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

## 怎么用它 —— 有选择地用

**这是一个可选的工具箱，不是所有页面都必须遵守的规范。**

- 挑组件时看**实际实现、demo 和适用场景**，不要只看组件名和成熟度字段。
- 本库不覆盖你的场景时，**直接用别的做法** —— 不要为了迁就本库而把任务做坏。
- 改一个**已有网站**时，先看它原有的框架、组件和样式体系，能沿用就沿用；
  本库只在你确实缺一块时补上去。
- 输出形态不是网页（PPT / 文档 / 邮件）时，本库的网页布局规则**不适用**。

`ai/START-HERE.md` 是给 AI 用的短入口（约 90 行），`START-HERE.md`（根目录）是给
人类复用者的三步清单（组件表由脚本生成，不会漂移）。

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

---

## dist：要不要用压缩产物

源码目录（`01-tokens/` `02-primitives/` …）里的 CSS **带着全部注释** —— 全库 CSS 有
**64% 是注释**（323.9 KB 原始里 207.5 KB）。那些注释是写给你看的取舍理由，不是写给你浏览器看的。

⇒ 所以发布物里另有一份 `dist/`：

| 产物 | 内容 | 什么时候用 |
|---|---|---|
| `dist/**/*.min.css` | 去注释 + 压缩 | **生产**（省 ~86%） |
| `dist/**/*.css` | 只去注释，保留格式 | 想读又不想被注释淹没 / 要 diff |
| `dist/**/*.js` | 只去注释，**不压缩** | 生产（JS 不压缩的理由见下） |

```js
import 'frontend-lib/dist/01-tokens/tokens.min.css';
import 'frontend-lib/dist/02-primitives/button/button.min.css';
```

- **`dist/` 是导出物**，可以整个删掉重建（`npm run dist`）。真值永远是源码目录。
- **JS 不做压缩**：手写压缩器会引入破坏 ES5 语义的风险，收益不抵风险 —— 这一点如实写在这里，
  不假装 min 过。
- **一致性有门禁守着**：`dist-parity` 把每个产物与源码喂给浏览器的 CSSOM，
  必须解析出**同一份规则集**；`dist-fresh` 防"源码改了但 dist 没重建"。

**采纳一个组件到底要付多少**：见 `dist/COSTS.md`（由脚本生成，每个数字都能复算）。
`tokens` 的 min 版 **2.1 KB gzip**，比任何一个组件自己都贵 —— 那就是"只用一个组件"的真实起步价。

**4 · 要成套的页面（可选）** —— 页面骨架

`01-tokens/page.css` 是**页面级**的骨架：页面框、内容列宽、标题阶梯、
行内代码、说明块。**它是选配的**，只有写了 `class="page"` 的页面才生效：

```html
<link rel="stylesheet" href="01-tokens/tokens.css">
<link rel="stylesheet" href="01-tokens/typography.css">
<link rel="stylesheet" href="01-tokens/page.css">
<!-- 骨架要放在组件 CSS 之前：组件靠"后来者同特异性胜出"覆盖骨架，不用 !important -->
<link rel="stylesheet" href="02-primitives/button/button.css">
...
<body class="page">
  <main class="wrap">      <!-- 内容列，宽度 = var(--measure-page) -->
    <h1>标题</h1>
    <p class="lede">导语</p>
    <h2 class="rule-top">带分隔线的小节</h2>
  </main>
</body>
```

为什么是 `class="page"` 而不是直接给 `body` / `h1` 写规则：
裸标签选择器的作用域是**整个文档**，会改掉宿主页面自己的同名元素。
挂一个类名是**显式选配** —— 不写就不生效，库对宿主页面零副作用。

要改全局观感，改这几处就够了，**不要在页面里再写一遍**：

| 想改什么 | 改哪里 |
|---|---|
| 内容列宽 | `--measure-page`（所有 `.wrap` 一起变） |
| 标题字号 / 字距 | `--fs-2xl` / `--tracking-title` |
| 页面内边距 | `--sp-6`（页面框）、`--sp-4`（左右下限） |
| 行内代码底色 | `--surface-sunken` |
| 说明块 | `--surface-sunken`（`.note--warn` 用 `--warning-bg`） |

页面里重写这些选择器**不会报错，但也不会生效**（会被 `.page` 前缀的定义
以更高特异性静默盖掉，成为死声明）⇒ `05-audit/shell-gate.py` 会拦住它。

## 目录

