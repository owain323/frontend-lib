#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mutation-leak-gate.py — 变异串泄漏检测（0.8.9 · 从 P0-1 事故反推出来的门禁）

============================================================================
这个门禁防的是什么（真事故，不是假想）
----------------------------------------------------------------------------
2026-10-17 的 P0-1：`03-patterns/overlay/overlay.js:100` 里是

    void 0;

而它本该是

    document.documentElement.style.removeProperty('--overlay-scrollbar-width');

那行 `void 0;` **逐字符就是** `overlay-host-reverse.py` 里 MUTANTS[3] 的变异串。

⇒ 反向控制的机制是「**原地改写源码** → 跑门禁 → 看它是否变红 → 还原」。
  只要在「改写」与「还原」之间发生任何中断（进程被杀 / 用户打断 / 崩溃），
  **源码就留在被变异的状态**，而且：
    · 没有任何报错
    · 门禁照样全绿（变异后的代码在别的判据上可能仍然合法）
    · 下一次 `git add -A` 就把它提交了

  这次事故里它还叠了一层：**该变异体因此失效**（原串已变成变异串，找不到），
  而失效的信号只是「这条反向控制报红」—— 看起来像"门禁坏了"，
  很容易被当成环境问题忽略。

============================================================================
判据
----------------------------------------------------------------------------
对每个反向控制脚本，提取它的 MUTANTS 里的**变异串**，
然后检查这些串**是否出现在目标源码里**。

  出现 ⇒ 说明变异没被还原 ⇒ **红**。

⚠️ 三条设计约束（都是为了避免这道门禁自己变成假绿）：
  ① **只查足够独特的变异串**（长度 ≥ 12 且含非空白字符）。
     太短的串（如 `''` / `0`）会命中正常代码 ⇒ 全是误报。
  ② **必须能解析出目标文件**；解析不出来就报「无法核对」而不是跳过 ——
     跳过等于假装查过了（I-10 那类最安静的假绿）。
  ③ **每条反向控制都要有变异串**；一条都提取不到就报「视野已空」。

用法：
  python3 05-audit/mutation-leak-gate.py
  python3 05-audit/mutation-leak-gate.py --selftest   # 反向控制
