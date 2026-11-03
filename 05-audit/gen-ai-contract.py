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
  人工（ai/components.meta.json）：rootClass / purpose / tier / printPolicy / pagination

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
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _css import declared_tokens, mask_comments, resolve_vars  # noqa: E402

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
    # 🔴 09-assets 整层原先不在契约里（0.8.3 补）
    #   ⇒ AI 入口看不到这一层，问"这库有没有图表"得到的答案是"没有"。
    #   与 0.8.1 那次「根 START-HERE 漏 11 个组件」是同一类病，只是漏了整整一层。
    ('09-assets', 'asset'),
]

# 🔴 契约里出现的 tier 必须都在这里登记 —— byTier 统计只认这张表。
#   少一个 ⇒ 契约里那一档计数恒为 0，且没人会发现（这正是本条存在的意义）。
ALL_TIERS = ('primitive', 'pattern', 'recipe', 'asset')

# ---------------------------------------------------------------- 打印策略（0.25.0）
# 🔴 为什么策略必须是**有限枚举**：
#   上一轮的教训是「CSS 里写了规则，没有任何东西能断言它真的生效」
#   （tokens.css 的 print 规则被组件 CSS 同特异性盖掉，PDF 逐字节不变）。
#   如果这里允许自由文本，契约就只是又一份散文 —— 谁都能写，
#   没人能反驳。枚举的每一个值都对应一组**可在浏览器里量**的断言
#   （见 05-audit/print-policy-gate.js），写错值 = 门禁红。
#
#   六个值的语义边界（不是同义词，别合并）：
#     omit         内容不上纸。selector 等于 rootClass ⇒ 整个组件消失
#     expand       打印时把屏幕上的限制放开（隐藏 / 收起 / 限高 / 固定定位），
#                  目的是「内容全在纸上」。它**不是**版式调整
#     reveal       只在纸上出现（屏幕上 display:none）
#     keep-together 不跨页切断
#     allow-break  退出 keep-together（给高块省纸）
#     keep         （缺省）原样保留 —— 用空数组表达，不写这个值
#
#   ⚠️ 为什么没有 `omit-parts`：隐藏粒度由 selector 自己说明
#      （等于 rootClass 是整块，是 `__` 部件就是少一块）。
#      多一个值就多一处「两个名字指同一件事」的争论，而判据一模一样。
PRINT_POLICIES = ('omit', 'expand', 'reveal', 'keep-together', 'allow-break')

# 🔴 内容分页：`server` 与 `expand` 不能同时出现。
#   服务端分页的组件 DOM 里只有**当前一页**的行；展开它 = 印出一页却
#   看起来完整 ⇒ 页数正常、对比度合格、内容少 90%，正是静默截断的教科书案例。
#   今天没有任何组件声明 server（这条规则处于守夜状态，由 gate 的反向控制
#   证明它能开火），但字段必须先存在，否则将来有人加的时候没有地方写。
PAGINATIONS = ('none', 'client', 'server')

# 单个选择器：允许后代（空格）/ 子代（>）/ 相邻（+）组合，但**不许逗号**。
#   逗号会让「一条记录认领一条声明」这句话失效 —— 一条记录认领 8 个选择器时，
#   「谁有权改坏它」就没有答案了（这正是 L2 要判的东西）。
RE_PRINT_SELECTOR = re.compile(r'^[^,{};]+$')

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


