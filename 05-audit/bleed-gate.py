#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
bleed-gate.py — CSS 作用域门禁（防止「改一处、全库变样」）

===========================================================================
🔴 为什么需要这道门禁（2026-10-06 实测事故驱动）
---------------------------------------------------------------------------
  一次真实的失败实验：用本库做 14 页 PPT，AI 反复局部修改后
  样式整体崩坏，人工修复 1.5 小时仍未收口。

  复盘发现根因不是「模型笨」，而是**系统没有给修改划边界**：
  库只约束了「浏览器里怎么表现」，没约束「CSS 能写在哪」。
  于是模型可以随手写：

      a { color: blue }        ← 改一个，宿主全站链接变色
      h1 { font-size: 31px }   ← 改一个，14 页标题全变
      .slide-3 h1 { ... }      ← 然后开始堆页面级 override

  最终 CSS 变成：全局规则 + 组件规则 + 页面规则 + 临时补丁 + !important。

===========================================================================
本门禁做什么
---------------------------------------------------------------------------
  **禁止组件 CSS 里的裸标签选择器**（`a {}` / `h1 {}` / `button {}` …）。

  理由：裸标签选择器的作用域是**整个文档**，不只组件。
  组件库一旦给宿主页面留下这种规则，
  使用者后面无论怎么改自己的页面，都会被本库影响
  —— 这与「组件应当只影响自己」的根本前提冲突。

  允许的例外（各都有明确理由，且逐条写明）：
    · reset 层（tokens.css）的 `-webkit-tap-highlight-color`
    · html / body —— reset 本来就该管它们
===========================================================================
为什么这条是「硬红线」而不是建议
---------------------------------------------------------------------------
  裸标签选择器一旦进了库，就**永久生效**。
  后面每次出现「样式被莫名改掉」的排查，起点都会指向它。
  ⇒ 宁可现在严，也不给以后留这种隐性耦合。
===========================================================================
"""
import io
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 组件 CSS 目录（01-tokens 里只有 tokens.css 有例外）
SCAN_DIRS = ('02-primitives', '03-patterns', '04-recipes', '09-assets')
TOKEN_FILES = {'01-tokens/tokens.css'}

# 会被判为「裸标签选择器」的元素
TAGS = ('h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li',
        'table', 'th', 'td', 'button', 'input', 'select', 'textarea', 'a')

# 行首裸标签（后面跟 , { 或空白+{）
BARE = re.compile(
    r'^\s{0,2}(' + '|'.join(TAGS) + r')\s*(,|\{)')

# reset 层允许的例外：只限这一个属性
RESET_OK = re.compile(
    r'^\s{0,2}(' + '|'.join(TAGS) + r')\s*,\s*$'      # 逗号续行
    r'|^\s{0,2}-webkit-tap-highlight-color'
    r'|^\s{0,2}(html|body)\s*[,{]')


def css_files():
    try:
        out = subprocess.run(
            ['git', '-c', 'core.quotePath=false', 'ls-files'],
            cwd=ROOT, capture_output=True, timeout=30)
        files = [f for f in out.stdout.decode('utf-8', 'replace').split('\n')
                 if f.strip()]
    except Exception:
        files = []
    return [f for f in files
            if f.endswith('.css')
            and not f.startswith('05-audit/')
            and not f.startswith('prefixed/')
            and '_baseline' not in f]


def scan():
    problems = []
    checked = 0
    for rel in css_files():
        checked += 1
        try:
            src = io.open(os.path.join(ROOT, rel), encoding='utf-8').read()
        except Exception:
            continue
        # 剥注释：注释里提到标签不算
        code = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
        code = re.sub(r'(?m)^\s*//.*$', '', code)
        in_token = os.path.basename(rel) in TOKEN_FILES
        in_token_dir = rel.startswith('01-tokens')
        for i, line in enumerate(code.split('\n'), 1):
            if not BARE.search(line):
                continue
            # reset 层（tokens.css）允许：tap-highlight 与 html/body
            if in_token or in_token_dir:
                if RESET_OK.search(line):
                    continue
            problems.append((rel, i, line.strip()[:66]))
    return checked, problems


def main():
    print('  === CSS 作用域（禁止裸标签选择器）===')
    print('')
    checked, problems = scan()
    print('  扫了 %d 个 CSS 文件' % checked)

    if not problems:
        print('  OK  没有裸标签选择器（组件只影响自己）')
        return 0

    print('')
    print('  🔴 发现裸标签选择器（作用域是整个文档，不只组件）：')
    for rel, ln, text in problems[:12]:
        print('     %s:%d' % (rel, ln))
        print('       %s' % text)
    if len(problems) > 12:
        print('       … 另有 %d 处' % (len(problems) - 12))
    print('')
    print('  ⇒ 这种规则会改掉**宿主页面**的同名元素。')
    print('    一旦入库，使用者后面改自己的页面都会被本库影响。')
    print('    修法：挂到组件自己的根选择器上，如 `.content a { }`。')
    return 1


if __name__ == '__main__':
    sys.exit(main())