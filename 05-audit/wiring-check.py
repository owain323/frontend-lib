#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
wiring-check.py — 组件"接线"检查：属性用了，配套的类名 / 脚本有没有？

为什么需要（这个坑我踩了两次）
--------------------------------
2026-10-03：sparkline 的 JS 找 `.sparkline[data-spark]`，
            demo 写的是 `class="spark"` ⇒ **9 个图一个没画出来，且不报错**。
2026-10-04：写 iOS 验证页时**又写了一次** `class="spark"` ⇒ 同样静默失效。

为什么上次的契约测试没抓到：
    `sparkline-contract.js` 只测它自己那个 demo 页，
    **管不到 10-review/ 下的页面**。

⚠️ 这类错的危险在于：**它不报错、不留痕、页面上只是"什么都没发生"**。
    所以必须有一个**扫全库**的检查，而不是逐页测。

判据（都是可机械查的，不含主观判断）：
    ① 用了 `data-spark` ⇒ 必须同时有 `sparkline` 类
    ② 用了 `data-tabs` / `data-accordion` ⇒ 必须引对应 JS
    ③ 用了 `role="tab"` / `class="accordion__"` ⇒ 必须引对应 JS
       （否则键盘行为与 ARIA 全部失效 —— "看起来能用其实不能用"）
    ④ 引用了本库 CSS/JS ⇒ 那个文件必须存在
"""
import sys
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# data 属性 → 必需的类名
ATTR_NEEDS_CLASS = {
    'data-spark': 'sparkline',
    'data-tabs': 'tabs',
    'data-accordion': 'accordion',
}
# 标记 → 必需的脚本（按文件名）
MARK_NEEDS_JS = {
    'data-spark': 'sparkline.js',
    'data-tabs': 'tabs.js',
    'data-accordion': 'accordion.js',
    'role="tab"': 'tabs.js',
    'accordion__trigger': 'accordion.js',
    'dialog__box': 'overlay.js',
}


def main():
    pages = [p for p in glob.glob(os.path.join(ROOT, '**', '*.html'), recursive=True)
             if '/05-audit/' not in p.replace('\\', '/')]
    bad = []
    checked = 0

    for f in pages:
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        try:
            s = open(f, encoding='utf-8', errors='replace').read()
        except OSError:
            continue
        # 去掉注释（注释里提不算）
        body = re.sub(r'<!--.*?-->', '', s, flags=re.S)
        checked += 1

        srcs = '\n'.join(re.findall(r'(?:href|src)="([^"]+)"', body))

        # ① data 属性 ⇒ 类名
        for attr, cls in ATTR_NEEDS_CLASS.items():
            if attr in body and not re.search(r'class="[^"]*\b%s\b' % cls, body):
                bad.append((rel, '用了 %s 但没有 class="%s"' % (attr, cls)))

        # ②③ 标记 ⇒ 脚本
        for mark, js in MARK_NEEDS_JS.items():
            if mark in body and js not in srcs:
                bad.append((rel, '用了 %s 但没引 %s' % (mark, js)))

        # ④ 引用的文件必须存在
        for src in re.findall(r'(?:href|src)="([^"]+\.(?:css|js))"', body):
            if src.startswith(('http:', 'https:', '//', 'data:')):
                continue
            p = os.path.normpath(os.path.join(os.path.dirname(f), src))
            if not os.path.isfile(p):
                bad.append((rel, '引用的文件不存在: %s' % src))

    if bad:
        print('  [FAIL] %d 处接线问题（组件**静默失效**，页面上不报错但也不工作）：' % len(bad))
        seen = set()
        for rel, msg in bad:
            k = (rel, msg)
            if k in seen:
                continue
            seen.add(k)
            print('     · %-34s %s' % (rel, msg))
        print('')
        print('  🔴 这类错不报错、不留痕，只表现为「点了没反应 / 图不出来」。')
        return 1
    print('  [OK  ] %d 个页面的组件接线全部正确' % checked)
    return 0


if __name__ == '__main__':
    sys.exit(main())