def dedicated_gates(cid, layer_dir):
    """专属门禁探测 —— **单一来源**（maturity-gate.py 也用它）。

    🔴 为什么必须是单一来源：原来 gen-ai-contract 与 maturity-gate 各写一份
       「脚本文件名以组件名开头」的探测，两份逻辑必然漂移 ——
       实测：maturity-gate 那份认不出 `chart-check.js` 覆盖 `bar`，
       于是同一组件在契约里是 stable、在重算里是 alpha，两道门禁互相打架。

    两种认法都要有（见 E28）：
      ① 脚本文件名以组件名开头（`bar-check.js`）
      ② 脚本用**清单变量**声明覆盖谁（`const CHART_DIRS = ['09-assets/bar', ...]`）
    ⚠️ ② 只认清单变量，不认"文件里任何位置出现过该路径"——
       `const BAR_URL = '.../09-assets/bar/demo.html'` 这类**用到的地址**
       会让判据永久为真、门禁被架空（见 E29）。
    """
    gate_dir = os.path.join(ROOT, '05-audit')
    if not os.path.isdir(gate_dir):
        return []
    stem = cid.replace('-', '')
    named = [f for f in os.listdir(gate_dir)
             if (f.startswith(cid) or f.startswith(stem))
             and f.endswith(('.js', '.py'))
             and ('check' in f or 'contract' in f or 'geometry' in f)]
    declared = []
    self_name = os.path.basename(os.path.abspath(__file__))
    needle = "'%s/%s'" % (layer_dir, cid)
    # ⚠️ 这里**故意不用词边界**：heredoc 逐层转义会把它变成退格符 0x08，
    #   正则永不匹配而文件看着完全正常（本轮真踩过，排查了很久）。
    #   改用「左括号 + 空白 + 引号路径」的形状，字符更少、更不容易被转义。
    pat = re.compile(
        r'(?<![A-Za-z0-9_])[A-Z][A-Z0-9_]*'
        r'(?:_DIRS|_COMPONENTS|_COVERED|_LIST)'
        r'[ 	]*=[ 	]*\[[^\]]*?' + re.escape(needle) + r'(?=[,\s\]])',
        re.S)
    for f in sorted(os.listdir(gate_dir)):
        if f == self_name or f in named:
            continue
        if not f.endswith(('.js', '.py')):
            continue
        if 'check' not in f and 'contract' not in f and 'geometry' not in f:
            continue
        try:
            src = io.open(os.path.join(gate_dir, f), encoding='utf-8',
                          errors='replace').read()
        except Exception:
            continue
        if pat.search(src):
            declared.append(f)
    return sorted(set(named) | set(declared))


def validate_print_policy(owner, rules, claimed):
    """校验一份 printPolicy（组件或库级），返回规范化后的 list。

    🔴 为什么把校验放在生成器而不是门禁里：
      契约是**生成物**。生成器拒绝写出一份非法契约，比"写出来再让门禁骂"
      早一步 —— 非法值进不了 components.json，下游（AI 消费者、门禁、
      CLI）就不必各自防一遍。
      但**语义**校验（选择器在 CSS 里真的存在、值真的生效）不在这一层：
      那需要读 CSS 与真浏览器，属于 print-policy-gate 的活。

    这里只判四件事（都能静态判、都不需要浏览器）：
      ① policy 是六个有限值之一（拼错 `ommit` 会安静地什么都不做）
      ② selector 是单个选择器（带逗号会让"一条记录认领一组声明"含糊）
      ③ why 不是空话（< 8 字 ⇒ 等于没解释）
      ④ 同一个选择器不能被认领两次（两个组件抢一条声明 ⇒ 谁都能改坏它）
    """
    if not isinstance(rules, list):
        raise SystemExit('[FAIL] %s 的 printPolicy 必须是数组' % owner)
    out = []
    for i, r in enumerate(rules):
        where = '%s.printPolicy[%d]' % (owner, i)
        if not isinstance(r, dict):
            raise SystemExit('[FAIL] %s 不是对象' % where)
        extra = set(r) - {'selector', 'policy', 'why'}
        if extra:
            raise SystemExit('[FAIL] %s 有不认识的字段 %s'
                             % (where, ', '.join(sorted(extra))))
        sel = (r.get('selector') or '').strip()
        pol = (r.get('policy') or '').strip()
        why = (r.get('why') or '').strip()
        if not sel:
            raise SystemExit('[FAIL] %s 缺 selector' % where)
        if not RE_PRINT_SELECTOR.match(sel):
            raise SystemExit(
                '[FAIL] %s 的 selector %r 不合法 —— 必须是单个选择器'
                '（不能带逗号 / 花括号；打印策略的粒度就是一条声明）'
                % (where, sel))
        if pol not in PRINT_POLICIES:
            raise SystemExit(
                '[FAIL] %s 的 policy %r 不在枚举里（%s）—— 拼错的值会'
                '安静地什么都不做' % (where, pol, ' / '.join(PRINT_POLICIES)))
        if len(why) < 8:
            raise SystemExit(
                '[FAIL] %s 的 why 太短（%r）—— 打印策略的每一条都要能'
                '回答「不这么做会怎样」' % (where, why))
        if sel in claimed:
            raise SystemExit(
                '[FAIL] 选择器 %r 被认领了两次（%s 与 %s）—— '
                '同一条声明只能有一个归属，否则两边都能改坏它'
                % (sel, claimed[sel], owner))
        claimed[sel] = owner
        out.append({'selector': sel, 'policy': pol, 'why': why})
    return out


