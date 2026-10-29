#!/usr/bin/env bash
# check-all.sh — 跑全部门禁，一条命令
#
# 🔴 建的。理由：这一晚我漏了 `--dir .` 参数，
#    6 道门禁假报 FAIL —— **手动敲 16 条命令本身就是不可靠的**。
#    门禁的价值在于"每次都跑"，跑不全等于没有。
set -u
cd "$(dirname "$0")/.." || exit 2
# ⭐ 允许外部指定解释器：`PY=/path/to/python bash 05-audit/check-all.sh`
#   为什么必须能覆盖：写死 `python` 时，若默认那个是版本过低或缺某个标准库模块，
#   成批门禁会**假报 FAIL**，而外人看不出是环境问题还是代码问题。
#   （2026-10-29 起视觉回归已零依赖，不再需要为 Pillow 单独指定解释器。）
PY="${PY:-python}"
# ⭐ 优先用环境变量；否则在常见位置里探测（只用相对位置，不写死绝路径）。
if [ -z "${NODE_DIR:-}" ]; then
  for _c in "$HOME/.local/share/frontend-lib-tools/node"            "$PWD/.toolchain/node"; do
    if [ -x "$_c/node" ]; then NODE_DIR="$_c"; break; fi
  done
fi
[ -z "${NODE_DIR:-}" ] && NODE_DIR=node
[ -x "$NODE_DIR/node" ] && export PATH="$NODE_DIR:$PATH"

# 行为脚本的依赖解析路径
# 优先用环境变量（运行者指定），否则向上探测。
if [ -z "${NODE_MODULES:-}" ]; then
  _d="$PWD"
  for _up in 1 2 3 4 5; do
    for _c in "$_d/node_modules"              "$HOME/.workbuddy/binaries/node/workspace/node_modules"; do
      if [ -d "$_c" ]; then NODE_MODULES="$_c"; break 2; fi
    done
    _d=$(dirname "$_d")
  done
fi
[ -z "${NODE_MODULES:-}" ] && NODE_MODULES=node_modules
export NODE_PATH="$NODE_MODULES"

# 🔴 浏览器 profile 落到**仓库同一块盘**（2026-10-29 实测）
#   本机 C 盘 476G 被占满时，puppeteer 建临时 profile 会直接失败
#   ⇒ 一批浏览器门禁集体报错，而代码一个字都没改。
#   browser.js 早就有 FL_TMPDIR 这个口子，这里给它一个默认值；
#   已经设了就不动（陌生环境里 os.tmpdir() 是对的）。
if [ -z "${FL_TMPDIR:-}" ] && [ -d "$PWD/.git" ]; then
  FL_TMPDIR="$PWD/.git/tmp"
  mkdir -p "$FL_TMPDIR" 2>/dev/null && export FL_TMPDIR
fi

fail=0
TIMING="${TIMING:-}"
# =========================================================
# 分层：按改动范围决定要跑哪些检查（ J12）
# ---------------------------------------------------------
# 动机：全量 143 道要几分钟。改一个按钮就等几分钟，
#       等于**开发流程在替我承担不必要的等待**。
# 分层：
#   MODE=fast      只跑静态检查（秒级）—— 跳过「组件层」
#   MODE=component 只跑「组件层」（需浏览器 / 重型外部工具，分钟级）
#   MODE=full      全量（收尾、发版前）
#
# 🔴 层怎么判（0.8.9 改 · 外部审计 P2-6）：
#   按优先级三级判定，都是**机械可判**的，没有硬编码名单：
#     ① 命令行带标记          `run "tok-b" @component $PY x.py`
#        ⇒ 同一个脚本分两种层时用它（token-parse 的静态半 / 浏览器半）
#     ② 命令文本含 node / puppeteer / playwright / with-server
#     ③ **脚本自己声明**：文件头 40 行内有 `# LAYER: component`
#   ⚠️ 之前只有 ② ⇒ 两个重型门禁漏网（`beh-reverse`、`pack-smoke`
#      的命令文本里没有 `node`，但内部起浏览器 / 跑 npm）
#      ⇒ fast 照样跑它们，各几十秒。
#
# 🔴 跳过必须**打出来**（0.8.9 改）：
#   之前是静默 `return 0` ⇒ 日志里 0 行 SKIP，「跑了多少 / 跳了多少」不可见。
#   这与本文件自己的原则冲突（「跳过不是通过，它是一条**真话**」）。
# =========================================================
# 🔴 两种传参方式**都要支持**（0.9.0 修 · 发布时才发现）：
#
#   MODE=fast bash 05-audit/check-all.sh     ← POSIX shell 语法
#   bash 05-audit/check-all.sh --fast        ← 任何环境都能用
#
#   为什么必须加第二种：`MODE=fast cmd` 这种「变量前缀」只有 POSIX shell 认。
#   而 **npm scripts 在 Windows 上走 `cmd.exe`**，`publish:check` 里写了
#   `MODE=fast bash …` ⇒ 直接崩：
#
#       > MODE=fast bash 05-audit/check-all.sh
#       无效参数 - =fast        （cmd 把 `MODE=fast` 当成了一个参数）
#       npm error code 4294967295
#
#   后果不是"检查没跑"，而是 **`npm publish` 在 Windows 上必然失败** ——
#   而 `prepublishOnly` 正是挂在它上面的。这条从来没被发现过，因为
#   从来没有人真的跑过一次 `npm publish`。
#
#   ⇒ 命令行参数优先于环境变量，两者等价。
for _arg in "$@"; do
  case "$_arg" in
    --fast)      MODE=fast ;;
    --component) MODE=component ;;
    --full)      MODE=full ;;
    # 计时日志同样要能用**参数**传：`TIMING=/tmp/x bash …` 在 Windows 的
    # cmd.exe 里会崩（和 MODE 是同一个原因）。默认路径见 --timing 无值时。
    --timing)    TIMING="${TMPDIR:-/tmp}/gate-timing.txt" ;;
    --timing=*)  TIMING="${_arg#--timing=}" ;;
    # 并发执行（0.11.15）：默认 4 路；--serial 回到逐条，用于排查"并发才出现"的怪问题。
    --serial)    PARALLEL=1 ;;
    --parallel=*) PARALLEL="${_arg#--parallel=}" ;;
  esac
done
MODE="${MODE:-full}"
# ---------- 分层判定（0.8.9）------------------------------------------------
_ran=0        # 本轮**真的执行了**的门禁数
_skipped=0    # 本轮**按层跳过**的门禁数
_layer_of() { # _layer_of <命令...>  → 回显 static / component
  local a
  for a in "$@"; do
    [ "$a" = "@component" ] && { echo component; return; }
    [ "$a" = "@static" ]    && { echo static;    return; }
  done
  case "$*" in
    *node*|*puppeteer*|*playwright*|*with-server*) echo component; return ;;
  esac
  # 脚本自声明（只读文件头 40 行，够快）
  local tok
  for tok in "$@"; do
    case "$tok" in
      *.py|*.js|*.mjs|*.sh)
        if [ -f "$tok" ] && head -40 "$tok" 2>/dev/null \
             | grep -qE '^# *LAYER: *component'; then
          echo component; return
        fi
        ;;
    esac
  done
  echo static
}
_should_skip() { # _should_skip <层>  → 0 表示本轮该跳过
  case "$MODE" in
    fast)      [ "$1" = component ] && return 0 ;;
    component) [ "$1" = static ]    && return 0 ;;
  esac
  return 1
}
_exec_args() { # 去掉命令行里的层标记，回显真正的命令
  local out=() a
  for a in "$@"; do
    case "$a" in @component|@static) ;; *) out+=("$a") ;; esac
  done
  printf '%s\n' "${out[*]}"
}

# =========================================================
# 并发执行框架（0.11.15）
# ---------------------------------------------------------
# 动机：全量串行约 20 分钟，而最慢的 10 道占 12.5 分钟 ——
#   它们都是"各自另开一个浏览器、重走一遍全部页面"。
#   实测 4 道同时跑（zoom-reflow / rtl-render / beh-reverse / demo-claim）：
#   串行 354s → 并发 142s，全部返回 0，互不干扰。
#
# 🔴 两条纪律，缺一条这个改造就是负收益：
#   ① **输出顺序不变**：每条门禁的输出落到临时文件，全部跑完再按注册顺序打印。
#      并发最容易毁掉的是"日志还能不能读" —— 交错输出会让失败诊断失效，
#      而失败诊断正是门禁存在的一半理由。
#   ② **写盘 / 独占资源的门禁必须串行**：命令里写 @serial。
#      判定不靠人记名单，靠标记（与 @component 同构，同一个理由）。
#
# 回退：--serial 或 PARALLEL=1 回到逐条执行。
# =========================================================
# 🔴 缓冲目录放在**仓库同一块盘**上，不是 $TMPDIR。
#   实测教训：本机 C 盘被别的程序占满（476G/476G），而仓库在 E 盘。
#   203 道门禁的完整输出如果落在 C 盘，会在"没空间"时集体失败 ——
#   那看起来像"203 处代码坏了"，实际是盘满了。
#   放进 .git/ 是为了不污染工作区（repo-hygiene 会扫未跟踪文件）。
if [ -d "$PWD/.git" ]; then _GATE_BASE="$PWD/.git"; else _GATE_BASE="${TMPDIR:-/tmp}"; fi
GATE_TMP=$(mktemp -d "$_GATE_BASE/gate.XXXXXX") || { echo "无法创建临时目录"; exit 2; }
trap 'rm -rf "$GATE_TMP"' EXIT
T_NAME=(); T_CMD=(); T_KIND=(); T_SER=(); T_TEXT=()
_ran=0
_skipped=0

