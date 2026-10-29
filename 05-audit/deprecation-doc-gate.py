#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
deprecation-doc-gate.py — 弃用政策文档 ↔ 登记册 双向一致

============================================================================
🔴 为什么需要
----------------------------------------------------------------------------
  `ai/deprecations.json` 是**机器**读的，`docs/DEPRECATIONS.md` 是**人**读的。
  两份东西描述同一件事，就一定会漂 —— 而这次漂的方向是致命的：

    · 登记册加了条目，文档没加 ⇒ 使用者读到的是"没有弃用项"，
      然后在某个版本里代码突然没了。他没有任何办法提前知道。
    · 文档写了条目，登记册没有 ⇒ 代码里**没有** `removeIn` 的记录，
      门禁 `deprecation-gate` 根本不会在到期时提醒 ⇒ 文档承诺了一个
      我们不会兑现的日期。

  第一种是"漏告知"，第二种是"假承诺"。两种都是这一维最伤的失败，
  而且它们都不会让任何测试变红 —— 只有把两份文件对起来看才会露出来。

  ⇒ 判据只有一句：**两个表格里的每一行，必须在登记册里有一一对应的条目；
     登记册里的每一条，必须在这两个表格里有一行。**字段（类型/版本/替代）
     也必须一致，否则"名字对上了、版本写错了"同样会漏告知。

============================================================================
判据（七条）
----------------------------------------------------------------------------
  ① 表 A（迁窗中）的行 ↔ `planned` 里 `removeIn > VERSION` 的条目，双向
  ② 表 B（已移除）的行 ↔ `retroactive` + `planned` 里 `removeIn ≤ VERSION`，双向
  ③ 每行的 `类型` ∈ token / class / api / event
  ④ 每行的版本号与登记册逐字相同（`0.8.0` 写成 `0.8` 也算错）
  ⑤ 每行的 `替代` 与登记册的 `replacement` 一致（`——` 表示 null）
  ⑥ 文档必须声明迁移窗口，且与 `policy.minLead` 说的是同一个窗口
  ⑦ 表 A / 表 B 的占位行（`（无）`）必须有说明文字，不许只留空表

============================================================================
⚠️ 关于 ⑥：判自然语言是假门禁，所以只判"同一句话还在不在"
----------------------------------------------------------------------------
  文档与登记册必须**同时**出现 `WINDOW_CLAIM` 这句话。改政策时两边都得改，
  任何一边单独改了都会红。这不是理解语义，只是把两处文字钉在一起 ——
  「理由写得好不好」这件事不判，判不了的事就说不判（同 do-dont-gate）。

用法
----------------------------------------------------------------------------
  python 05-audit/deprecation-doc-gate.py             # 判据
  python 05-audit/deprecation-doc-gate.py --selftest  # 反向控制
============================================================================
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AI = os.path.join(ROOT, 'ai')
DOC = os.path.join(ROOT, 'docs', 'DEPRECATIONS.md')
DEPR = os.path.join(AI, 'deprecations.json')
VERSION_FILE = os.path.join(ROOT, 'VERSION')

KINDS = ('token', 'class', 'api', 'event')
RE_VER = re.compile(r'^\d+\.\d+\.\d+$')
RE_TICK = re.compile(r'`([^`]+)`')
WINDOW_CLAIM = '至少跨一个次版本'
PLACEHOLDER = '（无）'

# 表头识别：靠列名，不靠"第几张表"。文档里加一张无关的表不该让本门禁红。
HEAD_A = ('名字', '类型', '弃用于', '最早移除于', '替代')
HEAD_B = ('名字', '类型', '移除于', '替代')


def vkey(s):
    m = RE_VER.match((s or '').strip())
    if not m:
        raise ValueError(s)
    return tuple(int(x) for x in s.strip().split('.'))


def load(p):
    return json.loads(io.open(p, encoding='utf-8').read())


# ---------------------------------------------------------------- 解析

