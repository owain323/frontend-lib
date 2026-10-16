#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gate-verdict-gate.py — 「门禁有没有判红路径」（0.8.9 新增）

============================================================================
这道门禁防的是什么
----------------------------------------------------------------------------
本库已经有过**两次**同类事故，形状不同但根因相同：

  ① `css-imports` / `dead-class` 写在 `run_report` 下 ⇒ 退出码恒为 0
     ⇒ **在 check-all 里永远 PASS**，不管它打印什么。
     而 `css-imports` 抓到过真问题（暗色对比度 2.45:1）。
     ⚠️ 它**打印了 FAIL**，只是退出码说成功 —— 这正是最容易被忽略的形态：
        人看日志以为它报了，自动化按退出码以为它过了。

  ② `dead-class-gate` 读 `sys.argv[1]` 当路径，而 `--selftest` 恰好在那个位置
     ⇒ root 指向不存在的目录 ⇒ **什么都没扫到 ⇒ 判「没有真死类」**
     ⇒ 输出看起来完全正常（「✅ 没有真死类」），退出码 0。

  共同点：**门禁的输出与它的退出码不是同一件事**，
  而 check-all（以及所有 CI）只看退出码。

⇒ 这道门禁检查：**每道注册的门禁，代码里存在"判红并返回非 0"的路径**。
  没有 ⇒ 它不可能失败 ⇒ 它不是门禁，是一段会打印东西的脚本。

============================================================================
判据
----------------------------------------------------------------------------
对 check-all.sh 里注册的每道门禁脚本，检查源码里是否有判红路径：
  · Python:  `return 1` / `return 2` / `sys.exit(1)` / `SystemExit(1)`
             / `raise SystemExit(1)` / 非零 `exit(`
  · JS:      `process.exit(1)` / `process.exitCode = 1`
  · Shell:   `exit 1` / `return 1`

⚠️ 三条避免它自己变成假绿的约束：
  ① 只查**注册在 check-all 里的**脚本（库文件如 `_common.py` 不在此列）
  ② **必须报告查了几个**；一个都没查到 ⇒ 报「视野已空」而不是通过
  ③ 允许**列举式白名单**（豁免必须逐条写明理由），不接受宽泛条件

用法：
  python3 05-audit/gate-verdict-gate.py
  python3 05-audit/gate-verdict-gate.py --selftest
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECK_ALL = os.path.join(ROOT, '05-audit', 'check-all.sh')

# 判红路径的形态。
#
# ⚠️ 第一版我写的是 `process\.exit\(\s*[1-9]` —— 实测**误报了 20+ 道门禁**，
#    因为本库有一批 `*-check.js` 判红是**间接**的：
#        process.exit(kit.report(r));      // ← kit.report 返回非 0 表示判红
#    它们的判红能力是真的（门禁日志里确实会 FAIL），
#    错的是我的判据只认字面数字。
#    ⇒ 改成「exit( 后面不是 0」，覆盖直接与间接两种。
#
# ⭐ 这一版改正很重要：**误报 20 道会让这道门禁立刻失去可信度**，
#    而它防的恰恰是"看起来在工作"这类问题 —— 自己误报就没资格谈这个。
VERDICT_PATTERNS = {
    '.py': [
        r'\breturn\s+[1-9]\b',                    # 返回非 0
        r'\breturn\s+(?!0\b)\w*\s*$',             # 返回变量（多为 bad/rc）
        r'\bsys\.exit\(\s*(?!0\s*\))[^)]+\)',     # 直接或间接
        r'\braise\s+SystemExit\(\s*[1-9]',
        r'\bSystemExit\(\s*[1-9]',
    ],
    '.js': [
        r'process\.exit\(\s*(?!0\s*\))[^)]*\)',   # exit(0) 之外的都算
        r'process\.exitCode\s*=\s*(?!0\b)\w',
        r'\bthrow\s+new\s+Error\(',
    ],
    '.mjs': [
        r'process\.exit\(\s*(?!0\s*\))[^)]*\)',
        r'process\.exitCode\s*=\s*(?!0\b)\w',
        r'\bthrow\s+new\s+Error\(',
    ],
    '.sh': [
        r'\bexit\s+[1-9]',
        r'\bexit\s+\$\{?\w*(\b|fail|bad)',
        r'\breturn\s+[1-9]',
    ],
}

