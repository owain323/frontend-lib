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

def check_page(path, html, exists):
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
        base = os.path.dirname(path)
        full = os.path.normpath(os.path.join(base, target)).replace('\\', '/')
        if full.startswith('..'):
            errs.append(('LINK', '%s：链接 %s 跑到仓库外' % (path, u)))
            continue
        if not exists(full):
            errs.append(('LINK', '%s：链接 %s 指向不存在的 %s ⇒ 点开 404'
                         % (path, u, full)))
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


def check_fresh(files, out_root):
    """磁盘 vs 现算。返回 (缺, 多, 异)。"""
    missing, extra, diff = [], [], []
    disk = set()
    for base, _dirs, names in os.walk(out_root):
        for n in names:
            p = os.path.join(base, n)
            rel = os.path.relpath(p, out_root).replace('\\', '/')
            if rel.startswith('guide/') or rel == 'index.html':
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

    if bad == 0:
        print('  自检 16 条通过（好样本绿 / 坏样本红且理由非空）')
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
        errs += ['[3/4/5] ' + m for _c, m in check_page(rel, files[rel], exists)]

    # [6] 内部词（复用同一份词表）
    pat = terms.process_trace_pat()
    for rel in sorted(files):
        for i, line in enumerate(files[rel].splitlines(), 1):
            m = pat.search(line)
            if m:
                errs.append('[6] %s:%d 命中内部词 %r' % (rel, i, m.group(0)))

    # [7] 索引行摘要
    errs += ['[7] ' + m for _c, m in check_index_rows(files['guide/index.html'])]

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
