#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
deprecation-gate.py — 废弃治理门禁（M9）

============================================================================
🔴 为什么需要
----------------------------------------------------------------------------
  移除一个**公开名字**（令牌 / 类名）是对下游的破坏性变更。
  而在此前，这件事**不受任何门禁约束**：0.7.4 移除了 `--measure`，
  只在更新日志里记了一笔 ⇒ 没有一处机器可读的地方说清：

    · 它什么时候开始算废弃
    · 什么时候**允许**真的删
    · 删了之后该用什么替代

  ⇒ 下游只能靠读更新日志的人肉记忆来迁移。

  对标 Primer 的 Deprecated / Removed 两档：废弃要有告警、有替代方案、
  提前公告、并用 codemod 或 lint 阻断继续使用。我们没有 codemod，
  所以「迁移窗口」只能用**版本号的距离**表达 —— 就是 policy.minLead。

============================================================================
判据（九条）
----------------------------------------------------------------------------
  ① planned 条目字段齐备，`kind` ∈ token / class
  ② `deprecatedIn` 不得是未来版本（不许"预告"一个还没发的版本）
  ③ `removeIn` 必须比 `deprecatedIn` 晚**至少一个次版本**（迁移窗口）
  ④ 已到期（VERSION ≥ removeIn）⇒ 名字**必须已经**从公开面消失（兑现承诺）
  ⑤ 未到期 ⇒ 名字**必须还在**公开面（不许提前删）
  ⑥ `replacement` 若非空 ⇒ 它指向的东西必须真的存在
  ⑦ 基线里有、当前面里没有的名字 ⇒ **必须**有已到期的登记（不许无流程移除）
  ⑧ `retroactive` 条数 ≤ budget（棘轮：不许再出现没走流程的移除）
  ⑨ 已到期且已消失的登记名 ⇒ 必须在基线里（证明它**曾经存在**，不是打错字）

============================================================================
🔴 基线为什么是「只增不减」
----------------------------------------------------------------------------
  `ai/surface.baseline.json` 记录公开面**曾经出现过**的名字，`--update` 只做
  `baseline ∪= 当前面`，**从不删条目**。

  这样设计是为了堵死一条洗白路径：如果 `--update` 会顺手把消失的名字从基线里
  抹掉，那么"先删代码、再跑一次 --update"就能让 ⑦（未登记的移除）永远不红
  ⇒ 这道门禁等于没有。只增不减 ⇒ 历史抹不掉 ⇒ ⑦ 永远有牙。

  代价：基线会缓慢变长。这是**有意的** —— 它本来就是一份历史账。

============================================================================
⚠️ ④⑤ 的实例靠自检保证，不靠库里恰好有废弃项
----------------------------------------------------------------------------
  哪天 `planned` 空了，④⑤ 就没有实例可查 ⇒ 它们会变成"永远绿"的死判据。
  本文件不为此加一条"planned 不得为空"的假判据（那会逼着人伪造废弃项），
  而是让 `--selftest` 用**合成条目**把 ④⑤ 打到 —— 自检每次都跑（已接进
  behavior-reverse.sh）⇒ 判据掉牙它自己会叫。

用法
----------------------------------------------------------------------------
  python 05-audit/deprecation-gate.py              # 判据
  python 05-audit/deprecation-gate.py --update     # 重建基线（只增不减）
  python 05-audit/deprecation-gate.py --selftest   # 反向控制
============================================================================
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AI = os.path.join(ROOT, 'ai')
VERSION_FILE = os.path.join(ROOT, 'VERSION')
DEPR = os.path.join(AI, 'deprecations.json')
BASE = os.path.join(AI, 'surface.baseline.json')
TOKENS = os.path.join(AI, 'tokens.json')
COMPONENTS = os.path.join(AI, 'components.json')

REQUIRED_PLANNED = ('id', 'kind', 'name', 'deprecatedIn', 'removeIn', 'reason')
REQUIRED_RETRO = ('kind', 'name', 'removedIn')
KINDS = ('token', 'class')
RE_VER = re.compile(r'^(\d+)\.(\d+)\.(\d+)$')


# ---------------------------------------------------------------- 基础

def vkey(s):
    """'0.7.7' → (0, 7, 7)。版本比较必须按**数值**，不能按字符串
    （'0.10.0' < '0.9.0' 按字符串比是错的）。"""
    m = RE_VER.match((s or '').strip())
    if not m:
        raise ValueError('版本号必须是 主.次.修 三段数字：%r' % s)
    return tuple(int(x) for x in m.groups())


