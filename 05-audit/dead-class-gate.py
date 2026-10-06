#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
dead-class-gate.py — 找出"CSS 定义了但从没人用"的类

背景（2026-10-03）
--------------------
这个库出现过三次**同一种静默失效**，都是"看起来有、实际没有"：

1. **27 处引用 `var(--sans)` / `var(--mono)`，而 tokens.css 从没定义它们**
   ⇒ 全部回退到浏览器默认字体。"库里看起来有字体体系，其实没有。"
2. **`.state--delayed` + `.is-shown`**：CSS 注释写着
   「由 JS 在超时后加 `.is-shown`」⇒ 读起来像实现了，
   **但全库没有任何 JS 加过它** ⇒ 延迟显示这个功能根本不存在。
3. **ES5 约束**只写在代码注释里，charter 没有、零门禁。

共同点：**约定/能力写下来了，但没有任何东西在守**。

判据
----
组件 CSS 里定义了、但**全库的 HTML 与 JS 都没用过**的类：

- 状态类（`is-*`）
- 变体类（`--sm` / `--selected` / `--compact` / `--error` …）

⚠️ **这类报告不是"必须删"**，而是"要人工判定"。三种处置：
  ① 真死代码（组件已删）⇒ 删
  ② 有意留白（注释写明"备好的能力"）⇒ 保留
  ③ **看起来实现了其实没有**（注释说 JS 会用，实际没人用）⇒
     **要么实现，要么改注释**——最危险的一种。

用法：python 05-audit/dead-class-gate.py          # 只报告
       python 05-audit/dead-class-gate.py --strict # 有就失败（接进门禁）
"""
import sys
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = ('01-tokens', '02-primitives', '03-patterns')

# 只查这些形态的类（其余的查了噪声太大）
WATCH = re.compile(
    r'(^is-)'                                  # 状态类
    r'|--(sm|md|lg|compact|selected|interactive|linked)'
    r'|--(delayed|error|loading|success|empty|warning)')


def collect_defined(root):
    out = {}
    for base in LIB:
        for f in glob.glob(os.path.join(root, base, '**', '*.css'), recursive=True):
            if 'demo' in os.path.basename(f):
                continue
            s = re.sub(r'/\*.*?\*/', '', open(f, encoding='utf-8').read(), flags=re.S)
            for m in re.finditer(r'\.([a-zA-Z][\w-]*)', s):
                name = m.group(1)
                if WATCH.search(name):
                    out.setdefault(name, set()).add(
                        os.path.relpath(f, root).replace('\\', '/'))
    return out


def collect_used(root):
    used = set()
    tmpl_prefixes = set()
    pats = glob.glob(os.path.join(root, '0*', '**', '*.js'), recursive=True) + \
          glob.glob(os.path.join(root, '0*', '**', '*.html'), recursive=True)
    # 🔴 2026-10-03 排除**门禁脚本自己**（05-audit/）。
    #    clicktest.js:458 里有 `s.cls.includes('state--' + key)` ——
    #    那是**检查**代码，不是"生成类名"，却被我的前缀正则当成了模板拼接，
    #    于是 `.state--delayed` 被误标成"浏览器实测在用"（实际没人用）。
    #    ⇒ 谁在"用它"要问**库与 demo**，不包括检查工具本身。
    pats = [f for f in pats if '05-audit' not in f.replace('\\', '/')
            and 'examples' not in f.replace('\\', '/')]
    for f in pats:
        s = open(f, encoding='utf-8', errors='replace').read()
        for m in re.finditer(r"classList\.(?:add|remove|toggle)\(\s*['\"]([\w-]+)['\"]", s):
            used.add(m.group(1))
        for m in re.finditer(r'class="([^"]*)"', s):
            used.update(m.group(1).split())
        for m in re.finditer(r"['\"]([\w -]+)['\"]\s*\+", s):   # 字符串拼接
            used.update(m.group(1).split())
        for m in re.finditer(r"\+\s*['\"]([\w -]+)['\"]", s):
            used.update(m.group(1).split())
        # 🔴 2026-10-03 补一类假警：**模板拼接的类名**。
        #    真实例子（overlay.js:97）：
        #        el.className = 'toast' + (opts.variant ? ' toast--' + opts.variant : '');
        #    三个变体 toast--success / --error / --warning 全部由此产生，
        #    但**静态扫不到** —— 源码里从来没有这三个完整字面量。
        #    浏览器实测确认三者都在渲染（点一遍 demo 的按钮即可复现）。
        #    ⇒ 记下"前缀"，凡 `前缀--*` 的死类都标成"模板生成，可能在用"。
        # 🔴 两个坑叠加才导致我第一版失效：
        #    ① 前缀带**前导空格**（' toast--' + v）⇒ 引号后必须允许 \s*
        #    ② `[\w-]*` 里的 `-` 会被贪婪吃掉第二个连字符 ⇒ 改用非贪婪 `[\w]*?`
        #    实测：前者返回 []，后者返回 ['toast--']。
        for m in re.finditer(r"['\"]\s*([A-Za-z][\w]*?--)\s*['\"]", s):
            tmpl_prefixes.add(m.group(1))
    return used, tmpl_prefixes


def main():
    root = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else ROOT
    defined = collect_defined(root)
    used, tmpl_prefixes = collect_used(root)
    dead = sorted(c for c in defined if c not in used)
    # 模板生成的（如 'toast--' + variant）—— 静态扫不到字面量，
    # 浏览器实测却真的在渲染。分开列，不混进"真死"里。
    dead_tmpl = [c for c in dead
                 if any(c.startswith(p) for p in tmpl_prefixes)]
    dead_real = [c for c in dead if c not in dead_tmpl]

    # 逐个找它的注释，看它自称是什么
    notes = {}
    for c in dead:
        for f in glob.glob(os.path.join(root, '0*', '**', '*.css'), recursive=True):
            s = open(f, encoding='utf-8', errors='replace').read()
            m = re.search(r'([^\n]*\*/)?\s*\.?' + re.escape(c) + r'\s*\{([^}]*)\}', s)
            if m:
                ctx = s[max(0, m.start() - 320):m.start()]
                lines = [l.strip() for l in ctx.split('\n') if l.strip().startswith('/*')
                         or l.strip().startswith('*')]
                notes[c] = ' '.join(lines)[-110:] if lines else ''
                break

    print('组件 CSS 定义的状态/变体类：%d 个' % len(defined))
    print('其中静态扫不到用法的：%d 个（真死 %d + 模板生成 %d）'
          % (len(dead), len(dead_real), len(dead_tmpl)))
    print('')
    if dead_tmpl:
        print('  【模板生成，浏览器实测在用】—— 不是死类：')
        for c in dead_tmpl:
            print('    · %-22s 由 `前缀--` + 变量 拼出来' % c)
        print('')
    if dead_real:
        print('  【真死类候选】—— 需要人工判定：')
        for c in dead_real:
            print('    · %-22s %s' % (c, notes.get(c, '')[:76]))
        print('')
    if not dead_real:
        print('  ✅ 没有真死类。')
        return 0
    print('  人工判定的三种处置：')
    print('    ① 真死代码（组件已删）⇒ 删')
    print('    ② 有意留白（注释写明"备好的能力"）⇒ 保留并标注')
    print('    ③ 注释说 JS 会用、实际没人用 ⇒ 最危险，改成诚实注释')
    if '--strict' in sys.argv:
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
