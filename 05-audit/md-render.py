#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
md-render.py — 内容渲染管线（Markdown → 自包含 HTML）

MANUAL-ONLY: 人工辅助工具。`03-patterns/content/README.md` 把它作为用法示例
写给使用者（"把 md 渲染成可读 HTML"），它不是流水线的一环，也不该是。

这是「云编辑器」能力的可复现版本：给它一份 .md，产出精简档 的单文件 HTML。
**中间没有任何手写环节** —— 这正是它存在的意义：
证明我们不发明标准之外的结构。

依据：本文件顶部列出的渲染约定

用法：
    python md-render.py <input.md> [-o out.html] [--title "标题"] [--check]
    python md-render.py <input.md> --check     # 只跑检查，不输出
    python md-render.py --selftest             # 反向控制：四条判据各自会不会红

渲染器：markdown-it（commonmark preset + table + strikethrough）
  · 核心语法 = CommonMark（事实标准）
  · 表格 / 删除线 = GFM 扩展（CommonMark 核心没有表格）
  · 与 GitHub 的差异：markdown-it 的删除线输出 <s>，GFM 规定 <del> ⇒ CSS 两者都支持

检查项（--check）：
  1. 标题层级不跳级（h1 → h3 = 跳级）
  2. <img> 必须有 alt（WCAG 1.1.1）
  3. 恰好一个 <h1>
  4. 表格语义：<table> 之外的**三种已知模拟形态**会被指名 ——
     (a) 表格子元素（tr/td/th/thead/tbody/tfoot/caption）出现在 <table> 外
     (b) 非原生表格标签上挂了 role=table/grid/row/cell 这类角色
     (c) 非 <table> 元素的 class token 里出现独立的 `table` 词（启发式）

退出码：0 = 干净；1 = 检查失败；2 = 用法错误

🔴 第 4 条原来只写了「表格必须是 <table>（不能是 div 模拟的）」，
   而实现只有一句 `<div[^"]*class="[^"]*table` —— 措辞比判据宽：
   用 `<div class="grid"><div class="row"><div class="cell">` 画的表格
   一个都不会被抓到。现在把措辞收窄到"三种已知形态"，并给每条配夹具。
⚠️ 仍有的边界（不写清就等于假绿）：**"这是不是一个表格"本身不可判定**。
   上面 (c) 是启发式，用 `class="r1 c2"` 画的表它发现不了。
   本工具的定位是渲染管线，不是表格检测器 —— 判据只覆盖自己写清楚的三种形态。
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
# 表格语义的三条判据。写成常量是为了能被自检**逐条关掉** ——
# 「关掉它，夹具必须变绿」才证明这条判据真的有牙，而不是别的判据顺手抓到了。
RULE_ORPHAN = 'orphan-cells'
RULE_ARIA = 'aria'
RULE_CLASS = 'class'
TABLE_RULES = (RULE_ORPHAN, RULE_ARIA, RULE_CLASS)

# 原生表格标签：它们出现在 <table> 外才是问题（见 RULE_ORPHAN）
TABLE_PARTS = ('caption', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th')
# ARIA 里"表格"这一族角色：挂在非原生标签上 = 用 role 模拟表格
ARIA_TABLE_ROLES = ('table', 'grid', 'treegrid', 'rowgroup', 'row',
                    'columnheader', 'rowheader', 'cell', 'gridcell')
NATIVE_TABLE_TAGS = ('table',) + TABLE_PARTS + ('colgroup', 'col')
# class token 里的"独立词 table"：`table` / `table-wrap` / `data-table` 算，
# `tablesorter` / `mytable` 不算（避免把第三方类名当表格）
RE_TABLE_CLASS = re.compile(r'(?:^|[-_])table(?:$|[-_])', re.I)


class Check(HTMLParser):
    def __init__(self, rules=TABLE_RULES):
        HTMLParser.__init__(self, convert_charrefs=True)
        self.headings = []
        self.imgs_total = 0
        self.imgs_no_alt = []
        self.h1_count = 0
        self.table_probs = []
        self.rules = tuple(rules)
        self._in_table = 0

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v if v is not None else '') for k, v in attrs}
        line = self.getpos()[0]
        if re.fullmatch(r'h[1-6]', tag):
            lvl = int(tag[1])
            self.headings.append((lvl, line))
            if lvl == 1:
                self.h1_count += 1
        elif tag == 'img':
            # 🔴 这里原来只统计"缺 alt 的"，然后当成"图片总数"打印 ——
            #    标签与数据不符，害我以为图片没渲染出来。图片总数要单独记。
            self.imgs_total += 1
            if 'alt' not in a:
                self.imgs_no_alt.append((line, a.get('src', '?')[:40]))

        # ---- 表格语义 ----
        if tag == 'table':
            self._in_table += 1
            return
        if (RULE_ORPHAN in self.rules and tag in TABLE_PARTS
                and self._in_table == 0):
            self.table_probs.append(
                ('TABLE', '第 %d 行 <%s> 出现在 <table> 之外 ⇒ 行列关系无处可依'
                 % (line, tag)))
        if (RULE_ARIA in self.rules and tag not in NATIVE_TABLE_TAGS
                and a.get('role', '').strip().lower() in ARIA_TABLE_ROLES):
            self.table_probs.append(
                ('TABLE', '第 %d 行 <%s role="%s"> 用 ARIA 角色模拟表格 '
                 '⇒ 该用原生 <table>'
                 % (line, tag, a.get('role', ''))))
        if (RULE_CLASS in self.rules and tag not in NATIVE_TABLE_TAGS
                and any(RE_TABLE_CLASS.search(t)
                        for t in (a.get('class') or '').split())):
            self.table_probs.append(
                ('TABLE', '第 %d 行 <%s class="%s"> 疑似用 div 模拟表格 '
                 '⇒ 辅助技术读不出行列关系'
                 % (line, tag, a.get('class', ''))))

    def handle_endtag(self, tag):
        if tag == 'table' and self._in_table:
            self._in_table -= 1


