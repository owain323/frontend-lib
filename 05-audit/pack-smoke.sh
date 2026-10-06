#!/usr/bin/env bash
# ============================================================================
# pack-smoke.sh — 打包实装冒烟
#
# ⭐ 为什么需要这道（2026-10-06）
#   release-gate 检查的是**源码仓库状态**（version/exports/files 是否存在）。
#   但使用者装到的是 **tarball** —— 两者是不同东西：
#   仓库里有的文件，tarball 里可能被 files 白名单漏掉；
#   tarball 里的路径，也可能和 exports 声明的对不上。
#
#   ⇒ 只有真跑一遍「pack →装到空目录 → import」才能回答：
#      **用户安装到的东西，是不是我们以为的那个东西？**
#
#   ⚠️ 一个曾经踩过的坑（这次也写进注释免得再犯）：
#     用 `npm install file:../repo` 验证是**无效的**——
#     那走的是本地目录软链，npm 会把整个仓库（含被 .gitignore挡掉的
#     内部文档）都"装"进去，看起来像泄漏，其实是假象。
#     ⇒ 必须 `npm pack` 出tarball 再装 tarball。
# ============================================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

NAME=$(cd "$REPO_ROOT" && node -p "require('./package.json').name")
VER=$(cd "$REPO_ROOT" && node -p "require('./package.json').version")
TARBALL="$WORK/${NAME}-${VER}.tgz"

echo "  === 打包实装冒烟（$NAME@$VER）==="
echo ""

# ---------- 1. 打包 ----------
(cd "$REPO_ROOT" && npm pack --pack-destination "$WORK" >/dev/null 2>&1)
if [ ! -f "$TARBALL" ]; then
  echo "  FAIL  npm pack 没产出 $TARBALL"
  exit 1
fi
echo "  OK    产出tarball（$(du -h "$TARBALL" | cut -f1)）"

# ---------- 2. 装到空目录 ----------
mkdir -p "$WORK/consumer"
cd "$WORK/consumer"
npm init -y >/dev/null 2>&1
if ! npm install --no-audit --no-fund --silent "$TARBALL" >/dev/null 2>&1; then
  echo "  FAIL  tarball 装不进空目录（package.json 或依赖有问题）"
  exit 1
fi
PKG="node_modules/$NAME"
echo "  OK    装进空项目成功"

# ---------- 3. 内部文档绝不能在包里 ----------
LEAK=$(cd "$PKG" && ls -d 00-charter 07-notes 08-plan prefixed 2>/dev/null | tr '\n' ' ')
LEAK="$LEAK $(cd "$PKG" && ls *.zip *.tar.gz 2>/dev/null | tr '\n' ' ')"
LEAK="$LEAK $(cd "$PKG" && ls PLAN*.md NOTES*.md 2>/dev/null | tr '\n' ' ')"
if [ -n "$(echo "$LEAK" | tr -d ' ')" ]; then
  echo "  FAIL  🔴 tarball 里出现了内部文档：$LEAK"
  echo "        ⇒ files 白名单或 .npmignore 有问题"
  exit 1
fi
echo "  OK    tarball 内无内部文档"

