# app-shell · 应用外壳

> 工具型页面的骨架：左边一列常驻导航、上面一条工具栏、右边是主区。
> 本库已有的四个 recipe 都是**内容型**版式（读 / 查 / 写 / 比），
> 缺的是**工具型**。

## 文件

| 文件 | 作用 |
|---|---|
| `app-shell.css` | 三段式布局 + 两个变体 + 窄屏退化 |
| `shell-nav.js` | 窄屏导航：菜单按钮 + 把侧栏克隆进 `03-patterns/drawer`。**必需**（理由见下） |
| `demo.html` | 六个形态 + 一个对比块 |

> 布局本身零 JS。`shell-nav.js` 不是"给布局加动效"，它补的是一个**入口**：
> 没有它，窄屏上侧栏收走之后一个导航链接都没有。
> 所以 START-HERE 里它归「必需」，不是"可选增强"。

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

## 窄屏导航（`shell-nav.js`）

```html
<link rel="stylesheet" href="app-shell.css">
<link rel="stylesheet" href="../drawer/drawer.css">

<div class="shell" data-shell-nav="主导航">   <!-- 值 = 抽屉标题 -->
  <header class="shell__topbar">…</header>    <!-- 按钮插在这里的第一个位置 -->
  <nav class="shell__side" aria-label="主导航">…</nav>
  <main class="shell__main">…</main>
</div>

<script src="../drawer/drawer.js"></script>   <!-- 必需：抽屉的行为 -->
<script src="shell-nav.js"></script>          <!-- 有 data-shell-nav 就自动初始化 -->
```

- **opt-in**：不写 `data-shell-nav` 就一个按钮都不注入 —— 别人的顶栏布局不该被悄悄改。
- **只接线，不重写行为**：Esc、焦点陷阱、焦点归位、背景 `inert`、锁滚动五件事
  全部来自 `drawer.js`。本层做的是"建按钮 / 克隆侧栏 / 判断何时该关"。
- **克隆，不移动**。桌面端还要用原节点；而抽屉是"用完即毁"的，
  移动过去的话一关侧栏就永远回不来了。克隆里所有 `id` 会剥掉
  （两份同 id 会让 `aria-labelledby` 指到隐藏那份上）。
- **断点不写在 JS 里**：判据是"菜单按钮还在不在"（`offsetParent === null`），
  显隐由 CSS 的 `@media` 决定。写死数字的话 CSS 改一个值、JS 就静默错位。
- **缺 `drawer.js` 时拒绝初始化**并 warn —— 宁可没有按钮，也不要一个点了没反应的按钮。
  窄屏下用户会反复点，然后认为整个页面坏了。
- **宽屏复位**：开着抽屉把窗口拉宽，抽屉自动关掉，否则两个导航同时在场。
- **rail 也能直接接**：侧栏是图标态时，抽屉里会自动变成「图标 + 文字」——
  前提是文字留在 DOM 里，见下面「图标态的文字」。

### 为什么不用 `03-patterns/nav`

`nav.js` 做的是"横排导航 → 全屏抽屉"：它的列表**常驻在文档里**，
抽屉和列表是同一个节点，只是移动位置。而这里的侧栏在窄屏是 `display: none`,
需要的是"另建一份显示出来" —— 生命周期正好相反（常驻 vs 即用即毁）。
两者共用同一套核（`emit` / `focus-return` / `dismissable`），只是不共用外壳。

## 变体

| 类 | 效果 | 用在哪 |
|---|---|---|
| `.shell--rail` | 侧栏 4.5rem，只剩图标 | 工具栏型产品 |
| `.shell--flat` | 侧栏无边框、与主区同色 | 想要更轻的分层 |
| `.shell--scroll-main` | 侧栏与顶栏不动，只有主区滚 | 看板 / 监控墙 |

`.shell--rail` 下每个链接的名字必须来自**可见文字**，不要靠 `aria-label` 或 `title` ——
做法见下一节。

### 图标态的文字（`.shell__link-label`）