_serial_of() { # 命令里带 @serial ⇒ 独占跑
  local a
  for a in "$@"; do
    if [ "$a" = "@serial" ]; then echo 1; return; fi
  done
  echo 0
}

_enqueue() { # _enqueue <名字> <层> <kind: run|report> <serial> <命令...>
  local name="$1" layer="$2" kind="$3" ser="$4"; shift 4
  local i=${#T_NAME[@]}
  T_NAME[$i]="$name"; T_KIND[$i]="$kind"; T_SER[$i]="$ser"
  T_CMD[$i]=$(printf '%q ' "$@")
  _ran=$((_ran+1))
}

_start() { # _start <idx> —— 执行一条，只落 rc / 耗时 / 原始输出
  local i="$1" t0 t1 r
  t0=$(date +%s)
  eval "${T_CMD[$i]}" > "$GATE_TMP/out.$i" 2>&1
  r=$?
  t1=$(date +%s)
  printf '%s\n' "$r" > "$GATE_TMP/rc.$i"
  printf '%s\n' "$((t1 - t0))" > "$GATE_TMP/dt.$i"
}

_print() { # _print <idx> —— 按注册顺序打印，诊断逻辑与旧版逐字相同
  local i="$1" name="${T_NAME[$i]:-}" kind="${T_KIND[$i]:-run}"
  local rcv dtv out
  if [ "$kind" = echo ]; then printf '%s\n' "${T_TEXT[$i]:-}"; return 0; fi
  if [ "$kind" = skip ]; then
    printf '  %-16s SKIP  （%s）\n' "$name" "${T_TEXT[$i]:-}"
    return 0
  fi
  rcv=$(cat "$GATE_TMP/rc.$i" 2>/dev/null || echo 1)
  dtv=$(cat "$GATE_TMP/dt.$i" 2>/dev/null || echo 0)
  out=$(cat "$GATE_TMP/out.$i" 2>/dev/null || true)
  [ -n "$TIMING" ] && echo "$dtv $name" >> "$TIMING"

  if [ "$rcv" -eq 0 ]; then
    if [ "$kind" = report ]; then
      printf '  %-16s 报告（发现项不判失败）  %3ss\n' "$name" "$dtv"
      [ -n "$out" ] && printf '%s\n' "$out" | head -8 | sed 's/^/       /'
    else
      printf '  %-16s PASS  %3ds\n' "$name" "$dtv"
    fi
    return 0
  fi

  printf '  %-16s FAIL  %3ds\n' "$name" "$dtv"
  # 🔴 失败就把门禁**自己的话**原样打出来（0.11.9 修 · 门禁第一次在 CI 上跑时踩到）
  #   旧写法是 `grep -E '^\s*\[' | head -6`，有两个致命盲点：
  #     ① `head -6` 截断 ⇒ 结论是**错的**：
  #        release-gate 有 13 节，日志里只剩 `[1]`…`[6]`，
  #        看起来像"前六节全挂了"，实际挂的是第 10 节。
  #        **一个会给出错误结论的诊断，比没有诊断更坏。**
  #     ② grep 只认 `[...]` 开头的行，把明细行（`· 文件 原因`）全丢了 ⇒
  #        wiring 明明报了 3 处、每处都带着文件名，日志里**一处都看不见**。
  #   ⇒ 判据：失败的完整输出才是证据。要截断只能因为太长，
  #     并且必须**说清楚截了多少**；末尾必须保留（崩溃栈在末尾）。
  local _total
  _total=$(printf '%s\n' "$out" | wc -l | tr -d ' ')
  if [ "$_total" -le 160 ]; then
    printf '%s\n' "$out" | sed 's/^/       │ /'
  else
    printf '%s\n' "$out" | head -120 | sed 's/^/       │ /'
    printf '       │ …（共 %s 行，此处省略中间部分；下面贴末尾 40 行，崩溃栈通常在那里）\n' "$_total"
    printf '%s\n' "$out" | tail -40 | sed 's/^/       │ /'
  fi
  if [ -z "$out" ]; then
    printf '       🔴 门禁零输出却退出非 0 ⇒ 视为崩溃，不是"检查不通过"。\n'
  fi
  # 🔴 环境类失败要说清（0.8.9 修 · 外部审计修复过程中撞到）
  #   上面那行只显示**门禁自己的判词**，于是
  #   「Cannot find module 'puppeteer-core'」这类**环境问题**
  #   一个字都不显示 ⇒ 只剩 60 多个光秃秃的 FAIL，
  #   看起来像"产品坏了 60 处"，实际是"依赖没装"。
  if printf '%s\n' "$out" | grep -qE "Cannot find module|MODULE_NOT_FOUND|ECONNREFUSED|找不到浏览器|找不到 Chrome|Traceback \(most recent call last\)"; then
    printf '       🔴 上面出现了**环境类**报错（不是检查不通过）：\n'
    printf '       ⇒ 先把环境修好（装依赖 / 起静态服务），否则这一批的结果没有意义。\n'
  fi
  fail=$((fail+1))
}

flush_all() { # 串行独占的先跑 → 其余并发 → 全部跑完再按序打印
  local total=${#T_NAME[@]}
  [ "$total" -eq 0 ] && return 0
  local par="${PARALLEL:-4}"
  case "$par" in ''|*[!0-9]*) par=4 ;; esac
  local i

  # 串行门禁（@serial）：先独占执行完
  for ((i = 0; i < total; i++)); do
    [ "${T_KIND[$i]:-}" = echo ] && continue
    [ "${T_KIND[$i]:-}" = skip ] && continue
    if [ "${T_SER[$i]:-0}" = 1 ]; then _start "$i"; fi
  done

  if [ "$par" -gt 1 ]; then
    local -a pid
    for ((i = 0; i < total; i++)); do
      [ "${T_KIND[$i]:-}" = echo ] && continue
      [ "${T_KIND[$i]:-}" = skip ] && continue
      [ "${T_SER[$i]:-0}" = 1 ] && continue
      _start "$i" &
      pid[$i]=$!
      while :; do
        local alive=0 k
        for k in "${!pid[@]}"; do
          if kill -0 "${pid[$k]}" 2>/dev/null; then alive=$((alive + 1)); fi
        done
        [ "$alive" -lt "$par" ] && break
        sleep 0.2
      done
    done
    wait
  else
    for ((i = 0; i < total; i++)); do
      [ "${T_KIND[$i]:-}" = echo ] && continue
      [ "${T_KIND[$i]:-}" = skip ] && continue
      [ "${T_SER[$i]:-0}" = 1 ] && continue
      _start "$i"
    done
  fi

  for ((i = 0; i < total; i++)); do _print "$i"; done
}

section() { # section 标题 —— 也进队列，保证日志顺序与源码顺序一致
  local i=${#T_NAME[@]}
  T_NAME[$i]=""; T_KIND[$i]="echo"; T_SER[$i]=0; T_CMD[$i]=""
  T_TEXT[$i]="$1"
}

run() {  # run <名字> <命令...>
  local name="$1"; shift
  # ---------- 分层 ----------
  local _layer
  _layer=$(_layer_of "$@")
  if _should_skip "$_layer"; then
    skip "$name" "$_layer 层 —— MODE=$MODE 不跑"
    return 0
  fi
  local _ser
  _ser=$(_serial_of "$@")
  # 🔴 用数组过滤而不是 `set -- $(_exec_args ...)` —— 后者把命令重新拆成单词，
  #    任何带空格的参数都会被拆坏。0.11.15 加 @serial 时正好一起改掉。
  local -a _cmd=()
  local _a
  for _a in "$@"; do
    case "$_a" in @component|@static|@serial) ;; *) _cmd+=("$_a") ;; esac
  done
  _enqueue "$name" "$_layer" run "$_ser" "${_cmd[@]}"
}

# 🔴 run_report <名字> <命令...> —— **报告模式**（N16）
#  与 run() 的区别只有一条：脚本**发现问题时**不判失败（误报率偏高，见 css-imports 头），
#  但：① 脚本**自身出错**仍然判失败；② 报告**必须打出来**。
#
#  ⚠️ 0.8.9 状态：**当前没有使用者**。
#     它的两个原使用者（css-imports / dead-class）都已升为真门禁 run——
#     因为判据收紧后误报降到 0，而"永远 PASS 的门禁等于没有门禁"（I-10）。
#     ⇒ 保留这个机制本身（它是一种**正当的过渡态**：
#       新写的门禁误报率高时，先挂在这里报告、积累样本、再升 run），
#       但**不要**把它当成"可以长期不判失败"的许可证。
#     判据：任何挂在这里超过一个版本的门禁，要么升 run、要么说明为什么升不了。
#
#  为什么必须单独有一个：以前 css-imports 写成
#     `$PY css-imports.py >/dev/null 2>&1 && echo PASS || true`
#  ⇒ 报告被丢进 /dev/null（这条门禁的**唯一产出**被销毁），
#     脚本崩了也被 `|| true` 吞掉 ⇒ 它既不算门禁、也不报告、也不失败。
#
#  ⚠️ 用 run_report 的门禁**仍然计入总数**（doc-facts-gate 认这个名字），
#     但它不会让整套变红 —— 文档里写总数时要知道这一点。
run_report() {
  local name="$1"; shift
  local _layer
  _layer=$(_layer_of "$@")
  if _should_skip "$_layer"; then
    skip "$name" "$_layer 层 —— MODE=$MODE 不跑"
    return 0
  fi
  local _ser
  _ser=$(_serial_of "$@")
  local -a _cmd=()
  local _a
  for _a in "$@"; do
    case "$_a" in @component|@static|@serial) ;; *) _cmd+=("$_a") ;; esac
  done
  _enqueue "$name" "$_layer" report "$_ser" "${_cmd[@]}"
}

