#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
motion.py — 动效门禁

把动效自检清单变成机械检查。
每一条都对应一个**真实犯过的错**，不是凭空设的规矩。

检查项：
  1. 自编缓动曲线        HIGH   曲线不该自己编（阻尼/重心是猜的）
  2. transition: all     HIGH   会把 width/box-shadow 一起过渡，掉帧且难排查
  3. scale(0) 入场       MEDIUM 元素从"一个点"炸开，观感廉价
  4. hover 未做触屏门控   MEDIUM 触屏上 hover 会"粘住"
  5. 动效时长 ≥ 300ms   MEDIUM UI 动画超 300ms 会让人觉得卡

🔴 这个门禁查不出（别指望它）：
  - 动画顺不顺（必须真机看）
  - 缓动曲线"对不对"（只能查是不是白名单里的值，查不出好不好）
  - 动画是否多余（那是频率表的事，要人判断）

用法：
    python motion.py --dir <目录>      # 递归扫 .css
    python motion.py <file.css> ...
退出码：0 = 无 HIGH；1 = 有 HIGH
"""

import sys
import os
import re
import glob

HIGH, MEDIUM = 'HIGH', 'MEDIUM'

# 业界通用值（与 Tailwind v4 默认、Emil Kowalski 技能库一致）
ALLOWED_EASE = [
    'cubic-bezier(0.23,1,0.32,1)',
    'cubic-bezier(0.77,0,0.175,1)',
    'cubic-bezier(0.32,0.72,0,1)',
    'cubic-bezier(0.4,0,0.2,1)',      # Material standard，容错
    'linear',
    'ease',
    'ease-out',
    'ease-in-out',
    'steps(1)',                      # 进度条那种离散推进
    'step-start', 'step-end',
]

# var(--ease-*) 走令牌，不算自编
TOKEN_EASE = re.compile(r'var\(\s*--ease-')
RAW_EASE = re.compile(r'cubic-bezier\([^)]*\)')

RE_TRANSITION_ALL = re.compile(r'transition\s*:\s*all\b', re.I)
RE_SCALE_ZERO = re.compile(r'scale\(\s*0(?:\.0+)?\s*[,)]', re.I)
RE_HOVER = re.compile(r'(?<![\w-]):hover\b')
RE_HOVER_GUARD = re.compile(r'@media[^{]*\(hover\s*:?\s*hover', re.I)
# 300ms = 0.3s
RE_DURATION = re.compile(r'(\d*\.?\d+)\s*(ms|s)\b', re.I)


def norm_ease(v):
    """归一化：去空格，统一小数位（0.230 与 0.23 视为同一个）"""
    v = re.sub(r'\s+', '', v)
    def _f(m):
        try:
            return '%g' % float(m.group(1))
        except ValueError:
            return m.group(1)
    return re.sub(r'(\d+\.?\d*)', _f, v)


ALLOWED_NORM = {norm_ease(x) for x in ALLOWED_EASE}


def strip_comments(css):
    return re.sub(r'/\*.*?\*/', '', css, flags=re.S)


def check(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        raw = f.read()
    css = strip_comments(raw)

    probs = []

    # 1. 自编曲线
    for m in RAW_EASE.finditer(css):
        if norm_ease(m.group(0)) not in ALLOWED_NORM:
            line = css[:m.start()].count('\n') + 1
            # 同一行里如果用了 var(--ease-*)，说明是令牌引用，不算
            ctx = css[max(0, m.start() - 60):m.end() + 10]
            if TOKEN_EASE.search(ctx):
                continue
            probs.append((HIGH, 'ease', line,
                          '自编缓动曲线 %s（第 %d 行）。曲线不该自己编，'
                          '用 var(--ease-out) 等令牌' % (m.group(0), line)))

    # 2. transition: all
    for m in RE_TRANSITION_ALL.finditer(css):
        line = css[:m.start()].count('\n') + 1
        probs.append((HIGH, 'transition-all', line,
                      'transition: all（第 %d 行）会把 width/box-shadow 一起过渡，'
                      '掉帧且难排查。逐个列属性' % line))

    # 3. scale(0) 入场
    for m in RE_SCALE_ZERO.finditer(css):
        line = css[:m.start()].count('\n') + 1
        probs.append((MEDIUM, 'scale-zero', line,
                      'scale(0) 入场（第 %d 行）——元素从"一个点"炸开。'
                      '用 0.9–0.97 + opacity' % line))

    # 4. hover 未门控
    has_hover = bool(RE_HOVER.search(css))
    has_guard = bool(RE_HOVER_GUARD.search(css))
    if has_hover and not has_guard:
        probs.append((MEDIUM, 'hover-guard', 0,
                      '有 :hover 但没有 @media (hover:hover) 门控 —— '
                      '触屏上点完会"粘住"在悬停态'))

    # 5. 时长 >= 300ms
    for m in RE_DURATION.finditer(css):
        try:
            val = float(m.group(1))
        except ValueError:
            continue
        unit = m.group(2).lower()
        ms = val if unit == 'ms' else val * 1000
        if ms >= 300:
            # transition-delay 也算，但先只报 transition/animation 的
            line = css[:m.start()].count('\n') + 1
            ctx = css[max(0, m.start() - 40):m.end() + 5]
            if 'delay' in ctx or 's' == m.group(2) and 'transition' not in ctx and 'animation' not in ctx:
                continue
            probs.append((MEDIUM, 'duration', line,
                          '动效 %.0fms（第 %d 行）≥300ms —— UI 动画超 300ms '
                          '会让人觉得卡' % (ms, line)))

    return probs


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args or '--help' in sys.argv:
        print(__doc__)
        return 2

    paths = []
    for a in args:
        if os.path.isdir(a):
            paths.extend(glob.glob(os.path.join(a, '**', '*.css'), recursive=True))
        else:
            paths.append(a)
    paths = [p for p in paths if os.path.isfile(p)]
    if not paths:
        print('没找到 CSS 文件')
        return 2

    root = os.path.commonpath(paths) if len(paths) > 1 else None
    total_high = 0

    for p in paths:
        probs = check(p)
        name = os.path.relpath(p, root).replace('\\', '/') if root else os.path.basename(p)
        high = [x for x in probs if x[0] == HIGH]
        med = [x for x in probs if x[0] == MEDIUM]
        total_high += len(high)
        if not probs:
            print('OK   %s' % name)
            continue
        print('%s %-46s HIGH %d / MEDIUM %d'
              % ('FAIL' if high else 'WARN', name, len(high), len(med)))
        for sev, rule, line, msg in probs:
            print('       L%-4d [%-14s] %s' % (line, rule, msg))

    print()
    if total_high:
        print('HIGH 级 %d 项 —— 不许提交（判据见 API.md 的「动效」）' % total_high)
        return 1
    print('无 HIGH 级问题。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
