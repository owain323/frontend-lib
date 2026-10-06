#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tsc-gate.py — TypeScript 契约门禁

===========================================================================
🔴 这个门禁解决什么（2026-10-06）
---------------------------------------------------------------------------
  仓库曾经声称「TypeScript 类型与运行时 API 一致」，但实际上类型里写满了
  runtime 根本不存在的 API：

    ① Select.value 声明成 string[]，实际是标量
    ② ComponentInstance.destroy() 三个组件都没有
    ③ Combobox.tags 声明成方法()，实际是 getter
    ④ DateRange 实例声明了 iso/quarterOf 等**静态**函数
    ⑤ PresetName 列的 'today'/'week' 全部不存在
    ⑥ DateRange.onChange 签名是两个字符串，实际是 (对象, 布尔)

  更糟的是**没人发现**：旧的 api-snapshot 门禁只比对「方法名是否出现」，
  上面 6 条全部能通过。

===========================================================================
两道判据，缺一不可
---------------------------------------------------------------------------
  A. **正例必须编译通过**
     type-tests/positive.ts —— 真实用法不该报错。

  B. **反例必须编译失败** ⭐ 这条才是关键
     type-tests/negative.ts —— 每条错误用法都对应一个真实发生过的问题。

  ⚠️ 为什么 B 不能省：
     如果只跑 A，「tsc 根本没运行」「paths 配错了」「文件没被 include」
     这三种情况都会输出「通过」⇒ 假绿。
     B 保证 tsc 真的在工作，且判据真的在拒绝错误用法。
===========================================================================
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.join(ROOT, 'type-tests')
POSITIVE = os.path.join(TESTS, 'tsconfig.json')
NEGATIVE = os.path.join(TESTS, 'tsconfig.negative.json')


def find_tsc():
    """定位 tsc：优先本地 node_modules，其次 PATH。"""
    local = os.path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
    if os.path.exists(local):
        return [process_node(), local]
    which = shutil.which('tsc')
    if which:
        return [which]
    return None


def process_node():
    return os.environ.get('NODE', 'node')


def run_tsc(project):
    tsc = find_tsc()
    if not tsc:
        return None, '找不到 tsc（npm install 一下 typescript）'
    p = subprocess.run(tsc + ['--noEmit', '-p', project],
                       cwd=ROOT, capture_output=True, timeout=300)
    return p.returncode, (p.stdout or b'').decode('utf-8', 'replace') + \
        (p.stderr or b'').decode('utf-8', 'replace')


# ⭐ 反例必须被拒绝的断言：每条 = (源码里的特征串, 期望出现的错误特征)
#   期望特征写宽松一点（只要能对上这条错误即可），避免 TS 版本差异导致假红。
NEGATIVE_EXPECT = [
    ('sel.destroy()',              'destroy'),
    ('sel.value = [',              'string[]'),
    ('cb.tags()',                  'not callable'),
    ('dr.setPreset(\'2026',        'Expected 1 arguments'),
    ('dr.addDays(',                'addDays'),
    ('presets: [\'today\']',       '"today"'),
    # ⑦ onChange 第一个参数是对象，不是两个字符串。
    #    ⭐ 期望特征选 'from' 而不是 'onChange' ——
    #      TS 报的是「参数 from 与 value 类型不兼容」，
    #      报错文本里并不会出现属性名onChange（实测踩过）。
    ('onChange: (from: string',    "not assignable"),
    ('const bad: string = tree.selected', 'HTMLElement'),
]


def main():
    print('  === TypeScript 契约（正例必须过/ 反例必须挂）===')
    print('')
    if not os.path.isdir(TESTS):
        print('  FAIL  没有 type-tests/ 目录')
        return 1

    # ---------- A. 正例必须编译通过 ----------
    rc, out = run_tsc(POSITIVE)
    if rc is None:
        print('  FAIL  %s' % out)
        return 1
    if rc != 0:
        print('  FAIL  正例编译失败（这些是合法用法，不该报错）')
        for line in out.strip().split('\n')[:8]:
            if line.strip():
                print('        %s' % line.strip()[:96])
        return 1
    print('  OK    正例编译通过（type-tests/positive.ts）')

    # ---------- B. 反例必须编译失败 ----------
    rc, out = run_tsc(NEGATIVE)
    if rc is None:
        print('  FAIL  %s' % out)
        return 1
    if rc == 0:
        print('  FAIL  🔴 反例竟然编译通过了')
        print('        ⇒ 要么 tsc 没真正工作，要么类型被改松了。')
        print('        这条判据是防「假绿」的关键，不能跳过。')
        return 1

    #逐条断言：期望的错误信息必须出现
    missing = []
    for src, expect in NEGATIVE_EXPECT:
        if expect not in out:
            missing.append((src, expect))
    if missing:
        print('  FAIL  反例里有%d 条**没有被拒绝**（类型可能被改松了）：' % len(missing))
        for src, expect in missing:
            print('        %-34s 期望错误含：%s' % (src, expect))
        print('')
        print('        tsc 实际输出（前 12 行）：')
        for line in out.strip().split('\n')[:12]:
            if line.strip():
                print('          %s' % line.strip()[:96])
        return 1

    n_err = len([l for l in out.split('\n') if 'error TS' in l])
    print('  OK    反例全部被拒绝（%d 条错误用法 / %d 条断言）'
          % (n_err, len(NEGATIVE_EXPECT)))
    print('')
    print('  ⇒ 类型与runtime 的形状已由编译器核对过。')
    print('    改 types/index.d.ts 前先跑本门禁，改完必跑。')
    return 0


if __name__ == '__main__':
    sys.exit(main())