def scan_component(cid, cdir, tier, meta, layer_dir, claimed):
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

    # 🔴 一个目录可以有**多个**全局（0.11.2：nav/ 里 nav.js 导出 Nav、toc.js 导出 Toc）。
    #    只记主文件那个 ⇒ 另一个全局在契约里**彻底消失** ⇒ autoinit 门禁拿不到它
    #    ⇒ 「表里多了一个库里没有的全局 Toc」这种**误报**（真值是表对了、契约缺了）。
    #    ⚠️ 修法不是从表里删掉 Toc（那是拿错误换绿灯），是让契约认第二个文件。
    js_also = [os.path.relpath(os.path.join(cdir, f), ROOT).replace('\\', '/')
               for f in sorted(os.listdir(cdir))
               if f.endswith('.js')
               and (not js_path or f != os.path.basename(js_path))]
    global_also = []
    for rel in js_also:
        try:
            m = RE_GLOBAL.search(io.open(os.path.join(ROOT, rel), encoding='utf-8').read())
        except IOError:
            m = None
        if m and m.group(1) != global_name:
            global_also.append({'global': m.group(1), 'js': rel})

    dedicated = dedicated_gates(cid, layer_dir)

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

    pagination = (meta.get('pagination') or 'none').strip()
    if pagination not in PAGINATIONS:
        raise SystemExit('[FAIL] %s 的 pagination %r 不在枚举里（%s）'
                         % (cid, pagination, ' / '.join(PAGINATIONS)))
    print_rules = validate_print_policy(cid, meta.get('printPolicy') or [], claimed)
    if pagination == 'server' and any(r['policy'] == 'expand' for r in print_rules):
        raise SystemExit(
            '[FAIL] %s：pagination=server 与 printPolicy=expand 不能同时成立。\n'
            '       服务端分页时 DOM 里只有当前一页的行，展开它 = 印出一页却\n'
            '       看起来完整（页数正常、对比度合格、内容少九成）。\n'
            '       要印全部就先把分页拿掉，或者把这条策略改成 omit。' % cid)

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
            # 🔴 一个组件可以有**多个** JS（0.11.2：nav = nav.js 行为层 + toc.js 目录增强）。
            #    `files.js` 只放**主**文件（与 `global` 对应的那个），其余的放这里。
            #    没有这个字段的话，第二个文件在契约里**彻底消失** ——
            #    而 AI 消费者读的就是这份契约：看不见就等于不存在。
            #    ⚠️ 旧版按 `<id>.js` 找主文件，找不到就退到"目录里唯一的 .js"；
            #       出现第二个 .js 之后，nav 的主文件会**随机**落到排序第一个
            #       （实际正好是 nav.js，但这属于碰巧，不是判据）。
            'jsAlso': js_also,
            'demo': os.path.relpath(demo_path, ROOT).replace('\\', '/') if demo_path else None,
        },
        # 🔴 打印契约（0.25.0）：这个组件**在纸上**会发生什么。
        #    `[]` 是明确值「原样保留」，不是"忘了填" —— 缺字段才算漏。
        #    policy 的每个取值对应一组浏览器断言，见 print-policy-gate.js。
        'pagination': pagination,
        'printPolicy': print_rules,
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
        # 同目录下一个组件还能导出的**其他**全局（主文件之外）。空列表 = 只有一个全局。
        'globalAlso': global_also,
        'behaviorRef': 'API.md#' + cid,
    }


# ---------------------------------------------------------------- 令牌解析
def _skip_inline_space(body, i):
    """跳过同一行内的空白（不跨行）。"""
    while i < len(body) and body[i] in ' \t':
        i += 1
    return i


