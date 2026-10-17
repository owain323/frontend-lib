#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
repo-hygiene.py — 仓库卫生门禁（零内部想法）

===========================================================================
🔴 为什么必须有这个门禁
---------------------------------------------------------------------------
  把 frontend-lib 推上 GitHub 时，`git add -A` 把
  `00-charter/`（定义 /  / 作战计划 / 差距分析）**一起推上去了**。
  还有 `07-notes/`（决策记录、复盘）、`08-plan/`、`PLAN.md`。

  ⛔ 这正是明令禁止的：
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
  ③ 判别力验证用的探针文件不得被提交

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
# ⚠️ 本文件曾被批量清洗脚本误伤，把词表里的一项清成了空字符串
#    ⇒ `re.compile(r'')` 匹配**一切**，导致 293 个正常文件被报成"内部文档"。
#    ⭐ 教训：清洗脚本必须**跳过门禁自身的词表**（词表就是要含这些词的）。


# 根目录白名单（0.8.9 加 · 判据③）
#   新增根级目录/文件**必须显式登记**。理由见 main() 里判据③的注释：
#   探针/夹具产物被 `git add -A` 顺手提交过一次，而且因为不在任何扫描范围里，
#   在索引里躺了几轮都没人发现。
ROOT_ALLOWED_DIRS = {
    '.github',
    '01-tokens', '02-primitives', '03-patterns', '04-recipes', '05-audit',
    '06-vendor', '09-assets', '10-review',
    'adapters', 'ai', 'benchmark', 'dist', 'docs', 'examples',
    'type-tests', 'types',
}
ROOT_ALLOWED_FILES = {
    '.gitattributes', '.gitignore',
    # `.npmrc`（0.9.0 加）：把 registry 钉在官方源。
    #   本机全局是 `registry.npmmirror.com`（淘宝镜像），而**镜像是只读的**
    #   ⇒ `npm publish` 会得到 403，且错误信息看起来像权限问题。
    #   文件里没有任何 token（凭据走 `npm login`，存用户主目录），leak-scan 也过。
    '.npmrc',
    'API.md', 'CHANGELOG.md', 'CODE_OF_CONDUCT.md', 'CONTRIBUTING.md',
    'ERRORS.md', 'LICENSE', 'README.md', 'SECURITY.md',
    'START-HERE.md', 'SUPPORT.md',
    'VERSION', 'index.html', 'package-lock.json', 'package.json',
}


def git_ls_files():
    try:
        # 🔴🔴 修一个**让本门禁完全失效**的 bug：
        #    `git ls-files` 默认对非 ASCII 路径做**引号转义**（core.quotePath）
        #    ⇒ "07-notes/-看不见的bug.md" 输出成
        #      "07-notes/ä¸­...md"（带引号 + 八进制转义）
        #    ⇒ split('/')[0] 拿到的是 `"07-notes` 而不是 `07-notes`
        #    ⇒ **中文路径永远匹配不上** ⇒ 门禁一直报"零内部文档"（假绿）
        #    ⚠️ 「零中文」纪律的一个副作用：它让中文文件名在
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
    roots = set()
    for f in files:
        norm = f.replace(chr(92), '/')
        top = norm.split('/')[0]
        roots.add(top)
        if top in INTERNAL_DIRS:
            bad.append((norm, '内部目录 ' + top + '/'))
            continue
        base = norm.split('/')[-1]
        for pat in INTERNAL_PATTERNS:
            if pat.search(base):
                bad.append((norm, '文件名命中内部模式 ' + pat.pattern))
                break

    # ---------- ② .gitignore 的规则必须**真的生效** ----------
    # 🔴🔴 血泪：只查「.gitignore 里有没有这个字符串」是**不够的**。
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

    print('  === 仓库卫生（零内部想法）===')
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

    # ---------- ③ 根目录只允许白名单条目（0.8.9 加）----------
    #  起因（真事故）：索引里有一个叫
    #     `这个目录不存在-零文件守卫探针`（6.6 KB 的 HTML）
    #  的文件，是某道门禁测「零文件守卫」时写出来的探针产物，
    #  被 `git add -A` 一起提交了（`70897ec`）。
    #  ⇒ 它不影响任何门禁（不在扫描范围里），所以**一直没被发现**：
    #     这正是"没人看的地方会慢慢变脏"。
    #  ⇒ 判据：根目录条目必须在白名单里。新增根级文件/目录**必须显式登记**，
    #     于是探针产物不可能再被顺手提交进来。
    stray = sorted(r for r in roots
                   if r not in ROOT_ALLOWED_DIRS and r not in ROOT_ALLOWED_FILES)

    if stray:
        print('')
        print('  🔴 根目录有 %d 个**未登记**的条目：' % len(stray))
        for s in stray[:12]:
            print('       %s' % s[:60])
        print('     ⚠️ 探针/夹具产物被 `git add -A` 扫进来就是这样发生的')
        print('        （实测过一次：一个叫「这个目录不存在-零文件守卫探针」的'
              '6.6 KB HTML 在索引里躺了几轮没人发现）')
        print('     ⇒ 如果这是**有意新增**的根级文件/目录，把它加进 '
              '`repo-hygiene.py` 的 ROOT_ALLOWED_*；')
        print('        如果是产物，`git rm --cached` 并加进 .gitignore。')
    else:
        print('  ✅ 根目录条目全部在白名单内（%d 个）' % len(roots))

    print('')
    if bad or missing_rules or stray:
        print('  ⇒ 🔴 仓库卫生未达标')
        print('    内部思考只留本地 workspace，绝不推 GitHub；'
              '根级新增必须显式登记')
        return 1
    print('  ✅ 仓库卫生达标')
    return 0


if __name__ == '__main__':
    sys.exit(main())
