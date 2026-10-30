# app-shell · 应用外壳

> 工具型页面的骨架：左边一列常驻导航、上面一条工具栏、右边是主区。
> 本库已有的四个 recipe 都是**内容型**版式（读 / 查 / 写 / 比），
> 缺的是**工具型**。

## 文件

| 文件 | 作用 |
|---|---|
| `app-shell.css` | 三段式布局 + 两个变体 + 窄屏退化。**零 JS** |
| `demo.html` | 六个形态 + 一个对比块 |

## 用法

```html
<link rel="stylesheet" href="app-shell.css">

<div class="shell">
  <header class="shell__topbar">
    <h1 class="shell__title">应付账款 · 2025 年度</h1>
    <div class="shell__topbar-end">
      <button>保存</button>
    </div>
  </header>

  <nav class="shell__side" aria-label="主导航">
    <a class="shell__brand" href="/">金标准 · 财务台</a>
    <ul class="shell__side-group">
      <li><a class="shell__link" href="/" aria-current="page">总览</a></li>
      <li><a class="shell__link" href="/entities">实体</a></li>
    </ul>
    <p class="shell__side-label">数据</p>
    <ul class="shell__side-group">
      <li><a class="shell__link" href="/import">导入</a></li>
    </ul>
  </nav>

  <main class="shell__main">
    <div class="shell__content">
      <!-- 你的内容 -->
    </div>
  </main>
</div>
```

DOM 顺序与视觉顺序一致（顶栏 → 侧栏 → 主区），`grid-template-areas` 负责把侧栏
摆到左边。**不要**为了"看起来对"去改 DOM 顺序 —— 读屏用户就是按 DOM 顺序听的。

## 两个坑（这是本组件存在的主要理由）

### 坑 1 · 主区少了 `min-width: 0`

grid / flex 项的默认 `min-width` 是 `auto`（不小于内容的最小宽度）。
主区里只要有一个宽表格，它就被撑到 700px 以上，**整个 shell 横滚** ——
侧栏和顶栏一起被推走。

```css
.shell__main { min-width: 0; }   /* 这一行 */
```

加了之后，宽内容只能在自己的滚动容器里滚 —— 那个容器本库给了：

```html
<div class="shell__scroll" tabindex="0" role="region" aria-label="宽表格，可横向滚动">
  <table>…</table>
</div>
```

⚠️ 三个属性都不能省：`tabindex="0"` 让键盘用户能聚焦并滚动它
（不加就是 axe 的 `scrollable-region-focusable`：鼠标能拖、键盘滚不动），
`role="region"` 让它成为一个可识别的区块，`aria-label` 给它名字
（没有名字的 region，读屏只会说"区域"）。

⚠️ 宽内容要放在 `.shell__content` **外面**：后者的 `max-width` 是正文栏宽，
放在里面宽度就被它限制住了，表格只能挤在 52rem 里。

判据：`app-shell-check.js` B1 / B1b（造一个 80rem 宽的块，分别量主区宽度与页面是否横滚）。

### 坑 2 · 高度用 `100vh` 而不是 `100dvh`

`100vh` 取的是**地址栏收起时**的视口高（最大那个）。
地址栏一展开，可视区域变小，元素仍按大的算 ⇒ 底部被裁一截，而且不出现滚动条。
iOS Safari 上最明显：最后一个按钮点不到。

```css
min-height: 100vh;    /* 兜底：不认 dvh 的引擎 */
min-height: 100dvh;   /* 正解 */
```

顺序不能反 —— 后写的优先。

## 侧栏为什么是 `sticky` 而不是 `fixed`

`fixed` 会把侧栏从 grid 流里摘出去，主区不知道它存在，于是要么被盖住，
要么手动补 `margin-inline-start`（然后在 RTL 里全错）。

`sticky` 留在流里：grid 照常算它的 15rem，滚到顶后固定住，RTL 自动正确
（因为用的是逻辑属性）。

