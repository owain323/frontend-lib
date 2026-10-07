#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
hype-scan.py — 自我标榜词检测

===========================================================================
🔴 为什么需要这道门禁（明确要求：禁止自我标榜）
---------------------------------------------------------------------------
  评审指出：仓库里出现「一流」「世界一流」这类词。

  ⭐ 库不该自称一流 —— **让使用者自己判断**。
  自我标榜会：
    · 降低可信度（"说自己最好的，通常不是"）
    · 在搜索/对比时显得 noisy
    · 与"工程能力应当作为**证据**而非商品"的定位冲突

  ⚠️ 但要小心误伤 —— 有些词在技术语境里是**正常表述**：
    · "原生控件在移动端是最好的"  ← 技术判断，保留
    · "这是权衡，不是完美"      ← 自我约束，保留
  ⇒ 判据只抓**自夸句式**（"世界一流""业内领先"），
    不抓"最好/完美"这类可能用于技术判断的词。
===========================================================================
"""
import sys
import os
import io
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, '05-audit'))
from _common import scannable_files  # noqa: E402

# ============================================================================
# 自夸词表 —— 每条都要写清"为什么它属于自夸"
# ============================================================================
HYPE = [
    '世界一流',   # 自我评级，最典型的自夸
    '业内领先',   # 自我评级
    '业界领先',   # 自我评级
    '行业领先',   # 自我评级
    '全球领先',   # 自我评级
    '首屈一指',   # 自我评级
    '无与伦比',   # 自我评级
    '无可比拟',   # 自我评级
    '史上最',     # 自我评级
    '最强',       # 自我评级
    '完美解决',   # 绝对化承诺
    '终极',       # 绝对化
    '碾压',       # 贬低同行
]

# ⚠️ 拼接写法：门禁源码本身不该含这些完整词
import terms  # noqa: E402

SELF = {'terms.py', 'leak-scan.py', 'leak-clean.py', 'outsider-audit.py',
        'publish-guard.py', 'proper-noun-scan.py', 'leak-fix-paths.py',
        'hype-scan.py', '_common.py', 'repo-hygiene.py'}

EXTS = ('.md', '.html', '.css', '.js', '.py', '.json', '.sh', '.yml', '.mjs')


def main():
    print('  === 自我标榜词检测 ===')
    print('')
    # 🔴 视野 = 磁盘上要交付的东西（含未跟踪的新文件），不是 git 索引
    files = scannable_files(ROOT)

    hits = {}
    for rel in files:
        if rel.split('/')[-1] in SELF or not rel.endswith(EXTS):
            continue
        try:
            t = io.open(os.path.join(ROOT, rel), encoding='utf-8',
                        errors='replace').read()
        except Exception:
            continue
        for w in HYPE:
            n = t.count(w)
            if n:
                lines = [i + 1 for i, l in enumerate(t.split('\n')) if w in l]
                hits.setdefault(w, []).append((rel, n, lines[:3]))

    print('  扫了 %d 个文件' % len(files))
    print('')
    if not hits:
        print('  OK 无自我标榜词')
        return 0

    total = 0
    for w in HYPE:
        if w in hits:
            n = sum(x[1] for x in hits[w])
            total += n
            print('  X %-10s %d 处 / %d 文件' % (w, n, len(hits[w])))
            for rel, c, lines in hits[w][:5]:
                print('       %s  x%d  行 %s' % (rel[:46], c, lines))
    print('')
    print('  => 共 %d 处。库不该自称一流 —— 让使用者自己判断。' % total)
    return 1


if __name__ == '__main__':
    sys.exit(main())
