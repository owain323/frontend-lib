# iOS Safari 验证页

## 这是什么

一个**给人在 iPhone 上看**的页面，覆盖本库组件在 **Safari / iOS** 下的十项验证点。

## 怎么看

1. 把 `${REPO}` 整个目录（或至少 `01-tokens` `02-primitives` `03-patterns`
   `09-assets` `10-review`）放到**手机能访问到的地方**
2. 在 iPhone 的 **Safari** 里打开 `10-review/ios/index.html`
3. 按页面上写的"该看到什么"逐条对
4. 重点截图：**第 1 节（按钮）**、**第 2 节（键盘弹起）**、**第 10 节（暗色）**

## 为什么值得单独做一页

Safari 与 Chromium 差异最大的六处，都在这一页里：

| 检查点 | 为什么 Safari 容易出问题 |
|---|---|
| `:focus-visible` | 触屏没有键盘焦点，Safari 的表现与桌面不同 |
| 键盘弹起遮挡输入框 | iOS 键盘会顶页面，`position:fixed` 元素常被顶出屏幕 |
| `position: sticky` | 父容器有 `overflow` 时 Safari 会让 sticky 失效 |
| `100vh` | iOS 收起地址栏时不变 ⇒ 底部留白（本页改用 `100dvh`）|
| `-webkit-` 前缀 | `backdrop-filter` / `appearance` 不加前缀就不生效 |
| `prefers-reduced-motion` | **iOS 默认就是 reduce** ⇒ 动画默认关（这是正确的）|

## 🔴 这个页面已经查出一个真 bug（2026-10-04）

`@media (max-width: 480px)` 里的 `.dialog { max-width: none }`
**没有宽度上界** ⇒ iPhone 15 Pro 实测：

```
弹窗宽 444  >  视口 393
左边缘    -26  ⇒ 左侧被切掉一块
```

真凶是内容里的**有最小宽度的东西**（`<table>` / `<pre>` / 长 code）。
已修为 `width: 100vw; max-width: 100vw; box-sizing: border-box`。

**反向控制验证过**：撤回修复后立刻回到 444 / -26。

⇒ **这是窄屏弹窗的通用坑，不只 iOS**（任何 < 480px 的屏幕都会中）。
