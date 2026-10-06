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
    · MUI  —— 提供 `MuiButton` 这样的稳定命名空间
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
⚠️ 已知限制（诚实说明）
---------------------------------------------------------------------------
  本工具做的是**文本级**替换，对以下情况无效：
    · 写在字符串里的类名（如 JS 生成的 HTML）
    · 跨组件的选择器里多个类名同时出现的顺序问题
  ⇒ 真正稳妥的做法是让**宿主改自己的类名**，或用构建工具的 CSS Modules。
  本工具的价值是**给无法改动宿主的场景一个逃生口**。
===========================================================================
"""
import argparse
import io
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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
                    # 只取**顶层块名**：不含 -- 修饰、长度合理
                    # ★ 只收「顶层块名」：不含 -- 修饰的那些是
                    #    BEM 的元素/变体，它们会跟着块名一起变，不需单独处理
                    if '--' in name or len(name) > 24:
                        continue
                    blocks.add(name)
    return sorted(blocks)


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
    print('  已生成 %d 个文件 → prefixed/（前缀 "%s-"）' % (n, prefix))
    print('  改写了 %d 个顶层类名' % len(blocks))
    print('')
    print('  用法：把 prefixed/ 里的 css 替换 node_modules 里的同名文件')
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
