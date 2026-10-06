#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
contrast.py — WCAG 2.1 对比度检查器（色板唯一真源 = tokens.css）

用途：改 01-tokens/tokens.css 之后必须跑。禁止凭感觉填色，
颜色必须带着**实测数字**进库。

用法：
    python contrast.py                        # 从 01-tokens/tokens.css 读色值并体检
    python contrast.py --path <file.css>      # 指定 tokens 文件
    python contrast.py '#15181c' '#f6f7f8'   # 单对检查
    python contrast.py --json                 # 输出 JSON

🔴 **为什么必须从 tokens.css 读，而不是用脚本内置色板**：
   内置色板是**上一版的快照**。改完 tokens.css 它不会跟着变，
   于是"门禁全绿"但**实际在用的颜色从没被测过**。
   本库真实发生过：tokens.css 的整个色板从暖色换成冷色系，
   门禁仍在测旧的暖色板，绿得毫无意义。
   ⇒ **tokens.css 是色板唯一真源，门禁必须读它。**

判定标准（WCAG 2.1）：
    正文文字      >= 4.5 : 1   (AA)
    大字/加粗     >= 3.0 : 1   (AA Large, >=18.66px bold 或 >=24px)
    UI 组件边界   >= 3.0 : 1   (非文本对比度, 1.4.11)
    AAA           >= 7.0 : 1

