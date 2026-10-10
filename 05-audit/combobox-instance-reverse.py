#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
combobox-instance-reverse.py — `combobox-instance-check.js` 的**常驻反向控制**

===========================================================================
🔴 为什么不是"写的时候手动验一次"就够
---------------------------------------------------------------------------
  判据会红这件事**会过期**：
    · 变异体是硬编码的字符串替换，combobox.js 一改形状它就匹配不上
      ⇒ 那个"反例"其实没生效（门禁照样打印 PASS ⇒ 假绿）
    · 判据本身被改宽 ⇒ 缺陷再也抓不到
  ⇒ 所以反向控制必须**每次都跑**（接在 behavior-reverse.sh 里），掉了牙它自己会叫。

===========================================================================
怎么判"有鉴别力"
---------------------------------------------------------------------------
  对每个变异体：打补丁 → 重跑门禁 → 必须**判红**（有 FAIL 行）。
  ⚠️ 只判退出码不够：服务没起时门禁是**崩了**（非 0 退出、0 条 FAIL），
     那不算"抓到了"—— 反向控制自己变成假绿（overlay-host 那边踩过一次）。

===========================================================================
安全性
---------------------------------------------------------------------------
  变异的是**源码**，跑完必须还原。`finally` + 独立备份文件双保险。
  🔴 读写都带 `newline=''`：默认文本模式会把 CRLF 统一成 LF，
     写回时整个文件的换行被改掉 —— 内容没变，git 却看到一整片红（踩过）。
===========================================================================
用法：python 05-audit/combobox-instance-reverse.py   （需要 127.0.0.1:8000）
"""
import io
import os
import subprocess
import sys

SRC = os.path.join('02-primitives', 'combobox', 'combobox.js')
BAK = SRC + '.__reverse.bak'
GATE = ['node', os.path.join('05-audit', 'combobox-instance-check.js')]

# (说明, 原串, 变异串, 期望被抓到的判据编号)
MUTANTS = [
    ('max 上限从 addTag 里拿掉（回到"事后补救"）',
     "if (opt.max && tags.length >= opt.max) return false;    /* 🔴 上限 */",
     "/* 上限被拿掉 */",
     '①'),
    ('渲染不写 aria-disabled（回到"只有 setActive 在读"）',
     "(o.disabled ? ' aria-disabled=\"true\"' : '') + '>' +",
     "'' + '>' +",
     '②'),
    ('setActive 回到"跑满 n 次无条件 break"（全禁用仍落禁用项）',
     "      if (!found) {\n"
     "        activeIdx = -1;\n"
     "        os.forEach(function (o) { o.removeAttribute('data-state'); });\n"
     "        input.removeAttribute('aria-activedescendant');\n"
     "        return;\n"
     "      }\n",
     "",
     '②'),
    ('addTag 不查禁用项',
     "if (isDisabled(v)) return false;                       /* 禁用项 */",
     "/* 不查禁用项 */",
     '②'),
    ('返回对象里没有 destroy',
     "      destroy: destroy,\n",
     "",
     '③'),
    ('destroy 不摘 document 级监听',
     "document.removeEventListener('click', onDocClick);",
     "/* 忘了摘 document 监听 */",
     '③'),
    ('destroy 不幂等（去掉守卫）',
     "      if (destroyed) return;\n      destroyed = true;",
     "      destroyed = true;",
     '③'),
    ('uid 回到"只在 !list.id 时递增"（调用方给 id 就撞）',
     "    var seq = ++uid;",
     "    var seq = uid;",
     '④'),
    ('closest 兜底回到死代码（三元判断）',
     "var b = closest(e.target, '[data-del]');",
     "var b = e.target.closest ? closest(e.target, '[data-del]') : null;",
     '⑤'),
]


def detect_newline(text):
    """探测文件的换行风格（CRLF / CR / LF）。"""
    if '\r\n' in text:
        return '\r\n'
    if '\r' in text:
        return '\r'
    return '\n'


def adapt_newline(s, nl):
    """把变异串的换行改成源文件的换行风格。

    🔴 为什么必须有这一步（2026-10-10 实测）
      读写用 `newline=''` 是为了**不改动文件换行风格** ——
      默认文本模式会把 CRLF 统一成 LF，写回后内容一字未变、git 却看到一整片红。

      但代价是：`MUTANTS` 里写的是 `\\n`，而 Windows 签出的 `combobox.js` 是
      **纯 CRLF**（实测 393 个 CRLF、0 个裸 LF）⇒ 目标串永远匹配不上
      ⇒ `old not in orig` 恒成立 ⇒ 变异**静默失效**，而门禁照样打印那一行"已失效"。
      现象：3/9 个变异体报"目标串找不到"，反向控制名存实亡。

      ⇒ 这正是 INVARIANT I-15 实证 A 的同类：**判据绑在了字节（换行符）上，
        而不是内容上**。修法与那边一致：先把换行归一，再比对。
      区别是这里**归一的是变异串**，文件本身一个字节都不动。
    """
    if nl == '\n' or not s:
        return s
    return s.replace('\r\n', '\n').replace('\r', '\n').replace('\n', nl)


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
        print('  ⚠️ 发现残留备份 ⇒ 先还原（上次没跑完）')
        os.replace(BAK, SRC)

    orig = io.open(SRC, encoding='utf-8', newline='').read()
    io.open(BAK, 'w', encoding='utf-8', newline='').write(orig)
    nl = detect_newline(orig)

    bad = 0
    try:
        code, fails = run_gate()
        print('  基线（未变异）  EXIT=%d   FAIL=%d' % (code, len(fails)))
        if code != 0:
            if fails:
                print('  🔴 基线就是红的：先修 combobox-instance-check，再谈反向控制')
            else:
                print('  🔴 基线跑不起来（一条 FAIL 都没有）：'
                      '多半是崩了或 8000 端口没有静态服务')
            bad += 1

        for why, old, new, tag in MUTANTS:
            old_a = adapt_newline(old, nl)
            new_a = adapt_newline(new, nl)
            if old_a not in orig:
                print('  🔴 %s：目标串在 %s 里找不到 ⇒ 变异没生效'
                      '（判据形状变了，这条反向控制已失效）' % (why, SRC))
                bad += 1
                continue
            io.open(SRC, 'w', encoding='utf-8', newline='') \
                .write(orig.replace(old_a, new_a, 1))
            code, fails = run_gate()
            if code == 0:
                print('  🔴 %s ⇒ 门禁还是绿的（判据 %s 没牙）' % (why, tag))
                bad += 1
            elif not fails:
                print('  🔴 %s ⇒ 门禁退出 %d 但**一条 FAIL 都没有**：'
                      '多半是崩了或环境缺失（如 8000 端口没服务），'
                      '这不算判据有鉴别力' % (why, code))
                bad += 1
            else:
                print('  OK  %s ⇒ 抓到 %d 条（判据 %s 有鉴别力）' % (why, len(fails), tag))
                for l in fails[:2]:
                    print('        ' + l)
            io.open(SRC, 'w', encoding='utf-8', newline='').write(orig)
    finally:
        io.open(SRC, 'w', encoding='utf-8', newline='').write(orig)
        if os.path.exists(BAK):
            os.remove(BAK)

    if bad:
        print('\n  ❌ combobox-instance 反向控制：%d 项不合格' % bad)
        return 1
    print('\n  ✅ combobox-instance 反向控制：%d 个变异体全被抓到' % len(MUTANTS))
    return 0


if __name__ == '__main__':
    sys.exit(main())
