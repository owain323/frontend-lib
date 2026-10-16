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
import hashlib
import io
import os
import subprocess
import sys


def _sha(text):
    """内容指纹，用于**还原校验**。

    ⚠️ 不能只看长度：变异串与原串**可能等长**（那样长度校验就漏了）。
    """
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

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

    # 🔴 必须 `newline=''` 读：默认文本模式会把 CRLF 统一成 LF，
    #    写回时就把整个文件的换行改掉了 —— 内容没变，git 却看到一整片红。
    #    （实测踩到：跑完一次反向控制，`overlay.js` 变成已修改状态。）
    orig = io.open(SRC, encoding='utf-8', newline='').read()
    io.open(BAK, 'w', encoding='utf-8', newline='').write(orig)

    bad = 0
    try:
        code, fails = run_gate()
        print('  基线（未变异）  EXIT=%d   FAIL=%d' % (code, len(fails)))
        if code != 0:
            if fails:
                print('  🔴 基线就是红的：先修 overlay-host-check，再谈反向控制')
            else:
                print('  🔴 基线跑不起来（一条 FAIL 都没有）：'
                      '多半是崩了或 8000 端口没有静态服务')
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
            elif not fails:
                # 🔴 这里踩过：静态服务没起时门禁是**崩了**（退出非 0、一条 FAIL 都没有），
                #    只判退出码会把它当成"抓到了" ⇒ 反向控制自己变成假绿。
                #    ⇒ 必须是"判红"才算，崩了/环境缺失一律报不合格。
                print('  🔴 %s ⇒ 门禁退出 %d 但**一条 FAIL 都没有**：'
                      '多半是崩了或环境缺失（如 8000 端口没服务），'
                      '这不算判据有鉴别力' % (why, code))
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

        # 🔴 还原校验（0.8.9 新增 · 从 P0-1 事故反推）
        # ------------------------------------------------------------------
        # 为什么必须自校验，而不是"写了 orig 就算还原了"：
        #   P0-1 就是「变异串 `void 0;` 留在了 `overlay.js` 里并被提交」。
        #   它的发生路径极普通：**在"改写"与"还原"之间被中断**
        #   （进程被杀 / 用户打断 / 崩溃）⇒ finally 没跑完 ⇒ 源码留在变异态。
        #   而这件事**没有任何报错**：门禁照样绿、下一次 git add -A 就提交了。
        #
        #   ⇒ 事后检测（check-all 里的 mutation-leak-gate）能兜住，
        #     但那是**下一轮**才发现。这里做**就地**校验：
        #     写完立刻比对 sha256，不一致就当场喊、再写一次。
        #
        # ⚠️ 用 sha256 而不是 len()：长度可能恰好相同（变异串与原串等长时），
        #    那就漏了。P0-1 的 `void 0;`（7）与
        #    `document.documentElement.style.removeProperty(...)`（远长于 7）
        #    不等长，但**不能指望每次都这样**。
        try:
            now = io.open(SRC, encoding='utf-8', newline='').read()
            if _sha(now) != _sha(orig):
                print('')
                print('  🔴 还原校验失败：%s 与原始内容不一致！' % SRC)
                print('     ⇒ 变异体可能还留在源码里。已再写一次并复验。')
                io.open(SRC, 'w', encoding='utf-8', newline='').write(orig)
                again = io.open(SRC, encoding='utf-8', newline='').read()
                if _sha(again) == _sha(orig):
                    print('     ✅ 第二次写入后已一致')
                else:
                    print('     🔴🔴 第二次仍不一致 ⇒ **请手工检查该文件**，'
                          '不要提交')
                bad += 1
        except Exception as e:            # 校验本身失败也要说，不能静默
            print('  🔴 还原校验自身出错（%s）⇒ 请手工确认 %s'
                  % (type(e).__name__, SRC))
            bad += 1

    if bad:
        print('\n  ❌ overlay-host 反向控制：%d 项不合格' % bad)
        return 1
    print('\n  ✅ overlay-host 反向控制：%d 个变异体全被抓到' % len(MUTANTS))
    return 0


if __name__ == '__main__':
    sys.exit(main())
