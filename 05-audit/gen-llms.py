#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen-llms.py — 生成 `llms-full.txt`（给 AI 编码代理的一页式参考）

===========================================================================
为什么需要它，以及为什么只有这一半是生成的
---------------------------------------------------------------------------
  发现层要两份文件：

    llms.txt       短、稳定、**手写**。它是定位声明（这是什么 / 去哪查 /
                   几条硬规矩），不随组件数量变化 —— 手写才不会写成模板腔。
    llms-full.txt  长、逐组件、**生成**。39 个组件的手写清单一定会漂：
                   加一个组件忘改一次，读者看到的是一份"少一个"的表。

  ⇒ 分工：手写的部分归人，可枚举的部分归机器。
     `llms.txt` 里那个"39 components"由 `docs-site-gate.py` 对着
     `ai/components.json` 核 —— 手写不等于没人管。

===========================================================================
判据（不在本文件里自证）
---------------------------------------------------------------------------
  · 生成是**确定性**的：同样输入跑两遍，字节相同（不写时间戳）
  · 入库产物 == 现算产物（`docs-site-gate.py` 逐字节比）

用法：
    python3 05-audit/gen-llms.py           # 就地生成
    python3 05-audit/gen-llms.py --check   # 只比，不写（门禁用）
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AI = os.path.join(ROOT, 'ai')
OUT = os.path.join(ROOT, 'llms-full.txt')

# 表格里 purpose 的截断长度。为什么是 40：
#   39 行 × 40 汉字 ≈ 1.5k token，整份文件落在 ~3k token；
#   再长就会挤掉"翻车点"那一列 —— 而后者是这份文件相对 components.json 的**增量**。
PURPOSE_MAX = 40


def read(name):
    with io.open(os.path.join(AI, name), encoding='utf-8') as f:
        return json.load(f)


def kb(rel):
    try:
        n = os.path.getsize(os.path.join(ROOT, rel))
    except OSError:
        return '?'
    return '%.1f' % (n / 1024.0)


def cell(s):
    """表格单元格：竖线与换行会直接把表撑破（Markdown 表格的硬约束）。"""
    return (s or '').replace('|', '\\|').replace('\n', ' ').strip()


def clip(s, n=PURPOSE_MAX):
    s = cell(s)
    return s if len(s) <= n else s[:n - 1] + '…'


# 翻车点分两份文件（组件级 / 写作级）。生成器要**合并**，否则 llms-full.txt
# 会漏掉一半 —— 而漏掉的部分恰好是"读者会读到的文字"那一类。
PITFALL_FILES = ['pitfalls.json', 'pitfalls-writing.json']


