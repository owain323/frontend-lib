#!/usr/bin/env bash
# check-all.sh — 跑全部门禁，一条命令
#
# 🔴 建的。理由：这一晚我漏了 `--dir .` 参数，
#    6 道门禁假报 FAIL —— **手动敲 16 条命令本身就是不可靠的**。
#    门禁的价值在于"每次都跑"，跑不全等于没有。
set -u
cd "$(dirname "$0")/.." || exit 2
PY="python"
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

fail=0
TIMING="${TIMING:-}"
# =========================================================
# 分层：按改动范围决定要跑哪些检查（ J12）
# ---------------------------------------------------------
# 动机：全量 60+ 道要 6 分钟。改一个按钮就等 6 分钟，
#       等于**开发流程在替我承担不必要的等待**。
# 分层：
#   MODE=fast      只跑静态检查（秒级）
#   MODE=component 只跑浏览器相关（分钟级）
#   MODE=full      全量（收尾、发版前）
# =========================================================
MODE="${MODE:-full}"
run() {  # run <名字> <命令...>
  local name="$1"; shift
  # ---------- 分层：按「需不需要浏览器」自动判定，而不是硬编码名单 ----------
  # ⭐ 之前是硬编码一个跳过名单 ⇒ 新增浏览器门禁时会**漏掉**（我今天就漏过）。
  # ⇒ 改成从命令本身判断：跑 node / puppeteer 的一律归「浏览器类」。
  if [ "$MODE" = "fast" ]; then
    case "$*" in
      *node*|*puppeteer*|*playwright*|*with-server*) return 0 ;;
    esac
  fi
  local t0 t1 dt
  t0=$(date +%s)
  if out=$("$@" 2>&1); then
    t1=$(date +%s); dt=$((t1-t0))
    printf '  %-16s PASS  %3ds\n' "$name" "$dt"
    [ -n "$TIMING" ] && echo "$dt $name" >> "$TIMING"
  else
    t1=$(date +%s); dt=$((t1-t0))
    printf '  %-16s FAIL  %3ds\n' "$name" "$dt"
    [ -n "$TIMING" ] && echo "$dt $name" >> "$TIMING"
    echo "$out" | grep -E '^\s*\[|不达标|不符|未定义|未门控|需人工|超' | head -6 | sed 's/^/       /'
    fail=$((fail+1))
  fi
}

echo "=== 静态门禁 ==="
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
# 机器可读契约层：schema 只用了实现过的关键字 / Profile 有鉴别力 / Patch 可回放
run "ai-layer"  node 05-audit/ai-layer-gate.js
# 规范三层分离：Invariant 层不许被 Contract / Guidance 污染
run "invariant"  $PY 05-audit/invariant-gate.py
# 兼容性 Benchmark：参考解法的十类编辑意图必须全部成立
run "benchmark"  node benchmark/run.js
# 核心不得混入呈现形态（slide/deck）语义 —— PPT 的事在 adapters/presentation/
run "core-boundary" $PY 05-audit/core-boundary-gate.py
# 呈现层自己的五条判据必须**真的会红**（0.4.2 补：它们此前一次都没被执行过）
run "presentation" $PY 05-audit/presentation-gate.py
# 级联分层就绪：`@layer` 计数 + 每处 !important 必须能归类（切层前的前提门控）
run "cascade-layer" $PY 05-audit/cascade-layer-gate.py
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
run "deps"      $PY 05-audit/deps.py --missing
run "behavior"  $PY 05-audit/gen-behavior.py --check
# 行为覆盖矩阵：哪些组件必须有哪种行为（不许靠省略跳过）
run "beh-matrix" $PY 05-audit/behavior-matrix-gate.py
# 成熟度阶梯：档位 = 独立重算；🔴 ladder 必须有鉴别力（不许 27 个组件全 stable）
run "maturity"  $PY 05-audit/maturity-gate.py
echo ""
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
  $PY -m http.server 8000 --bind 127.0.0.1 --directory . >/dev/null 2>&1 &
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
for g in tierA-gate icon-gate hover-gate measure-gate license-gate numeric-gate dark-gate hardcode-gate reuse-check _docclaims; do
  run "$g"       $PY "05-audit/$g.py" --dir $DIR_ARGS
done

echo ""
echo "=== 浏览器门禁（需要 127.0.0.1:8000）==="
echo ""
echo "=== 浏览器门禁 ==="
# 令牌在真浏览器里的计算值复核（fast 模式只跑静态的一半，这里补全）
run "token-parse-b" $PY 05-audit/token-parse-gate.py
# dist 产物与源码必须被浏览器解析成同一份规则集（M1：手写压缩器的唯一可信判据）
run "dist-parity" node 05-audit/dist-parity-check.js
# 骨架杠杆：改一处全局令牌，**每一页**真的跟着变（改前实测 36 处不跟随）
#   同时量窄屏横向溢出；反向控制：不引骨架的宿主页面必须纹丝不动
run "skel-lever"  node 05-audit/skeleton-lever-check.js
# 明暗四种组合在真浏览器里成立，且**不加载 theme-toggle.js**
run "theme-css"   node 05-audit/theme-css-gate.js
run "accent-gate" $PY 05-audit/accent-gate.py
run "perf-gate"   node 05-audit/perf-gate.js
run "size-budget" $PY 05-audit/size-baseline.py
# dist 新鲜度：源码 sha256 变了而 dist 没重建 ⇒ 红（防"交付出去的是旧产物"）
run "dist-fresh"  $PY 05-audit/build-dist.py --check
# 采纳成本表：表上每个数字都必须能用同一脚本复算（手改一个数字 ⇒ 红）
run "dist-cost"   $PY 05-audit/dist-cost-gate.py
run "switch"     node 05-audit/switch-contract.js
run "tabs"       node 05-audit/tabs-contract.js
run "accordion"  node 05-audit/accordion-contract.js
run "chart"      node 05-audit/chart-check.js
run "sparkline"  node 05-audit/sparkline-contract.js
run "a11y-scan"   node 05-audit/a11y-scan.js
run "clicktest"   node 05-audit/clicktest.js
run "button"       node 05-audit/button-check.js
run "input"       node 05-audit/input-check.js
run "card"       node 05-audit/card-check.js
run "badge"       node 05-audit/badge-check.js
run "list"       node 05-audit/list-check.js
run "content"       node 05-audit/content-check.js
run "states"       node 05-audit/states-check.js
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
run "beh-reverse" bash 05-audit/behavior-reverse.sh
run "form-validation"       node 05-audit/form-validation-check.js
  # N1：RTL 双向布局（只报告：物理属性在 LTR 页里是正确的）
  run "rtl"         node 05-audit/rtl-check.js
