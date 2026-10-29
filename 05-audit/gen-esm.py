#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
gen-esm.py — 给 IIFE 形态的行为脚本生成 ESM 入口

===========================================================================
🔴 为什么需要这一步
---------------------------------------------------------------------------
  库里的 16 个行为脚本都是 `(function (global) { … })(window)`，
  对外只挂一个全局名（`window.Accordion` 等）。

  这在 `<script src>` 下能用，但在 Vite / Next.js / 原生 ESM 里有三个问题：

    ① 没有 `import { Accordion } from 'agentcss'`
       ⇒ `types/index.d.ts` 声明了 `export declare const Accordion`，
         运行时却**没有任何模块导出它** —— 类型在说谎。
    ② 用户只能写 `import 'agentcss/patterns/accordion/accordion.js'`
       再摸 `window.Accordion`，TS 认不出来、打包器也无法 tree-shake。
    ③ 无 DOM 环境直接 ReferenceError（已在 0.11.15 修掉）。

  ⇒ 生成一层极薄的 `.mjs` 包装：**导入副作用 + 把 global 上的对象 re-export**。

===========================================================================
🔴 为什么是「生成」而不是手写 16 个 .mjs
---------------------------------------------------------------------------
  手写的第二份清单必然漂移：加了组件忘了加 mjs、改了全局名忘了改 mjs。
  生成物 + `--check` 让「漂移」在门禁里当场变红。

  真值源只有一个：**脚本源码里的 `global.X = …` 赋值**。
  文件名由 X 机械推导（DateRange → date-range），不另外维护映射表。

===========================================================================
用法
---------------------------------------------------------------------------
  python 05-audit/gen-esm.py            # 生成 esm/*.mjs + esm/index.mjs
  python 05-audit/gen-esm.py --check    # 只校验：现有文件是否与现算一致
  python 05-audit/gen-esm.py --selftest # 反向控制：证明判据会红
===========================================================================
判据
---------------------------------------------------------------------------
  ① 每个行为脚本**恰好**有一个 `global.<Name> = …`（0 个或 ≥2 个都红）
  ② esm/ 下的文件集合必须与现算集合**完全相等**（多一个孤儿文件也红）
  ③ 每个文件内容必须与现算**逐字节相等**