def check(html: str, rules=TABLE_RULES):
    c = Check(rules=rules)
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

    probs.extend(c.table_probs)
    return probs, len(c.headings), c.imgs_total, len(c.imgs_no_alt)


# ------------------------------------------------------------------ 自检
def selftest():
    """证明四条判据各自会红，而且**不误报**。"""
    print('  === md-render 反向控制 ===')
    fails = []

    def probs(html, rules=TABLE_RULES):
        return [m for _k, m in check(html, rules)[0]]

    def expect(why, html, needle, rules=TABLE_RULES):
        got = probs(html, rules)
        if any(needle in m for m in got):
            print('  [OK]   ' + why)
        else:
            fails.append(why)
            print('  [FAIL] ' + why)
            print('         got=' + repr(got))

    def expect_green(why, html, rules=TABLE_RULES):
        """不该红的时候不许红 —— 一道永远红的判据也能"抓到问题"。"""
        got = probs(html, rules)
        if not got:
            print('  [OK]   ' + why)
        else:
            fails.append(why)
            print('  [FAIL] ' + why)
            print('         got=' + repr(got))

    # ---- 正向：真表格与空白都不许红 ----
    expect_green('真 Markdown 表格渲染成 <table> ⇒ 不报',
                 '<h1>t</h1><table><thead><tr><th>a</th></tr></thead>'
                 '<tbody><tr><td>1</td></tr></tbody></table>')
    expect_green('普通 div 的 class 里没有 table 词 ⇒ 不报',
                 '<h1>t</h1><div class="grid"><div class="row">x</div></div>')
    expect_green('tablesorter / mytable 不算"独立词 table" ⇒ 不报',
                 '<h1>t</h1><div class="tablesorter mytable">x</div>')

    # ---- (a) 表格子元素跑出 <table> ----
    expect('(a) <tr> 在 <table> 外 ⇒ 报',
           '<h1>t</h1><div><tr><td>1</td></tr></div>', '行列关系')
    expect_green('(a) 元反向：关掉这条规则，同一夹具必须变绿',
                 '<h1>t</h1><div><tr><td>1</td></tr></div>',
                 (RULE_ARIA, RULE_CLASS))

    # ---- (b) ARIA 角色模拟 ----
    expect('(b) <div role="table"> ⇒ 报',
           '<h1>t</h1><div role="table"><div role="row">x</div></div>',
           'ARIA 角色')
    expect_green('(b) 元反向：关掉这条规则，同一夹具必须变绿',
                 '<h1>t</h1><div role="table"><div role="row">x</div></div>',
                 (RULE_ORPHAN, RULE_CLASS))

    # ---- (c) class 模拟 ----
    expect('(c) <div class="table"> ⇒ 报',
           '<h1>t</h1><div class="table"><div class="table-row">x</div></div>',
           '模拟表格')
    expect_green('(c) 元反向：关掉这条规则，同一夹具必须变绿',
                 '<h1>t</h1><div class="table"><div class="table-row">x</div></div>',
                 (RULE_ORPHAN, RULE_ARIA))

    # ---- 边界：承认抓不到的形态（写出来，免得以后被当成全覆盖）----
    expect_green('边界：class="r1 c2" 画的表现阶段抓不到（已知不可判定）',
                 '<h1>t</h1><div class="r1"><span class="c2">1</span></div>')

    # ---- 另外三条判据的最小夹具 ----
    expect('标题跳级 ⇒ 报', '<h1>t</h1><h3>x</h3>', '跳到')
    expect('缺 alt ⇒ 报', '<h1>t</h1><img src="a.png">', 'WCAG')
    expect('两个 h1 ⇒ 报', '<h1>a</h1><h1>b</h1>', '应为 1')

    if fails:
        print('  ❌ 有 %d 条反向控制没通过' % len(fails))
    else:
        print('  ✅ 反向控制全绿')
    return 1 if fails else 0


# ------------------------------------------------------------------ main
def main():
    if '--selftest' in sys.argv:
        return selftest()
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
        print('  检查通过（标题层级 / alt / 表格语义：三种已知形态）')

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
