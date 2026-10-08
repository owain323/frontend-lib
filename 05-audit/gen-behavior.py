#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
gen-behavior.py — 微行为核的注入与漂移门禁

===========================================================================
🔴 为什么是「生成 + 门禁」而不是「抽个公共文件让大家引」
---------------------------------------------------------------------------
  CSS 有 `@import`，JS 用 `<script>` 加载时**没有**等价机制。
  于是"共享一段 JS"只有三条路：

    A. 抽成公共文件，组件运行时依赖它
       ⇒ 使用者复制了组件却漏复制核文件 ⇒ **行为静默消失**
          （本库最痛的那类失败：不报错、只是 Esc 突然关不掉了）
    B. 组件里检测有没有核，没有就用自己的副本
       ⇒ 同一份逻辑仍然写 N 份，I-14 的病一点没治
    C. 真值源一份 + 生成进使用点 + 门禁证明每个使用点跟随  ← 本脚本
       ⇒ 使用者永远只复制一个文件；"改一处"在物理上成立

  C 正是本库处理页面骨架（page.css）用过的同一个形状：
  「存在唯一汇聚点」+「使用点不得自己重抄」+「门禁证明跟随」。
  只不过 CSS 靠 @import 天然满足第二点，JS 要靠生成。

===========================================================================
用法
---------------------------------------------------------------------------
  python 05-audit/gen-behavior.py              # 把所有核注入到声明了它的组件
  python 05-audit/gen-behavior.py --check      # 只校验：使用点是否与真值源一致
  python 05-audit/gen-behavior.py --selftest   # 反向控制：证明判据会红
  python 05-audit/gen-behavior.py --list       # 列出 核 → 使用点 矩阵
===========================================================================
判据
---------------------------------------------------------------------------
  ① 每个 `BEHAVIOR INJECT` 块的内容，必须与 `01-tokens/behavior/<name>.js`
     里的核**逐行全等**（缩进位移允许，逐行内容必须一字不差）
  ② 核文件本身必须带 BEGIN/END 标记（否则无法被注入）
  ③ 组件文件里出现 `BEHAVIOR INJECT` 块但真值源里没有这个核 ⇒ 红
