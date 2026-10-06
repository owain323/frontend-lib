#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
md-render.py — 内容渲染管线（Markdown → 自包含 HTML）

这是「云编辑器」能力的可复现版本：给它一份 .md，产出精简档 的单文件 HTML。
**中间没有任何手写环节** —— 这正是它存在的意义：
证明我们不发明标准之外的结构。

依据：本文件顶部列出的渲染约定

用法：
    python md-render.py <input.md> [-o out.html] [--title "标题"] [--check]
    python md-render.py <input.md> --check     # 只跑检查，不输出

渲染器：markdown-it（commonmark preset + table + strikethrough）
  · 核心语法 = CommonMark（事实标准）
  · 表格 / 删除线 = GFM 扩展（CommonMark 核心没有表格）
  · 与 GitHub 的差异：markdown-it 的删除线输出 <s>，GFM 规定 <del> ⇒ CSS 两者都支持

检查项（--check）：
  1. 标题层级不跳级（h1 → h3 = 跳级）
  2. <img> 必须有 alt（WCAG 1.1.1）
  3. 恰好一个 <h1>
  4. 表格必须是 <table>（不能是 div 模拟的）
退出码：0 = 干净；1 = 检查失败
"""

import sys
import os
import re
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.dirname(HERE)
CONTENT_CSS = os.path.join(LIB, '03-patterns', 'content', 'content.css')
TOKENS_CSS = os.path.join(LIB, '01-tokens', 'tokens.css')

SHELL = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
/* ---- 由 md-render.py 内联自 frontend-lib/01-tokens/tokens.css ---- */
{tokens}
/* ---- 由 md-render.py 内联自 frontend-lib/03-patterns/content/content.css ---- */
{content}
body {{
  margin: 0;
  background: var(--paper);
  color: var(--text-primary);
  font-family: var(--sans);
  font-size: var(--fs-base);
  line-height: var(--lh-base);
  -webkit-text-size-adjust: 100%;
}}
.wrap {{ max-width: 72ch; margin: 0 auto; padding: var(--sp-7) var(--sp-5) var(--sp-8); }}
</style>
</head>
<body>
<div class="wrap">
<div class="prose">
{body}
</div>
</div>
</body>
</html>
"""


# ------------------------------------------------------------------ 渲染
def render(md_text: str) -> str:
    try:
        from markdown_it import MarkdownIt
    except ImportError:
        sys.exit('需要 markdown-it-py：pip install markdown-it-py')
    # commonmark 预设 = CommonMark 核心；table / strikethrough = GFM 扩展
    return MarkdownIt('commonmark').enable('table').enable('strikethrough').render(md_text)


# ------------------------------------------------------------------ 检查
class Check(HTMLParser):
    def __init__(self):
        HTMLParser.__init__(self, convert_charrefs=True)
        self.headings = []
        self.imgs_total = 0
        self.imgs_no_alt = []
        self.h1_count = 0

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v if v is not None else '') for k, v in attrs}
        if re.fullmatch(r'h[1-6]', tag):
            lvl = int(tag[1])
            self.headings.append((lvl, self.getpos()[0]))
            if lvl == 1:
                self.h1_count += 1
        elif tag == 'img':
            # 🔴 这里原来只统计"缺 alt 的"，然后当成"图片总数"打印 ——
            #    标签与数据不符，害我以为图片没渲染出来。图片总数要单独记。
            self.imgs_total += 1
            if 'alt' not in a:
                self.imgs_no_alt.append((self.getpos()[0], a.get('src', '?')[:40]))


def check(html: str):
    c = Check()
    c.feed(html)
    probs = []

    if c.h1_count == 0:
        probs.append(('H1', '整页没有 <h1>'))
    elif c.h1_count > 1:
        probs.append(('H1', '有 %d 个 <h1>（应为 1）' % c.h1_count))

    prev = 0
    for lvl, line in c.headings:
        if prev and lvl > prev + 1:
            probs.append(('HEADING', '第 %d 行标题从 h%d 跳到 h%d' % (line, prev, lvl)))
        prev = lvl

    for line, src in c.imgs_no_alt:
        probs.append(('IMG', '第 %d 行 <img src="%s"> 缺 alt（WCAG 1.1.1）' % (line, src)))

    # div 模拟表格 —— 辅助技术读不出行列关系
    if re.search(r'<div[^>]*class="[^"]*table', html, re.I):
        probs.append(('TABLE', '疑似用 <div class="table..."> 模拟表格'))

    return probs, len(c.headings), c.imgs_total, len(c.imgs_no_alt)


# ------------------------------------------------------------------ main
def main():
    args = sys.argv[1:]
    if not args or '--help' in args:
        print(__doc__)
        return 2

    src_path = None
    out_path = None
    title = None
    do_check = '--check' in args

    for i, a in enumerate(args):
        if a in ('-o', '--output'):
            out_path = args[i + 1]
        elif a == '--title':
            title = args[i + 1]
        elif not a.startswith('-') and src_path is None:
            src_path = a

    if not src_path or not os.path.isfile(src_path):
        print('找不到输入文件')
        return 2

    with open(src_path, encoding='utf-8') as f:
        md_text = f.read()

    html = render(md_text)
    probs, nh, nimg, nmissing = check(html)

    print('渲染：%s' % os.path.basename(src_path))
    print('  %d 字节 md  ->  %d 字节 html' % (len(md_text.encode('utf-8')),
                                              len(html.encode('utf-8'))))
    print('  标题 %d 个，图片 %d 个（缺 alt %d 个）' % (nh, nimg, nmissing))

    if probs:
        print('\n检查未通过：')
        for rule, msg in probs:
            print('  [%s] %s' % (rule, msg))
    else:
        print('  检查通过（标题层级 / alt / 表格语义）')

    if do_check:
        return 1 if probs else 0

    if not out_path:
        print('\n（未指定 -o，只做检查）')
        return 1 if probs else 0

    with open(TOKENS_CSS, encoding='utf-8') as f:
        tokens = f.read()
    with open(CONTENT_CSS, encoding='utf-8') as f:
        content = f.read()

    page = SHELL.format(
        title=title or os.path.splitext(os.path.basename(src_path))[0],
        tokens=tokens,
        content=content,
        body=html,
    )
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(page)

    kb = os.path.getsize(out_path) / 1024
    print('\n已写出 %s（%.1f KB）' % (out_path, kb))
    if kb > 100:
        print('  ⚠️ 超过精简档 的 100 KB 硬约束')
    if probs:
        print('  ⚠️ 检查未通过，仍写出了文件 —— 请先修上面的问题')
    return 1 if probs else 0


if __name__ == '__main__':
    sys.exit(main())
