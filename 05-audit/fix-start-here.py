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
# 🔴 2026-10-10 收口：这张表原本只有 15 个组件，而库里实际 26 个（不含 2 个页面示例）。
#    漏掉的 11 个（select / combobox / date-range / popover / progress / skeleton /
#    drawer / dropdown / pagination / tooltip / tree）复用者在入口**根本看不到** ——
#    这比"文档写错一个数字"更严重：读者会以为这个库没有下拉选择、没有分页、没有日期区间。
WHEN = {
    'button': '几乎总要',
    'input': '有表单就要',
    'badge': '有状态标记就要（"已披露""停牌"）',
    'card': '有分组内容就要',
    'choice': '单选 / 多选就要',
    'select': '原生 select 的外观或交互不够用就要',
    'combobox': '选项多到要搜索，或要选多个并留成标签就要',
    'switch': '有"立即生效的设置"就要',
    'separator': '要分开内容块就要',
    'skeleton': '数据还没到、先把版式占住就要',
    'progress': '有耗时过程要给进度就要',
    'popover': '要一段信息贴着触发元素浮出来就要',
    'date-range': '要选起止日期就要',
    'tabs': '同层级内容切换就要',
    'accordion': '长表单分段就要',
    'dropdown': '要一组动作（新建 / 导出 / 删除）就要',
    'tooltip': '图标按钮或缩写需要一句话解释就要',
    'pagination': '数据多到要翻页就要',
    'tree': '层级数据（文件 / 组织 / 分类）要展开就要',
    'drawer': '要从侧边滑出面板就要',
    'overlay': '需要弹层（吐司 / 模态）就要',
    'states': '**凡是会异步取数就要**',
    'form-validation': '提交前要校验就要',
    'list': '列表会动态增删就要',
    'nav': '顶部要导航，或长文要目录就要',
    'content': '写文档 / 长文就要',
}
CN = {
    'button': '按钮', 'input': '输入框', 'badge': '标签 / 徽章',
    'card': '卡片', 'choice': '单选 / 多选', 'select': '下拉选择',
    'combobox': '可搜索选择', 'switch': '开关', 'separator': '分隔线',
    'skeleton': '加载骨架', 'progress': '进度条 / 环', 'popover': '浮层气泡',
    'date-range': '日期区间', 'tabs': '标签页', 'accordion': '折叠面板',
    'dropdown': '动作菜单', 'tooltip': '文字提示', 'pagination': '分页',
    'tree': '树形', 'drawer': '侧边抽屉',
    # 🔴 原来 nav 写"导航/抽屉"，但库里后来有了真正的 drawer ——
    #    两个组件共用一个中文名，读者会以为是同一个东西。拆开。
    'nav': '导航 / 目录',
    'overlay': '弹窗 / 吐司', 'states': '状态（空 / 加载 / 错 / 成功）',
    'form-validation': '表单校验', 'list': '列表增删', 'content': '长文排版',
}
# 表里的顺序（按"最常被要"排，不是字母序 —— 复用者是照着找的）
ORDER = ['button', 'input', 'badge', 'card', 'choice', 'select', 'combobox',
         'switch', 'separator', 'skeleton', 'progress', 'popover', 'date-range',
         'tabs', 'accordion', 'dropdown', 'tooltip', 'pagination', 'tree',
         'drawer', 'overlay', 'states', 'form-validation', 'list', 'nav',
         'content']

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


# "这是组件的行为层，不是可选增强"的**可机械判据**：
# JS 真的在管键盘 / ARIA / 焦点。
# 实测（2026-10-10）：必需档最低 9 处（tooltip.js）、可选档最高 2 处（toc.js）
# ⇒ 阈值取 5，两侧各有余量 —— 不是贴着现有数据拍出来的。
ARIA_MIN = 5
PAT_BEHAVIOR = re.compile(
    r"aria-|setAttribute\(\s*['\"]role|\.focus\(\)|activeElement|"
    r"focusin|focusout|\binert\b")
PAT_KEY = re.compile(r'keydown|keypress|keyup')
PAT_ARIA = re.compile(r"aria-|setAttribute\(\s*['\"]role")
PAT_FOCUS = re.compile(r'\.focus\(|activeElement|focusin|focusout|\binert\b')


def _js_path(rel, js_name):
    return os.path.join(ROOT, os.path.dirname(rel), js_name)


def js_mechanisms(rel, js_name):
    """JS 里**实测**承担了哪些机制 —— 表格里这一列是数出来的，不是我写的。"""
    src = io.open(_js_path(rel, js_name), encoding='utf-8').read()
    return ' · '.join([
        '键盘 ' + ('✓' if PAT_KEY.search(src) else '—'),
        'ARIA ' + ('✓' if PAT_ARIA.search(src) else '—'),
        '焦点 ' + ('✓' if PAT_FOCUS.search(src) else '—'),
    ])


