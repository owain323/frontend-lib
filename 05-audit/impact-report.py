#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
impact-report.py — 变更影响分析（Change Impact Analysis）

===========================================================================
🔴 它解决什么
---------------------------------------------------------------------------
  一次真实的失败实验：用本库做 14 页 PPT，AI 反复局部修改后整体崩坏，
  人工修复 1.5 小时未收口。

  复盘发现一个**机制性缺口**：改完一个文件之后，
  **没有任何东西告诉使用者「你刚才这一改，会波及哪些页面」**。
  于是只能全量重跑，或者（更常见）凭感觉决定要不要跑。

  这道脚本给出机械答案：
      改了 tokens.css     → 影响 31 个组件的页面，必须全量回归
      改了 list.css       → 只影响 list 的 1 个页面
      改了 tree.js        → 只影响 tree 的契约
      改了 10-review截图  → 不影响运行时

===========================================================================
为什么它比「多一道门禁」更有价值
---------------------------------------------------------------------------
  门禁只能在**已经改完**之后告诉你「坏了」。
  影响分析是在**改之前/刚改完**告诉你「你接下来必须检查什么」。

  ⇒ 前者让人修BUG，后者让人**不必**修 BUG。
===========================================================================
用法
---------------------------------------------------------------------------
    python3 05-audit/impact-report.py# 看当前工作区改了哪些文件
    python3 05-audit/impact-report.py --staged        # 只看暂存区
    python3 05-audit/impact-report.py --commit HEAD~1 # 看上次提交

    # CI 用法：有影响却没跑对应回归 ⇒ 退出码 1
    python3 05-audit/impact-report.py --require-regression
===========================================================================
"""
import io
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 与shot-baseline.py 的 PAGES 对齐（改组件 → 要重跑它的页面）
PAGE_OF = {}
try:
    import importlib.util
    _spec = importlib.util.spec_from_file_location(
        'sb', os.path.join(ROOT, '05-audit', 'shot-baseline.py'))
    _sb = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_sb)
    for d, f, _label in _sb.PAGES:
        PAGE_OF[d] = '%s/%s' % (d, f)
except Exception:
    # 兜底：shot-baseline 读不到时，至少能按目录推断
    PAGE_OF = {}

# 改动类别 → 必须重跑的门禁
RULES = [
    # (正则, 影响描述, 需要的门禁)
    (r'^01-tokens/tokens\.css$',
     '令牌层：全库配色/间距/字号的源头', ['contrast', 'dark-cont', 'visual', 'bleed']),
    (r'^01-tokens/typography\.css$',
     '排版层：全局字号与行高', ['contrast', 'visual']),
    (r'^01-tokens/.*\.css$',
     '令牌层其他文件：全局视觉', ['contrast', 'visual']),
    (r'^0[2349]-[a-z-]+/[a-z-]+/[a-z-]+\.css$',
     '组件样式：仅该组件的页面', ['visual', 'comment-bal']),
    (r'^0[2349]-[a-z-]+/[a-z-]+/[a-z-]+\.js$',
     '组件行为：该组件的契约与依赖它的页面', ['unit']),
    (r'^types/index\.d.ts$',
     '对外类型契约：影响所有 TypeScript 使用者', ['tsc', 'api-contract']),
    (r'^API\.md$',
     '公开 API 文档', ['api-doc', 'api-form']),
    (r'^package(-lock)?\.json$',
     '发布契约：依赖与安装方式', ['pack-smoke', 'release']),
    (r'^\.gitignore$',
     '忽略规则：影响哪些文件会入库', ['leak', 'repo-hygiene']),
]


def changed_files(mode):
    if mode == 'commit':
        ref = (sys.argv[sys.argv.index('--commit') + 1]
               if '--commit' in sys.argv else 'HEAD~1')
        p = subprocess.run(['git', 'diff', '--name-only', ref, 'HEAD'],
                           cwd=ROOT, capture_output=True, timeout=60)
    elif mode == 'staged':
        p = subprocess.run(['git', 'diff', '--cached', '--name-only'],
                           cwd=ROOT, capture_output=True, timeout=60)
    else:
        p = subprocess.run(
            ['git', '-c', 'core.quotePath=false', 'diff', '--name-only',
             'HEAD'], cwd=ROOT, capture_output=True, timeout=60)
    out = (p.stdout or b'').decode('utf-8', 'replace')
    return [f.strip() for f in out.split('\n') if f.strip()]


def classify(files):
    """返回 (全局影响, 局部影响[文件], 需要门禁 set, 需要页面 list)"""
    shared, local = [], []
    gates, pages = set(), set()
    for f in files:
        if f.startswith('10-review/') or f.startswith('05-audit/') \
                or f.startswith('docs/'):
            continue                      # 不影响运行时
        matched = False
        for pat, desc, gs in RULES:
            if re.match(pat, f):
                matched = True
                gates.update(gs)
                if '令牌层' in desc or '排版层' in desc:
                    shared.append((f, desc))
                else:
                    local.append((f, desc))
                # 组件文件 → 找它对应的页面
                d = os.path.dirname(f)
                if d in PAGE_OF:
                    pages.add(PAGE_OF[d])
                break
        if not matched and re.search(r'\.(css|html)$', f):
            local.append((f, '未分类的样式/页面文件（按最坏情况处理）'))
    return shared, local, gates, pages


def main():
    args = sys.argv[1:]
    mode = 'commit' if '--commit' in args else \
           'staged' if '--staged' in args else 'work'
    files = changed_files(mode)
    src = {'commit': '上次提交', 'staged': '暂存区', 'work': '工作区'}[mode]

    print('  === 变更影响分析（%s）===' % src)
    print('')
    if not files:
        print('  没有改动。')
        return 0

    shared, local, gates, pages = classify(files)
    print('  改动 %d 个文件' % len(files))

    if shared:
        print('')
        print('  🔴 全局影响（必须**全量**回归）：')
        for f, desc in shared:
            print('     %-42s %s' % (f[:42], desc))

    if local:
        print('')
        print('  🟡 局部影响（只需检查这些）：')
        for f, desc in local:
            print('     %-42s %s' % (f[:42], desc))

    if pages:
        print('')
        print('  ⇒ 需要重跑视觉回归的页面（%d 个）：' % len(pages))
        for p in sorted(pages):
            print('     %s' % p)

    if gates:
        print('')
        print('  ⇒ 必须通过的门禁：%s' % ' '.join(sorted(gates)))

    print('')
    if shared:
        print('  ⚠️  改了共享层⇒ 未跑全量视觉回归前，不要认为改好了。')
        print('     这正是「改一处、14 页全变」的机制来源。')
    else:
        print('  ⇒ 改动是局部的，跑上面的门禁即可。')

    # CI 用：有全局影响却显式要求跳回归 ⇒ 报错
    if '--require-regression' in args and shared and '--no-visual' in args:
        print('')
        print('  🔴 有全局影响但显式跳过了视觉回归')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())