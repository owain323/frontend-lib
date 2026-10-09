#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
token-audience-gate.py — 令牌受众登记 + 孤儿令牌门禁（M4）

============================================================================
🔴 为什么需要
----------------------------------------------------------------------------
  「声明了 112 个令牌，其中 9 个从没被 var() 引用过」这个数字早就量出来过，
  但它一直只是**一句观察**，不是一条判据 ⇒ 九个月里没人被它拦住过。

  而这 9 个根本不是同一种东西：

    · `--bp-sm`        断点。**物理上不可能**被 var() 引用 ——
                       CSS media query 的条件里不许写 var()。
                       它「没人引用」是本分，不是病。
    · `--fs-xl`        字号阶梯的一档。阶梯允许有暂未使用的档位。
    · `--ease-drawer`  为抽屉造的缓动曲线 …… 而抽屉用的是 `--ease-out`。
                       ⇒ **这是真缺陷**：造它的人以为接上了。
    · `--measure`      被 `--measure-page` / `--measure-prose` 取代后的遗留。
                       ⇒ **这也是真缺陷**：死重量。

  前两类是合理的，后两类不是 —— 但在「只数孤儿个数」的视角下**完全一样**。
  ⇒ 必须给每个令牌登记**它是给谁用的**（audience），判据才有鉴别力。

============================================================================
判据（七条）
----------------------------------------------------------------------------
  ① 每个声明的令牌都必须能解析出 audience（族默认或单条），不许靠省略跳过
  ② 登记里出现的令牌/族，必须在 tokens.css 里真的匹配到至少一个令牌
     ⇒ 防「登记漂移」与幻觉（对应 I-10 实证 9）
  ③ audience 必须是 public / internal / reference 之一
  ④ **孤儿 + internal ⇒ 红**：库自己不用、也不许使用者用 ⇒ 就是死代码
  ⑤ **孤儿 + public ⇒ 必须在 README 那份受审名单里**：库里没人用、
     文档里也找不到 ⇒ 那是纯粹的死重量（「说有、没人知道」的同一类病）
     ⚠️ 不是「文档里出现过就行」—— 第一版就是这么写的，结果
        `--ease-drawer` 只因为一句"已接回抽屉组件"的顺带提及就算过了，
        把抽屉的 bug 放回去时只有棘轮兜住，⑤ 一声不吭（假绿）。
  ⑤b 受审名单里写的令牌必须**真的是孤儿、真的存在**（文档不许撒谎）
  ⑥ 孤儿总数必须**等于** budget（棘轮：只能降，降了要同步改数字）
  ⑦ 单条登记的令牌必须写理由（凭什么它跟同族的其它令牌不一样）

============================================================================
反向控制：python 05-audit/token-audience-gate.py --selftest
  每一次突变都必须被抓到；原样必须全绿。
  ⚠️ 判据函数做成**纯函数**（输入可注入）是为了让反向控制真正跑到扫描器
     —— 只验判定函数、没验扫描函数，是 I-10 实证 10 已经踩过的坑。