# 🔴 skip <名字> <原因> —— **显式登记"这条门禁存在，但本机跑不了"**
#  为什么必须有它：以前缺环境时只是 `echo "... SKIP"`，
#  那行**不在门禁名单里** ⇒ 门禁总数随机器变化（有 node 的机器多 3 条）。
#  ⇒ 文档里写"共 N 道"就必须跟机器绑定，否则必有一条是错的。
#  ⇒ 改成显式登记：**注册数在任何机器上都是同一个数**，变的只是"执行了几条"。
#
#  🔴 计数放在这里（0.8.9）：跳过有两种来源，都要算进"本轮跳过 M 道"：
#     ① 分层跳过（MODE=fast 不跑组件层）
#     ② 环境缺失（缺 typescript / 浏览器）
#   放在 skip() 里就一处覆盖两种；分散在各调用点必然漏（实测漏过 17 道）。
skip() {
  local i=${#T_NAME[@]}
  T_NAME[$i]="$1"; T_KIND[$i]="skip"; T_SER[$i]=0; T_CMD[$i]=""
  T_TEXT[$i]="$2"
  _skipped=$((_skipped+1))
}

section "=== 静态门禁 ==="
run "contrast"   $PY 05-audit/contrast.py
run "cmp-contrast" $PY 05-audit/component-contrast.py
run "tierA-sync" $PY 05-audit/make-tiersnippet.py --check
# 🔴 2026-10-06 补：这条**本来就该在**，但一直没接进来。
#    后果：theme-toggle.js 与 tokens.css 已经漂移了（28 vs 27 个暗色令牌），
#    门禁一声不响 —— 而它自己的文档还写着「--check 已接进门禁」。
#    ⇒ 文档说做了、实际没接，比没做更危险（你会以为有人在看）。
run "theme-sync" $PY 05-audit/theme-sync.py --check
# 机器可读契约（ai/components.json + ai/tokens.json）必须与源码一致
run "ai-contract" $PY 05-audit/gen-ai-contract.py --check
# 令牌解析正确性：孤儿注释收尾符 / var() 引用缺失 / （full 模式）浏览器复核
run "token-parse" $PY 05-audit/token-parse-gate.py --no-browser
# 令牌受众：每个令牌都得登记「给谁用的」；孤儿不许是 internal、公开孤儿必须进受审名单
run "token-aud"  $PY 05-audit/token-audience-gate.py
# 第二种令牌导出（分层 / 无 -- 前缀 / value 不带 $）：形状 + 浏览器 CSSOM 复核
run "token-tree" $PY 05-audit/token-tree-gate.py
# 颜色令牌分两层（D5）：`:root` 里不许再出现「语义名 = 颜色字面量」；
#   暗色段只许覆盖 L1；L1 / L2 必须 1:1。反向控制由 selftest-all 跑。
run "token-layer" $PY 05-audit/layer-tokens.py --check
# 机器可读契约层：schema 只用了实现过的关键字 / Profile 有鉴别力 / Patch 可回放
run "ai-layer"  node 05-audit/ai-layer-gate.js
# CI 工作流配置：**真 YAML 解析**（不是正则）—— timeout-minutes 必须是整数、
#   run 引用的脚本必须存在、每个 job 必须装依赖
run "workflow"   node 05-audit/workflow-gate.js
# 浏览器引擎矩阵：跑起来的引擎之间 UA 必须**两两不同**（不许"三个作业跑同一个浏览器"）
run "engine"     node 05-audit/engine-gate.js
# 规范三层分离：Invariant 层不许被 Contract / Guidance 污染
run "invariant"  $PY 05-audit/invariant-gate.py
# 兼容性 Benchmark：参考解法的十类编辑意图必须全部成立
run "benchmark"  @static node benchmark/run.js
# 🔴 跑批记录（W13）：`--record` 指向不存在的文件时，旧版只打一行 WARN 就 RC=0
#   —— 那等于"声称跑了批，其实没跑"。现在：文件不存在 ⇒ RC=2。
#   另外逐份校验记录形状（八条判据），并让**参考解法记录**必须拿满分：
#   它验证的是"记录 → 评分"这条管线本身；管线不自洽，任何模型分数都不可信。
#   ⚠️ 零记录时本项输出 UNVERIFIED（RC=0）—— 它说明"没有坏记录"，
#      不说明"模型已验证"。这个区别写在输出里，不许靠读者猜。
run "benchmark-records" @static node benchmark/run.js --check-records
run "benchmark-records-rev" @static node benchmark/run.js --selftest
# 核心不得混入呈现形态（slide/deck）语义 —— PPT 的事在 adapters/presentation/
run "core-boundary" $PY 05-audit/core-boundary-gate.py
# 呈现层自己的五条判据必须**真的会红**（0.4.2 补：它们此前一次都没被执行过）
run "presentation" $PY 05-audit/presentation-gate.py
# 级联分层就绪：`@layer` 计数 + 每处 !important 必须能归类（切层前的前提门控）
run "cascade-layer" $PY 05-audit/cascade-layer-gate.py
# 真机探针与基线表（W10 / W12）：探测清单必须与源码用法**双向**一致；
#   基线表不许有占位符，VERIFIED 的必须带完整 UA。
#   ⚠️ 基线表 0 行时本项 RC=0 但会打印 UNVERIFIED —— "表结构没问题"
#      不等于"测过了"，这个区别写在输出里。
run "webview-probe" @static $PY 05-audit/webview-probe-gate.py
# 声明合法性：写了浏览器不认的属性（如 border-inset-inline-*）会**静默失效**，
#   不报错、不影响解析、行为契约也抓不到 ⇒ 交给浏览器自己判定（CSS.supports）
run "css-validity" node 05-audit/css-validity-gate.js
# 页面骨架：骨架已收编的选择器（h1/h2/.wrap/body/code/…）页面不许再抄一遍
#   —— 抄了会被 `.page` 前缀静默盖掉，变成"改了却没变"的死代码
run "shell"       $PY 05-audit/shell-gate.py
run "start-here" $PY 05-audit/fix-start-here.py --check
run "content-hygiene" $PY 05-audit/hygiene.py
run "shot-path"  $PY 05-audit/shot-path.py
run "mojibake"   $PY 05-audit/mojibake-check.py .
run "repo-hygiene"  $PY 05-audit/repo-hygiene.py
# 🔴 组件之间不许有 CSS @import —— 「拷一个文件就能用」是库对外的承诺。
#   一旦有 @import，用户拷了 A 没拷 B，页面不报错、不警告，只少掉一部分样式。
#    注：注释里的 @import 不算（tokens.css 正在教用户怎么 import 我们）。
#   注入验证过一次：给 badge.css 追加 @import ⇒ 精确报出第 143 行。
run "css-independence" $PY 05-audit/css-independence.py
# 🔴 HTML 标签配平（0.8.9 接进来 · 外部审计 P1-8 点名的孤儿门禁）：
#   它抓的是 **axe 与静态类名门禁都抓不到** 的一类 —— 未闭合 / 串位的标签。
#   浏览器会自动纠正，所以页面"看起来正常"，不留任何痕迹。
#   实测它一接进来就抓到 3 个真问题（`<main>` 串成 `</div>`、
#   一个 `<main class="wrap">">` 多出的 `">` 会当文本渲染出来）。
#   ⚠️ 接进来之前先修了它自己的两个洞（都在文件头留档）：
#     ① 报的行号是"剥离后文本"的坐标 ⇒ 人定位不到 ⇒ 改成保留换行
#     ② 注释与挖空的顺序反了 ⇒ 注释里的 `<script src=…>` 会把后面
#        几十行的真标签一起吞掉 ⇒ 报出指向错误位置的假红
run "tag-balance"   $PY 05-audit/tag-balance.py
# 🔴 组件「接线」检查（0.8.9 接进来 · 外部审计 P1-8 点名的孤儿门禁）：
#   属性用了、配套的类名 / 脚本引了吗？引的文件真的在吗？
#   实测抓过真问题：sparkline 的 JS 找 `.sparkline[data-spark]`，
#   而 demo 写的是 `class="spark"` ⇒ 9 个图一个都没画出来，且**不报错**。
#   ⚠️ 接进来之前先修了它的两个洞：
#     ① 扫描范围是 `**/*.html` ⇒ 把 node_modules/ 里的第三方页面
#        也扫进来，报出一堆 `/assets/index-xxx.js 不存在`（那是别人包的产物）
#     ② 属性提取用的是全文本正则 ⇒ 把 `<code>&lt;script src="…"&gt;</code>`
#        这种**转义示例**当成真引用 ⇒ 假红。改成只在**真标签**内取属性。
run "wiring"        $PY 05-audit/wiring-check.py
run "deps"      $PY 05-audit/deps.py --missing
run "behavior"  $PY 05-audit/gen-behavior.py --check
# 行为覆盖矩阵：哪些组件必须有哪种行为（不许靠省略跳过）
run "beh-matrix" $PY 05-audit/behavior-matrix-gate.py
# 成熟度阶梯：档位 = 独立重算；🔴 ladder 必须有鉴别力（不许 27 个组件全 stable）
run "maturity"  $PY 05-audit/maturity-gate.py
# 废弃治理：移除公开名字必须走流程（登记 → 迁移窗口 → 兑现）；基线只增不减
run "deprecation" $PY 05-audit/deprecation-gate.py
# 弃用政策文档 ↔ 登记册双向一致：漏告知（登记了没写）与假承诺（写了没登记）都要红。
# 🔴 为什么它必须单独一道：前面那道只保证"机器那一份自洽"，
#    使用者读的是 docs/DEPRECATIONS.md。两份文件描述同一件事就一定会漂，
#    而漂的两种方向**都不会让任何测试变红**。
run "deprec-doc" $PY 05-audit/deprecation-doc-gate.py
# 🔴 自动初始化的三处一致（2026-10-27 · P3 的正确修法）：
#   19 个全局里只有 6 个脚本会自动初始化，其余必须自己 create/new/attach。
#   这个区别以前没有任何文档写 —— 使用者把 Accordion 的经验套到 Select 上，
#   页面渲染正常、点了没反应、**不报错**。
#   ⇒ 现在：实现里的 @autoinit 标记 + API.md 那张表 + 文件里到底有没有
#     DOMContentLoaded，三者必须一致（双向）。
run "autoinit"    $PY 05-audit/autoinit-gate.py
echo ""
# 🔴 0.8.9：fast 是**纯静态**层，它不需要 :8000
#   （需要服务的门禁都已被判为 component 层并跳过）。
#   ⇒ 不再无条件起服务：否则 fast 也会占 8000 端口，
#     与用户本地的 dev server 抢端口、且让"秒级"档多花约 1 秒。
if [ "$MODE" = "fast" ]; then
  echo "=== 跳过本地静态服务（MODE=fast 是纯静态层）==="
else
echo "=== 启动本地静态服务（Python 与浏览器门禁都要用）==="
# 🔴 修：门禁脚本**自己保证**服务在跑。
#    之前只写了一句"需要 8000 端口"却既不检查也不启动
#    ⇒ 调用方忘了起服务时，6 个浏览器门禁**集体报"失败"**，
#      而那其实是**环境问题，不是组件问题** —— 极易被误读成"代码坏了"。
#    ⇒ 现在：没有就起，跑完关掉（trap 保证异常时也清理）。
# 🔴🔴 2026-10-07 补 canary：光看"8000 上有服务"**不够**，
#   要看它服务的是不是**这一棵树**。
#   实测：我在**源仓库目录**手动起过一个 http.server 忘了关，
#   然后在一个**克隆副本**里跑全量 —— 运行器看到 8000 已通，
#   愉快地"复用已在跑的服务"，于是 100 多道浏览器门禁量的全是**源仓库**。
#   症状很有迷惑性：107 道 PASS，只有 selftest 红（它要现生成临时文件，
#   在别人的根目录下 404）。若不是它红，这就是一次完美的假绿。
#   ⇒ 判据：拉一个仓库里的真实文件，与本地**字节比对**（不是看返回码）。
_SRV_PID=""          # set -u 下 trap 里引用未赋值变量会报错 ⇒ 先给空值
_canary() {
  curl -s --max-time 3 "http://127.0.0.1:8000/index.html" 2>/dev/null | cmp -s - index.html
}
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:8000/index.html"; then
  if _canary; then
    echo "  [OK] 复用已在跑的服务 :8000（canary 字节一致 ⇒ 同一棵树）"
  else
    echo "  [FAIL] :8000 上跑的是**另一棵树**（index.html 字节与本地不一致）"
    echo "         ⇒ 继续跑下去，浏览器门禁量的就不是这份代码（INVARIANT I-10 实证 6）"
    echo "         ⇒ 请停掉占用 8000 的进程再跑。"
    exit 2
  fi
else
  echo "  [启动] 本地静态服务 :8000"
  # ⚠️ 不用 `-m http.server`：它的 listen backlog 默认 5，
  #    4 个浏览器并发拉资源时会被内核拒绝（ERR_CONNECTION_REFUSED），
  #    表现为工具门禁偶发失败、单跑却通过。见 05-audit/http-serve.py 头。
  $PY 05-audit/http-serve.py 8000 >/dev/null 2>&1 &
  _SRV_PID=$!
  trap 'kill $_SRV_PID 2>/dev/null' EXIT
  for _i in 1 2 3 4 5 6 7 8 9 10; do
    curl -s -o /dev/null --max-time 1 "http://127.0.0.1:8000/index.html" && break
    sleep 0.4
  done
  if _canary; then
    echo "  [OK] 服务已就绪（canary 字节一致）"
  else
    echo "  [FAIL] 服务起不来或起了另一棵 —— 浏览器门禁结果**不可信**"
    exit 2
  fi
fi

fi
# ---------- /静态服务 ----------

# 🔴🔴 扫描目录必须**显式列举**，不能用 `.`
# ---------------------------------------------------------------------------
#   起因（2026-10-06 装 typescript 之后暴露）：
#     `--dir .` 会连node_modules/ 一起扫进去
#     ⇒ a11y 报「index.html 缺 lang」—— 那是 node_modules 里的第三方文件。
#     ⇒ 门禁对**我们没写的代码**报错 = 假红，而且会掩盖真问题。
#
#   为什么不在各个 .py 里加排除：
#     16 个门禁各改一遍，早晚会漏；而 `.gitignore` 里已有权威的忽略清单，
#     用它生成扫描范围才是单一事实源。
#
#   ⚠️ 两个门禁不能吃多路径（实测踩过，所以分组调用）：
#     · es5-gate  忽略 --dir，只按自己的 LIB_DIRS 走
#     · 只收 .html 的门禁若传 .md，会把 markdown 当 HTML 解析 ⇒ 假红
#       （viewport 报「START-HERE.md 缺 meta viewport」就是这么来的）
SCAN_DIRS="01-tokens 02-primitives 03-patterns 04-recipes 09-assets examples"
DIR_ARGS=""
for d in $SCAN_DIRS; do
  [ -d "$d" ] && DIR_ARGS="$DIR_ARGS $d"
done

# --- 只扫 HTML 的门禁：不含 .md ---
for g in states refs a11y viewport motion switch; do
  run "$g"       $PY "05-audit/$g.py" --dir $DIR_ARGS index.html
done
# --- 代码门禁---
# ⚠️ es5-gate 吃的是**位置参数**（仓库根），不是 `--dir`。
#    传 --dir 时它会扫到 0 个文件 ⇒ 0 违规 ⇒ 显示 PASS
#    （它自己的源码第 98-103 行就写了这个警告，别再踩）。
run "es5-gate"    $PY 05-audit/es5-gate.py .

# 减少动效策略：声明要保留的必须真保留，私自保留的必须登记理由
run "motion-reduced" $PY 05-audit/motion.py --reduced-audit
# 动效的**运行时**判据（真浏览器，0.10.1 加）。
#   上面那几道全是静态的：查的是"有没有 media query""时长是不是走令牌"。
#   这条量的是**动画对象本身**：① 切状态必须产生动画（没有=瞬移）；
#   ② 同属性并发 ≤1；③ reduced 下必须 0 个动画且 opacity 恒 1。
#   反向控制注入 `*{transition:none}` ⇒ ① 必须变红。
run "motion-live"   node 05-audit/motion-concurrency.js
run "motion-live-rev" node 05-audit/motion-concurrency.js --selftest
# 下面两道都是"写好了却从来没人跑"的脚本（orphan-gate 抓到的）：
#   · tap-target  —— WCAG 2.5.8(24×24) / 2.5.5(44×44) 命中区，跑 8 个页面
#   · switch-geom —— 开关滑块几何（上下对称 + 真实行程 20px）。
#     ai/components.json 一直把它列为 switch 的门禁，而它第一行就
#     `ReferenceError: Cannot access 'REPO' before initialization` —— 一次都没跑起来过。
run "tap-target"    node 05-audit/tap-target.js
run "switch-geom"   node 05-audit/switch-geometry.js
for g in tierA-gate icon-gate hover-gate measure-gate license-gate numeric-gate dark-gate hardcode-gate reuse-check _docclaims; do
  run "$g"       $PY "05-audit/$g.py" --dir $DIR_ARGS
done

echo ""
section "=== 浏览器门禁（需要 127.0.0.1:8000）==="
echo ""
# 令牌在真浏览器里的计算值复核（fast 模式只跑静态的一半，这里补全）
# @component：同一个脚本的**浏览器那一半**
#   （静态半在 line 150 用 `--no-browser`；这里跑完整版，需要 :8000）
run "token-parse-b" @component $PY 05-audit/token-parse-gate.py
# dist 产物与源码必须被浏览器解析成同一份规则集（M1：手写压缩器的唯一可信判据）
run "dist-parity" node 05-audit/dist-parity-check.js
# 骨架杠杆：改一处全局令牌，**每一页**真的跟着变（改前实测 36 处不跟随）
#   同时量窄屏横向溢出；反向控制：不引骨架的宿主页面必须纹丝不动
run "skel-lever"  node 05-audit/skeleton-lever-check.js
# 明暗四种组合在真浏览器里成立，且**不加载 theme-toggle.js**
run "theme-css"   node 05-audit/theme-css-gate.js
# 容器级作用域：`[data-theme]` 挂在容器（不是根）上也能换肤，含嵌套回退
#   ① 容器内令牌取该作用域的值 ② 组件（按钮 / 气泡）跟着变 ③ 作用域内对比度
#   ④ 焦点环用暗色加强版 ⑤ 组件里不许再有 `prefers-color-scheme` 分支
#   🔴 首跑抓到两件事：L2 别名在不同作用域不会重新求值（必须在每个作用域重声明）；
#      badge / tooltip 仍按系统偏好分支。两条都已修
run "theme-scope" node 05-audit/theme-scope-gate.js
run "theme-scope-rev" node 05-audit/theme-scope-gate.js --selftest
# 探针页自身要能跑：静态判据只能证明"清单写全了"，证明不了探测函数没写坏
run "webview-probe-run" node 05-audit/webview-probe-check.js
# 全部令牌的**解析值**（107 个 × 4 种明暗组合）：
#   ① 暗色三条路径等价 ② 浅色两条路径等价 ③ 声明即生效 ④ 无空值 ⑤ 与基线逐条一致
#   🔴 它补的是「声明合法、文本一致，但浏览器根本没让它生效」这一类
#      —— 实证过两次（未闭合注释吞掉 --lift-*、裸声明被丢弃）
#      —— `theme-css` 只探 2 个令牌，恰好是没被吞的那两条，抓不到。
#   ⚠️ 这也是"暗色人工核对"的替代品：visual 只拍浅色，暗色回归无人看。
run "token-resolved" node 05-audit/token-resolved-gate.js
run "accent-gate" $PY 05-audit/accent-gate.py
run "perf-gate"   node 05-audit/perf-gate.js
run "size-budget" $PY 05-audit/size-baseline.py
# dist 新鲜度：源码 sha256 变了而 dist 没重建 ⇒ 红（防"交付出去的是旧产物"）
run "dist-fresh"  $PY 05-audit/build-dist.py --check
# 采纳成本表：表上每个数字都必须能用同一脚本复算（手改一个数字 ⇒ 红）
run "dist-cost"   $PY 05-audit/dist-cost-gate.py
# 🔴 N17：标签**不能撞车**。上面「只扫 HTML」的循环里已经跑过 `05-audit/switch.py`，
#    标签也叫 `switch` ⇒ 日志里两条不同命令同名（一条扫 HTML、一条跑契约）。
#    ⇒ 计数口径不清（静态算 123 个不同名、实测 125），红的时候也分不清是哪条。
#    按 `a11y`(py) / `a11y-scan`(js) 的既有惯例：JS 契约用脚本名。
run "switch-contract" node 05-audit/switch-contract.js
run "tabs"       node 05-audit/tabs-contract.js
# 入场动效（03-patterns/reveal）：六方向共用 transform / 位移 ≤8px / 无 JS 不白屏
run "reveal"     node 05-audit/reveal-contract.js
run "accordion"  node 05-audit/accordion-contract.js
run "chart"      node 05-audit/chart-check.js
run "sparkline"  node 05-audit/sparkline-contract.js
# 科学绘图（09-assets）：判据与 BI 图表不同 —— 缺失去零、对数轴、单位、不算统计量
run "scientific-plot" node 05-audit/scientific-plot-check.js
run "a11y-scan"   node 05-audit/a11y-scan.js
# 🔴 可访问性树（2026-10-29 加）：axe 回答的是"有没有踩规则"，
#   回答不了"屏幕阅读器会念出什么"。这条把每页的朗读序列存成快照并逐行比对，
#   同时硬判 WCAG 4.1.2：每个可交互控件必须有非空 accessible name。
#   它是 `docs/ACCESSIBILITY.md` 里「名称/角色/值」那一行的**唯一**证据来源。
run "a11y-ax"     node 05-audit/a11y-ax.js
run "a11y-ax-rev" node 05-audit/a11y-ax.js --selftest
# 🔴 缩放 / 重排 / 焦点遮挡（2026-10-29 加）：WCAG 2.2 AA 的三条硬项
#   （1.4.4 文本 200% / 1.4.10 320px 重排 / 2.4.11 焦点不被吸顶栏遮挡）
#   此前**没有任何门禁**在管，而无障碍声明里却写着"按 AA 做"。
#   ⇒ 加了它，声明里那三行才有对应的判据，而不是"应该没问题"。
run "zoom-reflow"     node 05-audit/zoom-reflow.js
run "zoom-reflow-rev" node 05-audit/zoom-reflow.js --selftest
# 🔴 「按用到生成」出口的自检（0.8.9 · 审计 P2-1）：
#   证明 purge-css 真的在读 DOM（注入一条被删的规则 ⇒ 它必须变回保留），
#   而不是在查表或扫空 DOM —— 那两种错都会给出漂亮的省体积数字。
run "purge-selftest" @serial node 05-audit/purge-css-selftest.js
# 🔴 变异串泄漏检测（0.8.9 · 从 P0-1 事故反推出来的门禁）：
#   反向控制的机制是「原地改写源码 → 跑门禁 → 还原」。
#   中断时源码留在**被变异的状态** ⇒ 没有报错、门禁照样绿、
#   下一次 git add -A 就提交了（P0-1 就是这样进 HEAD 的）。
#   ⇒ 每轮都核一遍：变异串不许出现在目标源码里。
run "mutation-leak" @serial $PY 05-audit/mutation-leak-gate.py
# 🔴 门禁判红路径检测（0.8.9 · 防「输出说失败、退出码说成功」）：
#   本库已发生过两次同类事故 ——
#     ① css-imports / dead-class 挂在 run_report 下 ⇒ 退出码恒为 0
#        ⇒ 在 check-all 里**永远 PASS**，而 css-imports 抓到过真问题
#     ② dead-class 参数解析出错后什么都扫不到，却判「没有真死类」
#   ⇒ 每轮核对：每道注册的门禁，代码里都要有"判红并返回非 0"的路径。
run "gate-verdict"  $PY 05-audit/gate-verdict-gate.py
# 🔴 dist 的 JS 与源码**语义等价**（0.8.9 · 审计 P1-2）：
#   dist-parity 只对 CSS 做 CSSOM 双向比对，JS 被一行 continue **整体跳过**；
#   对 JS 的唯一把关是 node --check（只查语法）。
#   ⇒ 「dist 与源码一致」这条对外承诺，对 JS 部分此前**没有任何机械证据**。
#   做法：在**同源空白页**上分别加载源码 JS 与 dist JS，
#        比对"新增的 window 全局"与"抛的错"。配反向控制。
run "dist-js-parity" node 05-audit/dist-js-parity-gate.js
# 🔴 它的反向控制要连 :8000（本段已有服务）。
#   2026-10-27 起 selftest-all **自己也会起服务**，所以这里保留一道的原因是
#   避免同一条自检在一个 fast/full 里跑两遍（它要起浏览器，约 2-8 秒）；
#   → selftest-all 的 SKIP 里同步改成了「已在本段注册」的措辞。
run "dist-js-parity-rev" node 05-audit/dist-js-parity-gate.js --selftest
# 🔴 a11y 的反向控制（0.8.9 接上 · 审计 P1-8）：
#   `_a11y-reverse-control.js` 早就写好了 —— 注入 5 类典型违规
#   （img 无 alt / input 无 label / id 重复 / tabindex 乱序 / 对比度过浅），
#   验证 axe 是否**真的抓得到**。
#   但它零引用，从没被任何门禁调用过 ⇒ 按本库自己的口号
#   「没有反向控制的门禁不算门禁」，**a11y 扫描此前一直不算门禁**。
#   ⇒ 现在接进来：先证明 axe 有牙，再看真实页面。
run "a11y-reverse" node 05-audit/_a11y-reverse-control.js

run "clicktest"   node 05-audit/clicktest.js
run "button"       node 05-audit/button-check.js
run "input"       node 05-audit/input-check.js
run "card"       node 05-audit/card-check.js
run "badge"       node 05-audit/badge-check.js
run "list"       node 05-audit/list-check.js
run "content"       node 05-audit/content-check.js
run "states-check" node 05-audit/states-check.js   # 同上：与循环里的 states.py 区分
run "skeleton"    node 05-audit/skeleton-check.js
run "progress"    node 05-audit/progress-check.js
run "popover"     node 05-audit/popover-check.js
run "dismissable" node 05-audit/dismissable-check.js
run "focus-return" node 05-audit/focus-return-check.js
run "roving" node 05-audit/roving-check.js
run "typeahead" node 05-audit/typeahead-check.js
run "emit" node 05-audit/emit-check.js
# 🔴 反向控制也**必须每次都跑**，不能只在写的时候验证一次。
#    理由（今天一天踩了两次）：突变体的正则是硬编码的，源码一改形状它就匹配不上
#    ⇒ 那条"反例"根本没生效 ⇒ 自检报"突变没生效"，但**没人看** ⇒ 门禁看起来是好的、
#      实际上已经没牙了。⇒ 让它每次都跑，掉了牙自己会叫。
run "beh-reverse" @serial bash 05-audit/behavior-reverse.sh
run "form-validation"       node 05-audit/form-validation-check.js
  # N1：RTL 双向布局（只报告：物理属性在 LTR 页里是正确的）
  run "rtl"         node 05-audit/rtl-check.js
# 🔴 RTL **渲染**判据（2026-10-29 加）：rtl-check 只证明"CSS 里没有物理方向属性"，
#   那不等于 RTL 下渲染正确 —— 逻辑属性摆对了框，字形不会跟着翻；
#   汉字换成阿拉伯语会变长，可能装不下。这两件事都只能在渲染后量。
#   判的是：37 页 RTL 下不横滚 + 阿/希文字膨胀 1.3× 不破相 + 方向性字形镜像
#   （收起态 ▶→◀ 必须翻，展开态 ▼ 与叶子 · 必须不翻）。
run "rtl-render"     node 05-audit/rtl-render.js
run "rtl-render-rev" node 05-audit/rtl-render.js --selftest
run "separator"   node 05-audit/separator-check.js
  # N2：键盘导航（只报告：先量基线，达标后升级 fail）
  run "kbd"         node 05-audit/keyboard-nav.js
# 🔴 导航抽屉行为（0.11.2 加）：kbd 是"只报告"，抓不到"抽屉开了但读屏读不到"这种硬伤。
#   nav.css 定义了三个状态，却没规定谁来切 —— 于是每个使用者抄一份，
#   抄出来的版本把 aria-hidden 打在了抽屉的**祖先**上（截图/像素全绿，读屏全哑）。
#   这条门禁带键盘和视口变化，44 条判据、两个页面，红了就是真的坏了。
run "nav-drawer"  node 05-audit/nav-drawer.js
# 🔴 宽图 / 宽表通道（0.11.2 加）：视觉基线只拍 393 宽，而这个功能**只在桌面才有区别**
#   ⇒ 它的回归没有任何门禁看得见。判据全是量的数字（正文 ≤ 列、宽图 = 列、图内字号高度），
#   不是看截图 —— 因为"class 没生效"和"没写这个 class"在截图上长得一模一样。
run "rep-wide"    node 05-audit/rep-wide-channel.js
run "deco-clip" node 05-audit/deco-clip-check.js
run "fab-opaque" node 05-audit/fab-opaque-check.js
run "focus-ring" node 05-audit/focus-ring-check.js
run "model-viewer" node 05-audit/model-viewer-contract.js
run "pagination" node 05-audit/pagination-check.js
run "scrollbar" node 05-audit/scrollbar-check.js
run "tap-highlight" node 05-audit/tap-highlight-check.js
run "choice" node 05-audit/choice-check.js
run "nav" node 05-audit/nav-check.js
run "overlay" node 05-audit/overlay-check.js
# 弹层对**宿主页面**的影响（补偿叠加 / 引用计数 / 焦点归位 / 不横向跳 / 宽度公开）
run "overlay-host" node 05-audit/overlay-host-check.js
run "table" node 05-audit/table-check.js
# 04-recipes 页面级示例：版式在两档宽度下不塌、拼装结果语义正确
run "analysis-report" node 05-audit/analysis-report-check.js
# 报告版式系统 v1：三套 profile 的**取舍**真的落在计算值上（不是文案差异）
run "report" node 05-audit/report-check.js
run "data-showcase" node 05-audit/data-showcase-check.js
# 详情页配方：三变体必须同构（标签序列逐项比对），且都必须进视觉基线
run "detail-page" $PY 05-audit/detail-page-contract.py
# 无数据态：必须给理由、不得用 0 冒充、不得整块隐藏
run "no-data"     $PY 05-audit/no-data-gate.py
run "tooltip" node 05-audit/tooltip-check.js
run "dropdown" node 05-audit/dropdown-check.js
run "tree" node 05-audit/tree-check.js
run "drawer" node 05-audit/drawer-check.js
run "select" node 05-audit/select-check.js
run "combobox" node 05-audit/combobox-check.js
  # 实例级契约：max / disabled / destroy / 唯一 id / closest 兜底
  # （demo 页上查不出来，必须自己造实例）
  run "combobox-inst" node 05-audit/combobox-instance-check.js
run "date-range" node 05-audit/date-range-check.js
run "composition" node 05-audit/composition-check.js

# CSS 引用完整性（发现项只报告不 fail：class 名跨组件复用，误报率偏高）
# 🔴 0.8.9：从 run_report 升为 run（真门禁）。
#   理由：误报三次收紧后实测 **36 页 / 0 个疑似**，并补了 3 条反向控制。
#   一道"永远 PASS"的门禁等于没有门禁（I-10）——
#   它抓到过 form-validation 那类真问题（暗色 2.45:1），必须让它能拦住。
run "css-imports"   $PY 05-audit/css-imports.py
run "comment-bal" $PY 05-audit/comment-balance.py
run "dark-cont"   node 05-audit/dark-contrast.js
run "admission"   $PY 05-audit/admission-gate.py
run "selftest"    @serial $PY 05-audit/selftest.py

# ----------  H4/H5/H8：响应式 · 单元测试 · 性能预算 ----------
# ⚠️ 单元测试放最前：它只要 100ms，是"每次改代码后都该跑"的那一层。
if command -v node >/dev/null 2>&1; then
  # 🔴 N15：`FAILED` 是**另一个变量**，而结尾只判 `fail`
  #    ⇒ 单元测试挂了，整套门禁照样 `exit 0`（实测取证：unit FAIL 而 EXIT=0）。
  #    ⇒ 统一用 `fail`。（改用 run() 后这一行由 run() 自己加，不会再分叉。）
  run "unit"       node --test 05-audit/unit.test.mjs 05-audit/behavior-cores.test.mjs
  run "responsive"  node 05-audit/responsive-check.js
  # H3：Firefox（官方构建，非 Juggler）—— 单实例串行，控内存
  PW_PATH="${NODE_MODULES:-node_modules}/playwright" run "firefox" node 05-audit/multi-browser-check.js
else
  skip "unit"       "无 node"
  skip "responsive" "无 node"
  skip "firefox"    "无 node"
fi
run "perf"         $PY 05-audit/perf-gate.py
run "coverage"    $PY 05-audit/coverage-gate.py
# ---------- 视觉回归（ G2 · 最慢，放最后）----------
# 零依赖：比对走 05-audit/pngdiff.py（纯标准库，已与 Pillow 逐字节对齐）
#
# 🔴 明暗**两套**基线，两套都要跑（0.9.0 加）：
#   在此之前只拍浅色 ⇒ 暗色下"整页看不清"这类回归**没有任何门禁能抓**，
#   而 D1/D3/D5 三项改造都要动 CSS。
#   浅色仍是默认（目录不带后缀），暗色走 `--scheme dark`。
#
# 🔴 视觉门禁的两道**前置守卫**（2026-10-23）：
#   ① visual-coverage：视野内的 demo.html 必须都在 PAGES 里。
#      实测事故：PAGES 是硬编码 34 条 ⇒ 新页面**永远不被拍**，
#      "改了 CSS 没人报警"这个洞静默重开。首跑就抓到 04-recipes/report 没有基线。
#   ② visual-stamp：基线指纹必须等于当前代码的指纹。
#      实测事故：浅色基线录于 6f045ff、暗色录于 4962b2c，而 HEAD 已到 208782f，
#      两页红着过了 5 天 —— 因为指纹不符**只是 WARN**，像素比对仍是唯一判据。
#   两条都是秒级静态判据 ⇒ 放在视觉回归之前，先拦住没有被拍到的页面。
# 🔴 财务示例页的勾稽门禁（2026-10-27 加）：
#   示例页存在的意义是"证明本库能拼出产品级的一页"。第一次交付时
#   33 条勾稽错了 6 条（利润表加不出营业利润、BS 少了少数股东权益、
#   五年表研发费用与利润表差 6 倍、ROE 与权益对不上、估值三数互斥）
#   —— 而它**通过了所有既有门禁**，因为没有任何一道在看"数对不对"。
#   读者判断一页财务报告可不可信，第一件事是拿计算器加一遍。
#   这条不启动浏览器，秒级。
run "fin-ties" $PY 05-audit/finance-example-ties.py
run "visual-coverage" $PY 05-audit/visual-coverage-gate.py
run "visual-stamp"    $PY 05-audit/visual-stamp-gate.py

# 🔴 2026-10-29：这里原来按"装没装 Pillow"决定跑还是跳过。
#   后果是：没装的机器上这两道门禁**永远 SKIP**，而本仓库的规矩是
#   "跳过不是通过" —— 也就是说"日常改样式有没有防线"取决于运气。
#   现在比对逻辑换成 05-audit/pngdiff.py（纯标准库，已与 Pillow 逐字节对齐），
#   依赖没了，**跳过这条路径也就不存在了**。PY_PIL 变量随之退休。
run "visual"      $PY 05-audit/shot-baseline.py --check
run "visual-dark" $PY 05-audit/shot-baseline.py --check --scheme dark
# 🔴 RTL 视觉基线（2026-10-29 加）：`rtl-render` 能抓到"横向溢出"和"字形没翻"，
#   但抓不到第三种坏法 —— 镜像**错了但不溢出不改字形**（抽屉从错误的一侧滑入、
#   栅格左右互换、上/下一页位置反了）。这类只能靠像素比对。
#   ⚠️ 只覆盖 13 页（左右不对称/有方向性字形/顺序有语义的那些），
#      纯文本与纯色块页在 RTL 下与 LTR 是同一套盒模型，多录不增加判据。
run "visual-rtl"  $PY 05-audit/shot-baseline.py --check --dir rtl

echo ""
# 🔴 与 css-imports 同类：只报告不判失败，但**必须把报告打出来**且计入注册数（N16）
# 🔴 0.8.9：从 run_report 升为 run（真门禁）。
#   分类判据已机械化：模板生成（前缀拼接）+ 已文档化（README 类名表）
#   都由客观判据识别 ⇒ 落到 dead_real 的就是真需要人看的。
#   实测真仓库：真死 **0** 个。
run "dead-class"    $PY 05-audit/dead-class-gate.py

# ----------------------------------------------------------------------------
# 耗时 Top 10（按反馈加的：门禁跑起来花的时间偏长）
# ----------------------------------------------------------------------------
# ⭐ 为什么加这个：`run()` 之前**只输出 PASS/FAIL，不输出耗时**
#   ⇒ 想优化却**没有数据**，只能凭感觉 —— 违背「先量再改」。
#   用法：TIMING=/tmp/t.txt bash 05-audit/check-all.sh
# ----------------------------------------------------------------------------
if [ -n "$TIMING" ] && [ -s "$TIMING" ]; then
  echo ""
  echo "=== 耗时 Top 10（最慢的 10 道）==="
  sort -rn "$TIMING" | head -10 | while read -r dt nm; do
    printf '    %4ds  %s\n' "$dt" "$nm"
  done
  echo "    ----"
  echo "    合计 $(awk '{s+=$1} END {print s+0}' "$TIMING") 秒 / $(wc -l < "$TIMING" | tr -d ' ') 道"
  echo "    ⭐ 优化抓手：最慢的那几道通常反复启动浏览器 ⇒ 复用实例收益最大"
fi

run "bleed"         $PY 05-audit/bleed-gate.py
# 🔴 rewrite-residue（2026-08-16 新增）：抓「批量替换脚本留下的拼接痕迹」。
#  起因：`leak-fix-paths.py` 的 `RE_SLASH` 正则匹配任意引号字符串，
#   一次运行污染了 80 个文件（含所有浏览器门禁的入口），
#   而当时门禁失败**不显示错误原因** ⇒ 60 多个 FAIL 一个字都看不出所以然。
#   那是一次性迁移脚本，按 ROADMAP 执行纪律已删除；
#   但「这类痕迹没有守卫」这件事本身要留下守卫。
run "rewrite-residue" $PY 05-audit/rewrite-residue-gate.py
# ⚠️ typescript 没装时**必须显式 SKIP**，不能让它报 FAIL ——
#    陌生人 clone 出来的副本按设计没有 node_modules，报 FAIL 会被读成
#    "类型契约坏了"。与 visual 缺 Pillow 同一个约定（环境问题不冒充失败）。
if [ -f "$NODE_MODULES/typescript/bin/tsc" ] || [ -f "node_modules/typescript/bin/tsc" ]; then
  run "tsc"          $PY 05-audit/tsc-gate.py
else
  skip "tsc" "缺 typescript：npm install 后才会跑"
fi
# 🔴 pack-closure（2026-10-26 加 · 外部审计第 3 条建议）
#   判「**消费者真正收到的东西**」：拿 `npm pack --dry-run --json` 的清单
#   （npm 自己按 files 白名单算的，权威），递归判定 exports 的**每一种**形态
#   （字符串 / 条件对象 / 嵌套条件 / 数组回退链 / 通配），外加随包 HTML 的
#   本地引用、文档里给使用者的 node_modules/<包名>/… 路径。
#
#   为什么它必须进 fast 层：`pack-smoke` 要真打包再装一次（几十秒，component
#   层）⇒ 日常 `--fast` 直接跳过 ⇒ 这个 bug 类**日常根本不会被跑到**。
#   本脚本 ~1.5 秒，可以每次提交都跑。
#   ⚠️ 它自己含 `node`，按②会被判成 component，所以必须显式 @static。
#
#   实测：修复前 `npm pack` 出 269 个文件、`index.html` 0 个，而 package.json
#   的 `exports["."].default` 正指向它 ⇒ 包根导入必然失效。
run "pack-closure" @static node 05-audit/pack-closure.js
run "pack-smoke"       @serial bash 05-audit/pack-smoke.sh
run "leak"        $PY 05-audit/leak-scan.py
# 🔴 outsider-rev（2026-10-29 加 · 起因是"什么都没读就宣布干净"）
#   外人视角审查要联网读 GitHub（本机 `raw.githubusercontent.com` 被断连过），
#   不适合天天进日常门禁；但**它的判据**必须天天验 —— 旧实现里
#   "读到 0 个文件"和"读到全部文件"走到同一个 ✅，于是通道一被墙，
#   报告就从「未取证」变成「零泄漏」。
#   ⇒ 只跑 `--selftest`：纯离线、~0ms，专验「0 个文件必须红」这条。
run "outsider-rev" $PY 05-audit/outsider-audit.py --selftest
run "proper-noun" $PY 05-audit/proper-noun-scan.py
run "hype"        $PY 05-audit/hype-scan.py
# ⚠️ 直接调 node，不套 with-server.sh ——
#   check-all 自己已经起了 :8000，而 with-server.sh 遇到端口被占会直接报错。
run "doc-facts"       $PY 05-audit/doc-facts-gate.py
# 🔴 docs-site（2026-10-28 加 · 起因是"全绿但漏页"）
#   根索引页此前是手写的，于是 `reveal` / `analysis-report` / `detail-page` /
#   `longform` / `data-showcase` / `scientific-plot` 六个页面早就存在、
#   索引里一个都没有，而 177 道门禁全绿 —— 因为没有判据问过"索引覆盖几页"。
#   ⇒ 索引与 guide/ 改为生成，本门禁核四件事：产物是现算的、每页链接都能落地、
#     页面本身可访问（lang / 单一 h1 / main / skip link / 无重复 id）、无外链资源。
#   ⚠️ 它读 git 视野比对"改了 README 忘了重跑"，纯静态、~0.3 秒。
run "docs-site"     $PY 05-audit/docs-site-gate.py
run "docs-site-rev" $PY 05-audit/docs-site-gate.py --selftest
# 🔴 md-links（2026-10-29 加 · 起因是"文档指着四份不存在的文件"）
#   `README.zh-CN.md` / `docs/INVARIANT.md` / `ai/START-HERE.md` 一共 9 处指向
#   `docs/GUIDANCE.md`、`docs/BENCHMARK.md`、`docs/ROADMAP.md`、`docs/RELEASING.md`
#   —— 那四份在 0.11.4 被**故意**移进内部目录（含账号二次因子、到期日），
#   于是公开面留下一排悬空指针。既有判据都在看别的东西：
#   pack-closure 判包内 HTML 引用、docs-site 判生成后的页面链接，
#   **md 里的路径一直没人管**。
run "md-links"      $PY 05-audit/md-links.py
run "md-links-rev"  $PY 05-audit/md-links.py --selftest
# 🔴 do-dont（2026-10-29 加）—— "每个组件都得说清什么时候不该用"
#   起因：33 个组件里只有 11 个写了反例章，其余 22 个只有"✅ 这么用"。
#   一份只写正例的文档，读者学不到边界；而反例恰恰是最容易写坏的一类内容：
#   编造的类名/变量/文件名看起来很像真的，读者搜不到，整页可信度归零。
#   判据只管能机器抓住的那一半：章节在、条目够、**引用的标识符真实存在**。
#   "理由对不对"判不了，明确写在脚本头部 —— 不假装判了。
run "do-dont"      $PY 05-audit/do-dont-gate.py
run "do-dont-rev"  $PY 05-audit/do-dont-gate.py --selftest
# 🔴 demo-counterexample（2026-10-30 加）—— "反例要摆出来，不能只写在 README 里"
#   上一轮把文字反例补到 33/33，但**能看见的**只有 10/32
#   （这道门禁第一次在 HEAD 快照上跑，报的是「22 / 32 个组件没有可见的反例块」）：
#   读者看不见"错的样子"，就还是"渲染出来的 README"。
#   判据：每个组件的 demo 至少要有一个可见、带标题的反例块
#   （`class="box bad"` 或 `cmp__bad`）。**藏起来**（hidden / display:none）也算红。
#   "反例是不是真的错"这道判不了（价值判断）—— 但"两栏到底有没有差别"
#   是能判的，见下面 demo-claim。
run "demo-counter"  $PY 05-audit/demo-counterexample-gate.py
run "demo-counter-rev" $PY 05-audit/demo-counterexample-gate.py --selftest
# 🔴 demo-claim（2026-10-29 加）—— 补上面那句话留下的缺口
#   光判"块在不在"时，下面三处**全是绿的**：
#     nav  反例栏的长标题其实没换行（.toc__link 自带 nowrap，只是被裁掉）
#     list 同上（.list__title 自带 ellipsis，两栏一模一样）
#     dropdown 反例写了 display:flex，恰好绕开真实的 24px 坑
#   判据：每个 cmp 块的两栏各写一条可证伪的数字断言
#   （`data-bad="选择器|指标|>=44"`），两栏断言必须**互斥**且各自成立。
#   互斥是关键：能同时成立的两条断言，证明不了两栏有任何不同。
# 🔴 0.11.13 补的两条判据（同一道门禁，不新增条目）：
#   ② 反例块里必须有**标本**（真渲染出来的控件/内容）。0.11.12 之后扫了
#      34 个 demo 页，13 个反例块只有 `<p class="small">` 在描述反例 ——
#      `separator` 标题写"用 div 代替 hr"，块里连那个 div 都没有。
#      摆不出来的写 `data-prose="理由"`（理由要 ≥8 字，会被逐条打印）。
#   ③ 单栏 `box bad` 块必须**在块上**写 `data-claim-skip="理由"`
#      （0.11.14 起；以前是页面级注释 `<!-- demo-claim:skip -->`）。
#      改成按块，是因为按页判有个洞：给页面加**一个** `cmp` 块，
#      同页剩下的单栏反例就全部"洗白"了 —— 门禁不看了，也不要理由。
#      理由是"量不了"还是"可量没做"要分开写 ——
#      前者是边界，后者是欠账；混成一句"量化不了"就是拿措辞盖住没做的活。
# 🔴 port-safe —— 5 道门禁都靠 `listen(0)` 拿临时端口，而 Chrome 有一张
#   禁用端口表（ERR_UNSAFE_PORT，3659/4045/6000/6665-6669/10080…）。
#   实测：token-resolved 随机撞到 3659，全量门禁从"196 全绿"变成 195/196，
#   而报错跟被测代码毫无关系 —— 这种红最容易被当成环境抖动放过。
run "port-safe"     node 05-audit/safe-listen.js --selftest
run "demo-claim"    node 05-audit/demo-claim-gate.js
run "demo-claim-rev" node 05-audit/demo-claim-gate.js --selftest
# 🔴 行为层的「可编程接口」（0.11.15）
#   三个不会报错的接入坑，各一条判据：
#     A 无 DOM 加载   —— 16 个脚本曾经 16/16 在 Node 里 import 即崩（SSR 用户第一步就卡）
#     B 幂等          —— 重复 init 会留两份 root 监听 ⇒ 单击 toggle 偶数次 ⇒"点了没反应"
#     C ESM 入口      —— types 声明了 `export declare const Accordion`，包里却没有模块导出它
#   esm/ 是生成物：改源码后必须跑 gen-esm.py 重新生成，--check 拦住漂移。
run "esm-gen"       $PY 05-audit/gen-esm.py --check
run "esm-gen-rev"   $PY 05-audit/gen-esm.py --selftest
run "behavior-api"  node 05-audit/behavior-api-gate.js
run "behavior-api-rev" node 05-audit/behavior-api-gate.js --selftest
# 🔴 接入样板（0.11.15）：examples/esm-native 必须真的能打开、能点、能量。
#   之前 examples/react-vite 的 README 自称"证明能被真实项目用上"，
#   但那份样板没有 package.json、没有构建、从没被执行过 —— 声称的证明不是证明。
run "example-esm"   node 05-audit/example-esm-gate.js
run "example-esm-rev" node 05-audit/example-esm-gate.js --selftest
# 🔴 数值展示层（0.12.0）：涨跌方向色的口径 + 指标块的四条纪律。
#   这两条都必须起浏览器：
#     · dir-gate  判「默认红涨绿跌」和「[data-market="intl"] 真的对调」——
#       后者第一版写过但**从没生效**（`:where()` 特异性 0，抢不过 `:root`），
#       CSS 合法、注释正确、静态怎么读都对，只有读 computed color 才现形。
#     · metric-gate 判等宽数字 / 单位分离 / **缺数不填 0**（读文本，不看颜色）。
run "dir-color"    node 05-audit/dir-gate.js
run "dir-color-rev" node 05-audit/dir-gate.js --selftest
run "metric"       node 05-audit/metric-gate.js
run "metric-rev"   node 05-audit/metric-gate.js --selftest
run "api-contract"     $PY 05-audit/api-contract-gate.py
run "api-form"       $PY 05-audit/api-form-gate.py
run "api-form-rev"   $PY 05-audit/api-form-gate.py --selftest
run "api-doc"      $PY 05-audit/api-doc-gate.py
run "legacy-api"  $PY 05-audit/legacy-api-gate.py
run "release"     $PY 05-audit/release-gate.py
# 包名一致性（0.9.1 加）。
#   背景：包名从 frontend-lib 改成 agentcss 之后，类型测试里还留着旧名的 paths 映射
#   ⇒ 类型门禁验的是旧名，用户真会写的 `from 'agentcss'` 一次都没被编译过。
#   这条把「仓库名 ≠ 包名」写成推导式判据（仓库名从 repository.url 推出），
#   下次改名时判据自动跟着变。自带 --selftest（6 个变异体 + 1 条良性对照）。
run "pkg-name"    $PY 05-audit/pkg-name-gate.py
run "pkg-name-rev" $PY 05-audit/pkg-name-gate.py --selftest
# 发布物的**真实解析**（0.10.1 加）。
#   和 tsc-gate 的区别：tsc-gate 走 type-tests 的 paths 别名，验的是"这个 d.ts 语法对不对"；
#   这条按 files 白名单摆出 node_modules，让 tsc 以 moduleResolution:bundler **从包名解析**，
#   验的是"使用者那句 import 到底能不能成"。
#   首跑就抓到 exports["."] 指向未发布的 ./index.html（pack-smoke 因只认 string 形态而漏掉）。
run "pkg-resolve"     $PY 05-audit/pkg-resolve-gate.py
run "pkg-resolve-rev" $PY 05-audit/pkg-resolve-gate.py --selftest
# 孤儿脚本（0.10.1 加）：05-audit 里不许有"没人跑"的脚本。
#   来历：orphan-gate 的第一版就把 tap-target.js（WCAG 命中区）和
#   switch-geometry.js（契约里声明了、但第一行就崩）抓了出来。
run "orphan"      $PY 05-audit/orphan-gate.py
run "orphan-rev"  $PY 05-audit/orphan-gate.py --selftest
# 版本四处一致（VERSION / package.json / package-lock ×2 / CHANGELOG）。
# 与 release-gate 判据重叠但**入口不同**：这个给的是"哪一处不一致"的定位，
# 而 release-gate 给的是"发布前还缺什么"。两者都要，不是重复。
run "version-sync" $PY 05-audit/bump-version.py --check
run "gate-self"   @serial $PY 05-audit/gate-selfcheck.py
# 受版本控制的文本文件必须是 LF（D4 的**防守**，不只是搬运）。
#   D4 当时做的是"把现有 CRLF 转成 LF"，但没堵住"生成器会翻回去"——
#   实测撞到三次（theme-sync / make-tiersnippet / shot-baseline 写 _stamp.json）。
#   反向控制用**伪造的** `git ls-files --eol` 输出，不依赖仓库里恰好有坏文件。
run "eol"         $PY 05-audit/eol-gate.py
run "eol-rev"     $PY 05-audit/eol-gate.py --selftest
run "gate-fixture" @serial $PY 05-audit/gate-selfcheck-fixtures.py
# 🔴 所有门禁的反向控制，一次性跑（0.8.9 加 · 自查发现）：
#   实测本库 **26 个脚本支持 --selftest，而 check-all 里只注册了 1 个**
#   ⇒ 其余 25 个的反向控制从来没在门禁里跑过 ——
#   这正是本库自己登记过的 I-10 实证 5：「代码说自己会检查，但没门禁跑它」。
#   判据 ③ 还会断言**跑完工作区不许被弄脏**：
#   实测它抓到 gen-behavior.py 的自检用文本模式备份（CRLF→LF 在读取时就丢了），
#   还原写回去就把两个源文件的行尾永久改成了 LF（git diff 为空，只有 status 能看出）。
run "selftest-all"  @serial $PY 05-audit/selftest-all.py
# 🔴 2026-10-27：元门禁自己也要有牙。
#   事故：`MODE=fast` 下 selftest-all 报红，真因是它内部的
#   `motion-concurrency --selftest` 要连 :8000，而 fast 档不起服务。
#   修法两条：① selftest-all 自己确保 :8000（canary 校验 + 退出时关掉）；
#             ② 判定抽成 `verdict()` 并用合成样本自检 —— 其中一条样本就是
#                「RC=0 但输出说跑不起来 ⇒ 必须判红」（判据 ④）。
run "selftest-all-rev" @serial $PY 05-audit/selftest-all.py --selftest
# ---------------------------------------------------------------------------
flush_all

# 🔴 结论必须放在**最后**（0.8.9 修）
#   原先它在中段（后面还有约 20 道门禁），于是日志里会先打「全部通过。」
#   再接着出现 FAIL 行 —— 读到的人不会往下看。这是最坏的一种报告错位。
# ---------------------------------------------------------------------------
if [ "$MODE" != "full" ]; then
  echo ""
  echo "（分层模式：$MODE —— 收尾前请跑 MODE=full）"
fi
if [ "$fail" -eq 0 ]; then
  echo "全部通过。"
else
  echo "$fail 道门禁失败。"
fi
# 🔴 0.8.9：把"跑了多少 / 跳了多少"打出来。
#   之前 fast 静默丢弃约一半门禁、日志里 0 行 SKIP ⇒
#   看到"全部通过"会误以为**全部**都跑过了（跳过不是通过 —— 它是一条真话）。
echo "本轮：执行 $_ran 道 · 按层跳过 $_skipped 道（MODE=$MODE）"
if [ "$MODE" != "full" ]; then
  echo "       收尾与发版前请跑 MODE=full（$_ran + $_skipped 道全部执行）。"
fi

exit $fail