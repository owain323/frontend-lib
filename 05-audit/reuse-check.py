#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
reuse-check.py — 复用风险检查

Owner 的要求：
> 「你再自己仔细的去审核一下每一个模块，主要是不能有错。
> 因为你现在错了，以后等于我们复用的时候，会出现很多的 bug。」

**复用时最常见的四种翻车，这个脚本逐条查：**

1. **照抄 README 的代码跑不起来** —— 代码块里的 class 在 CSS 里没定义
2. **漏引依赖文件** —— README 声明依赖 X，demo 根本没 link X（无样式）
3. **link 的路径不存在** —— 404，页面无样式（库自己踩过）
4. **精简档 页面不自包含** —— 内联了 CSS 却还外链，部署到 某项目 就挂

🔴 **这个脚本查不了的**（必须人看）：
   - 文档说的和实际做的语义是否一致
   - API 设计是否合理
   - 降级路径是否真能工作
"""

import sys
import os
import re
import glob
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(p):
    with open(p, encoding='utf-8', errors='replace') as f:
        return f.read()


def css_classes(css):
    return set(re.findall(r'\.([a-zA-Z_][\w-]*)', css))


def classes_in_html(html):
    out = set()
    for m in re.finditer(r'class="([^"]+)"', html):
        out.update(m.group(1).split())
    return out


def md_code_blocks(md):
    """取 ``` 围栏里的代码块"""
    return re.findall(r'```[a-zA-Z]*\n(.*?)```', md, re.S)


def check_module(mod_dir):
    """一个模块 = 一个含 demo.html 的目录"""
    problems = []
    demo = os.path.join(mod_dir, 'demo.html')
    readme = os.path.join(mod_dir, 'README.md')
    if not os.path.isfile(demo):
        return problems

    html = read(demo)
    md = read(readme) if os.path.isfile(readme) else ''

    # ---- 1. link/script 路径是否存在 ----
    for m in re.finditer(r'<(?:link|script)[^>]*(?:href|src)="([^"]+)"', html):
        ref = m.group(1)
        if ref.startswith(('http://', 'https://', '//', 'data:', '#')):
            continue
        target = os.path.normpath(os.path.join(mod_dir, ref))
        if not os.path.isfile(target):
            problems.append(('missing-asset',
                '引用的 %s 不存在（页面会无样式或 JS 报错）' % ref))

    # ---- 2. README 声明的依赖 vs demo 实际 link ----
    # 依赖行形如：| **依赖** | `01-tokens/tokens.css` + `02-primitives/...` |
    m = re.search(r'\|\s*\*\*依赖\*\*\s*\|([^|]*)\|', md)
    if m:
        declared = re.findall(r'`([^`]+\.css|[^`]+\.js)`', m.group(1))
        for d in declared:
            base = os.path.basename(d)
            if base not in html:
                problems.append(('undeclared-vs-unlinked',
                    'README 声明依赖 %s，但 demo 没有 link 它 —— '
                    '照 README 的人会漏掉' % d))

    # ---- 2b. 反方向：demo 用了但 README 没声明的依赖 ----
    #     上面查的是"声明了有没有 link"；这条查"link 了有没有声明"。
    #     复用者照 README 抄依赖，demo 偷偷多用的那一个就漏了。
    m = re.search(r'\|\s*\*\*依赖\*\*\s*\|([^|]*)\|', md)
    if m and '**依赖**' in md:
        declared = set(os.path.basename(x)
                       for x in re.findall(r'`([^`]+\.(?:css|js))`', m.group(1)))
        used = set()
        for mm in re.finditer(r'<(?:link|script)[^>]*(?:href|src)="([^"]+\.(?:css|js))"', html):
            used.add(os.path.basename(mm.group(1)))
        # 本模块自己的文件（button/button.css、list/flip.js …）不算外部依赖 ——
        # 复用时你本来就在用这个组件。
        own = set(os.listdir(mod_dir))
        for u in sorted(used - declared):
            if u in own:
                continue
            if u.startswith(('_', 'demo', 'app')):
                continue
            problems.append(('linked-but-undeclared',
                'demo 用了 %s，但 README 的「依赖」里没声明 —— '
                '照 README 抄的人会漏掉这个' % u))

    # ---- 3. README 代码块里的 class 是否有定义 ----
    # 只查 html 代码块（css 代码块里的 class 定义不算"使用"）
    linked_css = []
    for m in re.finditer(r'<link[^>]*href="([^"]+\.css)"', html):
        p = os.path.normpath(os.path.join(mod_dir, m.group(1)))
        if os.path.isfile(p):
            linked_css.append(read(p))
    # 页面里 <style> 内联的
    for m in re.finditer(r'<style[^>]*>(.*?)</style>', html, re.S):
        linked_css.append(m.group(1))
    defined = set()
    for c in linked_css:
        defined |= css_classes(c)
    if md:
        for blk in md_code_blocks(md):
            if '<html' not in blk and '<div' not in blk and '<button' not in blk:
                continue
            used = classes_in_html(blk)
            missing = {c for c in used
                       if c not in defined and not c.endswith('__')}
            if missing:
                problems.append(('doc-class-undefined',
                    'README 代码块用了未定义的 class：%s'
                    % ', '.join(sorted(missing))))

    # ---- 4. 精简档 自包含检查（04-recipes 下的单文件必须自包含）----
    if '/04-recipes/' in mod_dir.replace('\\', '/'):
        inline = re.search(r'<style[^>]*>(.*?)</style>', html, re.S)
        ext_css = re.findall(r'<link[^>]*href="([^"]+\.css)"', html)
        ext_js = re.findall(r'<script[^>]*src="([^"]+\.js)"', html)
        if not inline and ext_css:
            problems.append(('tierA-not-inline',
                '精简档 页面应内联 CSS（部署到 某项目 无外链）'))
        if ext_js:
            problems.append(('tierA-ext-js',
                '精简档 页面外链了 JS：%s（单文件部署会 404）'
                % ', '.join(ext_js)))

    return problems


def check_start_here():
    """START-HERE.md 是给复用者看的入口 —— 里面的路径必须都存在。

    🔴 为什么必须查：它是"抄哪个文件"的唯一指引。
    如果它指向不存在的文件（就像之前 charter 指向不存在的 `[核心]` 段），
    复用者照着做只会找不到 —— 而且没有任何门禁会报。
    """
    import re
    p = os.path.join(ROOT, 'START-HERE.md')
    if not os.path.isfile(p):
        print('  [start-here] 没有 START-HERE.md')
        return 1
    src = open(p, encoding='utf-8').read()
    paths = re.findall(r'`((?:0[1-8]-|index)[^`]*?\.(?:css|js))`', src)
    paths += re.findall(r'`((?:0[1-8]-)[^`]*?/)`', src)
    missing = []
    for rel in sorted(set(paths)):
        full = os.path.join(ROOT, rel.rstrip('/'))
        if not os.path.exists(full):
            missing.append(rel)
    for m in missing:
        print('  [start-here] 指向不存在的路径: %s' % m)
    if not missing:
        print('  [start-here] %d 个引用路径全部存在' % len(set(paths)))
    return 1 if missing else 0


def main():
    root = ROOT if len(sys.argv) < 2 else os.path.abspath(sys.argv[1])
    mods = []
    for d in glob.glob(os.path.join(root, '0*', '*')) + \
             glob.glob(os.path.join(root, '0*', '*', '*')):
        if os.path.isfile(os.path.join(d, 'demo.html')):
            mods.append(d)
    mods = sorted(set(mods))

    total = 0
    for m in mods:
        probs = check_module(m)
        rel = os.path.relpath(m, root).replace('\\', '/')
        if not probs:
            print('OK   %s' % rel)
            continue
        total += len(probs)
        print('FAIL %s' % rel)
        for kind, msg in probs:
            print('       [%s] %s' % (kind, msg))

    print()
    if total:
        print('复用风险 %d 项 —— 别人照抄会踩' % total)
        return 1
    print('无复用风险。')
    if check_start_here():
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
