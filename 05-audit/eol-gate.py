#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
eol-gate.py — 受版本控制的文本文件必须是 LF（D4 的**防守**，不只是搬运）

============================================================================
🔴 为什么需要它
----------------------------------------------------------------------------
  D4（全仓行尾统一到 LF）做过一次人工搬运：把当时所有 CRLF 文件转成 LF。

  但"搬运"不等于"约束"。做完之后，**生成器每跑一次就把文件翻回 CRLF**，
  实测撞到三次，每次都是同一个根因：

    ① `theme-sync.py`        写 `01-tokens/tokens.css`
    ② `make-tiersnippet.py`  写 `04-recipes/tierA-tokens.css`
    ③ `shot-baseline.py`     写 `10-review/shots/_baseline-dark/_stamp.json`

  三处都是 `open(path, 'w', encoding='utf-8')` —— Windows 上默认
  `newline=None` ⇒ 每个 `\\n` 写成 `\\r\\n`。

  为什么一直没人发现：**没有任何门禁直接检查行尾**。
  `git` 只会打印一句 warning（"CRLF will be replaced by LF the next time
  Git touches it"），而 warning 不会让任何东西变红。

  ⇒ 本条门禁就是那个"会变红的东西"。D4 的搬运是修症状，这条是修机制。

============================================================================
判据
----------------------------------------------------------------------------
  ① `git ls-files --eol` 里，**索引侧**不得是 `crlf` / `mixed`
     （索引 = 真正进仓库的字节；这一侧脏了，别人 clone 下来就是脏的）
  ② **工作区侧**也不得是 `crlf` / `mixed`
     （工作区脏了，任何一次 `git add` 都会把 CRLF 写进索引）
  ③ 零视野守卫：`git ls-files --eol` 一条都读不到 ⇒ 红
     （不在仓库里 / git 不可用 ⇒ fail-closed，不许当"没有坏文件"）
  ④ 二进制（`none`）不参与判断 —— 它们没有"行尾"这回事

⚠️ 用 `git ls-files --eol` 而不是自己读文件：
   它会区分 **index / worktree / attributes** 三个视角，
   而且不用把整棵树读进内存。自己扫字节只能看到工作区，
   看不到"索引里存的是什么"。

============================================================================
用法
----------------------------------------------------------------------------
  python 05-audit/eol-gate.py
  python 05-audit/eol-gate.py --selftest   # 反向控制（伪造 --eol 输出）
  python 05-audit/eol-gate.py --fix        # 把工作区的 CRLF 转成 LF（人工确认后才跑）
