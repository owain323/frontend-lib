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


def scan(root):
    files = sorted(glob.glob(os.path.join(root, '**', '*.css'), recursive=True))
    files += sorted(glob.glob(os.path.join(root, '**', '*.html'), recursive=True))
    files = [f for f in files if os.path.sep + '05-audit' + os.path.sep not in f]
    # 🔴 `04-recipes/*/content.html` 是**参考片段**（供粘贴用的内容结构，
    #    不是可独立打开的页面），它没有自己的 <style> ——
    #    数字等宽由对应的 longform.html 提供。
    #    要求片段自己带 .num 会造成"加了 refs 就报未定义"的死循环。
    #    这是"自包含单文件 vs 内容片段"的边界，不是缺陷。
    files = [f for f in files if os.path.basename(f) != 'content.html']
    issues = []
    for p in files:
        name = os.path.basename(p)
        src = open(p, encoding='utf-8', errors='replace').read()
        lines = src.split('\n')
        for i, line in enumerate(lines, 1):
            # ① 组件 CSS 里自己写 font-variant-numeric
            if 'font-variant-numeric' in line and name not in ALLOWED_CSS:
                issues.append(('各写各的', name, i, line.strip()[:52]))
            # ② 含千分位/小数的元素没带 .num
            # 🔴 判据必须**连标签内的文本一起看**：
            #    <td>26,831 条记录</td> 的数字在**文本节点**里，
            #    标签本身的属性里没有 —— 只扫标签会整条漏掉。
            #    做法：先匹配开标签，再取它到下一个 < 之间的文本。
            for m in re.finditer(r'<(\w+)([^>]*)>([^<]*)', line):
                tag, attrs, text = m.group(1), m.group(2), m.group(3)
                if tag in ('style', 'script', 'meta', 'link', 'br', 'hr',
                           'path', 'svg', 'option', 'code', 'pre', 'title',
                           'kbd', 'samp', 'var'):
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
                if not is_data:
                    continue
                # 反例/说明段落里的数字不该强制
                st = max(0, i - 3)
                ctx = '\n'.join(lines[st:i])
                if ('反例' in ctx or '不要' in ctx or '不应该' in ctx
                        or '示例' in ctx or '例如' in ctx or '比如' in ctx):
                    continue
                issues.append(('数字未等宽', name, i,
                               (text or m.group(0))[:36]))
    return issues


def main():
    root = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else ROOT
    issues = scan(root)
    for kind, name, ln, txt in issues:
        print('  [numeric-gate] %-10s %s:L%-4d %s' % (kind, name, ln, txt))
    print('')
    if issues:
        print('%d 项：数字排印没有走统一机制。' % len(issues))
        print('  改法：元素加 class="num"（表格/金额/涨跌幅）或 class="num-lg"（指标块）；')
        print('       不要在组件 CSS 里自己写 font-variant-numeric。')
        return 1
    print('数字排印：全部走 tokens 的 .num / .num-lg。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
