# iOS Safari 验证页

## 这是什么

一个**给人在 iPhone 上看**的页面，覆盖本库组件在 **Safari / iOS** 下的十项验证点。

## 怎么看

1. 把仓库根目录（或至少 `01-tokens` `02-primitives` `03-patterns`
   `04-recipes` `09-assets` `10-review`）放到**手机能访问到的地方**
   —— 本地起个静态服务器即可，例如在仓库根目录执行 `npx serve`，
   然后用 iPhone 访问同一局域网下的地址
2. 在 iPhone 的 **Safari** 里打开 `/10-review/ios/index.html`
3. 按页面上写的"该看到什么"逐条对
4. 重点看：**第 1 节（按钮）**、**第 2 节（键盘弹起）**、**第 10 节（暗色）**

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

## 一个已修的窄屏弹窗缺陷（可作为同类问题的参考）

`@media (max-width: 480px)` 里的 `.dialog { max-width: none }`
**没有宽度上界**。内容里有**带最小宽度的东西**（`<table>` / `<pre>` / 长 code）时，
弹窗会被撑到超出视口。窄屏实测：

```
弹窗宽 444  >  视口 393
左边缘    -26  ⇒ 左侧被切掉一块
```

现在的写法是 `width: 100vw; max-width: 100vw; box-sizing: border-box`。

⇒ 这是**窄屏弹窗的通用坑**，不限于 iOS（任何 < 480px 的屏幕都会中）。
如果你要给自己的弹窗做适配，注意容器里有没有带 `min-width` 的子元素。