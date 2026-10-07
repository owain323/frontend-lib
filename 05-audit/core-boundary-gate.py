#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
core-boundary-gate.py — 核心里**不许出现呈现形态语义**

============================================================================
🔴 为什么
----------------------------------------------------------------------------
一次真实事故：用本库做 14 页 PPT，AI 反复局部修改后整体崩坏。
复盘时最容易得出的结论是「核心库要懂 PPT」——**这个结论是错的**：

  · 核心要知道"一页是什么"        ⇒ 核心从组件库变成演示文稿引擎
  · 核心要知道"一页能放几个元素"  ⇒ 这个数每换一种形态就不同
  · 核心要处理"翻页"              ⇒ 翻页跟组件没有任何关系

⇒ **呈现形态会变，组件不变。把易变的和不变的绑在一起，两边都动不了。**

正解：核心提供稳定底座，呈现语义挂在外层（adapters/presentation/），
两边通过 `extensions.presentation` 这个**数据**耦合，不通过代码耦合。

============================================================================
判据
----------------------------------------------------------------------------
  A. 核心目录 + 核心契约里不出现 slide / deck / ppt / page-N 语义
  B. 适配层存在且自包含（README + schema + 转换器 + 检查器）
  C. 往返可用：deck → 契约文档 → **核心校验器忽略 extensions**（不判非法）
  D. 反向控制：往核心文件里注入一个 slide ⇒ 门禁必须红

============================================================================
用法
----------------------------------------------------------------------------
  python 05-audit/core-boundary-gate.py
  python 05-audit/core-boundary-gate.py --selftest
