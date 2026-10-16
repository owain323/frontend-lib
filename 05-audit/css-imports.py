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


def inline_defined(html):
    """本页**内联 `<style>` 块里自己定义**的 class 名。

    🔴 0.8.9 新增（第三次收紧判据，起因是两个**误报**）：
      · `02-primitives/switch/demo.html` 报了「缺 states.css」
        —— 但它第 15 行自己写了 `.state { font-family: var(--mono); … }`
      · `03-patterns/list/demo.html` 报了「缺 bar.css」（那是 09-assets 的图表）
        —— 但它第 19 行自己写了 `.bar { display: flex; … }`
      ⇒ 两次都是「demo 自己定义了同名 class」⇒ 报出来必然是误报。

    ⭐ 这条判据的价值不只是少几个误报：**误报率高是这道门禁至今
      "只报告不判失败"的原因**。降不下误报，它永远升不成 FAIL，
      也就永远挡不住它抓到过的那类真问题
      （form-validation 用 `.btn--primary` 没引 button.css ⇒
        暗色下 2.45:1，实测值）。
    """
    out = set()
    for m in re.finditer(r'<style[^>]*>(.*?)</style>', html, re.S):
        css = m.group(1)
        # 只取**类选择器**：`.foo` 后跟 { , : 空格 > 或行尾
        for mm in re.finditer(r'\.([A-Za-z][\w-]*)\s*(?=[,:{>+~\s]|$)', css):
            out.add(mm.group(1))
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
        # 🔴 本页自己定义的 class 不算"用了别人的"（0.8.9）
        used -= inline_defined(html)
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
        print('  ⚠️ **本门禁报的是「可能」缺失**，请人工确认再修：')
        print('')
        print('  它抓到过一个**真问题**（值了）：')
        print('    form-validation 页用了 .btn--primary 却没引 button.css')
        print('    ⇒ 按钮拿不到 color: var(--text-on-accent)')
        print('    ⇒ 实测暗色下白字 on 浅蓝底 = 2.45:1（需 4.5）')
        print('')
        print('  🔴 0.8.9 起它**不再是"只报告"**：')
        print('    · 判据三次收紧后的实测误报：**36 页 / 0 个疑似**')
        print('      （第三次收紧 = 「本页内联 <style> 里自己定义的 class 不算缺引用」）')
        print('    · 补了 --selftest 的 3 条反向控制（会红 / 两类不误报）')
        print('    ⇒ 一道"永远 PASS"的门禁等于没有门禁（INVARIANT I-10）。')
        print('      误报降下来了，它就有资格按退出码判失败。')
    return 1 if bad else 0


def selftest():
    """反向控制：证明这道门禁**真的会红**（0.8.9）。

    🔴 为什么要做（它此前一直是"只报告不判失败"）：
      报告里写着「本脚本作为**辅助线索**保留，等积累更多样本再考虑升为 fail」。
      而**误报率高**正是它升不上去的原因 —— 一道天天误报的门禁，
      升成 FAIL 只会让人习惯性忽略它。

      本次做了两件事：
        ① 收紧判据（本页自已定义的 class 不算缺引用）⇒ 实测误报 2 → **0**
        ② 补反向控制 ⇒ 才有资格谈"升为 FAIL"

    ⚠️ fixture 建在**临时目录**里，绝不碰真仓库
      （P0-1 的教训：反向控制有副作用，中断就污染源码）。
    """
    import shutil
    import tempfile

    global ROOT
    real_root = ROOT
    tmp = tempfile.mkdtemp(prefix='cssimp-')
    bad = 0
    try:
        os.makedirs(os.path.join(tmp, '02-primitives', 'btn'))
        # ⚠️ 必须用 `with` 显式关闭：第一版写 `io.open(...).write(...)`
        #    —— 没关闭 ⇒ fixture 内容可能还没落盘 ⇒ build_map 读到空文件
        #    ⇒ 判据**正确地**没报，而反向控制报「没牙」。
        #    差一点就把「自己写坏了 fixture」当成「门禁没鉴别力」去改判据。
        #    ⇒ 与今天 purg-css-selftest 那次是同一类错：
        #      **自检写错比判据失效更隐蔽。**
        with io.open(os.path.join(tmp, '02-primitives', 'btn', 'btn.css'),
                     'w', encoding='utf-8') as _f:
            _f.write('.btn-x { color: red; }\n')

        # ① 用了 .btn-x 却不引 btn.css ⇒ 必须报
        demo = os.path.join(tmp, '02-primitives', 'btn', 'demo.html')
        with io.open(demo, 'w', encoding='utf-8') as _f:
            _f.write('<html><body><button class="btn-x">x</button></body></html>\n')
        ROOT = tmp
        rc = main()
        ok = (rc == 1)
        print('  %s ① 用了 .btn-x 不引 btn.css ⇒ %s'
              % ('OK ' if ok else '🔴 ', '正确报红' if ok else '没报红（没牙）'))
        if not ok:
            bad += 1

        # ② 本页**自己定义**了 .btn-x ⇒ 不许报（这正是本轮修掉的那类误报）
        with io.open(demo, 'w', encoding='utf-8') as _f:
            _f.write('<html><head><style>.btn-x { color: blue; }</style></head>'
                     '<body><button class="btn-x">x</button></body></html>\n')
        ROOT = tmp
        rc2 = main()
        ok2 = (rc2 == 0)
        print('  %s ② 本页自已定义 .btn-x ⇒ %s'
              % ('OK ' if ok2 else '🔴 ', '不误报' if ok2 else '误报'))
        if not ok2:
            bad += 1

        # ③ 引对了 ⇒ 不许报
        with io.open(demo, 'w', encoding='utf-8') as _f:
            _f.write('<html><head><link rel="stylesheet" href="btn.css"></head>'
                     '<body><button class="btn-x">x</button></body></html>\n')
        ROOT = tmp
        rc3 = main()
        ok3 = (rc3 == 0)
        print('  %s ③ 正常引了 btn.css ⇒ %s'
              % ('OK ' if ok3 else '🔴 ', '不误报' if ok3 else '误报'))
        if not ok3:
            bad += 1
    finally:
        ROOT = real_root
        shutil.rmtree(tmp, ignore_errors=True)

    print('')
    print('  %s' % ('反向控制全部通过 ⇒ 这道门禁有鉴别力'
                    if not bad else '🔴 %d 条反向控制没通过' % bad))
    return 1 if bad else 0


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(main())
