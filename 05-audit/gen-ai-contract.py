#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
gen-ai-contract.py — 生成 ai/components.json 与 ai/tokens.json

============================================================================
🔴 为什么要有这个脚本
----------------------------------------------------------------------------
对标 Open Props / Primer 时挖出的结构性缺口（见 08-plan/L批次-对标五强.md §三）：

    我们此前【没有任何机器可读的契约】。
    想回答「这个库有哪些组件、哪些插槽、哪些状态、哪些令牌」，
    只能去读 CSS 注释里的中文散文 —— 散文无法被断言，无法做结构化编辑。

    这就是 PPT 事故的技术根因之一：模型看不到可断言的接口，只能自由发挥。

============================================================================
真值方向（重要，和 Open Props 相反，理由写在这里）
----------------------------------------------------------------------------
Open Props:  JS/JSON 是真值 → 生成 CSS
我们:        CSS 是真值     → 生成 JSON

为什么不反过来：tokens.css 里每个色值都带着实测对比度注释（例：
「--scrollbar-thumb #7A808A 对 #ffffff 3.98:1」），那些注释是**有价值的知识**，
改成从 JSON 生成会全部丢掉。

⇒ 所以我们做的是【单向生成 + 一致性门禁】：CSS 仍是人写的真值，
  JSON 是导出物，`--check` 保证两者不漂移。比双向同步安全。

============================================================================
哪些字段是机械抽的，哪些是人声明的
----------------------------------------------------------------------------
  机械（本脚本从源码抽）：files / elements / variants / states / aria / uses
  人工（ai/components.meta.json）：rootClass / purpose / tier

  ⚠️ 为什么 rootClass 必须人声明：实测根类命名毫无规律 ——
     button→.btn  content→.prose  dropdown→.dd  date-range→.drange
     input→.field  overlay→.toast  combobox→.combo
     **机械猜不出来**。所以：人声明 + 脚本验证它在 CSS 里真的存在（双向）。
     猜错 ⇒ 红。

============================================================================
用法
----------------------------------------------------------------------------
  python3 05-audit/gen-ai-contract.py            # 生成
  python3 05-audit/gen-ai-contract.py --check    # 只校验（门禁用）
