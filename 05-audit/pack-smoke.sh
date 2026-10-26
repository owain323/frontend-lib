#!/usr/bin/env bash
# LAYER: component
# ============================================================================
# pack-smoke.sh — 打包实装冒烟
#
# 🔴 LAYER: component（0.8.9 加）—— 本脚本要 `npm pack` + 在临时目录真装一次，
#   属重型外部工具（慢、且依赖网络/磁盘）。命令文本是
#   `bash 05-audit/pack-smoke.sh`，不含 node ⇒ 之前 MODE=fast 会照跑它
#   （外部审计 P2-6 点的另一处）。
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
# 🔴 必须清掉 `npm_config_dry_run`（0.9.0 发布时才发现）：
#   `npm publish --dry-run` 会把 `npm_config_dry_run=true` 写进**环境变量**，
#   子进程全部继承。于是本脚本里的 `npm pack` 也变成 dry-run ⇒ **不产出 tarball**
#   ⇒ 这里报 "npm pack 没产出"。
#
#   后果比"一条误报"严重：`npm publish --dry-run` 是**发布前唯一的全链路预演**，
#   它红了就没人敢发；而真实 `npm publish` 不会设这个变量，所以问题只在预演里出现
#   —— 一个"只在验证时失败、真跑时没事"的门禁，比没有门禁更容易误导人。
unset npm_config_dry_run
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

# ---------- 3b. 内部判据产物 / 负向 fixture 不该进包 ----------
# 🔴 0.8.9 新增。为什么单独一条：
#   `files` 白名单是**目录级**的（"ai/" "dist/" 整目录进包），
#   所以目录里的**内部判据产物**会跟着一起进去 ——
#   上一轮 npm pack 实测 tarball 里就有：
#     ai/surface.baseline.json         （运行时 API 快照基线，门禁自己比对用）
#     adapters/presentation/fixtures/（故意做坏的负向 fixture）
#     dist/manifest.json              （构建元数据，29 KB）
#   ⇒ 这三样对**使用者**零价值，只是让包变大、让内部实现细节外泄。
#
# ⚠️ 为什么不改 files 改成显式排除：白名单目录已经很长，
#    再加一串 `!` 排除会让"包里该有什么"更难读。
#    ⇒ 保持白名单简洁，用**判据**守住。
JUNK=$(cd "$PKG" && find . \( -name '*baseline*.json' -o -name 'manifest.json' \
        -o -path '*/fixtures/*' -o -name '*selfcheck*' \) 2>/dev/null \
        | tr '\n' ' ')
if [ -n "$(echo "$JUNK" | tr -d ' ')" ]; then
  echo "  FAIL  🔴 tarball 里出现了内部判据产物 / 负向 fixture："
  echo "$JUNK" | tr ' ' '\n' | grep -v '^$' | sed 's/^/          /'
  echo "        ⇒ 这些是门禁自己比对用的，给使用者零价值"
  exit 1
fi
echo "  OK    tarball 内无内部判据产物 / 负向 fixture"

# ---------- 4. 声明 vs 包内实物：闭包判定（判据只留一份）----------
# 🔴 这一节原来自己用 bash + `node -e` 走一遍 exports。
#   老写法是 `if (typeof v === 'string') console.log(k + '\t' + v)` ⇒
#   条件导出对象整片跳过。而 `exports["."]` 恰好就是那种形态：
#        { "types": "./types/index.d.ts", "default": "./index.html" }
#   ⇒ 它一行都没进循环，于是 index.html 漏到 0.9.0，这里还常年打
#     "OK exports 的每个入口都真实存在"。
#
#   中间版本给 bash 打了补丁（递归展开 string/array/object）。但那是
#   **同一判定写两遍**（本库 ERROR E31：必然漂移），而且补丁只加了
#   exports 一条，HTML 引用、文档路径仍然没人判。
#   ⇒ 现在判据**只有一份**：`05-audit/pack-closure.js`
#        清单模式 → 每次 `--fast` 都跑（~1.5s，拿 npm 自己算的清单）
#        目录模式 → 就是这里，判**真装完之后**的树
#      两边共用同一套 walker，修一处两边都跟着变。
if ! node "$REPO_ROOT/05-audit/pack-closure.js" --dir "$WORK/consumer/$PKG" \
       > "$WORK/closure.txt" 2>&1; then
  echo "  FAIL  🔴 包内实物与声明不闭合："
  sed 's/^/        /' "$WORK/closure.txt"
  exit 1
fi
echo "  OK    exports / HTML 引用 / 文档路径 与包内实物一致"

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

# ---------- 7. 文档里给使用者的路径 ----------
# 🔴 这条来自一个真实的用户级问题（2026-10-06）：
#   README 写 `<script src="node_modules/frontend-lib/patterns/overlay/overlay.js">`
#   而 tarball 里根本没有 patterns/ 这个目录 ⇒ 陌生人照抄必然 404。
#   根因：exports 的 "./patterns/*" 只对**包解析**（import）生效，
#   它不会在 node_modules 里造一个 patterns/ 目录。
#
#   ⚠️ 判据已迁到第 4 步（`pack-closure.js --dir` 的第 [4] 段），
#      本文件不再留第二份实现 —— E31：同一判定写两遍必然漂移。
#      上面第 4 步的 "OK exports / HTML 引用 / 文档路径 与包内实物一致"
#      已经包含这条；这里只保留事故记录，防止以后有人以为漏了。
echo "  OK    文档路径检查已并入第 4 步（pack-closure --dir）"

echo ""
echo "  ⇒ 用户装到的东西与我们以为的一致。"
exit 0