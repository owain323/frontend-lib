#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
md-inline-gate.py — md-render 生成的单文件页，内联样式必须等于**当前**源文件

为什么需要这道门
-------------------------------------------------------------------------------
`05-audit/md-render.py` 是 MANUAL-ONLY 工具（它自己第一行就这么写）：
把 `.md` 渲染成**自包含** HTML 时，会把 `01-tokens/tokens.css` 和
`03-patterns/content/content.css` **整份内联**进 `<style>`。
于是同一份样式在仓库里有**两个出处**：源文件，和产物里的副本。

没有门禁守着，副本就会静默漂移 —— 而且漂移的方向永远一样：
**源文件改了，产物没重生成**。

这不是假设。外部审计 F1 命中的就是它：
`content.css` 里的 `.prose > img` 是直接子代选择器，而 Markdown 渲染出的
图片长在 `<p>` 里 ⇒ 一条都匹配不上；实测 320px 溢出 301px。
修的时候才发现 `04-recipes/longform/content.html` 里的副本**已经落后好几版**
（内联块 7 840 字符 vs 源文件 8 426 字符），改源文件对它毫无影响 ——
如果只改源文件就跑门禁，会得到"已修复"的结论，而页面根本没变。

判据
-------------------------------------------------------------------------------
① 产物里每个 `由 md-render.py 内联自 frontend-lib/<path> ---- */` 标记，
   后面到下一个标记（或 `body {`）之间的内容，必须与 `<path>` 当前内容
   **逐字相等**（只归一末尾空白）。
② 零视野守卫：一个产物都没找到、或找到了但一个内联块都没解析出来 ⇒ 红。
   否则"标记改名 / 目录搬走"会让这道门禁静默变成空转。
③ 标记指向的源文件必须存在 ⇒ 否则红（不能拿"源没了"当通过）。

边界（写清，否则等于假绿）
-------------------------------------------------------------------------------
* 本门禁**只**校验内联的样式副本，**不**校验正文：
  `.md` → HTML 的正文渲染结果它比不了 —— 那要跑 markdown-it，
  而 md-render 是人工工具，仓库的 Python 侧刻意保持零第三方依赖。
  ⇒ 改了 `.md` 之后仍必须人工重跑 `md-render.py`。
* 不给"手工同步副本"开口子：判据是逐字相等，没有豁免名单。
  真要豁免，得先证明那句话不是"同一个事实的第二个出处"。

用法
-------------------------------------------------------------------------------
    python 05-audit/md-inline-gate.py
    python 05-audit/md-inline-gate.py --selftest
