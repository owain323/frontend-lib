#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
selftest-all.py — 把所有门禁的反向控制**一次性跑一遍**

🔴 为什么需要（0.8.9 自查发现的真问题）
---------------------------------------------------------------------------
本库的核心口号是「没有反向控制的门禁不算门禁」。但实测：

    `05-audit/` 下有 **26 个脚本支持 `--selftest`**，
    而 `check-all.sh` 里只注册了 **1 个**（`api-form-rev`）。

⇒ 其余 25 个的反向控制**从来没在门禁里跑过**。
  这正是本库自己登记过的那类假绿（`INVARIANT.md` I-10 实证 5）：
  「代码说自己会检查，但没有任何门禁跑它」。

判据
---------------------------------------------------------------------------
  ① 至少发现 N 个自检（零视野守卫：一个都没找到 ⇒ 红）
  ② 每个自检必须 **RC=0**
  ③ **每跑完一个，工作区必须与跑前一致**
     —— 这一条抓的是"自检有副作用"：反向控制会临时改源码，
        还原不彻底就会把工作区弄脏（甚至把变异体留在源码里）。
        实测就是这么抓到 `gen-behavior.py --selftest` 的：
        它用**文本模式**读备份（CRLF→LF 在读取时就丢了），
        还原写回去就把两个源文件的行尾永久改成了 LF。
        ⇒ 内容一字不差，`git diff` 是空的，**只有 `git status` 能看出来**。

⚠️ 判据 ③ 需要 git。没有 git（比如解压出来的 tarball）时：
   **跳过这一条并明说**，不假装通过。

用法
---------------------------------------------------------------------------
    python3 05-audit/selftest-all.py
    SKIP_SELFTESTS="a.py,b.py" python3 05-audit/selftest-all.py   # 临时跳过
"""
import io
import os
import re
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIT = os.path.join(ROOT, '05-audit')

# 列举式跳过（每条都要写理由）。当前为空 —— 26 个全都跑得动（合计约 13 秒）。
# ⚠️ 不许用"跑得慢"当理由；只有"需要本机没有的外部条件"才算。
SKIP = {
    # 'x.py': '需要真机 / 外部 API',
}

TIMEOUT = 180


def candidates():
    out = []
    me = os.path.basename(os.path.abspath(__file__))
    for f in sorted(os.listdir(AUDIT)):
        if not f.endswith('.py'):
            continue
        # 🔴 必须排除自己：本文件里也出现了 `--selftest` 这个字面量，
        #    而它**不支持** --selftest ⇒ 一旦被选进来就会跑 main() ⇒ **递归**。
        if f == me:
            continue
        p = os.path.join(AUDIT, f)
        txt = io.open(p, encoding='utf-8', errors='replace').read()
        # 只认"真的实现了 --selftest 分支"的（不是注释里提一句）
        if re.search(r"['\"]--selftest['\"]\s*(?:in|not in)", txt):
            out.append(f)
    return out


def tree_state():
    """工作区快照（相对路径 + 状态）。git 不可用 → None。"""
    try:
        r = subprocess.run(['git', 'status', '--porcelain'],
                           cwd=ROOT, capture_output=True, text=True,
                           timeout=60)
        if r.returncode != 0:
            return None
        return set(l.rstrip() for l in r.stdout.split('\n') if l.strip())
    except Exception:
        return None


def run_one(fname):
    p = os.path.join(AUDIT, fname)
    t0 = time.time()
    try:
        r = subprocess.run([sys.executable, p, '--selftest'],
                           cwd=ROOT, capture_output=True, text=True,
                           encoding='utf-8', errors='replace',
                           timeout=TIMEOUT)
        rc, out = r.returncode, (r.stdout or '') + (r.stderr or '')
    except subprocess.TimeoutExpired:
        rc, out = 124, '超时（%ds）' % TIMEOUT
    return rc, out, int((time.time() - t0) * 1000)


def main():
    print('  === 全部门禁的反向控制（--selftest）===')
    print('')

    names = [f for f in candidates() if f not in SKIP]
    skipped = [(f, SKIP[f]) for f in candidates() if f in SKIP]

    # ① 零视野守卫
    if not names:
        print('  [FAIL] 一个自检都没找到 ⇒ 这道门禁是**空转**的')
        return 1
    print('  发现 %d 个自检%s'
          % (len(names), '' if not skipped else
             '（另有 %d 个声明跳过）' % len(skipped)))

    has_git = tree_state() is not None
    if has_git:
        base = tree_state()
        print('  工作区快照已取（%d 项已有改动，不计入判据）' % len(base))
    else:
        print('  ⚠️ git 不可用 ⇒ **判据 ③（不得弄脏工作区）跳过**，'
              '这一条本轮不作数')

    print('')
    bad = 0
    dirty = 0
    slow = []
    for f in names:
        rc, out, ms = run_one(f)
        extra = ''
        if has_git:
            now = tree_state()
            new = now - base if now is not None else set()
            if new:
                dirty += 1
                extra = '  🔴 弄脏工作区: %s' % ', '.join(sorted(new))[:60]
                base = now          # 避免后续脚本被前面的污染连坐
        ok = (rc == 0) and not extra
        print('  %s %-30s RC=%-3d %5dms%s'
              % ('OK ' if ok else '🔴 ', f, rc, ms, extra))
        if not ok:
            bad += 1
            tail = [l for l in out.strip().split('\n') if l.strip()][-4:]
            for l in tail:
                print('        %s' % l[:96])
        if ms > 5000:
            slow.append((ms, f))

    if skipped:
        print('')
        for f, why in skipped:
            print('  — %-30s 跳过（%s）' % (f, why))

    if slow:
        print('')
        print('  较慢的：%s'
              % ', '.join('%s %dms' % (f, ms) for ms, f in sorted(slow,
                                                                  reverse=True)))

    print('')
    if dirty:
        print('  🔴 %d 个自检**改了工作区**（还原不彻底）' % dirty)
        print('     ⇒ 反向控制会临时改源码，必须**字节级**还原：')
        print('        文本模式 `io.open(p, encoding="utf-8").read()` 会把')
        print('        CRLF 归一成 LF ⇒ 写回去就永久改了行尾，而 `git diff` 是空的。')
        print('        正确做法：备份/还原用 `open(p, "rb")` / `open(p, "wb")`。')
    if bad:
        print('  => %d 个自检未通过' % bad)
        return 1
    print('  OK %d 个反向控制全部通过%s'
          % (len(names), '，且都没有弄脏工作区' if has_git else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
