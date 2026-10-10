# 从这里开始

> **这个文件是给你用的，不是给我写的。**
> 目标：下次要用这个库，**照着下面抄，不用重新摸索**。

---

## 三步

### 第 1 步：判断你在哪一档

| 你的情况 | 走哪条 | 需要多少 |
|---|---|---|
| **某项目 / 单文件页**（不能外链 CSS、不能构建）| **A** | 令牌 13.8 KB + 你要的那几个组件 |
| **普通静态站**（能引 CSS、不能构建）| **B** | `<link>` 引 tokens + components |
| **React / Vite 等** | **C** | 先读下面「C 档的额外说明」|

### 第 2 步：抄令牌（**必做，三档都要**）

| 档 | 抄什么 | 怎么抄 |
|---|---|---|
| **A** | `04-recipes/tierA-tokens.css` | 整份粘进 `<style>` |
| **B / C** | `01-tokens/tokens.css` + `01-tokens/typography.css` | 两个 `<link>` |

> ⚠️ **A 档那份是从 `tokens.css` 自动抽出来的**（`make-tiersnippet.py`），
> 所以两边不会不一致。**不要手抄** —— 手抄迟早漂移。

### 第 3 步：只抄你真正要用的组件

**不要整个库都搬。** 下面是实测的每个组件多大：

🔴 **带 `JS` 的组件要连 JS 一起抄** —— 那个 JS 是**行为契约**
（键盘、焦点、ARIA），**去掉它组件就"看起来能用其实不能用"**。

| 组件 | 文件 | 行数 | JS | 什么时候要 |
|---|---|---|---|---|
| 按钮 | `02-primitives/button/button.css` | 353 | — | 几乎总要 |
| 输入框 | `02-primitives/input/input.css` | 238 | — | 有表单就要 |
| 标签 / 徽章 | `02-primitives/badge/badge.css` | 146 | — | 有状态标记就要（"已披露""停牌"） |
| 卡片 | `02-primitives/card/card.css` | 246 | — | 有分组内容就要 |
| 单选 / 多选 | `02-primitives/choice/choice.css` | 395 | — | 单选 / 多选就要 |
| 下拉选择（beta） | `02-primitives/select/select.css` | 151 | **必需 422** (`select.js`) | 原生 select 的外观或交互不够用就要 |
| 可搜索选择（beta） | `02-primitives/combobox/combobox.css` | 223 | **必需 393** (`combobox.js`) | 选项多到要搜索，或要选多个并留成标签就要 |
| 开关 | `02-primitives/switch/switch.css` | 370 | — | 有"立即生效的设置"就要 |
| 分隔线 | `02-primitives/separator/separator.css` | 73 | — | 要分开内容块就要 |
| 加载骨架 | `02-primitives/skeleton/skeleton.css` | 96 | — | 数据还没到、先把版式占住就要 |
| 进度条 / 环 | `02-primitives/progress/progress.css` | 172 | — | 有耗时过程要给进度就要 |
| 浮层气泡 | `02-primitives/popover/popover.css` | 187 | **必需 317** (`popover.js`) | 要一段信息贴着触发元素浮出来就要 |
| 日期区间 | `02-primitives/date-range/date-range.css` | 196 | **必需 301** (`date-range.js`) | 要选起止日期就要 |
| 标签页 | `03-patterns/tabs/tabs.css` | 159 | **必需 306** (`tabs.js`) | 同层级内容切换就要 |
| 折叠面板（beta） | `03-patterns/accordion/accordion.css` | 452 | **必需 368** (`accordion.js`) | 长表单分段就要 |
| 动作菜单（beta） | `03-patterns/dropdown/dropdown.css` | 135 | **必需 396** (`dropdown.js`) | 要一组动作（新建 / 导出 / 删除）就要 |
| 文字提示（beta） | `03-patterns/tooltip/tooltip.css` | 98 | **必需 152** (`tooltip.js`) | 图标按钮或缩写需要一句话解释就要 |
| 分页 | `03-patterns/pagination/pagination.css` | 195 | **必需 366** (`pagination.js`) | 数据多到要翻页就要 |
| 树形 | `03-patterns/tree/tree.css` | 113 | **必需 456** (`tree.js`) | 层级数据（文件 / 组织 / 分类）要展开就要 |
| 侧边抽屉（beta） | `03-patterns/drawer/drawer.css` | 129 | **必需 258** (`drawer.js`) | 要从侧边滑出面板就要 |
| 弹窗 / 吐司（beta） | `03-patterns/overlay/overlay.css` | 319 | **必需 375** (`overlay.js`) | 需要弹层（吐司 / 模态）就要 |
| 状态（空 / 加载 / 错 / 成功） | `03-patterns/states/states.css` | 252 | — | **凡是会异步取数就要** |
| 表单校验 | `03-patterns/form-validation/form-validation.css` | 263 | — | 提交前要校验就要 |
| 列表增删 | `03-patterns/list/list.css` | 162 | 可选 201 (`flip.js`，FLIP 增删动画，纯增强) | 列表会动态增删就要 |
| 导航 / 目录 | `03-patterns/nav/nav.css` | 299 | 可选 111 (`toc.js`，自动生成目录，纯增强) | 顶部要导航，或长文要目录就要 |
| 长文排版 | `03-patterns/content/content.css` | 270 | — | 写文档 / 长文就要 |

### 🔴 这些组件的 JS 是**必需的**（不是增强）

