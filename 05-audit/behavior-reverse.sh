#!/usr/bin/env bash
# behavior-reverse.sh — 把四个微行为核 + 覆盖矩阵的**反向控制**一次性跑完
#
# 🔴 为什么要独立成一个文件（而不是只在写的时候手动跑一次）
# ---------------------------------------------------------------------------
#   突变体是**硬编码正则**：源码一改形状，正则就匹配不上 ⇒ 那个"反例"根本没生效。
#   此时自检自己会打印「突变没生效 ⇒ 门禁是瞎的」，但——
#     · 它不在 check-all 里 ⇒ 没人看
#     · 门禁报告照样是 PASS ⇒ 看起来是好的，实际已经没牙了
#   ⇒ 这就是 I-10（"报告通过却什么也没查"）的另一种形态。
#
#   ⇒ 解法：把反向控制接进 check-all，**每次都跑**。掉了牙它自己会叫。
#
# 用法：bash 05-audit/behavior-reverse.sh
set -u
cd "$(dirname "$0")/.." || exit 2

PY="python"
if [ -z "${NODE_DIR:-}" ]; then
  for _c in "$HOME/.local/share/frontend-lib-tools/node" "$PWD/.toolchain/node"; do
    if [ -x "$_c/node" ]; then NODE_DIR="$_c"; break; fi
  done
fi
[ -z "${NODE_DIR:-}" ] && NODE_DIR=node
[ -x "$NODE_DIR/node" ] && export PATH="$NODE_DIR:$PATH"

fail=0
run() {
  local name="$1"; shift
  if out=$("$@" 2>&1); then
    printf '    %-14s OK\n' "$name"
  else
    printf '    %-14s FAIL\n' "$name"
    echo "$out" | grep -E "FAIL|没被抓到|没生效" | head -5 | sed 's/^/       /'
    fail=$((fail+1))
  fi
}

echo "  === 微行为核 · 反向控制 ==="
run "dismissable" node 05-audit/dismissable-check.js --selftest
run "focus-return" node 05-audit/focus-return-check.js --selftest
run "roving"      node 05-audit/roving-check.js --selftest
run "typeahead"   node 05-audit/typeahead-check.js --selftest
run "emit"        node 05-audit/emit-check.js --selftest
run "matrix"      $PY 05-audit/behavior-matrix-gate.py --selftest
run "token-aud"   $PY 05-audit/token-audience-gate.py --selftest

exit $fail
