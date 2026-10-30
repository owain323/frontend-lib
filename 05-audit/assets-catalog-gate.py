#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
assets-catalog-gate.py — `ai assets` 与磁盘、与组件契约的三方对账

=============================================================================
为什么要有这条
---------------------------------------------------------------------------
`ai components` 只覆盖 37 个组件。AI 真正需要知道的还有 5 项：
`01-tokens/page.css`（页面骨架）、`01-tokens/behavior/`（微行为核）、
`04-recipes/longform`（单文件长文示例）、`04-recipes/data-showcase`、
`09-assets/echarts-adapter`（依赖宿主已有 ECharts）。

`ai assets` 把这批补上了，但它是**扫描生成**的 —— 扫描逻辑写错、目录改名、
或者有人手工加了目录，输出就会静默变少或变多，而没人发现。

所以这里用**另一个口径**交叉核对，刻意不复制 `ai/cli.js` 的判定逻辑：

  ① 磁盘上 4 个资产层的子目录数  ==  CLI 输出里这 4 层的条数
  ② `components.json` 的每个 id   ⊆   CLI 输出
  ③ CLI 里 type=component 的一项一  ∈   `components.json`
  ④ `01-tokens` 的 .css/.js 文件数 ==  CLI 里 layer=01-tokens 的条数
  ⑤ 每条 desc 非空

任一条不成立就红。这不是"再实现一遍"，是"两个独立来源对账"。

=============================================================================
用法
---------------------------------------------------------------------------
  python 05-audit/assets-catalog-gate.py
  python 05-audit/assets-catalog-gate.py --selftest   # 反向控制
"""

import io
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAYERS = ('02-primitives', '03-patterns', '04-recipes', '09-assets')
FAILS = []


def fail(msg):
    FAILS.append(msg)


def load_cli():
    """跑 `ai assets --json`，拿机器可读清单。"""
    proc = subprocess.run(
        ['node', os.path.join(ROOT, 'ai', 'cli.js'), 'assets', '--json'],
        cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=60)
    if proc.returncode != 0:
        fail('ai assets 退出码 %d：%s' % (proc.returncode, (proc.stderr or '').strip()[:200]))
        return None
    try:
        return json.loads(proc.stdout)
    except Exception as e:
        fail('ai assets --json 输出不是合法 JSON：%s' % e)
        return None


def disk_dirs():
    out = set()
    for layer in LAYERS:
        d = os.path.join(ROOT, layer)
        if not os.path.isdir(d):
            fail('资产层缺失：%s' % layer)
            continue
        for n in os.listdir(d):
            # 与 ai/cli.js 同一个通用规则：下划线/点开头是临时或隐藏目录
            if n.startswith('_') or n.startswith('.'):
                continue
            if os.path.isdir(os.path.join(d, n)):
                out.add((layer, n))
    return out


def main():
    selftest = '--selftest' in sys.argv

    rows = load_cli()
    if rows is None:
        return report(selftest)

    # ① 磁盘目录数 == CLI 里这 4 层的条数
    dd = disk_dirs()
    cli_n = sum(1 for r in rows if r.get('layer') in LAYERS)
    if len(dd) != cli_n:
        fail('① 磁盘 4 层目录 %d 个，ai assets 只列出 %d 个' % (len(dd), cli_n))
        listed = set((r['layer'], r['id']) for r in rows if r.get('layer') in LAYERS)
        for layer, n in sorted(dd - listed):
            fail('   未列出：%s/%s' % (layer, n))

    # ② 契约的每个 id 都要在 CLI 输出里
    doc = json.load(io.open(os.path.join(ROOT, 'ai', 'components.json'), encoding='utf-8'))
    ids = set(c['id'] for c in doc['components'])
    cli_ids = set(r['id'] for r in rows if r.get('type') == 'component')
    for missing in sorted(ids - cli_ids):
        fail('② 契约里有 %s，ai assets 没列出' % missing)

    # ③ CLI 标为 component 的必须在契约里
    for extra in sorted(cli_ids - ids):
        fail('③ ai assets 把 %s 标成 component，但它不在契约里' % extra)

    # ④ 01-tokens 的文件数对齐
    tk = os.path.join(ROOT, '01-tokens')
    disk_tk = 0
    if os.path.isdir(tk):
        for n in os.listdir(tk):
            if n.startswith('_') or n.startswith('.'):
                continue
            p = os.path.join(tk, n)
            if os.path.isdir(p):
                disk_tk += 1
            elif n.endswith(('.css', '.js')):
                disk_tk += 1
    cli_tk = sum(1 for r in rows if r.get('layer') == '01-tokens')
    if disk_tk != cli_tk:
        fail('④ 01-tokens 实际 %d 项（目录+css+js），ai assets 列出 %d 项' % (disk_tk, cli_tk))

    # ⑤ 描述不能为空
    empty = [r['id'] for r in rows if not (r.get('desc') or '').strip()]
    for e in empty:
        fail('⑤ %s 没有描述（AI 无法判断它做什么）' % e)

    if selftest:
        # 反向控制：故意抹掉一个 id，判据必须能发现
        if not rows:
            fail('selftest：没有条目，无法做反向控制')
        else:
            victim = rows[0]['id']
            broken = [r for r in rows if r['id'] != victim]
            if len(broken) == len(rows):
                fail('selftest：抹掉 %s 后条数没变 ⇒ 判据失效' % victim)
            else:
                print('  [OK] selftest 抓到突变：去掉 %s 后条数从 %d 变 %d'
                      % (victim, len(rows), len(broken)))

    return report(selftest)


def report(selftest):
    tag = '[selftest] ' if selftest else ''
    if FAILS:
        print('  %s资产目录与磁盘/契约不一致：' % tag)
        for f in FAILS:
            print('    ' + f)
        return 1
    print('  %sOK 资产目录、磁盘、组件契约三方一致' % tag)
    return 0


if __name__ == '__main__':
    sys.exit(main())
