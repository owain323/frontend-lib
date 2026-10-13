# popover · 气泡卡片

通行系统的必备件。**非模态**——背景仍可交互，这是它与 dialog 的根本区别。

## ⭐ 该用哪一个（记不住就问这句）

> **用户需要"在里面操作"吗？**
> 不需要 → `tooltip`
> 需要，但不**打断**当前上下文 → **popover**
> 需要，且**必须先处理完**才能继续 → `dialog`

| | 能不能放交互内容 | 焦点管理 |
|---|---|---|
| `tooltip` | ❌ 只能纯文字 | 无 |
| **`popover`** | ✅ 表单、按钮、列表都行 | **焦点进入** |
| `dialog` | ✅ 但**模态**（背景锁死）| focus trap |

参照实现：Radix Popover / MUI Popover / Carbon Popover。

## 启用：DOM 由 JS 建，不用自己写

```js
const p = Popover.attach(按钮元素, { place: 'bottom', label: '标题' });
```

`attach()` 会自动：把触发器包进新建的 `.popover-anchor`（定位上下文）、
建出浮层本体并写好 `role` 与 `aria-label`。

| 参数 | 取值 |
|---|---|
| `place` | `bottom`（默认）/ `top` / `start` / `end` |
| `label` | 浮层的 `aria-label` |

返回的对象有 `open()` / `close()` / `toggle()`。

全局还有两个：

```js
Popover.closeAll();   // 关掉当前开着的那个
Popover.current;      // 当前开着的实例（没有则null）
```

## 内部结构（JS 生成，供你放内容）

```html
<span class="popover-anchor">
  <button aria-haspopup="dialog" aria-expanded="false">…</button>
  <div class="popover popover--bottom" role="dialog"
       data-open="false" aria-label="标题" inert>
    <div class="popover__title">…</div>
    <div class="popover__desc">…可含表单、按钮、列表…</div>
    <div class="popover__footer">…</div>
    <span class="popover__arrow" aria-hidden="true"></span>
  </div>
</span>
```

| 部件 | 说明 |
|---|---|
| `.popover-anchor` | **定位上下文** —— 箭头与浮层都相对它 |
| `.popover` + `--top/--bottom/--start/--end` | 浮层与四个方位，箭头自动指回触发器 |
| `.popover__title` / `__desc` / `__footer` | 内容分区 |
| `.popover__arrow` | 箭头 |

⚠️ **关闭态用 `inert`，不是 `hidden`** —— `inert` 让内部元素**不可聚焦**
（`hidden` 只是视觉隐藏，里面还能 Tab 到，这是常见错法）。

## 🔴 四个最容易做错的地方

| # | 要求 | 做错的后果 |
|---|---|---|
| ① | **非模态**：背景仍可交互，`role="dialog"` 但**不加 `aria-modal`** | 加了 `aria-modal` ⇒ 语义变成模态，读屏会锁焦点 |
| ② | 焦点**进入**浮层 | 焦点留在触发器 ⇒ 键盘用户进不去，浮层等于摆设 |
| ③ | `Esc` 关闭 **+ 焦点归还触发器** | 只关不还 ⇒ 焦点掉到 `<body>`，Tab 从头再来 |
| ④ | 点**外部**关闭，点**浮层内部不关** | 内部点击也关 ⇒ 表单填到一半全没了（最常见的 bug）|

## 动画

尊重 `prefers-reduced-motion` —— 用户在系统里关了动效，
组件的过渡也要跟着关。