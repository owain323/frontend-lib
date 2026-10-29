# metric · 指标块

报表里**“一个数”的最小完整单元**：一个标签、一个值、一句上下文。

```html
<link rel="stylesheet" href="02-primitives/metric/metric.css">

<dl class="metric">
  <dt class="metric__label">营业总收入</dt>
  <dd class="metric__value">1,294.06<span class="metric__unit">亿元</span></dd>
  <dd class="metric__foot">
    <span class="delta delta--up">12.40%</span>
    <span class="metric__note">同比</span>
  </dd>
</dl>
```

## 类

| 类 | 作用 |
|---|---|
| `.metric` | 基础块（推荐 `<dl>`，用 `<div>` 也能渲染） |
| `.metric__label` | 标签：12px、次要色 |
| `.metric__value` | 值：等宽数字 + `tabular-nums` + 不换行 |
| `.metric__unit` | 单位：与数字同基线，小一号 |
| `.metric__foot` | 脚下那行：通常放 `delta` + 说明词 |
| `.metric__note` | 说明词（“同比” / “较上季”） |
| `.metric__spark` | 迷你走势槽位，放不放都行 |
| `.metric--lg` | 主指标档 |
| `.metric--sm` | 紧凑档（密集网格） |
| `.metric--null` | 缺数档：值降为 tertiary、去字重 |
| `.metric-grid` | KPI 行的自适应网格 |

## 三条硬规矩

1. **缺数写 `—`（U+2014）并说明原因**，不填 0、不留空、不只把字变淡。
2. **单位放 `metric__unit`**，不要拼进值字符串。
3. **变化量放 `metric__foot`**，不要混进 `metric__value`。

## 反例

- ❌ **缺数填 0** —— `0.00` 与 `—` 在报表上是两个不同结论。填 0 会让读者把「未披露」读成「现金流为零」，而它其实可能只是没出报表
- ❌ **把单位拼进值字符串** —— `1,294.06亿元` 让单位跟着 30px 字号走、和数字一样重，读者第一眼会把“亿元”当成数值的一部分；而且没法单选单位调样式
- ❌ **把 `delta` 塞进 `metric__value`** —— 值里混进变化量之后等宽对齐失效（两段数字位数不同），读屏也会念成一串。变化量属于 `metric__foot`
- ❌ **用 `opacity` 表达缺数** —— `--text-tertiary` 的 5.33:1 已经是文字色地板，再乘一次透明度就跌破 4.5。缺数靠“不给数字”表达，不靠让它看不清
- ❌ **把 `metric` 当卡片用** —— 它没有边框、没有内边距、不承载操作区。要“一块带边框的内容”用 `card`；`metric` 只负责一个数

## 为什么推荐 `<dl>`

“标签—值”在 HTML 里有现成语义：术语 + 描述。读屏会念
「营业总收入 1,294.06 亿元 +12.40% 同比」；用 `<div>` 只会念一串没有关系的词。
CSS 只认类名，所以 `<div>` 也能渲染（兼容既有页面），但文档一律示范 `<dl>`。

## 网格

```html
<div class="metric-grid">
  <dl class="metric"> … </dl>
  <dl class="metric"> … </dl>
</div>
```

内部是 `repeat(auto-fit, minmax(min(100%, 12rem), 1fr))`。
那层 `min()` 不是冗余：窄容器下 12rem 会比可用宽度还大，没有它就会横向溢出
（`05-audit/metric-gate.js` 判据 ⑧ 在 375px 视口下直接量 `scrollWidth`）。

## 缺数是一等状态

```html
<dl class="metric metric--null">
  <dt class="metric__label">经营活动现金流净额</dt>
  <dd class="metric__value">—</dd>
  <dd class="metric__foot"><span class="metric__note">本期未披露</span></dd>
</dl>
```

`metric--null` 只把值的颜色降到 tertiary、去掉字重，**不隐藏这一块** ——
版面塌掉比显示“没有”更糟。这是本库从 `04-recipes/detail-page` 的 null 变体
继承下来的同一条纪律。

## 对本组件不做的事

- **不做数值格式化**。千分位、小数位、单位换算由数据侧决定；CSS 不知道
  `1,294.06` 与 `1294.06` 哪个对。库保证的是等宽对齐与不换行。
- **不判断方向**。涨跌颜色交给 `delta`，本组件不含任何方向令牌引用
  （`metric-gate` 判据 ⑦ 静态检查这件事）。

## 预览

```bash
python -m http.server 8000
# http://127.0.0.1:8000/02-primitives/metric/demo.html
```
