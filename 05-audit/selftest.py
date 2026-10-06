#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
selftest.py — 在真实浏览器里点一点，看结果

Owner 的要求：
> 「你最好开一开浏览器试着点一点玩一玩，在浏览器里面看一看
> 你写的东西到底符不符合你的预期」

做法（零依赖，不装 puppeteer / playwright）：
  1. 把一段自检 JS 注入 demo 的 </body> 之前，写到临时文件
  2. 用系统 Chrome 的 headless 模式加载
  3. 自检 JS 真实点击控件，把结果写进 document.title
  4. --dump-dom 读回结果并解析

**这是"可证伪自检"**：不是"我觉得对"，而是"真的点了，看到结果"。

🔴 **环境限制（如实记录，别把自检当万能）**：
   headless 的 `--virtual-time-budget` 会快进定时器，但**不驱动 requestAnimationFrame**
   —— 或者说驱动得**不稳定**。实测同一份代码三次跑出两种结果
   （两次 41 次采样后仍停在初始值，一次第 2 次采样就正确）。

   ⇒ 凡是被测代码用 rAF 排队的（目录高亮、FLIP 动画），
      **本自检的断言不可信**，已降级为"仅供参考"。
   ⇒ 不依赖 rAF 的断言（点击、尺寸、位移、焦点）**是可靠的**。

   判别方法（这次就是靠它定性的）：
     ① 先转储原始数据（sections 的 offsetTop 等）—— **数据可靠**
     ② 再看断言结果是否可重复 —— 不可重复就是环境问题，不是代码问题

⚠️ 一次失败值得警惕：**同一份代码两次跑出不同结果，比一直失败更糟** ——
它说明工具本身不可信，而不只��被测物有问题。

用法：
    python selftest.py                # 跑全部
    python selftest.py choice button  # 只跑指定
"""

import sys
import os
import re
import json
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = 'http://127.0.0.1:8000'
PORT = 8000

CHROME_CANDIDATES = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
]

# ------------------------------------------------------------------ 自检脚本
PROBES = '<script>' + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '_probe.js'), encoding='utf-8').read() + '</script>'


def find_chrome():
    for p in CHROME_CANDIDATES:
        if os.path.isfile(p):
            return p
    return None


def run_one(chrome, rel, tmpdir):
    """rel 形如 '02-primitives/choice/demo.html'"""
    src = os.path.join(ROOT, rel.replace('/', os.sep))
    with open(src, encoding='utf-8') as f:
        html = f.read()

    # 🔴 必须写回**原目录**，不能用 file://
    #    demo 里的 CSS 引用是相对路径（../01-tokens/tokens.css），
    #    放到别处或用 file:// 加载都会 404 ⇒ 量出来的尺寸全是错的。
    out = os.path.join(os.path.dirname(src), '_selftest_tmp.html')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html.replace('</body>', PROBES + '\n</body>'))

    url = 'http://127.0.0.1:%d/%s' % (PORT, os.path.relpath(out, ROOT).replace('\\', '/'))
    try:
        try:
            r = subprocess.run(
                [chrome, '--headless=new', '--disable-gpu', '--no-sandbox',
                 '--hide-scrollbars', '--window-size=1280,900',
                 '--virtual-time-budget=6000', '--dump-dom', url],
                capture_output=True, timeout=45, text=True,
                encoding='utf-8', errors='replace')
        finally:
            if os.path.isfile(out):
                os.remove(out)          # 测完立刻清掉，不留垃圾在库里
    except subprocess.TimeoutExpired:
        return [{'t': '页面加载', 'ok': False, 'info': '超时（>45s）'}]

    dom = r.stdout or ''
    m = re.search(r'<title>SELFTEST:(.*?)</title>', dom, re.S)
    if not m:
        return [{'t': '自检脚本执行', 'ok': False,
                 'info': '没拿到结果（页面可能有 JS 报错，或 title 未更新）'}]
    import html as _h
    try:
        return json.loads(_h.unescape(m.group(1)))
    except Exception:
        return [{'t': '结果解析', 'ok': False, 'info': m.group(1)[:120]}]


def main():
    chrome = find_chrome()
    if not chrome:
        print('找不到 Chrome/Edge，跳过（浏览器验证需要它）')
        return 2

    targets = sys.argv[1:]
    if not targets:
        targets = ['02-primitives/choice', '02-primitives/button',
                   '02-primitives/input', '03-patterns/list',
                   '03-patterns/overlay', '03-patterns/nav']

    tmpdir = tempfile.mkdtemp(prefix='fe-selftest-')
    total, passed = 0, 0

    for rel in targets:
        page = rel + '/demo.html'
        print('\n=== %s ===' % page)
        for r in run_one(chrome, page, tmpdir):
            mark = 'PASS' if r['ok'] else 'FAIL'
            print('  [%s] %-46s %s' % (mark, r['t'], r['info']))
            total += 1
            passed += 1 if r['ok'] else 0

    print('\n' + '=' * 68)
    print('真实浏览器自检：%d / %d 通过' % (passed, total))
    return 0 if passed == total else 1


if __name__ == '__main__':
    sys.exit(main())
