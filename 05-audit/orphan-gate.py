#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
orphan-gate —— 05-audit/ 里不许有"没人跑"的脚本

为什么要有它
=====================================================================
`05-audit/` 是这个库最大的资产（175 个脚本），也是最容易腐化的地方：

  · 一次性迁移脚本用完没删（`migrate-to-data-state.py`）
  · 写完却发现没接线（`_a11y-reverse-control.js` 有完整实现，
    但从来没有被任何门禁调用 —— 于是 a11y 的反向控制从建库起就没跑过）
  · 旧门禁被新门禁取代后留在原地（`api-snapshot.py`）

后果不是"目录难看"，而是 **读的人以为有人在看着**。这正是 INVARIANT I-10 说的
"最安静的假绿：它不产出任何报告"。

判据
=====================================================================
  每个 `05-audit/*.{py,js,mjs,sh}` 必须属于下面三类之一：

    A. 被**三源**之一引用：`check-all.sh`（含 `for g in …` 循环展开）、
       `package.json` 的 scripts、`.github/workflows/*`
    B. 被别的脚本引用（import / require / subprocess 里出现文件名或模块名）
    C. 明确退役：放在 `05-audit/_attic/` 下，或文件名以 `_` 开头（工具模块）
    D. **人工工具**：脚本自己的前 40 行里写着 `MANUAL-ONLY: <理由>`

  三类都不是 ⇒ 红，并打印"该怎么处置"。

为什么 D 要求把理由写在脚本头上，而不是在门禁里维护白名单
---------------------------------------------------------------------
白名单会长成一个没人敢删的列表（谁也不知道那条还有没有效）。
理由跟着实体走：脚本还在，理由就在；脚本删了，白名单条目自动消失。
门禁只认那个标记，不判断理由写得好不好 —— 那是评审的事。

为什么以 `_` 开头算例外
---------------------------------------------------------------------
本库约定 `_` 前缀 = **被别的脚本 import 的共享模块**（`_common.py` `_css.py`
`_probe.js` …），它们本来就不该出现在 `check-all.sh` 里。这条约定比"逐个登记"
便宜，而且已经在用了 —— 门禁承认既有约定，不另造一套。

零文件守卫 + 正向控制
=====================================================================
  · 候选脚本数 < 50 ⇒ FAIL（不是"干净"，是没扫到）
  · 必须能认出至少一个**已知被引用**的脚本（`doc-facts-gate.py`）⇒ 证明引用图非空

反向控制
=====================================================================
`--selftest` 用合成引用表跑三例：
  ① 只被 check-all.sh 引用 ⇒ 判为"有主"
  ② 谁都不引用 ⇒ 判为孤儿
  ③ `_` 前缀 / `_attic/` 下 ⇒ 豁免
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIT = os.path.join(ROOT, '05-audit')
EXTS = ('.py', '.js', '.mjs', '.sh')
MIN_SCRIPTS = 50

REF_RE = re.compile(r'05-audit/([A-Za-z0-9_.\-]+\.(?:py|js|mjs|sh))')
LOOP_RE = re.compile(r'for\s+(\w+)\s+in\s+([^;]+);\s*do')
USE_RE = re.compile(r'05-audit/\$\{?%s\}?\.(py|js|mjs|sh)')


def read(p):
    try:
        with io.open(p, encoding='utf-8', errors='ignore') as f:
            return f.read()
    except Exception:
        return ''


def expand_check_all(text):
    """把 `for g in a b c; do … "05-audit/$g.py"` 展开成具体文件名。

    不展开的话，所有走循环的门禁都会被误判成孤儿 —— 这是第一版漏掉的地方。
    """
    names = set(REF_RE.findall(text))
    for var, body in LOOP_RE.findall(text):
        tokens = [t.strip() for t in body.split() if t.strip()]
        if not tokens:
            continue
        # 看看循环体里到底用了这个变量拼哪个后缀
        used = set()
        for m in re.finditer(r'05-audit/\$\{?' + re.escape(var) + r'\}?\.(py|js|mjs|sh)', text):
            used.add(m.group(1))
        if not used:
            used = {'py'}
        for t in tokens:
            if t.startswith('$') or t.startswith('-'):
                continue
            for ext in used:
                names.add('%s.%s' % (t, ext))
    return names


