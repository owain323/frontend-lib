#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
prefix-build.py — 生成带命名空间前缀的 CSS 副本

===========================================================================
🔴 为什么需要这个工具（K5）
---------------------------------------------------------------------------
  本库用短类名（`.btn` / `.card` / `.list` / `.input` / `.badge`）。
  放进真实项目时很可能与宿主已有样式**撞名**：

      宿主:  .btn { border-radius: 2px; }     ← 你的按钮被改圆角
      或者: .card { display: flex; }          ← 你的卡片布局被改

  业界做法：
    · Radix —— 不管主题，但把 part / state 用 class 与 data-state 暴露给宿主
    · 供应商例如素材库都会提供空间化命名（不尽为同一事实）
    · WebKit —— 全部收进 shadow DOM（对本库不适用，太重）

  ⭐ 本库的做法：**保持短名，同时提供一个"加前缀"的构建工具**。
     使用者不想改源码、也不想让宿主改，就跑一次这个脚本。

===========================================================================
用法
---------------------------------------------------------------------------
  python3 05-audit/prefix-build.py --prefix fl
      → 在 prefixed/ 下生成一份带前缀的 CSS 副本（源码不动）

  python3 05-audit/prefix-build.py --check
      → 只检查：列出所有会被改写的选择器（预览）

===========================================================================
⭐ 必须**整套替换**（2026-10-06 实测确认）
---------------------------------------------------------------------------
  早期版本只改CSS，被评为"危险的半解决方案"—— 这个判断是对的。
  实测证据（同一页面，只换 CSS 不换 JS/HTML）：

      pagination 元素   class="pagination"   display: block   ← 样式失效
      pagination 元素   class="fl-pagination" display: flex   ← 样式生效

  因为 CSS 里已经是 .fl-pagination，而页面元素仍是 pagination，
  **一条规则都匹配不上，而且没有任何报错**。
  ⇒ 类名分布在三层，缺任一层就静默失效：
      CSS  层：样式规则写的是什么
      JS   层：classList.add('x') / className / innerHTML 里的类名
      HTML 层：demo 与验证页里 class="x"

===========================================================================
⚠️ 仍然存在的限制（诚实说明）
---------------------------------------------------------------------------
  本工具做的是**文本级**替换，对以下情况无效：
    · 运行时从外部数据源来的类名（后端返回的 class 名）
    · 跨组件选择器里多个类名同时出现的顺序问题
  ⇒ 真正稳妥的做法仍是让**宿主改自己的类名**，或用构建工具的 CSS Modules。
  本工具的价值是**给无法改动宿主的场景一个逃生口**。
