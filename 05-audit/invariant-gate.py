#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
invariant-gate.py — 守住 Invariant 层的边界，防止它被 Contract / Guidance 污染

============================================================================
🔴 为什么要有这道门禁
----------------------------------------------------------------------------
`docs/INVARIANT.md` 之所以有价值，是因为它**永不变**。
它一变，"哪些约束可以随模型变强而放宽"这件事就没有了基准。

但它会被污染，而且污染的方式很自然：
  · 想强调某个组件很重要 ⇒ 顺手在不变式里写了组件名（那是 Contract 的事）
  · 想让大家记得跑脚本 ⇒ 顺手写了"建议先跑 xxx"（那是 Guidance 的事）

每加一句，文档都"更有用"一点，但它作为**基准**的价值就少一分。
⇒ 所以要用门禁把边界钉住：**想往这层塞东西，得先说服门禁。**

============================================================================
判据
----------------------------------------------------------------------------
  ① 不变式里**不出现**组件名 / 令牌名 / 版本号 / 档位名
     （出现 ⇒ 那是 Contract 的内容，会随版本变）
  ② 不变式里**不出现**建议性措辞（应该 / 建议 / 推荐 / 最好 / 尽量）
     （出现 ⇒ 那是 Guidance 的内容，可以整份推翻）
  ③ 若 `ai/contract.schema.json` 声明了 `invariants`，
     则其中的条目必须与 INVARIANT.md 里的锚点一一对应，不得有孤儿

============================================================================
反向控制
----------------------------------------------------------------------------
  python 05-audit/invariant-gate.py --selftest
