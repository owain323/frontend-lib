#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
tag-balance.py — HTML 标签是否配平

为什么需要这一条
--------------------------------------------
给 10 个页面补 `<main>` 地标时，**脚本两次失配**：

1. 第一次用"数 `<div`/`</div>` 找配对"，遇到第一个 `</div>` 就闭合
   —— 但那是 `.lede` 的闭合，不是 `.wrap` 的。
2. 第二次用标签栈，仍失配 —— 因为 **`<script>var x = 1 < 2;</script>`
   里的 `<` 被当成标签开始**，匹配出假的 `</script>`。

第二次失配顺着查下去，发现了**真实的 HTML 错误**：
`index.html` 里有 `<pre><code>...</pre>` —— **`<code>` 没闭合**。

🔴 **为什么 axe 没报**：
axe 关注无障碍（ARIA/对比度/角色），**不校验标签是否闭合** ——
未闭合的 `<code>` 在浏览器里会被自动纠正，页面"看起来正常"，
所以静态门禁（类名检查）与 axe **都抓不到它**。只有标签平衡能。

用法：python 05-audit/tag-balance.py
"""
import sys
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr'}
TAG = re.compile(r'<(/?)([a-zA-Z][\w-]*)([^>]*?)(/?)>')


def blank_inner(text, tagname):
    """把 <tag>…</tag> 的**内部**挖空，但**保留换行符**。

    🔴 为什么必须保留换行（0.8.9 修）：
      原实现用 `m.group(1)+m.group(2)` 直接拼起来 ⇒ 内部内容里的换行
      **全部消失** ⇒ 后面按 `body[:pos].count('\\n')` 算出的行号
      是"剥离后文本"的坐标，**与源文件对不上**。
      实测后果：它报「期望 </main>（开在 L15）」，
      而 L15 是 CSS 规则 —— 人拿到这个提示**根本定位不到问题**。
      ⇒ 一个报不出位置的判据，等于让人重新找一遍。
    """
    pat = re.compile(r'(<' + tagname + r'\b[^>]*>)(.*?)(</' + tagname + r'>)',
                     re.S | re.I)

    def _blank(m):
        keep_nl = ''.join('\n' for _ in m.group(2).split('\n')[1:])
        return m.group(1) + keep_nl + m.group(3)

    return pat.sub(_blank, text)


def _strip_comments(text):
    """删掉注释，但**保留换行**（理由同上）。"""
    return re.sub(r'<!--.*?-->',
                  lambda m: ''.join('\n' for _ in m.group(0).split('\n')[1:]),
                  text, flags=re.S)


def check(path):
    src = open(path, encoding='utf-8', errors='replace').read()
    # 🔴 顺序很关键：**先剥注释，再挖空 script/style**（0.8.9 修）。
    #   反过来的话，注释里那句
    #       <!-- 这里**没有** <script src="three.min.js"> … -->
    #   会被当成一个真的 `<script>` 开始，然后非贪婪匹配到**下一个**
    #   `</script>`（几十行之后的真脚本）⇒ 中间的真实标签
    #   （`</head>` / `<body>` / `<main>` …）被整体挖掉 ⇒
    #   报出「<head> 没闭合」这种**指向错误位置**的假红。
    #   实测：这正是 `09-assets/model-viewer/demo.html` 被误报的原因。
    body = _strip_comments(src)
    body = blank_inner(body, 'script')
    body = blank_inner(body, 'style')
    assert len(body.split('\n')) == len(src.split('\n')), \
        '挖空后行数变了 ⇒ 行号会漂（这是本函数存在的唯一理由）'
    # ⚠️ 已知**假报**：源码里写 `<table><tr>`（不写 tbody）时，
    #    浏览器会自动补一个 tbody，于是 DOM 里是配平的。
    #    只看源码的标签栈会误报"table 没闭合"。
    #    浏览器实测 index.html / card 的 demo，body 都只有 1 个子元素
    #    —— **页面是对的，这个检查器是错的**。
    #    我试过在检查器里模拟浏览器补 tbody，**自己写错了**（更糟）。
    #    ⇒ 决定：不修这个检查器，**权威判据是浏览器**（axe + DOM 结构）。
    #    本门禁只当"明显破损"的粗筛。
    stack = []
    for i, m in enumerate(TAG.finditer(body)):
        closing, tag, selfclose = m.group(1), m.group(2).lower(), m.group(4)
        if tag in VOID or selfclose or tag == '!doctype':
            continue
        line = body[:m.start()].count('\n') + 1
        if closing:
            if not stack:
                return [('多余的 </%s>' % tag, line)]
            top, tline = stack.pop()
            if top != tag:
                return [('期望 </%s>（开在 L%d），实际 </%s>'
                         % (top, tline, tag), line)]
        else:
            stack.append((tag, line))
    if stack:
        return [('<%s> 没有闭合' % t, ln) for t, ln in stack]
    return []


def _targets(root):
    files = sorted(glob.glob(os.path.join(root, '0*', '**', '*.html'),
                             recursive=True))
    files += [os.path.join(root, 'index.html')]
    return [f for f in files if os.path.isfile(f)]


def main():
    # 🔴 位置参数要**过滤掉选项**（0.8.9 修）：
    #   `sys.argv[1]` 直接当路径 ⇒ `--selftest` / `--strict` 会被
    #   `abspath('--selftest')` 变成一个不存在的目录 ⇒ 扫到 0 个文件 ⇒
    #   判「全部配平」⇒ **假绿**。
    #   （同类 bug 在 dead-class-gate 里实测踩过一次。）
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    root = os.path.abspath(args[0]) if args else ROOT
    files = _targets(root)

    # 🔴 零视野守卫：一个 HTML 都没扫到 ⇒ 不许判通过
    if not files:
        print('  [FAIL] 一个 HTML 都没扫到（root=%s）⇒ 视野已空，不许判通过'
              % root)
        return 1

    bad = 0
    for f in files:
        errs = check(f)
        rel = os.path.relpath(f, root).replace(os.sep, '/')
        if errs:
            bad += 1
            # 🔴 必须把**出错那一行**也打出来（0.8.9 加）：
            #   原来只打消息，而消息里嵌的是"标签**开**在哪一行"。
            #   ⇒ 拿到提示的人知道"谁没闭合"，但不知道"在哪撞上的"，
            #     还得自己找一遍。一个报不全位置的判据等于半残。
            msg, line = errs[0]
            print('  [FAIL] %-44s L%-5d %s' % (rel, line, msg))
        else:
            print('  [OK  ] %-44s 标签配平' % rel)
    print('')
    if bad:
        print('%d 个文件标签不配平 —— 浏览器会自动纠正，但那是"静默失效"。' % bad)
        print('（行号已对齐**源文件**；早先报的是"剥离后文本"的坐标，定位不到。）')
        return 1
    print('标签平衡：%d 个文件全部配平。' % len(files))
    return 0


# ---------------------------------------------------------------------------
# 反向控制（本库纪律：没有反向控制的判据不算门禁）
# 三条判据：
#   ① 未闭合的标签必须被抓到
#   ② 收尾标签**串位**（`<main>…</div>`）必须被抓到 —— 这正是实测那 4 个
#      文件的形状，也是 axe 抓不到的那一类
#   ③ 行号必须**指向源文件**里那一行（早先的版本做不到）
# ---------------------------------------------------------------------------
def _selftest():
    import tempfile
    tmp = tempfile.mkdtemp(prefix='tagbal-')
    bad = 0

    def run(name, text, expect_err=True, expect_line=None):
        nonlocal bad
        p = os.path.join(tmp, name)
        open(p, 'w', encoding='utf-8', newline='').write(text)
        errs = check(p)
        ok = bool(errs) == expect_err
        print('  %s %s' % ('OK ' if ok else '🔴 ', name))
        if not ok:
            print('       errs=%r' % (errs,))
            bad += 1
            return
        if expect_err and expect_line is not None and errs:
            got_line = errs[0][1]
            ok2 = got_line == expect_line
            print('  %s    行号 %d（期望 %d）%s'
                  % ('OK ' if ok2 else '🔴 ', got_line, expect_line,
                     '' if ok2 else ' ← 行号没对齐源文件'))
            if not ok2:
                bad += 1

    # ③ 行号对齐：真问题在第 5 行（<div> 与 </main> 串位）
    run('shift.html',
        '<!DOCTYPE html>\n<html lang="zh-CN">\n<head><title>t</title></head>\n'
        '<body>\n<div>\n  <p>x</p>\n</main>\n</div>\n</body>\n</html>\n',
        True, 7)
    run('unclosed.html',
        '<!DOCTYPE html>\n<html><head><title>t</title></head>\n'
        '<body><main>\n<p>x</p>\n</body></html>\n', True)
    run('ok.html',
        '<!DOCTYPE html>\n<html><head><title>t</title></head>\n<body>\n'
        '<main>\n<p>x</p>\n</main>\n</body></html>\n', False)
    # ⚠️ 旧版会在这里失手：style/script 内的 < 与换行
    run('script-lt.html',
        '<!DOCTYPE html>\n<html><head><title>t</title></head>\n<body>\n<main>\n'
        '<script>\n  var a = 1 < 2;\n</script>\n</main>\n</body></html>\n', False)
    run('comment.html',
        '<!DOCTYPE html>\n<html><head><title>t</title></head>\n<body>\n'
        '<!-- <main> 注释里的标签不算 -->\n<main>\n<p>x</p>\n</main>\n'
        '</body></html>\n', False)
    # 🔴 这条是真实踩到的形状：注释里有一个**没有闭合的** <script ...>。
    #   剥注释与挖空的顺序反了 ⇒ 它会把后面几十行的真标签一起吞掉
    #   ⇒ 报出指向错误位置的假红（实测 model-viewer 就是这么被误报的）。
    run('comment-script.html',
        '<!DOCTYPE html>\n<html>\n<head>\n<title>t</title>\n'
        '<!-- 这里**没有** <script src="three.min.js">\n'
        '     引擎是点击后才加载的。 -->\n'
        '<link rel="stylesheet" href="a.css">\n</head>\n'
        '<body>\n<main>\n<p>x</p>\n</main>\n'
        '<script src="y.js"></script>\n</body></html>\n', False)

    print('')
    print('  ' + ('🔴 %d 条反向控制未通过' % bad if bad
                  else '反向控制全部通过 ⇒ 判据有鉴别力、行号也对齐'))
    return 1 if bad else 0


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(_selftest())
    sys.exit(main())
