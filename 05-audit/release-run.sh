#!/usr/bin/env bash
# release-run.sh — 发布状态探测与回执（**只读**，不发布任何东西）
#
# ============================================================================
# 为什么它存在
# ----------------------------------------------------------------------------
#   release.yml 原来是一条直线：npm publish 成功、`gh release create` 失败
#   ⇒ 重跑时必然撞 403（版本已存在）⇒ 流程永久卡住，只能人工补。
#
#   要能续跑，第一步不是"加个 if"，而是**能问出现在处于哪一步**。
#   这个脚本只回答三个问题，不改任何状态：
#     · registry 上有没有这个版本？
#     · 如果有，它是不是由这个 tag 的这次构建产出的？（provenance 绑定）
#     · GitHub Release 有没有？
#
#   ⚠️ 第二条是关键：只看"版本存在"就跳过发布，等于把**任何**已存在的包
#      当成"我们发的那一个"。错的版本会被当成成功状态，然后继续建 Release。
#
# ============================================================================
# 输出协议
# ----------------------------------------------------------------------------
#   stdout **只有** key=value（供 `>> "$GITHUB_OUTPUT"` 直接消费）：
#       npm=present|absent
#       release=present|absent
#       provenance=ok|absent|mismatch|unreadable
#   人话一律走 stderr —— 混进 stdout 会让 GITHUB_OUTPUT 解析失败。
#
#   退出码：0 状态一致；1 状态不一致（不许当成成功）；2 环境不可用（网络/git）
#
# 用法：
#   bash 05-audit/release-run.sh probe     # 探测；不一致时非 0
#   bash 05-audit/release-run.sh verify    # 收尾回执；任一缺失/不符则非 0
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

REG="https://registry.npmjs.org/"
PKG="agentcss"
VER="$(tr -d '[:space:]' < VERSION)"
TAG="v$VER"

log() { printf '%s\n' "$*" >&2; }

# 0 present / 1 absent / 2 registry 不可达（不能把"网断了"报成"没发布"）
npm_state() {
  if npm view "$PKG@$VER" version --registry="$REG" >/dev/null 2>&1; then
    printf 'present\n'
    return 0
  fi
  if npm view "$PKG" name --registry="$REG" >/dev/null 2>&1; then
    printf 'absent\n'
    return 1
  fi
  printf 'unreadable\n'
  return 2
}

release_state() {
  if ! command -v gh >/dev/null 2>&1; then
    printf 'unreadable\n'
    return 2
  fi
  if gh release view "$TAG" --json tagName >/dev/null 2>&1; then
    printf 'present\n'
    return 0
  fi
  printf 'absent\n'
  return 1
}

# 读 provenance 里的 gitCommit。stdout = 提交（40 位）或空。
#
# 🔴 用 python3 而不是 node（2026-11 修）：
#   这条脚本跑在 bash 门禁里，而 `selftest-all` 会在**任何**装了 python 的
#   机器上跑它。第一版用 `node -e` 解析 JSON —— 本地有 node 时全绿，
#   而 selftest 在没装 node 的环境里一律得到 `provenance=unreadable`
#   （实测：Ubuntu 22.04 裸机、以及本仓 Windows 侧的 WSL）。
#   那不是"包有问题"，是**判据的工具缺失伪装成了结论**。
#   ⇒ 本仓所有门禁都要求 python3，沿用它就没有额外的隐式依赖。
prov_commit_of() {
  local f="$1"
  python3 - "$f" <<'PY' 2>/dev/null
import base64, json, sys
with open(sys.argv[1], encoding='utf-8') as fh:
    j = json.load(fh)
att = j.get('attestations') or []
a = next((x for x in att
          if (x.get('predicateType') or '').endswith('provenance/v1')), None)
if a is None:
    sys.exit(3)
st = json.loads(base64.b64decode(a['bundle']['dsseEnvelope']['payload']))
deps = st['predicate']['buildDefinition'].get('resolvedDependencies') or []
sys.stdout.write(str((deps[0].get('digest') or {}).get('gitCommit') or ''))
PY
}