def load(p):
    return json.loads(io.open(p, encoding='utf-8').read())


def current_surface():
    """现在的公开面。

    ⚠️ 只含**有名字、能被下游引用**的两类：令牌名与类名（根类/变体/槽位）。
       状态取值（data-state 的枚举值）不算 —— 变化时没有名字可引用，
       且另有 states 类门禁看住。
    """
    tokens = set()
    for s in load(TOKENS).get('sets', {}).values():
        tokens |= set(s)
    cls = set()
    for c in load(COMPONENTS)['components']:
        if c.get('rootClass'):
            cls.add(c['rootClass'])
        for v in (c.get('variants') or []):
            cls.add(v)
        for s in (c.get('slots') or []):
            cls.add(s)
    return {'token': sorted(tokens), 'class': sorted(cls)}


def bucket_of(cur, kind):
    return set(cur.get(kind, []))


# ---------------------------------------------------------------- 判据

def check(depr, base, cur, version):
    bad = []
    V = vkey(version)
    cur_by = {k: bucket_of(cur, k) for k in KINDS}
    cur_all = cur_by['token'] | cur_by['class']
    base_all = set(base.get('token', [])) | set(base.get('class', []))

    planned = depr.get('planned', [])
    retro = depr.get('retroactive', [])

    def v_of(entry, key):
        """取版本号；写坏了就地报错并返回 None（不让整个门禁崩掉）"""
        try:
            return vkey(entry.get(key))
        except ValueError as ex:
            bad.append('%s：%s' % (entry.get('name', '(无名条目)'), ex))
            return None

    # ---- ①② 字段与版本合法性 ----
    for e in planned:
        name = e.get('name', '(无名条目)')
        for k in REQUIRED_PLANNED:                                    # ①
            if k not in e:
                bad.append('%s：planned 条目缺字段 %s' % (name, k))
        if e.get('kind') not in KINDS:
            bad.append('%s：kind 必须是 %s，实际 %r'
                       % (name, ' / '.join(KINDS), e.get('kind')))
    for e in retro:
        name = e.get('name', '(无名条目)')
        for k in REQUIRED_RETRO:                                      # ①
            if k not in e:
                bad.append('%s：retroactive 条目缺字段 %s' % (name, k))
        if e.get('kind') not in KINDS:
            bad.append('%s：kind 必须是 %s，实际 %r'
                       % (name, ' / '.join(KINDS), e.get('kind')))

    # 已到期的名字：允许从公开面消失
    due = set()
    for e in planned:
        r = v_of(e, 'removeIn')
        d = v_of(e, 'deprecatedIn')
        if d is not None and d > V:                                   # ②
            bad.append('%s：deprecatedIn=%s 晚于当前版本 %s ⇒ 不许预告未来'
                       % (e['name'], e['deprecatedIn'], version))
        if d is not None and r is not None:
            if (r[0], r[1]) <= (d[0], d[1]):                          # ③
                bad.append('%s：removeIn=%s 与 deprecatedIn=%s 没跨一个次版本'
                           ' ⇒ 下游没有迁移窗口' % (e['name'], e['removeIn'],
                                                    e['deprecatedIn']))
        if r is not None and r <= V:
            due.add(e['name'])
    for e in retro:
        due.add(e.get('name'))

    # ---- ④⑤ 存在性（双向）----
    for e in planned:
        name = e.get('name')
        r = v_of(e, 'removeIn')
        if r is None or e.get('kind') not in KINDS:
            continue
        present = name in cur_by[e['kind']]
        if r <= V and present:                                        # ④
            bad.append('%s：removeIn=%s 已到期（当前 %s），它还**在**公开面里'
                       ' ⇒ 承诺了却没删' % (name, e['removeIn'], version))
        if r > V and not present:                                     # ⑤
            bad.append('%s：removeIn=%s 还没到期，它却**已经不在**公开面里'
                       ' ⇒ 提前删了' % (name, e['removeIn']))
        if r <= V and not present and name not in base_all:           # ⑨
            bad.append('%s：已到期且已消失，但基线里**从来没有**它'
                       ' ⇒ 多半是登记时名字打错了' % name)

    # ---- ⑥ 替代方案必须真的存在 ----
    for e in list(planned) + list(retro):
        rep = e.get('replacement')
        if not rep:
            continue
        for r in (rep if isinstance(rep, list) else [rep]):
            if r not in cur_all:
                bad.append('%s：replacement 指向 %s，但公开面里没有它'
                           % (e.get('name'), r))

    # ---- ⑦ 未登记的移除 ----
    for n in sorted(base_all - cur_all):
        if n not in due:
            bad.append('%s：基线里有、现在没了，而登记册里**没有**允许移除它的条目'
                       ' ⇒ 这是一次没走流程的移除' % n)

    # ---- ⑧ 历史欠账棘轮 ----
    budget = depr.get('budget', {}).get('retroactive')
    if budget is None:
        bad.append('budget.retroactive 缺失 ⇒ 棘轮没有牙齿')
    elif len(retro) > budget:
        bad.append('retroactive 有 %d 条，预算只允许 %d 条 ⇒ 又出现了一次没走流程'
                   '的移除（要放行就得改预算，并把理由写进 $comment）'
                   % (len(retro), budget))

    stats = {'planned': len(planned), 'retroactive': len(retro),
             'due': len(due), 'baseline': len(base_all),
             'surface': len(cur_all)}
    return bad, stats


