#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
behavior-matrix-gate.py — 行为覆盖矩阵门禁（M3）

============================================================================
🔴 为什么需要
----------------------------------------------------------------------------
  四个微行为核抽完了，但"**哪些组件必须有哪种行为**"此前只写在人的脑子里：
    · 谁还没收编？不知道（只能逐个 grep）
    · 谁不适用？不知道（于是"不适用"和"忘了做"看起来一模一样）
    · 新增一个组件时，没人被提醒"它需不需要 dismissable"

⇒ 本门禁把这张表变成**机器可读 + 强制完整**的事实文件 `ai/behaviors.json`。

============================================================================
判据（六条）
----------------------------------------------------------------------------
  ① 每个组件 × 每个行为都必须登记（**不许靠省略跳过**）
  ② 状态必须是 core / manual / gap / n/a 之一
  ③ `core` ⇒ 源码里必须真的有注入块**且真的调用了核**（光注入不调 = 白背字节）
  ④ `manual` / `gap` / `n/a` 都必须写理由（空理由 ⇒ 红）
  ⑤ manual 与 gap 的数量**必须等于 budget**（棘轮：只能降，降了要同步改数字）
  ⑥ 矩阵里写了不存在的行为名 / 不存在的组件 ⇒ 红（防手滑和幻觉）

============================================================================
反向控制：python 05-audit/behavior-matrix-gate.py --selftest
  ① 声明 core 但源码没有 ⇒ 红
  ② 删掉一个组件的登记 ⇒ 红
  ③ n/a 不写理由 ⇒ 红
  ④ 声明一个不存在的行为（scrollLock）⇒ 红
  ⑤ manual 数少于 budget（棘轮没同步）⇒ 红
  ⑥ 注入了却没调用核 ⇒ 红（在临时副本上做，不动工作区）
  每一次都必须被抓到。
