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
对每个**精简档 自包含页**（`04-recipes/longform/*.html`）:
1. 文件大小 ≤ 100 KB
2. **零外部请求**：没有 `src`/`href` 指向 `http(s)://`
3. 零外链样式：没有 `<link rel=stylesheet>`、没有 `@import`
4. 零外链脚本：没有 `<script src=...>`
5. 零 `:has()`（CSS Level 4，老 WebView 不认）

🔴 **范围收窄到 longform/（0.8.9 修）**
   原来扫的是 `04-recipes/**`，把 analysis-report / data-showcase / report /
   table 的 **demo 页**也算成精简档，于是报出 4 处「外链样式 / 外链脚本」。
   ⇒ 那是**判据错，不是产品错**：
     · 精简档的定义是「能单独拷走用的自包含单文件」，本库只有 longform 是
       （其 README 明写「精简档硬约束」）；
     · 其余几个是**开发演示页**，它们按设计就该 `<link>` 库里的组件 CSS，
       否则改了库 CSS 还要同步改 demo，开发效率全丢。
   ⇒ 门禁只查真正承诺了"零外链"的那几个页面。
   ⭐ 与 hardcode-gate 已有的"精简档必须内联色板、demo 不算组件"同思路：
     **豁免规则要按页面承诺写，不能一刀切。**

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
    # 🔴 参数约定（0.8.9 · 外部审计 P0-1）：`--` 开头的当 flag，不当路径。
    # 🔴 事故：check-all.sh 传 `--dir <目录列表>`，旧写法把 argv[1]
    #   （字面量 "--dir"）当 root ⇒ root=<cwd>/--dir 不存在
    #   ⇒ glob 到 0 个文件 ⇒ 走进「没有精简档页面可查」⇒ return 0 ⇒ 判 PASS。
    #
    # ⭐ 本脚本扫的目录**固定是 04-recipes**（精简档按定义就在那儿），
    #   所以 root 恒为库根；位置参数只用来判断调用方是否真的想扫这一块。
    # 🔴 曾经试过"root = 第一个位置参数"，结果 root 变成 01-tokens
    #   ⇒ 去 01-tokens 下面找 04-recipes ⇒ 同样扫 0 个文件 ⇒ 同样假绿。
    raw = [a for a in sys.argv[1:] if not a.startswith('-')]
    args = [a for a in raw if os.path.isdir(a)]
    # 🔴 传了路径但一个都不存在 ⇒ 明确报红。
    #   不能静默当成"没传参数"：那会让「传错路径」和「全量检查」长得一样，
    #   而前者是调用方的错、后者是本意 —— 混起来就又是一次假绿。
    if raw and not args:
        print('❌ 传入的路径都不存在：%s' % raw)
        print('   这是**假绿**：不是"精简档合规"，是"什么都没检查"。')
        return 1
    # 传了目录列表但其中不含 04-recipes ⇒ 本脚本没有别的范围可扫 ⇒ 明确报红
    if args and not any(a.rstrip('/').endswith('04-recipes') for a in args):
        print('❌ 传入的目录里没有 04-recipes：%s' % args)
        print('   本门禁只检查「精简档 自包含页」，它们按定义位于 04-recipes/longform/。')
        print('   （若只想全量检查，直接不带参数运行即可）')
        return 1

    files = sorted(glob.glob(os.path.join(ROOT, '04-recipes', 'longform',
                                          '*.html'), recursive=True))
    # 🔴 零文件守卫：扫到 0 个文件时**必须判红**。
    #   原来这里直接 return 0 并说"没有精简档页面可查"——
    #   但"扫不到"和"确实没有"是两回事，前者是路径传错了。
    #   而「一个什么都没检查却报告通过的门禁，比没有门禁更危险」。
    if not files:
        print('❌ 一个精简档页面都没扫到（root=%s）' % ROOT)
        print('   这是**假绿**：不是"精简档合规"，是"什么都没检查"。')
        print('   本门禁不接受空扫描。')
        return 1
    print('（扫了 %d 个精简档页面）' % len(files))
    bad = 0
    for f in files:
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
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
        rel = os.path.relpath(f, ROOT).replace(os.sep, '/')
        print('  %-40s %.1f KB' % (rel, os.path.getsize(f) / 1024.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
