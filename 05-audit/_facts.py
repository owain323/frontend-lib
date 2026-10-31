# -*- coding: utf-8 -*-
r"""
_facts.py — 项目事实的**唯一提取层**（G0-1）

============================================================================
这个模块解决什么
----------------------------------------------------------------------------
同一个数字在仓库里有多个"手抄本"，迟早会漂。已经真实发生过三次：

  · `llms-full.txt` 第 13 行 `# 39 components`、第 118 行 `Components (40)`
    —— 同一文件两个数，因为生成器里那行是写死的字符串
  · `AGENTS.md` 第 3 行 `39 components`（手写，没有门禁看着）
  · 讨论文档里 `pitfalls` 写 19 条，实际 20 条

⇒ 纪律：**机器算得出来的，就不许手写。** 手写只能写解释，不能写计数。

============================================================================
三条边界（写在这里，防止后来的人把这里变成垃圾桶）
----------------------------------------------------------------------------
① 只放**机器能可靠算出来的**事实。
   "stable 到底保证了什么"、"是否经过真机验证"、"某个门禁有没有牙"
   —— 这些是契约与证据，不是计数，不许塞进来伪装成一个数字。

② 本模块的返回值**不落盘成常量**。
   任何调用方要么现算，要么读 `facts.json`（那是生成物，由 --write 产出）。

③ `validate()` 只看**源文件**，不看 `facts.json`。
   校验器一旦读生成物，就会变成"自己校验自己"——`docs-site-gate` 的
   判据 ① 就是这么失效的（生成器写死 39，文件也是 39，逐字节相等 ⇒ 绿）。
"""
from __future__ import annotations

import io
import json
import os
import re
import subprocess
import sys

ALLOWED_TIERS = ('primitive', 'pattern', 'recipe', 'asset')
ALLOWED_MATURITY = ('stable', 'beta', 'alpha')
ALLOWED_PITFALL_SCOPE = ('component', 'layout', 'process', 'writing')

REQ_COMPONENT = ('id', 'tier', 'purpose', 'rootClass', 'maturity', 'files')
REQ_PITFALL = ('id', 'title', 'scope', 'components', 'symptom', 'fix')


# ---------------------------------------------------------------- 读文件
def _text(root, rel):
    p = os.path.join(root, rel)
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def _json(root, rel):
    return json.loads(_text(root, rel))


