#!/usr/bin/env python3
"""组件之间不许有 CSS @import。

本库对外的一句承诺是「拷一个组件的样式表就能用」。这句话成立的前提
就是组件 CSS 之间没有 @import —— 一旦有，用户拷了 A 却没拷 B，
页面上不会报错、不会警告，只会少掉一部分样式。

注释里出现的 @import 不算：`01-tokens/tokens.css` 的注释正在教用户
怎么 @import 我们的文件，那是文档，不是依赖。
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCAN_DIRS = ('01-tokens', '02-primitives', '03-patterns', '04-recipes', '09-assets')
COMMENT_RE = re.compile(r'/\*.*?\*/', re.S)
IMPORT_RE = re.compile(r'@import\b')


def strip_comments(css):
    """把注释挖成空格（保留换行，行号才对得上）。"""
    def blank(m):
        return re.sub(r'[^\n]', ' ', m.group(0))
    return COMMENT_RE.sub(blank, css)


def find_imports(css):
    """返回 (行号, 原文行) 列表，只看注释之外的部分。"""
    clean = strip_comments(css).split('\n')
    raw = css.split('\n')
    return [(i + 1, raw[i].strip()) for i, line in enumerate(clean)
            if IMPORT_RE.search(line)]


def scan(root=ROOT):
    hits, n = [], 0
    for d in SCAN_DIRS:
        base_dir = os.path.join(root, d)
        for base, dirs, names in os.walk(base_dir):
            dirs[:] = [x for x in dirs if x not in ('node_modules', '.git')]
            for name in sorted(names):
                if not name.endswith('.css'):
                    continue
                n += 1
                path = os.path.join(base, name)
                with io.open(path, encoding='utf-8') as f:
                    for ln, text in find_imports(f.read()):
                        hits.append((os.path.relpath(path, root).replace('\\', '/'),
                                     ln, text))
    return n, hits


# ===========================================================================
# 自检
# ===========================================================================

def selftest():
    bad = 0

    def chk(note, css, want):
        nonlocal bad
        got = bool(find_imports(css))
        if got != want:
            bad += 1
            print('  [FAIL] %s（期望 %s，实际 %s）' % (note, want, got))

    chk('裸 @import 必须报', '@import url("a.css");\n', True)
    chk('注释里的 @import 不许报',
        '/*\n  用法：@import url("tokens.css");\n*/\na { color: red }\n', False)
    chk('行尾注释里的 @import 不许报',
        'a { color: red } /* 见 @import 说明 */\n', False)
    chk('干净文件不许报', 'a { color: var(--text) }\n', False)
    chk('注释后的真 @import 要报',
        '/* @import 是禁止的 */\n@import url("b.css");\n', True)

    # 挖注释必须保留行号：第 5 行的 @import 要报成 5
    css = '/*\n\n\n*/\n@import url("c.css");\n'
    got = [ln for ln, _t in find_imports(css)]
    if got != [5]:
        bad += 1
        print('  [FAIL] 行号被注释吃掉：期望 [5]，实际 %s' % got)

    if bad == 0:
        print('  自检全部通过（真 @import 报 / 注释里的不报 / 行号不漂）')
    return bad


# ===========================================================================

def main():
    if '--selftest' in sys.argv:
        return 1 if selftest() else 0

    n, hits = scan()
    if n == 0:
        print('[FAIL] 一个 CSS 都没扫到 —— 视野已空，不许通过')
        return 1
    if hits:
        print('[FAIL] 组件之间有 CSS @import（「拷一个文件就能用」会失效）：')
        for path, ln, text in hits[:20]:
            print('  %s:%d  %s' % (path, ln, text[:80]))
        print('  ⇒ 组件的样式表只能依赖 01-tokens 的令牌，不能 import 别的组件')
        return 1
    print('[OK] %d 个 CSS 文件，零跨组件 @import' % n)
    return 0


if __name__ == '__main__':
    sys.exit(main())