def build():
    comp = read('components.json')
    pit = {'pitfalls': []}
    for fn in PITFALL_FILES:
        pit['pitfalls'] = pit['pitfalls'] + (read(fn).get('pitfalls') or [])
    beh = read('behaviors.json')
    tok = read('tokens.json')
    meta = json.load(io.open(os.path.join(ROOT, 'package.json'), encoding='utf-8'))
    version = meta['version']

    comps = sorted(comp['components'], key=lambda c: (c['tier'], c['id']))
    pitfalls = pit.get('pitfalls', [])

    by_comp = {}
    for p in pitfalls:
        for cid in p.get('components') or []:
            by_comp.setdefault(cid, []).append(p['id'])

    L = []
    A = L.append

    A('# agentcss — full reference (one file)')
    A('')
    A('> Generated from `ai/components.json` + `ai/pitfalls*.json` + `ai/behaviors.json`'
      ' at version **%s**.' % version)
    A('> Do not edit by hand: run `python 05-audit/gen-llms.py` (freshness is gated).')
    A('> Short version: `llms.txt`. Machine contract: `ai/*.json`.')
    A('')
    A('Mobile-web CSS component library. Tokens + components + optional behaviour scripts.')
    A('No build step, no framework, no third-party runtime dependency. Class names are the API.')
    A('')
    A('## 1 · Query instead of guessing')
    A('')
    A('```bash')
    A('npx agentcss ai components --json                     # 39 components, joined with pitfalls')
    A('npx agentcss ai components --json --maturity=stable')
    A('npx agentcss ai pitfalls --json --component=table')
    A('npx agentcss ai tokens --json --set=dark')
    A('npx agentcss ai tree --json --set=dark --cat=color')
    A('npx agentcss ai validate <file> --schema=components --json')
    A('npx agentcss ai check <doc.json> --profile=strict --json')
    A('```')
    A('')
    A('Every subcommand accepts `--json`; failures print `{"ok":false,...}` and exit non-zero.')
    A('')
    A('## 2 · Components (%d)' % len(comps))
    A('')
    A('`class` is the root class you put on the element; `js` is the behaviour script (`—` = CSS only).')
    A('')
    A('| id | class | tier | maturity | css | js | what it is | pitfalls |')
    A('|---|---|---|---|---|---|---|---|')
    for c in comps:
        files = c.get('files') or {}
        js = files.get('js')
        pids = by_comp.get(c['id']) or []
        A('| `%s` | `%s` | %s | %s | %s KB | %s | %s | %s |' % (
            c['id'], c.get('rootClass') or c['id'], c['tier'], c['maturity'],
            kb(files['css']) if files.get('css') else '—',
            ('`%s`' % os.path.basename(js)) if js else '—',
            clip(c.get('purpose')), (' '.join('`%s`' % x for x in pids) or '—')))
    A('')
    A('## 3 · Known failure modes (%d)' % len(pitfalls))
    A('')
    A('Each one has actually shipped at least once. Full text: `npx agentcss ai pitfalls --json`.')
    A('')
    order = [('component', 'Component'), ('layout', 'Layout'), ('process', 'Process'),
             ('writing', 'Writing / publishing')]
    for key, label in order:
        rows = [p for p in pitfalls if p.get('scope') == key]
        if not rows:
            continue
        A('**%s (%d)**' % (label, len(rows)))
        A('')
        for p in rows:
            tags = (' · ' + ', '.join(p.get('tags') or [])) if p.get('tags') else ''
            A('- `%s` — %s%s' % (p['id'], cell(p['title']), tags))
        A('')
    A('## 4 · Tokens')
    A('')
    A('Light %d / dark %d. Two exports, same values:' % (
        tok['coverage']['lightCount'], tok['coverage']['darkCount']))
    A('')
    A('- `ai/tokens.json` — DTCG shape (`$value` / `$type`), feed to design tools')
    A('- `ai/tokens.tree.json` — grouped, `value` / `type` without `$`, feed to build tools')
    A('')
    A('Restyle by overriding CSS variables (`--accent`, `--paper`, `--sp-4`, …).')
    A('Never rewrite a component selector: it wins on specificity today and breaks silently later.')
    A('')
    A('## 5 · Behaviour cores')
    A('')
    A('| core | global | what it does |')
    A('|---|---|---|')
    for name in sorted(beh['behaviors']):
        b = beh['behaviors'][name]
        A('| %s | `%s` | %s |' % (name, b['fn'], cell(b['meaning'])))
    A('')
    A('These are shared by drawer / tabs / dropdown / overlay / combobox — do not re-implement them.')
    A('')
    A('## 6 · Conventions that are actually gated')
    A('')
    A('- 44×44 px touch targets; `:focus-visible` only, never `outline: 0`.')
    A('- States must survive forced-colors: backgrounds are dropped, borders and text are kept.')
    A('- Logical properties only (`margin-inline`, `inset-block`) — RTL is not a special case.')
    A('- `prefers-reduced-motion` shortens or removes every animation.')
    A('- Wide content gets its own `overflow-x` container with `tabindex="0"`.')
    A('')
    A('## 7 · Docs and language')
    A('')
    A('- `README.md` — English quickstart · `README.zh-CN.md` — Chinese detail')
    A('- `ai/START-HERE.md` — Chinese navigation for agents')
    A('- `demo.html` in each component directory — the ground truth for markup')
    A('- Prose docs are Chinese; JSON keys, CLI flags and this file are English.')
    A('')
    return '\n'.join(L)


def main():
    text = build()
    check = '--check' in sys.argv
    old = None
    if os.path.isfile(OUT):
        with io.open(OUT, encoding='utf-8') as f:
            old = f.read()
    if check:
        if old != text:
            print('  [FAIL] llms-full.txt 与现算结果不一致 —— 跑 python 05-audit/gen-llms.py')
            return 1
        print('  [OK] llms-full.txt 与现算结果一致（%d 字节）' % len(text.encode('utf-8')))
        return 0
    with io.open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    print('  已生成 llms-full.txt（%d 字节）' % len(text.encode('utf-8')))
    return 0


if __name__ == '__main__':
    sys.exit(main())