===========================================================================
"""
import argparse
import io
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_DIRS = ['02-primitives', '03-patterns', '04-recipes', '09-assets']
CSS_DIRS = ('01-tokens', '02-primitives', '03-patterns', '04-recipes', '09-assets')

# 这些目录整体复制但**不改写**（第三方代码不该动）
VERBATIM = ('09-assets/model-viewer/vendor',)

# 需要加前缀的 class（顶层块名，即 BEM 里的「块」）
# ⭐ 规则：含 `--` 的是「元素/变体」，跟在块名后面，不用单独处理；
#    只改写**块名**，元素与变体自动跟着变（因为它们以块名开头）。
SKIP_BLOCKS = {
    # 通用工具类：任何项目都有同名约定，改了反而破坏宿主的预期
    'is-open', 'is-active', 'is-disabled', 'is-leaving', 'is-locked',
    'sr-only',
    # ★ 文件名与非选择器（不是 class）
    'css', 'js',
}


def collect_blocks():
    """扫出所有顶层块名"""
    blocks = set()
    for d in CSS_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for sub in os.listdir(base):
            for cand in (os.path.join(base, sub, sub + '.css'),
                         os.path.join(base, sub + '.css')):
                if not os.path.isfile(cand):
                    continue
                try:
                    s = io.open(cand, encoding='utf-8').read()
                except Exception:
                    continue
                # ★ 只在代码里找（剔掉注释）——
                #    否则会把文件名归一个段（如 .css）当成 class
                code = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
                for m in re.finditer(r'\.([a-zA-Z][\w-]*)', code):
                    name = m.group(1)
                    if name in SKIP_BLOCKS:
                        continue
                    if len(name) > 24:
                        continue
                    blocks.add(name)
    return sorted(blocks)


def rewrite_js(blocks, prefix, out_root):
    """🔴 同时改写行为脚本里的类名 —— 否则加了前缀组件直接坏掉。

    ┌────────────────────────────────────────────────────────────┐
    │ 为什么必须做这一步（2026-10-06 实测）                      │
    │   只改 CSS 时：CSS 里是 .fl-dialog，JS 里仍然是 'dialog'，│
    │   运行时 class 名对不上 ⇒ **样式全部失效**，               │
    │   而且**没有任何报错** —— 最难查的一类坏。│
    └────────────────────────────────────────────────────────────┘

    ⚠️ 替换必须**极保守**，宁可漏改不可错改：
      · 只在明确的类名上下文里改（classList / className / innerHTML / querySelector）
      · 用**词边界**保证 .btn 不会匹配到 .btn-group
      · 跳过注释（注释里说的是「原理说明」，不是类名）
      · 改完立刻做语法校验（node --check）
    """
    if not blocks:
        return 0

    # 最长优先：.btn-group 要在 .btn 之前
    names = sorted(blocks, key=len, reverse=True)
    alt = '|'.join(re.escape(b) for b in names)

    # 三种上下文，各自的替换范围不同
    rules = [
        # classList.add/remove/toggle('x') / className = 'x'
        re.compile(r"""(classList\.(?:add|remove|toggle)\(\s*['"])(%s)(['"])""" % alt),
        re.compile(r"""(className\s*=\s*['"])(%s)(['"])""" % alt),
        # innerHTML / html 里嵌的 class="x y z"
        re.compile(r"""(class=\\?["'\\]*\s)([a-z][a-z0-9_\- ]*)"""),
        # 🔴 选择器里的 .name —— 必须排除属性访问与链式调用
        #   实测踩过：`this.tablist = root.querySelector(...)` 被当成
        #   选择器 .tablist 改成了 this.fl-tablist ⇒ SyntaxError。
        #   判据：点前面**不能紧跟标识符字符**（那多半是属性名或链式调用）。
        re.compile(r"""(?<![\w$])(\.)(%s)\b""" % alt),
        # ④ 引号里单独出现的类名（含前后空白或引号边界）
        #    ⚠️ 用前后断言语境，而不是「引号内任意位置」——
        #    否则 'text/plain'、'aria-hidden' 会被误改。
        re.compile(r"""(['"])(%s)(\1)""" % alt),
    ]
    cls_in_attr = re.compile(r'\b(' + alt + r')\b')

    n = 0
    for d in JS_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for sub in sorted(os.listdir(base)):
            src_dir = os.path.join(base, sub)
            cand = os.path.join(src_dir, sub + '.js')
            if not os.path.isdir(src_dir) or not os.path.isfile(cand):
                continue
            s = io.open(cand, encoding='utf-8').read()
            # 跳注释（整行 // 与 /* */ 块）
            parts = re.split(r'(/\*.*?\*/|(?:^|[^:])\s//[^\n]*)', s, flags=re.S)
            for i in range(0, len(parts), 2):      # 偶数 = 代码段
                code = parts[i]
                # ① classList.xxx('name') 与 className = 'name'
                code = rules[0].sub(
                    lambda m: m.group(1) + prefix + '-' + m.group(2) + m.group(3),
                    code)
                code = rules[1].sub(
                    lambda m: m.group(1) + prefix + '-' + m.group(2) + m.group(3),
                    code)
                # ② HTML 片段里的 class="a b c"
                def _fix_attr(m):
                    head, body = m.group(1), m.group(2)
                    return head + cls_in_attr.sub(
                        lambda x: prefix + '-' + x.group(1), body)
                code = rules[2].sub(_fix_attr, code)
                # ③ 选择器里的 .name（group1='.' group2=类名）
                code = rules[3].sub(
                    lambda m: m.group(1) + prefix + '-' + m.group(2), code)
                # ④ 🔴 引号里**单独出现**的类名（group1=引号 group2=类名）
                #    实测漏掉的形态（dropdown.js 第 79 行）：
                #      li.className + ' dd__item'      ← 字符串拼接
                #      indexOf('dd__item') < 0        ← 存在性检查
                #    两者都不是 classList.add / className =单值，
                #    前面的规则全都覆盖不到 ⇒ JS 改写后仍会丢样式。
                #    判据：引号内**只有**一个类名（前后是空白或引号边界），
                #    这样不会误伤 'text/plain'、'aria-hidden' 之类的普通字符串。
                code = rules[4].sub(
                    lambda m: m.group(1) + prefix + '-' + m.group(2) + m.group(1),
                    code)
                parts[i] = code
            out = os.path.join(out_root, d, sub, os.path.basename(cand))
            if not os.path.isdir(os.path.dirname(out)):
                os.makedirs(os.path.dirname(out))
            io.open(out, 'w', encoding='utf-8', newline='').write(''.join(parts))
            n += 1

    # 🔴 语法校验：改写JS 最怕把引号/括号弄坏而无人发现
    node = shutil.which('node')
    if node:
        bad = []
        for d in JS_DIRS:
            base = os.path.join(out_root, d)
            if not os.path.isdir(base):
                continue
            for sub in sorted(os.listdir(base)):
                f = os.path.join(base, sub, sub + '.js')
                if not os.path.isfile(f):
                    continue
                p = subprocess.run([node, '--check', f],
                                   capture_output=True)
                if p.returncode != 0:
                    bad.append(f.replace(os.sep, '/'))
        if bad:
            print('  🔴 JS 改写破坏了语法（%d 个文件）：' % len(bad))
            for b in bad[:6]:
                print('     %s' % b)
            return -1
        print('  ✓ 改写后的 JS 语法全部通过')
    return n


def rewrite_html(blocks, prefix, out_root):
    """🔴 同样改写 demo/验证页里的 class —— 这是**第三层**，漏了就白改。

    ┌────────────────────────────────────────────────────────────┐
    │ 实测证据（2026-10-06）│
    │   只改 CSS+JS 时，浏览器里 `.fl-dd__menu` 规则被解析了38 条，│
    │   但页面上元素仍是 `class="dd__menu"` ⇒ **一条都没匹配上**。│
    │   组件看起来完全没样式。│
    └────────────────────────────────────────────────────────────┘

    ⚠️ 只改 class 属性值里的**整词**，不动 data-* 属性与脚本内容
       （demo 页里的 <script> 会调组件 API，不需要改）。
    """
    if not blocks:
        return 0
    alt = '|'.join(re.escape(b) for b in blocks)
    # class="a b c" —— 逐词替换
    cls_attr = re.compile(r'(\sclass\s*=\s*")([^"]*)(")')
    word = re.compile(r'\b(' + alt + r')\b')

    n = 0
    for d in JS_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for sub in sorted(os.listdir(base)):
            cand = os.path.join(base, sub, 'demo.html')
            if not os.path.isfile(cand):
                continue
            s = io.open(cand, encoding='utf-8').read()
            out = cls_attr.sub(
                lambda m: m.group(1)
                + word.sub(lambda x: prefix + '-' + x.group(1), m.group(2))
                + m.group(3),
                s)
            dst = os.path.join(out_root, d, sub, 'demo.html')
            if not os.path.isdir(os.path.dirname(dst)):
                os.makedirs(os.path.dirname(dst))
            io.open(dst, 'w', encoding='utf-8', newline='').write(out)
            n += 1
    return n


def build(prefix):
    """生成带前缀的副本"""
    out_root = os.path.join(ROOT, 'prefixed')
    if os.path.isdir(out_root):
        shutil.rmtree(out_root)

    blocks = collect_blocks()
    if not blocks:
        print('  没找到任何 class')
        return 1
    # 最长优先，避免 .btn 抢先匹配掉 .btn-group
    pattern = re.compile(
        r'\.(' + '|'.join(re.escape(b) for b in sorted(blocks, key=len,
                                                    reverse=True)) + r')\b')

    n = 0
    for d in CSS_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for sub in sorted(os.listdir(base)):
            src_dir = os.path.join(base, sub)
            if not os.path.isdir(src_dir):
                continue
            if any(src_dir.replace(os.sep, '/').endswith(v.replace(os.sep, '/'))
                   for v in VERBATIM):
                continue
            for cand in (os.path.join(src_dir, sub + '.css'),
                         os.path.join(src_dir, 'tierA-tokens.css')):
                if not os.path.isfile(cand):
                    continue
                s = io.open(cand, encoding='utf-8').read()
                # 注释里的替换无意义，且可能破坏说明文字
                parts = re.split(r'(/\*.*?\*/)', s, flags=re.S)
                for i in range(0, len(parts), 2):      # 偶数 = 代码段
                    parts[i] = pattern.sub(lambda m: '.' + prefix + '-' + m.group(1),
                                           parts[i])
                out = os.path.join(out_root, d, sub)
                if not os.path.isdir(out):
                    os.makedirs(out)
                io.open(os.path.join(out, os.path.basename(cand)), 'w',
                        encoding='utf-8', newline='').write(''.join(parts))
                n += 1
    nj = rewrite_js(blocks, prefix, out_root)
    if nj < 0:
        return 1
    nh = rewrite_html(blocks, prefix, out_root)
    print('  已生成 %d 个 CSS + %d 个 JS + %d 个 HTML → prefixed/（前缀 "%s-"）'
          % (n, nj, nh, prefix))
    print('  改写了 %d 个类名（CSS / JS / HTML **三层同步**）' % len(blocks))
    print('')
    print('  用法：把 prefixed/ 里的文件替换 node_modules 里的同名文件')
    print('  ⚠️ 必须**整套替换** —— 少换任一层都会导致样式失效')
    print('     （HTML 层最容易漏：页面元素类名对不上，规则一条都不匹配）')
    return 0


def check():
    blocks = collect_blocks()
    print('  会被加前缀的顶层类（%d 个）：' % len(blocks))
    risky = [b for b in blocks if len(b) <= 8 and '-' not in b]
    print('  其中最容易被宿主撞名的（建议优先处理）：')
    for b in risky[:12]:
        print('     .%s' % b)
    print('')
    print('  已跳过的通用类：%s' % ', '.join(sorted(SKIP_BLOCKS)))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--prefix', default='fl',
                    help='命名空间前缀（默认 fl）')
    ap.add_argument('--check', action='store_true',
                    help='只列出会被改写的选择器')
    a = ap.parse_args()
    if a.check:
        return check()
    return build(a.prefix)


if __name__ == '__main__':
    sys.exit(main())
