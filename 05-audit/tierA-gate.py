#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
tierA-gate.py — 精简档 单文件的硬约束

背景
------------------
精简档（Tier A）的硬约束：

| 体积 | 单文件总计 ≤ 100 KB |
| 交付 | 复制粘贴，不是引用 |
| 网络 | 零外部请求 |

🔴 但这三条**零门禁在守** ——
所以 `longform.html` 从 17.1 KB 涨到 24.8 KB（加了暗色块），
而 README 与页面里仍然写着"17.1 KB"。

⇒ 约束存在但没人管，等于没有。本门禁把它收口。

判据
----
对每个**精简档 自包含页**（`04-recipes/**` 下的 `*.html`）：
1. 文件大小 ≤ 100 KB
2. **零外部请求**：没有 `src`/`href` 指向 `http(s)://`
3. 零外链样式：没有 `<link rel=stylesheet>`、没有 `@import`
4. 零外链脚本：没有 `<script src=...>`
5. 零 `:has()`（CSS Level 4，老 WebView 不认）

用法：python 05-audit/tierA-gate.py
"""
import sys
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_KB = 100

RULES = [
    # 🔴 只查**资源加载**，不查 `<a href>` ——
    #    正文里的参考链接（如 CommonMark 规范）不算"外部请求"：
    #    那是**用户主动点**才发生的，不是页面加载时自己去拉资源。
    #    第一版把两者混在一起，对 content.html 报了假警。
    ('外链资源', re.compile(
        r'<(?:img|iframe|source|video|audio|embed|object)\b[^>]*\bsrc\s*=\s*["\']https?://',
        re.I)),
    ('外链样式/脚本', re.compile(
        r'<(?:link|script)\b[^>]*(?:href|src)\s*=\s*["\']https?://', re.I)),
    ('外链样式', re.compile(r'<link[^>]*rel\s*=\s*["\']?stylesheet', re.I)),
    ('@import', re.compile(r'@import')),
    ('外链脚本', re.compile(r'<script[^>]*\bsrc\s*=', re.I)),
    (':has()', re.compile(r':has\(')),
]


def strip_comments(src):
    return re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'),
                  src, flags=re.S)


def main():
    root = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else ROOT
    files = sorted(glob.glob(os.path.join(root, '04-recipes', '**', '*.html'),
                             recursive=True))
    if not files:
        print('没有精简档 页面可查。')
        return 0
    bad = 0
    for f in files:
        rel = os.path.relpath(f, root).replace('\\', '/')
        size_kb = os.path.getsize(f) / 1024.0
        probs = []
        if size_kb > MAX_KB:
            probs.append('体积 %.1f KB > 上限 %d KB' % (size_kb, MAX_KB))
        src = strip_comments(open(f, encoding='utf-8', errors='replace').read())
        for name, pat in RULES:
            m = pat.search(src)
            if m:
                i = src[:m.start()].count('\n') + 1
                probs.append('%s（L%d）' % (name, i))
        mark = 'OK  ' if not probs else 'FAIL'
        print('  [%s] %-40s %6.1f KB  %s'
              % (mark, rel, size_kb, '；'.join(probs) if probs else '零外链 · 零 :has()'))
        if probs:
            bad += 1
    print('')
    if bad:
        print('%d 个精简档 页面违反硬约束。' % bad)
        return 1
    print('精简档 硬约束：%d 个页面全部通过。' % len(files))
    # 把实测大小打出来 —— 文档里写的就是这个数，
    # 发现不一致时（比如刚加了暗色块）能立刻发现该更新文档。
    print('')
    print('当前实测大小（文档里应与这里一致）：')
    for f in files:
        rel = os.path.relpath(f, root).replace(os.sep, '/')
        print('  %-40s %.1f KB' % (rel, os.path.getsize(f) / 1024.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
