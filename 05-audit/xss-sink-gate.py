#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
xss-sink-gate.py — 每一个 HTML 注入点都必须**说得清它装的是什么**

============================================================================
🔴 为什么这道门禁存在
----------------------------------------------------------------------------
审计报告只点了 `model-viewer` 一处 innerHTML，实际盘点有 21 处。真正的问题
不是"有几处"，而是**没有任何机制能阻止第 22 处悄悄进来**：

  · `combobox` 写对了（每个插值都过 esc），但"写对了"这件事没有留下证据；
  · `popover` / `drawer` 的 HTML 入口是**有意**的 API，但没人登记 ⇒ 读代码的人
    分不清"故意"与"忘了转义"；
  · `date-range` 把 `<input>` 的 value 拼进 innerHTML，而 `type=date` 在
    Chromium 97 的旧内核里会回退成文本输入 ⇒ value 可以是任意串（E299）。

⚠️ SECURITY.md 当时只写了 combobox 一处。**安全文档只覆盖一个注入点，比没有
   安全文档更危险** —— 它让人以为已经盘过了。

============================================================================
判据（每条都必须能红）
----------------------------------------------------------------------------
  ① 零文件 ⇒ 红（扫了 0 个 → 不是"通过"，是"没检查"）
  ② 除"赋空串"外的每个注入点，必须在**紧邻上一行**有标记：
        /* @html-sink <kind> — <为什么这样是安全的> */
     kind ∈ {escaped, internal, raw-html}；没有标记 ⇒ 红
  ③ `escaped`：语句本身必须出现 esc( / escAttr( 调用
  ④ `internal`：语句里不许出现外部数据的典型来源
     （.value / .getAttribute( / .dataset / location）—— 标了 internal 却在拼外部量 ⇒ 红
  ⑤ `raw-html`：该文件必须登记在 SECURITY.md 的「HTML 入口」一节
  ⑥ 反向：SECURITY.md 登记了、代码里却没有 raw-html 注入点 ⇒ 红（防陈旧登记）

============================================================================
⚠️ 这道门禁**证明不了**什么（诚实边界）
----------------------------------------------------------------------------
它不证明 `esc()` 的实现是对的，也不证明所有数据流都被覆盖。它证明的是：
**新增一个未声明的 HTML 注入点，必须显式改标记或改文档** —— 也就是让"忘记"
从静默变成一次必须做的决定。

============================================================================
为什么不用 `grep innerHTML`
----------------------------------------------------------------------------
见 INVARIANT.md I-11。`grep` 会把注释里、字符串里的 `.innerHTML =` 也算进来
（本文件自己的文档字符串里就有三处），于是判据要么误报、要么被"加个注释就绿"
绕过。这里先把注释与字符串遮蔽成等长空格，再在遮蔽层上找语句边界。
"""

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIRS = ['01-tokens', '02-primitives', '03-patterns', '04-recipes', '09-assets']
SECURITY = os.path.join(ROOT, 'SECURITY.md')

SINK_RE = re.compile(r'\.(?:innerHTML|outerHTML)\s*(?:\+?=)|\.insertAdjacentHTML\s*\(')
MARK_RE = re.compile(r'@html-sink\s+(raw-html|escaped|internal)\s*[—\-:：]?\s*(.*)')
CLEAR_RE = re.compile(r'^(\'\'|""|``)$')
EXTERNAL_RE = re.compile(r'\.value\b|\.getAttribute\s*\(|\.dataset\b|\blocation\b|\.textContent\b')
RAW_ASSIGN_RE = re.compile(r'\.(?:innerHTML|outerHTML)\s*\+?=')

# 正则字面量的合法起点：前一个非空白字符是这些（或前一个词是关键字）
REGEX_PREV = set('(,=:[!&|?{};+-*%~^<>')
REGEX_WORDS = ('return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'new',
               'instanceof', 'do', 'else')


def _is_regex_start(src, i):
    j = i - 1
    while j >= 0 and src[j] in ' \t\r\n':
        j -= 1
    if j < 0:
        return True
    if src[j] in REGEX_PREV:
        return True
    k = j
    while k >= 0 and (src[k].isalnum() or src[k] in '_$'):
        k -= 1
    return src[k + 1:j + 1] in REGEX_WORDS


def mask_js(src):
    """把注释与字符串换成等长空格（保留换行），长度与原文逐字节对齐。

    这样后续所有 offset 都能同时用于原文（取标记）与遮蔽层（找语句边界）。
    """
    out = list(src)
    n = len(src)
    i = 0

    def blank(a, b):
        for k in range(a, b):
            if out[k] != '\n':
                out[k] = ' '

    while i < n:
        c = src[i]
        # 行注释
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i)
            j = n if j < 0 else j
            blank(i, j)
            i = j
            continue
        # 块注释
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            blank(i, j)
            i = j
            continue
        # 正则字面量（🔴 必须处理：`/[&<>"]/g` 里的引号会让遮蔽层误以为
        # 字符串开始，一路吞掉几十行 —— 第一次跑就吞掉了 combobox 的 3 个注入点，
        # 而门禁照样报 OK。见本次的遮蔽层计数自检 ⓪）
        if c == '/' and _is_regex_start(src, i):
            j = i + 1
            in_class = False
            while j < n:
                ch = src[j]
                if ch == '\\':
                    j += 2
                    continue
                if ch == '[':
                    in_class = True
                elif ch == ']':
                    in_class = False
                elif ch == '/' and not in_class:
                    j += 1
                    break
                elif ch == '\n':
                    break
                j += 1
            blank(i, j)
            i = j
            continue
        # 字符串
        if c in '\'"`':
            quote = c
            j = i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == quote:
                    j += 1
                    break
                j += 1
            blank(i, j)
            i = j
            continue
        i += 1
    return ''.join(out)


def _stmt_span(masked, start):
    """从赋值符之后扫到深度 0 的分号（或块结束），返回右值区间。"""
    depth = 0
    i = start
    n = len(masked)
    while i < n:
        ch = masked[i]
        if ch in '([{':
            depth += 1
        elif ch in ')]}':
            if depth == 0:
                return start, i
            depth -= 1
        elif ch == ';' and depth == 0:
            return start, i
        i += 1
    return start, n


def _marker_before(src, stmt_start, name):
    """取紧邻语句之前的标记（允许中间只有空行/空白）。

    ⚠️ 切点必须是**语句所在行的行首**，不是 `.innerHTML` 的位置 ——
       否则"上一行"永远是同一行（第一版就栽在这，标记写了也读不到）。
    """
    line_start = src.rfind('\n', 0, stmt_start) + 1
    head = src[:line_start]
    blank = head.rstrip()
    if not blank.endswith('*/'):
        # 标记可能在同一行（极少），退化成同行查找
        m = MARK_RE.search(src[line_start:stmt_start])
        return (m.group(1), m.group(2).strip()) if m else (None, '')
    end = len(blank)
    beg = blank.rfind('/*', 0, end)
    if beg < 0:
        return None, ''
    block = blank[beg:end]
    m = MARK_RE.search(block)
    if not m:
        return None, ''
    return m.group(1), m.group(2).strip()


def security_registry():
    """SECURITY.md 的「HTML 入口」一节里登记了哪些文件。"""
    if not os.path.isfile(SECURITY):
        return None, 'SECURITY.md 不存在'
    text = io.open(SECURITY, encoding='utf-8').read()
    lines = text.split('\n')
    start = None
    for i, ln in enumerate(lines):
        if ln.startswith('#') and 'HTML 入口' in ln:
            start = i + 1
            break
    if start is None:
        return None, 'SECURITY.md 里找不到「HTML 入口」一节'
    body = []
    for ln in lines[start:]:
        if ln.startswith('## '):
            break
        body.append(ln)
    return set(re.findall(r'[\w./-]+\.js', '\n'.join(body))), None


def analyze(src, name, registry, guard=False):
    """返回 (errs, stats)。errs 是 [(行号, 说明)]。stats 是分类计数。

    guard=True 时额外做遮蔽层自检（真实仓库必开，fixture 不开）。
    """
    masked = mask_js(src)
    errs = []
    stats = {'clear': 0, 'escaped': 0, 'internal': 0, 'raw-html': 0, 'sink': 0}
    assigns = 0

    for m in SINK_RE.finditer(masked):
        stats['sink'] += 1
        if '=' in m.group(0):
            assigns += 1
        line = masked.count('\n', 0, m.start()) + 1
        eq = masked.find('=', m.start())
        if eq < 0 or eq > m.end() + 3:
            # insertAdjacentHTML( 没有赋值符：右值从括号后开始
            eq = m.end()
        a, b = _stmt_span(masked, eq + 1)
        rhs = src[a:b].strip()

        if CLEAR_RE.match(rhs):
            stats['clear'] += 1
            continue

        kind, why = _marker_before(src, m.start(), name)
        if not kind:
            errs.append((line, '未声明的 HTML 注入点（%s…）' % rhs[:48].replace('\n', ' ')))
            continue

        if len(why) < 6:
            errs.append((line, '@html-sink %s 没写理由' % kind))
            continue

        stats[kind] += 1

        if kind == 'escaped' and not re.search(r'\besc(?:Attr)?\s*\(', rhs):
            errs.append((line, '标了 escaped，但语句里没有 esc() 调用'))
        if kind == 'internal':
            hit = EXTERNAL_RE.search(rhs)
            if hit:
                errs.append((line, '标了 internal，却在拼外部量（`%s`）' % hit.group(0)))
        if kind == 'raw-html':
            rel = name.replace('\\', '/')
            if registry is None:
                errs.append((line, 'raw-html 需要 SECURITY.md 登记，但登记表读不到'))
            elif rel not in registry:
                errs.append((line, 'raw-html 未登记在 SECURITY.md 的「HTML 入口」：%s' % rel))

    # ⓪ 遮蔽层自检（只对真实仓库开，fixture 不开）：
    #    原文里每出现一处注入赋值，遮蔽后就必须找到一处。
    #    这条是"门禁自己有没有瞎"的判据 —— 第一版没有它，`/[&<>"]/g`
    #    把 combobox 的 3 个注入点整段吞掉，门禁照样打印 OK。
    #    它同时是一条仓库纪律：**组件代码里不要用 `.innerHTML =` 这种写法当注释文本**
    #    （要举例就写「innerHTML 赋值」），否则这里会红，需要人来看一眼。
    if guard:
        raw = list(RAW_ASSIGN_RE.finditer(src))
        if len(raw) != assigns:
            lines = [src.count('\n', 0, m.start()) + 1 for m in raw]
            errs.append((lines[0] if lines else 0,
                         '原文有 %d 处注入赋值，遮蔽后只找到 %d 处（出现在第 %s 行附近）；'
                         '不是注释/字符串里写了这种文本，就是遮蔽层吞了代码'
                         % (len(raw), assigns, ', '.join(map(str, lines[:6])))))

    return errs, stats


def collect():
    out = []
    for d in SRC_DIRS:
        base = os.path.join(ROOT, d)
        for root, dirs, names in os.walk(base):
            dirs[:] = [x for x in dirs if x not in ('_attic', 'node_modules')]
            for n in sorted(names):
                if n.endswith('.js'):
                    out.append(os.path.join(root, n))
    return out


def check():
    registry, reg_err = security_registry()
    files = collect()
    print('  === HTML 注入点 ===')

    if not files:
        print('  [FAIL] 扫到 0 个 JS 文件 —— 不是通过，是没检查')
        return 1

    total = {'clear': 0, 'escaped': 0, 'internal': 0, 'raw-html': 0, 'sink': 0}
    bad = 0
    used_raw = set()
    for p in files:
        rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
        src = io.open(p, encoding='utf-8', errors='replace').read()
        errs, st = analyze(src, rel, registry, guard=True)
        for k in total:
            total[k] += st[k]
        for line, msg in errs:
            print('  [FAIL] %s:%d  %s' % (rel, line, msg))
            bad += 1
        if st['raw-html']:
            used_raw.add(rel)

    print('     扫了 %d 个 JS 文件，%d 个注入点' % (len(files), total['sink']))
    print('       · 清空型 %d 处（赋空串，无解析）' % total['clear'])
    print('       · escaped %d 处（插值过 esc）' % total['escaped'])
    print('       · internal %d 处（只有常量/内部量）' % total['internal'])
    print('       · raw-html %d 处（有意入口，已登记）' % total['raw-html'])

    if total['sink'] == 0:
        print('  [FAIL] 一个注入点都没扫到 —— 判据失效')
        return 1
    if reg_err:
        print('  [FAIL] %s' % reg_err)
        bad += 1

    # ⑥ 反向：登记了却没有对应注入点 ⇒ 陈旧登记
    if registry:
        for rel in sorted(registry - used_raw):
            print('  [FAIL] SECURITY.md 登记了 %s，但代码里没有 raw-html 注入点' % rel)
            bad += 1

    if bad:
        print('  [FAIL] %d 处不满足' % bad)
        return 1
    print('  [OK] 每个注入点都说得清装的是什么')
    return 0


# ---------------------------------------------------------------------------
# 反向控制：每条判据都要证明它会红
# ---------------------------------------------------------------------------
FIXTURES = [
    ('未声明的注入点', "el.innerHTML = '<b>' + x + '</b>';", None, True),
    ('clear 不需要标记', "el.innerHTML = '';", None, False),
    ('escaped 且真的 esc 了',
     "/* @html-sink escaped — 插值全过 esc */\nel.innerHTML = '<b>' + esc(x) + '</b>';", None, False),
    ('标了 escaped 却没有 esc',
     "/* @html-sink escaped — 说是转义了 */\nel.innerHTML = '<b>' + x + '</b>';", None, True),
    ('internal 只有常量',
     "/* @html-sink internal — 本文件常量 */\nel.innerHTML = '<b>' + ICON + '</b>';", None, False),
    ('标了 internal 却在拼 value',
     "/* @html-sink internal — 说是内部量 */\nel.innerHTML = '<b>' + input.value + '</b>';", None, True),
    ('raw-html 已登记',
     "/* @html-sink raw-html — 调用方负责净化 */\nel.innerHTML = opt.html;", {'a/b.js'}, False),
    ('raw-html 未登记',
     "/* @html-sink raw-html — 调用方负责净化 */\nel.innerHTML = opt.html;", set(), True),
    ('注释里的注入点不算（遮蔽层）',
     "// el.innerHTML = '<b>' + x + '</b>';\nvar ok = 1;", None, False),
    ('字符串里的注入点不算（遮蔽层）',
     "var s = \"el.innerHTML = '<b>' + x + '</b>'\";", None, False),
]


# ⓪ 的样本：遮蔽层自检只对真实仓库开，这两条证明它在该红的时候会红。
GUARD_FIXTURES = [
    ('注释里写了注入赋值（仓库纪律）',
     "// el.innerHTML = '<b>' + x + '</b>';\nvar ok = 1;"),
    ('字符串里写了注入赋值（仓库纪律）',
     'var s = "el.innerHTML = x";'),
]


def selftest():
    print('  === 反向控制（xss-sink）===')
    bad = 0
    for label, src, registry, want_red in FIXTURES:
        errs, _ = analyze(src, 'a/b.js', registry if registry is not None else set())
        got_red = bool(errs)
        ok = got_red == want_red
        print('  [%s] %-26s 期望%s ⇒ 实际%s%s'
              % ('OK ' if ok else 'BAD', label,
                 '红' if want_red else '绿',
                 '红' if got_red else '绿',
                 ('  ' + errs[0][1][:40]) if errs else ''))
        if not ok:
            bad += 1

    for label, src in GUARD_FIXTURES:
        errs, _ = analyze(src, 'a/b.js', set(), guard=True)
        ok = bool(errs)
        print('  [%s] %-26s 期望红 ⇒ 实际%s%s'
              % ('OK ' if ok else 'BAD', label, '红' if ok else '绿',
                 ('  ' + errs[0][1][:40]) if errs else ''))
        if not ok:
            bad += 1

    # 真实仓库必须全绿（良性对照）
    if check() != 0:
        bad += 1
    if bad:
        print('  [FAIL] %d 条自检不成立' % bad)
        return 1
    print('  [OK] 判据有牙，真实仓库全绿')
    return 0


def main(argv):
    if '--selftest' in argv:
        return selftest()
    return check()


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
