#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
theme-sync.py — 明暗配色的**唯一真值**同步门禁

============================================================================
🔴 它取代了 gen-theme-js.py，原因
----------------------------------------------------------------------------
旧方案：暗色靠 JS 往 `:root` 上写 **30 条 inline 属性**实现。
代价见 `docs/INVARIANT.md` I-4 ——

    inline style 的优先级高于**一切**样式表。
    使用者想覆盖 `--surface`，只能再加 `!important` 反击。

也就是说：为了让"手动开关"能用，我们把**整个配色层**抬到了样式表之上，
使用者的 CSS 从此失效。这是为了一个按钮付出的代价。

新方案（对标 Pico CSS）：**CSS 自己表达暗色，JS 只翻一个属性。**

    @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }
    :root[data-theme="dark"] { … }          ← 本脚本生成

JS 里不再有任何色值。

============================================================================
⚠️ 为什么必须有这道门禁，而不是"把两段写一样就行"
----------------------------------------------------------------------------
暗色值现在在 CSS 里出现**两遍**（`@media` 段 + `[data-theme]` 段）。
见 `docs/INVARIANT.md` I-7：**第二份手写真值必然漂移。**

旧版已经演示过一次：手写 20 个值，**17 个与 tokens.css 不一致**，
连名字都编错（`--warn` / `--danger-soft` vs 真名 `--warning` / `--danger-bg`）。

⇒ 所以 `[data-theme]` 段**必须生成**，`--check` 已接进 `check-all.sh`。

============================================================================
判据
----------------------------------------------------------------------------
  ① tokens.css 里 `[data-theme="dark"]` 段的声明，与 `@media` 暗色段**逐条一致**
  ② `theme-toggle.js` 里**不含任何色值字面量**（hex / rgb / hsl）
     —— 这是 L3-P1 的验收判据：JS 不再持有配色
  ③ `theme-toggle.js` 里**不往 `:root` 写令牌**（不再有 inline 覆盖）

============================================================================
用法
----------------------------------------------------------------------------
  python 05-audit/theme-sync.py            # 生成 [data-theme] 段
  python 05-audit/theme-sync.py --check    # 校验（已接进 check-all.sh）
  python 05-audit/theme-sync.py --selftest # 反向控制
