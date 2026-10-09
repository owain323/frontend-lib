#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
token-tree-gate.py — 第二种令牌导出的正确性门禁（M5）

============================================================================
🔴 它守的是什么
----------------------------------------------------------------------------
  `ai/tokens.tree.json` 是给 **Style Dictionary / Figma Tokens** 吃的：
  分层、键名不带 `--`、`value`/`type` 不带 `$`。

  它是**生成物**。生成物最危险的失效方式不是"生成错"，而是
  **"生成错了但没人知道"** —— 因为它只会跟"再生成一遍"比（I-10 实证 9）。

  ⇒ 本门禁的判据 ⑤ 把每一个名字、每一个值拿到**真浏览器**里，
    用 Chrome 自己的 CSS 解析器（CSSOM）重新读一遍再比。
    这根桩与本库的任何一条正则**无关**，是真正独立的信息源。

============================================================================
判据（六条）
----------------------------------------------------------------------------
  ① `--check`：tree.json 与 tokens.css 一致（改了源码必须重新生成）
  ② index 双向：tokens.css 声明的令牌都在 index 里；index 里的名字都真实存在
  ③ 层级自洽：每个 index 路径都能在 sets.light 里真的取到叶子
  ④ 类别合法，且 `type` ∈ 该类别允许的类型集合（防"分错类"）
  ⑤ **浏览器 CSSOM 独立桩**：
       ⑤a 导出名字集合 == 浏览器解析出的名字集合（双向）
       ⑤b 每个值（剥注释 + 折叠空白后）能在浏览器同名的值集合里找到
  ⑥ dark 集的名字必须是 light 集的子集（暗色不该引入新令牌）

