#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
finance-example-ties.py — 财务示例页的每一个数都必须能被读者自己加出来

===========================================================================
🔴 为什么必须有（实测事故）
---------------------------------------------------------------------------
`examples/finance-report/index.html` 是拿来当尺子的示例页：它要证明
"用本库的素材能拼出产品级的一页"。第一次交付时，**33 条勾稽错了 6 条**：

  · 利润表：2015.4 − 167.2 − 178.6 − 48.4 − 126.9 − 12.1 = 1482.2，
    而表里营业利润写 1,402.8 —— 差了 79.4 亿，因为中间那些科目被省掉了。
  · 资产负债表：负债 682.3 + 归母 2,436.9 = 3,119.2，
    而资产总计写 3,168.7 —— 少的正是"少数股东权益"这一行。
  · 五年表的研发费用写 2.1 亿，同一页的利润表写 12.1 亿。
  · ROE 34.6% 与它下面那张资产负债表的权益对不上。
  · 市盈率 22.4 / 市净率 7.8 / 股息率 2.9% 三个数互相矛盾。

**这些数全部通过了所有既有门禁** —— 通过 HTML 校验、通过对比度、
通过视觉基线、像素一致。因为没有任何一道门禁在看"数对不对"。

读者判断一页财务报告是否可信，第一件事就是拿计算器加一遍。
加不上，后面写得再好也没人看。这不是内容质量问题，是**这份作品能不能被采信**的问题。

===========================================================================
判据（每一条都独立可证伪）
---------------------------------------------------------------------------
  ① 利润表：收入 − 各成本费用 + 其他项目净额 = 营业利润；
     营业利润 + 营业外 = 利润总额；利润总额 − 所得税 = 净利润；
     净利润 − 少数股东损益 = 归母净利润
  ② 资产负债表：负债 + 归母权益 + 少数股东权益 = 资产总计；
     三者占总资产比之和 = 100；三者较上年增量之和 = 资产总计增量
  ③ 现金流量表：经营 + 投资 + 筹资 = 现金净增加额
  ④ ROE：归母净利润 ÷（期初 + 期末）/ 2 的归母权益，与 KPI 卡对得上
     （期初 = 期末 − 本年增量，所以这条同时把 BS 和 KPI 绑在一起）
  ⑤ 五年表：归母净利率 = 归母净利润 ÷ 营业总收入；研发费用 = 研发费用率 × 营业总收入
  ⑥ 分部图：茅台酒 + 系列酒 = 当年营业总收入（五年逐年）
  ⑦ 费用率图：三条线 2025 年的值 = 表 1 对应科目 ÷ 营业总收入
  ⑧ 估值：市值 ÷ 归母净利润 = PE；市值 ÷ 归母权益 = PB；分红 ÷ 市值 = 股息率
     三个数从页面上读，**不在本脚本里写死** —— 写死就成了自证。

容差按页面显示精度给：整数列 ±0.51，一位小数 ±0.051。
不是"大概对就行"，是"舍入误差以内必须相等"。

用法：
    python 05-audit/finance-example-ties.py            # 检查
    python 05-audit/finance-example-ties.py -v         # 逐条打印
    python 05-audit/finance-example-ties.py --selftest # 反向控制（变异探针）

退出码：0 = 全部成立，1 = 有对不上的（会列出算出多少、表里写多少、差多少）

===========================================================================
反向控制（--selftest）
---------------------------------------------------------------------------
本库的纪律是「没有反向控制的门禁不算门禁」——一条永远绿的判据等于没有。
所以这道门禁自带 8 个变异：故意把示例页改坏一处，确认它**真的会红**。

  ① 营业成本 +3.4 亿            ⇒ 利润表加不上
  ② 少数股东权益 +10 亿          ⇒ 资产 ≠ 负债 + 权益
  ③ 研发费用率 0.6% → 0.7%       ⇒ 图与表脱节
  ④ 股息率 3.9% → 4.0%           ⇒ 估值三数互斥
  ⑤ 茅台酒 2025 1682 → 1690      ⇒ 分部加不出收入
  ⑥ 营业利润漂移 0.2 亿          ⇒ 连"小到看不出来"的也要抓
  ⑦ 整行删掉少数股东权益          ⇒ 判据与页面脱节必须报错，不是静默通过
  ⑧ 把「归母净利率」改名成「净利率」⇒ 同上

