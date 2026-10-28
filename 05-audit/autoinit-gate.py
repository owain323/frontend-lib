#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
autoinit-gate.py — 「哪些组件会自动初始化」必须三处一致

===========================================================================
🔴 它抓什么（P3 · 交接单里被误判成"自动初始化静默失效"的那件事）
---------------------------------------------------------------------------
  本库 22 个全局对象里，**只有 7 个会自动初始化**（Accordion / Tabs /
  Pagination / Nav / ModelViewer + Chart 的 sparkline 观察，Reveal 是条件自动）。

  剩下 15 个必须自己 `create` / `new` / `attach` / 直接调。
  （数字随代码走：本门禁每次运行都会打印实测的「7 个自动初始化」和文件名单，
    那行输出才是真值；这段文字如果哪天对不上，改这段，不要改门禁。）

  这个区别**从来没有写在文档里**。后果不是"少一行文档"，而是：

      页面用 `[data-select]` 把下拉的结构完整渲染出来了（CSS 是对的），
      点了没反应，console 里**一个字都没有**。

  ⇒ 使用者会怀疑 CSS、怀疑浏览器、怀疑事件代理，唯独不会想到
    「这个组件本来就不自动」。这类"静默失效"是最贵的一种 bug。

  ⚠️ 交接单当时的判断是「九个 create-only 组件的 DOMContentLoaded 计数全为 0
     ⇒ 自动初始化静默失效」。**前半句实测正确，后半句是错的**：
     它们不是"应该有却没有"，而是**本来就不该有**（自动初始化拿不到 options）。
     ⇒ 正确的修法不是"给它们都加上"，是把区别写成契约。
     （这也是 ERRORS.md 里反复出现的形态：先分清真 bug 与看起来像 bug。）

===========================================================================
三条判据
---------------------------------------------------------------------------
  ① **实现自洽**：任何含 `DOMContentLoaded` 的库脚本，必须有**且只有一条**
     `@autoinit:` 标记。
     —— 否则下次有人加了个静默自动初始化，文档那张表会立刻过时，没人发现。

  ② **标记不吹牛**：标记里的选择器必须在该文件里真的出现
     （`[data-x]` 要能找到 `data-x`；`.cls` 要能找到 `cls`；
       `conditional[attr]` 要能找到 `attr`）。
     —— 这是"文档说有、实现没有"的又一次预防（E43 / pagination.on 同型）。

  ③ **文档 ↔ 实现**：`API.md` 里 `<!-- autoinit-table:begin/end -->` 那张表
     必须与 `ai/components.json` 的全局集合**双向一致**，且每行的「是/条件/否」
     必须与源码里的标记一致。
     —— 单向只防吹牛，防不住"新加的自动初始化没进表"。

===========================================================================
不做什么（以及为什么）
---------------------------------------------------------------------------
  · **不检查 demo 里到底调没调**：那是 `api-form-gate` 的活（它比对调用形态）。
  · **不判断"哪种初始化更对"**：需要 options 的组件就不该自动，
    这是设计判断，不是机械判据；门禁只管"说的和做的一致"。
  · **不把 `06-vendor` 扫进来**：第三方代码的加载行为不由本库承诺。

用法
---------------------------------------------------------------------------
    python 05-audit/autoinit-gate.py
    python 05-audit/autoinit-gate.py --selftest
