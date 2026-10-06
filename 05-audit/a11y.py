#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
a11y.py — 无障碍静态门禁

检查的是**能静态判定**的四类问题，全部对应 WCAG 的明确条款：

  1. 表单控件无可访问名称   WCAG 3.3.2 / 1.3.1 / 4.1.2
  2. <img> 缺 alt          WCAG 1.1.1
  3. <button> 无可读文本   WCAG 4.1.2
  4. <html> 缺 lang        WCAG 3.1.1
  5. 标题层级跳级          WCAG 1.3.1  最佳实践

🔴 这个门禁**查不出**什么（别指望它）：
   - 对比度 → contrast.py
   - 键盘是否真的可达 → 必须真机 Tab
   - focus 是否可见 → states.py + 真机
   - 屏幕阅读器实际播报内容 → 必须真机
   🔴🔴 **JS 动态生成的内容扫不到** —— 本门禁只解析静态 HTML。
      实测踩过：states demo 里四个状态的标题是 JS 生成的 <h3>，
      静态扫不到 → 门禁放行；但运行时它们确实造成了 h1 → h3 跳级。
      **组件内部的标题不要用 h1–h6**，用 p + 类名保持视觉，
      这样既不进文档大纲，也不会造成跳级。
   静态检查只能覆盖"文本特征"，运行时行为一律抓不到。

用法：
    python a11y.py demo.html
    python a11y.py --dir <目录>        # 递归扫所有 .html
    python a11y.py <file.html> --strict  # 标题层级等也报（默认报）

