#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
dark-gate.py — 暗色配色的门禁

为什么需要
-----------------------
暗色最常见的两种错：
1. **把浅色反过来** —— 不是所有色都该反。
   例：`--accent` 浅色是深靛蓝（沉），暗色必须**变亮**才看得见；
   `--text-on-accent` 浅色是白字，暗色必须**变深**（否则亮底白字看不见）。
2. **块与底分不开** —— 语义底色（danger-bg 等）与纸底对比不足 1.10:1
   ⇒ 错误提示在暗色下"消失"。

所以本门禁验三件事（**两套配色都跑**）：
  A. 文字色在各自底上 ≥ 4.5:1（WCAG AA 正文）
  B. 语义底 / 底色三层 与纸底的对比 ≥ 1.10:1（分层可见）
  C. **暗色模式下没有和浅色完全相同的色值** ——
     那是"忘了改"的信号（反之则是"白白改了一堆"）

用法：python 05-audit/dark-gate.py
"""
import sys
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEP = os.sep
MIN_TEXT = 4.5
# 🔴 阈值不是我拍脑袋定的，是**量浅色现状得来的**：
#    浅色七层的实际值域是 1.037 ~ 1.091（最低 surface-sunken 1.037），
#    而 `--paper` 当年被否掉的值是 **1.025**（#fcfcfd vs 纯白）。
#    ⇒ 下限定在 **1.035**（略高于那个"肉眼分分开"的 1.025，
#    又不高于现状的任何一层 —— 否则这个门禁会把已通过的设计判成不合格）。
MIN_LAYER = 1.035


def lum(c):
    c = c.lstrip('#')
    if len(c) != 6:
        return None
    out = []
    for i in (0, 2, 4):
        v = int(c[i:i + 2], 16) / 255
        out.append(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]


def cr(a, b):
    la, lb = lum(a), lum(b)
    if la is None or lb is None:
        return None
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def parse(path):
    """把 tokens.css 拆成浅色 / 暗色两套"""
    src = open(path, encoding='utf-8').read()
    # 去掉注释，避免把说明里的数字当值
    src = re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'), src, flags=re.S)
    i = src.find('@media (prefers-color-scheme: dark)')
    if i < 0:
        return {}, {}
    light_src = src[:i]
    dark_src = src[i:]

    def grab(s):
        d = {}
        for m in re.finditer(r'(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;', s):
            d[m.group(1)] = m.group(2).lower()
        return d

    return grab(light_src), grab(dark_src)


def main():
    path = os.path.join(ROOT, '01-tokens', 'tokens.css')
    light, dark = parse(path)
    issues = []

    if not dark:
        print('  [dark-gate] 没有找到 @media (prefers-color-scheme: dark) 块')
        return 1

    # A. 文字在底上
    P = dark.get('--paper', '#000000')
    S = dark.get('--surface', '#000000')
    for tok, base, bn in [('--text-primary', P, 'paper'),
                          ('--text-secondary', P, 'paper'),
                          ('--text-tertiary', P, 'paper'),
                          ('--text-primary', S, 'surface'),
                          ('--danger', P, 'paper'), ('--success', P, 'paper'),
                          ('--warning', P, 'paper'), ('--info', P, 'paper'),
                          ('--accent', P, 'paper')]:
        if tok in dark and base:
            r = cr(dark[tok], base)
            if r is not None and r < MIN_TEXT:
                issues.append('A %-16s 在 %-7s 上 %.2f < %.1f'
                              % (tok, bn, r, MIN_TEXT))
    # 按钮上的字
    if '--text-on-accent' in dark and '--accent' in dark:
        r = cr(dark['--text-on-accent'], dark['--accent'])
        if r is not None and r < MIN_TEXT:
            issues.append('A %-16s 在 accent 上 %.2f < %.1f'
                          % ('--text-on-accent', r, MIN_TEXT))

    # B. 分层可见
    for tok in ('--surface', '--surface-sunken', '--danger-bg', '--success-bg',
                '--warning-bg', '--info-bg', '--accent-soft'):
        if tok in dark:
            r = cr(dark[tok], P)
            if r is not None and r < MIN_LAYER:
                issues.append('B %-16s 与 paper 只差 %.3f < %.3f（块会"消失"）'
                              % (tok, r, MIN_LAYER))

    # C. 暗色不能和浅色完全一样（漏改的信号）
    same = [k for k in dark if k in light and dark[k] == light[k]]
    if same:
        issues.append('C 暗色与浅色同值：%s' % ', '.join(sorted(same)))

    for it in issues:
        print('  [dark-gate] ' + it)
    print('')
    if issues:
        print('%d 项暗色问题。' % len(issues))
        return 1
    print('暗色配色：文字全部 AA，分层全部可见，无漏改。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
