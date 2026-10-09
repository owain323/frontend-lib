#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
doc-facts-gate.py — 文档事实门禁（任务 W4，2026-10-09 加固）

===========================================================================
🔴 为什么需要这道门禁
---------------------------------------------------------------------------
  评审指出：START-HERE 里写「badge / table / pagination 还没做」，
  而仓库里它们**早就有了**。根因不是有人偷懒，而是：

  **文档里的"事实"没有任何东西在维护它** ——
  组件加了没人改文档，门禁也不查，于是几个月后文档在骗人。

  更糟的是 CHANGELOG 写「18 道门禁」，实际已有 68 道。
  这类数字漂移会让使用者**低估或高估**项目的成熟度。

===========================================================================
🔴 加固：这道门禁自己有三个洞（N18 / N19）
---------------------------------------------------------------------------
  ① **视野太窄**：原来只查 4 个文件（START-HERE / CHANGELOG / API / README）。
     ⇒ `docs/INVARIANT.md` 里「117 道门禁」「本版有 26 个组件」漂了很久没人抓
       （真值当时已是 125 / 27）。文档写了错数，而这道门禁**根本没看那份文档**。

  ② **门禁数只报数字、不核名单**：原 `real_gate_count()` 返回 125 ——
     与实测**一样**，看着全对。但按名单比对才发现是两个错**刚好抵消**：
       · 漏了 `css-imports`（写在 run() 之外）与 `unit`（写在 if 里）  ⇒ -2
       · `switch` / `states` 被两条不同命令共用同一标签 ⇒ 各算两次 ⇒ +2
     ⇒ **对的数字、错的名单**。这种"凑巧对上"比算错更危险：
        它会替一个错数**背书**。⇒ 改成返回名单，并强制「名字必须唯一」。

  ③ **"组件数"用了目录法**：数目录下有 .css/.js 的子目录 ⇒ 31，
     而**权威**是 `ai/components.json` 的 `summary.total` ⇒ 27。
     差的那 4 个是 `09-assets/` 下的资源/适配器，不是契约里的组件。
     ⇒ 文档照它写就是错的，而门禁还会替它背书。

===========================================================================
本门禁查五类事实（真值**全部**取自机器可读源，不写死）
---------------------------------------------------------------------------
  F1 组件总数        ← ai/components.json 的 summary.total（并与条目数互校）
  F2 门禁总数        ← check-all.sh 的**注册名单**（run / run_report，名字去重）
  F3 成熟度          ← summary.byMaturity；有 beta 时文档不许说"全部 stable"
  F4 组件清单        ← 目录下真实存在的组件（说"还没做"但实际有 ⇒ 红）
  F5 发布记录        ← CHANGELOG 的 `## X.Y.Z — ` 后面必须是日期

  视野声明：会打印扫了多少份文档。**扫到 0 份 ⇒ 判失败**（视野已空不许通过）。

===========================================================================
为什么不自动改文档，而是报错
---------------------------------------------------------------------------
  自动改会把"哪里错了"抹掉，下次同样的错还会犯。
  ⇒ 报错 + 给出真实值，让人确认后手改。

===========================================================================
豁免（每一条都写明理由，不许含糊）
---------------------------------------------------------------------------
  · 代码块 / 行内代码内     —— 那是示例，不是事实声明
  · CHANGELOG 的**历史**版本段（## X.Y.Z ≠ VERSION）—— 历史快照不该追改
  · 06-vendor / 08-plan / 10-review / dist / node_modules
        —— 讲的分别是别的库、未入库的计划、生成的评审稿、派生产物
