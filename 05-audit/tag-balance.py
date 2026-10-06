#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
tag-balance.py — HTML 标签是否配平

为什么需要这一条（2026-10-03 的实际收获）
--------------------------------------------
给 10 个页面补 `<main>` 地标时，**脚本两次失配**：

1. 第一次用"数 `<div`/`</div>` 找配对"，遇到第一个 `</div>` 就闭合
   —— 但那是 `.lede` 的闭合，不是 `.wrap` 的。
2. 第二次用标签栈，仍失配 —— 因为 **`<script>var x = 1 < 2;</script>`
   里的 `<` 被当成标签开始**，匹配出假的 `</script>`。

第二次失配顺着查下去，发现了**真实的 HTML 错误**：
`index.html` 里有 `<pre><code>...</pre>` —— **`<code>` 没闭合**。

🔴 **为什么 axe 没报**：
axe 关注无障碍（ARIA/对比度/角色），**不校验标签是否闭合** ——
未闭合的 `<code>` 在浏览器里会被自动纠正，页面"看起来正常"，
所以静态门禁（类名检查）与 axe **都抓不到它**。只有标签平衡能。

用法：python 05-audit/tag-balance.py
"""
import sys
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr'}
TAG = re.compile(r'<(/?)([a-zA-Z][\w-]*)([^>]*?)(/?)>')


def blank_inner(text, tagname):
    pat = re.compile(r'(<' + tagname + r'\b[^>]*>).*?(</' + tagname + r'>)',
                     re.S | re.I)
    return pat.sub(lambda m: m.group(1) + m.group(2), text)


def check(path):
    src = open(path, encoding='utf-8', errors='replace').read()
    body = src
    body = blank_inner(body, 'script')
    body = blank_inner(body, 'style')
    body = re.sub(r'<!--.*?-->', '', body, flags=re.S)
    # ⚠️ 2026-10-03 已知**假报**：源码里写 `<table><tr>`（不写 tbody）时，
    #    浏览器会自动补一个 tbody，于是 DOM 里是配平的。
    #    只看源码的标签栈会误报"table 没闭合"。
    #    浏览器实测 index.html / card 的 demo，body 都只有 1 个子元素
    #    —— **页面是对的，这个检查器是错的**。
    #    我试过在检查器里模拟浏览器补 tbody，**自己写错了**（更糟）。
    #    ⇒ 决定：不修这个检查器，**权威判据是浏览器**（axe + DOM 结构）。
    #    本门禁只当"明显破损"的粗筛。
    stack = []
    for i, m in enumerate(TAG.finditer(body)):
        closing, tag, selfclose = m.group(1), m.group(2).lower(), m.group(4)
        if tag in VOID or selfclose or tag == '!doctype':
            continue
        line = body[:m.start()].count('\n') + 1
        if closing:
            if not stack:
                return [('多余的 </%s>' % tag, line)]
            top, tline = stack.pop()
            if top != tag:
                return [('期望 </%s>（开在 L%d），实际 </%s>'
                         % (top, tline, tag), line)]
        else:
            stack.append((tag, line))
    if stack:
        return [('<%s> 没有闭合' % t, ln) for t, ln in stack]
    return []


def main():
    root = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else ROOT
    files = sorted(glob.glob(os.path.join(root, '0*', '**', '*.html'), recursive=True))
    files += [os.path.join(root, 'index.html')]
    bad = 0
    for f in files:
        if not os.path.isfile(f):
            continue
        errs = check(f)
        rel = os.path.relpath(f, root).replace(os.sep, '/')
        if errs:
            bad += 1
            print('  [FAIL] %-44s %s' % (rel, errs[0][0]))
        else:
            print('  [OK  ] %-44s 标签配平' % rel)
    print('')
    if bad:
        print('%d 个文件标签不配平 —— 浏览器会自动纠正，但那是"静默失效"。' % bad)
        return 1
    print('标签平衡：%d 个文件全部配平。' % len(files))
    return 0


if __name__ == '__main__':
    sys.exit(main())
