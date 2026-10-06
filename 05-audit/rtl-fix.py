#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rtl-fix.py — 把物理方向属性批量改成逻辑属性（ I6）

===========================================================================
为什么需要：
---------------------------------------------------------------------------
  实测：物理属性 57 处，逻辑属性仅 6 处 ⇒ RTL 几乎完全没考虑。
  而物理属性在 `dir="rtl"` 下**不会自动翻转** ——
  阿拉伯语用户看到的就是"错位"的界面。

===========================================================================
改写规则（不是无脑替换，要看语义）
---------------------------------------------------------------------------
  `margin-left`  → `margin-inline-start`
  `margin-right` → `margin-inline-end`
  `padding-left` → `padding-inline-start`
  `padding-right`→ `padding-inline-end`
  `left`         → `inset-inline-start`
  `right`        → `inset-inline-end`
  `text-align: left`  → `text-align: start`
  `text-align: right` → `text-align: end`

  ⭐ 例外：**绝对定位**的 `left`/`right` 在组件里常常是
     "箭头贴在某一边"的意思，改成 `inset-inline-*` 后语义更对
     （跟随书写方向），所以**照改**。
     但如果它同时配了 `transform` 做居中，改动会影响居中基准
     ⇒ 改完必须跑视觉回归（check-all 会自动跑）。
===========================================================================
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 顺序要紧：先改长属性名，避免 `left` 把 `margin-left` 里的 `left` 也吃掉
RULES = [
    (re.compile(r'\bmargin-left\s*:'),  'margin-inline-start:'),
    (re.compile(r'\bmargin-right\s*:'), 'margin-inline-end:'),
    (re.compile(r'\bpadding-left\s*:'), 'padding-inline-start:'),
    (re.compile(r'\bpadding-right\s*:'),'padding-inline-end:'),
    (re.compile(r'\bleft\s*:'),         'inset-inline-start:'),
    (re.compile(r'\bright\s*:'),        'inset-inline-end:'),
    (re.compile(r'text-align\s*:\s*left\b'),  'text-align: start'),
    (re.compile(r'text-align\s*:\s*right\b'), 'text-align: end'),
]

DIRS = ('01-tokens', '02-primitives', '03-patterns', '04-recipes', '09-assets')


def main():
    n = 0
    for d in DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for sub in sorted(os.listdir(base)):
            subp = os.path.join(base, sub)
            if not os.path.isdir(subp):
                continue
            for cand in (os.path.join(subp, sub + '.css'),
                         os.path.join(subp, 'tierA-tokens.css')):
                if not os.path.isfile(cand):
                    continue
                try:
                    t = io.open(cand, encoding='utf-8').read()
                except Exception:
                    continue
                # 剥注释后再改，避免动到注释里的示例
                parts = re.split(r'(/\*.*?\*/)', t, flags=re.S)
                changed = False
                for i, seg in enumerate(parts):
                    if i % 2 == 1:      # 注释块
                        continue
                    orig = seg
                    for pat, rep in RULES:
                        seg = pat.sub(rep, seg)
                    if seg != orig:
                        changed = True
                    parts[i] = seg
                if changed:
                    io.open(cand, 'w', encoding='utf-8', newline='').write(''.join(parts))
                    print('  ✓ ' + os.path.relpath(cand, ROOT).replace(os.sep, '/'))
                    n += 1
    print('  改了 %d 个文件' % n)


if __name__ == '__main__':
    main()
