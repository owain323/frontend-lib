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
  · `README.zh-CN.md` 的 `共 **37** 个` —— `**` 让老正则整条失配，而同一文件
    另一处 `40 个组件` 是对的，于是"找到了一个数"就把错的那个放过去了
  · 两份 README 的组件表只有 37 行、标题写 40 —— 数字和清单是同一件事的两半

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


def _desc(v):
    """把"实际是什么类型/什么值"说清楚 —— 报错信息本身也是判据的一部分。

    只写 `不是字符串` 的话，读的人还得自己去文件里找；写出 `数字 37`
    才能一眼判断是"写错了"还是"结构变了"。
    """
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return '布尔 %r' % v
    if isinstance(v, (int, float)):
        return '数字 %r' % v
    if isinstance(v, str):
        return '空字符串' if not v.strip() else '字符串 %r' % v
    if isinstance(v, list):
        return '数组（%d 项）' % len(v)
    if isinstance(v, dict):
        return '对象'
    return type(v).__name__


def _nonempty_str(v):
    return isinstance(v, str) and v.strip() != ''


# ---------------------------------------------------------------- 结构校验
def validate_sources(root):
    """只看源文件。返回 [(文件, 说明)]。任何一条都足以让门禁红。"""
    errs = []

    # ---- components.json
    try:
        comp = _json(root, 'ai/components.json')
    except Exception as e:                                   # noqa: BLE001
        return [('ai/components.json', '读不出来：%s' % e)]

    # 顶层不是对象时后面所有 .get() 都会抛，直接停在这里报清楚
    if not isinstance(comp, dict):
        return [('ai/components.json', '顶层不是对象，实际是 %s' % _desc(comp))]

    items = comp.get('components')
    if not isinstance(items, list) or not items:
        return [('ai/components.json', 'components 不是非空数组，实际是 %s' % _desc(items))]

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
    # 字段"在不在"和字段"对不对"是两件事。只查前者时，`"title": null`
    # 或 `"components": "table"` 都能过 —— 前者让 llms-full 生成出
    # `undefined`，后者让 `for cid in ...` 逐字符遍历字符串。
    STR_FIELDS = ('id', 'title', 'symptom', 'fix')
    all_pids = []
    for rel in ('ai/pitfalls.json', 'ai/pitfalls-writing.json'):
        try:
            d = _json(root, rel)
        except Exception as e:                              # noqa: BLE001
            errs.append((rel, '读不出来：%s' % e))
            continue
        if not isinstance(d, dict):
            errs.append((rel, '顶层不是对象，实际是 %s' % _desc(d)))
            continue
        ps = d.get('pitfalls')
        if not isinstance(ps, list) or not ps:
            errs.append((rel, 'pitfalls 不是非空数组，实际是 %s' % _desc(ps)))
            continue
        for i, p in enumerate(ps):
            where = '%s[%d]' % (rel, i)
            if not isinstance(p, dict):
                errs.append((where, '不是对象，实际是 %s' % _desc(p)))
                continue
            for k in REQ_PITFALL:
                if k not in p:
                    errs.append((where, '缺字段 %s' % k))
            for k in STR_FIELDS:
                if k in p and not _nonempty_str(p[k]):
                    errs.append((where, '%s 必须是非空字符串，实际是 %s'
                                 % (k, _desc(p[k]))))
            if 'components' in p:
                comps = p['components']
                if not isinstance(comps, list):
                    errs.append((where, 'components 必须是数组，实际是 %s'
                                 % _desc(comps)))
                else:
                    for n, cid in enumerate(comps):
                        if not _nonempty_str(cid):
                            errs.append((where, 'components[%d] 必须是非空字符串，实际是 %s'
                                         % (n, _desc(cid))))
                        elif cid not in ids:
                            errs.append((where, '引用了不存在的组件 %r' % cid))
            if not isinstance(p.get('scope'), str) or p.get('scope') not in ALLOWED_PITFALL_SCOPE:
                errs.append((where, 'scope=%r 不在 %s'
                             % (p.get('scope'), list(ALLOWED_PITFALL_SCOPE))))
            if _nonempty_str(p.get('id')):
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

    if not isinstance(pkg, dict):
        errs.append(('package.json', '顶层不是对象，实际是 %s' % _desc(pkg)))
        return errs

    ver_file = _text(root, 'VERSION').strip()
    if pkg.get('version') != ver_file:
        errs.append(('package.json', 'version=%r 与 VERSION=%r 不一致'
                     % (pkg.get('version'), ver_file)))
    bin_ = pkg.get('bin')
    if not isinstance(bin_, dict) or not bin_.get('agentcss'):
        errs.append(('package.json', '缺 bin.agentcss —— CLI 入口没了（bin 实际是 %s）'
                     % _desc(bin_)))
    if pkg.get('dependencies'):
        errs.append(('package.json', '出现了运行时依赖 %s —— 本库的硬约束是零依赖'
                     % list(pkg['dependencies'])))
    files = pkg.get('files')
    if not isinstance(files, list) or 'ai/' not in files:
        errs.append(('package.json', 'files 里没有 ai/ —— 契约不随包发出去（files 实际是 %s）'
                     % _desc(files)))

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
#
# 🔴 为什么要容忍 Markdown 强调符
#   老写法 `(\d+)\s*个组件` 要求数字与量词**直接相邻**。README.zh-CN.md 里是
#   `共 **37** 个（stable 37 …）` —— `**` 一插进来整条就失配。更糟的是同一文件
#   另一处还有正确的 `40 个组件`，于是 check_claims 找得到数字、判定为通过，
#   而那个 37 从来没人看见。**"找到一个正确的数"不能替代"所有同类声明都对"。**
MD = r'[*_`]{0,3}'


