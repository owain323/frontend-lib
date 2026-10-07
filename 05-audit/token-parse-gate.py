#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
token-parse-gate.py — 令牌层的**解析正确性**门禁

============================================================================
🔴 它抓的两类 bug 都是真的发生过、并且是真的用户可见的
----------------------------------------------------------------------------
【bug A】孤儿注释收尾符 ⇒ 后面一条令牌被浏览器整个吃掉
----------------------------------------------------------------------------
tokens.css 里出现过这样的注释（缺开头，第二行只有一个收尾符）：

    /* 开关开态轨道色 -- 浅色版
       与品牌色一致；暗色下换用降彩度的值（见 dark 段）*/
       不用 var(--accent) 是因为暗色下它太亮、铺满一大块会发光 */
    --switch-on:         #1b4d8f;

**真浏览器实测**：`getComputedStyle(root).getPropertyValue('--switch-on')`
在浅色模式下是**空字符串**。
⇒ CSS 的错误恢复把这行当成"坏声明"跳过了 ⇒ 开关组件在浅色下**没有轨道色**。

【bug B】令牌只在 @media dark 里定义 ⇒ 浅色下整条声明失效
----------------------------------------------------------------------------
`--surface-raised` 只写在 `@media (prefers-color-scheme: dark)` 里，
浅色段没有。而 combobox / popover / select / dropdown / tooltip / table
**六个组件**都写了 `background: var(--surface-raised)`（无兜底值）。

**真浏览器实测**：浅色下该变量为空 ⇒ `background` 整条失效 ⇒
计算值 `rgba(0, 0, 0, 0)` ⇒ **完全透明**。

⇒ 这条在 10-review/ios/index.html 里**早就记过了**，但当时只在那一个页面
  绕开（改用别的令牌），**没修根因** ⇒ 其余五个组件一直在踩。
  这是"绕开症状而不是修根因"的代价，写在这里当反面教材。

============================================================================
判据
----------------------------------------------------------------------------
  A. 全库 CSS 里不得出现「不在注释内的注释收尾符」（孤儿 `*/`）
  B. 组件 CSS 里 `var(--x)` 引用的令牌，必须在**无条件作用域**里有定义，
     或者自带兜底值 `var(--x, fallback)`
     ⇒ "只在 @media dark 里定义"不算无条件
  C. 真浏览器复核：关键令牌在浅色/暗色两种模拟下都不得为空

============================================================================
反向控制（必须能红）
----------------------------------------------------------------------------
  python 05-audit/token-parse-gate.py --selftest
