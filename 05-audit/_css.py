#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
_css.py — 给 05-audit 下的 CSS 解析脚本用的**共享扫描器**

============================================================================
🔴 为什么必须单独抽出来
----------------------------------------------------------------------------
写 gen-theme-js.py 时实测踩到：数大括号配平的时候**没有跳过注释和字符串**，
于是 CSS 里一句注释中出现的 `{` 就让块提前结束 ⇒
浅色段只收到 101 个令牌（实为 107 个），`--switch-on` 整个丢失。

这不是理论风险。它当时只表现为一行 [WARN]，
**差点就这么过去了** —— 而它影响的是「暗色令牌差集」的正确性。

⇒ INVARIANT I-11（正则不是解析器）在本库是**用两次事故换来的**：
   ① tokens.css 注释里的中文分号被当成属性值 ⇒ --paper 丢失、暗色不生效
   ② 大括号计数没跳过注释 ⇒ 令牌收集不全

⇒ 所以这里提供的三个函数全部是**逐字符扫描**，
   显式处理：块注释 /* */、单引号串、双引号串。不做任何正则猜测。

============================================================================
提供
----------------------------------------------------------------------------
  scan_blocks(css)            → [(selector_text, body_text)]  扁平块列表
  find_block(css, open_idx)   → (body, 结束下标)
  parse_decls(body)           → [(name, value, note)]
  strip_comments(css)         → (去注释文本, 注释是否配平)
