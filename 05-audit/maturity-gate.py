#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
maturity-gate.py — 组件成熟度阶梯门禁（M8）

============================================================================
🔴 为什么需要
----------------------------------------------------------------------------
  M8 之前的实测：**27 个组件全是 stable**。

  ladder（alpha / beta / stable）在那种分布下**等于没有**：
    · 它不区分任何两个组件
    · 于是"这个组件稳不稳"这个问题，使用者只能去翻源码自己判断
    · 更糟的是它给人一种"都被验证过"的错觉

  对标 Primer：六档阶梯（Experimental → Alpha → Beta → Stable → Deprecated →
  Removed），**每一档都有硬判据**（废弃要有告警、有替代方案、提前 ≥1 个月公告、
  codemod/lint 阻断继续使用）。判据的存在感 = ladder 的鉴别力。

============================================================================
判据（五条）
----------------------------------------------------------------------------
  ① 每个组件的档位必须等于**独立重算**的结果（本文件自己扫源码，
     不读 gen-ai-contract.py 的结论 —— 那等于让生成器给自己判卷）
  ② 档位必须在 ladder 里（alpha / beta / stable）
  ③ 🔴 **ladder 必须有鉴别力**：不得所有组件都落在同一档
     ⇒ 这条正是本检查存在的理由。哪天又变成"全 stable"，这里会红。
     ⚠️ 0.15.0 补了第三条出路（写下来，免得下次又以为只能二选一）：
        如果**真的是全库达标**，那就必须**证明量具还活着** ——
        给一个真实组件临时塞一条合成债务，重算必须降成 beta
        （`discriminates()`）。证明得了 ⇒ 放行并打印一行说明；
        证明不了（判据被改松，债务不再降档）⇒ 红，且红在"量具坏了"而不是"没 beta"。
        这不是"加一个允许全绿的开关"：分支里唯一的证据是**判据仍然会红**。
  ④ 契约的 `maturityReasons.behaviorDebt` 必须与 `ai/behaviors.json` 实测一致（双向）
  ⑤ 契约的 `maturityReasons` 里四条判据字段必须与**独立重算**一致（双向）

     ⇒ 这一条顺带保证"非 stable 一定说清了欠什么"：档位由 facts 决定，而理由
       必须等于 facts，所以档位非 stable 时理由里必然有一条为假。
       把它写成单向的"必须至少有一条为假"是**死判据**（有 ⑤ 在就永远轮不到它），
       死判据 = 没有反向控制 = 不是门禁，故不采用。

🔴 ③ 的可达路径（写下来，免得将来以为它永远绿）：
     ③ 统计的是**重算**档位的分布，**不是**契约里写的值。
       ⇒ 手写把 maturity 全改成 stable 是碰不到 ③ 的（那会被 ① 抓走）。
     真正让它红的是：有人在 `ai/behaviors.json` 里把 manual / gap 洗成 core，
     或把第 4 条判据改松 ⇒ 27 个组件重算全 stable ⇒ ladder 归零。
     反向控制里就是照这条路径造的突变体。

============================================================================
四条硬判据（档位怎么算出来的）
----------------------------------------------------------------------------
  hasDemo            有 demo.html
  hasDedicatedGate   05-audit 下有它的专属门禁
  statesOnDomAttr    CSS 里没有 `.is-*` 状态类（INVARIANT I-8）
  noBehaviorDebt     行为矩阵里没有 manual（手写副本未收编）/ gap（该做没做）

  alpha  ← 前两条缺一
  beta   ← 前两条都有，但后两条至少缺一
  stable ← 四条全过

