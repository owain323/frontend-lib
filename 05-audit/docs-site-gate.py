#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
docs-site-gate.py —— 文档站与根索引页的判据

===========================================================================
为什么要有这道门禁
--------------------------------------------------------------------------
0.11.x 期间出现过一件事：`reveal` / `analysis-report` / `detail-page` /
`longform` / `data-showcase` / `scientific-plot` 六个页面**早就存在**，
而根 `index.html` 里一个都没有 —— 177 道门禁全绿。

因为没有任何一道判据问过「索引覆盖了几页」。手写索引的失效方式不是
写错字，而是**它不会因为新增文件而变红**。

同一件事的另一半：35 个组件的 README 散在各目录，站上没有索引、没有搜索。
于是"有文档"和"能读到文档"之间差一整个交付面。

⇒ 索引与文档页改为生成（`gen-docs.py`），本门禁负责证明三件事：
     ① 生成物是**现算的**（改了 README 忘了重跑 ⇒ 红）
     ② 每一页的链接都指着**真实存在的文件**（不产生 404）
     ③ 页面本身是可访问的（lang / title / 单一 h1 / main / skip link / 无重复 id）

===========================================================================
判据清单
--------------------------------------------------------------------------
  [1] 产物新鲜      磁盘 == 现算（逐字节）；缺页与多页都算不新鲜
  [2] 覆盖          每个组件一页；页数 == 组件数 + 1（索引）
  [3] 链接          所有相对 href/src 指向仓库内真实文件（目录须存在）
  [4] 可访问        lang / title / 唯一 h1 / main / skip-link / id 不重复
  [5] 零外链资源    link/script/img 不得指向 http(s)（否则"零依赖"是假的）
  [6] 内部词        复用 terms.process_trace_pat()，不在本文件另写一份
  [7] 摘要可用      索引每行有摘要，且不是分隔线/HTML/代码残片

===========================================================================
自检（--selftest）
--------------------------------------------------------------------------
  ⚠️ 只断言"红"是不够的：一道永远红的门禁也算"能抓住问题"。
     所以每个样本都断言**红的理由**，其中一条样本断言"好样本必须绿"。
===========================================================================
"""
import io
import json
import os
import re
import sys
import tempfile
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import terms  # noqa: E402

GEN = os.path.join(HERE, 'gen-docs.py')

LINK_RE = re.compile(r'(?:href|src)="([^"]+)"')
ID_RE = re.compile(r'\sid="([^"]+)"')
TAG_RE = re.compile(r'<[^>]+>')
SKIP_SCHEMES = ('http://', 'https://', 'mailto:', '#', 'data:', '//')
RES_RE = re.compile(r'<(?:link|script|img)[^>]*?(?:href|src)="([^"]+)"')


def load_gen():
    """把生成器当模块载入（不复制它的逻辑）。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location('gen_docs', GEN)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ===========================================================================
# 判据（纯函数：喂字符串与"存在性"回调，便于自检）
# ===========================================================================

