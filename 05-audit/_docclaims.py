# -*- coding: utf-8 -*-
r"""
_docclaims.py — 核对 tokens.css 注释里的对比度数字是否与实测一致

🔴 **配对表必须显式写死，不能靠默认值。**
   教训：第一版核对脚本把 `--accent-hover` 配成
   "对 --accent-hover"（自己对自己 = 1.00），得出"注释不符"的**假结论**，
   差点去改本来正确的注释。

用法：python 05-audit/_docclaims.py
"""
import io
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contrast as C

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 令牌 -> (说明, 用哪块底色去算)
PAIR = {
    '--text-primary':     ('纸底', '--paper'),
    '--text-secondary':   ('纸底', '--paper'),
    '--text-tertiary':    ('纸底', '--paper'),
    '--text-on-accent':   ('accent 底', '--accent'),
    '--border-control':   ('纸底', '--paper'),
    '--border-decor':     ('纸底·装饰，WCAG 不强制', '--paper'),
    '--border-decor-str': ('纸底·装饰', '--paper'),
    '--danger':           ('纸底', '--paper'),
    '--success':          ('纸底', '--paper'),
    '--warning':          ('纸底', '--paper'),
    '--info':             ('纸底', '--paper'),
    '--accent':           ('纸底', '--paper'),
    # accent-hover 是"按钮底色"，压在它上面的是**白字**
    '--accent-hover':     ('白字压上', '--accent-hover'),
}

# 令牌本身是底色、真正要测的是它上面的文字
AS_TEXT = {'--accent-hover': '--text-on-accent'}

# 🔴 暗色模式建立后，这个核对脚本必须**分开两套跑**。
#    之前它只按浅色的 PAIR 表算，把暗色值也套进去 ⇒ 14 处误报。
#    暗色的配对关系**方向不同**（accent-hover 上压的是深字，不是白字）。
DARK_PAIR = dict(PAIR)
DARK_AS_TEXT = {'--accent-hover': '--text-on-accent'}


def split_modes(css):
    """拆成 (浅色段, 暗色段)"""
    i = css.find('@media (prefers-color-scheme: dark)')
    if i < 0:
        return css, ''
    return css[:i], css[i:]


def load_dark(path):
    """从暗色段里读出令牌值"""
    css = io.open(path, encoding='utf-8').read()
    _, dark = split_modes(css)
    d = {}
    for m in re.finditer(r'(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;', dark):
        d[m.group(1)] = m.group(2)
    return d


def main():
    path = os.path.join(ROOT, '01-tokens', 'tokens.css')
    css = io.open(path, encoding='utf-8').read()
    T = C.load_tokens(path)
    dark = load_dark(path)
    light_css, dark_css = split_modes(css)

    bad = 0
    checked = 0
    for tok, note in re.findall(
            r'(--[a-z0-9-]+)\s*:\s*#[0-9a-fA-F]{6};\s*/\*(.*?)\*/', light_css):
        nums = re.findall(r'(\d+\.\d+)', note)
        if not nums or tok not in PAIR:
            continue
        fg = AS_TEXT.get(tok, tok)
        label, base = PAIR[tok]
        r = C.contrast(T[fg], T[base])
        checked += 1
        ok = any(abs(r - float(n)) < 0.06 for n in nums)
        if not ok:
            bad += 1
        print('  %-20s 注释 %-26s 实测 %6.2f (vs %s)  %s'
              % (tok, note.strip()[:26], r, label, 'OK' if ok else '<<< 不符'))

    # ---- 暗色段 ----
    if dark_css:
        for tok, _val, note in re.findall(
                r'(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6});[^\n]*?/\*(.*?)\*/', dark_css):
            nums = re.findall(r'(\d+\.\d+)', note)
            if not nums or tok not in DARK_PAIR:
                continue
            fg_tok = DARK_AS_TEXT.get(tok, tok)
            if fg_tok not in dark:
                continue
            base_tok = DARK_PAIR[tok][1]
            if base_tok not in dark:
                continue
            # 🔴 必须用**暗色段的值**（dark），不能用浅色的 T
            r = C.contrast(dark[fg_tok], dark[base_tok])
            checked += 1
            ok = any(abs(r - float(n)) < 0.06 for n in nums)
            if not ok:
                bad += 1
            print('  %-20s 暗 %-20s 实测 %6.2f (vs %s)  %s'
                  % (tok, note.strip()[:20], r, DARK_PAIR[tok][0],
                     'OK' if ok else '<<< 不符'))

    print('')
    print('核对 %d 条，不符 %d 处' % (checked, bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