def _cells(line):
    """`| a | b |` → ['a', 'b']（去掉首尾空管）。"""
    s = line.strip()
    if not s.startswith('|'):
        return None
    s = s[1:]
    if s.endswith('|'):
        s = s[:-1]
    return [c.strip() for c in s.split('|')]


def _is_sep(cells):
    return all(re.match(r'^:?-{2,}:?$', c or '') for c in cells if c is not None) \
        and any(cells)


def _clean(cell):
    return (cell or '').strip().strip('`').strip()


def _names_in(cell):
    """替代列：取反引号里的名字；`——` / `—` / 空 ⇒ []。"""
    got = RE_TICK.findall(cell or '')
    return got


def parse_tables(text):
    """返回 {'A': [row…], 'B': [row…]}，row 是 dict。"""
    out = {'A': [], 'B': []}
    lines = text.split('\n')
    i = 0
    while i < len(lines):
        cells = _cells(lines[i])
        if cells and any(_clean(c) in HEAD_A for c in cells) and \
                [ _clean(c) for c in cells[:5]] == list(HEAD_A):
            out['A'].extend(_read_rows(lines, i + 1, 'A'))
        elif cells and [ _clean(c) for c in cells[:4]] == list(HEAD_B) and \
                len(cells) >= 5:
            out['B'].extend(_read_rows(lines, i + 1, 'B'))
        i += 1
    return out


def _read_rows(lines, start, bucket):
    rows = []
    j = start
    # 跳过对齐行
    if j < len(lines):
        c = _cells(lines[j])
        if c is not None and _is_sep(c):
            j += 1
    while j < len(lines):
        c = _cells(lines[j])
        if c is None:
            break
        if _is_sep(c):
            j += 1
            continue
        name = _clean(c[0]) if c else ''
        if name == PLACEHOLDER:
            rows.append({'placeholder': True,
                         'note': _clean(c[-1]) if len(c) > 1 else ''})
        elif name:
            if bucket == 'A':
                rows.append({'placeholder': False, 'name': name,
                             'kind': _clean(c[1]), 'deprecatedIn': _clean(c[2]),
                             'removeIn': _clean(c[3]),
                             'replacement': _names_in(c[4]),
                             'why': _clean(c[5]) if len(c) > 5 else ''})
            else:
                rows.append({'placeholder': False, 'name': name,
                             'kind': _clean(c[1]), 'removedIn': _clean(c[2]),
                             'replacement': _names_in(c[3]),
                             'why': _clean(c[4]) if len(c) > 4 else ''})
        j += 1
    return [r for r in rows]


# ---------------------------------------------------------------- 判据

def expected(depr, version):
    """登记册 → 两个桶的期望。版本比较按数值，不按字符串。"""
    V = vkey(version)
    a, b = {}, {}
    for e in depr.get('planned', []):
        row = {'name': e.get('name'), 'kind': e.get('kind'),
               'replacement': e.get('replacement')}
        try:
            due = vkey(e.get('removeIn')) <= V
        except ValueError:
            due = False           # 版本写坏了由 deprecation-gate 去报
        if due:
            b[e.get('name')] = dict(row, removedIn=e.get('removeIn'))
        else:
            a[e.get('name')] = dict(row,
                                    deprecatedIn=e.get('deprecatedIn'),
                                    removeIn=e.get('removeIn'))
    for e in depr.get('retroactive', []):
        b[e.get('name')] = {'name': e.get('name'), 'kind': e.get('kind'),
                            'removedIn': e.get('removedIn'),
                            'replacement': e.get('replacement')}
    return a, b


def _norm_rep(v):
    if not v:
        return []
    return sorted(v if isinstance(v, list) else [v])


