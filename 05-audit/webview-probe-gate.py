#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
webview-probe-gate.py — 真机能力探针与基线表的**一致性**门禁（W10 / W12）

============================================================================
🔴 它守的是什么
----------------------------------------------------------------------------
`10-review/webview/capability-probe.html` 是给人在**真机**上打开的探针页，
结果要贴进 `docs/LAYER-BASELINE.md`。这两样东西都有一种极常见的腐烂方式：

  ① 库新增了一个 CSS 能力（比如开始用 `:has()`），探针页**没跟着加**
     ⇒ 基线表上写着"15 / 15 全支持"，而真正会用到的第 16 项**从没被问过**
     ⇒ "基线上全绿"变成一句**测量范围之外**的保证
  ② 探针页测的能力库里早就不用了 ⇒ 每一台真机都填不满 ⇒ 表格永远填不完
     ⇒ 人会开始"挑着填"，表格随后失去意义
  ③ 基线表被人填了一行 `TBD` / `?` / `待填`，看起来"有数据"
     ⇒ 这是本项目反复登记的那类假绿：**表格里有字，但没有事实**

⇒ 本门禁把这三条都变成判据。它**不做**真机实测（做不到），
   它保证的是：**"测什么"这件事与源码不会漂移**，以及**"记了什么"必须能被检验**。

============================================================================
判据（五条）
----------------------------------------------------------------------------
  ① 探针页自包含：不引任何外部资源（真机上没有网络是常态，
     更要紧的是：引了外部资源就等于"测的是另一份文件"）
  ② 探测条目 ≥ 10，且每条都标注了判定方式（`声明` / `实测`）
     —— 声明式 `CSS.supports()` 与行为实测**不是同一种证据**，混着写会误导
  ③ **双向漂移**：CAPS 表里每一行都有「源码特征」与「探针条目名」；
     源码有这个特征而探针没测 ⇒ 红；探针测了而源码已不用 ⇒ 红
     （`@layer` 例外：库里还没用，是 W12 的候选，理由写在 ALLOW）
  ④ 基线表结构：8 列齐全；有数据行时每格必须非空、不含占位符；
     `状态` 只能是 `UNVERIFIED` / `VERIFIED`；`VERIFIED` 行的 UA 必须 ≥30 字符
     （"iPhone 15"这种简称不是 UA —— 没有 UA 的基线无法复核）
  ⑤ 零视野守卫：③ 的源码扫描如果一条特征都没命中 ⇒ 红
     （扫 0 个文件却判 PASS，是本库最熟悉的那种假绿）

============================================================================
用法
----------------------------------------------------------------------------
  python 05-audit/webview-probe-gate.py --dir .
  python 05-audit/webview-probe-gate.py --selftest
