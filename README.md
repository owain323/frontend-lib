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

**2 · 需要交互组件时**，引入行为脚本

行为脚本是 IIFE，挂到 `window` 上（如 `window.Overlay`）。

用打包器：

```js
import 'frontend-lib/patterns/overlay/overlay.js';
```

用 `<script>` 标签（**注意路径是包内的真实目录**）：

```html
<!-- npm 不会把 patterns/ 建成目录，必须按 03-patterns/ 写 -->
<script src="node_modules/frontend-lib/03-patterns/overlay/overlay.js"></script>
```

包内的目录结构与仓库一致：`01-tokens` `02-primitives` `03-patterns`
`04-recipes` `09-assets`。上例等价于 `import 'frontend-lib/patterns/overlay/overlay.js'`。

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
| `ai/` | **机器可读契约**：`components.json` / `tokens.json` / schema / 校验器 / 命令行 |
| `adapters/` | 场景适配层（如演示文稿），**不进核心** |
| `benchmark/` | 兼容性基准（10 类编辑意图，当前无模型实测记录） |
| `docs/` | `INVARIANT.md`（不变式）· `GUIDANCE.md`（建议）· `BENCHMARK.md`（对标） |
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

### 明暗模式

**CSS 自己表达，不需要 JS**：

| 你想要 | 做法 |
|---|---|
| 跟随系统 | 什么都不做（默认） |
| 强制暗 | `<html data-theme="dark">` |
| 强制亮 | `<html data-theme="light">` |

三种都**不加载任何 JS 就成立** —— 这点由 `theme-css` 门禁在真浏览器里守着。

想要一个可点的开关时，才加载 `01-tokens/theme-toggle.js`。
它**只翻属性，不含任何色值**（色值的真值只有一份：`tokens.css`）。
支持三态：跟随系统 / 亮 / 暗，`window.Theme.set('dark' | 'light' | 'auto')`。

⚠️ 因为暗色是纯 CSS 表达的，你的覆盖**不会**被 inline style 压掉
（旧版靠 JS 写 30 条 inline 属性，那是本库曾经最大的一处设计代价）。

## 机器可读契约（给自动化工具用）

组件与令牌不只有文档，还有**结构化数据**：

```bash
node ai/cli.js components --maturity=stable   # 列出达到 stable 的组件
node ai/cli.js tokens --mode=dark             # 列出暗色令牌
node ai/cli.js check  page.html               # 校验一份文档
node ai/cli.js diff   a.html b.html           # 两份文档的差异
```

- `ai/components.json` / `ai/tokens.json` 由源码**生成**（`--check` 已接门禁）
  ⇒ 改了源码忘记重新生成就红。真值只有一份，不靠"记得同步"。
- 组件**成熟度是算出来的**，不是人写的（没人会主动把自己的组件标成 beta）。
- 档位 `creative / standard / strict` 决定校验严格程度。
  门禁会证明它有鉴别力：同一份文档在 `strict` 下的报错数必须**多于** `creative`。
- 文档里带未知 `extensions` 时旧版校验器只忽略、不判非法（前向兼容）。

## 规范分三层

改动本库或写扩展之前，先知道该动哪一层：

| 层 | 文件 | 性质 |
|---|---|---|
| **不变式** | `docs/INVARIANT.md` | 客观事实，永不变。有门禁守边界 |
| **契约** | `ai/*.json` + `API.md` | 约定，随版本变 |
| **建议** | `docs/GUIDANCE.md` | 工作建议，可整份推翻 |

约束要放宽时动的是**建议层**，不变式一个字都不用动。
对标了谁、故意不学谁，见 `docs/BENCHMARK.md`。

## 可访问性

- 每个组件都有行为契约（键盘路径、ARIA 属性、对比度）
- 焦点环遵循系统设置，高对比度模式下浏览器会加强
- 尊重 `prefers-reduced-motion`

## 开发

```bash
npm ci                 # 按锁文件安装
npm test               # 单元测试（约 100ms）
npm run test:types     # 类型契约：正例必过 + 反例必挂
npm run gate:fast      # 静态检查（约 45 秒）
npm run gate           # 全量检查（含浏览器）
npm run ai -- check path/to/page.html    # 机器可读契约的命令行
npm run benchmark                        # 兼容性基准
```

改代码时跑 `gate:fast` 即可；**提交前**再跑一次 `gate`。

类型声明在 `types/index.d.ts`。改动它之前先看
[docs/ROADMAP.md](docs/ROADMAP.md) 里的「契约类事项」——
那几项没做完之前，本库还不适合作为长期依赖引入。

## 许可

MIT
