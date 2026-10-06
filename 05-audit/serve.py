#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
serve.py — 一键起本地静态服务器来看 demo

🔴 **为什么必须有这个脚本**（真实踩过的坑，2026-10-02）：

   本库的 demo 引用**共享的 CSS**（`../../01-tokens/tokens.css`），
   这样才能证明"组件是可复用的"，而不是复制粘贴的死样式。

   但 WorkBuddy 的 present_files 预览面板是**单文件模式** ——
   它只服务那一个 HTML，兄弟文件一律 404。

   结果：所有引用共享 CSS 的 demo 在预览面板里打开都是**完全无样式**的
   （浏览器默认按钮、列表竖排、标题变成默认 h1）。
   而 longform 一直正常，因为它**自包含内联了 CSS** ——
   这个对比恰好暴露了问题，我却一直没发现。

   ⇒ demo **必须通过 HTTP 服务器**打开，不能靠双击，也不能靠单文件预览。

用法：
    python serve.py               # 起服务器并打印所有 demo 的 URL
    python serve.py --port 8080   # 指定端口（默认自动挑空闲的）
    python serve.py --list        # 只列出 demo 清单，不起服务
    python serve.py --stop        # 停掉本脚本起的服务器
"""

import sys
import os
import glob
import socket
import subprocess
import json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PIDFILE = os.path.join(HERE, '.serve.pid')


def free_port(start=8000, tries=20):
    for p in range(start, start + tries):
        s = socket.socket()
        try:
            s.bind(('127.0.0.1', p))
            s.close()
            return p
        except OSError:
            s.close()
            continue
    return None


def list_demos():
    out = []
    for pat in ('index.html', '01-tokens/*.html', '02-primitives/*/demo.html',
                '03-patterns/*/demo.html', '04-recipes/*/*.html'):
        out.extend(glob.glob(os.path.join(ROOT, pat)))
    # index.html 是入口，排在最前；其余按字母序
    entry = [x for x in out if os.path.basename(x) == 'index.html']
    rest = sorted(x for x in out if x not in entry)
    return entry + rest


def stop():
    if not os.path.isfile(PIDFILE):
        print('没有在运行的 serve.py 实例。')
        return
    with open(PIDFILE) as f:
        pid = int(f.read().strip())
    try:
        os.kill(pid, 15)
        os.remove(PIDFILE)
        print('已停止（pid %d）。' % pid)
    except OSError as e:
        print('停止失败：%s' % e)


def main():
    args = sys.argv[1:]

    if '--stop' in args:
        stop()
        return 0

    demos = list_demos()

    if '--list' in args:
        for d in demos:
            print('  %s' % os.path.relpath(d, ROOT).replace('\\', '/'))
        return 0

    port = None
    if '--port' in args:
        try:
            port = int(args[args.index('--port') + 1])
        except (IndexError, ValueError):
            print('--port 需要一个数字')
            return 2
    else:
        port = free_port()
    if not port:
        print('找不到空闲端口')
        return 2

    proc = subprocess.Popen(
        [sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    with open(PIDFILE, 'w') as f:
        f.write(str(proc.pid))

    base = 'http://127.0.0.1:%d/' % port
    print('静态服务器已起（pid %d）' % proc.pid)
    print('根目录：%s' % ROOT)
    print('')
    print('demo 清单：')
    for d in demos:
        rel = os.path.relpath(d, ROOT).replace('\\', '/')
        print('  %s%s' % (base, rel))
    print('')
    print('⚠️  这些页面引用共享 CSS，**必须通过上面的 URL 打开**。')
    print('   直接双击文件或用单文件预览面板，兄弟 CSS 会 404，页面会完全没样式。')
    print('')
    print('停掉：python %s --stop' % os.path.relpath(__file__).replace('\\', '/'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
