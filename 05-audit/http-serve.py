#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
http-serve.py — 给门禁用的静态服务

🔴 为什么不直接用 `python -m http.server`
---------------------------------------------------------------------------
  0.11.15 把门禁改成 4 路并发之后，`tooltip` 门禁偶发失败：

      Failed to load resource: net::ERR_CONNECTION_REFUSED

  单跑它是通过。原因在服务端，不在被测代码：

    `socketserver.TCPServer.request_queue_size` 默认 **5**。
    一个页面要拉 tokens.css / typography.css / page.css / 组件 css / 组件 js
    等十来个资源，4 个浏览器同时开页 ⇒ 瞬时排队经常超过 5 ⇒ 内核直接拒绝。

  ⇒ 这里把 backlog 提到 256，并显式开 daemon_threads。

用法：
    python 05-audit/http-serve.py [端口]     # 默认 8000，只绑 127.0.0.1
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        # 🔴 给每个响应盖一个身份戳（0.17.0 实测教训）
        #   check-all 的 canary 原来只比对 index.html 的**字节**，
        #   所以它分不出"这一棵树 + 门禁服务器"和"这一棵树 + 单线程开发服务器"。
        #   实际后果：有人用 serve.py（单线程、backlog 默认 5）占了 8000，
        #   canary 字节一致 ⇒ 被愉快复用 ⇒ 4 路并发时资源请求排队失败
        #   ⇒ 页面 CSS 没加载完就被量 ⇒ tap-target 报 79×22（应为 360×44）、
        #     rtl-render 报"希伯来语膨胀溢出 1464px"。
        #   ⇒ 两个门禁同时假红，而去查代码永远查不到（代码是好的）。
        #   ⇒ 修法不是"加长等待"，是让 canary 能问出**这是谁**。
        self.send_header('X-FL-Gate-Server', 'threaded-256')
        super().end_headers()

    def log_message(self, *a):  # 门禁日志已经够长了，别再加访问日志
        pass


class Server(ThreadingHTTPServer):
    daemon_threads = True
    # 默认 5；并发浏览器会把队列打满，表现为 ERR_CONNECTION_REFUSED
    request_queue_size = 256


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    Server(('127.0.0.1', port), Handler).serve_forever()