# ---------------------------------------------------------------- 基线维护

def do_update():
    """重建基线 —— **只增不减**（理由见文件头）。"""
    cur = current_surface()
    base = load(BASE) if os.path.isfile(BASE) else {'token': [], 'class': []}
    added = 0
    for k in KINDS:
        merged = set(base.get(k, [])) | set(cur.get(k, []))
        added += len(merged) - len(set(base.get(k, [])))
        base[k] = sorted(merged)
    base['schemaVersion'] = '1.0.0'
    base['$comment'] = [
        '公开面基线：库里**曾经出现过**的公开名字（令牌名 / 类名）。',
        '🔴 只增不减 —— 由 05-audit/deprecation-gate.py --update 维护。',
        '   删条目会让"未登记的移除"永远查不出来（那正是这道门禁要抓的东西）。',
    ]
    with io.open(BASE, 'w', encoding='utf-8', newline='') as fh:
        fh.write(json.dumps(base, ensure_ascii=False, indent=2) + '\n')
    print('  ✓ 基线已更新（只增不减）：新增 %d 个，合计 %d 个'
          % (added, len(set(base['token']) | set(base['class']))))
    return 0


# ---------------------------------------------------------------- 反向控制

def selftest():
    depr_raw = io.open(DEPR, encoding='utf-8').read()
    V = io.open(VERSION_FILE, encoding='utf-8').read().strip()
    base = load(BASE)
    cur = current_surface()
    bad = 0

    def clone(fn):
        d = json.loads(depr_raw)
        fn(d)
        return d

    def clone_cur(fn):
        c = {'token': list(cur['token']), 'class': list(cur['class'])}
        fn(c)
        return c

    def clone_base(fn):
        b = {'token': list(base['token']), 'class': list(base['class'])}
        fn(b)
        return b

    def expect(why, errs, needle):
        nonlocal bad
        hit = any(needle in e for e in errs)
        print('  [%s] %s' % ('OK  ' if hit else 'FAIL', why))
        if not hit:
            bad += 1
            print('        实际报的是：%s' % (errs[:2] or '空 —— 一条都没抓到'))
        return hit

    def only(why, errs, needle):
        """隔离断言：必须**只**红了这一条 ⇒ 证明突变体真打到被测判据"""
        nonlocal bad
        ok = len(errs) == 1 and needle in errs[0]
        print('  [%s] %s' % ('OK  ' if ok else 'FAIL', why))
        if not ok:
            bad += 1
            print('        实际 %d 条：%s' % (len(errs), errs[:3]))

    def run(d, b=None, c=None):
        return check(d, b or base, c or cur, V)[0]

    # ② 预告未来
    expect('deprecatedIn 写成未来版本 ⇒ 必须红',
           run(clone(lambda d: d['planned'][0].update(
               deprecatedIn='9.9.9', removeIn='9.10.0'))),
           '不许预告未来')
    # ③ 没跨次版本
    only('removeIn 与 deprecatedIn 同一个次版本 ⇒ 没给迁移窗口 ⇒ 必须红',
         run(clone(lambda d: d['planned'][0].update(removeIn='0.7.8'))),
         '没跨一个次版本')
    # ④ 到期不删
    # ⚠️ 合成条目自己也得守 ③（跨次版本），否则 ③ 会连带红 ⇒ 隔离断言过不了
    only('已到期却还留在公开面里 ⇒ 承诺了没删 ⇒ 必须红',
         run(clone(lambda d: d['planned'][0].update(
             deprecatedIn='0.6.0', removeIn='0.7.0'))),
         '承诺了却没删')
    # ⑤ 提前删（连基线一起改 ⇒ 排除 ⑦ ⑨，孤立出 ⑤）
    name = json.loads(depr_raw)['planned'][0]['name']
    kind = json.loads(depr_raw)['planned'][0]['kind']
    only('还没到期却已从公开面消失（提前删）⇒ 必须红',
         run(json.loads(depr_raw),
             clone_base(lambda b: b[kind].remove(name)),
             clone_cur(lambda c: c[kind].remove(name))),
         '提前删了')
    # ⑥ replacement 指向不存在的东西
    expect('replacement 指向公开面里没有的名字 ⇒ 必须红',
           run(clone(lambda d: d['retroactive'][0].update(
               replacement=['--measure-page', '--no-such-token']))),
           'replacement 指向')
    # ⑦ 未登记的移除
    only('基线里有、现在没了，而登记册里没有条目 ⇒ 无流程移除 ⇒ 必须红',
         run(json.loads(depr_raw), base,
             clone_cur(lambda c: c['token'].remove('--paper'))),
         '没走流程的移除')
    # ⑧ 历史欠账棘轮
    only('retroactive 再加一条（超出预算）⇒ 棘轮必须红',
         run(clone(lambda d: d['retroactive'].append(
             {'kind': 'token', 'name': '--gone', 'removedIn': '0.7.7'}))),
         '又出现了一次没走流程')
    # ⑨ 登记了一个从没存在过的名字
    only('已到期且已消失，但基线里从来没有它（名字打错）⇒ 必须红',
         run(clone(lambda d: d['planned'].append(
             {'id': 'typo', 'kind': 'token', 'name': '--typo-token',
              'deprecatedIn': '0.6.0', 'removeIn': '0.7.0',
              'reason': '合成样本'}))),
         '从来没有')
    # ① 缺字段
    expect('planned 条目缺字段 ⇒ 必须红',
           run(clone(lambda d: d['planned'][0].pop('reason'))),
           '缺字段')

    errs = check(json.loads(depr_raw), base, cur, V)[0]
    if errs:
        print('  [FAIL] 原样就有不通过的项 ⇒ 判据过严')
        for e in errs[:8]:
            print('        ' + e)
        bad += 1
    else:
        print('  [OK]   原样全绿（planned %d · retroactive %d）'
              % (len(json.loads(depr_raw)['planned']),
                 len(json.loads(depr_raw)['retroactive'])))
    return 1 if bad else 0


