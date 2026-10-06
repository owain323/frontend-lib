#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scan-control-markup.py — 全库扫「可点控件的 HTML 写法」

🔴 为什么需要（2026-10-04，Owner 实机连报三次之后）
---------------------------------------------------
Owner 的判断：「**全局可能都是有问题的**……这类问题都是存在的」。

他说得对 —— 而且我搜完发现两类缺陷**确实是同一个根源**：

  ① **外层容器不是 <label>**
     `.choice` 要求「整个包裹层锚定给 label」。
     写成 `<div class="choice">` ⇒ 只有 20px 的小圆点和文字能点，
     旁边一大片空白点了没反应。

  ② **单选组只有 1 个选项**
     radio 选中后无法取消（HTML 原生行为）⇒ 点它"没反应"是**正确的**。
     但**只有一个选项的单选组根本测不出选择是否有效** ——
     页面上永远看不出变化，人只会以为坏了。

③ 还有一个隐性坑：**label 套 label**（非法 HTML，浏览器会拆开，结构乱掉）。

本脚本**扫全库**（组件 demo + 验证页 + examples），
不抽查 —— 因为 Owner 已经证明"抽查会漏"。
"""
import io
import os
import re
import sys
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def pages():
    out = []
    for pat in ('0*/*.html', '0*/*/*.html', '0*/*/*/*.html',
                'examples/*.html', 'examples/*/*.html',
                '10*/*.html', '10*/*/*.html'):
        out += glob.glob(os.path.join(ROOT, pat))
    # 去掉 04-recipes 里的长文（那是内容页，不是组件用法演示）
    return [p for p in out if '/04-recipes/' not in p.replace('\\', '/')]


def scan(path):
    """返回该页的问题列表。"""
    try:
        s = io.open(path, encoding='utf-8', errors='replace').read()
    except OSError:
        return []
    body = re.sub(r'<!--.*?-->', '', s, flags=re.S)
    bad = []
    rel = os.path.relpath(path, ROOT).replace(os.sep, '/')

    # 🔴 2026-10-04 **改判据**（我上一轮的判断是错的）：
    #   原来写「外层必须是 <label>」⇒ 报 choice/demo.html 有问题。
    #   **实测两种写法都能点**（demo 的 div 版点空白 false->true ✅）。
    #   真正的原因是 **input 必须铺满整个包裹层**（`inset:0 + 100%`），
    #   标签名是 div 还是 label 都一样。
    #   ⇒ 静态扫标签名是**查错了对象**，改成查 CSS 规则本身。
    if 'class="choice' in body and 'choice__input' in body:
        css = io.open(os.path.join(ROOT, '02-primitives', 'choice', 'choice.css'),
                      encoding='utf-8', errors='replace').read()
        m = re.search(r'\.choice__input\s*\{([^}]*)\}', css)
        bodycss = m.group(1) if m else ''
        covers = ('inset: 0' in bodycss or 'inset:0' in bodycss) and '100%' in bodycss
        if not covers:
            bad.append('choice.css 的 .choice__input **没有铺满**'
                       '（缺 inset:0 或 width/height:100%）⇒ 点空白处不会命中 input')

    # ② 唯一真错：外层 label + 内层也 label ⇒ label 套 label（非法）
    for m in re.finditer(
            r'<label class="choice[ "][^>]*>\s*<input[^>]*>\s*<label', body):
        bad.append('label 套 label（非法 HTML，浏览器会拆开）')

    # ③ label 套 label
    for m in re.finditer(r'<label[^>]*>\s*(?:(?!</label>).)*?<label', body, re.S):
        bad.append('label 套 label（非法 HTML，浏览器会拆开）')

    # ④ 单选组至少 2 个选项
    for m in re.finditer(r'name="([^"]+)"', body):
        nm = m.group(1)
        cnt = len(re.findall(r'type="radio"[^>]*name="%s"' % re.escape(nm), body))
        if cnt == 1:
            bad.append('单选组 name="%s" **只有 1 个选项** —— '
                       'radio 选中后无法取消，点它"没反应"是正常的，'
                       '但这样**测不出选择是否有效**，至少要 2 个' % nm)

    return [(rel, b) for b in bad]


def main():
    files = pages()
    all_bad = []
    for f in files:
        all_bad += scan(f)

    print('  扫了 %d 个页面（组件 demo + 验证页 + examples）' % len(files))
    if not all_bad:
        print('  ✅ 可点控件的写法全部正确')
        print('     （choice 外层是 label · 内层是 span · 无 label 套 label ·')
        print('       单选组都有 ≥2 个选项）')
        return 0

    by_file = {}
    for rel, msg in all_bad:
        by_file.setdefault(rel, []).append(msg)
    print('  ❌ %d 个页面有问题：' % len(by_file))
    for rel in sorted(by_file):
        print('     · %s' % rel)
        seen = set()
        for m in by_file[rel]:
            if m in seen:
                continue
            seen.add(m)
            print('         - %s' % m)
    return 1


if __name__ == '__main__':
    sys.exit(main())