provenance_state() {
  local tmp code commit tag_commit
  if ! command -v curl >/dev/null 2>&1; then
    printf 'unreadable\n'
    return 2
  fi
  tmp="$(mktemp)"
  code="$(curl -s -o "$tmp" -w '%{http_code}' \
    "https://registry.npmjs.org/-/npm/v1/attestations/$PKG@$VER" || echo 000)"
  if [ "$code" = "404" ]; then
    rm -f "$tmp"
    log "  provenance: registry 上没有这个版本的 attestation（不是本工作流发布的）"
    printf 'absent\n'
    return 1
  fi
  if [ "$code" != "200" ]; then
    rm -f "$tmp"
    log "  provenance: attestation 接口返回 $code ⇒ 读不到，不能当成通过"
    printf 'unreadable\n'
    return 2
  fi
  commit="$(prov_commit_of "$tmp")"
  rm -f "$tmp"
  if [ -z "$commit" ]; then
    log "  provenance: attestation 里没有 gitCommit"
    printf 'unreadable\n'
    return 2
  fi
  tag_commit="$(git rev-parse --verify "$TAG^{commit}" 2>/dev/null || true)"
  if [ -z "$tag_commit" ]; then
    log "  provenance: 本地没有 $TAG（浅克隆？）⇒ 无法比对"
    printf 'unreadable\n'
    return 2
  fi
  if [ "$(printf '%s' "$commit" | tr 'A-F' 'a-f')" != \
       "$(printf '%s' "$tag_commit" | tr 'A-F' 'a-f')" ]; then
    log "  provenance: 包的 gitCommit=$commit，而 $TAG 指向 $tag_commit"
    log "  ⇒ npm 上这个版本**不是**这个 tag 构建的。不许把它当成已完成状态。"
    printf 'mismatch\n'
    return 1
  fi
  printf 'ok\n'
  return 0
}

do_probe() {
  local n r p rc
  n="$(npm_state)"; rc=$?
  if [ "$rc" = "2" ]; then
    log "  registry 不可达（不是'没发布'）⇒ 拒绝判定"
    exit 2
  fi
  r="$(release_state)"; rc=$?
  if [ "$rc" = "2" ]; then
    log "  gh 不可用或未认证 ⇒ 拒绝判定（设 GH_TOKEN）"
    exit 2
  fi
  p="unknown"
  if [ "$n" = "present" ]; then
    p="$(provenance_state)"; rc=$?
    if [ "$rc" != "0" ]; then
      printf 'npm=%s\nrelease=%s\nprovenance=%s\n' "$n" "$r" "$p"
      exit 1
    fi
  fi
  printf 'npm=%s\nrelease=%s\nprovenance=%s\n' "$n" "$r" "$p"
}

