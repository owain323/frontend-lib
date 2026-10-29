# accordion · 折叠面板

## 结构（APG 原文要求，不是我的设计）

```html
<div class="accordion" data-accordion>
  <div class="accordion__item">
    <h3 class="accordion__heading">
      <button class="accordion__trigger" aria-expanded="true">
        <span class="accordion__label">标题</span>
        <span class="accordion__marker" aria-hidden="true"></span>
      </button>
    </h3>
    <div class="accordion__panel">内容</div>
  </div>
</div>
```

**button 必须在 heading 里面**，不能写反。APG 原文：

> "Make sure to place the heading tag around the button, **not inside it**,
> as this would prevent some screen readers (such as VoiceOver and TalkBack)
> from reading it."

写反了（`<button><h3>标题</h3></button>`）VoiceOver / TalkBack **读不出标题**。

**`aria-controls` / `aria-labelledby` / `role="region"` 由 JS 自动补齐** ——
这三处是机械的对应关系，让人手写只会写错。

## 类

| 类 | 作用 |
|---|---|
| `.accordion` | 容器（**默认单开**）|
| `data-accordion-multi` | 多个可同时展开（**data 属性**）|
| `.accordion--many` | 面板 > 6 时**不给** `role="region"` |
| `.accordion__item` | 一项 |
| `.accordion__heading` | heading 包装（真实 `<h2>`–`<h6>`）|
| `.accordion__trigger` | 原生 `<button>` |
| `.accordion__panel` | 内容区 |

## 两种模式

| 模式 | 类 | 行为 |
|---|---|---|
| **单开**（默认）| — | 开一个时自动关其他 |
| **多开** | `data-accordion-multi`（**data 属性，不是 class**）| 各自独立 |

判断依据：**同一个问题的不同答案**用单开；**各自独立的信息块**用多开。

### 为什么多开是 data 属性而不是 class

它**不是样式变体，是行为开关** —— 多开模式下展开的那一项，
和单开模式下展开的那一项**视觉上完全一样**（都是真的展开了）。
没有任何东西需要用样式去表达"这是多开模式"。

（对比 `tabs--manual`：那个我**给了**真实视觉差异 —— 选中项不加粗，
因为"还没生效的事不该看起来已生效"。两个决定标准是同一个：
**有没有真实的视觉差异需要表达**。）

## 键盘（APG 原文）

| 键 | 行为 |
|---|---|
| `Enter` / `Space` | 切换 |
| `Tab` / `Shift+Tab` | 在**所有**可聚焦元素间移动（含面板内）|

### 🔴 本组件刻意**没有**方向键 / Home / End

APG 明确写：

> "arrow / Home / End key navigation is **no longer part of the
> APG Accordion keyboard interaction**."

那是 **tabs** 的契约（roving tabindex）。
**照抄给 accordion 是把两个模式混了。**

### 🔴 本组件刻意**不监听** `keydown`

原生 `<button>` **本身就响应** Enter/Space 并触发 click。
手写 keydown 会造成**双触发**（keydown 切一次、click 又切一次）。

判别力已验证：注入 keydown 监听 ⇒ 契约测试 2 项立即被抓。

## role="region" 的 ≤6 上限

APG 警告：

> "…in an accordion that contains more than **approximately 6** panels that
> can be expanded at the same time." ⇒ "landmark region proliferation"

地标泛滥时，读屏用户的地标列表会被几十个"分区"淹没。
**面板 > 6 时不要加** `role="region"` —— 用 `.accordion--many`。

## 折叠必须用 `hidden`

收起时用 `hidden` 属性 + `display:none`，
**不能只用 `max-height:0`** —— 那样内容仍在无障碍树里，
读屏会念出折叠区域的全部文字，键盘也能 Tab 进去。

## 语法约束

`accordion.js` **ES5**（无箭头函数 / const / let / 模板字符串），
也**不用 `Element.closest` / `Array.filter`** ——
理由与 `tabs.js` / `list.js` / `overlay.js` 一致：精简档 的 WebView 版本不确定，
**一致比方便重要**。

## 验证

`accordion-contract.js` **18 项全过**（真实按键）：

- 结构：heading 包 button（非里面套）· 原生 button · ARIA 双向互指 · `role=region` · marker `aria-hidden`
- 单开：Enter 切换 · **原项自动收起** · 始终只有一项展开
- **收起的面板真正 `display:none`**（离开无障碍树）
- Space 切换（证明不监听 keydown 也对）· 点击切换
- 多开：两项可同时展开
- `aria-disabled` 点不开
- **>6 且加 `--many` ⇒ 不给 `role=region`**（实测 0/8）
- axe 0 违规 / 29 条通过

判别力验证：注入 keydown 双触发 ⇒ **2 项立即被抓**。

## 反例

- ❌ **给折叠标题加方向键 / Home / End** —— APG 的 Accordion 只要求 Tab + Enter/Space。
  加了会和页面滚动抢方向键；本组件**刻意不监听 `keydown`**，这是设计不是遗漏
- ❌ **用 `max-height` 做展开动画** —— 你必须猜内容有多高：猜小了裁字，猜大了结尾拖一段空白。
  本库用 `grid-template-rows` 从 `0fr` 到 `1fr`，不需要知道高度
- ❌ **收起时直接 `display: none`** —— 关闭前必须**先量到高度再收**，否则量到 0，
  动画"啪"一下消失（`accordion.js` 里那条注释说的就是这个）
- ❌ **给 `accordion__panel` 加 `overflow: hidden`** —— 会裁掉里面控件的焦点环；
  收的过程交给 grid 的 `0fr` 完成
- ❌ **每一项都套 `role="region"`** —— APG 有 ≤6 的地标上限，超过就是"地标泛滥"，
  读屏的地标列表反而失去导航价值
- ❌ **把 `--acc-h` 挪进全局令牌表** —— 它只对本组件有意义（`accordion.css` 里写了为什么不进 `tokens.css`），
  进全局表会让所有人以为那是个通用尺寸

---