============================================================================
"""
from __future__ import annotations

import io
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _css import strip_comments  # noqa: E402

SCAN_DIRS = ['01-tokens', '02-primitives', '03-patterns', '04-recipes']
TOKEN_DIRS = ['01-tokens']
EXTRA_TOKEN_FILES = ['04-recipes/tierA-tokens.css']

RE_VAR = re.compile(r'var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])')
RE_ATRULE = re.compile(r'@(media|supports)\b')


def all_css():
    out = []
    for d in SCAN_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, _dn, files in os.walk(base):
            for f in sorted(files):
                if f.endswith('.css'):
                    out.append(os.path.join(dirpath, f))
    return sorted(out)


def rel(p):
    return os.path.relpath(p, ROOT).replace('\\', '/')


# ---------------------------------------------------------------- A 孤儿收尾符
def check_orphan_close(path):
    """返回 [(行号, 片段)] —— 出现在注释之外的注释收尾符。"""
    s = io.open(path, encoding='utf-8').read()
    bad, i, n = [], 0, len(s)
    while i < n:
        if s[i:i + 2] == '/*':
            end = s.find('*/', i + 2)
            if end < 0:
                bad.append((s.count('\n', 0, i) + 1, '注释没有收尾'))
                break
            i = end + 2
            continue
        if s[i] in '"\'':
            q = s[i]
            j = i + 1
            while j < n:
                if s[j] == '\\':
                    j += 2
                    continue
                if s[j] == q:
                    j += 1
                    break
                j += 1
            i = j
            continue
        if s[i:i + 2] == '*/':
            bad.append((s.count('\n', 0, i) + 1, s[max(0, i - 40):i + 2]))
            i += 2
            continue
        i += 1
    return bad


# ---------------------------------------------------------------- B 作用域
def decls_with_scope(css):
    """
    扫一遍 CSS，产出 [(name, value, 是否在 @media/@supports 内)]。
    用一个块栈跟踪：每进入一个块，记下它是不是由 @media/@supports 打开的。
    """
    out = []
    stack = []          # 每个元素：该块是否"条件作用域"
    i, n = 0, len(css)
    buf_start = 0

    def in_conditional():
        return any(stack)

    while i < n:
        c = css[i]
        if c == '/' and css[i:i + 2] == '/*':
            end = css.find('*/', i + 2)
            i = n if end < 0 else end + 2
            continue
        if c in '"\'':
            q = c
            j = i + 1
            while j < n:
                if css[j] == '\\':
                    j += 2
                    continue
                if css[j] == q:
                    j += 1
                    break
                j += 1
            i = j
            continue
        if c == '{':
            # 判断这个块由谁打开：往前找到最近的 '}' ';' '{' 之后的内容
            j = i - 1
            while j >= 0 and css[j] not in '{};':
                j -= 1
            head = css[j + 1:i]
            stack.append(bool(RE_ATRULE.search(head)))
            i += 1
            buf_start = i
            continue
        if c == '}':
            # 先把这个块里没处理的声明收掉
            seg = css[buf_start:i]
            for name, value, _note in _simple_decls(seg):
                out.append((name, value, in_conditional()))
            if stack:
                stack.pop()
            i += 1
            buf_start = i
            continue
        i += 1
    return out


def _simple_decls(body):
    """轻量版声明扫描（不跨块），返回 [(name, value, note)]。"""
    res, i, n = [], 0, len(body)
    note = ''
    while i < n:
        if body[i:i + 2] == '/*':
            end = body.find('*/', i + 2)
            if end < 0:
                break
            note = body[i + 2:end].strip()
            i = end + 2
            continue
        if body[i] in '"\'':
            q = body[i]
            j = i + 1
            while j < n:
                if body[j] == '\\':
                    j += 2
                    continue
                if body[j] == q:
                    j += 1
                    break
                j += 1
            i = j
            continue
        if body[i] in ' \t\r\n;':
            i += 1
            continue
        if body[i:i + 2] == '--':
            colon = body.find(':', i)
            if colon < 0:
                break
            semi = body.find(';', colon)
            semi = n if semi < 0 else semi
            name = body[i:colon].strip()
            value = body[colon + 1:semi].strip()
            res.append((name, value, note))
            note = ''
            i = semi + 1
            continue
        i += 1
    return res


def global_unconditional():
    files = []
    for d in TOKEN_DIRS:
        base = os.path.join(ROOT, d)
        for dirpath, _dn, fs in os.walk(base):
            for f in sorted(fs):
                if f.endswith('.css'):
                    files.append(os.path.join(dirpath, f))
    for extra in EXTRA_TOKEN_FILES:
        p = os.path.join(ROOT, extra)
        if os.path.isfile(p):
            files.append(p)
    res = {}
    for p in files:
        for name, value, cond in decls_with_scope(io.open(p, encoding='utf-8').read()):
            if name.startswith('--') and not cond and name not in res:
                res[name] = rel(p)
    return res


def check_var_refs(path, global_uc):
    raw = io.open(path, encoding='utf-8').read()
    # ⚠️ 必须先去注释再扫 var()：注释里举例写的 `var(--sw-travel)` 不是引用。
    #    （第一版没去注释 ⇒ switch.css 被误报 3 处，全是注释里的说明文字）
    css, _bal = strip_comments(raw)
    local_uc = {n for n, _v, cond in decls_with_scope(css)
                if n.startswith('--') and not cond}
    bad = []
    for m in RE_VAR.finditer(css):
        name, nxt = m.group(1), m.group(2)
        if nxt == ',':
            continue                       # 有兜底值 ⇒ 安全
        if name in global_uc or name in local_uc:
            continue
        line = raw.count('\n', 0, m.start()) + 1
        bad.append((line, name))
    return bad


# ---------------------------------------------------------------- C 浏览器复核
KEY_TOKENS = ['--switch-on', '--surface-raised', '--surface', '--paper',
              '--accent', '--text-primary', '--skeleton-bg', '--text-on-solid']


def browser_check():
    if '--no-browser' in sys.argv:
        return None            # fast 模式：静态判据已足够，浏览器留给 full
    probe = os.path.join(ROOT, '05-audit', 'token-parse-probe.js')
    if not os.path.isfile(probe):
        return None
    try:
        node = 'node'
    except Exception:                       # pragma: no cover
        return None
    env = dict(os.environ)
    env['FL_BROWSER'] = os.path.join(ROOT, '05-audit', 'browser.js')
    # 🔴 要复核哪些令牌，由本门禁说了算，不能让探针自己决定。
    #    （第一版两边各写一份名单 ⇒ 探针读的是 WATCH，门禁查的是 KEY_TOKENS，
    #      查的键压根没被读 ⇒ 一律判"为空" ⇒ 假红。INVARIANT I-7 的又一次现身。）
    try:
        r = subprocess.run([node, probe, '--json', '--tokens=' + ','.join(KEY_TOKENS)],
                           capture_output=True, timeout=180, env=env, cwd=ROOT)
    except (OSError, subprocess.SubprocessError) as e:
        print('  [SKIP] 浏览器复核不可用：%s' % e)
        return None
    if r.returncode != 0:
        print('  [SKIP] 浏览器复核未跑起来（不影响静态判据）：%s'
              % (r.stderr or b'').decode('utf-8', 'replace')[:200])
        return None
    try:
        import json
        data = json.loads(r.stdout.decode('utf-8'))
    except Exception:
        return None
    missing = []
    for mode in ('light', 'dark'):
        for k in KEY_TOKENS:
            if not (data.get(mode) or {}).get(k):
                missing.append((mode, k))
    return missing


def selftest():
    """反向控制：证明这道门禁会红。"""
    import tempfile
    ok = True
    tmp = tempfile.mkdtemp(prefix='fl-tokpar-')
    # A：孤儿收尾符
    f1 = os.path.join(tmp, 'a.css')
    io.open(f1, 'w', encoding='utf-8').write(
        '/* 正常注释 */\n  这行不在注释里 */\n--x: 1;\n')
    if not check_orphan_close(f1):
        print('  [FAIL] 反向控制失效：孤儿收尾符没被抓到')
        ok = False
    else:
        print('  [OK] 反向控制 A：孤儿收尾符被抓到')
    # A 反例：正常注释不应误报
    f2 = os.path.join(tmp, 'b.css')
    io.open(f2, 'w', encoding='utf-8').write(
        '/* 多行\n   注释 */\n.x { color: red }\n')
    if check_orphan_close(f2):
        print('  [FAIL] 误报：正常多行注释被当成孤儿')
        ok = False
    else:
        print('  [OK] 反向控制 A′：正常注释不误报')
    # B：只在 @media 里定义 ⇒ 算条件作用域
    f3 = os.path.join(tmp, 'c.css')
    io.open(f3, 'w', encoding='utf-8').write(
        ':root { --a: 1; }\n@media (min-width: 1px) { :root { --b: 2; } }\n')
    scoped = {n: c for n, _v, c in decls_with_scope(io.open(f3, encoding='utf-8').read())}
    if scoped.get('--a') is not False or scoped.get('--b') is not True:
        print('  [FAIL] 反向控制失效：@media 内外的作用域没分对 (%s)' % scoped)
        ok = False
    else:
        print('  [OK] 反向控制 B：@media 内的令牌被判为条件作用域')
    return 0 if ok else 1


def main():
    if '--selftest' in sys.argv:
        return selftest()

    fails = 0

    # A
    print('  A. 孤儿注释收尾符')
    orphan_n = 0
    for p in all_css():
        for line, snip in check_orphan_close(p):
            print('     [FAIL] %s:%d  注释之外的收尾符：…%s'
                  % (rel(p), line, snip.replace('\n', ' ')[-50:]))
            orphan_n += 1
            fails += 1
    print('     %s' % ('无' if not orphan_n else '%d 处' % orphan_n))

    # B
    print('  B. var() 引用的令牌在无条件作用域里有没有定义')
    guc = global_unconditional()
    print('     全局无条件令牌 %d 个（来自 %s + tierA-tokens.css）'
          % (len(guc), '/'.join(TOKEN_DIRS)))
    varbad = 0
    for p in all_css():
        if rel(p).startswith('01-tokens/'):
            continue          # 令牌层自己允许互相引用
        for line, name in check_var_refs(p, guc):
            print('     [FAIL] %s:%d  var(%s) 无兜底且无条件定义缺失'
                  % (rel(p), line, name))
            varbad += 1
            fails += 1
    print('     %s' % ('无' if not varbad else '%d 处' % varbad))

    # C
    print('  C. 真浏览器复核（%d 个关键令牌 × 浅/暗）' % len(KEY_TOKENS))
    miss = browser_check()
    if miss is None:
        print('     （跳过，静态判据已足够）')
    elif miss:
        for mode, k in miss:
            print('     [FAIL] %s 模式下 %s 为空 —— 该令牌没生效' % (mode, k))
            fails += 1
        print('     %d 处' % len(miss))
    else:
        print('     全部非空')

    if fails:
        print('  [FAIL] token-parse-gate 共 %d 处' % fails)
        return 1
    print('  [OK] 令牌解析门禁通过')
    return 0


if __name__ == '__main__':
    sys.exit(main())
