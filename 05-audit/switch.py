#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
switch.py — 状态切换门禁

把 00-charter/08-状态切换规范.md 里**可机械判定**的三条变成检查。
每一条都对应一个真实犯过的错：

  1. 叠放风险   HIGH   absolute 居中 + 同选择器有流内内容 ⇒ 文字会溢出并重叠
  2. 占位变化   MEDIUM 状态类用 display:none ⇒ 切换时容器尺寸会变
  3. 溢出保护   MEDIUM 容器没有 overflow 保护

🔴 这个门禁**查不出**（别指望它）：
  - 点击目标有没有被推走      → 必须真机
  - 竞态 / 乱序返回是否错乱   → 必须真机
  - 视觉上别扭不别扭          → 必须真机
  它只能拦住"结构上就会重叠"的写法。

用法：
    python switch.py --dir <目录>       # 递归扫 .css
    python switch.py <file.css> ...
退出码：0 = 无 HIGH；1 = 有 HIGH
"""

import sys
import os
import re
import glob

HIGH, MEDIUM = 'HIGH', 'MEDIUM'

RE_COMMENT = re.compile(r'/\*.*?\*/', re.S)
RE_RULE = re.compile(r'([^{}]+)\{([^{}]*)\}', re.S)

# 状态类名约定：is-* / *-loading / *--* / aria-busy
RE_STATE_SEL = re.compile(r'\.is-[a-z-]+|--loading|\[aria-busy', re.I)
# 会改变占位的隐藏方式
RE_DISPLAY_NONE = re.compile(r'(^|;)\s*display\s*:\s*none', re.I)
RE_VIS_HIDDEN = re.compile(r'(^|;)\s*visibility\s*:\s*hidden', re.I)


def check(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        raw = f.read()
    css = RE_COMMENT.sub('', raw)

    probs = []
    rules = [(m.group(1).strip(), m.group(2)) for m in RE_RULE.finditer(css)]

    # 1. 叠放风险：absolute + left:50% 居中，且同选择器有流内内容
    for sel, body in rules:
        if 'position: absolute' in body.replace(' ', ' '):
            if re.search(r'left:\s*50%', body) and re.search(r'top:\s*50%', body):
                # 同一条规则里同时有流内内容（inline/flex 之类）就是风险
                if re.search(r'display:\s*(inline|block|flex|grid)', body):
                    probs.append((HIGH, 'stack-risk', sel,
                                  'absolute + 居中 + 同一选择器里有流内内容 ⇒ '
                                  '可能与内容重叠。改用 grid 叠放（grid-area: stack）'))

    # 2. 状态类用 display:none（改变占位）
    for sel, body in rules:
        if not RE_STATE_SEL.search(sel):
            continue
        if RE_DISPLAY_NONE.search(body) and not RE_VIS_HIDDEN.search(body):
            probs.append((MEDIUM, 'placeholder', sel,
                          '状态类用 display:none ⇒ 切换时容器尺寸会变，'
                          '周围布局会跳动。改 opacity（可过渡）或用 grid 叠放占位'))

    # 3. overflow 保护：按钮**容器**没有 overflow
    #    ⚠️ 只检查容器本身，跳过 BEM 修饰类（`--`）。
    #       实测踩过的误报：`.btn--block` 单独看没有 overflow，
    #       但它总是与 `.btn` 组合使用，overflow 从基础类层叠生效。
    #       这就是"只看单条规则、不考虑层叠"的典型误报。
    for sel, body in rules:
        if not re.search(r'\.(btn|button)\b', sel):
            continue
        if '--' in sel:          # BEM 修饰类，不单独构成容器
            continue
        if 'display' in body and 'overflow' not in body:
            probs.append((MEDIUM, 'overflow', sel,
                          '按钮容器没有 overflow 保护 ⇒ 长文案会溢出边界'))

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
        total_high += len(high)
        if not probs:
            print('OK   %s' % name)
            continue
        print('%s %-46s HIGH %d / MEDIUM %d'
              % ('FAIL' if high else 'WARN', name, len(high), len(probs) - len(high)))
        for sev, rule, sel, msg in probs:
            print('       [%-12s] %-34s %s' % (rule, sel[:34], msg))

    print()
    if total_high:
        print('HIGH 级 %d 项 —— 不许提交（见 00-charter/08-状态切换规范.md）' % total_high)
        return 1
    print('无 HIGH 级问题。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
