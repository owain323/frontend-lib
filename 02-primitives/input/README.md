# input / field

| 字段 | 内容 |
|---|---|
| **来源** | 原创（依据 WCAG 2.1 + 移动端实测约束） |
| **实测** | 占位符 5.16 AA、错误文字 6.26 AA、边框 3.56（UI 边界）；16px 依据 iOS Safari 行为 |
| **适用** | 精简档 / B / C，纯 CSS，可整段复制 |
| **依赖** | `01-tokens/tokens.css` · demo 另需 `02-primitives/button/button.css`（校验按钮）与 `01-tokens/typography.css`（`.small`）|

---

## 五态（input 不是七态）

| 状态 | 实现 | 不做会怎样 |
|---|---|---|
| hover | 边框加深 | 边界无反馈 |
| **focus** | `:focus` 边框变色 + ring | **用户不知道光标在哪** |
| **disabled** | 灰底、不可聚焦、**值不提交** | 以为坏了 |
| **error** | `[aria-invalid]` 红框 + 图标 + 文字 | **校验错误对屏幕阅读器静默** |
| readonly | `[readonly]` 可聚焦、**值会提交** | 与 disabled 混淆 |

**input 没有 active 态**——输入框不响应按压。这一条也写进了 `states.py` 的形态区分里。

---

## 🔴 与 button 最关键的一处不同，别照抄

| | button | input |
|---|---|---|
| 焦点选择器 | `:focus-visible` | `:focus` |
| 理由 | 鼠标点击时不该冒出难看的框 | **用户必须随时知道"我现在在哪个框里"**，不管是鼠标点的还是 Tab 过去的 |

搞反了表单会非常难用。

---

## 无障碍清单（缺一条就不算做对）

```html
<div class="field">
  <label class="field__label" for="amount">
    金额 <span class="field__req" aria-hidden="true">*</span>
  </label>
  <input class="field__input" id="amount" type="text"
         required
         aria-describedby="amount-hint amount-err"
         aria-invalid="true">
  <span class="field__hint" id="amount-hint">最多两位小数</span>
  <span class="field__error" id="amount-err" role="alert">请输入有效金额</span>
</div>
```

- **`for` / `id` 配对** —— 没有它，屏幕阅读器读出来只是"编辑框"
- **`aria-describedby`** —— 把说明和错误都挂到输入框上，聚焦时能听到
- **`aria-invalid="true"`** —— 机器可读的错误状态
- **`role="alert"` 或 `aria-live`** —— 错误动态出现时会被读出来
- **`required`** —— 别只放一个红色星号

---

## 三个容易踩的坑

**1. `font-size` 必须 ≥ 16px**

iOS Safari 在输入框字号小于 16px 时**会自动放大整个页面**。这是移动端最常见的表单 bug，而且是硬下限，不是审美。

**2. 不能只靠颜色表示错误（WCAG 1.4.1）**

只把边框变红，色盲用户完全看不出哪里错了。本库给三条线索：红边框 + 叹号图标 + 错误文字。

**3. `readonly` 和 `disabled` 是两回事**

| | disabled | readonly |
|---|---|---|
| 可聚焦 | ❌ | ✅ |
| 可复制 | ❌ | ✅ |
| **值提交** | **❌** | **✅** |

展示计算结果、展示带过来的值 → 用 `readonly`，让用户能复制。做成 `disabled` 的样子，用户会以为这个值不提交。

---

## 反例 —— 什么时候不该用

- ❌ **用 placeholder 当 label** —— 一输入就消失，对比度通常不达标，屏幕阅读器支持不一致
- ❌ **普通输入框加成功态** —— 只在有明确"校验通过"语义时用（如"用户名可用"），其余是噪音
- ❌ **错误提示只变红不写文字** —— 对屏幕阅读器用户等于静默失败
- ❌ **`.field--row` 用在窄屏** —— 480px 以下会自动回退纵向，别手动覆盖这个回退
- ❌ **textarea 不设 `min-height`** —— 高度会塌，用户不知道能输入多少

---

## 门禁

```bash
python 05-audit/states.py 02-primitives/input/input.css
```

当前：零缺失（含 HIGH 五项全过）。
`states.py` 会把 `input/field` 类自动归到 input 形态，不查 `active`。

## 备好的能力（demo 里没演示，但可以直接用）

| 类 | 作用 | 什么时候用 |
|---|---|---|
| `.field__input--sm` | 小尺寸（表格 / 紧凑栏） | 表格行内、侧栏等密度高的场景 |

> ⚠️ **demo 里没有演示这一档** —— 它是留给复用者的钩子，
> 不是"看起来有其实没有"。要用就自己加类。

## 🔴 移动端必填：inputmode 与 autocomplete（2026-10-04 补）

这两个属性**不影响桌面**，但**决定手机上用户体验**：

### 1 · `inputmode` —— 决定**弹出哪种键盘**

```html
<!-- 金额 / 数量 → 数字键盘（有小数点）-->
<input type="text" inputmode="decimal">

<!-- 邮箱 → 带 @ 的键盘 -->
<input type="email" inputmode="email">

<!-- 电话 → 纯数字键盘 -->
<input type="tel" inputmode="tel">
```

⚠️ **`type="text"` + 不写 `inputmode` ⇒ 手机上弹的是全键盘**，
   用户要自己切到数字 —— 这是**成本类表单最常见的体验缺陷**。

### 2 · `autocomplete` —— 决定**浏览器是否自动填充**

```html
<!-- 开启自动填充（推荐）-->
<input name="email" autocomplete="email" type="email">

<!-- 演示/测试页要避免真实数据填充 -->
autocomplete="off"
```

⚠️ 缺失 ⇒ 用户每次都要手打一遍。

**依据**：HTML 规范 + WCAG 1.3.5 Identify Input Purpose。

### 3 · `required` 与原生校验

```html
<input required aria-required="true">
```

⚠️ 必填字段**优先用原生 `required`**（浏览器自带校验气泡与键盘类型优化），
   JS 校验只做**补充**（服务端仍必须再校验一次）。
