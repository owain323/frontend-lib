#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
pack.py — 打一个可以直接用的发布包

为什么需要（阶段 E）
--------------------
库现在的"分发方式"是**拷目录**。但拷目录会把这些东西一起带走：

- `05-audit/`（门禁脚本，20+ 个 .py，验证用，复用者不需要）
- `08-plan/`、`PLAN*.md`、`07-notes/`（我们内部的计划与复盘）
- `demo.html`（演示页，复用者只看 README 就够）
- `responsive-demo.html`（tokens 自己的演示）

⇒ 复用的真实成本是：**只有 13 个 CSS/JS 文件 + README**，
剩下 70 多个文件是我们自己的开发过程。

本脚本产出：
    frontend-lib-<版本>.zip
      ├── dist/          ← 只放复用真正需要的（CSS/JS/README/演示）
      ├── docs/          ← 规范与决策记录（charter / notes / 计划）
      └── checks/        ← 门禁（想自己验的人可带）

**不包含**：`PLAN*.md`、`.toolchain`、临时文件。

用法：
    python 05-audit/pack.py            # 打包到库根
    python 05-audit/pack.py --out D:/  # 打包到别处
    python 05-audit/pack.py --list     # 只看会打进去什么
"""
import io
import os
import re
import sys
import glob
import zipfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── 什么进包 ────────────────────────────────────────────────
INCLUDE = [
    '00-charter',        # 规范（下游想知道"为什么这么设计"时要看）
    '01-tokens',         # 令牌 + 排版
    '02-primitives',     # 组件
    '03-patterns',       # 复合模式
    '04-recipes',        # 精简档 完整范例
    '05-audit',          # 门禁（想自己验的人需要）
    '06-vendor',         # 协议台账（合规必需）
    '07-notes',          # 经验（含踩坑记录）
    '08-plan',           # 路线图
    '09-assets',
    # 🔴 加 10-review：截图是**看得到的证据**。
    #    判断依据：「放在那边以后我都不会用的，这是极大的资源浪费」——
    #    而发出去的包里**一张图都没有**（INCLUDE 里根本没有这一项）。
    #    ⇒ 截图必须在包里，否则别人看不到这库长什么样。
    '10-review',         # 图标素材
    'index.html',
    'README.md',
    'START-HERE.md',   # 复用入口：给使用者的第一份文件
    'CHANGELOG.md',
    'VERSION',
]
# 明确排除
EXCLUDE_DIRS = {'.git', '.toolchain', 'node_modules', '__pycache__',
                '.claude', 'dist', 'output'}
EXCLUDE_FILES = {'PLAN.md', 'PLAN-v2.md'}      # 内部计划，不进发布包
EXCLUDE_EXT = {'.bak', '.tmp', '.log', '.pyc'}

# 打包时要清理的临时文件（自检脚本留下的）
TEMP_PATTERNS = ['_probe*', '_selftest_tmp.html', '_accent_tmp.js', '_*.tmp.html']


def read_version():
    p = os.path.join(ROOT, 'VERSION')
    if os.path.isfile(p):
        return io.open(p, encoding='utf-8').read().strip() or '0.0.0'
    return '0.0.0'


def should_skip(path):
    name = os.path.basename(path)
    if os.path.splitext(name)[1] in EXCLUDE_EXT:
        return True
    if name in EXCLUDE_FILES:
        return True
    for pat in TEMP_PATTERNS:
        if name.startswith(pat.replace('*', '')) and pat.endswith('*'):
            return True
    return False


def collect():
    """返回 [(磁盘路径, 包内相对路径)]"""
    out = []
    for item in INCLUDE:
        src = os.path.join(ROOT, item)
        if not os.path.exists(src):
            continue
        if os.path.isfile(src):
            if not should_skip(src):
                out.append((src, os.path.basename(src)))
            continue
        for dirpath, dirnames, filenames in os.walk(src):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
            for fn in filenames:
                fp = os.path.join(dirpath, fn)
                if should_skip(fp):
                    continue
                rel = os.path.relpath(fp, ROOT).replace(os.sep, '/')
                out.append((fp, rel))
    return sorted(out, key=lambda x: x[1])


def human(n):
    return '%.0f KB' % (n / 1024) if n < 1024 * 1024 else '%.1f MB' % (n / 1024 / 1024)


def main():
    args = sys.argv[1:]
    ver = read_version()
    files = collect()

    if '--list' in args:
        print('会打包 %d 个文件：' % len(files))
        cur = ''
        for _, rel in files:
            top = rel.split('/')[0]
            if top != cur:
                cur = top
                print('\n  %s/' % top)
            print('    %s' % rel)
        return 0

    outdir = ROOT
    if '--out' in args:
        i = args.index('--out')
        outdir = os.path.abspath(args[i + 1])
        if not os.path.isdir(outdir):
            print('目标目录不存在：%s' % outdir)
            return 2

    # --slim：只带复用真正要的东西（CSS/JS/README/规范），
    # 不带门禁脚本 —— 复用者不会跑我们的测试。
    slim = '--slim' in args
    name = 'frontend-lib-%s%s.zip' % (ver, '-slim' if slim else '')
    path = os.path.join(outdir, name)
    total = 0
    picked = files
    if slim:
        # 极简包 = 复用真正要的东西。
        # 排除的是**我们自己的开发过程**：门禁脚本、经验复盘、内部路线图。
        # 03-patterns（复合模式）**必须留** —— 它是库的核心价值，
        #   （form-validation / list / nav / overlay / states 都在里面）
        DROP = ('05-audit/', '07-notes/', '08-plan/')
        def keep(r):
            if r.startswith(DROP):
                return False
            # 🔴 加 .png/.svg/.json
            #    原来只收 .css/.js/.md/.html 四种 ⇒ **截图全被丢掉**，
            #    slim 包里一张图都没有。这个判断是对的：
            #    「放在那边以后我都不会用的，这是极大的资源浪费」——
            #    看不到实物，就等于没有。
            return r.endswith(('.css', '.js', '.md', '.html',
                                '.png', '.svg', '.json')) \
                or os.path.basename(r) == 'VERSION'
        picked = [(a, r) for a, r in files if keep(r)]

    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for src, rel in picked:
            z.write(src, rel)
            total += os.path.getsize(src)

    print('已打包：%s%s' % (path, '（极简）' if slim else '（完整）'))
    print('  文件 %d 个 · 原始 %s · 压缩后 %s'
          % (len(picked), human(total), human(os.path.getsize(path))))
    if slim:
        print('  极简包不含：05-audit（门禁）/ 07-notes（复盘）/ 08-plan（路线图）')
    print('')
    print('包里有什么：')
    for top in ('00-charter', '01-tokens', '02-primitives', '03-patterns',
                '04-recipes', '05-audit', '06-vendor', '07-notes',
                '08-plan', '09-assets', '10-review'):
        # 🔴 修：这里原来数的是 `files`（**全量收集**），
        #    不是 `picked`（**实际打包的**）⇒ slim 明明没打 05-audit，
        #    报告却列「05-audit 44 个文件」—— **报告在骗人**。
        #    这个判断没错：「臃肿不堪」有一部分是这造成的。
        n = len([1 for _, r in picked if r.startswith(top)])
        if n:
            print('  %-16s %d 个文件' % (top, n))
    print('')
    print('⚠  未包含（我们内部的过程记录）：PLAN.md / PLAN-v2.md')
    return 0


if __name__ == '__main__':
    sys.exit(main())
