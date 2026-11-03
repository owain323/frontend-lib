#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
split-tokens.py — 把 `tokens.css` 切成「变量层」与「底座层」，并守住"没有第三类"

============================================================================
🔴 为什么要有这个脚本
----------------------------------------------------------------------------
`01-tokens/tokens.css` 同时干了两件事：

  ① **变量层** —— `:root` 里一堆自定义属性。引入它只多出变量，不改宿主任何行为。
  ② **底座层** —— 全局 `:focus-visible` 焦点环、`a,button,label…` 的
     `-webkit-tap-highlight-color: transparent`、`@media (prefers-reduced-motion)`
     里对 `*` 的 `!important`。**这三条改的是整个宿主文档。**

README 的最小示例是 `tokens.css + typography.css`，却把它描述成"零副作用"。
对一个「塞进已有站点」的库，这是集成风险：接进去之后宿主的焦点环、
点按反馈、减少动效策略都被替换了，而使用者不知道是哪一行干的。

⚠️ 但**不能直接拆**：0.23.0 起公开面冻结，`tokens.css` 的语义、它的引入方式、
44 个 demo 与多道门禁都绑在它上面。改它就是破坏性变更，要走废弃流程。

⇒ 所以这里做的是**加法**：从 `tokens.css` 切出两个新文件
   （`tokens.core.css` / `base.reset.css`），`tokens.css` 一个字节都不动。
   想"只要变量"的人改用 core；想"连底座一起"的人继续用 tokens.css（旧路不变）。

============================================================================
🔴 为什么是"切"而不是"手写两份"
----------------------------------------------------------------------------
INVARIANT I-7：同一个事实有第二份手写来源，必然漂移。
如果把变量抄一份到 `tokens.core.css`，第一次改令牌就会有一个人忘记改另一份，
而**两边都能渲染**，谁也不会发现。

⇒ 所以两个新文件是**生成物**（文件头写明不要手改），真值永远是 `tokens.css`。
   本脚本的 `--check` 逐字节比对；`tokens.css` 改了没重切 ⇒ 红。

============================================================================
判据
----------------------------------------------------------------------------
  ① 零规则 ⇒ 红（切了 0 条 → 不是通过，是没检查）
  ② `tokens.css` 的每条顶层规则必须归入三类之一：core / reset / library
     归不了类 ⇒ 红（**这条是重点**：将来有人往 tokens.css 里加第四条全局规则，
     既不在 core 也不在 reset，就会被逼着做一次显式决定）
  ③ `tokens.core.css` == core 类规则的逐字节拼接 + 固定文件头
  ④ `base.reset.css` == reset 类规则的逐字节拼接 + 固定文件头
  ⑤ core 里出现元素选择器 / `*` / 属性 `-webkit-tap-highlight-color` ⇒ 红
     （变量的定义可以写在 `:root`，但不能顺手带一条全局规则进来）

反向控制见 `--selftest`：改一条规则、删一条规则、加一条未归类的全局规则，
三种都必须红。
"""

import io
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _css import mask_comments  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '01-tokens', 'tokens.css')
CORE = os.path.join(ROOT, '01-tokens', 'tokens.core.css')
RESET = os.path.join(ROOT, '01-tokens', 'base.reset.css')

HEAD_CORE = """/* ============================================================================
 * tokens.core.css —— **只有变量**，不含任何全局规则
 * ============================================================================
 *
 * 什么时候用它：把这个库嵌进**已有站点**，只想拿到配色/间距/字号令牌，
 * 不想让库改掉宿主的焦点环、点按反馈、减少动效策略。
 *
 * 什么时候不该用它：从零搭页面（那就用 `tokens.css`，它含底座层）。
 *
 * ⚠️ 本文件是**生成物**，由 `05-audit/split-tokens.py --write` 从
 *    `01-tokens/tokens.css` 切出来。手改会在门禁里红，且下次重切就没了。
 *    真值永远是 `tokens.css`（I-7：同一事实不留第二份手写来源）。
 */
"""

HEAD_RESET = """/* ============================================================================
 * base.reset.css —— 底座层：会改**整个宿主文档**的那几条规则
 * ============================================================================
 *
 * 🔴 这个文件里的每一条都作用于宿主页面本身，而不只是本库的组件：
 *    · `:focus-visible`            —— 宿主所有可聚焦元素的焦点环
 *    · `a, button, label, …`       —— 宿主的点按高亮被关掉
 *    · `prefers-reduced-motion`    —— 对 `*` 压掉动效（带 !important）
 *
 * 所以它**默认不该被引入**：先用 `tokens.core.css`，确认要这套底座再加它。
 * 从零搭页面的人用 `tokens.css`（= core + reset，一条引入搞定）。
 *
 * ⚠️ 本文件是**生成物**，由 `05-audit/split-tokens.py --write` 切出来。
 */

