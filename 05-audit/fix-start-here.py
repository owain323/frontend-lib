#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
fix-start-here.py — 用**实测数据**重建 START-HERE.md 的组件表

为什么需要这个脚本（而不是手改）
--------------------------------
2026-10-03：`hygiene.py` 报出 4 个源文件"未被任何地方引用" ——
badge / separator / tabs / accordion。

查真因：**它们的 demo 确实引了**，但 `START-HERE.md`（复用者的第一份文件）
**没有列这四个**。而且顺手发现 `states.css` 的行数写着 255、实测 258。

🔴 这类漂移靠人眼永远发现不了 ——
因为改组件的人不会去翻 START-HERE，而读 START-HERE 的人不会去量文件。

⇒ 所以：**这个表必须是生成的，不是手写的。**

用法：python 05-audit/fix-start-here.py --check   # 只查是否同步
      python 05-audit/fix-start-here.py            # 重建
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 组件名 → (什么时候要)
WHEN = {
    'button': '几乎总要',
    'badge': '有状态标记就要（"已披露""停牌"）',
    'separator': '要分开内容块就要',
    'switch': '有"立即生效的设置"就要',
    'input': '有表单就要',
    'choice': '有选择就要',
    'card': '有分组内容就要',
    'tabs': '同层级内容切换就要',
    'accordion': '长表单分段就要',
    'form-validation': '提交前要校验就要',
    'list': '列表会动态增删就要',
    'nav': '内容长要目录就要',
    'overlay': '需要弹层就要',
    'states': '**凡是会异步取数就要**',
    'content': '写文档/长文就要',
}
CN = {
    'button': '按钮', 'badge': '标签/徽章', 'separator': '分隔线',
    'switch': '开关', 'input': '输入框', 'choice': '单选/复选/下拉',
    'card': '卡片', 'tabs': '标签页', 'accordion': '折叠面板',
    'form-validation': '表单校验', 'list': '列表增删', 'nav': '导航/抽屉',
    'overlay': '弹窗/toast', 'states': '状态（空/错/加载）', 'content': '长文排版',
}
# 表里的顺序（按"最常被要"排，不是字母序 —— 复用者是照着找的）
ORDER = ['button', 'badge', 'separator', 'switch', 'input', 'choice', 'card',
         'tabs', 'accordion', 'form-validation', 'list', 'nav', 'overlay',
         'states', 'content']

START = '### 第 3 步：只抄你真正要用的组件'
# 🔴 结束标记必须**含 `##`**，否则会匹配到正文里出现的同一串字。
#    （第一版漏了 `##` ⇒ ValueError: substring not found）
END = '## 抄完先做这三件事'


def measure():
    rows = []
    for name in ORDER:
        rel = None
        for base in ('02-primitives', '03-patterns'):
            p = os.path.join(ROOT, base, name, name + '.css')
            if os.path.isfile(p):
                rel = '%s/%s/%s.css' % (base, name, name)
                css = p
                break
        if not rel:
            continue
        n_css = sum(1 for _ in io.open(css, encoding='utf-8'))
        # 🔴 JS 文件名**曾经不统一**（list 是 flip.js、nav 是 toc.js），
        #    按约定找不到时会静默显示「—」⇒ 读者以为不用抄 JS，
        #    而那恰恰是最危险的一栏（行为契约藏在里面）。
        #    ⇒ 找不到就退回"目录里唯一的 .js"，并把真实文件名带出去。
        d = os.path.dirname(os.path.join(ROOT, rel))
        js = os.path.join(d, name + '.js')
        if os.path.isfile(js):
            n_js = sum(1 for _ in io.open(js, encoding='utf-8'))
            js_name = name + '.js'
        else:
            cands = [f for f in os.listdir(d) if f.endswith('.js')]
            if len(cands) == 1:
                n_js = sum(1 for _ in io.open(os.path.join(d, cands[0]),
                                              encoding='utf-8'))
                js_name = cands[0]
            else:
                n_js, js_name = 0, None
        rows.append((name, rel, n_css, n_js, js_name))
    return rows


