#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
measure-gate.py — 检查行长（measure）是否用了语言感知的令牌

背景（2026-10-03，Owner 提问触发）
-----------------------------------
中文排版用 `em` 限宽看起来"完美"，**但那是巧合**：1em = 1 个汉字宽。
换到英文，同样的 `max-width: 20em` 只有 640px ≈ 20 字符 ——
实测 84 字符的英文标题会折成 4 行。

`ch` 也不对：ch = "0" 的宽度，**1 汉字 ≈ 2ch**，13ch 只能放 6 个汉字。

⇒ 没有任何单一单位能同时伺候所有语言。
⇒ 本库的做法：组件用 `var(--measure-*)`，令牌按 `:lang()` 切换单位。

判据
----
标题 / 导语 / 正文 / 引言 / 边注 这几类**行宽元素**，
必须用 `var(--measure-*)`，不许写死 em / ch。

**豁免**：页面骨架容器（`.wrap` / `.article` / `main`）用 ch/em 是**正确的** ——
它要随用户字号缩放，不是行长控制。这类靠选择器白名单排除。

用法：python 05-audit/measure-gate.py
"""
import sys
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 行宽元素的选择器关键词（命中即要求用令牌）
MEASURE_KEYS = re.compile(
    r'(^|[\s,>+~])(h1|h2|\.standfirst|\.lead|\.lede|\.pull|\.aside|'
    r'\.article__title|\.article__standfirst|\.prose|main|p)(\s|,|{)')

# 豁免：这些是**页面骨架容器**，不是行长
SKELETON = re.compile(r'^\s*\.(wrap|article|shell|container)\b|^\s*body\s*\{')


def check(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        src = f.read()
    src = re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'), src, flags=re.S)
    bad = []
    for m in re.finditer(r'([^{}]+)\{([^}]*)\}', src):
        sel = m.group(1).strip()
        body = m.group(2)
        mw = re.search(r'max-width:\s*(\d+)(em|ch)\b', body)
        if not mw:
            continue
        if SKELETON.match(sel):
            continue
        if not MEASURE_KEYS.search(sel + ' '):
            continue
        v, unit = int(mw.group(1)), mw.group(2)
        bad.append((sel.replace('\n', ' ')[:44], v, unit))
    return bad


def main():
    # 🔴 2026-10-03 修一个致命缺陷：原来写死扫 `0*`，
    #    传别的目录当参数时**一个文件都扫不到** ⇒ 门禁永远"全绿"。
    #    这正是"反向控制失败却没发现"的根源。
    root = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else ROOT
    files = sorted(glob.glob(os.path.join(root, '**', '*.html'), recursive=True))
    total = 0
    for p in files:
        if '/05-audit' in p.replace(os.sep, '/'):
            continue
        bad = check(p)
        if not bad:
            continue
        rel = os.path.relpath(p, root).replace(os.sep, '/')
        for sel, v, unit in bad:
            total += 1
            print('  [measure-gate] %-42s %-44s %d%s' % (rel, sel, v, unit))
    print('')
    if total:
        print('%d 处行宽写死了单位 —— 换语言会排版失衡' % total)
        print('  改用 var(--measure-title) / --measure-lede / --measure-prose / --measure-pull')
        return 1
    print('行宽全部使用语言感知令牌。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