===========================================================================
"""
from __future__ import annotations

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORE_DIR = os.path.join(ROOT, '01-tokens', 'behavior')
COMP_DIRS = ('02-primitives', '03-patterns')

BEGIN = re.compile(r'^(?P<ind>[ \t]*)'
                   r'/\*\s*=+\s*BEHAVIOR INJECT BEGIN:\s*(?P<name>[\w-]+)\s*=+\s*\*/\s*$')
END = re.compile(r'^(?P<ind>[ \t]*)'
                 r'/\*\s*=+\s*BEHAVIOR INJECT END:\s*(?P<name>[\w-]+)\s*=+\s*\*/\s*$')
CORE_BEGIN = re.compile(r'/\*\s*=+\s*BEHAVIOR CORE BEGIN:\s*([\w-]+)\s*=+\s*\*/')
CORE_END = re.compile(r'/\*\s*=+\s*BEHAVIOR CORE END:\s*([\w-]+)\s*=+\s*\*/')


# ==========================================================================
# 真值源
# ==========================================================================
def cores():
    """核名 → 核的源码行列表（不含 BEGIN/END 标记行）。"""
    out = {}
    if not os.path.isdir(CORE_DIR):
        return out
    for f in sorted(os.listdir(CORE_DIR)):
        if not f.endswith('.js'):
            continue
        lines = io.open(os.path.join(CORE_DIR, f),
                        encoding='utf-8').read().split('\n')
        name = None
        buf = []
        for ln in lines:
            mb = CORE_BEGIN.search(ln)
            if mb:
                name = mb.group(1)
                buf = []
                continue
            me = CORE_END.search(ln) if name else None
            if me:
                out[name] = buf
                name = None
                buf = []
                continue
            if name is not None:
                buf.append(ln)
    return out


def component_files():
    found = []
    for d in COMP_DIRS:
        base = os.path.join(ROOT, d)
        for root, dirs, files in os.walk(base):
            dirs[:] = [x for x in dirs if x not in ('vendor',)]
            for f in files:
                if f.endswith('.js'):
                    found.append(os.path.join(root, f))
    return sorted(found)


# ==========================================================================
# 核心判据
# ==========================================================================
def scan_blocks(lines):
    """找出文件里所有 INJECT 块 ⇒ [(name, begin_i, end_i, indent)]"""
    blocks = []
    open_name = None
    for i, ln in enumerate(lines):
        mb = BEGIN.search(ln)
        if mb:
            open_name = (mb.group('name'), i, mb.group('ind'))
            continue
        me = END.search(ln)
        if me and open_name and me.group('name') == open_name[0]:
            blocks.append((open_name[0], open_name[1], i, open_name[2]))
            open_name = None
    return blocks


def check():
    """返回 (问题列表, 使用点矩阵)。"""
    cs = cores()
    problems = []
    matrix = {}
    for path in component_files():
        rel = os.path.relpath(path, ROOT).replace(os.sep, '/')
        lines = io.open(path, encoding='utf-8').read().split('\n')
        for name, bi, ei, ind in scan_blocks(lines):
            comp = rel.split('/')[-2] if '/' in rel else rel
            matrix.setdefault(name, []).append(comp)
            if name not in cs:
                problems.append('%s：声明注入核 `%s`，但 01-tokens/behavior/ 里没有它'
                                % (rel, name))
                continue
            want = cs[name]
            got = lines[bi + 1:ei]
            if not _same(want, got, ind):
                problems.append('%s：`%s` 块与真值源不一致 ⇒ 核改过没重新注入'
                                % (rel, name))
            # 🔴 注入了就必须**真的用**：留着块却一次都不调用，
            #    等于"付费买了 2KB 却没拿到行为"，而且没人会发现。
            if not calls_core('\n'.join(lines), name):
                problems.append('%s：注入了 `%s` 却一次都没调用它' % (rel, name))
    return problems, matrix


def calls_core(src, name):
    """有没有真的调用这个核（`dismissable` ⇒ `flDismissable`）。"""
    fn = 'fl' + _camel(name)
    return re.search(r'(?<![\w$.])' + fn + r'\s*\(', src) is not None


def _same(want, got, ind):
    """逐行全等（允许整体缩进位移）。空行只比"是否为空"。"""
    w = [x for x in want]
    g = [x for x in got]
    if len(w) != len(g):
        return False
    for a, b in zip(w, g):
        if a.strip() == '' or b.strip() == '':
            if a.strip() != b.strip():
                return False
            continue
        # 注入时每行整体加了 ind；比的时候先去掉位移，再逐字比内容
        bb = b[len(ind):] if (ind and b.startswith(ind)) else b
        if a != bb:
            return False
    return True


def inject():
    """把核写回每个使用点。返回被改写的相对路径列表。"""
    cs = cores()
    changed = []
    for path in component_files():
        src = io.open(path, encoding='utf-8').read()
        lines = src.split('\n')
        blocks = scan_blocks(lines)
        if not blocks:
            continue
        out = []
        i = 0
        touched = False
        for name, bi, ei, ind in blocks:
            out.extend(lines[i:bi + 1])
            if name in cs:
                for ln in cs[name]:
                    out.append((ind + ln) if ln.strip() else ln)
            else:
                out.extend(lines[bi + 1:ei])
            out.append(lines[ei])
            i = ei + 1
            touched = True
        out.extend(lines[i:])
        new = '\n'.join(out)
        if touched and new != src:
            io.open(path, 'w', encoding='utf-8', newline='').write(new)
            changed.append(os.path.relpath(path, ROOT).replace(os.sep, '/'))
    return changed


# ==========================================================================
# 反向控制
# ==========================================================================
def selftest():
    print('  === gen-behavior 反向控制 ===')
    ok = True
    cs = cores()
    if not cs:
        print('  [FAIL] 没有找到任何行为核')
        return 1

    # ① 改真值源的一个字节 ⇒ 使用点必须报不一致
    name = sorted(cs)[0]
    cpath = None
    for f in sorted(os.listdir(CORE_DIR)):
        if not f.endswith('.js'):
            continue
        p = os.path.join(CORE_DIR, f)
        if CORE_BEGIN.search(io.open(p, encoding='utf-8').read()):
            txt = io.open(p, encoding='utf-8').read()
            if CORE_BEGIN.search(txt).group(1) == name:
                cpath = p
                break
    if not cpath:
        print('  [FAIL] 找不到核文件')
        return 1

    raw = io.open(cpath, encoding='utf-8').read()
    # ⚠️ BEGIN 带 `^` 锚点 ⇒ 必须**逐行**匹配，不能对整段文本 search
    #    （整段文本里 `^` 只匹配开头 ⇒ 永远搜不到 ⇒ 自检会"跳过"漂移验证，
    #     而跳过就等于这条反向控制不存在 —— 典型的假绿）
    users = [p for p in component_files()
             if scan_blocks(io.open(p, encoding='utf-8').read().split('\n'))]
    if not users:
        print('  [!] 还没有组件注入任何核 ⇒ 只验证「真值源可解析」，跳过漂移验证')
        return 0 if cs else 1

    try:
        io.open(cpath, 'w', encoding='utf-8', newline='').write(
            raw.replace('var fl' + _camel(name),
                        'var fl' + _camel(name) + '__probe', 1))
        bad, _ = check()
    finally:
        io.open(cpath, 'w', encoding='utf-8', newline='').write(raw)
    if not any('不一致' in b for b in bad):
        print('  [FAIL] 真值源改了，使用点却没被判不一致 ⇒ 门禁是瞎的')
        ok = False
    else:
        print('  [OK]   真值源改一个字 ⇒ 使用点立刻报不一致')

    # ② 改使用点里的块 ⇒ 必须报不一致（证明它比的是内容，不是"有没有块"）
    upath = users[0]
    uraw = io.open(upath, encoding='utf-8').read()
    try:
        io.open(upath, 'w', encoding='utf-8', newline='').write(
            uraw + '\n/* probe */\n')
        # 上面只是加注释，不会触发；真正改块内一行：
        ulines = uraw.split('\n')
        blocks = scan_blocks(ulines)
        if blocks:
            nm, bi, ei, ind = blocks[0]
            ulines[bi + 1] = ulines[bi + 1] + ' /* 篡改 */'
            io.open(upath, 'w', encoding='utf-8', newline='').write(
                '\n'.join(ulines))
        bad2, _ = check()
    finally:
        io.open(upath, 'w', encoding='utf-8', newline='').write(uraw)
    if not any('不一致' in b for b in bad2):
        print('  [FAIL] 使用点里的块被篡改却没报错 ⇒ 门禁是瞎的')
        ok = False
    else:
        print('  [OK]   使用点里的块被篡改 ⇒ 立刻报不一致')

    # ③ 「注入了却没调用」必须能被判出来 —— 直接在字符串上验判据，
    #    不拿真实组件文件做实验（那会污染工作区）
    withcall = "var x = flDismissable({ inside: [] });"
    without = "var x = 1; /* 块留着，但没人调用它 */"
    if calls_core(withcall, 'dismissable') is not True \
            or calls_core(without, 'dismissable') is not False:
        print('  [FAIL] 「注入了却没调用」的判据不成立')
        ok = False
    else:
        print('  [OK]   注入了却没调用 ⇒ 能判出来')

    # ④ 注入是幂等的：跑两次，第二次不得产生改动
    before = io.open(upath, encoding='utf-8').read()
    inject()
    after = io.open(upath, encoding='utf-8').read()
    if before != after:
        io.open(upath, 'w', encoding='utf-8', newline='').write(before)
        print('  [FAIL] 注入不幂等（第二次跑又改了文件）')
        ok = False
    else:
        print('  [OK]   注入幂等（跑两次结果一致）')
    return 0 if ok else 1


def _camel(name):
    return ''.join(w[:1].upper() + w[1:] for w in name.split('-'))


# ==========================================================================
def main():
    args = set(sys.argv[1:])
    if '--selftest' in args:
        return selftest()
    if '--list' in args:
        _, matrix = check()
        for name in sorted(matrix):
            print('  %-16s → %s' % (name, ', '.join(sorted(matrix[name]))))
        return 0
    if '--check' in args:
        problems, matrix = check()
        n = sum(len(v) for v in matrix.values())
        if problems:
            print('  🔴 行为核漂移：')
            for p in problems[:12]:
                print('     %s' % p)
            if len(problems) > 12:
                print('       … 另有 %d 处' % (len(problems) - 12))
            print('')
            print('     ⇒ 跑 python 05-audit/gen-behavior.py 重新注入')
            return 1
        print('  OK %d 个使用点与真值源逐行一致' % n)
        return 0

    changed = inject()
    problems, matrix = check()
    n = sum(len(v) for v in matrix.values())
    print('  已注入：%d 个使用点，改写 %d 个文件' % (n, len(changed)))
    for c in changed:
        print('     %s' % c)
    if problems:
        print('  🔴 注入后仍有不一致：')
        for p in problems[:8]:
            print('     %s' % p)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
