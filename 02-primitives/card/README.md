# card

| 字段 | 内容 |
|---|---|
| **来源** | 原创。2px 抬起一条来自对 `animal-island-ui` 的观察（那套设计里最认同的一条） |
| **实测** | `states.py` 零缺失（card 形态：focus HIGH / hover LOW） |
| **适用** | 精简档 / B / C，纯 CSS |
| **依赖** | `01-tokens/tokens.css`  + `01-tokens/typography.css`（`.note` 提示框）|

---

## 唯一的核心判据：hover 不能有布局跳动

hover 只改 **`transform`** 和 **`box-shadow`**，这两个属性不触发回流。
改 `border-width` / `margin` / `padding` / `height` 任何一项都会引起重排，相邻卡片跟着抖。

那个抖动很轻——1px 左右，轻到说不清哪里不对——**但整页会显得廉价**。
`demo.html` 把它放大到 4px，鼠标移上去一次就能记住。

**要"加粗"边框怎么办**：用 `box-shadow: inset 0 0 0 2px`，不要改 `border-width`。
`--selected` 变体就是这么做的。

---

## 变体

| 变体 | 用途 | 注意 |
|---|---|---|
| `.card` | 默认，1px 边框 | 一排卡片时边框会显得重 |
| `.card--flat` | 无边框，靠明度差分层 | **列表首选**，比全都有边框干净 |
| `.card--elevated` | 默认带阴影 | 只给浮层/弹窗；列表全用它阴影会打架 |
| `.card--interactive` | 可点，hover 抬 2px | 需要整卡可点时配 `--linked` |
| `.card--linked` | 整卡可点 | 内部必须有真实 `<a>`/`<button>` |
| `.card--selected` | 选中态 | inset shadow，不是改 border |
| `.card--compact` | 紧凑 | 两档够了，第三档说明密度没规划 | —— demo 未演示，是留给复用者的钩子
| `.card--row` | 横向 | 560px 以下自动回退纵向 |

---

## 🔴 整卡可点：正确做法 vs 错误做法

**错误**：给 `<div>` 加 `onclick`。
键盘 Tab 不到、屏幕阅读器不认、不能中键新开、不能复制链接。

**正确**：卡片内放一个真实的 `<a>`，用它的 `::after` 铺满整卡。

```html
<div class="card card--linked card--interactive">
  <div class="card__body">
    <h3 class="card__title"><a class="card__link" href="/x">标题</a></h3>
    <p class="card__desc">摘要</p>
  </div>
</div>
```

焦点用 `:focus-within`——内部链接获焦时**整张卡**显示 ring，而不是只有标题那一小块。
链接本身的 `:focus-visible` 要关掉，否则会出现两个框。

卡片里如果有其他可点元素（按钮、标签），要 `z-index: 1` 盖在热区之上。

---

## 抬起 2px，不是 8px

卡片是"被拿起"，不是"被弹起"。8px 以上会有游戏感——
**长文和数据类界面不能要那种感觉**。

这条来自对 `animal-island-ui` 的观察：卡片 20px 圆角、无投影、hover 只抬 2px。
那套库整体画风跟严肃内容不搭，但这一条是对的。

---

## 反例 —— 什么时候不该用

- ❌ **一排卡片全用 `--elevated`** —— 阴影互相打架，整页发灰。列表用 `--flat`
- ❌ **hover 抬起 8px 以上** —— 游戏感
- ❌ **整卡套 `div onclick`** —— 键盘不可达，见上
- ❌ **给链接本身再画焦点环** —— 会变成两个框
- ❌ **用 JS 截断描述文字** —— 会留下半个词或半个字，用 `-webkit-line-clamp`
- ❌ **手动覆盖 `--row` 在窄屏的回退** —— 那个回退是必要的

---

## 门禁

```bash
python 05-audit/states.py 02-primitives/card/card.css
```

card 形态查两项：`focus`（HIGH，整卡可点时键盘不可达）、`hover`（LOW）。
不查 `disabled` / `active`——卡片没有禁用态，也不响应按压。

跑在 某项目 上立刻抓出 `.card` / `.card-grid` / `.side-card` 三个类全缺 focus。
