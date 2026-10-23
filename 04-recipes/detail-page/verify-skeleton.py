#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify-skeleton.py — 配方自带校验收口（实现在 05-audit/detail-page-contract.py）

🔴 为什么做成转发而不是各写一份：
   两处实现早晚会漂移，而"同构"这条恰恰是最怕漂移的判据。
   ⇒ 配方里的人跑这一条，门禁里跑的是同一份代码。

用法：python 04-recipes/detail-page/verify-skeleton.py [--selftest]
"""
import os
import sys
import runpy

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GATE = os.path.join(ROOT, '05-audit', 'detail-page-contract.py')
sys.argv[0] = GATE
sys.exit(runpy.run_path(GATE, run_name='__main__') or 0)
