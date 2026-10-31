#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
perf-gate.py — 性能预算门禁（ H8）

===========================================================================
🔴 为什么需要它
---------------------------------------------------------------------------
  性能是唯一"**只会变差、不会自己变好**"的维度：
  改一行 CSS 让某个属性多写一遍、体积悄悄涨 2KB —— 没有任何功能门禁会拦。

  ⛔ 实测过的静默劣化路径：
     · 复制粘贴把 `transition` 写进几十个选择器
     · 反复调试留下的 `outline: 0` / `will-change: transform`
     · 大段内联 `<style>`（demo 页面积累出来的）
     · 引入图表库（echarts）却不 lazy-load

===========================================================================
预算（按"移动端 WebView + 4G"这一真实场景定，不是拍脑袋）
---------------------------------------------------------------------------
  ① 单个 CSS 文件 ≤ 24 KB
     理由：4G 下 24KB ≈ 200ms 首屏样式阻塞，超过就该拆。
  ② 单个**组件**文件 ≤ 10 KB（tokens 不在内）
     理由：一个组件占总量的 1/14 以上时，它已经不是「一个组件」了。
  ③ 全部 CSS 合计 ≤ 工作上限（= 授予额度 + 储备，天花板 172 KB）
     🔴 这一条 2026-10-31 换过模型，是本文件最大的一次改动：
       旧形状是**一个手写常量**，被改过六次（120→124→125→132→139→142→143），
       每次都在注释里自证一次「这次是真实增长」。问题不是数字大小，
       而是被约束的人握着那个数字 ⇒ 下一次必然重演，
       而且上限抬到「随手加什么都装得下」的那天，这道预算就废了。
       新形状（数据在 `05-audit/budget.json`，规则在 `docs/BUDGET.md`）：
         · 天花板 172 KB —— 冻结，改它要走 ADR；
         · 储备 10 KB —— 常规新增组件**不用动任何数字**；
         · 向下棘轮 —— 体积降了必须把线收回来（否则储备凭空变大）；
         · 显式授予 ≤ 3 次 —— 吃光储备要留一条带理由的账。
  ④ 组件 demo 页面的内联 `<style>` ≤ 8 KB
     理由：demo 是给人看的，但内联样式会绕过 tokens 门禁 ⇒ 要卡住。
  ⑤ **禁止**遗留调试属性
     `will-change: transform`（未配动画时）· `outline: 0`（无替代焦点环时）
  ⑥ 动画必须尊重 `prefers-reduced-motion`
     （本库已有 `05-audit/motion.py` 查这个，这里只做交叉提醒）

用法
---------------------------------------------------------------------------
  python3 05-audit/perf-gate.py                       # 默认：判定
  python3 05-audit/perf-gate.py --ratchet             # 体积降了 ⇒ 把线收回来
  python3 05-audit/perf-gate.py --grant --reason "…"  # 吃光储备 ⇒ 留账（≤3 次）