============================================================================
"""
import io
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
REG = os.path.join(ROOT, 'ai', 'tokens.audience.json')
TOKENS_CSS = os.path.join(ROOT, '01-tokens', 'tokens.css')
AUDIENCES = ('public', 'internal', 'reference')
SCAN_DIRS = ('01-tokens', '02-primitives', '03-patterns', '04-recipes',
             '09-assets', 'examples')
DOC_FILES = ('01-tokens/README.md', 'API.md', 'START-HERE.md')
SCAN_EXT = ('.css', '.html', '.js', '.md')

RE_DECL = re.compile(r'^\s*(--[a-z0-9-]+)\s*:', re.M)
RE_VAR = re.compile(r'var\(\s*(--[a-z0-9-]+)')


# ---------------------------------------------------------------- 取事实

def declared_tokens(css_text):
    """tokens.css 里声明过的令牌（去重、保序）"""
    out = []
    for m in RE_DECL.finditer(css_text):
        if m.group(1) not in out:
            out.append(m.group(1))
    return out


def scan_var_refs(root):
    """全库 var(--x) 引用 ⇒ {令牌: 文件数}"""
    refs = {}
    for d in SCAN_DIRS:
        base = os.path.join(root, d)
        if not os.path.isdir(base):
            continue
        for dirpath, _, files in os.walk(base):
            for fn in sorted(files):
                if not fn.endswith(SCAN_EXT):
                    continue
                try:
                    t = io.open(os.path.join(dirpath, fn), encoding='utf-8',
                                errors='ignore').read()
                except IOError:
                    continue
                for m in RE_VAR.finditer(t):
                    refs.setdefault(m.group(1), set()).add(fn)
    return refs


def read_docs(root):
    """文档文本（判据 ⑤ 用）"""
    out = {}
    for rel in DOC_FILES:
        p = os.path.join(root, rel)
        if os.path.isfile(p):
            out[rel] = io.open(p, encoding='utf-8', errors='ignore').read()
    d = os.path.join(root, 'docs')
    if os.path.isdir(d):
        for fn in sorted(os.listdir(d)):
            if fn.endswith('.md'):
                out['docs/' + fn] = io.open(os.path.join(d, fn), encoding='utf-8',
                                            errors='ignore').read()
    return out


# ---------------------------------------------------------------- 纯函数判据

def audience_of(tok, reg):
    """① 解析 audience：单条覆盖 > 最长族前缀"""
    one = reg.get('tokens', {}).get(tok)
    if one:
        return one.get('audience'), 'tokens'
    best = None
    for fam in reg.get('families', {}):
        if tok.startswith(fam):
            if best is None or len(fam) > len(best):
                best = fam
    if best is None:
        return None, None
    return reg['families'][best].get('audience'), best


def mentioned(tok, text):
    """令牌名是否在一段文本里出现。

    ⚠️ 边界必须排除 [a-z0-9-]：否则 `--measure` 会命中 `--measure-page`
       （`-` 是非单词字符，\\b 挡不住）。这条负例在 selftest 里。
    """
    return re.compile(re.escape(tok) + r'(?![a-z0-9-])').search(text) is not None


def curated_orphans(readme_text):
    """⑤ README「库里没引用、但承诺给你用的令牌」那一节的名单。

    只认这一节 —— 「文档里出现过」太松：一句顺带提及就能让判据闭嘴。
    """
    if not readme_text:
        return []
    m = re.search(r'^##\s*库里没引用、但承诺给你用的令牌\s*$(.*?)(?=^##\s)',
                  readme_text, re.M | re.S)
    if not m:
        return []
    # ⚠️ 必须以字母开头：否则 Markdown 的水平线 `---` 会被当成令牌
    return sorted(set(re.findall(r'(--[a-z][a-z0-9-]*)', m.group(1))))


def check(reg, declared, refs, readme_text):
    """七条判据。返回 (错误列表, 统计)"""
    bad = []
    audiences = reg.get('audiences', {})
    families = reg.get('families', {})
    singles = reg.get('tokens', {})
    listed = curated_orphans(readme_text)

    # ③ audiences 段必须先定义过
    for a in AUDIENCES:
        if a not in audiences:
            bad.append('audiences 里缺「%s」的定义' % a)

    # ② 登记的键必须真的匹配到令牌（防幻觉 / 漂移）
    for fam in sorted(families):
        if not any(t.startswith(fam) for t in declared):
            bad.append('族「%s」在 tokens.css 里一个令牌都匹配不到（登记漂移）' % fam)
    for tok in sorted(singles):
        if tok not in declared:
            bad.append('单条登记的「%s」在 tokens.css 里不存在（登记漂移）' % tok)
        why = str(singles[tok].get('why', '')).strip()        # ⑦
        if not why:
            bad.append('单条登记的「%s」没写理由（凭什么它跟同族不一样）' % tok)

    orphans = []
    by_aud = {}
    for tok in declared:
        aud, src = audience_of(tok, reg)
        if aud is None:                                        # ①
            bad.append('令牌「%s」没有登记 audience（不许靠省略跳过）' % tok)
            continue
        if aud not in AUDIENCES:                               # ③
            bad.append('令牌「%s」的 audience「%s」不在 %s 里（来自 %s）'
                       % (tok, aud, '/'.join(AUDIENCES), src))
            continue
        by_aud[aud] = by_aud.get(aud, 0) + 1
        if tok in refs:
            continue
        orphans.append(tok)
        if aud == 'internal':                                  # ④
            bad.append('孤儿 + internal：「%s」库自己不用、也不许使用者用 ⇒ 死代码，删'
                       % tok)
        elif aud == 'public' and tok not in listed:            # ⑤
            bad.append('孤儿 + public：「%s」库里没人用，也不在 README 那份'
                       '「库里没引用、但承诺给你用的令牌」名单里 ⇒ 死重量，'
                       '要么接进组件、要么进名单' % tok)

    # ⑤b 名单不许撒谎
    for tok in listed:
        if tok not in declared:
            bad.append('README 名单里的「%s」在 tokens.css 里不存在' % tok)
        elif tok in refs:
            bad.append('README 名单里的「%s」其实**有**被引用 ⇒ 名单过期了，'
                       '它不是孤儿' % tok)

    # ⑥ 棘轮
    cap = reg.get('budget', {}).get('orphan')
    if cap is None:
        bad.append('budget 缺 orphan（棘轮上限必须显式写）')
    elif len(orphans) != cap:
        bad.append('孤儿实际 %d ≠ budget %d ⇒ 棘轮要求两边一致（降了就一起改小，'
                   '不许偷偷升）' % (len(orphans), cap))

    return bad, {'orphans': orphans, 'byAudience': by_aud,
                 'declared': len(declared), 'listed': listed}


# ---------------------------------------------------------------- 真跑

def run(root=None):
    root = root or ROOT
    reg = json.loads(io.open(os.path.join(root, 'ai', 'tokens.audience.json'),
                             encoding='utf-8').read())
    css = io.open(os.path.join(root, '01-tokens', 'tokens.css'),
                  encoding='utf-8').read()
    readme = read_docs(root).get('01-tokens/README.md', '')
    return check(reg, declared_tokens(css), scan_var_refs(root), readme)


# ---------------------------------------------------------------- 反向控制

def selftest():
    reg = json.loads(io.open(REG, encoding='utf-8').read())
    css = io.open(TOKENS_CSS, encoding='utf-8').read()
    declared = declared_tokens(css)
    refs = scan_var_refs(ROOT)
    readme = read_docs(ROOT).get('01-tokens/README.md', '')
    bad = 0

    def expect(why, errs, needle=None):
        nonlocal bad
        hit = any((needle in e) for e in errs) if needle else bool(errs)
        if hit:
            print('  [OK]   判据抓到突变：' + why)
        else:
            print('  [FAIL] 突变没被抓到 ⇒ 门禁是瞎的：' + why)
            bad += 1

    def clone(fn):
        d = json.loads(io.open(REG, encoding='utf-8').read())
        fn(d)
        return d

    # ① 删掉一个族 ⇒ 令牌解析不出 audience
    expect('删掉 --tracking- 族 ⇒ 令牌没登记',
           check(clone(lambda d: d['families'].pop('--tracking-')),
                 declared, refs, readme)[0], '没有登记 audience')

    # ② 登记一个不存在的令牌 / 不存在的族
    expect('单条登记一个不存在的令牌（--ghost）',
           check(clone(lambda d: d['tokens'].__setitem__(
               '--ghost', {'audience': 'public', 'why': 'x'})),
               declared, refs, readme)[0], '在 tokens.css 里不存在')
    expect('登记一个匹配不到任何令牌的族（--zz-）',
           check(clone(lambda d: d['families'].__setitem__(
               '--zz-', {'audience': 'public', 'why': 'x'})),
               declared, refs, readme)[0], '一个令牌都匹配不到')

    # ③ audience 写成不存在的值
    expect('audience 写成不存在的值（secret）',
           check(clone(lambda d: d['families']['--sp-'].__setitem__(
               'audience', 'secret')), declared, refs, readme)[0], '不在 public')

    # ④ 把一个孤儿登记成 internal ⇒ 必须红
    orphans = [t for t in declared if t not in refs]
    if not orphans:
        print('  [FAIL] 仓库里没有孤儿 ⇒ 造不出④的样本')
        bad += 1
    else:
        tgt = orphans[0]
        expect('把孤儿 %s 登记成 internal ⇒ 死代码' % tgt,
               check(clone(lambda d: d['tokens'].__setitem__(
                   tgt, {'audience': 'internal', 'why': 'x'})),
                   declared, refs, readme)[0], '孤儿 + internal')

    # ⑤ 孤儿 + public 但不在受审名单里 ⇒ 必须红
    pub = [t for t in orphans if audience_of(t, reg)[0] == 'public']
    if not pub:
        print('  [FAIL] 没有「公开孤儿」⇒ 造不出⑤的样本')
        bad += 1
    else:
        tgt = pub[0]
        expect('公开孤儿 %s 不在受审名单里 ⇒ 死重量' % tgt,
               check(reg, declared, refs, '')[0], '孤儿 + public')

    # ⑤b 名单里写了一个其实有被引用的令牌 ⇒ 文档在撒谎
    used = [t for t in declared if t in refs]
    expect('受审名单里混入一个非孤儿（%s）⇒ 名单过期' % used[0],
           check(reg, declared, refs,
                 '## 库里没引用、但承诺给你用的令牌\n\n| `%s` |\n\n## 下一节\n'
                 % used[0])[0], '其实**有**被引用')

    # ⑤b 名单里写了一个不存在的令牌
    expect('受审名单里混入一个不存在的令牌',
           check(reg, declared, refs,
                 '## 库里没引用、但承诺给你用的令牌\n\n| `--ghost` |\n\n## 下一节\n'
                 )[0], '里不存在')

    # ⑥ 棘轮：把 budget 改大 ⇒ 必须红
    expect('budget 与实测不一致（棘轮没同步）',
           check(clone(lambda d: d['budget'].__setitem__('orphan', 999)),
                 declared, refs, readme)[0], '棘轮')

    # ⑦ 单条登记不写理由
    expect('单条登记不写理由',
           check(clone(lambda d: d['tokens'].__setitem__(
               '--measure-page', {'audience': 'public'})),
               declared, refs, readme)[0], '没写理由')

    # ---- 扫描器本身（I-10 实证 10：只验判定函数是不够的）----
    if mentioned('--measure', '| `--measure-page` | 52rem |'):
        print('  [FAIL] mentioned() 把 --measure 误判为「在 --measure-page 里出现过」')
        bad += 1
    else:
        print('  [OK]   扫描器边界：--measure 不会被 --measure-page 顶替')
    if not mentioned('--fs-xl', '--fs-xl: clamp(...);'):
        print('  [FAIL] mentioned() 找不到明明存在的 --fs-xl')
        bad += 1
    else:
        print('  [OK]   扫描器正向：--fs-xl 能被找到')
    if curated_orphans('随便一段没有那个小标题的文字\n\n--fs-xl\n'):
        print('  [FAIL] curated_orphans() 在没有受审名单时也返回了内容')
        bad += 1
    else:
        print('  [OK]   扫描器负向：没有受审名单 ⇒ 空')
    got = curated_orphans('## 库里没引用、但承诺给你用的令牌\n\n'
                          '| `--fs-xl` | x |\n| `--bp-sm` / `--bp-lg` | y |\n\n'
                          '## 下一节\n\n| `--sp-1` |\n')
    if sorted(got) != ['--bp-lg', '--bp-sm', '--fs-xl']:
        print('  [FAIL] curated_orphans() 取错了范围：%r' % (got,))
        bad += 1
    else:
        print('  [OK]   扫描器范围：只取该节，不取下一节（--sp-1 没被算进来）')

    # ---- 原样必须全绿 ----
    errs, st = check(reg, declared, refs, readme)
    if errs:
        print('  [FAIL] 原样就有不通过的项 ⇒ 判据过严')
        for e in errs[:12]:
            print('        ' + e)
        bad += 1
    else:
        print('  [OK]   原样全绿（声明 %d · 孤儿 %d）'
              % (st['declared'], len(st['orphans'])))
    return 1 if bad else 0


def main():
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    errs, st = run()
    print('')
    print('  === 令牌受众 + 孤儿 ===')
    if errs:
        for e in errs:
            print('    X ' + e)
    else:
        aud = st['byAudience']
        print('    OK %d 个令牌全部登记受众（public %d · internal %d · reference %d）'
              % (st['declared'], aud.get('public', 0), aud.get('internal', 0),
                 aud.get('reference', 0)))
        print('    OK 孤儿 %d 个：%s' % (len(st['orphans']), ' '.join(st['orphans'])))
    print('')
    if errs:
        print('  ❌ %d 项不满足' % len(errs))
        sys.exit(1)
    print('  ✅ 令牌受众闭环')
    sys.exit(0)


if __name__ == '__main__':
    main()