def build_table(rows):
    out = ['',
           '**不要整个库都搬。** 下面是实测的每个组件多大：',
           '',
           '🔴 **带 `JS` 的组件要连 JS 一起抄** —— 那个 JS 是**行为契约**',
           '（键盘、焦点、ARIA），**去掉它组件就"看起来能用其实不能用"**。',
           '',
           '| 组件 | 文件 | 行数 | JS | 什么时候要 |',
           '|---|---|---|---|---|']
    # 🔴 修正一个**危险的分类错误**（我自己犯的）：
    #   原来凡是有 .js 的组件都在「JS」列标粗体，暗示"必须抄"。
    #   但 list 的 flip.js 是**可选的 FLIP 动画工具**、nav 的 toc.js 是
    #   **目录生成脚本** —— 两者都**不是组件的行为层**，
    #   list.css / nav.css 本身是纯 CSS。
    #   ⇒ 把"必需的行为层"与"可选的增强脚本"分开标，
    #     否则复用者会以为不抄就"组件坏了"。
    REQUIRED_JS = {'tabs': 'tabs.js', 'accordion': 'accordion.js',
                   'overlay': 'overlay.js'}
    OPTIONAL_JS = {'list': ('flip.js', 'FLIP 增删动画，纯增强'),
                   'nav': ('toc.js', '自动生成目录，纯增强')}
    for name, rel, n_css, n_js, js_name in rows:
        if name in REQUIRED_JS:
            js = '**必需 %d** (`%s`)' % (n_js, js_name)
        elif name in OPTIONAL_JS:
            fn, why = OPTIONAL_JS[name]
            js = '可选 %d (`%s`，%s)' % (n_js, fn, why)
        elif n_js:
            js = '**%d** (`%s`)' % (n_js, js_name)
        else:
            js = '—'
        out.append('| %s | `%s` | %d | %s | %s |'
                   % (CN.get(name, name), rel, n_css, js, WHEN.get(name, '')))
    out += ['',
            '### 🔴 三个组件的 JS 是**必需的**（不是增强）',
            '',
            '| 组件 | JS | 只抄 CSS 会怎样 |',
            '|---|---|---|',
            '| 标签页 | `tabs.js` | 方向键不切面板 · Tab 会逐个穿过所有 tab |',
            '| 折叠面板 | `accordion.js` | Enter/Space 不响应 · 面板的 `role="region"` 缺失 |',
            '| 弹窗/toast | `overlay.js` | **没有焦点陷阱** · Esc 不关 · 读屏不播报 |',
            '',
            '> `flip.js` / `toc.js` 是**可选增强**（动画、目录生成），',
            '> 它们的 CSS 本身是纯 CSS —— 不抄那两个 JS，组件照样能用。',
            '']
    return '\n'.join(out)


AI_BEGIN = '<!-- ==== AI-INVENTORY-BEGIN ==== -->'
AI_END = '<!-- ==== AI-INVENTORY-END ==== -->'

# 每个目录一句「它回答什么问题」——写的是**用途**，不是文件清单。
# 🔴 新增目录必须到这里登记：不登记 ⇒ 本脚本直接报错退出，
#    而不是静默漏掉（链子里少一个环是最难被发现的一种错）。
RECIPE_DESC = {
    'analysis-report': '组合型研究报告：正文 + 辅助栏并排，窄屏退回单栏',
    'data-showcase': '四种数据表达方式对照：我到底该用哪个',
    'longform': '单栏长文排版与阅读节奏',
    'table': '专业数据表格：列级格式与单位，三种用途预设',
}
ASSET_DESC = {
    'bar': '柱状图，含 charter 13 图表规范的裁剪铁律',
    'echarts-adapter': '把令牌喂给 ECharts，按需引入；本库不含 ECharts',
    'model-viewer': '惰性加载的 3D 模型查看器',
    'scientific-plot': '二维科学绘图：坐标轴 / 误差棒 / 置信区间带 / 对数轴',
    'sparkline': '迷你趋势线，没有坐标轴的走势提示',
}