# ---------- 4. exports 声明的每个入口都必须真实存在 ----------
#⚠️ 必须按**通配语义**判，不能逐条- [ -e ]：
#    `./patterns/*` 这种通配导出对应的目标 `03-patterns/*` 本身带*，
#    `[ -e "node_modules/pkg/03-patterns/*" ]` 永远是假
#    ⇒ 会把**正常的通配导出**误报成缺失（实测踩过）。
#    正解：通配导出取目录，检查**目录存在且非空**。
BAD=""
while IFS=$'\t' read -r key target; do
  [ -z "$key" ] && continue
  case "$target" in
    # 通配导出：检查目标目录存在且非空
    *'*')
      d="$PKG/$(dirname "${target%/*}")"
      if [ ! -d "$d" ]; then
        BAD="$BAD $key -> $target（目录不存在）"
      elif [ -z "$(ls -A "$d" 2>/dev/null)" ]; then
        BAD="$BAD $key -> $target（目录为空）"
      fi
      ;;
    # 精确导出：文件或目录必须在
    *)
      p="$PKG/${target#./}"
      [ -e "$p" ] || BAD="$BAD $key -> $target（缺失）"
      ;;
  esac
done < <(node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('$PKG/package.json', 'utf8'));
  const ex = pkg.exports || {};
  for (const [k, v] of Object.entries(ex)) {
    if (typeof v === 'string') console.log(k + '\t' + v);
  }
")
if [ -n "$BAD" ]; then
  echo "  FAIL  🔴 exports 声明了但tarball 里不存在："
  for b in $BAD; do echo "        $b"; done
  exit 1
fi
echo "  OK    exports 的每个入口都真实存在"

# ---------- 5. 关键文件必须在（types 是对外承诺）----------
MISS=""
for f in types/index.d.ts LICENSE README.md; do
  [ -e "$PKG/$f" ] || MISS="$MISS $f"
done
if [ -n "$MISS" ]; then
  echo "  FAIL  🔴 tarball 缺：$MISS"
  exit 1
fi
echo "  OK    types / LICENSE / README 都在包里"

# ---------- 6. 真加载一次 JS（语法错误会在这里暴露）----------
# ---------- 6. 真解析一次包里的 JS（语法错误会在这里暴露）----------
# ⚠️ 两个踩过的坑，都写在这里免得再犯：
#   ① `| sed 's|^|../|'` —— 多加一层路径，导致这道判据**从来没真正执行过**
#      （静默跳过，看起来一直"通过"）。
#   ② `cd "$PKG" && find ...` 产出**相对路径**，后续在别的 cwd 下
#      `node --check` 会解析到不存在的文件 ⇒ **误报语法错误**。
#      正解：一律用**绝对路径**，且find 在子 shell 里跑。
PKG_ABS="$(cd "$PKG" && pwd)"
JS_OK=0; JS_N=0
while IFS= read -r jf; do
  [ -z "$jf" ] && continue
  JS_N=$((JS_N+1))
  if ! node --check "$jf" 2>/dev/null; then
    echo "  FAIL  🔴 包里的 JS 语法有问题：${jf#$PKG_ABS/}"
    exit 1
  fi
  JS_OK=$((JS_OK+1))
  [ "$JS_OK" -ge 12 ] && break
done < <(cd "$PKG_ABS" && find 01-tokens 02-primitives 03-patterns 04-recipes 09-assets \
           -name '*.js' -type f 2>/dev/null | head -12 | sed "s|^|$PKG_ABS/|")
if [ "$JS_N" -gt 0 ]; then
  echo "  OK    包内 $JS_OK 个 JS 全部可解析"
else
  echo "  FAIL  🔴 tarball 里一个 JS 都没有 —— files 白名单漏了"
  exit 1
fi

# ---------- 7. 文档里给使用者的路径必须真实存在 ----------
# 🔴 这条来自一个真实的用户级问题（2026-10-06）：
#   README 写 `<script src="node_modules/frontend-lib/patterns/overlay/overlay.js">`
#   而 tarball 里根本没有 patterns/ 这个目录 ⇒ 陌生人照抄必然 404。
#   根因：exports 的 "./patterns/*" 只对**包解析**（import）生效，
#   它不会在node_modules 里造一个 patterns/ 目录。
#
#   ⇒ 凡是文档里出现 node_modules/<pkg>/... 的路径，
#     必须在 tarball 里逐个核实。
BAD_DOC=""
while IFS= read -r ref; do
  [ -z "$ref" ] && continue
  # ref 形如 frontend-lib/03-patterns/overlay/overlay.js
  rel="${ref#"$NAME"/}"
  if [ ! -e "$PKG_ABS/$rel" ]; then
    BAD_DOC="$BAD_DOC
         $ref"
  fi
done < <(cd "$PKG_ABS" && grep -rhoE "node_modules/$NAME/[A-Za-z0-9_/.-]+\.(js|css)" \
          --include='*.md' . 2>/dev/null | sed "s|node_modules/||" | sort -u)
if [ -n "$BAD_DOC" ]; then
  echo "  FAIL  🔴 文档里的路径在包里不存在：$BAD_DOC"
  echo "        ⇒ 使用者照抄必然 404。exports 不会在 node_modules 里造目录。"
  exit 1
fi
echo "  OK    文档里给使用者的路径全部存在"

echo ""
echo "  ⇒ 用户装到的东西与我们以为的一致。"
exit 0