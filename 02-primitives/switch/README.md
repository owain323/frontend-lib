# switch · 开关

用于**立即生效的设置项**（"开/关通知"）。

## 它和 checkbox 的差别是**语义**，不是形状

| | 读屏播报 | 键盘 |
|---|---|---|
| `.choice--checkbox` | 「复选框，已勾选」 | Space 切换 |
| `.switch` | 「**开关**，已开启」 | **Space 切换，Enter 不切换** |

APG 把两者分成不同模式，正是因为这个 —— 复选框是"待提交的选择"，
开关是"已经生效的状态"。

## 类

| 类 | 作用 |
|---|---|
| `.switch` | 容器 |
| `.switch__input` | **原生 `<input type="checkbox" role="switch">`** |
| `.switch__track` | 滑块轨道（焦点环画在这里）|
| `.switch__thumb` | 滑块圆点 |
| `.switch__label` | 标签（`<label for>` 关联）|
| `.switch__label--sr` | 视觉隐藏、语义保留（只有滑块时用）|
| `.switch--lg` | 较大一档（48×28）|

## 用法

```html
<span class="switch">
  <input class="switch__input" type="checkbox" role="switch" id="s1">
  <span class="switch__track"><span class="switch__thumb"></span></span>
  <label class="switch__label" for="s1">开启动价推送</label>
</span>
```

## 为什么用原生 checkbox 而不是 div + role

**用原生控件 ⇒ 无障碍行为免费且必然正确**：
浏览器天生只响应 Space，**不需要写 JS 去拦 Enter** ——
也就不会有"忘拦"的风险。焦点环看不见原生控件，所以画在 `.switch__track` 上。

对比：`<div role="switch" tabindex="0" onclick>` 要自己处理
Space 键、焦点样式、状态播报 —— **三件事漏一件就坏**，
而且 axe 只看得见 DOM，看不见你的 JS 有没绑对。

## 组件零 JS

`switch.css` 不含任何 JavaScript。demo 里那个 `change` 监听器
**只是用来显示当前状态的**，不是组件的一部分。

## 尺寸

默认 40×22 · 较大 48×28 —— 两档（与 card / badge 一致）。

## 验证

`switch-contract.js` 10 项全过（**用真实按键**，不是 dispatchEvent）：

- 可聚焦 · `role="switch"` · 原生 checkbox · `label[for]` 关联
- 焦点环画在可见元素上
- **Space 切换**（真实按键）· **Enter 不切换**（APG 要求，真实按键）
- 滑块位移随状态变化 · axe 0 违规 / 24 条通过

反向控制：去掉 `role` 与 `label` ⇒ 4 项立即被抓。
