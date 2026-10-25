#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
theme-sync.py — 明暗配色的**唯一真值**同步门禁

============================================================================
🔴 它取代了 gen-theme-js.py，原因
----------------------------------------------------------------------------
旧方案：暗色靠 JS 往 `:root` 上写 **30 条 inline 属性**实现。
代价见 `docs/INVARIANT.md` I-4 ——

    inline style 的优先级高于**一切**样式表。
    使用者想覆盖 `--surface`，只能再加 `!important` 反击。

也就是说：为了让"手动开关"能用，我们把**整个配色层**抬到了样式表之上，
使用者的 CSS 从此失效。这是为了一个按钮付出的代价。

新方案（对标 Pico CSS）：**CSS 自己表达暗色，JS 只翻一个属性。**

    @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }
    :root[data-theme="dark"] { … }          ← 本脚本生成

JS 里不再有任何色值。

============================================================================
⚠️ 为什么必须有这道门禁，而不是"把两段写一样就行"
----------------------------------------------------------------------------
暗色值现在在 CSS 里出现**两遍**（`@media` 段 + `[data-theme]` 段）。
见 `docs/INVARIANT.md` I-7：**第二份手写真值必然漂移。**

旧版已经演示过一次：手写 20 个值，**17 个与 tokens.css 不一致**，
连名字都编错（`--warn` / `--danger-soft` vs 真名 `--warning` / `--danger-bg`）。

⇒ 所以 `[data-theme]` 段**必须生成**，`--check` 已接进 `check-all.sh`。

============================================================================
判据
----------------------------------------------------------------------------
  ① 暗色生成段 == `@media` 暗色段（逐条）
  ② 浅色生成段 == 裸 `:root` 的 `--raw-*`（逐条）
     —— 容器里"暗里回浅"只能靠它重写一遍，见 docs/RFC-THEME-SCOPE.md D2
  ③ 两段的选择器都必须**容器可用**：暗色段含 `[data-theme="dark"]`，
     浅色段恰好是 `[data-theme="light"]`。改回 `:root` 限定 ⇒ 容器级作用域
     静默失效（D1）
  ④ `theme-toggle.js` 里**不含任何色值字面量**（hex / rgb / hsl）
     —— 这是 L3-P1 的验收判据：JS 不再持有配色
  ⑤ `theme-toggle.js` 里**不往 `:root` 写令牌**（不再有 inline 覆盖）

============================================================================
用法
----------------------------------------------------------------------------
  python 05-audit/theme-sync.py            # 生成两个属性段
  python 05-audit/theme-sync.py --check    # 校验（已接进 check-all.sh）
  python 05-audit/theme-sync.py --selftest # 反向控制
