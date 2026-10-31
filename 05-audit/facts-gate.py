#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
facts-gate.py — 事实链门禁（G0-1）

============================================================================
它守的是什么
----------------------------------------------------------------------------
一份事实，四个环节：

    源文件  →  提取(_facts.collect)  →  facts.json  →  对外声明(llms/README/HTML)

任何一环断了，读者看到的数就是错的。这个门禁把四个环节**分别**验一遍：

  ① 源文件结构对不对（缺字段 / 字段类型错 / id 重复 / 非法枚举 / 版本不一致）
  ② 从源文件现算一遍，与 facts.json 比          ← 抓"生成物没刷新"
  ③ 从对外文件里把数字抠出来，与现算值比        ← 抓"文档写错了"
  ④ 对外文件里有没有**没登记**的数字声明        ← 抓"新写了一句没人管"
  ⑤ README 的组件清单：分节标题数 / 表格行数 / 表格里的 id / 契约，四者一致

🔴 为什么不合并成一条
   合并就会退化成 `docs-site-gate` 判据 ① 那种写法：拿生成器的输出校验生成器。
   实测过：`gen-llms.py` 里写死 `# 39 components`，文件也是 39，逐字节相等 ⇒ 绿。
   **自证式判据只能证明"两边一起错"。**

============================================================================
用法
----------------------------------------------------------------------------
    python 05-audit/facts-gate.py            # 校验，失败非 0
    python 05-audit/facts-gate.py --write    # 重算并写 05-audit/facts.json
    python 05-audit/facts-gate.py --selftest # 合成样本，证明判据有牙