| 路径 | 内容 |
|---|---|
| `01-tokens/` | 设计令牌（颜色 / 间距 / 字号 / 圆角）、排版基线、页面骨架（`page.css`，选配）、`behavior/` 微行为核 |
| `02-primitives/` | 基础组件：button / input / select / combobox / date-range 等 |
| `03-patterns/` | 复合模式：nav / tabs / overlay / list / tree / table 等 |
| `04-recipes/` | 页面级示例：`longform`（长文排版）· `analysis-report`（组合型研究报告）· `table`（专业数据表格）· `data-showcase`（数据展示能力对照） |
| `09-assets/` | 图表资产：`sparkline`（迷你趋势线）· `scientific-plot`（二维科学绘图：坐标轴/误差棒/置信区间带/对数轴）· `echarts-adapter`（把令牌喂给 ECharts，按需，本库不含 ECharts） |
| `ai/` | **机器可读契约**：`components.json` / `tokens.json` / schema / 校验器 / 命令行 |
| `adapters/` | 场景适配层（如演示文稿），**不进核心** |
| `benchmark/` | 兼容性基准（10 类编辑意图，当前无模型实测记录） |
| `docs/` | `INVARIANT.md`（不变式）· `GUIDANCE.md`（建议）· `BENCHMARK.md`（对标） |
| `types/` | TypeScript 类型定义（描述 `window` 上的全局对象） |

## 示例与验证状态

### 怎么跑示例

```bash
npm ci
python -m http.server 8000          # 在仓库根起静态服务
```

| 示例 | 地址 | 展示什么 |
|---|---|---|
| 长文排版 | `/04-recipes/longform/longform.html` | 单栏长文的阅读节奏 |
| 组合型报告 | `/04-recipes/analysis-report/demo.html` | 正文 + 辅助栏并排，窄屏自然退回单栏 |
| 专业数据表格 | `/04-recipes/table/demo.html` | 列级格式与单位、三种预设、多级表头 |
| 数据展示对照 | `/04-recipes/data-showcase/demo.html` | 四种数据表达方式各自回答什么问题 |
| 科学绘图 | `/09-assets/scientific-plot/demo.html` | 坐标轴、误差棒、置信区间带、对数轴 |

### 怎么自己验证（不想只信我们的话）

```bash
python -m http.server 8000 &     # 🔴 必须先起静态服务：一部分门禁要真浏览器渲染
bash 05-audit/check-all.sh       # 全量门禁约 130 项，本机约 8 分钟
```

每一项的输出是 `PASS` / `FAIL` / `SKIP`，末尾给出失败条数与退出码（全绿为 0）。

- **`SKIP` 是真话，不是通过。** 缺依赖的项会明确写"装了才会跑"，
  例如 `visual`（逐张比对视觉基线）需要 Pillow：`pip install pillow`。
  真浏览器类门禁需要 `npm ci`。
- **环境不全时它不会给你假绿。** 忘了起静态服务，真浏览器类门禁会直接报：
  「基线跑不起来（一条 FAIL 都没有）：多半是崩了或 8000 端口没有静态服务」。
  —— 这正是本库对"门禁报通过却什么也没查"的处置：**宁可红，不假装绿。**
- 只跑一项：`python 05-audit/deprecation-gate.py`、`node 05-audit/table-check.js`、
  `node 05-audit/scientific-plot-check.js`。
- 想看每道门禁**自己有没有牙**：`bash 05-audit/behavior-reverse.sh`
  （对门禁做突变，验证它会红、且只红该红的那一条）。

### 经过实际验证的

- 桌面 Chrome / Edge / Firefox，跑过全量门禁（含真浏览器渲染与无障碍扫描）。
- 视觉基线在 `10-review/shots/_baseline/`，由 `shot-baseline` 门禁逐张比对。
- 每个组件的键盘路径 / ARIA / 对比度都有契约守着（`05-audit/` 下百余道检查）。
- 数据语义有机械断言：例如科学绘图的「缺失值不被当作零」、
  表格的「不按数值大小猜百分比」，都有**反例对照**证明判据有效。

### 明确不承诺的

- **未在 iOS / Android 真机 WebView 上验证**（见下一节）。
- 不做虚拟滚动：大表格的行数上限交给调用方判断。
- 不提供 React / Vue 组件，只提供 CSS 类与可选的行为脚本。
- `scientific-plot` 不做插值、回归或任何统计计算，也不宣称显著性。
- 示例页里的数据**全部是演示数据**，不是真实实验结果或业务数据。

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
node ai/cli.js check  doc.json                # 校验一份**契约文档**（读 JSON）
node ai/cli.js diff   a.json b.json           # 两份契约文档按语义 id 比对
```

> ⚠️ `check` / `diff` 吃的是 **JSON 契约文档**，**不解析原始 HTML**。
> 想校验一个真实页面，请先用契约格式描述它，或直接跑 `npm run gate`
> （那里有真浏览器，能验的是渲染结果而不是源文件文本）。

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
npm run ai -- check path/to/doc.json     # 机器可读契约的命令行（读 JSON 文档）
npm run benchmark                        # 兼容性基准
```

改代码时跑 `gate:fast` 即可；**提交前**再跑一次 `gate`。

类型声明在 `types/index.d.ts`。改动它之前先看
[docs/ROADMAP.md](docs/ROADMAP.md) 里的「契约类事项」——
那几项没做完之前，本库还不适合作为长期依赖引入。

## 许可

MIT
