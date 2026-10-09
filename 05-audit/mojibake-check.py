#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mojibake-check.py — 乱码（编码损坏）门禁

===============================================================================
起因：iOS 真机截图里出现乱码黑块，
   实测发现**全库 13 个文件**都有编码损坏的字。
===============================================================================

🔴🔴 视野曾经漏掉一整类文件（2026-10-10 修）
------------------------------------------------------------------------------
   `EXTS` 里**没有 `.ts`** ⇒ `types/*.d.ts` 从头到尾没被扫过。
   而 `types/index.d.ts` 里真的有一处乱码（thisQ 那一行的"本"字烂成了 U+FFFD），
   门禁却一直报"✅ 无乱码" —— **假绿**。
   ⇒ 扩展名白名单这种写法本身就危险：没列进去的文件类型**永远不会被看一眼**。
   ⇒ 现在把仓库里实际存在的源码扩展名全列上（`.ts` / `.py` / `.sh` / `.yml` / `.mjs`）。
   ⚠️ 自己的文档里**不许**再用 U+FFFD 字面量举例子 ——
      那样一开 `.py` 扫描就会把自己判成乱码（下面的说明改用文字描述）。

为什么需要这道门禁
------------------------------------------------------------------------------
乱码的三个特点让它必须自动化：

1. **目视极易漏** —— 一个乱码字混在 500 行文字里，眼睛会滑过去
2. **不报错** —— 浏览器照常渲染，只是显示错字
3. **来源隐蔽** —— 大多是"用 Python 读写时编码没配对"
   （写时用了 utf-8，读时用了别的编码，再写回去就坏了）

⚠️ 已知的两个真实成因（都踩过）：
   ① heredoc 里 `\\1` / `\\d` 这类转义在写入时被吃掉
   ② 用 `io.open(..., encoding='gbk')` 读 utf-8 文件再写回

判据
------------------------------------------------------------------------------
* 文件必须是**合法 UTF-8**（否则解码直接失败）
* 解码后**不得包含 U+FFFD 替换字符**（`\ufffd`）——
  这个字符的出现就说明"解码时遇到了无法识别的字节"
