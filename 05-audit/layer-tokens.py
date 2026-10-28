#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
layer-tokens.py — 把 `tokens.css` 的颜色令牌拆成 L1 原始值 / L2 语义两层（D5）

============================================================================
🔴 为什么要分两层
----------------------------------------------------------------------------
  现在 30 个颜色令牌的取值直接写在语义名下：

      --paper:  #f6f7f8;
      --accent: #1b4d8f;

  这带来两个后果：

  ① **换一套配色要改 30 个地方，且改完不知道有没有漏**
     （暗色段漏一个 ⇒ 暗色下静默沿用浅色值，浏览器不报错）

  ② **暗色段必须把 30 个语义令牌全部重写一遍** —— 因为值写死在语义名下。
     这是「漏一个就静默错」的结构性来源。

  分成两层之后：

      /* L1 */ --raw-paper: #f6f7f8;
      /* L2 */ --paper: var(--raw-paper);

  暗色段**只覆盖 L1**，L2 是 `var()` 引用会自然跟随 ⇒
  「暗色段漏了某个语义令牌」这件事在结构上不可能发生。

============================================================================
判据（`--check`）
----------------------------------------------------------------------------
  ① `:root` 里不许再出现「语义名 = 颜色字面量」—— 颜色只能来自 L1
  ② 每个 L1 令牌都必须被至少一个 L2 引用（否则是死重量）
  ③ L2 引用的 L1 必须真的存在（否则 `var()` 静默失效）
  ④ 暗色段只许出现 L1 令牌（出现 L2 ⇒ 又回到"要写两遍"的老路）
  ⑤ L1 / L2 必须 1:1 对应，且命名是 `--raw-<语义名>`

⚠️ 这套判据只在本文件结构上成立；**行为等价**由 `token-resolved-gate`
   负责（分层前后浏览器解析值必须一字不差）。

用法：
  python 05-audit/layer-tokens.py            # 执行分层（幂等：已分层则只校验）
  python 05-audit/layer-tokens.py --check    # 只校验
  python 05-audit/layer-tokens.py --selftest # 反向控制
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from _css import find_block, mask_comments, parse_decls  # noqa: E402

TOK = os.path.join(ROOT, '01-tokens', 'tokens.css')

RAW_PREFIX = '--raw-'
RE_ROOT = re.compile(r':root(?![\w-])[^{]*\{')
RE_MEDIA_DARK = re.compile(r'@media[^{]*prefers-color-scheme:\s*dark[^{]*\{')
# 整值就是一个颜色字面量（不含 unit / 多值）
RE_COLOR = re.compile(r'^(#[0-9a-fA-F]{3,8}|rgba?\([^()]*\)|hsla?\([^()]*\))$')

L1_BANNER = """\
  /* ================================================================ [L1] 原始值
     ⚠️ **这一层不是给使用者用的**，它是"配色取值"本身。

     换一套品牌配色 = 只改这一块的 30 个值，L2 一行都不用动；
     暗色段也只覆盖这块（见文件末尾的 `@media (prefers-color-scheme: dark)`）。

     🔴 命名带 `--raw-` 是**刻意的**：它在告诉读代码的人
        「别在组件里 `var(--raw-*)`」—— 组件只该用 L2 的语义名。
        `token-audience-gate` 把这一层登记为 internal。

     ℹ️ 边界（别夸大它的能力）：这是"取值层"，**不是**与语义解耦的色阶标尺
        （gray-50 / gray-100 那种）。真正的色阶标尺需要先做一次颜色聚类与命名
        决策，是独立的后续工程。
        本层解决的是"换肤只改一处 + 暗色不可能漏"这两件事。
     ---------------------------------------------------------------- */
"""


def split_sections(css):
    """→ (dark_inner_start, dark_inner_end, media_end)

    `dark_inner_*` 是 `@media (prefers-color-scheme: dark)` 里**第一个 :root 块**
    的花括号内部区间。所有改写都限定在这两处，别的地方一个字节都不碰。

    🔴 定位必须在 `mask_comments(css)` 上做：
      本文件里有一段注释**举着** `@media … prefers-color-scheme: dark` 当例子，
      直接搜会先命中注释里那段。偏移量与原文一致（遮蔽器保留长度与换行），
      所以定位出来的下标可以直接拿去切原文 —— 原文里的注释也就保住了。
    """
    masked = mask_comments(css)
    m = RE_MEDIA_DARK.search(masked)
    if not m:
        raise SystemExit('找不到 @media (prefers-color-scheme: dark)')
    media_body_start = m.end() - 1
    _media_body, media_end = find_block(masked, media_body_start)
    inner_root = RE_ROOT.search(masked, media_body_start)
    if not inner_root or inner_root.start() > media_end:
        raise SystemExit('暗色 @media 段里找不到 :root 块')
    rstart = inner_root.end() - 1
    _body, rend = find_block(masked, rstart)
    return rstart + 1, rend, media_end


