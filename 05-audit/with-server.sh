#!/usr/bin/env bash
# with-server.sh — 起服务器 → 跑命令 → **一定停掉**
#
# 建的。起因：发现有个后台 http.server 跑了 9.6 小时。
#   根因不是"忘了停"，而是**"起服务"和"停服务"本来是两步** ——
#   中间任何一步失败，清理就被跳过。
#   这里用 trap 把"停"绑到退出路径：**成功、失败、Ctrl-C 都会停**。
#
# 🔴 2026-11 修两处（v0.24.2 发布时被 CI 打出来的）
# ---------------------------------------------------------------------------
#   ① 原来用 `python -m http.server`。两宗罪：
#      · `python` 在 ubuntu-latest 上**不存在**（只有 python3）
#        ⇒ 服务根本没起来，浏览器门禁全部 ERR_CONNECTION_REFUSED，
#          而报错看起来像"产品坏了"。
#      · 就算起来了，`http.server` 是**单线程、listen backlog=5**：
#          4 路并发拉资源就被内核拒 ⇒ 页面样式没落地就被量 ⇒ **假红**。
#          （check-all.sh 里对这件事有一段专门的判据与注释。）
#      ⇒ 现在与 check-all 起**同一个** `http-serve.py`（ThreadingHTTPServer +
#         `X-FL-Gate-Server` 身份戳），并先探测 python3。
#   ② 等端口那一层从"只要有人应答就算就绪"改成 canary：
#      `index.html` 字节与本地一致 **且** 响应头带身份戳。
#      只看返回码的话，别人的服务器/另一棵树都会被当成"就绪"。
#
# 用法：
#   bash 05-audit/with-server.sh bash 05-audit/check-all.sh
#   bash 05-audit/with-server.sh node 05-audit/clicktest.js
#   bash 05-audit/with-server.sh bash -c 'node 05-audit/a.js && node 05-audit/b.js'
set -u
PORT="${PORT:-8000}"
cd "$(dirname "$0")/.." || exit 2

# python3 优先：本仓门禁的前置依赖是 python3，只有 Windows 侧才常见 `python`。
PY="${PY:-}"
if [ -z "$PY" ]; then
  for _c in python3 python; do
    if command -v "$_c" >/dev/null 2>&1; then PY="$_c"; break; fi
  done
fi
if [ -z "$PY" ]; then
  echo "找不到 python3（本脚本要用它起静态服务）"
  exit 2
fi

# 端口已被占用就直接报错 —— **不去动别人的进程**。
# （也可能是上一次忘了停的；那种情况请按 PID 确认 CommandLine 之后再停，
#   **不要按端口盲杀**。）
if curl -s -o /dev/null -m 1 "http://127.0.0.1:$PORT/index.html" 2>/dev/null; then
  echo "端口 $PORT 已经在监听 —— 可能有个残留的服务器。"
  echo "请先确认并停掉它（Windows: Get-CimInstance Win32_Process 看 CommandLine），再跑本脚本。"
  exit 2
fi

# 与 check-all.sh 用**同一个**服务：多线程 + 身份戳。
$PY 05-audit/http-serve.py "$PORT" >/dev/null 2>&1 &
SRV=$!
cleanup() { kill "$SRV" 2>/dev/null; }
trap cleanup EXIT INT TERM

ready=0
for _ in $(seq 1 12); do
  if curl -s -o /dev/null -m 1 "http://127.0.0.1:$PORT/index.html" 2>/dev/null; then
    # canary：同一棵树 + 门禁服务器身份戳，缺一不可
    if curl -s -m 3 "http://127.0.0.1:$PORT/index.html" 2>/dev/null \
         | cmp -s - index.html \
       && curl -sI -m 3 "http://127.0.0.1:$PORT/index.html" 2>/dev/null \
         | grep -qi '^X-FL-Gate-Server:'; then
      ready=1
      break
    fi
  fi
  sleep 0.5
done
if [ "$ready" != 1 ]; then
  echo "服务起不来，或起来的不是这一棵树（canary 未通过）⇒ 浏览器结果不可信"
  exit 2
fi

"$@"
exit $?          # trap 在这里停掉服务器
