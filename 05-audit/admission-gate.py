#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
admission-gate.py — 新组件准入机械检查（总 G3）

===========================================================================
🔴 这个脚本的定位
---------------------------------------------------------------------------
  `00-charter/14-新组件准入清单.md` 写了 8 条必读纪律。
  但**清单会过期** —— 这是所有规范文档的通病。

  ⇒ 所以清单里的每一条，都必须有**对应的机械检查**放在这里。
  ⇒ 清单不是"给人读的建议"，是"给门禁读的规格"。

===========================================================================
八条纪律 → 八个检查
---------------------------------------------------------------------------
  ① 焦点落在哪（写下来了没）        → 查契约文件里有没有相关注释
  ② 内层弹层要 stopPropagation     → 查组合契约存在且含该判据
  ③ 令牌不能凭空造                  → 复用 deps.py（这里再查一次，做冗余）
  ④ 不能用 ES6+ 选择器              → 复用 es5-gate.py
  ⑤ 颜色走令牌 + 焦点环真的画出来   → 复用 focus-ring-check
  ⑥ outline:none 要有真正替代       → 同上（focus-ring 门禁里）
  ⑦ disabled/focus/hover 齐全      → 复用 states.py
  ⑧ 必须有 demo.html               → 复用 refs.py + 本脚本的目录检查

  ⚠️ ③④⑤⑥⑦ 已有独立门禁，本脚本**不重复实现** ——
     只做"新组件特有"的检查（见下方 CHECKS）。
