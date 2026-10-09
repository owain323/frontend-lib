#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
gen-tokens-tree.py — 第二种令牌导出：`ai/tokens.tree.json`（M5）

============================================================================
🔴 为什么要有第二种
----------------------------------------------------------------------------
  已有的 `ai/tokens.json` 是 **DTCG 草案形状**、按键名平铺：

      { "sets": { "light": { "--paper": { "$value": ..., "$type": ... } } } }

  它对"想读令牌的人"很好，对**工具链**不好：Style Dictionary / Figma Tokens
  （Tokens Studio）要的是**按类别分组的层级结构**和**不带 `--` 前缀的键名**：

      { "color": { "paper": { "value": ..., "type": ... } } }

  更关键的是 `$value` vs `value`：DTCG 用 `$` 前缀，而 Style Dictionary 与
  Tokens Studio 认的是**不带 `$`** 的。同一个文件喂不进两套工具 ——
  ⇒ 两种形状各出一份，`index` 段把两种键名互相对应起来。

  （对标 Open Props：它同时发 CSS、分品类 CSS、JSON、Figma 库。）

============================================================================
为什么它必须挂到浏览器 CSSOM 上复核
----------------------------------------------------------------------------
  本文件是**生成物**。生成物跟"再生成一遍"比 ⇒ 等于自己跟自己对答案，
  不引入任何新信息（docs/INVARIANT.md I-10 实证 9，0.7.1 真踩过）。

  ⇒ `token-tree-gate.py` 判据 ⑤ 把导出的**每一个名字与每一个值**
    拿到真浏览器里，用 **Chrome 自己的 CSS 解析器**（CSSOM）重新读一遍再比。
    这根桩是独立的：它走的是浏览器的词法/语法分析，不是本文件的正则。
    （"孤儿注释收尾符把下一行吃掉"那一类 bug，只有这根桩抓得到。）

============================================================================
用法
----------------------------------------------------------------------------
  python 05-audit/gen-tokens-tree.py            # 生成
  python 05-audit/gen-tokens-tree.py --check    # 只校验是否与源码一致
