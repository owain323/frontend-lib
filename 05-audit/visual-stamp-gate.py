#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
visual-stamp-gate.py — 基线必须录在当前代码上（指纹过期即红）

===========================================================================
🔴 为什么必须有（真实拖了 5 天的事故）
---------------------------------------------------------------------------
`shot-baseline.py` 在 `_baseline/_stamp.json` 里记了录制时的
**渲染指纹**（CSS+JS+HTML 的内容哈希）与 **HEAD**。
但 `--check` 发现指纹不符时**只打印一行 WARN**，
真正的判据还是"像素 diff 是否超阈值"。

⇒ 后果：**改了 CSS、没重录基线，门禁照样全绿**。
   实测：浅色基线录于 `6f045ff`、暗色录于 `4962b2c`，
   而当时 HEAD 已经到 `208782f`（badge 加了 `align-self`），
   两页红着过了 5 天，没人发现"基线不是当前代码拍的"。

⚠️ 本条**只比指纹，不比 head**：
   基线通常在功能提交里一起录，stamp 里的 head 天然是**父提交**，
   拿它跟当前 HEAD 比会永远红 —— 那是把判据写成噪声。

===========================================================================
判据
---------------------------------------------------------------------------
  ① `_baseline-<平台>[-dark|-rtl]/_stamp.json`（三套）必须都存在
  ② 其 `fingerprint` 必须等于当前 `css_fingerprint()`
  ③ 三套分别判定，缺一套也红
  ④ 只判**本平台**那三套（基线按平台分集，见 shot-baseline.py 顶部）：
     别的平台的戳与这次改动无关；本平台的戳不存在就红，不许放行

修复方式（不许在代码里放行）：
    python 05-audit/shot-baseline.py --update                # 浅色
    python 05-audit/shot-baseline.py --update --scheme dark  # 暗色
    python 05-audit/shot-baseline.py --update --dir rtl      # RTL

用法：
    python 05-audit/visual-stamp-gate.py
    python 05-audit/visual-stamp-gate.py --selftest
退出码：0 = 两份戳都对得上当前代码；1 = 过期/缺失；2 = 无法计算指纹
"""
import io
import os
import sys
import json
import importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, '10-review', 'shots')

# 🔴 三套，不是两套（2026-10-29 加 RTL）：新加的基线集如果不在
#   这张表里，它就会成为**唯一没人看守的基线** —— 改了 CSS 不重录，
#   像素比对照样绿，而"绿"的意思是"和一份过期基线一样"。
#   一份基线只要存在，就必须进这张表。
# 🔴 0.11.9：表改成**按平台生成**。平台名从 shot-baseline.py 取
#   （`mod.PLAT`），不在这里写第二份 —— 两份平台判定迟早会分叉，
#   那就是 E31 的老毛病：同一件事在仓库里有两个真源。
def cases(plat):
    return [
        ('浅色', '_baseline-%s' % plat,      ''),
        ('暗色', '_baseline-%s-dark' % plat, ' --scheme dark'),
        ('RTL',  '_baseline-%s-rtl' % plat,  ' --dir rtl'),
    ]


def load_shot_module():
    spec = importlib.util.spec_from_file_location(
        '_shot_baseline', os.path.join(ROOT, '05-audit', 'shot-baseline.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def evaluate(stamp, now):
    """纯函数：返回 (状态, 说明)。状态 ∈ ok / missing / stale / norecord

    🔴 单独抽出来是为了 --selftest 能直接喂合成数据 ——
       否则"自检"只能读磁盘，验的是今天这台机器的状态，不是判据。
    """
    if stamp is None:
        return 'missing', '基线里没有 _stamp.json（可能是用旧脚本录的）'
    fp = stamp.get('fingerprint')
    if not fp:
        return 'norecord', '_stamp.json 里没有 fingerprint 字段'
    if fp != now:
        return 'stale', '基线录于 %s（head=%s），当前 %s' % (
            fp, stamp.get('head', '?'), now)
    return 'ok', '指纹一致（head=%s）' % stamp.get('head', '?')


def read_stamp(directory):
    path = os.path.join(directory, '_stamp.json')
    try:
        with io.open(path, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def selftest():
    cases = [
        ('一致',    {'fingerprint': 'aaa', 'head': '1'}, 'aaa', 'ok'),
        ('过期',    {'fingerprint': 'aaa', 'head': '1'}, 'bbb', 'stale'),
        ('缺戳',    None,                               'aaa', 'missing'),
        ('无字段',  {'head': '1'},                      'aaa', 'norecord'),
    ]
    bad = 0
    for name, stamp, now, want in cases:
        got, msg = evaluate(stamp, now)
        ok = got == want
        print('  %-6s %s  期望 %-7s 实得 %-7s %s'
              % (name, 'PASS' if ok else 'FAIL', want, got, msg))
        if not ok:
            bad += 1
    # ⑦b 对偶：证明 'ok' 不是"永远返回 ok"
    if evaluate({'fingerprint': 'x'}, 'y')[0] == 'ok':
        print('  [FAIL] 对偶用例失败：明显不一致却判 ok')
        bad += 1
    print('  自检 %d 条，失败 %d 条' % (len(cases) + 1, bad))
    return 1 if bad else 0


def main():
    if '--selftest' in sys.argv:
        return selftest()

    try:
        mod = load_shot_module()
        now = mod.css_fingerprint()
    except Exception as e:                      # 指纹算不出来 ⇒ 不许判通过
        print('  [FAIL] 无法计算当前指纹：%s' % e)
        return 2
    if not now:
        print('  [FAIL] 当前指纹为空 —— 不许判通过')
        return 2

    plat = mod.PLAT
    sets = cases(plat)
    bad = False
    for label, dirname, flag in sets:
        stamp = read_stamp(os.path.join(SHOTS, dirname))
        state, msg = evaluate(stamp, now)
        if state == 'ok':
            print('  OK   %s  %s' % (label, msg))
            continue
        bad = True
        print('  FAIL %s（%s）%s' % (label, dirname, msg))
        if state in ('stale', 'missing', 'norecord'):
            print('       → 若这些 CSS/JS/HTML 改动是有意的：')
            print('         python 05-audit/shot-baseline.py --update%s' % flag)
            print('       → 若不是有意的，说明源码被改坏了，先看 visual 的 diff 图')

    if bad:
        print('  ⇒ 基线不是当前代码拍的：像素比对此刻**不能证明任何事**')
        return 1
    print('  %d 份基线（平台 %s）都录在当前代码上' % (len(sets), plat))
    return 0


if __name__ == '__main__':
    sys.exit(main())
