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


# 可引用外部文件的**真实标签**。
# 🔴 为什么必须有它（0.8.9 修 · 接进门禁时实测）：
#   原来直接用 `re.findall(r'(?:href|src)="([^"]+)"', body)` 抓全文本 ⇒
#   把 `<code>&lt;script src="echarts.min.js"&gt;</code>` 这种
#   **转义过的示例代码**也当成了真引用 ⇒ 报「引用的文件不存在: echarts.min.js」
#   （那个文件本来就不该存在 —— 示例说的是"主项目自己引"）。
#   ⇒ 只在**真标签**（`<link …>` / `<script …>`）内部取属性，
#     `&lt;script …&gt;` 不是标签，自然被排除。
REAL_REF_TAG = re.compile(
    r'<(?:link|script|img|iframe|source|a)\b[^>]*>', re.I)
RE_ATTR = re.compile(r'(?:href|src)="([^"]*)"', re.I)


def refs_in(body):
    """从**真标签**里取 href/src（不含转义示例、不含注释）。"""
    out = []
    for m in REAL_REF_TAG.finditer(body):
        out.extend(RE_ATTR.findall(m.group(0)))
    return out


SKIP_DIRS = ('node_modules', 'dist', '.git', '05-audit', '06-vendor',
             '10-review')


def page_files():
    """仓库里本库自己的页面。

    🔴 必须排除 node_modules / dist（0.8.9 修）：
      原来 glob `**/*.html` 会把 `node_modules/playwright-core/**/*.html`
       也扫进来 ⇒ 报出一堆 `/assets/index-xxx.js 引用的文件不存在`
       （那是第三方包自己的构建产物）⇒ 假红会淹没真问题。
       与 check-all.sh 里 `--dir` 那条纪律同源：**扫描范围必须显式列举**。
    """
    out = []
    for p in glob.glob(os.path.join(ROOT, '**', '*.html'), recursive=True):
        rel = os.path.relpath(p, ROOT).replace('\\', '/')
        if any(rel.split('/')[0] == d or ('/' + d + '/') in '/' + rel
               for d in SKIP_DIRS):
            continue
        out.append(p)
    return sorted(out)


def main():
    pages = page_files()
    bad = []
    checked = 0

    # 🔴 零视野守卫：一个页面都没扫到 ⇒ 不许判通过
    if not pages:
        print('  [FAIL] 一个页面都没扫到 ⇒ 视野已空，不许判通过')
        return 1

    for f in pages:
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        try:
            s = open(f, encoding='utf-8', errors='replace').read()
        except OSError:
            continue
        # 去掉注释（注释里提不算）
        body = re.sub(r'<!--.*?-->', '', s, flags=re.S)
        checked += 1

        srcs = '\n'.join(refs_in(body))

        # ① data 属性 ⇒ 类名
        for attr, cls in ATTR_NEEDS_CLASS.items():
            if attr in body and not re.search(r'class="[^"]*\b%s\b' % cls, body):
                bad.append((rel, '用了 %s 但没有 class="%s"' % (attr, cls)))

        # ②③ 标记 ⇒ 脚本
        for mark, js in MARK_NEEDS_JS.items():
            if mark in body and js not in srcs:
                bad.append((rel, '用了 %s 但没引 %s' % (mark, js)))

        # ④ 引用的文件必须存在
        for src in refs_in(body):
            if not src.endswith(('.css', '.js')):
                continue
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


# ---------------------------------------------------------------------------
# 反向控制（本库纪律：没有反向控制的判据不算门禁）
# 三条判据：
#   ① 转义过的示例代码**不许**被当成真引用（实测踩到的假红）
#   ② 真标签里的引用，文件不存在时**必须**报
#   ③ 用了标记却没引脚本时**必须**报
# ---------------------------------------------------------------------------
def _selftest():
    import tempfile
    tmp = tempfile.mkdtemp(prefix='wiring-')
    global ROOT
    keep_root = ROOT
    bad = 0

    def chk(label, got_bad, want_bad):
        nonlocal bad
        ok = got_bad == want_bad
        print('  %s %s' % ('OK ' if ok else '🔴 ', label))
        if not ok:
            print('       got=%r want=%r' % (got_bad, want_bad))
            bad += 1

    try:
        os.makedirs(os.path.join(tmp, '02-primitives', 'x'), exist_ok=True)
        page = os.path.join(tmp, '02-primitives', 'x', 'demo.html')
        ROOT = tmp
        # ① 转义示例 + 真实存在的引用 ⇒ 不许报
        open(page, 'w', encoding='utf-8', newline='').write(
            '<html><body>\n'
            '<code>&lt;script src="not-real.min.js"&gt;&lt;/script&gt;</code>\n'
            '<script src="x.js"></script>\n'
            '</body></html>\n')
        open(os.path.join(tmp, '02-primitives', 'x', 'x.js'), 'w').write('//')
        chk('① 转义示例不算真引用（旧版在这里假红）', main(), 0)

        # ② 真标签引用了不存在的文件 ⇒ 必须报
        open(page, 'w', encoding='utf-8', newline='').write(
            '<html><body>\n<script src="missing.js"></script>\n'
            '</body></html>\n')
        chk('② 真引用不存在 ⇒ 报', main(), 1)

        # ③ 用了标记却没引脚本 ⇒ 必须报
        mk = list(MARK_NEEDS_JS.items())[0]
        open(page, 'w', encoding='utf-8', newline='').write(
            '<html><body><div %s></div></body></html>\n' % mk[0].rstrip('>'))
        chk('③ 用了标记却没引脚本 ⇒ 报', main(), 1)
    finally:
        ROOT = keep_root

    print('')
    print('  ' + ('🔴 %d 条反向控制未通过' % bad if bad
                  else '反向控制全部通过 ⇒ 判据有鉴别力'))
    return 1 if bad else 0


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(_selftest())
    sys.exit(main())