============================================================================
"""
from __future__ import annotations

import io
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _css import find_block, parse_decls  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOK = os.path.join(ROOT, '01-tokens', 'tokens.css')
JS = os.path.join(ROOT, '01-tokens', 'theme-toggle.js')

BEGIN = '/* === BEGIN: dark-via-attr（由 05-audit/theme-sync.py 生成，勿手改）=== */'
END = '/* === END: dark-via-attr === */'

# ⚠️ 必须容忍 `:root:not([data-theme="light"])` 这种带后缀的选择器
#    （旧版写成 `:root\s*\{`，一改成 :not(...) 就整段失配）
RE_ROOT = re.compile(r':root(?![\w-])[^{]*\{')
RE_MEDIA_DARK = re.compile(r'@media[^{]*prefers-color-scheme:\s*dark[^{]*\{')

# ② 色值字面量
RE_HEX = re.compile(r'#[0-9a-fA-F]{3,8}\b')
RE_FN = re.compile(r'\b(?:rgb|rgba|hsl|hsla)\s*\(')


def collect(css):
    """抽出所有 `:root…{}` 块里的令牌（先出现的为准）。"""
    res = {}
    for m in RE_ROOT.finditer(css):
        body, _ = find_block(css, m.end() - 1)
        for name, value, _note in parse_decls(body):
            if name.startswith('--') and name not in res:
                res[name] = value
    return res


def split_region(css):
    """返回 (region_with_markers_or_None, 起, 止)。没有标记也允许（首次生成）。"""
    a = css.find(BEGIN)
    if a < 0:
        return None, -1, -1
    b = css.find(END, a)
    if b < 0:
        raise SystemExit('tokens.css 有 BEGIN 标记但没有 END 标记')
    return css[a:b + len(END)], a, b + len(END)


def dark_tokens(css):
    """从 `@media (prefers-color-scheme: dark)` 段取暗色令牌（真值来源）。"""
    m = RE_MEDIA_DARK.search(css)
    if not m:
        raise SystemExit('tokens.css 里找不到 @media (prefers-color-scheme: dark)')
    inner, _ = find_block(css, m.end() - 1)
    return collect(inner)


def build_region(dark):
    rows = '\n'.join('  %s: %s;' % (k, v) for k, v in sorted(dark.items()))
    return (BEGIN + '\n'
            ':root[data-theme="dark"] {\n' + rows + '\n}\n'
            + END)


def check_css(css):
    """① 两段逐条一致。"""
    dark = dark_tokens(css)
    region, _a, _b = split_region(css)
    if region is None:
        return ['tokens.css 缺少 `[data-theme="dark"]` 段 —— 跑 '
                'python 05-audit/theme-sync.py 生成']

    m = RE_ROOT.search(region)
    if not m:
        return ['生成段里找不到 `:root[data-theme="dark"]` 块']
    body, _ = find_block(region, m.end() - 1)
    got = {n: v for n, v, _ in parse_decls(body) if n.startswith('--')}

    problems = []
    for k in sorted(set(dark) - set(got)):
        problems.append('生成段缺令牌 %s（暗色段有 `%s`）' % (k, dark[k]))
    for k in sorted(set(got) - set(dark)):
        problems.append('生成段多令牌 %s（暗色段已无此令牌）' % k)

    def norm(v):
        return v.replace(' ', '').lower()

    for k in sorted(set(dark) & set(got)):
        if norm(dark[k]) != norm(got[k]):
            problems.append('令牌 %s 值不一致：`@media` 段是 `%s`，'
                            '生成段是 `%s`' % (k, dark[k], got[k]))
    return problems


def check_js(js):
    """②③ JS 不得持有色值、不得往 :root 写令牌。"""
    problems = []
    for m in RE_HEX.finditer(js):
        line = js.count('\n', 0, m.start()) + 1
        problems.append('theme-toggle.js:%d 有色值字面量 `%s` —— '
                        '配色必须只在 tokens.css 里' % (line, m.group(0)))
    for m in RE_FN.finditer(js):
        line = js.count('\n', 0, m.start()) + 1
        problems.append('theme-toggle.js:%d 有色值函数 `%s(` —— '
                        '配色必须只在 tokens.css 里' % (line, m.group(0)))
    if re.search(r'\.style\.setProperty\s*\(\s*[\'"]--', js):
        problems.append('theme-toggle.js 仍在往 `:root` 写令牌（inline style）'
                        ' —— 这会压过使用者的样式表，见 INVARIANT I-4')
    return problems


def generate(css):
    dark = dark_tokens(css)
    region = build_region(dark)
    old, a, b = split_region(css)
    if old is None:
        # 插到 @media 暗色段之后
        m = RE_MEDIA_DARK.search(css)
        inner, end = find_block(css, m.end() - 1)
        return css[:end] + '\n\n' + region + '\n' + css[end:]
    return css[:a] + region + css[b:]


def selftest():
    print('  === theme-sync 反向控制 ===')
    ok = True
    base_css = (
        ':root {\n  --paper: #ffffff;\n  --surface: #f6f7f8;\n}\n'
        '@media (prefers-color-scheme: dark) {\n'
        '  :root:not([data-theme="light"]) {\n'
        '    --paper: #14171a;\n    --surface: #1c2024;\n  }\n}\n')
    dark = dark_tokens(base_css)
    good_css = base_css + '\n' + build_region(dark) + '\n'

    def run(why, css, js, should_fail):
        probs = check_css(css) + check_js(js)
        got = bool(probs)
        good = (got == should_fail)
        if not good:
            print('       ↳ 实际：%s' % (probs[0] if probs else '(无)'))
        print('  [%s] %-24s 期望%s ⇒ 实际%s'
              % ('OK ' if good else 'FAIL', why,
                 '红' if should_fail else '绿', '红' if got else '绿'))
        return good

    clean_js = 'var a = 1;\nroot.setAttribute("data-theme", m);\n'

    cases = [
        ('两段一致', good_css, clean_js, False),
        ('缺生成段', base_css, clean_js, True),
        ('生成段少一个令牌',
         base_css + '\n' + BEGIN + '\n:root[data-theme="dark"] {\n'
         '  --paper: #14171a;\n}\n' + END + '\n', clean_js, True),
        ('生成段值不一致',
         base_css + '\n' + BEGIN + '\n:root[data-theme="dark"] {\n'
         '  --paper: #000000;\n  --surface: #1c2024;\n}\n' + END + '\n',
         clean_js, True),
        ('JS 有 hex 色值', good_css,
         "var c = '#14171a';\n", True),
        ('JS 有 rgba 色值', good_css,
         "var c = 'rgba(0, 0, 0, .6)';\n", True),
        ('JS 写 inline 令牌', good_css,
         "root.style.setProperty('--paper', x);\n", True),
    ]
    for why, css, js, should in cases:
        if not run(why, css, js, should):
            ok = False
    return 0 if ok else 1


def main():
    if '--selftest' in sys.argv:
        return selftest()

    css = io.open(TOK, encoding='utf-8').read()
    js = io.open(JS, encoding='utf-8').read() if os.path.isfile(JS) else ''

    if '--check' in sys.argv:
        problems = check_css(css) + check_js(js)
        dark = dark_tokens(css)
        if problems:
            for p in problems:
                print('  [FAIL] %s' % p)
            print('\n  共 %d 处 —— 跑 python 05-audit/theme-sync.py 重新生成'
                  % len(problems))
            return 1
        print('  [OK] 暗色真值同步：`@media` 段 %d 个令牌 ⇒ '
              '`[data-theme="dark"]` 段一致；JS 无配色' % len(dark))
        return 0

    new = generate(css)
    if new == css:
        print('  ✓ tokens.css 已是最新（无需改动）')
    else:
        io.open(TOK, 'w', encoding='utf-8').write(new)
        print('  ✓ 已生成 `[data-theme="dark"]` 段（%d 个令牌）'
              % len(dark_tokens(css)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
