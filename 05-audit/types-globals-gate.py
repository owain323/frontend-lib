#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""
types-globals-gate.py — 源码挂到 window 的全局，类型里必须有（E297）

============================================================================
🔴 为什么需要（0.25.2 的实际状态）
----------------------------------------------------------------------------
  源码里有 **24 个** `window.X =` / `global.X =`，`types/index.d.ts` 只声明了
  **16 个**。缺的 8 个是：

      Theme  Chart  ChartAdapter  ModelViewer      ← 审计报告点到的 4 个
      Bar    ScientificPlot  ShellNav  Upload      ← 报告没点到的另外 4 个

  后果不是"少写点类型"这么轻：TS 用户写 `window.Theme.set('dark')` 会报
  "属性不存在"，于是要么 `(window as any)`、要么去 `@ts-expect-error`，
  **两条路都绕开了类型系统** —— 而本库最反对的就是绕过契约。
  `Upload` 更刺眼：`esm/upload.mjs` 是**存在**的，运行时能 import，类型里看不见。

  更糟的是本文件旁边的注释当时写着「behavior-api 门禁核对源码 / esm 入口 /
  本文件声明**三者**集合相等」。核实：`behavior-api-gate.js` 里
  **一次都没出现 `index.d.ts`**，它只比源码与 `esm/`。
  ⇒ 注释替一道门禁承诺了它没做的事，比没有门禁更危险。

============================================================================
判据（三条，全部可机械执行）
----------------------------------------------------------------------------
  ① 源码里每个全局赋值（`window.X =` / `global.X =`，排除 `==` / `===`）都必须在
     `FrontendLibGlobal` 里有声明
  ② 反过来：`FrontendLibGlobal` 的每个成员都必须能在源码里找到赋值
     ⇒ 防「幻觉类型」（声明了运行时不存在的东西）
  ③ 每个具名导出 `export declare const X` 必须有对应的 `esm/<kebab>.mjs`
     ⇒ 防「幻觉导出」（类型说能 import，运行时取不到）

  反向控制（--selftest）：
     C1 注入一个源码全局却没声明     ⇒ ① 红
     C2 删掉一条声明                ⇒ ① 红
     C3 声明一个源码里没有的成员     ⇒ ② 红
     C4 声明一个没有 esm 的具名导出   ⇒ ③ 红
     C5 真实仓库                    ⇒ 必须全绿

用法
----------------------------------------------------------------------------
  python 05-audit/types-globals-gate.py
  python 05-audit/types-globals-gate.py --selftest
"""
from __future__ import annotations

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TYPES = os.path.join(ROOT, 'types', 'index.d.ts')
ESM = os.path.join(ROOT, 'esm')
SRC_DIRS = ['01-tokens', '02-primitives', '03-patterns', '04-recipes', '09-assets']

# `window.X =` / `global.X =`，但**不是**比较运算（== / ===）
RE_ASSIGN = re.compile(r'\b(?:window|global)\.([A-Z][A-Za-z0-9_$]*)\s*=(?!=)')
RE_IFACE = re.compile(r'export interface FrontendLibGlobal\s*\{')
RE_MEMBER = re.compile(r'^\s{2}([A-Za-z_$][\w$]*)\s*[?:]\s*', re.M)
RE_NAMED = re.compile(r'^export declare const ([A-Za-z_$][\w$]*)\s*:', re.M)


def kebab(name):
    if name.isupper():                       # FLIP → flip
        return name.lower()
    s = re.sub(r'(?<!^)(?=[A-Z])', '-', name)
    return s.lower()


def scan_globals(dirs=None):
    """返回 {全局名: [文件…]}。"""
    hits = {}
    for d in (dirs or SRC_DIRS):
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for root, _, names in os.walk(base):
            for n in names:
                if not n.endswith('.js'):
                    continue
                p = os.path.join(root, n)
                rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
                src = io.open(p, encoding='utf-8', errors='replace').read()
                for m in RE_ASSIGN.finditer(src):
                    hits.setdefault(m.group(1), []).append(rel)
    return hits


def parse_dts(text=None):
    """返回 (声明的全局成员列表, 具名导出列表)。"""
    text = text if text is not None else io.open(TYPES, encoding='utf-8').read()
    m = RE_IFACE.search(text)
    if not m:
        return [], []
    start = m.end() - 1
    depth, i = 0, start
    while i < len(text):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                break
        i += 1
    body = text[start + 1:i]
    members = RE_MEMBER.findall(body)
    return members, RE_NAMED.findall(text)


def check(globals_map, members, named, esm_files):
    errs = []
    declared = set(members)
    have = set(globals_map)

    for name in sorted(have - declared):
        errs.append(('①', '%s 挂在 window 上但没有类型声明（%s）'
                     % (name, globals_map[name][0])))
    for name in sorted(declared - have):
        errs.append(('②', 'FrontendLibGlobal 声明了 %s，源码里找不到赋值' % name))
    for name in named:
        fn = kebab(name) + '.mjs'
        if fn not in esm_files:
            errs.append(('③', 'export declare const %s 没有 esm/%s' % (name, fn)))
    return errs


def load():
    return scan_globals(), parse_dts()[0], parse_dts()[1], \
        set(os.listdir(ESM)) if os.path.isdir(ESM) else set()


# --------------------------------------------------------------- 反向控制
def selftest():
    g, members, named, esm = load()
    ok = True

    def case(tag, gm, mem, nm, want):
        nonlocal ok
        errs = check(gm, mem, nm, esm)
        hit = [e for e in errs if e[0] == want]
        good = bool(hit)
        print('    %s %s → 判据%s %s'
              % ('OK  ' if good else 'X   ', tag, want,
                 '如期变红（%d 条）' % len(hit) if good else '**没有变红**'))
        if not good:
            ok = False

    def g_plus():
        d = dict(g)
        d['Nope'] = ['02-primitives/nope/nope.js']
        return d

    def m_minus():
        return [x for x in members if x != 'Theme']

    def m_plus():
        return list(members) + ['Ghost']

    print('  === 反向控制 ===')
    case('C1 源码多一个全局没声明', g_plus(), members, named, '①')
    case('C2 删掉 Theme 的声明', g, m_minus(), named, '①')
    case('C3 声明一个源码里没有的成员', g, m_plus(), named, '②')
    case('C4 声明一个没有 esm 的具名导出', g, members,
         list(named) + ['Ghost'], '③')

    real = check(g, members, named, esm)
    print('    %s C5 真实仓库 → %s'
          % ('OK  ' if not real else 'X   ',
             '全绿' if not real else '**有 %d 条误报**' % len(real)))
    if real:
        ok = False
        for e in real[:5]:
            print('         ', e)

    print('')
    print('  ✅ 三条判据全部有牙，且不误伤真实仓库' if ok else '  ❌ 反向控制未通过')
    return 0 if ok else 1


def main():
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    g, members, named, esm = load()
    errs = check(g, members, named, esm)
    print('')
    print('  === 源码全局 ↔ 类型声明 ===')
    print('    源码 %d 个全局 · d.ts 声明 %d 个 · 具名导出 %d 个'
          % (len(g), len(members), len(named)))
    if errs:
        for rule, msg in errs:
            print('    X [%s] %s' % (rule, msg))
    else:
        print('    OK 每个 window 全局都有类型，每条声明都有源码依据，'
              '每个具名导出都有 esm 入口')
    print('')
    if errs:
        print('  ❌ %d 项不满足' % len(errs))
        sys.exit(1)
    print('  ✅ 类型与运行时对齐')
    sys.exit(0)


if __name__ == '__main__':
    main()
