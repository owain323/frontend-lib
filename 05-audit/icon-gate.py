#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
icon-gate.py — 图标规格检查

背景（2026-10-03）
------------------
Owner 指出「动物森友会有素材库，我们一个都没有……没有这种资产之后干活很累」。
建了 `09-assets/`，图标必须满足：

| 要求 | 原因 |
|---|---|
| `viewBox="0 0 24 24"` | 与 Lucide 一致，混用不出接缝 |
| `width="1em" height="1em"` | **跟随字号** —— 写死 px 会出现"大图标过细、小图标过粗" |
| `fill="none"` | 线性风格；不设会被某些 UA 填成黑块 |
| `stroke="currentColor"` | **颜色随文字走**，暗色模式自动跟随，不需要两份图 |
| `stroke-width="2"` | 与 Lucide 同粗细，混用才匀 |
| `stroke-linecap/linejoin="round"` | 端点圆润，与库的整体气质一致 |
| `role="img"` + `aria-label` | 装饰性图标才该 `aria-hidden`；有语义的必须有名字 |
| **禁硬编码颜色** | `#fff` 之类会破坏暗色模式与 currentColor |

**查不出、必须人眼看的是"语义清不清晰"** ——
本门禁只能保证"它是对的、它能用"，保证不了"它画得好"。

用法：python 05-audit/icon-gate.py
"""
import sys
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 🔴 2026-10-03 踩过的坑：`Q = r'''["']'''` 看起来是"匹配单双引号"，
#    但把它拼进 `[^' + Q + ']+`（= `[^["']]+`）后，字符类里**同时含两种引号**，
#    于是排除集把所有引号都排掉了 —— 字符串被切成两段，`aria-label="门禁"` 匹配不上。
#    教训：拼正则片段时，字符类的内容要和上下文一起想，不能只看单块。
DQ = chr(34)   # "
SQ = chr(39)   # '
Q = '[' + DQ + SQ + ']'
NOTQ = '[^' + DQ + SQ + ']'
RULES = {
    'viewBox 24x24': r'viewBox\s*=\s*' + Q + r'0 0 24 24' + Q,
    'width=1em': r'width\s*=\s*' + Q + r'1em' + Q,
    'height=1em': r'height\s*=\s*' + Q + r'1em' + Q,
    'fill=none': r'fill\s*=\s*' + Q + r'none' + Q,
    'stroke=currentColor': r'stroke\s*=\s*' + Q + r'currentColor' + Q,
    'stroke-width=2': r'stroke-width\s*=\s*' + Q + r'2' + Q,
    'linecap=round': r'stroke-linecap\s*=\s*' + Q + r'round' + Q,
    'linejoin=round': r'stroke-linejoin\s*=\s*' + Q + r'round' + Q,
    'role=img': r'role\s*=\s*' + Q + r'img' + Q,
    'aria-label': r'aria-label\s*=\s*' + Q + NOTQ + '+' + Q,
}
HARD_COLOR = re.compile(r'(?:fill|stroke)\s*[=:]\s*["\']?#', re.I)
SHAPES = re.compile(r'<(?:path|rect|circle|line|polyline|polygon)\b')


def main():
    root = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else ROOT
    files = sorted(glob.glob(os.path.join(root, '09-assets', '**', '*.svg'),
                             recursive=True))
    if not files:
        print('没有图标可查。')
        return 0
    bad = 0
    for f in files:
        s = open(f, encoding='utf-8').read()
        rel = os.path.relpath(f, root).replace(os.sep, '/')
        miss = [k for k, p in RULES.items() if not re.search(p, s)]
        hard = HARD_COLOR.findall(s)
        n = len(SHAPES.findall(s))
        if n == 0:
            miss.append('没有图形元素')
        ok = not miss and not hard
        if not ok:
            bad += 1
        print('  [%s] %-40s %s'
              % ('OK  ' if ok else 'FAIL', rel,
                 ('规格齐全（%d 个图形）' % n) if ok
                 else '缺：' + '、'.join(miss) + (' | 硬编码颜色' if hard else '')))
    print('')
    if bad:
        print('%d 个图标规格不合规。' % bad)
        return 1
    print('图标规格：%d 个全部通过。' % len(files))
    print('⚠ 规格合规 != 画得好 —— 语义清晰度必须人眼看。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
