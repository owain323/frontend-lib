#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
detail-page-contract.py — detail-page 三个变体必须同构且被视觉覆盖

===========================================================================
🔴 为什么需要（不是"顺手加个脚本"）
---------------------------------------------------------------------------
「三个变体结构一致」是这张配方的全部价值：字段有多少、有没有数据，
**都不许改 DOM**。但这句话只写在 README 里就等于没写 ——
第二次改样式的人会顺手删掉一个空节点，而没有任何东西会报警。

本脚本做两件事：
  ① 用 html.parser 建标签序列，三个变体必须**逐项一致**
     （不用正则：属性值里的 `<`、script/style 里的字符串都会骗过正则）
  ② 三个变体都必须进 `05-audit/shot-baseline.py` 的 PAGES
     （否则"观感"没人看管 —— 这正是 2026-10-23 抓到的那个洞）

组件路径：04-recipes/detail-page/（覆盖率门禁按目录名认契约，这里写成字面量）

用法：
    python 05-audit/detail-page-contract.py
    python 05-audit/detail-page-contract.py --selftest
退出码：0 = 同构且都被视觉覆盖；1 = 否；2 = 文件缺失（不许判通过）
"""
import io
import os
import re
import sys
import html.parser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, '04-recipes', 'detail-page')
VARIANTS = ('full', 'partial', 'null')
SHOT = os.path.join(ROOT, '05-audit', 'shot-baseline.py')


class Seq(html.parser.HTMLParser):
    """只取标签序列（忽略文本与属性值）"""

    def __init__(self):
        html.parser.HTMLParser.__init__(self, convert_charrefs=True)
        self.tags = []

    def handle_starttag(self, tag, attrs):
        self.tags.append('<' + tag)

    def handle_startendtag(self, tag, attrs):
        self.tags.append('<' + tag)

    def handle_endtag(self, tag):
        self.tags.append('</' + tag)


def skeleton(text):
    p = Seq()
    p.feed(text)
    p.close()
    return p.tags


def compare(a, b):
    """返回 None 表示一致；否则返回 (位置, a 的标签, b 的标签)"""
    for i in range(min(len(a), len(b))):
        if a[i] != b[i]:
            return i, a[i], b[i]
    if len(a) != len(b):
        return min(len(a), len(b)), (a[len(b)] if len(a) > len(b) else '（无）'), \
               (b[len(a)] if len(b) > len(a) else '（无）')
    return None


def covered_by_visual(pages_text):
    """三个变体是否都登记在 shot-baseline 的 PAGES 里"""
    missing = []
    for v in VARIANTS:
        if not re.search(r"\('04-recipes/detail-page',\s*'%s\.html'" % v, pages_text):
            missing.append(v + '.html')
    return missing


def selftest():
    bad = 0

    # ① 同构判据本身：一致 ⇒ None；多一个节点 ⇒ 必须报
    a = skeleton('<div><p>x</p></div>')
    cases = [
        ('一致', a, skeleton('<div><p>y</p></div>'), False),
        ('多一个节点', a, skeleton('<div><p>x</p><p>y</p></div>'), True),
        ('标签种类不同', a, skeleton('<div><section>x</section></div>'), True),
        ('嵌套不同', a, skeleton('<div><p>x</p></div></div>'), True),
    ]
    for name, x, y, want_diff in cases:
        diff = compare(x, y)
        ok = (diff is not None) == want_diff
        print('  %-14s %s  期望%s 实得%s' % (
            name, 'PASS' if ok else 'FAIL',
            '有差异' if want_diff else '一致', '有差异' if diff else '一致'))
        if not ok:
            bad += 1

    # ② 覆盖判据本身：漏一个必须报
    good = "    ('04-recipes/detail-page', 'full.html', 'x'),\n" \
           "    ('04-recipes/detail-page', 'partial.html', 'x'),\n" \
           "    ('04-recipes/detail-page', 'null.html', 'x'),\n"
    if covered_by_visual(good):
        print('  FAIL 覆盖判据对完整清单误报')
        bad += 1
    else:
        print('  PASS 覆盖判据：完整清单不误报')
    if covered_by_visual(good.replace("('04-recipes/detail-page', 'null.html', 'x'),\n", '')) != ['null.html']:
        print('  FAIL 覆盖判据漏报（少一个变体却没说）')
        bad += 1
    else:
        print('  PASS 覆盖判据：少一个变体必须报')

    print('  自检 %d 条，失败 %d 条' % (len(cases) + 2, bad))
    return 1 if bad else 0


def main():
    if '--selftest' in sys.argv:
        return selftest()

    texts = {}
    for v in VARIANTS:
        p = os.path.join(DIR, v + '.html')
        if not os.path.isfile(p):
            print('  [FAIL] 缺 %s —— 三个变体缺一不可，不许判通过' % v + '.html')
            return 2
        texts[v] = io.open(p, encoding='utf-8').read()

    seqs = {v: skeleton(texts[v]) for v in VARIANTS}
    base = seqs['full']
    for v in VARIANTS[1:]:
        diff = compare(base, seqs[v])
        if diff:
            print('  [FAIL] full 与 %s 不同构：第 %d 个标签 full=%s %s=%s'
                  % (v, diff[0], diff[1], v, diff[2]))
            return 1
    print('  OK   三个变体同构（%d 个标签逐项一致）' % len(base))

    if not os.path.isfile(SHOT):
        print('  [FAIL] 找不到 shot-baseline.py，无法核对视觉覆盖')
        return 2
    missing = covered_by_visual(io.open(SHOT, encoding='utf-8').read())
    if missing:
        print('  [FAIL] 这些变体没有视觉基线，改坏了没人报警：%s' % ', '.join(missing))
        return 1
    print('  OK   三个变体都在 shot-baseline 的 PAGES 里')
    return 0


if __name__ == '__main__':
    sys.exit(main())