def parse_block(body):
    """
    解析一段 CSS 声明体，返回 [(name, value, 前导注释, 尾注释)]。

    ⚠️ 必须先去注释再切分号 —— 注释里有中文分号和 #080a0c 这类值，
       直接 split(';') 会把注释内容当成属性值（这个 bug 真实发生过，
       导致 --paper 整个丢失、暗色模式从未生效。见 tokens.css 里的记录）。

    🔴 为什么必须区分「前导」和「尾注释」（E294，0.25.4 修）
       旧实现只有一个 pending_note：`--a: 1; /* A 的说明 */` 里的注释被
       下一个声明吃掉，于是 `--b` 的描述写着 A 的含义。本文件里 101 条
       尾注释 ⇒ 最多 100 个令牌的描述整体错位一位。
       判据不是"注释存不存在"，是"这段文字认的是哪个令牌"。
       同一行 = 尾注释（跟着前一个声明）；换行之后 = 前导注释。
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
            # 同一行后面的注释归本条（可能是连续多个）
            trailing = []
            if semi < n:
                j = _skip_inline_space(body, semi + 1)
                while body[j:j + 2] == '/*':
                    e = body.find('*/', j + 2)
                    if e < 0:
                        break
                    trailing.append(body[j + 2:e].strip())
                    j = _skip_inline_space(body, e + 2)
                if trailing:
                    semi = j - 1        # 让 i 从这里继续，避免重扫
            if name.startswith('--'):
                out.append((name, value, pending_note, '  '.join(trailing)))
            pending_note = ''
            i = max(semi + 1, i + 1)
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
    css = css_raw
    # ⚠️ 保留注释：注释里有实测对比度证据，要抽进 note
    # 但解析声明时必须跳过注释 ⇒ parse_block 内部处理

    # 🔴 D5 分层后，颜色分成 L1（`--raw-*`）+ 语义别名（`--paper: var(--raw-paper)`）。
    #    `ai/tokens.json` 是**对外契约**：只承诺语义名。
    #    ① L1 不能导出去（它是"当前配色的取值"，换品牌时整层替换）；
    #    ② 值必须解析成字面量（消费方拿到 `var(--raw-paper)` 而库里没有那个定义
    #       就废了 —— 分层前这里是 hex，改成 var() 是静默破契约）。
    #    全文解析 = CSS 层叠（暗色段在后面，覆盖浅色的 L1）。
    all_toks = resolve_vars(declared_tokens(css))

    # 🔴 描述清洗（E294）：旧实现 `note_of` 只取注释块第一行，
    #    而 tokens.css 的分组注释第一行恰好是 `-------- 基底` 分隔线 ⇒
    #    147 个令牌里 19 个的描述是分隔线，其余的首行也大多丢了后文。
    #    现在的规则是可断言的四条：
    #      ① 纯分隔线丢掉；行内分隔线换成空格；
    #      ② 块首是分隔线 ⇒ 这是**分组注释**，紧随的那一行是组名，丢掉；
    #      ③ 分组注释只有在**正文提到本令牌名**时才归属本令牌
    #         （`--paper` 的块里写着 `paper = 页面底…`，那是它的定义；
    #           `--text-primary` 的块讲的是"三档够用"，不是它的描述）；
    #      ④ 前导 + 尾注释都收，按出现顺序去重拼接。
    SEP_ONLY = re.compile(r'^[\s\-=_*~]{4,}$')
    SEP_LEAD = re.compile(r'^[-=_*~]{4,}')          # 行首就是分隔线（组名同行）
    SEP_RUN = re.compile(r'[-=_*~]{4,}')
    DESC_CAP = 400

    def _segments(raw):
        """把一段注释切成有信息量的片段（已去掉分隔线/空行）。"""
        segs = []
        for ln in (raw or '').splitlines():
            s = ln.strip().strip('*').strip()
            if not s or SEP_ONLY.match(s):
                continue
            s = re.sub(r'\s+', ' ', SEP_RUN.sub(' ', s)).strip()
            if s:
                segs.append(s)
        return segs

    def note_of(lead, trail, token_name):
        lead = lead or ''
        segs = _segments(lead)
        head_lines = [ln.strip() for ln in lead.strip().splitlines() if ln.strip()]
        if head_lines and (SEP_ONLY.match(head_lines[0])
                           or SEP_LEAD.match(head_lines[0])):
            group = segs[1:] if segs else []       # 组名，不是描述
            bare = token_name.lstrip('-')
            flat = ' '.join(group).replace('-', '').replace('_', '')
            if bare in ' '.join(group) or bare.replace('-', '') in flat:
                segs = group
            elif _segments(trail):
                segs = []                           # 有尾注释就够用了
            else:
                segs = group                        # 没别的说法，总比空着强
        out = []
        for s in segs + _segments(trail):
            if s not in out:
                out.append(s)
        text = ''
        for s in out:
            nxt = (text + ' ' + s).strip() if text else s
            if len(nxt) > DESC_CAP:
                return (text + '…') if text else nxt[:DESC_CAP]
            text = nxt
        return text

    def resolve_alias(v, local):
        """把 `var(--raw-x)` 换成字面值。

        🔴 必须**先在块内**找（`local`）：`all_toks` 是全文层叠的结果，
           暗色段在后面会把 `--raw-paper` 覆盖成 `#14171A` ——
           拿它去解析**浅色**段，得到的会是暗色值（实测踩过：
           `sets.light["--paper"].$value` 变成 `#14171A`）。
           块内没有才回退到全文（跨块引用）。
        """
        m = re.match(r'^var\(\s*(--raw-[a-z0-9-]+)\s*\)$', v.strip())
        if not m:
            return v
        ref = m.group(1)
        return local.get(ref) or all_toks.get(ref) or v

    def collect(mode_css):
        res = {}
        for m in re.finditer(r':root\s*\{', mode_css):
            body, _ = find_block(mode_css, m.end() - 1)
            decls = list(parse_block(body))
            local = {n: v for n, v, _, _ in decls}
            for name, value, lead, trail in decls:
                if name in res:
                    continue  # 先出现的为准（浅色块在前）
                if name.startswith('--raw-'):
                    continue  # L1 不进对外契约
                value = resolve_alias(value, local)
                item = {'$value': value, '$type': guess_type(value)}
                # 只留第一行有效信息，避免把整段表格塞进来
                d = note_of(lead, trail, name)
                if d:
                    item['$description'] = d
                res[name] = item
        return res

    light = collect(css)

    # 暗色段现在**只覆盖 L1** 且是 `--raw-x: #hex` 的形状 ⇒
    # 键名去掉 `--raw-` 前缀就是它覆盖的那个语义令牌，值直接就是暗色解析值。
    # 定位走 `mask_comments`：本文件里有注释举着 `@media … dark` 当例子。
    dark = {}
    masked = mask_comments(css)
    for m in re.finditer(r'@media[^{]*prefers-color-scheme:\s*dark[^{]*\{',
                         masked):
        media_body, _ = find_block(css, m.end() - 1)   # 原文 body（保注释）
        # 🔴 只解析里面的 `:root` 块（E294）。
        #    整个 media 体里，`:root…{` 选择器**上方**还挂着解释选择器的注释
        #    （「⚠️ :not([data-theme="light"]) 让强制亮压过系统暗色」）。
        #    直接对整个 body 做 parse_block ⇒ 那条注释被当成块内第一声明的
        #    描述 ⇒ `--raw-paper` 拿到了讲选择器的话。实测踩过：
        #    dark/--paper 的 $description 是 `⚠️ :not(...)`。
        body_masked = mask_comments(media_body)
        roots = list(re.finditer(r':root[^{]*\{', body_masked))
        segments = []
        for r in roots:
            seg, _ = find_block(media_body, r.end() - 1)
            segments.append(seg)
        if not segments:
            segments = [media_body]     # 没有 :root 就退回旧行为，别静默丢令牌
        decls = []
        for seg in segments:
            decls.extend(parse_block(seg))
        for name, value, lead, trail in decls:
            if not name.startswith('--'):
                continue
            sem = ('--' + name[len('--raw-'):]) if name.startswith('--raw-') \
                else name
            if sem in dark:
                continue
            val = all_toks.get(sem, value)
            item = {'$value': val, '$type': guess_type(val)}
            d = note_of(lead, trail, name)
            if d:
                item['$description'] = d
            dark[sem] = item

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

    # 🔴 选择器认领表必须在**扫描第一个组件之前**建好，并且先认领库级规则：
    #    先组件后库级的话，`.no-print` 这类会被某个组件"顺手"先认领，
    #    报错信息里的归属就取决于扫描顺序（不可复现的报错比没有报错更糟）。
    claimed = {}
    defaults = meta_all.get('printDefaults') or {}
    default_rules = validate_print_policy(
        'printDefaults', defaults.get('rules') or [], claimed)

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
            comps.append(scan_component(cid, d, tier, metas[cid], rel, claimed))

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
            'printPolicy = 这个组件在纸上会发生什么（空数组 = 原样保留）；'
            'pagination = 内容是否被分页裁过（server 不许与 expand 同时出现，'
            '否则展开的只是当前一页）。'
        ),
        'maturityCriteria': maturity_criteria(comps, meta_all['maturityCriteria']),
        'printDefaults': {
            '$comment': (
                '库级打印约定：不属于任何组件，只由 01-tokens/tokens.css 兑现。'
                'policy 是有限枚举，每个值对应一组浏览器断言 '
                '（见 05-audit/print-policy-gate.js）。'
            ),
            'rules': default_rules,
        },
        'summary': {
            'total': len(comps),
            'byMaturity': summary,
            'byTier': {t: sum(1 for c in comps if c['tier'] == t)
                       for t in ALL_TIERS},
        },
        'components': comps,
    }
    return doc, scan_tokens()


def maturity_criteria(comps, base):
    """🔴 把 maturityCriteria 里**描述数字**的两句改成算出来的（0.8.9）。

    为什么必须改（审计 P2-4 复现）：
      那两句（`$whyFourth` / `$strictImpact`）是**手写常量**，
      写于 0.7.6，那时是 stable 20 / beta 7、strict 下有 7 个组件不可用。
      而现在实测是 stable 29 / beta 4
      ⇒ **同一份文件里，「算出来的数」是对的、「手写的数」是 0.7.x 的快照**。
      ⚠️ 手工搜过：**没有任何脚本生成这两个字段** ⇒ 它们就是无人维护的死文字。

      这正是本库自己的原则「凡是不由生成器产出的数字，最终都会漂」
      （tokens 双份定义、README 体积数字都是同一个病）。

    ⇒ 改成：从 `comps` 现场算出 stable / beta 数与 strict 不可用清单。
       以后组件升档，这两句自动跟着变，不需要有人记得回来改。
    """
    mc = dict(base)
    n_stable = sum(1 for c in comps if c['maturity'] == 'stable')
    n_beta = sum(1 for c in comps if c['maturity'] == 'beta')
    # strict 档位只放行 stable ⇒ 非 stable 的组件在 strict 下不可用
    blocked = sorted(c['id'] for c in comps if c['maturity'] != 'stable')

    mc['$whyFourth'] = (
        '🔴 为什么第四条判据不能省：用前三条时多数组件会**全是 stable** '
        '⇒ ladder 没有任何鉴别力（对标 Primer 六档阶梯，每档都有硬判据）。'
        '补上「行为欠账」这一条后：'
        '**stable %d / beta %d**（本行由生成器算出，不要手改）。'
        '%s'
        % (n_stable, n_beta,
           '全库达标时 ladder 靠**正向控制**证明还有鉴别力'
           '（maturity-gate ③：塞一条合成债务必须降 beta），不是靠"总得留几个 beta"。'
           if n_beta == 0 else '')
    )
    if blocked:
        mc['$strictImpact'] = (
            '⚠️ strict 档位只放行 stable ⇒ %d 个组件在 strict 下不可用：'
            '%s。放宽 strict 会让「未收编的手写行为」进入生产路径。'
            '（本行由生成器算出，不要手改）'
            % (len(blocked), ' / '.join(blocked))
        )
    else:
        # 0.15.0 起会出现"全库达标"：这时不该印一句"0 个组件不可用：（无）"，
        # 那是把空集合硬塞进一句话里，读起来像模板漏了值。
        mc['$strictImpact'] = (
            '✅ strict 档位放行全部 %d 个组件 —— 没有任何组件带着未收编的'
            '手写行为或未做的行为（本行由生成器算出，不要手改）' % len(comps)
        )
    return mc


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
