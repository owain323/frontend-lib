#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
size-baseline.py — 体积基线与回归门禁

===========================================================================
🔴 为什么需要这道门禁（K10）
---------------------------------------------------------------------------
  现有 `perf-gate.py` 查的是**绝对阈值**：
      单文件 ≤ 24KB、全量 ≤ 120KB、单页内联 ≤ 8KB

  ⭐ 但那是「现在通过」级别的检查。真实风险是：
      改一行 CSS 让某个属性多写一遍、体积悄悄涨 2KB
      —— 只要没冲破绝对阈值，**没有任何门禁会拦**。

  成熟做法（MUI 那一档）：
      每次提交都记录体积快照，
      并检查**相对上一次**的变化幅度。
  ⭐ 一句话：
      「现在通过」是及格线，
      「不许偷偷把性能带坏」才是持续预算。

===========================================================================
用法
---------------------------------------------------------------------------
  python3 05-audit/size-baseline.py --record    # 记录当前基线
  python3 05-audit/size-baseline.py            # 与基线比对（默认）
  python3 05-audit/size-baseline.py --allow-growth 8   # 允许增长 8%
===========================================================================
"""
import sys
import os
import io
import json
import gzip

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE = os.path.join(ROOT, '05-audit', 'size-baseline.json')

# 纳入统计的目录（vendor 第三方代码不算我们自己的体积）
DIRS = ('01-tokens', '02-primitives', '03-patterns', '04-recipes')
EXTS = ('.css', '.js')

# ⭐ 单个改动允许的增长比例 —— 超过就要解释
DEFAULT_TOLERANCE = 5.0     # %


def collect():
    """收集 (相对路径, 原始字节, gzip 字节)"""
    out = {}
    for d in DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            # ⭐ 第三方代码不算我们的体积
            if 'vendor' in dirpath.replace(os.sep, '/'):
                continue
            for f in filenames:
                if not f.endswith(EXTS):
                    continue
                p = os.path.join(dirpath, f)
                rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
                try:
                    raw = open(p, 'rb').read()
                except Exception:
                    continue
                out[rel] = {
                    'raw': len(raw),
                    # ⭐ 线上传输量看的是 gzip，不是原始大小
                    'gzip': len(gzip.compress(raw, 9)),
                }
    return out


def total(data, key='gzip'):
    return sum(v[key] for v in data.values())


def fmt(n):
    return '%.1f KB' % (n / 1024.0)


def main():
    arg_tol = None
    if '--allow-growth' in sys.argv:
        i = sys.argv.index('--allow-growth')
        try:
            arg_tol = float(sys.argv[i + 1])
        except (IndexError, ValueError):
            print('  X --allow-growth 需要一个数字（百分比）')
            return 2
    record = '--record' in sys.argv
    tol = arg_tol if arg_tol is not None else DEFAULT_TOLERANCE

    cur = collect()
    if not cur:
        print('  X 没收集到任何文件')
        return 1

    if record or not os.path.isfile(BASELINE):
        data = {
            'tolerance_percent': tol,
            'files': cur,
            'total_raw': total(cur, 'raw'),
            'total_gzip': total(cur, 'gzip'),
        }
        io.open(BASELINE, 'w', encoding='utf-8', newline='').write(
            json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + '\n')
        print('  已记录基线：%d 个文件' % len(cur))
        print('     原始 %s · gzip %s' % (fmt(data['total_raw']),
                                            fmt(data['total_gzip'])))
        return 0

    base = json.load(io.open(BASELINE, encoding='utf-8'))
    told = base.get('tolerance_percent', DEFAULT_TOLERANCE)
    if arg_tol is None:
        tol = told

    bfiles = base.get('files', {})
    print('  === 体积基线比对（容差 %.1f%%）===' % tol)
    print('')

    bad = 0

    # ① 总量
    # ⭐⭐ 关键：只看 **gzip 比率**会漏判。
    #   实测：加 4KB 重复注释，gzip 只涨 0.1KB（+0.06%）⇒ 比率门禁失效。
    #   重复内容正是最常见的"悄悄变大"（复制粘贴的样式），
    #   gzip 恰好把它压掉 ⇒ 必须同时看**绝对增量**与**原始体积**。
    cg, bg = total(cur, 'gzip'), base.get('total_gzip', 0)
    craw, braw = total(cur, 'raw'), base.get('total_raw', 0)
    abs_gz = cg - bg
    abs_raw = craw - braw
    # 允许的绝对增长：基线的 5%，且不超过 16KB
    allow_abs = max(1024 * 16, int(bg * tol / 100.0))
    ratio = (cg - bg) * 100.0 / bg if bg else 0
    # ⭐ **raw 才是抓「重复内容型膨胀」的主力** ——
    #   复制粘贴的样式，gzip 几乎压不动（实测 4KB → 0.1KB）。
    raw_allow = max(1024 * 8, int(braw * tol / 100.0))
    over = abs_gz > allow_abs or ratio > tol or abs_raw > raw_allow
    print('  %s gzip 总体积  %s → %s  (绝对 %+0.1f KB / 允许 %0.1f KB，比率 %+.2f%%)'
          % ('X ' if over else 'OK ', fmt(bg), fmt(cg),
             abs_gz / 1024.0, allow_abs / 1024.0, ratio))
    print('     %s 原始总体积  %s → %s  (绝对 %+0.1f KB / 允许 %0.1f KB)'
          % ('X ' if abs_raw > raw_allow else 'OK ',
             fmt(braw), fmt(craw), abs_raw / 1024.0, raw_allow / 1024.0))
    if over:
        bad += 1
    print('')

    # ② 单文件
    grew = []
    for rel, v in cur.items():
        b = bfiles.get(rel)
        if not b or not b.get('gzip'):
            continue
        d = (v['gzip'] - b['gzip']) * 100.0 / b['gzip']
        # ⭐ 单文件同样看绝对增量（1KB 门槛）：
        #   小文件涨 50% 可能只有几百字节，不值得拦；
        #   但涨 3KB 一定是有人复制粘贴了。
        dabs = v['gzip'] - b['gzip']
        # ⭐ raw 涨 1KB 就报（重复内容在 raw 视角下是实打实的）
        rabs = v['raw'] - b['raw']
        if d > tol or dabs > 1024 or rabs > 1024:
            grew.append((rel, b['gzip'], v['gzip'], d))
    if grew:
        grew.sort(key=lambda x: -(x[2] - x[1]))
        print('  X 以下文件超出容差：')
        for rel, b0, c0, d in grew[:8]:
            print('     %-44s %s → %s (%+.1f%%)' % (rel[:44], fmt(b0), fmt(c0), d))
        bad += len(grew)
    else:
        print('  OK 单文件增长均在容差内')

    # ③ 新增文件（也要记账，否则体积只增不减）
    added = [r for r in cur if r not in bfiles]
    if added:
        print('')
        print('  ! 新增 %d 个文件（已计入总量，但请确认是必要的）:' % len(added))
        for r in added[:6]:
            print('     %-44s %s' % (r[:44], fmt(cur[r]['gzip'])))
    removed = [r for r in bfiles if r not in cur]
    if removed:
        print('')
        print('  · 已删除 %d 个文件（体积下降）' % len(removed))

    print('')
    if bad:
        print('  => 体积超出预算。')
        print('     如果是有意的，请重录基线：')
        print('       python3 05-audit/size-baseline.py --record')
        print('     如果是无意的，就是一次性能回归。')
        return 1
    print('  OK 未超出体积预算')
    return 0


if __name__ == '__main__':
    sys.exit(main())