def check(text, depr, version):
    errs = []
    got = parse_tables(text)
    want_a, want_b = expected(depr, version)

    # ⑥ 迁移窗口：两处必须说同一句话
    if WINDOW_CLAIM not in text:
        errs.append('⑥ 文档没有声明迁移窗口（缺「%s」）⇒ 读者无法判断'
                    '还有多少时间可以迁移' % WINDOW_CLAIM)
    lead = (depr.get('policy') or {}).get('minLead') or ''
    if WINDOW_CLAIM not in lead:
        errs.append('⑥ 登记册 policy.minLead 与文档说的不是同一个窗口'
                    '（minLead 里没有「%s」）⇒ 改政策时漏改了一边' % WINDOW_CLAIM)

    for bucket, rows, want, label in (('A', got['A'], want_a, '表 A（迁窗中）'),
                                      ('B', got['B'], want_b, '表 B（已移除）')):
        seen = {}
        for r in rows:
            if r.get('placeholder'):
                # ⑦ 占位行必须带说明
                if not r.get('note'):
                    errs.append('⑦ %s 的占位行没有说明文字（空表也要说清为什么空）'
                                % label)
                continue
            n = r['name']
            if n in seen:
                errs.append('%s 里 %s 出现了两行 ⇒ 版本号/替代容易被改成只改一行'
                            % (label, n))
            seen[n] = r
            if r['kind'] not in KINDS:
                errs.append('③ %s 的类型必须是 %s，实际 %r'
                            % (n, ' / '.join(KINDS), r['kind']))
            exp = want.get(n)
            if not exp:
                other = '表 B' if bucket == 'A' else '表 A'
                hint = '（它在%s里）' % other if n in (want_b if bucket == 'A'
                                                    else want_a) else ''
                errs.append('② %s 里的 %s 在登记册里没有对应条目%s ⇒ 文档承诺了'
                            '一件代码里没有的事' % (label, n, hint))
                continue
            for k in ('deprecatedIn', 'removeIn', 'removedIn'):
                if k not in exp:
                    continue
                if r.get(k) != exp[k]:
                    errs.append('④ %s 的 %s 写成 %r，登记册是 %r ⇒ 版本号对不上，'
                                '到期时间就会被读错' % (n, k, r.get(k), exp[k]))
            if _norm_rep(r['replacement']) != _norm_rep(exp.get('replacement')):
                errs.append('⑤ %s 的替代写成 %s，登记册是 %s ⇒ 读者会去用一个'
                            '不存在或不正确的替代品'
                            % (n, _norm_rep(r['replacement']) or '（无）',
                               _norm_rep(exp.get('replacement')) or '（无）'))
        for n in sorted(set(want) - set(seen)):
            errs.append('① %s 里漏了 %s ⇒ 登记册里有、文档没写 ⇒ 就是"漏告知"，'
                        '使用者会以为它不会消失' % (label, n))
    return errs


# ---------------------------------------------------------------- 反向控制

