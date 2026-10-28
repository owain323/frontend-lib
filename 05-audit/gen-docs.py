#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen-docs.py —— 从真值生成演示索引页与组件文档站

===========================================================================
为什么要有它
--------------------------------------------------------------------------
根 `index.html` 此前是**手写**的。手写索引的病不是"写错一次"，而是
**它不会因为新增组件而变红**：0.11.x 期间 `reveal` / `analysis-report` /
`detail-page` / `longform` / `data-showcase` / `scientific-plot` 六个页面
早就存在，索引里一个都没有，而 177 道门禁全绿 —— 因为没有任何一道
判据问过"索引覆盖了几页"。

同样的道理适用于文档：35 个组件的 README 散在各目录，站上既没有索引
也没有搜索，只有 clone 下来的人才能读。

⇒ 索引与文档页都改成**生成**，真值只有两处：
     · `ai/components.json`  —— 有哪些组件、哪个档、成熟度（权威）
     · 各组件 `README.md`    —— 内容（唯一撰写源）

===========================================================================
判据（由 docs-site-gate.py 核，不在本文件里自证）
--------------------------------------------------------------------------
  ① 生成是**确定性**的：同样的输入跑两遍，字节相同（不带时间戳/随机数）
  ② 落盘产物与现算产物**逐字节相同**（改了 README 忘了重跑 ⇒ 红）
  ③ 每个组件一页；每页的 h1 等于 README 的 h1
  ④ 页面里的相对链接必须指向仓库里真实存在的文件（不产生 404）

用法：
    python3 05-audit/gen-docs.py            # 生成（就地覆盖）
    python3 05-audit/gen-docs.py --out DIR  # 生成到别处（门禁用来比对）
"""
import io
import json
import os
import re
import shutil
import sys
from urllib.parse import quote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 顶层目录 → (展示名, 说明)。顺序即站点顺序：先基础件，后组合件。
TIERS = [
    ('02-primitives', 'primitive', '基础组件', '单一控件。拷一段 CSS 就能用。'),
    ('03-patterns', 'pattern', '模式', '由多个控件组成的一种交互，通常带行为脚本。'),
    ('04-recipes', 'recipe', '版式模板', '一整页的排版约定，给"有结论、有数据"的材料用。'),
    ('09-assets', 'asset', '图表与资源', '数据可视化与可选的第三方适配层。'),
]
TIER_BY_DIR = dict((d, (slug, label, desc)) for d, slug, label, desc in TIERS)

# 不是组件、但有可点开的页面。单独列，且**不计入组件总数** ——
# 组件总数只有 `ai/components.json` 一个来源（doc-facts 门禁也核这一条）。
EXTRA_PAGES = [
    ('04-recipes/data-showcase', '能力对照页', '把同一批数据用不同图表与版式各画一遍，横向看差别。'),
    ('04-recipes/longform', '长文阅读页', '精简档的长文版式：目录、行宽、脚注、引用。'),
]

# 只在站点上列、**不随 npm 包发布**的页面。包内索引不能链它们
# （pack-closure 会把这种链接判成"装完必然 404"）。
SITE_ONLY = [
    ('10-review/ios/index.html', 'iOS 真机验证页', '十项，每项写了「该看到什么」，Safari 专用。'),
    ('10-review/composition/demo.html', '组合页', '把多个模式拼在同一页，看它们互相干扰。'),
    ('examples/react-vite/index.html', 'React + Vite 示例', '在框架里引本库的最小工程。'),
]

SKIP_LINK_SCHEMES = ('http://', 'https://', 'mailto:', '#', 'data:')

# 跨组件的**约定页**：源文件是 markdown（随 npm 包一起发），生成到 guide/<slug>.html。
#
# 🔴 为什么需要这一类（2026-10-29）
#   令牌怎么用、焦点环多大、动效多久、暗色怎么切、能不能写 margin-left ——
#   这些规则**不属于任何组件**，所以原来的生成器（只认组件目录）没有地方放它们。
#   症状不是"少一页"，是搜索里搜「减少动效」命中 0 项：用户问的是意思，
#   而全站没有一个页面承载那个意思。补搜索词只是止痛，页面才是器官。
#
#   为什么源文件放 `docs/`：那三个 .md 本来就在 `files` 白名单里（随包发），
#   使用者 `npm i` 之后能直接读到原文；`guide/` 不在白名单，只活在文档站上。
CONCEPT_PAGES = [
    ('conventions', '全局约定',
     '令牌三层、间距台阶、焦点环、动效时长、暗色三态、逻辑属性、'
     '能不能用 @layer 与 !important',
     'docs/CONVENTIONS.md'),
    ('accessibility', '无障碍',
     '目标等级、验过的范围与手段、已知缺口、自测命令',
     'docs/ACCESSIBILITY.md'),
]


# ===========================================================================
# 一 · Markdown 子集 → HTML
#     只支持本仓库实际用到的语法。用到的都支持，没用到的不假装支持 ——
#     假装支持的后果是"渲染出来看着像对的"，比报错更难发现。
#     实测用量（37 份 README / 4082 行）：表格 714 行、h2 259、列表 177、
#     分隔线 86、引用 49、有序表 44、h3 54、强调 7。
# ===========================================================================

def esc(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
             .replace('"', '&quot;'))


CJK = re.compile(u'[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]')
CODE_SPAN = re.compile(r'(`+)(.+?)\1', re.S)
AUTOLINK = re.compile(r'<(https?://[^>\s]+)>')


def _join_lines(lines):
    """把折行段落接回去。

    🔴 直接 `' '.join` 会在中文里塞进空格：本仓库 README 是手工折行的，
       折点常常落在句子中间 ⇒ 「同一份内容 在三种不同目的」这种空格
       满页都是。中文与中文之间不加空格，其余情况按 Markdown 规则加。
    """
    out = ''
    for ln in lines:
        ln = ln.strip()
        if not ln:
            continue
        if not out:
            out = ln
        elif CJK.match(out[-1]) and CJK.match(ln[0]):
            out += ln
        else:
            out += ' ' + ln
    return out


def inline(text, resolve_link=None):
    """行内：代码 > 自动链接 > 转义 > 图片 > 链接 > 强调。

    顺序有讲究：代码片段必须先摘出来，否则 `**` 和 `[]()` 会把
    代码里的字当成语法（本仓库 README 里到处是 `aria-*` 与 `[data-x]`）。
    """
    stash = []

    def hold(html):
        stash.append(html)
        return '\x00%d\x00' % (len(stash) - 1)

    def code_sub(m):
        return hold('<code>%s</code>' % esc(m.group(2)))

    def auto_sub(m):
        u = m.group(1)
        return hold('<a href="%s">%s</a>' % (esc(u), esc(u)))

    s = CODE_SPAN.sub(code_sub, text)
    s = AUTOLINK.sub(auto_sub, s)
    s = esc(s)

    def img_sub(m):
        alt, src = m.group(1), m.group(2)
        if resolve_link:
            src = resolve_link(src)
        return hold('<img src="%s" alt="%s" loading="lazy" decoding="async">'
                    % (esc(src), alt))

    def link_sub(m):
        label, href = m.group(1), m.group(2)
        if resolve_link:
            href = resolve_link(href)
        return hold('<a href="%s">%s</a>' % (esc(href), label))

    s = re.sub(r'!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)', img_sub, s)
    s = re.sub(r'\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)', link_sub, s)
    s = re.sub(r'\*\*(?=\S)(.+?)(?<=\S)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'~~(?=\S)(.+?)(?<=\S)~~', r'<del>\1</del>', s)
    s = re.sub(r'(?<![\*\w])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\*\w])', r'<em>\1</em>', s)

    while '\x00' in s:
        s = re.sub('\x00(\\d+)\x00', lambda m: stash[int(m.group(1))], s)
    return s


def split_row(line):
    """按 `|` 切表格行，**但跳过反引号里的 `|`**。

    实测本仓库有 `| `.badge` | 可点 |` 这类行，反引号里出现过 `|`
    （`aria-sort="ascending|descending"`），朴素 split 会把一格切成两格，
    整张表从此错位一格 —— 而且看着"像"是对的。
    """
    cells, cur, in_code = [], '', False
    i = 0
    while i < len(line):
        c = line[i]
        if c == '`':
            in_code = not in_code
            cur += c
        elif c == '|' and not in_code:
            cells.append(cur)
            cur = ''
        elif c == '\\' and i + 1 < len(line) and line[i + 1] == '|':
            cur += '|'
            i += 1
        else:
            cur += c
        i += 1
    cells.append(cur)
    if cells and not cells[0].strip():
        cells = cells[1:]
    if cells and not cells[-1].strip():
        cells = cells[:-1]
    return [c.strip() for c in cells]


SEP_ROW = re.compile(r'^\s*\|?[\s:\-|]+\|[\s:\-|]*$')


def is_sep_row(line):
    if not SEP_ROW.match(line):
        return False
    return '-' in line and line.count('|') >= 2 or (line.strip().startswith('|') and '---' in line)


def render_table(rows, resolve_link):
    head, aligns = rows[0], []
    for cell in rows[1]:
        c = cell.strip()
        if c.endswith(':') and c.startswith(':'):
            aligns.append('center')
        elif c.endswith(':'):
            aligns.append('right')
        else:
            aligns.append('left')
    body = rows[2:]

    def cell(tag, text, idx):
        al = aligns[idx] if idx < len(aligns) else 'left'
        cls = ' class="ta-%s"' % al if al != 'left' else ''
        return '<%s%s>%s</%s>' % (tag, cls, inline(text, resolve_link), tag)

    out = ['<div class="table"><table>', '<thead><tr>']
    out.append(''.join(cell('th', c, i) for i, c in enumerate(head)))
    out.append('</tr></thead>')
    if body:
        out.append('<tbody>')
        for r in body:
            r = (r + [''] * len(head))[:len(head)]
            out.append('<tr>' + ''.join(cell('td', c, i) for i, c in enumerate(r)) + '</tr>')
        out.append('</tbody>')
    out.append('</table></div>')
    return '\n'.join(out)


HEAD_RE = re.compile(r'^(#{1,6})\s+(.*)$')
UL_RE = re.compile(r'^[-*]\s+(.*)$')
OL_RE = re.compile(r'^(\d+)[.)]\s+(.*)$')
HR_RE = re.compile(r'^(?:-{3,}|\*{3,}|_{3,})\s*$')
FENCE_RE = re.compile(r'^```(\w*)\s*$')


# 容器内（引用块 / 列表项）把多行合并成一段时用的分隔符：
#   逐行 inline 会把跨行的 `**加粗**` 切成两半，最后再换回 <br>。
_SENT = '\u241e'


def split_fenced(rows):
    """把容器里收集到的行拆成 [('t', 文本), ('c', 代码)] 序列。

    容器里的围栏必须当块级处理。旧实现把收集到的所有行用哨兵连成一行
    再 inline，于是 ```html 被当成"三个空的行内代码片段"吃掉，
    里面的内容要么整块消失、要么降级成一片行内代码色文字。
    """
    seq, buf = [], []
    i, n = 0, len(rows)
    while i < n:
        if FENCE_RE.match(rows[i].strip()):
            if buf:
                seq.append(('t', buf))
                buf = []
            i += 1
            body = []
            while i < n and not rows[i].strip().startswith('```'):
                body.append(rows[i])
                i += 1
            i += 1                      # 闭合行；缺了也照收，数量不符由判据报
            seq.append(('c', '\n'.join(body)))
        else:
            buf.append(rows[i])
            i += 1
    if buf:
        seq.append(('t', buf))
    return seq