反向控制：python 05-audit/maturity-gate.py --selftest
============================================================================
"""
import io
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
AI = os.path.join(ROOT, 'ai')
COMPONENTS = os.path.join(AI, 'components.json')
BEHAVIORS = os.path.join(AI, 'behaviors.json')
META = os.path.join(AI, 'components.meta.json')
GATE_DIR = os.path.join(ROOT, '05-audit')

# 🔴 探测逻辑的**单一来源**（见 ERRORS E28）
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location(
    '_gen_ai_contract', os.path.join(GATE_DIR, 'gen-ai-contract.py'))
_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
_dedicated_gates = _mod.dedicated_gates

LADDER = ('alpha', 'beta', 'stable')
RE_ISCLASS = re.compile(r'\.is-([a-z0-9-]+)')


# ---------------------------------------------------------------- 取事实

def behavior_debt(js_basename):
    """行为矩阵里该组件的 manual / gap 清单（按 **JS 文件名** 查）。

    ⚠️ 必须按文件名查，不能按组件 id：矩阵用的是文件名（flip.js ⇒ flip），
       组件 id 用的是目录名（list/）。用 id 查 ⇒ list / nav 这类将来出现
       gap 会被**静默漏掉**（等于判据没跑到被测代码）。
    """
    if not js_basename or not os.path.isfile(BEHAVIORS):
        return []
    matrix = json.loads(io.open(BEHAVIORS, encoding='utf-8').read()).get('matrix', {})
    out = []
    for beh in sorted(matrix):
        v = matrix[beh].get(js_basename)
        if v is None:
            continue
        st = v[0] if isinstance(v, list) else v
        if st in ('manual', 'gap'):
            out.append(beh + ':' + st)
    return sorted(out)


def js_basename_of(css_rel):
    """由 CSS 路径推出组件目录里的 JS 文件名（与生成器同一规则：取排序第一个）"""
    cdir = os.path.dirname(os.path.join(ROOT, css_rel))
    if not os.path.isdir(cdir):
        return None
    cands = sorted(f for f in os.listdir(cdir) if f.endswith('.js'))
    return cands[0][:-3] if cands else None


def recompute(c):
    """独立重算一个组件的档位。返回 (档位, 四条判据 dict, behaviorDebt)"""
    css_rel = c.get('files', {}).get('css')
    css_path = os.path.join(ROOT, css_rel) if css_rel else None
    cdir = os.path.dirname(css_path) if css_path else None

    has_demo = bool(cdir) and os.path.isfile(os.path.join(cdir, 'demo.html'))
    # 🔴 门禁探测复用 gen-ai-contract 的**同一份实现**，不各写一份。
    #    原来这里另写了一份「脚本文件名以组件名开头」的探测 ⇒ 两份逻辑漂移：
    #    实测认不出 `chart-check.js` 覆盖 `bar`，于是同一组件在契约里是 stable、
    #    在这里重算是 alpha ⇒ 两道门禁互相打架（ERRORS E28）。
    css_parts = css_rel.split('/') if css_rel else []
    layer_dir = css_parts[0] if css_parts else ''
    has_gate = bool(cdir) and bool(_dedicated_gates(c['id'], layer_dir))
    legacy = sorted(set(RE_ISCLASS.findall(
        io.open(css_path, encoding='utf-8', errors='ignore').read()))) if css_path else []
    i8_ok = not legacy
    debt = behavior_debt(js_basename_of(css_rel))

    if not (has_demo and has_gate):
        level = 'alpha'
    elif not i8_ok or debt:
        level = 'beta'
    else:
        level = 'stable'
    return level, {'hasDemo': has_demo, 'hasDedicatedGate': has_gate,
                   'statesOnDomAttributes': i8_ok, 'legacyClasses': legacy}, debt


# ---------------------------------------------------------------- 判据

def discriminates(comp):
    """全库 stable 时的**正向控制**：判据还分得清"有债"和"没债"吗？

    做法是只改一个变量——把某个真实组件的行为债临时置为一条合成债务，
    重算必须降成 beta；撤掉之后必须回到 stable。
    其它三条判据用的是真实组件的真实结果，不参与造假。

    ⚠️ 为什么不用"必须有 beta"来保证鉴别力：那是**拿数据凑判据**。
       47 个组件全部达标时，正确的结论就是"全 stable"，
       而正确的问题变成"这把尺子还准不准"——本条回答的是后者。
    """
    global behavior_debt
    if not comp:
        return False
    orig = behavior_debt
    try:
        behavior_debt = lambda b: ['synthetic:gap']
        with_debt, _, _ = recompute(comp[0])
    finally:
        behavior_debt = orig
    clean, _, _ = recompute(comp[0])
    return with_debt == 'beta' and clean == 'stable'


def check(comp, quiet=False):
    bad = []
    counts = {}
    for c in comp:
        want, facts, debt = recompute(c)
        counts[want] = counts.get(want, 0) + 1
        got = c.get('maturity')
        if got not in LADDER:                                        # ②
            bad.append('%s：档位「%s」不在 ladder %s 里' % (c['id'], got, '/'.join(LADDER)))
            continue
        if got != want:                                              # ①
            bad.append('%s：契约写 %s，按判据重算是 %s（%s）'
                       % (c['id'], got, want,
                          '、'.join(k for k, v in facts.items()
                                    if k != 'legacyClasses' and not v) or
                          '行为欠账 ' + ','.join(debt)))
        reasons = c.get('maturityReasons', {})
        if sorted(reasons.get('behaviorDebt', [])) != debt:          # ④
            bad.append('%s：behaviorDebt 与行为矩阵不一致（契约 %s / 实测 %s）'
                       % (c['id'], reasons.get('behaviorDebt'), debt))
        for k in ('hasDemo', 'hasDedicatedGate', 'statesOnDomAttributes'):  # ⑤
            if reasons.get(k) != facts[k]:
                bad.append('%s：maturityReasons.%s 写 %s，实测 %s（理由不能是编的）'
                           % (c['id'], k, reasons.get(k), facts[k]))
    # ③ ladder 必须有鉴别力
    if len(counts) < 2:
        only = list(counts)[0] if counts else '空'
        n = list(counts.values())[0] if counts else 0
        if only == 'stable' and discriminates(comp):
            # 全库达标 + 量具经得起正向控制 ⇒ 这是**有证据的全绿**，放行。
            # ⚠️ 这里不打印：check() 会被自检调用几十次，打印会淹掉结论。
            #    说明放在 main() 里那行，只在真正跑门禁时出现。
            pass
        else:
            bad.append('🔴 ladder 没有鉴别力：%d 个组件全落在 %s 这一档，且'
                       '「塞一条债务 ⇒ 降成 beta」的正向控制没通过 ⇒ 要么判据已经松到'
                       '没有信息量（补一条 / 加严），要么先修好量具'
                       '—— 不能就这么放着' % (n, only))
    return bad, counts


# ---------------------------------------------------------------- 反向控制

def selftest():
    raw = io.open(COMPONENTS, encoding='utf-8').read()
    comp = json.loads(raw)['components']
    bad = 0

    def expect_true(why, cond, extra=''):
        nonlocal bad
        print('  [%s] %s' % ('OK  ' if cond else 'FAIL', why))
        if not cond:
            bad += 1
            if extra:
                print('        ' + extra)

    def clone(fn):
        d = json.loads(raw)['components']
        fn(d)
        # 🔴 突变体必须**真的改到东西**（2026-10-30 加，第三次踩同一类坑）：
        #    这条自测原本写"把 accordion 手工改成 stable"，
        #    而 accordion 这轮**真的**升成 stable 了 ⇒ 突变等于原样
        #    ⇒ 自检报"判据没抓到"，其实判据没瞎。见 ERRORS E166。
        if json.dumps(d, sort_keys=True, ensure_ascii=False) == \
           json.dumps(json.loads(raw)['components'], sort_keys=True, ensure_ascii=False):
            return None
        return d

    def expect(why, errs, needle=None):
        nonlocal bad
        if errs is None:
            print('  [FAIL] 突变体与原样相同 ⇒ 这条反向控制已失效：%s' % why)
            bad += 1
            return
        hit = any(needle in e for e in errs) if needle else bool(errs)
        print('  [%s] %s' % ('OK  ' if hit else 'FAIL', why))
        if not hit:
            bad += 1

    def to_beta(cs):
        """把**任意一个 stable 的**组件谎报成 beta。

        ⚠️ 这条原来写的是"把某个非 stable 的谎报成 stable"。0.15.0 全库达标后
        **没有非 stable 的组件了** ⇒ 那个突变体没有对象（clone 会判"没改到"）。
        这类"写死方向"的突变体会被数据追上，所以改成反方向：stable 永远有。
        """
        t = [c for c in cs if c.get('maturity') == 'stable']
        if t:
            t[0]['maturity'] = 'beta'

    expect('把一个 stable 的组件谎报成 beta ⇒ 必须红',
           check(clone(to_beta))[0], '按判据重算是')
    expect('把一个 stable 手工降级成 alpha（button）⇒ 必须红',
           check(clone(lambda cs: [c for c in cs if c['id'] == 'button'][0]
                       .__setitem__('maturity', 'alpha')))[0], '按判据重算是')
    expect('档位写成 ladder 外的名字（gold）⇒ 必须红',
           check(clone(lambda cs: [c for c in cs if c['id'] == 'button'][0]
                       .__setitem__('maturity', 'gold')))[0], '不在 ladder')
    # 🔴 这条突变体原本用「dropdown 的 debt 少报一条（只留 typeahead:gap）」。
    #    0.8.6 收编后 dropdown 的 debt **正好只剩** typeahead:gap
    #    ⇒ 这个突变变成了"没突变" ⇒ 自测永远失败，而判据并没有变瞎。
    #    换成 combobox：它的 debt 里真有一条 dismissable:manual，手工清空才是真突变。
    #    （⚠️ 写这条时我一度在注释里说它有 focus-return 债 —— 核实矩阵后并没有，
    #      combobox 的 focus-return 是 n/a。断言本身有效，注释里的理由是错的。）
    #    教训同 E39：反向控制突变体必须与当前真实状态解耦。
    # ⚠️ 同样是"突变体被真改动追上"的坑（0.8.8）：原用 combobox 清空 debt，
    #   而 0.8.6 收编后 combobox 的 debt **正好就是空** ⇒ 不再是突变。
    #   ⇒ 改用 drawer：给它硬塞一条**它没有**的债（typeahead:gap）⇒ 必红。
    expect('behaviorDebt 与矩阵不一致（drawer 被塞了一条不存在的债）⇒ 必须红',
           check(clone(lambda cs: [c for c in cs if c['id'] == 'drawer'][0]
                       ['maturityReasons'].__setitem__('behaviorDebt',
                                                       ['typeahead:gap'])))[0],
           'behaviorDebt 与行为矩阵不一致')
    expect('maturityReasons 与重算不符（button 的 hasDemo 写成 false）⇒ 必须红',
           check(clone(lambda cs: [c for c in cs if c['id'] == 'button'][0]
                       ['maturityReasons'].__setitem__('hasDemo', False)))[0],
           'maturityReasons.hasDemo')

    # 🔴 本检查存在的理由：判据被改松 ⇒ 全库重算 stable ⇒ ladder 归零。
    #    0.15.0 起「全库 stable」不再是自动红：③ 会先做**正向控制**
    #    （塞一条合成债务 ⇒ 必须降 beta）。所以这里的突变体也要跟着换 ——
    #    不能只把数据洗白（那本来就是合法的全绿），要**把判据本身改松**：
    #    让 recompute 忽略债务、一律返回 stable。
    origin_recompute = globals()['recompute']

    def loosened(c):
        lvl, facts, debt = origin_recompute(c)
        return 'stable', facts, debt          # 债务不再影响档位

    globals()['recompute'] = loosened
    try:
        errs3 = check(comp)[0]                # 契约一个字没动，动的是判据
    finally:
        globals()['recompute'] = origin_recompute
    expect_true('判据被改松（债务不再降档）⇒ 正向控制抓得到 ⇒ ③ 必须红',
                any('ladder 没有鉴别力' in e for e in errs3),
                '实际报的是：%s' % (errs3[:3] or '空 —— 一条都没抓到'))
    expect_true('…且**只**红了 ③ 这一条（证明突变体真打到 ③，不是被 ①⑤ 顺带抓到）',
                len(errs3) == 1,
                '实际 %d 条：%s' % (len(errs3), errs3[:3]))

    errs, counts = check(comp)
    if errs:
        print('  [FAIL] 原样就有不通过的项 ⇒ 判据过严')
        for e in errs[:8]:
            print('        ' + e)
        bad += 1
    else:
        print('  [OK]   原样全绿（%s）'
              % ' · '.join('%s %d' % (k, counts[k]) for k in sorted(counts)))
    return 1 if bad else 0


def main():
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    comp = json.loads(io.open(COMPONENTS, encoding='utf-8').read())['components']
    errs, counts = check(comp)
    print('')
    print('  === 组件成熟度阶梯 ===')
    if errs:
        for e in errs:
            print('    X ' + e)
    else:
        print('    OK %d 个组件档位与独立重算一致（%s）'
              % (len(comp), ' · '.join('%s %d' % (k, counts[k]) for k in sorted(counts))))
        if len(counts) > 1:
            print('    OK ladder 有鉴别力（不止一个档位 ⇒ 它真的在区分组件）')
        else:
            print('    OK 全库 stable（%d 个）—— 已用合成债务验证判据仍能把有债的降到'
                  ' beta，阶梯退而不休' % len(comp))
    print('')
    if errs:
        print('  ❌ %d 项不满足' % len(errs))
        sys.exit(1)
    print('  ✅ 成熟度阶梯闭环')
    sys.exit(0)


if __name__ == '__main__':
    main()