============================================================================
"""
from __future__ import annotations

import io
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _css import find_block, mask_comments, parse_decls  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOK = os.path.join(ROOT, '01-tokens', 'tokens.css')
JS = os.path.join(ROOT, '01-tokens', 'theme-toggle.js')

BEGIN = '/* === BEGIN: dark-via-attr（由 05-audit/theme-sync.py 生成，勿手改）=== */'
END = '/* === END: dark-via-attr === */'

# 浅色回退段：容器级换肤必需（见 docs/RFC-THEME-SCOPE.md D2）。
# `var()` 是继承的，CSS 没有"取消声明、回到上一层"的语法 ⇒ 暗容器里再要浅色，
# 只能把浅色 L1 全部重写一遍 —— 于是它成为第二份真值，必须生成 + 校验。
LIGHT_BEGIN = ('/* === BEGIN: light-via-attr（由 05-audit/theme-sync.py 生成，'
               '勿手改）=== */')
LIGHT_END = '/* === END: light-via-attr === */'

# ⚠️ 必须容忍 `:root:not([data-theme="light"])` 这种带后缀的选择器
#    （旧版写成 `:root\s*\{`，一改成 :not(...) 就整段失配）
RE_ROOT = re.compile(r':root(?![\w-])[^{]*\{')
RE_BARE_ROOT = re.compile(r':root\s*\{')
RE_MEDIA_DARK = re.compile(r'@media[^{]*prefers-color-scheme:\s*dark[^{]*\{')

SEL_DARK = '[data-theme="dark"]'
SEL_LIGHT = '[data-theme="light"]'

# ② 色值字面量
RE_HEX = re.compile(r'#[0-9a-fA-F]{3,8}\b')
RE_FN = re.compile(r'\b(?:rgb|rgba|hsl|hsla)\s*\(')


def collect(css):
    """抽出所有 `:root…{}` 块里的令牌（先出现的为准）。

    🔴 定位走 `mask_comments(css)`：注释里会出现 `:root` 字样（举例、说明），
       直接搜会把示例当成真实块。遮蔽器保持长度与换行 ⇒ 下标可直接切原文，
       原文里的注释也就不会丢。
    """
    res = {}
    masked = mask_comments(css)
    for m in RE_ROOT.finditer(masked):
        body, _ = find_block(masked, m.end() - 1)
        for name, value, _note in parse_decls(body):
            if name.startswith('--') and name not in res:
                res[name] = value
    return res


def split_region(css, begin=BEGIN, end=END):
    """返回 (region_with_markers_or_None, 起, 止)。没有标记也允许（首次生成）。"""
    a = css.find(begin)
    if a < 0:
        return None, -1, -1
    b = css.find(end, a)
    if b < 0:
        raise SystemExit('tokens.css 有 BEGIN 标记但没有对应 END 标记')
    return css[a:b + len(end)], a, b + len(end)


def dark_tokens(css):
    """从 `@media (prefers-color-scheme: dark)` 段取暗色令牌（真值来源）。

    🔴 必须遮蔽注释再搜 —— 实测过两次：
       ① 文件里有一段注释**举着** `@media … prefers-color-scheme: dark` 讲原因；
       ② 我自己在 L1 那一层的说明里写了同样一句，
      两次都让这里定位到注释里的假 @media。
       ② 的后果更重：matched 到一处空规则块 ⇒ 读出 **0 个令牌** ⇒
       生成的 `[data-theme="dark"]` 变成空块，而 `--check` 还说"一致"（0 == 0）。
    """
    masked = mask_comments(css)
    m = RE_MEDIA_DARK.search(masked)
    if not m:
        raise SystemExit('tokens.css 里找不到 @media (prefers-color-scheme: dark)')
    inner, _ = find_block(masked, m.end() - 1)
    return collect(inner)


def light_tokens(css):
    """浅色 L1 = 第一个**裸** `:root {` 里的 `--raw-*`。

    ⚠️ 只认裸 `:root {`：`:root:not([data-theme="light"])` 是暗色条件覆盖，
       `:root:lang(ar)` 是排版覆盖，都不是"基准浅色值"。
    """
    masked = mask_comments(css)
    m = RE_BARE_ROOT.search(masked)
    if not m:
        raise SystemExit('tokens.css 里找不到裸 `:root {` 块')
    body, _ = find_block(masked, m.end() - 1)
    out = {}
    for name, value, _note in parse_decls(body):
        if name.startswith('--raw-') and name not in out:
            out[name] = value
    if not out:
        raise SystemExit(
            '裸 `:root {` 里没有任何 --raw-* 令牌 —— 浅色回退段会生成空块，'
            '而"空块 == 空块"会被判成一致（假绿）')
    return out


def light_aliases(css):
    """L2 别名表：`--paper: var(--raw-paper)` ⇒ {'--paper': 'var(--raw-paper)'}。

    🔴 为什么生成段必须**连 L2 一起重声明**（P1 首跑实测出来的）
    ------------------------------------------------------------------------
    `--paper: var(--raw-paper)` 是在**声明它的那个元素**（`:root`）上求值的，
    后代继承的是**求值结果**（`#f6f7f8`），不是那个 `var()` 表达式。

    所以只在容器里覆盖 `--raw-paper`，容器里的 `--paper` 仍然是 `#f6f7f8` ——
    实测确认：暗区容器里的 `--paper` 与区外一字不差，按钮底色也完全没变。

    ⇒ 每个作用域都要把 `--paper: var(--raw-paper)` 重声明一遍，
      让它在这个元素上**重新求值**。代价是生成段变长一倍，但这是 CSS 的规定动作。
    """
    masked = mask_comments(css)
    m = RE_BARE_ROOT.search(masked)
    if not m:
        raise SystemExit('tokens.css 里找不到裸 `:root {` 块')
    body, _ = find_block(masked, m.end() - 1)
    out = {}
    for name, value, _note in parse_decls(body):
        if name.startswith('--raw-') or name in out:
            continue
        norm = value.replace(' ', '')
        if re.match(r'^var\(--raw-[a-z0-9-]+\)$', norm):
            out[name] = value
    return out


def _region(begin, end, selector, raws, aliases):
    rows = ['  %s: %s;' % (k, v) for k, v in sorted(raws.items())]
    rows.append('')
    rows += ['  %s: %s;' % (k, v) for k, v in sorted(aliases.items())]
    return begin + '\n' + selector + ' {\n' + '\n'.join(rows) + '\n}\n' + end


def build_region(dark, aliases):
    # 🔴 列表第一个保留 `:root` 限定：根元素上的特异性不降级（与旧行为逐字等价）。
    #    第二个 `[data-theme="dark"]` 才是容器级作用域的入口，见
    #    docs/RFC-THEME-SCOPE.md D1。
    return _region(BEGIN, END,
                   ':root[data-theme="dark"],\n' + SEL_DARK, dark, aliases)


def build_light_region(light, aliases):
    return _region(LIGHT_BEGIN, LIGHT_END, SEL_LIGHT, light, aliases)


def _region_block(region, begin):
    """取生成段里第一个规则块的 (选择器文本, 声明体)。"""
    start = region.find(begin) + len(begin)
    masked = mask_comments(region)
    i = masked.find('{', start)
    if i < 0:
        return None, None
    sel = masked[start:i].strip()
    body, _ = find_block(masked, i)
    return sel, body


def _selectors(sel):
    return [s.strip() for s in sel.split(',')]


def _diff(label, want, got, src):
    """逐条比对，返回问题列表。值比较前去掉空白并转小写（`#FFF` == `#fff`）。"""
    p = []
    for k in sorted(set(want) - set(got)):
        p.append('%s生成段缺令牌 %s（%s 有 `%s`）' % (label, k, src, want[k]))
    for k in sorted(set(got) - set(want)):
        p.append('%s生成段多令牌 %s（%s 已无此令牌）' % (label, k, src))

    def norm(v):
        return v.replace(' ', '').lower()

    for k in sorted(set(want) & set(got)):
        if norm(want[k]) != norm(got[k]):
            p.append('%s令牌 %s 值不一致：%s 是 `%s`，生成段是 `%s`'
                     % (label, k, src, want[k], got[k]))
    return p


def check_css(css):
    """① 暗色段 == @media 段；② 浅色段 == :root；③ 选择器必须容器可用；
    ④ 两段的 L2 别名必须齐（否则作用域里 L1 白改，见 light_aliases 注释）。"""
    problems = []
    dark = dark_tokens(css)
    light = light_tokens(css)
    aliases = light_aliases(css)

    def split_decls(body):
        raws, alias = {}, {}
        for n, v, _ in parse_decls(body):
            if not n.startswith('--'):
                continue
            if n.startswith('--raw-'):
                raws[n] = v
            else:
                alias[n] = v
        return raws, alias

    dregion, _a, _b = split_region(css)
    if dregion is None:
        problems.append('tokens.css 缺少 `[data-theme="dark"]` 段 —— 跑 '
                        'python 05-audit/theme-sync.py 生成')
    else:
        sel, body = _region_block(dregion, BEGIN)
        if sel is None:
            problems.append('暗色生成段里找不到规则块')
        else:
            if SEL_DARK not in _selectors(sel):
                problems.append(
                    '暗色生成段的选择器里没有 `%s`（现在是 `%s`）—— '
                    '容器级作用域会失效，见 docs/RFC-THEME-SCOPE.md D1'
                    % (SEL_DARK, ' '.join(sel.split())))
            got_raw, got_alias = split_decls(body)
            problems += _diff('暗色 L1', dark, got_raw, '`@media` 段')
            problems += _diff('暗色 L2', aliases, got_alias, '`:root` 的 L2')

    lregion, _c, _d = split_region(css, LIGHT_BEGIN, LIGHT_END)
    if lregion is None:
        problems.append('tokens.css 缺少 `[data-theme="light"]` 段 —— 跑 '
                        'python 05-audit/theme-sync.py 生成')
    else:
        sel, body = _region_block(lregion, LIGHT_BEGIN)
        if sel is None:
            problems.append('浅色生成段里找不到规则块')
        else:
            if _selectors(sel) != [SEL_LIGHT]:
                problems.append(
                    '浅色生成段的选择器必须是单个 `%s`（现在是 `%s`）—— '
                    '它只用来"从暗容器里回退"，不该带别的限定'
                    % (SEL_LIGHT, ' '.join(sel.split())))
            got_raw, got_alias = split_decls(body)
            problems += _diff('浅色 L1', light, got_raw, '`:root` 的 L1')
            problems += _diff('浅色 L2', aliases, got_alias, '`:root` 的 L2')
    return problems


def check_js(js):
    """②③ JS 不得持有色值、不得往 :root 写令牌。"""
    problems = []
    for m in RE_HEX.finditer(js):
        line = js.count('\n', 0, m.start()) + 1
        problems.append('theme-toggle.js:%d 有色值字面量 `%s` —— '
                        '配色必须只在 tokens.css 里' % (line, m.group(0)))
    for m in RE_FN.finditer(js):
        line = js.count('\n', 0, m.start()) + 1
        problems.append('theme-toggle.js:%d 有色值函数 `%s(` —— '
                        '配色必须只在 tokens.css 里' % (line, m.group(0)))
    if re.search(r'\.style\.setProperty\s*\(\s*[\'"]--', js):
        problems.append('theme-toggle.js 仍在往 `:root` 写令牌（inline style）'
                        ' —— 这会压过使用者的样式表，见 INVARIANT I-4')
    return problems


def _media_end(css):
    """`@media (prefers-color-scheme: dark)` 块的结束下标（闭括号之后）。"""
    masked = mask_comments(css)
    m = RE_MEDIA_DARK.search(masked)
    if not m:
        raise SystemExit('tokens.css 里找不到 @media (prefers-color-scheme: dark)')
    _inner, end = find_block(masked, m.end() - 1)
    return end


def generate(css):
    light = light_tokens(css)
    dark = dark_tokens(css)
    aliases = light_aliases(css)
    lregion = build_light_region(light, aliases)
    dregion = build_region(dark, aliases)

    # 浅色段先定位/插入：它要排在暗色段**之前**（读起来顺序是 浅 → 暗）
    old, a, b = split_region(css, LIGHT_BEGIN, LIGHT_END)
    if old is None:
        _o, da, _db = split_region(css)
        pos = da if da >= 0 else _media_end(css)
        css = css[:pos] + lregion + '\n\n' + css[pos:]
    else:
        css = css[:a] + lregion + css[b:]

    old, a, b = split_region(css)
    if old is None:
        pos = _media_end(css)
        css = css[:pos] + '\n\n' + dregion + css[pos:]
    else:
        css = css[:a] + dregion + css[b:]
    return css


def selftest():
    print('  === theme-sync 反向控制 ===')
    ok = True
    base_css = (
        ':root {\n  --raw-paper: #ffffff;\n  --raw-surface: #f6f7f8;\n'
        '  --paper: var(--raw-paper);\n  --surface: var(--raw-surface);\n}\n'
        '@media (prefers-color-scheme: dark) {\n'
        '  :root:not([data-theme="light"]) {\n'
        '    --raw-paper: #14171a;\n    --raw-surface: #1c2024;\n  }\n}\n')
    dark = dark_tokens(base_css)
    light = light_tokens(base_css)
    aliases = light_aliases(base_css)
    light_region = build_light_region(light, aliases)
    dark_region = build_region(dark, aliases)
    good_css = base_css + '\n' + light_region + '\n\n' + dark_region + '\n'

    def mutated(why, css, old, new):
        """变异体必须**真的改动了文本** —— 否则"期望红却红了"是假象。"""
        out = css.replace(old, new, 1)
        if out == css:
            print('  [FAIL] 变异体没生效（搜不到 %r）：%s' % (old, why))
            return None
        return out

    def run(why, css, js, should_fail):
        if css is None:
            return False
        probs = check_css(css) + check_js(js)
        got = bool(probs)
        good = (got == should_fail)
        if not good:
            print('       ↳ 实际：%s' % (probs[0] if probs else '(无)'))
        print('  [%s] %-24s 期望%s ⇒ 实际%s'
              % ('OK ' if good else 'FAIL', why,
                 '红' if should_fail else '绿', '红' if got else '绿'))
        return good

    clean_js = 'var a = 1;\nroot.setAttribute("data-theme", m);\n'

    cases = [
        ('两段一致', good_css, clean_js, False),
        ('缺暗色生成段',
         good_css.replace(dark_region, ''), clean_js, True),
        ('缺浅色回退段',
         good_css.replace(light_region, ''), clean_js, True),
        ('暗色段少一个令牌',
         mutated('暗色段少一个令牌', good_css,
                 '  --raw-paper: #14171a;\n', ''), clean_js, True),
        ('暗色段值不一致',
         mutated('暗色段值不一致', good_css,
                 '--raw-paper: #14171a;', '--raw-paper: #000000;'),
         clean_js, True),
        # ③ 容器级作用域：改回根限定 ⇒ 必须红（否则 P1 白做）
        ('暗色段被改回根限定',
         mutated('暗色段被改回根限定', good_css,
                 ':root[data-theme="dark"],\n[data-theme="dark"] {',
                 ':root[data-theme="dark"] {'), clean_js, True),
        # ④ 有 L1 没 L2：容器里 L1 白改（P1 首跑实测到的那个坑）
        ('暗色段缺 L2 别名',
         mutated('暗色段缺 L2 别名', good_css,
                 '  --paper: var(--raw-paper);\n', ''), clean_js, True),
        ('浅色段值不一致',
         mutated('浅色段值不一致', good_css,
                 light_region, light_region.replace(
                     '--raw-paper: #ffffff;', '--raw-paper: #eeeeee;')),
         clean_js, True),
        ('JS 有 hex 色值', good_css,
         "var c = '#14171a';\n", True),
        ('JS 有 rgba 色值', good_css,
         "var c = 'rgba(0, 0, 0, .6)';\n", True),
        ('JS 写 inline 令牌', good_css,
         "root.style.setProperty('--paper', x);\n", True),
    ]
    for why, css, js, should in cases:
        if not run(why, css, js, should):
            ok = False
    return 0 if ok else 1


def main():
    if '--selftest' in sys.argv:
        return selftest()

    css = io.open(TOK, encoding='utf-8').read()
    js = io.open(JS, encoding='utf-8').read() if os.path.isfile(JS) else ''

    if '--check' in sys.argv:
        problems = check_css(css) + check_js(js)
        dark = dark_tokens(css)
        if problems:
            for p in problems:
                print('  [FAIL] %s' % p)
            print('\n  共 %d 处 —— 跑 python 05-audit/theme-sync.py 重新生成'
                  % len(problems))
            return 1
        print('  [OK] 主题真值同步：`@media` 段 %d 个令牌 ⇒ `[data-theme="dark"]` 段一致；'
              '`:root` 的 %d 个 L1 ⇒ `[data-theme="light"]` 段一致；JS 无配色'
              % (len(dark), len(light_tokens(css))))
        return 0

    new = generate(css)
    if new == css:
        print('  ✓ tokens.css 已是最新（无需改动）')
    else:
        # 🔴 必须显式 newline='\n'：Windows 默认把 \n 写成 \r\n。
        #    实测过：跑一次 `theme-sync.py` 就把 tokens.css 变成全 CRLF，
        #    而 D4（行尾统一）已经把全库统一成 LF ⇒ 生成器和 D4 直接打架。
        io.open(TOK, 'w', encoding='utf-8', newline='\n').write(new)
        print('  ✓ 已重新生成两个属性段（暗色 %d 个令牌 / 浅色回退 %d 个）'
              % (len(dark_tokens(css)), len(light_tokens(css))))
    return 0


if __name__ == '__main__':
    sys.exit(main())