do_verify() {
  local n r p rc c i=0 step="${WAIT_STEP:-10}" tries="${WAIT_TRIES:-18}"
  # 🔴 先等 registry 索引（2026-11 加 · v0.24.2 现场打出来的）
  #   npm publish 返回 0 之后，**版本端点还要几十秒才可见**。
  #   回执在 publish 之后立刻跑，于是拿到 npm=absent ⇒ 报"发布未完成"。
  #   实际是发布成功、回执错判 —— 一次**假红**，而且出现在最不该出错的地方。
  #   ⇒ 只在"absent"上等（present 立刻返回；unreadable 说明网络/接口有问题，
  #      等下去也不会变，直接判环境不可用）。
  #   ⚠️ 用"尝试次数"而不是"累计秒数"做上界：`WAIT_STEP=0` 时（自检用）
  #      累计秒数永远不涨 ⇒ 死循环。这种写法在自检里才会暴露。
  while [ "$i" -lt "$tries" ]; do
    n="$(npm_state)" || true
    [ "$n" = "present" ] && break
    [ "$n" = "unreadable" ] && break
    i=$((i + 1))
    [ "$i" -ge "$tries" ] && break
    log "  registry 还没索引到 $PKG@$VER（第 $i 次重试 / 上限 ${tries}）"\
" —— npm 发布是最终一致的，继续等"
    sleep "$step"
  done
  if [ "$n" = "unreadable" ]; then
    log "  registry 不可达 ⇒ 无法出回执"
    exit 2
  fi
  r="$(release_state)"; rc=$?
  [ "$rc" = "2" ] && { log "  gh 不可用 ⇒ 无法出回执"; exit 2; }
  p="unknown"
  if [ "$n" = "present" ]; then
    p="$(provenance_state)" || true
  fi
  c="$(git rev-parse --short=12 "$TAG^{commit}" 2>/dev/null || echo '?')"
  # 回执必须自带"是哪一版、哪个 tag、哪个提交、三态各是什么"——
  # 只写"成功"两个字，事后无法判断它验的是不是同一个东西。
  printf 'tag=%s  version=%s  commit=%s  npm=%s  provenance=%s  release=%s\n' \
    "$TAG" "$VER" "$c" "$n" "$p" "$r"
  if [ "$n" != "present" ] || [ "$r" != "present" ] || [ "$p" != "ok" ]; then
    log "  ⇒ 发布未完成或身份不符（npm/provenance/release 三者必须同时成立）"
    exit 1
  fi
}

# ============================================================================
# 反向测试（不联网、不发布任何东西）
# ----------------------------------------------------------------------------
# 夹具之间只差一个变量；其中「provenance 指向本 tag」与「指向别的提交」
# 唯一的差别就是 attestation 里的 gitCommit —— 若判据退化成
# "版本存在就算已完成"，后者会通过，而它正是最危险的那种假绿。
# ============================================================================
selftest() {
  local tmp sha body_ok body_bad out rc bad=0 total=0

  tmp="$(mktemp -d)"
  mkdir -p "$tmp/05-audit" "$tmp/bin"
  cp "$0" "$tmp/05-audit/release-run.sh"
  printf '0.24.2\n' > "$tmp/VERSION"
  ( cd "$tmp" || exit 2
    git init -q
    git config user.email 'rt@example.invalid'
    git config user.name 'rt'
    git add -A
    git commit -qm base
    git tag -a v0.24.2 -m 'selftest' ) >/dev/null 2>&1
  sha="$( cd "$tmp" && git rev-parse HEAD )"

  cat > "$tmp/bin/npm" <<'SH'
#!/usr/bin/env bash
# STUB_NPM: present / absent / unreachable / flaky
#   flaky = 第一次说"没有"，之后说"有" —— 模拟 registry 索引延迟
case "${2:-}" in
  agentcss@*)
    case "${STUB_NPM:-absent}" in
      present) exit 0 ;;
      flaky)
        # 🔴 没给 STUB_FLIP 就**报错**，不许退回 `/nonexistent` 那种哨兵：
        #    哨兵在非 root 的 Linux 上写不进去 ⇒ 永远不翻转 ⇒ 用例静默失败。
        #    CI 实测就是这么红的（本地 Windows 与 WSL-as-root 恰好可写）。
        if [ -z "${STUB_FLIP:-}" ]; then
          echo 'selftest 桩：flaky 需要 STUB_FLIP' >&2
          exit 9
        fi
        if [ -f "$STUB_FLIP" ]; then exit 0; fi
        : > "$STUB_FLIP"
        exit 1 ;;
      *) exit 1 ;;
    esac ;;
  agentcss)   [ "${STUB_NPM:-absent}" = unreachable ] && exit 1 || exit 0 ;;
  *) exit 0 ;;
esac
SH
  cat > "$tmp/bin/gh" <<'SH'