"""


def chunks(css):
    """把 CSS 切成顶层规则片段（含规则前的注释）。返回 [(prelude, text)]。"""
    masked = mask_comments(css)
    out = []
    depth = 0
    start = None
    prelude_at = 0
    last_end = 0
    for i, ch in enumerate(masked):
        if ch == '{':
            if depth == 0:
                start = i
                prelude_at = last_end
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start is not None:
                prelude = ' '.join(masked[prelude_at:start].split())
                out.append((prelude, css[prelude_at:i + 1]))
                start = None
                last_end = i + 1
    return out


def _inner(text):
    """块体。⚠️ 索引必须从**遮蔽层**取：块首的注释里就可能出现 `{`
    （本文件里真有：注释举例 `.wrap { max-width: 680px }`），
    在原文里找第一个 `{` 会切到注释中间，后面全错。"""
    masked = mask_comments(text)
    i = masked.find('{')
    j = masked.rfind('}')
    return text[i + 1:j] if i >= 0 and j > i else ''


def _decls(text):
    body = mask_comments(_inner(text))
    return [d.strip() for d in body.split(';') if d.strip()]


def _is_var_rule(prelude, text):
    """这条规则（含嵌套）是不是**只声明自定义属性**。

    🔴 不能只看选择器前缀。暗色令牌在
       `@media screen and (prefers-color-scheme: dark) { :root { --paper… } }` 里，
       按前缀会把它判成"库自己的东西"，于是 core 里没有暗色 ——
       用 core 的人会发现切暗色不生效，而门禁全绿。
       （实测：第一版就是这样，计算样式里 dark 仍返回 #f6f7f8。）
    """
    pl = prelude.lower()
    if pl.startswith('@media'):
        subs = chunks(_inner(text))
        return bool(subs) and all(_is_var_rule(p, t) for p, t in subs)
    if not (pl.startswith(':root') or pl.startswith('[data-theme')):
        return False
    subs = chunks(_inner(text))
    if subs:
        return all(_is_var_rule(p, t) for p, t in subs)
    ds = _decls(text)
    return bool(ds) and all(d.startswith('--') for d in ds)


def kind_of(prelude, text):
    """归类。返回值必须是 'core' / 'reset' / 'library' / None（None ⇒ 红）。"""
    low = prelude.lower()
    # ① 先判"会改宿主裸元素"的三类（reset）—— 它们的优先级最高，
    #    即使选择器长得像 :root 也不许被划进变量层。
    if low.startswith('@media (prefers-reduced-motion'):
        return 'reset'
    if low.startswith(':focus-visible'):
        return 'reset'
    if low.startswith('a, button, label'):
        return 'reset'
    # ② 只声明变量的规则（含 @media / [data-theme] 包裹的暗色与语言覆盖）
    if _is_var_rule(prelude, text):
        return 'core'
    # ③ 只作用于本库的类名 / 显式 opt-in 属性 / 打印与 hover 的库内规则
    if (low.startswith('.') or low.startswith('[data-')
            or low.startswith('@media print')
            or low.startswith('@media screen')
            or low.startswith('@media (hover: hover)')):
        return 'library'
    return None


def build(css):
    """返回 (core_text, reset_text, stats, unknown)。"""
    core, reset, unknown = [], [], []
    stats = {'core': 0, 'reset': 0, 'library': 0}
    for prelude, text in chunks(css):
        k = kind_of(prelude, text)
        if k is None:
            unknown.append(prelude[:80])
            continue
        stats[k] += 1
        if k == 'core':
            core.append(text)
        elif k == 'reset':
            reset.append(text)
    # 用 join 而不是 `常量 + '\n' + …`：后者会被 rewrite-residue 的 R2
    # （批量替换留下的拼接痕迹）误判 —— 判据看的是形状，不是意图。
    core_text = ''.join([HEAD_CORE, '\n', '\n'.join(core), '\n'])
    reset_text = ''.join([HEAD_RESET, '\n', '\n'.join(reset), '\n'])
    return core_text, reset_text, stats, unknown


def check(verbose=True):
    css = io.open(SRC, encoding='utf-8').read()
    core_text, reset_text, stats, unknown = build(css)
    bad = 0

    if sum(stats.values()) == 0:
        print('  [FAIL] 一条规则都没切出来 —— 不是通过，是没检查')
        return 1

    for p in unknown:
        print('  [FAIL] 这条顶层规则没有归类：%s' % p)
        print('         ⇒ 要么它是变量（core），要么它会改宿主（reset），')
        print('           要么它只作用于本库（library）—— 必须显式决定一次')
        bad += 1

    for path, want, label in ((CORE, core_text, 'tokens.core.css'),
                              (RESET, reset_text, 'base.reset.css')):
        if not os.path.isfile(path):
            print('  [FAIL] %s 不存在 —— 跑 --write' % label)
            bad += 1
            continue
        got = io.open(path, encoding='utf-8').read()
        if got != want:
            print('  [FAIL] %s 与 tokens.css 切出来的不一致 —— 跑 --write' % label)
            bad += 1
            continue
        if verbose:
            print('  OK   %-18s %d 条规则' % (label, stats['core' if 'core' in label
                                                              else 'reset']))

    # ⑤ core 里不许有元素选择器 / 通配 / 点按高亮
    core_body = io.open(CORE, encoding='utf-8').read() if os.path.isfile(CORE) else ''
    for prelude, text in chunks(core_body):
        if not _is_var_rule(prelude, text):
            print('  [FAIL] tokens.core.css 里出现"不只声明变量"的规则：%s'
                  % prelude[:60])
            bad += 1
        if 'tap-highlight' in prelude:
            print('  [FAIL] tokens.core.css 里出现点按高亮规则')
            bad += 1
    if '!important' in core_body:
        print('  [FAIL] tokens.core.css 里出现 !important —— 变量层不该有优先级声明')
        bad += 1

    if verbose:
        print('     合计 %d 条顶层规则：core %d · reset %d · library %d'
              % (sum(stats.values()), stats['core'], stats['reset'],
                 stats['library']))
    if bad:
        print('  [FAIL] %d 处不满足' % bad)
        return 1
    print('  [OK] 变量层与底座层都是 tokens.css 的精确切片')
    return 0


def write():
    css = io.open(SRC, encoding='utf-8').read()
    core_text, reset_text, stats, unknown = build(css)
    if unknown:
        print('  [FAIL] 有未归类的规则，先处理再写：%s' % unknown[:3])
        return 1
    io.open(CORE, 'w', encoding='utf-8', newline='\n').write(core_text)
    io.open(RESET, 'w', encoding='utf-8', newline='\n').write(reset_text)
    print('  已写出 tokens.core.css（%d 条）· base.reset.css（%d 条）'
          % (stats['core'], stats['reset']))
    return 0


# ---------------------------------------------------------------------------
# 反向控制：三种漂移都必须红
# ---------------------------------------------------------------------------
def _mutate(css, fn):
    return fn(css)


def selftest():
    print('  === 反向控制（split-tokens）===')
    css = io.open(SRC, encoding='utf-8').read()
    base_core, base_reset, _, _ = build(css)
    bad = 0

    cases = [
        ('改一条变量（core 应失配）',
         css.replace('--r-sm:', '--r-sm: 3px; /*x*/ --r-sm:', 1)),
        ('删一条焦点环（reset 应失配）',
         re.sub(r':focus-visible\s*\{[^}]*\}', '', css, count=1)),
        ('加一条未归类的全局规则',
         css + '\nbody { background: #fff; }\n'),
    ]
    for label, mutated in cases:
        core, reset, stats, unknown = build(mutated)
        drift = (core != base_core) or (reset != base_reset) or bool(unknown)
        print('  [%s] %-28s 期望红 ⇒ 实际%s%s'
              % ('OK ' if drift else 'BAD', label, '红' if drift else '绿',
                 ('  未归类：' + unknown[0][:40]) if unknown else ''))
        if not drift:
            bad += 1

    # 良性对照：tokens.css 原样必须一致
    core, reset, stats, unknown = build(css)
    ok = (core == base_core and reset == base_reset and not unknown)
    print('  [%s] %-28s 期望绿 ⇒ 实际%s'
          % ('OK ' if ok else 'BAD', '原样不动（良性对照）', '绿' if ok else '红'))
    if not ok:
        bad += 1

    if check(verbose=False) != 0:
        bad += 1
    if bad:
        print('  [FAIL] %d 条自检不成立' % bad)
        return 1
    print('  [OK] 判据有牙，真实文件一致')
    return 0


def main(argv):
    if '--write' in argv:
        return write()
    if '--selftest' in argv:
        return selftest()
    return check()


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
