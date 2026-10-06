#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
viewport.py — 响应式静态门禁（零负载版）

🔴 **这个门禁只做静态检查。真正的横向溢出必须渲染才知道。**
   而渲染要启动 headless Chrome —— 本机 16GB 内存曾因资源耗尽假死 4 次（M-0 铁律）。
   所以：
     静态版（本文件，默认）—— 零负载，覆盖下面 4 类**可判定**的问题
     渲染取证 —— 需单独申请后才能跑，不在本文件范围内

检查项：
  1. 缺 <meta name="viewport">                      HIGH
  2. viewport 里没有 width=device-width             HIGH  → 移动端按 980px 渲染，字变极小
  3. CSS 里 width: ≥320px 的硬编码固定宽度          HIGH  → 320px 设备必然横向溢出
  4. <img> 没有显式 width/height                    LOW   → 加载时布局跳动（CLS）
  5. min-width: ≥480px                              LOW   → 可能是刻意的横向滚动容器

刻意**不做**的事：
  - 不扫 max-width（那恰恰是防溢出的正确写法；正则已用 (?<![\w-]) 排除）
  - 不判断"这个固定宽度是不是在 overflow:auto 的容器里"（要真解析布局，静态做不到）
  - ⚠️ **不报告 @media 块内的固定宽度** —— 这条要诚实说明：
      对 `@media (min-width: 1024px)` 是对的（宽屏才生效，960 < 1024 没问题）；
      对 `@media (max-width: 960px)` 是**漏的**（窄屏时用 960px 宽必然溢出）。
      当前按"宁可不报也不误报"处理。等出现真实案例再改成区分处理。

用法：
    python viewport.py demo.html
    python viewport.py --dir <目录>
