#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
no-data-gate.py — 无数据态必须是"一等状态"，不是空白

===========================================================================
🔴 为什么需要
---------------------------------------------------------------------------
产品页里最常见的三种偷懒，都发生在没有数据的时候：

  ① **隐藏** —— 整块 display:none / 不渲染
     ⇒ 读者以为"这页没有这项"，而不是"这项没有数据"
  ② **用 0 冒充** —— 缺失写成 0
     ⇒ 0 是"确实是零"，缺失是"没有数据"，语义相反；
        在指标页上这会直接导致错误结论
  ③ **留白不说** —— 结构还在，但不解释为什么
     ⇒ 读者只能猜，猜错的成本由业务承担

本门禁只做机械可判的那部分：
  · 页面若声明 `data-state="null"`（无数据态），必须
      ① 出现理由文案（固定词表里的词）
      ② 指标值不得是裸的数字零
      ③ 指标区不得被隐藏
      ④ 理由节点必须真的写了东西（≥8 个字）

⚠️ 它判不了"理由说得对不对"—— 那是人的判断，写进 README 与评审，不装成机检。

用法：
    python 05-audit/no-data-gate.py
    python 05-audit/no-data-gate.py --selftest
退出码：0 = 无数据态都立得住；1 = 有不成立的；2 = 视野为空（不许判通过）
"""
import io
import os
import re
import sys
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 允许的"为什么没有"用词。词表短是刻意的：它要覆盖"没接入/未披露/待补录"三种真实情形。
REASONS = ('暂无数据', '未接入', '未披露', '待补录', '没有数据', '尚未接入')

# 指标值里出现这些，说明是"用零/占位符冒充"了缺失
FAKE_VALUES = ('0', '0.0', '0.00', '0%', '0.00%', '-', '—', '--', 'N/A', 'n/a')


def kpi_values(html):
    """取所有指标值节点的文本（类名以 detail-kpi__value 开头）"""
    out = []
    for m in re.finditer(
            r'<span[^>]*class="[^"]*detail-kpi__value[^"]*"[^>]*>(.*?)</span>',
            html, re.S):
        out.append(re.sub(r'<[^>]+>', '', m.group(1)).strip())
    return out


def reason_text(html):
    m = re.search(r'<p[^>]*class="[^"]*detail-null__reason[^"]*"[^>]*>(.*?)</p>',
                  html, re.S)
    if not m:
        return None
    return re.sub(r'<[^>]+>', '', m.group(1)).strip()


def audit(html, label=''):
    """纯函数：返回问题列表（便于 --selftest 喂合成样本）"""
    probs = []

    if not re.search(r'data-state="null"', html):
        return probs          # 不是无数据态，不归本门禁管

    if not any(w in html for w in REASONS):
        probs.append((label, 'no-reason',
                      '整页找不到任何"为什么没有"的说明（可用：%s）'
                      % ' / '.join(REASONS)))

    txt = reason_text(html)
    if txt is None:
        probs.append((label, 'no-reason-node', '缺 .detail-null__reason 节点'))
    else:
        # 判据落在**理由节点自己**上：整页别处的"暂无数据"不能替它顶账
        if not any(w in txt for w in REASONS):
            probs.append((label, 'no-reason',
                          '理由节点里没有"为什么没有"（"%s"）' % txt[:20]))
        if len(txt) < 8:
            probs.append((label, 'thin-reason',
                          '理由只有 %d 个字（"%s"）—— 等于没说' % (len(txt), txt)))

    for v in kpi_values(html):
        if v in FAKE_VALUES:
            probs.append((label, 'fake-zero',
                          '指标值写成了 "%s" —— 缺失不能用零或占位符冒充' % v))

    # 指标区被隐藏（属性或内联样式）
    for m in re.finditer(r'<div[^>]*class="[^"]*detail-kpis[^"]*"[^>]*>', html):
        tag = m.group(0)
        if 'hidden' in tag or re.search(r'display\s*:\s*none', tag):
            probs.append((label, 'hidden', '指标区被隐藏了 —— 整块消失等于假装没有这项'))
    return probs


def selftest():
    good = ('<section data-state="null">'
            '<div class="detail-kpis">'
            '<span class="detail-kpi__value detail-kpi__value--missing">暂无数据</span>'
            '</div>'
            '<p class="detail-null__reason">该对象尚未接入数据源，因此没有可展示的指标。</p>'
            '</section>')
    cases = [
        ('合规', good, [], ),
        ('没有理由', good.replace('该对象尚未接入数据源，因此没有可展示的指标。', '无'), ['no-reason', 'thin-reason']),
        ('用零冒充', good.replace('暂无数据', '0'), ['fake-zero']),
        ('整块隐藏', good.replace('<div class="detail-kpis">', '<div class="detail-kpis" hidden>'), ['hidden']),
        ('非无数据态', good.replace('data-state="null"', 'data-state="full"'), ['no-problems']),
    ]
    bad = 0
    for name, html, want in cases:
        got = [k for _l, k, _m in audit(html, 'x')]
        if want == ['no-problems']:
            ok = got == []
        else:
            ok = sorted(set(got)) == sorted(set(want))
        print('  %-10s %s  期望 %s 实得 %s'
              % (name, 'PASS' if ok else 'FAIL', want, got or '无问题'))
        if not ok:
            bad += 1
    print('  自检 %d 条，失败 %d 条' % (len(cases), bad))
    return 1 if bad else 0


def main():
    if '--selftest' in sys.argv:
        return selftest()

    pages = sorted(glob.glob(os.path.join(ROOT, '0*', '**', '*.html'), recursive=True))
    pages = [p for p in pages if 'dist' not in p.replace('\\', '/').split('/')]
    if not pages:
        print('  [FAIL] 一个 HTML 都没扫到 —— 视野为空，不许判通过')
        return 2

    hits, probs = 0, []
    for p in pages:
        html = io.open(p, encoding='utf-8', errors='replace').read()
        if 'data-state="null"' not in html:
            continue
        hits += 1
        rel = os.path.relpath(p, ROOT).replace('\\', '/')
        probs.extend(audit(html, rel))

    print('  无数据态页面：%d 个（扫描 %d 个 HTML）' % (hits, len(pages)))
    if not hits:
        print('  [FAIL] 一个无数据态页面都没找到 —— 要么配方没了，要么标记没了，'
              '两种都不该判通过')
        return 1
    if probs:
        for label, kind, msg in probs:
            print('  FAIL %-34s [%s] %s' % (label, kind, msg))
        return 1
    print('  OK   无数据态都给了理由，没有用零冒充，也没有整块隐藏')
    return 0


if __name__ == '__main__':
    sys.exit(main())