def emit_container(rows, resolve_link, wrap_single=False, br=False):
    """容器内产出：文本段 → 段落，代码段 → 代码块。

    ``br`` 决定折行怎么接：引用块保留逐行（`<br>`），列表项走
    `_join_lines` 接成一段 —— 中英之间要不要空格由它判断，
    直接 join 会在中文里塞满空格。
    """
    def text_of(chunk):
        if br:
            return inline(_SENT.join(x.strip() for x in chunk if x.strip()),
                          resolve_link).replace(_SENT, '<br>')
        return inline(_join_lines(chunk), resolve_link)

    seq = split_fenced(rows)
    if len(seq) == 1 and seq[0][0] == 't':
        body = text_of(seq[0][1])
        return '<p>%s</p>' % body if wrap_single else body
    parts = []
    for kind, body in seq:
        if kind == 'c':
            parts.append('<pre class="code" tabindex="0"><code>%s</code></pre>'
                         % esc(body))
        else:
            parts.append('<p>%s</p>' % text_of(body))
    return ''.join(parts)


def md_to_html(text, resolve_link=None, on_heading=None):
    """块级解析。返回 (html, headings)。

    h1 不在正文里输出 —— 页面模板已经有一个 h1（来自 README 第一行），
    正文再出一个就有两个一级标题，读屏的"跳到标题"会给出两个同名项。
    """
    lines = text.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    out, heads = [], []
    i, n = 0, len(lines)
    sec = [0]

    def emit_heading(level, raw):
        sec[0] += 1
        hid = 's%d' % sec[0]
        txt = inline(raw, resolve_link)
        if on_heading and level >= 2:
            on_heading(level, re.sub(r'<[^>]+>', '', txt), hid)
        if level == 1:
            return
        out.append('<h%d id="%s">%s<a class="anchor" href="#%s" '
                   'aria-label="本节直链">#</a></h%d>'
                   % (level, hid, txt, hid, level))

    while i < n:
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        m = FENCE_RE.match(stripped)
        if m:
            lang = m.group(1)
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith('```'):
                buf.append(lines[i])
                i += 1
            i += 1
            cls = ' class="language-%s"' % esc(lang) if lang else ''
            out.append('<pre class="code" tabindex="0"><code%s>%s</code></pre>'
                       % (cls, esc('\n'.join(buf))))
            continue

        m = HEAD_RE.match(stripped)
        if m:
            emit_heading(len(m.group(1)), m.group(2).strip())
            i += 1
            continue

        if HR_RE.match(stripped):
            out.append('<hr>')
            i += 1
            continue

        if stripped.startswith('|') and i + 1 < n and is_sep_row(lines[i + 1].strip()):
            # rows[0] = 表头，rows[1] = 对齐行（`|---:|`），其余是表体
            rows = [split_row(stripped), split_row(lines[i + 1].strip())]
            i += 2
            while i < n and lines[i].strip().startswith('|'):
                rows.append(split_row(lines[i].strip()))
                i += 1
            out.append(render_table(rows, resolve_link))
            continue

        if stripped.startswith('>'):
            buf = []
            while i < n and lines[i].strip().startswith('>'):
                raw = lines[i].strip()[1:]
                buf.append(raw[1:] if raw.startswith(' ') else raw)
                i += 1
            out.append('<blockquote>%s</blockquote>'
                       % emit_container(buf, resolve_link, wrap_single=True, br=True))
            continue

        m = UL_RE.match(stripped)
        if m:
            items = []                  # 每项是一组行（含续行，可能含围栏）
            while i < n:
                cur = lines[i]
                mm = UL_RE.match(cur.strip())
                if mm:
                    items.append([mm.group(1).strip()])
                    i += 1
                elif cur.strip() and cur.startswith(('  ', '\t')):
                    items[-1].append(cur)
                    i += 1
                else:
                    break
            out.append('<ul>' + ''.join('<li>%s</li>' % emit_container(t, resolve_link)
                                        for t in items) + '</ul>')
            continue

        m = OL_RE.match(stripped)
        if m:
            items = []
            while i < n:
                cur = lines[i]
                mm = OL_RE.match(cur.strip())
                if mm:
                    items.append([mm.group(2).strip()])
                    i += 1
                elif cur.strip() and cur.startswith(('  ', '\t')) and items:
                    items[-1].append(cur)
                    i += 1
                else:
                    break
            out.append('<ol>' + ''.join('<li>%s</li>' % emit_container(t, resolve_link)
                                        for t in items) + '</ol>')
            continue

        buf = []
        while i < n:
            cur = lines[i]
            if not cur.strip():
                break
            if (FENCE_RE.match(cur.strip()) or HEAD_RE.match(cur.strip())
                    or HR_RE.match(cur.strip()) or UL_RE.match(cur.strip())
                    or OL_RE.match(cur.strip()) or cur.strip().startswith('|')
                    or cur.strip().startswith('>')):
                break
            buf.append(cur)
            i += 1
        if buf:
            out.append('<p>%s</p>' % inline(_join_lines(buf), resolve_link))
        else:
            i += 1

    return '\n'.join(out), heads


# ===========================================================================
# 二 · 真值装载
# ===========================================================================

def read(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def norm_rel(p):
    return os.path.normpath(p).replace('\\', '/')


def load_components():
    """组件清单：**只认 `ai/components.json`**，不从目录推。

    目录里比契约多出两个（`data-showcase` / `longform`）—— 它们是页面，
    不是组件。按目录推总数会得出 37，而文档里写的是 35：doc-facts 门禁
    核的是契约，两边一旦分叉就会出现"站点说 37、README 说 35"。
    """
    conf = json.loads(read(os.path.join(ROOT, 'ai', 'components.json')))
    comps = []
    for item in conf['components']:
        d = item['files'].get('css') or item['files'].get('js') or ''
        cdir = os.path.dirname(d) if d else ''
        if not cdir:
            for root, _slug, _label, _desc in TIERS:
                cand = os.path.join(root, item['id'])
                if os.path.isdir(os.path.join(ROOT, cand)):
                    cdir = cand
                    break
        comps.append({
            'id': item['id'],
            'dir': norm_rel(cdir),
            'tier': item['tier'],
            'maturity': item.get('maturity', 'stable'),
            'purpose': item.get('purpose', ''),
            'files': item.get('files', {}),
            'slots': item.get('slots') or [],
        })
    comps.sort(key=lambda c: (c['dir'], c['id']))
    return conf, comps


def readme_of(cdir):
    p = os.path.join(ROOT, cdir, 'README.md')
    return read(p) if os.path.isfile(p) else ''


def title_of(md, fallback):
    body = md.strip()
    if body:
        m = HEAD_RE.match(body.split('\n', 1)[0].strip())
        if m and len(m.group(1)) == 1:
            return m.group(2).strip()
    return fallback


def first_para(md):
    """README 第一段正文 —— 索引页给一句人话摘要用。

    不用 `purpose` 那句：那是契约里的机器可读描述，写的是"能力覆盖"，
    不是"这是什么、什么时候用"。索引页要的是后者。
    """
    lines = md.replace('\r\n', '\n').split('\n')
    i, buf, in_fence = 0, [], False
    while i < len(lines):
        s = lines[i].strip()
        if s.startswith('```'):
            in_fence = not in_fence
            i += 1
            continue
        if in_fence:
            i += 1
            continue
        if not s:
            if buf:
                break
            i += 1
            continue
        if s.startswith('#'):
            i += 1
            continue
        if HR_RE.match(s):
            if buf:
                break
            i += 1
            continue
        if s.startswith('|') or s.startswith('>') or s.startswith('<'):
            if buf:
                break
            i += 1
            continue
        buf.append(s)
        i += 1
    txt = _join_lines(buf)
    txt = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', txt)
    txt = txt.replace('**', '').replace('`', '')
    return txt


# ===========================================================================
# 三 · 链接重写
#     文档页在 `guide/`，README 在 `<组件目录>/`。原样照搬的话每一条
#     `../table/table.css` 都会 404 —— 而 404 在自己机器上看起来
#     和"能点"没有区别（要真点了才知道）。
# ===========================================================================

def make_resolver(cdir, page_ids):
    base = cdir

    def resolve(target):
        if not target or target.startswith(SKIP_LINK_SCHEMES):
            return target
        path, _, frag = target.partition('#')
        tail = ('#' + frag) if frag else ''
        if not path:
            return tail or '#'
        abs_repo = norm_rel(os.path.join(base, path))
        if abs_repo.endswith('README.md') and abs_repo[:-len('/README.md')] in page_ids:
            return page_ids[abs_repo[:-len('/README.md')]] + '.html' + tail
        if os.path.isdir(os.path.join(ROOT, abs_repo)):
            return '../' + abs_repo + '/' + tail
        return '../' + abs_repo + tail

    return resolve


# ===========================================================================
# 四 · 页面模板
# ===========================================================================

# 站点图标：**内联成 data URI**，不落一个 favicon.svg 文件。
#   ① 不落文件 ⇒ 不用动 `package.json` 的 files 白名单（多一个根文件就多一条
#     pack-closure 关系，而根 `index.html` 是随包发出去的）；
#   ② 不落文件 ⇒ 不用动 repo-hygiene 的根目录白名单；
#   ③ 没有 <link rel="icon"> 时，浏览器会去要 /favicon.ico —— 线上实测
#     每个页面都吃一个 404。给了就没这个请求。
#   ⚠️ 整段百分号编码：属性值里留裸 `<` 会让"标签配平"这类按 `<` 扫的判据
#      把图标当成真的 SVG 元素。
FAVICON_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
    '<rect width="32" height="32" rx="7" fill="#1b4d8f"/>'
    '<rect x="8" y="8" width="7" height="7" rx="1.6" fill="#fff"/>'
    '<rect x="17" y="8" width="7" height="7" rx="1.6" fill="#fff" opacity=".5"/>'
    '<rect x="8" y="17" width="7" height="7" rx="1.6" fill="#fff" opacity=".5"/>'
    '<rect x="17" y="17" width="7" height="7" rx="1.6" fill="#fff"/>'
    '</svg>')
