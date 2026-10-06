#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
api-snapshot.py — 公开 API 快照门禁（工单 J11）

===========================================================================
🔴 为什么需要这道门禁（外部评审 P0）
---------------------------------------------------------------------------
  评审发现最严重的问题：**`types/index.d.ts` 声明的 API 与 runtime 不一致**：

    types 写：  Select.getValue() / setValue()
    runtime 是： Select.create().value （getter/setter）

  ⇒ 使用 TypeScript 的开发者**会被类型系统明确误导**。
  ⇒ 这比"没有类型"更坏 —— 错误类型制造**错误的确定性**。

⭐ 本门禁的定位：**单一事实源**。
   它直接从 runtime 源码里**提取真实导出的 API**，
   存成 `api-snapshot.json`，并在每次运行时比对。
   ⇒ types 与 runtime 一旦分叉，立刻被抓到。

===========================================================================
为什么不用「真的跑起来探测」
---------------------------------------------------------------------------
  那样最准，但需要浏览器环境，慢且脆。
  ⭐ 这里用**静态提取**：读 `global.Xxx = {...}` 与 `return {...}` 里的键。
  够用来抓"types 写了 runtime 没有的方法"这类**分叉**。
===========================================================================
"""
import sys
import os
import io
import re
import json
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAPSHOT = os.path.join(ROOT, '05-audit', 'api-snapshot.json')

# ============================================================================
# 组件清单：(组件名, js 路径, 全局挂载名)
# ============================================================================
COMPONENTS = [
    ('Select',    '02-primitives/select/select.js'),
    ('Combobox',  '02-primitives/combobox/combobox.js'),
    ('DateRange', '02-primitives/date-range/date-range.js'),
    ('Overlay',   '03-patterns/overlay/overlay.js'),
    ('Tabs',      '03-patterns/tabs/tabs.js'),
    ('Accordion', '03-patterns/accordion/accordion.js'),
    ('Tree',      '03-patterns/tree/tree.js'),
    ('Popover',   '02-primitives/popover/popover.js'),
]


def extract(js_path):
    """从 JS 源码里提取它实际暴露的 API 键名"""
    p = os.path.join(ROOT, js_path)
    if not os.path.isfile(p):
        return None
    s = io.open(p, encoding='utf-8').read()
    keys = set()

    # ① return { a, b, get c(){}, set d(){} }
    for m in re.finditer(r'return\s*\{', s):
        i = m.end() - 1
        depth = 0
        for j in range(i, min(len(s), i + 1200)):
            if s[j] == '{':
                depth += 1
            elif s[j] == '}':
                depth -= 1
                if depth == 0:
                    body = s[i + 1:j]
                    for k in re.finditer(
                            r'(?:^|[\s,{])([a-zA-Z_$][\w$]*)\s*[(:]',
                            body):
                        keys.add(k.group(1))
                    break

    # ② global.Xxx = { a, b, create(){} }
    for m in re.finditer(r'global\.(\w+)\s*=\s*\{', s):
        i = m.end() - 1
        depth = 0
        for j in range(i, min(len(s), i + 800)):
            if s[j] == '{':
                depth += 1
            elif s[j] == '}':
                depth -= 1
                if depth == 0:
                    body = s[i + 1:j]
                    for k in re.finditer(
                            r'(?:^|[\s,{])([a-zA-Z_$][\w$]*)\s*[(:]',
                            body):
                        keys.add(k.group(1))
                    break

    # ③ 排除明显的内部实现
    # ⚠️ 排除 JS 内置与局部变量 —— 它们出现在 object literal 里但不是 API
    BAD = {'if', 'for', 'while', 'return', 'function', 'var', 'let', 'const',
           'String', 'Date', 'Number', 'Object', 'Array', 'Math', 'JSON',
           'null', 'true', 'false', 'new', 'typeof', 'length', 'q', 'y',
           'paint', 'paintList'}
    return sorted(k for k in keys if k not in BAD and len(k) > 1)


def types_declared():
    """从 types/index.d.ts 里提取声明的方法名"""
    p = os.path.join(ROOT, 'types', 'index.d.ts')
    if not os.path.isfile(p):
        return {}
    s = io.open(p, encoding='utf-8').read()
    out = {}
    # interface X { ... }  /  declare namespace X { ... }
    for m in re.finditer(r'(?:interface|namespace)\s+(\w+)[^{]*\{', s):
        name = m.group(1)
        i = m.end() - 1
        depth = 0
        for j in range(i, min(len(s), i + 3000)):
            if s[j] == '{':
                depth += 1
            elif s[j] == '}':
                depth -= 1
                if depth == 0:
                    body = s[i + 1:j]
                    ms = set(re.findall(r'^\s*(\w+)\s*\(', body, re.M))
                    if ms:
                        out.setdefault(name, set()).update(ms)
                    break
    return {k: sorted(v) for k, v in out.items()}


def main():
    print('  === 公开 API 快照（工单 J11）===')
    print('')

    current = {}
    for name, path in COMPONENTS:
        keys = extract(path)
        if keys:
            current[name] = keys

    if not current:
        print('  [X] 没能从任何组件提取到 API')
        return 1

    # ---------- 比对快照 ----------
    old = None
    if os.path.isfile(SNAPSHOT):
        try:
            old = json.load(io.open(SNAPSHOT, encoding='utf-8'))
        except Exception:
            old = None

    if old is None:
        io.open(SNAPSHOT, 'w', encoding='utf-8', newline='').write(
            json.dumps(current, ensure_ascii=False, indent=2,
                       sort_keys=True) + '\n')
        print('  已生成 API 快照：%s' % os.path.relpath(SNAPSHOT, ROOT)
              .replace('\\', '/'))
        for k, v in sorted(current.items()):
            print('     %-12s %s' % (k, ', '.join(v[:9])))
        return 0

    changed = []
    for comp in sorted(set(list(old.keys()) + list(current.keys()))):
        o = set(old.get(comp, []))
        n = set(current.get(comp, []))
        if o != n:
            removed = sorted(o - n)
            added = sorted(n - o)
            changed.append((comp, removed, added))
            print('  X %-12s API 变了' % comp)
            if removed:
                print('      消失: %s' % ', '.join(removed))
            if added:
                print('      新增: %s' % ', '.join(added))
    if not changed:
        print('  OK 公开 API 与上次快照一致')
    else:
        print('')
        print('  => 公开 API 变动。')
        print('     若**是有意**的破坏性改动，必须：')
        print('       1) 更新 types/index.d.ts（别让类型系统骗人）')
        print('       2) 更新 api-snapshot.json（承认改动）')
        print('       3) 在 CHANGELOG 标注 BREAKING')
        return 1

    # ---------- types 与 runtime 是否分叉 ----------
    print('')
    t = types_declared()
    forks = []
    for comp, keys in current.items():
        if comp not in t:
            continue
        ts = set(t[comp])
        rt = set(keys)
        missing = sorted(m for m in ts if m not in rt and m != 'create')
        if missing:
            forks.append((comp, missing))
    if forks:
        print('  🔴 types 声明了 runtime 没有的方法：')
        for comp, missing in forks:
            print('     %-12s %s' % (comp, ', '.join(missing)))
        print('')
        print('     => 这会**明确误导** TypeScript 使用者，比没有类型更糟。')
        return 1
    print('  OK types 声明的方法在 runtime 都存在')
    return 0


if __name__ == '__main__':
    sys.exit(main())
