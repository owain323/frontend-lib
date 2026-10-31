#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
budget-selftest.py — 体积预算门禁**自己的**判据

===========================================================================
🔴 为什么需要
---------------------------------------------------------------------------
  0.22.2 把体积预算从「perf-gate.py 里的一个手写常量」换成了
  一本账（`05-audit/budget.json`）+ 五个分支（天花板 / 储备 / 棘轮 /
  单文件 / 单组件）。换模型的动机是：那个常量被手改过六次，
  每次都是被约束的人自己批准自己。

  ⭐ 但新模型引入了一个更隐蔽的风险：
     **判据本身是新的，而它平时的输出是「OK」。**
     五个分支里只有极少数会在真实仓库里被触发 ——
     也就是说，写错分支顺序、写反不等号、把 ceiling 判成 limit，
     日常跑一百次都看不出来。

  ⇒ 这份文件存在的唯一理由：用**合成账本**把五个分支逐一逼出来，
    并证明失败时说的是**那一句**（不是"反正红了"）。

===========================================================================
怎么做到「不碰真账本」
---------------------------------------------------------------------------
  perf-gate.py 支持 `FL_BUDGET=<path>` 指向另一本账。
  本脚本在临时目录里造账本，逐条跑真实的 `perf-gate.py`（子进程，
  走的是同一条 main()），因此验的是**端到端行为**，不是函数返回值。
  跑完核对真账本的 sha256 没变 —— 自检不许改仓库。