"""
from __future__ import annotations

import io
import os
import re
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

PROBE = os.environ.get('FL_PROBE') or os.path.join(
    ROOT, '10-review', 'webview', 'capability-probe.html')
BASELINE = os.environ.get('FL_BASELINE') or os.path.join(
    ROOT, 'docs', 'LAYER-BASELINE.md')

# 库里真的有样式的目录（与 build-dist 的 SRC_DIRS 口径一致，少掉模型资产）
SRC_DIRS = ['01-tokens', '02-primitives', '03-patterns', '04-recipes',
            '09-assets', 'adapters']
SRC_EXTS = ('.css', '.js', '.mjs', '.html', '.htm')

MIN_ITEMS = 10

# 🔴 「源码特征」→「探针里的条目名」。这张表是**唯一**的对应关系，
#    判据 ③ 两侧都从这里读（E31：同一个判断不写两遍）。
CAPS = [
    ('var(--', '自定义属性（CSS 变量）'),
    (':focus-visible', ':focus-visible'),
    (':is(', ':is() / :where()'),
    (':where(', ':is() / :where()'),
    (':has(', ':has()'),
    ('clamp(', 'clamp()'),
    ('gap:', 'flex + gap'),
    ('aspect-ratio', 'aspect-ratio'),
    ('dvh', 'dvh 单位'),
    ('scrollbar-width', 'scrollbar-width'),
    ('accent-color', 'accent-color'),
    ('color-scheme', 'color-scheme'),
    ('backdrop-filter', 'backdrop-filter'),
    ('<dialog', '<dialog> + ::backdrop'),
    ('popover', 'Popover API'),
    ('@layer', '@layer（尚未使用，切层的前提）'),
]

# 探针里测了、但源码暂时不用 —— 每条都要写理由（否则就是噪音）
ALLOW = {
    '@layer（尚未使用，切层的前提）':
        '库里还没用 @layer；它是 W12「能不能切层」的问题本身，所以必须提前测',
}

PLACEHOLDERS = ('?', '?', 'TBD', 'TODO', '待填', '待定', 'xxx', '—待')

RE_EXTERNAL = re.compile(
    r'''<(?:script|link|img|iframe|source|video|audio)\b[^>]*?
        (?:src|href)\s*=\s*["']?
        (?![#])''' , re.X | re.I)


def read(p):
    with io.open(p, encoding='utf-8', errors='replace') as f:
        return f.read()


def is_external(attr_value):
    v = attr_value.strip().strip('"\'')
    if not v:
        return False
    if v.startswith('#'):
        return False
    if v.startswith('data:') or v.startswith('blob:'):
        return False
    return True


# ---------------------------------------------------------------- 判据 ①
def check_self_contained(html):
    problems = []
    for m in re.finditer(r'<(script|link|img|iframe|source|video|audio)\b([^>]*)>',
                         html, re.I):
        tag, attrs = m.group(1).lower(), m.group(2)
        for am in re.finditer(r'\b(src|href)\s*=\s*("([^"]*)"|\'([^\']*)\'|([^\s>]+))',
                              attrs, re.I):
            val = am.group(3) or am.group(4) or am.group(5) or ''
            if is_external(val):
                line = html.count('\n', 0, m.start()) + 1
                problems.append('① 探针页:%d `<%s %s="%s">` 引了外部资源 —— '
                                '真机上多半加载不到，而且那等于"测的是另一份文件"'
                                % (line, tag, am.group(1), val))
    return problems


# ---------------------------------------------------------------- 判据 ②
def probe_items(html):
    """从 ITEMS 数组里数出条目：每条是 ['名字', fn, '声明'|'实测', '用法']

    ⚠️ fn 有两种写法：匿名的 `function () { … }` 与具名的 `flexGapWorks`。
       第一版的正则只认后一种，于是 15 条只数到 4 条 —— 而门禁**照样跑**，
       只是把它判成"条目太少"。若当时把下限调到 4，它就会静默变成空转。
       ⇒ 这里对 fn 一律用"任意内容"，只锚定首尾两个引号段。
    """
    i = html.find('var ITEMS')
    if i < 0:
        return [], 'HTML 里找不到 `var ITEMS` 数组'
    j = html.find('\n  ];', i)
    body = html[i:j if j > 0 else len(html)]
    items = re.findall(
        r"\n\s*\[\s*'([^']+)'\s*,\s*(?:.*?),\s*'([^']*)'\s*,\s*'",
        body, re.S)
    return items, None


def check_items(html):
    problems = []
    items, err = probe_items(html)
    if err:
        return [err]
    if len(items) < MIN_ITEMS:
        problems.append('② 探针只有 %d 个条目（下限 %d）—— '
                        '条目太少时"全支持"这个结论没有覆盖力'
                        % (len(items), MIN_ITEMS))
    for name, method in items:
        if method not in ('声明', '实测'):
            problems.append('② 条目 `%s` 的判定方式写成 `%s` —— '
                            '必须是 `声明`（CSS.supports）或 `实测`（真建元素量）'
                            % (name, method))
    return problems


# ---------------------------------------------------------------- 判据 ③⑤
def scan_sources():
    """→ {特征: [命中文件...]}。只扫真的有样式的目录。"""
    hits = {}
    scanned = 0
    for d in SRC_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames if x != 'node_modules']
            for fn in filenames:
                if not fn.lower().endswith(SRC_EXTS):
                    continue
                path = os.path.join(dirpath, fn)
                rel = os.path.relpath(path, ROOT).replace('\\', '/')
                scanned += 1
                txt = read(path)
                for feat, _name in CAPS:
                    if feat in txt:
                        hits.setdefault(feat, set()).add(rel)
    return hits, scanned


def check_drift(html):
    problems = []
    items, err = probe_items(html)
    if err:
        return [err]
    names = set(n for n, _m in items)
    hits, scanned = scan_sources()

    # ⑤ 零视野守卫
    if scanned == 0:
        return ['⑤ 一个源文件都没扫到（SRC_DIRS 全空？）—— '
                '这种情况下判据 ③ 会**空转通过**，属于假绿']
    if not hits:
        return ['⑤ 扫描了 %d 个文件但一条特征都没命中 —— '
                '要么特征表全错了，要么源码被换掉了' % scanned]

    # ③a 源码有、探针没测
    for feat, name in CAPS:
        if feat in hits and name not in names:
            problems.append('③ 源码在 %d 个文件里用了 `%s`，但探针没有 `%s` 这一条 '
                            '⇒ 基线表上的"全支持"覆盖不到它'
                            % (len(hits[feat]), feat, name))
    # ③b 探针测了、源码不用
    covered = set(n for _f, n in CAPS)
    for name, _m in items:
        if name in covered:
            continue
        problems.append('③ 探针里有 `%s`，但它不在 CAPS 表里 —— 无法判断源码是否还在用'
                        % name)
    for feat, name in CAPS:
        if feat not in hits and name in names:
            if name in ALLOW:
                continue
            problems.append('③ 探针测了 `%s`，但源码里已经找不到 `%s` ⇒ '
                            '这一项会让每台真机都填不满，属于噪音（要留就写进 ALLOW 并给理由）'
                            % (name, feat))
    return problems


# ---------------------------------------------------------------- 判据 ④
COLS = ['设备 / 系统', '入口', 'UA', '结果', '缺失能力', '测试日期', '记录人', '状态']


def data_rows(md):
    """→ [(行号, cells)]。只取**真正的数据行**：
    跳过表头、分隔行（`---`）、以及全空的模板行。
    统计口径只此一处 —— 否则"表里有几行"会在两个地方算出两个数。"""
    out = []
    in_table = False
    for idx, line in enumerate(md.split('\n'), 1):
        s = line.strip()
        if not s.startswith('|'):
            in_table = False
            continue
        cells = [c.strip() for c in s.strip('|').split('|')]
        if cells and cells[0] == COLS[0]:
            in_table = True
            continue
        if not in_table:
            continue
        if set(''.join(cells)) <= set('-: '):
            continue
        if all(c == '' for c in cells):
            continue
        out.append((idx, cells))
    return out


def check_baseline(md):
    problems = []
    # 表头
    header = None
    for line in md.split('\n'):
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if cells and cells[0] == COLS[0]:
            header = cells
            break
    if header is None:
        return ['④ 基线表里找不到表头（第一列应为 `%s`）' % COLS[0]]
    if header != COLS:
        problems.append('④ 基线表头是 %s，应为 %s'
                        % (header, COLS))
        return problems

    for idx, cells in data_rows(md):
        if len(cells) != len(COLS):
            problems.append('④ 基线表第 %d 行有 %d 列，应为 %d 列'
                            % (idx, len(cells), len(COLS)))
            continue
        for k, c in enumerate(cells):
            if c == '':
                problems.append('④ 基线表第 %d 行的「%s」是空的 —— '
                                '空单元格比写"未知"更糟：它看起来像"没问题"'
                                % (idx, COLS[k]))
            elif c in PLACEHOLDERS or any(ph in c for ph in PLACEHOLDERS):
                problems.append('④ 基线表第 %d 行的「%s」是占位符 `%s`'
                                % (idx, COLS[k], c))
        status = cells[-1]
        if status not in ('UNVERIFIED', 'VERIFIED'):
            problems.append('④ 基线表第 %d 行的状态是 `%s`，'
                            '只能是 UNVERIFIED 或 VERIFIED' % (idx, status))
        if status == 'VERIFIED':
            ua = cells[2]
            if len(ua) < 30 or ' ' not in ua:
                problems.append('④ 基线表第 %d 行标了 VERIFIED，但 UA 是 `%s` —— '
                                '不是从探针页复制出来的完整 UA，别人无法复核'
                                % (idx, ua))
    return problems


# ---------------------------------------------------------------- 主流程
def run(probe=None, baseline=None):
    probe = probe or PROBE
    baseline = baseline or BASELINE
    if not os.path.isfile(probe):
        return ['探针页不存在：%s' % probe]
    if not os.path.isfile(baseline):
        return ['基线文档不存在：%s —— W12 的结论没有落档处' % baseline]
    html = read(probe)
    md = read(baseline)
    return (check_self_contained(html) + check_items(html)
            + check_drift(html) + check_baseline(md))


# ---------------------------------------------------------------- 反向控制
def selftest():
    print('  === webview-probe 反向控制 ===')
    ok = True
    base_html = read(PROBE)
    base_md = read(BASELINE)
    tmp = tempfile.mkdtemp(prefix='wv-')

    def chk(why, html, md, should_fail, needle=None):
        nonlocal ok
        hp = os.path.join(tmp, 'p.html')
        mp = os.path.join(tmp, 'b.md')
        io.open(hp, 'w', encoding='utf-8').write(html)
        io.open(mp, 'w', encoding='utf-8').write(md)
        probs = run(hp, mp)
        hit = probs if needle is None else [p for p in probs if needle in p]
        got = bool(hit)
        good = (got == should_fail)
        if not good:
            print('       ↳ 实际：%s' % (probs[0] if probs else '(无)'))
        print('  [%s] %-34s 期望%s ⇒ 实际%s'
              % ('OK ' if good else 'FAIL', why,
                 '红' if should_fail else '绿', '红' if got else '绿'))
        if not good:
            ok = False

    chk('原样不动', base_html, base_md, False)

    # ① 外链
    chk('探针引了外部 CSS',
        base_html.replace('</head>', '<link rel="stylesheet" href="x.css"></head>'),
        base_md, True, '①')

    # ② 条目里判定方式写错（把第一条 `实测` 改成 `猜的`）
    broken_method = base_html.replace(", '实测',", ", '猜的',", 1)
    if broken_method == base_html:
        print('  [FAIL] 自检样本失效：找不到 `, \'实测\',`')
        ok = False
    else:
        chk('判定方式写成"猜的"', broken_method, base_md, True, '②')

    # ③ 源码用了但探针没测：把探针里 :has() 那一条删掉
    no_has = re.sub(r"\n\s*\[':has\(\)'[^\n]*\n", '\n', base_html)
    if no_has == base_html:
        print('  [FAIL] 自检样本失效：找不到 :has() 条目')
        ok = False
    else:
        chk('源码用了 :has() 但探针没测', no_has, base_md, True, '③')

    # ③b 探针测了源码不用：把 CAPS 里的 gap 换成源码里不存在的特征
    #     （直接改 CAPS 会影响全局，改用"探针多一条"的方式）
    extra = base_html.replace(
        "['@layer（尚未使用，切层的前提）', layerWorks, '实测',",
        "['源码里不存在的假能力', function () { return true; }, '实测', ''],"
        "\n    ['@layer（尚未使用，切层的前提）', layerWorks, '实测',")
    chk('探针多了一条源码不用的能力', extra, base_md, True, '③')

    # ④ 基线表填了占位符
    row_bad = base_md.replace(
        '|  |  |  |  |  |  |  |  |',
        '| iPhone | Safari | TBD | 15/15 | 无 | 待填 | 我 | VERIFIED |')
    chk('基线表填了占位符', base_html, row_bad, True, '④')

    # ④ VERIFIED 但 UA 是简称
    row_ua = base_md.replace(
        '|  |  |  |  |  |  |  |  |',
        '| iPhone 15 | Safari | iPhone 15 | 15/15 | 无 | 2000-01-01 | 我 | VERIFIED |')
    chk('VERIFIED 但 UA 是简称', base_html, row_ua, True, '④')

    # ④ 合法的一行（完整 UA）必须绿
    ua = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
          'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
    row_ok = base_md.replace(
        '|  |  |  |  |  |  |  |  |',
        '| iPhone 15 | Safari | %s | 15/15 | 无 | 2000-01-01 | 我 | VERIFIED |' % ua)
    chk('合法的一行（完整 UA）', base_html, row_ok, False)

    # ⑤ 源码目录全空 ⇒ 必须红而不是绿
    saved = list(SRC_DIRS)
    try:
        SRC_DIRS[:] = ['__no_such_dir__']
        chk('源码扫描零视野', base_html, base_md, True, '⑤')
    finally:
        SRC_DIRS[:] = saved

    print('')
    print('  ' + ('反向控制全部通过 ⇒ 五条判据都有牙' if ok
                  else '🔴 有反向控制未通过'))
    return 0 if ok else 1


def main():
    if '--selftest' in sys.argv:
        return selftest()
    probs = run()
    if probs:
        for p in probs:
            print('  [FAIL] %s' % p)
        print('\n  共 %d 处' % len(probs))
        return 1
    html = read(PROBE)
    items, _ = probe_items(html)
    md = read(BASELINE)
    rows = len(data_rows(md))
    print('  [OK] 探针 %d 项能力、自包含；与源码用法双向一致（扫描 %d 个源文件）；'
          '基线表 %d 行数据'
          % (len(items), scan_sources()[1], rows))
    if rows == 0:
        print('  ⚠️ 基线表 0 行 —— 状态仍是 **UNVERIFIED**：'
              '"表结构没问题"不等于"测过了"')
    return 0


if __name__ == '__main__':
    sys.exit(main())
