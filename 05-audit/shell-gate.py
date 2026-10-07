#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
shell-gate.py — 页面骨架门禁（禁止页面重抄骨架）

============================================================================
🔴🔴 为什么需要这道门禁（0.4.2 · 实测事故驱动）
----------------------------------------------------------------------------
  事故：用本库做 14 页 PPT，想改一处"全局"的东西，14 页立刻崩。

  复盘量出来的根因（不是猜的，脚本数过 39 个页面）：

     选择器     出现页   写法种数
     h1         36       8
     h2         35      11
     .wrap      33      16     ← 列宽从 680px 到 900px 有 13 个不同数字
     body       32       9
     code       24       9
     .lede      21       7     ← typography.css 里**已有**，页面还在重抄
     .note      21      10     ← 同上
     .box       13       2

  ⇒ 这个库里**根本没有"全局"**：骨架被 33 个页面各抄了一份。
    "改全局"在物理上不成立 —— 没有一处可改，只有 33 处要改。

  0.4.2 把这批收编进 01-tokens/page.css（一处定义，挂在 .page 下）。
  收编之后就有个新风险：页面如果**还留着**自己的 `h1 {}` / `.wrap {}`，

      .page h1  （特异性 0,1,1） 会盖掉页面的  h1  （0,0,1）

  ⇒ 页面那句变成**死代码**：不报错、不影响解析、肉眼看不出来，
    只有"我明明改了却没变"的时候才会被发现。
    这正是本库已经踩过两次的那种静默失效（compare I-12）。

  本门禁拦的就是这个：**骨架收编了的选择器，页面一律不许再声明**。
============================================================================

判据（三条，都机械可判）
----------------------------------------------------------------------------
  ① 页面内联 <style> 里**不得**出现骨架已收编的选择器
     （骨架 = 01-tokens/page.css 的 `.page X` + 01-tokens/typography.css 的裸定义）
  ② 骨架选择器在骨架文件里**只能有一处定义**
     （两处定义 = 又变成两个真值源）
  ③ 组件 CSS 里也不得出现骨架选择器（组件不该重新定义页面骨架）

  只报告不 fail：非骨架选择器在 ≥3 个页面里重复（已知债，见下）
============================================================================

🔴 有意没收编的（不是漏，是判断后不收）
----------------------------------------------------------------------------
  · `.row`  15 页 14 种写法 —— 各页的局部排布工具，不是骨架；
             压成 1 种会破坏 9 个页面的实际布局。
  · `.log`  10 页 7 种写法，且一个类名两种语义（2 页"一行淡字" / 8 页"日志面板"）。
  · `.pad`  6 页 4 种写法，都是各页自己的占位高度。

  这三项的重复**不会**造成"改全局崩"（它们不是全局），所以留在页面里；
  本门禁把它们作为"已知重复"报出来，但不 fail。
============================================================================

用法
----------------------------------------------------------------------------
  python3 05-audit/shell-gate.py              # 扫全库
  python3 05-audit/shell-gate.py <文件...>     # 只扫指定文件（反向控制用）
  python3 05-audit/shell-gate.py --selftest    # 自检：必须能红，也必须能绿