#!/usr/bin/env bash
[ "${STUB_GH:-absent}" = present ] && exit 0 || exit 1
SH
  cat > "$tmp/bin/curl" <<'SH'
#!/usr/bin/env bash
prev=""
for a in "$@"; do
  if [ "$prev" = "-o" ]; then printf '%s' "${STUB_BODY:-}" > "$a"; fi
  prev="$a"
done
printf '%s' "${STUB_CODE:-200}"
SH
  chmod +x "$tmp/bin/npm" "$tmp/bin/gh" "$tmp/bin/curl"

  # 造一份"看起来像真的" attestation。同样用 python3 —— 夹具依赖 node
  # 会让自检在没装 node 的机器上以 `provenance=unreadable` 集体失败，
  # 而那看起来像"包有问题"，实际只是夹具造不出来。
  body_of() {
    python3 - "$1" <<'PY'
import base64, json, sys
st = {'predicate': {'buildDefinition': {
    'resolvedDependencies': [{'digest': {'gitCommit': sys.argv[1]}}]}}}
out = {'attestations': [{
    'predicateType': 'https://slsa.dev/provenance/v1',
    'bundle': {'dsseEnvelope': {
        'payload': base64.b64encode(
            json.dumps(st).encode('utf-8')).decode('ascii')}},
}]}
sys.stdout.write(json.dumps(out))
PY
  }
  body_ok="$(body_of "$sha")"
  body_bad="$(body_of "1111111111111111111111111111111111111111")"

  probe_stub() {
    STUB_NPM="$1" STUB_GH="$2" STUB_CODE="$3" STUB_BODY="$4" \
      PATH="$tmp/bin:$PATH" bash "$tmp/05-audit/release-run.sh" probe 2>/dev/null
  }
  # 🔴 WAIT_STEP / WAIT_TRIES / STUB_FLIP 三个都必须显式传：
  #   · 不传步长 ⇒ 走默认 18×10s，flaky 那一例要跑 180 秒（CI 实测 171s）；
  #   · 不传 STUB_FLIP ⇒ 桩退回哨兵 `/nonexistent`，而**非 root 的 Linux**
  #     写不进去 ⇒ flip 永远不翻转 ⇒ "等到 present"那条必然失败。
  #     Windows 与 WSL-as-root 恰好可写，所以本地全绿、CI 红 ——
  #     夹具依赖了运行身份的权限，比判据写错更难查。
  #   ⇒ 现在桩也会在缺 STUB_FLIP 时**直接报错**，不再静默退化。
  # ⚠️ 这里**合并 stderr**（`2>&1`）：回执的结论行在 stdout，但"为什么是这个结论"
  #    在 stderr（重试了几次、哪一步不可达）。只留 stdout 就没法断言"它到底等没等"。
  verify_stub() {
    WAIT_STEP=0 WAIT_TRIES=5 \
      STUB_NPM="$1" STUB_GH="$2" STUB_CODE="$3" STUB_BODY="$4" \
      STUB_FLIP="$tmp/flip" \
      PATH="$tmp/bin:$PATH" bash "$tmp/05-audit/release-run.sh" verify 2>&1
  }

  chk() {
    local ok=1
    total=$((total + 1))
    [ "$2" = "$3" ] || ok=0
    case "$4" in *"$5"*) ;; *) ok=0 ;; esac
    if [ "$ok" = "1" ]; then
      printf '  OK  %-52s\n' "$1"
    else
      printf '  X   %-52s rc=%s 期望=%s 输出=%s\n' "$1" "$3" "$2" "$4"
      bad=$((bad + 1))
    fi
  }

  # 「不许出现」也是一条判据：unreadable 时**不该**去重试，
  # 否则"网断了"会被 18×10s 拖成三分钟，最后还是同一个结论。
  chk_not() {
    local ok=1
    total=$((total + 1))
    [ "$2" = "$3" ] || ok=0
    case "$4" in *"$5"*) ok=0 ;; esac
    if [ "$ok" = "1" ]; then
      printf '  OK  %-52s\n' "$1"
    else
      printf '  X   %-52s rc=%s 期望=%s 输出=%s\n' "$1" "$3" "$2" "$4"
      bad=$((bad + 1))
    fi
  }

  out="$(probe_stub absent absent 200 '')"; rc=$?
  chk 'npm 不存在 ⇒ 待发布' 0 "$rc" "$out" 'npm=absent'

  out="$(probe_stub present absent 200 "$body_ok")"; rc=$?
  chk '已发布且 provenance 指向本 tag ⇒ 可跳过' 0 "$rc" "$out" 'provenance=ok'

  out="$(probe_stub present absent 200 "$body_bad")"; rc=$?
  chk '已发布但 provenance 指向别的提交 ⇒ 拒绝' 1 "$rc" "$out" 'provenance=mismatch'

  out="$(probe_stub present absent 404 '')"; rc=$?
  chk '已发布但无 attestation ⇒ 拒绝' 1 "$rc" "$out" 'provenance=absent'

  out="$(probe_stub unreachable absent 200 '')"; rc=$?
  chk 'registry 不可达 ⇒ 不判成 absent' 2 "$rc" "$out" ''

  out="$(verify_stub present absent 200 "$body_ok")"; rc=$?
  chk '回执：Release 缺失 ⇒ 非 0' 1 "$rc" "$out" 'release=absent'

  out="$(verify_stub present present 200 "$body_ok")"; rc=$?
  chk '回执：三者齐备 ⇒ 0 且带提交号' 0 "$rc" "$out" 'commit='

  # 🔴 v0.24.2 现场：publish 成功，回执立刻查 → npm=absent → 报"未完成"。
  #   这里造一个"第一次说没有、第二次说有"的 registry，断言回执会等。
  rm -f "$tmp/flip"
  out="$(verify_stub flaky present 200 "$body_ok")"; rc=$?
  chk '回执：registry 索引延迟 ⇒ 等到 present 再判' 0 "$rc" "$out" 'npm=present'

  # ④ 真的没发出去：等满次数之后必须判失败，而且要说清"absent"，不是"超时"
  out="$(verify_stub absent present 200 "$body_ok")"; rc=$?
  chk '回执：npm 始终缺席 ⇒ 判失败且写明 absent' 1 "$rc" "$out" 'npm=absent'

  # ⑤ 包在、Release 在，但 attestation 指向**别的提交** ⇒ 身份不符，必须拒绝。
  #    若判据退化成"版本存在就算完成"，这一条会绿 —— 它是最危险的假绿。
  out="$(verify_stub present present 200 "$body_bad")"; rc=$?
  chk '回执：provenance 指向别的提交 ⇒ 拒绝' 1 "$rc" "$out" 'provenance=mismatch'

  # ⑥ registry 不可达：判 2（环境不可用），且**一次都不重试** ——
  #    "网断了"等下去不会变，重试只会把 3 分钟浪费在同一个结论上。
  out="$(verify_stub unreachable present 200 '')"; rc=$?
  chk '回执：registry 不可达 ⇒ rc=2' 2 "$rc" "$out" 'registry 不可达'
  chk_not '回执：不可达时不重试（不等索引延迟）' 2 "$rc" "$out" '第 1 次重试'

  rm -rf "$tmp"
  if [ "$bad" = "0" ]; then
    log "  release-run 反向测试：$total/$total 通过"
  else
    log "  release-run 反向测试：$bad/$total 条未通过"
  fi
  return "$bad"
}

case "${1:-}" in
  probe)  do_probe ;;
  verify) do_verify ;;
  --selftest) selftest; exit $? ;;
  *)
    log "用法: bash 05-audit/release-run.sh probe|verify|--selftest"
    exit 2
    ;;
esac