def check_page(path, html, exists, base='/'):
    """一页的静态检查。返回 [(判据代号, 理由)]。"""
    errs = []

    if '<html lang="' not in html:
        errs.append(('A11Y-1', '%s：<html> 上没有 lang ⇒ 读屏按系统语言猜读法' % path))
    t = re.search(r'<title>(.*?)</title>', html, re.S)
    if not t or not t.group(1).strip():
        errs.append(('A11Y-2', '%s：<title> 为空 ⇒ 标签页与历史记录里无法区分' % path))

    h1 = re.findall(r'<h1[ >]', html)
    if len(h1) != 1:
        errs.append(('A11Y-3', '%s：有 %d 个 <h1>（必须恰好 1 个）' % (path, len(h1))))
    if '<main' not in html:
        errs.append(('A11Y-4', '%s：没有 <main> 地标' % path))
    if 'href="#main"' not in html or 'id="main"' not in html:
        errs.append(('A11Y-5', '%s：缺「跳到主内容」链接或其落点' % path))

    ids = ID_RE.findall(html)
    dup = sorted(set(i for i in ids if ids.count(i) > 1))
    if dup:
        errs.append(('A11Y-6', '%s：id 重复 %s ⇒ 页内锚点只会跳到第一个' % (path, dup[:3])))

    for m in RES_RE.finditer(html):
        u = m.group(1)
        if u.startswith(('http://', 'https://', '//')):
            errs.append(('EXT', '%s：引用了外部资源 %s ⇒ 断网即失效，"零依赖"不成立'
                         % (path, u)))

    for m in LINK_RE.finditer(html):
        u = m.group(1)
        if u.startswith(SKIP_SCHEMES):
            continue
        target = u.split('#')[0]
        if not target:
            continue
        if target.startswith('/'):
            # 站内绝对路径（只有 404 页会用）。剥掉站点前缀再当仓库内
            #   路径判落地 —— 不豁免，只是换个算法。
            prefix = base if base != '/' else '/'
            if not target.startswith(prefix):
                errs.append(('LINK', '%s：绝对路径 %s 不在站点前缀 %s 下 ⇒ 线上必然 404'
                             % (path, u, prefix)))
                continue
            full = target[len(prefix):]
        else:
            here = os.path.dirname(path)
            full = os.path.normpath(os.path.join(here, target)).replace('\\', '/')
        if full.startswith('..'):
            errs.append(('LINK', '%s：链接 %s 跑到仓库外' % (path, u)))
            continue
        if not exists(full):
            errs.append(('LINK', '%s：链接 %s 指向不存在的 %s ⇒ 点开 404'
                         % (path, u, full)))
    return errs


def check_404_paths(html, base):
    """404 页的每个引用都必须是绝对路径。

    这不是风格要求。GitHub Pages 拿这个文件响应**任意**不存在的地址，
    而浏览器地址栏仍停在那个错路径上：访问 `/frontend-lib/typo/x` 时，
    页内 `01-tokens/tokens.css` 会被解析成 `/frontend-lib/typo/01-tokens/tokens.css`
    —— 又一次 404。于是整页裸奔：没样式、没暗色、字挤成一团。

    正常页面永远不会遇到这个失败模式，所以要单独一条判据盯着。
    """
    errs = []
    for m in re.finditer(r'(?:href|src)="([^"]+)"', html):
        u = m.group(1)
        if u.startswith(SKIP_SCHEMES):
            continue
        if not u.startswith('/'):
            errs.append(('404-1', '用了相对路径 %s ⇒ 在错路径下会解析成错地址，'
                                  '整页样式丢失' % u))
    if base == '/':
        errs.append(('404-2', '推导不出站点前缀（package.json 没有 homepage）⇒ '
                              '绝对路径无处可落'))
    return errs


def check_index_rows(html):
    """索引页每一行都要有摘要，且摘要不能是代码/分隔线残片。"""
    errs = []
    rows = re.findall(r'<li class="g-item"[^>]*>(.*?)</li>', html, re.S)
    if not rows:
        errs.append(('INDEX-1', '索引页一行都没有 ⇒ 生成器视野空了'))
    for r in rows:
        d = re.search(r'<span class="g-item__desc">(.*?)</span>', r, re.S)
        name = re.search(r'<span class="g-item__name">(.*?)</span>', r, re.S)
        label = TAG_RE.sub('', name.group(1)) if name else '?'
        if not d or not d.group(1).strip():
            errs.append(('INDEX-2', '索引行「%s」没有摘要' % label))
            continue
        txt = d.group(1).strip()
        if txt in ('---', '***') or txt.startswith('<') or '```' in txt:
            errs.append(('INDEX-3', '索引行「%s」的摘要取到了代码/分隔线：%r'
                         % (label, txt[:40])))
    return errs