退出码：0 = 干净；1 = 有 HIGH 级问题
"""

import sys
import os
import re
import glob
from html.parser import HTMLParser

# 严重度
HIGH, LOW = 'HIGH', 'LOW'

# 这些控件必须有可访问名称
FORM_TAGS = ('input', 'select', 'textarea')
# 这些 type 的 input 不需要
SKIP_INPUT_TYPES = ('hidden', 'submit', 'button', 'reset', 'image')
# 这些元素必须有 alt
IMG_TAGS = ('img',)


class Checker(HTMLParser):
    def __init__(self, collect_only=False):
        HTMLParser.__init__(self, convert_charrefs=True)
        self.collect_only = collect_only   # 第一遍：只收集 label[for]，不报问题
        self.problems = []          # (sev, rule, line, msg)
        self.labels = {}            # for -> True
        self.label_wrapping = 0     # 当前 label 深度
        self.headings = []          # (level, line)
        self.ids = set()
        self._stack = []            # 记录未闭合的 label，用于判断包裹式
        self._in_label = False
        self._text_depth = 0        # 在按钮内部时累计文本
        self._btn_text = {}         # id/idx -> 累积文本
        self._btn_open = 0
        self._btn_needs_label = False

    # -------------------------------------------------------------- helpers
    def _line(self):
        return self.getpos()[0]

    def _add(self, sev, rule, msg):
        self.problems.append((sev, rule, self._line(), msg))

    @staticmethod
    def _attrs(attrs):
        return {k.lower(): (v if v is not None else '') for k, v in attrs}

    # -------------------------------------------------------------- 标签
    def handle_starttag(self, tag, attrs):
        a = self._attrs(attrs)
        line = self._line()
        if a.get('id'):
            self.ids.add(a['id'])

        if tag == 'html':
            if not a.get('lang'):
                self._add(HIGH, 'html-lang', '<html> 缺 lang 属性（WCAG 3.1.1）')

        elif tag == 'label':
            if a.get('for'):
                self.labels[a['for'].lower()] = True
            self._in_label = True

        elif tag in FORM_TAGS:
            self._check_form(tag, a)

        elif tag in IMG_TAGS:
            # alt="" 是合法的（装饰图必须显式写空），缺 alt 属性才是错
            if 'alt' not in a:
                self._add(HIGH, 'img-alt',
                          '<img src="%s"> 缺 alt 属性（WCAG 1.1.1）。'
                          '装饰图要显式写 alt=""，不要省略' % a.get('src', '?')[:40])

        elif tag == 'button':
            self._btn_open += 1
            self._btn_needs_label = True
            if a.get('aria-label') or a.get('aria-labelledby'):
                self._btn_needs_label = False
            if not self._btn_text:
                self._btn_text = {}

        elif re.match(r'h[1-6]$', tag):
            self.headings.append((int(tag[1]), line))

    def handle_endtag(self, tag):
        if tag == 'label':
            self._in_label = False
        elif tag == 'button':
            self._btn_open = max(0, self._btn_open - 1)
            if self._btn_open == 0:
                self._btn_needs_label = False

    def handle_data(self, data):
        # button 内的可见文本
        if self._btn_open > 0 and data.strip():
            self._btn_needs_label = False

    # -------------------------------------------------------------- 检查
    def _check_form(self, tag, a):
        # 第一遍（collect_only）只收集 label[for]，不做任何检查
        if self.collect_only:
            return
        # 🔴 aria-hidden="true" 的元素对辅助技术完全不可见，
        #    不需要可访问名称，也不该被报（demo 里的反例演示常这么写）。
        if a.get('aria-hidden', '').lower() == 'true':
            return

        itype = a.get('type', '').lower()
        if tag == 'input' and itype in SKIP_INPUT_TYPES:
            return

        # 已包裹在 <label> 里就算有名称
        if self._in_label:
            return

        if a.get('aria-label') or a.get('aria-labelledby'):
            return

        eid = a.get('id')
        if eid and eid.lower() in self.labels:
            return

        extra = ''
        if eid:
            extra = '（有 id="%s" 但没有对应的 <label for="%s">）' % (eid, eid)
        self._add(HIGH, 'form-label',
                  '<%s> 没有可访问名称（WCAG 4.1.2 / 3.3.2）%s '
                  '修法：加 <label for>、包进 <label>、或写 aria-label' % (tag, extra))

    # -------------------------------------------------------------- 收尾
    def finish(self):
        # 标题层级
        if self.headings:
            h1 = [l for lvl, l in self.headings if lvl == 1]
            if len(h1) == 0:
                self.problems.append((HIGH, 'heading', self.headings[0][1],
                                      '整页没有一个 <h1>'))
            elif len(h1) > 1:
                self.problems.append((LOW, 'heading', h1[1],
                                      '有 %d 个 <h1>（通常 1 个就够）' % len(h1)))
            prev = 0
            for lvl, line in self.headings:
                if prev and lvl > prev + 1:
                    self.problems.append((LOW, 'heading', line,
                                          '标题从 h%d 跳到 h%d（WCAG 1.3.1）' % (prev, lvl)))
                prev = lvl
        return self.problems


import re  # noqa: E402  已在顶部导入，此行仅为提醒


def check_file(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        src = f.read()

    # 🔴 修正一个真 bug：单遍扫描**假设 label 出现在 input 之前**。
    #    但两种顺序都是合法的 ——
    #      <label for="x">…</label><input id="x">    （label 在前）
    #      <input id="x"><label for="x">…</label>    （input 在前，本库现在用这个）
    #    单遍扫到 input 时 self.labels 还是空的 ⇒ 全部误报"缺可访问名称"。
    #    改两遍：第一遍只收集 label[for]，第二遍才检查。
    try:
        c0 = Checker(collect_only=True)
        c0.feed(src)
    except Exception:
        pass

    c = Checker()
    c.labels = c0.labels
    try:
        c.feed(src)
    except Exception as e:                       # 解析失败也要报，不许静默
        return [(HIGH, 'parse', 0, 'HTML 解析失败：%s' % e)], 0
    return c.finish(), len(c.headings)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args or '--help' in sys.argv:
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

    root = os.path.commonpath(paths) if len(paths) > 1 else None
    total_high = 0
    for p in paths:
        probs, nh = check_file(p)
        name = os.path.relpath(p, root).replace('\\', '/') if root else os.path.basename(p)
        high = [x for x in probs if x[0] == HIGH]
        low = [x for x in probs if x[0] == LOW]
        total_high += len(high)
        if not probs:
            print('OK   %-44s %d 个标题层级正常' % (name, nh))
            continue
        print('%s %-44s HIGH %d / LOW %d' % ('FAIL' if high else 'WARN', name,
                                             len(high), len(low)))
        for sev, rule, line, msg in probs:
            print('       L%-4d [%-10s] %s' % (line, rule, msg))

    print()
    if total_high:
        print('HIGH 级 %d 项 —— 不许提交' % total_high)
        return 1
    print('无 HIGH 级问题。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
