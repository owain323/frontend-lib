#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
overlay-host-reverse.py — `overlay-host-check.js` 的**常驻反向控制**

===========================================================================
🔴 为什么不是"写的时候手动验一次"就够
---------------------------------------------------------------------------
  判据会红这件事**会过期**：
    · 变异体是硬编码的字符串替换，overlay.js 一改形状它就匹配不上
      ⇒ 那个"反例"其实没生效
    · 判据本身被改宽（比如容差从 0 放宽到 100px）⇒ 缺陷再也抓不到
  两种情况下门禁都照样打印 PASS —— 这就是"假绿"。

  ⇒ 所以反向控制必须**每次都跑**（接在 behavior-reverse.sh 里），
    掉了牙它自己会叫。

===========================================================================
怎么判"有鉴别力"
---------------------------------------------------------------------------
  对每个变异体：打补丁 → 重跑 overlay-host-check → **必须非零退出**。
  只要有一个变异体跑出 0 ⇒ 判据对它没牙 ⇒ 本脚本红。

  ⭐ 补丁前先确认目标串**真的在文件里**（否则"变异没生效"会被误当成
     "判据很稳"）⇒ 那也算失败。

===========================================================================
安全性
---------------------------------------------------------------------------
  变异的是**源码**，跑完必须还原。`finally` + 独立备份文件双保险；
  万一中途崩了，下一次跑会先在备份里恢复。
===========================================================================
用法：python 05-audit/overlay-host-reverse.py
"""
import io
import os
import subprocess
import sys

SRC = os.path.join('03-patterns', 'overlay', 'overlay.js')
BAK = SRC + '.__reverse.bak'
GATE = ['node', os.path.join('05-audit', 'overlay-host-check.js')]

# (说明, 原串, 变异串, 期望被抓到的判据编号)
MUTANTS = [
    ('补偿从"叠加"改成"替换"',
     "document.body.style.paddingRight = (cur + sbw) + 'px';",
     "document.body.style.paddingRight = sbw + 'px';",
     '②'),
    ('干脆不补偿',
     "document.body.style.paddingRight = (cur + sbw) + 'px';",
     "document.body.style.paddingRight = cur + 'px';",
     '⑥'),
    ('不公开滚动条宽度变量',
     "'--overlay-scrollbar-width', sbw + 'px');",
     "'--overlay-scrollbar-width-unused', sbw + 'px');",
     '⑦'),
    ('关闭时不清理变量',
     "document.documentElement.style.removeProperty('--overlay-scrollbar-width');",
     "void 0;",
     '⑦'),
]


def run_gate():
    p = subprocess.run(GATE, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    out = (p.stdout or '') + (p.stderr or '')
    fails = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
    return p.returncode, fails


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(here)

    if os.path.exists(BAK):
        # 上一次崩了没还原 ⇒ 先救回来，别让源码带着变异体进仓库
        print('  ⚠️ 发现残留备份 ⇒ 先还原（上次没跑完）')
        os.replace(BAK, SRC)

    orig = io.open(SRC, encoding='utf-8').read()
    io.open(BAK, 'w', encoding='utf-8', newline='').write(orig)

    bad = 0
    try:
        code, fails = run_gate()
        print('  基线（未变异）  EXIT=%d   FAIL=%d' % (code, len(fails)))
        if code != 0:
            print('  🔴 基线就是红的：先修 overlay-host-check，再谈反向控制')
            bad += 1

        for why, old, new, tag in MUTANTS:
            if old not in orig:
                print('  🔴 %s：目标串在 %s 里找不到 ⇒ 变异没生效（判据形状变了，'
                      '这条反向控制已失效）' % (why, SRC))
                bad += 1
                continue
            io.open(SRC, 'w', encoding='utf-8', newline='') \
                .write(orig.replace(old, new, 1))
            code, fails = run_gate()
            if code == 0:
                print('  🔴 %s ⇒ 门禁还是绿的（判据 %s 没牙）' % (why, tag))
                bad += 1
            else:
                print('  OK  %s ⇒ 抓到 %d 条（判据 %s 有鉴别力）' % (why, len(fails), tag))
                for l in fails[:3]:
                    print('        ' + l)
            io.open(SRC, 'w', encoding='utf-8', newline='').write(orig)
    finally:
        io.open(SRC, 'w', encoding='utf-8', newline='').write(orig)
        if os.path.exists(BAK):
            os.remove(BAK)

    if bad:
        print('\n  ❌ overlay-host 反向控制：%d 项不合格' % bad)
        return 1
    print('\n  ✅ overlay-host 反向控制：%d 个变异体全被抓到' % len(MUTANTS))
    return 0


if __name__ == '__main__':
    sys.exit(main())
