#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
coverage-gate.py — 覆盖率门禁（ H9）

===========================================================================
🔴 为什么需要它
---------------------------------------------------------------------------
  前面 8 轮 + H 做了 33 个契约、43 道门禁。但**没人能回答**：

      「这 33 个契约，覆盖了多少东西？」

  ⚠️ 没有覆盖率 ⇒ 只能靠"我觉得覆盖够了" ⇒ 新增组件时不知道要不要补契约
  ⇒ 于是覆盖率**只会慢慢掉**，而且掉的时候没人知道。

===========================================================================
判据（都可机械判定）
---------------------------------------------------------------------------
  ① **组件覆盖率**：每个组件目录（02-primitives / 03-patterns / 04-recipes）
     至少有一个 demo.html **且** 至少有一个对应契约。

  ② **CSS class 覆盖率**（本文件真正计算，不是只写在注释里）：
     把每个组件 `*.css` 里**规则主体**（选择器最右那一段）上的 class 抽出来，
     逐个问"有没有人认领它"。三条子判据：

       ②a **孤儿类**：demo / 组件 JS / 任何契约 / 组件 README 四处都没提到。
           ⇒ 要么是死规则，要么是连文档都没有的隐藏 API。**失败。**

       ②b **幻影类**：组件 README 里写到、且 BEM 根属于本组件的类，
           CSS 里却不存在。⇒ 文档承诺了不存在的东西。**失败。**
           （例外见 PHANTOM_EXEMPT：明确写着"已在某版本移除"的历史说明。）

       ②c **未被文本引用类**：只被 README 认领，demo / JS / 契约一次都没碰过
           ⇒ 视觉回归永远看不到它。**棘轮**：不得比基线多
           （`css-coverage-baseline.json`；`--record` 重录）。

           ⚠️ 口径（0.25.2 写死，别再靠猜）：这条判的是**文本**，不是"渲染"。
              判据是在 demo / JS / 契约里找这个类名的**字面量**，
              所以 JS 用拼串生成的类名看不见 —— 实测 41 条里有 10 条
              （tooltip 四方位、drawer 四方向、toast 两变体）其实每次交互都在渲染。
              ⇒ 遇到拼接请把它改成完整字面量映射（见 E288），
                不要为了"让数字好看"往 demo 里塞一个不用的元素。

       ②d **跨组件同名主体**：同一个类名被两个不同组件声明为规则主体。
           同特异性 ⇒ 后加载的那个静默覆盖前一个（E254 那类事故）。
           必须显式登记在 `css-ownership.json` 并写明理由，**未登记即失败**；
           登记过期（现实中已不再重名）也失败 —— 白条不许腐烂。

  ③ **契约自身覆盖率**：契约不能有"孤儿"—— 它指向的 demo 必须存在。

  ⚠️ ① 的阈值定在 **100%**：组件数量不多，全部覆盖得起。
     若将来组件涨到 60+，可以降到 80% 并在 charter 里写明理由 ——
     **但阈值降低必须是一次显式的决定，不是默默放宽。**

   ⚠️ ② 为什么不全用 100%：
     "孤儿 / 幻影 / 未登记重名" 都是**绝对错误**，必须 100% 清零；
     而"文档有、demo 没渲染"是**存量缺口**（视觉回归的视野还没铺满），
     一次性清零要先给 15 个类补 demo，会连带改基线。
     用棘轮把它钉在当下水位：允许变好，不允许变坏。
     这是本仓 `size-baseline.json` / `shot-baseline.json` 的同一套办法。
