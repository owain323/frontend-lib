#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
states_exempt.py — 「本文件不适用哪些状态」的声明机制

为什么需要
----------------------
`states.py` 按**类名**匹配规则组。`.switch__input` 里 `input` 这个字面量
让 switch 匹配到 input 规则，于是被要求实现 `error` / `readonly`。

**但开关没有校验态，也没有只读态** —— 它只有 开 / 关。

两种坏处理：
  · 硬加假的 `.is-error` / `[readonly]` ⇒ 代码里出现永远用不到的死状态，
    复用者看到会以为开关能校验。
  · 删掉门禁这条 ⇒ 所有 input 都不再被检查。

⇒ 正确做法是**显式声明不适用**，并且**把声明写进被检查的文件里** ——
这样"为什么 switch 不需要 error"是**可 grep 的**，不是靠记忆。

语法
----
在被检查的 CSS 注释里写一行：

    states-exempt: error readonly

`states.py` 读它，只在**该文件内**豁免（别的文件不受影响）。
"""
import re

# 声明语法
# 🔴 字符类里不能带 `-`，否则 `[\w\s-]` 的 `-` 会被当范围端点，
#    反而把后面的 `---...` 分隔线整行吃进来（实测踩过）。
DECL = re.compile(r'states-exempt:[ \t]*([\w]+(?:[ \t]+[\w]+)*)')


def read_exempt(path):
    """读一个 CSS 文件里的 states-exempt 声明，返回 set（没有则空集）。"""
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            txt = f.read()
    except OSError:
        return set()
    m = DECL.search(txt)
    if not m:
        return set()
    return {s.strip() for s in m.group(1).split() if s.strip()}


def collect(paths):
    """返回 {状态名: [声明它的文件]}"""
    out = {}
    for p in paths:
        for st in read_exempt(p):
            out.setdefault(st, []).append(p)
    return out


if __name__ == '__main__':
    import sys
    for p in sys.argv[1:]:
        e = read_exempt(p)
        print('%s: %s' % (p, ' '.join(sorted(e)) if e else '(无声明)'))
