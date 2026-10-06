#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
hygiene.py — 工程卫生检查

查四件容易积累但没人主动清的事：
  ① 临时文件残留（*.bak / *.tmp / *.orig / *~ / *.rej）
  ② 调试代码残留（console.log / debugger / TODO:FIXME / XXX:）
  ③ 孤儿文件（存在但没被任何 demo / README / 门禁引用）
  ④ 硬编码色值（组件里写死 #hex 而不是用令牌）

为什么值得建：
  ①②④ 靠人眼扫会漏 —— 文件多了就看不见了。
  ③ 更隐蔽：一个组件做完、改了名，旧的 demo 还指着它，
     或者反过来新文件忘了被引用 ⇒ **包发出去才发现少东西**。

🔴 建这个脚本的直接原因：
   工程卫生不能只靠手工扫 —— 手工只看得到表面。

判据边界（避免假警）：
  · ② 只扫**组件与 demo**（0*/ examples/），不扫 05-audit ——
    门禁脚本里 console.log 是**正常输出**，不是残留。
  · ③ demo/README/门禁/pack 清单里出现过的路径算"被引用"。
  · ④ 允许在**注释、演示用的反例**、以及 CSS 自定义属性定义处出现 #hex。
"""
import sys
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 不扫的目录（门禁自己的输出不算残留）
SKIP_DIRS = ('05-audit', '07-notes', '08-plan', '.git')

# ② 调试残留的判据
DEBUG_PATTERNS = [
    (r'console\.log\(', 'console.log'),
    (r'\bdebugger\b\s*;?', 'debugger'),
    (r'TODO\s*:\s*FIXME', 'TODO:FIXME'),
    (r'XXX\s*:', 'XXX:'),
    (r'\bdebugger_statement\b', 'debugger 语句'),
]

# ④ 硬编码色值：排除定义处与注释
HEX = re.compile(r'#[0-9a-fA-F]{3,8}\b')


def files_under(patterns):
    out = []
    for p in patterns:
        out += glob.glob(os.path.join(ROOT, p), recursive=True)
    return [f for f in out
            if not any(d in f.replace('\\', '/') for d in SKIP_DIRS)]


def check_temp():
    junk = []
    for p in glob.glob(os.path.join(ROOT, '**', '*'), recursive=True):
        base = os.path.basename(p)
        if base.endswith(('.bak', '.tmp', '.orig', '~', '.rej', '.old')):
            junk.append(os.path.relpath(p, ROOT))
    return junk


def check_debug():
    hits = []
    for f in files_under(('0*/*.css', '0*/*.js', '0*/*.html',
                          'examples/**/*.html', 'examples/**/*.js')):
        try:
            s = open(f, encoding='utf-8', errors='replace').read()
        except OSError:
            continue
        # 去掉注释与 <style>/<script> 之外的散文
        code = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
        code = re.sub(r'<!--.*?-->', '', code, flags=re.S)
        for pat, name in DEBUG_PATTERNS:
            if re.search(pat, code):
                hits.append((os.path.relpath(f, ROOT), name))
    return hits


def collect_refs():
    """所有"提到过某个源文件"的地方。"""
    refs = set()
    scan = (glob.glob(os.path.join(ROOT, '*.md'))
            + glob.glob(os.path.join(ROOT, '0*', '*', 'README.md'))
            + glob.glob(os.path.join(ROOT, '0*', '*', '*.html'))
            + glob.glob(os.path.join(ROOT, 'examples', '*', '*.html'))
            + glob.glob(os.path.join(ROOT, 'examples', '*', '*.js'))
            + glob.glob(os.path.join(ROOT, 'examples', '*', '*.md'))
            + glob.glob(os.path.join(ROOT, '05-audit', '*.py'))
            + glob.glob(os.path.join(ROOT, '05-audit', '*.js'))
            + glob.glob(os.path.join(ROOT, '05-audit', '*.sh')))
    for f in scan:
        if not os.path.isfile(f):
            continue
        try:
            s = open(f, encoding='utf-8', errors='replace').read()
        except OSError:
            continue
        for m in re.findall(r'[\w/\-.]+\.(?:css|js|html)', s):
            refs.add(m.replace('\\', '/'))
    return refs


def check_orphans():
    refs = collect_refs()
    srcs = files_under(('0*/*/*.css', '0*/*/*.js', '0*/*/demo.html',
                        'examples/*/index.html', '04-recipes/*/*.html'))
    orphans = []
    for f in srcs:
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        base = os.path.basename(f)
        if rel in refs or base in refs:
            continue
        if os.path.basename(os.path.dirname(f)) + '/' + base in refs:
            continue
        if rel.startswith('04-recipes/'):
            continue          # recipe 由 START-HERE 整体引用
        orphans.append(rel)
    return orphans


def check_hardcoded_hex():
    """组件里写死 #hex（令牌定义处除外）。

    🔴 第一版把 01-tokens 也扫进来 ——
       而 tokens.css **本来就是色值定义处**，扫它等于扫自己。
       只扫 02/03（真正的组件层）。
    """
    hits = []
    for f in files_under(('02-*/*/*.css', '03-*/*/*.css')):
        try:
            s = open(f, encoding='utf-8').read()
        except OSError:
            continue
        body = re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'),
                      s, flags=re.S)   # 注释清空但保留行号
        lines = body.split('\n')
        for i, ln in enumerate(lines):
            # 令牌定义行（--x: #hex）不算
            if re.match(r'\s*--[\w-]+\s*:', ln):
                continue
            # demo 反例里的内联色值不算（那是"故意展示坏做法"）
            for m in HEX.finditer(ln):
                hits.append((os.path.relpath(f, ROOT).replace('\\', '/'),
                             i + 1, m.group(0)))
    return hits


def main():
    junk = check_temp()
    dbg = check_debug()
    orph = check_orphans()
    hexes = check_hardcoded_hex()

    bad = 0
    if junk:
        bad += len(junk)
        print('  [FAIL] 临时文件残留 %d 个：' % len(junk))
        for j in junk[:10]:
            print('     · ' + j)
    else:
        print('  [OK  ] 无临时文件残留')

    if dbg:
        bad += len(dbg)
        print('  [FAIL] 调试代码残留 %d 处：' % len(dbg))
        for f, name in dbg[:10]:
            print('     · %s  (%s)' % (f, name))
    else:
        print('  [OK  ] 组件与 demo 里无 console.log / debugger / TODO:FIXME')

    if orph:
        print('  [注意] 未被任何地方引用的源文件 %d 个（**不是错**，'
              '但发包前要确认是有意留的）：' % len(orph))
        for o in orph[:10]:
            print('     · ' + o)
    else:
        print('  [OK  ] 没有孤儿文件')

    if hexes:
        print('  [注意] 组件里写死的 #hex %d 处（应改用令牌，'
              '否则换主题不会跟着变）：' % len(hexes))
        for f, ln, h in hexes[:12]:
            print('     · %s L%d  %s' % (f, ln, h))
    else:
        print('  [OK  ] 组件里没有写死的 #hex')

    if bad:
        print('')
        print('  %d 项必须修。' % bad)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
