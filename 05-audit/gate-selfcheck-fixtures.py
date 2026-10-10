#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gate-selfcheck-fixtures.py — 门禁的反向控制（K9：Test the Tests）

===========================================================================
🔴 为什么需要这道门禁
---------------------------------------------------------------------------
  门禁自己也可能**失效**：某天扩展点漏了一种文件类型、判据写错、
  词表没更新 —— 它会一直报"通过"，而实际已经在放行问题。

  实测（2026-10-06）：`leak-scan` 的 `EXTS` 列表里**没有 `.ts`**，
  往 `types/index.d.ts` 注入内部代号，它报"无敏感信息"。
  ⇒ **门禁自己被证伪了**，而且没有任何机制会发现。

  ⭐ 这道门禁做的事：拿**已知该被抓到**的样本喂给各门禁，
  确认它们真的会红。门禁不再被信任，而是**被检验**。

===========================================================================
用法
---------------------------------------------------------------------------
  python3 05-audit/gate-selfcheck-fixtures.py       # 跑全部反向控制
===========================================================================
"""
import io
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable
sys.path.insert(0, os.path.join(ROOT, '05-audit'))
import terms  # noqa: E402

# ============================================================================
# 反向控制清单：(门禁脚本, 要改的文件, 注入内容, 说明)
# ============================================================================
CASES = [
    ('leak-scan.py', 'README.md',
     '\nprobe C:/Users/probe-user/x\n', '用户名与绝对路径'),
    # ⚠️ 注入词必须**从 terms.py 取** —— 写死一个词，词表改了它就测不到真东西
    ('leak-scan.py', 'types/index.d.ts',
     '\n/** %s */\n' % terms.HARD_BAN[0], '类型定义里的内部代号'),
    ('leak-scan.py', '02-primitives/badge/badge.css',
     '\n.probe { color: #ff0000; }\n', '正常 CSS（应**不**被抓）'),
    ('leak-scan.py', 'README.md',
     '\n一段正常的中文说明文字。\n', '正常中文（应**不**被抓）'),
    # ---- 公开可用性四判据（补）----
    # 每条都配一个「正常样本」做反向控制，防止判据收得过窄变成永久假红。
    ('leak-scan.py', '02-primitives/badge/badge.css',
     '\n/* %s 报"点了不动" */\n' % terms.COLLAB_TRACE[0],
     '内部协作痕迹（Owner 称谓）'),
    ('leak-scan.py', '05-audit/css-imports.py',
     '\nCLASS_OWNER = {}\n', '同名变量CLASS_OWNER（应**不**被抓）'),
    ('leak-scan.py', '03-patterns/list/README.md',
     '\n规则见 %s/05.md\n' % terms.INTERNAL_DIRS[0],
     '引用内部目录（陌生人点进去只有 404）'),
    ('leak-scan.py', '02-primitives/date-range/demo.html',
     # ⚠️ 用**真实日期字面量**，不要从 WORK_STAMP_RE 切片 ——
     #   那是正则源码片段（'20(?:26)-(?:09|10)-\\d{2}'），
     #   切片拼出来的字符串不构成合法日期，门禁当然抓不到。
     '\n<!-- 2026-10-03：原为写死 -->\n',
     '注释里的工作日期戳'),
    ('leak-scan.py', '02-primitives/date-range/demo.html',
     '\n<!-- 范围 2020-01-01 ~ 2026-12-31，闰年用例 2024-02-29 -->\n',
     '业务日期（应**不**被抓）'),
    # ⚠️ 占位符必须写**完整的 ${NAME}** ——
    #   取 PLACEHOLDER_RE[:2] 只能拿到转义符 `\$`，拼不出真占位符。
    ('leak-scan.py', '02-primitives/switch/README.md',
     '\n用法见 ${REPO}/docs\n',
     '未替换的占位符'),
]


def run_gate(script):
    p = subprocess.run([PY, os.path.join(ROOT, '05-audit', script)],
                       cwd=ROOT, capture_output=True, timeout=90)
    return p.returncode, (p.stdout or b'').decode('utf-8', 'replace')


def hits_for(out, rel):
    """leak-scan 输出里**属于 rel 这一个文件**的命中行。

    🔴 为什么不能只看退出码（2026-10-09 事故真值）：
       我在 CHANGELOG.md 里写了一个内部流程词 ⇒ leak-scan 全库报 1 处。
       而这里十条样本**全是拿退出码判的** ⇒ 4 条「正常内容应不被抓」被报成
       **「误报了」** —— 报告是**误导性**的：它们一个都没误报，
       红的是另一个不相干的文件。
       ⇒ 判据必须**归因到被注入的那一个文件**，不能用全库的脸色。
    """
    return re.findall(r'^\s*' + re.escape(rel) + r'\b.*$', out, re.M)


def scanned_n(out):
    """leak-scan 实际扫了多少个文件。

    ⚠️ 顺手堵一个更隐蔽的假绿：扫到 **0 个文件**时退出码也是 0，
       ⇒ 「正常内容应不被抓」那几条会**全部假绿通过**。
       现在要求"确实扫到了文件"才算"未被误报"。
    """
    m = re.search(r'扫了\s*(\d+)\s*个文件', out)
    return int(m.group(1)) if m else 0


def verdict(script, rel, why):
    """跑一次门禁，给出 (是否如预期, 说明)。注入由调用方负责。

    🔴 抽成函数不只是为了少写代码：
       下面 `_check_attribution()` 要在**别处有命中**的前提下跑同一条判据，
       两条路径必须走**同一份判定逻辑** —— 否则"归因检查"可能在验证一个
       早已和真实路径漂移的副本（I-10：报告通过却没查到被测代码）。
    """
    _code, out = run_gate(script)
    hits = hits_for(out, rel)
    n = scanned_n(out)
    if '应**不**被抓' not in why:                 # 该被抓
        if hits:
            return True, '如预期报错（命中 %s：%s）' % (rel, hits[0].strip())
        return False, '门禁**没抓到**（已失效！扫了 %d 个文件）' % n
    if hits:                                      # 不该被抓，却被点名
        return False, '**误报**了：%s' % hits[0].strip()
    if n <= 0:
        return False, '⚠️ 扫了 **0 个文件** ⇒ 这条"通过"不作数（门禁视野已空）'
    return True, '未被误报（已扫 %d 个文件）' % n


def _check_attribution():
    """🔴 反向控制：判据必须**归因到被注入的那一个文件**。

    事故真值（2026-10-09）：旧逻辑用**全库退出码**判定 ⇒ 别处一个命中，
    就让 4 条「正常内容」被报成「**误报**了」—— 报告是**误导性**的，
    它们一条都没误报，红的是另一个不相干的文件。

    ⇒ 本函数把那个场景重造一遍，确认新逻辑不再被带偏：
         · 被注入的文件**必须**被点名
         · 没被注入的文件**必须不**被点名（**哪怕全库退出码是红的**）
    """
    victim = 'CHANGELOG.md'
    bystander = '02-primitives/badge/badge.css'
    p_v = os.path.join(ROOT, victim)
    p_b = os.path.join(ROOT, bystander)
    if not (os.path.isfile(p_v) and os.path.isfile(p_b)):
        return ['归因检查跳过：样本文件不存在（%s / %s）' % (victim, bystander)]
    orig = io.open(p_v, encoding='utf-8').read()
    try:
        with io.open(p_v, 'w', encoding='utf-8', newline='') as fh:
            fh.write(orig + '\n内部流程词：%s\n' % terms.PROCESS_WORDS[0])
        code, out = run_gate('leak-scan.py')
        # ① 场景必须真的造出来：全库得是红的，否则这次验证是**空转**
        if code == 0:
            return ['场景没造出来：注入后 leak-scan 竟全库通过 ⇒ 归因验证等于没跑']
        # ② 被注入的文件必须被点名
        if not hits_for(out, victim):
            return ['注入了内部流程词，leak-scan 却没点名 %s ⇒ 门禁没抓到' % victim]
        # ③ 🔴 关键：在"别处有命中"的前提下，**真跑一条**「正常内容」样本
        #    ⇒ 退回"只看退出码"的旧逻辑，这一条会立刻红（旧逻辑在此场景必报误报）
        ok, msg = verdict('leak-scan.py', bystander, '正常 CSS（应**不**被抓）')
    finally:
        with io.open(p_v, 'w', encoding='utf-8', newline='') as fh:
            fh.write(orig)
    if not ok:
        return ['别处有命中时，未被注入的样本被判成「%s」⇒ 判据没归因到单个文件' % msg]
    return []


def _check_scannable_fallback():
    """🔴 反向控制：`scannable_files()` 在**没有 git** 的树里不得返回 0 个文件。

    ⚠️ 为什么这条必须存在（2026-10-09 实测发现的路径）：
       用远端 tarball（无 .git）当干净克隆跑全套门禁时 ——
         · api-doc 报「实现里挂载的全局对象：**0 个**」⇒ 红（还算吵）
         · leak-scan 四个注入**一个都没抓到** ⇒ 报"无敏感信息"（**假绿**）
       根因：`scannable_files()` 只走 `git ls-files`，没有 git 就返回空列表。
       ⚠️ 而"扫到 0 个文件 ⇒ 什么都没抓到 ⇒ 报通过"，正是 I-10
          （报告通过却什么也没查）的又一种形态 —— 而且是最安静的那种。

    ⇒ 本函数验证两件事：
       ① 无 git 的临时目录里，兜底必须真的枚举出文件（不许 0 个）
       ② 兜底的视野必须与 git 视野**一致**（多一个少一个都不行：
          少了 ⇒ 漏检；多了 ⇒ 把 gitignore 掉的生成产物也扫进来）
    """
    import shutil
    sys.path.insert(0, os.path.join(ROOT, '05-audit'))
    import _common

    out = []

    # ① 无 git ⇒ 不许返回 0
    tmp = tempfile.mkdtemp(prefix='fl-nogit-')
    try:
        io.open(os.path.join(tmp, 'a.js'), 'w', encoding='utf-8').write('var a=1;')
        io.open(os.path.join(tmp, '.gitignore'), 'w', encoding='utf-8').write(
            'gen/\n*.log\n')
        os.makedirs(os.path.join(tmp, 'gen'))
        io.open(os.path.join(tmp, 'gen', 'x.js'), 'w', encoding='utf-8').write('x')
        io.open(os.path.join(tmp, 'b.log'), 'w', encoding='utf-8').write('x')
        got = _common.scannable_files(tmp)
        if 'a.js' not in got:
            out.append('无 git 时兜底没枚举出 a.js（返回 %r）⇒ 假绿的根源' % (got,))
        elif 'gen/x.js' in got or 'b.log' in got:
            out.append('兜底没有尊重 .gitignore（扫进了 %r）' % (got,))
        else:
            print('  OK   %-14s 无 git 的树里仍能枚举出文件，且尊重 .gitignore'
                  % 'scannable_files')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # ② 两种视野必须一致
    git_view = set(_common.scannable_files(ROOT))
    walk_view = set(_common._walk_all(ROOT))
    if git_view != walk_view:
        extra = sorted(walk_view - git_view)[:4]
        less = sorted(git_view - walk_view)[:4]
        out.append('兜底视野与 git 视野不一致（兜底多 %s / 兜底少 %s）'
                   % (extra, less))
    else:
        print('  OK   %-14s 兜底视野与 git 视野完全一致（%d 个文件）'
              % ('scannable_files', len(git_view)))
    return out


def main():
    print('  === 门禁反向控制（门禁本身也要被检验）===')
    print('')

    backups = {}
    bad = 0
    passed = 0

    for line in _check_scannable_fallback():
        print('  X    ' + line)
        bad += 1

    att = _check_attribution()
    for line in att:
        print('  X    ' + line)
        bad += 1
    if not att:
        print('  OK   leak-scan 的命中归因到单个文件（别处命中不会带偏本项）')

    for script, rel, inject, why in CASES:
        path = os.path.join(ROOT, rel)
        if not os.path.isfile(path):
            print('  跳过 %s（文件不存在）' % rel)
            continue

        # 备份原内容
        with io.open(path, encoding='utf-8') as fh:
            orig = fh.read()
        backups[path] = orig

        expect_fail = '应**不**被抓' not in why
        with io.open(path, 'w', encoding='utf-8', newline='') as fh:
            fh.write(orig + inject)

        # 🔴 归因到**被注入的那一个文件**（见 hits_for 的注释）：
        #    全库退出码会把别处的命中算到这条样本头上 ⇒ 报告误导。
        ok, msg = verdict(script, rel, why)
        if ok:
            passed += 1
        else:
            bad += 1
        label = '注入「%s」' % why if expect_fail else '正常内容「%s」' % why
        print('  %s %-14s %s → %s' % ('OK  ' if ok else 'X ', script, label, msg))

        # 还原
        with io.open(path, 'w', encoding='utf-8', newline='') as fh:
            fh.write(orig)

    print('')
    print('  通过 %d / %d' % (passed, passed + bad))
    if bad:
        print('')
        print('  ⇒ 有 %d 项没通过：门禁自身已失效或误报。' % bad)
        print('    ⭐ 门禁报"通过"不代表它还在工作 —— 必须持续反向控制。')
        return 1
    print('  OK 所有门禁的反向控制都通过')
    return 0


if __name__ == '__main__':
    sys.exit(main())