def check_search_examples(html):
    """搜索框的占位示例，必须**真的搜得到**。

    🔴 为什么单独判这一条：占位文案 `例如：抽屉 / 表格 / btn--ghost`
       是给用户抄的。第一版写的是 `badge--dot` —— 那个类名在全仓库
       不存在（badge 只有 `--solid-danger` 这些），用户照抄搜 0 项，
       只会以为"这个站搜不到东西"。
       示例写错不会报错、不会缺样式，只会让人对搜索失去信心。
    """
    errs = []
    m = re.search(r'placeholder="([^"]*)"', html)
    kw = re.search(r'<script type="application/json" id="kw">(.*?)</script>',
                   html, re.S)
    if not m:
        return [('SEARCH-1', '索引页没有搜索框占位文案')]
    if not kw:
        return [('SEARCH-1', '索引页没有键表 ⇒ 搜索框是死的')]
    try:
        table = json.loads(kw.group(1))
    except ValueError:
        return [('SEARCH-1', '键表不是合法 JSON')]
    if not table:
        return [('SEARCH-1', '键表是空的')]
    keys = [re.sub(r'\s+', '', v.lower()) for v in table.values()]

    text = m.group(1)
    part = text.split('：')[-1] if '：' in text else text
    picked = [t.strip() for t in part.split('/') if t.strip()]
    if not picked:
        return [('SEARCH-2', '占位文案里没有示例词：%r' % text)]
    for tok in picked:
        q = re.sub(r'\s+', '', tok.lower())
        if not any(q in k for k in keys):
            errs.append(('SEARCH-2',
                         '占位示例「%s」在键表里命中 0 项 —— 用户照抄搜不到东西' % tok))
    return errs


# 用户真会这么问 —— 回归探针。
#
# 这 14 个词在「键表只有类名/属性/标题」的版本里有一半命中 0：
# 搜「禁用」「焦点环」「错误态」全是空结果，因为这几个字只出现在正文句子里。
# 键表补上正文之后 21/22 命中（唯一缺的「减少动效」是全局约定，
# 不属于任何组件 —— 要补的是"全局约定页"，不是搜索）。
# 探针放在这里，是为了让"命中率"不会哪天被悄悄改回去。
SEARCH_PROBES = ('焦点环', '禁用', '错误态', '空状态', '对比度', '暗色', '打印',
                 '弹层', '阴影', '圆角', '读屏', '键盘', '分页', '抽屉')


def check_search_probes(html):
    errs = []
    kw = re.search(r'<script type="application/json" id="kw">(.*?)</script>',
                   html, re.S)
    if not kw:
        return [('SEARCH-3', '索引页没有键表')]
    try:
        table = json.loads(kw.group(1))
    except ValueError:
        return [('SEARCH-3', '键表不是合法 JSON')]
    keys = [re.sub(r'\s+', '', v.lower()) for v in table.values()]
    for tok in SEARCH_PROBES:
        q = re.sub(r'\s+', '', tok.lower())
        if not any(q in k for k in keys):
            errs.append(('SEARCH-3', '搜「%s」命中 0 项 —— 用户问的是意思，'
                                     '键表里只有结构词' % tok))
    return errs


def check_coverage(files, comp_ids):
    errs = []
    pages = set(f[len('guide/'):-len('.html')] for f in files
                if f.startswith('guide/') and f.endswith('.html'))
    for cid in comp_ids:
        if cid not in pages:
            errs.append(('COVER-1', '组件 %s 没有文档页' % cid))
    if 'index' not in pages:
        errs.append(('COVER-2', '没有 guide/index.html'))
    extra = sorted(p for p in pages if p != 'index' and p not in comp_ids)
    if extra:
        errs.append(('COVER-3', '多出没有对应组件的页面 %s' % extra[:5]))
    return errs


FENCE = '```'


def _strip_wrap(s):
    """剥掉前导引用符与缩进。

    围栏、表格、标题写进列表项或引用块时，前面会带 `> ` 或两个空格。
    旧的渲染器只认行首，于是那些块被当成行内文字 —— 这里要先剥，
    不然判据和渲染器一样瞎。
    """
    while True:
        t = s.lstrip()
        if t.startswith('>'):
            s = t[1:]
            continue
        if t != s:
            s = t
            continue
        return s


