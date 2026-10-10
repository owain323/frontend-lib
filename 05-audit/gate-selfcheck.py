#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gate-selfcheck.py — 门禁运行器自身的门禁（检查项 J9）

===========================================================================
🔴 为什么需要（外部评审：「门禁自身的门禁」）
---------------------------------------------------------------------------
  评审在 check-all.sh 里发现三个问题，**都是门禁自己的**：
    ① 4 条 run 写在 exit 之后 ⇒ **永不执行**（却显示"已接入"）
    ② hygiene 同名出现两次 ⇒ 报告里分不清是哪一道
    ③ set -u 下用到未初始化的变量 ⇒ 失败路径会中途崩掉

  ⭐ 讽刺之处：这是一个**以门禁为核心卖点**的库，
     而它的门禁运行器自己有「看起来在跑、其实没跑」的门禁。

===========================================================================
判据
---------------------------------------------------------------------------
  ① exit 之后**不得**再有 run（不可达 = 假通过）
  ② run 名称**不得重复**（重复 = 报告歧义）
  ③ set -u 下用到的变量**必须已初始化**
===========================================================================
"""
import sys
import os
import io
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(ROOT, '05-audit', 'check-all.sh')

# 环境自带的变量（不算"未初始化"）
BUILTIN = {
    'PATH', 'HOME', 'PWD', 'TMPDIR', 'USER', 'SHELL', 'LANG', 'IFS',
    'BASH_SOURCE', 'OSTYPE', 'PYTHONPATH', 'RANDOM', 'SECONDS', 'LINENO',
}
# 本库约定的环境变量（由运行者提供）
ALLOWED_ENV = {'NODE_PATH', 'NODE_DIR', 'NODE_MODULES', 'PW_PATH',
               'TIMING', 'PY', 'AUDIT_REF', 'GITHUB_TOKEN', 'GH_TOKEN'}


def main():
    print('  === 门禁运行器自检 ===')
    print('')
    if not os.path.isfile(SH):
        print('  X 找不到 check-all.sh')
        return 1
    src = io.open(SH, encoding='utf-8').read()
    lines = src.split('\n')
    bad = 0

    # ---------- ① exit 之后不得有 run ----------
    exit_at = None
    for i, l in enumerate(lines):
        if l.strip().startswith('exit '):
            exit_at = i
    if exit_at is None:
        print('  [1] X 找不到 exit 退出点')
        bad += 1
    else:
        after = [l.strip() for l in lines[exit_at + 1:]
                 if l.strip().startswith('run ')]
        if after:
            print('  [1] X exit 之后还有 %d 条门禁（**永不执行**）：'
                  % len(after))
            for a in after[:5]:
                print('        %s' % a[:58])
            bad += 1
        else:
            print('  [1] OK exit 之后无门禁（全部可达）')

    # ---------- ② run 名称不得重复 ----------
    names = []
    for l in lines:
        m = re.match(r'\s*run\s+"([a-z0-9_-]+)"', l)
        if m:
            names.append(m.group(1))
    dup = sorted(set(n for n in names if names.count(n) > 1))
    if dup:
        print('  [2] X 门禁名称重复：%s' % ', '.join(dup))
        print('        （同名会让报告无法分辨是哪一道）')
        bad += 1
    else:
        print('  [2] OK %d 条门禁名称唯一' % len(names))

    # ---------- ③ set -u 的变量必须已初始化 ----------
    has_u = re.search(r'^\s*set\s+-[a-z]*u', src, re.M) is not None
    if not has_u:
        print('  [3] - 未启用 set -u，跳过')
    else:
        assigned = set()
        for m in re.finditer(r'^\s*(?:local\s+|export\s+)?(\w+)=', src, re.M):
            assigned.add(m.group(1))
        for m in re.finditer(r'^\s*(?:local|export)\s+(\w+)', src, re.M):
            assigned.add(m.group(1))
        for m in re.finditer(r'for\s+(\w+)\s+in', src):
            assigned.add(m.group(1))
        used = set()
        for m in re.finditer(r'\$\{?([A-Za-z_]\w*)', src):
            used.add(m.group(1))
        undef = sorted(u for u in used
                       if u not in assigned
                       and u not in BUILTIN
                       and u not in ALLOWED_ENV)
        if undef:
            print('  [3] ! set -u 下未初始化的变量：%s' % ', '.join(undef[:8]))
            print('        （只在失败路径用到时，失败会中途崩掉而非报出）')
        else:
            print('  [3] OK 未发现未初始化变量')

    print('')
    if bad:
        print('  => 门禁运行器自身有 %d 处问题' % bad)
        return 1
    print('  OK 门禁运行器自身无问题')
    return 0


if __name__ == '__main__':
    sys.exit(main())
