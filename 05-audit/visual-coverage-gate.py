#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
visual-coverage-gate.py — 受管页面必须真的被视觉门禁覆盖

===========================================================================
🔴 为什么必须有（实测事故）
---------------------------------------------------------------------------
`shot-baseline.py` 的 `PAGES` 是**硬编码 34 条**，不是 glob。
⇒ 新增一个 `demo.html`，`visual` 门禁**根本不会拍它**，
  于是"改了 CSS 没人报警"这个洞静默地重新出现。

这不是假设：本门禁第一次跑就抓到 1 个真缺口
（`04-recipes/report` 有 CSS、有 demo，却从来没有基线），
以及 1 个必须先登记的豁免（`09-assets/echarts-adapter`）。

===========================================================================
判据（双向，任何一边不对都红）
---------------------------------------------------------------------------
  ① 源码里存在 `demo.html`，但不在 `PAGES` 里        ⇒ 未覆盖页（红）
  ② `PAGES` 里有条目，但文件不存在                    ⇒ 幽灵条目（红）
  ③ 豁免表里的页面在源码里不存在                      ⇒ 腐烂的豁免（红）
     豁免是"暂时不拍"的白条，它自己必须有寿命：
     页面改名/删除后，白条必须一起消失，否则它会变成事实上的关闭开关。

为什么是双向：单向只会告诉你"漏了新的"，不会告诉你"基线指向一个不存在的页面"。
后者更危险 —— 门禁会安静地什么都不比。

用法：
    python 05-audit/visual-coverage-gate.py
    python 05-audit/visual-coverage-gate.py --selftest
退出码：0 = 三个方向都干净；1 = 有问题；2 = 扫描视野为空（不许判通过）
"""
import io
import os
import sys
import glob
import importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 视觉门禁的视野：这几层下所有 demo.html 都该被拍
SCAN_DIRS = ('01-tokens', '02-primitives', '03-patterns',
             '04-recipes', '09-assets', '10-review')

# 豁免：必须有理由，且页面必须真实存在（③ 会核）
EXEMPT = {
    '09-assets/echarts-adapter':
        '无 CSS（纯 JS 适配层），且依赖外部 CDN 的 echarts —— 截图不可稳定复现',
}


def load_pages():
    """从 shot-baseline.py 读 PAGES。

    🔴 不在这里复制一份清单：清单是单一真源，复制第二份等于给"漂移"开绿灯。
    """
    spec = importlib.util.spec_from_file_location(
        '_shot_baseline', os.path.join(ROOT, '05-audit', 'shot-baseline.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return {d.replace('\\', '/'): f for d, f, _label in mod.PAGES}


def scan_demos():
    """扫出视野内真实存在的 demo.html（返回 {目录: 文件名}）"""
    found = {}
    for d in SCAN_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for path in glob.glob(os.path.join(base, '**', 'demo.html'), recursive=True):
            rel = os.path.relpath(os.path.dirname(path), ROOT).replace('\\', '/')
            found[rel] = 'demo.html'
    return found


def check(covered, actual, exempt):
    """纯函数：三个方向的差异都返回出来（便于 --selftest 直接喂合成数据）"""
    uncovered = sorted(set(actual) - set(covered) - set(exempt))
    phantom = sorted(set(covered) - set(actual))
    dead_exempt = sorted(set(exempt) - set(actual))
    return uncovered, phantom, dead_exempt


def report(uncovered, phantom, dead_exempt):
    bad = False
    if uncovered:
        bad = True
        print('  [FAIL] 这些页面有 demo.html，却没有视觉基线（改坏了没人报警）：')
        for p in uncovered:
            print('         + %s/demo.html' % p)
        print('         → 加进 05-audit/shot-baseline.py 的 PAGES，然后 --update 录基线；')
        print('           确实不该拍的，写进本脚本 EXEMPT 并给出理由。')
    if phantom:
        bad = True
        print('  [FAIL] PAGES 里这些条目没有对应文件（门禁会比一个不存在的页面）：')
        for p in phantom:
            print('         - %s/demo.html' % p)
    if dead_exempt:
        bad = True
        print('  [FAIL] EXEMPT 里这些页面已经不存在了（白条过期 = 事实上的关闭开关）：')
        for p in dead_exempt:
            print('         ? %s' % p)
    return bad


def selftest():
    """反向控制：判据必须能红，且不能乱红"""
    cases = [
        ('全绿', {'a', 'b'}, {'a', 'b'}, {}, (0, 0, 0)),
        ('未覆盖', {'a'}, {'a', 'b'}, {}, (1, 0, 0)),
        ('幽灵', {'a', 'gone'}, {'a'}, {}, (0, 1, 0)),
        ('腐烂豁免', {'a'}, {'a'}, {'a', 'dead'}, (0, 0, 1)),
        ('豁免生效', {'a'}, {'a', 'b'}, {'b'}, (0, 0, 0)),
    ]
    bad = 0
    for name, cov, act, exc, want in cases:
        got = tuple(len(x) for x in check(cov, act, exc))
        ok = got == want
        print('  %-8s %s  期望 %s 实得 %s' % (name, 'PASS' if ok else 'FAIL', want, got))
        if not ok:
            bad += 1
    # ⑦b 对偶：证明"没报错"不是因为它永远返回空
    if not check({'a'}, {'a', 'b'}, {})[0]:
        print('  [FAIL] 对偶用例失败：喂了未覆盖页却报空')
        bad += 1
    print('  自检 %d 条，失败 %d 条' % (len(cases) + 1, bad))
    return 1 if bad else 0


def main():
    if '--selftest' in sys.argv:
        return selftest()

    covered = load_pages()
    actual = scan_demos()
    if not actual:
        print('  [FAIL] 一个 demo.html 都没扫到 —— 视野已空，不许判通过')
        return 2

    uncovered, phantom, dead_exempt = check(covered, actual, EXEMPT)
    print('  受管页面 %d / 实际 demo %d / 豁免 %d'
          % (len(covered), len(actual), len(EXEMPT)))
    if report(uncovered, phantom, dead_exempt):
        return 1
    print('  OK   全部 demo.html 都在视觉基线的视野内')
    return 0


if __name__ == '__main__':
    sys.exit(main())