"""
import io
import json
import os
import re
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 库自己的代码目录。06-vendor 是第三方，10-review 是评审材料，都不算"本库承诺"。
DIRS = ('01-tokens', '02-primitives', '03-patterns', '04-recipes',
        '09-assets', 'adapters')

MARK = re.compile(r'@autoinit:\s*(\S+)')
ANCHOR = re.compile(r'<!--\s*autoinit-table:begin\s*-->(.*?)'
                    r'<!--\s*autoinit-table:end\s*-->', re.S)
WORDS = {'是': True, '条件': True, '否': False}


def _read(p):
    return io.open(p, encoding='utf-8').read()


def js_files(root):
    out = []
    for d in DIRS:
        base = os.path.join(root, d)
        if not os.path.isdir(base):
            continue
        for dirpath, _, files in os.walk(base):
            if 'node_modules' in dirpath.replace(os.sep, '/'):
                continue
            for f in files:
                if f.endswith('.js'):
                    out.append(os.path.relpath(os.path.join(dirpath, f),
                                               root).replace(os.sep, '/'))
    return sorted(out)


def marks(root):
    """{相对路径: [标记值, ...]} —— 只收含 DOMContentLoaded 的脚本。"""
    got = {}
    for rel in js_files(root):
        txt = _read(os.path.join(root, rel))
        if 'DOMContentLoaded' in txt:
            got[rel] = MARK.findall(txt)
    return got


def globals_map(root):
    """{全局名: js 相对路径} —— 来自组件契约（单一真源）。

    🔴 一个组件目录可以导出**不止一个**全局（0.11.2：nav/ 里 nav.js 导 `Nav`、
       toc.js 导 `Toc`）。只读 `global` 一个字段的话，第二个全局在门禁眼里
       **不存在** ⇒ 表里写了它反而被判「库里没有这个全局」—— 这是**误报**，
       而误报的处置方式如果改成"把表里那行删掉"，就等于拿真实信息换绿灯。
       ⇒ 契约补 `globalAlso`（同样从源码正则推出来，不是手写），门禁认它。
    """
    p = os.path.join(root, 'ai', 'components.json')
    d = json.loads(_read(p))
    m = {}

    def fix(v):
        return (v or '').replace(os.sep, '/')

    for c in d.get('components') or []:
        files = c.get('files') or {}
        g = c.get('global')
        if g and g not in m:
            m[g] = fix(files.get('js'))
        for extra in c.get('globalAlso') or []:
            name = extra.get('global')
            if name and name not in m:
                m[name] = fix(extra.get('js'))
    return m


def parse_table(root):
    """{'全局名': '是|条件|否'}；找不到锚点返回 None。"""
    p = os.path.join(root, 'API.md')
    if not os.path.isfile(p):
        return None
    m = ANCHOR.search(_read(p))
    if not m:
        return None
    rows = {}
    for line in m.group(1).split('\n'):
        line = line.strip()
        if not line.startswith('|'):
            continue
        cells = [c.strip() for c in line.strip('|').split('|')]
        if len(cells) < 2:
            continue
        name = cells[0].strip('`').strip()
        if not name or name == '全局' or set(name) <= set('-: '):
            continue
        rows[name] = cells[1].strip('`').strip()
    return rows


def check_mark(rel, txt, val):
    """判据 ②：标记里的选择器必须在文件里真的出现。返回问题描述或 None。

    🔴 第一版这里有个自指漏洞（自检抓到的）：
       标记本身就在文件里，直接 `t in txt` 对 `[data-nope]` 也成立
       —— 等于"我写什么就有什么"，判据永远绿。
    ⇒ 必须先把**含 @autoinit 的行**剔掉，再查标记里的选择器是否在别处真的用到。
    """
    if val == 'none':
        return None
    if val.startswith('self'):
        # 「脚本自身初始化，不扫 DOM」——不需要选择器。
        return None
    body = '\n'.join(l for l in txt.split('\n') if '@autoinit' not in l)
    if val.startswith('conditional['):
        attr = val[len('conditional['):].rstrip(']')
        if not attr:
            return '%s：conditional[...] 里没写属性名' % rel
        if attr not in body:
            return ('%s：标记写 conditional[%s]，但文件里找不到 %r'
                    '（条件属性名写错或实现改了）' % (rel, attr, attr))
        return None
    tokens = (re.findall(r'data-[a-z0-9-]+', val)
              + re.findall(r'\.([a-z][a-z0-9-]*)', val))
    if not tokens:
        return ('%s：标记 %r 里没有可校验的选择器记号'
                '（要么写选择器，要么写 none / self）' % (rel, val))
    for t in tokens:
        if t not in body:
            return ('%s：标记写 %r，但文件里找不到 %r'
                    '（标记在吹牛，或实现改过忘了改标记）' % (rel, val, t))
    return None


def run(root):
    """返回问题列表 [(位置, 判据, 说明)]。空列表 = 通过。"""
    problems = []
    mk = marks(root)

    # ---- 判据 ① 实现自洽 ----
    if not mk:
        problems.append(('源码', '判据空转',
                         '一个含 DOMContentLoaded 的脚本都没扫到 ⇒ 本门禁什么都没查'))
    for rel in sorted(mk):
        vals = mk[rel]
        if len(vals) == 0:
            problems.append((rel, '① 有 DOMContentLoaded 但没有 @autoinit 标记',
                             '新增了自动初始化却没人登记 ⇒ API.md 那张表立刻过时'))
        elif len(vals) > 1:
            problems.append((rel, '① @autoinit 标记多于一条',
                             '一个脚本只能有一种自动初始化语义，写两条就说不清了'))

    # ---- 判据 ② 标记不吹牛 ----
    for rel in sorted(mk):
        txt = _read(os.path.join(root, rel))
        for v in mk[rel]:
            p = check_mark(rel, txt, v)
            if p:
                problems.append((rel, '② 标记与实现对不上', p))

    # ---- 判据 ③ 文档 ↔ 实现 ----
    tbl = parse_table(root)
    if tbl is None:
        problems.append(('API.md', '③ 找不到 autoinit-table 锚点',
                         '表被删/锚点被改 ⇒ 使用者又回到"靠猜这个组件要不要自己 init"'))
    elif not tbl:
        problems.append(('API.md', '③ 自动初始化表是空的',
                         '零行通过等于没判（I-10）'))
    else:
        gm = globals_map(root) if os.path.isfile(
            os.path.join(root, 'ai', 'components.json')) else {}
        for g in sorted(tbl):
            word = tbl[g]
            if g not in gm:
                problems.append(('API.md', '③ 表里出现了库里没有的全局 `%s`' % g,
                                 '要么名字写错，要么组件已删'))
                continue
            if word not in WORDS:
                problems.append(('API.md',
                                 '③ `%s` 的第二列只能写 是 / 条件 / 否' % g,
                                 '现在写的是 %r' % word))
                continue
            js = gm[g]
            vals = mk.get(js, []) if js else []
            auto = any(not (v == 'none' or v.startswith('self')) for v in vals)
            if WORDS[word] != auto:
                problems.append((
                    'API.md', '③ `%s` 声明为「%s」但实现%s自动初始化' % (
                        g, word, '有' if auto else '没有'),
                    '实现的标记在 %s（%s）' % (js or '?',
                                              ', '.join(vals) if vals else '无标记')))
        for g in sorted(gm):
            if g not in tbl:
                problems.append(('API.md', '③ 全局 `%s` 没进「自动初始化」表' % g,
                                 '使用者不知道它要不要自己 init'))

    return problems


# ===========================================================================
# 反向控制：喂合成样本，确认三条判据都会红、且一致时真会绿
# ===========================================================================

SELECT_JS = "var Select = { create: function () {} };\nwindow.Select = Select;\n"
AUTO_JS = ("// @autoinit: [data-widget]\n"
           "if (document.readyState === 'loading') {\n"
           "  document.addEventListener('DOMContentLoaded', function () {\n"
           "    document.querySelectorAll('[data-widget]');\n"
           "  });\n}\n")
LIAR_JS = ("// @autoinit: [data-nope]\n"
           "if (document.readyState === 'loading') {\n"
           "  document.addEventListener('DOMContentLoaded', function () {});\n}\n")
SELF_JS = ("// @autoinit: self\n"
           "if (document.readyState === 'loading') {\n"
           "  document.addEventListener('DOMContentLoaded', function () {});\n}\n")
# 同目录下的第二个脚本：导出另一个全局，但**不**自动初始化
SECOND_JS = "var Toc = { init: function () {} };\nwindow.Toc = Toc;\n"


def _fixture(tmp, files, table, globals_, also=None):
    for rel, body in files.items():
        p = os.path.join(tmp, rel)
        d = os.path.dirname(p)
        if d and not os.path.isdir(d):
            os.makedirs(d)
        io.open(p, 'w', encoding='utf-8', newline='\n').write(body)
    comps = {'components': [{'id': g.lower(), 'global': g,
                             'files': {'js': js}} for g, js in globals_.items()]}
    # `also`：同一目录下的**第二个**全局 ⇒ 挂到目录相同的那个组件上（`globalAlso`）
    for g, js in (also or {}).items():
        for c in comps['components']:
            if os.path.dirname(c['files']['js']) == os.path.dirname(js):
                c.setdefault('globalAlso', []).append({'global': g, 'js': js})
                break
        else:
            raise AssertionError('also 里的 %s 找不到同目录组件' % g)
    p = os.path.join(tmp, 'ai')
    if not os.path.isdir(p):
        os.makedirs(p)
    io.open(os.path.join(p, 'components.json'), 'w', encoding='utf-8',
            newline='\n').write(json.dumps(comps, ensure_ascii=False))
    if table is None:
        io.open(os.path.join(tmp, 'API.md'), 'w', encoding='utf-8',
                newline='\n').write('# API\n\n没有锚点。\n')
    else:
        rows = '\n'.join('| `%s` | %s | — |' % (g, w) for g, w in table)
        io.open(os.path.join(tmp, 'API.md'), 'w', encoding='utf-8',
                newline='\n').write(
            '# API\n\n<!-- autoinit-table:begin -->\n'
            '| 全局 | 会自动初始化 | 触发条件 |\n|---|---|---|\n'
            '%s\n<!-- autoinit-table:end -->\n' % rows)


def selftest():
    print('  === autoinit-gate 判据合成（每例都是一个破坏样本）===')
    cases = []
    # ① 一致：Select 标「否」、实现没自动；Widget 标「是」、实现有标记
    cases.append(('一致 ⇒ 绿', dict(
        files={'02-primitives/select/select.js': SELECT_JS,
               '03-patterns/widget/widget.js': AUTO_JS},
        table=[('Select', '否'), ('Widget', '是')],
        globals_={'Select': '02-primitives/select/select.js',
                  'Widget': '03-patterns/widget/widget.js'}),
        False))
    # ② 有 DOMContentLoaded 没标记
    cases.append(('有自动初始化但没标记 ⇒ 红', dict(
        files={'02-primitives/select/select.js':
               "if (document.readyState === 'loading') {"
               " document.addEventListener('DOMContentLoaded', function(){}); }\n"},
        table=[('Select', '否')],
        globals_={'Select': '02-primitives/select/select.js'}), True))
    # ③ 标记吹牛（选择器文件里没有）
    cases.append(('标记里的选择器不存在 ⇒ 红', dict(
        files={'03-patterns/widget/widget.js': LIAR_JS},
        table=[('Widget', '是')],
        globals_={'Widget': '03-patterns/widget/widget.js'}), True))
    # ④ 表说「否」但实现偷偷加了自动初始化（最常见的漂移方向）
    cases.append(('表说不会但实现有 ⇒ 红', dict(
        files={'02-primitives/select/select.js': SELECT_JS,
               '03-patterns/widget/widget.js': AUTO_JS},
        table=[('Select', '否'), ('Widget', '否')],
        globals_={'Select': '02-primitives/select/select.js',
                  'Widget': '03-patterns/widget/widget.js'}), True))
    # ⑤ 全局漏进表
    cases.append(('全局没进表 ⇒ 红', dict(
        files={'02-primitives/select/select.js': SELECT_JS,
               '03-patterns/widget/widget.js': AUTO_JS},
        table=[('Widget', '是')],
        globals_={'Select': '02-primitives/select/select.js',
                  'Widget': '03-patterns/widget/widget.js'}), True))
    # ⑥ 锚点没了
    cases.append(('表锚点被删 ⇒ 红', dict(
        files={'02-primitives/select/select.js': SELECT_JS},
        table=None,
        globals_={'Select': '02-primitives/select/select.js'}), True))
    # ⑦ self 标记（不扫 DOM）不算自动
    cases.append(('self 标记不参与「是/否」判定 ⇒ 绿', dict(
        files={'01-tokens/theme.js': SELF_JS,
               '02-primitives/select/select.js': SELECT_JS},
        table=[('Select', '否')],
        globals_={'Select': '02-primitives/select/select.js'}), False))
    # ⑧ 同目录第二个全局（nav 的实际形状）：契约里有、表里漏 ⇒ 必须红
    #    —— 这条是 0.11.2 的真事故：契约只记 `global` 一个字段，
    #       于是 toc.js 导出的 `Toc` 在门禁眼里不存在，表里写了它被报"库里没有"。
    #    ⚠️ 第一版这两个样本里**一个自动初始化脚本都没有** ⇒ 命中"判据空转"，
    #       红得对但红错了理由（漏进表根本没被验到）。⇒ 必须搭一个会自动初始化的
    #       Widget 让门禁有东西可查，并**断言红的理由**是"没进表"，不是"空转"。
    cases.append(('同目录第二个全局漏进表 ⇒ 红', dict(
        files={'02-primitives/select/select.js': SELECT_JS,
               '02-primitives/select/extra.js': SECOND_JS,
               '03-patterns/widget/widget.js': AUTO_JS},
        table=[('Select', '否'), ('Widget', '是')],
        globals_={'Select': '02-primitives/select/select.js',
                  'Widget': '03-patterns/widget/widget.js'},
        also={'Toc': '02-primitives/select/extra.js'}), True, '没进'))
    # ⑨ 同上但表里写全了 ⇒ 绿（证明 globalAlso 这条路径是**通**的，不只是会红）
    cases.append(('同目录第二个全局登记完整 ⇒ 绿', dict(
        files={'02-primitives/select/select.js': SELECT_JS,
               '02-primitives/select/extra.js': SECOND_JS,
               '03-patterns/widget/widget.js': AUTO_JS},
        table=[('Select', '否'), ('Widget', '是'), ('Toc', '否')],
        globals_={'Select': '02-primitives/select/select.js',
                  'Widget': '03-patterns/widget/widget.js'},
        also={'Toc': '02-primitives/select/extra.js'}), False))

    bad = 0
    for case in cases:
        name, spec, want_red = case[0], case[1], case[2]
        # 第 4 项（可选）：红的**理由**必须命中这个词。
        # 只断言"红"是不够的 —— 门禁可能因为别的原因红（"判据空转"就抓到过一次），
        # 那种"红"对被测判据来说是零信息量。
        want_sub = case[3] if len(case) > 3 else None
        tmp = tempfile.mkdtemp(prefix='fl-autoinit-')
        try:
            _fixture(tmp, spec['files'], spec['table'], spec['globals_'],
                     spec.get('also'))
            probs = run(tmp)
            red = bool(probs)
            ok = (red == want_red)
            if ok and want_sub:
                ok = any(want_sub in p[1] or want_sub in p[2] for p in probs)
            print('  %s %-34s 期望=%s 实得=%s%s'
                  % ('OK ' if ok else '🔴 ', name,
                     '红' if want_red else '绿',
                     '红' if red else '绿',
                     '' if not probs else '  (%s)' % probs[0][1][:30]))
            if not ok:
                bad += 1
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    if bad:
        print('  => %d 个样本判错 ⇒ 判据没有鉴别力' % bad)
        return 1
    print('  OK %d 个破坏样本全部判对 ⇒ 三条判据都有牙' % len(cases))
    return 0


def main():
    print('  === 自动初始化：实现 ↔ 标记 ↔ API.md 三处一致 ===')
    print('')
    probs = run(ROOT)
    mk = marks(ROOT)
    auto = [r for r, v in mk.items()
            if any(not (x == 'none' or x.startswith('self')) for x in v)]
    print('  扫描：%d 个库脚本，其中 %d 个自动初始化、%d 个不扫 DOM（self/none）'
          % (len(js_files(ROOT)), len(auto), len(mk) - len(auto)))
    if not probs:
        print('')
        print('  OK  实现、标记、文档三处一致')
        print('      （%d 个自动初始化：%s）'
              % (len(auto), ', '.join(sorted(os.path.basename(a) for a in auto))))
        return 0
    print('')
    print('  🔴 三处对不上：')
    for where, what, detail in probs:
        print('     %-46s %s' % (what, ''))
        print('       位置：%s' % where)
        print('       %s' % detail)
    print('')
    print('  ⇒ 「哪些组件会自动初始化」必须只有一个说法。')
    print('    改实现就改标记与 API.md；改文档就要确认实现真的那样做。')
    return 1


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(main())