"""

import io
import os
import sys

SEP = chr(92)   # os.sep 的字面量（Windows 上是反斜杠）

SKIP_DIRS = {'.git', 'node_modules', '__pycache__',
             # 🔴 补：视觉回归的**产物目录**。
             #    实测踩坑：`_current/` 里存的是**截图产物**，
             #    但扩展名被写成 `.html`（内容其实是 PNG）
             #    ⇒ 本脚本把它们当 HTML 扫 ⇒ 报「编码损坏」23 个文件。
             #    ⚠️ 这类"名字骗人"的产物目录必须显式排除，
             #       否则门禁会长期假红（大家会习惯性忽略）。
             '10-review/shots/_current',
             '10-review/shots/_diff',
             '_selftest'}
# 🔴 白名单必须覆盖仓库里**实际存在**的源码扩展名。
#    漏一个 ⇒ 那一类文件永远不会被扫（`.ts` 就这么漏了很久）。
#    ⚠️ 新增文件类型时，**这里也要补**，否则新类型天然免疫。
EXTS = ('.html', '.css', '.js', '.mjs', '.md', '.json', '.txt', '.svg',
        '.ts', '.py', '.sh', '.yml')
BAD = '\ufffd'          # U+FFFD 替换字符


def check(path):
    """返回问题描述列表（空 = 通过）"""
    problems = []
    raw = open(path, 'rb').read()
    try:
        s = raw.decode('utf-8')
    except UnicodeDecodeError as e:
        return ['不是合法 UTF-8：%s' % str(e)[:60]]

    if BAD not in s:
        return []

    n = s.count(BAD)
    lines = [i + 1 for i, l in enumerate(s.split('\n')) if BAD in l]
    problems.append('%d 个替换字符（U+FFFD），行 %s' % (n, lines[:8]))
    # 打印每行的问题片段，帮人定位
    for i, l in enumerate(s.split('\n')):
        if BAD in l:
            idx = l.index(BAD)
            frag = l[max(0, idx - 20):idx + 20]
            problems.append('  L%d: …%s…' % (i + 1, frag))
        if len(problems) > 10:
            break
    return problems


def scan(root):
    """返回 (扫了几个文件, [(路径, 问题描述)])"""
    bad = []
    n = 0
    for dirpath, dirnames, filenames in os.walk(root):
        # 🔴 排除项要匹配**完整相对路径**（产物目录是嵌套两层的：
        #    10-review/shots/_current/，只按目录名匹配不到）
        rel = os.path.relpath(dirpath, root).replace(SEP, '/')
        rel = '' if rel == '.' else rel
        dirnames[:] = [d for d in dirnames
                       if d not in SKIP_DIRS
                       and ((rel + '/' + d) if rel else d) not in SKIP_DIRS]
        for f in filenames:
            if not f.endswith(EXTS):
                continue
            p = os.path.join(dirpath, f)
            n += 1
            probs = check(p)
            if probs:
                bad.append((p, probs))
    return n, bad


def selftest():
    """🔴 证明这道门禁**会红**（否则"无乱码"可能只是"没扫到"）。

    四条反向控制：
      · 干净的 .ts  ⇒ 不许报
      · 含 U+FFFD 的 .ts ⇒ 必须报（历史 bug：.ts 根本不在视野里）
      · 含 U+FFFD 的 .py ⇒ 必须报
      · 非白名单扩展名（.png）里的 U+FFFD ⇒ 不报（产物不扫，避免假红）
    """
    import shutil
    import tempfile
    tmp = tempfile.mkdtemp(prefix='mojibake-selftest-')
    bad = 0
    try:
        def w(name, text):
            p = os.path.join(tmp, name)
            io.open(p, 'w', encoding='utf-8').write(text)
            return p
        w('clean.ts', 'export const a = 1; // 正常中文注释\n')
        w('bad.ts', 'const s = "本\ufffd度";\n')
        w('bad.py', '# 注释里有 \ufffd 乱码\n')
        w('shot.png', '\ufffd\ufffd')      # 不在白名单 ⇒ 不该被扫
        n, found = scan(tmp)
        names = dict((os.path.basename(p), probs) for p, probs in found)

        def ok(cond, why):
            nonlocal bad
            print('  %s %s' % ('OK  ' if cond else '🔴', why))
            if not cond:
                bad += 1

        ok(n == 3, '只扫白名单内的 3 个文件（实际 %d）' % n)
        ok('clean.ts' not in names, '干净的 .ts 不报')
        ok('bad.ts' in names, '含替换字符的 .ts 必须报（.ts 必须在视野里）')
        ok('bad.py' in names, '含替换字符的 .py 必须报')
        ok('shot.png' not in names, '非白名单扩展名不扫（产物目录不误报）')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    if bad:
        print('\n  ❌ mojibake 反向控制：%d 项不合格' % bad)
        return 1
    print('\n  ✅ mojibake 反向控制：4 条全过')
    return 0


def main():
    if '--selftest' in sys.argv:
        return selftest()
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    n, bad = scan(root)

    print('扫描了 %d 个文件' % n)
    if not bad:
        print('✅ 无乱码（全部是合法 UTF-8，且不含替换字符）')
        return 0

    print('❌ %d 个文件含编码损坏：' % len(bad))
    for p, probs in bad:
        print('  ' + p.replace(os.sep, '/'))
        for x in probs:
            print('    ' + x)
    print('')
    print('🔴 怎么修：')
    print('   1. 打开对应文件，找到行号')
    print('   2. 把那个替换字符（显示成黑色菱形问号）换成正确的字')
    print('   3. 若整段都坏了 ⇒ 从 git 或备份恢复该段')
    print('   ⚠️ 预防：读写文本文件时**显式指定 encoding="utf-8"**，')
    print('      不要用系统默认编码（Windows 上可能是 gbk）')
    return 1


if __name__ == '__main__':
    sys.exit(main())