def check_js_classification(rows, required, optional):
    """「必需 / 可选」是**人写的判断**，所以它必须被源码反向校验。

    三条判据：
      ① 目录里有 JS，却既不标必需也不标可选 ⇒ 漏登记（新增组件最容易犯）
      ② 标了"必需"，源码里却没有行为契约的痕迹 ⇒ 标错了，那是纯增强
      ③ 标了"可选"，源码里却满是行为契约 ⇒ 也标错了，它其实必需

    任何一条不符就退出 —— 分类表自己不会说话，只能靠这个替它说话。
    """
    bad = []
    for name, rel, n_css, n_js, js_name in rows:
        if not js_name:
            continue
        n = len(PAT_BEHAVIOR.findall(
            io.open(_js_path(rel, js_name), encoding='utf-8').read()))
        if name not in required and name not in optional:
            bad.append('%s：有 %s，但没登记进 REQUIRED_JS / OPTIONAL_JS'
                       % (name, js_name))
        elif name in required and n < ARIA_MIN:
            bad.append('%s：标了「必需」，但 %s 里行为契约只有 %d 处（< %d）'
                       ' ⇒ 它是纯增强，不该标必需' % (name, js_name, n, ARIA_MIN))
        elif name in optional and n >= ARIA_MIN:
            bad.append('%s：标了「可选」，但 %s 里行为契约有 %d 处（>= %d）'
                       ' ⇒ 它是行为层，不该标可选' % (name, js_name, n, ARIA_MIN))
    if bad:
        raise SystemExit(
            'JS 的「必需 / 可选」分类与源码不符：\n  - ' + '\n  - '.join(bad))


def build_table(rows, comps):
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
    #
    # 🔴 2026-10-10：这张分类表是**人写的判断**，而人写的东西会漏。
    #    原先只登记了 5 个，库里还有 9 个带 JS 的组件根本没登记
    #    （combobox / select / dropdown / drawer / popover / date-range /
    #     pagination / tooltip / tree）⇒ 它们会落到 `elif n_js` 分支，
    #    被标成裸粗体数字，读者分不清"必需"还是"可选"。
    #    ⇒ 全部登记完，并用 `check_js_classification()` 从源码反向校验，
    #      漏登记 / 误判都会红。
    REQUIRED_JS = {
        'tabs': 'tabs.js',
        'accordion': 'accordion.js',
        'overlay': 'overlay.js',
        'combobox': 'combobox.js',
        'select': 'select.js',
        'dropdown': 'dropdown.js',
        'drawer': 'drawer.js',
        'popover': 'popover.js',
        'date-range': 'date-range.js',
        'pagination': 'pagination.js',
        'tooltip': 'tooltip.js',
        'tree': 'tree.js',
    }
    OPTIONAL_JS = {'list': ('flip.js', 'FLIP 增删动画，纯增强'),
                   'nav': ('toc.js', '自动生成目录，纯增强')}
    check_js_classification(rows, REQUIRED_JS, OPTIONAL_JS)
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
        # beta 从契约里读，不手抄 —— 契约一变，入口跟着变。
        cn = CN.get(name, name)
        c = comps.get(name)
        if c and c.get('maturity') and c['maturity'] != 'stable':
            cn += '（%s）' % c['maturity']
        out.append('| %s | `%s` | %d | %s | %s |'
                   % (cn, rel, n_css, js, WHEN.get(name, '')))
    out += ['',
            '### 🔴 这些组件的 JS 是**必需的**（不是增强）',
            '',
            '它们的 JS 承担**行为契约**：键盘、ARIA、焦点。'
            '只抄 CSS 会得到"看起来能用其实不能用"的组件。',
            '',
            '| 组件 | JS | JS 里实测承担的机制 |',
            '|---|---|---|']
    for name, rel, n_css, n_js, js_name in rows:
        if name not in REQUIRED_JS:
            continue
        out.append('| %s | `%s` | %s |'
                   % (CN.get(name, name), js_name, js_mechanisms(rel, js_name)))
    out += ['',
            '**已经人工验证过后果的三条**（其余的按上表推断，不要凭印象写后果）：',
            '',
            '- 标签页只抄 CSS：方向键不切面板 · Tab 会逐个穿过所有 tab',
            '- 折叠面板只抄 CSS：Enter / Space 不响应 · 面板的 `role="region"` 缺失',
            '- 弹窗 / 吐司只抄 CSS：**没有焦点陷阱** · Esc 不关 · 读屏不播报',
            '',
            '> `flip.js` / `toc.js` 是**可选增强**（动画、目录生成），',
            '> 它们的 CSS 本身是纯 CSS —— 不抄那两个 JS，组件照样能用。',
            '']
    out += build_recipes()
    return '\n'.join(out)