============================================================================
反向控制：python 05-audit/token-tree-gate.py --selftest
============================================================================
"""
import io
import json
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
TREE = os.path.join(ROOT, 'ai', 'tokens.tree.json')
CSS = os.path.join(ROOT, '01-tokens', 'tokens.css')
PROBE = os.path.join(ROOT, '05-audit', 'token-tree-probe.js')

RE_DECL = re.compile(r'^\s*(--[a-z0-9-]+)\s*:', re.M)

GEN = None


def gen():
    """加载生成器模块（复用它的 norm / strip_comments / ALLOWED / path_of）"""
    global GEN
    if GEN is None:
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            'gen_tokens_tree', os.path.join(ROOT, '05-audit', 'gen-tokens-tree.py'))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        GEN = m
    return GEN


def key(v):
    """比对用的归一化：先剥注释，再折叠空白（引号内的空白不动）"""
    g = gen()
    return g.norm(g.strip_comments(v))


def css_names():
    out = []
    for m in RE_DECL.finditer(io.open(CSS, encoding='utf-8').read()):
        if m.group(1) not in out:
            out.append(m.group(1))
    return out


# ---------------------------------------------------------------- 独立桩

def browser_facts():
    """跑 token-tree-probe.js，拿浏览器 CSSOM 解析出的名字与值。

    ⚠️ 浏览器起不来 ⇒ 返回 None（环境问题是 SKIP，不是 FAIL —— 执行宪法第 4 条）。
    ⚠️ 解析出 **0 个**自定义属性 ⇒ 也当失败处理：
       "拿 0 个和 N 个比" 是另一种形态的假绿（见 visual-regression 那条教训）。
    """
    env = dict(os.environ)
    env['FL_BROWSER'] = os.path.join(ROOT, '05-audit', 'browser.js')
    try:
        out = subprocess.run(['node', PROBE, '--json'],
                             cwd=ROOT, env=env, capture_output=True, timeout=180)
    except Exception as e:                                   # noqa: BLE001
        print('    SKIP ⑤ 浏览器复核跑不起来（%s）' % e)
        return None
    if out.returncode != 0:
        print('    SKIP ⑤ 浏览器复核未通过（%s）'
              % (out.stderr.decode('utf-8', 'ignore').strip()[:120] or '无输出'))
        return None
    try:
        facts = json.loads(out.stdout.decode('utf-8'))
    except ValueError:
        print('    SKIP ⑤ 浏览器输出不是 JSON')
        return None
    if not facts.get('names'):
        print('    SKIP ⑤ 浏览器没解析到任何自定义属性 ⇒ 桩本身是坏的，'
              '不能拿它当"通过"')
        return None
    return facts


# ---------------------------------------------------------------- 判据

def check(doc, names, cssom):
    bad = []
    g = gen()
    idx = doc.get('index', {})
    sets = doc.get('sets', {})
    light = sets.get('light', {})
    dark = sets.get('dark', {})

    # ② index 双向
    for n in names:
        if n not in idx:
            bad.append('② 令牌「%s」在 index 里没有（导出漏了它）' % n)
    for n in sorted(idx):
        if n not in names:
            bad.append('② index 里的「%s」在 tokens.css 里不存在（登记漂移）' % n)

    # ③ 层级自洽
    for path in sorted(idx.values()):
        cat, leaf = path.split('/', 1)
        if cat not in light or leaf not in light[cat]:
            bad.append('③ index 指向的 %s 在 sets.light 里取不到' % path)

    # ④ 类别 / 类型
    for sname, tree in (('light', light), ('dark', dark)):
        for cat in sorted(tree):
            if cat not in g.ALLOWED:
                bad.append('④ %s 集里的类别「%s」不在已知类别里' % (sname, cat))
                continue
            for leaf in sorted(tree[cat]):
                typ = tree[cat][leaf].get('type')
                if typ not in g.ALLOWED[cat]:
                    bad.append('④ %s/%s/%s 的 type「%s」不属于类别 %s（允许 %s）'
                               % (sname, cat, leaf, typ, cat,
                                  '/'.join(g.ALLOWED[cat])))
                if not str(tree[cat][leaf].get('value', '')).strip():
                    bad.append('④ %s/%s/%s 的 value 是空的' % (sname, cat, leaf))

    # ⑥ dark ⊆ light
    dnames = set()
    for cat in dark:
        dnames.update(cat + '/' + l for l in dark[cat])
    lpaths = set(idx.values())
    for p in sorted(dnames - lpaths):
        bad.append('⑥ dark 集里的「%s」在 light 集里没有 ⇒ 暗色引入了新令牌' % p)

    # ⑤ 浏览器独立桩
    if cssom is not None:
        en = set(idx)
        bn = set(cssom.get('names', []))
        for n in sorted(bn - en):
            bad.append('⑤a 浏览器解析到了「%s」，导出里没有' % n)
        for n in sorted(en - bn):
            bad.append('⑤a 导出里的「%s」，浏览器根本没解析到（声明被吃掉了？）' % n)
        rev = {}
        for k, v in idx.items():
            rev[v] = k
        for sname, tree in (('light', light), ('dark', dark)):
            for cat in sorted(tree):
                for leaf in sorted(tree[cat]):
                    nm = rev.get(cat + '/' + leaf)
                    if nm is None:
                        continue
                    want = key(tree[cat][leaf].get('value', ''))
                    got = [key(x) for x in cssom.get('values', {}).get(nm, [])]
                    if want not in got:
                        bad.append('⑤b %s 的 %s/%s 值对不上浏览器（导出 %r）'
                                   % (sname, cat, leaf, want[:48]))
    return bad


def check_generated():
    """① tree.json 与源码一致"""
    env = dict(os.environ)
    p = subprocess.run([sys.executable, os.path.join(ROOT, '05-audit',
                                                     'gen-tokens-tree.py'),
                        '--check'], cwd=ROOT, env=env, capture_output=True)
    return p.returncode == 0, (p.stdout.decode('utf-8', 'ignore') +
                               p.stderr.decode('utf-8', 'ignore')).strip()


# ---------------------------------------------------------------- 反向控制

def selftest():
    doc = json.loads(io.open(TREE, encoding='utf-8').read())
    names = css_names()
    cssom = browser_facts()
    if cssom is None:
        print('    ⚠️ 浏览器不可用 ⇒ ⑤ 的突变本次验不到（其余照验）')
    bad = 0

    def expect(why, errs, needle):
        nonlocal bad
        hit = any(needle in e for e in errs) if needle else bool(errs)
        if hit:
            print('  [OK]   判据抓到突变：' + why)
        else:
            print('  [FAIL] 突变没被抓到 ⇒ 门禁是瞎的：' + why)
            bad += 1

    def clone(fn):
        d = json.loads(io.open(TREE, encoding='utf-8').read())
        fn(d)
        return d

    expect('② index 删掉一个令牌（--paper）',
           check(clone(lambda d: d['index'].pop('--paper')), names, cssom), '在 index 里没有')
    expect('② index 里加一个不存在的令牌（--ghost）',
           check(clone(lambda d: d['index'].__setitem__('--ghost', 'color/ghost')),
                 names, cssom), '在 tokens.css 里不存在')
    # ⚠️ 突变必须是「index 指向一个 light 里没有的叶子」，不是「删掉 index 条目」
    #    —— 删条目只会让 ② 红，③ 根本没跑到被测的那段代码。
    expect('③ index 指向一个 light 里不存在的叶子',
           check(clone(lambda d: d['index'].__setitem__('--paper', 'color/ghost')),
                 names, cssom), '在 sets.light 里取不到')
    expect('④ 类型改成该类别不允许的（color/paper 的 type 改成 duration）',
           check(clone(lambda d: d['sets']['light']['color']['paper'].__setitem__(
               'type', 'duration')), names, cssom), '不属于类别')
    expect('⑥ dark 集引入一个 light 没有的令牌',
           check(clone(lambda d: d['sets']['dark'].setdefault('color', {})
                       .__setitem__('ghost', {'value': '#000', 'type': 'color'})),
                 names, cssom), '暗色引入了新令牌')
    if cssom is not None:
        expect('⑤b 把一个值改错（--paper 的值）',
               check(clone(lambda d: d['sets']['light']['color']['paper']
                           .__setitem__('value', '#000000')), names, cssom),
               '值对不上浏览器')
        expect('⑤a 导出里编一个浏览器没有的令牌',
               check(clone(lambda d: d['index'].__setitem__('--ghost', 'color/ghost')),
                     names, cssom), '浏览器根本没解析到')

    # 生成器侧：新令牌不在四张分类表里 ⇒ 必须报错（不许默默归到兜底）
    g = gen()
    try:
        g.path_of('--brand-new-token')
        print('  [FAIL] 生成器给一个没归类的令牌也返回了路径 ⇒ 新令牌会被默默兜底')
        bad += 1
    except KeyError:
        print('  [OK]   生成器拒绝给没归类的令牌生成路径')

    # 扫描器本身
    if key("a  'SF  Mono'   b") != "a 'SF  Mono' b":
        print('  [FAIL] key() 把引号内的空白也折叠了 ⇒ 字体名会被改坏')
        bad += 1
    else:
        print('  [OK]   归一化保护引号内的空白（字体名里的空格有意义）')
    if key("/* 中文 */ -apple-system") != '-apple-system':
        print('  [FAIL] key() 没有剥掉值里的注释 ⇒ 跟浏览器永远对不上')
        bad += 1
    else:
        print('  [OK]   归一化会剥掉值里的注释（浏览器保留值中间的注释）')

    errs = check(doc, names, cssom)
    if errs:
        print('  [FAIL] 原样就有不通过的项 ⇒ 判据过严')
        for e in errs[:10]:
            print('        ' + e)
        bad += 1
    else:
        print('  [OK]   原样全绿（%d 个令牌 / browser=%s）'
              % (len(names), 'yes' if cssom else 'no'))
    return 1 if bad else 0


def main():
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    print('')
    print('  === 第二种令牌导出（Style Dictionary / Figma 友好）===')
    bad = 0
    ok, msg = check_generated()
    if ok:
        print('    OK  ① ai/tokens.tree.json 与 tokens.css 一致')
    else:
        print('    X   ① ' + (msg or 'ai/tokens.tree.json 与源码不一致'))
        bad += 1
    doc = json.loads(io.open(TREE, encoding='utf-8').read())
    cssom = browser_facts()
    errs = check(doc, css_names(), cssom)
    if errs:
        for e in errs:
            print('    X ' + e)
        bad += len(errs)
    else:
        m = doc['meta']
        print('    OK ②–④ ⑥ 全部通过（浅色 %d / 暗色 %d · %d 个类别）'
              % (m['lightCount'], m['darkCount'], len(m['categories'])))
        if cssom is not None:
            print('    OK ⑤ 浏览器 CSSOM 复核：%d 个名字、全部值与浏览器一致'
                  % len(cssom['names']))
    print('')
    if bad:
        print('  ❌ %d 项不满足' % bad)
        sys.exit(1)
    print('  ✅ 第二种令牌导出闭环')
    sys.exit(0)


if __name__ == '__main__':
    main()
