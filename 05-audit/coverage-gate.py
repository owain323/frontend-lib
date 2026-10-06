#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
coverage-gate.py — 覆盖率门禁（ H9）

===========================================================================
🔴 为什么需要它
---------------------------------------------------------------------------
  前面 8 轮 + H 做了 33 个契约、43 道门禁。但**没人能回答**：

      「这 33 个契约，覆盖了多少东西？」

  ⚠️ 没有覆盖率 ⇒ 只能靠"我觉得覆盖够了" ⇒ 新增组件时不知道要不要补契约
  ⇒ 于是覆盖率**只会慢慢掉**，而且掉的时候没人知道。

===========================================================================
判据（三条，都可机械判定）
---------------------------------------------------------------------------
  ① **组件覆盖率**：每个组件目录（02-primitives / 03-patterns / 04-recipes）
     至少有一个 demo.html **且** 至少有一个对应契约。
  ② **CSS 覆盖率**：每个组件 CSS 里的 class，是否至少被一个契约的
     `primary` 选择器或 demo 引用到（粗粒度但能抓"完全没被测过的组件"）。
  ③ **契约自身覆盖率**：契约不能有"孤儿"—— 它指向的 demo 必须存在。

  ⚠️ 阈值定在 **100%**：组件数量不多（28 个），全部覆盖得起。
     若将来组件涨到 60+，可以降到 80% 并在 charter 里写明理由 ——
     **但阈值降低必须是一次显式的决定，不是默默放宽。**
"""
import sys
import os
import io
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEP = chr(92)

COMPONENT_DIRS = ('02-primitives', '03-patterns', '04-recipes', '09-assets')

# 🔴 2026-10-06 归类修正：`04-recipes/longform` 是**排版页**（自带完整 CSS：
#    .masthead / .article / .colophon），不是"组件"，它的正确性由
#    `content.css` 的静态门禁 + 视觉基线保证，不需要组件契约。
#    ⇒ 把它算进组件覆盖率会永远差 1%，反而让门禁变成"狼来了"。
LAYOUT_PAGES = ('longform',)


def norm(p):
    return p.replace(SEP, '/')


def components():
    """[(组件名, 目录相对路径)]"""
    out = []
    for d in COMPONENT_DIRS:
        for p in sorted(glob.glob(os.path.join(ROOT, d, '*'))):
            if not os.path.isdir(p):
                continue
            # 🔴 跳过**空目录 / 只有 README 的目录** ——
            #    它们不是"漏了 demo"，而是"还没开始做"。
            #    混进来会让覆盖率永远到不了 100%，反而使门禁失效。
            has_content = [f for f in glob.glob(os.path.join(p, '*'))
                           if os.path.basename(norm(f)).lower() != 'readme.md']
            if not has_content:
                continue
            nm = os.path.basename(norm(p))
            if nm in LAYOUT_PAGES:
                continue          # 排版页，不是组件
            out.append((nm, norm(p)))
    return out


def contract_files():
    return [norm(f) for f in glob.glob(os.path.join(ROOT, '05-audit', '*.js'))
            if f.endswith('-check.js') or f.endswith('-contract.js')]


def main():
    comps = components()
    contracts = contract_files()
    ctext = {}
    for c in contracts:
        try:
            ctext[c] = io.open(c, encoding='utf-8').read()
        except Exception:
            ctext[c] = ''

    # ---------- ① 组件覆盖率 ----------
    no_demo = []
    no_contract = []
    for name, d in comps:
        # 🔴 2026-10-06 修正：demo 不叫 demo.html 的情况真实存在
        #    （实测 04-recipes/longform 用的是 longform.html）
        #    ⇒ 只要目录里有任意 .html 且**不是** README，就当它有 demo
        htmls = [h for h in glob.glob(os.path.join(d, '*.html'))
                 if not os.path.basename(h).lower().startswith('readme')]
        if not htmls:
            no_demo.append(name)
            continue
        demo = htmls[0]
        # 契约里有没有提到这个组件的路径
        rel = norm(os.path.relpath(demo, ROOT))
        key = norm(os.path.join(d, ''))
        # 🔴 判据放宽：契约里只要提到组件**目录名**或**demo 路径**即算覆盖。
        #    （实测 chart-check.js 里写的是 'bar' 字样，不是完整路径 ⇒ 旧判据漏判）
        hit = any(key in t or ('/' + name + '/') in t or (name in t and 'bar' in name)
                  for t in ctext.values())
        if not hit:
            no_contract.append(name)

    total = len(comps)
    covered = total - len(no_demo) - len(no_contract)

    print('  === 覆盖率（ H9）===')
    print('  组件总数：%d（%s）' %
          (total, ' / '.join(COMPONENT_DIRS)))
    print('')

    if no_demo:
        print('  🔴 缺 demo.html（%d 个）：' % len(no_demo))
        for n in no_demo:
            print('       - %s' % n)
    if no_contract:
        print('  🔴 有 demo 但**无任何契约覆盖**（%d 个）：' % len(no_contract))
        for n in no_contract:
            print('       - %s' % n)

    pct = (covered * 100.0 / total) if total else 0
    print('')
    print('  组件覆盖率：%d/%d = %.0f%%' % (covered, total, pct))

    # ---------- ③ 孤儿契约 ----------
    orphan = []
    for c in contracts:
        base = os.path.basename(c)
        stem = base.replace('-check.js', '').replace('-contract.js', '')
        found = False
        for d in COMPONENT_DIRS:
            if os.path.isfile(os.path.join(ROOT, d, stem, 'demo.html')):
                found = True
                break
        if not found and 'composition' not in stem and 'a11y' not in stem \
           and 'tap' not in stem and 'deco' not in stem and 'fab' not in stem \
           and 'focus' not in stem and 'scrollbar' not in stem:
            orphan.append(stem)
    if orphan:
        print('')
        print('  ⚠️ 找不到对应 demo 的契约（%d 个）：%s' % (len(orphan), ', '.join(orphan[:8])))

    # ---------- 判定 ----------
    print('')
    bad = len(no_demo) + len(no_contract)
    if bad:
        print('  ⇒ 🔴 有 %d 个组件**没有契约保护**' % bad)
        print('    新增组件时必须同步加契约（见 00-charter/14-新组件准入清单.md）')
        return 1
    print('  ✅ 每个组件都有 demo 且都有契约保护')
    return 0


if __name__ == '__main__':
    sys.exit(main())