FAVICON = 'data:image/svg+xml,' + quote(FAVICON_SVG, safe='')

HEAD_TPL = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>%(title)s</title>
<meta name="description" content="%(desc)s">
<link rel="icon" href="%(fav)s">
<link rel="stylesheet" href="%(up)s01-tokens/tokens.css">
<link rel="stylesheet" href="%(up)s01-tokens/typography.css">
<link rel="stylesheet" href="%(up)s01-tokens/page.css">
<link rel="stylesheet" href="%(up)s03-patterns/nav/nav.css">
<link rel="stylesheet" href="%(up)s04-recipes/table/table.css">
<link rel="stylesheet" href="guide.css">
<link rel="icon" href="data:,">
</head>
'''

TOP_TPL = '''<a href="#main" class="skip">跳到主内容</a>
<header class="g-top">
  <div class="g-top__in">
    <a class="g-brand" href="index.html">agentcss</a>
    <span class="g-sep" aria-hidden="true">/</span>
    <span class="g-where">%(where)s</span>
    <a class="g-jump" href="%(demo_href)s">%(jump)s<span aria-hidden="true"> →</span></a>
  </div>
</header>
'''

FOOT_TPL = '''<footer class="g-foot">
  <p>%(ver)s · 零第三方运行时依赖 · 组件数 %(n)d</p>
</footer>
'''

COMP_PAGE = HEAD_TPL + '''<body class="page">
''' + TOP_TPL + '''<div class="g-layout">
  <main id="main" class="g-main">
    <p class="g-kicker">%(tier)s · %(maturity)s</p>
    <h1>%(h1)s</h1>
    <p class="lede">%(purpose)s</p>
    <ul class="g-meta">%(meta)s</ul>
%(live)s
    <article class="g-doc">
%(body)s
    </article>
    <nav class="g-pager" aria-label="上一页 / 下一页">
      %(prev)s
      %(next)s
    </nav>
  </main>
  <aside class="g-side">
    <p class="g-side__title" id="toc-title">本页目录</p>
    %(toc)s
  </aside>
</div>
''' + FOOT_TPL + '''</body>
</html>
'''

CONCEPT_PAGE = HEAD_TPL + '''<body class="page">
''' + TOP_TPL + '''<div class="g-layout">
  <main id="main" class="g-main">
    <p class="g-kicker">%(kicker)s</p>
    <h1>%(h1)s</h1>
    <p class="lede">%(purpose)s</p>
    <ul class="g-meta">%(meta)s</ul>
    <article class="g-doc">
%(body)s
    </article>
    <nav class="g-pager" aria-label="上一页 / 下一页">
      %(prev)s
      %(next)s
    </nav>
  </main>
  <aside class="g-side">
    <p class="g-side__title" id="toc-title">本页目录</p>
    %(toc)s
  </aside>
</div>
''' + FOOT_TPL + '''</body>
</html>
'''

INDEX_PAGE = HEAD_TPL + '''<body class="page g-index">
''' + TOP_TPL + '''<div class="g-layout g-layout--index">
  <main id="main" class="g-main">
    <h1>组件文档</h1>
    <p class="lede">%(n)d 个组件，按「基础件 → 模式 → 版式模板 → 图表」排列。
      每一项都能点开示例，样式与行为脚本可以整段复制走。</p>
    <p class="lede lede--note">组件之间没有 CSS 依赖：任意一个组件的样式表只用到
      <code>01-tokens</code> 的令牌，不会 <code>@import</code> 别的组件。
      只要 <code>tokens.css</code> + 这一个文件；行为脚本按需再加。</p>

    <div class="g-search">
      <label class="g-search__label" for="q">搜索组件、状态、选择器</label>
      <input class="g-search__input" id="q" type="search" autocomplete="off"
             spellcheck="false" placeholder="例如：抽屉 / 表格 / btn--ghost" aria-describedby="hits">
      <p class="g-search__hint" id="hits" aria-live="polite">共 %(n)d 项</p>
    </div>

%(sections)s

    <p class="g-empty" id="empty" hidden>没有匹配项。换个词试试。</p>
  </main>