def _num(after, group=True):
    """数字（前后允许 Markdown 强调符）+ 紧跟其后的上下文。

    group=False 用于未登记扫描：那里不要捕获组，免得和别的分支搅在一起。
    """
    n = r'(\d+)' if group else r'\d+'
    return MD + r'\s*' + n + r'\s*' + MD + r'\s*' + after


# 「共 N 个」只有在**后面接括号/句读/行尾**时才算总数声明：
#   `共 40 个（stable …）` / `共 37 个。`  → 省略的名词是"组件"
#   `共 3 个步骤`                          → 省略的是"步骤"，不是组件数
# 不做这个区分的话，任何"共 N 个X"都会被当成组件数，误报比漏报更烦人。
CN_TOTAL_TAIL = r'个(?=\s*[（(。，,、；;！!?？\n]|\s*$)'

CLAIMS = [
    ('components.total', 'llms.txt',         _num(r'components\b'),                    'llms.txt 组件数'),
    ('components.total', 'llms-full.txt',    _num(r'components\b'),                    'llms-full 组件数'),
    ('components.total', 'llms-full.txt',    r'Components\s*\(\s*(\d+)\s*\)',          'llms-full 章节标题'),
    ('pitfallsAll',      'llms-full.txt',    r'Known failure modes\s*\(\s*(\d+)\s*\)', 'llms-full 翻车点章节'),
    ('components.total', 'AGENTS.md',        _num(r'components\b'),                    'AGENTS.md 契约说明'),
    ('components.total', 'index.html',       _num(r'个组件'),                          '首页'),
    ('components.total', '404.html',         _num(r'个组件'),                          '404 页'),
    ('components.total', 'guide/index.html', _num(r'个组件'),                          '文档站索引'),
    ('components.total', 'README.md',        _num(r'components\b'),                    '英文 README 总数'),
    ('components.byMaturity.stable', 'README.md', r'stable\s+(\d+)',                   '英文 README 成熟度'),
    ('components.byMaturity.beta',   'README.md', r'beta\s+(\d+)',                     '英文 README 成熟度'),
    ('components.total', 'README.zh-CN.md',  _num(r'个组件'),                          '中文 README 总数'),
    ('components.total', 'README.zh-CN.md',  r'共\s*' + _num(CN_TOTAL_TAIL),           '中文 README 概览'),
    ('components.byMaturity.stable', 'README.zh-CN.md', r'stable\s+(\d+)',             '中文 README 成熟度'),
]

# 「未登记扫描」的范围：这些文件里出现下列任一形态，必须被 CLAIMS 全部覆盖。
# CHANGELOG 是历史记录，不在此列。
SCAN_FILES = ['README.md', 'README.zh-CN.md', 'llms.txt', 'llms-full.txt', 'AGENTS.md',
              'index.html', '404.html', 'guide/index.html']
