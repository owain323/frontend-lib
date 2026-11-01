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
  local n r p rc c
  n="$(npm_state)"; rc=$?
  [ "$rc" = "2" ] && { log "  registry 不可达 ⇒ 无法出回执"; exit 2; }
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
  local tmp sha body_ok body_bad out rc bad=0

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
case "${2:-}" in
  agentcss@*) [ "${STUB_NPM:-absent}" = present ] && exit 0 || exit 1 ;;
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
  verify_stub() {
    STUB_NPM="$1" STUB_GH="$2" STUB_CODE="$3" STUB_BODY="$4" \
      PATH="$tmp/bin:$PATH" bash "$tmp/05-audit/release-run.sh" verify 2>/dev/null
  }

  chk() {
    local ok=1
    [ "$2" = "$3" ] || ok=0
    case "$4" in *"$5"*) ;; *) ok=0 ;; esac
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

  rm -rf "$tmp"
  if [ "$bad" = "0" ]; then
    log '  release-run 反向测试：7/7 通过'
  else
    log "  release-run 反向测试：$bad 条未通过"
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