退出码：0 = 全部达标；1 = 有不达标项；2 = 文件问题
"""

import sys
import os
import sys as _sys
_sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # 🔴 统一排除产物目录（见 _common.py）
import re
import json


# ---------------------------------------------------------------- WCAG 计算
def _srgb_to_lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_rgb(h):
    h = h.strip().lstrip('#')
    if len(h) == 3:
        h = ''.join(ch * 2 for ch in h)
    if len(h) != 6:
        raise ValueError('需要 6 位或 3 位十六进制颜色: %r' % h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def luminance(h):
    r, g, b = hex_to_rgb(h)
    return (0.2126 * _srgb_to_lin(r) + 0.7152 * _srgb_to_lin(g)
            + 0.0722 * _srgb_to_lin(b))


def contrast(fg, bg):
    a, b = luminance(fg), luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def verdict(ratio, kind='text'):
    if kind == 'ui':
        return 'UI 达标' if ratio >= 3.0 else 'UI 不达标'
    if ratio >= 7.0:
        return 'AAA'
    if ratio >= 4.5:
        return 'AA'
    if ratio >= 3.0:
        return 'AA Large'
    return '不达标'


# ---------------------------------------------------------------- tokens 读取
def load_tokens(path, mode='light'):
    """从 CSS 解析 --token: #hex —— 色板的唯一真源

    🔴 2026-10-03：`mode` 参数是暗色模式落地时补的。
    之前**没有**这个参数，而解析整份文件 —— 暗色块在文件末尾，
    同名令牌会被暗色值覆盖，于是这个门禁**只验暗色、悄悄放过了浅色**。
    `dark-gate.py` 是另一套检查（它自己也只管暗色），
    所以**浅色在那段时间里是没有门禁的**。
    """
    out = {}
    try:
        with open(path, encoding='utf-8') as f:
            css = f.read()
    except OSError:
        return out
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    if mode == 'dark':
        i = css.find('@media (prefers-color-scheme: dark)')
        if i >= 0:
            css = css[i:]
    else:
        i = css.find('@media (prefers-color-scheme: dark)')
        if i >= 0:
            css = css[:i]
    for m in re.finditer(r'(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;', css):
        out[m.group(1)] = m.group(2)
    return out


# 语义配对：(说明, 前景 token, 背景 token, 最低要求, 类型)
# 🔴 每一条都对应真实会用的组合，不是随手凑的。
PAIRS = [
    ('正文 / 纸底',         '--text-primary',   '--paper',          4.5,  'text'),
    ('正文 / 表面',         '--text-primary',   '--surface',        4.5,  'text'),
    ('正文 / 内凹区',       '--text-primary',   '--surface-sunken', 4.5,  'text'),
    ('次要 / 纸底',         '--text-secondary', '--paper',          4.5,  'text'),
    ('次要 / 表面',         '--text-secondary', '--surface',        4.5,  'text'),
    ('三级 / 纸底',         '--text-tertiary',  '--paper',          4.5,  'text'),
    ('三级 / 表面',         '--text-tertiary',  '--surface',        4.5,  'text'),
    ('白字 / accent',       '--text-on-accent', '--accent',         4.5,  'text'),
    ('白字 / accent-hover', '--text-on-accent', '--accent-hover',   4.5,  'text'),
    ('危险色 / 纸底',       '--danger',         '--paper',          4.5,  'text'),
    ('危险色 / 危险底',     '--danger',         '--danger-bg',      4.5,  'text'),
    ('强调色 / 纸底',       '--accent',         '--paper',          4.5,  'text'),
    ('强调色 / 表面',       '--accent',         '--surface',        4.5,  'text'),
    ('控件边界 / 纸底',     '--border-control', '--paper',          3.0,  'ui'),
    ('控件边界 / 表面',     '--border-control', '--surface',        3.0,  'ui'),
    # 分层：底色与表面要有可见差，否则"表面浮在底上"的效果完全消失。
    # 这不是 WCAG 要求，是设计底线 —— 实测出现过"背景没渲染出来"，
    # 量出来 #fcfcfd vs #ffffff 只有 1.025:1，人眼根本分辨不出。
    ('表面 / 纸底（分层）', '--surface',        '--paper',          1.06, 'ui'),
]


def check_inline_sync(tokens, root, mode='light'):
    """
    检查内联了 tokens 的 HTML，色值是否与 tokens.css 一致。

    🔴 为什么需要这条（本库真实发生过）：
       精简档 的单文件必须内联色板，那就成了 tokens.css 的**副本**。
       我改版时改了 HTML 里的副本，**忘了改 tokens.css 这个源头** ——
       于是 charter 里写着"暖褐色已移除"，而实际所有 demo 还在用暖色。
       没有任何门禁能发现这件事：对比度是对的、引用是全的、结构是对的，
       只是**两边不一致**。

    🔴 暗色模式后必须**分两次核对**：
       一个 HTML 里现在有**两份**色板（浅色 :root + @media dark 里的 :root）。
       之前用 `re.search` 只找**第一个匹配** ⇒ 拿暗色值去比浅色内联，
       全部误报。改法：dark 模式只在 `@media (prefers-color-scheme: dark)`
       之后的范围里找。

    返回漂移列表 [(文件, token, tokens值, 文件里的值)]
    """
    import glob
    import _common
    bad = []
    # 🔴 加豁免：examples/ 下的页面**故意**自带一套令牌
    #    （那是 T-01 接入样板的核心论点：证明本库组件能在别人的令牌体系下工作）。
    #    它们与 tokens.css 不同**不是漂移**，是需要保留的设计。
    #    ⇒ 只有 demo / recipe（那些声称"内联了本库色板"）才该被检查。
    EXEMPT = ('examples' + os.sep, 'examples/')
    for f in glob.glob(os.path.join(root, '**', '*.html'), recursive=True):
        rel = os.path.relpath(f, root)
        if any(rel.startswith(x) for x in EXEMPT):
            continue          # 示例项目自带令牌，不是漂移
        # 🔴 排除**产物目录**（统一清单见 _common.py）
        #    实测踩坑：`_current/` 里的文件扩展名是 .html 但内容是 PNG
        #    ⇒ 读它直接抛 UnicodeDecodeError，整个门禁崩掉。
        if _common.is_artifact(rel):
            continue
        try:
            with open(f, encoding='utf-8') as fh:
                s = fh.read()
        except OSError:
            continue
        # dark 模式：只截取 @media dark 之后的部分
        scope = s
        if mode == 'dark':
            i = s.find('@media (prefers-color-scheme: dark)')
            if i < 0:
                continue          # 该文件本来就没有暗色块，跳过
            scope = s[i:]
        for k, v in tokens.items():
            m = re.search(re.escape(k) + r'\s*:\s*(#[0-9a-fA-F]{3,6})', scope)
            if m and m.group(1).lower() != v.lower():
                bad.append((os.path.relpath(f, root), k, v, m.group(1)))
    return bad


def check_pairs(tokens, path):
    """跑一遍所有语义配对，返回 (不达标列表, 缺项列表)"""
    fails, missing = [], []
    for desc, fg, bg, need, kind in PAIRS:
        if fg not in tokens or bg not in tokens:
            missing.append('%s：缺 %s 或 %s' % (desc, fg, bg))
            continue
        r = contrast(tokens[fg], tokens[bg])
        bad = r < need
        print('%-20s %-9s %-9s %7.2f   %-8s %s'
              % (desc, tokens[fg], tokens[bg], r, verdict(r, kind),
                 '>>> 不达标' if bad else 'OK'))
        if bad:
            fails.append('%s = %.2f < %.2f' % (desc, r, need))
    return fails, missing


def main():
    if len(sys.argv) == 3 and sys.argv[1].startswith('#'):
        r = contrast(sys.argv[1], sys.argv[2])
        print('%.2f : 1  ->  %s' % (r, verdict(r)))
        print('            ->  大字/UI 边界: %s' % verdict(r, 'ui'))
        return 0 if r >= 4.5 else 1

    path = None
    if '--path' in sys.argv:
        path = sys.argv[sys.argv.index('--path') + 1]
    if not path:
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        path = os.path.join(here, '01-tokens', 'tokens.css')
    if not os.path.isfile(path):
        print('找不到 tokens 文件：%s' % path)
        return 2

    # 🔴 暗色模式落地后，**两套配色都要跑**。
    #    之前 load_tokens 解析整份文件，暗色块在末尾覆盖了同名令牌 ——
    #    于是这个门禁其实**只在验暗色**，浅色被悄悄放过了。
    all_fails, all_missing = [], []
    light_tokens, dark_tokens = {}, {}
    for mode in ('light', 'dark'):
        tokens = load_tokens(path, mode)
        if not tokens:
            print('tokens 文件里没解析到颜色（%s）：%s' % (mode, path))
            return 2
        if mode == 'light':
            light_tokens = tokens
        else:
            dark_tokens = tokens
        print('')
        print('── %s ──' % ('浅色' if mode == 'light' else '暗色'))
        f, m = check_pairs(tokens, path)
        all_fails.extend(f)
        all_missing.extend(m)
    fails, missing = all_fails, all_missing

    print('色板实测（真源：%s）' % path)
    print('=' * 74)

    if missing:
        print('')
        print('未覆盖的组合（tokens 里缺对应项）：')
        for m in missing:
            print('  %s' % m)

    if '--json' in sys.argv:
        print('')
        print(json.dumps({'ok': not fails, 'fails': fails, 'missing': missing},
                         ensure_ascii=False, indent=2))

    # 内联副本一致性（精简档 单文件内联了色板 = tokens 的副本，会漂移）
    # 🔴 root 必须是**库根**，不是 tokens 所在目录 —— 取 dirname(path) 会只搜
    #    01-tokens/，HTML 在 04-recipes/ 里，于是永远报"一致"（假绿，已实测踩到）。
    root = os.path.dirname(os.path.dirname(os.path.abspath(path)))
    # 🔴 两套配色各查一次内联副本（暗色落地后 HTML 里有两份色板）
    drift = (check_inline_sync(light_tokens, root, 'light')
             + check_inline_sync(dark_tokens, root, 'dark'))
    if drift:
        print('')
        print('内联副本漂移 %d 处 —— HTML 里内联的色值与 tokens.css 不一致：' % len(drift))
        for fn, k, tv, fv in drift:
            print('  %-34s %-20s tokens=%s  文件=%s' % (fn, k, tv, fv))
        print('  ⇒ 修法：改 tokens.css 后重新生成那些 HTML（md-render.py 可一键重生成）')
    else:
        print('')
        print('内联副本一致性：OK（浅色 + 暗色两套都与 tokens.css 一致）')

    print('')
    print('=' * 74)
    if fails:
        print('不达标 %d 项 —— 这些颜色不许进 01-tokens/：' % len(fails))
        for f in fails:
            print('  %s' % f)
        return 1
    if drift:
        print('色板本身达标，但内联副本有漂移 —— 不许提交。')
        return 1
    print('全部达标。')
    return 0


if __name__ == '__main__':
    sys.exit(main())


# 暗色的**色相**门禁（真机实测否决过一次配色）
#
# 实测反馈原话：「白色兼灰色是有高级感的，现在变成了暖色，太吓人了」
#
# ⇒ 本库的"高级感"来自**冷灰**（接近蓝的灰），这是产品调性，**不能改**。
# ⇒ 机械判据：中性色的 R 和 B 差 ≤ 12（R 略高一点点才偏冷）。
#    若 R 明显高于 B（>12）⇒ 偏暖 ⇒ 门禁红。
HUE_MAX_SPREAD = 12   # R - B 的最大允许值（>12 即偏暖）


def hue_is_cold(hexs):
    """中性色应该是冷灰：R ≈ B，R 最多略高。"""
    h = hexs.strip().lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    if len(h) < 6:
        return True          # 不是颜色（变量未解析）⇒ 不判
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (r - b) <= HUE_MAX_SPREAD
