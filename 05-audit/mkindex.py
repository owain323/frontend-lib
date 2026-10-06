#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mkindex.py — 生成演示站的入口页（自动列出所有可点开的页面）

用途：`/demo/` 是给人在手机上翻的入口，不该让人猜路径。
"""
import io
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'index.html')
SKIP = ('05-audit', '07-notes', '08-plan', '.git')

TPL = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>frontend-lib · 演示</title>
<link rel="stylesheet" href="01-tokens/tokens.css">
<style>
  body { min-height:100vh; margin:0;
    padding: calc(env(safe-area-inset-top) + var(--sp-6)) max(env(safe-area-inset-right), var(--sp-4))
             calc(env(safe-area-inset-bottom) + var(--sp-6)) max(env(safe-area-inset-left), var(--sp-4));
    background: var(--paper); color: var(--text-primary); }
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { font-size: var(--fs-2xl); line-height: var(--lh-tight); margin: 0 0 var(--sp-2); }
  .lede { color: var(--text-secondary); margin: 0 0 var(--sp-5); max-width: 60ch; }
  h2 { font-size: var(--fs-lg); margin: var(--sp-6) 0 var(--sp-2);
       padding-top: var(--sp-4); border-top: 1px solid var(--border-decor); }
  ul { list-style:none; padding:0; margin:0; }
  li { padding: var(--sp-2) 0; border-bottom: 1px solid var(--border-decor); }
  a { color: var(--accent); text-decoration: none; display: block; }
  a:active { background: var(--surface-sunken); }
  code { font-family: var(--mono); font-size: var(--fs-sm); }
  .first { background: var(--surface-sunken); border: 1px solid var(--border-control);
           border-radius: var(--r-md); padding: var(--sp-4); margin: 0 0 var(--sp-5); }
  .first a { font-weight: 600; }
  .note { font-size: var(--fs-xs); color: var(--text-secondary); }
</style>
<link rel="stylesheet" href="03-patterns/nav/nav.css">
</head>
<body>
<!-- 🔴 2026-10-04 补（a11y-scan 报 landmark-one-main / region 两违规）：
     入口页必须有 <main> 地标，并提供"跳到主内容"的 skip link
     （WCAG 2.4.1 Bypass Blocks）—— 键盘用户按一次 Tab 就能跳过导航。
     ⚠️ 这段必须写在**生成器**里，否则每次重新生成 index.html 都会被覆盖。 -->
<a href="#main" class="skip">跳到主内容</a>
<main id="main" class="wrap">
  <h1>frontend-lib · 演示</h1>
  <p class="lede">
    零依赖前端组件库。全部页面可点开，<strong>在手机上直接看也可以</strong>。
  </p>

  <div class="first">
    <p style="margin:0 0 var(--sp-2)"><strong>建议先看这个</strong></p>
    <a href="10-review/ios/index.html">iOS 验证页（十项，Safari 专用）</a>
    <p class="note" style="margin:var(--sp-2) 0 0">
      按钮 / 输入框 / 开关 / 单选 / 标签页 / 折叠 / 弹窗 / 趋势图 / 徽章 / 暗色
      —— 每节都写了「该看到什么」。
    </p>
  
  <h2>全部页面</h2>
  <ul>
__LINKS__
  </ul>
</div>
</main>
</body>
</html>
'''


def main():
    rows = []
    for dirpath, dirs, files in os.walk(ROOT):
        rel_dir = os.path.relpath(dirpath, ROOT).replace(os.sep, '/')
        if rel_dir == '.':
            rel_dir = ''
        if any(s in rel_dir for s in SKIP):
            continue
        for f in files:
            if f not in ('demo.html', 'index.html'):
                continue
            p = (rel_dir + '/' + f) if rel_dir else f
            if any(s in p for s in SKIP):
                continue
            if p.startswith('index') and rel_dir == '':
                continue          # 入口页自己不放自己的链接
            rows.append(p)
    rows.sort()
    links = '\n'.join(
        '    <li><a href="%s"><code>%s</code></a></li>' % (p, p) for p in rows)
    io.open(OUT, 'w', encoding='utf-8').write(TPL.replace('__LINKS__', links))
    print('  ✓ 入口页已生成：%s（%d 个链接）' % (OUT, len(rows)))


if __name__ == '__main__':
    main()