</div>
''' + FOOT_TPL + '''<script type="application/json" id="kw">%(kws)s</script>
<script>
%(js)s
</script>
</body>
</html>
'''


def toc_html(heads):
    if not heads:
        return '<p class="g-side__none">（本节内容较短，无小标题）</p>'
    items = ''.join('<li><a href="#%s">%s</a></li>' % (h[1], h[0]) for h in heads)
    return '<ul class="g-toc">%s</ul>' % items


def file_links(c):
    out = []
    demo = c['files'].get('demo') or ''
    if demo:
        out.append('../' + demo)
    for key in ('css', 'js'):
        f = c['files'].get(key)
        if f:
            out.append('../' + f)
        for extra in (c['files'].get(key + 'Also') or []):
            out.append('../' + extra)
    return out


def live_block(c, h1):
    """页面顶部的**活标本**：把 demo 用 iframe 内嵌进来，并自动撑到内容高度。

    为什么是 iframe 而不是把 demo 的 HTML 抄进页面
    ------------------------------------------------------------------------
    考虑过三条路，只有这条能同时满足「35/35 覆盖」和「零漂移」：

      ① 从 demo 里抽 `.cell` 块内嵌 —— **只有 button / input 两页用了 `.cell`**，
         其余是按 `<h2>` 分节的自由排版；而且 37 个 demo 里有 55 个 <script>、
         179 个 id ⇒ 抄进页面会撞 id、丢行为。
      ② 把 README 里的 ```html 块渲染成标本 —— 只有 29/35 有，且**混着反例块**
         （"别这么写"的示例）。盲渲染等于把错误示范摆成正确示范，是欺骗。
      ③ iframe 内嵌 demo —— 35/35 都有 demo；demo 自己就是状态的矩阵
         （按钮七态、输入框八态…）；样式互不污染；脚本与键盘在里面**真能用**。

    取舍写清楚：iframe 里是**另一个文档**，`file://` 直接打开时浏览器不给跨文档
    访问 ⇒ 自动高度失效，退化为 CSS 里的固定高度并在内部滚动。
    部署在 http(s) 下没有这个问题。
    """
    demo = c['files'].get('demo')
    if not demo:
        return ''
    return (
        '<figure class="g-live">'
        '<figcaption class="g-live__cap">'
        '<span class="g-live__tag">在这页里直接跑</span>'
        '下面是 %(name)s 的真实示例页，全套状态都在里面；'
        '<a href="../%(demo)s">单独打开</a>可以看到完整尺寸。'
        '</figcaption>'
        '<iframe class="g-live__frame" src="../%(demo)s" '
        'title="%(name)s 的可运行示例" loading="lazy"></iframe>'
        '</figure>'
        '<script src="live.js" defer></script>'
        % {'name': esc(h1), 'demo': demo}
    )


def render_component(c, page_ids, ver, n_total, prev_c, next_c):
    md = readme_of(c['dir'])
    heads = []

    def grab(level, text, hid):
        if level == 2:
            heads.append((re.sub(r'<[^>]+>', '', text), hid))

    body, _ = md_to_html(md, make_resolver(c['dir'], page_ids), on_heading=grab)
    h1 = title_of(md, c['id'])
    tier = TIER_BY_DIR.get(c['dir'].split('/')[0], ('', '', ''))
    meta = ''.join('<li><a href="%s"><code>%s</code></a></li>' % (esc(u), esc(u[3:]))
                   for u in file_links(c))
    if not meta:
        meta = '<li>仅文档</li>'

    prev = ''
    if prev_c:
        prev = ('<a class="g-pager__link g-pager__link--prev" href="%s.html">'
                '<span>上一页</span>%s</a>'
                % (prev_c['id'], esc(title_of(readme_of(prev_c['dir']), prev_c['id']))))
    nxt = ''
    if next_c:
        nxt = ('<a class="g-pager__link g-pager__link--next" href="%s.html">'
               '<span>下一页</span>%s</a>'
               % (next_c['id'], esc(title_of(readme_of(next_c['dir']), next_c['id']))))

    return COMP_PAGE % {
        'fav': FAVICON,
        'title': esc(h1) + ' · agentcss',
        'desc': esc(c['purpose']),
        'up': '../',
        'where': esc(h1),
        'demo_href': ('../' + c['files']['demo']) if c['files'].get('demo') else 'index.html',
        'jump': '打开示例',
        'ver': 'v' + ver,
        'n': n_total,
        'tier': esc(tier[1]),
        'maturity': esc(c['maturity']),
        'h1': esc(h1),
        'purpose': esc(c['purpose']),
        'meta': meta,
        'live': live_block(c, h1),
        'body': body,
        'prev': prev,
        'next': nxt,
        'toc': toc_html(heads),
    }


def make_concept_resolver():
    """概念页的链接解析：`docs/*.md` 之间的互链要指向**生成后的页面**。

    为什么不能复用 `make_resolver`：它只认「`X/README.md` → `x.html`」这一种映射
    （组件页的规矩）。概念页的源文件是 `docs/CONVENTIONS.md`，写成
    `[全局约定](CONVENTIONS.md)` 时，通用解析器会给出 `../docs/CONVENTIONS.md`
    —— 那是一个 `.md` 文件，点开是源码，不是页面。读者在站点里被送去读源码，
    是"文档站少了一页"的另一种表现。
    """
    ids = set(s for s, _l, _d, _m in CONCEPT_PAGES)

    def resolve(target):
        if not target or target.startswith(SKIP_LINK_SCHEMES):
            return target
        path, _, frag = target.partition('#')
        tail = ('#' + frag) if frag else ''
        if not path:
            return tail or '#'
        stem = path.rsplit('/', 1)[-1]
        if stem.endswith('.md') and stem[:-3] in ids:
            return stem[:-3] + '.html' + tail
        abs_repo = norm_rel(os.path.join('docs', path))
        if os.path.isdir(os.path.join(ROOT, abs_repo)):
            return '../' + abs_repo + '/' + tail
        return '../' + abs_repo + tail

    return resolve


def render_concept(slug, label, desc, rel_md, ver, n_total, prev_c, next_c):
    md = read(rel_md)
    heads = []

    def grab(level, text, hid):
        if level == 2:
            heads.append((re.sub(r'<[^>]+>', '', text), hid))

    body, _ = md_to_html(md, make_concept_resolver(), on_heading=grab)
    h1 = title_of(md, label)

    def pager(kind, target):
        if not target:
            return ''
        cls = 'g-pager__link g-pager__link--' + kind
        word = '上一页' if kind == 'prev' else '下一页'
        return ('<a class="%s" href="%s.html"><span>%s</span>%s</a>'
                % (cls, target[0], word, esc(target[1])))

    return CONCEPT_PAGE % {
        'fav': FAVICON,
        'title': esc(h1) + ' · agentcss',
        'desc': esc(desc),
        'up': '../',
        'where': esc(label),
        'demo_href': 'index.html',
        'jump': '回到索引',
        'ver': 'v' + ver,
        'n': n_total,
        'kicker': '全局约定 · 跨组件',
        'h1': esc(h1),
        'purpose': esc(desc),
        'meta': ('<li><a href="../%s"><code>%s</code></a></li>'
                 '<li>规则由 <code>01-tokens/</code> 实现，判据见文末对应表</li>'
                 % (esc(rel_md), esc(rel_md))),
        'body': body,
        'prev': pager('prev', prev_c),
        'next': pager('next', next_c),
        'toc': toc_html(heads),
    }


def render_concept_row(slug, label, desc, rel_md):
    """索引页里的一行。键表要含正文词 —— 搜「减少动效」「强制暗」是搜意思，不是搜目录名。"""
    md = read(rel_md)
    keys = ' '.join([slug, label, desc, ' '.join(code_tokens(md)),
                     ' '.join(headings_of(md)), prose_words(md)])
    html = ('<li class="g-item" data-id="%s">'
            '<a class="g-item__link" href="%s.html">'
            '<span class="g-item__name">%s</span>'
            '<span class="g-item__desc">%s</span></a></li>'
            % (esc(slug), esc(slug), esc(label), esc(desc)))
    return html, slug, keys.lower()


def render_row(c, page_ids):
    md = readme_of(c['dir'])
    title = title_of(md, c['id'])
    # 🔴 摘要用**契约里的 purpose**，不是 README 的第一段。
    #    实测第一版取第一段，结果 35 条里有 9 条不是"这是什么"：
    #    button 拿到的是「实测动机：某项目的按钮只有两态…」（一段复盘），
    #    card 拿到的是「.card__body 不是可选的」（一条实现细节），
    #    choice 拿到的是「1. 绝不 display:none…」（列表第一项）。
    #    README 的段落顺序服从"论证"，不服从"导览"——索引页要的是后者。
    summary = c['purpose'] or first_para(md)
    # 搜索键 = 名字 + 摘要 + 小标题 + **CSS 里真有的类名** + README 里的反引号片段。
    #   最常用的一种找法是"`.btn--ghost` 是哪个组件的？"。
    #   ⚠️ 类名**不能**只从 `ai/components.json` 的 `slots` 取：badge 的 slots
    #      是空数组，照它建索引等于把数据缺口变成搜索缺口（实测：搜
    #      `badge--solid-danger` 命中 0）。而 CSS 文件里就有全部类名 ——
    #      那才是"这个组件到底提供什么"的真值。
    keys = ' '.join([c['id'], title, summary,
                     ' '.join(c.get('slots') or []),
                     ' '.join(css_tokens(c)),
                     ' '.join(code_tokens(md)),
                     ' '.join(headings_of(md)),
                     prose_words(md)])
    demo = c['files'].get('demo') or ''
    demo_link = ('<a class="g-item__demo" href="../%s">示例</a>' % demo) if demo else ''
    # 🔴 搜索键**不放进 DOM 属性**：它会被读屏当正文念出来，也会被"按结构扫
    #    HTML"的判据当成真的在用那些属性。实测：写成 data-k="… data-accordion …"
    #    之后，wiring 判据报「用了 data-accordion 但没写 class」5 处，
    #    全部来自索引页 —— 而页面里根本没有 accordion。
    #    ⇒ 键放进 <script type="application/json">，元素只留 id。
    html = ('<li class="g-item" data-id="%s">'
            '<a class="g-item__link" href="%s.html">'
            '<span class="g-item__name">%s</span>'
            '<span class="g-item__desc">%s</span></a>%s</li>'
            % (c['id'], c['id'], esc(title), esc(summary), demo_link))
    return html, c['id'], keys.lower()


def code_tokens(md):
    """README 里出现的类名 / 属性名 —— 只给搜索用。

    实测动机：想在索引页找「`.badge--dot` 是哪个组件的」，
    只搜标题与小标题一个都命中不了。而契约里的 `slots` 并不完整
    （badge 的 slots 是空的），照它建索引等于把数据缺口变成搜索缺口。
    ⇒ 直接从 README 的反引号片段里挑"长得像类名/属性"的那些：
      带 `-`/`_` 的连接段，或以 `.` / `data-` / `aria-` 开头。
       这样 `aria-sort`、`focus-visible`、`.card--linked` 都能找到；
       普通英文词（`table`、`the`）不会被塞进索引。
    """
    out, seen = [], set()
    # 🔴 围栏代码块要按**行**剔除，不能用 `re.sub('```.*?```')`：
    #    后者靠配对，一个多余的围栏就让后面整段失配 ——
    #    实测 table/README 只抽出 6 个词（真实数量是几十个），
    #    而且它**有输出**，看起来完全正常。
    in_fence = False
    for line in md.split(chr(10)):
        s = line.strip()
        if s.startswith('```'):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        for span in re.findall(r'`([^`]{2,60})`', line):
            for tok in re.findall(r'[a-z][a-z0-9]*(?:[-_]{1,2}[a-z0-9]+)+', span.lower()):
                if tok in seen:
                    continue
                seen.add(tok)
                out.append(tok)
                if len(out) >= 120:
                    return out
    return out


def css_tokens(c):
    """组件 CSS 里**真的存在**的类名 —— 只给搜索用。

    实测动机：最常用的一种找法是「`.btn--ghost` 是哪个组件的？」。
    契约里的 `slots` 回答不了这个问题（badge 的 slots 是空数组），
    而 CSS 文件里就是全部类名，不必另造一份清单。

    只取形如 `.x` / `.x--y` / `.x__z` 的选择器片段；`@media` 里的
    `(min-width: …)` 之类不含 `.`，自然不会被抓进来。
    """
    css = (c.get('files') or {}).get('css')
    if not css:
        return []
    p = os.path.join(ROOT, css)
    if not os.path.isfile(p):
        return []
    out, seen = [], set()
    for tok in re.findall(r'\.(-?[a-z][a-z0-9_-]*)', read(p).lower()):
        # 纯数字/单位残片（`0.5rem` 会被切成 `5rem`）剔掉
        if tok in seen or tok[:1].isdigit():
            continue
        seen.add(tok)
        out.append(tok)
    return out[:80]


def prose_words(md):
    """正文散文里的词也进键表。

    在这之前键表只有类名、属性名、标题 —— 用户搜「禁用」「焦点环」
    「错误态」全是 0 命中，因为这几个词只出现在正文句子里。
    键表覆盖的是「结构词」，而人问的是「意思」。

    只留中文词组与英文词，去掉标点、数字、单字：
    正文 63KB → 词串 30KB 左右，换掉一半的搜不到。
    """
    out, infence = [], False
    for line in md.split('\n'):
        s = line.strip()
        if s.startswith('```'):
            infence = not infence
            continue
        if infence:
            continue
        out.append(s)
    text = ' '.join(out)
    words = re.findall(r'[\u4e00-\u9fff]{2,}|[A-Za-z][A-Za-z0-9_-]{1,}', text)
    # 同一个组件里重复出现的词没有区分度，只留第一次（保留原顺序）
    return ' '.join(dict.fromkeys(words))


def headings_of(md):
    """README 的二三级标题 —— 只给搜索用（不显示）。

    索引页搜索"focus"要能找到 button（它的标题里有「focus-visible」），
    这类词的命中面靠标题比靠摘要可靠得多。
    """
    out = []
    in_fence = False
    for ln in md.split('\n'):
        s = ln.strip()
        if s.startswith('```'):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = HEAD_RE.match(s)
        if m and len(m.group(1)) in (2, 3):
            out.append(re.sub(r'[`*_\[\]]', '', m.group(2)))
    return out


def render_section(label, desc, rows):
    return ('    <section class="g-sec" aria-labelledby="h-%s">\n'
            '      <h2 id="h-%s">%s</h2>\n'
            '      <p class="g-sec__desc">%s</p>\n'
            '      <ul class="g-list">\n%s\n      </ul>\n'
            '    </section>' % (label, label, esc(label), esc(desc), '\n'.join(rows)))


INDEX_JS = r'''
(function () {
  var q = document.getElementById('q');
  var hits = document.getElementById('hits');
  var empty = document.getElementById('empty');
  var items = [].slice.call(document.querySelectorAll('.g-item'));
  var secs = [].slice.call(document.querySelectorAll('.g-sec'));
  var total = items.length;
  var KW = {};
  try {
    KW = JSON.parse(document.getElementById('kw').textContent || '{}');
  } catch (e) {
    KW = {};            /* 键表坏了只该让搜索变弱，不该让整页脚本停摆 */
  }

  function norm(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, '');
  }

  function keyOf(li) {
    return norm(KW[li.getAttribute('data-id')] || '');
  }

  function apply() {
    var terms = norm(q.value);
    var shown = 0;
    items.forEach(function (li) {
      var hit = !terms || keyOf(li).indexOf(terms) !== -1;
      li.hidden = !hit;
      if (hit) shown++;
    });
    secs.forEach(function (sec) {
      var any = sec.querySelectorAll('.g-item:not([hidden])').length;
      sec.hidden = any === 0;
    });
    hits.textContent = shown === total
      ? '共 ' + total + ' 项'
      : '匹配 ' + shown + ' / ' + total + ' 项';
    empty.hidden = shown !== 0;
  }

  q.addEventListener('input', apply);

  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== q) {
      e.preventDefault();
      q.focus();
      q.select();
    } else if (e.key === 'Escape' && document.activeElement === q) {
      q.value = '';
      apply();
      q.blur();
    } else if (e.key === 'Enter' && document.activeElement === q) {
      var first = document.querySelector('.g-item:not([hidden]) .g-item__link');
      if (first) first.click();
    }
  });

  var prefilled = new URLSearchParams(location.search).get('q');
  if (prefilled) { q.value = prefilled; }
  apply();
})();
'''


def render_index(comps, page_ids, ver, extras, site_rows, concepts=()):
    """索引页。`extras` / `site_rows` / `concepts` 都是 `(row, id, keys)` 三元组 ——
    **键表由构造方一并交回**，不在这里重新拼：早先这里只收 HTML 字符串，
    行里的搜索键只好塞进 `data-k` 属性，于是 ① 读屏会把键念出来
    ② 按结构扫 HTML 的判据（wiring-check）把它们当成真在用那些属性。
    """
    rows_by_tier = {}
    kws = {}
    for c in comps:
        row, cid, keys = render_row(c, page_ids)
        kws[cid] = keys
        rows_by_tier.setdefault(c['tier'], []).append(row)
    for row, rid, keys in list(extras) + list(site_rows) + list(concepts):
        kws[rid] = keys
    sections = []
    # 概念页排在最前：先读约定，再看组件。它是"怎么用这套东西"的前提，
    #   不是附录 —— 放在页尾等于承认"没人会读"。
    if concepts:
        sections.append(render_section(
            '全局约定（不属于任何组件）',
            '令牌用法、焦点环、动效时长、暗色切换、逻辑属性 —— 这些规则跨全部组件，'
            '改一处影响全站。',
            [r for r, _i, _k in concepts]))
    for _d, slug, label, desc in TIERS:
        rows = rows_by_tier.get(slug)
        if rows:
            sections.append(render_section(label, desc, rows))
    if extras:
        sections.append(render_section('另有两个整页示例',
                                       '不是组件，是两套完整版式的示范。',
                                       [r for r, _i, _k in extras]))
    if site_rows:
        sections.append(render_section('只在本站有的页面',
                                       '这三个页面不随 npm 包发布，只在文档站上。',
                                       [r for r, _i, _k in site_rows]))
    return INDEX_PAGE % {
        'fav': FAVICON,
        'title': '组件文档 · agentcss',
        'desc': '%d 个组件的索引与文档。' % len(comps),
        # 索引页同样在 guide/ 里 —— 写成 '' 会让 tokens.css 指向
        # /guide/01-tokens/tokens.css（404），整页变成无样式裸 HTML。
        'up': '../',
        'where': '组件文档',
        'demo_href': '../index.html',
        'jump': '打开示例',
        'ver': 'v' + ver,
        'n': len(comps),
        'sections': '\n'.join(sections),
        'kws': json.dumps(kws, ensure_ascii=False, sort_keys=True,
                          separators=(',', ':')).replace('</', '<\\/'),
        'js': INDEX_JS,
    }


def site_base():
    """404 页要用的绝对前缀，从 package.json 的 homepage 推。

    不另写一份常量：fork 的人改了 homepage 而 404 页还指着旧名字，
    这种错只在"访问一个不存在的地址"时才看得见 —— 而那时人已经在
    找东西了，看到的是一张没有样式的裸页。
    """
    pkg = os.path.join(ROOT, 'package.json')
    if not os.path.isfile(pkg):
        return '/'
    with io.open(pkg, encoding='utf-8') as f:
        home = (json.load(f).get('homepage') or '').strip()
    m = re.match(r'^https?://[^/]+(/.*?)/?$', home)
    return (m.group(1).rstrip('/') + '/') if m else '/'


# 404 页**只能**用绝对路径引资源。
#   GitHub Pages 用它响应任意不存在的地址，而浏览器地址栏仍停在那个
#   错路径上（`/frontend-lib/typo/xxx`）—— 此时 `01-tokens/tokens.css`
#   会被解析成 `/frontend-lib/typo/01-tokens/tokens.css`，也 404。
#   于是整页裸奔：没样式、没暗色、字挤在一起。
#   这个失败模式不会出现在正常页面上，所以必须由判据盯着。
ROOT_404 = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>页面不存在 · agentcss</title>
<meta name="robots" content="noindex">
<link rel="icon" href="%(fav)s">
<link rel="stylesheet" href="%(base)s01-tokens/tokens.css">
<link rel="stylesheet" href="%(base)s01-tokens/typography.css">
<link rel="stylesheet" href="%(base)s01-tokens/page.css">
<style>
.skip { position: absolute; left: -9999px; }
.skip:focus { left: var(--sp-3); top: var(--sp-3); z-index: 9;
  background: var(--surface); padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm); }
.e-wrap { max-width: 34rem; margin: 0 auto; padding: var(--sp-8) var(--sp-5);
  min-height: 76vh; display: grid; align-content: center; }
.e-kicker { margin: 0 0 var(--sp-2); font-size: var(--fs-sm);
  letter-spacing: 0.08em; color: var(--text-tertiary); }
.e-wrap h1 { margin: 0 0 var(--sp-3); }
.e-note { margin: 0 0 var(--sp-6); color: var(--text-secondary); }
.e-links { margin: 0 0 var(--sp-7); padding: 0; list-style: none; }
.e-links li { margin: 0 0 var(--sp-3); }
/* 不写颜色就会落到浏览器默认蓝：暗色下那个蓝偏暗、和纸面糊在一起 */
.e-links a { color: var(--accent); font-weight: 500; }
.e-links span { color: var(--text-tertiary); }
.e-tech { margin: 0; font-size: var(--fs-sm); color: var(--text-tertiary); }
.e-tech code { word-break: break-all; }
</style>
</head>
<body class="page">
<a href="#main" class="skip">跳到主内容</a>
<main id="main" class="e-wrap">
  <p class="e-kicker">404</p>
  <h1>这个地址没有内容</h1>
  <p class="e-note">多半是旧链接，或者路径里打错了一个字符。</p>
  <ul class="e-links">
    <li><a href="%(base)sguide/index.html">组件索引</a>
      <span>—— %(n)d 个组件，可以按类名、状态、中文词搜</span></li>
    <li><a href="%(base)s">演示总览</a>
      <span>—— 每个组件一个能点的页面</span></li>
  </ul>
  <p class="e-tech">你请求的是 <code id="u"></code></p>
</main>
<script>
  var u = document.getElementById('u');
  if (u) u.textContent = location.pathname + location.search;
</script>
</body>
</html>
'''