# ---------------------------------------------------------------- 结构校验
def validate_sources(root):
    """只看源文件。返回 [(文件, 说明)]。任何一条都足以让门禁红。"""
    errs = []

    # ---- components.json
    try:
        comp = _json(root, 'ai/components.json')
    except Exception as e:                                   # noqa: BLE001
        return [('ai/components.json', '读不出来：%s' % e)]

    items = comp.get('components')
    if not isinstance(items, list) or not items:
        return [('ai/components.json', 'components 不是非空数组')]

    ids = []
    for i, c in enumerate(items):
        where = 'ai/components.json[%d]%s' % (i, ' ' + str(c.get('id')) if isinstance(c, dict) else '')
        if not isinstance(c, dict):
            errs.append((where, '不是对象'))
            continue
        for k in REQ_COMPONENT:
            if k not in c or c[k] in (None, '', {}):
                errs.append((where, '缺字段 %s' % k))
        cid = c.get('id')
        if isinstance(cid, str):
            ids.append(cid)
        else:
            errs.append((where, 'id 不是字符串'))
        if c.get('tier') not in ALLOWED_TIERS:
            errs.append((where, 'tier=%r 不在 %s' % (c.get('tier'), list(ALLOWED_TIERS))))
        if c.get('maturity') not in ALLOWED_MATURITY:
            errs.append((where, 'maturity=%r 不在 %s' % (c.get('maturity'), list(ALLOWED_MATURITY))))
        # global 为 null 是合法的（纯 CSS 组件没有行为层）；只要不是 null 就必须是字符串
        if c.get('global') is not None and not isinstance(c['global'], str):
            errs.append((where, 'global 不是字符串（也不是 null）：%r' % (c['global'],)))
        if not isinstance(c.get('files'), dict):
            errs.append((where, 'files 不是对象'))

    dup = sorted({x for x in ids if ids.count(x) > 1})
    if dup:
        errs.append(('ai/components.json', 'id 重复：%s' % ', '.join(dup)))

    # ---- pitfalls（两份，id 必须全局唯一）
    all_pids = []
    for rel in ('ai/pitfalls.json', 'ai/pitfalls-writing.json'):
        try:
            d = _json(root, rel)
        except Exception as e:                              # noqa: BLE001
            errs.append((rel, '读不出来：%s' % e))
            continue
        ps = d.get('pitfalls')
        if not isinstance(ps, list) or not ps:
            errs.append((rel, 'pitfalls 不是非空数组'))
            continue
        for i, p in enumerate(ps):
            where = '%s[%d]' % (rel, i)
            if not isinstance(p, dict):
                errs.append((where, '不是对象'))
                continue
            for k in REQ_PITFALL:
                if k not in p:
                    errs.append((where, '缺字段 %s' % k))
            if p.get('scope') not in ALLOWED_PITFALL_SCOPE:
                errs.append((where, 'scope=%r 不在 %s'
                             % (p.get('scope'), list(ALLOWED_PITFALL_SCOPE))))
            for cid in (p.get('components') or []):
                if cid not in ids:
                    errs.append((where, '引用了不存在的组件 %r' % cid))
            if isinstance(p.get('id'), str):
                all_pids.append((p['id'], rel))

    seen = {}
    for pid, rel in all_pids:
        if pid in seen:
            errs.append((rel, 'pitfall id 与 %s 重复：%s' % (seen[pid], pid)))
        seen[pid] = rel

    # ---- package.json / VERSION
    try:
        pkg = _json(root, 'package.json')
    except Exception as e:                                  # noqa: BLE001
        errs.append(('package.json', '读不出来：%s' % e))
        return errs

    ver_file = _text(root, 'VERSION').strip()
    if pkg.get('version') != ver_file:
        errs.append(('package.json', 'version=%r 与 VERSION=%r 不一致'
                     % (pkg.get('version'), ver_file)))
    if not pkg.get('bin', {}).get('agentcss'):
        errs.append(('package.json', '缺 bin.agentcss —— CLI 入口没了'))
    if pkg.get('dependencies'):
        errs.append(('package.json', '出现了运行时依赖 %s —— 本库的硬约束是零依赖'
                     % list(pkg['dependencies'])))
    if 'ai/' not in (pkg.get('files') or []):
        errs.append(('package.json', 'files 里没有 ai/ —— 契约不随包发出去'))

    return errs


# ---------------------------------------------------------------- 提取
def _cli_names(root):
    """子命令名从 `ai/cli.js` 自己导出的 CMDS 来，不抄一份清单。"""
    js = ('const m=require(process.argv[1]);'
          'process.stdout.write(JSON.stringify(Object.keys(m.CMDS)));')
    out = subprocess.run([_node(), '-e', js, os.path.join(root, 'ai', 'cli.js')],
                         capture_output=True, timeout=60)
    if out.returncode != 0:
        raise RuntimeError('ai/cli.js 取 CMDS 失败：%s'
                           % (out.stderr or b'').decode('utf-8', 'replace')[:200])
    return json.loads(out.stdout.decode('utf-8'))


def _node():
    return 'node'


def collect(root):
    """从源文件现算。不读 facts.json，不读任何手工统计。"""
    comp = _json(root, 'ai/components.json')['components']
    pit = _json(root, 'ai/pitfalls.json')['pitfalls']
    pitw = _json(root, 'ai/pitfalls-writing.json')['pitfalls']
    pkg = _json(root, 'package.json')

    by_tier = {t: 0 for t in ALLOWED_TIERS}
    by_maturity = {m: 0 for m in ALLOWED_MATURITY}
    for c in comp:
        by_tier[c['tier']] += 1
        by_maturity[c['maturity']] += 1

    by_scope = {s: 0 for s in ALLOWED_PITFALL_SCOPE}
    for p in pit + pitw:
        by_scope[p['scope']] += 1

    return {
        'schemaVersion': 1,
        'generatedBy': '05-audit/facts-gate.py --write',
        'version': _text(root, 'VERSION').strip(),
        'components': {
            'total': len(comp),
            'byTier': by_tier,
            'byMaturity': by_maturity,
            'withBehaviorLayer': sum(1 for c in comp if c.get('global')),
        },
        'pitfalls': {
            'total': len(pit),
            'byScope': {k: v for k, v in by_scope.items() if k != 'writing'},
        },
        'pitfallsWriting': {'total': len(pitw)},
        'pitfallsAll': len(pit) + len(pitw),
        'dependencies': {
            'runtime': len(pkg.get('dependencies') or {}),
            'dev': len(pkg.get('devDependencies') or {}),
        },
        'cli': {'subcommands': len(_cli_names(root))},
    }


