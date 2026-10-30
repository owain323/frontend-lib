#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
zero-dep-gate.py — 「零第三方运行时依赖」承诺的机器守护

=============================================================================
为什么要有这条
---------------------------------------------------------------------------
README 第三行写着：

    **Zero third-party runtime dependencies** — installing it adds nothing to
    your `node_modules` that ships to the browser.

`package.json` 的 `keywords_note` 也写着「零依赖是本库的核心约束」。

但 `05-audit/` 下**没有任何门禁读过 `dependencies` 字段**（2026-10-30 实测：
`grep -rn "dependencies" 05-audit/*.py 05-audit/*.js` 一条都没有）。

破坏实验（同日）：

    往 package.json 注入 "dependencies": {"lodash": "^4.17.21"}

结果 `doc-facts-gate.py` / `npm run dist:check` / `npm test` **三道全部 RC=0**。

⇒ 核心承诺被违反时，全库没有任何一道门禁会知道。这条就是补上它。

=============================================================================
判据（三条都要成立）
---------------------------------------------------------------------------
  ① `dependencies` 为空或不存在
  ② `peerDependencies` 为空或不存在 —— peer 同样会让消费方装包
  ③ `optionalDependencies` 为空或不存在

`devDependencies` **允许**：它不进使用者的 node_modules。
这正是「开发期工具」与「运行时依赖」的分界，不是漏洞。

=============================================================================
用法
---------------------------------------------------------------------------
  python 05-audit/zero-dep-gate.py
  python 05-audit/zero-dep-gate.py --selftest   # 反向控制：注入假依赖，必须红
"""

import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = os.path.join(ROOT, 'package.json')

# 这些字段一旦非空，「零运行时依赖」就不成立
FORBIDDEN = ('dependencies', 'peerDependencies', 'optionalDependencies')


def load():
    return json.load(io.open(PKG, encoding='utf-8'))


def check(pkg, selftest=False):
    fail = []
    for f in FORBIDDEN:
        v = pkg.get(f)
        if selftest and f == 'dependencies':
            v = {'lodash': '^4.17.21'}   # 注入突变
        if v:
            names = sorted(v.keys()) if isinstance(v, dict) else [str(v)]
            fail.append('%s 非空：%s' % (f, ', '.join(names)))
    return fail


def main():
    selftest = '--selftest' in sys.argv
    try:
        pkg = load()
    except Exception as e:
        print('  X 读不到 package.json：%s' % e)
        return 1

    fails = check(pkg, selftest)

    if selftest:
        # 反向控制：判据必须能抓到注入的 lodash
        if not fails:
            print('  X selftest 失败：注入 lodash 后判据没红 ⇒ 判据本身是聋的')
            return 1
        print('  [OK] selftest 抓到突变：注入 lodash ⇒ %s' % fails[0])
        return 0

    if fails:
        print('  X 「零第三方运行时依赖」这个承诺被破坏了：')
        for f in fails:
            print('    · ' + f)
        print('')
        print('    README 第三行与 package.json 的 keywords_note 都宣称零依赖。')
        print('    要么把依赖去掉，要么同步改掉 README —— 但不能一边加包一边宣称零依赖。')
        return 1

    dev = pkg.get('devDependencies') or {}
    print('  OK 零运行时依赖成立（devDependencies %d 个，只用于开发期）' % len(dev))
    return 0


if __name__ == '__main__':
    sys.exit(main())