============================================================================
"""

import io
import os
import re
import sys
import tempfile
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 骨架的两个真值源文件
OWNER_FILES = ('01-tokens/page.css', '01-tokens/typography.css')

# 扫描时跳过（第三方 / 打包产物 / 陌生人看不到的东西）
# 🔴 `examples/` 整目录跳过，不是图省事：
#    examples/react-vite 是**故意不引本库令牌**的"宿主项目"样板
#    （它自带 40 个固定 px 令牌，用来证明组件能在别人的令牌体系下工作）。
#    骨架是**选配**的（要写 <body class="page"> 才生效），
#    这个例子就是那个"不选配"的反例 —— 它当然会自己写 body。
#    ⇒ 拿骨架门禁去要求它，等于要求所有宿主页面都必须用我们的骨架。
SKIP_DIRS = ('node_modules', '.git', 'benchmark', 'examples',
             '05-audit', 'prefixed', '.workbuddy')
# 组件 CSS 所在目录（判据③）
COMPONENT_DIRS = ('02-primitives', '03-patterns', '04-recipes', '09-assets')

# 🔴 单文件自包含交付物：全站零外链（tokens 内联进 :root），
#    这是它存在的意义 —— 给它挂骨架等于把它改成不是它。
#    ⇒ 骨架是"选配"，这类页面就是"不选配"的那一类。
SELF_CONTAINED = ('04-recipes/longform/longform.html',
                  '04-recipes/longform/content.html')

STYLE_RE = re.compile(r'<style[^>]*>(.*?)</style>', re.S | re.I)


def norm(sel):
    """归一化选择器：`  .page   h1  ` -> `.page h1`"""
    s = re.sub(r'\s+', ' ', sel.strip())
    return re.sub(r'\s*([>+~,])\s*', r'\1', s)


def strip_comments(css):
    return re.sub(r'/\*.*?\*/', '', css, flags=re.S)


def blocks(css):
    """切块：[(prelude, body)]，@media 等 at-rule 的 prelude 保留但不算选择器。"""
    out, i, n = [], 0, len(css)
    while i < n:
        j = css.find('{', i)
        if j < 0:
            break
        pre = css[i:j].strip()
        depth, k = 0, j
        while k < n:
            if css[k] == '{':
                depth += 1
            elif css[k] == '}':
                depth -= 1
                if depth == 0:
                    break
            k += 1
        out.append((pre, css[j + 1:k]))
        i = k + 1
    return out


def selectors(css):
    """取所有非 at-rule 的选择器（已归一化）。"""
    out = []
    for pre, _ in blocks(strip_comments(css)):
        if not pre or pre.startswith('@'):
            continue
        for s in pre.split(','):
            s = norm(s)
            if s:
                out.append(s)
    return out


# ============================================================ 骨架真值源
def skeleton():
    """返回 (forbidden, owners)
      forbidden: 页面不许再声明的选择器 -> 归属文件
      owners   : 骨架文件里实际写的选择器 -> [文件]（判据②用）
    """
    forbidden, owners = {}, collections.defaultdict(list)
    for rel in OWNER_FILES:
        path = os.path.join(ROOT, rel)
        if not os.path.isfile(path):
            continue
        src = io.open(path, encoding='utf-8').read()
        for sel in selectors(src):
            owners[sel].append(rel)
            if rel.endswith('page.css'):
                # `.page h1` -> 页面不许写 `h1`；`.page` 本体 -> 页面不许写 `body`
                key = sel[len('.page'):].strip() if sel.startswith('.page') else sel
                forbidden[key or 'body'] = rel
            else:
                forbidden[sel] = rel
    return forbidden, owners


# ============================================================ 扫描
def scan_path(rel, forbidden):
    """扫一个文件，返回 [(文件, 选择器, 归属)]"""
    path = os.path.join(ROOT, rel) if not os.path.isabs(rel) else rel
    src = io.open(path, encoding='utf-8', errors='replace').read()
    hits = []
    if rel.endswith('.css'):
        css = src
    else:
        css = '\n'.join(STYLE_RE.findall(src))
    if not css.strip():
        return hits
    for sel in selectors(css):
        for s in sel.split(','):
            s = norm(s)
            if s in forbidden:
                hits.append((rel, s, forbidden[s]))
    return hits


def html_files():
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames
                       if d not in SKIP_DIRS and not d.startswith('.')]
        for f in filenames:
            if f.endswith('.html') and '_baseline' not in f:
                rel = os.path.relpath(os.path.join(dirpath, f), ROOT).replace('\\', '/')
                if rel in SELF_CONTAINED:
                    continue
                out.append(rel)
    return sorted(out)


def css_files():
    out = []
    for d in COMPONENT_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames if x not in SKIP_DIRS]
            for f in filenames:
                if f.endswith('.css') and '_baseline' not in f:
                    out.append(os.path.relpath(os.path.join(dirpath, f), ROOT)
                               .replace('\\', '/'))
    return sorted(out)


def dup_report(forbidden, min_pages=3):
    """非骨架选择器在多少个页面里被重复声明（只报告，不 fail）。"""
    cnt = collections.Counter()
    for rel in html_files():
        src = io.open(os.path.join(ROOT, rel), encoding='utf-8', errors='replace').read()
        css = '\n'.join(STYLE_RE.findall(src))
        for sel in selectors(css):
            for s in sel.split(','):
                s = norm(s)
                if s in forbidden:
                    continue
                cnt[s] += 1
    return [(s, c) for s, c in cnt.most_common() if c >= min_pages]


# ============================================================ 自检
FIXTURE_BAD = """<!DOCTYPE html>
<html><head><style>
  body { margin: 0; }
  h1 { font-size: 31px; }
  .wrap { max-width: 820px; margin: 0 auto; }
  h2 { font-size: var(--fs-lg); }
  code { font-family: monospace; }
  .box { padding: 12px; }
  .lede { margin: 0; }
  .small { font-size: 12px; }
  .note { background: #eee; }
</style></head><body class="page"><main class="wrap"></main></body></html>
"""

FIXTURE_GOOD = """<!DOCTYPE html>
<html><head><style>
  /* 页面自己的东西：骨架没收编，允许 */
  .row { display: flex; gap: var(--sp-3); }
  .demo-grid { display: grid; }
  .page .row-more { padding: var(--sp-2); }
</style></head><body class="page"><main class="wrap"></main></body></html>
"""


def selftest():
    print('  === shell-gate 自检（门禁必须既能红、也能绿）===')
    print('')
    forbidden, owners = skeleton()
    ok = True

    # ---- 反向控制：坏样本必须被抓 ----
    tmp = tempfile.mkdtemp(prefix='shellgate-')
    bad = os.path.join(tmp, 'bad.html')
    good = os.path.join(tmp, 'good.html')
    io.open(bad, 'w', encoding='utf-8').write(FIXTURE_BAD)
    io.open(good, 'w', encoding='utf-8').write(FIXTURE_GOOD)

    hits = scan_path(bad, forbidden)
    got = {h[1] for h in hits}
    want = {'body', 'h1', '.wrap', 'h2', 'code', '.box', '.lede', '.small', '.note'}
    missing = want - got
    if missing:
        print('  X 反向控制失败：坏样本里这些没被抓到 -> %s' % sorted(missing))
        ok = False
    else:
        print('  OK 反向控制：坏样本的 %d 个骨架选择器全被抓到' % len(want))

    # ---- 正常样本必须放行 ----
    ok_hits = scan_path(good, forbidden)
    if ok_hits:
        print('  X 判据过宽：正常样本被误报 -> %s' % [h[1] for h in ok_hits])
        ok = False
    else:
        print('  OK 判据不过宽：页面自己的 .row / .demo-grid 放行')

    # ---- 判据②：骨架文件里不得有两处定义同一选择器 ----
    dup = {s: f for s, f in owners.items() if len(f) > 1}
    if dup:
        print('  X 骨架选择器有多处定义 -> %s' % dup)
        ok = False
    else:
        print('  OK 骨架选择器在骨架文件里各只有一处定义（%d 个）' % len(owners))

    # ---- 真值源不能是空的（否则门禁会永远绿）----
    if len(forbidden) < 10:
        print('  X 骨架真值源只有 %d 条，疑似解析失败' % len(forbidden))
        ok = False
    else:
        print('  OK 骨架真值源解析出 %d 条禁用选择器' % len(forbidden))

    for f in (bad, good):
        os.remove(f)
    os.rmdir(tmp)
    print('')
    print('  自检%s' % ('通过' if ok else '失败'))
    return 0 if ok else 1


# ============================================================
def main():
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    if '--selftest' in sys.argv:
        return selftest()

    forbidden, owners = skeleton()

    print('  === 页面骨架（禁止页面重抄骨架）===')
    print('')
    print('  骨架真值源：%s' % ' + '.join(OWNER_FILES))
    print('  收编了 %d 个选择器，页面一律不许再声明' % len(forbidden))

    if args:
        hits = []
        for a in args:
            hits += scan_path(a, forbidden)
        if not hits:
            print('  OK 指定文件没有重抄骨架')
            return 0
        for rel, sel, owner in hits:
            print('  🔴 %s: 重抄了骨架选择器 `%s`（已由 %s 定义）' % (rel, sel, owner))
        return 1

    hits = []
    for rel in html_files():
        hits += scan_path(rel, forbidden)
    comp = []
    for rel in css_files():
        comp += scan_path(rel, forbidden)

    bad = 0
    if hits:
        print('')
        print('  🔴 页面内联 <style> 里还在重抄骨架（这些声明会被 .page 前缀静默盖掉）：')
        for rel, sel, owner in hits[:20]:
            print('     %-42s `%s`  ← 已由 %s 定义' % (rel, sel, owner))
        if len(hits) > 20:
            print('     … 另有 %d 处' % (len(hits) - 20))
        print('')
        print('  ⇒ 改法：删掉页面里这条规则，让它吃骨架；')
        print('     确需不同，请在骨架里加修饰类（如 .rule-top），不要各页自己写一遍。')
        bad += 1
    else:
        print('  OK 39 个页面都没有重抄骨架')

    if comp:
        print('')
        print('  🔴 组件 CSS 里在重定义页面骨架：')
        for rel, sel, owner in comp[:20]:
            print('     %-42s `%s`  ← 已由 %s 定义' % (rel, sel, owner))
        bad += 1
    else:
        print('  OK 组件 CSS 没有重定义骨架')

    dups = dup_report(forbidden)
    if dups:
        print('')
        print('  已知重复（**不** fail：这些不是骨架，是各页局部排布）：')
        for sel, c in dups[:10]:
            print('     %-22s %d 页' % (sel, c))
        print('     ⇒ 它们是"改全局"崩不了的那一类，留着；哪天要收编先解决语义分歧。')

    print('')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
