#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
reuse-check.py — 复用风险检查

**目标**：复用时不能有错。一个组件被抄进别的项目之后跑不起来，
比没有这个组件更糟 —— 使用者会先去怀疑自己的代码。

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


def strip_html_comments(html):
    """🔴 剥掉 HTML 注释（0.8.9 修 · 外部审计把本门禁的假绿修好后暴露）。

    实测踩到的：`09-assets/model-viewer/demo.html` 里有这么一段**注释**——
        <!-- 🔴 注意：这里**没有** <script src="three.min.js">
             3D 引擎是**点击后才加载**的 … -->
    而原来的正则 `<(?:link|script)[^>]*(?:href|src)="…"` 不看上下文，
    把注释里那句当成了真引用⇒ 报「引用的 three.min.js 不存在」。

    ⇒ 这是一个**判据错**，不是产品错：那个 script 确实不存在，正如注释所说。

    ⭐ 与我在 CSS 扫描上栽过的同一类：
       **扫代码必须先剥注释**，否则注释里的示例会变成"违规"。
    """
    return re.sub(r'<!--.*?-->', '\n', html, flags=re.S)


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

    # 🔴 剥注释再扫 —— 见 strip_html_comments 的说明（注释里的示例不是真引用）
    html = strip_html_comments(read(demo))
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
    # 🔴 0.8.9 修：README **代码块里自己定义**的类也算已定义。
    #   实测踩到：`03-patterns/states/README.md` 的"移除记录"一节里，
    #   文档明确说 `.js-delayed` 本库已移除、要使用者自己写，并给出实现：
    #       ```html
    #       <div class="state state--loading js-delayed">…
    #       ```css
    #       .js-delayed { visibility: hidden; }
    #   而判据只把 demo 里 `<link>` 的 CSS 算进 defined
    #   ⇒ 报「README 代码块用了未定义的 class」，是**误报**。
    #   ⚠️ 两次踩坑的记录：
    #      ① 第一版用 `<style>…</style>` 匹配 —— 这里的样式在 ```css 围栏里，
    #         不是 <style> 标签 ⇒ 没生效。
    #      ② 第二版图省事直接 `css_classes(md)` 把整篇 README 的 `.xxx`
    #         都算成"已定义" ⇒ **反向控制立刻失效**（注入一个真未定义的类也不报）。
    #         ⭐ 这就是"判据被削弱"的典型：修一个误报，顺手放过了真问题。
    #   ⇒ 正确做法：**只取代码块**，且只取有 CSS 形态的块。
    if md:
        for blk in re.findall(r'```(?:css|html)\n(.*?)```', md, re.S):
            defined |= css_classes(blk)
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

    # ---- 4. 精简档 自包含检查 ----
    # 🔴 范围与 tierA-gate 对齐（0.8.9 · 外部审计把假绿修好后暴露的判据打架）
    #   原来判据是 `'/04-recipes/' in mod_dir` ⇒ 把 analysis-report /
    #   data-showcase / report 的 **demo 页**也当成"精简档"，
    #   于是报出 3 处「精简档应内联 CSS」+ 3 处「外链了 JS」。
    #   ⇒ 但那些页面按设计就该外链库里的组件（改了库还要同步改 demo），
    #      本库真正承诺"零外链、可单文件拷走"的只有 `04-recipes/longform/`。
    #   ⚠️ 这是 E31「同一个判定逻辑写两份」的另一例：
    #      两个门禁对"谁是精简档"的口径必须一致，否则一个绿一个红互相打架。
    _mod_rel = os.path.relpath(mod_dir, ROOT).replace(os.sep, '/')
    if _mod_rel.startswith('04-recipes/longform'):
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
    # 🔴 参数约定（0.8.9 · 外部审计 P0-1）：`--` 开头的当 flag，不当路径。
    # 🔴 事故：check-all.sh 传 `--dir <目录列表>`，旧写法把 argv[1]
    #   （字面量 "--dir"）当 root ⇒ root=<cwd>/--dir 不存在
    #   ⇒ glob('0*/*') 扫到 0 个模块 ⇒ total=0 ⇒「无复用风险」判 PASS。
    raw = [a for a in sys.argv[1:] if not a.startswith('-')]
    roots = [a for a in raw if os.path.isdir(a)]
    # 🔴 传了路径但一个都不存在 ⇒ 明确报红
    if raw and not roots:
        print('❌ 传入的路径都不存在：%s' % raw)
        print('   这是**假绿**：不是"无复用风险"，是"什么都没检查"。')
        return 1
    # ⭐ 本脚本扫的是「带 demo.html 的模块目录」，它们按定义在 0*/ 之下，
    #   所以 root 恒为库根；位置参数只用来校验调用方是否真的想扫这一块。
    if roots and not any(
            any(seg.startswith('0') for seg in a.rstrip('/').replace('\\', '/').split('/'))
            for a in roots):
        print('❌ 传入的目录里没有组件/模式目录（0*）：%s' % roots)
        print('   本门禁只检查带 demo.html 的模块目录。')
        print('   （若只想全量检查，直接不带参数运行即可）')
        return 1
    root = ROOT
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
    print('（扫了 %d 个模块）' % len(mods))
    # 🔴 零文件守卫：扫到 0 个模块必须判红。
    #   这是本门禁被假绿吞掉的那一层—— 路径传错 ⇒ mods 为空
    #   ⇒「无复用风险」与真的全通过**输出完全一样**。
    if not mods:
        print('❌ 一个模块都没扫到 —— 这是**假绿**，本门禁不接受空扫描。')
        return 1
    if total:
        print('复用风险 %d 项 —— 别人照抄会踩' % total)
        return 1
    print('无复用风险。')
    if check_start_here():
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