# 列举式白名单：豁免**必须逐条写明理由**，不接受宽泛条件。
#
# ⚠️ 判据：只有当"退出码由**别的机制**负责"时才豁免，
#    而不是"它看起来不重要"。每一条都要能被独立核实。
ALLOW_NO_VERDICT = [
    ('unit',
     '由 `node --test` 运行 —— 退出码由**测试框架**决定：'
     '有失败用例时 node --test 自己 exit 1，测试文件本身不需要判红路径。'
     '实测核实：故意让一个断言失败，node --test 的退出码确实是 1。'),
]


def registered_gates():
    """从 check-all.sh 解析出注册的门禁（名字 → 命令行）。

    ⚠️ 两类注册都要认：
      ① 逐条：`run "名字" 命令...`
      ② **循环批量**：
             for g in tierA-gate icon-gate ...; do
               run "$g"    $PY "05-audit/$g.py" --dir $DIR_ARGS
             done
         第一版我只展开出了名字，命令行还是 `run "$g" ... "$g.py"`，
         ⇒ `script_of()` 从中取到的是 **字面 `$g`**（不是真名）
         ⇒ 17 道被「跳过」，而跳过意味着**没查**。
         ⇒ 现在把模板里的 `$g` 用每个真名替换，得到真实路径。
    """
    txt = io.open(CHECK_ALL, encoding='utf-8').read()
    out = {}
    for m in re.finditer(r'^\s*(run|run_report)\s+"([^"]+)"\s+(.+?)\s*$',
                         txt, re.M):
        # ⚠️ 跳过 `run "$g" ...`（那是**循环体内部**的模板，不是注册）
        #    第一版没跳 ⇒ 解析出一个叫 `$g` 的"门禁"，
        #    然后它被当成"找不到脚本路径"跳过 —— 又是一次静默漏查。
        #    真正的展开由下面的循环解析负责。
        if '$' in m.group(2):
            continue
        out[m.group(2)] = m.group(3)
    # 循环批量注册
    for m in re.finditer(r'^\s*for g in ([^;]+); do\s*\n(.*?)\n\s*done',
                         txt, re.M | re.S):
        names = [x.strip().strip('"\'') for x in m.group(1).split()]
        body = m.group(2)
        for run_m in re.finditer(r'^\s*run\s+"\$g"\s+(.+?)\s*$', body, re.M):
            tpl = run_m.group(1)
            for name in names:
                if name:
                    out[name] = tpl.replace('$g', name)
    return out


def script_of(cmdline):
    """从命令行里找出 .py/.js/.sh 脚本路径。

    ⚠️ 必须**先剥引号**：循环注册的模板展开后会带引号
       （`run "$g" $PY "05-audit/$g.py"` ⇒ token 是 `"05-audit/tierA-gate.py"`），
       而 `endswith('.py')` 对带引号的 token 是 False
       ⇒ 13 道门禁被静默跳过（跳过=没查，但报告里只写"不适用"，很隐蔽）。
    """
    for tok in cmdline.split():
        tok = tok.strip('"\'')
        if tok.endswith(('.py', '.js', '.mjs', '.sh')):
            return tok
    return None