def build_recipes():
    """页面级示例 —— 上面是零件，下面是已经拼好的整页。

    复用者最常见的问法是"我要做个 XX 页，有现成的吗"，
    而原来的入口只给零件清单，等于让每个人自己从头拼。
    """
    d = os.path.join(ROOT, '04-recipes')
    names = sorted(x for x in os.listdir(d) if os.path.isdir(os.path.join(d, x)))
    miss = [x for x in names if x not in RECIPE_DESC]
    if miss:
        raise SystemExit('04-recipes/ 下这些目录在 RECIPE_DESC 里没有说明：%s'
                         % '、'.join(miss))
    out = ['',
           '### 现成页面（整页抄，不是零件）',
           '',
           '| 示例 | 目录 | 它示范什么 |',
           '|---|---|---|']
    for n in names:
        out.append('| `%s/` | `04-recipes/%s/` | %s |' % (n, n, RECIPE_DESC[n]))
    out += ['']
    return out


def build_assets():
    """09-assets/ 下的能力清单 —— 与 ai/START-HERE.md 同源，同一份 ASSET_DESC。"""
    d = os.path.join(ROOT, '09-assets')
    names = sorted(x for x in os.listdir(d) if os.path.isdir(os.path.join(d, x)))
    miss = [x for x in names if x not in ASSET_DESC]
    if miss:
        raise SystemExit('09-assets/ 下这些目录在 ASSET_DESC 里没有说明：%s'
                         % '、'.join(miss))
    # 🔴 不要再加中文名前缀：ASSET_DESC 本身第一句就是中文名
    #    （"柱状图，含…""迷你趋势线，没有…"），拼上去就变成"柱状图 —— 柱状图，含…"。
    out = ['| 目录 | 它解决什么 |', '|---|---|']
    for n in names:
        out.append('| `09-assets/%s/` | %s |' % (n, ASSET_DESC[n]))
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
# 09-assets/README.md 里的目录表也由本脚本生成 —— 2026-10-10 收口时发现：
# 那份 README 的标题还写着「素材（图标）」，而这一层早就是 5 个图表能力，
# 正文里一个字都没提。跟 START-HERE 是同一个病：目录会变，散文不会跟着变。
ASSET_BEGIN = '<!-- ==== ASSET-LIST-BEGIN ==== -->'
ASSET_END = '<!-- ==== ASSET-LIST-END ==== -->'


def load_components():
    """ai/components.json → {id: 组件}。入口里的成熟度一律从这里读，不手抄。"""
    p = os.path.join(ROOT, 'ai', 'components.json')
    if not os.path.isfile(p):
        raise SystemExit('ai/components.json 不存在 —— 先跑 '
                         'python 05-audit/gen-ai-contract.py')
    return {c['id']: c
            for c in json.loads(io.open(p, encoding='utf-8').read())['components']}


def inventory():
    """给 ai/START-HERE.md 用的「实测清单」。

    三条都是**数出来的**，不是手抄的：
      · 组件数与成熟度分布 ← ai/components.json
      · 04-recipes/ 与 09-assets/ 下的目录 ← 实际目录列表
    """
    comps = load_components()
    ms = {}
    for c in comps.values():
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
    table = build_table(rows, load_components())
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

    assets = build_assets()
    a_p = os.path.join(ROOT, '09-assets', 'README.md')
    s3 = io.open(a_p, encoding='utf-8').read()
    i3 = s3.index(ASSET_BEGIN)
    j3 = s3.index(ASSET_END) + len(ASSET_END)
    want3 = ASSET_BEGIN + '\n' + assets + '\n' + ASSET_END

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
        if _norm(s3[i3:j3]) == _norm(want3):
            print('  [OK  ] 09-assets/README.md 的能力清单与实际一致')
        else:
            print('  [FAIL] 09-assets/README.md 的能力清单已漂移 —— 跑 fix-start-here.py')
            bad = 1
        return bad

    io.open(p, 'w', encoding='utf-8').write(head + START + '\n' + table + '\n' + tail)
    print('  ✓ 已重建 START-HERE.md 的组件表（%d 个组件）' % len(rows))
    io.open(ai_p, 'w', encoding='utf-8').write(s2[:i2] + want2 + s2[j2:])
    print('  ✓ 已重建 ai/START-HERE.md 的实测清单')
    io.open(a_p, 'w', encoding='utf-8').write(s3[:i3] + want3 + s3[j3:])
    print('  ✓ 已重建 09-assets/README.md 的能力清单')
    return 0


def _norm(t):
    """只比表格部分，忽略行尾空白。"""
    return '\n'.join(l.rstrip() for l in t.strip().split('\n'))


if __name__ == '__main__':
    sys.exit(main())