"""
import ast
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.join(ROOT, '05-audit')

# 变异串的**最短长度**。
#
# 🔴 这个数字不能拍。第一版我写 12，理由是"太短的会命中正常代码"——
#    结果实测发现：**P0-1 那个泄漏的变异串 `void 0;` 长度只有 7，被过滤掉了**
#    ⇒ 门禁对**它要防的那次事故**恰好查不出来。这是最糟的一种设计错：
#      门禁看起来在工作，但它防的正是自己漏掉的那一类。
#
#    降到 3 之后实测：13 条变异串（2 条空串除外）全查，
#    在**目标源码**里**零误报**。
#    为什么短串在这里安全：变异串是"故意做坏的写法"，
#    而且只在**它自己的目标文件**里查（不是全库）。
MIN_LEN = 3

# 已知的「故意保留」白名单：变异串里含这些片段时不算泄漏。
# 🔴 必须是**列举行**，不许写成宽泛条件 —— 宽泛条件会悄悄吃掉真问题。
KNOWN_OK = (
    # 变异体定义文件自己（它们当然含变异串）
    'reverse.py', 'reverse.js', 'reverse.sh',
    'mutation-leak-gate.py',
)


def target_of(src_text):
    """从反向控制脚本里解析出它变异的**目标文件**。

    三种写法都见过，都要认：
      · `SRC = os.path.join('03-patterns', 'overlay', 'overlay.js')`  ← 多段
      · `SRC = os.path.join(ROOT, '03-patterns/overlay/overlay.js')` ← 单段 + ROOT
      · `TARGET = '02-primitives/combobox/combobox.js'`             ← 直接字面量

    ⚠️ 第一版我只写了「单段 + ROOT」那一支，实测两个脚本**都解析不出**
    ⇒ 门禁报「无从核对」。
    ⇒ **报「无从核对」而不是静默跳过是对的**（跳过 = 假装查过了，I-10 那种
      最安静的假绿），但解析能力必须够 —— 否则门禁永远红着，等于没接。
    """
    # ① os.path.join(...) —— 取出里面所有字符串字面量拼起来
    m = re.search(r"(?:SRC|TARGET)\s*=\s*os\.path\.join\(([^)]*)\)", src_text)
    if m:
        parts = re.findall(r"'([^']+)'", m.group(1))
        parts = [p for p in parts if p and p != 'ROOT']
        if parts:
            # 最后一段可能自带路径（如 'overlay/overlay.js'）
            return '/'.join(parts)
    # ② 直接字面量
    m = re.search(r"(?:SRC|TARGET)\s*=\s*'([^']+\.(?:js|css))'", src_text)
    if m:
        return m.group(1)
    return None


def mutants_of_py(path):
    """用 ast 提取 (说明, 原串, 变异串) —— 不用正则，避免被转义骗。"""
    txt = io.open(path, encoding='utf-8').read()
    tree = ast.parse(txt)
    out = []
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        names = [t.id for t in node.targets if isinstance(t, ast.Name)]
        if 'MUTANTS' not in names:
            continue
        for elt in getattr(node.value, 'elts', []):
            if not isinstance(elt, (ast.Tuple, ast.List)):
                continue
            parts = []
            for e in elt.elts:
                try:
                    parts.append(ast.literal_eval(e))
                except Exception:
                    parts.append(None)
            if len(parts) >= 3 and isinstance(parts[2], str):
                out.append((parts[0] or '?', parts[1], parts[2]))
    return out


def mutants_of_js(path):
    """JS 反向控制：提取 CASES / MUTANTS 里被注入的字符串。

    ⚠️ JS 侧的注入形态有两种，含义完全不同：
      · `_a11y-reverse-control.js` 的 CASES 是**注入 DOM**（不改源码）
        ⇒ 不存在"泄漏进源码"这回事，**不适用本门禁**，直接跳过并说明。
    """
    txt = io.open(path, encoding='utf-8').read()
    if 'insertAdjacentHTML' in txt or 'appendChild' in txt:
        return None            # 注入 DOM 型，不适用
    out = []
    for m in re.finditer(r"\['([^']{3,})',\s*'((?:[^'\\]|\\.){MIN,})'\]".replace(
            '{MIN,}', '{%d,}' % MIN_LEN), txt):
        out.append((m.group(1), None, m.group(2)))
    return out


def main():
    bad = 0
    checked = 0

    print('  === 变异串泄漏检测（防 P0-1 复发）===')
    print('')

    reverse_files = [f for f in sorted(os.listdir(HERE))
                     if ('reverse' in f) and f.endswith(('.py', '.js'))
                     and not any(k in f for k in ('__pycache__',))]

    if not reverse_files:
        print('  🔴 视野已空：一个反向控制脚本都没找到')
        print('     ⇒ 这道门禁没在核对任何东西，不应判通过')
        return 1

    for f in reverse_files:
        p = os.path.join(HERE, f)
        rel_f = '05-audit/' + f
        src_txt = io.open(p, encoding='utf-8').read()

        muts = mutants_of_py(p) if f.endswith('.py') else mutants_of_js(p)
        if muts is None:
            print('  —   %-30s 注入 DOM 型，不适用本门禁' % rel_f)
            continue

        uniq = [(w, o, m) for (w, o, m) in muts
                if isinstance(m, str) and len(m.strip()) >= MIN_LEN]
        # 🔴 空串型变异 = **删除式**（把某段代码删掉，而不是替换成别的写法）。
        #    本门禁只查"源码里**多**了什么"，查不出"源码里**少**了什么"
        #    ⇒ 这一类要如实计数并说出来，不能假装覆盖了。
        skipped = [w for (w, o, m) in muts
                   if not isinstance(m, str) or len(m.strip()) < MIN_LEN]
        if skipped:
            print('  ⚠️  %-30s %d 条**删除式**变异本门禁查不了（只查"多"不查"少"）：'
                  % (rel_f, len(skipped)))
            for w in skipped:
                print('         · %s' % str(w)[:60])
            print('         ⇒ 它们由该组件自己的契约门禁兜底'
                  '（源码少了东西，契约门禁会红）')
        if not uniq:
            print('  🔴 %-30s 提取不到任何「足够独特」的变异串（共 %d 条）'
                  % (rel_f, len(muts)))
            print('     ⇒ 这道门禁对它无从核对 ⇒ 不应判通过')
            bad += 1
            continue

        tgt = target_of(src_txt)
        if not tgt:
            print('  🔴 %-30s 解析不出目标文件 ⇒ 无从核对' % rel_f)
            bad += 1
            continue

        tp = os.path.join(ROOT, tgt)
        if not os.path.isfile(tp):
            print('  🔴 %-30s 目标文件不存在：%s' % (rel_f, tgt))
            bad += 1
            continue

        # 🔴 只查**目标源码**（不查 05-audit 自己，避免把变异体定义当泄漏）
        target = io.open(tp, encoding='utf-8').read()
        leaked = []
        for why, orig, mut in uniq:
            if mut in target:
                leaked.append((why, mut))
        checked += len(uniq)

        if leaked:
            print('  🔴 %-30s 目标 %s' % (rel_f, tgt))
            for why, mut in leaked:
                print('       [泄漏] %s' % why)
                print('              %s' % mut.replace('\n', ' ')[:88])
            print('       ⇒ 变异没被还原：反向控制跑完没恢复源码，'
                  '或进程被中断')
            bad += len(leaked)
        else:
            print('  OK  %-30s %d 条变异串都不在 %s 里'
                  % (rel_f, len(uniq), os.path.basename(tgt)))

    print('')
    if bad:
        print('  🔴 %d 处变异串泄漏 / 无从核对 ⇒ 源码里可能留着变异后的代码'
              % bad)
        print('     （这类问题**没有任何报错**：门禁照样绿，'
              '下一次 git add -A 就提交了）')
        return 1
    print('  核对 %d 条变异串，全部不在源码里 ⇒ 反向控制都还原了' % checked)
    return 0


def selftest():
    """反向控制：证明这道门禁**真的会红**。

    ⚠️ 必须在**临时副本**上做，绝不能碰真源码 ——
       这道门禁防的就是「反向控制原地改写源码没还原」，
       它自己的反向控制当然更不能原地改写。
    """
    import shutil
    import tempfile

    print('  === 反向控制（证明它会红）===')
    print('')
    bad = 0
    tmp = tempfile.mkdtemp(prefix='mutleak-')

    # 在临时目录里造一对「反向控制脚本 + 目标源码」，
    # 目标源码**故意含变异串**
    fake = os.path.join(tmp, '05-audit')
    os.makedirs(fake)
    tgt_rel = '02-primitives/fake/fake.js'
    os.makedirs(os.path.join(tmp, '02-primitives/fake'))
    io.open(os.path.join(tmp, tgt_rel), 'w', encoding='utf-8').write(
        'function f() {\n  /* 变异串被泄漏在这里 */\n  void 0;\n}\n')
    io.open(os.path.join(fake, 'fake-reverse.py'), 'w', encoding='utf-8').write(
        "import os\n"
        "ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))\n"
        "SRC = os.path.join(ROOT, '%s')\n"
        "MUTANTS = [\n"
        "    ('测试用变异',\n"
        "     \"document.documentElement.style.removeProperty('--x');\",\n"
        "     'void 0;',\n"
        "     '①'),\n"
        "]\n" % tgt_rel)

    # 用真逻辑跑这个临时环境
    global ROOT, HERE
    real_root, real_here = ROOT, HERE
    ROOT, HERE = tmp, fake
    try:
        rc = main()
    finally:
        ROOT, HERE = real_root, real_here

    ok = (rc == 1)
    print('')
    print('  %s 注入含变异串的源码 ⇒ 门禁 %s'
          % ('OK ' if ok else '🔴 ', '正确报红' if ok else '没报红（没牙）'))
    if not ok:
        bad += 1

    # 反例：改成干净源码 ⇒ 必须绿
    io.open(os.path.join(tmp, tgt_rel), 'w', encoding='utf-8').write(
        'function f() {\n'
        "  document.documentElement.style.removeProperty('--x');\n"
        '}\n')
    ROOT, HERE = tmp, fake
    try:
        rc2 = main()
    finally:
        ROOT, HERE = real_root, real_here
    ok2 = (rc2 == 0)
    print('  %s 干净源码 ⇒ %s' % ('OK ' if ok2 else '🔴 ',
                                '不误报' if ok2 else '误报'))
    if not ok2:
        bad += 1

    shutil.rmtree(tmp, ignore_errors=True)
    print('')
    print('  %s' % ('反向控制全部通过 ⇒ 这道门禁有鉴别力' if not bad
                    else '🔴 %d 条反向控制没通过' % bad))
    return 1 if bad else 0


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(main())
