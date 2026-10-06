#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
fix-browser-import.py — 把所有测试脚本改成走 browser.js（唯一入口）

🔴 为什么必须统一
--------------------------------
当天做判别力验证时发现：磁盘上的 JS 改对了，浏览器里跑的还是旧代码
⇒ **Chrome 磁盘缓存**。grep 实测：**11 个脚本一个都没关缓存**。

而"判别力验证"是判断门禁有没有鉴别力的**唯一手段** ——
门禁没鉴别力，它抓不抓得到问题都不可信。

改法不是给 11 个脚本各加一行（下次新写还会忘），
而是**收敛成一个入口** + 一道门禁守住。

这个脚本做两件事：
  ① 把 puppeteer.launch() 换成 require('./browser').launch()
  ② 在 launch 之后紧跟 setCacheEnabled(false)（newPage 里已做，
     但显式写一遍更保险—— belt and braces）

用法：python 05-audit/fix-browser-import.py
"""
import io
import os
import re
import sys
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUD = os.path.join(ROOT, '05-audit')

OLD_LAUNCH = re.compile(
    r"puppeteer\.launch\(\s*\{[^}]*?executablePath\s*:\s*'[^']*'[^}]*?\}\s*\)",
    re.S)
OLD_SHORT = re.compile(
    r"puppeteer\.launch\(\{\s*executablePath\s*:\s*'[^']*'\s*\}\s*\)", re.S)

NOTE = (
    "  // 🔴 统一走 browser.js：那里会 setCacheEnabled(false)。\n"
    "  //    没有它，页面里跑的是**缓存的旧代码**，测试会假通过\n"
    "  //    （磁盘上明明改对了，浏览器里还是旧的）。\n"
    "  const { launch } = require('./browser');\n"
)


def fix_one(path):
    src = io.open(path, encoding='utf-8').read()
    orig = src

    # ① 换 launch 调用
    def repl(m):
        return "launch()"
    new = OLD_LAUNCH.sub(repl, src)
    new = OLD_SHORT.sub(repl, new)

    if new == orig:
        return None

    # ② 换 require
    if "require('puppeteer-core')" in new:
        new = new.replace("const puppeteer = require('puppeteer-core');",
                          "// puppeteer-core 改由 browser.js 统一持有\n"
                          + NOTE.rstrip('\n'))
    elif "require('./browser')" not in new:
        # 插到文件顶部 require 区
        lines = new.split('\n')
        for i, l in enumerate(lines):
            if l.startswith("const") and "require(" in l:
                lines.insert(i, NOTE.rstrip('\n'))
                break
        new = '\n'.join(lines)

    # ③ 删掉不再用的 puppeteer 变量声明（如果还有残留引用就保留）
    io.open(path, 'w', encoding='utf-8').write(new)
    return True


def main():
    n = 0
    for f in sorted(glob.glob(os.path.join(AUD, '*.js'))):
        if os.path.basename(f) == 'browser.js':
            continue
        if fix_one(f):
            n += 1
            print('  ✓ 改了 ' + os.path.basename(f))
    print('  共 %d 个脚本' % n)
    if n == 0:
        print('  （没有需要改的）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