def render_404(comps, ver):
    return ROOT_404 % {'fav': FAVICON, 'base': esc(site_base()), 'n': len(comps)}


def render_root_index(comps, page_ids, ver):
    """根 `index.html` —— **只链包内真实存在的页面**。

    package.json 的 `files` 白名单不含 `10-review/` 与 `examples/`，
    所以这两个目录的页面在这里出现就会变成"装完必然 404"
    （pack-closure 有判据，且登记了豁免名单）。站点首页另外列它们，
    见 `guide/index.html`。
    """
    rows_by_tier = {}
    for c in comps:
        demo = c['files'].get('demo')
        if not demo:
            continue
        title = title_of(readme_of(c['dir']), c['id'])
        rows_by_tier.setdefault(c['tier'], []).append(
            '<li><a href="%s">%s</a><span class="r__p">%s</span></li>'
            % (esc(demo), esc(title), esc(c['purpose'][:56])))
    blocks = []
    for _d, slug, label, desc in TIERS:
        rows = rows_by_tier.get(slug)
        if rows:
            blocks.append('<h2 class="rule-top">%s</h2>\n<p class="r__d">%s</p>\n<ul>\n%s\n</ul>'
                          % (esc(label), esc(desc), '\n'.join(rows)))
    return ROOT_INDEX % {
        'fav': FAVICON,
        'title': 'agentcss · 演示',
        'ver': esc(ver),
        'n': len(comps),
        'blocks': '\n\n'.join(blocks),
    }


