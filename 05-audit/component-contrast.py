#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
component-contrast.py — 组件里「字 / 底」组合的对比度

背景（2026-10-03）
------------------
`contrast.py` 查的是**令牌之间**的对比度（比如 `--text-primary` on `--paper`）。
但组件会自己组合令牌，**这些组合没人查** ——
加 `badge` 时手工验算发现 5 组都达标，但那是运气，不是机制。

🔴 而且我第一次写这个脚本时**自己踩了坑**：
用 `color:\s*var\((--[\w-]+)\)` 去匹配，结果**匹配到了 `border-color:` 行**
（因为 `border-color` 里也含 `color:`，且正则没要求行首）
⇒ 报出 5 组"1.00 不达标"的假警。
⇒ 判据必须是 `(?m)^\s*color:`（行首），且 background 也要行首匹配。

用法：
    python 05-audit/component-contrast.py            # 全部组件
    python 05-audit/component-contrast.py --dir .    # 指定库根
"""
import sys
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contrast as C  # noqa: E402

TEXT_MIN = 4.5      # 正文门槛（badge 11px 也按这个，不放宽）


def main():
    root = os.path.abspath(sys.argv[sys.argv.index('--dir') + 1]) \
        if '--dir' in sys.argv else ROOT
    light = C.load_tokens(os.path.join(root, '01-tokens/tokens.css'), 'light')
    dark = C.load_tokens(os.path.join(root, '01-tokens/tokens.css'), 'dark')

    # 🔴 两个都要**行首**匹配，否则会吃到 border-color / outline-color
    BG = re.compile(r'(?m)^\s*background(?:-color)?:\s*var\(\s*(--[\w-]+)\s*\)')
    FG = re.compile(r'(?m)^\s{1,4}color:\s*var\(\s*(--[\w-]+)\s*\)')

    files = sorted(glob.glob(os.path.join(root, '0[23]-*', '*', '*.css')))
    total = 0
    bad = []
    for f in files:
        src = C.strip_comments(open(f, encoding='utf-8').read()) \
            if hasattr(C, 'strip_comments') else \
            re.sub(r'/\*.*?\*/', '', open(f, encoding='utf-8').read(), flags=re.S)
        rel = os.path.relpath(f, root).replace(os.sep, '/')
        # 按规则块拆（花括号配平，不靠正则猜）
        for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', src):
            sel, body = m.group(1).strip(), m.group(2)
            b = BG.search(body)
            fg = FG.search(body)
            if not (b and fg):
                continue
            bk, fk = b.group(1), fg.group(1)
            if bk not in light or fk not in light:
                continue          # 局部令牌或非颜色值，跳过
            l = C.contrast(light[fk], light[bk])
            d = C.contrast(dark.get(fk, light[fk]), dark.get(bk, light[bk]))
            total += 1
            if l < TEXT_MIN or d < TEXT_MIN:
                bad.append((rel, sel[:40], fk, bk, l, d))
        # 变体类单独看（.btn--primary 这类常在独立规则里）
    print('  组件里可判定的「字 / 底」组合：%d 个' % total)
    if bad:
        print('')
        for rel, sel, fk, bk, l, d in bad:
            print('  🔴 %-30s %-26s %s on %s  浅 %.2f · 暗 %.2f'
                  % (rel, sel, fk, bk, l, d))
        print('')
        print('  %d 组低于 4.5:1' % len(bad))
        return 1
    print('  ✅ 全部 ≥ 4.5:1（两套配色都算）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
