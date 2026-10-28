# frontend-lib

[English](README.md) · 中文

移动 Web 组件库。CSS 样式 + 可选行为脚本，**零第三方运行时依赖**。

> **npm 包名是 `agentcss`**（`npm install agentcss`）。
> 仓库名沿用 `frontend-lib`。两者不是一回事：包名是安装标识，仓库名是主页地址。

**它同时是给 AI 读的**：`ai/components.json` 里每个组件都有机器可解析的契约
——可用的类名、状态怎么表达、哪些行为不能漏、成熟度到哪一步。
人可以直接复制 CSS 用；AI 可以读契约避免凭空猜组件怎么写。

## 它解决什么问题

移动端页面的三个反复出现的问题：

1. **暗色模式**要自己写两套色值 → 这里一套令牌自动适配
2. **弹层行为**（Esc 关闭、焦点归还、点击外部关闭）每个项目重写一遍 → 这里是可复用的组件
3. **无障碍**（焦点环、读屏标签、对比度）容易漏 → 这里每个组件都有契约守着

## 不是什么

- ❌ **不是 UI kit** —— 不做 calendar / upload 那些大而全的东西。
  （`date-range` 是轻量的起止日期选择，不是完整的日历 / 日期选择器；
  完整的 date-picker 请用专门的库）
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

**已发布到 npm registry。** 包名 `agentcss`（scoped 名不需要，直接用下面这条）：

```bash
npm install agentcss
```

装出来的目录名就是 `agentcss`，`dist-tags.latest` 指向当前版本。

另外两条**同样真实可用**的路（内容与 registry 上那一份同源）：

```bash
# ① 钉住某一版、且拿到与我们验证过的那一份**逐字节一致**的 tarball
npm install https://github.com/owain323/frontend-lib/releases/download/v0.11.3/agentcss-0.11.3.tgz

# ② 想跟着 master 走（未发布的最新提交）
npm install github:owain323/frontend-lib
```

> 历史说明：0.9.0 曾发布成功、两分钟后被误删（`ERRORS.md` E55）；此后一段时间
> registry 上没有可安装版本，靠 GitHub Release 附件分发（`docs/RELEASING.md`
> 「发布受阻时」）。自 0.11.2 起这条通路已恢复。

**② 源码复制**（不想装依赖）：把 `01-tokens/` 和需要的组件目录复制进你的项目。
⚠️ 复制 `dist/` 里的版本，**别复制源码版** —— 源码版有一半以上是给人和 AI 读的注释
（理由见下面「体积」一节）。

> 为什么这里不提前写 `npm install agentcss`：
> 写了而 registry 上还没有，照做的人会拿到 404，然后以为是自己的环境问题 ——
> 这与本库曾经踩过的「README 教人装、装到的是别人 2017 年的包」是同一类坑。
> 发布成功之后这一行才会换上。

## 组件一览

共 **35** 个（stable 31 / beta 4）。每个组件目录下有 `README.md`（为什么这么做）和 `demo.html`（能直接抄的结构）。

### primitives · 基础件（13）

| 组件 | 根类名 | 用途 |
|---|---|---|
| `badge` | `badge` | 状态标签：计数、分类、结果标记 |
| `button` | `btn` | 动作触发：主/次/危险/纯文字四档 |
| `card` | `card` | 内容容器：媒体+正文+操作区三段 |
| `choice` | `choice` | 单选/多选/原生 select 外观的统一控件 |
| `combobox` | `combo` | 可搜索 + 可多选标签的输入控件 |
| `date-range` | `drange` | 日期区间选择，含预设快捷范围 |
| `input` | `field` | 文本输入及其标签/帮助/错误三件套 |
| `popover` | `popover` | 锚定到触发元素的浮层 |
| `progress` | `progress` | 进度条与进度环 |
| `select` | `select` | 自定义下拉选择（非原生） |
| `separator` | `separator` | 分隔线，可带中间文字 |
| `skeleton` | `skeleton` | 加载占位骨架 |
| `switch` | `switch` | 开关切换 |

### patterns · 组合模式（14）