ROOT_INDEX = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>%(title)s</title>
<link rel="icon" href="%(fav)s">
<link rel="stylesheet" href="01-tokens/tokens.css">
<link rel="stylesheet" href="01-tokens/typography.css">
<link rel="stylesheet" href="01-tokens/page.css">
<link rel="stylesheet" href="03-patterns/nav/nav.css">
<style>
ul { list-style: none; padding: 0; margin: 0 0 var(--sp-6); }
li { padding: var(--sp-3) 0; border-bottom: 1px solid var(--border-decor); }
li a { color: var(--accent); text-decoration: none; display: block; font-weight: 600; }
li a:active { background: var(--surface-sunken); }
.r__d { margin: 0 0 var(--sp-3); color: var(--text-secondary);
        font-size: var(--fs-sm); line-height: var(--lh-normal); }
.r__p { display: block; color: var(--text-secondary); font-size: var(--fs-sm);
        line-height: var(--lh-normal); margin-top: var(--sp-1); }
</style>
</head>
<body class="page">
<a href="#main" class="skip">跳到主内容</a>
<main id="main" class="wrap">
  <h1>agentcss · 演示</h1>
  <p class="lede">
    %(n)d 个组件，每一页都能直接打开看。
    <strong>手机上也一样</strong> —— 布局、触控尺寸、暗色都是按移动端调的。
  </p>

%(blocks)s

  <h2 class="rule-top">说明</h2>
  <p class="note">
    本页只链随包发布的页面。完整文档与其余开发期页面在
    <code>guide/index.html</code>（仓库内）与线上文档站。
  </p>
</main>
<footer class="wrap">
  <p class="note">%(ver)s · 零第三方运行时依赖</p>