def main():
    gates = registered_gates()
    if not gates:
        print('  🔴 视野已空：从 check-all.sh 解析不出任何门禁')
        print('     ⇒ 这道门禁没在核对任何东西，不应判通过')
        return 1

    print('  === 门禁判红路径检测 ===')
    print('')
    checked = 0
    no_verdict = []
    skipped = []

    for name in sorted(gates):
        rel = script_of(gates[name])
        if not rel:
            skipped.append((name, '命令行里找不到脚本路径'))
            continue
        p = os.path.join(ROOT, rel)
        ext = os.path.splitext(rel)[1]
        if ext not in VERDICT_PATTERNS:
            skipped.append((name, '不认识的扩展名 %s' % ext))
            continue
        if not os.path.isfile(p):
            no_verdict.append((name, rel, '**文件不存在**'))
            continue
        if name in [x[0] for x in ALLOW_NO_VERDICT]:
            skipped.append((name, '白名单豁免'))
            continue

        src = io.open(p, encoding='utf-8', errors='replace').read()
        hit = None
        for pat in VERDICT_PATTERNS[ext]:
            if re.search(pat, src):
                hit = pat
                break
        checked += 1
        if not hit:
            no_verdict.append((name, rel, '找不到任何判红路径'))

    if no_verdict:
        print('  🔴 以下门禁**不可能失败**（退出码恒为 0）：')
        for name, rel, why in no_verdict:
            print('     · %-18s %-34s %s' % (name, rel, why))
        print('')
        print('     ⇒ 一道不可能失败的门禁不是门禁，是一段会打印东西的脚本。')
        print('       它的问题恰恰在于**看起来在工作** —— 人看日志以为它报了，')
        print('       自动化按退出码以为它过了。')
        print('       （本库已发生过两次：css-imports / dead-class 挂在 run_report 下；')
        print('         dead-class 参数解析出错后什么都扫不到却判「没有真死类」。）')
    else:
        print('  OK  注册的 %d 道门禁都有判红路径' % checked)

    if skipped:
        print('')
        print('  — 跳过 %d 道（不是"通过"，是"本门禁不适用"）：' % len(skipped))
        for name, why in skipped[:10]:
            print('     · %-20s %s' % (name, why))
        if len(skipped) > 10:
            print('     …… 另有 %d 道' % (len(skipped) - 10))

    print('')
    print('  实查 %d 道 / 注册 %d 道' % (checked, len(gates)))
    if checked == 0:
        print('  🔴 实查 0 道 ⇒ 判据视野已空，不应判通过')
        return 1
    return 1 if no_verdict else 0


def selftest():
    """反向控制：证明这道门禁会红，且不误报。

    ⚠️ 在**临时目录**里构造（P0-1 的教训：反向控制有副作用，
       而 selftest 恰恰也在动文件 —— 不碰真仓库）。
    """
    import shutil
    import tempfile

    global ROOT, CHECK_ALL
    real = (ROOT, CHECK_ALL)
    tmp = tempfile.mkdtemp(prefix='verdict-')
    bad = 0
    try:
        os.makedirs(os.path.join(tmp, '05-audit'))

        def write_check_all(body):
            with io.open(os.path.join(tmp, '05-audit', 'check-all.sh'),
                         'w', encoding='utf-8') as f:
                f.write(body)

        def write_gate(fn, body):
            with io.open(os.path.join(tmp, '05-audit', fn),
                         'w', encoding='utf-8') as f:
                f.write(body)

        ROOT = tmp
        CHECK_ALL = os.path.join(tmp, '05-audit', 'check-all.sh')

        # ① 门禁没有判红路径 ⇒ 必须报
        write_check_all('run "nov"   python3 05-audit/nov.py\n')
        write_gate('nov.py', "print('看起来在检查')\nreturn_ = 0\n")
        rc = main()
        ok = (rc == 1)
        print('')
        print('  %s ① 门禁无判红路径 ⇒ %s'
              % ('OK ' if ok else '🔴 ', '正确报红' if ok else '没报红（没牙）'))
        if not ok:
            bad += 1

        # ② 有判红路径 ⇒ 不许报
        write_check_all('run "yes"   python3 05-audit/yes.py\n')
        write_gate('yes.py', 'import sys\nsys.exit(0)\n')
        write_check_all('run "yes"   python3 05-audit/yes.py\n')
        write_gate('yes.py', 'import sys\nif bad:\n    sys.exit(1)\n')
        rc2 = main()
        ok2 = (rc2 == 0)
        print('  %s ② 有 sys.exit(1) ⇒ %s'
              % ('OK ' if ok2 else '🔴 ', '不误报' if ok2 else '误报'))
        if not ok2:
            bad += 1

        # ③ 视野已空（一条都解析不出）⇒ 必须报，不许判通过
        write_check_all('# 什么都没注册\n')
        rc3 = main()
        ok3 = (rc3 == 1)
        print('  %s ③ 视野已空 ⇒ %s'
              % ('OK ' if ok3 else '🔴 ', '正确报红' if ok3 else '静默通过'))
        if not ok3:
            bad += 1
    finally:
        ROOT, CHECK_ALL = real
        shutil.rmtree(tmp, ignore_errors=True)

    print('')
    print('  %s' % ('反向控制全部通过 ⇒ 这道门禁有鉴别力' if not bad
                    else '🔴 %d 条反向控制没通过' % bad))
    return 1 if bad else 0


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(main())
