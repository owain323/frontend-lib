#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
make-tiersnippet.py — 从 tokens.css 生成精简档 专用令牌文件

为什么需要这个
--------------------------------------------
精简档（Tier A）的硬约束是：

> 「精简档：复制 `01-tokens/tokens.css` 的 **`[核心]` 段**，约 2 KB」

**但 tokens.css 里从来没有过任何叫「[核心]」的区块** ——
那句话指向一个**不存在的东西**。复用的人照着做，只会找不到。

🔴 这就是"复用要重新摸索"的根源之一，而且是**我自己文档里的假承诺**。

做法
----
从 tokens.css **自动抽取**两段（浅色 `:root` + 暗色 `@media`），
写成 `04-recipes/tierA-tokens.css`。

**自动抽取 = 不会漂移** —— 这是手抄做不到的。
若手抄，两边迟早不一致，而一致性检查也查不出来（它只在 HTML 里查）。

用法：
    python 05-audit/make-tiersnippet.py          # 生成
    python 05-audit/make-tiersnippet.py --check  # 只查是否已同步（接进门禁）
"""
import sys
import os
import re
import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from _css import declared_tokens, resolve_vars  # noqa: E402
RAW_PREFIX = '--raw-'

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '01-tokens', 'tokens.css')
DST = os.path.join(ROOT, '04-recipes', 'tierA-tokens.css')

HEADER = """/* ============================================================================
   精简档 专用：内联用令牌（某项目 / 单文件）
   ============================================================================
   本文件由 `python 05-audit/make-tiersnippet.py` 从 01-tokens/tokens.css
   **自动抽取**，请不要手改 —— 改源头，然后重新生成。

   🔴 它为什么存在：
      charter 一直写着"精简档 只需复制 tokens.css 的 [核心] 段"，
      但**那个区块从来不存在**。复用的人照着做只会找不到。
      这个文件就是那个"核心"，真的、能复制、能用。

   体积：浅色 {n_light} 个令牌 + 暗色 {n_dark} 个，零外链零构建。
   --------------------------------------------------------------------- */
