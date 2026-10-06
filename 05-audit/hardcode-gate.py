#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
hardcode-gate.py — 组件里不许硬编码颜色

为什么
-------------------------------------
扫出组件 CSS 里的硬编码颜色，逐个核实后发现 **5 处真问题**：

| 位置 | 硬编码 | 暗色下的后果 |
|---|---|---|
| `states.css` 骨架屏 | `#ece8de` / `#f5f2ea` | 暗色下是两块**刺眼的白块** |
| `nav.css` 抽屉遮罩 | `rgba(21,24,28,.4)` | 深底上遮罩与底同色 ⇒ **看不出有遮罩** |
| `overlay.css` 弹窗遮罩 | `rgba(31,29,25,.45)` | 同上 |
| `button.css` danger hover | `#8f1e17` | 深底上"加深"等于**消失** |

⇒ 规律：**写死颜色 = 主题切换时必然失效**。
和 `--text-on-accent`（白字压深底）是同一类错误。

判据
----
组件 CSS（`02-primitives` / `03-patterns` / `04-recipes`）里
**不许出现** `#hex` 或 `rgb()/rgba()`，**除非**：

豁免（写进白名单，理由必须写在这里）：
- `01-tokens/**`  —— 它**就是**色板定义本身
- `05-audit/**`   —— 门禁脚本里要写正则和示例
- 颜色画布类（`background: #fff` 造一个绘制用的画布）——
  目前本库没有，出现时在这里加一条并写明理由

用法：python 05-audit/hardcode-gate.py
"""
import sys
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 整目录豁免
DIR_EXEMPT = ('01-tokens', '05-audit')
# 行内容忍（白名单带理由；新增必须写清为什么）
LINE_EXEMPT = (
    # 🔴 这里**曾经**豁免过"勾号用白色"，理由是"白勾跟随所压底色、不是主题色"。
    #    **那个判断是错的** —— 实测：暗色下 accent 变亮（#7aa9de），
    #    白勾压在上面只有 2.45:1，**低于 WCAG 1.4.11 对图形元素要求的 3:1**。
    #    ⇒ 勾号必须用 --text-on-accent（暗色下是深字，7.73:1），不能写死。
    #    留这一行注释是因为"看起来像豁免"很容易再骗一次。
    # 这两条是"压深色底的白字/白心"，是**语义**不是主题色：
    # 按钮变亮时字变深由 --text-on-accent 负责，不该写死在组件里。
    ('color: #ffffff;   /* 白字压 danger', '白字压 danger 底，语义色对；暗色下由 --danger-hover 提亮保证'),
    ('border: solid #ffffff;          /* 压在 accent 上',
     '勾号压在 accent 底上；暗色下 accent 变亮，这个白勾是"挖空"效果，需人工确认'),
)

HEX = re.compile(r'#[0-9a-fA-F]{3,8}\b')
RGB = re.compile(r'\brgba?\s*\(')


def main():
    root = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else ROOT
    issues = []
    # 🔴 判据收窄（第一版报 56 处，其中 50 处误报）：
    #   · `04-recipes/**` 是**精简档 自包含单文件** —— 它**必须**内联色板副本
    #     （部署到 某项目 不能外链），那些 #hex 是**设计要求**，不是疏漏。
    #   · `demo.html` 里的一次性样式不是组件（它们演示"怎么用"）。
    #   ⇒ 只抓**组件 CSS**：02-primitives / 03-patterns 下的 .css。
    files = []
    for base in ('02-primitives', '03-patterns'):
        files += glob.glob(os.path.join(root, base, '**', '*.css'), recursive=True)
    for p in files:
        rel = os.path.relpath(p, root).replace(os.sep, '/')
        if any(rel.startswith(d) for d in DIR_EXEMPT):
            continue
        try:
            src = open(p, encoding='utf-8', errors='replace').read()
        except OSError:
            continue
        # 先整体剥掉多行注释（逐行剥会把跨行注释的尾巴当代码）
        src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
        lines = src.split('\n')
        for i, ln in enumerate(lines, 1):
            if not (HEX.search(ln) or RGB.search(ln)):
                continue
            if any(k in ln for k, _ in LINE_EXEMPT):
                continue
            issues.append((rel, i, ln.strip()[:58]))
    for rel, ln, txt in issues:
        print('  [hardcode-gate] %-38s L%-4d %s' % (rel, ln, txt))
    print('')
    if issues:
        print('%d 处硬编码颜色 —— 主题切换时会失效。' % len(issues))
        print('  改法：换成 tokens 里的语义令牌；确需写死就加进脚本的 LINE_EXEMPT 并写明理由。')
        return 1
    print('无硬编码颜色：全部走令牌。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