前六个是**内容错**，后两个是**判据腐烂** —— 页面结构改了而门禁还在按老行名找，
这两类都必须红。跑完字节级还原，再确认基线重新变绿（否则探针自己脏了工作区）。
"""
from __future__ import print_function

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, 'examples', 'finance-report', 'index.html')

VERBOSE = '-v' in sys.argv
fails = []
checks = 0


def chk(label, got, want, tol):
    global checks
    checks += 1
    if abs(got - want) > tol:
        fails.append(u'%s：算出 %.2f，页面写 %.2f，差 %.2f' % (label, got, want, got - want))
    elif VERBOSE:
        print(u'  ok  %s' % label)


def num(text):
    """把单元格文本变成数：去标签、去千分位、把 U+2212 当负号、『—』当缺失。"""
    t = re.sub(r'<[^>]+>', '', text).replace(u'\u2212', '-').replace(',', '').strip()
    try:
        return float(t)
    except ValueError:
        return None


def table_rows(html, panel_id):
    """取某个 tabpanel 里的全部数据行：[(项目名, [数...])]"""
    m = re.search(r'id="%s"(.*?)</table>' % panel_id, html, re.S)
    if not m:
        raise SystemExit(u'找不到 #%s 里的表格 —— 页面结构变了，本门禁的判据要跟着改，'
                         u'不能就这么通过' % panel_id)
    out = []
    for tr in re.findall(r'<tr>(.*?)</tr>', m.group(1), re.S):
        cells = re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', tr, re.S)
        if cells:
            out.append((re.sub(r'<[^>]+>', '', cells[0]).strip(), [num(c) for c in cells[1:]]))
    return out


def jarray(html, var):
    m = re.search(r'var %s = \[([^\]]*)\]' % var, html)
    if not m:
        raise SystemExit(u'找不到 var %s —— 图表数据被改名了，判据要跟着改' % var)
    return [float(x) for x in m.group(1).split(',')]


def main():
    if not os.path.exists(PAGE):
        raise SystemExit(u'示例页不存在：%s' % PAGE)
    html = io.open(PAGE, encoding='utf-8').read()

    def g(rows, key):
        for name, vals in rows:
            if name.startswith(key):
                return vals
        raise SystemExit(u'表格里找不到「%s」这一行 —— 判据与页面已经脱节' % key)

    # ── ① 利润表 ──────────────────────────────────────────────
    is_ = table_rows(html, 'panel-is')
    rev = g(is_, u'营业总收入')[0]
    op = (rev - g(is_, u'营业成本')[0] - g(is_, u'税金及附加')[0]
              - g(is_, u'销售费用')[0] - g(is_, u'管理费用')[0]
              - g(is_, u'研发费用')[0] - g(is_, u'财务费用')[0]
              + g(is_, u'其他项目净额')[0])
    chk(u'利润表 营业利润', op, g(is_, u'营业利润')[0], 0.051)
    chk(u'利润表 利润总额', g(is_, u'营业利润')[0] + g(is_, u'营业外收支净额')[0],
        g(is_, u'利润总额')[0], 0.051)
    chk(u'利润表 净利润', g(is_, u'利润总额')[0] - g(is_, u'所得税费用')[0],
        g(is_, u'净利润')[0], 0.051)
    chk(u'利润表 归母净利润', g(is_, u'净利润')[0] - g(is_, u'少数股东损益')[0],
        g(is_, u'归母净利润')[0], 0.051)
    chk(u'表 1 毛利率 = 1 − 营业成本/收入', (rev - g(is_, u'营业成本')[0]) / rev * 100,
        91.7, 0.06)

    # ── ② 资产负债表 ──────────────────────────────────────────
    bs = table_rows(html, 'panel-bs')
    chk(u'资产 = 负债 + 归母 + 少数',
        g(bs, u'负债合计')[0] + g(bs, u'归母所有者权益')[0] + g(bs, u'少数股东权益')[0],
        g(bs, u'资产总计')[0], 0.051)
    chk(u'BS 占比合计 100', g(bs, u'负债合计')[1] + g(bs, u'归母所有者权益')[1] +
        g(bs, u'少数股东权益')[1], 100.0, 0.06)
    chk(u'BS 增量合计 = 资产增量',
        g(bs, u'负债合计')[2] + g(bs, u'归母所有者权益')[2] + g(bs, u'少数股东权益')[2],
        g(bs, u'资产总计')[2], 0.051)

    # ── ③ 现金流量表 ──────────────────────────────────────────
    cf = table_rows(html, 'panel-cf')
    chk(u'CF 三项之和 = 现金净增加额',
        g(cf, u'经营活动')[0] + g(cf, u'投资活动')[0] + g(cf, u'筹资活动')[0],
        g(cf, u'现金及现金等价物净增加额')[0], 0.051)

    # ── ④ ROE（把 BS 与 KPI 绑起来） ───────────────────────────
    eq_end, eq_d = g(bs, u'归母所有者权益')[0], g(bs, u'归母所有者权益')[2]
    chk(u'ROE = 归母净利 ÷ 平均归母权益',
        g(is_, u'归母净利润')[0] / ((eq_end + eq_end - eq_d) / 2) * 100, 34.6, 0.06)

    # ── ⑤ 五年表 ──────────────────────────────────────────────
    m = re.search(r'表 4(.*?)</table>', html, re.S)
    if not m:
        raise SystemExit(u'找不到表 4')
    h = m.group(1)
    yrs = ['2021', '2022', '2023', '2024', '2025']

    def hrow(key):
        r = re.search(r'<th scope="row">%s.*?</th>(.*?)</tr>' % key, h, re.S)
        if not r:
            raise SystemExit(u'表 4 里找不到「%s」' % key)
        return [num(c) for c in re.findall(r'<td[^>]*>(.*?)</td>', r.group(1), re.S)]

    revs, nps = hrow(u'营业总收入'), hrow(u'归母净利润')
    rds, rdr = hrow(u'研发费用'), jarray(html, 'RD')
    for i, y in enumerate(yrs):
        chk(u'表 4 归母净利率 %s' % y, nps[i] / revs[i] * 100, hrow(u'归母净利率')[i], 0.06)
        if rds[i] is not None:
            chk(u'表 4 研发费用 %s = 费用率 × 收入' % y, revs[i] * rdr[i] / 100, rds[i], 0.051)
    chk(u'表 4 营收 2025 = 表 1', revs[4], rev, 0.51)
    chk(u'表 4 归母 2025 = 表 1', nps[4], g(is_, u'归母净利润')[0], 0.51)

    # ── ⑥ 分部图 ──────────────────────────────────────────────
    mt, sr = jarray(html, 'MAOTAI'), jarray(html, 'SERIES')
    for i, y in enumerate(yrs):
        chk(u'分部合计 %s = 营业总收入' % y, mt[i] + sr[i], revs[i], 0.51)

    # ── ⑦ 费用率图 vs 表 1 ────────────────────────────────────
    for var, key, label in (('SELL', u'销售费用', u'销售'), ('ADMIN', u'管理费用', u'管理')):
        chk(u'费用率 %s 2025 = 科目 ÷ 收入' % label,
            g(is_, key)[0] / rev * 100, jarray(html, var)[4], 0.051)

    # ── ⑧ 估值四数（从页面读） ────────────────────────────────
    card = re.search(u'估值快照(.*?)</section>', html, re.S)
    if not card:
        raise SystemExit(u'找不到「估值快照」卡')
    card = card.group(1)

    def snap(key):
        m2 = re.search(r'<dt>%s</dt><dd class="num">([^<]+)</dd>' % key, card)
        if not m2:
            raise SystemExit(u'估值快照里找不到「%s」' % key)
        return float(re.sub(r'[^0-9.\-]', '', m2.group(1).replace(u'\u2212', '-')))

    cap = snap(u'总市值')
    chk(u'市值 ÷ 归母 = PE', cap / g(is_, u'归母净利润')[0], snap(u'市盈率 TTM'), 0.051)
    chk(u'市值 ÷ 归母权益 = PB', cap / g(bs, u'归母所有者权益')[0], snap(u'市净率'), 0.051)
    chk(u'派息 75% ÷ 市值 = 股息率', g(is_, u'归母净利润')[0] * 0.75 / cap * 100,
        snap(u'股息率'), 0.051)

    # ── 汇总 ──────────────────────────────────────────────────
    if fails:
        print(u'[FAIL] 财务示例页有 %d 条勾稽对不上（共查 %d 条）：' % (len(fails), checks))
        for f in fails:
            print(u'   - ' + f)
        print(u'   ⇒ 示例页上的每个数，都应能被读者用页面上的其他数算出来。')
        print(u'      改数必须整页一起改，改完跑这条门禁。')
        return 1
    print(u'[OK  ] 财务示例页 %d 条勾稽全部成立' % checks)
    return 0


def selftest():
    """反向控制：把示例页故意改坏，确认这道门禁真的会红。
    跑子进程而不是在内存里调 main() —— 这样验的是**真的 CLI 退出码**，
    也就是 check-all.sh 实际依赖的那个东西。"""
    import subprocess

    orig = open(PAGE, 'rb').read()
    muts = [
        (u'营业成本 166.6 → 170.0（利润表加不上）',
         u'<td class="num">166.6</td>', u'<td class="num">170.0</td>'),
        (u'少数股东权益 300.0 → 310.0（资产 ≠ 负债 + 权益）',
         u'<td class="num">300.0</td>', u'<td class="num">310.0</td>'),
        (u'研发费用率 0.6 → 0.7（图与表脱节）',
         u'var RD = [0.2, 0.3, 0.4, 0.5, 0.6];',
         u'var RD = [0.2, 0.3, 0.4, 0.5, 0.7];'),
        (u'股息率 3.9% → 4.0%（估值三数互斥）',
         u'<dd class="num">3.9%</dd>', u'<dd class="num">4.0%</dd>'),
        (u'茅台酒 2025 1682 → 1690（分部加不出收入）',
         u'var MAOTAI = [934, 1078, 1266, 1459, 1682];',
         u'var MAOTAI = [934, 1078, 1266, 1459, 1690];'),
        (u'营业利润漂移 0.2 亿（小到"看不出来"的也要抓）',
         u'<td class="num">1,402.8</td>', u'<td class="num">1,402.6</td>'),
        (u'整行删掉少数股东权益（判据腐烂必须报错）',
         u'<th scope="row">少数股东权益</th>', u'<th scope="row">股东权益</th>'),
        (u'「归母净利率」改名成「净利率」（判据找不到行必须报错）',
         u'<th scope="row">归母净利率', u'<th scope="row">净利率'),
    ]

    def run():
        p = subprocess.run([sys.executable, os.path.abspath(__file__)],
                           capture_output=True)
        # SystemExit 的说明走 stderr，失败原因多数在那里 —— 两边都要收
        out = ((p.stdout or b'') + (p.stderr or b'')).decode('utf-8', 'replace')
        return p.returncode, out

    rc, out = run()
    if rc != 0:
        print(u'[FAIL] 基线就是红的，反向控制没有意义：')
        print(u'       ' + out.strip().splitlines()[0])
        return 1
    n = re.search(r'共?\s*(\d+)\s*条勾稽', out)
    print(u'  [OK] 基线绿（%s 条勾稽）' % (n.group(1) if n else '?'))

    bad = 0
    try:
        for name, a, b in muts:
            text = orig.decode('utf-8')
            if a not in text:
                print(u'  [FAIL] 探针腐烂：源串没找到 —— %s' % name)
                print(u'         ⇒ 页面改了而探针没跟上。探针本身也是判据，也会过期。')
                bad += 1
                continue
            # 用 bytes 写回：io.open(...,'w') 在 Windows 上会把 \n 变成 \r\n，
            # 那会把 eol 门禁弄红，也会让"字节级还原"变成假话。
            open(PAGE, 'wb').write(text.replace(a, b, 1).encode('utf-8'))
            rc2, out2 = run()
            if rc2 == 0:
                print(u'  [SURVIVE] %s —— 改坏了却还是绿，这条判据是装饰' % name)
                bad += 1
            else:
                why = ''
                for line in out2.splitlines():
                    if line.strip().startswith(u'- ') or u'找不到' in line:
                        why = line.strip()
                        break
                print(u'  [KILL] %s' % name)
                if why:
                    print(u'         → %s' % why[:100])
    finally:
        open(PAGE, 'wb').write(orig)          # 字节级还原

    if open(PAGE, 'rb').read() != orig:
        print(u'  [FAIL] 还原后文件与原文不一致 —— 反向控制弄脏了工作区')
        return 1
    rc3, _ = run()
    if rc3 != 0:
        print(u'  [FAIL] 还原后基线没有重新变绿')
        return 1
    if bad:
        print(u'  [FAIL] %d 个变异没被抓住（共 %d 个）' % (bad, len(muts)))
        return 1
    print(u'  [OK] %d 个变异全部被抓住，还原后基线重新变绿' % len(muts))
    return 0


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(main())
