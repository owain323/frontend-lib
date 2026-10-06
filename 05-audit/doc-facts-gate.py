#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
doc-facts-gate.py — 文档事实门禁（任务 W4）

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
本门禁抓三类漂移
---------------------------------------------------------------------------
  ① 组件清单：文档说有、仓库里没有（或反之）
     判据来源 = 目录里真实存在的组件（有 .css 或 .js）
  ② 门禁数量：文档里写「N 道门禁」，与 check-all.sh 实际条数不符
  ③ 发布记录：`## X.Y.Z — ` 后面缺日期（半空的发布说明）

===========================================================================
为什么不自动改文档，而是报错
---------------------------------------------------------------------------
  自动改会把"哪里错了"抹掉，下次同样的错还会犯。
  ⇒ 报错 + 给出真实值，让人确认后手改。
===========================================================================
"""
import io
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMPONENT_DIRS = ('02-primitives', '03-patterns', '04-recipes', '09-assets')
DOCS = ('START-HERE.md', 'CHANGELOG.md', 'API.md', 'README.md')


def real_components():
    """仓库里真实存在的组件：目录下有 .css 或 .js。"""
    out = {}
    for d in COMPONENT_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            sub = os.path.join(base, name)
            if not os.path.isdir(sub):
                continue
            has = any(f.endswith(('.css', '.js'))
                      for f in os.listdir(sub))
            if has:
                out.setdefault(d, []).append(name)
    return out


def real_gate_count():
    """check-all.sh 里实际注册的门禁条数。"""
    p = os.path.join(ROOT, '05-audit', 'check-all.sh')
    if not os.path.isfile(p):
        return None
    s = io.open(p, encoding='utf-8').read()
    return len(re.findall(r'^run\s+"', s, re.M))


def strip_code(s):
    """剥掉代码块与行内代码，避免把示例里的名字当成事实声明。"""
    s = re.sub(r'```.*?```', '', s, flags=re.S)
    s = re.sub(r'`[^`]*`', '', s)
    return s


def main():
    print('  === 文档事实核对（任务 W4）===')
    print('')

    comps = real_components()
    all_names = set()
    for v in comps.values():
        all_names.update(v)
    n_gates = real_gate_count()
    problems = []

    # ---------- ① 组件清单 ----------
    for doc in DOCS:
        p = os.path.join(ROOT, doc)
        if not os.path.isfile(p):
            continue
        text = strip_code(io.open(p, encoding='utf-8').read())

        # 找「还没做 / 待补 / 计划」这类**否定声明**里提到的组件
        for m in re.finditer(
                r'([A-Za-z][\w-]*)\s*(?:❌|✗|×)?\s*'
                r'(?:还没做|未做|待补|计划做|尚未提供|缺失)', text):
            name = m.group(1)
            if name in all_names:
                problems.append(
                    (doc, '组件已存在却被称为「还没做」',
                     '%s（真实存在于 %s）' % (
                         name,
                         next(d for d, v in comps.items() if name in v))))

    # ---------- ② 门禁数量 ----------
    # ⚠️ 只核对**未发布**的版本条目。
    #   已发布版本里的数字是**当时的快照**，改它等于篡改发布历史 ——
    #   而历史不该被追改。判据：只查 VERSION 指向的那个版本。
    #   （VERSION 与 CHANGELOG 顶部版本一致 ⇒ 那节就是"当前/待发布"。）
    if n_gates:
        ver_file = os.path.join(ROOT, 'VERSION')
        cur = io.open(ver_file, encoding='utf-8').read().strip() \
            if os.path.isfile(ver_file) else None
        for doc in DOCS:
            p = os.path.join(ROOT, doc)
            if not os.path.isfile(p):
                continue
            raw = io.open(p, encoding='utf-8').read()
            for m in re.finditer(r'(\d+)\s*道门禁', raw):
                claim = int(m.group(1))
                if claim == n_gates:
                    continue
                # 只在该数字所在行提到当前版本时才报
                line_start = raw.rfind('\n', 0, m.start()) + 1
                line_end = raw.find('\n', m.end())
                line = raw[line_start:line_end if line_end > 0 else len(raw)]
                # 归属的版本 = 该行之前最近的 `## X.Y.Z` 标题
                head = raw[:line_start]
                vm = None
                for v in re.finditer(r'^##\s+(\d+\.\d+\.\d+)', head, re.M):
                    vm = v.group(1)
                if cur and vm == cur:
                    problems.append(
                        (doc, '门禁数量与实际不符',
                         '%s 段写 %d 道，check-all.sh 实际 %d 道'
                         % (cur, claim, n_gates)))

    # ---------- ③ 发布记录缺日期 ----------
    # ⚠️ `\S*` 会**跨行**：实测 `## 0.3.0 — ` 后面接的是下一行的 `###`，
    #    于是被当成「有内容」而漏报。正解：显式排除换行，且要求是日期。
    p = os.path.join(ROOT, 'CHANGELOG.md')
    if os.path.isfile(p):
        raw = io.open(p, encoding='utf-8').read()
        # 日期形如 YYYY-MM-DD；没写日期就留空
        for m in re.finditer(
                r'^##\s+(\d+\.\d+\.\d+)\s*—[ \t]*(.*)$', raw, re.M):
            ver = m.group(1)
            rest = m.group(2).strip()
            if not re.match(r'\d{4}-\d{2}-\d{2}', rest):
                problems.append(
                    ('CHANGELOG.md', '版本条目缺日期',
                     '## %s — 后面是 %r（应为 YYYY-MM-DD）' % (ver, rest[:20])))

    if not problems:
        print('  OK  文档里的事实与仓库一致')
        if n_gates:
            print('      （当前共 %d 道门禁、%d 个组件）'
                  % (n_gates, len(all_names)))
        return 0

    print('  🔴 文档里的事实与仓库不符：')
    for doc, what, detail in problems:
        print('     %-14s %s' % (doc, what))
        print('       %s' % detail)
    print('')
    print('  ⇒ 文档在骗人。这比写得少更糟：')
    print('    使用者会据此判断该不该依赖本库。')
    print('    ⭐ 修的时候确认「文档旧了」还是「真缺功能」——处置不同。')
    return 1


if __name__ == '__main__':
    sys.exit(main())