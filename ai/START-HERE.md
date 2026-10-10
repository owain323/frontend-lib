# AI 使用入口（frontend-lib）

> **本文件只做导航，不复制契约与组件文档。** 要细节就去它指的地方看。

## 0 · 先记住一件事

**本库提供的是可选工程资产，不是所有 HTML/网站都必须遵守的统一规范。**

- 组件不适用时，用别的实现 —— **不要为满足本库的实现偏好而牺牲任务结果**。
- 修改已有网站时，**先看它原有的框架、组件和样式体系**，能沿用就沿用。
- PPT、文档、邮件等其他输出形态**不自动继承**本库的网页布局规则。
- 选组件看**实际实现、API、示例、适用场景**，不要只凭组件名称和成熟度字段判断。

## 1 · 这个库提供什么

| 能力 | 位置 |
|---|---|
| 设计令牌（色/间距/字号/圆角，明暗双主题，纯 CSS 无需 JS） | `01-tokens/tokens.css` |
| 排版与页面骨架（**选配**，写在 `class="page"` 上才生效） | `01-tokens/typography.css`、`page.css` |
| 组件（CSS 为主 + 可选 JS） | `02-primitives/`、`03-patterns/` |
| 微行为核（Esc 关闭 / 焦点归还 / 方向键游走） | `01-tokens/behavior/` |
| 页面级示例 | `04-recipes/`（清单见下节） |
| 图表与可视化资产 | `09-assets/`（清单见下节） |
| 机器可读契约 + 命令行 | `ai/*.json`、`ai/cli.js` |

**没有的**（别找）：图标、React/Vue 组件（只有 CSS 类）、构建配置。

> 🔴 下面这一段里的**数字与目录清单会漂移**（加一个组件就错一处），
> 所以它由 `05-audit/fix-start-here.py` 生成；手改会被 `npm run gate` 判为漂移。
> 它的值直接从 `ai/components.json` 与目录实际内容读出来 —— **不信上面的说法，信这个**。

<!-- ==== AI-INVENTORY-BEGIN ==== -->
- 组件 **28** 个（`beta` 7 · `stable` 21）
- `04-recipes/`（页面级示例）：`analysis-report`（组合型研究报告：正文 + 辅助栏并排，窄屏退回单栏） · `data-showcase`（四种数据表达方式对照：我到底该用哪个） · `longform`（单栏长文排版与阅读节奏） · `table`（专业数据表格：列级格式与单位，三种用途预设）
- `09-assets/`（图表与可视化）：`bar`（柱状图，含 charter 13 图表规范的裁剪铁律） · `echarts-adapter`（把令牌喂给 ECharts，按需引入；本库不含 ECharts） · `model-viewer`（惰性加载的 3D 模型查看器） · `scientific-plot`（二维科学绘图：坐标轴 / 误差棒 / 置信区间带 / 对数轴） · `sparkline`（迷你趋势线，没有坐标轴的走势提示）
<!-- ==== AI-INVENTORY-END ==== -->

## 2 · 什么时候值得用 / 什么时候别用

| 值得用 | 别用 |
|---|---|
| 从零写移动端页面，想要现成的暗色与无障碍基线 | 宿主已有成熟组件库（沿用它的） |
| 要弹层/标签页/折叠面板且要求键盘可达 | 只要一两个样式，引整个库不划算 |
| 单文件页不能外链 CSS（用 `04-recipes/tierA-tokens.css`） | 要 date-picker / calendar / upload 这类大而全控件 |

## 3 · 怎么查

| 想查什么 | 去哪 |
|---|---|
| 有哪些组件、多大、JS 是否必需 | 根目录 `START-HERE.md`（组件表由 `05-audit/fix-start-here.py` 生成，不会漂移） |
| 组件清单与成熟度 | `node ai/cli.js components --maturity=stable` |
| 令牌名与取值 | `node ai/cli.js tokens --mode=dark`、`node ai/cli.js tree`（分层视图） |
| 组件真实长什么样 | 该组件目录下的 `demo.html` |
| 页面怎么搭 | `04-recipes/` 下的示例 |
| 令牌怎么改 | README「主题定制」（覆盖 CSS 变量，不需重新编译） |

**类名即 API**（`.btn`、`.btn--primary`）。改样式改**令牌**，不要改类名，
也不要在页面里重写组件选择器（会被更高特异性静默盖掉，成为死声明）。

## 4 · 怎么判断一项能力是否经过验证

| 信号 | 怎么看 |
|---|---|
| 成熟度 | `ai/components.json` 的 `maturity` 是**算出来的**（判据在 `ai/components.meta.json`），不是人写的 |
| 有没有 demo | 组件目录下有 `demo.html` 就能直接跑起来对照 |
| 有没有门禁守 | `05-audit/check-all.sh`（`npm run gate`）一次跑全，逐项打印 `PASS`/`FAIL`/`SKIP` |
| 浏览器支持 | README「浏览器支持」表：桌面 Chrome/Edge/Firefox 已验证；**iOS/Android WebView 未在真机验证** |

⚠️ **未在真机验证的项就是没验证**，不要替它打包票。

## 5 · 什么时候应当沿用宿主项目现有技术

- 宿主已有设计系统 / 组件库 ⇒ 用它的，本库只在确实缺一块时补。
- 宿主已有构建与样式方案 ⇒ 不要为引入本库改它的构建。
- 宿主页面既有布局能达成目标 ⇒ 改它的局部，不要套本库的页面骨架。
- 输出形态不是网页（PPT / 文档 / 邮件）⇒ 本库的网页布局规则**不适用**。

## 6 · 怎么跑已有检查

```bash
npm ci                 # 按锁文件安装（首次）
npm test               # 单元测试
npm run test:types     # 类型契约：正例必过 + 反例必挂
npm run gate:fast      # 静态检查（约 45 秒，改代码时跑）
npm run gate           # 全量检查（含浏览器，提交前跑）
node ai/cli.js check <doc.json>   # 校验契约文档（读 JSON，不解析原始 HTML）
```

改动本库**自身**时的分层（决定该动哪一层）：

| 层 | 文件 | 性质 |
|---|---|---|
| 不变式 | `docs/INVARIANT.md` | 客观事实，有门禁守边界 |
| 契约 | `ai/*.json` | 版本化约定 |
| 建议 | `docs/GUIDANCE.md` | 工作建议，可整份推翻 |

> `docs/GUIDANCE.md` 里「贴进 system prompt 的极简版」的适用范围是
> **维护 frontend-lib 自身或严格按本库范式写页面**，不是所有 HTML 任务的通用规则。

## 7 · 三句话版本

1. 这是**可选**资产；不适用就用别的，别硬套。
2. 查组件去根目录 `START-HERE.md` 和组件自己的 `demo.html`，别猜。
3. 改样式改令牌、保留类名；提交前跑 `npm run gate`。