# ---------------------------------------------------------------- 主

def main():
    if '--update' in sys.argv:
        sys.exit(do_update())
    if '--selftest' in sys.argv:
        sys.exit(selftest())

    print('')
    print('  === 废弃治理 ===')
    if not os.path.isfile(BASE):
        print('    X 缺基线 ai/surface.baseline.json')
        print('      ⇒ 没有基线就比不出"谁消失了" ⇒ 先跑 --update')
        print('      ⚠️ 这里是**红**不是跳过：跳过等于让 ⑦ 永远假绿。')
        sys.exit(1)

    V = io.open(VERSION_FILE, encoding='utf-8').read().strip()
    depr = load(DEPR)
    base = load(BASE)
    cur = current_surface()
    errs, st = check(depr, base, cur, V)

    if errs:
        for e in errs:
            print('    X ' + e)
    else:
        print('    OK 登记册自洽（planned %d · retroactive %d · 已到期可移除 %d）'
              % (st['planned'], st['retroactive'], st['due']))
        print('    OK 公开面 %d 个名字，基线 %d 个 ⇒ 无未登记的移除'
              % (st['surface'], st['baseline']))
    print('')
    if errs:
        print('  ❌ %d 项不满足' % len(errs))
        sys.exit(1)
    print('  ✅ 废弃治理闭环')
    sys.exit(0)


if __name__ == '__main__':
    main()
