#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cascade-layer-gate.py — 级联分层（`@layer`）的**就绪**门控

============================================================================
🔴 为什么这道门禁存在
----------------------------------------------------------------------------
对标 Web Awesome 时学到：`@layer` 能直接拆掉「使用者加 `!important`」的动机，
因为**未分层样式永远赢过已分层样式，与特异性无关**。

但我们**没有切**，理由是目标环境（移动 WebView）的基线没确认。
⇒ 「不切」如果不加门控，就会退化成一句永远没人执行的话。

这道门禁把「不切」变成**可判的状态**：

  ① 交付 CSS 里 `@layer` 计数为 0 ⇒ 维持现状，只做分类体检
  ② 一旦出现第一条 `@layer` ⇒ 要求三条前提的实测记录已落档，否则红
  ③ 交付 CSS 里的每一处 `!important` 必须**可分类**（无障碍 / 正确性），
     分不了类的 ⇒ 红

============================================================================
③ 为什么是「分类」而不是「清零」
----------------------------------------------------------------------------
第一版我写的是「`!important` 必须为 0」。实测后发现这个判据是**错的**：

  全库 11 处命中里，**10 处真声明**，且全部正当 ——
    · 6 处在 `@media (prefers-reduced-motion: reduce)` 里（无障碍，必须赢）
    · 1 处是 `[hidden] { display: none }`（正确性，必须赢）
  剩下 1 处是**注释里的文本**（`修法：显式声明 hidden 时用 ... !important`）

⇒ 清零会逼人删掉无障碍兜底，那是**把门禁变成破坏正确性**。

⭐ 真正要防的不是「有 `!important`」，而是「**说不清为什么要赢** 的 `!important`」。
   ⇒ 判据改成：**每一处都要能被归到一个已批准的理由**。

   ⚠️ 顺带记一条：`@layer` 下 `!important` 的层序是**反的** ——
      库在早层里的 `!important` 会赢过使用者的 `!important`。
      对 reduced-motion 这类"操作系统级偏好"来说这**恰恰是对的**，
      所以它们不该被清零；但对"图省事"的 `!important` 来说是不可接受的。

============================================================================
④ 为什么不用正则扫描
----------------------------------------------------------------------------
见 `INVARIANT.md` I-11：正则不是解析器。
`grep '!important'` 会把注释里的文本也算进来（实测 11 处里有 1 处就是）。
⇒ 本脚本逐字符遍历，跳过注释与字符串；上下文（`@media` / 选择器）用**括号栈**取。

============================================================================
用法
----------------------------------------------------------------------------
    python 05-audit/cascade-layer-gate.py            # 体检
    python 05-audit/cascade-layer-gate.py --selftest # 反向控制

