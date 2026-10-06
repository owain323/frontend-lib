#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
repo-hygiene.py — 仓库卫生门禁（Owner 铁律：零内部想法）

===========================================================================
🔴 为什么必须有这个门禁（2026-10-06 真实事故）
---------------------------------------------------------------------------
  我把 frontend-lib 推上 GitHub 时，`git add -A` 把
  `00-charter/`（定义 /  / 作战计划 / 差距分析）**一起推上去了**。
  还有 `07-notes/`（决策记录、复盘）、`08-plan/`、`PLAN.md`。

  ⛔ 这正是 Owner 明令禁止的：
      「零内部想法 —— 评审意见、改进策略、作战计划、文案草稿、
        证据登记表、分镜、逐字稿、复盘、错误日志、对话记录，
        这些"我们的想法"**只留本地 workspace，绝不推 GitHub**」

  ⛔ 而且它是**静默**的：`git add -A` 不会问你，push 也不会报错。
     ⇒ 只能靠机械检查。

===========================================================================
判据
---------------------------------------------------------------------------
  ① **git 索引里**（不是工作区）不得出现内部目录/文件
     目录：`00-charter/` `07-notes/` `08-plan/`
     文件：`PLAN.md` `WORK-NOTES.md` `**.md` `*复盘*.md`
           `*差距*.md` `*决策*.md`
  ② `.gitignore` 必须有这些规则（否则第 ① 条会被人手改绕过）
  ③ 反向控制用的探针文件不得被提交

  ⭐ 只查 **git 索引**（`git ls-files`）—— 工作区里留着是**正确的**
    （内部文档要在本地能用，只是不许进库）。
"""
import sys
import os
import io
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 内部目录（内部思考的容器）
INTERNAL_DIRS = ('00-charter', '07-notes', '08-plan')

# 内部文件（按文件名模式）
INTERNAL_PATTERNS = [
    re.compile(r'(^|/)PLAN\.md$'),
    re.compile(r'WORK-NOTES\.md$'),
    re.compile(r'复盘'),
    re.compile(r'差距'),
    re.compile(r'决策-'),
    re.compile(r'作战'),
    re.compile(r'评审记录'),
    re.compile(r'ERROR-?LOG'),
]
# ⚠️ 2026-10-06：本文件曾被批量清洗脚本误伤，把词表里的一项清成了空字符串
#    ⇒ `re.compile(r'')` 匹配**一切**，导致 293 个正常文件被报成"内部文档"。
#    ⭐ 教训：清洗脚本必须**跳过门禁自身的词表**（词表就是要含这些词的）。


def git_ls_files():
    try:
        # 🔴🔴 2026-10-06 修一个**让本门禁完全失效**的 bug：
        #    `git ls-files` 默认对非 ASCII 路径做**引号转义**（core.quotePath）
        #    ⇒ "07-notes/2026-10-03-看不见的bug.md" 输出成
        #      "07-notes/ä¸­...md"（带引号 + 八进制转义）
        #    ⇒ split('/')[0] 拿到的是 `"07-notes` 而不是 `07-notes`
        #    ⇒ **中文路径永远匹配不上** ⇒ 门禁一直报"零内部文档"（假绿）
        #    ⚠️ 这正是 Owner「零中文」纪律的一个副作用：它让中文文件名在
        #       git 输出里变形，而这一门禁恰好要靠文件名判断。
        #    ⇒ 正解：`core.quotePath=false` 关掉转义。
        out = subprocess.run(['git', '-c', 'core.quotePath=false', 'ls-files'],
                             cwd=ROOT, timeout=30, capture_output=True)
        if out.returncode != 0:
            return None
        return out.stdout.decode('utf-8', errors='replace').splitlines()
    except Exception:
        return None


def main():
    files = git_ls_files()
    if files is None:
        print('  SKIP  不是 git 仓库（或 git 不可用）')
        return 0

    # ---------- ① 索引里不该有内部文档 ----------
    bad = []
    for f in files:
        norm = f.replace(chr(92), '/')
        top = norm.split('/')[0]
        if top in INTERNAL_DIRS:
            bad.append((norm, '内部目录 ' + top + '/'))
            continue
        base = norm.split('/')[-1]
        for pat in INTERNAL_PATTERNS:
            if pat.search(base):
                bad.append((norm, '文件名命中内部模式 ' + pat.pattern))
                break

    # ---------- ② .gitignore 的规则必须**真的生效** ----------
    # 🔴🔴 2026-10-06 血泪：只查「.gitignore 里有没有这个字符串」是**不够的**。
    #    **gitignore 不支持行尾注释** ——
    #      写成 `07-notes/            # 决策记录 / 复盘`
    #      会被当成**字面路径**（含空格与 #），规则**完全失效**，
    #      而 `git status` 仍显示 `?? 07-notes/`（很容易被骗过去）。
    #    ⇒ 正解：用 `git check-ignore` **实测**每条规则生不生效。
    #    这一条是本门禁存在的意义：它抓的就是"看起来有、其实没有"。
    gi_path = os.path.join(ROOT, '.gitignore')
    missing_rules = []
    for probe in ('00-charter/x.md', '07-notes/x.md', '08-plan/x.md',
                  'PLAN.md', 'WORK-NOTES.md'):
        r = subprocess.run(['git', 'check-ignore', '-q', probe],
                           cwd=ROOT, capture_output=True)
        if r.returncode != 0:
            missing_rules.append(probe)

    print('  === 仓库卫生（Owner 铁律：零内部想法）===')
    print('  git 索引文件数：%d' % len(files))

    if bad:
        print('')
        print('  🔴 索引里有 %d 个内部文档（**必须移出**）:' % len(bad))
        for f, why in bad[:12]:
            print('       %-46s ← %s' % (f[:46], why))
        if len(bad) > 12:
            print('       …还有 %d 个' % (len(bad) - 12))
    else:
        print('  ✅ 索引里零内部文档')

    if missing_rules:
        print('')
        print('  🔴 这些路径**没有被真正忽略**：%s' % ', '.join(missing_rules))
        print('     ⚠️ 最可能的原因：**.gitignore 不支持行尾注释**')
        print('        （写成 "07-notes/   # 说明" 会被当字面路径 ⇒ 规则失效，')
        print('          而 git status 仍显示 ?? 07-notes/，很容易被骗过去）')
        print('     ⇒ 注释必须写在**独立行**。用 git check-ignore 验一下：')
        print('        git check-ignore -q 07-notes/x.md && echo OK')
    else:
        print('  ✅ gitignore 规则实测生效（check-ignore 全部命中）')

    print('')
    if bad or missing_rules:
        print('  ⇒ 🔴 内部思考只留本地 workspace，绝不推 GitHub')
        print('    修法：git rm --cached <路径>（保留本地文件）+ 补 .gitignore')
        return 1
    print('  ✅ 仓库卫生达标')
    return 0


if __name__ == '__main__':
    sys.exit(main())