def collect_references():
    """返回 (被引用的文件名集合, 参与计算的来源文件数)。"""
    refs = set()
    sources = 0

    sh = os.path.join(AUDIT, 'check-all.sh')
    if os.path.isfile(sh):
        refs |= expand_check_all(read(sh))
        sources += 1

    pkg = os.path.join(ROOT, 'package.json')
    if os.path.isfile(pkg):
        txt = read(pkg)
        refs |= set(REF_RE.findall(txt))
        sources += 1

    wf = os.path.join(ROOT, '.github', 'workflows')
    if os.path.isdir(wf):
        for f in os.listdir(wf):
            if f.endswith(('.yml', '.yaml')):
                refs |= set(REF_RE.findall(read(os.path.join(wf, f))))
                sources += 1

    # 任意**代码**文件里提到某个脚本名（含 import/require/subprocess 的间接引用）。
    # 🔴 只扫代码，不扫 .md / .json：
    #    第一版扫了全部文本，结果 CHANGELOG 里"提过一句"的脚本全被算成"有主" ——
    #    在变更日志里被提及 ≠ 有人在跑它。这正是本门禁要抓的东西。
    for dp, dn, fn in os.walk(ROOT):
        dn[:] = [d for d in dn if d not in ('.git', 'node_modules', '_attic')]
        for f in fn:
            if f.endswith(('.py', '.js', '.mjs', '.sh')):
                p = os.path.join(dp, f)
                for m in REF_RE.finditer(read(p)):
                    refs.add(m.group(1))
    return refs, sources + 1


def classify(name, refs, stem_refs, manual=()):
    if name.startswith('_'):
        return 'ok-prefix'
    if name in refs:
        return 'ok-ref'
    if name in manual:
        return 'ok-manual'
    stem = os.path.splitext(name)[0]
    if stem in stem_refs:
        return 'ok-stem'      # 被 import / require 的模块名
    return 'orphan'


def find_manual(names):
    """前 40 行里带 `MANUAL-ONLY:` 的脚本 = 人工工具。"""
    out = set()
    for n in names:
        head = '\n'.join(read(os.path.join(AUDIT, n)).splitlines()[:40])
        if 'MANUAL-ONLY:' in head:
            out.add(n)
    return out


def judge(names, refs, stem_refs, manual=()):
    out = []
    for n in sorted(names):
        out.append((n, classify(n, refs, stem_refs, manual)))
    return out


def real_run():
    names = []
    for dp, dn, fn in os.walk(AUDIT):
        if '_attic' in dp:
            continue
        for f in fn:
            if f.endswith(EXTS):
                names.append(f)

    if len(names) < MIN_SCRIPTS:
        print('  [FAIL] 只扫到 %d 个脚本（阈值 %d）—— 不是"很干净"，是没扫到'
              % (len(names), MIN_SCRIPTS))
        return 1

    refs, sources = collect_references()
    if not refs:
        print('  [FAIL] 引用图是空的 —— 说明 check-all.sh / package.json 没被读到')
        return 1
    if 'doc-facts-gate.py' not in refs:
        print('  [FAIL] 正向控制失败：连 doc-facts-gate.py 都没被认作"有主"')
        return 1

    # 模块名（去掉后缀）也被 import 的情况
    blobs = []
    for dp, dn, fn in os.walk(ROOT):
        dn[:] = [d for d in dn if d not in ('.git', 'node_modules')]
        for f in fn:
            if f.endswith(('.py', '.js', '.mjs', '.sh')):
                blobs.append(read(os.path.join(dp, f)))
    blob = '\n'.join(blobs)
    stem_refs = set()
    for n in names:
        stem = os.path.splitext(n)[0]
        if n not in refs and re.search(r'(^|[\s(\'"/])' + re.escape(stem) + r'($|[\s)\'"/:])',
                                       blob, re.M):
            stem_refs.add(stem)

    rows = judge(names, refs, stem_refs, find_manual(names))
    orphans = [n for n, k in rows if k == 'orphan']
    by_kind = {}
    for n, k in rows:
        by_kind[k] = by_kind.get(k, 0) + 1

    print('  === 孤儿脚本（orphan）===')
    print('  扫了 %d 个脚本 · 引用来源 %d 处 · 分类 %s'
          % (len(names), len(refs), json.dumps(by_kind, ensure_ascii=False)))
    if orphans:
        for n in orphans:
            print('  [FAIL] 没人跑：05-audit/%s' % n)
        print('  ⇒ 处置只有两种：接进 check-all.sh，或移进 05-audit/_attic/（附一句为什么退役）。')
        return 1
    print('  OK   没有孤儿：每个脚本要么被调用，要么是 `_` 工具模块，要么已退役')
    return 0


def selftest():
    """合成引用表：证明三类判定都能成立。"""
    cases = [
        ('doc-facts-gate.py', {'doc-facts-gate.py'}, set(), (), 'ok-ref'),
        ('_common.py', set(), set(), (), 'ok-prefix'),
        ('ghost.py', set(), set(), (), 'orphan'),
        ('contract-kit.js', set(), {'contract-kit'}, (), 'ok-stem'),
        ('md-render.py', set(), set(), {'md-render.py'}, 'ok-manual'),
    ]
    bad = 0
    for name, refs, stems, manual, want in cases:
        got = classify(name, refs, stems, manual)
        ok = got == want
        if not ok:
            bad += 1
        print('  %s  %-22s → %-10s（应 %s）' % ('PASS' if ok else 'FAIL', name, got, want))
    print('  自检 5 条，失败 %d 条' % bad)
    return 1 if bad else 0


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(real_run())
