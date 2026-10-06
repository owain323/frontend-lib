#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
hover-gate.py — 检查 :hover 是否做了输入方式门控

依据：Emil Kowalski 的设计规则（ui-benchmark-redesign 技能收录）
---------------------------------------------------------------
`:hover` 在**触屏设备上会"粘住"**：点一下按钮，hover 状态会一直保持，
用户要再点别的地方才消失 —— 移动端没有"移开鼠标"这个动作。

正确做法是把 hover 效果包进门控：

    @media (hover: hover) and (pointer: fine) {
      .btn:hover { ... }
    }

只对**真能悬停的设备**生效（鼠标 / 触控板）。

判据：文件去掉注释后仍有 `:hover`，但整个文件没有 `@media (hover` ⇒ 未门控。

用法：python 05-audit/hover-gate.py
"""
import sys
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def check(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        s = f.read()
    s2 = re.sub(r'/\*.*?\*/', '', s, flags=re.S)   # 去注释
    hovers = len(re.findall(r':hover', s2))
    if hovers == 0:
        return None
    gated = len(re.findall(r'@media[^{]*\(hover\s*:\s*hover\)', s2))
    return hovers if gated == 0 else None


def main():
    files = sorted(glob.glob(os.path.join(ROOT, '0*', '**', '*.css'), recursive=True))
    files = [f for f in files if '_probe' not in f]
    bad = []
    for p in files:
        n = check(p)
        if n:
            rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
            bad.append((rel, n))
    for rel, n in bad:
        print('  [hover-gate] %-44s %d 处 :hover 未门控' % (rel, n))
    print('')
    if bad:
        print('未门控 %d 个文件 —— 触屏上 hover 会"粘住"' % len(bad))
        return 1
    print('全部 :hover 已门控。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