</footer>
</body>
</html>
'''


# ===========================================================================
# 五 · 落盘
# ===========================================================================

def build(out_dir):
    """把整站算出来，返回 {相对路径: 内容}。纯函数：不写盘，便于比对。"""
    ver = read(os.path.join(ROOT, 'VERSION')).strip()
    conf, comps = load_components()
    page_ids = dict((c['dir'], c['id']) for c in comps)

    files = {}
    for idx, c in enumerate(comps):
        prev_c = comps[idx - 1] if idx > 0 else None
        next_c = comps[idx + 1] if idx + 1 < len(comps) else None
        files['guide/%s.html' % c['id']] = render_component(
            c, page_ids, ver, len(comps), prev_c, next_c)

    extras = []
    for cdir, label, desc in EXTRA_PAGES:
        demo = os.path.join(cdir, 'demo.html')
        if not os.path.isfile(os.path.join(ROOT, demo)):
            found = [f for f in sorted(os.listdir(os.path.join(ROOT, cdir)))
                     if f.endswith('.html')]
            demo = os.path.join(cdir, found[0]) if found else ''
        eid = cdir.rsplit('/', 1)[-1]
        md = readme_of(cdir)
        keys = ' '.join([eid, label, desc, ' '.join(code_tokens(md)),
                         ' '.join(headings_of(md))]).lower()
        # 路径必须过 norm_rel：`os.path.join` 在 Windows 上给的是
        # `04-recipes/data-showcase\demo.html`。浏览器会把 `\` 当路径分隔符
        # 兜住，所以肉眼看不出来 —— 但链接判据与第三方的链接检查都会挂。
        extras.append((
            '<li class="g-item" data-id="%s">'
            '<a class="g-item__link" href="../%s">'
            '<span class="g-item__name">%s</span>'
            '<span class="g-item__desc">%s</span></a></li>'
            % (esc(eid), esc(norm_rel(demo)), esc(label), esc(desc)), eid, keys))

    site_rows = []
    for rel, label, desc in SITE_ONLY:
        sid = norm_rel(rel).replace('/', '-').rsplit('.html', 1)[0]
        site_rows.append((
            '<li class="g-item" data-id="%s">'
            '<a class="g-item__link" href="../%s">'
            '<span class="g-item__name">%s</span>'
            '<span class="g-item__desc">%s</span></a></li>'
            % (esc(sid), esc(norm_rel(rel)), esc(label), esc(desc)),
            sid, ' '.join([sid, label, desc]).lower()))

    # 概念页：不像组件那样有 demo / 上下篇按组件顺序排，它们自成一小串链条。
    concepts = []
    for i, (slug, label, desc, rel_md) in enumerate(CONCEPT_PAGES):
        prev_c = (CONCEPT_PAGES[i - 1][0], CONCEPT_PAGES[i - 1][1]) if i > 0 else None
        next_c = ((CONCEPT_PAGES[i + 1][0], CONCEPT_PAGES[i + 1][1])
                  if i + 1 < len(CONCEPT_PAGES) else None)
        files['guide/%s.html' % slug] = render_concept(
            slug, label, desc, rel_md, ver, len(comps), prev_c, next_c)
        concepts.append(render_concept_row(slug, label, desc, rel_md))

    files['guide/index.html'] = render_index(comps, page_ids, ver, extras,
                                             site_rows, concepts)
    files['guide/guide.css'] = GUIDE_CSS + LIVE_CSS
    # 🔴 live.js 必须由生成器**产出**，不能是手写落在 guide/ 里的文件。
    #    前者是"文档站的全部产物都可以随时重算"，后者会让
    #    docs-site 判出"残留页面"（它比自己手里那份现算结果多一个文件）。
    #    2026-10-29 就是这么被抓到的：手写了 live.js，却只在 HTML 里引用它。
    files['guide/live.js'] = LIVE_JS
    files['index.html'] = render_root_index(comps, page_ids, ver)
    files['404.html'] = render_404(comps, ver)

    # 站点专属页（`10-review/` `examples/` 下那三个）只列在 `guide/index.html`。
    #   根 `index.html` 在 `files` 白名单里、会随包发出去，把它链到
    #   不发布的东西上就是"装完必然 404"（pack-closure 判据）。`guide/`
    #   本身不在白名单，所以它链什么都不影响包内一致性。
    return files, comps, conf


def write_all(out_dir, files):
    for rel in sorted(files):
        p = os.path.join(out_dir, rel)
        d = os.path.dirname(p)
        if d and not os.path.isdir(d):
            os.makedirs(d)
        with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
            f.write(files[rel])


# ============================================================================
# 活标本样式（v0.11.9）
# ============================================================================
# 单独成常量而不是并进 GUIDE_CSS：这一段解决的是"页面里嵌了一个小舞台"
# 这一个新的视觉元素，和站点骨架（导航 / 侧栏 / 正文排版）不是一件事。
# 将来若标本要换形态（比如改成可以直接切浅色/暗色），改动只在这一段。
LIVE_CSS = """
/* ---------- 活标本 (g-live) ----------
   组件页顶部内嵌那页 demo。为什么是 iframe、取舍写在哪，
   见 gen-docs.py 的 live_block()。这里只管：默认高度、同层视觉、呼吸。

   默认高度 320px 有具体含义：JS 没跑起来（file:// 或脚本被禁）时
   框架仍在、内容仍能内部滚动看到。低于它读者会以为标本坏了。 */
.g-live {
  margin: 0 0 var(--sp-6);
  border: 1px solid var(--border-decor);
  border-radius: var(--r-md);
  background: var(--surface);
  overflow: hidden;          /* 圆角裁掉 iframe 的方角 */
}

.g-live__cap {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--border-decor);
  background: var(--surface-sunken);
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  line-height: 1.6;
}

.g-live__cap a { color: var(--accent); }

.g-live__tag {
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.02em;
}

.g-live__frame {
  display: block;
  width: 100%;
  border: 0;
  height: 320px;
  background: var(--paper);
}

/* 被高度上限截断时由 live.js 追加的一句话。
   放在题注里，而不是覆盖在内容上 —— 覆盖层会挡住第一行标本。 */
.g-live__hint {
  color: var(--text-secondary);
  border-inline-start: 2px solid var(--border-decor);
  padding-inline-start: var(--sp-2);
}
"""


def main():
    argv = sys.argv[1:]
    out_dir = ROOT
    if '--out' in argv:
        out_dir = os.path.abspath(argv[argv.index('--out') + 1])

    files, comps, conf = build(out_dir)
    write_all(out_dir, files)
    print('生成 %d 个文件：guide/ 下 %d 页 + 根 index.html'
          % (len(files), len([k for k in files if k.startswith('guide/')])))
    print('  组件 %d（stable %d / beta %d）· 真值 ai/components.json'
          % (len(comps), conf['summary']['byMaturity'].get('stable', 0),
             conf['summary']['byMaturity'].get('beta', 0)))
    return 0


# ===========================================================================
# 六 · 站点样式
#     这份 CSS **不进 npm 包**（`files` 白名单里没有 `guide/`）——
#     它只是文档站的外观，不是库的一部分。因此这里可以自由用 `guide/`
#     这个前缀，不必挤进库的 BEM 命名空间。
# ===========================================================================

GUIDE_CSS = """/* 由 05-audit/gen-docs.py 生成，勿手改（改生成器） */
/* 🔴 这里**没有** `.g-page { padding: 0 }`。
   它曾经在：文档站想要"整幅贴边的顶栏"，于是把骨架（01-tokens/page.css）
   给的页面框清了零，再在 `.g-layout` 里自己写一遍内边距。
   骨架杠杆判据（skeleton-lever-check.js L3）把它量出来了：
   改 `--sp-6`，35 个文档页的 body padding-top 一个都不动。
   那不是"文档站有特殊情况"，那是**两份页面框** —— 改全局只牵动其中一份，
   而人眼看不出来（两种写法渲染出来几乎一样）。
   ⇒ 页面框只有 page.css 一份；顶栏改为在页面框内吸附。 */

/* ---- 顶栏 ---------------------------------------------------------------- */
/* 底色用 `--paper`（= 页面框的底色）而不是 `--surface`：
   顶栏在页面框内部，用表面色会变成"浮在纸面上的一条工具条"；
   同色 + 一条发丝线，读起来才是**文档的页头**。吸附时也顺带无缝。 */
.g-top {
  position: sticky;
  top: 0;
  z-index: var(--z-raised);
  background: var(--paper);
  border-bottom: 1px solid var(--border-decor);
}
.g-top__in {
  max-width: 76rem;
  margin: 0 auto;
  min-height: 3.5rem;
  /* 左右不写内边距：页面框已经给了 `max(--sp-4, safe-area)`，
     再写一遍就是双份（393px 下量出来会多 16px）。 */
  padding: 0;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-sm);
}
.g-brand {
  color: var(--text-primary);
  font-weight: 600;
  text-decoration: none;
  letter-spacing: -0.01em;
  padding: var(--sp-2) 0;
}
.g-sep { color: var(--text-tertiary); }
.g-where {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.g-jump {
  margin-left: auto;
  flex: none;
  color: var(--accent);
  text-decoration: none;
  border: 1px solid var(--border-control);
  border-radius: var(--r-pill);
  padding: var(--sp-1) var(--sp-3);
  min-height: var(--sz-touch-sm);
  display: inline-flex;
  align-items: center;
}
.g-jump:hover { border-color: var(--accent); }
.g-jump:focus-visible {
  outline: var(--ring-thickness) solid var(--accent);
  outline-offset: 2px;
}

/* ---- 版式 ---------------------------------------------------------------- */
.g-layout {
  max-width: 76rem;
  margin: 0 auto;
  /* 左右内边距归页面框管（`.page` 的 padding-inline），这里只留纵向呼吸。 */
  padding: var(--sp-6) 0 var(--sp-8);
  display: grid;
  grid-template-columns: minmax(0, 1fr) 14rem;
  gap: var(--sp-7);
  align-items: start;
}
.g-layout--index { grid-template-columns: minmax(0, 1fr); max-width: 54rem; }
.g-main { min-width: 0; max-width: 46rem; }
.g-index .g-main { max-width: none; }

.g-kicker {
  margin: 0 0 var(--sp-2);
  font-size: var(--fs-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}
.g-meta {
  list-style: none;
  padding: 0;
  margin: 0 0 var(--sp-6);
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
}
.g-meta li {
  border: 1px solid var(--border-decor);
  border-radius: var(--r-pill);
  padding: 0 var(--sp-2);
  color: var(--text-secondary);
}
.g-meta a { color: var(--text-secondary); text-decoration: none; }
.g-meta a:hover { color: var(--accent); }

/* ---- 正文 ----------------------------------------------------------------- */
.g-doc { font-size: var(--fs-base); line-height: var(--lh-base); }
.g-doc h2 {
  margin: var(--sp-6) 0 var(--sp-3);
}
/* README 的写法几乎都是「`---` 之后接 h2」。两边都给分隔线会画出两条线，
   中间夹一段空白 —— 实测第一版就是这样，看着像误触。取消标题那条，
   让 `---` 独自承担分隔。 */
.g-doc hr + h2 { margin-top: 0; }
.g-doc h3 { margin: var(--sp-5) 0 var(--sp-2); font-size: var(--fs-lg); }
.g-doc h4 { margin: var(--sp-4) 0 var(--sp-2); font-size: var(--fs-md); }
.g-doc p { margin: 0 0 var(--sp-3); }
.g-doc ul, .g-doc ol { margin: 0 0 var(--sp-3); padding-inline-start: 1.35em; }
.g-doc li { margin: var(--sp-1) 0; }
.g-doc hr {
  border: 0;
  border-top: 1px solid var(--border-decor);
  margin: var(--sp-6) 0 var(--sp-5);
}
.g-doc blockquote {
  margin: var(--sp-3) 0;
  padding: var(--sp-2) var(--sp-4);
  border-inline-start: 3px solid var(--border-control);
  background: var(--surface-sunken);
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
  color: var(--text-secondary);
}
.g-doc blockquote p { margin: 0; }

/* 表格：库里的 `.table` 是给"数据表"用的（限高 70vh + 内部滚动）。
   文档里的表格是排版元素，限高会把内容藏在滚动条后面。 */
.g-doc .table { max-height: none; }
.g-doc .table table { font-size: var(--fs-sm); }
.g-doc .table th, .g-doc .table td { text-align: start; vertical-align: top; }
.g-doc .ta-center { text-align: center; }
.g-doc .ta-right { text-align: right; }

/* 代码块 */
.g-doc pre.code {
  margin: 0 0 var(--sp-4);
  padding: var(--sp-3) var(--sp-4);
  overflow-x: auto;
  background: var(--surface-sunken);
  border: 1px solid var(--border-decor);
  border-radius: var(--r-md);
  font-family: var(--mono);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  tab-size: 2;
}
.g-doc pre.code code {
  background: none;
  border: 0;
  padding: 0;
  font-size: inherit;
  white-space: pre;
}
.g-doc pre.code:focus-visible {
  outline: var(--ring-thickness) solid var(--accent);
  outline-offset: 2px;
}

/* 标题锚点：只在悬停/聚焦时出现，不占版面 */
.g-doc .anchor {
  margin-inline-start: var(--sp-2);
  color: var(--text-tertiary);
  text-decoration: none;
  opacity: 0;
  font-weight: 400;
}
.g-doc h2:hover .anchor,
.g-doc h3:hover .anchor,
.g-doc .anchor:focus-visible { opacity: 1; }

/* ---- 侧边目录 ------------------------------------------------------------- */
.g-side {
  position: sticky;
  top: 4.25rem;
  font-size: var(--fs-sm);
  border-inline-start: 1px solid var(--border-decor);
  padding-inline-start: var(--sp-4);
  max-height: calc(100vh - 6rem);
  overflow-y: auto;
}
.g-side__title {
  margin: 0 0 var(--sp-2);
  font-size: var(--fs-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}
.g-side__none { color: var(--text-tertiary); margin: 0; }
.g-toc { list-style: none; margin: 0; padding: 0; }
.g-toc li { margin: 0; }
.g-toc a {
  display: block;
  padding: var(--sp-1) 0;
  color: var(--text-secondary);
  text-decoration: none;
  line-height: var(--lh-tight);
}
.g-toc a:hover { color: var(--accent); }
.g-toc a:focus-visible {
  outline: var(--ring-thickness) solid var(--accent);
  outline-offset: 2px;
}

/* ---- 索引页 --------------------------------------------------------------- */
.lede--note {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  max-width: 46em;
  margin: calc(var(--sp-3) * -1) 0 var(--sp-5);
}
.lede--note code { font-size: var(--fs-xs); }

.g-search { margin: 0 0 var(--sp-6); }
.g-search__label {
  display: block;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
.g-search__input {
  width: 100%;
  min-height: var(--sz-touch);
  padding: 0 var(--sp-3);
  font: inherit;
  color: var(--text-primary);
  background: var(--surface);
  border: 1px solid var(--border-control);
  border-radius: var(--r-md);
  -webkit-appearance: none;
  appearance: none;
}
.g-search__input::placeholder { color: var(--text-tertiary); }
.g-search__input:focus-visible {
  outline: var(--ring-thickness) solid var(--accent);
  outline-offset: 1px;
  border-color: var(--accent);
}
.g-search__hint {
  margin: var(--sp-2) 0 0;
  font-size: var(--fs-xs);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.g-sec { margin: 0 0 var(--sp-7); }
.g-sec h2 {
  margin: 0 0 var(--sp-1);
  font-size: var(--fs-lg);
  padding-top: var(--sp-4);
  border-top: 1px solid var(--border-decor);
}
.g-sec__desc {
  margin: 0 0 var(--sp-3);
  color: var(--text-secondary);
  font-size: var(--fs-sm);
}
.g-list { list-style: none; margin: 0; padding: 0; }
.g-item {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  border-bottom: 1px solid var(--border-decor);
}
.g-item__link {
  flex: 1 1 auto;
  min-width: 0;
  display: block;
  padding: var(--sp-3) 0;
  text-decoration: none;
  color: var(--text-primary);
}
.g-item__name {
  display: block;
  font-weight: 600;
  font-size: var(--fs-md);
  letter-spacing: -0.01em;
}
.g-item__desc {
  display: block;
  margin-top: var(--sp-1);
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  line-height: var(--lh-normal);
}
.g-item__link:hover .g-item__name { color: var(--accent); }
.g-item__link:focus-visible {
  outline: var(--ring-thickness) solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--r-sm);
}
.g-item__demo {
  flex: none;
  align-self: center;
  font-size: var(--fs-xs);
  color: var(--accent);
  text-decoration: none;
  border: 1px solid var(--border-control);
  border-radius: var(--r-pill);
  padding: 0 var(--sp-2);
  min-height: var(--sz-touch-sm);
  display: inline-flex;
  align-items: center;
}
.g-item__demo:focus-visible {
  outline: var(--ring-thickness) solid var(--accent);
  outline-offset: 2px;
}
.g-empty { color: var(--text-secondary); }

/* ---- 翻页 / 页脚 ---------------------------------------------------------- */
.g-pager {
  margin-top: var(--sp-7);
  padding-top: var(--sp-4);
  border-top: 1px solid var(--border-decor);
  display: flex;
  gap: var(--sp-3);
  justify-content: space-between;
  font-size: var(--fs-sm);
}
.g-pager__link {
  max-width: 45%;
  color: var(--accent);
  text-decoration: none;
  padding: var(--sp-2) 0;
  min-height: var(--sz-touch);
}
.g-pager__link span {
  display: block;
  font-size: var(--fs-xs);
  color: var(--text-tertiary);
}
.g-pager__link--next { margin-inline-start: auto; text-align: end; }

.g-foot {
  max-width: 76rem;
  margin: 0 auto;
  padding: var(--sp-5) max(var(--sp-4), env(safe-area-inset-left));
  border-top: 1px solid var(--border-decor);
  color: var(--text-tertiary);
  font-size: var(--fs-xs);
}
.g-foot p { margin: 0; }

/* ---- 窄屏：侧边目录收起，顶栏保留 ----------------------------------------- */
@media (max-width: 64rem) {
  .g-layout { grid-template-columns: minmax(0, 1fr); }
  .g-side { display: none; }
  .g-main { max-width: none; }
}
"""



LIVE_JS = r"""/**
 * live.js — 让文档页里的活标本撑到它自己的高度
 * ============================================================================
 * 为什么需要这个文件
 * ---------------------------------------------------------------------------
 *   组件页用 <iframe> 内嵌 demo（理由与取舍见 05-audit/gen-docs.py 的
 *   live_block()）。iframe 的默认高度是写死的，而 demo 页长短差很多：
 *   按钮七态约 2500px，report 页 5100px。写死高度只有两种结果 ——
 *   要么被裁、要么一大片空白。
 *
 * 为什么不能"量一次 scrollHeight 就设上去"（第一版就是这么写的）
 * ---------------------------------------------------------------------------
 *   实测：`table` 页在框高 100px 时 body.scrollHeight = 1924，
 *   在框高 1926px 时同一个值是 **3206** —— 同一页有两个"真实高度"。
 *   原因是它内部有随视口高度伸缩的滚动区（`height:100%` / flex 撑满那一类）。
 *   于是任何单一采样点都会得到自洽但错误的值，
 *   而 ResizeObserver 因为盒子尺寸没变**永远不触发**，错值就被固化下来。
 *
 *   还有第二层：demo 的 `body` 带 `min-height: 100vh`（页面骨架保证
 *   "内容不满一屏也铺满"）。嵌在标本框里这条规则是**反的** ——
 *   它让 scrollHeight 永远等于框高，于是"装得下"永远成立，
 *   多档采样会一路把框撑到上限（实测全部页面收敛到 7118px）。
 *
 *   ⇒ 两条一起改：
 *       ① 进 iframe 先把 body / html 的 `min-height` 内联清成 0
 *          （嵌在框里，"撑满视口"没有意义；标本的高度应当等于内容）；
 *       ② 再从 100px 起量一次 scrollHeight，那才是真实内容高度。
 *
 * 三条不可让步的约束
 * ---------------------------------------------------------------------------
 *   ① **不许抛错**：`file://` 直接打开时 iframe 是跨文档，contentDocument
 *      读不到。这时保持 CSS 的默认高度 + 内部滚动，页面照常可用 ——
 *      功能降级，而不是坏掉。
 *   ② **内容变了要跟着变**：tabs / 抽屉会改变高度。ResizeObserver 盯着
 *      body 与 documentElement，变化时重算。
 *   ③ **本文件不属于库的交付物**：npm 包里没有 `guide/`。
 * ========================================================================= */
(function () {
  'use strict';

  var MIN = 240;
  /* 兜底上限只防天文数字。别把它设成"常见页面高度"：
     实测 report 页 5115px，第一版设 3000 把三页全部截断。 */
  var MAX = 9000;
  /* 内嵌窗口的**产品上限**：超过它的内容在窗口内滚动，而不是把文档页撑到两万像素。
     实测 nav 页真实高度 11384px —— 原样内嵌等于让读者滚过十几个屏幕才看到正文。
     裁了就必须说：设 data-capped 并补一句"窗口内可滚动"（门禁会查这句在不在），
     否则"看起来完整、其实只有前 1/5"就是另一种骗人。 */
  /* ⚠️ 这个值**不能和 STEPS 里任何一档相等**：相等时"刚好装下"与"被上限截断"
     会落在同一个数字上，于是 capped 判断永远为假、提示不出现 ——
     而门禁那边按高度判"已截断"，两边打架（实测 input / tabs 卡在这里）。
     ⇒ CAP 取 2200，STEPS 里没有它。 */
  var CAP = 2200;
  var STEPS = [100, 700, 1400, 2400, 3600, 5200, 7000];

  function fit(frame) {
    var doc = null;
    try {
      doc = frame.contentDocument;
    } catch (e) {
      return false;                    // 跨文档：保持 CSS 里的默认高度
    }
    if (!doc || !doc.documentElement || !doc.body) return false;

    var body = doc.body;

    /* 每次都清（幂等、一行开销）。
       🔴 不能"只清一次"：`init()` 在 iframe 还是 about:blank 时就会跑一次 fit，
       那时打个标记，等真实文档 load 进来后**标记还在、规则却回来了** ——
       于是 100vh 重新生效，测量一路虚高到上限。
       实测症状：六页全部收敛到同一个 7118px，而每页真实高度差着 2000px。 */
    body.style.minHeight = '0';
    doc.documentElement.style.minHeight = '0';

    var measure = function () {
      return Math.max(body.scrollHeight, doc.documentElement.scrollHeight);
    };

    var apply = function () {
      var ro = frame.__ro;
      if (ro) ro.disconnect();          // 自己动尺寸时不要吵醒自己
      /* 从 100px 起量：min-height 已经清零，此时 scrollHeight 就是内容高度。
         再往上兜一档，覆盖"内容按框高伸缩"那类布局（多档取最大）。 */
      var answer = 0;
      for (var i = 0; i < STEPS.length; i++) {
        frame.style.height = STEPS[i] + 'px';
        var need = measure();
        if (!need) continue;
        if (need > answer) answer = need;
        if (need <= STEPS[i] + 2) break;   // 装得下就够，不必再往上试
      }
      answer = Math.min(Math.max(answer, MIN), MAX);

      var capped = answer > CAP;
      if (capped) answer = CAP;
      frame.style.height = answer + 'px';

      /* 被上限截断时，把这件事写在页面上（不是只写在代码里） */
      if (capped) {
        frame.dataset.capped = '1';
        /* ⚠️ 不用 Element.closest：它在老 WebView 上直接抛异常，
           而 live.js 是文档站脚本 —— 用 ES5 的循环向上找，成本一样。
           （legacy-api 门禁按"组件与文档脚本同一把尺"判，这里照规矩来。） */
        var fig = null;
        for (var up = frame; up; up = up.parentElement) {
          if (up.className && (' ' + up.className + ' ').indexOf(' g-live ') >= 0) {
            fig = up;
            break;
          }
        }
        var cap = fig ? fig.querySelector('.g-live__cap') : null;
        if (cap && !cap.querySelector('.g-live__hint')) {
          var hint = document.createElement('span');
          hint.className = 'g-live__hint';
          hint.textContent = '这页比较长：窗口内可滚动。';
          cap.appendChild(hint);
        }
      }

      /* 设完之后再确认一次：有的布局在"刚好装下"时又长了一点。
         差得多就再补一次（不做循环 —— 在视口依赖型布局上会抖个没完）。 */
      var after = measure();
      if (after > answer + 6) {
        frame.style.height = Math.min(after, MAX) + 'px';
      }
      if (ro) ro.observe(body);         // 改完再挂回去
    };

    apply();
    /* 字体在首次布局之后才应用，图片也可能后到 ⇒ 再收尾两次。
       不做轮询：那是拿 CPU 换确定性，这里只覆盖首屏那一次。 */
    setTimeout(apply, 150);
    setTimeout(apply, 700);

    /* 🔴🔴 这里是一个**反馈环**，必须断开才能观察：
     *   apply() 改的是 frame 的高度 ⇒ documentElement 的高度跟着变
     *   ⇒ 如果观察 documentElement，回调立刻再进 apply() ⇒ 死循环。
     *   实测症状：跑 GoTo/截图直接卡死（不是慢，是主线程被布局占满）。
     *   ⇒ ① 只观察 body（min-height 已清零，body 高度 = 内容高度）；
     *     ② apply 期间先断开、改完再挂上 —— 自己造成的尺寸变化不该再触发自己。 */
    if (frame.__ro) { frame.__ro.disconnect(); frame.__ro = null; }
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        if (frame.__busy) return;
        frame.__busy = true;
        /* 让出一次任务：内容连续变化时只算最后一帧 */
        setTimeout(function () {
          apply();
          frame.__busy = false;
        }, 60);
      });
      ro.observe(body);
      frame.__ro = ro;
    }
    return true;
  }

  function init() {
    var frames = document.querySelectorAll('iframe.g-live__frame');
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      if (f.dataset.fit === '1') continue;
      f.dataset.fit = '1';
      /* lazy 加载时 load 可能已经过去了 ⇒ 先试一次，load 再兜一次 */
      fit(f);
      f.addEventListener('load', function () { fit(this); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
"""

if __name__ == '__main__':
    sys.exit(main())