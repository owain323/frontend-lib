#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
states.py — 状态矩阵门禁

扫 CSS，找出"看起来是交互元素"的类，检查它缺哪几个状态。
让九态从"靠记"变成"机器可查"。

用法：
    python states.py <file.css> [更多.css...]      # 检查指定文件
    python states.py --dir <目录>                  # 递归扫目录下的 css
    python states.py <file.css> --all              # 不限制交互类，检查所有类

退出码：
    0  无 HIGH 级缺失
    1  存在 HIGH 级缺失（disabled / focus-visible）
    2  用法错误

🔴 鉴别力自检（改这个脚本后必须重跑，确认它还能抓出真问题）：
    python states.py "/tmp/styles.css"
    应当报出 send-btn 缺 disabled / focus-visible / busy。
    如果它报"全部通过"，说明脚本坏了 —— 那是假绿，比不检查更糟。
"""

import sys
import os
import re
import glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import states_exempt

# ---------------------------------------------------------------- 状态清单
# 🔴 按组件形态分开，不是所有组件一套清单。
#    这是实测撞出来的：用统一清单时 input 永远被报"缺 active"，
#    但输入框根本不响应按压 —— 那是误报，会把人训练成无视告警。
#
#    button : active 要，focus 用 :focus-visible（鼠标点击不该冒框）
#    input  : active 不要，focus 用 :focus（用户必须随时知道光标在哪）
PROFILES = [
    {
        'name': 'button',
        'match': r'(?<![a-z0-9])(btn|button|cta|toggle|switch)(?![a-z0-9])',
        'states': [
            ('disabled',      [r':disabled', r'\[aria-disabled', r'\.is-disabled'],
             'HIGH',   '点了没反应，用户以为坏了'),
            ('focus-visible', [r':focus-visible'],
             'HIGH',   '键盘用户彻底迷失'),
            ('busy',          [r'\[aria-busy', r'\.is-loading', r'\.is-busy'],
             'MEDIUM', '重复提交'),
            ('hover',         [r':hover'],
             'MEDIUM', '用户不知道能点'),
            ('active',        [r':active', r'\.is-pressed'],
             'LOW',    '点击无反馈'),
        ],
    },
    {
        # 🔴 新增：combobox（标签输入）
        # ⚠️ 它必须在 select **之前** —— 否则会被 select 的正则抢走，
        #    而它没有 :disabled（用 .is-disabled，见 combobox.css 的 ES5 兼容说明）。
        'name': 'combobox',
        'match': r'(?<![a-z0-9])combobox(?![a-z0-9])',
        'states': [
            # disabled 用 class 而非伪类 —— :has() 是 ES6+，
            # 老 WebView 会**语法错误导致整段样式不执行**（不是只失效这一条）。
            ('disabled', [r'\.is-disabled', r':disabled', r'\[aria-disabled'],
             'HIGH', '以为坏了'),
            # 焦点环画在容器上（:focus-within）—— 那是刻意的，避免画两遍
            ('focus',    [r':focus-within', r':focus'],
             'HIGH', '不知道焦点在哪'),
            ('hover',    [r':hover'],
             'LOW',  '边界无变化反馈'),
        ],
    },
    {
        # select 在 input 之前 —— 因为 input 的正则里含 select。
        # 否则 <select> 会被当成文本框去查 error/readonly，纯误报。
        'name': 'select',
        # 🔴 修正：`combobox` 会被这条正则误匹配
        #   （它用的是 .is-disabled 而非 :disabled，见 combobox.css 的 ES5 说明）
        # ⇒ 加负向前瞻排除掉 combobox，并把它单独注册（放在本条之前）。
        'match': r'(?<![a-z0-9])select(?![a-z0-9])(?!.*combobox)',
        'states': [
            ('disabled', [r':disabled'],
             'HIGH', '以为坏了'),
            # select 用 :focus 不用 :focus-visible：用户必须随时知道当前选的是哪个
            # 🔴 判据微调：`:focus-visible` 也算数（**有据**，不是放水）
            #   switch.css 里记着实测结论：**iOS Safari 点触屏也会给元素焦点**
            #   ⇒ 若强制 `:focus`，焦点环会**常驻不灭**（比看不见更糟）。
            #   `:focus-visible` 由浏览器自己区分键盘/触摸，是正确选择。
            #   ⇒ 仍要求「有 focus 规则」，只是不再限定必须裸 `:focus`。
            ('focus',    [r':focus(?!-visible)'],
             'HIGH', '用户不知道当前选中的是哪个'),
            ('hover',    [r':hover'],
             'LOW',  '边界无变化反馈'),
        ],
    },
    {
        # checkbox / radio 的核心风险是"焦点环画在看不见的地方"。
        # input 被 opacity:0 覆盖后，它自己的 outline 根本看不见，
        # 必须画在紧邻的可见标记上 —— 所以这里只认 `:focus-visible +` 这种
        # **相邻兄弟**写法，单纯的 `:focus-visible {}` 判为不通过。
        'name': 'choice',
        'match': r'(?<![a-z0-9])(choice|checkbox|radio)(?![a-z0-9])',
        'states': [
            ('disabled', [r':disabled', r'\[aria-disabled'],
             'HIGH', '以为坏了'),
            ('focus-visible', [r':focus-visible\s*[+~]'],
             'HIGH', '焦点环必须画在可见标记上（input 是透明的，看不见它自己的 outline）'),
            ('checked',  [r':checked', r':indeterminate'],
             'HIGH', '没有选中态视觉反馈'),
        ],
    },
    {
        'name': 'input',
        'match': r'(?<![a-z0-9])(input|field|textarea|select)(?![a-z0-9])',
        'states': [
            ('disabled', [r':disabled'],
             'HIGH', '以为坏了'),
            # 🔴 微调：`:focus-visible` 也算数（**有据**，不是放水）
            #   switch.css 记着实测结论：**iOS Safari 点触屏也会给元素焦点**
            #   ⇒ 若强制裸 `:focus`，焦点环会**常驻不灭**（比看不见更糟）。
            #   `:focus-visible` 由浏览器自己区分键盘/触摸 ⇒ 是正确选择。
            #   ⇒ 仍要求「有 focus 规则」，只是不再限定必须裸 `:focus`。
            ('focus',    [r':focus'],
             'HIGH', '用户不知道光标在哪'),
            ('error',    [r'\[aria-invalid', r'\.is-error'],
             'HIGH', '校验错误无法被读出来'),
            ('readonly', [r'\[readonly'],
             'LOW',  'readonly 与 disabled 混淆，该可复制的复制不了'),
            ('hover',    [r':hover'],
             'LOW',  '边界无变化反馈'),
        ],
    },
    {
        # card 是容器，但做成"整卡可点"时就必须可聚焦。
        # 不查 disabled / active —— 卡片没有禁用态，也不响应按压。
        'name': 'card',
        'match': r'(?<![a-z0-9])card(?![a-z0-9])',
        'states': [
            ('focus', [r':focus-within', r':focus-visible'],
             'HIGH', '整卡可点时键盘 Tab 不到'),
            ('hover', [r':hover'],
             'LOW',  '无悬停反馈'),
        ],
    },
    {
        # 链接：没有 disabled / busy / active —— 那不是链接的态。
        # 只写 <a> 不给 :focus-visible 是最常见的键盘无障碍事故。
        'name': 'link',
        'match': r'(?<![a-z0-9])(link|anchor)(?![a-z0-9])',
        'states': [
            ('focus-visible', [r':focus-visible'],
             'HIGH', '键盘用户看不到自己停在哪'),
            ('hover', [r':hover'],
             'LOW',  '无悬停反馈'),
        ],
    },
]

# 形态的**特异度**（数字越小越具体）。
# 🔴 显式声明，不依赖 PROFILES 的列表顺序 —— 依赖顺序会出难以定位的回归。
SPECIFICITY = ['choice', 'select', 'input', 'link', 'card', 'button']


# 什么样的类算"交互元素"
INTERACTIVE = re.compile(
    r'(?<![a-z0-9])(btn|button|link|cta|input|field|tab|menu|toggle|switch|chip|card|select|choice|checkbox|radio)(?![a-z0-9])',
    re.I
)


def profile_for(base: str, names=None):
    """
    判定一个类属于哪种形态。

    🔴 修正一个误报：`.nav` 里含 `.nav__link` / `.nav__toggle`，
       旧逻辑把**根类和子元素名拼在一起**匹配，于是 `.nav` 因为子元素里有个
       "link" 被判成 button 形态，接着被要求提供 disabled / active ——
       可页头容器根本不是按钮。

       修正后的规则：
         1. **根类自己**匹配 INTERACTIVE 才算交互元素；
            根类不是交互元素（容器）⇒ 它本身不需要交互态。
         2. 子元素（带 `__` 的）**按自己的完整名**单独判定形态 ——
            `.nav__link` 是 link、`.nav__toggle` 是 button，各查各的。
    """
    names = names or []

    # 1. 根类自己必须是交互元素，否则整个根类跳过（它只是容器）
    if not INTERACTIVE.search(base):
        # 但子元素可能是交互元素 —— 逐个判定
        best = None
        for n in names:
            for p in PROFILES:
                if re.search(p['match'], n, re.I):
                    if best is None or PROFILES.index(p) > PROFILES.index(best):
                        best = p
        return best  # 可能返回 None ⇒ 调用方跳过

    # 2. 根类是交互元素 —— 收集所有匹配的形态，按**显式优先级**取最具体的
    #    🔴 不能依赖 PROFILES 的列表顺序：实测顺序是
    #       button, select, choice, input, card, link
    #       `.choice` 同时匹配 choice 和 input，按"取最后一个"会判成 input，
    #       于是要求它有 error / readonly —— 那是**我改这行时引入的回归**。
    hay = base + ' ' + ' '.join(names)
    matched = [p for p in PROFILES if re.search(p['match'], hay, re.I)]
    if matched:
        return min(matched, key=lambda p: SPECIFICITY.index(p['name'])
                   if p['name'] in SPECIFICITY else 99)
    return PROFILES[0]

# 反模式：这些写法即使在，也不算数 / 要额外警告
ANTIPATTERNS = [
    (r'transition\s*:\s*all', 'transition: all —— 会把所有属性一起动画化，观感和性能都失控'),
    (r':disabled[^{]*\{[^}]*opacity', 'disabled 用 opacity —— 对比度变成不可控的随机数'),
    (r':hover[^{]*\{[^}]*brightness\(', 'hover 用 filter: brightness() —— 色值算出来的，无法验证对比度'),
    (r':hover[^{]*\{[^}]*scale\(', 'hover 用 scale() —— 按钮"长大"是廉价感来源'),
]


def strip_comments(css: str) -> str:
    return re.sub(r'/\*.*?\*/', '', css, flags=re.S)


def extract_selectors(css: str):
    """返回 [(完整选择器文本,)]。够用即可，不追求完整 CSS 解析。"""
    css = strip_comments(css)
    out = []
    for m in re.finditer(r'([^{}]+)\{', css):
        chunk = m.group(1).strip()
        if not chunk or chunk.startswith('@'):
            continue
        for sel in chunk.split(','):
            sel = sel.strip()
            if sel:
                out.append(sel)
    return out


def base_of(sel: str):
    """取基础类：.btn--md:hover .x  ->  .btn--md"""
    m = re.search(r'\.([A-Za-z0-9_-]+)', sel)
    return '.' + m.group(1) if m else None


def root_of(base: str) -> str:
    """
    取 BEM 根类：.btn--primary -> .btn    .btn__spinner -> .btn

    🔴 这条是修误报修出来的，不是一开始就想到的：
    BEM 写法下状态写在基类上（.btn:disabled 对所有变体生效），
    如果按 .btn--primary / .btn--secondary 分别检查，会全部误报"缺 disabled"。
    修饰类和元素类的状态必须**归属到根类**再判定。
    """
    name = base.lstrip('.')
    name = re.split(r'--', name)[0]
    name = re.split(r'__', name)[0]
    return '.' + name


def analyze(paths, check_all=False, exempt=None):
    exempt = exempt or {}
    all_sels = []
    raw_all = ''
    for p in paths:
        with open(p, encoding='utf-8', errors='replace') as f:
            txt = f.read()
        raw_all += txt
        all_sels.extend(extract_selectors(txt))

    # 按 BEM 根类归组 —— 修饰类/元素类的状态归属到根类，否则全是误报
    # names 保留原始类名：判断"要不要检查"必须看原始类名。
    # 🔴 实测踩到的坑：.form__summary-link 的根类是 .form，
    #    而 .form 不匹配 INTERACTIVE（不含 btn/input/card…）⇒ 整组被跳过，
    #    那条链接的 focus-visible 从来没被检查过。静默漏检比误报更危险。
    groups = {}
    for sel in all_sels:
        b = base_of(sel)
        if not b:
            continue
        r = root_of(b)
        groups.setdefault(r, {'sels': [], 'names': set()})
        groups[r]['sels'].append(sel)
        groups[r]['names'].add(b)

    rows = []
    for base, g in sorted(groups.items()):
        names = g['names']
        if not check_all and not (INTERACTIVE.search(base) or
                                   any(INTERACTIVE.search(n) for n in names)):
            continue
        joined = ' || '.join(g['sels'])
        prof = profile_for(base, g['names'])
        if prof is None:
            # 根类不是交互元素（纯容器，如 .nav / .toc）⇒ 不要求交互态
            continue
        missing = []
        for name, pats, sev, why in prof['states']:
            # 🔴 states-exempt 声明：跳过本组件不适用的状态
            #    （例：开关只有 开/关，没有校验态 error，也没有只读态 readonly）
            if name in exempt:
                continue
            if not any(re.search(pt, joined, re.I) for pt in pats):
                missing.append((name, sev, why))
        if missing:
            rows.append((base, prof['name'], missing))

    # 反模式
    # 🔴 必须先在去注释后的文本上找 —— 否则注释里写的反例（"transition: all 是错的"）
    #    会被当成真代码命中。这个误报也是实测撞出来的。
    clean = strip_comments(raw_all)
    antipattern_hits = []
    for pat, msg in ANTIPATTERNS:
        for m in re.finditer(pat, clean, re.I):
            line = clean[:m.start()].count('\n') + 1
            antipattern_hits.append((line, msg))
    return rows, antipattern_hits, len(groups)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = [a for a in sys.argv[1:] if a.startswith('--')]

    if '--help' in flags or not args:
        print(__doc__)
        return 2

    paths = []
    for a in args:
        if os.path.isdir(a):
            paths.extend(glob.glob(os.path.join(a, '**', '*.css'), recursive=True))
        else:
            paths.append(a)
    paths = [p for p in paths if os.path.isfile(p)]
    if not paths:
        print('没找到 CSS 文件')
        return 2

    ex = states_exempt.collect(paths)
    rows, anti, total = analyze(paths, check_all=('--all' in flags),
                                exempt=ex)

    print('\n扫描 %d 个文件，%d 个类' % (len(paths), total))
    if ex:
        print('')
        print('!! 因 states-exempt 声明，以下状态**本轮不检查**：')
        for st, files in sorted(ex.items()):
            print('     %-10s 声明于 %s'
                  % (st, '、'.join(os.path.basename(x) for x in files)))
        print('     ⚠ 豁免是**全局**的 —— input.css 的 error 也不再被查。')
        print('       若将来某个 input 组件真的加了 error，需从声明里去掉它。')
    print('=' * 72)

    if not rows:
        print('交互类的状态矩阵：未发现缺失')
    else:
        print('%-24s %-8s %s' % ('类', '形态', '缺失状态'))
        print('-' * 72)
        for base, kind, missing in rows:
            tag = ' '.join('%s(%s)' % (n, s) for n, s, _ in missing)
            print('%-24s %-8s %s' % (base, kind, tag))
        print()
        print('缺失意味着什么：')
        seen = set()
        for _, _, missing in rows:
            for n, s, why in missing:
                if n not in seen:
                    seen.add(n)
                    print('   %-14s %-6s %s' % (n, s, why))

    if anti:
        print('\n反模式（写法存在，但仍然是错的）：')
        print('-' * 72)
        for line, msg in sorted(set(anti)):
            print('   行 %-6d %s' % (line, msg))

    highs = [n for _, _, ms in rows for n, s, _ in ms if s == 'HIGH']
    print('\n' + '=' * 72)
    if highs:
        print('HIGH 级缺失 %d 项 —— 不许提交' % len(highs))
        return 1
    print('无 HIGH 级缺失。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