def light_root_range(css):
    """浅色主 `:root`（文件里第一个顶层 :root 块）的花括号内部区间。"""
    masked = mask_comments(css)
    m = RE_ROOT.search(masked)
    if not m:
        raise SystemExit('找不到 :root')
    _body, end = find_block(masked, m.end() - 1)
    return m.end(), end


def iter_color_decls(text):
    """→ [(name, value, line_no)] 只取**整值是颜色**的声明。

    用 `parse_decls`（会跳注释）而不是自己写正则扫 ——
    本文件里有大段注释举着旧配色当例子，正则扫注释会把它当真实声明
    （实测踩过：`--accent` 被数出 3 次，其中 2 次在注释里）。
    """
    out = []
    for name, value, _note in parse_decls(text):
        v = value.strip()
        if name.startswith('--') and not name.startswith(RAW_PREFIX) \
                and RE_COLOR.match(v):
            out.append((name, v))
    return out


def line_of(text, name):
    """声明所在行号（1 基，相对 text）。只用于报错定位。"""
    for i, ln in enumerate(text.split('\n'), 1):
        if re.match(r'^\s*' + re.escape(name) + r'\s*:', ln):
            return i
    return 0


def rewrite_light(light):
    """浅色 `:root` 内部：插 L1 区块 + 把语义行的值改成 var()。"""
    colors = iter_color_decls(light)
    if not colors:
        return light, []
    rows = ['  %-27s %s;' % (RAW_PREFIX + n[2:] + ':', v) for n, v in colors]
    block = L1_BANNER.lstrip('\n') + '\n'.join(rows) + '\n'
    # `light` 的第一个字符就是换行（`:root {` 之后），所以这里先补一个换行再拼 ——
    # 否则 banner 会被挤到 `:root {` 那一行上（实测贴成 `:root {  /* …`）
    return '\n' + block + light_replaced(light, {n for n, _v in colors}), colors


def light_replaced(light, names):
    """把 light 里属于 `names` 的语义行的值换成 var(--raw-*)，其余原样。

    逐行处理 + 跟踪注释状态：本文件里大段注释举着旧配色当例子，
    正则整体替换会把注释也改掉（改了不影响行为，但会把证据弄脏）。
    """
    lines = light.split('\n')
    in_comment = False
    out = []
    for ln in lines:
        stripped = ln.strip()
        if in_comment:
            if '*/' in stripped:
                in_comment = False
            out.append(ln)
            continue
        if stripped.startswith('/*') and '*/' not in stripped:
            in_comment = True
            out.append(ln)
            continue
        if stripped.startswith('/*') or stripped.startswith('*'):
            out.append(ln)
            continue
        m = re.match(r'^(\s*)(--[a-z0-9-]+)(\s*:\s*)([^;]+)(;)(.*)$', ln, re.I)
        if m and m.group(2) in names:
            indent, name, sep, _v, semi, rest = m.groups()
            out.append('%s%s%svar(%s%s)%s%s'
                       % (indent, name, sep, RAW_PREFIX, name[2:], semi, rest))
            continue
        out.append(ln)
    return '\n'.join(out)


def rewrite_dark(dark):
    """暗色 `:root` 内部：语义名加 `--raw-` 前缀，值不动。"""
    lines = dark.split('\n')
    in_comment = False
    out = []
    n = 0
    for ln in lines:
        stripped = ln.strip()
        if in_comment:
            if '*/' in stripped:
                in_comment = False
            out.append(ln)
            continue
        if stripped.startswith('/*') and '*/' not in stripped:
            in_comment = True
            out.append(ln)
            continue
        if stripped.startswith('/*') or stripped.startswith('*'):
            out.append(ln)
            continue
        m = re.match(r'^(\s*)(--[a-z0-9-]+)(\s*:\s*)([^;]+)(;)(.*)$', ln, re.I)
        if m and not m.group(2).startswith(RAW_PREFIX) \
                and RE_COLOR.match(m.group(4).strip()):
            indent, name, sep, value, semi, rest = m.groups()
            out.append('%s%s%s%s%s%s%s'
                       % (indent, RAW_PREFIX, name[2:], sep, value, semi, rest))
            n += 1
            continue
        out.append(ln)
    return '\n'.join(out), n