用法：python3 05-audit/budget-selftest.py
===========================================================================
"""
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GATE = os.path.join(ROOT, '05-audit', 'perf-gate.py')
REAL = os.path.join(ROOT, '05-audit', 'budget.json')

sys.path.insert(0, os.path.join(ROOT, '05-audit'))
import importlib.util                                    # noqa: E402
_spec = importlib.util.spec_from_file_location('perf_gate', GATE)
pg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pg)


def sha(path):
    with io.open(path, 'rb') as f:
        return hashlib.sha256(f.read().replace(b'\r\n', b'\n')).hexdigest()


TOTAL = sum(pg._size_all().values())


def ledger(**kw):
    """造一本账：默认取真实账本，按关键字覆盖。"""
    with io.open(REAL, encoding='utf-8') as f:
        b = json.load(f)
    for k, v in kw.items():
        if k == 'granted':
            b['granted']['effectiveBytes'] = v
        else:
            b[k] = v
    return b


def run(b, *args):
    """把账本写进临时文件，用 FL_BUDGET 跑真实的 perf-gate。"""
    fd, p = tempfile.mkstemp(suffix='.json', prefix='budget-')
    os.close(fd)
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(pg._dump_budget(b))
    env = dict(os.environ, FL_BUDGET=p)
    r = subprocess.run([sys.executable, GATE] + list(args), env=env,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out = r.stdout.decode('utf-8', 'replace')
    after = None
    try:
        with io.open(p, encoding='utf-8') as f:
            after = json.load(f)
    except Exception:
        pass
    os.unlink(p)
    return r.returncode, out, after


CASES = []


def case(label, want_rc, want_text, b, *args):
    CASES.append((label, want_rc, want_text, b, args))


BIG = TOTAL + 400 * 1024          # 远超天花板，用来单独测天花板

# ① 基线：真账本的数字原样跑 ⇒ 必须绿
case('基线：真账本原样 ⇒ 放行', 0, 'OK    合计',
     ledger())

# ② 天花板：调到总量以下 ⇒ 必须报「天花板」，且**不能**被「储备用尽」抢先
case('天花板：ceiling = 总量−1 KB ⇒ 报天花板', 1, '越过了天花板',
     ledger(ceilingEffectiveBytes=TOTAL - 1024, granted=TOTAL - 1024,
            reserveEffectiveBytes=81920))

# ③ 储备：授予=总量，储备=0 ⇒ 多出的部分就是超预算（这里用 ceiling 抬高排除干扰）
case('储备：授予=总量−1 且储备=0 ⇒ 报储备用尽', 1, '已用尽',
     ledger(granted=TOTAL - 1, reserveEffectiveBytes=0, ceilingEffectiveBytes=BIG))

# ④ 棘轮：授予比实测高 6 KB ⇒ 必须要求收线
case('棘轮：授予=总量+6 KB ⇒ 要求收线', 1, '棘轮：合计',
     ledger(granted=TOTAL + 6144, reserveEffectiveBytes=0, ceilingEffectiveBytes=BIG))

# ⑤ 棘轮死区：高 1 KB（< 2 KB 死区）⇒ 不吵
case('棘轮死区：授予=总量+1 KB ⇒ 放行', 0, 'OK    合计',
     ledger(granted=TOTAL + 1024, reserveEffectiveBytes=0, ceilingEffectiveBytes=BIG))

# ⑥ 单组件：上限压到 100 B ⇒ 必须点名「单组件上限」
case('单组件：上限 100 B ⇒ 报单组件', 1, '单组件上限',
     ledger(maxComponentEffectiveBytes=100, ceilingEffectiveBytes=BIG,
            granted=TOTAL, reserveEffectiveBytes=0))

# ⑦ 单文件：上限压到 100 B ⇒ 必须点名「单文件上限」
case('单文件：上限 100 B ⇒ 报单文件', 1, '单文件上限',
     ledger(maxOneFileEffectiveBytes=100, ceilingEffectiveBytes=BIG,
            granted=TOTAL, reserveEffectiveBytes=0))

# ⑧ 授予：没带理由 ⇒ 拒绝（退出码 2），且账本不动
case('授予：不带 --reason ⇒ 拒绝', 2, '必须带 --reason',
     ledger(granted=TOTAL - 4096, reserveEffectiveBytes=8192,
            ceilingEffectiveBytes=BIG), '--grant')

# ⑨ 授予：理由太短 ⇒ 同样拒绝
case('授予：理由 5 个字 ⇒ 拒绝', 2, '至少 12 个字',
     ledger(granted=TOTAL - 4096, reserveEffectiveBytes=8192,
            ceilingEffectiveBytes=BIG), '--grant', '--reason', '因为需要')


def main():
    bad = 0
    n = 0
    real_before = sha(REAL)
    print('  === 体积预算门禁自检（实测总量 %d B）===' % TOTAL)
    print('')

    for label, want_rc, want_text, b, args in CASES:
        rc, out, _ = run(b, *args)
        n += 1
        ok = (rc == want_rc) and (want_text in out)
        print('  %s %s' % ('OK ' if ok else '🔴', label))
        if not ok:
            bad += 1
            print('       want rc=%s 含「%s」；got rc=%s' % (want_rc, want_text, rc))
            for line in out.splitlines():
                if 'FAIL' in line or '🔴' in line or '✅' in line:
                    print('       | %s' % line.strip()[:100])

    # ⑩ 授予写盘：临时账本必须真的被改写（granted 跟上 + 留一条账）
    b = ledger(granted=TOTAL - 4096, reserveEffectiveBytes=8192,
               ceilingEffectiveBytes=BIG)
    b['grants'] = []
    rc, out, after = run(b, '--grant', '--reason',
                         '新组件 timeline 的生效 CSS，实测 681 B')
    n += 1
    ok = (rc == 0 and after and after['granted']['effectiveBytes'] == TOTAL
          and len(after.get('grants') or []) == 1)
    print('  %s 授予：带理由 ⇒ 账本改写（granted=%s，留账 %s 条）'
          % ('OK ' if ok else '🔴', (after or {}).get('granted', {}).get('effectiveBytes'),
             len((after or {}).get('grants') or [])))
    if not ok:
        bad += 1
        print('       rc=%s' % rc)
        print(out)

    # ⑪ 授予额度上限：已经记过 3 次 ⇒ 拒绝（否则储备就是摆设）
    b = ledger(granted=TOTAL - 4096, reserveEffectiveBytes=8192,
               ceilingEffectiveBytes=BIG)
    b['grants'] = [{'kind': 'grant', 'bytes': TOTAL - 4096, 'delta': 2048,
                    'reason': '历史授予', 'date': '2026-0%d-01' % (i + 1)}
                   for i in range(3)]
    rc, out, after = run(b, '--grant', '--reason', '第四次授予，理由够长但仍该被拒绝')
    n += 1
    ok = (rc == 1 and '已经授予过 3 次' in out
          and after and after['granted']['effectiveBytes'] == TOTAL - 4096)
    print('  %s 授予：已记 3 次 ⇒ 拒绝，且账本不动' % ('OK ' if ok else '🔴'))
    if not ok:
        bad += 1
        print('       rc=%s granted=%s' % (rc, (after or {}).get('granted', {}).get('effectiveBytes')))
        print(out)

    # ⑫ 棘轮写盘：授予高于实测 ⇒ --ratchet 收线
    b = ledger(granted=TOTAL + 6144, reserveEffectiveBytes=0, ceilingEffectiveBytes=BIG)
    rc, out, after = run(b, '--ratchet')
    n += 1
    ok = (rc == 0 and after and after['granted']['effectiveBytes'] == TOTAL)
    print('  %s 棘轮：收线后授予=%s' % ('OK ' if ok else '🔴',
                                    (after or {}).get('granted', {}).get('effectiveBytes')))
    if not ok:
        bad += 1

    # ⑬ 账本缺失 ⇒ 失败并说清怎么恢复（不回退默认值）
    env = dict(os.environ, FL_BUDGET=os.path.join(ROOT, '05-audit', 'nope.json'))
    r = subprocess.run([sys.executable, GATE], env=env,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out = r.stdout.decode('utf-8', 'replace')
    n += 1
    ok = r.returncode != 0 and '找不到 05-audit/budget.json' in out
    print('  %s 账本缺失 ⇒ 失败（不回退默认值）' % ('OK ' if ok else '🔴'))
    if not ok:
        bad += 1
        print(out)

    # ⑭ 自检不许改仓库
    n += 1
    ok = sha(REAL) == real_before
    print('  %s 真账本未被改动（sha 相同）' % ('OK ' if ok else '🔴'))
    if not ok:
        bad += 1

    print('')
    if bad:
        print('  🔴 %d / %d 未通过 —— 预算判据的实现路径有问题，不是数字有问题'
              % (bad, n))
        return 1
    print('  ✅ %d 条通过：五个分支各被逼出一次，失败文案与写盘路径都对' % n)
    return 0


if __name__ == '__main__':
    sys.exit(main())
