#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""
ai-token-desc-gate.py — AI 令牌描述的**语义归属**门禁（E294）

============================================================================
🔴 为什么需要这一道（它和 gen-ai-contract.py --check 差在哪）
----------------------------------------------------------------------------
  `--check` 保证「JSON 和生成器一致」。它**不保证生成器是对的** ——
  生成器把 A 的注释挂到 B 头上，`--check` 照样全绿。

  0.25.2 就是这样：147 个令牌里
    · 19 个 `$description` 是 `-------- 分组名` 分隔线；
    · `--scrollbar-radius`（5px）的描述是 `hover 更深一档 · 4.06:1`
      —— 那是**上一个令牌** `--scrollbar-thumb-hov` 的尾注释。
  根因：`parse_block` 只有一个 pending_note，「同一行后面的注释」
  被当成「下一行的前导注释」⇒ 101 条尾注释各错位一位。

  这类错误对机器读者是**毒**：它拿到的是「一段真实存在、但属于别人的话」，
  比缺失更糟 —— 缺失时它会去查，错挂时它会照做。

============================================================================
判据（五条，全部可机械执行）
----------------------------------------------------------------------------
  ① 描述不许含分隔线（`----` / `====` / `****` 连续 4 个以上）
  ② 描述不许是空串（没有描述就别写这个字段，别写 ""）
  ③ 描述不许以冒号结尾，也不许是纯符号（去掉符号后不剩任何实词）
  ④ 描述长度 ≤ 400 字符（超了是"整段散文"，不是描述）
  ⑤ **归属**：每条描述必须能在**本令牌自己的相邻注释**里找到出处 ——
     只查这一条就能抓住"错位一位"这个真事故。

  ⑤ 的实现刻意不复用生成器的解析函数：它按行独立重建
     「令牌 → 相邻注释文本」，再做**去标点归一化**后的子串比对。
     复用会让两边一起错（这正是 0.25.2 的教训）。

============================================================================
反向控制（--selftest）：每条判据都要证明自己会红
----------------------------------------------------------------------------
  C1 分隔线进了描述                  ⇒ ① 红
  C2 描述改成空串                    ⇒ ② 红
  C3 描述以冒号结尾                  ⇒ ③ 红
  C4 描述超长                        ⇒ ④ 红
  C5 两个令牌的描述互换（错位一位）  ⇒ ⑤ 红
  C6 真实 tokens.json                ⇒ 必须**全绿**（否则门禁是无差别报警器）

用法
----------------------------------------------------------------------------
  python 05-audit/ai-token-desc-gate.py             # 门禁用
  python 05-audit/ai-token-desc-gate.py --selftest   # 反向控制