def apply(css):
    lstart, lend = light_root_range(css)
    light = css[lstart:lend]
    colors = iter_color_decls(light)
    if not colors:
        return css, []

    new_light, colors = rewrite_light(light)

    dstart, dend, _media_end = split_sections(css)
    dark = css[dstart:dend]
    new_dark, ndark = rewrite_dark(dark)

    out = css[:lstart] + new_light + css[lend:dstart] + new_dark + css[dend:]
    return out, colors


def check(css):
    """五条结构判据。返回问题列表。"""
    problems = []
    lstart, lend = light_root_range(css)
    light = css[lstart:lend]
    l2 = [(n, v) for n, v in
          ((x, y.strip()) for x, y, _ in parse_decls(light) if x.startswith('--'))
          if not n.startswith(RAW_PREFIX)]
    raw = [n for n in
           (x for x, _y, _z in parse_decls(light) if x.startswith('--'))
           if n.startswith(RAW_PREFIX)]

    # ① 语义名 = 颜色字面量 ⇒ 红
    for name, value in l2:
        if RE_COLOR.match(value):
            problems.append(
                '① `:root` 里 `%s: %s;` —— 颜色字面量必须只在 L1（`%s%s`），'
                '语义层只写 `var(...)`。'
                '\n      跑 `python 05-audit/layer-tokens.py` 分层。'
                % (name, value, RAW_PREFIX, name[2:]))

    # ② 每个 L1 必须被至少一个 L2 引用
    # 🔴 只抓 `var(--raw-*)`：语义令牌引用**别的**令牌是合法的
    #    （`--popover-p: var(--sp-3)` 引的是间距令牌，不属于 L1 的事）。
    #    第一版抓所有 `var(--x)`，于是把 `--sp-3` 报成"引用了不存在的 L1" ——
    #    判据口径必须与"我在检查什么"严格对齐，宽一格就是假红。
    refs = set()
    for _name, value in l2:
        for m in re.finditer(r'var\(\s*(--raw-[a-z0-9-]+)\s*[,)]', value, re.I):
            refs.add(m.group(1))
    for r in sorted(set(raw) - refs):
        problems.append('② L1 令牌 `%s` 没有任何 L2 引用 —— 死重量' % r)

    # ③ L2 引用的 L1 必须存在
    for r in sorted(refs - set(raw)):
        problems.append('③ L2 引用了不存在的 L1 令牌 `%s` —— `var()` 会静默失效' % r)

    # ④ 暗色段只许出现 L1
    dstart, dend, _e = split_sections(css)
    dark = css[dstart:dend]
    for name, value, _rest in parse_decls(dark):
        if not name.startswith('--'):
            continue
        if not name.startswith(RAW_PREFIX):
            problems.append(
                '④ 暗色段出现语义令牌 `%s` —— 暗色只该覆盖 L1，'
                '语义层是 var() 引用会自动跟随。\n'
                '      写语义令牌等于又回到"要写两遍、漏一个就静默错"的老路。'
                % name)
        elif RE_COLOR.match(value.strip()) is None:
            problems.append('④ 暗色段 `%s` 的值不是颜色字面量：`%s`'
                            % (name, value.strip()))

    # ⑤ 1:1 对应
    l2names = {n[2:] for n, _v in l2 if any(
        r == RAW_PREFIX + n[2:] for r in refs)}
    rawnames = {n[len(RAW_PREFIX):] for n in raw}
    for n in sorted(l2names - rawnames):
        problems.append('⑤ L2 `--%s` 对应的 `--raw-%s` 不存在' % (n, n))
    for n in sorted(rawnames - l2names):
        problems.append('⑤ L1 `--raw-%s` 没有对应的语义令牌 `--%s`' % (n, n))
    return problems


def main():
    argv = sys.argv[1:]
    css = io.open(TOK, encoding='utf-8').read()

    if '--selftest' in argv:
        return selftest(css)

    if '--check' in argv:
        probs = check(css)
        if probs:
            print('  [FAIL] %d 处不符合分层结构' % len(probs))
            for p in probs[:8]:
                print('    · ' + p)
            if len(probs) > 8:
                print('    … 另有 %d 处' % (len(probs) - 8))
            return 1
        lstart, lend = light_root_range(css)
        light = css[lstart:lend]
        nraw = len([x for x, _y, _z in parse_decls(light) if x.startswith(RAW_PREFIX)])
        ncolor = len(iter_color_decls(light))
        print('  [OK] 颜色令牌分两层：L1 %d 个 / 语义层直写颜色 %d 个（应为 0）；'
              '暗色段只覆盖 L1' % (nraw, ncolor))
        return 0

    # 执行
    if not check(css) and iter_color_decls(css[light_root_range(css)[0]:
                                               light_root_range(css)[1]]) == []:
        # 已分层且结构合法
        print('  已是分层结构，无需改动（跑 --check 校验）')
        return 0

    new, colors = apply(css)
    if not colors:
        print('  [FAIL] 没找到任何颜色令牌，什么也没做')
        return 1
    io.open(TOK, 'w', encoding='utf-8', newline='\n').write(new)
    print('  已分层：%d 个颜色令牌 → `--raw-*`' % len(colors))
    probs = check(new)
    if probs:
        print('  🔴 分层后结构校验不通过（%d 处）' % len(probs))
        for p in probs[:6]:
            print('    · ' + p)
        return 1
    print('  结构校验通过')
    return 0


