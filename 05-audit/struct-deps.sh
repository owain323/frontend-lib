#!/usr/bin/env bash
# struct-deps.sh — 改 HTML 结构之前先跑这个
#
# 为什么需要：本库真实发生过 —— 把 input 从 label 内移到平级后，
# `.choice__mark` 不再是相邻兄弟，所有 `X + .choice__mark` 规则**全部失效**，
# 一度 7 处同时静默失效（勾号 / disabled / indeterminate / radio）。
# 选择器语法完全合法，只是不匹配任何元素 ⇒ 没有任何报错。
#
# 用法：改结构之前，在目标目录跑一遍，把输出里的选择器逐条对照检查。
set -u
DIR="${1:-.}"
echo "=== 依赖结构关系的选择器（改 HTML 结构前必须逐条核对）==="
echo ""
echo "--- 相邻兄弟 '+'（结构一变就失效）---"
grep -rn --include="*.css" -E '\+[ ]*\.[a-zA-Z]' "$DIR" | sed 's/^/  /' || echo "  无"
echo ""
echo "--- 后续兄弟 '~'（同样依赖结构）---"
grep -rn --include="*.css" -E '~[ ]*\.[a-zA-Z]' "$DIR" | sed 's/^/  /' || echo "  无"
echo ""
echo "--- 子代 '>'（依赖嵌套层级）---"
grep -rn --include="*.css" -E '>[ ]*\.[a-zA-Z]' "$DIR" | sed 's/^/  /' || echo "  无"
echo ""
echo "=== JS 里按结构取的节点（同样会静默失效）==="
grep -rn --include="*.js" --include="*.html" -E 'querySelector\(|closest\(|previousElementSibling|nextElementSibling' "$DIR" | sed 's/^/  /' | head -20
echo ""
echo "改完结构后，请跑：node 05-audit/clicktest.js（真实鼠标点击）"