"""
from __future__ import annotations

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKENS_JSON = os.path.join(ROOT, 'ai', 'tokens.json')
TOKENS_CSS = os.path.join(ROOT, '01-tokens', 'tokens.css')

SEP_RUN = re.compile(r'[-=_*~]{4,}')
DECL = re.compile(r'^\s*(--[\w-]+)\s*:')
DESC_CAP = 400


def norm(s):
    """归一化：去掉所有空白与标点，只留实词字符。用于跨实现比对。"""
    return re.sub(r'[^0-9A-Za-z\u4e00-\u9fff]+', '', s or '')


def adjacent_comments(css_text):
    """
    独立重建「令牌名 → 相邻注释原文列表」。

    规则（不复用生成器的 parse_block，故意换一种写法：
    按**注释块的行范围**定位，而不是按字符流扫描）：
      · 尾注释：与本行声明同一个注释块，且块的起点在 `;` 之后
      · 前导注释：块的结束行落在声明行上方 1~2 行内（允许一个空行）
      · 一个令牌可能出现多次（浅色 :root / 暗色 :root），全部收集
    """
    lines = css_text.split('\n')

    # 1) 所有注释块 → (起始行, 结束行, 文本, 起点偏移, 终点偏移)
    blocks = []
    for m in re.finditer(r'/\*.*?\*/', css_text, re.S):
        s, e = m.start(), m.end()
        sl = css_text.count('\n', 0, s)
        el = css_text.count('\n', 0, e)
        blocks.append((sl, el, m.group(0)[2:-2], s, e))

    # 2) 每行的起始偏移，用来判断"在 ; 之后"
    line_start = [0]
    for ln in lines:
        line_start.append(line_start[-1] + len(ln) + 1)

    out = {}

    def push(name, text):
        if text and text.strip():
            out.setdefault(name, []).append(text)

    # 🔴 一个注释块是"尾注释"还是"前导注释"，取决于它在**自己那一行**的位置：
    #    起点在 `;` 之后 ⇒ 它属于那一行的声明（尾注释），
    #    **不能**再算作下一行的前导注释 —— 否则错位一位的 bug 在门禁里同样隐身
    #    （实测：0.25.2 的数据上 ⑤ 一条都抓不到，只剩 ① 在报分隔线）。
    def is_trailing_of_own_line(sl, s):
        ln = lines[sl] if sl < len(lines) else ''
        semi = ln.find(';')
        if semi < 0:
            return False
        return s > line_start[sl] + semi

    for i, ln in enumerate(lines):
        m = DECL.match(ln)
        if not m:
            continue
        name = m.group(1)
        semi = ln.find(';')
        semi_off = line_start[i] + (semi if semi >= 0 else len(ln))

        for sl, el, text, s, e in blocks:
            if sl == i and s > semi_off:
                push(name, text)                    # 本行的尾注释
            elif el in (i - 1, i - 2) and e <= line_start[i] \
                    and not is_trailing_of_own_line(sl, s):
                push(name, text)                    # 真正的前导注释
    return out


def check(data, adjacent):
    """返回 [(令牌, 判据编号, 说明)]。"""
    errs = []
    sets = data.get('sets') or {}
    for sk in ('light', 'dark'):
        for name, tok in sorted((sets.get(sk) or {}).items()):
            if '$description' not in tok:
                continue
            d = tok.get('$description')
            tag = '%s/%s' % (sk, name)
            if not isinstance(d, str):
                errs.append((tag, '②', '描述不是字符串'))
                continue
            if SEP_RUN.search(d):
                errs.append((tag, '①', '描述里有分隔线：%r' % d[:60]))
            if not d.strip():
                errs.append((tag, '②', '空描述（没有就别写这个字段）'))
                continue
            if d.rstrip().endswith(('：', ':')):
                errs.append((tag, '③', '描述以冒号结尾（半句话）：%r' % d[-30:]))
            elif len(norm(d)) <= 1:
                errs.append((tag, '③', '描述只有符号，没有实词：%r' % d))
            if len(d) > DESC_CAP:
                errs.append((tag, '④', '描述 %d 字符 > %d' % (len(d), DESC_CAP)))
            # ---- ⑤ 归属
            cands = []
            for n in (name, '--raw-' + name.lstrip('-')):
                cands.extend(adjacent.get(n) or [])
            hay = norm(' '.join(cands))
            key = norm(d)[:24]
            if not key:
                continue
            if key not in hay:
                got = '（该令牌没有任何相邻注释）' if not cands else \
                      '（相邻注释是：%r）' % norm(' '.join(cands))[:60]
                errs.append((tag, '⑤', '描述不是这两个邻近注释的内容 %s：%r'
                             % (got, d[:60])))
    return errs


def load():
    with io.open(TOKENS_JSON, encoding='utf-8') as f:
        data = json.load(f)
    with io.open(TOKENS_CSS, encoding='utf-8') as f:
        css = f.read()
    return data, adjacent_comments(css)


# --------------------------------------------------------------- 反向控制
def selftest():
    data, adj = load()
    ok = True

    def run_case(tag, mutate, want):
        nonlocal ok
        d = json.loads(json.dumps(data))
        mutate(d)
        errs = check(d, adj)
        hit = [e for e in errs if e[1] == want]
        good = bool(hit)
        print('    %s %s → 判据%s %s'
              % ('OK  ' if good else 'X   ', tag, want,
                 '如期变红（%d 条）' % len(hit) if good else '**没有变红**'))
        if not good:
            ok = False

    def c1(d):
        d['sets']['light']['--paper']['$description'] = '-------------------- 基底'
    def c2(d):
        d['sets']['light']['--surface']['$description'] = '   '
    def c3(d):
        d['sets']['light']['--dir-up']['$description'] = '方向令牌如下：'
    def c4(d):
        d['sets']['light']['--text-primary']['$description'] = '说明' * 250
    def c5(d):
        a = d['sets']['light']['--scrollbar-thumb'].get('$description')
        b = d['sets']['light']['--scrollbar-radius'].get('$description')
        d['sets']['light']['--scrollbar-thumb']['$description'] = b or '无'
        d['sets']['light']['--scrollbar-radius']['$description'] = a or '无'

    print('  === 反向控制 ===')
    run_case('C1 分隔线进描述', c1, '①')
    run_case('C2 描述改成空白', c2, '②')
    run_case('C3 描述以冒号结尾', c3, '③')
    run_case('C4 描述超长', c4, '④')
    run_case('C5 两个令牌描述互换', c5, '⑤')

    # C6 正向控制：真实数据必须全绿，否则门禁只是无差别报警器
    real = check(data, adj)
    print('    %s C6 真实 tokens.json → %s'
          % ('OK  ' if not real else 'X   ',
             '全绿' if not real else '**有 %d 条误报**' % len(real)))
    if real:
        ok = False
        for e in real[:5]:
            print('         ', e)

    print('')
    print('  ✅ 五条判据全部有牙，且不误伤真实数据' if ok else '  ❌ 反向控制未通过')
    return 0 if ok else 1


def main():
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    data, adj = load()
    errs = check(data, adj)
    total = sum(len(tok and [1] or []) for s in ('light', 'dark')
                for tok in (data['sets'].get(s) or {}).values()
                if '$description' in tok)
    print('')
    print('  === AI 令牌描述归属 ===')
    if errs:
        for tag, rule, msg in errs[:40]:
            print('    X [%s] %-26s %s' % (rule, tag, msg))
        if len(errs) > 40:
            print('    … 还有 %d 条' % (len(errs) - 40))
    else:
        print('    OK %d 条描述：无分隔线 · 无空串 · 无半句话 · 归属全部对得上'
              % total)
    print('')
    if errs:
        print('  ❌ %d 条描述不满足' % len(errs))
        sys.exit(1)
    print('  ✅ 令牌描述与令牌本身对得上')
    sys.exit(0)


if __name__ == '__main__':
    main()