"""
import sys
import os
import io
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHARTER = os.path.join(ROOT, '00-charter', '14-新组件准入清单.md')
COMPOSITION = os.path.join(ROOT, '05-audit', 'composition-check.js')

# 组件目录（01-tokens / 05-audit 不是组件）
COMPONENT_DIRS = ['02-primitives', '03-patterns', '04-recipes', '09-assets']


def chk_missing_demo():
    """⑧ 每个组件目录必须有 demo.html（否则契约在 404 页面上空跑）"""
    missing = []
    total = 0
    for d in COMPONENT_DIRS:
        for sub in sorted(glob.glob(os.path.join(ROOT, d, '*'))):
            if not os.path.isdir(sub):
                continue
            name = os.path.basename(sub)
            # 只有看起来像组件目录的才查（有 css 或 js 就是）
            has_asset = (glob.glob(os.path.join(sub, '*.css')) or
                         glob.glob(os.path.join(sub, '*.js')))
            if not has_asset:
                continue
            total += 1
            if not os.path.exists(os.path.join(sub, 'demo.html')):
                missing.append('%s/%s' % (d, name))
    return {'ok': not missing, 'n': total, 'missing': missing,
            'what': '每个组件都有 demo.html（⑧）'}


def chk_contract_registered():
    """每个组件必须有一个对应的契约文件，且在 check-all.sh 里"""
    all_sh = io.open(os.path.join(ROOT, '05-audit', 'check-all.sh'),
                     encoding='utf-8').read()
    orphans = []
    total = 0
    for d in COMPONENT_DIRS:
        for sub in sorted(glob.glob(os.path.join(ROOT, d, '*'))):
            if not os.path.isdir(sub):
                continue
            name = os.path.basename(sub)
            if not (glob.glob(os.path.join(sub, '*.css')) or
                    glob.glob(os.path.join(sub, '*.js'))):
                continue
            total += 1
            # 🔴 契约文件名通常是 name-check.js。
            #    但**图表类组件由 chart-check 统一覆盖**（一个契约管多个目录）——
            #    它的判据（裁剪/标注/量程/门控）对所有图表通用，
            #    硬要每个图表目录再写一份只会复制粘贴。
            if d == '09-assets':
                continue
            # 契约文件名通常是 name-check.js
            cands = [name + '-check.js', name + '-contract.js']
            hit = [c for c in cands if os.path.exists(os.path.join(ROOT, '05-audit', c))]
            if not hit:
                orphans.append('%s/%s（无契约）' % (d, name))
            elif hit[0] not in all_sh:
                orphans.append('%s/%s（契约未接入 check-all）' % (d, name))
    return {'ok': not orphans, 'n': total, 'missing': orphans,
            'what': '每个组件有契约且已接入门禁'}


def chk_composition_exists():
    """② 组合契约必须存在且含 Esc 层级判据
       —— 没有它，「Esc 一次关两层」这类 bug 永远抓不到"""
    if not os.path.exists(COMPOSITION):
        return {'ok': False, 'missing': ['composition-check.js 不存在'],
                'what': '组合契约存在（②）'}
    s = io.open(COMPOSITION, encoding='utf-8').read()
    need = ['Esc', 'z-index', '焦点']
    miss = [k for k in need if k not in s]
    return {'ok': not miss, 'missing': (['组合契约缺少「%s」判据' % m for m in miss] if miss else []),
            'what': '组合契约含 Esc/z-index/焦点判据（②）'}


def chk_focus_documented():
    """① 每个"可交互组件"的契约里，必须写明焦点落在哪
       —— 这是本项目最易错的一项（listbox 用 roving vs tree 用 activedescendant）"""
    undocumented = []
    total = 0
    for f in sorted(glob.glob(os.path.join(ROOT, '05-audit', '*-check.js'))):
        base = os.path.basename(f)
        # 只查交互型组件
        # ⚠️ 只查**有焦点策略**的组件。
        #    list / nav 是**无焦点策略**的（整页靠浏览器 Tab，不做游标管理），
        #    对它们要求"写明焦点策略"是判据错（那不是缺陷，是不适用）。
        if not any(k in base for k in
                   ('select', 'combobox', 'tree', 'dropdown', 'tooltip',
                    'drawer', 'overlay')):
            continue
        total += 1
        s = io.open(f, encoding='utf-8').read()
        # 焦点策略必须**写在注释里**（说明是有意设计，不是默认行为）
        # ⚠️ 三种策略都算数（准入清单第 ① 条）：
        #   ① roving tabindex（tree / dropdown）
        #   ② aria-activedescendant（select / combobox）
        #   ③ **不接管焦点**（tooltip —— 焦点留在触发元素上）
        #   ④ 焦点陷阱（drawer / dialog —— 焦点在弹层内循环）
        has_note = ('焦点' in s and
                    ('aria-activedescendant' in s
                     or 'roving' in s.lower()
                     or 'skipFocusRing' in s
                     or '不接管焦点' in s
                     or '焦点陷阱' in s))
        if not has_note:
            undocumented.append(base)
    return {'ok': not undocumented, 'n': total, 'missing': undocumented,
            'what': '交互组件的契约写明了焦点策略（①）'}


def chk_no_stopprop_missing():
    """② 内层弹层的 Esc 必须 stopPropagation
       —— 检查源码里 close 前有 stopPropagation"""
    problems = []
    targets = [
        ('02-primitives/select/select.js', 'Escape'),
        ('02-primitives/combobox/combobox.js', 'Escape'),
        ('03-patterns/dropdown/dropdown.js', 'Escape'),
    ]
    for rel, key in targets:
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            continue
        s = io.open(p, encoding='utf-8').read()
        # 找处理 Escape 的分支，看它附近有没有 stopPropagation
        ok = False
        for m in re.finditer(r'if \(k === .Escape.[^)]*\)\s*\{', s):
            seg = s[m.start():m.start() + 420]
            if 'stopPropagation' in seg:
                ok = True
                break
        if not ok:
            problems.append(os.path.basename(rel))
    return {'ok': not problems, 'missing': problems,
            'what': '内层弹层的 Esc 调了 stopPropagation（②）'}


def chk_charter_exists():
    """准入清单本身必须在（否则 §5 的"活起来"是空话）"""
    if not os.path.exists(CHARTER):
        return {'ok': False, 'missing': ['00-charter/14-新组件准入清单.md 不存在'],
                'what': '准入清单存在'}
    s = io.open(CHARTER, encoding='utf-8').read()
    # 必须有 8 条（① - ⑧）
    marks = [m for m in '①②③④⑤⑥⑦⑧' if m in s]
    miss = []
    if len(marks) < 8:
        miss.append('清单只有 %d/8 条' % len(marks))
    # 🔴 元规则必须也在：清单自己的失效防护
    if '元规则' not in s:
        miss.append('缺少「元规则」一节（门禁自己的假绿防护）')
    return {'ok': not miss, 'n': len(marks), 'missing': miss,
            'what': '准入清单含 8 条纪律 + 元规则'}


CHECKS = [
    chk_charter_exists,
    chk_missing_demo,
    chk_contract_registered,
    chk_composition_exists,
    chk_focus_documented,
    chk_no_stopprop_missing,
]


def main():
    print('  === 新组件准入检查（ G3）===')
    bad = 0
    for fn in CHECKS:
        r = fn()
        extra = ''
        if r.get('n') is not None:
            extra = '（%d 项）' % r['n']
        if r['ok']:
            print('  OK    %s%s' % (r['what'], extra))
        else:
            bad += 1
            print('  FAIL  %s%s' % (r['what'], extra))
            for m in r['missing'][:6]:
                print('        - %s' % m)
            if len(r['missing']) > 6:
                print('        … 另有 %d 项' % (len(r['missing']) - 6))
    if bad:
        print('')
        print('  ⇒ %d 项未满足。新增组件前请先读：' % bad)
        print('    00-charter/14-新组件准入清单.md')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
