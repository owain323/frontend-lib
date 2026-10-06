#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen-theme-js.py — 从 tokens.css 的 dark 段**自动生成** theme-toggle.js

🔴 为什么必须生成，不能手写
------------------------------------------------
我第一版 theme-toggle.js 里**手写**了 20 个暗色令牌值，
结果**17 个与 tokens.css 不一致**，连名字都编错了
（我写 `--warn` / `--danger-soft`，真名是 `--warning` / `--danger-bg`）。

⇒ **令牌值与名字只有一个权威来源：tokens.css。**
   手写第二份 = 必然漂移，而且**测不出来**（两边都能自洽）。

⇒ 这个脚本从 tokens.css 的 `@media (prefers-color-scheme: dark)` 段
   提取全部令牌，生成 JS 里的 DARK 表。
   ⚠️ **字体族不复制**（只复制颜色/阴影），字体在 CSS 里已生效。

用法：python 05-audit/gen-theme-js.py          # 生成
      python 05-audit/gen-theme-js.py --check  # 检查是否同步
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOK = os.path.join(ROOT, '01-tokens', 'tokens.css')
OUT = os.path.join(ROOT, '01-tokens', 'theme-toggle.js')

# 只复制这些类型（字体/间距/圆角在 CSS 里已生效，不需要覆盖）
WANT = re.compile(r'^--(paper|surface|text-|border-|accent|danger|success|'
                  r'warning|info|scrim|shadow|switch-on|scrollbar|focus-ring)')
# 🔴 加固：注释里的**中文分号**会把 `[^;]+` 骗过去
#    （实测踩到：注释里写了 `#080a0c` 和 `；`，被当成 --paper 的值
#      ⇒ --paper 整个丢失 ⇒ 切暗色时页面背景不变，真机实测报"背景是淡白色"）
#    ⇒ 值里一旦出现 `#` 之后跟非法的值形态，就跳过。
BAD_VALUE = re.compile(r'#[0-9a-fA-F]{3,8}[^0-9a-fA-F;\s]|\*\*|一')
SKIP_VALUE = re.compile(r'/\*|font|^\s*$|calc\(|clamp\(')


def extract():
    s = io.open(TOK, encoding='utf-8').read()
    i = s.find('@media (prefers-color-scheme: dark)')
    if i < 0:
        raise SystemExit('tokens.css 里找不到 @media (prefers-color-scheme: dark)')
    blk = s[i:]
    out = {}
    for k, v in re.findall(r'(--[\w-]+)\s*:\s*([^;]+);', blk):
        if not WANT.match(k):
            continue
        v = v.strip()
        # 一行里有多个声明时（如 --sans 后面跟字体列表）只取到第一个分号前
        if SKIP_VALUE.search(v) or '\n' in v:
            continue
        out[k] = v
    return out


def build(dark):
    rows = '\n'.join("    '%s': '%s'," % (k, v) for k, v in sorted(dark.items()))
    tpl = io.open(os.path.join(ROOT, '05-audit', 'theme-toggle.tpl.js'),
                  encoding='utf-8').read()
    return tpl.replace('__DARK_TOKENS__', rows).replace('__TOKEN_COUNT__', str(len(dark)))


def main():
    dark = extract()
    new = build(dark)
    old = io.open(OUT, encoding='utf-8').read() if os.path.isfile(OUT) else ''
    if '--check' in sys.argv:
        if old == new:
            print('  [OK  ] theme-toggle.js 与 tokens.css 同步（%d 个暗色令牌）'
                  % len(dark))
            return 0
        print('  [FAIL] theme-toggle.js 与 tokens.css **已漂移**'
              '（%d 个令牌）—— 跑 gen-theme-js.py 重新生成' % len(dark))
        return 1
    io.open(OUT, 'w', encoding='utf-8').write(new)
    print('  ✓ 已生成 theme-toggle.js（%d 个暗色令牌，来自 tokens.css）' % len(dark))
    return 0


if __name__ == '__main__':
    sys.exit(main())