============================================================================
"""
from __future__ import annotations

import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _css import find_block  # noqa: E402
from _common import walk_filtered  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS_DIRS = ('01-tokens', '02-primitives', '03-patterns', '04-recipes')
BASELINE_DOC = os.path.join(ROOT, 'docs', 'LAYER-BASELINE.md')

# 已批准的分类：命中即放行，并写清"它凭什么必须赢"
A11Y_MEDIA = ('prefers-reduced-motion', 'prefers-contrast', 'forced-colors')


def css_files():
    out = []
    for d in CSS_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, _dirnames, filenames in walk_filtered(base):
            for f in sorted(filenames):
                if f.endswith('.css'):
                    out.append(os.path.join(dirpath, f))
    return sorted(out)


def _mask(css, a, b, spans):
    """
    取 css[a:b] 但把落在其中的字符串区间抠掉。

    ⚠️ 为什么不能「跳过字符串时直接把 last 推到字符串之后」：
       那样选择器 `[data-open='true']` 的前导会被截成 `]`，
       `@media` 与 `[hidden]` 的分类就全废了。
       ⇒ 正解是**保留原文结构**，只在判断时把字符串抠掉。
    """
    out = []
    prev = a
    for s, e in spans:
        if s >= b or e <= a:
            continue
        s = max(s, a)
        e = min(e, b)
        if s > prev:
            out.append(css[prev:s])
        prev = e
    if prev < b:
        out.append(css[prev:b])
    return ''.join(out)


def walk(css, start, stop, ctx, sink, base=0, preludes=None):
    """
    产出 (declaration, ctx_stack)。逐字符，跳过注释与字符串。

    preludes：额外收集所有**块前导**（用来找 `@layer`）。
    ⚠️ 不能对原文做 `text.find('@layer')` —— 那会把注释里的 `@layer` 也算进来，
       与 `!important` 是同一类假命中。前导只在**真正的块起点**产生。


    ctx 是**括号栈**：外层在前、内层在后。
    ⇒ 判断 `@media` 只需看栈里有没有 media 前导，不用另写一遍块匹配。

    ⚠️ base：块内容的行号是**相对块内**的，直接 count 会全报成第 1 行
       （实测：tokens.css 四处全显示 :1）。递归时把块起点在原文中的
       偏移传进来，行号才是文件真实行号。
    """
    i, last = start, start
    spans = []
    while i < stop:
        ch = css[i]
        if ch == '/' and css[i:i + 2] == '/*':
            end = css.find('*/', i + 2)
            i = stop if (end < 0 or end > stop) else end + 2
            # ⚠️ 必须把 last 推到注释之后 —— 否则前导会把注释尾巴一起吃进来，
            #    `@media (...)` 变成 `/* ===== › @media (...)`，分类永远匹配不上。
            last = i
            continue
        if ch in '"\'':
            q = ch
            j = i + 1
            while j < stop:
                if css[j] == '\\':
                    j += 2
                    continue
                if css[j] == q:
                    j += 1
                    break
                j += 1
            spans.append((i, j))
            i = j
            continue
        if ch == '{':
            prelude = ' '.join(_mask(css, last, i, spans).split())
            if preludes is not None:
                preludes.append({
                    'line': css.count('\n', 0, base + last) + 1,
                    'text': prelude,
                })
            body, nxt = find_block(css, i)
            walk(body, 0, len(body), ctx + [prelude], sink, base + i + 1,
                 preludes)
            i = last = nxt
            spans = []
            continue
        if ch == ';':
            decl = ' '.join(_mask(css, last, i, spans).split())
            if '!important' in decl:
                line = css.count('\n', 0, base + last) + 1
                sink.append({
                    'line': line,
                    'decl': decl,
                    'ctx': list(ctx),
                })
            last = i + 1
            spans = []
        elif ch == '}':
            last = i + 1
            spans = []
        i += 1


def classify(hit):
    """
    归到一个已批准的理由；归不了就返回 None（⇒ 红）。
    """
    for prelude in hit['ctx']:
        low = prelude.lower()
        if low.startswith('@media') and any(m in low for m in A11Y_MEDIA):
            return '无障碍偏好（%s）—— 操作系统级偏好必须赢' % prelude.strip()
    for prelude in reversed(hit['ctx']):
        if '[hidden]' in prelude.lower():
            return '正确性（`[hidden]` 必须真的隐藏）'
    return None


def scan():
    """返回 (layers, hits) —— layers 是 `@layer` 出现处，hits 是 !important 命中。"""
    layers, hits = [], []
    for path in css_files():
        text = io.open(path, encoding='utf-8').read()
        rel = os.path.relpath(path, ROOT).replace(os.sep, '/')
        sink, preludes = [], []
        walk(text, 0, len(text), [], sink, 0, preludes)
        for h in sink:
            h['file'] = rel
            hits.append(h)
        for p in preludes:
            if p['text'].startswith('@layer'):
                layers.append({'file': rel, 'line': p['line'],
                               'text': p['text']})
    return layers, hits


def check(layers, hits):
    """判据。返回 (问题列表, 分类结果)。"""
    problems = []
    kinds = {}
    for h in hits:
        why = classify(h)
        if why is None:
            problems.append(
                '%s:%d 有无法归类的 `!important`：`%s`\n'
                '      上下文：%s\n'
                '      ⇒ 分层后它的层序会反转并压过使用者的 `!important`。'
                '      要么归到一个已批准理由（无障碍偏好 / `[hidden]` 正确性），'
                '要么改用特异性解决。'
                % (h['file'], h['line'], h['decl'][:60],
                   ' › '.join(c.strip()[:40] for c in h['ctx'][-2:]) or '(顶层)'))
        else:
            kinds.setdefault(why, []).append(h)

    if layers:
        if not os.path.isfile(BASELINE_DOC):
            problems.append(
                '已出现 %d 处 `@layer`（首处：%s:%d），但 `%s` 不存在。\n'
                '      ⇒ 分层前必须先落档：① WebView 基线实测 ② 全量视觉回归记录。\n'
                '      这两条没落档就切分层，等于拿使用者的线上页面去赌。'
                % (len(layers), layers[0]['file'], layers[0]['line'],
                   os.path.relpath(BASELINE_DOC, ROOT)))
    return problems, kinds


def selftest():
    """反向控制：每条判据都必须证明自己会红。"""
    print('  === cascade-layer-gate 反向控制 ===')
    ok = True

    # ⚠️ ok 是外层变量，run 里只**读改**它，不能再赋值
    #    （第一版在 run 里 `ok = False` ⇒ UnboundLocalError，自检自己崩了）
    def run(text, why, should_fail):
        sink, preludes = [], []
        walk(text, 0, len(text), [], sink, 0, preludes)
        for h in sink:
            h['file'] = 'fixture.css'
        probs, _ = check([], sink)
        got = bool(probs)
        good = (got == should_fail)
        print('  [%s] %-22s 期望%s ⇒ 实际%s %s'
              % ('OK ' if good else 'FAIL', why,
                 '红' if should_fail else '绿', '红' if got else '绿',
                 probs[0].split('\n')[0][:44] if probs else ''))
        return good

    cases = [
        # ① 无法归类 ⇒ 红
        ('.a { padding: 4px !important; }', '无理由的 !important', True),
        # ② 无障碍 media ⇒ 绿
        ('@media (prefers-reduced-motion: reduce) { .a {\n'
         '  animation-duration: 0.01ms !important; } }', 'reduced-motion 内', False),
        # ③ [hidden] 正确性 ⇒ 绿
        ('.p[hidden] { display: none !important; }', '[hidden] 正确性', False),
        # ④ 注释里的文本 ⇒ 不算命中（grep 会假命中那条）
        ('/* 修法：用 display: none !important */\n.a { color: red; }',
         '注释里的文本', False),
        # ⑤ 字符串里的文本 ⇒ 不算命中
        ('.a::after { content: "x !important"; }', '字符串里的文本', False),
        # ⑥ 前导带注释前缀时仍能正确分类（曾因 last 未推进而失败）
        ('/* 说明 */\n@media (prefers-reduced-motion: reduce) {\n'
         '  .a { animation-duration: 0.01ms !important; } }',
         '注释后紧跟 media', False),
    ]
    for text, why, should in cases:
        if not run(text, why, should):
            ok = False

    # ⑦ 出现 @layer 但没有基线档 ⇒ 红
    probs, _ = check([{'file': 'a.css', 'line': 1, 'text': '@layer fl-base'}], [])
    good = bool(probs)
    if not good:
        ok = False
    print('  [%s] %-22s 期望红 ⇒ 实际%s'
          % ('OK ' if good else 'FAIL', '切层但无基线档', '红' if good else '绿'))
    return 0 if ok else 1


def main():
    if '--selftest' in sys.argv:
        return selftest()

    layers, hits = scan()
    problems, kinds = check(layers, hits)

    print('  === 级联分层就绪检查 ===')
    print('     交付 CSS：%d 个文件' % len(css_files()))
    print('     `@layer`：%d 处' % len(layers))
    print('     `!important`：%d 处（已排除注释与字符串）' % len(hits))
    for why, hs in sorted(kinds.items()):
        print('       · %d 处 —— %s' % (len(hs), why))
    if not hits:
        print('       （无）')
    print()

    if problems:
        for p in problems:
            print('  [FAIL] %s' % p)
        print('\n  共 %d 处问题' % len(problems))
        return 1
    print('  [OK] 分层就绪状态自洽')
    return 0


if __name__ == '__main__':
    sys.exit(main())