退出码：0 = 无 HIGH；1 = 有 HIGH
"""

import sys
import os
import re
import glob
from html.parser import HTMLParser

HIGH, MEDIUM, LOW = 'HIGH', 'MEDIUM', 'LOW'

RE_META = re.compile(r'<meta[^>]+>', re.I)
RE_ATTR_NAME = re.compile(r'name\s*=\s*["\']?([^"\'>\s]+)', re.I)
RE_ATTR_CONTENT = re.compile(r'content\s*=\s*["\']([^"\']*)["\']', re.I)

RE_CSS_COMMENT = re.compile(r'/\*.*?\*/', re.S)
RE_DATA_URI = re.compile(r'data:[^"\')]*')
RE_MEDIA_BLOCK = re.compile(r'@media[^{]*\{')

RE_WIDTH = re.compile(r'(?<![\w-])width\s*:\s*(\d+)px', re.I)
RE_MIN_WIDTH = re.compile(r'(?<![\w-])min-width\s*:\s*(\d+)px', re.I)


# ====================================================================== HTML
class ViewportCheck(HTMLParser):
    def __init__(self):
        HTMLParser.__init__(self, convert_charrefs=True)
        self.has_viewport = False
        self.vp_content = ''
        self.imgs_no_size = []
        self.img_order = []
        self.img_lazy = []
        self.img_srcset_nosizes = []

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v if v is not None else '') for k, v in attrs}

        if tag == 'meta':
            nm = a.get('name', '').lower()
            if nm == 'viewport':
                self.has_viewport = True
                self.vp_content = a.get('content', '')

        elif tag == 'img':
            # 没有显式宽高 → 加载时布局跳动（CLS）
            has_w = 'width' in a
            has_h = 'height' in a
            style = a.get('style', '')
            css_ratio = 'aspect-ratio' in style
            if not (has_w and has_h) and not css_ratio:
                self.imgs_no_size.append((self.getpos()[0], a.get('src', '?')[:50]))
            # 🔴 新增两条（依据图片规范）：
            #   · 第一个 img 加 loading=lazy —— 极可能是首屏图，lazy 会拖慢 LCP
            #   · 有 srcset 没 sizes —— 浏览器会选错图，比不写 srcset 更糟
            self.img_order.append(a)
            if a.get('loading', '').lower() == 'lazy':
                self.img_lazy.append((self.getpos()[0], a.get('src', '?')[:50]))
            if 'srcset' in a and 'sizes' not in a:
                self.img_srcset_nosizes.append((self.getpos()[0], a.get('src', '?')[:50]))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)


def check_html(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        src = f.read()

    c = ViewportCheck()
    try:
        c.feed(src)
    except Exception as e:
        return [(HIGH, 'parse', 0, 'HTML 解析失败：%s' % e)], 0

    probs = []
    if not c.has_viewport:
        probs.append((HIGH, 'meta-viewport',
                      '缺 <meta name="viewport">（移动端会按约 980px 虚拟宽度渲染，'
                      '所有字变得极小）'))
    else:
        v = c.vp_content.replace(' ', '').lower()
        if 'width=device-width' not in v:
            probs.append((HIGH, 'meta-width',
                          'viewport 里没有 width=device-width：content="%s"'
                          ' —— 移动端不会按设备宽度渲染' % c.vp_content[:60]))
        if 'initial-scale' not in v:
            probs.append((LOW, 'meta-scale',
                          'viewport 里没有 initial-scale=1 —— 允许用户手动缩放，'
                          '低视力用户会受益。确认是有意为之'))

    n_img = len(c.imgs_no_size)
    for line, s in c.imgs_no_size[:6]:
        # 🔴 由 LOW 升为 HIGH。
        #    CLS 是 Core Web Vitals 之一，且**完全可自动检测** ——
        #    能自动检测却按"建议"级别报，等于门禁没设防。
        probs.append((HIGH, 'img-size',
                      '<img src="%s"> 没有显式 width/height 且 style 无 aspect-ratio '
                      '（L%d）→ 加载完成时布局跳动（CLS）' % (s, line)))
    if n_img > 6:
        probs.append((HIGH, 'img-size', '…… 另有 %d 个 img 同样缺尺寸' % (n_img - 6)))

    # 第一个 img 加 lazy —— 极可能是首屏 / LCP 图
    if c.img_order and c.img_lazy:
        first_src = c.img_order[0].get('src', '?')[:50]
        if c.img_lazy and c.img_lazy[0][1] == first_src:
            probs.append((MEDIUM, 'img-lazy-hero',
                          '第一个 <img>（很可能是首屏主图）加了 loading="lazy" —— '
                          'lazy 会把它推迟到布局之后才下载，'
                          '而那正是用户第一眼要看的（CLS/LCP 双输）。确认它确实在首屏以下'))

    for line, s in c.img_srcset_nosizes:
        probs.append((MEDIUM, 'img-srcset',
                      '<img src="%s"> 有 srcset 但没有 sizes（L%d）—— '
                      '浏览器不知道它显示多大，会选错图；**配错比不写 srcset 更糟**'
                      % (s, line)))
    return probs


# ====================================================================== CSS
def check_css(path, in_media_ok=True):
    with open(path, encoding='utf-8', errors='replace') as f:
        css = f.read()

    css = RE_CSS_COMMENT.sub('', css)
    css = RE_DATA_URI.sub('', css)

    # 挖掉 @media 块 —— 里面的固定宽度是断点覆盖，不影响移动端最小宽度。
    # 用占位符替换，保留行数信息。
    def _blank(m):
        return re.sub(r'[^\n]', ' ', m.group(0))
    css = RE_MEDIA_BLOCK.sub(lambda m: _blank(re.match(r'@media[^{]*', m.group(0)) or m), css)
    css = re.sub(r'@media[^{]*\{', _blank, css)

    probs = []
    n_media = len(RE_MEDIA_BLOCK.findall(css))
    line0 = 0

    for m in RE_WIDTH.finditer(css):
        w = int(m.group(1))
        if w < 320:
            continue
        line = css[:m.start()].count('\n') + 1
        probs.append((HIGH, 'fixed-width',
                      'width: %dpx（L%d）→ 320px 设备必然横向溢出。'
                      '改用 max-width: %dpx 或 width: 100%%' % (w, line, w)))

    for m in RE_MIN_WIDTH.finditer(css):
        w = int(m.group(1))
        if w < 480:
            continue
        line = css[:m.start()].count('\n') + 1
        probs.append((LOW, 'min-width',
                      'min-width: %dpx（L%d）→ 如果外层没有 overflow-x:auto，'
                      '移动端会溢出。如果它本来就是代码块/画布的横向滚动容器，'
                      '确认后忽略' % (w, line)))
    return probs


# ====================================================================== main
def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args or '--help' in sys.argv:
        print(__doc__)
        return 2

    paths = []
    for a in args:
        if os.path.isdir(a):
            paths.extend(glob.glob(os.path.join(a, '**', '*.htm*'), recursive=True))
            paths.extend(glob.glob(os.path.join(a, '**', '*.css'), recursive=True))
        else:
            paths.append(a)
    # 🔴 排除**产物目录**（实测踩坑：报"缺 meta viewport"）
    #    `glob('**/*.htm*')` 会扫到 `10-review/shots/_current/` ——
    #    那里存的是**截图产物**，扩展名被写成 .html（内容其实是 PNG），
    #    当然没有 <meta viewport> ⇒ 门禁长期假红。
    #    ⭐ 真实页面 39/39 全都有 viewport，门禁却报缺 ⇒ 判据扫错了范围。
    _ARTIFACT_DIRS = ('10-review/shots/_current', '10-review/shots/_diff',
                      '_selftest', '.git', 'node_modules')
    paths = [p for p in paths
             if os.path.isfile(p)
             and not any(a in p.replace(os.sep, '/') for a in _ARTIFACT_DIRS)]
    if not paths:
        print('没找到 HTML/CSS 文件')
        return 2

    root = os.path.commonpath(paths) if len(paths) > 1 else None
    total_high = 0

    for p in paths:
        probs = check_css(p) if p.lower().endswith('.css') else check_html(p)
        name = os.path.relpath(p, root).replace('\\', '/') if root else os.path.basename(p)
        high = [x for x in probs if x[0] == HIGH]
        med = [x for x in probs if x[0] == MEDIUM]
        low = [x for x in probs if x[0] == LOW]
        total_high += len(high)

        if not probs:
            print('OK   %s' % name)
            continue
        print('%s %-46s HIGH %d / MEDIUM %d / LOW %d'
              % ('FAIL' if high else 'WARN', name, len(high), len(med), len(low)))
        for sev, rule, msg in probs:
            print('       [%-14s] %s' % (rule, msg))

    print()
    if total_high:
        print('HIGH 级 %d 项 —— 不许提交' % total_high)
        return 1
    print('无 HIGH 级问题。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
