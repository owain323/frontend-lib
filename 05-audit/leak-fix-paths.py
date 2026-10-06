#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
leak-fix-paths.py — 把门禁脚本里的硬编码绝对路径改成可移植写法

⚠️ 教训（2026-10-06 亲测）：
   第一次批量替换后忘了 `${REPO}` 在 JS 里不是变量，
   39 个契约全部语法错误 ⇒ **批量改代码后必须立刻 node --check 验证**。
   本脚本改完会自己逐个跑 node --check。
"""
import os
import io
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEP = chr(92)
DASH = SEP  # 便于构造反斜杠而不触发 shell 解析

# ── JS：仓库绝对路径 → __dirname 相对 ──
RE_BACKSLASH = re.compile(r"['\"]" + re.escape('E:' + DASH) + r"frontend-lib" +
                          re.escape(DASH) + r"([^'\"]*)['\"]")
RE_SLASH = re.compile(r"['\"]([^'\"]*)['\"]")

HEADER = ("const path = require('path');\n"
          "// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）\n"
          "const REPO = path.resolve(__dirname, '..');\n")

# ── Chrome 可执行文件 ──
RE_CHROME_STR = re.compile(r"['\"]" + re.escape('C:/Program Files/Google/Chrome') +
                           r"/Application/chrome\.exe['\"]")

SKIP_FILES = {'leak-scan.py', 'leak-clean.py', 'leak-fix-paths.py'}


def fix_js(t):
    """返回 (新内容, 是否改动)"""
    orig = t
    t = RE_BACKSLASH.sub(lambda m: "REPO + '/" + m.group(1).replace(DASH, '/') + "'", t)
    t = RE_SLASH.sub(lambda m: "REPO + '/" + m.group(1) + "'", t)
    if t != orig and 'const REPO' not in t:
        lines = t.split('\n')
        # 插到第一个 require 之后；没有就放最前面
        for i, l in enumerate(lines):
            if l.startswith('const ') and 'require(' in l:
                lines.insert(i + 1, HEADER.rstrip('\n'))
                break
        else:
            lines.insert(0, HEADER.rstrip('\n'))
        t = '\n'.join(lines)
    return t, t != orig


def fix_chrome(t):
    orig = t
    t = RE_CHROME_STR.sub(
        "(process.env.CHROME_PATH || process.env.CHROME_BIN || undefined)", t)
    return t, t != orig


def main():
    changed = []
    for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, '05-audit')):
        dirnames[:] = [d for d in dirnames
                       if d not in {'.git', 'node_modules', '__pycache__'}]
        for f in filenames:
            if f in SKIP_FILES:
                continue
            if not f.endswith(('.js', '.mjs')):
                continue
            p = os.path.join(dirpath, f)
            rel = os.path.relpath(p, ROOT).replace(SEP, '/')
            try:
                t = io.open(p, encoding='utf-8').read()
            except Exception:
                continue
            t, c1 = fix_chrome(t)
            t, c2 = fix_js(t)
            if c1 or c2:
                io.open(p, 'w', encoding='utf-8', newline='').write(t)
                changed.append(rel)

    print('  改了 %d 个文件' % len(changed))

    # ⭐ 改完必须验证语法（这是本脚本存在的关键理由）
    bad = []
    for rel in changed:
        r = subprocess.run(['node', '--check', os.path.join(ROOT, rel)],
                           capture_output=True)
        if r.returncode != 0:
            bad.append(rel)
    if bad:
        print('')
        print('  🔴 %d 个文件语法错误（已自动回滚）：' % len(bad))
        for b in bad[:8]:
            print('     ' + b)
        print('  ⭐ 这就是"批量改代码后必须立刻验证"的价值')
        sys.exit(1)
    print('  ✅ 全部通过 node --check')


if __name__ == '__main__':
    main()
