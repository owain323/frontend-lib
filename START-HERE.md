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
| 按钮 | `02-primitives/button/button.css` | 350 | — | 几乎总要 |
| 标签/徽章 | `02-primitives/badge/badge.css` | 146 | — | 有状态标记就要（"已披露""停牌"） |
| 分隔线 | `02-primitives/separator/separator.css` | 73 | — | 要分开内容块就要 |
| 开关 | `02-primitives/switch/switch.css` | 363 | — | 有"立即生效的设置"就要 |
| 输入框 | `02-primitives/input/input.css` | 237 | — | 有表单就要 |
| 单选/复选/下拉 | `02-primitives/choice/choice.css` | 395 | — | 有选择就要 |
| 卡片 | `02-primitives/card/card.css` | 246 | — | 有分组内容就要 |
| 标签页 | `03-patterns/tabs/tabs.css` | 157 | **必需 211** (`tabs.js`) | 同层级内容切换就要 |
| 折叠面板 | `03-patterns/accordion/accordion.css` | 443 | **必需 342** (`accordion.js`) | 长表单分段就要 |
| 表单校验 | `03-patterns/form-validation/form-validation.css` | 258 | — | 提交前要校验就要 |
| 列表增删 | `03-patterns/list/list.css` | 162 | 可选 201 (`flip.js`，FLIP 增删动画，纯增强) | 列表会动态增删就要 |
| 导航/抽屉 | `03-patterns/nav/nav.css` | 297 | 可选 111 (`toc.js`，自动生成目录，纯增强) | 内容长要目录就要 |
| 弹窗/toast | `03-patterns/overlay/overlay.css` | 309 | **必需 288** (`overlay.js`) | 需要弹层就要 |
| 状态（空/错/加载） | `03-patterns/states/states.css` | 258 | — | **凡是会异步取数就要** |
| 长文排版 | `03-patterns/content/content.css` | 259 | — | 写文档/长文就要 |

### 🔴 三个组件的 JS 是**必需的**（不是增强）

| 组件 | JS | 只抄 CSS 会怎样 |
|---|---|---|
| 标签页 | `tabs.js` | 方向键不切面板 · Tab 会逐个穿过所有 tab |
| 折叠面板 | `accordion.js` | Enter/Space 不响应 · 面板的 `role="region"` 缺失 |
| 弹窗/toast | `overlay.js` | **没有焦点陷阱** · Esc 不关 · 读屏不播报 |

> `flip.js` / `toc.js` 是**可选增强**（动画、目录生成），
> 它们的 CSS 本身是纯 CSS —— 不抄那两个 JS，组件照样能用。

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

## 这份清单里没有的东西（别找）

| 你可能想要 | 有没有 |
|---|---|
| 图标 | ❌ 一个都没有（`09-assets/icons/` 是空的）|
| React / Vue 组件 | ❌ 只有 CSS 类 |
| 数据表格 / 指标块 / 徽章 | ❌ 还没做 |
| 暗色模式 | ✅ 有，抄令牌就自带 |
| 中文排版（i18n）| ✅ 有度量令牌，四语言实测过 |

**没有就是没有。** 早知道比晚知道省时间。
