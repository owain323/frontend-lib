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
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POLICY = os.path.join(ROOT, 'ai', 'motion-policy.json')

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


def reduced_blocks(css):
    """取出所有 prefers-reduced-motion 块（已剥注释，按括号配平切）"""
    css = strip_comments(css)
    out = []
    for m in re.finditer(r'@media[^{]*prefers-reduced-motion[^{]*\{', css):
        i = m.end()
        depth, j = 1, i
        while j < len(css) and depth > 0:
            if css[j] == '{':
                depth += 1
            elif css[j] == '}':
                depth -= 1
            j += 1
        out.append(css[i:j - 1])
    return out


def keeps_motion(block):
    """块内有没有 >=100ms 的 animation-duration（即"真的保留了动画"）

    为什么用 100ms 当门槛：0.01ms / 0s 是"关掉"，1.2s 是"保留"，
    中间没有第三个语义。100ms 只是把两类分开，不是调参。
    """
    for m in re.finditer(r'animation-duration\s*:\s*([0-9.]+)\s*(ms|s)', block):
        val = float(m.group(1))
        ms = val if m.group(2).lower() == 'ms' else val * 1000
        if ms >= 100:
            return True, ms
    return False, None


def audit_reduced(texts, policy):
    """纯函数：texts = {组件名: (路径, css)}，policy = motion-policy.json 内容

    三个方向，缺一个都会留下洞：
      ① 声明了保留，但 CSS 没真保留（写了空话）
      ② 没声明，却私自保留了动画（偷偷给自己开白条）
      ③ 登记了但文件不存在（清单腐烂）
    """
    probs = []
    keep = policy.get('keep', {})

    for name, meta in sorted(keep.items()):
        if name not in texts:
            probs.append((name, 'missing', '登记在 motion-policy 里，但找不到 CSS：%s'
                          % meta.get('file', '?')))
            continue
        ok = False
        for b in reduced_blocks(texts[name][1]):
            if keeps_motion(b)[0]:
                ok = True
                break
        if not ok:
            probs.append((name, 'not-kept',
                          '声明要保留动画，但 reduced 块里没有 >=100ms 的 '
                          'animation-duration（要么没写，要么被 0.01ms 灭了）'))

    for name, (_path, css) in sorted(texts.items()):
        if name in keep:
            continue
        for b in reduced_blocks(css):
            kept, ms = keeps_motion(b)
            if kept:
                probs.append((name, 'undeclared',
                              '它保留了 %.0fms 的动画，但没在 ai/motion-policy.json '
                              '登记理由' % ms))
                break
    return probs


def reduced_audit():
    """读盘执行（判据逻辑在 audit_reduced 里，便于 --selftest 喂合成数据）"""
    if not os.path.isfile(POLICY):
        print('  [FAIL] 缺 %s —— 没有策略就没有判据，不许判通过' % POLICY)
        return 1
    with open(POLICY, encoding='utf-8') as f:
        policy = json.load(f)

    texts = {}
    for f in sorted(glob.glob(os.path.join(ROOT, '0*', '**', '*.css'), recursive=True)):
        parts = os.path.relpath(f, ROOT).replace('\\', '/').split('/')
        if len(parts) < 3:
            continue
        name = parts[1]
        with open(f, encoding='utf-8', errors='replace') as fh:
            texts[name] = (parts[0] + '/' + parts[1] + '/' + parts[2], fh.read())

    if not texts:
        print('  [FAIL] 一个组件 CSS 都没扫到 —— 视野为空，不许判通过')
        return 1

    probs = audit_reduced(texts, policy)
    keep = policy.get('keep', {})
    print('  减少动效策略：保留 %d 个组件 / 扫描 %d 个组件 CSS' % (len(keep), len(texts)))
    if probs:
        for name, kind, msg in probs:
            print('  FAIL %-18s [%s] %s' % (name, kind, msg))
        print('')
        print('  ⇒ 保留动画必须有理由，且理由要写在 ai/motion-policy.json 里：')
        print('     要么去掉这段保留，要么登记它、说清"关掉会害到谁"。')
        return 1
    print('  OK   保留清单与实现一致，且没有未登记的私自动效')
    return 0


def selftest():
    """反向控制：喂合成 CSS，判据必须能红也必须不乱红"""
    policy = {'keep': {'spinner': {'file': 'x/spinner.css'}}}
    cases = [
        ('合规（保留已声明）',
         {'spinner': ('x', '@media (prefers-reduced-motion: reduce){.a{animation-duration:1.2s !important}}'),
          'card': ('y', '@media (prefers-reduced-motion: reduce){.b{transform:none}}')},
         []),
        ('声明了但没保留',
         {'spinner': ('x', '@media (prefers-reduced-motion: reduce){.a{animation-duration:0.01ms !important}}')},
         ['not-kept']),
        ('私自保留（未登记）',
         {'spinner': ('x', '@media (prefers-reduced-motion: reduce){.a{animation-duration:1.2s !important}}'),
          'toast': ('y', '@media (prefers-reduced-motion: reduce){.b{animation-duration:2s !important}}')},
         ['undeclared']),
        ('登记了但文件不存在',
         {'card': ('y', '/* 无 */')},
         ['missing']),
    ]
    bad = 0
    for name, texts, want in cases:
        got = [k for _n, k, _m in audit_reduced(texts, policy)]
        ok = sorted(set(got)) == sorted(set(want)) and (want or not got)
        print('  %-18s %s  期望 %s 实得 %s'
              % (name, 'PASS' if ok else 'FAIL', want or '无问题', got or '无问题'))
        if not ok:
            bad += 1
    # ⑦b 对偶：证明"没报错"不是因为函数永远返回空
    if not audit_reduced({'card': ('y', '@media (prefers-reduced-motion: reduce){.b{animation-duration:3s}}')},
                         {'keep': {}}):
        print('  [FAIL] 对偶用例失败：明显未登记的动效却判无问题')
        bad += 1
    print('  自检 %d 条，失败 %d 条' % (len(cases) + 1, bad))
    return 1 if bad else 0


def main():
    if '--selftest' in sys.argv:
        return selftest()
    if '--reduced-audit' in sys.argv:
        return reduced_audit()

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