def selftest(css):
    """反向控制：每条判据都要能被注入的坏样本打红。"""
    print('  === layer-tokens 反向控制 ===')
    ok = True

    def run(why, probe, should_fail):
        nonlocal ok
        probs = check(probe)
        got = bool(probs)
        good = (got == should_fail)
        ok = ok and good
        print('  [%s] %-30s 期望%s ⇒ 实际%s'
              % ('OK ' if good else 'FAIL', why,
                 '红' if should_fail else '绿', '红' if got else '绿'))
        if not good:
            for p in probs[:2]:
                print('       ' + p.replace('\n', ' ')[:120])

    # 原样必须绿
    run('原样（已分层）', css, False)

    # ① 语义名又写成字面量
    lstart, lend = light_root_range(css)
    light = css[lstart:lend]
    first = None
    for name, value, _n in parse_decls(light):
        if name.startswith(RAW_PREFIX):
            continue
        if re.match(r'^var\(--raw-', value.strip()):
            first = (name, value)
            break
    if first is None:
        print('  [FAIL] 自检前提不成立：找不到形如 `X: var(--raw-X)` 的语义行')
        return 1
    # 🔴 必须用**正则**替换，不能拼 `'%s: %s'` 去 replace：
    #    原文是 `--paper:            var(--raw-paper);`（冒号后十几个空格对齐），
    #    拼出来的 `--paper: var(--raw-paper)` 匹配不上 ⇒ replace 静默不生效
    #    ⇒ "期望红 ⇒ 实际绿"。所有 fixture 都要断言"确实改了东西"。
    body1 = re.sub(
        r'(\n\s*' + re.escape(first[0]) + r'\s*:\s*)var\(--raw-[a-z0-9-]+\)',
        r'\1#123456', light, count=1)
    if body1 == light:
        print('  [FAIL] 自检样本失效：没能把 `%s` 的值改成字面量' % first[0])
        return 1
    run('① 语义名直写颜色', css[:lstart] + body1 + css[lend:], True)

    # ② L1 死活没人引用：把一个 raw 名改掉，让对应 L2 引用落空
    rawname = None
    for name, _v, _n in parse_decls(light):
        if name.startswith(RAW_PREFIX):
            rawname = name
            break
    body2 = light.replace(rawname + ':', '--raw-unused-probe:', 1)
    # 语义层引用不变 ⇒ ③ 应红（引用不存在的 L1）；同时原 raw 名消失 ⇒ ①
    run('② L1 改名后引用落空', css[:lstart] + body2 + css[lend:], True)

    # ③ 引用一个不存在的 L1
    body3 = light.replace('var(%s)' % rawname, 'var(--raw-nope)', 1)
    run('③ 引用不存在的 L1', css[:lstart] + body3 + css[lend:], True)

    # ④ 暗色段写语义令牌
    dstart, dend, _e = split_sections(css)
    dark = css[dstart:dend]
    m = re.search(r'(--raw-[a-z0-9-]+)(\s*:)', dark)
    # 🔴 第一版写成 `m.group(1)[len(RAW_PREFIX):]` —— 那会把 `--raw-accent`
    #    变成 `accent`（`--` 一起被切掉了），得到一条**非法声明** `accent: …;`
    #    ⇒ 门禁当然不报 ④（它压根不是自定义属性），于是"期望红 ⇒ 实际绿"。
    #    正确是 `--` + 去掉 `--raw-` 的部分。
    semantic = '--' + m.group(1)[len(RAW_PREFIX):]
    body4 = css[:dstart] + dark.replace(m.group(1), semantic, 1) + css[dend:]
    run('④ 暗色段写语义令牌', body4, True)

    # ⑤ L1 多于 L2：加一个没人引用的 raw
    body5 = light.replace('  --raw-', '  --raw-zzz-probe: #abc;\n  --raw-', 1)
    run('⑤ 多出一个孤儿 L1', css[:lstart] + body5 + css[lend:], True)

    print('\n  结论：%s' % ('五条判据都有牙' if ok else '🔴 有判据形同虚设'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
