#!/usr/bin/env bash
# publish.sh — 一键发布（交互只有 npm 登录那一步）
#
# 用法（在仓库根目录，或任意位置用绝对路径）：
#     bash 05-audit/publish.sh
#
# 它做什么：
#   ① 检查 npm 登录状态（没登录就带你登录）
#   ② 检查 registry 不是镜像源（镜像源 publish 会 403，且错误看起来像权限问题）
#   ③ 检查版本号五处一致
#   ④ 真正执行 npm publish —— 它会先跑 prepublishOnly（fast 门禁 + 打包实装冒烟），
#      门禁红就**什么都不会发出去**
#
# 它不做什么：
#   - 不改版本号（那是人的决定，见 docs/RELEASING.md 第 1 步）
#   - 不跳过任何检查
#
# 为什么这个脚本存在：
#   发布这一步必须由账号持有人在一个能交互的终端里跑一次 —— 这是发布流程
#   本身的约束，不是可以绕过的麻烦。把前面能自动化的都自动化，
#   只把这一步压到"回车"。

set -euo pipefail
cd "$(dirname "$0")/.."

VER="$(cat VERSION)"
echo
echo "============================================="
echo "  发布 agentcss@$VER"
echo "============================================="
echo

# ---------- ① 登录 ----------
echo "① npm 认证"

# 两条路都支持：
#   a) 你已经 `npm login` 过（凭据在 ~/.npmrc）—— 下面直接复用
#   b) 仓库根有一个 `.npm-token` 文件（npm 的 Automation Token）
#      —— 它已被 .gitignore 挡住，不会误提交；用完请删掉
#
# 为什么先看 b：某些环境里 `npm login` 要开浏览器，登不进去。
# 但**无论哪条路，凭据都不进仓库、不进聊天记录**。
TMPRC=""
if [ -f .npm-token ]; then
  echo "   发现 .npm-token（本地文件，不入库）"
  TOKEN="$(tr -d '[:space:]' < .npm-token)"
  if [ -z "$TOKEN" ]; then
    echo "   ✗ .npm-token 是空的"
    exit 1
  fi
  TMPRC="$(mktemp)"
  chmod 600 "$TMPRC"
  printf '//registry.npmjs.org/:_authToken=%s\n' "$TOKEN" > "$TMPRC"
  # shellcheck disable=SC2064
  trap 'rm -f "$TMPRC"' EXIT
  export NPM_CONFIG_USERCONFIG="$TMPRC"
  echo "   ✓ 用 .npm-token 认证（发布完请删掉这个文件）"
elif npm whoami >/dev/null 2>&1; then
  echo "   已登录：$(npm whoami)"
else
  echo "   还没登录。接下来 npm 会提示你登录（浏览器授权或输入一次性验证码）。"
  echo
  npm login
  echo
  echo "   登录后身份：$(npm whoami)"
fi

# ---------- ② registry ----------
echo
echo "② registry"
REG="$(npm config get registry)"
if [ "$REG" != "https://registry.npmjs.org/" ]; then
  echo "   ✗ 当前是 $REG"
  echo
  echo "     这是镜像源，**只能读不能发**。直接 publish 会得到 403，"
  echo "     而那个报错看起来像权限问题，很容易查错方向。"
  echo
  echo "     两种修法（任选一）："
  echo "       a) 确认你在仓库目录里执行（仓库根的 .npmrc 已经设好了）"
  echo "       b) 临时指定：npm publish --registry=https://registry.npmjs.org/"
  exit 1
fi
echo "   ✓ $REG"

# ---------- ③ 版本一致 ----------
echo
echo "③ 版本号"
python 05-audit/bump-version.py --check

# ---------- ④ 发布 ----------
echo
echo "④ npm publish"
echo "   会先跑门禁（约 2–3 分钟）。门禁红 ⇒ 自动中止，什么都没发出去。"
echo
npm publish

echo
echo "============================================="
echo "  发完了。核对五件事（docs/RELEASING.md 第四节）："
echo "============================================="
echo "   1) npm view agentcss version        应为 $VER"
echo "   2) 打开 https://www.npmjs.com/package/agentcss 看 README 渲染"
echo "   3) 新目录里 npm i agentcss 再 import 一次"
echo "   4) git tag 已推：git ls-remote --tags origin v$VER"
echo "   5) 若发了坏版本：发 patch，**不要**强行覆盖已发布版本"
echo
