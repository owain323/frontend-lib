# scientific-plot · 二维科学绘图

原生 SVG 画的二维坐标系绘图模块。**零第三方运行时依赖**，ES5，和 `09-assets/sparkline` 同级。

## 它和 BI 图表不是一回事

| | BI / 营运图表（`sparkline`、`echarts-adapter`） | 科学绘图（本模块） |
|---|---|---|
| 回答的问题 | 「这个月比上个月好还是差」 | 「这些测量值落在哪、误差多大、有没有超模型」 |
| 坐标 | 多为分类轴 | **数值轴**，线性 / 对数显式声明 |
| 数据语义 | 趋势 | 值 + **不确定性**（误差棒 / 区间带） |
| 缺失 | 少见 | 常见，且**必须与零区分** |

两者共享设计令牌、字体、容器与响应式基础，
但**不共享**坐标与数据格式规则 ⇒ 本模块不依赖 BI 图表的内部实现。

## 用法

```html
<link rel="stylesheet" href="01-tokens/tokens.css">
<link rel="stylesheet" href="09-assets/scientific-plot/scientific-plot.css">
<script src="09-assets/scientific-plot/scientific-plot.js"></script>
<div id="fig"></div>
<script>
  ScientificPlot.render(document.getElementById('fig'), {
    width: 680, height: 340,
    title: '阻尼振荡位移',                       // 进 aria-label
    x: { label: '时间', unit: 's', scale: 'linear', domain: [0, 4] },
    y: { label: '位移', unit: 'm', scale: 'linear', domain: [-1.1, 1.1] },
    series: [{ type: 'function', fn: function (t) {
      return Math.exp(-0.35 * t) * Math.cos(2 * Math.PI * 1.2 * t);
    }, domain: [0, 4], samples: 400 }],
    refs: [{ axis: 'y', value: 0 }]
  });
</script>
```

## API

`ScientificPlot.render(el, spec)` 返回 `{ svg, x, y, ticks, series }`（比例尺对象可用于后续交互）。

**坐标轴** `spec.x` / `spec.y`

| 字段 | 说明 |
|---|---|
| `label` | 轴名。**不给会退化成 "x"/"y"**，正式图请给 |
| `unit` | 单位，会拼到轴名后（如「时间 / s」） |
| `scale` | `'linear'`（默认）或 `'log'` |
| `domain` | `[min, max]`，必填。对数轴必须 `> 0`，否则**抛错** |

**数据系列** `spec.series[]`

| `type` | `data` 形状 | 说明 |
|---|---|---|
| `line` | `[[x, y], ...]` | 折线；`null` 处**断开** |
| `scatter` | `[[x, y], ...]` | 散点 |
| `function` | 传 `fn` + `domain` + `samples` | 采样成点后画线，**不做表达式求值** |
| `errorbar` | `[[x, y, yerr], ...]` 或 `[[x, y, lo, hi], ...]` | 误差棒，只画给定边界 |
| `band` | `[[x, lo, hi], ...]` | 置信区间带（填充多边形） |

其他：`refs[]`（参考线 `{axis, value, label}`）、`annotations[]`（点标注 `{x, y, text}`）、
`grid`（默认开）、`truncated`（轴截断时置 `true`，图上会打提示）、`margin`、`className`。

## 它**不**做什么（诚实边界）

- **不计算任何统计量**：均值、标准误、标准差、置信区间都由调用方算好传进来。
  本模块也**不宣称**显著性 —— 那是调用方的判断，不是绘图的职责。
- **不做表达式求值**：函数曲线只接受真函数。传字符串会被忽略，**绝不 `eval`**。
- **不做插值 / 回归 / 平滑**：只连你给的点。
- **不做**直方图 / 箱线图 / 小提琴图 / 热力图 / 等高线 —— 这些留待后续，
  确有需要时接入成熟绘图库，不打包进本库必选运行时。
- **不做大规模交互**（缩放、框选、十字线）—— 第一版聚焦"画对"。

## 颜色与线型

分类色 5 个（`--accent / --danger / --success / --warning / --info`，与 `echarts-adapter` 同一套）。
**第 6 条曲线不会循环回第 1 个颜色**，而是切换线型（虚线 / 点线…）——
因为两条同色曲线读者分不清谁是谁。

## 预览

```bash
# 仓库根起静态服务
python -m http.server 8000
# 打开
http://127.0.0.1:8000/09-assets/scientific-plot/demo.html
```

## 已知限制

- 未在 iOS / Android 真机 WebView 上验证（与库整体一致）。
- 刻度标签未做"相邻标签重叠时自动抽稀"（对数轴跨大数量级时已按 10 的幂简化）。
- 无数据点级别的无障碍替代（图表整体有 `aria-label`，逐点值需调用方在页面上另给文本等价说明，
  demo.html 第 5 节演示了做法）。
