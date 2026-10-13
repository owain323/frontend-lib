# date-range · 日期区间

财务/成本场景刚需：**"看上季度"、"对比去年同期"**。

## 🔴 三件容易做错的事（写在最前面）

| # | 做什么 | 不做会怎样 |
|---|---|---|
| ① | **必须有「清除」按钮** | 日期填错了，用户只能一个个退格删 |
| ② | **`min`/`max` 越界与"开始晚于结束"要明确报错** | 用户不知道自己填错了，还以为没生效 |
| ③ | 快捷按钮必须能 `Tab` 到 | 键盘用户完全用不了"看上季度" |

## 结构

```html
<div class="drange">
  <label class="drange__label">
    <span>开始</span>
    <input class="drange__input" type="date" data-dr-from>
  </label>
  <span class="drange__sep" aria-hidden="true">→</span>
  <label class="drange__label">
    <span>结束</span>
    <input class="drange__input" type="date" data-dr-to>
  </label>
  <button class="drange__clear" type="button" data-dr-clear>清除</button>
  <div class="drange__presets">…上季度 / 上月 / 今年…</div>
  <p data-dr-error role="alert"></p>
  <p data-dr-summary></p>
</div>
```

| 部件 | 说明 |
|---|---|
| `.drange` | 根，`flex-wrap` —— 窄屏自动换行 |
| `[data-dr-from]` / `[data-dr-to]` | 两个日期输入，**缺任一个直接抛错** |
| `[data-dr-error]` | 错误容器，`role="alert"` |
| `[data-dr-summary]` | 选中区间的摘要（如「共 92 天」）|
| `[data-dr-clear]` | 清除，**不可省** |
| `.drange--disabled` | 整体禁用 |

⚠️ 标记名是 **`data-dr-*`**（`dr` 缩写），不是 `data-drange-*`。

## 启用

```js
const dr = DateRange.create(元素, {
  presets: [{ label: '上季度', from: …, to: … }],
  min: '2020-01-01', max: '2026-12-31',
});
```

同时导出的一批**纯函数**（可单独用，很 handy）：

```js
DateRange.iso(date)              // → 'YYYY-MM-DD'
DateRange.addDays(d, n)
DateRange.addMonths(d, n)
DateRange.quarterOf(d)           // → 0..3（0 = Q1）
DateRange.quarterRange(y, q)     // 季度必须是 0-3，传别的直接抛错
```

⚠️ `quarterOf` 曾经是**内部函数但忘了导出** —— 使用者拿到了 `quarterRange`
却无法从任意日期反推季度号。是单测抓出来的，补导出（纯函数，无副作用）。

## 校验做了什么

| 情况 | 行为 |
|---|---|
| 开始 > 结束 | 报「开始日期不能晚于结束日期（当前：…）」|
| 早于 `min` | 报「开始日期不能早于 …」|
| 晚于 `max` | 报「结束日期不能晚于 …」|
| `quarterRange` 季度号越界 | 抛错并说明「季度必须是 0-3（0=Q1），收到 …」|

### 🔴 错误要同时落到字段上，不只是显示一句话

```js
from.setAttribute('aria-invalid', msg ? 'true' : 'false');
to.setAttribute('aria-invalid', msg ? 'true' : 'false');
if (msg) {
  errBox.id = 'dr-err-N';
  from.setAttribute('aria-describedby', id);   // to 同理
}
```

**为什么**：只显示一行红字，读屏用户**不知道是哪个字段错了**。
`aria-invalid` 标记问题字段，`aria-describedby` 把错误挂到字段上，
三件一起做才完整。

`opt.min` / `opt.max` 会**同时**写到两个输入的原生 `min`/`max` 属性上
（浏览器自带的日期选择器就会拦住越界值，不只是我们事后校验）。

## 成熟度：stable（无行为债）

契约里 `behaviorDebt` 为空 —— 清除、校验、preset 接线都有门禁覆盖
（`05-audit/date-range-check.js`）。

## 门禁

`05-audit/date-range-check.js`