它们的 JS 承担**行为契约**：键盘、ARIA、焦点。只抄 CSS 会得到"看起来能用其实不能用"的组件。

| 组件 | JS | JS 里实测承担的机制 |
|---|---|---|
| 下拉选择 | `select.js` | 键盘 ✓ · ARIA ✓ · 焦点 ✓ |
| 可搜索选择 | `combobox.js` | 键盘 ✓ · ARIA ✓ · 焦点 ✓ |
| 浮层气泡 | `popover.js` | 键盘 ✓ · ARIA ✓ · 焦点 ✓ |
| 日期区间 | `date-range.js` | 键盘 — · ARIA ✓ · 焦点 ✓ |
| 标签页 | `tabs.js` | 键盘 ✓ · ARIA ✓ · 焦点 ✓ |
| 折叠面板 | `accordion.js` | 键盘 ✓ · ARIA ✓ · 焦点 — |
| 动作菜单 | `dropdown.js` | 键盘 ✓ · ARIA ✓ · 焦点 ✓ |
| 文字提示 | `tooltip.js` | 键盘 ✓ · ARIA ✓ · 焦点 ✓ |
| 分页 | `pagination.js` | 键盘 ✓ · ARIA ✓ · 焦点 ✓ |
| 树形 | `tree.js` | 键盘 ✓ · ARIA ✓ · 焦点 ✓ |
| 侧边抽屉 | `drawer.js` | 键盘 ✓ · ARIA ✓ · 焦点 ✓ |
| 弹窗 / 吐司 | `overlay.js` | 键盘 ✓ · ARIA ✓ · 焦点 ✓ |

**已经人工验证过后果的三条**（其余的按上表推断，不要凭印象写后果）：

- 标签页只抄 CSS：方向键不切面板 · Tab 会逐个穿过所有 tab
- 折叠面板只抄 CSS：Enter / Space 不响应 · 面板的 `role="region"` 缺失
- 弹窗 / 吐司只抄 CSS：**没有焦点陷阱** · Esc 不关 · 读屏不播报

> `flip.js` / `toc.js` 是**可选增强**（动画、目录生成），
> 它们的 CSS 本身是纯 CSS —— 不抄那两个 JS，组件照样能用。


### 现成页面（整页抄，不是零件）

| 示例 | 目录 | 它示范什么 |
|---|---|---|
| `analysis-report/` | `04-recipes/analysis-report/` | 组合型研究报告：正文 + 辅助栏并排，窄屏退回单栏 |
| `data-showcase/` | `04-recipes/data-showcase/` | 四种数据表达方式对照：我到底该用哪个 |
| `longform/` | `04-recipes/longform/` | 单栏长文排版与阅读节奏 |
| `report/` | `04-recipes/report/` | 报告版式系统 v1：共享基础 + 三种版式取舍（杂志 / 科研技术 / 金融研究） |
| `table/` | `04-recipes/table/` | 专业数据表格：列级格式与单位，三种用途预设 |

## 抄完先做这三件事

1. **看效果** —— 每个组件目录下有 `demo.html`，抄完对照着比
2. **跑一遍无障碍** —— 浏览器控制台里（或用 axe）确认对比度达标
3. **别改类名** —— 类名是 API（`.btn` `.btn--primary` `.field__input`），
   改名等于换组件。**要改样式就改令牌**，全库会一起变

---

## C 档（React / Vite）的额外说明

**目前没有构建配置。** 这个库是**零依赖、零构建**的纯 CSS + ES5 JS，
所以在 Vite 里直接 `import './tokens.css'` 就能用，不需要任何额外配置。

**如果你要的是 React 组件（`<Button />` 这样的），这个库现在没有** ——
它给的是 CSS 类，不是组件。**这不是缺陷，是范围**：
CSS 类跨框架通用，React 组件会绑死框架。

---

## 一句话记住

> **抄 `tierA-tokens.css`（A 档）或 `tokens.css`（B/C 档）→ 再抄你要的那几个 CSS → 保留类名。**

---

## 你可能还想找的（有 / 没有，一次说清）

> 🔴 这一节以前把徽章写成「没有」，而同一份文件的第 39 行就列着它 ——
> 自己跟自己打架，比"漏写一项"更误导人。
> 现在：**凡是上面组件表里有的，这里一律不再说没有。**

| 你可能想要 | 有没有 |
|---|---|
| 徽章 | ✅ 有 —— `02-primitives/badge/`，见上面组件表 |
| 数据表格 | ⚠️ 有现成页面，不是库级组件 —— 抄 `04-recipes/table/`（三种用途预设：财务 / 学术 / 统计）|
| 指标块 / KPI 卡 | ❌ 没有专门组件 —— 用 `card` + 排版令牌自己搭，几分钟的事 |
| 图标 | ❌ 本库不内置任何图标（`09-assets/` 下没有图标目录）—— 需要就自己内联 SVG，规格见 `09-assets/README.md` |
| React / Vue 组件 | ❌ 只有 CSS 类（原因见上面「C 档」）|
| 暗色模式 | ✅ 有，抄令牌就自带 |
| 中文排版（i18n）| ✅ 有度量令牌，四语言实测过 |

**没有就是没有。** 早知道比晚知道省时间。

> 每一行的「有 / 没有」都是对着目录与契约数出来的。
> 新增组件后请跑 `python 05-audit/fix-start-here.py` 重生成上面的表，
> 再人工对一遍这一节 —— 脚本只管表，管不了散文。
