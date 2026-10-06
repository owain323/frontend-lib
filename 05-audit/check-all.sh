#!/usr/bin/env bash
# check-all.sh — 跑全部门禁，一条命令
#
# 🔴 2026-10-03 建的。理由：这一晚我漏了 `--dir .` 参数，
#    6 道门禁假报 FAIL —— **手动敲 16 条命令本身就是不可靠的**。
#    门禁的价值在于"每次都跑"，跑不全等于没有。
set -u
cd "$(dirname "$0")/.." || exit 2
PY="python"
# ⭐ 优先用环境变量；否则在常见位置里探测。
#    ⚠️ 之前写成 ${NODE_DIR:-node}（相对路径）⇒ 依赖找不到，
#    44 道门禁一起挂 —— 且失败信息是 Cannot find module，看不出根因。
if [ -z "${NODE_DIR:-}" ]; then
  for _c in "$HOME/.workbuddy/binaries/node/versions/22.17.0"            "$HOME/.workbuddy/binaries/node/versions/22.22.2"            "/c/Users/czj17751/.workbuddy/binaries/node/versions/22.17.0"; do
    [ -x "$_c/node" ] && NODE_DIR="$_c" && break
  done
fi
[ -z "${NODE_DIR:-}" ] && NODE_DIR=node
[ -x "$NODE_DIR/node" ] && export PATH="$NODE_DIR:$PATH"
# axe-core / puppeteer-core 装在库外的 node workspace（不��发布包带走）
if [ -z "${NODE_MODULES:-}" ]; then
  for _c in "$HOME/.workbuddy/binaries/node/workspace/node_modules"            "/c/Users/czj17751/.workbuddy/binaries/node/workspace/node_modules"            "$PWD/node_modules"; do
    [ -d "$_c" ] && NODE_MODULES="$_c" && break
  done
fi
[ -z "${NODE_MODULES:-}" ] && NODE_MODULES=node_modules
export NODE_PATH="$NODE_MODULES"

fail=0
TIMING="${TIMING:-}"
# =========================================================
# 分层：按改动范围决定要跑哪些检查（工单 J12）
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
  # 分层短路：fast 模式跳过浏览器类检查
  case "$MODE" in
    fast)
      case "$name" in
        visual|responsive|dark-cont|composition|firefox|a11y-scan|clicktest|rtl|kbd|perf-gate) return 0 ;;
      esac ;;
  esac
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
run "start-here" $PY 05-audit/fix-start-here.py --check
run "content-hygiene" $PY 05-audit/hygiene.py
run "shot-path"  $PY 05-audit/shot-path.py
run "mojibake"   $PY 05-audit/mojibake-check.py .
run "repo-hygiene"  $PY 05-audit/repo-hygiene.py
run "deps"      $PY 05-audit/deps.py --missing
echo ""
echo "=== 启动本地静态服务（Python 与浏览器门禁都要用）==="
# 🔴 2026-10-04 修：门禁脚本**自己保证**服务在跑。
#    之前只写了一句"需要 8000 端口"却既不检查也不启动
#    ⇒ 调用方忘了起服务时，6 个浏览器门禁**集体报"失败"**，
#      而那其实是**环境问题，不是组件问题** —— 极易被误读成"代码坏了"。
#    ⇒ 现在：没有就起，跑完关掉（trap 保证异常时也清理）。
if ! curl -s -o /dev/null --max-time 2 "http://127.0.0.1:8000/index.html"; then
  echo "  [启动] 本地静态服务 :8000"
  $PY -m http.server 8000 --bind 127.0.0.1 --directory . >/dev/null 2>&1 &
  _SRV_PID=$!
  trap 'kill $_SRV_PID 2>/dev/null' EXIT
  for _i in 1 2 3 4 5 6 7 8 9 10; do
    curl -s -o /dev/null --max-time 1 "http://127.0.0.1:8000/index.html" && break
    sleep 0.4
  done
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:8000/index.html"; then
    echo "  [OK] 服务已就绪"
  else
    echo "  [FAIL] 服务起不来 —— 浏览器门禁结果**不可信**"
  fi
else
  echo "  [OK] 复用已在跑的服务 :8000"
fi

for g in states refs a11y viewport motion switch; do
  run "$g"       $PY "05-audit/$g.py" --dir .
done
for g in es5-gate tierA-gate icon-gate hover-gate measure-gate license-gate numeric-gate dark-gate hardcode-gate reuse-check _docclaims; do
  run "$g"       $PY "05-audit/$g.py" --dir .
done

echo ""
echo "=== 浏览器门禁（需要 127.0.0.1:8000）==="
echo ""
echo "=== 浏览器门禁 ==="
run "accent-gate" $PY 05-audit/accent-gate.py
run "perf-gate"   node 05-audit/perf-gate.js
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
# 耗时 Top 10（2026-10-06 新增，Owner 抱怨「跑起来花的时间比较长」）
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

run "proper-noun" $PY 05-audit/proper-noun-scan.py
run "hype"        $PY 05-audit/hype-scan.py
run "api-snap"        $PY 05-audit/api-snapshot.py
run "release"     $PY 05-audit/release-gate.py
run "gate-self"   $PY 05-audit/gate-selfcheck.py
exit $fail