⚠️ 两个前提缺一不可：
- `align-self: start` —— grid 项默认 `stretch`，撑满高度就无从"粘住"
- `max-height: 100dvh` + `overflow-y: auto` —— 条目多了侧栏自己滚，
  而不是把主区一起滚走

## 变体

| 类 | 效果 | 用在哪 |
|---|---|---|
| `.shell--rail` | 侧栏 4.5rem，只剩图标 | 工具栏型产品 |
| `.shell--flat` | 侧栏无边框、与主区同色 | 想要更轻的分层 |
| `.shell--scroll-main` | 侧栏与顶栏不动，只有主区滚 | 看板 / 监控墙 |

`.shell--rail` 下每个链接**必须**有 `aria-label` 或 `title` ——
否则读屏念出来是一串"链接、链接、链接"。

## 令牌

| 变量 | 默认 | 说明 |
|---|---|---|
| `--shell-side-w` | `15rem` | 侧栏宽。导航文字 + 图标不折行的下限附近 |
| `--shell-topbar-h` | `3.5rem` | 顶栏高 |
| `--shell-pad` | `var(--sp-4)` | 主区与顶栏的内边距（窄屏自动降到 `--sp-3`） |
| `--shell-bp` | `48rem` | 侧栏收起阈值 |

## 无障碍

- 侧栏是 `<nav aria-label="主导航">`：页面上可能还有第二个 `<nav>`（页内目录），
  两个都没有名字时读屏只会说"导航、导航"。判据：`a11y-ax.js`。
- 当前页用 `aria-current="page"`，**不是** `class="active"` ——
  前者是读屏能听到的状态，后者只是 CSS 钩子。
- 标记当前页用三条线索：竖条、底色、字重。灰度打印和色盲下都分得出来。
- 强制色下 `inset` 阴影会被整个移除，所以另有一段 media 把"当前项"换成实色边框；
  所有项统一预留 3px 透明边框，避免当前项的文字比其它项右移。
- 顶栏与侧栏的链接都有 44px 命中区（`--sz-touch`）。

## 反例

- **❌ 侧栏 `position: fixed` + 主区 `margin-inline-start`** —— 看起来能用，但侧栏被摘出
  grid 流，主区宽度靠**手抄的数字**维持（改侧栏宽就要改两处）；`inset-inline-start`
  与 `margin-inline-start` 只要有一处漏改，RTL 下侧栏跑到右边、主区仍在右边留白。**

  正确的做法见上面「侧栏为什么是 `sticky` 而不是 `fixed`」。

- **❌ 窄屏把侧栏 `display: none` 之后没有别的入口** —— 导航消失了。
  侧栏收走的代价是"用户找不到别的页面"，要么在顶栏放一个按钮接到
  `03-patterns/drawer`，要么明确接受"窄屏只有当前页"（只读看板可以接受）。

  ⚠️ 别自己写 `transform: translateX(-100%)` 的抽屉：抽屉需要 Esc 关闭、焦点归位、
  背景滚动锁、变宽自关四件事，`drawer` 已经全做了。自己写一份，四件里必然漏两件。

- **❌ 给 `.shell` 加 `overflow: hidden` 想"修好"横滚** —— 它确实不横滚了，
  因为内容**被裁掉了**，而且滚动条也没了。主区被撑破的正确修法是
  `min-width: 0` + `.shell__scroll`（见坑 1），不是把溢出的部分藏起来。

- **❌ 把宽表格放进 `.shell__content`** —— `.shell__content` 的 `max-width` 是
  正文栏宽（`--measure-page`），表格会被限制在 52rem 里，右边几列挤成一团。
  宽内容要放在 `.shell__content` **外面**、`.shell__main` 直下。

## 相关

- `03-patterns/nav` —— 页内目录 + 抽屉行为层。视觉上与侧栏条目对齐，但**不复用类**：
  一个是"页面内的目录"，一个是"应用级导航"，语义不同。
- `03-patterns/drawer` —— 窄屏导航抽屉，Esc / 焦点归位 / 背景锁 / 变宽自关都已实现。
- `04-recipes/detail-page` / `analysis-report` —— 内容型版式，可以放进 `.shell__main`。
