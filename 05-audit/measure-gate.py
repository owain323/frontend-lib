#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
measure-gate.py — 检查行长（measure）是否用了语言感知的令牌

背景（由一个提问触发）：
-----------------------------------
中文排版用 `em` 限宽看起来"完美"，**但那是巧合**：1em = 1 个汉字宽。
换到英文，同样的 `max-width: 20em` 只有 640px ≈ 20 字符 ——
实测 84 字符的英文标题会折成 4 行。

`ch` 也不对：ch = "0" 的宽度，**1 汉字 ≈ 2ch**，13ch 只能放 6 个汉字。

⇒ 没有任何单一单位能同时伺候所有语言。
⇒ 本库的做法：组件用 `var(--measure-*)`，令牌按 `:lang()` 切换单位。

判据
----
标题 / 导语 / 正文 / 引言 / 边注 这几类**行宽元素**，
必须用 `var(--measure-*)`，不许写死 em / ch。

**豁免**：页面骨架容器（`.wrap` / `.article` / `main`）用 ch/em 是**正确的** ——
它要随用户字号缩放，不是行长控制。这类靠选择器白名单排除。

用法：python 05-audit/measure-gate.py
"""
import sys
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 行宽元素的选择器关键词（命中即要求用令牌）
MEASURE_KEYS = re.compile(
    r'(^|[\s,>+~])(h1|h2|\.standfirst|\.lead|\.lede|\.pull|\.aside|'
    r'\.article__title|\.article__standfirst|\.prose|main|p)(\s|,|{)')

# 豁免：这些是**页面骨架容器**，不是行长
SKELETON = re.compile(r'^\s*\.(wrap|article|shell|container)\b|^\s*body\s*\{')


def check(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        src = f.read()
    src = re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'), src, flags=re.S)
    bad = []
    for m in re.finditer(r'([^{}]+)\{([^}]*)\}', src):
        sel = m.group(1).strip()
        body = m.group(2)
        mw = re.search(r'max-width:\s*(\d+)(em|ch)\b', body)
        if not mw:
            continue
        if SKELETON.match(sel):
            continue
        if not MEASURE_KEYS.search(sel + ' '):
            continue
        v, unit = int(mw.group(1)), mw.group(2)
        bad.append((sel.replace('\n', ' ')[:44], v, unit))
    return bad


def main():
    # 🔴 参数约定（0.8.9 · 外部审计 P0-1）：`--` 开头的当 flag，不当路径。
    # 🔴 事故：check-all.sh 传 `--dir <目录列表>`，旧写法把 argv[1]
    #   （字面量 "--dir"）当 root ⇒ root=<cwd>/--dir 不存在
    #   ⇒ glob 到 0 个文件 ⇒ 无违规 ⇒ 判 PASS。
    #   而这句「传别的目录当参数时一个文件都扫不到」的警告，
    #   写在源码里却只针对"写死扫 0*"这一种成因，没覆盖"参数被当路径"。
    raw = [a for a in sys.argv[1:] if not a.startswith('-')]
    args = [a for a in raw if os.path.isdir(a)]
    # 🔴 传了路径但一个都不存在 ⇒ 明确报红。
    #   不能用 `or [ROOT]` 兜底：那是把「调用方传错了」当成「没传参数」，
    #   两者跑出来的结果一样，但性质完全相反 —— 混起来又是一次假绿。
    if raw and not args:
        print('❌ 传入的路径都不存在：%s' % raw)
        print('   这是**假绿**：不是"行宽合规"，是"什么都没检查"。')
        return 1
    args = args or [ROOT]

    # 🔴 扫描范围扩到 *.css（0.8.9 · 外部审计 P0-1b）：
    #   原来只扫 `**/*.html`，于是**组件 CSS 里的硬写行宽完全看不到** ——
    #   而 `content.css:23 max-width: 68ch` 与 `states.css:51 max-width: 42ch`
    #   就在那里（它们绕过了 --measure-prose 的语言感知机制）。
    #   check() 本来就是通用 CSS 语法解析，不关心文件类型 ⇒ 只需扩 glob。
    files = []
    for r in args:
        files += sorted(glob.glob(os.path.join(r, '**', '*.html'), recursive=True))
        files += sorted(glob.glob(os.path.join(r, '**', '*.css'), recursive=True))
    files = sorted(set(files))
    total = 0
    n_scanned = 0
    for p in files:
        if '/05-audit' in p.replace(os.sep, '/') or '/dist/' in p.replace(os.sep, '/') + '/':
            continue
        n_scanned += 1
        bad = check(p)
        if not bad:
            continue
        rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
        for sel, v, unit in bad:
            total += 1
            print('  [measure-gate] %-42s %-44s %d%s' % (rel, sel, v, unit))
    print('')
    print('（扫了 %d 个文件）' % n_scanned)
    # 🔴 零文件守卫：扫到 0 个文件必须判红（不是"通过"，是"什么都没检查"）
    if n_scanned == 0:
        print('❌ 一个文件都没扫到 —— 这是**假绿**，本门禁不接受空扫描。')
        return 1
    if total:
        print('%d 处行宽写死了单位 —— 换语言会排版失衡' % total)
        print('  改用 var(--measure-title) / --measure-lede / --measure-prose / --measure-pull')
        return 1
    print('行宽全部使用语言感知令牌。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
