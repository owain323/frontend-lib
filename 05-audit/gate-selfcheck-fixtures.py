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


def main():
    print('  === 门禁反向控制（门禁本身也要被检验）===')
    print('')

    backups = {}
    bad = 0
    passed = 0

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

        code, out = run_gate(script)

        if expect_fail:
            ok = code != 0
            if ok:
                passed += 1
            else:
                bad += 1
            print('  %s %-14s 注入「%s」→ %s' % (
                'OK  ' if ok else 'X ', script, why,
                '如预期报错' if ok else '门禁**没抓到**（已失效！）'))
        else:
            ok = code == 0
            if ok:
                passed += 1
            else:
                bad += 1
            print('  %s %-14s 正常内容「%s」→ %s' % (
                'OK  ' if ok else 'X ', script, why,
                '未被误报' if ok else '**误报**了'))

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