============================================================================
"""
import io
import json
import os
import re
import shutil
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
AI = os.path.join(ROOT, 'ai')
MATRIX = os.path.join(AI, 'behaviors.json')
INJECT = 'BEHAVIOR INJECT BEGIN'
STATES = ('core', 'manual', 'gap', 'n/a')
SCAN_DIRS = ('02-primitives', '03-patterns', '04-recipes', '09-assets')


def comp_js():
    """所有组件 JS（按目录，排除第三方 vendor）"""
    out = []
    for d in SCAN_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for sub in sorted(os.listdir(base)):
            p = os.path.join(base, sub)
            if not os.path.isdir(p):
                continue
            for fn in sorted(os.listdir(p)):
                if fn.endswith('.js') and 'vendor' not in os.path.join(d, sub):
                    out.append('%s/%s/%s' % (d, sub, fn))
    return sorted(out)


def name_of(rel):
    """'03-patterns/list/flip.js' ⇒ 'flip'（用**文件名**，不是目录名 ——
        flip.js 在 list/ 下、toc.js 在 nav/ 下，用目录名会错配）"""
    return os.path.basename(rel)[:-3]


def uses_core(rel, beh):
    """是否真的用了核：有注入块 **且** 真的调用了它"""
    try:
        s = io.open(os.path.join(ROOT, rel), encoding='utf-8').read()
    except IOError:
        return False, '读不到文件'
    if INJECT not in s:
        return False, '源码里没有注入块'
    fn = 'fl' + ''.join(w.capitalize() for w in beh.split('-'))
    if not re.search(r'(?<![\w$.])' + fn + r'\s*\(', s):
        return False, '有注入块但没调用 %s()' % fn
    return True, ''


def check(data):
    bad = []
    behaviors = data.get('behaviors', {})
    matrix = data.get('matrix', {})
    budget = data.get('budget', {})

    comps = comp_js()
    by_name = {}
    for c in comps:
        by_name.setdefault(name_of(c), c)
    names = sorted(by_name)

    # ⑥ 行为名必须存在
    for beh in matrix:
        if beh not in behaviors:
            bad.append('矩阵里的行为「%s」在 behaviors 里没有定义（未知行为）' % beh)
    for beh in behaviors:
        if beh not in matrix:
            bad.append('行为「%s」在 matrix 里没有登记' % beh)

    counts = {'core': 0, 'manual': 0, 'gap': 0, 'n/a': 0}
    for beh in sorted(behaviors):
        cells = matrix.get(beh, {})
        for nm in names:
            if nm not in cells:                                    # ①
                bad.append('%s：组件「%s」没有登记（不许靠省略跳过）' % (beh, nm))
                continue
            cell = cells[nm]
            state = cell[0] if isinstance(cell, list) else cell
            why = cell[1] if isinstance(cell, list) and len(cell) > 1 else ''
            if state not in STATES:                                # ②
                bad.append('%s / %s：状态「%s」不在 %s 里' % (beh, nm, state, '/'.join(STATES)))
                continue
            counts[state] += 1
            if state == 'core':                                    # ③
                ok, why_not = uses_core(by_name[nm], beh)
                if not ok:
                    bad.append('%s / %s：声明 core，但 %s' % (beh, nm, why_not))
            elif not str(why).strip():                             # ④
                bad.append('%s / %s：状态 %s 必须写理由' % (beh, nm, state))
        for nm in cells:                                           # ⑥
            if nm not in names:
                bad.append('%s：矩阵里的组件「%s」在仓库里不存在' % (beh, nm))

    # ⑤ 棘轮
    for k in ('manual', 'gap'):
        cap = budget.get(k)
        if cap is None:
            bad.append('budget 缺 %s（棘轮上限必须显式写）' % k)
        elif counts[k] != cap:
            bad.append('%s 实际 %d ≠ budget %d ⇒ 棘轮要求两边一致（降了就把上限一起改小，'
                       '不许偷偷升）' % (k, counts[k], cap))
    return bad, counts


def run():
    data = json.loads(io.open(MATRIX, encoding='utf-8').read())
    return check(data)


def selftest():
    global ROOT
    raw = io.open(MATRIX, encoding='utf-8').read()
    cases = []

    def mk(why, fn):
        d = json.loads(raw)
        fn(d)
        cases.append((why, d))

    mk('声明 core 但源码没有（tooltip 的 dismissable 改成 core）',
       lambda d: d['matrix']['dismissable'].__setitem__('tooltip', ['core', '']))
    mk('删掉一个组件的登记（pagination 的 roving）',
       lambda d: d['matrix']['roving'].pop('pagination'))
    mk('n/a 不写理由',
       lambda d: d['matrix']['typeahead'].__setitem__('tabs', ['n/a', '']))
    mk('声明一个不存在的行为（scrollLock）',
       lambda d: d['matrix'].__setitem__('scrollLock', {'tabs': ['n/a', 'x']}))
    mk('manual 数与 budget 不一致（棘轮没同步）',
       lambda d: d['budget'].__setitem__('manual', 0))
    mk('状态写成不存在的值（maybe）',
       lambda d: d['matrix']['roving'].__setitem__('tabs', ['maybe', 'x']))

    bad = 0
    for why, d in cases:
        errs, _ = check(d)
        if errs:
            print('  [OK]   判据抓到突变：' + why)
        else:
            print('  [FAIL] 突变没被抓到 ⇒ 门禁是瞎的：' + why)
            bad += 1

    # ⑥ 「注入了却没调用核」要在**临时副本**上造，不动工作区
    src = os.path.join(ROOT, '03-patterns', 'tabs', 'tabs.js')
    original = io.open(src, encoding='utf-8').read()
    tmp = tempfile.mkdtemp(prefix='fl-matrix-')
    try:
        mirror = os.path.join(tmp, '03-patterns', 'tabs')
        os.makedirs(mirror)
        # ⚠️ 必须让 `flRoving(` 彻底消失：只换成 `_unused = flRoving({`
        #    仍然匹配正则 ⇒ 突变根本没生效，自检会**假绿**（I-10 实证 9）。
        broken = original.replace('this.roving = flRoving({',
                                  'this.roving = null; /* 忘了调用 */ var dead = ({', 1)
        if broken == original:
            print('  [FAIL] 造不出"注入了却没调用"的样本（源码形状变了）')
            bad += 1
        else:
            keep, ROOT = ROOT, tmp
            io.open(os.path.join(mirror, 'tabs.js'), 'w', encoding='utf-8', newline='').write(broken)
            d = json.loads(raw)
            errs, _ = check(d)
            ROOT = keep
            if any('没调用' in e for e in errs):
                print('  [OK]   判据抓到突变：注入了却没调用核')
            else:
                print('  [FAIL] 突变没被抓到 ⇒ 门禁是瞎的：注入了却没调用核')
                bad += 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    errs, counts = run()
    if errs:
        print('  [FAIL] 原样就有不通过的项 ⇒ 判据过严')
        for e in errs[:12]:
            print('        ' + e)
        bad += 1
    else:
        print('  [OK]   原样全绿（core %d · manual %d · gap %d · n/a %d）'
              % (counts['core'], counts['manual'], counts['gap'], counts['n/a']))
    return 1 if bad else 0


def main():
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    errs, counts = run()
    print('')
    print('  === 行为覆盖矩阵 ===')
    if errs:
        for e in errs:
            print('    X ' + e)
    else:
        print('    OK 18 个组件 × 4 种行为全部登记（不许靠省略跳过）')
        print('    OK core %d · manual %d（待收编）· gap %d（应做未做）· n/a %d'
              % (counts['core'], counts['manual'], counts['gap'], counts['n/a']))
    print('')
    if errs:
        print('  ❌ %d 项不满足' % len(errs))
        sys.exit(1)
    print('  ✅ 行为覆盖矩阵闭环')
    sys.exit(0)


if __name__ == '__main__':
    main()
