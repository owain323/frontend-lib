# checkbox / radio / select

| 字段 | 内容 |
|---|---|
| **来源** | 原创 |
| **实测** | `demo.html` 顶部面板**实时显示原生键盘事件**（观测，不是模拟）；门禁零 HIGH |
| **适用** | 精简档 / B / C，纯 CSS |
| **依赖** | `01-tokens/tokens.css` `02-primitives/input/input.css`（select 段落用它的 `.field__label` / `.field__hint`） + `01-tokens/typography.css`（`.note` 提示框）|

---

## 三条铁律

**1. 绝不 `display:none` / `visibility:hidden` 隐藏原生控件。**
那会把它从 tab 顺序移除，键盘用户彻底到不了。**用鼠标测完全测不出来。**

**2. 不改原生控件的结构和 DOM 位置，只改外观。**

**3. 焦点环必须画在看得见的元素上。**
input 被 `opacity:0` 覆盖后，它自己的 `outline` 你根本看不见。

```css
.choice__input:focus-visible + .choice__mark { outline: 2px solid var(--accent); }
```

`states.py` 的 choice 形态**只认 `:focus-visible +` 这种相邻兄弟写法**，
单纯写 `:focus-visible {}` 判为不通过——因为那正是会骗过门禁的错误写法。

---

## 实现手法

原生 input 用 `opacity:0` + 绝对定位铺满整个 label，于是三件事同时成立：

- 点击**整个标签**都能切换（不必精确点 20px 的方框）
- Space / 方向键行为 **100% 原生**
- 触摸目标是 **44px**（视觉方框只有 20px）

**为什么不用 `appearance:none` 直接美化 input**：那样方框和文字没法并排（input 只有一个盒子）。

---

## checkbox

要支持 **indeterminate**（第三态）。"全选"复选框在"部分选中"时必须能表达中间状态，
否则用户不知道哪些被选中了。不做这个态的库基本都缺。

`:indeterminate` **只能由 JS 设置**（`el.indeterminate = true`），CSS 不影响它。

---

## radio 组：必须 `fieldset + legend`

这是原生语义，屏幕阅读器会播报"第几组、共几项、当前选中第几项"。

单选互斥、同一个 `name`、方向键移动即选中——全部依赖原生行为。
用 `<div>` + `<span>` 模拟，这些全丢。

```html
<fieldset class="choice__group">
  <legend class="choice__legend">时间范围</legend>
  <div class="choice__options">
    <label class="choice choice--radio">
      <input class="choice__input" type="radio" name="range" value="30" checked>
      ...
```

🔴 **命名注意**：同族元素用 `__`（`.choice__group`），不用 `-`。
`states.py` 靠 BEM 根类归组状态，写成 `.choice-group` 会让容器脱离根类、被误判缺状态——
**这个门禁反过来纠正过我的命名**。

---

## select：用原生的，别自做

原生 select 在移动端是**最好的**：系统弹出带 wheel 的选择器、语言跟随系统、无障碍由系统保证。
换成 `<div>` 模拟，这些全部要重写，且必然漏一部分。

只改外观：

```css
.select__control { appearance: none; }
.select__control::-ms-expand { display: none; }
.select__arrow { pointer-events: none; }   /* 🔴 不写这句，箭头吃掉点击 */
```

键盘行为（↑↓ 选择、Enter 确认、Esc 关闭）**全部保留**。

select 用 `:focus` 不用 `:focus-visible`——和 input 一样，用户必须随时知道当前选的是哪个。

---

## disabled

不用 `opacity`（对比度会变成不可控的随机数），用明确的低对比色组。
**disabled 之后 hover 不能有任何变化**，否则看着像还能点。

---

## 🔴 结构选型：两种写法都安全（2026-10-02 实测推翻了我自己的担心）

我曾把结构从「input 在 label 内」改成「input 与 label 平级 + for」，
理由是怕**双触发**（input 铺满 label ⇒ 点击既命中 input 又冒泡到 label ⇒ 翻转两次）。

**用 puppeteer 真实鼠标点击实测两种结构：**

| 结构 | 连点三次 | 结论 |
|---|---|---|
| A：input 在 label 内 | `true → false → true` | **无双触发** |
| B：input 平级 + `for` | `true → false → true` | **无双触发** |

**HTML 规范本身就有防护**：
> label 的激活行为对「交互性后代」的事件**必须什么都不做**。

⇒ **我当初的担心是多余的。** 两种都能用，当前保持 B（已用真实点击验证过）。
仍选 B 的理由：input 与 label 分离后 label 内部可自由排版。

🔴 **但改结构有个真实的坑（我踩过）**：
`.choice__mark` 不再是 input 的**相邻兄弟**，所有 `X + .choice__mark` 规则**全部失效**。
本库一度有 **7 处**同时失效（勾号 / disabled / indeterminate / radio），
症状是「**属性变了但框看着没变**」—— 面板显示"已勾选"，框里是空的。

**属性测试永远抓不到这类 bug**，必须测"视觉有没有跟着变"。
`el.click()` 也抓不到（它是程序化调用，**不做命中测试**）。

**验证**：
```bash
node 05-audit/clicktest.js choice     # 真实鼠标点击，11 项
```

---

## 门禁

```bash
python 05-audit/states.py --dir ${REPO}
```

choice 形态查三项，全是 HIGH：

| 查 | 为什么 HIGH |
|---|---|
| `disabled` | 以为坏了 |
| `:focus-visible +` | 焦点环必须画在可见标记上 |
| `:checked` / `:indeterminate` | 没有选中态视觉反馈 |

select 形态查 `disabled` / `:focus`（**不是** focus-visible）/ `hover`。

---

## 反例

- ❌ **`display:none` 隐藏原生 input** —— 键盘不可达，鼠标测不出来
- ❌ **自己用 `<div>` 做 checkbox** —— Space / Tab / 表单提交 / 屏幕阅读器全要重写
- ❌ **焦点环画在 input 上** —— input 透明，outline 看不见
- ❌ **用 opacity 做 disabled** —— 对比度随机数
- ❌ **radio 组用 `<div>` 模拟** —— 丢掉 fieldset/legend 的原生语义
- ❌ **箭头不写 `pointer-events:none`** —— 吃掉点击
- ❌ **换掉原生 select 做自定义下拉** —— 移动端体验和无障碍全要重做
- ❌ **checkbox 不做 indeterminate** —— "全选"无法表达中间状态
- ❌ **同族元素用 `-` 而不是 `__`** —— BEM 违规，状态归组会失效