def md_counts(md):
    """README 的块级元素数。围栏里的 `|` 与 `#` 不算（那是代码）。"""
    fence = table = head = 0
    infence = False
    for raw in md.replace('\r\n', '\n').split('\n'):
        s = _strip_wrap(raw).strip()
        if s.startswith(FENCE):
            fence += 1
            infence = not infence
            continue
        if infence:
            continue
        if re.match(r'^\|[\s:\-|]*-[\s:\-|]*\|$', s):
            table += 1
        if re.match(r'^#{2,3}\s+\S', s):
            head += 1
    return {'fence': fence // 2, 'table': table, 'head': head}


def html_counts(html):
    return {'fence': len(re.findall(r'<pre\b', html)),
            'table': len(re.findall(r'<table\b', html)),
            'head': len(re.findall(r'<h[23]\b', html))}


def check_parity(comps, readme_text, pages):
    """README 写了 N 段代码 / M 张表 / K 个小标题，页面就得有同样多。

    防的不是排版难看，是**静默丢内容**：围栏写进列表项或引用块时，
    旧渲染器整块吞掉或降级成行内文字。页面上看不出「少了东西」——
    少的那段代码不会留下空位、不会报错、截图也一切正常。
    """
    names = {'fence': '代码块', 'table': '表格', 'head': '小标题'}
    errs = []
    for c in comps:
        page = 'guide/%s.html' % c['id']
        if page not in pages:
            continue
        md = readme_text(c['id'])
        if md is None:
            errs.append(('PARITY-0', '%s 的 README 读不到' % c['id']))
            continue
        want, got = md_counts(md), html_counts(pages[page])
        for k in ('fence', 'table', 'head'):
            if want[k] != got[k]:
                errs.append(('PARITY-1', '%s 的%s：README %d 个，页面 %d 个'
                             % (c['id'], names[k], want[k], got[k])))
    return errs


def check_fresh(files, out_root):
    """磁盘 vs 现算。返回 (缺, 多, 异)。"""
    missing, extra, diff = [], [], []
    disk = set()
    for base, _dirs, names in os.walk(out_root):
        for n in names:
            p = os.path.join(base, n)
            rel = os.path.relpath(p, out_root).replace('\\', '/')
            if rel.startswith('guide/') or rel in ('index.html', '404.html'):
                disk.add(rel)
    for rel in sorted(files):
        if rel not in disk:
            missing.append(rel)
            continue
        with io.open(os.path.join(out_root, rel), encoding='utf-8') as f:
            if f.read() != files[rel]:
                diff.append(rel)
    managed = set(files)
    for rel in sorted(disk - managed):
        if rel.startswith('guide/'):
            extra.append(rel)
    return missing, extra, diff


# ===========================================================================
# 自检
# ===========================================================================

OK_PAGE = ('<!DOCTYPE html><html lang="zh-CN"><head><title>t</title></head>'
           '<body><a href="#main">skip</a><main id="main"><h1>x</h1></main>'
           '</body></html>')


def selftest():
    bad = 0

    def expect(code, html, want, exists=None, note=''):
        nonlocal bad
        real_exists = exists or (lambda p: True)
        got = [c for c, _ in check_page('guide/x.html', html, real_exists)]
        if want not in got:
            bad += 1
            print('  [FAIL] 样本没被判红：%s（期望 %s，实际 %s）' % (note, want, got))
        else:
            reason = [m for c, m in check_page('guide/x.html', html, real_exists)
                      if c == want][0]
            if not reason.strip():
                bad += 1
                print('  [FAIL] 样本判红了但没给理由：%s' % note)

    # ① 好样本必须绿 —— 否则后面每一条"红"都可能是门禁本身有病
    errs = check_page('guide/x.html', OK_PAGE, lambda p: True)
    if errs:
        bad += 1
        print('  [FAIL] 好样本被判红：%s' % errs)

    expect('A11Y-1', OK_PAGE.replace(' lang="zh-CN"', ''), 'A11Y-1', note='缺 lang')
    expect('A11Y-2', OK_PAGE.replace('<title>t</title>', '<title></title>'),
           'A11Y-2', note='空 title')
    expect('A11Y-3', OK_PAGE.replace('<h1>x</h1>', '<h1>x</h1><h1>y</h1>'),
           'A11Y-3', note='两个 h1')
    expect('A11Y-3', OK_PAGE.replace('<h1>x</h1>', ''), 'A11Y-3', note='没有 h1')
    expect('A11Y-4', OK_PAGE.replace('<main id="main">', '<div id="main">')
           .replace('</main>', '</div>'), 'A11Y-4', note='缺 main')
    expect('A11Y-5', OK_PAGE.replace('href="#main"', 'href="#top"'),
           'A11Y-5', note='skip 链接指向不存在的落点')
    expect('A11Y-6', OK_PAGE.replace('<h1>x</h1>', '<h1 id="a">x</h1><p id="a">y</p>'),
           'A11Y-6', note='id 重复')
    expect('EXT', OK_PAGE.replace('<h1>x</h1>',
                                  '<link rel="stylesheet" href="https://cdn/x.css"><h1>x</h1>'),
           'EXT', note='外链样式')
    expect('LINK', OK_PAGE.replace('<h1>x</h1>', '<a href="../nope.css">x</a><h1>x</h1>'),
           'LINK', exists=(lambda p: p != 'nope.css'), note='死链')
    expect('LINK', OK_PAGE.replace('<h1>x</h1>', '<a href="../../etc/passwd">x</a><h1>x</h1>'),
           'LINK', note='链接跑出仓库')

    # 索引摘要：三种残片都要判红
    def idx(desc):
        return ('<li class="g-item" data-k="x"><a class="g-item__link" href="x.html">'
                '<span class="g-item__name">x</span>'
                '<span class="g-item__desc">%s</span></a></li>' % desc)

    for desc, want, note in (('---', 'INDEX-3', '摘要取到分隔线'),
                             ('<link rel="stylesheet">', 'INDEX-3', '摘要取到 HTML'),
                             ('', 'INDEX-2', '摘要为空')):
        got = [c for c, _ in check_index_rows(idx(desc))]
        if want not in got:
            bad += 1
            print('  [FAIL] 样本没被判红：%s（期望 %s，实际 %s）' % (note, want, got))
    if check_index_rows(idx('状态标签：计数、分类、结果标记')):
        bad += 1
        print('  [FAIL] 正常摘要被判红')

    # 搜索示例：写错一个词必须判红，写对了必须绿（两个方向都要有）
    def search_page(ph, table):
        return ('<input id="q" placeholder="%s">'
                '<script type="application/json" id="kw">%s</script>'
                % (ph, json.dumps(table, ensure_ascii=False)))

    got = [c for c, _ in check_search_examples(
        search_page('例如：抽屉 / badge--dot', {'badge': 'badge solid-danger'}))]
    if 'SEARCH-2' not in got:
        bad += 1
        print('  [FAIL] 占位示例里那个不存在的词没被判红：%s' % got)
    if check_search_examples(search_page('例如：badge / solid-danger',
                                         {'badge': 'badge solid-danger'})):
        bad += 1
        print('  [FAIL] 真能搜到的占位示例被判红')

    # 搜索探针：键表只有结构词 ⇒ 用户问的词必须搜不到，判据要报
    got = [c for c, _ in check_search_probes(
        search_page('例如：抽屉', {'button': 'button badge btn--ghost aria-sort'}))]
    if 'SEARCH-3' not in got:
        bad += 1
        print('  [FAIL] 键表只有结构词时，搜索探针没报：%s' % got)

    # 反向控制：探针词都在键表里时不许报
    if check_search_probes(search_page('例如：抽屉', {'x': ' '.join(SEARCH_PROBES)})):
        bad += 1
        print('  [FAIL] 探针词齐全的键表被判红')
    got = [c for c, _ in check_search_examples(search_page('例如：抽屉', {}))]
    if 'SEARCH-1' not in got:
        bad += 1
        print('  [FAIL] 空键表没被判红：%s' % got)

    # 覆盖：缺页 / 多页
    got = [c for c, _ in check_coverage({'guide/index.html', 'guide/a.html'}, ['a', 'b'])]
    if 'COVER-1' not in got:
        bad += 1
        print('  [FAIL] 缺页没被判红：%s' % got)
    got = [c for c, _ in check_coverage(
        {'guide/index.html', 'guide/a.html', 'guide/zzz.html'}, ['a'])]
    if 'COVER-3' not in got:
        bad += 1
        print('  [FAIL] 多出来的页面没被判红：%s' % got)

    # 新鲜度：三种不新鲜都要判红
    tmp = tempfile.mkdtemp(prefix='docs-gate-')
    try:
        os.makedirs(os.path.join(tmp, 'guide'))
        with io.open(os.path.join(tmp, 'index.html'), 'w', encoding='utf-8', newline='\n') as f:
            f.write('old')
        miss, extra, diff = check_fresh({'index.html': 'new', 'guide/a.html': 'x'}, tmp)
        if not (miss == ['guide/a.html'] and diff == ['index.html']):
            bad += 1
            print('  [FAIL] 新鲜度判据没分辨出「缺页」与「内容不同」：%s %s'
                  % (miss, diff))
        with io.open(os.path.join(tmp, 'guide', 'stale.html'), 'w', encoding='utf-8',
                     newline='\n') as f:
            f.write('x')
        _m, extra, _d = check_fresh({'index.html': 'old'}, tmp)
        if extra != ['guide/stale.html']:
            bad += 1
            print('  [FAIL] 新鲜度判据没发现多出来的页面：%s' % extra)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # 内容守恒：README 两块代码、页面一块 ⇒ 必须报
    md_two = '## a\n\n\x60\x60\x60html\n<b>x</b>\n\x60\x60\x60\n\n\x60\x60\x60css\na{}\n\x60\x60\x60\n'
    pg_one = ('<html lang="zh-CN"><head><title>t</title></head><body>'
              '<main id="main"><h1>x</h1><h2>a</h2>'
              '<pre class="code"><code>&lt;b&gt;x&lt;/b&gt;</code></pre>'
              '</main></body></html>')
    fake = [{'id': 'x'}]
    got = [c for c, _ in check_parity(fake, lambda _i: md_two, {'guide/x.html': pg_one})]
    if 'PARITY-1' not in got:
        bad += 1
        print('  [FAIL] README 丢了一个代码块没被判红：%s' % got)

    # 反向控制：块数一致时不许报
    pg_two = pg_one.replace('</main>',
                            '<pre class="code"><code>a{}</code></pre></main>')
    if check_parity(fake, lambda _i: md_two, {'guide/x.html': pg_two}):
        bad += 1
        print('  [FAIL] 数量一致的样本被判红')

    # 容器里的围栏也要算数：列表项/引用块里的代码块，README 侧必须数到
    md_wrapped = ('## a\n\n- 说明：\n\n  \x60\x60\x60html\n  <i>y</i>\n  \x60\x60\x60\n\n'
                  '> \x60\x60\x60css\n> b{}\n> \x60\x60\x60\n')
    if md_counts(md_wrapped)['fence'] != 2:
        bad += 1
        print('  [FAIL] 缩进/引用里的围栏没被数到：%s' % md_counts(md_wrapped))

    # 404 页：相对路径必须报（错路径下会二次 404，整页裸奔）
    got = [c for c, _ in check_404_paths(
        '<link rel="stylesheet" href="01-tokens/tokens.css">', '/frontend-lib/')]
    if '404-1' not in got:
        bad += 1
        print('  [FAIL] 404 页用相对路径没被判红：%s' % got)

    # 反向控制：全绝对路径不许报
    if check_404_paths('<link href="/frontend-lib/a.css"><a href="#x">y</a>',
                       '/frontend-lib/'):
        bad += 1
        print('  [FAIL] 全绝对路径的 404 页被判红')

    # 推不出站点前缀时必须报（否则绝对路径无处可落）
    if not check_404_paths('<a href="/a">x</a>', '/'):
        bad += 1
        print('  [FAIL] 站点前缀缺失没被判红')

    if bad == 0:
        # 🔴 这里**不写条数**。原来写的是「自检 16 条通过」，而实际断言
        #    早就不止 16 条 —— 一个没人能核对的数字，早晚会变成假的。
        #    证据是这一行本身：`--selftest` 一跑就是全部通过/不通过。
        print('  自检全部通过（好样本绿 / 坏样本红且理由非空）')
    return bad


# ===========================================================================
# 主流程
# ===========================================================================

def main():
    if '--selftest' in sys.argv:
        return 1 if selftest() else 0

    gen = load_gen()
    files, comps, conf = gen.build(ROOT)
    comp_ids = [c['id'] for c in comps]
    SITE_BASE = gen.site_base()

    errs = []

    # [1] 新鲜
    missing, extra, diff = check_fresh(files, ROOT)
    for m in missing:
        errs.append(('[1] %s 不存在 —— 加了页面却没重跑 gen-docs.py' % m))
    for e in extra:
        errs.append(('[1] %s 是残留页面（生成器里已经没有它）' % e))
    for d in diff:
        errs.append(('[1] %s 与现算结果不一致 —— 改了 README 或生成器却没重跑' % d))

    # [2] 覆盖
    errs += ['[2] ' + m for _c, m in check_coverage(files, comp_ids)]

    # [3][4][5] 逐页
    tracked = set()
    for base, dirs, names in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules', 'internal')]
        for n in names:
            tracked.add(os.path.relpath(os.path.join(base, n), ROOT).replace('\\', '/'))

    def exists(rel):
        if rel in tracked:
            return True
        p = os.path.join(ROOT, rel)
        return os.path.isdir(p)

    for rel in sorted(files):
        if not rel.endswith('.html'):
            continue          # guide.css 之类不是页面，a11y 判据不适用
        errs += ['[3/4/5] ' + m
                 for _c, m in check_page(rel, files[rel], exists, base=SITE_BASE)]

    # [6] 内部词（复用同一份词表）
    pat = terms.process_trace_pat()
    for rel in sorted(files):
        for i, line in enumerate(files[rel].splitlines(), 1):
            m = pat.search(line)
            if m:
                errs.append('[6] %s:%d 命中内部词 %r' % (rel, i, m.group(0)))

    # [7] 索引行摘要
    errs += ['[7] ' + m for _c, m in check_index_rows(files['guide/index.html'])]

    # [8] 搜索框的占位示例必须真搜得到
    errs += ['[8] ' + m for _c, m in check_search_examples(files['guide/index.html'])]

    # [8b] 用户真会问的词必须搜得到
    errs += ['[8b] ' + m for _c, m in check_search_probes(files['guide/index.html'])]

    # [10] 404 页只许用绝对路径（它要在任意错路径下都能加载样式）
    errs += ['[10] ' + m for _c, m in
             check_404_paths(files.get('404.html', ''), SITE_BASE)]

    # [9] 内容守恒：README 里有的块，页面上一块都不能少
    def readme_text(cid):
        c = next((x for x in comps if x['id'] == cid), None)
        if not c:
            return None
        p = os.path.join(ROOT, os.path.dirname(c['files']['css']), 'README.md')
        if not os.path.isfile(p):
            return None
        with io.open(p, encoding='utf-8') as f:
            return f.read()

    errs += ['[9] ' + m for _c, m in check_parity(comps, readme_text, files)]

    # 视野声明：扫到 0 页不许通过
    n_pages = len([f for f in files if f.startswith('guide/')])
    if n_pages < 2:
        errs.append('[0] 只生成了 %d 个页面 —— 视野已空，不许通过' % n_pages)

    if errs:
        for e in errs[:20]:
            print('  [FAIL] %s' % e)
        if len(errs) > 20:
            print('  [FAIL] …另有 %d 条' % (len(errs) - 20))
        print('  ⇒ 改完 README 或生成器后跑：python3 05-audit/gen-docs.py')
        return 1

    print('  [OK] %d 页（%d 组件 + 索引）· 摘要 %d 行 · 链接全部落地'
          % (n_pages, len(comp_ids),
             len(re.findall(r'class="g-item__desc"', files['guide/index.html']))))
    return 0


if __name__ == '__main__':
    sys.exit(main())
