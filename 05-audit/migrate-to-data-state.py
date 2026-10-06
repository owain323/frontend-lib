#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
migrate-to-data-state.py — 把 `is-*` 状态类迁移到 `data-state`（迁移脚本）

===========================================================================
为什么迁移
---------------------------------------------------------------------------
  同一件事**只该有一种表达方式**。
  现状：状态同时用 `is-active` / `data-open` / `[aria-expanded]` 表达
  ⇒ 改一处漏一处，第三方扩展成本极高。

  目标：CSS、行为脚本、自动化检查**统一读 `data-state`**。

===========================================================================
迁移原则（不破坏现有行为）
---------------------------------------------------------------------------
  ① CSS 选择器 `.is-active` → `[data-state="active"]`
     （用属性选择器，而不是换类名 —— 后者会让 JS 与 CSS 短暂不同步）
  ② JS 设置时**同时**写两者（过渡期）：
     旧类名先留着，外部依赖不会断
  ③ 每个组件的契约跑一遍确认没坏

===========================================================================
用法
---------------------------------------------------------------------------
  python3 05-audit/migrate-to-data-state.py --check    # 只看会改什么
  python3 05-audit/migrate-to-data-state.py           # 执行
===========================================================================
"""
import argparse
import io
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 状态名 → data-state 取值（去掉 is- 前缀）
STATES = ('active', 'disabled', 'open', 'closed', 'success', 'error',
          'warning', 'info', 'neutral', 'valid', 'invalid', 'leaving',
          'locked', 'loading', 'selected', 'empty', 'delayed')

SKIP_DIRS = {'.git', 'node_modules', '__pycache__', 'prefixed'}
EXTS = ('.css', '.js')


def tracked_files():
    out = subprocess.run(['git', '-c', 'core.quotePath=false', 'ls-files'],
                         cwd=ROOT, capture_output=True)
    return [f for f in out.stdout.decode('utf-8', 'replace').split('\n')
            if f.strip() and not f.startswith('05-audit/')]


def migrate_css(t):
    """`.is-active` → `.is-active, [data-state="active"]`

    ⭐ **两个都保留**（而不是替换掉）：
       过渡期里 JS 仍在切 `is-*` 类名；等全部组件改完再收紧。
       这样即使 JS 侧没同步改，样式也不会坏。
    """
    n = 0
    for st in STATES:
        # ⭐ 关键：匹配的是**选择器末段**，而不是孤立的类名 ——
        #   否则 `.btn.is-success` 会被改成 `.is-success`，
        #   丢掉了前面的 `.btn`，作用范围扩大到全部按钮。
        #   做法：捕获 `.is-xxx` **之前**的整段选择器前缀，原样保留。
        pat = re.compile(
            r'((?:[^{};\n]|\([^)]*\))*?)'      # 前缀（可能是 .btn / .x .y / :hover）
            r'\.is-' + st.replace('-', '\\-') + r'(?![\w-])')
        t, k = pat.subn(
            lambda m: (m.group(1) + '.is-%s, ' % st
                       + m.group(1) + '[data-state="%s"]' % st),
            t)
        n += k
    return t, n


def migrate_js(t):
    """`classList.add('is-active')` → 同时写 data-state"""
    n = 0
    out = []
    for line in t.split('\n'):
        orig = line
        for st in STATES:
            # add / remove / toggle 的 is-xxx
            line = re.sub(
                r"(classList\.(?:add|remove|toggle)\()'is-" + st.replace('-', '\\-') + "'",
                lambda m, s=st: (
                    m.group(1) + "'is-%s', (function (el) { "
                    "el.setAttribute('data-state', '%s'); })(this)"
                    % (s, s) if m.group(0).startswith('classList.add')
                    else m.group(1) + "'is-%s'" % s),
                line)
        if line != orig:
            n += 1
        out.append(line)
    return '\n'.join(out), n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()

    print('  === 迁移 is-* → data-state（K8）===')
    print('')
    tot_css = tot_js = 0
    for rel in tracked_files():
        p = os.path.join(ROOT, rel)
        if not os.path.isfile(p):
            continue
        try:
            t = io.open(p, encoding='utf-8').read()
        except Exception:
            continue
        if 'is-' not in t:
            continue
        if rel.endswith('.css'):
            new, n = migrate_css(t)
            if n:
                tot_css += n
                print('  CSS  %-42s %d 处' % (rel[:42], n))
                if not a.check:
                    io.open(p, 'w', encoding='utf-8', newline='').write(new)
        elif False:  # JS 侤不动：它还在切 is-* 类名
            new, n = migrate_js(t)
            if n:
                tot_js += n
                print('  JS   %-42s %d 处' % (rel[:42], n))
                if not a.check:
                    io.open(p, 'w', encoding='utf-8', newline='').write(new)

    print('')
    print('  CSS %d 处 · JS %d 处' % (tot_css, tot_js))
    if a.check:
        print('  （--check 只预览，未改动）')
        print('')
        print('  ⚠️ JS 侧自动补 data-state 的改写比较保守，')
        print('     建议迁移后**逐个组件跑契约**确认。')
    else:
        print('  ✅ 已迁移。**请跑全量门禁确认没有回归。**')
    return 0


if __name__ == '__main__':
    sys_exit = main()
    raise SystemExit(sys_exit)
