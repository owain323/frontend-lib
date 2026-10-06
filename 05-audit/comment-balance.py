#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
comment-balance.py — 注释配平门禁（ H2 的副产品）

===========================================================================
🔴 为什么必须有这个门禁（本项目最隐蔽的一类 bug）
---------------------------------------------------------------------------
  2026-10-06 实测发现：`tokens.css` 里有**三处**注释问题，
  它们的**共同后果**是「浏览器把整段 CSS 静默丢弃」：

    ① 亮色 `:root` 块里有**一个多余的 `*/`**（L104 提前闭合了 L103 的注释）
       ⇒ L105 的说明文字变成"裸字符"
       ⇒ 浏览器解析到那里时状态错乱，**`:root` 只剩 8 条声明**
       ⇒ `--accent` / `--surface` 等几十个令牌**全部丢失**

    ② 暗色段的注释从 L665 一直到**文件末尾都没闭合**
       ⇒ 暗色的 `:root` 块被整个吞掉

    ③ 暗色段的令牌是**裸声明**（没有 `:root {` 包裹）
       ⇒ 同样被丢弃

  ⛔ 三处**都不报错**：CSS 合法加载，控制台干净，页面能显示。
  ⛔ 三处都让 `check-all.sh` **全绿**（因为所有门禁都在"假装测暗色"）。

  ⇒ 这类 bug 只能靠**机械检查注释配平**发现。

===========================================================================
判据
---------------------------------------------------------------------------
  ① 全文 `/*` 与 `*/` 数量相等（且无"多余的 */"）
  ② CSS：每个 `@media` 块**内部至少有 1 条规则**
     （0 条 = 内容被注释吞掉了 —— 这是本 bug 最直接的特征）
  ③ CSS：`:root` 块的声明数 >= 30
     （正常应 60+；< 30 说明块被提前闭合）
"""
import sys
import os
import io
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def scan_comments(text):
    """返回 (末尾深度, 多余的 */ 个数, 未闭合的起始行)"""
    d = 0
    stray = 0
    last_open = None
    ln = 1
    k = 0
    n = len(text)
    while k < n:
        if text[k] == '\n':
            ln += 1
        if text[k:k + 2] == '/*':
            d += 1
            if d == 1:
                last_open = ln
            k += 2
            continue
        if text[k:k + 2] == '*/':
            d -= 1
            if d < 0:
                stray += 1
                d = 0
                last_open = None
            k += 2
            continue
        k += 1
    return d, stray, last_open


def check_css(path):
    """CSS 专用：查 @media 空块 + :root 声明数"""
    text = io.open(path, encoding='utf-8').read()
    problems = []

    # ① 注释配平
    d, stray, at = scan_comments(text)
    if d != 0:
        problems.append('注释未闭合（从 L%s 开始就没关掉）⇒ 后面全部被浏览器当注释丢弃'
                        % (at or '?'))
    if stray:
        problems.append('有 %d 个多余的 `*/`（对应行内容变成"裸字符"，'
                        '会让浏览器解析状态错乱）' % stray)

    if d != 0 or stray:
        return problems   # 注释乱时后面的检查没意义

    # ② @media 块内是否有规则（用简易括号匹配，够用）
    lines = text.split('\n')
    i = 0
    while i < len(lines):
        if '@media' in lines[i] and lines[i].rstrip().endswith('{'):
            depth = 1
            j = i + 1
            has_rule = False
            while j < len(lines) and depth > 0:
                t = lines[j].strip()
                if not t or t.startswith('/*') or t.startswith('*'):
                    j += 1
                    continue
                if t.endswith('{'):
                    depth += 1
                    has_rule = True
                elif t == '}':
                    depth -= 1
                elif ':' in t and not t.startswith('--'):
                    has_rule = True   # 块内的属性声明
                j += 1
            if not has_rule:
                cond = lines[i].strip()[:40]
                problems.append('L%d 的 @media %s **内含 0 条规则** '
                                '⇒ 内容被注释吞掉了' % (i + 1, cond))
            i = j
            continue
        i += 1

    # ③ 孤儿声明检测（比「某 :root 只有 N 条」准得多）
    #    ⭐ 判据：文件里 --xxx: 声明总数 vs **规则块内**的声明数。
    #      差得多 ⇒ 有一堆声明在块外（浏览器会静默丢弃）。
    #    ⚠️ 不能用「声明数 < 30」来判 ——
    #       组件私有的小 :root（accordion 只有 2 条）是**故意的**。
    import re
    plain = re.sub(r'/[*].*?[*]/', '', text, flags=re.S)
    NL = chr(10)
    total_decl = len(re.findall(r'^\s*--[a-z0-9-]+\s*:', plain, flags=re.M))
    inside = 0
    depth = 0
    for line in plain.split(NL):
        st = line.strip()
        if st.endswith('{'):
            depth += 1
        elif st == '}':
            depth = max(0, depth - 1)
        elif st.startswith('--') and depth > 0:
            inside += 1
    orphan = total_decl - inside
    if total_decl >= 10 and orphan > 5:
        problems.append('有 %d 个 --xxx: 声明在**规则块外**（%d 个在块内）'
                        ' ⇒ 浏览器会静默丢弃它们（块被提前闭合的典型症状）'
                        % (orphan, inside))

    return problems


def check_generic(path):
    """HTML/JS：只查注释配平"""
    text = io.open(path, encoding='utf-8').read()
    d, stray, at = scan_comments(text)
    p = []
    if d != 0:
        p.append('注释未闭合（从 L%s 开始）' % (at or '?'))
    if stray:
        p.append('有 %d 个多余的 `*/`' % stray)
    return p


def main():
    files = (glob.glob(os.path.join(ROOT, '0*', '*', '*.css')) +
             glob.glob(os.path.join(ROOT, '0*', '*', '*.html')) +
             glob.glob(os.path.join(ROOT, '0*', '*', '*.js')) +
             glob.glob(os.path.join(ROOT, '05-audit', '*.js')))
    files = [f for f in files if os.path.isfile(f)]

    bad = 0
    for f in sorted(files):
        rel = os.path.relpath(f, ROOT)
        try:
            probs = check_css(f) if f.endswith('.css') else check_generic(f)
        except Exception as e:
            probs = ['读取失败：%s' % str(e)[:50]]
        if probs:
            bad += 1
            print('  FAIL  %s' % rel)
            for x in probs:
                print('        - %s' % x)

    print('  扫了 %d 个文件，%d 个有问题' % (len(files), bad))
    if bad:
        print('')
        print('  ⇒ 🔴 这类 bug 不报错、页面能显示、门禁全绿 —— 但功能已经坏了。')
        print('    2026-10-06：`tokens.css` 因此丢了全部暗色令牌 + 一半亮色令牌。')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