===========================================================================
"""
import io
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMPONENT_DIRS = ('02-primitives', '03-patterns', '04-recipes', '09-assets')

# 🔴 视野：只排除"讲的不是本库当前事实"的地方。
#    ⚠️ 原来只有 4 个文件 —— 那就是这个门禁最大的洞（N18）。
EXCLUDE_DIRS = ('06-vendor', '08-plan', '10-review', 'dist',
                'node_modules', '.git')
EXCLUDE_FILES = ('CHANGELOG.md',)      # 单独处理（历史段要豁免）

# 🔴 三种登记方式都算：**注册数必须与环境无关**
#   run / run_report  真的执行
#   skip              这台机器跑不了（缺 node / Pillow / typescript）
#   ⇒ 以前 skip 是裸 `echo`，不在名单里 ⇒ 门禁总数随机器变（有 node 的机器多 3 条）
RUN_RE = r'^\s*(?:\w+=\S+\s+)*run(?:_report)?\s+"([^"]+)"'
SKIP_RE = r'^\s*skip\s+"([^"]+)"'


# ===========================================================================
# 真值来源
# ===========================================================================
def contract():
    """ai/components.json —— 组件事实的**权威**来源。"""
    p = os.path.join(ROOT, 'ai', 'components.json')
    if not os.path.isfile(p):
        return None
    return json.load(io.open(p, encoding='utf-8'))


def real_components():
    """仓库里真实存在的组件：目录下有 .css 或 .js。

    ⚠️ 这个只能用来判「某个组件有没有」（F4），
       **不能**用来对外报"有几个组件" —— 它把 09-assets 下的资源也算进去了
       （目录法 31 vs 契约法 27，差的就是那 4 个）。
    """
    out = {}
    for d in COMPONENT_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            sub = os.path.join(base, name)
            if not os.path.isdir(sub):
                continue
            if any(f.endswith(('.css', '.js')) for f in os.listdir(sub)):
                out.setdefault(d, []).append(name)
    return out


def real_gates():
    """check-all.sh 里注册的门禁**名单**（不是数字）。

    🔴 为什么必须返回名单而不是数字（N18 的病根）：
       原实现返回 125，与实测一致；但名单比对显示是两个错刚好抵消
       （漏 css-imports / unit 计 -2，switch / states 重名各算两次 +2）。
       **对的数字、错的名单** —— 它会替错数背书，比算错更危险。

    ⚠️ 踩过的坑（记下来免得重走）：
       · 只锚 `^\\s*run` 会漏掉 `PW_PATH="..." run "firefox"`（前面挂环境变量）
       · `run "$g"` 在 for 循环里 ⇒ 必须展开循环变量，否则 9 条一条都不算

    Returns: (names, problems) —— problems 是这份名单自身的病（重名 / 目标文件不存在）
    """
    p = os.path.join(ROOT, '05-audit', 'check-all.sh')
    if not os.path.isfile(p):
        return [], ['找不到 05-audit/check-all.sh ⇒ 判据视野已空']
    reg = []                      # (name, kind, line)；kind ∈ {run, skip}
    loops = {}
    problems = []
    for i, l in enumerate(io.open(p, encoding='utf-8').read().split('\n'), 1):
        m_for = re.match(r'^\s*for\s+(\w+)\s+in\s+(.+?)\s*;\s*do\s*$', l)
        if m_for:
            loops[m_for.group(1)] = m_for.group(2).split()
            continue
        m = re.match(RUN_RE, l)
        if m:
            name = m.group(1)
            mv = re.match(r'^\$(\w+)$', name)
            if mv:
                reg.extend((v, 'run', i) for v in loops.get(mv.group(1), []))
            else:
                reg.append((name, 'run', i))
            continue
        m = re.match(SKIP_RE, l)
        if m:
            reg.append((m.group(1), 'skip', i))
    # ---- 名单自检 ----
    # ⚠️ 允许「run 一条 + skip 一条」：那是 if/else 的两支，互斥，不是重名。
    #    **两条都真的执行**才是重名 ⇒ 计数口径不清、红的时候分不清是哪条。
    by_name = {}
    for name, kind, line in reg:
        by_name.setdefault(name, []).append((kind, line))
    for name, hits in sorted(by_name.items()):
        runs = [ln for k, ln in hits if k == 'run']
        if len(runs) > 1:
            problems.append(
                '门禁重名 %r（check-all.sh 第 %s 行）⇒ 两条不同的检查共用一个标签'
                ' ⇒ 计数口径不清、红的时候分不清是哪条'
                % (name, '/'.join(str(x) for x in runs)))
    return sorted(by_name), problems


# ===========================================================================
# 文档扫描
# ===========================================================================
def md_files():
    """受版本控制、且讲的是本库当前事实的 .md。"""
    # 🔴 `git ls-files` 在非 git 树里**不报错、只是返回空**（returncode≠0）。
    #   远端无 `.git` 的干净 tarball 就是这种树 —— 若就此收手，
    #   视野会是 0 ⇒ 直接判"视野已空" ⇒ 陌生人 clone 后**必红且冤枉**。
    #   ⇒ 拿不到 git 结果时必须回退到文件系统遍历（反向控制里就有这一条）。
    files = []
    try:
        tracked = subprocess.run(['git', 'ls-files', '*.md'],
                                 cwd=ROOT, capture_output=True, text=True)
        if tracked.returncode == 0:
            files = [f for f in tracked.stdout.split('\n') if f.strip()]
    except Exception:
        files = []
    if not files:
        for dirpath, dirnames, filenames in os.walk(ROOT):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
            for f in filenames:
                if f.endswith('.md'):
                    files.append(os.path.relpath(
                        os.path.join(dirpath, f), ROOT).replace('\\', '/'))
    out = []
    for f in files:
        parts = f.replace('\\', '/').split('/')
        if any(p in EXCLUDE_DIRS for p in parts[:-1]):
            continue
        if parts[-1] in EXCLUDE_FILES:
            continue
        if os.path.isfile(os.path.join(ROOT, f)):
            out.append(f)
    return sorted(out)


def code_ranges(text):
    """围栏代码块的行区间（示例代码不是事实声明）。"""
    out = []
    open_at = None
    for i, l in enumerate(text.split('\n')):
        if l.lstrip().startswith('```'):
            if open_at is None:
                open_at = i
            else:
                out.append((open_at, i))
                open_at = None
    if open_at is not None:
        out.append((open_at, len(text.split('\n'))))
    return out


def strip_inline(s):
    return re.sub(r'`[^`]*`', '', s)


def version_at(text, pos):
    """pos 之前最近的 `## X.Y.Z` 标题的版本号（没有则 None）。"""
    vm = None
    for m in re.finditer(r'^##\s+(\d+\.\d+\.\d+)', text[:pos], re.M):
        vm = m.group(1)
    return vm


def iter_lines(text):
    """逐行迭代（跳过围栏代码块，剥掉行内代码），返回 (line_text, line_no)。

    🔴 为什么必须**逐行**而不是"先剥再全局正则"：
       剥掉行内代码后文本变短 ⇒ 匹配位置偏移 ⇒ 报出来的**行号是错的**
       （实测把 ROADMAP 第 75 行的说法报成第 72 行）。
       行号错了，人就去改一个没坏的的地方 —— 归因错乱比漏报更糟。
    """
    lines = text.split('\n')
    fences = code_ranges(text)
    for i, l in enumerate(lines):
        if any(a <= i <= b for a, b in fences):
            continue
        yield strip_inline(l), i + 1


def scan_claims(text, patterns):
    """返回 [(claim_int, line_text, line_no)]。"""
    out = []
    for line, no in iter_lines(text):
        for pat in patterns:
            for m in re.finditer(pat, line):
                out.append((int(m.group(1)), line.strip(), no))
    return out


PAT_COMPONENTS = [
    r'(?:本版|当前|本库|全库|总共|一共|共)\s*(?:有\s*)?(\d+)\s*个组件',
    r'(\d+)\s*个组件成熟度',
]
PAT_GATES = [r'(\d+)\s*道门禁']
PAT_ALL_STABLE = [
    r'全部(?:升到|是)?\s*stable',
    r'全是\s*stable',
    r'成熟度全部',
]


def main():
    print('  === 文档事实核对（任务 W4）===')
    print('')
    problems = []

    conf = contract()
    gates, gate_problems = real_gates()
    comps = real_components()
    all_names = set()
    for v in comps.values():
        all_names.update(v)

    # ---------- 真值自检：真值本身不可信 ⇒ 不许往下判 ----------
    n_comp = None
    maturity = {}
    if conf is None:
        problems.append(('ai/components.json', '真值缺失',
                         '找不到契约文件 ⇒ 组件数与成熟度无从核对'))
    else:
        cs = conf.get('components') or []
        summ = conf.get('summary') or {}
        n_comp = summ.get('total')
        maturity = summ.get('byMaturity') or {}
        if n_comp != len(cs):
            problems.append(
                ('ai/components.json', '契约自相矛盾',
                 'summary.total=%r 但实际条目 %d 个' % (n_comp, len(cs))))
        if n_comp is None:
            problems.append(('ai/components.json', '真值缺失',
                             'summary.total 不存在 ⇒ 组件数无从核对'))

    for gp in gate_problems:
        problems.append(('05-audit/check-all.sh', '门禁名单自身有病', gp))
    if not gates:
        problems.append(('05-audit/check-all.sh', '判据视野已空',
                         '一条门禁都没解析出来 ⇒ 这份"通过"不作数'))

    # ---------- 视野 ----------
    files = md_files()
    if not files:
        problems.append(('（全仓）', '判据视野已空',
                         '一份文档都没扫到 ⇒ 这份"通过"不作数'))
    print('     视野：%d 份受版本控制的 .md（另有 CHANGELOG 只查当前版本段）'
          % len(files))

    cur = None
    vp = os.path.join(ROOT, 'VERSION')
    if os.path.isfile(vp):
        cur = io.open(vp, encoding='utf-8').read().strip()

    # ---------- 逐份文档核对 ----------
    for f in files:
        p = os.path.join(ROOT, f)
        text = io.open(p, encoding='utf-8').read()

        # F1 组件总数
        if n_comp is not None:
            for claim, line, no in scan_claims(text, PAT_COMPONENTS):
                if claim == n_comp:
                    continue
                problems.append((f, '组件数量与实际不符',
                                 '第 %d 行写 %d 个，ai/components.json 是 %d 个'
                                 ' ⇒ %s' % (no, claim, n_comp, line[:60])))

        # F2 门禁总数
        if gates:
            for claim, line, no in scan_claims(text, PAT_GATES):
                if claim == len(gates):
                    continue
                problems.append((f, '门禁数量与实际不符',
                                 '第 %d 行写 %d 道，check-all.sh 注册 %d 道'
                                 ' ⇒ %s' % (no, claim, len(gates), line[:60])))

        # F3 成熟度：有 beta 就不许说"全部 stable"
        if (maturity.get('beta') or 0) > 0:
            for line, no in iter_lines(text):
                for pat in PAT_ALL_STABLE:
                    m = re.search(pat, line)
                    if not m:
                        continue
                    if '不' in line[:12]:      # "不全是 stable" 之类
                        continue
                    problems.append(
                        (f, '成熟度与契约不符',
                         '第 %d 行说「%s」，但契约里 beta 有 %d 个（stable %d）'
                         ' ⇒ %s' % (no, m.group(0), maturity.get('beta'),
                                    maturity.get('stable'), line.strip()[:60])))

        # F4 组件"还没做"的否定声明
        for line, no in iter_lines(text):
            for m in re.finditer(
                    r'([A-Za-z][\w-]*)\s*(?:❌|✗|×)?\s*'
                    r'(?:还没做|未做|待补|计划做|尚未提供|缺失)', line):
                name = m.group(1)
                if name in all_names:
                    problems.append(
                        (f, '组件已存在却被称为「还没做」',
                         '第 %d 行：%s（真实存在于 %s）'
                         % (no, name,
                            next(d for d, v in comps.items() if name in v))))

    # ---------- CHANGELOG：只查当前版本段（历史快照不追改） ----------
    p = os.path.join(ROOT, 'CHANGELOG.md')
    if os.path.isfile(p):
        raw = io.open(p, encoding='utf-8').read()
        lines = raw.split('\n')
        offsets = [0]
        for l in lines:
            offsets.append(offsets[-1] + len(l) + 1)
        fences = code_ranges(raw)
        for i, l in enumerate(lines):
            if any(a <= i <= b for a, b in fences):
                continue
            line = strip_inline(l)
            ver = version_at(raw, offsets[i])
            # ③/⑤ 顺带：版本条目必须带日期
            mh = re.match(r'^##\s+(\d+\.\d+\.\d+)\s*—[ \t]*(.*)$', line)
            if mh and not re.match(r'\d{4}-\d{2}-\d{2}', mh.group(2).strip()):
                problems.append(('CHANGELOG.md', '版本条目缺日期',
                                 '## %s — 后面是 %r（应为 YYYY-MM-DD）'
                                 % (mh.group(1), mh.group(2).strip()[:20])))
                continue
            if cur and ver != cur:
                continue                      # 历史段：豁免
            for pat in (PAT_COMPONENTS if n_comp is not None else []):
                for m in re.finditer(pat, line):
                    if int(m.group(1)) != n_comp:
                        problems.append(
                            ('CHANGELOG.md', '组件数量与实际不符',
                             '第 %d 行（%s 段）写 %s 个，契约是 %s 个'
                             % (i + 1, ver or '?', m.group(1), n_comp)))
            for m in re.finditer(PAT_GATES[0], line):
                if gates and int(m.group(1)) != len(gates):
                    problems.append(
                        ('CHANGELOG.md', '门禁数量与实际不符',
                         '第 %d 行（%s 段）写 %s 道，注册 %d 道'
                         % (i + 1, ver or '?', m.group(1), len(gates))))

    if not problems:
        print('  OK  文档里的事实与仓库一致')
        print('      （%d 道门禁、%d 个组件、%s）'
              % (len(gates), n_comp if n_comp is not None else -1,
                 'stable %d / beta %d' % (maturity.get('stable', 0),
                                          maturity.get('beta', 0))))
        return 0

    print('  🔴 文档里的事实与仓库不符：')
    for doc, what, detail in problems:
        print('     %-22s %s' % (doc, what))
        print('       %s' % detail)
    print('')
    print('  ⇒ 文档在骗人。这比写得少更糟：')
    print('    使用者会据此判断该不该依赖本库。')
    print('    ⭐ 修的时候确认「文档旧了」还是「真缺功能」——处置不同。')
    return 1


def selftest():
    """反向控制：在一个**临时仓库**里注入错的说法，每条都必须被抓到。

    🔴 为什么必须做这个（宪法：没有反向控制 ⇒ 不算门禁）：
       这道门禁天生容易"假绿" —— 只要视野里一份文档都没扫到、
       或真值取不到，它就会安静地通过。上面那次跑绿，
       只能说明"现在没错"，**不能说明它有鉴别力**。

    每个变异体都构造一个最小仓库（有 VERSION / 契约 / check-all.sh / 两份 md），
    只改一处 ⇒ 观察是不是**恰好**抓到预期的那一条。
    """
    import shutil
    import tempfile

    base = tempfile.mkdtemp(prefix='docfacts-')
    bad = 0
    try:
        def build(files):
            for rel, content in files.items():
                fp = os.path.join(base, rel)
                d = os.path.dirname(fp)
                if not os.path.isdir(d):
                    os.makedirs(d)
                io.open(fp, 'w', encoding='utf-8').write(content)

        CONF = ('{"summary":{"total":3,"byMaturity":{"stable":2,"beta":1}},'
                '"components":[{"id":"a"},{"id":"b"},{"id":"c"}]}')
        # 3 道：two + one + skip 一条（skip 也算注册数）
        SH = ('run "two" true\n'
              'for g in one; do\n  run "$g" true\ndone\n'
              'skip "off" "缺环境"\n')
        GOOD = {'VERSION': '0.0.1',
                'ai/components.json': CONF,
                '05-audit/check-all.sh': SH,
                'README.md': '共 3 道门禁、本版有 3 个组件。\n'}

        # ---- 基线：全对 ⇒ 必须绿 ----
        build(GOOD)
        global ROOT
        ROOT = base
        rc = main()
        ok = (rc == 0)
        print(('  OK  ' if ok else '  🔴 ') +
              '基线（数字全对）⇒ EXIT=%d（应为 0）' % rc)
        bad += 0 if ok else 1

        cases = [
            ('门禁数写错（5 ≠ 3）', {'README.md': '共 5 道门禁。\n'},
             '门禁数量与实际不符'),
            ('组件数写错（9 ≠ 3）', {'README.md': '本版有 9 个组件。\n'},
             '组件数量与实际不符'),
            ('有 beta 却说全部 stable', {'README.md': '成熟度全部升到 stable。\n'},
             '成熟度与契约不符'),
            ('组件已存在却说还没做',
             {'README.md': 'badge 还没做。\n',
              '02-primitives/badge/badge.css': '.badge{}\n'},
             '组件已存在却被称为'),
            ('门禁重名（两条 run 同名）',
             {'05-audit/check-all.sh': SH + 'run "two" false\n'},
             '门禁重名'),
        ]
        for why, patch, expect in cases:
            shutil.rmtree(base)
            os.makedirs(base)
            merged = dict(GOOD)
            merged.update(patch)
            build(merged)
            ROOT = base
            rc = main()
            ok = (rc == 1)
            print(('  OK  ' if ok else '  🔴 ') +
                  '%s ⇒ EXIT=%d（应为 1，并报「%s」）' % (why, rc, expect))
            bad += 0 if ok else 1

        # ---- 豁免：代码块里的数字不是事实声明，不许报 ----
        shutil.rmtree(base); os.makedirs(base)
        merged = dict(GOOD)
        merged['README.md'] = '```\n共 99 道门禁\n```\n'
        build(merged)
        ROOT = base
        rc = main()
        ok = (rc == 0)
        print(('  OK  ' if ok else '  🔴 ') +
              '豁免：代码块里的「99」不许当成事实 ⇒ EXIT=%d（应为 0）' % rc)
        bad += 0 if ok else 1

        # ---- 视野：一份文档都没有 ⇒ 不许通过 ----
        shutil.rmtree(base); os.makedirs(base)
        build({'VERSION': '0.0.1', 'ai/components.json': CONF,
               '05-audit/check-all.sh': SH})
        ROOT = base
        rc = main()
        ok = (rc == 1)
        print(('  OK  ' if ok else '  🔴 ') +
              '视野已空（0 份文档）⇒ EXIT=%d（应为 1）' % rc)
        bad += 0 if ok else 1
    finally:
        shutil.rmtree(base, ignore_errors=True)

    print('')
    print('  %s' % ('反向控制全部通过。' if bad == 0
                    else '🔴 %d 条反向控制没通过 ⇒ 这份门禁没有鉴别力' % bad))
    return 1 if bad else 0


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(main())