"""
import sys
import os
import io
import glob
import re
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 体积按**内容**记账（行尾归一），与 size-baseline / dist 共用同一个入口。
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bytes                                          # noqa: E402

KB = 1024.0

# 🔴 预算**不在这里** —— 在 `05-audit/budget.json`（唯一数据源，理由见 docs/BUDGET.md）。
#
#    这个常量以前是手写的，被改过六次：
#        120 → 124 → 125 → 132 → 139 → 142 → 143 KB
#    每一次都在注释里写一段「这次为什么合理」。问题从来不是数字大小，
#    而是**被约束的人手里握着那个数字** —— 于是每次加组件都是一次自证，
#    而下一次必然重演。上限抬到「随手加什么都装得下」的那天，这道预算就废了。
#
#    现在的形状：天花板冻结（172 KB）+ 储备（10 KB，常规增长免费）
#    + 向下棘轮（体积降了必须把线收回来）。常规新增组件**不用动任何数字**。
BUDGET_PATH = (os.environ.get('FL_BUDGET') or
               os.path.join(ROOT, '05-audit', 'budget.json'))
# ⚠️ FL_BUDGET 只给 `budget-selftest.py` 用（拿临时账本验判据本身）。
#    它每次运行都会把「用的是哪本账」打在标题里 ——
#    否则一次 export 就能让门禁去读一本没人维护的账，而且看不出来。

# ⚠️ 这两个名字保留给别的脚本 import（历史原因）。真实值由 budget() 在运行期给。
MAX_ONE_CSS = None
MAX_INLINE_STYLE = None


def budget():
    """读预算账本。读不到就**直接失败**，绝不回退到默认值。

    🔴 回退等于「账本丢了、门禁照跑」：那是最坏的一种假绿 ——
       报告写「全部在预算内」，而实际用的是一份没人维护的旧常量。
    """
    if not os.path.isfile(BUDGET_PATH):
        raise SystemExit(
            '  🔴 找不到 05-audit/budget.json —— 体积预算的唯一数据源。\n'
            '     不回退默认值：账本缺失时的「通过」毫无意义。\n'
            '     恢复它：git checkout 05-audit/budget.json')
    with io.open(BUDGET_PATH, encoding='utf-8') as f:
        b = json.load(f)
    need = ('ceilingEffectiveBytes', 'reserveEffectiveBytes', 'ratchetSlackBytes',
            'maxOneFileEffectiveBytes', 'maxComponentEffectiveBytes',
            'maxInlineStyleBytes', 'granted', 'grants')
    miss = [k for k in need if k not in b]
    if miss:
        raise SystemExit('  🔴 budget.json 缺字段：%s' % ', '.join(miss))
    if 'effectiveBytes' not in (b.get('granted') or {}):
        raise SystemExit('  🔴 budget.json 的 granted 里没有 effectiveBytes')
    return b


def _limit(b):
    """工作上限 = min(天花板, 授予 + 储备)。"""
    return min(b['ceilingEffectiveBytes'],
               b['granted']['effectiveBytes'] + b['reserveEffectiveBytes'])


def verdict(total, b):
    """体积判定的**唯一**分支点。→ 'ok' | 'ceiling' | 'limit' | 'ratchet'

    🔴 为什么抽成纯函数：五层判据的分支顺序本身就是语义 ——
       越过天花板时必须报「只能删」，不能被「储备用尽」抢先；
       降得太多时必须报棘轮，不能被「在预算内」吞掉。
       这些顺序用真实仓库跑不出来（总量是固定的），只能喂合成数字。
    """
    ceiling = b['ceilingEffectiveBytes']
    granted = b['granted']['effectiveBytes']
    reserve = b['reserveEffectiveBytes']
    slack = b['ratchetSlackBytes']
    if total > ceiling:
        return 'ceiling'
    if total > _limit(b):
        return 'limit'
    if total < granted - slack:
        return 'ratchet'
    return 'ok'


SELFTEST = [
    # (总量, 授予, 储备, 天花板, 死区) → 期望判定 · 这条在证明什么
    (146111, 146111, 10240, 176128, 2048, 'ok', '基线状态'),
    (156351, 146111, 10240, 176128, 2048, 'ok', '储备刚好用满 = 仍然放行（≤ 不是 <）'),
    (156352, 146111, 10240, 176128, 2048, 'limit', '多用 1 B 就该红'),
    (176129, 176000, 10240, 176128, 2048, 'ceiling', '越过天花板：不能被 limit 抢先'),
    (176128, 176000, 10240, 176128, 2048, 'ok',
     '正好在天花板上 ⇒ 放行；此时储备已被天花板截断（main 会打警告）'),
    (144062, 146111, 10240, 176128, 2048, 'ratchet', '降 2049 必须收线'),
    (144063, 146111, 10240, 176128, 2048, 'ok', '刚好降 2048 = 死区以内，不吵'),
    (156352, 156352, 10240, 176128, 2048, 'ok', '授予已跟上：limit = 授予 + 储备'),
]


def _selftest():
    """喂合成数字验五个分支。不碰仓库任何文件。"""
    bad = 0
    for total, granted, reserve, ceiling, slack, want, why in SELFTEST:
        b = {
            'ceilingEffectiveBytes': ceiling,
            'reserveEffectiveBytes': reserve,
            'ratchetSlackBytes': slack,
            'granted': {'effectiveBytes': granted},
        }
        got = verdict(total, b)
        ok = got == want
        print('  %s %-6s 总量 %6d 授予 %6d → %-8s %s'
              % ('OK ' if ok else '🔴', want, total, granted, got, why))
        if not ok:
            bad += 1

    # 🔴 接线：verdict 是纯函数，光靠上面那张表证明不了 main() 真的调它。
    #    查字节码引用的名字 —— 有人把比较内联回 main 时，这条会红。
    names = main.__code__.co_names
    wired = 'verdict' in names
    print('  %s 接线：main() 引用了 verdict（%s）'
          % ('OK ' if wired else '🔴', '是' if wired else '否 —— 判定被内联了'))
    if not wired:
        bad += 1

    print('')
    print('  ' + ('🔴 %d 条自检未通过' % bad if bad
                  else '自检全部通过 ⇒ 五个分支与接线都在位'))
    return 1 if bad else 0


def css_files():
    out = []
    for pat in ('01-tokens/*.css', '02-primitives/*/*.css',
                '03-patterns/*/*.css', '04-recipes/*/*.css',
                '09-assets/*/*.css'):
        out += glob.glob(os.path.join(ROOT, pat))
    return sorted(out)


def strip_comments(s):
    return re.sub(r'/\*.*?\*/', '', s, flags=re.S)


def _fmt(n):
    return '%.1f KB' % (n / KB)


def _size_all():
    """→ {相对路径: 生效字节}。剥注释 → 行尾归一 → UTF-8 量。"""
    sizes = {}
    for f in css_files():
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        s = strip_comments(_bytes.read_norm(f).decode('utf-8'))
        sizes[rel] = len(s.encode('utf-8'))
    return sizes


# 一个「中等组件」的生效 CSS（实测中位数：delta 1.5 / metric 1.5 /
# app-shell 2.4 / shell-nav 0.9 / upload 4.2）—— 只用来把剩余字节翻译成
# 「还能装几个组件」，不参与判定。
TYPICAL_COMPONENT = 2458


def main():
    bad = 0

    B = budget()
    ceiling = B['ceilingEffectiveBytes']
    reserve = B['reserveEffectiveBytes']
    slack = B['ratchetSlackBytes']
    granted = B['granted']['effectiveBytes']
    limit = _limit(B)
    MAX_ONE = B['maxOneFileEffectiveBytes']
    MAX_COMP = B['maxComponentEffectiveBytes']
    MAX_INLINE = B['maxInlineStyleBytes']

    # ---------- 体积 ----------
    # ⚠️ relpath 在 Windows 上跨盘符会抛 ValueError（E: 仓库 / C: 临时目录）——
    #    自检用的临时账本正好在这个位置，所以这里必须兜住。
    try:
        ledger = os.path.relpath(BUDGET_PATH, ROOT).replace('\\', '/')
    except ValueError:
        ledger = BUDGET_PATH
    if os.environ.get('FL_BUDGET'):
        # 读的不是仓库里那本 ⇒ 必须显眼。否则一次 export 就能让门禁
        # 去读一本没人维护的账，而报告看起来一样干净。
        ledger = '⚠️ 非仓库账本 ' + BUDGET_PATH
    print('  === CSS 体积预算（账本 %s）===' % ledger)
    if not css_files():
        print('  [FAIL] 一个 CSS 都没找到')
        return 1
    # 🔴 算的是「剥掉注释后」的体积：本库注释极长（刻意投入），
    #    但**浏览器不解析注释** ⇒ 用磁盘体积判会严重高估
    #    （实测 tokens.css 原始 34.5 KB，剥注释后 14.5 KB）。
    sizes = _size_all()
    total = sum(sizes.values())

    # L1 单文件 / L2 单组件 —— 管形状，不管总量
    for rel, n in sorted(sizes.items(), key=lambda x: -x[1]):
        if n > MAX_ONE:
            bad += 1
            print('  FAIL  %-46s %s（单文件上限 %s）' % (rel, _fmt(n), _fmt(MAX_ONE)))
        elif not rel.startswith('01-tokens/') and n > MAX_COMP:
            bad += 1
            print('  FAIL  %-46s %s（单组件上限 %s ⇒ 该拆了，不是该调预算）'
                  % (rel, _fmt(n), _fmt(MAX_COMP)))

    big_rel, big_n = max(sizes.items(), key=lambda x: x[1])
    print('  单文件 %d 个，最大 %s %s' % (len(sizes), big_rel.split('/')[-1], _fmt(big_n)))
    print('  生效合计 %s ｜ 工作上限 %s（授予 %s + 储备 %s）｜ 天花板 %s' %
          (_fmt(total), _fmt(limit), _fmt(granted), _fmt(reserve), _fmt(ceiling)))

    # 判定只走 verdict() 一处 —— 分支顺序（天花板 > 储备 > 棘轮）写在那里，
    # 由 --selftest 用合成数字守。这里只负责把结果翻译成人话。
    v = verdict(total, B)
    if v == 'ceiling':
        bad += 1
        print('  FAIL  合计 %s 越过了天花板 %s' % (_fmt(total), _fmt(ceiling)))
        print('        天花板是**产品承诺**，不靠改数字解决：删到 %s 以下再来。'
              % _fmt(ceiling))
        print('        真要抬：写 docs/BUDGET.md 的 ADR 一节（含实测来源与新的传输成本），'
              '连同 budget.json 一起提交。')
    elif v == 'limit':
        bad += 1
        print('  FAIL  合计 %s > 工作上限 %s（授予 %s + 储备 %s 已用尽）'
              % (_fmt(total), _fmt(limit), _fmt(granted), _fmt(reserve)))
        print('        两条路，都不能只改数字：')
        print('          a) 删等量代码 —— 45 个文件里找重复声明 / 未引用规则；')
        print('          b) 显式授予：')
        print('             python3 05-audit/perf-gate.py --grant --reason "为什么这 %s 是必要的"'
              % _fmt(total - granted))
        print('        授予会记账（含理由），且最多 3 次 —— 之后只能删。')
    elif v == 'ratchet':
        bad += 1
        print('  FAIL  棘轮：合计 %s 比授予额度 %s 低了 %s（死区 %s）'
              % (_fmt(total), _fmt(granted), _fmt(granted - total), _fmt(slack)))
        print('        体积降了却没收线 ⇒ 储备会凭空变大，预算悄悄放松。')
        print('        收线（安全，无需理由）：')
        print('          python3 05-audit/perf-gate.py --ratchet')
    else:
        left = ceiling - total
        used = total - granted
        print('  OK    合计 %s / %s ｜ 天花板还剩 %s ≈ %d 个中等组件'
              % (_fmt(total), _fmt(limit), _fmt(left),
                 int(left // TYPICAL_COMPONENT)))
        print('        本轮已用储备 %s / %s；棘轮死区 %s'
              % (_fmt(max(0, used)), _fmt(reserve), _fmt(slack)))
        if granted + reserve > ceiling:
            # 账本里授予额度太大 ⇒ 储备其实是空的（被天花板截断）。
            # 不判红（总量确实没超），但必须说出来，否则"还有 10 KB 储备"是假的。
            print('        ⚠️ 授予 %s + 储备 %s > 天花板 ⇒ 储备只剩 %s（被天花板截断）'
                  % (_fmt(granted), _fmt(reserve), _fmt(max(0, ceiling - granted))))

    # ---------- demo 内联样式 ----------
    print('')
    print('  === demo 内联 <style> 预算（单个）===')
    worst_inline = 0
    worst_name = ''
    for f in sorted(glob.glob(os.path.join(ROOT, '0*', '*', 'demo.html'))):
        html = io.open(f, encoding='utf-8').read()
        for m in re.finditer(r'<style[^>]*>(.*?)</style>', html, flags=re.S):
            n = len(m.group(1).encode('utf-8'))
            if n > worst_inline:
                worst_inline, worst_name = n, os.path.basename(os.path.dirname(f))
            if n > MAX_INLINE:
                bad += 1
                print('  FAIL  %-42s %6.1f KB（上限 %.0f KB）' %
                      (os.path.basename(f), n / KB, MAX_INLINE / KB))
    print('  OK    最大 %s %s（上限 %s）' % (worst_name or '—', _fmt(worst_inline),
                                            _fmt(MAX_INLINE)))

    # ---------- ④ 遗留调试属性 ----------
    print('')
    print('  === 遗留调试属性 ===')
    deb = []
    for f in css_files():
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        s = strip_comments(io.open(f, encoding='utf-8').read())
        # will-change 用在非动画元素上（动画类才有意义）
        for m in re.finditer(r'([^{}]*)\{([^{}]*will-change[^{}]*)\}', s, flags=re.S):
            sel = m.group(1).strip().split('\n')[-1].strip()[:30]
            body = m.group(2)
            # 允许 @keyframes / 动画类
            if 'animation' in body or 'transition' in body or '@' in sel:
                continue
            deb.append('%s %s' % (rel, sel))
    if deb:
        bad += 1
        for d in deb[:6]:
            print('  FAIL  will-change 用在无动画的元素上：%s' % d)
    else:
        print('  OK    无遗留 will-change')

    # ---------- 汇总 ----------
    print('')
    if bad:
        print('  ⇒ %d 项超出预算' % bad)
        print('    性能是唯一"只会变差、不会自己变好"的维度 ⇒ 必须有门禁')
    else:
        print('  ✅ 全部在预算内')
    return 1 if bad else 0


def _dump_budget(b):
    """把账本写回去，并**保持它原来的排版**。

    json.dumps 会把整份账本压成一坨 —— 而这份文件是给人读的
    （它是「为什么是这些数」的唯一条目）。所以顶层每个键单独一段。
    """
    parts = []
    for k, v in b.items():
        body = json.dumps(v, ensure_ascii=False, indent=2)
        parts.append('  %s: %s' % (json.dumps(k, ensure_ascii=False),
                                   body.replace('\n', '\n  ')))
    return '{\n' + ',\n\n'.join(parts) + '\n}\n'


def _record(kind, reason=None):
    """改写授予额度并留账。kind = 'ratchet' | 'grant'。

    🔴 只做一件小事：把 granted.effectiveBytes 设成**当前实测**。
       它不碰天花板，也不碰储备 —— 天花板是产品承诺，储备是政策，
       这两样都不该被一条命令改掉。
    """
    import datetime
    B = budget()
    total = sum(_size_all().values())
    granted = B['granted']['effectiveBytes']
    reserve = B['reserveEffectiveBytes']
    ceiling = B['ceilingEffectiveBytes']
    slack = B['ratchetSlackBytes']
    grants = B.setdefault('grants', [])

    if kind == 'ratchet':
        if total >= granted - slack:
            print('  · 没什么可收的：合计 %s，授予 %s（死区 %s）'
                  % (_fmt(total), _fmt(granted), _fmt(slack)))
            return 0
        if total > granted:
            print('  🔴 合计 %s 比授予还大 —— 这不是棘轮的场景，先解决超预算'
                  % _fmt(total))
            return 1
        note = '棘轮：体积从 %s 降到 %s，把线收回来' % (_fmt(granted), _fmt(total))
    else:
        if not reason or len(reason.strip()) < 12:
            print('  🔴 --grant 必须带 --reason "…"（至少 12 个字）')
            print('     这条账要能回答「这 X KB 换来的是什么」——')
            print('     没有理由的授予，等于把天花板当摆设。')
            return 2
        if len(grants) >= 3:
            print('  🔴 已经授予过 %d 次。' % len(grants))
            print('     储备 × 3 ≈ 天花板余量 —— 三次之后，唯一的路是删代码。')
            for g in grants:
                print('       · %s  %s  %s' % (g.get('at'), _fmt(g.get('bytes', 0)),
                                              g.get('reason', '')[:40]))
            return 1
        if total > ceiling:
            print('  🔴 合计 %s 已越过天花板 %s —— 授予不解决这件事' % (_fmt(total), _fmt(ceiling)))
            return 1
        if total + reserve > ceiling:
            print('  🔴 授予后「授予 %s + 储备 %s」= %s 会超出天花板 %s'
                  % (_fmt(total), _fmt(reserve), _fmt(total + reserve), _fmt(ceiling)))
            print('     放不下储备的授予只是把红线画在红线上 —— 该删了。')
            return 1
        note = reason.strip()

    B['granted'] = {
        'effectiveBytes': total,
        'files': len(_size_all()),
        'at': B.get('granted', {}).get('at'),
        'note': note,
    }
    grants.append({
        'kind': kind,
        'bytes': total,
        'delta': total - granted,
        'reason': note,
        'date': datetime.date.today().isoformat(),
    })
    io.open(BUDGET_PATH, 'w', encoding='utf-8', newline='').write(_dump_budget(B))

    print('  ✅ 已记账：授予 %s → %s（%s）' % (_fmt(granted), _fmt(total),
                                            ('%+.1f KB' % ((total - granted) / KB))))
    print('     新的工作上限：%s ｜ 天花板 %s ｜ 已授予 %d 次'
          % (_fmt(_limit(B)), _fmt(ceiling), len(grants)))
    print('     ⚠️ budget.json 已改写 —— 它是**要提交的账本**，不是本地缓存。')
    return 0


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(_selftest())
    if '--ratchet' in sys.argv:
        sys.exit(_record('ratchet'))
    if '--grant' in sys.argv:
        rsn = None
        if '--reason' in sys.argv:
            i = sys.argv.index('--reason')
            rsn = sys.argv[i + 1] if i + 1 < len(sys.argv) else None
        sys.exit(_record('grant', rsn))
    sys.exit(main())