| 组件 | 根类名 | 用途 |
|---|---|---|
| `accordion` | `accordion` | 可折叠分组 |
| `content` | `prose` | 长文排版容器（标题/段落/列表/引用/代码） |
| `drawer` | `drawer` | 侧边抽屉，含遮罩 |
| `dropdown` | `dd` | 下拉菜单 |
| `form-validation` | `form` | 表单校验反馈与错误汇总 |
| `list` | `list` | 键值列表/条目列表 |
| `nav` | `nav` | 顶部导航与目录 |
| `overlay` | `toast` | 吐司提示与模态遮罩 |
| `pagination` | `pagination` | 分页控件 |
| `reveal` | `reveal` | 入场动效：一个 `data-reveal` 属性管六个方向，**零 JS 也能看** |
| `states` | `state` | 空/加载/错误/成功四种整块状态 |
| `tabs` | `tabs` | 选项卡切换 |
| `tooltip` | `tooltip` | 悬停/聚焦提示 |
| `tree` | `tree` | 可展开树形结构 |

### recipes · 整页配方（4）

| 组件 | 根类名 | 用途 |
|---|---|---|
| `analysis-report` | `report` | 组合型研究报告页面：正文与辅助栏并排，窄屏自然退回单栏 |
| `detail-page` | `detail-page` | 实体详情页骨架：字段齐全 / 部分缺失 / 一条数据都没有，三态共用同一套 DOM |
| `report` | `rep` | 报告版式系统 v1：共享基础 + 三套版式（杂志/科研技术/金融研究），只换一个 … |
| `table` | `table` | 数据表格：排序/加载/空/错误四态；三种用途预设（财务/学术/统计） |

### assets · 可视化（4）

| 组件 | 根类名 | 用途 |
|---|---|---|
| `bar` | `bar` | 柱状图（charter 13 图表规范）：堆叠/分组两种语义、超量程裁剪、图例 |
| `model-viewer` | `mv` | 3D 模型查看器：令牌驱动样式，不含渲染库本体 |
| `scientific-plot` | `splot` | 二维科学绘图：折线/区间带/对数轴，纯令牌驱动、零依赖 |
| `sparkline` | `sparkline` | 迷你趋势图：无坐标轴、纯形状，适合表格内嵌的一行走势 |
---

## 用法

**1 · 引入样式**（用你的打包器）

```js
import 'agentcss/tokens.css';
import 'agentcss/typography.css';
import 'agentcss/primitives/button/button.css';
```

**2 · 需要交互组件时**，引入行为脚本

行为脚本是 IIFE，挂到 `window` 上（如 `window.Overlay`）。

用打包器：

```js
import 'agentcss/patterns/overlay/overlay.js';
```

用 `<script>` 标签（**注意路径是包内的真实目录**）：

```html
<!-- npm 不会把 patterns/ 建成目录，必须按 03-patterns/ 写 -->
<script src="node_modules/agentcss/03-patterns/overlay/overlay.js"></script>
```

包内的目录结构与仓库一致：`01-tokens` `02-primitives` `03-patterns`
`04-recipes` `09-assets`。上例等价于 `import 'agentcss/patterns/overlay/overlay.js'`。

**3 · 直接复制**（不想装依赖）

复制 `dist/` 里对应的文件进你的项目即可 —— `dist/` 是**去注释但保留格式**的，
拷过去不会有大段注释挡着。想读取舍理由再回源码目录看。

```
dist/01-tokens/tokens.css          ← 拷这个
01-tokens/tokens.css              ← 源码（带 31.6 KB 注释），用于阅读
```

- **别拷源码目录**除非你要读它：全库 CSS 有 66% 是注释（字节口径；字符口径会低报 12 个百分点），`page.css` 一个文件
  12.4 KB 里 10.8 KB 是注释。
- **JS 也拷 `dist/`**：那一份去了注释但没压缩（理由见「体积」一节）。

---

### 最小可运行页面（纯 HTML，不用打包器）

