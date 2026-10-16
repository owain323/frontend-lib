#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rewrite-residue-gate.py — 抓「批量替换脚本留下的拼接痕迹」

背景（本门禁因何存在）
---------------------------------------------------------------------------
2026-08-16 的一次事故：`leak-fix-paths.py` 是个一次性迁移脚本，
它的 `fix_js()` 里有一行：

    t = RE_SLASH.sub(lambda m: "REPO + '/" + m.group(1) + "'", t)

而 `RE_SLASH = re.compile(r"['\"]([^'\"]*)['\"]")` ——
**匹配任意引号字符串**，于是

    require('puppeteer-core')   →   require(REPO + '//puppeteer-core')
    （"常见写法：纯红"）        →   （REPO + REPO + '//常见写法：纯红'）

一次运行 ⇒ **80 个文件被污染**，其中包括所有浏览器门禁的入口
⇒ 后续所有浏览器门禁全挂（报成"产品坏了 60 多处"，
   实际是"文件被脚本毁了"）。

🔴 为什么当时没人发现：
   1. 那次运行没有 dry-run、没有确认、没有备份；
   2. 门禁**失败时不显示错误原因**（`run()` 只 grep 判词），
      于是 60 多个 FAIL 一个字都看不出原因；
   3. 直到有人去 `require()` browser.js 才发现整个文件是坏的。

判据
---------------------------------------------------------------------------
源码文件（.js / .mjs / .py / .sh）里**不允许**出现下列痕迹：

  ① `REPO + REPO + '//`      连续两次替换的残留
  ② `REPO + '<标识符> + '//` 一次替换的残留（拼接两次）
  ③ `<标识> + '<标识> + '/`  同上，任意标识符版本
  ④ `__REPO__` / `${REPO}/`   未替换的模板变量（在 .py/.sh 里才是问题）

⭐ 这些痕迹**在任何源码里都是错的** —— 因为 `REPO` 是一个变量，
   `REPO + '//x'` 在 JS 里能跑，但它的**来源只能是那条坏正则**。
   真正的可移植写法是 `path.resolve(__dirname, '..')`。

用法：python3 rewrite-residue-gate.py
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 要扫的源码扩展名
EXTS = ('.js', '.mjs', '.py', '.sh')
# 不扫的目录
SKIP_DIRS = ('/dist/', '/node_modules/', '/.git/', '/.workbuddy/')

# 🔴 每条判据 = (编号, 说明, 正则)
#   正则必须能命中**实际的污染形态**，且不能命中正常写法
PATTERNS = [
    ('R1', '连续两次替换的残留 REPO + REPO',
     re.compile(r"REPO\s*\+\s*REPO\s*\+")),
    ('R2', '拼接痕迹 <标识> + <字符串> + <字符串>',
     re.compile(r"\b[A-Z_]{3,}\s*\+\s*'[^']{1,40}'\s*\+\s*'")),
    ('R3', "替换产生的双斜杠常量 REPO + '//",
     re.compile(r"REPO\s*\+\s*'//")),
    # ⚠️ R4「未替换的占位符 ${REPO} / __REPO__」**故意不做**：
    #   那一类已由 `leak-scan.py` 的「未替换占位符」检查负责，
    #   而且它有成熟的豁免（门禁脚本自己 docstring 里的示例不算缺陷）。
    #   🔴 我第一版自己写了一遍，结果把门禁脚本的注释全报成残留
    #      ⇒ **同一个判定不要写两遍**（E31 的老教训）。
]


def sources():
    for dp, dn, fn in os.walk(ROOT):
        p = dp.replace(os.sep, '/')
        if any(s in p for s in SKIP_DIRS):
            continue
        for f in fn:
            if not f.endswith(EXTS):
                continue
            # 🔴 排除本文件自己：判据的正则里必然含它要找的字面量，
            #   不排除的话它会永远报自己的行。
            if f == os.path.basename(__file__):
                continue
            yield os.path.join(dp, f)


def main():
    issues = []
    n_files = 0
    for p in sources():
        n_files += 1
        try:
            src = io.open(p, encoding='utf-8', errors='replace').read()
        except OSError:
            continue
        for i, line in enumerate(src.split('\n'), 1):
            for code, desc, pat in PATTERNS:
                if pat.search(line):
                    issues.append((code, os.path.relpath(p, ROOT).replace(
                        os.sep, '/'), i, desc, line.strip()[:62]))

    for code, rel, ln, desc, txt in issues:
        print('  [%s] %-40s L%-5d %s' % (code, rel, ln, txt))
    print('')
    print('（扫了 %d 个源码文件）' % n_files)

    # 🔴 零文件守卫：扫到 0 个文件 ⇒ 判红（否则是空转）
    if n_files == 0:
        print('❌ 一个源码文件都没扫到 —— 这是**假绿**，本门禁不接受空扫描。')
        return 1

    if issues:
        print('%d 处「批量替换残留」—— 这些痕迹只可能来自写坏的替换脚本。' % len(issues))
        print('  真实写法是 path.resolve(__dirname, "..")，不是字符串拼接。')
        print('  ⭐ 若你刚跑过某个 fix-* / *-clean 脚本，请先 git diff 看它改了什么。')
        return 1
    print('无批量替换残留。')
    return 0


if __name__ == '__main__':
    sys.exit(main())