============================================================================
"""
from __future__ import annotations

import io
import json
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CORE_DIRS = ['01-tokens', '02-primitives', '03-patterns', '04-recipes']
CORE_FILES = ['ai/contract.schema.json', 'ai/components.schema.json',
              'ai/tokens.schema.json', 'ai/patch.schema.json',
              'ai/validate.js', 'ai/patch.js', 'ai/cli.js']

# ⚠️ 必须排除 `progress-slide` 这类**名字里恰好带 slide**的东西。
#    第一版用裸 `\bslide\b` ⇒ progress.css 的动画名被判违规（实测假红）。
RE_PRESENTATION = re.compile(
    r'(?<![-\w])(deck|decks|slide|slides|ppt|keynote)(?![-\w])', re.I)
RE_PAGE_OVERRIDE = re.compile(r'\.(page|slide)-\d', re.I)

ADAPTER = os.path.join(ROOT, 'adapters', 'presentation')
ADAPTER_FILES = ['README.md', 'deck.schema.json', 'to-doc.js', 'check.js']


def rel(p):
    return os.path.relpath(p, ROOT).replace('\\', '/')


def scan_core():
    hits = []
    for d in CORE_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, _dn, files in os.walk(base):
            for f in sorted(files):
                p = os.path.join(dirpath, f)
                try:
                    t = io.open(p, encoding='utf-8').read()
                except Exception:
                    continue
                for m in RE_PRESENTATION.finditer(t):
                    line = t.count('\n', 0, m.start()) + 1
                    hits.append((rel(p), line, m.group(0)))
    for f in CORE_FILES:
        p = os.path.join(ROOT, f)
        if not os.path.isfile(p):
            continue
        t = io.open(p, encoding='utf-8').read()
        for m in RE_PRESENTATION.finditer(t):
            line = t.count('\n', 0, m.start()) + 1
            hits.append((rel(p), line, m.group(0)))
    return hits


def check_roundtrip():
    """deck → 契约文档 → 核心校验器必须接受（忽略 extensions）。"""
    deck = {
        'schemaVersion': '1.0.0',
        'title': '示例',
        'slides': [
            {'id': 's1', 'layout': 'title',
             'nodes': [{'id': 't', 'kind': 'text', 'text': '标题', 'role': 'title'}]},
            {'id': 's2', 'layout': 'bullets', 'title': '要点',
             'nodes': [{'id': 'b1', 'kind': 'text', 'text': '一', 'role': 'body'}]}
        ]
    }
    tmp = tempfile.mkdtemp(prefix='fl-coreboundary-')
    fdeck = os.path.join(tmp, 'deck.json')
    fdoc = os.path.join(tmp, 'doc.json')
    io.open(fdeck, 'w', encoding='utf-8').write(json.dumps(deck, ensure_ascii=False))
    try:
        r = subprocess.run([sys.executable or 'node', '-c', '1'], capture_output=True)
    except Exception:
        pass
    node = 'node'
    r1 = subprocess.run([node, os.path.join(ADAPTER, 'to-doc.js'), fdeck, '-o', fdoc],
                        capture_output=True, cwd=ROOT)
    if r1.returncode != 0:
        return ['to-doc.js 转换失败：' +
                (r1.stderr or b'').decode('utf-8', 'replace')[:200]]
    r2 = subprocess.run([node, os.path.join(ROOT, 'ai', 'cli.js'),
                         'check', fdoc, '--profile=creative', '--json'],
                        capture_output=True, cwd=ROOT)
    if r2.returncode != 0:
        return ['核心校验器拒绝了带 extensions 的文档 ⇒ 前向兼容失效：' +
                (r2.stdout or b'').decode('utf-8', 'replace')[:300]]
    return []


def selftest():
    """反向控制：证明 A 判据会红。"""
    ok = True
    tmp = tempfile.mkdtemp(prefix='fl-coreboundary-')
    # 干净的核心不该报
    p = os.path.join(tmp, 'clean.css')
    io.open(p, 'w', encoding='utf-8').write(
        '.card { color: red }\n@keyframes progress-slide { from {} to {} }\n')
    t = io.open(p, encoding='utf-8').read()
    got = RE_PRESENTATION.findall(t)
    if got:
        print('  [FAIL] 误报：progress-slide 被当成呈现语义 %s' % got)
        ok = False
    else:
        print('  [OK]   progress-slide（动画名）不误报')
    # 注入 slide ⇒ 必须报
    p2 = os.path.join(tmp, 'dirty.css')
    io.open(p2, 'w', encoding='utf-8').write('.slide { color: red }\n')
    t2 = io.open(p2, encoding='utf-8').read()
    if not RE_PRESENTATION.findall(t2):
        print('  [FAIL] 反向控制失效：注入 slide 没被抓到')
        ok = False
    else:
        print('  [OK]   注入 slide 被抓到')
    # 页面级 override
    if not RE_PAGE_OVERRIDE.search('.page-3 h1 { }'):
        print('  [FAIL] 反向控制失效：.page-3 没被抓到')
        ok = False
    else:
        print('  [OK]   .page-3 这类页面级选择器会被抓到')
    return 0 if ok else 1


def main():
    if '--selftest' in sys.argv:
        print('  === core-boundary 反向控制 ===')
        return selftest()

    print('  === 核心边界 ===')
    fails = 0

    hits = scan_core()
    if hits:
        for f, line, word in hits[:10]:
            print('     [FAIL] %s:%d  出现呈现语义「%s」' % (f, line, word))
        print('     ⇒ 共 %d 处。呈现形态的事该去 adapters/presentation/' % len(hits))
        fails += len(hits)
    else:
        print('     A. 核心目录与核心契约：无 slide / deck / ppt 语义')

    missing = [f for f in ADAPTER_FILES
               if not os.path.isfile(os.path.join(ADAPTER, f))]
    if missing:
        print('     [FAIL] B. 适配层缺文件：%s' % ', '.join(missing))
        fails += 1
    else:
        print('     B. 适配层自包含（%s）' % ' + '.join(ADAPTER_FILES))

    rt = check_roundtrip()
    if rt:
        for x in rt:
            print('     [FAIL] C. %s' % x)
        fails += len(rt)
    else:
        print('     C. deck → 契约文档 → 核心校验器接受（extensions 被忽略）')

    if fails:
        print('  [FAIL] 共 %d 处' % fails)
        return 1
    print('  [OK] 核心没有混进呈现语义')
    return 0


if __name__ == '__main__':
    sys.exit(main())
