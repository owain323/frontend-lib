#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
legacy-api-gate.py — 旧环境兼容门禁

===========================================================================
🔴 为什么需要（K6）
---------------------------------------------------------------------------
  本库的**语法**目标是 ES5，但「ES5 语法」≠「ES5 运行时 API」。

  实测踩过的坑：代码通过了 ES5 语法检查，却在老 WebView 上运行时
  抛 `is not a function`，因为用了：

      Element.closest()    2015 年起才 widespread
      Array.from()         ES2015
      Object.assign()      ES2015

  这是**静默失效**：本地开发完全正常，只有真机才炸。

===========================================================================
判据
---------------------------------------------------------------------------
  ① 组件 JS 里**不得直接**调用下列 API
     （polyfill.js 自身除外，它是专门补这些的）
  ② 提示可用的 polyfill
===========================================================================
"""
import sys
import os
import io
import re
import subprocess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import origin_of, scannable_files  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 禁止直接使用的较新 API ⇒ 替代方案
FORBIDDEN = {
    # ★ 不检查「el.closest(返回存在性』的形式——
    #    那是**特性检测**（if (el.closest) return el.closest(sel)），
    #    正是为了兼容老环境，不算“直接使用”。
    '.closest(': 'Element.closest',
    'Object.assign': 'Object.assign',
    'Array.from': 'Array.from',
    'Object.entries': 'Object.entries',
    'Object.values': 'Object.values',
    'Array.prototype.includes': 'Array#includes',
    '.startsWith(': 'String#startsWith',
    '.endsWith(': 'String#endsWith',
    '.padStart(': 'String#padStart',
    '.padEnd(': 'String#padEnd',
    'new Map(': 'Map',
    'new Set(': 'Set',
}

EXEMPT = {'01-tokens/polyfill.js'}


def main():
    print('  === 旧环境兼容（K6）===')
    print('')
    # 🔴 视野 = 磁盘上要交付的东西（含未跟踪的新文件），不是 git 索引
    #    —— 见 _common.scannable_files 的事故说明。
    files = scannable_files(ROOT)

    hits = {}
    for rel in files:
        if not rel.endswith('.js'):
            continue
        # 🔴 豁免按**源路径**判定：dist/01-tokens/polyfill.js 就是
        #    01-tokens/polyfill.js 去掉注释的产物 —— 它存在的意义就是补这些 API，
        #    把自己判成「违规使用新 API」是门禁自相矛盾。
        if rel.startswith('05-audit/') or 'vendor' in rel \
                or origin_of(rel) in EXEMPT:
            continue
        try:
            s = io.open(os.path.join(ROOT, rel), encoding='utf-8',
                        errors='replace').read()
        except Exception:
            continue
        # ★ 先剔掉注释：注释里提到某个 API 不等于在用它
        #    （本项目曾因此误报）
        s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
        s = re.sub(r'(?m)^\s*//.*$', '', s)
        s = re.sub(r'/\*\*.*?\*/', '', s, flags=re.S)
        # ★ 排除**特性检测**形态 —— 那正是兼容老环境的正确写法：
        #     if (el.closest) { return el.closest(sel); }   ← 合法
        #     e.target.closest('[x]')                        ← 违规
        s = re.sub(r'if\s*\(\s*\w+\.closest\s*\)', '', s)
        s = re.sub(r'\w+\.closest\s*\?', '', s)
        s = re.sub(r'return\s+\w+\.closest\(', '', s)
        for token, name in FORBIDDEN.items():
            n = s.count(token)
            if n:
                hits.setdefault(name, []).append((rel, n))

    if not hits:
        print('  OK 组件代码未直接使用较新 API')
        print('')
        print('  提示：需要这些能力时，先引入 01-tokens/polyfill.js')
        return 0

    print('  X 组件代码直接使用了以下较新 API：')
    for name in sorted(hits):
        tot = sum(n for _, n in hits[name])
        print('     %-22s %d 处' % (name, tot))
        for rel, n in hits[name][:4]:
            print('        %s  x%d' % (rel[:48], n))
    print('')
    print('  ⇒ 这些在老 WebView 上会直接抛异常（静默失效，只在真机炸）。')
    print('    修法二选一：')
    print('      A. 引入 01-tokens/polyfill.js（已覆盖 closest / Array.from）')
    print('      B. 改写成 ES5 写法')
    return 1


if __name__ == '__main__':
    sys.exit(main())
