# tabs · 标签页

同一位置切换**同层级**的几块内容。

## 结构（APG 要求，不是我的设计）

```html
<div class="tabs" data-tabs>
  <div class="tabs__list" role="tablist" aria-orientation="horizontal" aria-label="…">
    <button class="tabs__tab" role="tab" id="t1"
            aria-controls="p1" aria-selected="true">基本信息</button>
    <button class="tabs__tab" role="tab" id="t2"
            aria-controls="p2" aria-selected="false">高级设置</button>
  </div>
  <div class="tabs__panel" role="tabpanel" id="p1" aria-labelledby="t1">…</div>
  <div class="tabs__panel" role="tabpanel" id="p2" aria-labelledby="t2" hidden>…</div>
</div>
```

**tab 必须是 `<button>`** —— APG 明确要求。
用 `<div role="tab">` 键盘上根本 Tab 不到，也不响应 Enter/Space。

## 键盘契约

| 键 | 行为 |
|---|---|
| `Tab` | 进入组时落在**当前选中**的 tab；再按 Tab 进入面板内容 |
| `← →` | 上一个 / 下一个 tab（并激活）|
| `Home` / `End` | 第一个 / 最后一个 tab |
| `Enter` / `Space` | 仅**手动模式**下用于激活 |

## 🔴 roving tabindex（本组件最容易写错的地方）

一组 tab 里**只有一个**是 `tabindex="0"`，其余 `-1`。

**为什么要这样**：否则 Tab 键会**逐个穿过所有 tab** ——
一排 5 个 tab 要按 5 次 Tab 才能进内容区。

**更关键**：那个 `"0"` **必须跟着选中项走**。
只在初始化时设一次是最常见的 bug（用户激活第 3 个 tab 后，Tab 键还会回到第 1 个）。

## 两种激活模式

| 模式 | 类 | 方向键 | 何时用 |
|---|---|---|---|
| **自动**（默认）| — | 移动即切换 | 面板轻 |
| **手动** | `.tabs--manual` | 只移动焦点，Enter 才切 | 面板重（避免读屏不停播报）|

## 纵向

`aria-orientation="vertical"` + `.tabs--vertical`。

## 一个规范与现实的张力

APG 要求「在 tab 上按 Tab ⇒ 焦点进入面板内容」。
**但全是静态文字的面板没有任何可聚焦元素** ⇒ Tab 会直接跳过整个面板。

实测确认（`tabs-contract.js` 里就是用这个测的）：
demo 的面板里放了按钮，`Tab` 序列是
`t1 → 面板内按钮 → 下一个 tab 组` —— **符合规范**。

⚠️ 纯文字面板请自己加可聚焦元素（链接、按钮、或 `tabindex="-1"` 的容器）。

## 语法约束

`tabs.js` **刻意用 ES5**（无箭头函数 / const / let / 模板字符串）——
精简档（某项目 上的 WebView）版本不确定。

也**刻意不用 `Element.closest` / `Array.filter`**（ES5 之后才有），
自己写了 15 行等价实现 —— 与同目录的 `list.js` / `overlay.js` 保持一致。
**一致比方便重要。**

## 验证

`tabs-contract.js` **28 项全过**（用 `page.keyboard.press()` 真实按键）：

- 结构：`<button>` · `role=tablist` · `aria-controls` 双向互指 · `aria-orientation`
- roving：唯一 `0` · **跟着选中项走** · 循环后仍唯一
- 键盘：`←→` · `Home`/`End` · **循环** · **跳过 `aria-disabled`**
- Tab 进出：进组落在选中项 · 进面板内容 · **不逐个穿过同组**
- 手动模式：方向键不切面板但移焦点 · Enter 才激活
- axe 0 违规 / 30 条通过

判别力验证：破坏 roving（全部设成 `0`）⇒ **5 项立即被抓**。