# ---------------------------------------------------------------- 对外声明
# 「声明清单」登记的是**位置**（哪个文件、什么句式），不是**值**。
# 值永远来自 collect()。新增一处数字声明就要在这里登记一行，否则
# check_claims() 的"未登记声明"扫描会报红 —— 这是为了防止漂移复发。
CLAIMS = [
    ('components.total', 'llms.txt',            r'(\d+)\s+components',            'llms.txt 组件数'),
    ('components.total', 'llms.txt',            r'all (\d+)\s+components',        'llms.txt CLI 示例'),
    ('components.total', 'llms-full.txt',       r'(\d+)\s+components, joined',    'llms-full CLI 示例'),
    ('components.total', 'llms-full.txt',       r'Components \((\d+)\)',          'llms-full 章节标题'),
    ('pitfallsAll',      'llms-full.txt',       r'Known failure modes \((\d+)\)', 'llms-full 翻车点章节'),
    ('components.total', 'AGENTS.md',           r'(\d+)\s+components',            'AGENTS.md 契约说明'),
    ('components.total', 'index.html',          r'(\d+)\s*个组件',                '首页'),
    ('components.total', '404.html',            r'(\d+)\s*个组件',                '404 页'),
    ('components.total', 'guide/index.html',    r'(\d+)\s*个组件',                '文档站索引'),
    ('components.total', 'README.zh-CN.md',     r'(\d+)\s*个组件',                '中文 README'),
]

# 「未登记扫描」的范围：这些文件里出现 N components / N 个组件，
# 必须被上面的 CLAIMS 全部覆盖。CHANGELOG 是历史记录，不在此列。
SCAN_FILES = ['README.md', 'README.zh-CN.md', 'llms.txt', 'llms-full.txt', 'AGENTS.md',
              'index.html', '404.html', 'guide/index.html']
SCAN_RE = r'\d+\s*(?:个组件|components)'


def _fact_value(facts, path):
    cur = facts
    for k in path.split('.'):
        cur = cur[k]
    return cur


def check_claims(root, facts):
    """独立校验：直接从**生成物/文档**里把数字抠出来，与现算值比。

    不复用任何生成器的拼接结果 —— 这正是 docs-site-gate 判据 ① 失效的方式。
    """
    errs = []
    registered = {}          # rel -> [(start, end)]
    for fact, rel, pat, label in CLAIMS:
        try:
            text = _text(root, rel)
        except FileNotFoundError:
            errs.append((rel, '文件不存在（声明清单登记了 %s）' % label))
            continue
        want = _fact_value(facts, fact)
        hits = list(re.finditer(pat, text))
        if not hits:
            errs.append((rel, '%s：找不到数字（期望 %s = %d）' % (label, fact, want)))
            continue
        for m in hits:
            got = int(m.group(1))
            line = text.count('\n', 0, m.start()) + 1
            if got != want:
                errs.append((rel, '%s 第 %d 行：写着 %d，源文件算出来是 %d（%s）'
                             % (label, line, got, want, fact)))
        if rel not in registered:
            registered[rel] = []
        registered[rel].extend(m.span() for m in hits)

    # 未登记的数字声明：防止有人新写一句 "41 components" 而没人管
    for rel in SCAN_FILES:
        try:
            text = _text(root, rel)
        except FileNotFoundError:
            continue
        spans = registered.get(rel, [])
        for m in re.finditer(SCAN_RE, text):
            if any(m.start() >= a and m.end() <= b for a, b in spans):
                continue
            line = text.count('\n', 0, m.start()) + 1
            errs.append((rel, '第 %d 行有未登记的数字声明 %r'
                         ' —— 在 05-audit/_facts.py 的 CLAIMS 里登记它'
                         % (line, text[m.start():m.end()])))

    return errs