============================================================================
"""
import io
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
SRC = os.path.join(ROOT, '01-tokens', 'tokens.css')
OUT = os.path.join(ROOT, 'ai', 'tokens.tree.json')

RE_ROOT = re.compile(r':root\s*\{')
RE_DARK = re.compile(r'@media[^{]*prefers-color-scheme:\s*dark[^{]*\{')
RE_DECL = re.compile(r'(--[a-z0-9-]+)\s*:\s*([^;{}]+);')
RE_COMMENT = re.compile(r'/\*.*?\*/', re.S)

# ---------------------------------------------------------------- 分类
# ⚠️ 四条表必须**穷尽**：落在表外的令牌会让门禁红（新令牌必须显式归类）。

EXPLICIT = {
    '--sans': 'fontFamily/sans',
    '--mono': 'fontFamily/mono',
    '--serif': 'fontFamily/serif',
    '--progress': 'number/progress',
    '--progress-num': 'number/progress-num',
    '--skeleton-duration': 'duration/skeleton',
    '--popover-dur': 'duration/popover',
    '--progress-dur': 'duration/progress',
}

COLOR = {
    '--paper', '--surface', '--surface-sunken', '--surface-raised',
    '--text-primary', '--text-secondary', '--text-tertiary',
    '--text-on-accent', '--text-on-solid',
    '--accent', '--accent-hover', '--accent-soft',
    '--danger', '--danger-hover', '--danger-bg',
    '--success', '--success-bg',
    '--warning', '--warning-bg',
    '--info', '--info-bg',
    '--border-control', '--border-decor', '--border-decor-str',
    '--switch-on', '--scrim',
    '--skeleton-bg', '--skeleton-shimmer',
    '--scrollbar-thumb', '--scrollbar-thumb-hov',
}

SIZE = {
    '--ring-size', '--ring-thickness',
    '--scrollbar-size', '--scrollbar-size-thin', '--scrollbar-radius',
    '--popover-min-w', '--popover-max-w', '--popover-p', '--popover-gap',
    '--progress-h', '--skeleton-h', '--skeleton-size',
}

# 阶梯族：键名去掉族前缀，剩下的就是档位名
SCALE = [
    ('--bp-', 'breakpoint'),
    ('--dur-', 'duration'),
    ('--ease-', 'easing'),
    ('--fs-', 'fontSize'),
    ('--lh-', 'lineHeight'),
    ('--tracking-', 'letterSpacing'),
    ('--r-', 'radius'),
    ('--sp-', 'space'),
    ('--z-', 'zIndex'),
    ('--shadow-', 'shadow'),
    ('--lift-', 'lift'),     # ⚠️ 是 translate 的**位移量**，不是阴影（见 tokens.css 注释）
    ('--measure-', 'measure'),
    ('--sz-', 'size'),
]

# 类别 ⇒ 允许的值类型（判据会卡这一对，防"分错类"）
ALLOWED = {
    'color': ('color',),
    'space': ('dimension',),
    'radius': ('dimension',),
    'size': ('dimension', 'alias'),
    'fontSize': ('dimension',),
    'lineHeight': ('number',),
    'letterSpacing': ('dimension', 'number'),
    'fontFamily': ('fontFamily',),
    'measure': ('dimension',),
    'duration': ('duration',),
    'easing': ('cubicBezier',),
    'zIndex': ('number',),
    'breakpoint': ('dimension',),
    'shadow': ('shadow',),
    'lift': ('dimension',),
    'number': ('number', 'percentage'),
}


def path_of(name):
    """令牌名 ⇒ 'color/paper' 这样的路径。表外 ⇒ 抛出（门禁会抓到）。"""
    if name in EXPLICIT:
        return EXPLICIT[name]
    if name in COLOR:
        return 'color/' + name[2:]
    if name in SIZE:
        return 'size/' + name[2:]
    for pre, cat in SCALE:
        if name.startswith(pre):
            return cat + '/' + name[len(pre):]
    raise KeyError(name)


def guess_type(v):
    """从**值**推类型（不看名字）—— 名字负责分类，值负责定型，两边要互相印证。"""
    if v.startswith('var('):
        return 'alias'
    if v.startswith('cubic-bezier('):
        return 'cubicBezier'
    if re.match(r'^(#|rgba?\(|hsla?\()', v) and 'px' not in v:
        return 'color'
    if 'rgba(' in v or 'rgb(' in v:
        return 'shadow'          # 阴影是「偏移量 + rgba()」，含 px ⇒ 不是纯色
    if re.match(r'^-?\d+(\.\d+)?$', v):
        return 'number'
    if re.match(r'^\d+(\.\d+)?(ms|s)$', v):
        return 'duration'
    if v.endswith('%'):
        return 'percentage'
    if v.startswith('clamp(') or re.search(r'\d(px|rem|em|ch|vw|vh)([^a-z]|$)', v):
        return 'dimension'
    if ',' in v and re.search(r'[A-Za-z]', v):
        return 'fontFamily'
    return 'other'


# ---------------------------------------------------------------- 解析

def norm(v):
    """折叠空白用于比对 —— **引号内的空白不折叠**（字体名里的空格是有意义的）。

    ⚠️ 为什么需要它：CSSOM 保留自定义属性值的**原始**空白（不归一化），
       而导出的值应是可读的（tokens.css 为了对齐塞了很多空格、字体栈还换行）。
       两边都过一遍 norm 才可比。
    """
    out = []
    q = None
    i = 0
    n = len(v)
    while i < n:
        ch = v[i]
        if q:
            out.append(ch)
            if ch == q:
                q = None
            i += 1
        elif ch in '"\'':
            q = ch
            out.append(ch)
            i += 1
        elif ch.isspace():
            while i < n and v[i].isspace():
                i += 1
            if out:
                out.append(' ')
        else:
            out.append(ch)
            i += 1
    return ''.join(out).strip()


def strip_comments(css):
    """⚠️ 值里也可能有注释（`--mono: /* 拉丁等宽 */ ui-monospace, ...`）。
       浏览器的词法分析会把它丢掉 ⇒ 导出也必须丢，否则跟浏览器对不上。"""
    return RE_COMMENT.sub('', css)


def block_body(css, i):
    """从 `{` 的位置 i 开始取块体（配对大括号）"""
    depth = 0
    for j in range(i, len(css)):
        if css[j] == '{':
            depth += 1
        elif css[j] == '}':
            depth -= 1
            if depth == 0:
                return css[i + 1:j], j
    return css[i + 1:], len(css)


def decls(body):
    out = []
    for m in RE_DECL.finditer(body):
        out.append((m.group(1), norm(m.group(2))))
    return out


def collect_light(css):
    """浅色 = 只认**裸** `:root {`（`:root:lang(ar)` / `:root[data-theme=...]`
       是条件覆盖，不算基准值）。先出现的为准。"""
    res = {}
    for m in RE_ROOT.finditer(css):
        body, _ = block_body(css, m.end() - 1)
        for n, v in decls(body):
            res.setdefault(n, v)
    return res


def collect_dark(css):
    res = {}
    for m in RE_DARK.finditer(css):
        inner, _ = block_body(css, m.end() - 1)
        for n, v in decls(inner):
            res.setdefault(n, v)
    return res


def build_set(pairs):
    """{name: value} ⇒ 层级 dict + index"""
    tree = {}
    index = {}
    problems = []
    for name in sorted(pairs):
        try:
            path = path_of(name)
        except KeyError:
            problems.append('令牌「%s」没有归类 —— 新令牌必须显式加进 EXPLICIT / '
                            'COLOR / SIZE / SCALE 四张表之一' % name)
            continue
        cat, leaf = path.split('/', 1)
        typ = guess_type(pairs[name])
        if typ not in ALLOWED.get(cat, ()):
            problems.append('令牌「%s」归类为 %s，但它的值看起来是 %s（%s）⇒ 分错类了'
                            % (name, cat, typ, pairs[name][:40]))
        tree.setdefault(cat, {})[leaf] = {'value': pairs[name], 'type': typ}
        index[name] = path
    return tree, index, problems


def build():
    css = strip_comments(io.open(SRC, encoding='utf-8').read())
    light = collect_light(css)
    dark = collect_dark(css)
    ltree, lindex, p1 = build_set(light)
    dtree, dindex, p2 = build_set(dark)
    problems = p1 + p2
    doc = {
        'schemaVersion': '1.0.0',
        'source': '01-tokens/tokens.css',
        'generatedBy': '05-audit/gen-tokens-tree.py',
        '$comment': (
            '第二种令牌导出：**分层、无 -- 前缀、键名用 value/type（不带 $）**，'
            '供 Style Dictionary / Figma Tokens（Tokens Studio）直接消费。'
            '第一种（ai/tokens.json）是 DTCG 形状、键名带 -- 与 $，给"读令牌的人"。'
            'index 段把两种键名互相对应。⚠️ 本文件是生成物，不要手改；'
            '它的正确性由 token-tree-gate.py 挂到**浏览器 CSSOM** 上复核。'
        ),
        'sets': {'light': ltree, 'dark': dtree},
        'index': lindex,
        'meta': {
            'lightCount': len(light),
            'darkCount': len(dark),
            'categories': sorted(set(list(ltree) + list(dtree))),
        },
    }
    return doc, problems


def dump(doc):
    return json.dumps(doc, ensure_ascii=False, indent=2, sort_keys=False) + '\n'


def main():
    doc, problems = build()
    if problems:
        print('  ❌ 生成时发现问题：')
        for p in problems:
            print('     ' + p)
        sys.exit(1)
    text = dump(doc)
    if '--check' in sys.argv:
        if not os.path.isfile(OUT):
            print('  [FAIL] ai/tokens.tree.json 不存在 —— 跑一次生成器')
            sys.exit(1)
        cur = io.open(OUT, encoding='utf-8').read()
        if cur != text:
            print('  [FAIL] ai/tokens.tree.json 与源码不一致 —— 改了源码就要重新生成')
            sys.exit(1)
        print('  [OK] ai/tokens.tree.json 与源码一致')
        sys.exit(0)
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(text)
    m = doc['meta']
    print('  已生成 ai/tokens.tree.json  · 浅色 %d / 暗色 %d · %d 个类别'
          % (m['lightCount'], m['darkCount'], len(m['categories'])))
    print('  类别：%s' % ' '.join(m['categories']))
    sys.exit(0)


if __name__ == '__main__':
    main()
