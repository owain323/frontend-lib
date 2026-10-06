# frontend-lib

移动 Web 组件库。CSS 样式 + 可选行为脚本，**零第三方运行时依赖**。

## 它解决什么问题

移动端页面的三个反复出现的问题：

1. **暗色模式**要自己写两套色值 → 这里一套令牌自动适配
2. **弹层行为**（Esc 关闭、焦点归还、点击外部关闭）每个项目重写一遍 → 这里是可复用的组件
3. **无障碍**（焦点环、读屏标签、对比度）容易漏 → 这里每个组件都有契约守着

## 不是什么

- ❌ **不是 UI kit** —— 不做 date-picker / calendar / upload 那些大而全的东西
- ❌ **不是构建工具** —— 不需要打包器，复制文件就能用
- ❌ **不是零依赖的 JS 框架** —— 交互组件是**可选**的，纯样式场景不用加载任何 JS

## 安装

```bash
npm install frontend-lib
```

## 用法

**1 · 引入样式**（用你的打包器）

```js
import 'frontend-lib/tokens.css';
import 'frontend-lib/typography.css';
import 'frontend-lib/primitives/button/button.css';
```

**2 · 需要交互组件时**，用 `<script>` 引入行为脚本

```html
<script src="node_modules/frontend-lib/patterns/overlay/overlay.js"></script>
```

行为脚本是 IIFE，挂到 `window` 上（如 `window.Overlay`）。

**3 · 直接复制**（不想装依赖）

把 `01-tokens/` 和需要的组件目录复制进你的项目即可。

## 目录

| 路径 | 内容 |
|---|---|
| `01-tokens/` | 设计令牌（颜色 / 间距 / 字号 / 圆角）与排版基线 |
| `02-primitives/` | 基础组件：button / input / select / combobox / date-range 等 |
| `03-patterns/` | 复合模式：nav / tabs / overlay / list / tree / table 等 |
| `04-recipes/` | 页面级示例 |
| `09-assets/` | 图表 |
| `types/` | TypeScript 类型定义（描述 `window` 上的全局对象） |

## 浏览器支持

| 环境 | 状态 |
|---|---|
| Chrome / Edge（桌面） | 已验证 |
| Firefox（桌面） | 已验证 |
| iOS Safari / WKWebView | **未在真机验证** |
| Android WebView | **未在真机验证** |

⚠️ 定位里写「移动 Web」指的是**设计取向**（触控优先、命中区不小于 44px），
不代表已在真机 WebView 上跑过完整测试。生产前请在自己的目标环境验证。

## 主题定制

覆盖 CSS 变量即可，不需要重新编译：

```css
:root {
  --accent: #0a7c5a;    /* 品牌主色 */
  --r-md: 10px;         /* 圆角 */
  --sp-3: 12px;         /* 间距 */
}
```

暗色模式跟随系统（`prefers-color-scheme`），也可手动覆盖 `[data-theme]`。

## 可访问性

- 每个组件都有行为契约（键盘路径、ARIA 属性、对比度）
- 焦点环遵循系统设置，高对比度模式下浏览器会加强
- 尊重 `prefers-reduced-motion`

## 开发

```bash
npm ci
npm test        # 单元测试
npm run gate    # 全量检查
```

## 许可

MIT