============================================================================
"""


def _scan(css, start, stop):
    """生成器：产出 (kind, text) —— kind ∈ {'code','comment','string'}。"""
    i, n = start, min(stop, len(css))
    buf = []
    kind = 'code'

    def flush():
        if buf:
            yield (kind, ''.join(buf))
            buf[:] = []

    while i < n:
        if kind == 'code':
            if css[i:i + 2] == '/*':
                yield from flush()
                end = css.find('*/', i + 2)
                if end < 0 or end >= n:
                    yield ('comment', css[i:n])
                    return
                yield ('comment', css[i:end + 2])
                i = end + 2
                continue
            if css[i] in '"\'':
                yield from flush()
                q = css[i]
                j = i + 1
                while j < n:
                    if css[j] == '\\':
                        j += 2
                        continue
                    if css[j] == q:
                        j += 1
                        break
                    j += 1
                yield ('string', css[i:j])
                i = j
                continue
            buf.append(css[i])
            i += 1
            continue
        # （本函数只在 kind='code' 时被调用外层，这里兜底）
        buf.append(css[i])
        i += 1
    yield from flush()


def find_block(css, open_idx):
    """
    open_idx 指向 '{'。返回 (块内容原文, '}' 之后的下标)。
    ⚠️ 括号计数**跳过注释与字符串** —— 否则注释里的 `{` 会让块提前结束。
    """
    assert css[open_idx] == '{', 'find_block 需要指向 {'
    depth, i, n = 0, open_idx, len(css)
    start = open_idx + 1
    while i < n:
        c = css[i]
        if c == '/' and css[i:i + 2] == '/*':
            end = css.find('*/', i + 2)
            i = n if end < 0 else end + 2
            continue
        if c in '"\'':
            q = c
            j = i + 1
            while j < n:
                if css[j] == '\\':
                    j += 2
                    continue
                if css[j] == q:
                    j += 1
                    break
                j += 1
            i = j
            continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return css[start:i], i + 1
        i += 1
    return css[start:n], n


def parse_decls(body):
    """
    解析 `name: value;` 声明。返回 [(name, value, 前导注释)]。
    ⚠️ 真正跳过注释与字符串 —— 注释里的中文分号不会被当成属性值。
    """
    out, i, n = [], 0, len(body)
    pending_note = ''
    while i < n:
        c = body[i]
        if c == '/' and body[i:i + 2] == '/*':
            end = body.find('*/', i + 2)
            if end < 0:
                break
            pending_note = body[i + 2:end].strip()
            i = end + 2
            continue
        if c == '/' and body[i:i + 2] == '//':
            end = body.find('\n', i)
            i = n if end < 0 else end + 1
            continue
        if c in '"\'':
            q = c
            j = i + 1
            while j < n:
                if body[j] == '\\':
                    j += 2
                    continue
                if body[j] == q:
                    j += 1
                    break
                j += 1
            i = j
            continue
        if c in ' \t\r\n':
            i += 1
            continue
        # 声明：读到 ':' 再读到 ';'（在块末尾也接受无分号）
        colon = body.find(':', i)
        if colon < 0:
            break
        name = body[i:colon].strip()
        if not name or not (name[0].isalpha() or name[0] == '-' or name[0] == '_'):
            i = colon + 1
            continue
        # 值：从 colon 后扫到 ';'，跳过字符串与注释。
        # 🔴 必须**逐段拼接**而不是最后做 body[a:b] 切片：
        #    切片会把值里面夹的注释一起带出来 ——
        #    实测 `--sans` 的值变成了 "/* 拉丁 */\n -apple-system, ..."，
        #    其中含**真实换行** ⇒ 写进 JS 单引号字符串里直接 SyntaxError。
        j = colon + 1
        val_end = None
        seg = []
        while j < n:
            if body[j] == '/' and body[j:j + 2] == '/*':
                end = body.find('*/', j + 2)
                seg.append(' ')
                j = n if end < 0 else end + 2
                continue
            if body[j] in '"\'':
                q = body[j]
                k = j + 1
                while k < n:
                    if body[k] == '\\':
                        k += 2
                        continue
                    if body[k] == q:
                        k += 1
                        break
                    k += 1
                seg.append(body[j:k])
                j = k
                continue
            if body[j] == ';':
                val_end = j
                break
            if body[j] == '{':
                # 嵌套块（如 @supports 内的声明）⇒ 跳过
                _, after = find_block(body, j)
                j = after
                continue
            seg.append(body[j])
            j += 1
        if val_end is None:
            val_end = n
        value = ' '.join(''.join(seg).split()).strip()
        out.append((name, value, pending_note))
        pending_note = ''
        i = val_end + 1
    return out


def strip_comments(css):
    """去掉块注释（保留字符串内容）。返回 (文本, 注释是否配平)。"""
    out, i, n, balanced = [], 0, len(css), True
    while i < n:
        if css[i] == '/' and css[i:i + 2] == '/*':
            end = css.find('*/', i + 2)
            if end < 0:
                balanced = False
                break
            out.append(' ')
            i = end + 2
            continue
        if css[i] in '"\'':
            q = css[i]
            j = i + 1
            while j < n:
                if css[j] == '\\':
                    j += 2
                    continue
                if css[j] == q:
                    j += 1
                    break
                j += 1
            out.append(css[i:j])
            i = j
            continue
        out.append(css[i])
        i += 1
    return ''.join(out), balanced


# ---------------------------------------------------------------------------
# 令牌取值：`var()` 解析（D5 的地基 · 全库唯一一份）
# ---------------------------------------------------------------------------
# 🔴 为什么必须收敛成一份（E31：同一个判断不写第二遍）
#   `contrast.py` / `dark-gate.py` / `cmp-contrast.py` 各自写了一遍
#   「从 CSS 里抠 `--x: #hex`」。三份实现只要有一份漏了某种写法（三色 hex、
#   `rgb()`、`var()` 引用），对比度就会**悄悄**少算几对，而报告照样有数字。
#
#   而 D5（令牌分两层）之后，语义令牌会写成 `--paper: var(--raw-paper)` ——
#   三份旧实现全部只认 hex，会直接把 30 个色令牌读成"不存在"。
#
#   ⇒ 解析 `var()` 这一步**本来就是必须写的**，所以写在这里、只写一次。
import re as _re

# 🔴 分隔符是 `;` **或** `}` —— CSS 允许最后一条声明不带分号，
#   只认 `;` 会静默漏掉每个块的最后一条（实测：
#   `--a:var(--b); --b:var(--a)}` 只读到 --a，
#   于是『循环引用』那个反向控制根本没被触发）。
_RE_DECL = _re.compile(r'(--[a-z0-9-]+)\s*:\s*([^;}]+)', _re.I)
_RE_VAR = _re.compile(r'^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(.*))?\)$', _re.I)


def declared_tokens(css):
    """→ {name: value}（**原样值**，后出现的覆盖先出现的）。

    只做词法，不做语义：值可能是 `#hex`、`rgb(...)`、`var(--x)`、`12px`。
    """
    out = {}
    for m in _RE_DECL.finditer(strip_comments(css)[0]):
        out[m.group(1).strip()] = m.group(2).strip()
    return out


def resolve_vars(tokens, _depth=0):
    """把 `var(--x)` 引用解析成最终值，返回新 dict（不修改入参）。

    🔴 三个必须做对的地方：
      ① **循环引用**（`--a: var(--b); --b: var(--a)`）必须**报错**，
         不能靠递归深度兜底 —— 那样只会得到一个莫名的 RecursionError。
      ② **未定义的引用**：`var(--nope)` 有 fallback 就用 fallback，
         没有就**保留原样**（不静默变成空串 —— 空串会让下游算出错误的对比度）。
      ③ 值里带多个 var 的（`var(--a) var(--b)`）目前**不解析**，
         保持原样并让调用方自己判断 —— 本库的令牌值是单值，
         真出现多值时应该显式加进来，而不是让解析器猜。
    """
    if _depth > 20:
        raise ValueError('var() 解析超过 20 层，可能是循环引用：%r'
                         % (list(tokens)[:5],))

    def one(name, seen):
        raw = tokens[name]
        m = _RE_VAR.match(raw.strip())
        if not m:
            return raw
        ref, fallback = m.group(1), m.group(2)
        if ref in seen:
            raise ValueError('var() 循环引用：%s' % ' → '.join(list(seen) + [ref]))
        if ref in tokens:
            return one(ref, seen + (ref,))
        if fallback is not None:
            return fallback.strip()
        return raw          # 未定义且无 fallback ⇒ 保留原样，不制造空值

    return {k: one(k, (k,)) for k in tokens}


def mask_comments(css):
    """把注释替换成**等长空白**（保留换行），偏移量与原文完全一致。

    🔴 为什么不能用 `strip_comments` 代替
      `strip_comments` 会**删掉**注释 ⇒ 之后拿到的一切下标都对不上原文，
      写回文件时会错位。而这个函数的用途恰恰是「在原文里定位」：

          masked = mask_comments(css)
          i = RE.search(masked).start()      # 这个下标在 css 里同样有效

    🔴 为什么需要在注释遮蔽后再匹配 @media
      实测：`tokens.css` 里有一段注释**举着** `@media … prefers-color-scheme: dark`
      当例子（讲为什么不用 `light-dark()`）。直接搜会先命中注释里那段，
      再靠 `[^{]*` 一路吃到真实的 `{` —— 看着"能用"，其实是**偶然对齐**：
      只要注释里在它之前出现任何 `{`（比如贴一段示例 CSS），
      整个定位就会静默偏移到错误位置，而门禁照样给出结论。
    """
    out = []
    i, n = 0, len(css)
    while i < n:
        if css.startswith('/*', i):
            j = css.find('*/', i + 2)
            j = n if j < 0 else j + 2
            chunk = css[i:j]
            # 注释里换行要保留（否则行号全错），其余字符变空格
            out.append(''.join('\n' if c == '\n' else ' ' for c in chunk))
            i = j
        else:
            j = css.find('/*', i)
            j = n if j < 0 else j
            out.append(css[i:j])
            i = j
    return ''.join(out)
