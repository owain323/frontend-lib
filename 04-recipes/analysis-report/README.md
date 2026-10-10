# analysis-report · 组合型研究报告

一个**多栏组合**页面的可运行示例。它证明本库能组合出的不只是单栏长文。

## 用途

给「有结论、有数据、有出处」的报告用：实验报告、技术评估、调研纪要。
和 `04-recipes/longform` 的分工很清楚：

| | `longform` | `analysis-report`（本示例） |
|---|---|---|
| 布局 | 单栏长文 | **正文 + 辅助栏并排**，窄屏退回单栏 |
| 证明的是 | 长文排版与阅读节奏 | **信息层级 + 组合能力** |
| 数据 | 无 | 表格 + 坐标系图表 |

## 文件

| 文件 | 说明 |
|---|---|
| `demo.html` | 可直接打开的示例页 |
| `analysis-report.css` | 本示例的局部样式（并排布局、关键发现区、引用块、代码块） |
| `README.md` | 本文件 |

## 依赖

**零新增运行时依赖。** 只引用库内已有资产：

```
01-tokens/tokens.css          ← 设计令牌（必引）
01-tokens/typography.css      ← 排版基线
01-tokens/page.css            ← 页面骨架（.page / .wrap / .lede）
02-primitives/card/card.css   ← 辅助栏卡片，复用现有组件
02-primitives/badge/badge.css ← 状态标记
04-recipes/table/table.css    ← 数据表格（复用，不另造）
09-assets/scientific-plot/…   ← 图表（复用，不另造）
analysis-report.css          ← 本示例的局部样式
```

引用顺序：**骨架在组件之前**。组件靠「后来者同特异性胜出」覆盖骨架，
不需要 `!important`（这条顺序有门禁守着）。

## 布局策略

```
.report__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);          /* 默认单栏 */
}
@media (min-width: 64rem) {                        /* --bp-lg = 1024px */
  grid-template-columns: minmax(0, 1fr) 15rem;     /* 正文 + 辅助栏 */
}
```

三个要点：

1. **默认就是单栏**，并排是宽屏才**发生**的事 —— 不是把桌面版缩小。
   窄屏下不需要任何额外媒体查询，栅格自然退成一行。
2. `minmax(0, 1fr)` 而不是 `1fr`：否则长表格/长代码会把栅格列撑开，
   产生横向溢出。这是 Grid 的经典陷阱。
3. 辅助栏 `position: sticky` 必须配 `align-self: start`，
   否则 sticky 在 Grid 里不生效（默认 stretch 会撑满整列高度）。

## 已知限制

- 断点写不了 `var()` —— 媒体查询里的 `64rem` 与令牌 `--bp-lg`
  是同一数值，但**必须写字面值**（CSS 规范限制）。改令牌时这里要手动同步。
- 辅助栏在 `100vh` 内滚动，正文很长时它不会跟着到页脚。
- 页面宽度为 `--measure-page + 16rem`，若宿主项目另有页面框架，请按实际情况调整。

## 预览

```bash
python -m http.server 8000        # 仓库根
# http://127.0.0.1:8000/04-recipes/analysis-report/demo.html
```

## 数据说明

页面里的实验数据**全部是演示用示例数据**，不是真实实验结果。
留出这条是因为：「长得像真实数据」的示例最容易被误引用。