把下面整段存成 `index.html`，放在 `node_modules/` 同级目录，双击打开就是对的：

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>示例</title>
<link rel="stylesheet" href="node_modules/agentcss/dist/01-tokens/tokens.css">
<link rel="stylesheet" href="node_modules/agentcss/dist/01-tokens/typography.css">
<link rel="stylesheet" href="node_modules/agentcss/dist/01-tokens/page.css">
<link rel="stylesheet" href="node_modules/agentcss/dist/02-primitives/card/card.css">
<link rel="stylesheet" href="node_modules/agentcss/dist/02-primitives/badge/badge.css">
<link rel="stylesheet" href="node_modules/agentcss/dist/02-primitives/button/button.css">
<link rel="stylesheet" href="node_modules/agentcss/dist/02-primitives/input/input.css">
</head>
<body class="page">
<main class="wrap">

  <h1>我的订单</h1>
  <p class="lede">最近 30 天 · 共 1 笔</p>

  <div class="card card--interactive">
    <div class="card__body">
      <h3>茅台 2026 年一季报</h3>
      <p class="small">订单号 20261017001</p>
      <span class="badge badge--success">已披露</span>
    </div>
  </div>

  <div class="field">
    <label class="field__label" for="q">订单号</label>
    <input class="field__input" id="q" type="search" placeholder="输入订单号" inputmode="numeric">
    <span class="field__hint">支持后四位模糊匹配</span>
  </div>

  <button class="btn btn--md btn--primary">导出</button>

</main>
</body>
</html>
```

三处最容易写错的地方，模板里已经避开了：

| 如果这样写 | 会发生什么 |
|---|---|
| `<input class="input">` | **`.input` 不存在**。不报错、不警告，高度变成 21px |
| 内容直接放 `.card` 里 | `.card` 自身 `padding: 0`，文字**贴边** |
| 漏掉 `page.css` | `.wrap` / `.lede` 不生效，整页宽度失去约束 |

**上生产时**：把 `node_modules/agentcss/dist/` 整个复制到静态目录（比如 `vendor/agentcss/`），
把上面 7 个 `href` 的前缀换掉。`node_modules` 不会随部署上线。

---

## 体积：默认给你的已经是干净产物

源码目录（`01-tokens/` `02-primitives/` …）里的 CSS **带着全部注释** —— 实测全库 CSS
有 **66% 是注释**（354.7 KB 原始里 235.2 KB），`page.css` 单个就有 87%。

那些注释是写给你看的取舍理由（为什么这么定、踩过什么坑），不是写给你浏览器看的。
**注释让你看代码时处处撞墙，构建工具还会把 66% 的字节原样传下去。**

⇒ 所以 `import 'agentcss/tokens.css'` **默认给你去注释后的产物**，
源码版放在 `agentcss/src/*`：

| 你写的 | 实际拿到 | tokens 那一项的体积 |
|---|---|---|
| `import 'agentcss/tokens.css'` | `dist/01-tokens/tokens.css`（去注释、留格式） | **8.0 KB**（源码是 39.6 KB） |
| `import 'agentcss/typography.css'` | `dist/01-tokens/typography.css` | **1.1 KB**（源码是 7.1 KB） |
| `import 'agentcss/src/01-tokens/tokens.css'` | 源码（**带全部注释**） | 39.6 KB |

**规则一句话**：默认拿干净的；想读"为什么这么定"就去 `src/`。

### 产物只有一份（压缩）+ 源码可读

| 产物 | 内容 | 什么时候用 |
|---|---|---|
| `dist/**/*.css` | **去注释 + 压缩** | 生产，默认就用这个 |
| `dist/**/*.js` | 只去注释，**不压缩** | 生产（JS 不压缩的理由见下） |
| `01-tokens/**` `02-primitives/**` … | 源码，注释齐全 | 想读"为什么这么定"、要 diff |

```js
import 'agentcss/dist/01-tokens/tokens.css';         // 压缩版
import 'agentcss/dist/02-primitives/button/button.css';
// 要可读版：import 'agentcss/01-tokens/tokens.css';
```

> ⚠️ **不再有 `*.min.css`**。此前 `dist/` 同时产出 `x.css`（去注释）与 `x.min.css`（压缩），
> 而源码也在包里 ⇒ 同一批 CSS 出现三次（未压缩 564.4 kB，占解包 19.3%）。
> 现在 `dist/x.css` **就是压缩版**，路径不变、内容更小；
> 写死 `x.min.css` 的地方去掉 `.min` 即可。

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
- 想知道**我们踩过哪些坑**：`ERRORS.md`。只记真的红过的门禁和真的做错过的事，
  每条写清症状 → 根因 → 纠正规则，规则都能照着执行。

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