============================================================================
"""
from __future__ import annotations

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AI = os.path.join(ROOT, 'ai')
META = os.path.join(AI, 'components.meta.json')
OUT_COMPONENTS = os.path.join(AI, 'components.json')
OUT_TOKENS = os.path.join(AI, 'tokens.json')
TOKENS_CSS = os.path.join(ROOT, '01-tokens', 'tokens.css')
BEHAVIORS = os.path.join(AI, 'behaviors.json')


def load_behavior_matrix():
    """M8：成熟度判据要用行为矩阵（manual / gap）。

    ⚠️ 文件不存在 ⇒ 返回空 dict（而不是崩）：本文件也用于 `--check`，
       行为矩阵是另一张独立的表，不该让它俩互相锁死。
    """
    if not os.path.isfile(BEHAVIORS):
        return {}
    return json.loads(io.open(BEHAVIORS, encoding='utf-8').read()).get('matrix', {})


BEH_MATRIX = load_behavior_matrix()

SCAN = [
    ('02-primitives', 'primitive'),
    ('03-patterns', 'pattern'),
    ('04-recipes', 'recipe'),
]

# ---------------------------------------------------------------- 抽取正则
RE_ELEMENT = re.compile(r'\.([A-Za-z][A-Za-z0-9-]*)__([A-Za-z0-9-]+)')
RE_VARIANT = re.compile(r'\.([A-Za-z][A-Za-z0-9-]*)--([A-Za-z0-9-]+)')
RE_STATE_VAL = re.compile(r'\[data-([a-z-]+)\s*=\s*["\']?([A-Za-z0-9_-]+)["\']?\]')
RE_STATE_BOOL = re.compile(r'\[data-([a-z-]+)\]')
RE_ISCLASS = re.compile(r'\.is-([a-z][a-z0-9-]*)')
RE_ROLE = re.compile(r'role\s*=\s*["\']([a-z]+)["\']')
RE_ARIA = re.compile(r'\baria-([a-z]+)\s*=')
# ⚠️ `=(?!=)` 是必需的，不是洁癖：
#    第一版写成 `\s*=`，而核里有 `typeof window.CustomEvent === 'function'`
#    ⇒ `===` 的第一个 `=` 被当成赋值 ⇒ 10 个组件的 global 全被抓成
#    `CustomEvent`（实测事故，见 CHANGELOG 0.7.1 修一节）。
#    两种写法都要认：`window.X = `（直接挂）与 `global.X = `（IIFE 参数）。
#    只认前者时，select / dropdown / tree 这些的 global 一直是 `null`
#    —— 契约在骗人：它们明明都有全局对象。
RE_GLOBAL = re.compile(r'(?:window|global)\.([A-Z][A-Za-z0-9]*)\s*=(?!=)')

# 🔴 注入块里的**不是这个组件自己的代码** —— 它是核的副本。
#    凡"这个组件是什么"的抽取，都必须先把它摘掉，否则核一改，
#    27 个组件的契约跟着变（而且没人会发现）。
RE_INJECT_BEGIN = re.compile(r'/\*\s*=+\s*BEHAVIOR INJECT BEGIN:.*?\*/')
RE_INJECT_END = re.compile(r'/\*\s*=+\s*BEHAVIOR INJECT END:.*?\*/')


def read(path):
    with io.open(path, 'r', encoding='utf-8') as f:
        return f.read()


def strip_inject(text):
    """摘掉 `BEHAVIOR INJECT` 块（核被整块注入进使用点，那不是组件的源码）。"""
    out = []
    in_block = False
    for ln in text.split('\n'):
        if RE_INJECT_BEGIN.search(ln):
            in_block = True
            continue
        if RE_INJECT_END.search(ln):
            in_block = False
            continue
        if not in_block:
            out.append(ln)
    return '\n'.join(out)


def strip_comments(css):
    """去掉 CSS 注释。返回 (无注释文本, 是否平衡)。"""
    out = []
    i, n = 0, len(css)
    balanced = True
    while i < n:
        if css[i:i + 2] == '/*':
            end = css.find('*/', i + 2)
            if end < 0:
                balanced = False
                break
            out.append(' ')
            i = end + 2
        else:
            out.append(css[i])
            i += 1
    return ''.join(out), balanced


def first(d, *names):
    for nm in names:
        p = os.path.join(d, nm)
        if os.path.isfile(p):
            return p
    return None


def scan_component(cid, cdir, tier, meta):
    css_path = first(cdir, cid + '.css')
    if css_path is None:
        cands = [f for f in os.listdir(cdir) if f.endswith('.css')]
        if not cands:
            return None
        css_path = os.path.join(cdir, sorted(cands)[0])

    css_raw = read(css_path)
    css, balanced = strip_comments(css_raw)
    if not balanced:
        raise SystemExit('[FAIL] %s 的注释不闭合，无法安全解析' % css_path)

    js_path = first(cdir, cid + '.js')
    if js_path is None:
        cands = [f for f in os.listdir(cdir) if f.endswith('.js')]
        if cands:
            js_path = os.path.join(cdir, sorted(cands)[0])
    demo_path = first(cdir, 'demo.html')

    js_text = strip_inject(read(js_path)) if js_path else ''
    text = css
    if js_path:
        text += '\n' + js_text
    if demo_path:
        text += '\n' + read(demo_path)

    root = meta.get('rootClass')
    if not root:
        raise SystemExit('[FAIL] %s 在 components.meta.json 里没有 rootClass' % cid)

    # 🔴 双向验证：人声明的根类必须真的在 CSS 里出现
    if not re.search(r'\.' + re.escape(root) + r'(?![\w-])', css):
        raise SystemExit(
            '[FAIL] %s 声明的根类 .%s 在其 CSS 里不存在 —— '
            '声明与源码已经漂移' % (cid, root))

    elements, foreign = [], []
    for pre, el in sorted(set(RE_ELEMENT.findall(css))):
        (elements if pre == root else foreign).append(pre + '__' + el)

    variants = sorted({'--'.join(m) for m in RE_VARIANT.findall(css)
                       if m[0] == root})

    enum_states, bool_states = {}, set()
    for attr, val in RE_STATE_VAL.findall(css):
        enum_states.setdefault(attr, set()).add(val)
    for attr in RE_STATE_BOOL.findall(css):
        bool_states.add(attr)
    legacy = sorted(set(RE_ISCLASS.findall(css)))

    global_name = None
    if js_path:
        m = RE_GLOBAL.search(js_text)
        if m:
            global_name = m.group(1)

    # 专属门禁：05-audit 下有没有针对这个组件的检查脚本
    gate_dir = os.path.join(ROOT, '05-audit')
    stem = cid.replace('-', '')
    dedicated = sorted([
        f for f in os.listdir(gate_dir)
        if (f.startswith(cid) or f.startswith(stem))
        and f.endswith(('.js', '.py'))
        and ('check' in f or 'contract' in f or 'geometry' in f)
    ]) if os.path.isdir(gate_dir) else []

    has_demo = demo_path is not None
    has_gate = len(dedicated) > 0
    # INVARIANT I-8：状态必须活在 DOM 属性上，不能活在 class 里
    i8_ok = len(legacy) == 0

    # 🔴 M8：成熟度必须**有鉴别力**。只用上面三条判据的话 27 个组件全是 stable，
    #    ladder 等于没用（对标 Primer 的六档阶梯，每档都有硬判据）。
    #    ⇒ 第四条：该收编到微行为核的**还没收编**（manual）或**根本没做**（gap）
    #      的组件，不配 stable —— 它改一处不会全库跟着变（I-14）。
    #    ⚠️ 行为矩阵用的是 **JS 文件名**（flip.js ⇒ flip），组件 id 用的是目录名
    #       （list/）⇒ 必须按文件名查，否则 list/nav 这类将来出现 gap 会被漏掉。
    debt = []
    if js_path:
        bkey = os.path.basename(js_path)[:-3]
        for b, cells in BEH_MATRIX.items():
            v = cells.get(bkey)
            if v is None:
                continue
            st = v[0] if isinstance(v, list) else v
            if st in ('manual', 'gap'):
                debt.append(b + ':' + st)

    if not (has_demo and has_gate):
        maturity = 'alpha'
    elif not i8_ok or debt:
        maturity = 'beta'
    else:
        maturity = 'stable'

    return {
        'id': cid,
        'tier': meta.get('tier', tier),
        'purpose': meta.get('purpose', ''),
        'rootClass': root,
        'maturity': maturity,
        'maturityReasons': {
            'hasDemo': has_demo,
            'hasDedicatedGate': has_gate,
            'statesOnDomAttributes': i8_ok,
            'behaviorDebt': debt,      # M8：manual/gap 清单，非空 ⇒ 最高只能 beta
        },
        'gates': dedicated,
        'files': {
            'css': os.path.relpath(css_path, ROOT).replace('\\', '/'),
            'js': os.path.relpath(js_path, ROOT).replace('\\', '/') if js_path else None,
            'demo': os.path.relpath(demo_path, ROOT).replace('\\', '/') if demo_path else None,
        },
        'slots': elements,
        'variants': variants,
        'states': {
            'enum': {k: sorted(v) for k, v in sorted(enum_states.items())},
            'boolean': sorted(bool_states),
            'legacyClass': legacy,
        },
        'aria': {
            'roles': sorted(set(RE_ROLE.findall(text))),
            'attrs': sorted(set(RE_ARIA.findall(text))),
        },
        'usesOtherNamespaces': sorted(set(foreign)),
        'global': global_name,
        'behaviorRef': 'API.md#' + cid,
    }


# ---------------------------------------------------------------- 令牌解析
def parse_block(body):
    """
    解析一段 CSS 声明体，返回 [(name, value, 前导注释)]。
    ⚠️ 必须先去注释再切分号 —— 注释里有中文分号和 #080a0c 这类值，
       直接 split(';') 会把注释内容当成属性值（这个 bug 真实发生过，
       导致 --paper 整个丢失、暗色模式从未生效。见 tokens.css 里的记录）。
    """
    out = []
    i, n = 0, len(body)
    pending_note = ''
    while i < n:
        # 注释
        if body[i:i + 2] == '/*':
            end = body.find('*/', i + 2)
            if end < 0:
                break
            pending_note = body[i + 2:end].strip()
            i = end + 2
            continue
        c = body[i]
        if c in ' \t\r\n':
            i += 1
            continue
        # 声明
        if c == '-' and body[i:i + 2] == '--':
            colon = body.find(':', i)
            if colon < 0:
                break
            semi = body.find(';', colon)
            if semi < 0:
                semi = n
            name = body[i:colon].strip()
            value = body[colon + 1:semi].strip()
            if name.startswith('--'):
                out.append((name, value, pending_note))
            pending_note = ''
            i = semi + 1
            continue
        i += 1
    return out


def find_block(css, start):
    """从 start 处（指向 '{'）取出配平的大括号内容，返回 (内容, 结束位置)。"""
    depth = 0
    i = start
    n = len(css)
    while i < n:
        if css[i] == '{':
            depth += 1
        elif css[i] == '}':
            depth -= 1
            if depth == 0:
                return css[start + 1:i], i + 1
        i += 1
    return css[start + 1:], n


def guess_type(value):
    v = value.strip()
    if re.match(r'^#([0-9a-fA-F]{3,8})$', v):
        return 'color'
    if re.match(r'^(rgb|rgba|hsl|hsla|color-mix|light-dark)\s*\(', v):
        return 'color'
    if re.match(r'^-?\d+(\.\d+)?(px|rem|em|%|vh|vw|ch|ex|vmin|vmax)$', v):
        return 'dimension'
    if re.match(r'^-?\d+(\.\d+)?$', v):
        return 'number'
    if re.match(r'^(cubic-bezier|steps|linear|ease|ease-in|ease-out|ease-in-out)', v):
        return 'cubicBezier'
    if 'var(' in v:
        return 'alias'
    if re.match(r'^\d+(\.\d+)?s|^\d+(\.\d+)?ms$', v):
        return 'duration'
    return 'other'


def scan_tokens():
    css_raw = read(TOKENS_CSS)
    css, balanced = strip_comments(css_raw) if False else (css_raw, True)
    # ⚠️ 保留注释：注释里有实测对比度证据，要抽进 note
    # 但解析声明时必须跳过注释 ⇒ parse_block 内部处理

    def collect(mode_css):
        res = {}
        for m in re.finditer(r':root\s*\{', mode_css):
            body, _ = find_block(mode_css, m.end() - 1)
            for name, value, note in parse_block(body):
                if name in res:
                    continue  # 先出现的为准（浅色块在前）
                item = {'$value': value, '$type': guess_type(value)}
                if note:
                    # 只留第一行有效信息，避免把整段表格塞进来
                    first_line = next(
                        (ln.strip(' *') for ln in note.splitlines()
                         if ln.strip(' *').strip()), '')
                    if first_line:
                        item['$description'] = first_line[:200]
                res[name] = item
        return res

    light = collect(css)

    dark = {}
    for m in re.finditer(r'@media[^{]*prefers-color-scheme:\s*dark[^{]*\{', css):
        inner, _ = find_block(css, m.end() - 1)
        for name, value, note in parse_block(inner):
            if name.startswith('--') and name not in dark:
                item = {'$value': value, '$type': guess_type(value)}
                if note:
                    first_line = next(
                        (ln.strip(' *') for ln in note.splitlines()
                         if ln.strip(' *').strip()), '')
                    if first_line:
                        item['$description'] = first_line[:200]
                dark[name] = item

    # 深色应当是浅色的子集：多出来的说明有人加了浅色没有的令牌
    only_dark = sorted(set(dark) - set(light))
    only_light = sorted(set(light) - set(dark))

    return {
        'schemaVersion': '1.0.0',
        'source': os.path.relpath(TOKENS_CSS, ROOT).replace('\\', '/'),
        '$comment': (
            '由 05-audit/gen-ai-contract.py 从 tokens.css 生成，不要手改。'
            '$value/$type 遵循 W3C Design Tokens 草案形状，便于被 Figma / '
            'Style Dictionary 一类工具直接消费（对标 Open Props）。'
        ),
        'sets': {
            'light': light,
            'dark': dark,
        },
        'coverage': {
            'lightCount': len(light),
            'darkCount': len(dark),
            'onlyInDark': only_dark,
            'onlyInLight': only_light,
        },
    }


# ---------------------------------------------------------------- 主流程
def build():
    with io.open(META, 'r', encoding='utf-8') as f:
        meta_all = json.load(f)
    metas = meta_all['components']

    comps = []
    seen = set()
    for rel, tier in SCAN:
        base = os.path.join(ROOT, rel)
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            d = os.path.join(base, name)
            if not os.path.isdir(d):
                continue
            if not any(f.endswith('.css') for f in os.listdir(d)):
                continue  # 无 CSS 的目录不是组件（如 04-recipes/longform）
            cid = name
            if cid in seen:
                continue
            seen.add(cid)
            if cid not in metas:
                raise SystemExit(
                    '[FAIL] 目录 %s/%s 有 CSS，但 components.meta.json 里没有它 —— '
                    '新组件必须先登记' % (rel, cid))
            comps.append(scan_component(cid, d, tier, metas[cid]))

    extra = sorted(set(metas) - seen)
    if extra:
        raise SystemExit(
            '[FAIL] components.meta.json 里登记了 %s，但源码里找不到对应目录 —— '
            '幽灵组件会让人照着不存在的东西写' % ', '.join(extra))

    comps.sort(key=lambda c: (c['tier'], c['id']))
    summary = {}
    for c in comps:
        summary[c['maturity']] = summary.get(c['maturity'], 0) + 1

    doc = {
        'schemaVersion': '1.0.0',
        'generatedBy': '05-audit/gen-ai-contract.py',
        'libraryVersion': read(os.path.join(ROOT, 'VERSION')).strip(),
        '$comment': (
            '机器可读的组件契约。slots = BEM 元素名（在本库里元素名就是插槽名），'
            'states.enum = 组件会在 DOM 上写出的 data-* 取值，'
            'states.legacyClass = 仍未收敛到 data 属性的历史状态类（INVARIANT I-8 未达标）。'
        ),
        'maturityCriteria': meta_all['maturityCriteria'],
        'summary': {
            'total': len(comps),
            'byMaturity': summary,
            'byTier': {t: sum(1 for c in comps if c['tier'] == t)
                       for t in ('primitive', 'pattern', 'recipe')},
        },
        'components': comps,
    }
    return doc, scan_tokens()


def main():
    check = '--check' in sys.argv
    doc, tokens = build()

    def dump(obj):
        return json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=False) + '\n'

    targets = [(OUT_COMPONENTS, doc), (OUT_TOKENS, tokens)]
    if check:
        bad = 0
        for path, obj in targets:
            if not os.path.isfile(path):
                print('  [FAIL] 缺少生成物 %s —— 跑 gen-ai-contract.py 生成'
                      % os.path.relpath(path, ROOT))
                bad += 1
                continue
            cur = read(path)
            want = dump(obj)
            if cur != want:
                print('  [FAIL] %s 与源码不一致 —— 改了源码就要重新生成'
                      % os.path.relpath(path, ROOT))
                a = cur.splitlines()
                b = want.splitlines()
                for i in range(max(len(a), len(b))):
                    x = a[i] if i < len(a) else '<无>'
                    y = b[i] if i < len(b) else '<无>'
                    if x != y:
                        print('        首处不同 第%d行\n          现有: %s\n          应为: %s'
                              % (i + 1, x.strip()[:90], y.strip()[:90]))
                        break
                bad += 1
        if bad:
            return 1
        print('  [OK] ai/components.json 与 ai/tokens.json 均与源码一致')
        return 0

    if not os.path.isdir(AI):
        os.makedirs(AI)
    for path, obj in targets:
        with io.open(path, 'w', encoding='utf-8', newline='\n') as f:
            f.write(dump(obj))
    s = doc['summary']
    print('  已生成 ai/components.json  · %d 个组件 · %s'
          % (s['total'], ' / '.join('%s %d' % (k, v)
                                    for k, v in sorted(s['byMaturity'].items()))))
    print('  已生成 ai/tokens.json      · 浅色 %d / 暗色 %d'
          % (tokens['coverage']['lightCount'], tokens['coverage']['darkCount']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
