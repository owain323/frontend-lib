#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
leak-clean.py — 精确清洗敏感词（安全版）

===========================================================================
🔴 为什么这个脚本重写过
---------------------------------------------------------------------------
  第一版用**正则 + 全库替换**，把 240 个文件改坏了 ——
  连 shell 函数定义 `run()` 都被打成 `run {`，
  因为正则吃掉了 `run()` 的括号。

  ⭐ 教训（比"正则转义"更根本）：
    **批量文本清洗必须满足三条**，否则一定改坏东西：
      ① **代码文件只改注释行**，绝不碰代码本体
      ② 只用**纯字符串替换**，不用正则（正则会误吃相邻符号）
      ③ 改完必须**逐文件做语法检查**（node --check / ast.parse / bash -n）
===========================================================================
"""
import io
import os
import re
import sys
import subprocess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import terms  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ⭐ 纯字符串替换表
SUBS = [(_w, '某项目') for _w in terms.HARD_BAN]
SUBS += [(_w, '') for _w in terms.PROCESS_WORDS]

# 工单编号（W-01 之类）—— 只在注释里出现
TICKET_RE = re.compile(r'[（(]?\s*W-\d+(?:-\d+)*\s*[）)]?')
# 版本表述
TIER_RE = re.compile(
    r'[（(]?\s*(?:默认尺寸|默认尺寸|降级到\s*[ABC]|Tier\s+[ABC])'
    r'\s*[：:]?[^)）\n]{0,20}[）)]?')

SELF = {'leak-scan.py', 'leak-clean.py', 'leak-fix-paths.py', 'terms.py',
        'outsider-audit.py', 'publish-guard.py'}
EXTS = ('.js', '.py', '.html', '.css', '.md', '.json',
        '.sh', '.mjs', '.yml', '.yaml', '.txt', '.tpl')

# ⭐ 这些扩展名是"代码"⇒ 只改注释行
CODE_EXT = ('.js', '.mjs', '.py', '.sh')


def in_block_comment(lines, idx):
    """判断第 idx 行是否处于 /* */ 块注释内"""
    depth = 0
    for i in range(idx):
        depth += lines[i].count('/*') - lines[i].count('*/')
    return depth > 0


def clean_code(t):
    """代码文件：只改注释行（单次遍历维护块注释深度）"""
    lines = t.split(chr(10))
    changed = 0
    depth = 0
    in_doc = False  # 是否在 Python docstring 内
    for i, ln in enumerate(lines):
        st = ln.strip()
        opens = ln.count('/*')
        closes = ln.count('*/')
        # 本行开始时的状态
        was_in = depth > 0
        # 本行结束后
        depth += opens - closes
        if depth < 0:
            depth = 0
        now_in = depth > 0
        # ⭐ Python docstring（""" 包裹）也要算注释
        if st.startswith(chr(34)*3) or st.endswith(chr(34)*3) or in_doc:
            in_doc = not in_doc
            is_cmt = True
        else:
            is_cmt = (was_in or now_in or
                      st.startswith('//') or st.startswith('#') or
                      st.startswith('*'))
        if not is_cmt:
            continue
        new = ln
        for a, b in SUBS:
            new = new.replace(a, b)
        new = TICKET_RE.sub('', new)
        new = TIER_RE.sub('', new)
        if new != ln:
            lines[i] = new
            changed += 1
    return chr(10).join(lines), changed


def clean_doc(t):
    """文档 / CSS / HTML：整文件替换（没有语法结构可破坏）"""
    o = t
    for a, b in SUBS:
        t = t.replace(a, b)
    t = TICKET_RE.sub('', t)
    t = TIER_RE.sub('', t)
    return t, (1 if t != o else 0)


def main():
    verbose = '-v' in sys.argv
    out = subprocess.run(['git', '-c', 'core.quotePath=false', 'ls-files'],
                         cwd=ROOT, capture_output=True)
    files = [f for f in out.stdout.decode('utf-8', 'replace').split('\n')
             if f.strip()]

    nfiles = nlines = 0
    touched = []
    for rel in files:
        if rel.split('/')[-1] in SELF or not rel.endswith(EXTS):
            continue
        p = os.path.join(ROOT, rel)
        try:
            t = io.open(p, encoding='utf-8').read()
        except Exception:
            continue
        if rel.endswith(CODE_EXT):
            new, cnt = clean_code(t)
        else:
            new, cnt = clean_doc(t)
        if cnt and new != t:
            io.open(p, 'w', encoding='utf-8', newline='').write(new)
            nfiles += 1
            nlines += cnt
            touched.append((rel, cnt))

    print('  改了 %d 个文件 / %d 行' % (nfiles, nlines))
    if verbose:
        for r, c in touched:
            print('     %s  (%d)' % (r[:56], c))
    return 0


if __name__ == '__main__':
    sys.exit(main())