`facts.json` 放在 `05-audit/`（不进 npm 包）：它是**内部一致性凭据**，
不是对外契约。对外契约仍是 `ai/components.json`；多发布一份统计文件
会多一个要维护的公开面，本次不做。
"""
from __future__ import annotations

import io
import json
import os

import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import _facts  # noqa: E402

FACTS_REL = '05-audit/facts.json'


def _dump(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + '\n'


def _load_facts(root):
    p = os.path.join(root, FACTS_REL)
    if not os.path.isfile(p):
        return None
    with io.open(p, encoding='utf-8') as f:
        return json.loads(f.read())


def compare_facts(fresh, stored):
    """逐项比，报出**哪个事实**、存了什么、现在是什么。"""
    if stored is None:
        return ['%s 不存在 —— 跑 python 05-audit/facts-gate.py --write' % FACTS_REL]
    errs = []

    def walk(path, a, b):
        if isinstance(a, dict) and isinstance(b, dict):
            for k in sorted(set(a) | set(b)):
                if k in ('generatedBy', 'schemaVersion'):
                    continue
                if k not in a:
                    errs.append('%s 里多出 %s（源文件已经没有这项）' % (path, k))
                elif k not in b:
                    errs.append('%s 缺 %s（源文件有这项）' % (path, k))
                else:
                    walk('%s.%s' % (path, k) if path else k, a[k], b[k])
        elif a != b:
            errs.append('%s：facts.json 存 %r，现算 %r' % (path, b, a))

    walk('', fresh, stored)
    return errs


def run(root):
    src = _facts.validate_sources(root)
    for where, msg in src:
        print('  [FAIL] %s：%s' % (where, msg))
    if src:
        print('')
        print('  ⇒ 源文件结构有问题，先修源文件（提取与比对全都不可信）。')
        return 1

    facts = _facts.collect(root)
    stored = None
    try:
        stored = _load_facts(root)
    except Exception as e:                                  # noqa: BLE001
        print('  [FAIL] %s 解析失败：%s' % (FACTS_REL, e))
        return 1

    stale = compare_facts(facts, stored)
    for m in stale:
        print('  [FAIL] %s' % m)
    if stale:
        print('')
        print('  ⇒ facts.json 与源文件不一致（或没刷新）：'
              '跑 python 05-audit/facts-gate.py --write')

    claims = _facts.check_claims(root, facts)
    for where, msg in claims:
        print('  [FAIL] %s：%s' % (where, msg))

    listings = _facts.check_listings(root, facts)
    for where, msg in listings:
        print('  [FAIL] %s：%s' % (where, msg))

    ok = not stale and not claims and not listings
    print('')
    print('  事实：组件 %d（原语 %d / 模式 %d / 版式 %d / 资产 %d）· '
          '翻车点 %d + %d = %d · CLI %d 个子命令 · 版本 %s'
          % (facts['components']['total'],
             facts['components']['byTier']['primitive'],
             facts['components']['byTier']['pattern'],
             facts['components']['byTier']['recipe'],
             facts['components']['byTier']['asset'],
             facts['pitfalls']['total'], facts['pitfallsWriting']['total'],
             facts['pitfallsAll'], facts['cli']['subcommands'], facts['version']))
    print('  声明清单：%d 条位置 · 已登记文件 %d 个 · 清单核对 %d 个文件 × %d 层'
          % (len(_facts.CLAIMS), len({c[1] for c in _facts.CLAIMS}),
             len(_facts.LISTING_FILES), len(_facts.TIER_HEADINGS)))
    if ok:
        print('  OK    源文件 / facts.json / 对外声明 三者一致')
        return 0
    print('  FAIL  %d 处' % (len(stale) + len(claims) + len(listings)))
    return 1


def write(root):
    src = _facts.validate_sources(root)
    if src:
        for where, msg in src:
            print('  [FAIL] %s：%s' % (where, msg))
        print('  ⇒ 源文件结构有问题，不生成 facts.json')
        return 1
    facts = _facts.collect(root)
    p = os.path.join(root, FACTS_REL)
    old = None
    if os.path.isfile(p):
        with io.open(p, encoding='utf-8') as f:
            old = f.read()
    new = _dump(facts)
    if old == new:
        print('  OK    %s 无变化（%d 字节）' % (FACTS_REL, len(new.encode('utf-8'))))
        return 0
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(new)
    print('  已写入 %s（%d 字节）' % (FACTS_REL, len(new.encode('utf-8'))))
    return 0


# ---------------------------------------------------------------- 自检
def _listing(comps):
    """按层生成 README 的清单段：标题数字与表格行数**同源**，不会一半新一半旧。"""
    out = []
    for tier, name in (('primitive', 'primitives'), ('pattern', 'patterns'),
                       ('recipe', 'recipes'), ('asset', 'assets')):
        group = [c for c in comps if c['tier'] == tier]
        out.append('### %s (%d)' % (name, len(group)))
        out.append('')
        out.append('| Component | Root class | Purpose |')
        out.append('|---|---|---|')
        for c in group:
            out.append('| `%s` | `%s` | %s |' % (c['id'], c['rootClass'], c['purpose']))
        out.append('')
    return '\n'.join(out)


def _mk_root(tmp, n=3):
    """合成一个最小仓库：结构合法、数字自洽、README 清单与契约一致。"""
    os.makedirs(os.path.join(tmp, 'ai'))

    def w(rel, text):
        p = os.path.join(tmp, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)

    w('VERSION', '1.2.3\n')
    w('package.json', _dump({
        'name': 'demo', 'version': '1.2.3', 'bin': {'agentcss': './ai/cli.js'},
        'files': ['ai/'], 'dependencies': {},
        'devDependencies': {'x': '^1', 'y': '^2'},
    }))
    w('ai/cli.js', 'module.exports={CMDS:{check:1,validate:1,tokens:1}};\n')
    comps = [{'id': 'c%d' % i, 'tier': _facts.ALLOWED_TIERS[i % 4],
              'purpose': 'p', 'rootClass': 'r', 'maturity': 'stable',
              'files': {'css': 'x.css'}} for i in range(n)]
    comps[0]['global'] = 'C0'
    w('ai/components.json', _dump({'schemaVersion': 1, 'components': comps}))
    w('ai/pitfalls.json', _dump({'pitfalls': [
        {'id': 'p1', 'title': 't', 'scope': 'component', 'components': ['c0'],
         'symptom': 's', 'fix': 'f'},
        {'id': 'p2', 'title': 't', 'scope': 'layout', 'components': [],
         'symptom': 's', 'fix': 'f'},
    ]}))
    w('ai/pitfalls-writing.json', _dump({'pitfalls': [
        {'id': 'w1', 'title': 't', 'scope': 'writing', 'components': [],
         'symptom': 's', 'fix': 'f'},
    ]}))
    stable = sum(1 for c in comps if c['maturity'] == 'stable')
    beta = sum(1 for c in comps if c['maturity'] == 'beta')
    # 声明文件：句式与 CLAIMS 对齐（含 Markdown 加粗 —— 真实仓库就是这么写的）
    w('llms.txt', '> demo: %d components, machine readable.\n'
                  'npx agentcss ai components --json   # all %d components\n' % (n, n))
    w('llms-full.txt', 'x  # %d components, joined with pitfalls\n## 2 · Components (%d)\n'
                       '## 3 · Known failure modes (%d)\n' % (n, n, 3))
    w('AGENTS.md', '- **Contract:** `ai/components.json` — %d components.\n' % n)
    w('index.html', '<p>%d 个组件</p>\n' % n)
    w('404.html', '<p>—— %d 个组件</p>\n' % n)
    w('guide/index.html', '<p>%d 个组件</p>\n' % n)
    w('README.md', '# demo\n\n**%d** components (stable %d / beta %d).\n\n%s\n'
      % (n, stable, beta, _listing(comps)))
    w('README.zh-CN.md', '# demo\n\n一页看全 %d 个组件\n\n'
                         '共 **%d** 个（stable %d · 全部通过四条判据）。\n\n%s\n'
      % (n, n, stable, _listing(comps)))
    return tmp


def _fresh(tmp):
    return _facts.collect(tmp)


def selftest():
    cases, fails = [], []

    def check(name, ok, detail=''):
        cases.append((name, ok, detail))
        if not ok:
            fails.append(name)

    # S1 结构合法 ⇒ validate 无错，数字正确
    with tempfile.TemporaryDirectory() as tmp:
        _mk_root(tmp)
        e = _facts.validate_sources(tmp)
        check('S1 合法源文件：validate 无错', not e, '; '.join('%s:%s' % x for x in e[:2]))
        f = _fresh(tmp)
        check('S1 提取：3 组件 / 3 翻车点 / 3 子命令',
              f['components']['total'] == 3 and f['pitfallsAll'] == 3
              and f['cli']['subcommands'] == 3 and f['dependencies']['runtime'] == 0,
              json.dumps(f['components'], ensure_ascii=False))

    # S2 重复 id ⇒ 必须报
    with tempfile.TemporaryDirectory() as tmp:
        _mk_root(tmp)
        p = os.path.join(tmp, 'ai/components.json')
        d = json.loads(io.open(p, encoding='utf-8').read())
        d['components'][1]['id'] = d['components'][0]['id']
        io.open(p, 'w', encoding='utf-8', newline='\n').write(_dump(d))
        e = _facts.validate_sources(tmp)
        check('S2 重复组件 id 被抓', any('id 重复' in m for _, m in e),
              '; '.join(m for _, m in e[:2]))

    # S3 缺 rootClass ⇒ 必须报
    with tempfile.TemporaryDirectory() as tmp:
        _mk_root(tmp)
        p = os.path.join(tmp, 'ai/components.json')
        d = json.loads(io.open(p, encoding='utf-8').read())
        del d['components'][0]['rootClass']
        io.open(p, 'w', encoding='utf-8', newline='\n').write(_dump(d))
        e = _facts.validate_sources(tmp)
        check('S3 缺必需字段被抓', any('缺字段 rootClass' in m for _, m in e),
              '; '.join(m for _, m in e[:2]))

    # S4 文档数字写错 ⇒ check_claims 必须报（且指出行号与两个值）
    with tempfile.TemporaryDirectory() as tmp:
        _mk_root(tmp)
        p = os.path.join(tmp, 'llms.txt')
        io.open(p, 'w', encoding='utf-8', newline='\n').write('> demo: 39 components.\n')
        e = _facts.check_claims(tmp, _fresh(tmp))
        hit = [m for _, m in e if '写着 39' in m and '3' in m]
        check('S4 声明写错被抓（39 vs 3）', bool(hit), '; '.join(m for _, m in e[:2]))

    # S5 未登记的数字声明 ⇒ 必须报
    #     注意不能拿"已登记句式写错数"来测这一条 —— 那会走 ③ 的报错路径，
    #     看起来也是红的，但证明的是另一件事。这里用 AGENTS.md 里一个
    #     **没被任何 CLAIM 覆盖**的中文句式。
    with tempfile.TemporaryDirectory() as tmp:
        _mk_root(tmp)
        p = os.path.join(tmp, 'AGENTS.md')
        s = io.open(p, encoding='utf-8').read()
        io.open(p, 'w', encoding='utf-8', newline='\n').write(s + '\n顺带一提，这里有 7 个组件。\n')
        e = _facts.check_claims(tmp, _fresh(tmp))
        check('S5 未登记声明被抓', any('未登记' in m for _, m in e),
              '; '.join(m for _, m in e[:2]))

    # S6 facts.json 过期 ⇒ compare 必须报
    with tempfile.TemporaryDirectory() as tmp:
        _mk_root(tmp)
        f = _fresh(tmp)
        stale = json.loads(json.dumps(f))
        stale['components']['total'] = 39
        e = compare_facts(f, stale)
        check('S6 facts.json 过期被抓', any('components.total' in m for m in e),
              '; '.join(e[:2]))

    # S7 运行时不依赖出现 ⇒ 必须报（硬约束不能被顺手破掉）
    with tempfile.TemporaryDirectory() as tmp:
        _mk_root(tmp)
        p = os.path.join(tmp, 'package.json')
        d = json.loads(io.open(p, encoding='utf-8').read())
        d['dependencies'] = {'left-pad': '^1'}
        io.open(p, 'w', encoding='utf-8', newline='\n').write(_dump(d))
        e = _facts.validate_sources(tmp)
        check('S7 运行时依赖被抓', any('运行时依赖' in m for _, m in e),
              '; '.join(m for _, m in e[:2]))

    # S8 Markdown 加粗 + 中文量词里的错数 ⇒ 必须报（老正则整条漏掉的那种）
    with tempfile.TemporaryDirectory() as tmp:
        _mk_root(tmp)
        p = os.path.join(tmp, 'README.zh-CN.md')
        s = io.open(p, encoding='utf-8').read()
        s = s.replace('共 **3** 个（stable 3', '共 **37** 个（stable 37')
        io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
        e = _facts.check_claims(tmp, _fresh(tmp))
        hit = [m for _, m in e if '写着 37' in m and 'components.total' in m]
        check('S8 `共 **37** 个` 被抓（加粗 + 中文量词）', bool(hit),
              '; '.join(m for _, m in e[:2]))

    # S9 同一文件里既有正确的 3 又有错误的 7 ⇒ 错的必须被报（正确数不能掩盖）
    with tempfile.TemporaryDirectory() as tmp:
        _mk_root(tmp)
        p = os.path.join(tmp, 'README.zh-CN.md')
        s = io.open(p, encoding='utf-8').read()
        s += '\n另外，本库一共 7 个组件。\n'
        io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
        e = _facts.check_claims(tmp, _fresh(tmp))
        check('S9 正确的 3 不掩盖错误的 7',
              any('写着 7' in m for _, m in e),
              '; '.join(m for _, m in e[:2]))

    # S10 标题数字对了、表格少一行 ⇒ check_listings 必须报
    with tempfile.TemporaryDirectory() as tmp:
        _mk_root(tmp)
        p = os.path.join(tmp, 'README.md')
        s = io.open(p, encoding='utf-8').read()
        s = s.replace('| `c0` | `r` | p |\n', '')
        io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
        e = _facts.check_listings(tmp, _fresh(tmp))
        check('S10 清单少一行被抓', any('只列了 0 个组件' in m for _, m in e),
              '; '.join(m for _, m in e[:2]))

    # S11 标题数字写错 ⇒ check_listings 必须报
    with tempfile.TemporaryDirectory() as tmp:
        _mk_root(tmp)
        p = os.path.join(tmp, 'README.md')
        s = io.open(p, encoding='utf-8').read()
        s = s.replace('### primitives (1)', '### primitives (2)')
        io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
        e = _facts.check_listings(tmp, _fresh(tmp))
        check('S11 分节标题数写错被抓', any('分节标题写着 2' in m for _, m in e),
              '; '.join(m for _, m in e[:2]))

    # S20 行数不变、但把一个组件换成不存在的 ⇒ 行数判据看不见，id 比对必须抓住
    with tempfile.TemporaryDirectory() as tmp:
        _mk_root(tmp)
        p = os.path.join(tmp, 'README.md')
        s = io.open(p, encoding='utf-8').read()
        s = s.replace('| `c0` | `r` | p |', '| `ghost` | `r` | p |')
        io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
        e = _facts.check_listings(tmp, _fresh(tmp))
        check('S20 清单里塞不存在的组件被抓（行数不变）',
              any('清单与契约不符' in m and 'ghost' in m for _, m in e),
              '; '.join(m for _, m in e[:2]))

    # S21 `共 37 个。`（不接括号）也要抓 —— 中文里省略名词是常见写法
    with tempfile.TemporaryDirectory() as tmp:
        _mk_root(tmp)
        p = os.path.join(tmp, 'README.zh-CN.md')
        s = io.open(p, encoding='utf-8').read()
        s += '\n共 37 个。\n'
        io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
        e = _facts.check_claims(tmp, _fresh(tmp))
        check('S21 `共 37 个。`（无括号）被抓', any('写着 37' in m for _, m in e),
              '; '.join(m for _, m in e[:2]))

    # S22 反向：`共 3 个步骤` 省略的是"步骤"，不许当成组件数（不能误报）
    with tempfile.TemporaryDirectory() as tmp:
        _mk_root(tmp)
        p = os.path.join(tmp, 'README.zh-CN.md')
        s = io.open(p, encoding='utf-8').read()
        s += '\n装好一共需要 3 个步骤。\n'
        io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
        e = _facts.check_claims(tmp, _fresh(tmp))
        check('S22 `共 3 个步骤` 不误报', not [m for _, m in e if '写着 3' in m],
              '; '.join(m for _, m in e[:2]))

    # ---- P1：pitfalls 字段类型（每条都要求"报清楚且不抛异常"）
    def _pit(name, mutate, want, label):
        with tempfile.TemporaryDirectory() as tmp:
            _mk_root(tmp)
            p = os.path.join(tmp, 'ai/pitfalls.json')
            d = json.loads(io.open(p, encoding='utf-8').read())
            mutate(d)
            io.open(p, 'w', encoding='utf-8', newline='\n').write(_dump(d))
            try:
                e = _facts.validate_sources(tmp)
            except Exception as exc:                        # noqa: BLE001
                check(label, False, '校验器自己抛了 %s: %s' % (type(exc).__name__, exc))
                return
            check(label, any(want in m for _, m in e), '; '.join(m for _, m in e[:2]))

    _pit('id', lambda d: d['pitfalls'][0].__setitem__('id', 7),
         'id 必须是非空字符串', 'S12 pitfall id 是数字被抓（且不崩）')
    _pit('title', lambda d: d['pitfalls'][0].__setitem__('title', None),
         'title 必须是非空字符串', 'S13 title 是 null 被抓')
    _pit('comps-str', lambda d: d['pitfalls'][0].__setitem__('components', 'c0'),
         'components 必须是数组', 'S14 components 是字符串被抓')
    _pit('comps-num', lambda d: d['pitfalls'][0].__setitem__('components', 3),
         'components 必须是数组', 'S15 components 是数字被抓')
    _pit('comps-bad', lambda d: d['pitfalls'][0]['components'].append('ghost'),
         '引用了不存在的组件', 'S16 components 有幽灵 id 被抓')
    _pit('comps-item', lambda d: d['pitfalls'][0].__setitem__('components', ['']),
         'components[0] 必须是非空字符串', 'S17 components 里空串被抓')

    # S18 顶层不是对象 ⇒ 报清楚、不抛
    with tempfile.TemporaryDirectory() as tmp:
        _mk_root(tmp)
        p = os.path.join(tmp, 'ai/pitfalls.json')
        io.open(p, 'w', encoding='utf-8', newline='\n').write('[1, 2, 3]\n')
        try:
            e = _facts.validate_sources(tmp)
            check('S18 pitfalls 顶层是数组被抓（且不崩）',
                  any('顶层不是对象' in m for _, m in e),
                  '; '.join(m for _, m in e[:2]))
        except Exception as exc:                            # noqa: BLE001
            check('S18 pitfalls 顶层是数组被抓（且不崩）', False,
                  '校验器自己抛了 %s: %s' % (type(exc).__name__, exc))

    # S19 合法数据恢复后：validate / claims / listings 三处全绿
    with tempfile.TemporaryDirectory() as tmp:
        _mk_root(tmp)
        f = _fresh(tmp)
        e = (_facts.validate_sources(tmp) + _facts.check_claims(tmp, f)
             + _facts.check_listings(tmp, f))
        check('S19 合法仓库：三道判据全绿', not e,
              '; '.join('%s:%s' % x for x in e[:2]))

    for name, ok, detail in cases:
        print('  %s %s%s' % ('[OK]  ' if ok else '[FAIL]', name,
                             '' if ok else '  ← ' + detail))
    print('')
    if fails:
        print('  %d / %d 条自检未通过' % (len(fails), len(cases)))
        return 1
    print('  %d / %d 条自检通过（每条都证明了判据在该红时会红）' % (len(cases), len(cases)))
    return 0


def main(argv):
    if '--selftest' in argv:
        return selftest()
    if '--write' in argv:
        return write(ROOT)
    print('=== 事实链（源文件 → 提取 → facts.json → 对外声明）===')
    rc = run(ROOT)
    return rc


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
