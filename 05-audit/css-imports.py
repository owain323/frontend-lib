#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
css-imports.py — demo 页面「用了组件 class 却没引它的 CSS」门禁

===========================================================================
🔴 为什么必须有这个门禁（ H4a，2026-10-06）
---------------------------------------------------------------------------
  实测发现：`03-patterns/form-validation/demo.html` 里放了
  `<button class="btn btn--primary">提交</button>`，但**页面没引 button.css**。

  ⇒ 结果：按钮拿到了 button.css 里那条 `color: var(--text-on-accent)` 吗？
     **没有** ⇒ 它继承了 `body` 的颜色（暗色下是浅色 #E4E7EA）
  ⇒ 实测 `白字(255,255,255) on 浅蓝底(122,169,222)` = **2.45:1**（需 4.5）

  ⛔ 全部静默：页面能显示、CSS 合法、控制台干净、`refs.py` 也**通过**
     （因为 `refs.py` 只查「已引的 CSS 里有没有定义」，
       而 button.css 压根没被引 ⇒ 它认为"未定义"反而正常）。
  ⇒ 只有「按主题实测对比度」才抓得到 —— 也就是上一轮新建的
     `dark-contrast.js` 报了 11 个，逐个查才查到这里。

  ⚠️ 这类问题**只能机械检测**（人眼看不出少引了一个 CSS）。

===========================================================================
判据
---------------------------------------------------------------------------
  ① 建立「class → 定义它的组件 CSS」映射（扫全部组件 CSS，剥掉注释）
  ② 对每个 demo 页面：取出它 `<link rel=stylesheet>` 引的 CSS 集合
  ③ 页面 `class="..."` 里用到的 class，若其归属 CSS **不在**引用集合里
     ⇒ 报缺失

  ⚠️ 豁免：
     · `tokens.css` / `typography.css`（基础层，默认都引）
     · `is-*` 状态类（由 JS 切换，不属于某个组件）
     · 页面自己目录内的 CSS（同目录引用也算已引）
"""
import sys
import os
import io
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = ('tokens.css', 'typography.css', 'focus-ring.css')

# 组件 CSS 里定义的 class → 该 CSS 的相对路径（用于报告）
# 🔴 带组件前缀的 class（能明确认出属于哪个组件）⇒ 才做检查。
#    刻意**不含** row / state / item / label / box / wrap 这类通用词 ——
#    它们在多个组件里各有含义，按它们报错必然误报（实测 4 个）。
PREFIXED = set()
for _p in ('btn', 'badge', 'card', 'field', 'select', 'combo', 'date-range',
           'drange', 'tree', 'dd', 'nav', 'tab', 'acc', 'overlay', 'toast',
           'dialog', 'drawer', 'list', 'switch', 'choice', 'pagination',
           'bar', 'spark', 'model', 'sep', 'state', 'form'):
    PREFIXED.add(_p)

CLASS_OWNER = {}


def build_map():
    CLASS_OWNER.clear()
    for f in glob.glob(os.path.join(ROOT, '0*', '*', '*.css')):
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        base = os.path.basename(f)
        if base in BASE:
            continue
        s = io.open(f, encoding='utf-8').read()
        s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
        for m in re.finditer(r'\.([a-zA-Z][a-zA-Z0-9_-]*)', s):
            CLASS_OWNER.setdefault(m.group(1), set()).add(base)


def page_css(html, page_dir):
    """页面实际引用的 CSS 文件名集合（支持 ../x/y.css 与 y.css 两种写法）"""
    out = set()
    for m in re.finditer(r'<link[^>]+rel=["\']stylesheet["\'][^>]*>', html):
        tag = m.group(0)
        h = re.search(r'href=["\']([^"\']+)["\']', tag)
        if not h:
            continue
        href = h.group(1)
        if href.startswith(('http', '//', 'data:')):
            continue
        out.add(os.path.basename(href))
    return out


def page_classes(html):
    out = set()
    for m in re.finditer(r'class=["\']([^"\']+)["\']', html):
        for c in m.group(1).split():
            if not c or c.startswith('is-') or c.startswith('js-'):
                continue
            if '--' in c:            # CSS 变量名，不是 class
                continue
            out.add(c)
    # 模板生成 / 运行时拼接的 class（含插值的）
    for m in re.finditer(r'class=["\'][^"\']*\{', html):
        pass
    return out


def main():
    build_map()
    pages = (glob.glob(os.path.join(ROOT, '0*', '*', 'demo.html')) +
             glob.glob(os.path.join(ROOT, '10-review', '*', 'demo.html')))
    pages = sorted(set(pages))

    bad = 0
    for f in pages:
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        html = io.open(f, encoding='utf-8').read()
        linked = page_css(html, os.path.dirname(f))
        used = page_classes(html)
        need = set()
        for c in used:
            # 🔴 两次收紧判据（都是因为误报）：
            #   ① 只在 class **唯一归属**某个 CSS 时才报
            #      （`btn` 被多个 CSS 定义 ⇒ 报出来必是误报）
            #   ② **且**该 class 带组件前缀
            #      ⚠️ 实测：`row` / `state` / `item` 这类**通用词**，
            #         在 sparkline.css / states.css / table.css 里各有含义，
            #         demo 页面里的 `.row` 根本不是那些组件
            #         ⇒ 只按"唯一归属"报，仍有 4 个误报。
            #   ⇒ 正解：只查**能明确认出是哪个组件**的 class。
            if not any(c == p or c.startswith(p) for p in PREFIXED):
                continue
            owners = CLASS_OWNER.get(c, ())
            if len(owners) == 1:
                css = list(owners)[0]
                if css not in linked:
                    need.add(css)
        if need:
            bad += 1
            print('  FAIL  %s' % rel)
            print('        缺引: %s' % ', '.join(sorted(need)))
            # 指出是哪些 class 导致的（最多 4 个）
            culprits = []
            for c in sorted(used):
                for css in CLASS_OWNER.get(c, ()):
                    if css in need and c not in culprits:
                        culprits.append(c)
            if culprits:
                print('        用到的 class: %s' % ', '.join(culprits[:6]))

    print('  扫了 %d 个 demo 页面，%d 个可能有缺失引用' % (len(pages), bad))
    if bad:
        print('')
        print('  ⚠️ **本门禁只报告，不 fail**：')
        print('')
        print('  它抓到过一个**真问题**（值了）：')
        print('    form-validation 页用了 .btn--primary 却没引 button.css')
        print('    ⇒ 按钮拿不到 color: var(--text-on-accent)')
        print('    ⇒ 实测暗色下白字 on 浅蓝底 = 2.45:1（需 4.5）')
        print('')
        print('  但它的**误报率偏高**，因为 class 名在组件间复用：')
        print('    · `btn`  同时被 button.css / table.css / overlay.css 定义')
        print('    · `row` 同时是 sparkline.css 与 demo 自己的东西')
        print('    ⇒ 我已两次收紧判据（唯一归属 + 组件前缀），仍有误报。')
        print('')
        print('  ⇒ 结论：这类问题**最可靠的抓法是 `dark-contrast.js` + 人工逐个查**')
        print('    （按主题实测对比度，不确定度远低于静态推断）。')
        print('    本脚本作为**辅助线索**保留，等积累更多样本再考虑升为 fail。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