```html
<a class="shell__link" href="#" title="总览">
  <svg … aria-hidden="true">…</svg>
  <span class="shell__link-label">总览</span>
</a>
```

rail 状态下 `.shell__link-label` 被**视觉隐藏**（1px 盒 + 裁切），但仍在可访问树里，
所以读屏念的是「总览」而不是「链接」。两条硬理由：

1. **名字只能有一个来源。** 删掉文字改用 `aria-label`，等于同一句话维护两遍：
   改了可见文字却忘了改 `aria-label`，读屏念的还是旧的。
2. **抽屉里要靠它把文字补回来。** `shell-nav.js` 克隆的是侧栏节点，而抽屉把克隆
   挂到 `<body>` 下 ⇒ 它**离开了 `.shell--rail` 的作用域** ⇒ 隐藏规则不再命中
   ⇒ 抽屉里自动变成「图标 + 文字」。不需要第二份标记，也没有 JS 分支。

⚠️ **不能**改成 `display: none`：不在可访问树里的内容不参与名字计算，链接会退化成
"链接、链接、链接"。门禁 `F12` 守名字；`G4` 把这条规则改成 `display:none` 后必须变红。

⚠️ `title` 只负责桌面端的鼠标提示（触屏没有 hover）。它还会**兜出**一个名字，
所以门禁 fixture 里故意不写 `title` —— 否则「把标签改成 display:none」这种破坏
会被 `title` 兜住，判据看起来仍然是绿的。

### 图标态的品牌与分组

4.5rem 放不下品牌名，也放不下「数据 / 校验」这种分组名。两者各有各的解法，
**都不是**"删掉了事"。

**品牌：标记 + 文字两段。**

```html
<a class="shell__brand" href="#">
  <svg class="shell__brand-mark" …>…</svg>
  <span class="shell__brand-text">金标准 · 财务台</span>
</a>
```

rail 下 `.shell__brand-text` 与 `.shell__link-label` 同一套手法（1px 盒 + 裁切，
`display: none` 是**错的**）：标记留在 72px 中央，品牌名仍在可访问树里，
宽屏回来时字还在。品牌名是直接文本的老写法会退化成「金…」——
不是坏，是提醒你补上两段结构。

标记用 `currentColor` 画（内联 `<svg>`），不用 `<img>`：强制色下 `currentColor`
会被换成 `CanvasText`，图形还在；`<img>` 里的颜色不受当前颜色影响。

**分组：让两个 `.shell__side-group` 相邻，不要用 `.shell__side-label`。**

```html
<ul class="shell__side-group">…</ul>
<ul class="shell__side-group">…</ul>   <!-- `+` 会给出分隔线与间距 -->
```

`.shell__side-group + .shell__side-group` 那条规则本来就是为"无标签分组"准备的。
rail 下硬塞一个 `.shell__side-label` 会被 CSS 藏掉（兜底，防止它折行挤散图标），
但那段标记从此永远不会被看见、也不会被维护 —— 所以门禁 `H3` 判的是
「rail 实例里**不许出现** `.shell__side-label`」，比 CSS 的容错更严。

门禁：`H1` 名字来自可见文字、`H2` 品牌两段、`H3` 分组不用标签 ——
三条都落在**demo 页的真实 DOM** 上，不只看 fixture
（教训：F12/F13/F14 验的是 fixture，而 demo 当时教的是相反写法，46 条全绿）。

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

- **❌ 窄屏把侧栏 `display: none` 之后就不管了** —— 导航消失了，用户在手机上
  除了当前页哪儿也去不了。要么引 `shell-nav.js`（本目录就有），
  要么明确接受"窄屏只有当前页"（只读看板可以接受，但那要是**决定**，不是疏忽）。

  ⚠️ 别自己写 `transform: translateX(-100%)` 的抽屉。看起来只是"滑出来"，
  实际要做的是**焦点陷阱 / 焦点归位 / 背景 `inert` / 锁滚动 / Esc** 五件事。
  自己写必然漏两件，而漏掉的那两件在鼠标用户眼里完全正常 ——
  只有键盘和读屏用户会被困在一个关不掉的抽屉里。

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