"""


def _strip_comments(src):
    """🔴 剥掉注释再找区块。
    原因：`tokens.css` 的**注释里**也写着
    "prefers-color-scheme: dark"（那段说明"为什么用 @media"），
    而原代码用 `src.index(...)` ⇒ 找到的是**注释里那次** ⇒
    从错误位置数括号 ⇒ 永远配不平 ⇒ `UnboundLocalError`。
    ⚠️ 这类"按字符串找结构"的代码，只要文档里提了一句就会失效。"""
    out = []
    k = 0
    n = len(src)
    while k < n:
        if src[k:k + 2] == '/*':
            e = src.find('*/', k + 2)
            if e < 0:
                out.append(re.sub(r'[^' + chr(10) + ']', ' ', src[k:]))
                break
            # 保留换行，行号不变
            out.append(re.sub(r'[^' + chr(10) + ']', ' ', src[k:e + 2]))
            k = e + 2
            continue
        out.append(src[k])
        k += 1
    return ''.join(out)


def extract(src):
    """→ (light_block, dark_block)，已做 D5 分层处理。

    🔴 D5 之后 tokens.css 里颜色分成两层：
         :root        --raw-paper: #f6f7f8;  --paper: var(--raw-paper);
         @media dark  --raw-paper: #14171A;   （语义层不重复）
       而 tierA 是**给使用者直接复制进 `<style>` 的单文件极简版** ⇒
       它必须仍然是"一个令牌一个值"，不能带 L1，也不能带 `var(--raw-*)`。

       ⇒ 浅色段：删掉 L1 行，语义行的 `var(--raw-x)` 换成该 L1 的值；
         暗色段：L1 的**名字去掉 `--raw-` 前缀**（它就是覆盖那个语义令牌），
                 值是暗色下的解析值。

    ⚠️ 两份值必须分别解析：浅色用"@media 之前"的文本，暗色用**全文**
       （CSS 层叠：后面出现覆盖前面出现）。
    """
    plain = _strip_comments(src)
    i = plain.index(':root')
    depth = 0
    for j in range(i, len(plain)):
        if plain[j] == '{':
            depth += 1
        elif plain[j] == '}':
            depth -= 1
            if depth == 0:
                light = plain[i:j + 1]
                break
    k = plain.index('@media (prefers-color-scheme: dark)')
    depth = 0
    for j in range(k, len(plain)):
        if plain[j] == '{':
            depth += 1
        elif plain[j] == '}':
            depth -= 1
            if depth == 0:
                dark = plain[k:j + 1]
                break

    light_toks = resolve_vars(declared_tokens(light))
    dark_toks = resolve_vars(declared_tokens(plain))     # 全文 = 层叠结果

    def rewrite(block, toks, drop_l1):
        out = []
        for ln in block.split('\n'):
            # 🔴 `_strip_comments` 把注释**替换成等长空格**（为了保住下标好定位），
            #    于是每一段注释都会留下一行纯空白。直接写出去，tierA 里就会出现
            #    十几行"看不见但存在"的空行（D5 的 L1 banner 一次留下 16 行）。
            #    判据：`ln.strip() == ''` 且 `ln != ''` ⇒ 这是注释残行，丢掉。
            #    真正的空行（`''`）保留，作为分组间隔。
            if ln.strip() == '' and ln != '':
                continue
            if ln.strip() == '':
                out.append('')
                continue
            m = re.match(r'^(\s*)(--[a-z0-9-]+)(\s*:\s*)([^;]+)(;)(\s*)$', ln)
            if not m:
                out.append(ln.rstrip())
                continue
            ind, name, sep, val, semi, tail = m.groups()
            if name.startswith(RAW_PREFIX):
                if drop_l1:
                    continue                     # 浅色段：L1 不进 tierA
                name = '--' + name[len(RAW_PREFIX):]   # 暗色段：L1 → 语义名
                val = toks.get(name, val)
            elif val.strip().startswith('var('):
                val = toks.get(name, val)        # 语义别名 → 字面值
            out.append('%s%s%s%s%s' % (ind, name, sep, val, semi))
        # 折叠连续空行
        cleaned = []
        for ln in out:
            if ln == '' and cleaned and cleaned[-1] == '':
                continue
            cleaned.append(ln)
        return '\n'.join(cleaned)

    return (rewrite(light, light_toks, True),
            rewrite(dark, dark_toks, False))


def count(t):
    return len(re.findall(r'(--[a-z0-9-]+)\s*:', t))


def main():
    src = io_src = open(SRC, encoding='utf-8').read()
    light, dark = extract(src)
    body = '\n'.join([HEADER.replace('{n_light}', str(count(light)))
                             .replace('{n_dark}', str(count(dark))),
                       light, '', dark, ''])
    check = '--check' in sys.argv
    if check:
        if not os.path.isfile(DST):
            print('  [FAIL] 04-recipes/tierA-tokens.css 不存在')
            return 1
        cur = open(DST, encoding='utf-8').read()
        # 只比内容（头部注释可能被人加了说明）
        cur_body = cur[cur.index(':root'):] if ':root' in cur else ''
        want_body = body[body.index(':root'):]
        if cur_body.strip() == want_body.strip():
            print('  [OK  ] tierA-tokens.css 与 tokens.css 同步')
            return 0
        print('  [FAIL] tierA-tokens.css 已漂移 —— 跑 make-tiersnippet.py 重新生成')
        return 1
    # 🔴 必须显式 newline='\n'：Windows 上默认会把 \n 转成 \r\n，
    #    于是每次生成都在改行尾 ⇒ `dist-fresh` 的「只改换行符」自检当场红，
    #    且和 D4（行尾统一）直接打架。
    with open(DST, 'w', encoding='utf-8', newline='\n') as f:
        f.write(body)
    print('  ✓ 已生成 04-recipes/tierA-tokens.css（%d 字节，%d + %d 个令牌）'
          % (os.path.getsize(DST), count(light), count(dark)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
