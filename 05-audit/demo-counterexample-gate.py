#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""demo-counterexample-gate.py —— 每个组件都必须有「能看见的」反例。

为什么要有这道门禁
==================
文档里写「❌ 不要 hover 改 border-width」是一句话；
把那个抖动的卡片**摆出来**是另一回事 —— 后者读者一眼就懂，前者要想象。

2026-10-30 在 HEAD 快照上量过（不是估计）：带 demo 的 32 个组件里，
**22 个**一个可见的反例块都没有 —— 也就是只有 10 个真的摆出来了。
文字反例那时已经 33/33（`do-dont-gate.py` 守着 README），
但**能看见的只有 10/32** —— 而这一维评审的原话是
「内嵌 + 变体/状态并排 + do–don't 是唯一路径」。
只写不看，等于回到"渲染出来的 README"。

所以这道门禁守的是：**反例必须以可渲染的块出现在 demo 里**。

它判什么
========
  ① 组件有 demo.html（没有就红 —— 不然这条判据可以被"删掉 demo"绕过）
  ② 至少一个反例块：`class` 里同时有 `box` 和 `bad`，或有 `cmp__bad`
  ③ 块是**可见**的：不许 `hidden`、不许内联 `display:none`
     —— 藏起来的反例等于没有；而且要防的是"写了个块但不敢让人看"
  ④ 块里的头 400 个字符内必须有 `<h2>` / `<h3>` 标题
     —— 一块不知道错在哪的坏样子，比没有更让人困惑

它**不判**什么（判不了就说不判，不假装判了）
===========================================
· 反例是不是**真的**错 —— 这是判断题。写错的反例比没写更糟，
  但那需要人读源码核对（`internal/ERRORS.md` 里有专门一条）。
· 反例与本库说法是否一致 —— 同上。
· 反例的坏样子是否**看得出来** —— "看起来一样"要靠人眼，
  自动化只能保证块在、可见、有标题。

