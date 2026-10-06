#!/usr/bin/env bash
# with-server.sh — 起服务器 → 跑命令 → **一定停掉**
#
# 2026-10-03 建的。起因：Owner 发现有个后台 http.server 跑了 9.6 小时。
#   根因不是"忘了停"，而是**"起服务"和"停服务"本来是两步** ——
#   中间任何一步失败，清理就被跳过。
#   这里用 trap 把"停"绑到退出路径：**成功、失败、Ctrl-C 都会停**。
#
# 用法：
#   bash 05-audit/with-server.sh bash 05-audit/check-all.sh
#   bash 05-audit/with-server.sh node 05-audit/clicktest.js
set -u
PORT="${PORT:-8000}"
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

# 端口已被占用就直接报错 —— **不去动别人的进程**。
# （也可能是上一次忘了停的；那种情况请用 PowerShell 工具按 PID
#   确认 CommandLine 之后再停，**不要按端口盲杀**。）
if curl -s -o /dev/null -m 1 "http://127.0.0.1:$PORT/index.html" 2>/dev/null; then
  echo "端口 $PORT 已经在监听 —— 可能有个残留的服务器。"
  echo "请先确认并停掉它（PowerShell: Get-CimInstance Win32_Process 看 CommandLine），再跑本脚本。"
  exit 2
fi

$PY -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!
cleanup() { kill "$SRV" 2>/dev/null; }
trap cleanup EXIT INT TERM

for _ in $(seq 1 10); do
  curl -s -o /dev/null -m 1 "http://127.0.0.1:$PORT/index.html" && break
  sleep 0.5
done

"$@"
exit $?          # trap 在这里停掉服务器