run "separator"   node 05-audit/separator-check.js
  # N2：键盘导航（只报告：先量基线，达标后升级 fail）
  run "kbd"         node 05-audit/keyboard-nav.js
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
run "table" node 05-audit/table-check.js
run "tooltip" node 05-audit/tooltip-check.js
run "dropdown" node 05-audit/dropdown-check.js
run "tree" node 05-audit/tree-check.js
run "drawer" node 05-audit/drawer-check.js
run "select" node 05-audit/select-check.js
run "combobox" node 05-audit/combobox-check.js
run "date-range" node 05-audit/date-range-check.js
run "composition" node 05-audit/composition-check.js

# CSS 引用完整性（只报告不 fail：class 名跨组件复用，误报率偏高）
  $PY 05-audit/css-imports.py >/dev/null 2>&1 && echo "  css-imports    PASS（只报告模式）" || true
run "comment-bal" $PY 05-audit/comment-balance.py
run "dark-cont"   node 05-audit/dark-contrast.js
run "admission"   $PY 05-audit/admission-gate.py
run "selftest"    $PY 05-audit/selftest.py

# ----------  H4/H5/H8：响应式 · 单元测试 · 性能预算 ----------
# ⚠️ 单元测试放最前：它只要 100ms，是"每次改代码后都该跑"的那一层。
if command -v node >/dev/null 2>&1; then
  if node --test 05-audit/unit.test.mjs >/dev/null 2>&1; then
    echo "  unit            PASS（7 个纯函数测试，~100ms）"
  else
    echo "  unit            FAIL"; FAILED=$((FAILED+1))
    node --test 05-audit/unit.test.mjs 2>&1 | grep -E "^not ok" | head -5 | sed 's/^/         /'
  fi
  run "responsive"  node 05-audit/responsive-check.js
  # H3：Firefox（官方构建，非 Juggler）—— 单实例串行，控内存
  PW_PATH="${NODE_MODULES:-node_modules}/playwright" run "firefox" node 05-audit/multi-browser-check.js
else
  echo "  unit            SKIP（无 node）"
fi
run "perf"         $PY 05-audit/perf-gate.py
run "coverage"    $PY 05-audit/coverage-gate.py
# ---------- 视觉回归（ G2 · 最慢，放最后）----------
# ⚠️ 需要 Pillow；没装就跳过（不 fail-closed，理由见脚本头注释）
if $PY -c "from PIL import Image" 2>/dev/null; then
  run "visual"    $PY 05-audit/shot-baseline.py --check
else
  echo "  visual         SKIP（缺 Pillow，装了才会跑）"
fi

echo ""
echo "=== 死类报告（只报告，不 fail：判据需要人判断）==="
$PY 05-audit/dead-class-gate.py | sed 's/^/  /'

echo ""
if [ "$MODE" != "full" ]; then
  echo ""
  echo "（分层模式：$MODE —— 收尾前请跑 MODE=full）"
fi
if [ "$fail" -eq 0 ]; then
  echo "全部通过。"
else
  echo "$fail 道门禁失败。"
fi

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
# ⚠️ typescript 没装时**必须显式 SKIP**，不能让它报 FAIL ——
#    陌生人 clone 出来的副本按设计没有 node_modules，报 FAIL 会被读成
#    "类型契约坏了"。与 visual 缺 Pillow 同一个约定（环境问题不冒充失败）。
if [ -f "$NODE_MODULES/typescript/bin/tsc" ] || [ -f "node_modules/typescript/bin/tsc" ]; then
  run "tsc"          $PY 05-audit/tsc-gate.py
else
  echo "  tsc              SKIP（缺 typescript：npm install 后才会跑）"
fi
run "pack-smoke"       bash 05-audit/pack-smoke.sh
run "leak"        $PY 05-audit/leak-scan.py
run "proper-noun" $PY 05-audit/proper-noun-scan.py
run "hype"        $PY 05-audit/hype-scan.py
# ⚠️ 直接调 node，不套 with-server.sh ——
#   check-all 自己已经起了 :8000，而 with-server.sh 遇到端口被占会直接报错。
run "doc-facts"       $PY 05-audit/doc-facts-gate.py
run "api-contract"     $PY 05-audit/api-contract-gate.py
run "api-form"       $PY 05-audit/api-form-gate.py
run "api-form-rev"   $PY 05-audit/api-form-gate.py --selftest
run "api-doc"      $PY 05-audit/api-doc-gate.py
run "legacy-api"  $PY 05-audit/legacy-api-gate.py
run "release"     $PY 05-audit/release-gate.py
run "gate-self"   $PY 05-audit/gate-selfcheck.py
run "gate-fixture" $PY 05-audit/gate-selfcheck-fixtures.py
exit $fail