"""
from __future__ import annotations

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIRS = ('02-primitives', '03-patterns')
OUT_DIR = os.path.join(ROOT, 'esm')

# 行首缩进 + global.<Name> = …   （行内注释里的不算：必须行首）
RE_EXPORT = re.compile(r'^[ \t]*global\.([A-Za-z_$][\w$]*)[ \t]*=[^=]', re.M)

HEADER = ('/* ⚠️ 生成物，勿手改 —— 由 05-audit/gen-esm.py 从源码的 `global.X = …` 生成。\n'
          '   改源码后跑 `python3 05-audit/gen-esm.py` 重新生成，`--check` 会拦住漂移。 */\n')


def kebab(name: str) -> str:
    """DateRange → date-range；FLIP → flip；Toc → toc。"""
    if name.isupper():
        return name.lower()
    s = re.sub(r'(?<!^)(?=[A-Z])', '-', name)
    return s.lower()


def scan() -> dict:
    """回显 { 源文件相对路径: [全局名…] }（按路径排序，结果稳定）"""
    found = {}
    for d in SRC_DIRS:
        base = os.path.join(ROOT, d)
        for dirpath, _dirnames, filenames in os.walk(base):
            for fn in sorted(filenames):
                if not fn.endswith('.js'):
                    continue
                p = os.path.join(dirpath, fn)
                rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
                src = io.open(p, encoding='utf-8').read()
                found[rel] = RE_EXPORT.findall(src)
    return dict(sorted(found.items()))


def render(rel_src: str, name: str) -> str:
    """一个 .mjs 的完整内容。"""
    return (HEADER
            + "import '../%s';\n\n" % rel_src
            + "const g = typeof window !== 'undefined' ? window : globalThis;\n"
            + 'export const %s = g.%s;\n' % (name, name)
            + 'export default %s;\n' % name)


def render_index(pairs: list) -> str:
    """esm/index.mjs —— 一次性拿到全部组件。"""
    out = [HEADER, "/* 全部组件的汇总入口。只要其中一两个时，直接引对应的单文件更省体积。 */\n"]
    for rel_src, name in pairs:
        out.append("import '../%s';\n" % rel_src)
    out.append("\nconst g = typeof window !== 'undefined' ? window : globalThis;\n\n")
    for _rel, name in pairs:
        out.append('export const %s = g.%s;\n' % (name, name))
    return ''.join(out)


def analyse():
    """回显 (pairs, errors)。pairs = [(源路径, 全局名)]"""
    files = scan()
    pairs, errors = [], []
    for rel, names in files.items():
        if len(names) == 0:
            errors.append('%s：没找到 `global.<Name> = ` 导出（0 个）' % rel)
        elif len(names) > 1:
            errors.append('%s：导出名不唯一（%s）—— 一个文件只许挂一个全局 API'
                          % (rel, ', '.join(names)))
        else:
            pairs.append((rel, names[0]))
    # 文件名冲突（两个组件导出同名 → 生成的 mjs 会互相覆盖）
    seen = {}
    for rel, name in pairs:
        k = kebab(name)
        if k in seen:
            errors.append('文件名冲突：%s 与 %s 都映射到 esm/%s.mjs'
                          % (seen[k], rel, k))
        seen[k] = rel
    return pairs, errors


def expected() -> dict:
    """回显 { esm 内文件名: 内容 }"""
    pairs, errors = analyse()
    if errors:
        return {}
    out = {}
    for rel, name in pairs:
        out[kebab(name) + '.mjs'] = render(rel, name)
    out['index.mjs'] = render_index(pairs)
    return dict(sorted(out.items()))


def check() -> int:
    pairs, errors = analyse()
    for e in errors:
        print('  ✗ ' + e)
    if errors:
        print('\n生成源有问题，无法判定 ESM 入口。')
        return 1

    exp = expected()
    have = set()
    if os.path.isdir(OUT_DIR):
        have = {f for f in os.listdir(OUT_DIR) if f.endswith('.mjs')}

    bad = 0
    for fn in sorted(exp):
        p = os.path.join(OUT_DIR, fn)
        if not os.path.exists(p):
            print('  ✗ esm/%s 缺失（应生成）' % fn)
            bad += 1
            continue
        got = io.open(p, encoding='utf-8').read()
        if got != exp[fn]:
            print('  ✗ esm/%s 与现算不一致（源码改过但没重新生成？）' % fn)
            bad += 1
    for fn in sorted(have - set(exp)):
        print('  ✗ esm/%s 是孤儿（源码里没有对应的 global 导出）' % fn)
        bad += 1

    if bad:
        print('\n共 %d 处不一致。跑 `python3 05-audit/gen-esm.py` 重新生成。' % bad)
        return 1
    print('  ✓ ESM 入口与源码一致：%d 个组件 + index.mjs' % (len(exp) - 1))
    return 0


def write() -> int:
    pairs, errors = analyse()
    for e in errors:
        print('  ✗ ' + e)
    if errors:
        return 1
    exp = expected()
    if not os.path.isdir(OUT_DIR):
        os.makedirs(OUT_DIR)
    for fn in sorted(os.listdir(OUT_DIR)):
        if fn.endswith('.mjs') and fn not in exp:
            os.remove(os.path.join(OUT_DIR, fn))
            print('  删除孤儿 esm/%s' % fn)
    for fn, body in exp.items():
        p = os.path.join(OUT_DIR, fn)
        io.open(p, 'w', encoding='utf-8', newline='').write(body)
        print('  写入 esm/%s' % fn)
    print('✓ 共 %d 个文件' % len(exp))
    return 0


# ==========================================================================
# 反向控制：判据能不能红
# ==========================================================================
def selftest() -> int:
    R = []

    def add(name, ok):
        R.append((name, bool(ok)))

    def names_of(src):
        return RE_EXPORT.findall(src)

    # ---- 抽取逻辑 ----
    add('正常 global.Foo = {...} 抽出 1 个',
        names_of('  global.Foo = { a: 1 };\n') == ['Foo'])
    add('无缩进的 global.Foo = 也抽得到',
        names_of('global.Foo = 1;\n') == ['Foo'])
    add('两个导出被识别（交给上层判红）',
        len(names_of('  global.A = 1;\n  global.B = 2;\n')) == 2)
    add('零导出被识别（交给上层判红）',
        names_of('  var x = 1;\n') == [])
    add('比较运算 != 不误当赋值',
        names_of('  if (global.Foo != 1) {}\n') == [])
    add('== 不误当赋值',
        names_of('  if (global.Foo == 1) {}\n') == [])
    add('行首注释里的 global.X = 不算（有缩进但开头是 //）',
        names_of('  // global.Foo = 1;\n') == [])
    add('函数体内的局部赋值也算（缩进无关，这是已知边界）',
        names_of('      global.Foo = 1;\n') == ['Foo'])

    # ---- 文件名推导 ----
    add('DateRange → date-range', kebab('DateRange') == 'date-range')
    add('FLIP → flip（全大写不拆）', kebab('FLIP') == 'flip')
    add('Toc → toc', kebab('Toc') == 'toc')
    add('Accordion → accordion', kebab('Accordion') == 'accordion')

    # ---- 生成内容 ----
    body = render('03-patterns/x/x.js', 'X')
    add('生成物包含源路径', "import '../03-patterns/x/x.js';" in body)
    add('生成物 re-export 全局名', 'export const X = g.X;' in body)
    add('生成物带 default', 'export default X;' in body)
    add('生成物带"勿手改"标记', '勿手改' in body)
    add('生成物不硬编码 window（SSR 安全）',
        "typeof window !== 'undefined' ? window : globalThis" in body)

    # ---- 结论 ----
    red = [n for n, ok in R if not ok]
    for n, ok in R:
        print('  %s %s' % ('✓' if ok else '✗', n))
    if red:
        print('\n🔴 自检失败 %d 条：判据可能没有效力。' % len(red))
        return 1
    print('\n✓ 自检 %d 条全部通过（%d 条正向控制）' % (len(R), len(R)))
    return 0


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    if '--check' in sys.argv:
        sys.exit(check())
    sys.exit(write())