"""
import io
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# `git ls-files --eol` 的一行长这样（字段之间是制表符）：
#   i/lf    w/lf    attr/                  README.md
#   i/crlf  w/crlf  attr/                  old.txt
#   i/none  w/none  attr/                  logo.png
BAD = ('crlf', 'mixed')
# `none` = 空文件；`-text` = 二进制（git 不做行尾转换，也没有行尾可言）
NON_TEXT = ('none', '-text')


def parse_eol_line(line):
    """→ (index_eol, worktree_eol, path) 或 None（认不出来的行）"""
    parts = line.split('\t', 1)
    if len(parts) != 2:
        return None
    flags = parts[0].split()
    if len(flags) < 2:
        return None
    idx = flags[0].split('/', 1)[-1]
    wt = flags[1].split('/', 1)[-1]
    return idx, wt, parts[1].strip()


def problems_from(lines):
    """纯函数：给定 `git ls-files --eol` 的输出行，返回 (问题, 文本路径, 二进制数)。

    抽成纯函数是为了能让 `--selftest` 用**伪造输入**测它 ——
    反向控制不该依赖"仓库里恰好有个坏文件"（那种前提会随仓库状态漂移，
    本项目在 E50 记过同一类教训）。
    """
    bad = []
    texts = []
    skipped = 0
    for ln in lines:
        p = parse_eol_line(ln)
        if p is None:
            continue
        idx, wt, path = p
        # 🔴 git 对二进制的标记是 **`-text`**，不是 `none`（`none` 是空文件）。
        #    第一版只排除了 `none` ⇒ 68 个 png 全被当文本计数，
        #    输出写着"二进制 0 个不计"——数字是错的（虽然没误报：
        #    png 含空字节 ⇒ git 一律判 `-text`，永远不会落进 BAD）。
        if idx in NON_TEXT and wt in NON_TEXT:
            skipped += 1
            continue                      # 二进制 / 空文件，没有行尾
        texts.append(path)
        why = []
        if idx in BAD:
            why.append('索引侧 %s' % idx)
        if wt in BAD:
            why.append('工作区侧 %s' % wt)
        if why:
            bad.append((path, ' / '.join(why)))
    return bad, texts, skipped


def run_git_lines():
    try:
        r = subprocess.run(['git', 'ls-files', '--eol'], cwd=ROOT,
                           capture_output=True, text=True, encoding='utf-8',
                           errors='replace', timeout=120)
    except (OSError, subprocess.TimeoutExpired) as e:
        return None, 'git 跑不起来：%s' % e
    if r.returncode != 0:
        return None, 'git ls-files 返回 %d：%s' % (r.returncode,
                                                   (r.stderr or '')[:200])
    return r.stdout.splitlines(), None


def find_nul(paths):
    """文本文件里不该出现 NUL 字节。

    🔴 为什么这件事放在"行尾门禁"里
      git 把文件判为**文本**（`lf` / `crlf`）却含 0x00，本身就是自相矛盾：
      同一个文件在两个工具眼里是两种东西（git 说文本，grep 说二进制）。
      这和"行尾不统一"是同一层的问题 —— **文件本身被写坏了**。

      实测来源：写文件时把反斜杠零当转义序列传进去，落盘就是真的 0x00。
      危害在于**静默**：`grep` 遇到 NUL 会把它当二进制、直接不显示，
      `ast.parse` 也只是整份拒绝，看不出是哪一行。
    """
    bad = []
    for rel in paths:
        p = os.path.join(ROOT, rel)
        try:
            d = io.open(p, 'rb').read()
        except (IOError, OSError):
            continue
        if b'\x00' in d:
            bad.append(rel)
    return bad


def main():
    argv = sys.argv[1:]
    if '--selftest' in argv:
        return selftest()

    lines, err = run_git_lines()
    if err:
        print('  [FAIL] %s（fail-closed：读不到视野就不能判"干净"）' % err)
        return 1
    if not lines:
        print('  [FAIL] 零视野：`git ls-files --eol` 一条都没读到 —— '
              '多半是工作目录不对，不是"没有坏文件"')
        return 1

    bad, texts, skipped = problems_from(lines)
    if not texts:
        print('  [FAIL] 零视野：解析出 %d 条记录，全是认不出的格式' % len(lines))
        return 1
    fail = 0
    if bad:
        fail += 1
        print('  [FAIL] %d / %d 个文本文件不是 LF' % (len(bad), len(texts)))
        for path, why in bad[:15]:
            print('    · %-52s %s' % (path, why))
        if len(bad) > 15:
            print('    … 另有 %d 个' % (len(bad) - 15))
        print('\n  ⇒ CRLF 进仓库的代价：任何跨机 diff 都会显示"整个文件都改了"，'
              '\n     代码评审只能看天。')
        print('  ⇒ 生成器写产物时必须显式 `newline=\'\\n\'`（Windows 默认转 CRLF）。')

    nuls = find_nul(texts)
    if nuls:
        fail += 1
        print('  [FAIL] %d 个文本文件含 NUL 字节（git 判为文本，内容却是二进制）'
              % len(nuls))
        for rel in nuls[:10]:
            print('    · ' + rel)
        print('\n  ⇒ 典型来源：写文件时把"反斜杠零"当转义传进去，落盘成了真的 0x00。')
        print('  ⇒ 它**静默**：grep 会把文件当二进制、直接不显示内容。')

    if fail:
        return 1
    print('  [OK] %d 个文本文件全部 LF 且无 NUL 字节'
          '（索引侧与工作区侧都干净；二进制 %d 个不计）'
          % (len(texts), skipped))
    return 0


def selftest():
    """反向控制：用**伪造的** `git ls-files --eol` 输出，逐种情况验判据。"""
    print('  === eol-gate 反向控制 ===')
    ok = True

    # 🔴 fixture 的格式必须与 `git ls-files --eol` 真实输出一致：
    #   三个 flag 之间是**空白**（多个空格对齐），path 之前是**制表符**。
    #     i/lf    w/lf    attr/                   README.md
    #     └──────── 空格分隔 ────────┘└── tab ──┘
    #    第一版伪造时把 flag 之间也写成了 tab ⇒ `split('\t', 1)` 只切出
    #    一个 flag ⇒ `len(flags) < 2` ⇒ 整行被跳过 ⇒ 判据"期望红却绿"。
    #    这就是 E50 记的同一类病：**fixture 前提错了，看起来像判据没牙**。
    def row(idx, wt, path, attr='attr/'):
        return '%s %s %s\t%s' % (idx, wt, attr, path)

    cases = [
        ('全 LF', [row('i/lf', 'w/lf', 'README.md')], False, '没有坏文件'),
        ('索引侧 CRLF', [row('i/crlf', 'w/crlf', 'a.css')], True, '索引侧 crlf'),
        ('只有工作区 CRLF', [row('i/lf', 'w/crlf', 'b.js')], True, '工作区侧 crlf'),
        ('mixed（同一文件混行尾）', [row('i/mixed', 'w/mixed', 'c.md')], True, 'mixed'),
        ('空文件 none 不计', [row('i/none', 'w/none', 'empty.txt')], False, '空文件'),
        ('二进制 -text 不计（git 的真实标记）',
         [row('i/-text', 'w/-text', 'logo.png')], False, '二进制'),
        ('CRLF 混在正常文件里', [
            row('i/lf', 'w/lf', 'a.css'),
            row('i/crlf', 'w/crlf', 'b.css'),
            row('i/lf', 'w/lf', 'c.css'),
        ], True, '两个坏的一个好的'),
        ('attrs 字段存在也不影响', [row('i/lf', 'w/lf', 'd.txt', 'attr/text=auto')],
         False, '带 attributes'),
        ('多空格对齐（真实输出常见）',
         ['i/lf      w/lf      attr/                   e.md'], False, '多空格对齐'),
    ]

    for why, lines, should_fail, desc in cases:
        bad, texts, _sk = problems_from(lines)
        got = len(bad) > 0
        good = (got == should_fail)
        ok = ok and good
        print('  [%s] %-26s %-16s 期望%s ⇒ 实际%s%s'
              % ('OK ' if good else 'FAIL', why, desc,
                 '红' if should_fail else '绿', '红' if got else '绿',
                 '' if good else '  ← 判据没牙'))

    # 零视野守卫：解析不出任何记录时必须能被上层识别
    bad, texts, _sk = problems_from(['随便一行不是 eol 格式'])
    good = (len(texts) == 0)
    ok = ok and good
    print('  [%s] %-26s %-16s 期望被识别为零视野 ⇒ %s'
          % ('OK ' if good else 'FAIL', '不可解析的输入', '文本数为 0',
             '是' if good else '否'))

    print('\n  结论：%s' % ('四条判据都有牙' if ok else '🔴 有判据形同虚设'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