def selftest():
    text = io.open(DOC, encoding='utf-8').read()
    depr_raw = io.open(DEPR, encoding='utf-8').read()
    V = io.open(VERSION_FILE, encoding='utf-8').read().strip()
    bad = 0

    def run(t, d):
        return check(t, d, V)

    def clone(fn):
        d = json.loads(depr_raw)
        fn(d)
        return d

    def hit(why, errs, needle):
        nonlocal bad
        ok = any(needle in e for e in errs)
        print('  [%s] %s' % ('OK  ' if ok else 'FAIL', why))
        if not ok:
            bad += 1
            print('        实际报的是：%s' % (errs[:2] or '空 —— 一条都没抓到'))

    def drop_row(t):
        """删掉表 B 里第一行数据（只删行，不动别的）。"""
        lines = t.split('\n')
        started = False
        out = []
        for ln in lines:
            c = _cells(ln)
            if c and [ _clean(x) for x in c[:4]] == list(HEAD_B):
                started = True
                out.append(ln)
                continue
            if started and c is not None and not _is_sep(c) and _clean(c[0]) != PLACEHOLDER:
                started = False      # 只删第一行
                continue
            if started and c is None:
                started = False
            out.append(ln)
        return '\n'.join(out)

    # ① 漏告知
    hit('表 B 少一行 ⇒ 漏告知 ⇒ 必须红',
        run(drop_row(text), json.loads(depr_raw)), '漏了')

    # ② 文档多写一条登记册没有的
    add_row = text.replace(
        '| `--measure` | token |',
        '| `--ghost-token` | token | 0.9.0 | —— | 合成样本 |\n| `--measure` | token |', 1)
    hit('表 B 多一行登记册没有的 ⇒ 假承诺 ⇒ 必须红',
        run(add_row, json.loads(depr_raw)), '没有对应条目')

    # ④ 版本号写错
    bad_ver = re.sub(r'(\| `--measure` \| token \| )0\.7\.4', r'\g<1>0.7', text, count=1)
    hit('版本号写成 0.7（少一段）⇒ 必须红',
        run(bad_ver, json.loads(depr_raw)), '0.7.4')

    # ⑤ 替代写错
    bad_rep = text.replace('`--measure-page` / `--measure-prose`',
                           '`--measure-page` / `--measure-none`', 1)
    hit('替代写了不存在的名字（与登记册不一致）⇒ 必须红',
        run(bad_rep, json.loads(depr_raw)), '替代写成')

    # ③ 类型写错
    bad_kind = re.sub(r'(\| `--measure` \| )token', r'\g<1>cssvar', text, count=1)
    hit('类型写成 cssvar（不在四类里）⇒ 必须红',
        run(bad_kind, json.loads(depr_raw)), '类型必须是')

    # ⑥ 窗口声明被删
    no_claim = text.replace(WINDOW_CLAIM, '某段时间')
    hit('文档不再声明迁移窗口 ⇒ 必须红',
        run(no_claim, json.loads(depr_raw)), '没有声明迁移窗口')

    # ⑥b 登记册的 minLead 被改口径
    other_lead = clone(lambda d: d['policy'].update(minLead='一年内'))
    hit('登记册 minLead 换了口径而文档没改 ⇒ 必须红',
        run(text, other_lead), 'minLead')

    # ②b 错桶：把一个已移除的名字写进表 A
    misplaced = text.replace(
        '| （无） | | | | | 当前没有名字处于迁移窗口中 |',
        '| `--measure` | token | 0.7.4 | 0.9.0 | `--measure-page` | 合成 |', 1)
    hit('已移除的名字写进「迁窗中」表 ⇒ 必须红',
        run(misplaced, json.loads(depr_raw)), '表 A')

    # ⑦ 占位行没有说明
    bare = text.replace('| （无） | | | | | 当前没有名字处于迁移窗口中 |',
                        '| （无） | | | | | |', 1)
    hit('占位行没有说明文字 ⇒ 必须红',
        run(bare, json.loads(depr_raw)), '占位行')

    # 原样必须全绿
    errs = run(text, json.loads(depr_raw))
    if errs:
        print('  [FAIL] 原样就有不通过的项 ⇒ 判据过严')
        for e in errs[:8]:
            print('        ' + e)
        bad += 1
    else:
        print('  [OK]   原样全绿')
    return 1 if bad else 0


# ---------------------------------------------------------------- 主

def main():
    if '--selftest' in sys.argv:
        sys.exit(selftest())

    print('')
    print('  === 弃用政策文档 ===')
    if not os.path.isfile(DOC):
        print('    X 缺 docs/DEPRECATIONS.md')
        print('      ⇒ 登记册只有机器读得到，使用者看不到 ⇒ 等于没有告知')
        sys.exit(1)
    text = io.open(DOC, encoding='utf-8').read()
    depr = load(DEPR)
    V = io.open(VERSION_FILE, encoding='utf-8').read().strip()
    errs = check(text, depr, V)
    if errs:
        for e in errs:
            print('    X ' + e)
        print('')
        print('  ❌ %d 项不满足' % len(errs))
        sys.exit(1)

    want_a, want_b = expected(depr, V)
    print('    OK 表 A（迁窗中）%d 条 · 表 B（已移除）%d 条 ⇒ 与登记册一一对应'
          % (len(want_a), len(want_b)))
    print('    OK 迁移窗口声明与 policy.minLead 同口径')
    print('')
    print('  ✅ 文档与登记册一致')
    sys.exit(0)


if __name__ == '__main__':
    main()
