#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
comment-balance.py — 注释配平门禁（ H2 的副产品）

===========================================================================
🔴 为什么必须有这个门禁（本项目最隐蔽的一类 bug）
---------------------------------------------------------------------------
  实测发现：`tokens.css` 里有**三处**注释问题，
  它们的**共同后果**是「浏览器把整段 CSS 静默丢弃」：

    ① 亮色 `:root` 块里有**一个多余的 `*/`**（L104 提前闭合了 L103 的注释）
       ⇒ L105 的说明文字变成"裸字符"
       ⇒ 浏览器解析到那里时状态错乱，**`:root` 只剩 8 条声明**
       ⇒ `--accent` / `--surface` 等几十个令牌**全部丢失**

    ② 暗色段的注释从 L665 一直到**文件末尾都没闭合**
       ⇒ 暗色的 `:root` 块被整个吞掉

    ③ 暗色段的令牌是**裸声明**（没有 `:root {` 包裹）
       ⇒ 同样被丢弃

  ⛔ 三处**都不报错**：CSS 合法加载，控制台干净，页面能显示。
  ⛔ 三处都让 `check-all.sh` **全绿**（因为所有门禁都在"假装测暗色"）。

  ⇒ 这类 bug 只能靠**机械检查注释配平**发现。

===========================================================================
判据
---------------------------------------------------------------------------
  ① 全文 `/*` 与 `*/` 数量相等（且无"多余的 */"）
  ② CSS：每个 `@media` 块**内部至少有 1 条规则**
     （0 条 = 内容被注释吞掉了 —— 这是本 bug 最直接的特征）
  ③ CSS：`:root` 块的声明数 >= 30
     （正常应 60+；< 30 说明块被提前闭合）
