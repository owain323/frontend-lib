#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
deps.py — 令牌 → 组件的影响图


------------------------------------------------------------------
为什么需要
----------
2026-10-03 调 `--text-tertiary` 时，我是**改完跑全量门禁**才知道它影响了很多组件。
但实测发现：**一次 grep 就能看到** —— 它被全部 10 个组件引用。

"改完才知道"和"改前就知道"差在：
- 前者：门禁红了才知道，且**门禁只告诉你坏了，不告诉你坏在哪**
- 后者：动手前就知道影响面，可以先想清楚

⚠️ 这个脚本**不是门禁**（它不判定对错，只报告关系）。
   加进 check-all 会让"报告型"和"判定型"混在一起 ——
   那正是我今晚犯过的错（`dead-class-gate` 那种）。

用法
----
    python 05-audit/deps.py                     # 全部：令牌 → 谁在用
    python 05-audit/deps.py --token text-tertiary   # 某个令牌被谁用
    python 05-audit/deps.py --component button      # 某个组件用了哪些令牌
    python 05-audit/deps.py --orphans           # 哪些令牌没人用（可删）
    python 05-audit/deps.py --missing           # 组件引用了但 tokens.css 没定义 ← 真问题
"""
import sys
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = ('01-tokens', '02-primitives', '03-patterns')


def read(p):
    return open(p, encoding='utf-8', errors='replace').read()


def strip_css(s):
    return re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'),
                  s, flags=re.S)


def collect():
    """返回 (token→组件集合, 组件→令牌集合, 组件文件)"""
    t2c, c2t, files = {}, {}, {}
    local_all = set()
    for base in LIB:
        for f in sorted(glob.glob(os.path.join(ROOT, base, '**', '*.css'),
                                  recursive=True)):
            if 'demo' in os.path.basename(f):
                continue
            comp = os.path.basename(os.path.dirname(f))
            s = strip_css(read(f))
            refs = set(re.findall(r'var\(\s*--([a-z0-9-]+)', s))
            # 🔴 组件可以在自己作用域里**定义局部令牌**（states.css 就这么做了：
            #    --sk-base: var(--surface-sunken)），那不是"引用了不存在的令牌"。
            #    ⇒ 未定义检查必须把组件自己定义的算进去，否则全是假警。
            local = set(re.findall(r'(--[a-z0-9-]+)\s*:', s))
            local = {t.lstrip('-') for t in local}
            local_all |= local
            files[comp] = os.path.relpath(f, ROOT).replace(os.sep, '/')
            c2t[comp] = refs
            for t in refs:
                t2c.setdefault(t, set()).add(comp)
    return t2c, c2t, files, local_all


def defined_tokens():
    """tokens.css + typography.css 里真正定义的（不含 --var() 引用）"""
    out = set()
    for f in ('01-tokens/tokens.css', '01-tokens/typography.css'):
        p = os.path.join(ROOT, f)
        if os.path.isfile(p):
            s = strip_css(read(p))
            out |= set(re.findall(r'(--[a-z0-9-]+)\s*:', s))
    return {t.lstrip('-') for t in out}


def main():
    # 🔴 修：`args` 必须排除位置参数（目录），否则
    #    `deps.py --token xxx` 时 args[0] 是 '--token' 而 root 取到了 '--token'。
    argv = [a for a in sys.argv[1:] if not a.startswith('-')]
    root = os.path.abspath(argv[0]) if argv else ROOT
    t2c, c2t, files, local_all = collect()
    defined = defined_tokens()
    # ⚠️ 撤回一次改动：曾想豁免 `--progress`（组件私有参数），
    #    但豁免会让"忘了设值"的组件静默用 0%（假绿）。
    #    ⇒ 正解是在 tokens.css 定义默认值，让门禁自然通过。
    usable = defined | local_all   # 全局定义的 + 组件自己定义的
    args = sys.argv[1:]

    def val(a):
        return a[2:] if a.startswith('--') else a

    if '--token' in args:
        i = args.index('--token')
        t = val(args[i + 1])
        cs = sorted(t2c.get(t, ()))
        print('  --%s 被 %d 个组件引用:' % (t, len(cs)))
        for c in cs:
            print('    %-18s %s' % (c, files.get(c, '')))
        if not cs:
            print('    （没人用 —— 可能是死令牌）')
        return 0

    if '--component' in args:
        i = args.index('--component')
        c = args[i + 1]
        ts = sorted(c2t.get(c, ()))
        print('  %s 用了 %d 个令牌:' % (c, len(ts)))
        print('    %s' % ' '.join(ts))
        undef = [t for t in ts if t not in usable]
        if undef:
            print('  🔴 其中未定义（会失效）: %s' % ' '.join(undef))
        return 1 if undef else 0

    if '--orphans' in args:
        used = set(t2c)
        unused = sorted(defined - used)
        print('  定义了但没有组件引用的令牌：%d 个' % len(unused))
        for t in unused:
            print('    --%s' % t)
        print('')
        print('  ⚠️ 不一定该删 —— 令牌常被"只写在 demo 里"或"给复用者预留"。')
        return 0

    if '--missing' in args:
        # 🔴 判据修正：**带 fallback 的引用不算"未定义"**。
        #    例：accordion 的 `max-height: var(--acc-h, 0px)`
        #    —— `--acc-h` 由 accordion.js 在展开前动态测量写入
        #    （panel.style.setProperty('--acc-h', h + 'px')），
        #    收起后清掉。有 fallback 时**永远不会静默失效**。
        #    ⇒ 只查"CSS 里有没有定义这个变量"会误报。
        import glob as _glob
        import re as _re
        fallback_ok = set()
        runtime_ok = set()
        for _f in _glob.glob('**/*.css', recursive=True) + _glob.glob('**/*.js', recursive=True):
            if 'vendor' in _f:
                continue
            try:
                _t = io.open(_f, encoding='utf-8').read()
            except Exception:
                continue
            # var(--x, fallback)  ⇒ 有 fallback
            fallback_ok |= set(m.group(1) for m in
                               _re.finditer(r'var\(\s*(--[a-z0-9-]+)\s*,', _t))
            # setProperty('--x'  ⇒ JS 运行时写入
            runtime_ok |= set(m.group(1) for m in
                              _re.finditer(r'setProperty\(\s*[\'"](--[a-z0-9-]+)', _t))
        exempt = fallback_ok | runtime_ok

        bad = []
        for c, ts in sorted(c2t.items()):
            undef = sorted(t for t in ts
                           if t not in usable and t not in exempt)
            if undef:
                bad.append((c, undef))
                print('  🔴 %-18s 引用了未定义令牌: %s' % (c, ' '.join('--' + t for t in undef)))
        if not bad:
            print('  ✅ 所有组件引用的令牌都在 tokens.css / typography.css 里有定义')
        return 1 if bad else 0

    # 默认：全表
    print('  令牌 → 组件（共 %d 个令牌被引用）' % len(t2c))
    print('  ' + '-' * 60)
    for t in sorted(t2c, key=lambda x: (-len(t2c[x]), x)):
        cs = t2c[t]
        mark = '' if t in defined else '  🔴 未定义'
        print('  --%-22s %2d 个  %s%s' % (t, len(cs), ' '.join(sorted(cs)), mark))
    print('')
    undef = [(c, [t for t in ts if t not in usable])
             for c, ts in c2t.items() if [t for t in ts if t not in usable]]
    print('  引用了未定义令牌的组件：%d 个' % len(undef))
    for c, ts in undef:
        print('    %-18s %s' % (c, ' '.join('--' + t for t in ts)))
    return 1 if undef else 0


if __name__ == '__main__':
    sys.exit(main())
