#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
refs.py — 引用完整性门禁

检查 HTML 里用到的 class / 引用的 id，是否在对应的 CSS / 文档里真的存在。

为什么需要它：
    类名写错时，页面**不会报错、不会警告**，只是那个元素没有样式。
    看起来完全正常，但效果已经错了 —— 这是最难发现的一类 bug。
    库里有多个 demo，每个都引用几十个类名，靠人眼对不可靠。

用法：
    python refs.py demo.html            # 单个 HTML（自动跟随 <link> 的 CSS）
    python refs.py --dir <目录>          # 递归检查所有 .html
    python refs.py <a.html> <b.html>

退出码：0 = 干净；1 = 有未定义引用
"""

import sys
import os
import re
import glob

# 从 HTML 取 class 属性
RE_CLASS = re.compile(r'class\s*=\s*["\']([^"\']+)["\']', re.I)
# 从 HTML 取 id 属性
RE_ID = re.compile(r'\bid\s*=\s*["\']([^"\']+)["\']', re.I)
# <link rel=stylesheet href=...>
RE_LINK = re.compile(r'<link[^>]+rel\s*=\s*["\']?stylesheet["\']?[^>]*>', re.I)
RE_HREF = re.compile(r'href\s*=\s*["\']([^"\']+)["\']', re.I)
# 内联 <style> 块
RE_STYLE_BLOCK = re.compile(r'<style[^>]*>(.*?)</style>', re.I | re.S)
# CSS 里的类选择器
RE_CSS_CLASS = re.compile(r'\.([A-Za-z_][A-Za-z0-9_-]*)')
# JS 里引用的 id
RE_GETID = re.compile(r'getElementById\(\s*["\']([^"\']+)["\']\s*\)')
# href="#anchor"
RE_ANCHOR = re.compile(r'href\s*=\s*["\']#([^"\']+)["\']', re.I)
# 库的 token 类（CSS 变量，不在 class 里）
IGNORE_PREFIX = ('is-', 'has-', 'sr-', 'u-', 'js-')

# <code> 里是文档示例文字（如 <code>&lt;a href="#字段id"&gt;</code>），
# 不是真引用。扫之前先剥掉，否则示例里的 id 会被当成"引用了不存在的元素"。
RE_CODE = re.compile(r'<code[^>]*>.*?</code>', re.I | re.S)

# 🔴 2026-10-02 修正：<style> 和 <script> 块里的文本也必须剥掉。
#    实测踩到的坑：content.css 的**反模式注释**里写了
#    `<div class="code-block">`、`class="heading"` 这些反面示例，
#    refs.py 把它们当成了页面真实使用的 class ⇒ 报"未定义"。
#    样式块里的内容是 CSS，不是 HTML。
RE_STYLE_SCRIPT = re.compile(r'<(style|script)[^>]*>.*?</\1>', re.I | re.S)


def strip_comments(css: str) -> str:
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    return re.sub(r'^\s*@.*?$', '', css, flags=re.M)


def css_classes(css: str):
    out = set()
    for m in RE_CSS_CLASS.finditer(strip_comments(css)):
        name = m.group(1)
        # 排除伪类里的片段（:hover 之类已被上面剥掉大部分）
        out.add(name)
    return out


def collect_css(html_path, html_text):
    """外部 CSS + 内联 <style>，返回 (类集合, 文件列表)"""
    classes, files = set(), []
    d = os.path.dirname(os.path.abspath(html_path))
    for tag in RE_LINK.findall(html_text):
        hm = RE_HREF.search(tag)
        if not hm:
            continue
        rel = hm.group(1)
        if rel.startswith('http') or rel.startswith('//'):
            continue
        p = os.path.join(d, rel)
        if os.path.isfile(p):
            files.append(p)
            with open(p, encoding='utf-8', errors='replace') as f:
                classes |= css_classes(f.read())
    for blk in RE_STYLE_BLOCK.findall(html_text):
        classes |= css_classes(blk)
    return classes, files


def check(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        html = f.read()

    defined, css_files = collect_css(path, html)
    # 🔴 剥离顺序至关重要：**先剥大块（style/script），再剥小块（code）**。
    #
    #    反过来会出错：RE_CODE 的 `.*?` 会跨越块边界 ——
    #    实测踩到过：content.css 的注释里出现 `<code>` 字样，
    #    RE_CODE 从那里一直吃到后面某个 `</code>`，**把中间的 `</style>` 一起吃掉**，
    #    于是 RE_STYLE_SCRIPT 再也匹配不到完整的 style 块。
    #    症状：style 块里的 class="heading"（出现在反模式注释示例中）被当成页面用的类。
    scan = RE_STYLE_SCRIPT.sub('', html)
    scan = RE_CODE.sub('', scan)

    used = set()
    for m in RE_CLASS.finditer(scan):
        used.update(m.group(1).split())

    ids = set(RE_ID.findall(scan))

    # 🔴 只检查 JS 里的 getElementById，**不检查 href="#anchor"**。
    #    demo 里的占位链接（href="#x"）不是真引用，检查它只会制造误报。
    #    误报会让人训练成无视告警 —— 那比漏报更危险。
    js_ids = set(RE_GETID.findall(scan))

    missing_cls = sorted(
        c for c in used
        if c not in defined and not c.startswith(IGNORE_PREFIX)
    )
    missing_id = sorted(i for i in js_ids if i not in ids)

    # 目录项指向的 id 必须存在 —— 否则那一项永远不会被高亮。
    # 🔴 2026-10-02 新增。Owner 报"导航不跟随"，追下来发现目录第一项指向
    #    的 id 根本不存在（第一项永远不会高亮）。这类错完全可静态查出来，
    #    不该靠真机发现。
    toc_missing = sorted(set(
        m.group(1) for m in re.finditer(
            r'<a[^>]*class="[^"]*toc__link[^"]*"[^>]*href="#([^"]+)"', scan, re.I)
        if m.group(1) not in ids
    ))

    return (missing_cls, missing_id, toc_missing, css_files,
            len(used), len(defined))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = [a for a in sys.argv[1:] if a.startswith('--')]

    if '--help' in flags or not args:
        print(__doc__)
        return 2

    paths = []
    for a in args:
        if os.path.isdir(a):
            paths.extend(glob.glob(os.path.join(a, '**', '*.html'), recursive=True))
        else:
            paths.append(a)
    paths = [p for p in paths if os.path.isfile(p)]
    if not paths:
        print('没找到 HTML 文件')
        return 2

    bad = 0
    # 有多个文件时显示父目录 —— 库里有 6 个都叫 demo.html，只显示 basename 认不出是谁
    root = os.path.commonpath(paths) if len(paths) > 1 else None
    for p in paths:
        mc, mi, toc_bad, cf, nu, nd = check(p)
        name = os.path.relpath(p, root).replace('\\', '/') if root else os.path.basename(p)
        if not mc and not mi and not toc_bad:
            print('OK   %-26s %3d 个 class 全部有定义' % (name, nu))
        else:
            bad += 1
            print('FAIL %-26s 用了 %d 个 class / 找到 %d 个定义' % (name, nu, nd))
            if mc:
                print('     class 未定义：%s' % ', '.join(mc))
            if mi:
                print('     id 未找到  ：%s' % ', '.join(mi))
            if toc_bad:
                print('     目录项指向的 id 不存在：%s' % ', '.join('#' + t for t in toc_bad))
                print('       → 那一项永远不会被高亮，且点击会跳到页面顶部')
            if not cf:
                # 自包含单文件（精简档）把 CSS 内联在 <style> 里，本来就没有 <link>。
                # 只有"既没有 link 也没有内联 style"才是真问题。
                with open(p, encoding='utf-8', errors='replace') as fh:
                    has_inline = re.search(r'<style[^>]*>', fh.read(), re.I)
                if not has_inline:
                    print('     ⚠ 既没有 <link> 也没有 <style> —— 检查路径写错了？')

    print()
    if bad:
        print('%d 个文件有未定义引用 —— 不许提交（类名写错时页面不报错，只是静默失效）' % bad)
        return 1
    print('全部引用可解析。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