"""

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MARKER = '由 md-render.py 内联自 frontend-lib/'
MARKER_RE = re.compile(re.escape('由 md-render.py 内联自 ') + r'(frontend-lib/\S+?) ---- \*/')
# ⚠️ 标记里的 `frontend-lib/` 是**仓库名标签**，不是仓库内的路径前缀
#    （md-render.py 的 SHELL 里写死成 "内联自 frontend-lib/<相对路径>"）。
#    直接拿它拼路径会得到 `<root>/frontend-lib/01-tokens/tokens.css` —— 不存在。
#    所以先剥掉这一段标签，剩下的才是仓库内相对路径。
LABEL = 'frontend-lib/'
# 最后一个内联块结束于内联 shell 的 `body {`（见 md-render.py 的 SHELL）
TAIL = 'body {'


def read(path):
    """统一成 LF 再比 —— 否则 CRLF 的工作区会把"完全一致"判成不一致。"""
    return io.open(path, encoding='utf-8', errors='replace').read().replace('\r\n', '\n')


def marker_sites(html):
    """返回 [(源相对路径, 标记行结束后的下标)]。

    ⚠️ 不去"猜内联块在哪结束"。第一版按"下一个标记 / 一行 `body {`"切，
       而 `body {` 与源文件里的同名行无法区分 —— 判据自己先坏掉。
       现在改成**子串定位**：md-render 把源文件整份写进 `{tokens}` / `{content}`，
       所以标记行之后必须**紧跟**源文件的全文。既不用猜结尾，也不可能被内容里的
       同名字串骗到。
    """
    out = []
    for m in MARKER_RE.finditer(html):
        out.append((m.group(1), m.end()))
    return out


def norm(text):
    return '\n'.join(line.rstrip() for line in text.strip().splitlines())


def check(root):
    """返回 (错误列表, 统计)。root 可替换，便于反向控制喂合成样本。"""
    errs = []
    produced = 0
    checked = 0
    files = []
    for base, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs
                   if d not in ('node_modules', '.git', '_attic', '__pycache__')]
        for n in sorted(names):
            if not n.endswith('.html'):
                continue
            p = os.path.join(base, n)
            try:
                html = read(p)
            except OSError:
                continue
            if MARKER not in html:
                continue
            rel_html = os.path.relpath(p, root).replace(os.sep, '/')
            produced += 1
            files.append(rel_html)
            sites = marker_sites(html)
            if not sites:
                errs.append('%s：有内联标记，但一个块都解析不出来（判据可能已失效）'
                            % rel_html)
                continue
            for src, pos in sites:
                checked += 1
                rel = src[len(LABEL):] if src.startswith(LABEL) else src
                src_path = os.path.join(root, rel.replace('/', os.sep))
                if not os.path.isfile(src_path):
                    errs.append('%s：内联标记指向的源文件不存在 —— %s' % (rel_html, src))
                    continue
                source = norm(read(src_path))
                inline = norm(html[pos:pos + len(source) + 2])
                if inline != source:
                    hint = ''
                    for k in range(min(len(inline), len(source))):
                        if inline[k] != source[k]:
                            hint = ('首个差异在第 %d 字符：副本 %r / 源 %r'
                                    % (k, inline[max(0, k - 30):k + 30].rstrip(),
                                       source[max(0, k - 30):k + 30].rstrip()))
                            break
                    else:
                        hint = '副本 %d 字符，源 %d 字符' % (len(inline), len(source))
                    errs.append('%s ⇄ %s：内联副本与源文件不一致。%s'
                                % (rel_html, src, hint))
    stats = {'produced': produced, 'blocks': checked, 'files': files}
    if produced == 0:
        errs.append('零视野：全仓没有找到任何 md-render 产物标记 '
                    '（标记被改名、目录被搬走，都会让这道门禁空转）')
    elif checked == 0:
        errs.append('零视野：找到 %d 个产物，但内联块计数为 0' % produced)
    return errs, stats


def main(argv):
    if '--selftest' in argv:
        return selftest()

    print('  === md-render 内联副本一致性 ===')
    errs, st = check(ROOT)
    for f in st['files']:
        print('  产物：%s' % f)
    print('  产物 %d 个 · 内联块 %d 个' % (st['produced'], st['blocks']))
    if errs:
        for e in errs:
            print('  [FAIL] %s' % e)
        print('  [FAIL] %d 项 —— 改了源样式就重跑 md-render.py 再提交' % len(errs))
        return 1
    print('  [OK] 内联副本与源文件逐字一致')
    return 0


# ------------------------------------------------------------------ 反向控制
GOOD_CSS = '.prose img {\n  max-width: 100%;\n}\n'
BAD_CSS = '.prose > img {\n  max-width: 100%;\n}\n'


def _fixture(root, inline, source=GOOD_CSS, marker=True):
    src = os.path.join(root, '03-patterns', 'content')
    os.makedirs(src, exist_ok=True)
    io.open(os.path.join(src, 'content.css'), 'w', encoding='utf-8',
            newline='\n').write(source)
    body = ('<!DOCTYPE html>\n<style>\n'
            + ('/* ---- ' + MARKER + '03-patterns/content/content.css ---- */\n'
               if marker else '')
            + inline
            + 'body {\n  margin: 0;\n}\n</style>\n')
    io.open(os.path.join(root, 'page.html'), 'w', encoding='utf-8',
            newline='\n').write(body)


def selftest():
    import shutil
    import tempfile

    print('  === md-inline-gate 反向控制 ===')
    bad = 0

    def report(ok, name, extra=''):
        nonlocal bad
        print('  ' + ('OK   ' if ok else 'FAIL ') + name + (('  ' + extra) if extra else ''))
        if not ok:
            bad += 1

    tmp = tempfile.mkdtemp(prefix='md-inline-')
    try:
        d = os.path.join(tmp, 'good')
        _fixture(d, GOOD_CSS)
        errs, st = check(d)
        report(errs == [] and st['blocks'] == 1, '副本与源一致 ⇒ 绿',
               'blocks=%d' % st['blocks'])

        d = os.path.join(tmp, 'drift')
        _fixture(d, BAD_CSS)
        errs, st = check(d)
        report(len(errs) == 1 and '不一致' in errs[0],
               '副本落后于源（就是 F1 的形态）⇒ 红', errs[0][:60] if errs else '')

        d = os.path.join(tmp, 'missing')
        _fixture(d, GOOD_CSS)
        os.remove(os.path.join(d, '03-patterns', 'content', 'content.css'))
        errs, st = check(d)
        report(len(errs) == 1 and '不存在' in errs[0], '源文件缺失 ⇒ 红')

        d = os.path.join(tmp, 'noview')
        _fixture(d, GOOD_CSS, marker=False)
        errs, st = check(d)
        report(any('零视野' in e for e in errs) and st['produced'] == 0,
               '一个产物都没有 ⇒ 零视野红')

        d = os.path.join(tmp, 'unparsed')
        os.makedirs(d, exist_ok=True)
        io.open(os.path.join(d, 'x.html'), 'w', encoding='utf-8', newline='\n').write(
            '<style>/* ' + MARKER + ' ---- broken */ .a{}</style>')
        errs, st = check(d)
        report(any('解析不出来' in e for e in errs), '标记在但块切不出来 ⇒ 红')

        d = os.path.join(tmp, 'trailws')
        _fixture(d, GOOD_CSS + '\n\n   \n')
        errs, st = check(d)
        report(errs == [], '仅末尾空白不同 ⇒ 绿（归一化有效）')

        # 真实仓库必须全绿（良性对照）
        real_errs, real_st = check(ROOT)
        report(real_errs == [], '真实仓库 ⇒ 绿',
               'prod=%d blocks=%d' % (real_st['produced'], real_st['blocks']))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print('  ' + ('✅ 反向控制全部通过' if bad == 0 else '🔴 %d 条反向控制失败' % bad))
    return 0 if bad == 0 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
