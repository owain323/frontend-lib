#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
numeric-gate.py — 数字排印必须走统一机制

背景
-----------------------
1. Windows 的 Segoe UI 里 `1` `8` `0` 本来就等宽（10.33px @14px），
   **但逗号只有 4.25px** ⇒ `12,345,678` 仍然会歪。
2. 不同系统（macOS SF / Linux DejaVu）连数字本身都不一定等宽。
⇒ **不能依赖系统字体默认，必须显式声明。**

而建这个门禁之前，库里有三套做法：
  · `list.css`  自己写 `font-variant-numeric: tabular-nums`
  · `longform`  用自造的 `.num`（没进 tokens）
  · `states`    的数据行（26,831 条记录）**根本没处理**

判据
----
1. **不允许在组件 CSS 里直接写 `font-variant-numeric`** ——
   只能用 tokens.css 里的 `.num` / `.num-lg`。
2. **凡是展示千分位/小数的元素（`12,345` `2.41%` `1.50`），
   必须带 `.num` 或 `.num-lg` 类** —— 否则数字列会歪。

用法：python 05-audit/numeric-gate.py
"""
import sys
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 千分位 或 小数（可能是金额、数量、百分比）
NUMERIC = re.compile(r'(?<![\w.])\d{1,3}(?:,\d{3})+(?![\w])|(?<![\w.])\d+\.\d+')
# 唯一允许写 font-variant-numeric 的地方。
# ⚠️ 04-recipes 下的**自包含单文件页**（精简档）也允许 ——
#    它们不引 typography.css（部署到 某项目 只能单文件），
#    删掉自己的定义会让数字失去等宽。这是"不能一刀切"的边界。
ALLOWED_CSS = ('typography.css', 'longform.html', 'content.html')

# 🔴 组件内部格式化元素（0.8.9 · 门禁从假绿变成真检查后暴露的）
#   判据① 抓的是「组件 CSS 自己写 font-variant-numeric」，
#   但下面这些文件里的那一行出现在**组件自己生成的元素**上：
#     date-range  → <input type=date>（日期 2026-10-16 不等宽会随位数跳动）
#     progress    → 百分比读数（不跳动才看得出进度在动）
#     pagination  → 页码（小数点要能对齐）
#     accordion   → .acc-table .num（表格内等宽 + 右对齐）
#     bar / scientific-plot / model-viewer → SVG 坐标轴刻度（10px 等宽才对得齐）
#     report / table → --stats 表格的统计量列（p 值要能横向对比）
#     tree         → 计数/大小列
#
#   为什么该豁免：**内容由组件生成，使用者无从给元素加 .num 类**。
#   「数字排印走统一机制」约束的是**使用者写的数字**，
#   不是组件自己的格式化实现 —— 否则就是要求组件放弃必要的排版控制。
#
#   ⭐ 与已有的「精简档自包含页」豁免同属一条边界：
#     **豁免的共同点是「这份代码的使用者控制不了它」**。
#   ⚠️ 列举式：新增这类组件必须显式加进来，否则会被抓到
#      —— 宁可多报一次，也不要默默放过。
ALLOWED_COMPONENT_INTERNAL = (
    'date-range.css', 'progress.css', 'pagination.css', 'accordion.css',
    'bar.css', 'scientific-plot.css', 'model-viewer.css',
    'report.css', 'table.css', 'tree.css',
)


def scan(roots):
    """🔴 参数约定（0.8.9 · 外部审计 P0-1）—— roots 是目录列表。

    事故：check-all.sh 用 `--dir <目录列表>` 调用本脚本，
    而旧写法把 `sys.argv[1]`（字面量 "--dir"）当 root
    ⇒ root = <cwd>/--dir（不存在）⇒ glob 到 0 个文件
    ⇒ 无违规 ⇒ exit 0 ⇒ 门禁显示 PASS。
    ⇒ 「数字排印」这道核心卖点的门禁，在官方全量门禁里**等于没跑**。

    ⭐ 但 root 不能改成"第一个位置参数"：这几个脚本的 root 语义是**库根**
      （它们在 root 之下自己找 02-primitives / 0*），
      root 变成子目录后仍然扫 0 个文件 —— 换了理由的假绿（E41 v1 的教训）。
    """
    files = []
    for root in roots:
        files += glob.glob(os.path.join(root, '**', '*.css'), recursive=True)
        files += glob.glob(os.path.join(root, '**', '*.html'), recursive=True)
    files = sorted(set(files))
    files = [f for f in files if os.path.sep + '05-audit' + os.path.sep not in f]
    # 🔴 `04-recipes/*/content.html` 是**参考片段**（供粘贴用的内容结构，
    #    不是可独立打开的页面），它没有自己的 <style> ——
    #    数字等宽由对应的 longform.html 提供。
    #    要求片段自己带 .num 会造成"加了 refs 就报未定义"的死循环。
    #    这是"自包含单文件 vs 内容片段"的边界，不是缺陷。
    files = [f for f in files if os.path.basename(f) != 'content.html']
    issues = []
    # 🔴 demo 页豁免（0.8.9）：组件的 demo 为了「能直接双击打开、演示怎么用」，
    #   会把 typography.css 里的 .num **内联一份**
    #   ⇒ 对它要求"不要自己写 font-variant-numeric"不合理：
    #     它不引 typography.css（引了就不是自包含演示页了）。
    #   这与已有的「精简档自包含页」豁免是**同一条边界**，不是新特例。
    # ⚠️ 但只豁免**判据①**；判据②（数据格没挂 .num）对 demo 仍然生效
    #      —— demo 演示的就是"该怎么用"，它自己不该用错。
    # ⚠️ 判定按「文件名含 demo」而不是只认 demo.html：
    #      实测 scrollbar-demo.html、*-demo.html 这类命名也在用。
    # 🔴 不要把 demo 从 files 里剔掉 —— 那样它连判据②也不跑了，那是削弱判据。
    for p in files:
        name = os.path.relpath(p, ROOT).replace(os.sep, '/')
        _is_demo = 'demo' in os.path.basename(p)
        src = open(p, encoding='utf-8', errors='replace').read()
        lines = src.split('\n')
        for i, line in enumerate(lines, 1):
            # ① 组件 CSS 里自己写 font-variant-numeric
            if ('font-variant-numeric' in line
                    and os.path.basename(name) not in ALLOWED_CSS
                    and os.path.basename(p) not in ALLOWED_COMPONENT_INTERNAL
                    and not _is_demo):
                issues.append(('各写各的', name, i, line.strip()[:52]))
            # ② 含千分位/小数的元素没带 .num
            # 🔴 判据必须**连标签内的文本一起看**：
            #    <td>26,831 条记录</td> 的数字在**文本节点**里，
            #    标签本身的属性里没有 —— 只扫标签会整条漏掉。
            #    做法：先匹配开标签，再取它到下一个 < 之间的文本。
            # 🔴 正文必须**紧跟开标签**（0.8.9 修）：
            #   原来 `([^<]*)` 会跨过子标签吃到 `</span>` 前的文本，
            #   于是 `<td class=\"num\">4.186 <span>(0.214)</span></td>`
            #   里的 `(0.214)` 被算给了外层 td——
            #   而外层**已经**挂了 num，判据却仍报「没挂」。
            #   ⇒ 改成 `([^<]*)` 只取紧邻文本 + 用捕获组拿完整标签，
            #      子标签里的数字由它自己的标签名去查。
            for m in re.finditer(r'<(\w+)([^>]*)>([^<]*)', line):
                tag, attrs, text = m.group(1), m.group(2), m.group(3)
                if tag in ('style', 'script', 'meta', 'link', 'br', 'hr',
                           'path', 'svg', 'option', 'code', 'pre', 'title',
                           'kbd', 'samp', 'var'):
                    continue
                # 🔴 附加读数类子元素（0.8.9 修）：
                #   `<td class="num">4.186 <span class="stat__se">(0.214)</span></td>`
                #   里 `(0.214)` 是**标准误** —— 它属于外层那一格的排印，
                #   而外层已经挂了 .num ⇒ 不该再要求 span 自己挂一次。
                #   同类：置信区间 / p 值 / 变化量的辅助读数。
                #   ⚠️ 不能把 span 整体豁免 —— 有些 span 本身就是数据格。
                if tag == 'span' and any(
                        k in attrs for k in ('stat__se', 'stat__ci',
                                             'stat__p', '__hint', '__sub')):
                    continue
                # 行内 CSS / JS 里的数值（1.05、0.5、1.4s）不是"展示的数据"
                if ':' in line and ('px' in line or 's ' in line or 'ms' in line
                                    or 'transform' in line or 'opacity' in line
                                    or 'filter' in line or 'transition' in line):
                    continue
                # placeholder="0.00" 是提示文本不是数据；不强制
                if tag == 'input' and 'placeholder' in attrs and 'value' not in attrs:
                    continue
                if not (NUMERIC.search(attrs) or NUMERIC.search(text)):
                    continue
                # class 里含 num 词（.num / --num / num-lg 都算）
                # 🔴 若这一格的数字出现在**子标签**里（`<span>` / `<code>`…），
                #   那份数字的排印归子标签管，不归外层 td ——
                #   外层挂了 num 就算这一格合规。
                _rest = line[m.end(3):]
                if re.match(r'\s*</?\w+', _rest) and 'num' in attrs.split('class=')[-1]:
                    continue
                if 'num' in attrs.split('class=')[-1]:
                    continue
                # 🔴 判据要"窄到只圈住真病灶"（ui-benchmark-redesign 纪律）：
                #    第一版太宽 —— 14 项里 11 项是误报（CSS 数值、时长、版本、
                #    对比度读数、正文里的数字全被误报）。
                #    真病灶只有一种形状：**数据密集的容器里没等宽**。
                #    所以只对数据类元素强制，其余一律放过。
                is_data = tag in ('td', 'th') or any(
                    k in attrs for k in ('list__value', 'metric', 'stat',
                                         'kpi', 'amount', 'price', 'value'))
                # 🔴 0.12.0：数字排印**原子**自己的数据槽（`metric__value` /
                #    `.delta`）不需要再挂 `.num`。理由不是"给组件开小口"：
                #    它们用 `font-family: var(--mono)` —— **等宽字族每个字形同宽**，
                #    `tabular-nums` 只对比例字族有意义（在等宽字族上是无效动作）。
                #    判据① 仍然管着它们（不许写 font-variant-numeric，已删）；
                #    这里是判据② 的合理豁免：**等宽由字族保证，不由类名保证**。
                # ⚠️ 与 `stat__se` 那类豁免同性质：判据要窄到只圈真病灶。
                if 'metric__value' in attrs or 'delta' in attrs.split('class=')[-1]:
                    continue
                if not is_data:
                    continue
                # 反例/说明段落里的数字不该强制
                st = max(0, i - 3)
                # 🔴 ctx 必须**含本行**（0.8.9 修）：实测「浏览器版本」这类说明
                #   就在**同一个 <td>** 里（表头写「浏览器版本」，
                #   单元格写「Firefox 64+」）⇒ 只看前 3 行永远豁免不到。
                ctx = chr(10).join(lines[st:i]) + line
                # ⚠️ 词表扩充要当心：这一段是**收窄**判据（少报误报），
                #   不是放宽。每个词都对应一类「讲怎么用」而不是「展示数据」：
                #     浏览器 / 版本 → 兼容性表格（数字是版本号）
                #     WCAG / 对比度 / 实测 → 无障碍说明（数字是实测读数）
                #     写法 / 不写成 → 格式约定说明（数字是举例）
                #     显著性 / 置信 / 标准误 → 统计表（数字已在 .stat 里）
                if any(k in ctx for k in (
                        '反例', '不要', '不应该', '示例', '例如', '比如',
                        '浏览器', '版本', '支持', 'WCAG', '对比度', '实测',
                        '写法', '读数', '不写成', '规范', '显著性',
                        '置信', '标准误', '透明度', '面积图')):
                    continue
                issues.append(('数字未等宽', name, i,
                               (text or m.group(0))[:36]))
    return issues, len(files)


def main():
    # 🔴 参数约定（0.8.9 · 外部审计 P0-1）：`--` 开头的一律当 flag，不当路径。
    raw = [a for a in sys.argv[1:] if not a.startswith('-')]
    roots = [a for a in raw if os.path.isdir(a)]
    # 🔴 传了路径但一个都不存在 ⇒ 明确报红。
    #   不能用 `or [ROOT]` 兜底：那是把「调用方传错了」当成「没传参数」，
    #   两者跑出来的结果一样但性质相反 —— 混起来又是一次假绿。
    if raw and not roots:
        print('❌ 传入的路径都不存在：%s' % raw)
        print('   这是**假绿**：不是"数字排印合规"，是"什么都没检查"。')
        return 1
    roots = roots or [ROOT]
    issues, n_files = scan(roots)
    for kind, name, ln, txt in issues:
        print('  [numeric-gate] %-10s %s:L%-4d %s' % (kind, name, ln, txt))
    print('')
    print('（扫了 %d 个文件）' % n_files)
    # 🔴 零文件守卫：扫到 0 个文件时**必须判红**。
    if n_files == 0:
        print('❌ 一个文件都没扫到 —— 这是**假绿**，本门禁不接受空扫描。')
        return 1
    if issues:
        print('%d 项：数字排印没有走统一机制。' % len(issues))
        print('  改法：元素加 class="num"（表格/金额/涨跌幅）或 class="num-lg"（指标块）；')
        print('       不要在组件 CSS 里自己写 font-variant-numeric。')
        return 1
    print('数字排印：全部走 tokens 的 .num / .num-lg。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