"""
import sys
import os
import io
import re
import glob
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEP = chr(92)

COMPONENT_DIRS = ('02-primitives', '03-patterns', '04-recipes', '09-assets')

# 🔴 归类修正：`04-recipes/longform` 是**排版页**（自带完整 CSS：
#    .masthead / .article / .colophon），不是"组件"，它的正确性由
#    `content.css` 的静态门禁 + 视觉基线保证，不需要组件契约。
#    ⇒ 把它算进组件覆盖率会永远差 1%，反而让门禁变成"狼来了"。
LAYOUT_PAGES = ('longform',)

OWNERSHIP_FILE = 'css-ownership.json'
BASELINE_FILE = 'css-coverage-baseline.json'

# ---------------------------------------------------------------- CSS 词法
# 🔴 三个必须剥掉的东西，否则会把"不是类名"的字符读成类名：
#    · 注释       —— 注释里写 `.foo` 是说明，不是定义
#    · url(...)   —— `data:image/svg+xml,...http://www.w3.org/...` 里能读出
#                     `.org` / `.w3` 这种假类名（实测踩过）
#    · 字符串     —— content:"..." 同理
CSS_COMMENT = re.compile(r'/\*[\s\S]*?\*/')
CSS_URL = re.compile(r'url\((?:[^()\\]|\\.)*\)', re.I)
CSS_STR = re.compile(r'"[^"]*"|\'[^\']*\'')
# 选择器 { 声明 } —— 靠"选择器里不许出现 { } @"把 @media 外壳跳过，
# 内层规则仍能被单独匹配到（正则可以从 `.a {` 这个位置起算）。
RULE_RE = re.compile(r'([^{}@]+)\{([^{}]*)\}', re.S)
CLASS_RE = re.compile(r'\.(-?[_a-zA-Z][\w-]*)')
PSEUDO_RE = re.compile(r'::?[a-zA-Z-]+(\([^)]*\))?')
BEM_SPLIT = re.compile(r'__|--')

# 明确写着"这东西不存在 / 已移除"的**警告性提及**，不算幻影。
# 每一条都要能指回那句话，否则就是把判据关掉了。
PHANTOM_EXEMPT = {
    'state--delayed':
        'states/README：记录它 0.8.0 已移除（承诺的延迟显现没有 JS 驱动），'
        '留着是为了让后来者知道"别再提这个能力"',
    'dialog__body':
        'overlay/README：明写"这张表曾经有三行是假的"，它是被纠正的历史名字',
    'toast__icon':
        'overlay/README：同上，早期版本抄下来的名字，全库无定义',
}

# JS 按序号 / 键名拼出来的类名：源码里**永远不存在完整字面量**，
# 判据的整词匹配认不出来。登记前缀 + 谁在拼，并逐条打印，不做静默豁免。
DYNAMIC_PREFIX = {
    'bar__s':
        "bar.js：'bar__s' + (s % SERIES_STYLES) —— 按系列序号上色（.bar__s0..s4）",
    'bar__label--':
        "bar.js：'bar__label bar__label--' + keys[k] —— clip / max",
    'splot__s':
        "scientific-plot.js：'splot__s' + (idx % SERIES_CLASSES) —— 5 档配色",
}


def norm(p):
    return p.replace(SEP, '/')


def read(p):
    try:
        return io.open(p, encoding='utf-8').read()
    except Exception:
        return ''


def strip_css(text):
    t = CSS_COMMENT.sub(' ', text)
    t = CSS_URL.sub(' ', t)
    return CSS_STR.sub(' ', t)


def subjects(selector):
    """返回 (该类名集合, 是否"主体独占")。

    主体 = 选择器最右那一段复合选择器。
    主体独占 = 整条选择器只有这一段（没有祖先/兄弟/子代组合）。
    `:hover` / `::before` / `:not(...)` 先剥掉，它们不改变"这条规则在给谁上样式"。

    🔴 为什么必须区分：`.list__actions .btn` 是 list 在**上下文里覆盖** button，
       不是 list 占用了 `.btn` 这个类名。按"任意出现"判定会把 9 处组合关系
       全报成重名，门禁立刻变噪音（实测：13 条 → 5 条）。
    """
    s = PSEUDO_RE.sub('', selector).strip()
    if not s or s.startswith('@'):
        return set(), False
    parts = [p for p in re.split(r'[\s>+~]+', s) if p]
    if not parts:
        return set(), False
    return set(CLASS_RE.findall(parts[-1])), len(parts) == 1


def all_classes(selector):
    """一条选择器里出现过的全部类名（不考虑它处在什么位置）。

    🔴 为什么 ②a / ②b 必须用它，而不是只看规则主体：
       `.switch--lg .switch__track { --sw-h: 28px }` 这种修饰符**没有自己的规则**，
       它的作用全部通过后代体现。只看主体会把 `.switch--lg` 判成"CSS 里不存在"，
       于是文档里明明正确的说明被报成幻影 —— 判据在冤枉人。
       （实测：只看主体 16 条幻影，其中 12 条是这类误判。）
    """
    return set(CLASS_RE.findall(PSEUDO_RE.sub('', selector)))


def scan_css(files):
    """返回 (defined, sole)。

    defined: 本组件 CSS 里出现过的全部类名（含只作用于后代的修饰符）
    sole:    其中"规则主体就是这个类本身"的 —— 只有它算占用类名（②d）
    """
    defined = {}
    sole = {}
    for f in files:
        txt = strip_css(read(f))
        for m in RULE_RE.finditer(txt):
            for sel in m.group(1).split(','):
                for c in all_classes(sel):
                    defined.setdefault(c, set()).add(f)
                cls, is_sole = subjects(sel)
                for c in cls:
                    if is_sole:
                        sole.setdefault(c, set()).add(f)
    return defined, sole


def claimed_by(name, demo, js, doc, contracts):
    """这个类名被谁认领了。返回来源集合（空集 = 没人认领）。"""
    pat = r'(?:^|[^-\w])' + re.escape(name) + r'(?![\w-])'
    out = set()
    for tag, text in (('demo', demo), ('js', js), ('doc', doc), ('contract', contracts)):
        if text and re.search(pat, text):
            out.add(tag)
    return out


# ---------------------------------------------------------------- 纯函数（喂合成数据自检）
def classify(classes, sources):
    """单组件：返回 (孤儿类, 未渲染类)。

    classes: 本组件 CSS 定义的类名集合
    sources: {类名: 认领来源集合}
    孤儿 = 一个来源都没有；未渲染 = 只有 doc 认领。
    """
    orphans = sorted(c for c in classes if not sources.get(c))
    unrendered = sorted(c for c in classes
                        if sources.get(c) and sources[c] <= {'doc'})
    return orphans, unrendered


def classify_dup(sole_by_comp, declared):
    """返回 (undeclared, stale, mismatch)。

    sole_by_comp: {组件: {类名, ...}}
    declared:     {类名: {'owners': [...], 'reason': '...'}}
    """
    owner = {}
    for comp, cls in sole_by_comp.items():
        for c in cls:
            owner.setdefault(c, set()).add(comp)
    actual = {c: v for c, v in owner.items() if len(v) > 1}

    undeclared = sorted(c for c in actual if c not in declared)
    stale = sorted(c for c in declared if c not in actual)
    mismatch = []
    for c in sorted(actual):
        if c not in declared:
            continue
        want = set(declared[c].get('owners') or [])
        if actual[c] != want:
            mismatch.append((c, sorted(actual[c]), sorted(want)))
    return undeclared, stale, mismatch, actual


def diff_unrendered(current, baseline):
    """棘轮：返回 (新增的, 已经修好的)。"""
    cur = set(current)
    base = set(baseline)
    return sorted(cur - base), sorted(base - cur)


# ---------------------------------------------------------------- 采集
def components():
    """[(组件名, 目录相对路径)]"""
    out = []
    for d in COMPONENT_DIRS:
        for p in sorted(glob.glob(os.path.join(ROOT, d, '*'))):
            if not os.path.isdir(p):
                continue
            # 🔴 跳过**空目录 / 只有 README 的目录** ——
            #    它们不是"漏了 demo"，而是"还没开始做"。
            #    混进来会让覆盖率永远到不了 100%，反而使门禁失效。
            has_content = [f for f in glob.glob(os.path.join(p, '*'))
                           if os.path.basename(norm(f)).lower() != 'readme.md']
            if not has_content:
                continue
            nm = os.path.basename(norm(p))
            if nm in LAYOUT_PAGES:
                continue          # 排版页，不是组件
            out.append((nm, norm(p)))
    return out


def contract_files():
    """契约 = 05-audit 下的 *-check / *-contract（JS 与 Python 都算）

    🔴 2026-10-23 修：原先只 glob `*.js`，于是用 Python 写的契约
    （detail-page-contract.py / no-data-gate.py 这一批）**不被承认**，
    明明有判据却报"无契约覆盖" —— 门禁在冤枉自己人。
    契约是"有没有判据"，不是"用什么语言写"。
    """
    out = []
    for pat in ('*.js', '*.py'):
        for f in glob.glob(os.path.join(ROOT, '05-audit', pat)):
            base = os.path.basename(f)
            if base.endswith('-check.js') or base.endswith('-contract.js')                     or base.endswith('-check.py') or base.endswith('-contract.py'):
                out.append(norm(f))
    return out


def load_json(name, default):
    p = os.path.join(ROOT, '05-audit', name)
    if not os.path.isfile(p):
        return default
    try:
        return json.loads(read(p))
    except Exception as e:
        print('  🔴 %s 解析失败：%s' % (name, e))
        return default


# ---------------------------------------------------------------- ② 主判定
def gather(comps, contracts_text):
    """{组件相对路径: {'defined','sole','demo','js','doc'}}"""
    out = {}
    for name, d in comps:
        css_files = sorted(glob.glob(os.path.join(d, '*.css')))
        if not css_files:
            continue
        key = norm(os.path.relpath(d, ROOT))
        defined, sole = scan_css(css_files)
        out[key] = {
            'defined': defined,
            'sole': set(sole),
            'demo': '\n'.join(read(f) for f in sorted(glob.glob(os.path.join(d, '*.html')))),
            'js': '\n'.join(read(f) for f in sorted(glob.glob(os.path.join(d, '*.js')))),
            'doc': '\n'.join(read(f) for f in sorted(glob.glob(os.path.join(d, '*.md')))),
        }
    return out


def css_report(comps, contracts_text):
    data = gather(comps, contracts_text)
    defined_by = {k: v['defined'] for k, v in data.items()}
    sole_by = {k: v['sole'] for k, v in data.items()}
    demo_by = {k: v['demo'] for k, v in data.items()}
    js_by = {k: v['js'] for k, v in data.items()}
    doc_by = {k: v['doc'] for k, v in data.items()}

    baseline = load_json(BASELINE_FILE, {'unrendered': []})
    declared_doc = load_json(OWNERSHIP_FILE, {'duplicates': {}})
    # 登记表里写成 `.foo`（好读），内部一律用不带点的名字 ⇒ 读进来先归一
    declared = {k.lstrip('.'): v for k, v in (declared_doc.get('duplicates') or {}).items()}

    if not defined_by:
        print('  🔴 一个组件 CSS 都没扫到 —— 视野已空，不许判通过')
        return 2

    orphans_all = []
    unrendered_all = []
    phantoms_all = []
    dynamic_all = []
    total_cls = 0

    def dynamic_prefix(c):
        for p in DYNAMIC_PREFIX:
            if c.startswith(p):
                return p
        return None

    for d in sorted(defined_by):
        classes = set(defined_by[d])
        total_cls += len(classes)
        sources = {c: claimed_by(c, demo_by[d], js_by[d], doc_by[d], contracts_text)
                   for c in classes}
        # 动态拼接的类：登记过前缀的，单独列出，不算孤儿
        dyn = sorted(c for c in classes
                     if not sources.get(c) and dynamic_prefix(c))
        if dyn:
            dynamic_all.append((d, dyn))
            for c in dyn:
                sources[c] = {'dynamic'}
        orphans, unrendered = classify(classes, sources)
        if orphans:
            orphans_all.append((d, orphans))
        if unrendered:
            unrendered_all.extend(['%s:%s' % (d, c) for c in unrendered])

    # ②b 幻影类：文档提到、BEM 根属于本组件、**全库都没有**这个类
    #    🔴 必须排除"交叉引用"：form-validation 的 README 会写 `.field`（那是 input 的），
    #       只看本组件 CSS 会把正确的引用报成幻影。判据改成"别处也没有才算幻影"。
    global_defined = set()
    for d in defined_by:
        global_defined |= set(defined_by[d])
    exempt_hit = []
    for d in sorted(defined_by):
        classes = set(defined_by[d])
        roots = set(BEM_SPLIT.split(c)[0] for c in classes)
        phantoms = []
        for c in set(CLASS_RE.findall(doc_by[d])):
            if c in PHANTOM_EXEMPT:
                exempt_hit.append(c)
                continue
            if c in global_defined:
                continue
            # 存在于本组件 JS 里也算"真实存在"：`.accordion--many` 是纯行为开关
            # （只改 role=region 的挂与不挂），一行样式都没有，但它是能用的类。
            if re.search(r'(?:^|[^-\w])' + re.escape(c) + r'(?![\w-])', js_by[d]):
                continue
            if BEM_SPLIT.split(c)[0] in roots:
                phantoms.append(c)
        if phantoms:
            phantoms_all.append((d, sorted(phantoms)))

    # ---------- 打印 ----------
    print('  === 覆盖率（ H9）===')
    print('  组件总数：%d（%s）' %
          (len(comps), ' / '.join(COMPONENT_DIRS)))
    print('  CSS 类总数：%d（组件 CSS 里出现过的全部类名）' % total_cls)
    print('')

    bad = False

    if dynamic_all:
        n = sum(len(x[1]) for x in dynamic_all)
        print('  ℹ️  JS 动态拼接的类（%d 个，已登记前缀，见 DYNAMIC_PREFIX）：' % n)
        for d, items in dynamic_all:
            print('       %s  →  %s' % (d, ' '.join('.' + c for c in items)))
        print('')

    if orphans_all:
        bad = True
        n = sum(len(x[1]) for x in orphans_all)
        print('  🔴 孤儿类（%d 个）：CSS 里定义了，但 demo / JS / 契约 / README 都没提' % n)
        for d, items in orphans_all:
            print('       %s' % d)
            for c in items:
                print('         - .%s' % c)
        print('     ⇒ 要么删规则，要么写进该组件 README（它是公开 API 就得能查到）')
        print('')

    if phantoms_all:
        bad = True
        n = sum(len(x[1]) for x in phantoms_all)
        print('  🔴 幻影类（%d 个）：README 写了，CSS 里不存在' % n)
        for d, items in phantoms_all:
            print('       %s  →  %s' % (d, ' '.join('.' + c for c in items)))
        print('     ⇒ 文档承诺了不存在的东西，抄进业务代码就是"样式不生效"')
        print('')

    if exempt_hit:
        print('  ℹ️  幻影豁免（%d 个，见 PHANTOM_EXEMPT）：%s'
              % (len(set(exempt_hit)), ', '.join('.' + c for c in sorted(set(exempt_hit)))))
        print('')

    new_un, fixed_un = diff_unrendered(unrendered_all, baseline.get('unrendered') or [])
    if new_un:
        bad = True
        print('  🔴 未被文本引用的类变多了（%d 个）：只被 README 认领，demo / JS / 契约一次都没碰过' % len(new_un))
        for x in new_un:
            print('         + %s' % x)
        print('     ⇒ 视觉回归永远看不到它。给它补 demo，或 `--record` 显式接受水位')
        print('     ⚠️ 这是**文本**口径：JS 拼串生成的类名会被漏看（见 E288）')
        print('')
    if fixed_un:
        print('  ✅ 未被文本引用的类比基线少了 %d 个（记得 `--record` 固化新水位）：%s'
              % (len(fixed_un), ', '.join(fixed_un[:6]) + (' …' if len(fixed_un) > 6 else '')))
        print('')

    undeclared, stale, mismatch, actual = classify_dup(sole_by, declared)
    if undeclared:
        bad = True
        print('  🔴 跨组件同名主体类（%d 个未登记）：' % len(undeclared))
        for c in undeclared:
            print('       .%-24s %s' % (c, ' , '.join(sorted(actual[c]))))
        print('     ⇒ 同特异性，后加载的那个静默覆盖前一个。在 05-audit/%s 登记归属'
              % OWNERSHIP_FILE)
        print('')
    if stale:
        bad = True
        print('  🔴 %s 里的登记已经过期（现实中不再重名）：%s'
              % (OWNERSHIP_FILE, ', '.join('.' + c for c in stale)))
        print('     ⇒ 删掉这条，白条不许腐烂')
        print('')
    if mismatch:
        bad = True
        print('  🔴 %s 登记的归属与实际不符：' % OWNERSHIP_FILE)
        for c, got, want in mismatch:
            print('       .%-24s 实际 %s / 登记 %s' % (c, ' , '.join(got), ' , '.join(want) or '(空)'))
        print('')

    # ---------- ① 组件覆盖率 ----------
    ctext = {}
    for c in contract_files():
        ctext[c] = read(c)

    no_demo = []
    no_contract = []
    for name, d in comps:
        # 🔴 修正：demo 不叫 demo.html 的情况真实存在
        #    （实测 04-recipes/longform 用的是 longform.html）
        #    ⇒ 只要目录里有任意 .html 且**不是** README，就当它有 demo
        htmls = [h for h in glob.glob(os.path.join(d, '*.html'))
                 if not os.path.basename(h).lower().startswith('readme')]
        if not htmls:
            no_demo.append(name)
            continue
        demo = htmls[0]
        # 契约里有没有提到这个组件的路径
        rel = norm(os.path.relpath(demo, ROOT))
        key = norm(os.path.join(d, ''))
        # 🔴 判据放宽：契约里只要提到组件**目录名**或**demo 路径**即算覆盖。
        #    （实测 chart-check.js 里写的是 'bar' 字样，不是完整路径 ⇒ 旧判据漏判）
        hit = any(key in t or ('/' + name + '/') in t or (name in t and 'bar' in name)
                  for t in ctext.values())
        if not hit:
            no_contract.append(name)

    total = len(comps)
    covered = total - len(no_demo) - len(no_contract)

    if no_demo:
        print('  🔴 缺 demo.html（%d 个）：' % len(no_demo))
        for n in no_demo:
            print('       - %s' % n)
    if no_contract:
        print('  🔴 有 demo 但**无任何契约覆盖**（%d 个）：' % len(no_contract))
        for n in no_contract:
            print('       - %s' % n)

    pct = (covered * 100.0 / total) if total else 0
    print('')
    print('  组件覆盖率：%d/%d = %.0f%%' % (covered, total, pct))

    # ---------- ③ 孤儿契约 ----------
    orphan_c = []
    for c in contract_files():
        base = os.path.basename(c)
        stem = base.replace('-check.js', '').replace('-contract.js', '')
        found = False
        for d in COMPONENT_DIRS:
            if os.path.isfile(os.path.join(ROOT, d, stem, 'demo.html')):
                found = True
                break
        if not found and 'composition' not in stem and 'a11y' not in stem \
           and 'tap' not in stem and 'deco' not in stem and 'fab' not in stem \
           and 'focus' not in stem and 'scrollbar' not in stem:
            orphan_c.append(stem)
    if orphan_c:
        print('')
        print('  ⚠️ 找不到对应 demo 的契约（%d 个）：%s' % (len(orphan_c), ', '.join(orphan_c[:8])))

    # ---------- 判定 ----------
    print('')
    if bad:
        return 1
    if no_demo or no_contract:
        print('  ⇒ 🔴 有 %d 个组件**没有契约保护**' % (len(no_demo) + len(no_contract)))
        print('    新增组件时必须同步加契约（判据见 API.md 的「组件契约」）')
        return 1
    print('  ✅ 每个组件都有 demo 且都有契约保护')
    print('  ✅ CSS 类无孤儿、无幻影、跨组件重名全部登记、未渲染水位未涨')
    return 0


# ---------------------------------------------------------------- 自检
def selftest():
    """反向控制：每条判据都必须能红，且不能乱红。"""
    bad = 0

    # ②a / ②c
    cases = [
        ('全认领', {'a', 'b'},
         {'a': {'demo'}, 'b': {'js', 'contract'}}, (0, 0)),
        ('孤儿', {'a', 'b'},
         {'a': {'demo'}, 'b': set()}, (1, 0)),
        ('只写文档', {'a', 'b'},
         {'a': {'demo'}, 'b': {'doc'}}, (0, 1)),
        ('文档+契约不算未渲染', {'a'},
         {'a': {'doc', 'contract'}}, (0, 0)),
    ]
    for name, cls, src, want in cases:
        got = tuple(len(x) for x in classify(cls, src))
        ok = got == want
        print('  %-14s %s  期望 %s 实得 %s' % (name, 'PASS' if ok else 'FAIL', want, got))
        if not ok:
            bad += 1

    # ②d
    dup_cases = [
        ('无重名', {'p/a': {'x'}, 'p/b': {'y'}}, {}, (0, 0, 0)),
        ('重名未登记', {'p/a': {'x'}, 'p/b': {'x'}}, {}, (1, 0, 0)),
        ('重名已登记', {'p/a': {'x'}, 'p/b': {'x'}},
         {'x': {'owners': ['p/a', 'p/b']}}, (0, 0, 0)),
        ('登记过期', {'p/a': {'x'}, 'p/b': {'y'}},
         {'x': {'owners': ['p/a', 'p/b']}}, (0, 1, 0)),
        ('归属不符', {'p/a': {'x'}, 'p/b': {'x'}, 'p/c': {'x'}},
         {'x': {'owners': ['p/a', 'p/b']}}, (0, 0, 1)),
    ]
    for name, sole, decl, want in dup_cases:
        got = tuple(len(x) for x in classify_dup(sole, decl)[:3])
        ok = got == want
        print('  %-14s %s  期望 %s 实得 %s' % (name, 'PASS' if ok else 'FAIL', want, got))
        if not ok:
            bad += 1

    # 棘轮
    ratchet = [
        ('水位持平', ['a'], ['a'], (0, 0)),
        ('涨了', ['a', 'b'], ['a'], (1, 0)),
        ('修好了', ['a'], ['a', 'b'], (0, 1)),
    ]
    for name, cur, base, want in ratchet:
        got = tuple(len(x) for x in diff_unrendered(cur, base))
        ok = got == want
        print('  %-14s %s  期望 %s 实得 %s' % (name, 'PASS' if ok else 'FAIL', want, got))
        if not ok:
            bad += 1

    # 词法：这三个输入曾经被读成假类名
    lex = [
        ('注释不算', '/* .ghost { } */ .real { color: red }', {'real'}),
        ('data-uri 不算', '.a{background:url("data:x,http://www.w3.org/")}', {'a'}),
        ('字符串不算', '.a{content:".fake"}', {'a'}),
        ('伪类不算', '.a:hover::before { }', {'a'}),
    ]
    for name, css, want in lex:
        got = set()
        for m in RULE_RE.finditer(strip_css(css)):
            for sel in m.group(1).split(','):
                got |= subjects(sel)[0]
        ok = got == want
        print('  %-14s %s  期望 %s 实得 %s' % (name, 'PASS' if ok else 'FAIL', sorted(want), sorted(got)))
        if not ok:
            bad += 1

    # 主体独占：`.ctx .target` 是上下文覆盖，不算占用 `.target`；
    # `.target` 单独出现才算。这条决定 ②d 会不会变成噪音。
    sole_cases = [
        ('.ctx .target { }', False),
        ('.target { }', True),
        ('.target:hover { }', True),
        ('.p > .target { }', False),
        ('.a.b { }', True),
    ]
    for css, want in sole_cases:
        m = list(RULE_RE.finditer(strip_css(css)))[0]
        got = subjects(m.group(1))[1]
        ok = got == want
        print('  %-14s %s  期望 %s 实得 %s'
              % ('主体独占' + ('+' if want else '-'), 'PASS' if ok else 'FAIL', want, got))
        if not ok:
            bad += 1

    total = len(cases) + len(dup_cases) + len(ratchet) + len(lex) + len(sole_cases)
    print('  自检 %d 条，失败 %d 条' % (total, bad))
    return 1 if bad else 0


def record(comps, contracts_text):
    """重录未渲染水位（只写 baseline，不碰 ownership）。"""
    data = gather(comps, contracts_text)
    entries = []
    for d in sorted(data):
        v = data[d]
        sources = {c: claimed_by(c, v['demo'], v['js'], v['doc'], contracts_text)
                   for c in v['defined']}
        _, unrendered = classify(set(v['defined']), sources)
        entries.extend(['%s:%s' % (d, c) for c in unrendered])
    p = os.path.join(ROOT, '05-audit', BASELINE_FILE)
    payload = {
        '_note': ('只被 README 认领、demo / JS / 契约从未碰过的类。'
                  '棘轮：不得变多。补了 demo 之后跑 --record 把水位降下来。'),
        'unrendered': sorted(entries),
    }
    with io.open(p, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print('  已重录 %s：%d 条未渲染' % (BASELINE_FILE, len(entries)))
    return 0


def main():
    if '--selftest' in sys.argv:
        return selftest()

    comps = components()
    contracts_text = '\n'.join(read(c) for c in contract_files())
    if '--record' in sys.argv:
        return record(comps, contracts_text)
    return css_report(comps, contracts_text)


if __name__ == '__main__':
    sys.exit(main())