判据的边界写在上面，是因为一道判据最危险的时刻，
是它绿了之后有人以为它证明了更多东西。
"""
import os
import re
import sys
import importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAYERS = ('02-primitives', '03-patterns', '04-recipes')

TAG_RE = re.compile(r'<(div|section)\b[^>]*>', re.I)
HEAD_RE = re.compile(r'<h[23]\b[^>]*>(.*?)</h[23]>', re.S | re.I)
LOOKAHEAD = 400


def components():
    for layer in LAYERS:
        d = os.path.join(ROOT, layer)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            comp = os.path.join(d, name)
            if os.path.isdir(comp):
                yield layer, name, comp


def layout_pages():
    """排版页名单的**唯一**定义在 `coverage-gate.py`（那里写清了为什么）。

    不在这里写第二份：两份名单迟早分叉 —— 这个库已经在"平台名"上
    踩过一次（视觉基线目录名与门禁里的表各写一份）。
    """
    spec = importlib.util.spec_from_file_location(
        '_coverage_gate', os.path.join(ROOT, '05-audit', 'coverage-gate.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return tuple(getattr(mod, 'LAYOUT_PAGES', ()))


def is_bad_block(tag):
    m = re.search(r'class\s*=\s*"([^"]*)"', tag, re.I)
    if not m:
        return False
    cls = m.group(1).split()
    return ('box' in cls and 'bad' in cls) or 'cmp__bad' in cls


def check_html(html):
    """返回问题列表（空 = 通过）。"""
    blocks = [m for m in TAG_RE.finditer(html) if is_bad_block(m.group(0))]
    if not blocks:
        return ['没有任何可见的反例块（`class="box bad"` 或 `cmp__bad`）'
                ' —— 反例只在 README 里写着，读者看不见']

    problems = []
    for m in blocks:
        tag = m.group(0)
        snippet = re.sub(r'\s+', ' ', tag)[:70]

        # ③ 可见性：藏起来的反例等于没有
        if re.search(r'\bhidden\b', tag, re.I) or \
           re.search(r'display\s*:\s*none', tag, re.I):
            problems.append('反例块被藏起来了：%s' % snippet)

        # ④ 必须有标题，否则读者不知道这块错在哪
        head = HEAD_RE.search(html, m.end(), m.end() + LOOKAHEAD)
        if not head:
            problems.append('反例块没有标题（`<h2>` / `<h3>`）：%s' % snippet)
        else:
            text = re.sub(r'<[^>]+>', '', head.group(1))
            text = re.sub(r'\s+', ' ', text).strip()
            if len(text) < 2:
                problems.append('反例块的标题是空的：%s' % snippet)
    return problems


def main():
    if '--selftest' in sys.argv:
        return selftest()

    bad = 0
    total = 0
    pages = layout_pages()
    for layer, name, comp in components():
        demo = os.path.join(comp, 'demo.html')
        if not os.path.isfile(demo):
            if name in pages:
                # 排版页没有 demo.html —— 它不是组件，正确性由 content.css 的
                # 静态门禁 + 视觉基线保证（理由写在 coverage-gate.py 里）。
                print('  ---- %s/%s  排版页，不计入' % (layer, name))
                continue
            print('  FAIL %s/%s  没有 demo.html' % (layer, name))
            bad += 1
            continue
        total += 1
        with open(demo, 'r', encoding='utf-8', errors='replace') as fh:
            html = fh.read()
        problems = check_html(html)
        if problems:
            bad += 1
            print('  FAIL %s/%s' % (layer, name))
            for p in problems:
                print('       · %s' % p)

    if bad:
        print('  ⇒ %d / %d 个组件没有可见的反例块' % (bad, total))
        print('    反例要摆出来，不要只写在 README 里 —— '
              '读者看不见"错的样子"就学不到边界')
        return 1
    print('  %d 个组件都有可见、有标题的反例块' % total)
    return 0


# ============================ 反向控制 ============================
# 每条用例都必须**在反例上失败**（能红的用例才有鉴别力）。
OK_BOX = '''<h2>示例</h2>
<div class="box bad">
  <h3>反例：用 div 当按钮</h3>
  <p>点了没反应，Tab 也到不了。</p>
</div>
'''
OK_CMP = '''<div class="cmp">
  <div class="cmp__pane cmp__bad">
    <h3>常见写法</h3>
    <p>纯红边框，只靠颜色。</p>
  </div>
  <div class="cmp__pane cmp__good">
    <h3>本库写法</h3>
  </div>
</div>
'''
NO_BLOCK = '''<h2>示例</h2>
<div class="box">
  <p>只有正例。</p>
</div>
'''
HIDDEN = '''<div class="box bad" style="display:none">
  <h3>反例</h3>
</div>
'''
NO_HEAD = '''<div class="box bad">
  <p>一块不知道错在哪的坏样子。</p>
</div>
'''
EMPTY_HEAD = '''<div class="box bad">
  <h3> </h3>
</div>
'''
GOOD_PANE_ONLY = '''<div class="cmp">
  <div class="cmp__pane cmp__good">
    <h3>本库写法</h3>
  </div>
</div>
'''


def selftest():
    cases = [
        ('① box bad + 标题 → 放行',              OK_BOX,        False),
        ('② cmp__bad + 标题 → 放行',             OK_CMP,        False),
        ('③ 只有正例 → 要红',                    NO_BLOCK,      True),
        ('④ 反例被 display:none 藏起来 → 要红',   HIDDEN,        True),
        ('⑤ 反例块没有标题 → 要红',               NO_HEAD,       True),
        ('⑥ 反例块标题是空白 → 要红',             EMPTY_HEAD,    True),
        ('⑦ 只有 cmp__good 那半边 → 要红',        GOOD_PANE_ONLY, True),
    ]
    fail = 0
    for label, html, want_bad in cases:
        problems = check_html(html)
        got_bad = bool(problems)
        ok = got_bad == want_bad
        print('  %s %s%s' % ('OK  ' if ok else 'FAIL', label,
                             '' if ok else '  ← 期望%s，实际%s'
                             % ('红' if want_bad else '绿',
                                '红' if got_bad else '绿')))
        if problems:
            print('       抓到：%s' % problems[0])
        fail += 0 if ok else 1
    print('')
    if fail:
        print('  ⇒ 自检 %d 条不过 —— 这道门禁自己都不可信，别拿它当判据' % fail)
        return 1
    print('  自检 %d 条全过（其中 %d 条必须红）'
          % (len(cases), sum(1 for c in cases if c[2])))
    return 0


if __name__ == '__main__':
    sys.exit(main())