============================================================================
"""
from __future__ import annotations

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INV = os.path.join(ROOT, 'docs', 'INVARIANT.md')
CONTRACT = os.path.join(ROOT, 'ai', 'contract.schema.json')

# ② 建议性措辞
SOFT_WORDS = ['应该', '建议', '推荐', '最好', '尽量', '不妨', '可以考虑']

# ① 会随版本变的东西
RE_ANCHOR = re.compile(r'^#{2,3}\s+([A-Za-z][\w.-]*)\b', re.M)
RE_TOKEN_NAME = re.compile(r'(?<![\w-])--[a-z][a-z0-9-]{2,}')
RE_VERSION = re.compile(r'\b\d+\.\d+\.\d+\b')


def component_names():
    """从机器可读契约取真实组件名（不写死名单 ⇒ 加了组件自动生效）。"""
    p = os.path.join(ROOT, 'ai', 'components.json')
    if not os.path.isfile(p):
        return set()
    try:
        doc = json.loads(io.open(p, encoding='utf-8').read())
    except Exception:
        return set()
    names = set()
    for c in doc.get('components', []):
        names.add(c['id'])
        if c.get('rootClass'):
            names.add(c['rootClass'])
        for s in c.get('slots', []):
            names.add(s)
    return {n for n in names if n}


def profile_names():
    p = os.path.join(ROOT, 'ai', 'profiles.json')
    if not os.path.isfile(p):
        return set()
    try:
        doc = json.loads(io.open(p, encoding='utf-8').read())
    except Exception:
        return set()
    return set(doc.get('profiles', {}).keys())


def prose_only(text):
    """
    去掉围栏代码块与行内代码，只留正文。

    ⚠️ 为什么：不变式里**举例子**是必要的（不举例没人看得懂），
       例子必然要写具体组件名/令牌名。核对该保留的是**正文**里
       有没有出现" normative 地提到某个具体组件"。

    ⚠️ 反例（第一版没做这层区分，实测误报）：
       `--check` / `--dir` 是命令行参数，被当成令牌名；
       代码块里的 `.card {}` 被当成组件名。
       ⇒ 判据收得太宽 = 永久假红 = 门禁被学会忽略。这正是要避免的。
    """
    out = []
    fence = False
    for line in text.split('\n'):
        if line.lstrip().startswith('```'):
            fence = not fence
            continue
        if fence:
            continue
        out.append(line)
    body = '\n'.join(out)
    # 行内代码
    body = re.sub(r'`[^`\n]*`', ' ', body)
    return body


def check(text, comps, profiles):
    problems = []
    body = prose_only(text)

    # ① 会变的东西
    for m in RE_TOKEN_NAME.finditer(body):
        problems.append('出现了令牌名 `%s` —— 令牌集合会随版本变，属于 Contract'
                        % m.group(0))
    for m in RE_VERSION.finditer(text):
        problems.append('出现了版本号 `%s` —— 属于 Contract' % m.group(0))
    for name in sorted(comps):
        if re.search(r'(?<![\w-])' + re.escape(name) + r'(?![\w-])', body, re.I):
            problems.append('出现了组件名 `%s` —— 组件集合会随版本变，属于 Contract'
                            % name)
    for name in sorted(profiles):
        if re.search(r'(?<![\w-])' + re.escape(name) + r'(?![\w-])', body, re.I):
            problems.append('出现了档位名 `%s` —— 属于 Contract' % name)

    # ② 建议性措辞
    lines = text.split('\n')
    for i, line in enumerate(lines, 1):
        st = line.strip()
        # ⚠️ 表格行与带引号的引用句，是在**说明边界**（"这条应该归 Guidance"），
        #    不是在陈述不变式本身 ⇒ 不参与判据。
        #    不排除 ⇒ §五「这一层不包含什么」整张表都会被判污染，
        #    而那张表恰恰是防止污染最有用的部分 ⇒ 门禁在惩罚正确的内容。
        if st.startswith('|') or '"' in line or '\u201c' in line:
            continue
        for w in SOFT_WORDS:
            if w in line:
                problems.append('L%d 有建议性措辞「%s」—— 那是 Guidance 的内容，'
                                '不变式只陈述事实' % (i, w))
                break

    return problems


def check_schema():
    """③ 契约里声明的 invariants 必须能在 INVARIANT.md 里找到对应锚点。"""
    if not os.path.isfile(CONTRACT):
        return []
    try:
        doc = json.loads(io.open(CONTRACT, encoding='utf-8').read())
    except Exception as e:
        return ['ai/contract.schema.json 解析失败：%s' % e]
    declared = doc.get('invariants') or []
    if not declared:
        return []
    text = io.open(INV, encoding='utf-8').read()
    missing = [d for d in declared if d not in text]
    out = []
    for d in missing:
        out.append('契约声明了不变式 `%s`，但 INVARIANT.md 里找不到它 ⇒ 孤儿声明' % d)
    return out


def selftest():
    """反向控制：证明三条判据都会红。"""
    ok = True
    base = ('# 不变式\n\n## I-1 裸标签选择器的作用域是**整个文档**\n\n'
            '这是 CSS 的定义。\n')
    cases = [
        (base.replace('CSS 的定义', 'CSS 的定义，建议先跑脚本'), True, '建议性措辞'),
        (base.replace('整个文档', '整个文档 --accent 也受影响'), True, '令牌名'),
        (base.replace('整个文档', '整个文档 0.3.1 起'), True, '版本号'),
        (base, False, '干净的不变式'),
    ]
    for text, should_fail, why in cases:
        probs = check(text, set(), set())
        got = bool(probs)
        flag = 'OK ' if got == should_fail else 'FAIL'
        if got != should_fail:
            ok = False
        print('  [%s] %-10s 期望%s ⇒ 实际%s %s'
              % (flag, why, '红' if should_fail else '绿', '红' if got else '绿',
                 probs[0][:40] if probs else ''))
    # 组件名 / 档位名 —— 这两个判据都是"集合从机器可读契约取"，
    # 白名单是空的（set()）时它们根本不会触发 ⇒ 必须各测一次，否则是假绿。
    for why, comps, profs in [('组件名', {'card'}, set()),
                              ('档位名', set(), {'strict'})]:
        probs = check(base.replace('整个文档', '例如 .card 在 strict 下'),
                      comps, profs)
        got = bool(probs)
        if got != True:  # noqa: E712
            ok = False
        print('  [%s] %-10s 期望红 ⇒ 实际%s %s'
              % ('OK ' if got else 'FAIL', why, '红' if got else '绿',
                 probs[0][:34] if probs else ''))
    return 0 if ok else 1


def main():
    if '--selftest' in sys.argv:
        print('  === invariant-gate 反向控制 ===')
        return selftest()

    if not os.path.isfile(INV):
        print('  [FAIL] 缺少 docs/INVARIANT.md')
        return 1
    text = io.open(INV, encoding='utf-8').read()
    probs = check(text, component_names(), profile_names())
    probs += check_schema()

    print('  === Invariant 层边界 ===')
    if probs:
        for p in probs:
            print('     [FAIL] %s' % p)
        print('  [FAIL] 共 %d 处 —— 不变式层被污染，'
              '它就不配当"哪些约束可以放宽"的基准' % len(probs))
        return 1
    anchors = RE_ANCHOR.findall(text)
    print('     %d 条不变式，无组件名 / 令牌名 / 版本号 / 建议措辞' % len(anchors))
    print('  [OK] 不变式层干净')
    return 0


if __name__ == '__main__':
    sys.exit(main())
