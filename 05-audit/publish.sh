#!/usr/bin/env bash
# publish.sh — 发布前诊断（**不发布任何东西**）
#
# MANUAL-ONLY: 由人在打 tag 之前手动跑；它不是门禁，也不被任何流程自动调用。
#
# ============================================================================
# 为什么它不再发布
# ----------------------------------------------------------------------------
#   这里原来直接执行 `npm publish`。那意味着仓库里存在**第二条发布路径**：
#   不查 tag、不查工作区是否干净、不带 `--provenance`。
#   两条路径的保障不同，等于后门开在文档旁边。
#
#   ⇒ 现在发布只有一条：打 annotated tag `v<版本>` → release.yml。
#     本脚本只回答"现在能不能发"，四个检查全是只读的。
#
#   ⚠️ 诚实边界：持有 npm token 的人仍可在任何机器上手发，仓库内的
#      判据拦不住。能做的是让**被文档承认的路径**只有 tag 这一条，
#      并让本地不再提供默认的发布动作。
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

PY="${PY:-python3}"
command -v "$PY" >/dev/null 2>&1 || PY=python

VER="$(tr -d '[:space:]' < VERSION 2>/dev/null)"
fail=0
say() { printf '%s\n' "$*"; }

say "============================================="
say "  发布前诊断 agentcss@$VER（不会发布）"
say "============================================="

# ---------- ① registry ----------
REG="$(npm config get registry 2>/dev/null || echo unknown)"
if [ "$REG" != "https://registry.npmjs.org/" ]; then
  say "✗ registry = $REG（镜像只能读不能发）"
  fail=1
else
  say "✓ registry = $REG"
fi

# ---------- ② 版本六处一致 ----------
if ! "$PY" 05-audit/bump-version.py --check >/dev/null 2>&1; then
  say "✗ 版本六处不一致 ⇒ 跑 $PY 05-audit/bump-version.py --check 看详情"
  fail=1
else
  say "✓ 版本六处一致"
fi

# ---------- ③ 工作区干净 ----------
# 发布必须来自一个**确定的提交**：脏工作区发出去的包，gitHead 指向的
# 提交里根本没有这些改动。
DIRTY="$(git status --porcelain 2>/dev/null | head -5)"
if [ -n "$DIRTY" ]; then
  say "✗ 工作区不干净 —— 这些改动不在任何提交里："
  printf '%s\n' "$DIRTY" | sed 's/^/    /'
  fail=1
else
  say "✓ 工作区干净"
fi

# ---------- ④ tag 锚点 ----------
KIND="$(git cat-file -t "v$VER" 2>/dev/null || true)"
if [ "$KIND" != "tag" ]; then
  say "✗ 没有 annotated tag v$VER（当前：${KIND:-不存在}）"
  fail=1
else
  say "✓ v$VER 是 annotated tag"
fi

say ""
if [ "$fail" != "0" ]; then
  say "⇒ 先修上面的问题。发布仍然只有一条路径："
else
  say "⇒ 诊断通过。发布只有一条路径："
fi
say "     git tag -a v$VER -m \"source-commit: <40 位提交>\""
say "     git push origin v$VER        # 只推这一个 tag，不要 git push --tags"
say ""
say "   npm publish 只发生在 release.yml 里（带 --provenance）。"
say "   本地不再提供发布动作：没有 tag 与干净工作区，就没有可信的来源签名。"
exit "$fail"
