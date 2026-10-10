# data-showcase · 数据展示能力对照

一页对照四种数据表达方式，用来回答「我该用哪个」。

| 表达方式 | 组件 | 回答的问题 |
|---|---|---|
| 迷你趋势 | `09-assets/sparkline` | 指标是涨还是跌 |
| 科学坐标图 | `09-assets/scientific-plot` | 值落在哪、误差多大 |
| 学术表格 | `04-recipes/table`（`--academic`） | 哪个方案在哪个指标上更好 |
| 统计结果表 | `04-recipes/table`（`--stats`） | 效应大小与确定程度 |

它们**共享**设计令牌、字体、容器与响应式基础，
但**不共享**坐标规则与数据格式 —— 所以是四个用途，不是同一个组件的四种皮肤。

## 文件

| 文件 | 说明 |
|---|---|
| `demo.html` | 对照示例页（可直接打开） |

样式全部复用库内已有资产，本示例页只用了 `<style>` 里少量排布规则（KPI 卡、图表框），
没有新增运行时依赖。

## 依赖

```
01-tokens/tokens.css
01-tokens/typography.css
01-tokens/page.css
09-assets/sparkline/sparkline.css + .js
09-assets/scientific-plot/scientific-plot.css + .js
04-recipes/table/table.css
```

## 预览

```bash
python -m http.server 8000
# http://127.0.0.1:8000/04-recipes/data-showcase/demo.html
```

## 说明

页面内所有数值均为**示例数据**，不构成任何业务或科研结论。
留这句是因为「长得像真实数据」的示例最容易被误引用。