"""
import sys
import os
import io
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# JS 里 `/` 可能是除号也可能是正则字面量开头。
# 判据（业界通用启发式）：看**前一个有意义的字符**——
#   是运算符/括号/分号/逗号/冒号/等号，或行首 ⇒ 这是正则；否则是除号。
# ⚠️ 不处理这个 ⇒ `/\s*/gi` 里的 `*/` 会被当成"多余的注释收尾符"（实测误报）。
_JS_REGEX_PREV = set('(,=:[!&|?{};+-*%~^<>\n')
_JS_REGEX_KW = ('return', 'typeof', 'case', 'in', 'of', 'new', 'delete',
                'void', 'instanceof', 'do', 'else', 'yield', 'await')


def scan_comments(text, js=False):
    """
    返回 (末尾深度, 多余的 */ 个数, 未闭合的起始行, 注释内嵌套的 /* 行号列表)

    🔴 2026-10-06 重写：原来是**数数**（`/*` 的个数 vs `*/` 的个数）。
       实测它放过了一个真 bug：
         accordion.css 里同时存在
           ① 一段说明文字**缺注释开头**，只有末尾一个收尾符
           ② 另一处**注释里嵌了一个 `/*`**
       两个错误方向相反 ⇒ 计数正好相等 ⇒ **门禁报 PASS**，
       而那段说明文字其实一直被浏览器当成选择器垃圾在解析。

       更糟的是：等我把①修好（补上开头），计数反而**不相等了** ⇒ 门禁开始报红。
       ⇒ 也就是说：**这道门禁在惩罚修复**。这是假绿的典型症状。

    ⇒ 正解：**真的扫**，不数数。逐字符走，跳过字符串，注释结束以第一个 `*/` 为准
       （CSS 注释不嵌套），并单独记录"注释里又开了一个注释"这种隐患。
    """
    d = 0
    stray = []
    nested = []
    last_open = None
    k = 0
    n = len(text)

    def line_at(pos):
        return text.count('\n', 0, pos) + 1

    while k < n:
        if text[k] in '"\'':
            q = text[k]
            j = k + 1
            while j < n:
                if text[j] == '\\':
                    j += 2
                    continue
                if text[j] == q:
                    j += 1
                    break
                j += 1
            k = j
            continue
        if js and text[k] == '/' and k + 1 < n and text[k + 1] != '/' \
                and text[k + 1] != '*':
            # 可能是正则字面量 ⇒ 用前一个有意义字符判断
            p = k - 1
            while p >= 0 and text[p] in ' \t':
                p -= 1
            prev = text[p] if p >= 0 else '\n'
            if prev in _JS_REGEX_PREV:
                word = ''
                q = p
                while q >= 0 and (text[q].isalnum() or text[q] in '_$'):
                    word = text[q] + word
                    q -= 1
                if not word or word in _JS_REGEX_KW:
                    # 吃掉整个正则字面量（含字符类与转义）
                    j = k + 1
                    in_class = False
                    while j < n:
                        c = text[j]
                        if c == '\\':
                            j += 2
                            continue
                        if c == '\n':
                            break
                        if in_class:
                            if c == ']':
                                in_class = False
                        elif c == '[':
                            in_class = True
                        elif c == '/':
                            j += 1
                            break
                        j += 1
                    k = j
                    continue
        if text[k:k + 2] == '//' and js:
            e = text.find('\n', k)
            k = n if e < 0 else e + 1
            continue
        if text[k:k + 2] == '/*':
            end = text.find('*/', k + 2)
            if end < 0:
                d += 1
                if last_open is None:
                    last_open = line_at(k)
                break
            body = text[k + 2:end]
            # 注释内部又出现注释开头 ⇒ 隐患（CSS 注释不嵌套，且会骗过数数型工具）
            b = 0
            while True:
                b = body.find('/*', b)
                if b < 0:
                    break
                nested.append(line_at(k + 2 + b))
                b += 2
            k = end + 2
            continue
        if text[k:k + 2] == '*/':
            stray.append(line_at(k))
            k += 2
            continue
        k += 1
    return d, stray, last_open, nested


def check_css(path):
    """CSS 专用：查 @media 空块 + :root 声明数"""
    text = io.open(path, encoding='utf-8').read()
    problems = []

    # ① 注释配平
    d, stray, at, nested = scan_comments(text)
    if d != 0:
        problems.append('注释未闭合（从 L%s 开始就没关掉）⇒ 后面全部被浏览器当注释丢弃'
                        % (at or '?'))
    if stray:
        problems.append('有 %d 个多余的 `*/`（%s；对应行内容变成"裸字符"，'
                        '会让浏览器解析状态错乱）'
                        % (len(stray), ', '.join('L%d' % x for x in stray[:5])))
    if nested:
        problems.append('注释内部又出现了注释开头（%s）—— CSS 注释**不嵌套**，'
                        '外层会在遇到的第一个收尾符处就结束；'
                        '而且它会让"数个数"型的检查得出错误结论（本项目踩过）'
                        % ', '.join('L%d' % x for x in nested[:5]))

    if d != 0 or stray:
        return problems   # 注释乱时后面的检查没意义

    # ② @media 块内是否有规则（用简易括号匹配，够用）
    lines = text.split('\n')
    i = 0
    while i < len(lines):
        if '@media' in lines[i] and lines[i].rstrip().endswith('{'):
            depth = 1
            j = i + 1
            has_rule = False
            while j < len(lines) and depth > 0:
                t = lines[j].strip()
                if not t or t.startswith('/*') or t.startswith('*'):
                    j += 1
                    continue
                if t.endswith('{'):
                    depth += 1
                    has_rule = True
                elif t == '}':
                    depth -= 1
                elif ':' in t and not t.startswith('--'):
                    has_rule = True   # 块内的属性声明
                j += 1
            if not has_rule:
                cond = lines[i].strip()[:40]
                problems.append('L%d 的 @media %s **内含 0 条规则** '
                                '⇒ 内容被注释吞掉了' % (i + 1, cond))
            i = j
            continue
        i += 1

    # ③ 孤儿声明检测（比「某 :root 只有 N 条」准得多）
    #    ⭐ 判据：文件里 --xxx: 声明总数 vs **规则块内**的声明数。
    #      差得多 ⇒ 有一堆声明在块外（浏览器会静默丢弃）。
    #    ⚠️ 不能用「声明数 < 30」来判 ——
    #       组件私有的小 :root（accordion 只有 2 条）是**故意的**。
    import re
    plain = re.sub(r'/[*].*?[*]/', '', text, flags=re.S)
    NL = chr(10)
    total_decl = len(re.findall(r'^\s*--[a-z0-9-]+\s*:', plain, flags=re.M))
    inside = 0
    depth = 0
    for line in plain.split(NL):
        st = line.strip()
        if st.endswith('{'):
            depth += 1
        elif st == '}':
            depth = max(0, depth - 1)
        elif st.startswith('--') and depth > 0:
            inside += 1
    orphan = total_decl - inside
    if total_decl >= 10 and orphan > 5:
        problems.append('有 %d 个 --xxx: 声明在**规则块外**（%d 个在块内）'
                        ' ⇒ 浏览器会静默丢弃它们（块被提前闭合的典型症状）'
                        % (orphan, inside))

    return problems


def check_generic(path):
    """HTML/JS：只查注释配平"""
    text = io.open(path, encoding='utf-8').read()
    d, stray, at, nested = scan_comments(text, js=True)
    p = []
    if d != 0:
        p.append('注释未闭合（从 L%s 开始）' % (at or '?'))
    if stray:
        p.append('有 %d 个多余的 `*/`（%s）'
                 % (len(stray), ', '.join('L%d' % x for x in stray[:5])))
    # ⚠️ JS **不**报 nested：文档里引用 `/*` 是正当的（chart-check.js 就在讲
    #    一个由注释起始符引起的假绿），报了就是噪音。JS 的未闭合注释由
    #    node --check 兜住，比我们准。
    del nested
    return p


def selftest():
    r"""
    反向控制：证明这道门禁**真的会红**，且不该红的时候不红。

    ⚠️ 为什么必须固化成 --selftest 而不是临时命令验证：
       我第一次用 `python - <<EOF` 内联跑这些用例，
       正则样本里的转义在 shell/JSON 两层传递中被吃掉一层反斜杠，
       写出来的"正则"是断行的 ⇒ 门禁当然抓它 ⇒ 我一度以为门禁坏了。
       ⇒ **用临时命令做验证，本身就是一个不可靠的验证方式。**
       ⇒ 样本里的反斜杠一律用 chr(92) 拼，不写字面量。
    """
    import tempfile
    NL = chr(10)
    BS = chr(92)
    cases = [
        ('a.css', '.a{color:red}' + NL + '/* 忘了关' + NL + '.b{}' + NL,
         True, '未闭合注释'),
        ('b.css', '.a{color:red}' + NL + '*/' + NL + '.b{}' + NL,
         True, '孤儿收尾符'),
        ('c.css', '/* 外层' + NL + '/* 内层' + NL + '*/' + NL + '.c{}' + NL,
         True, '注释内嵌套开头'),
        ('d.css', '/* ok */' + NL + '.a{color:red}' + NL,
         False, '正常 CSS'),
        # ⚠️ 正则里的 `*/`：不该报。这是第一版扫描器的实测误报点。
        ('e.js', 'var re = /(a|b)[^' + BS + 'n]{0,40}=' + BS + 's*/gi;' + NL,
         False, 'JS 正则里的收尾符'),
        ('f.js', 'var x = a / b; // c' + NL,
         False, 'JS 除号'),
        ('g.js', '/* 未闭合' + NL + 'var x = 1;' + NL,
         True, 'JS 未闭合注释'),
    ]
    d = tempfile.mkdtemp(prefix='fl-commentbal-')
    ok = True
    print('  === comment-balance 反向控制 ===')
    for name, txt, should_fail, why in cases:
        p = os.path.join(d, name)
        io.open(p, 'w', encoding='utf-8').write(txt)
        probs = check_css(p) if name.endswith('.css') else check_generic(p)
        got = bool(probs)
        if got != should_fail:
            print('  [FAIL] %-16s 期望%s ⇒ 实际%s  %s'
                  % (why, '红' if should_fail else '绿', '红' if got else '绿',
                     probs[0][:50] if probs else ''))
            ok = False
        else:
            print('  [OK]   %-16s 期望%s ⇒ 实际%s'
                  % (why, '红' if should_fail else '绿', '红' if got else '绿'))
    return 0 if ok else 1


def main():
    if '--selftest' in sys.argv:
        return selftest()
    files = (glob.glob(os.path.join(ROOT, '0*', '*', '*.css')) +
             glob.glob(os.path.join(ROOT, '0*', '*', '*.html')) +
             glob.glob(os.path.join(ROOT, '0*', '*', '*.js')) +
             glob.glob(os.path.join(ROOT, '05-audit', '*.js')))
    files = [f for f in files if os.path.isfile(f)]

    bad = 0
    for f in sorted(files):
        rel = os.path.relpath(f, ROOT)
        try:
            probs = check_css(f) if f.endswith('.css') else check_generic(f)
        except Exception as e:
            probs = ['读取失败：%s' % str(e)[:50]]
        if probs:
            bad += 1
            print('  FAIL  %s' % rel)
            for x in probs:
                print('        - %s' % x)

    print('  扫了 %d 个文件，%d 个有问题' % (len(files), bad))
    if bad:
        print('')
        print('  ⇒ 🔴 这类 bug 不报错、页面能显示、门禁全绿 —— 但功能已经坏了。')
        print('    2026-10-06：`tokens.css` 因此丢了全部暗色令牌 + 一半亮色令牌。')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