SCAN_RE = '|'.join([
    _num(r'(?:个组件|components\b)', group=False),
    r'共\s*' + _num(CN_TOTAL_TAIL, group=False),
    r'(?:stable|beta|alpha)\s+\d+',
])

# 分节标题里的按层计数（`### primitives (17)` / `### recipes · 整页配方（5）`）。
# 它和服务端表格的行数是**同一件事的两半**：标题说 17、表里只有 15 行，
# 就是"数字改了、清单没改"—— 0.24.1 之前两份 README 都是这个状态。
TIER_HEADINGS = (
    ('components.byTier.primitive', r'primitives?'),
    ('components.byTier.pattern',   r'patterns?'),
    ('components.byTier.recipe',    r'recipes?'),
    ('components.byTier.asset',     r'assets?'),
)
LISTING_FILES = ('README.md', 'README.zh-CN.md')


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
            # 按**起点**落在已登记区间内判断，而不是整段包含：
            # 声明正则可能带 lookahead（`个(?=\s*[（(])`），扫描正则不带，
            # 两者端点会差一个字符。起点相同就是同一处声明。
            if any(a <= m.start() < b for a, b in spans):
                continue
            line = text.count('\n', 0, m.start()) + 1
            errs.append((rel, '第 %d 行有未登记的数字声明 %r'
                         ' —— 在 05-audit/_facts.py 的 CLAIMS 里登记它'
                         % (line, text[m.start():m.end()])))

    return errs


def check_listings(root, facts):
    """README 的组件清单必须"标题 == 表格行数 == 契约"三者一致。

    🔴 为什么单靠 check_claims 不够
       0.24.1 的英文 README 标题写 `primitives (17)`（对），表格里只有 15 行。
       数字对一个、清单少两个 —— check_claims 只看那个 17，看不见表格。
       中文 README 更彻底：标题写 15、表格 15 行，两边一起错，而契约是 17。
       两种形态的共同点是"某一边改了、另一边没改"，所以必须**两半都数**。
    """
    errs = []
    comps = _json(root, 'ai/components.json')['components']
    ids_by_tier = {}
    for c in comps:
        ids_by_tier.setdefault(c['tier'], []).append(c['id'])

    for rel in LISTING_FILES:
        try:
            text = _text(root, rel)
        except FileNotFoundError:
            errs.append((rel, '文件不存在（清单登记了它）'))
            continue
        lines = text.split('\n')
        for fact, pat in TIER_HEADINGS:
            tier = fact.rsplit('.', 1)[-1]
            want = _fact_value(facts, fact)
            want_ids = sorted(ids_by_tier.get(tier, []))
            head = re.compile(r'^###\s+' + pat + r'\b[^\n]*?[（(]\s*(\d+)\s*[）)]\s*$')
            seen = False
            for i, ln in enumerate(lines):
                m = head.match(ln)
                if not m:
                    continue
                seen = True
                got = int(m.group(1))
                if got != want:
                    errs.append((rel, '第 %d 行分节标题写着 %d，契约里是 %d（%s）'
                                 % (i + 1, got, want, fact)))
                j = i + 1
                while j < len(lines) and not re.match(r'^#{2,3}\s', lines[j]):
                    j += 1
                rows = [x for x in lines[i + 1:j] if re.match(r'^\|\s*`', x)]
                if len(rows) != want:
                    errs.append((rel, '第 %d 行起的分节只列了 %d 个组件，契约里是 %d（%s）'
                                 ' —— 数字和清单要一起改'
                                 % (i + 1, len(rows), want, fact)))
                # 行数对、内容不对：列了一个不存在的组件，或漏了一个
                have = sorted(r.split('`')[1] for r in rows if r.count('`') >= 2)
                if have != want_ids:
                    errs.append((rel, '第 %d 行起的分节清单与契约不符：少了 %s ／ 多了 %s'
                                 % (i + 1,
                                    sorted(set(want_ids) - set(have)) or '无',
                                    sorted(set(have) - set(want_ids)) or '无')))
            if not seen:
                errs.append((rel, '找不到 %s 的分节标题（应形如 "### primitives (17)"）'
                             % fact))
    return errs