def inventory():
    """给 ai/START-HERE.md 用的「实测清单」。

    三条都是**数出来的**，不是手抄的：
      · 组件数与成熟度分布 ← ai/components.json
      · 04-recipes/ 与 09-assets/ 下的目录 ← 实际目录列表
    """
    p = os.path.join(ROOT, 'ai', 'components.json')
    if not os.path.isfile(p):
        raise SystemExit('ai/components.json 不存在 —— 先跑 '
                         'python 05-audit/gen-ai-contract.py')
    comps = json.loads(io.open(p, encoding='utf-8').read())['components']
    ms = {}
    for c in comps:
        ms[c.get('maturity', '?')] = ms.get(c.get('maturity', '?'), 0) + 1

    def listing(base, desc):
        d = os.path.join(ROOT, base)
        names = sorted(x for x in os.listdir(d)
                       if os.path.isdir(os.path.join(d, x)))
        miss = [x for x in names if x not in desc]
        if miss:
            raise SystemExit(
                '%s/ 下这些目录在 fix-start-here.py 里没有说明：%s\n'
                '⇒ 在 %s 里补一句它回答什么问题，再跑本脚本'
                % (base, '、'.join(miss),
                   'RECIPE_DESC' if base == '04-recipes' else 'ASSET_DESC'))
        return ' · '.join('`%s`（%s）' % (x, desc[x]) for x in names)

    return '\n'.join([
        '- 组件 **%d** 个（%s）' % (len(comps), ' · '.join(
            '`%s` %d' % (k, ms[k]) for k in sorted(ms))),
        '- `04-recipes/`（页面级示例）：%s' % listing('04-recipes', RECIPE_DESC),
        '- `09-assets/`（图表与可视化）：%s' % listing('09-assets', ASSET_DESC),
    ])


def main():
    rows = measure()
    table = build_table(rows)
    p = os.path.join(ROOT, 'START-HERE.md')
    s = io.open(p, encoding='utf-8').read()
    i = s.index(START)
    j = s.index(END)
    head, tail = s[:i], s[j:]

    inv = inventory()
    ai_p = os.path.join(ROOT, 'ai', 'START-HERE.md')
    s2 = io.open(ai_p, encoding='utf-8').read()
    i2 = s2.index(AI_BEGIN)
    j2 = s2.index(AI_END) + len(AI_END)
    want2 = AI_BEGIN + '\n' + inv + '\n' + AI_END

    if '--check' in sys.argv:
        bad = 0
        cur = s[i:j]
        if _norm(cur) == _norm(START + '\n' + table + '\n'):
            print('  [OK  ] START-HERE.md 的组件表与实际文件一致')
        else:
            print('  [FAIL] START-HERE.md 的组件表已漂移 —— 跑 fix-start-here.py')
            bad = 1
        if _norm(s2[i2:j2]) == _norm(want2):
            print('  [OK  ] ai/START-HERE.md 的实测清单与实际一致')
        else:
            print('  [FAIL] ai/START-HERE.md 的实测清单已漂移 —— 跑 fix-start-here.py')
            bad = 1
        return bad

    io.open(p, 'w', encoding='utf-8').write(head + START + '\n' + table + '\n' + tail)
    print('  ✓ 已重建 START-HERE.md 的组件表（%d 个组件）' % len(rows))
    io.open(ai_p, 'w', encoding='utf-8').write(s2[:i2] + want2 + s2[j2:])
    print('  ✓ 已重建 ai/START-HERE.md 的实测清单')
    return 0


def _norm(t):
    """只比表格部分，忽略行尾空白。"""
    return '\n'.join(l.rstrip() for l in t.strip().split('\n'))


if __name__ == '__main__':
    sys.exit(main())
