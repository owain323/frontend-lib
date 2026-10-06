#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
license-gate.py — 版权与外部来源检查

背景：
> 「注意一下版权的纠纷和风险」

🔴 **这类问题门禁查不全**，本脚本只覆盖能机械判定的三类，
   但这三类恰恰是最容易出事的：

1. **逐字复制外部文本** —— 思想不受版权保护，**表达受保护**。
   听思路、用自己的话写；真要引用必须标注来源（见 06-vendor/外部方法论来源.md）。
2. **外链字体/图片资产** —— 最大的版权雷区。本库定位是"零外部资产"，
   出现 @font-face / 外链位图即破例（要引入必须先登记协议）。
3. **版权声明文本** —— 出现 `© 20xx` / `All rights reserved` 等，
   要么是我们引述的规范原文（合法），要么是没授权的标识（风险）。

**查不出来、必须人判断的**：
   - 某个设计决策是不是抄了某个具体产品
   - 字体/图标的"看起来像"某个品牌资产
   - 配色是否构成对某品牌的模仿

用法：python 05-audit/license-gate.py
"""
import sys
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEP = os.sep

# 逐字英文：连续 12 个以上单词的一行
LONG_EN = re.compile(r'[a-z]+(?: [a-z]+){11,}')
# 外链资产
ASSET = re.compile(r'@font-face|@import\s+(?:url\()?["\']?https?:|'
                   r'url\(\s*["\']?(?:https?:)?//[^)]*\.(?:woff2?|ttf|otf|png|jpe?g|svg)', re.I)
# 版权声明
NOTICE = re.compile(r'(?:©\s*20\d\d|copyright\s+©|all rights reserved|'
                    r'CC[-\s]?BY[-\s]?NC)', re.I)

# 我们自己写的风险警示（出现在 01-入库门槛 与 协议台账 里，是有意引述）
ALLOW_FILE = ('01-入库门槛.md', '协议台账.md', '外部方法论来源.md')
# 规范类原文引用（合法）
ALLOW_LINE = re.compile(r'(WCAG|MIT|Apache|SPDX|协议|台账|警示|禁商用|风险|引用|转述|不逐字|自己的话)')


def scan(root=None):
    root = root or ROOT
    files = sorted(glob.glob(os.path.join(root, '**', '*.*'), recursive=True))
    files = [f for f in files if f.endswith(('.md', '.css', '.html', '.js', '.py'))]
    files = [f for f in files if os.path.sep + '05-audit' + os.path.sep not in f]
    # 门禁自己与"讲门禁怎么用"的文档必然含有这些关键词
    files = [f for f in files
             if os.path.basename(f) not in ('license-gate.py', '外部方法论来源.md')]
    issues = []
    for p in files:
        name = os.path.basename(p)
        try:
            src = open(p, encoding='utf-8', errors='replace').read()
        except Exception:
            continue
        # 去掉代码块与行内代码后再判"逐字英文"，避免误报代码标识符
        prose = re.sub(r'```.*?```', '', src, flags=re.S)
        prose = re.sub(r'`[^`]*`', '', prose)
        for i, line in enumerate(prose.split('\n'), 1):
            if LONG_EN.search(line) and not ALLOW_LINE.search(line):
                issues.append(('逐字英文疑似', name, i, line.strip()[:60]))
        for i, line in enumerate(src.split('\n'), 1):
            m = ASSET.search(line)
            if m:
                issues.append(('外链字体/图片', name, i, line.strip()[:60]))
            m2 = NOTICE.search(line)
            if m2 and name not in ALLOW_FILE and not ALLOW_LINE.search(line):
                issues.append(('版权声明文本', name, i, line.strip()[:60]))
    return issues


def main():
    # 🔴 修：原来 ROOT 是模块级常量且 glob 写死 '0*'，
    #    传别的目录做判别力验证时**一个文件都扫不到** ⇒ 门禁永远"全绿"。
    #    这和 measure-gate 那次是同一个病根。
    root = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else ROOT
    issues = scan(root)
    for kind, name, ln, txt in issues:
        print('  [license-gate] %-14s %s:L%-4d %s' % (kind, name, ln, txt))
    print('')
    if issues:
        print('%d 项需要人工判断。' % len(issues))
        print('  · 逐字英文 → 改用自己的话，或在 06-vendor/外部方法论来源.md 登记来源')
        print('  · 外链资产 → 本库定位是零外部资产；确需引入先登记协议')
        print('  · 版权声明 → 确认是引述规范（合法）还是未授权标识（风险）')
        return 1
    print('版权检查：无逐字复制、无外链资产、无可疑版权声明。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
