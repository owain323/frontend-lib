# nav —— 页头 / 目录 / 移动端抽屉

| 字段 | 内容 |
|---|---|
| **来源** | 原创。`toc.js` 是从 `04-recipes/longform` 内联脚本**提取并加固**的；`nav.js` 是从 demo/示例页**手抄了两遍**的抽屉逻辑抽出来的 |
| **实测** | demo 三件事都能真机验证（页头/目录/抽屉）；抽屉的 22 条行为由 `05-audit/nav-drawer.js` 在浏览器里跑 |
| **适用** | 精简档 / B / C，`toc.js` 与 `nav.js` 均为 ES5 |
| **依赖** | `01-tokens/tokens.css` + `02-primitives/button/button.css` + `01-tokens/page.css`（页面骨架：`.wrap` / `.lede` / `.note`） + `01-tokens/typography.css` |
| **规范** | 见本文件「状态切换」一节|

---

## 一个目录，两个全局

`nav/` 里有**两个独立脚本、两个全局**：

| 文件 | 全局 | 形态 | 自动初始化 |
|---|---|---|---|
| `nav.js` | `Nav` | attach（`Nav.attach(root)`） | **是**，扫 `[data-nav]` |
| `toc.js` | `Toc` | direct（`Toc.init(opts)`） | 否，必须自己调 |

它们**共用同一份 HTML**（页头 + 目录 + 抽屉）但**生命周期无关**：
抽屉常常用不上目录，目录也可能出现在没有抽屉的长文页里。所以不合并成一个脚本。

⚠️ AI 契约（`ai/components.json`）里 `nav` 这个组件记的是 `global: "Nav"` +
`globalAlso: [{Toc}]` —— 一个组件目录可以导出第二个全局。
`05-audit/autoinit-gate.py` 会按这张清单核对 `API.md` 的表，
少记一个就会报「表里出现了库里没有的全局」。

---

## 抽屉行为层：`nav.js`（可选，但没有它抽屉就是死的）

```html
<header class="nav" data-nav>
  <button class="nav__toggle" aria-expanded="false" aria-controls="nav-list">…</button>
  <ul class="nav__list" id="nav-list">…</ul>
  <div class="nav__scrim"></div>      <!-- 可省，缺了 JS 自己建 -->
</header>
<script src="nav.js"></script>         <!-- 有 data-nav 就自动初始化 -->
```

`nav.css` 只定义了**状态长什么样**（`[data-state="open"]` / `aria-expanded`），
从没规定**谁来切**。所以在这之前，每个使用者都要抄 60 行 —— 抄出来的版本
各有各的漏。现在这一层在库里，并且被门禁按 22 条判据盯着。

### 🔴 抄出来的版本里那个 bug：`aria-hidden` 打在了祖先上

旧 demo 的写法是「把 body 的每个子元素都 `aria-hidden`，跳过 list/scrim/toggle」。
问题：`<header class="nav">` 是 list 的**祖先**，它不在跳过名单里 ⇒
整块 `<header>` 被 `aria-hidden="true"` 包住，**抽屉自己也跟着对读屏消失**。

而它"看起来完全正常"：截图正常、像素比对正常、键盘 Tab 也正常。
**只有用读屏打开菜单才会发现里面一个字都读不出来。**

`nav.js` 的判据是「跳过**包含**导航自身的节点」，而不是「跳过这三个元素」。

### 🔴 为什么复用 `drawer.js` 会错

`03-patterns/drawer/drawer.js` 的 `Drawer.open()` **自己建 DOM**（new aside、
塞进 body、关了就删）。而导航列表在文档里本来就有一份，桌面端还要用它横排。
**生命周期相反**（即用即毁 vs 常驻），所以不共用实现，只共用**核**：
`emit` / `focus-return` / `dismissable` 三块与 `drawer.js` 逐行同源（`gen-behavior.py` 保证）。

### 🔴 断点不写数字

"窗口变宽就关掉"的判据是**汉堡按钮还在不在**（`offsetParent !== null`），
不是 `window.innerWidth > 768`。CSS 里改一个断点值，写死数字的 JS 会**静默错位**。

### 事件

`fl-nav-open` / `fl-nav-close`（`detail = { root }`）。自动初始化不接回调
—— 要收通知请听事件（与 `tabs.js` 同一条纪律）。

---

## 目录高亮：`toc.js`

```js
Toc.init({ links: '#toc-list .toc__link', sections: 'main h2[id]' });
```

返回一个取消函数（解绑事件）。

### 🔴 为什么不用 `IntersectionObserver`（实测到 bug）

第一版用的是 `IntersectionObserver` + `rootMargin: '-10% 0px -70% 0px'`，
靠 `seen[id] = isIntersecting` 增量维护当前节。

**实测反馈"导航不跟随文章移动"。** 根因：

> **滚到两个 section 之间时，观察区里一个 section 都没有**
> ⇒ `seen` 全为 false ⇒ 不调 `mark()` ⇒ 高亮停在上一个不动。

**这不是边界情况，是常态**——用户大部分时间就滚在两节之间。

现在统一用计算：`取最后一个 offsetTop <= 滚动位置 + 100px 的 section`。
**任何滚动位置都有确定答案**，不会出现"都不在观察区"的状态。

**为什么不用 IO 省 CPU**：两者成本其实一样——`scroll` 监听也只在**滚动时**执行
（已用 `rAF` 节流），不滚动时都不跑。为了一个"看起来更优"的方案换正确性风险，不划算。

### ⚠️ `offsetTop` 的前提

它相对于 **`offsetParent`**。若把目录放在一个 `position: relative` 的容器里，
`offsetTop` 会是相对那个容器的值，与 `pageYOffset` 不可比 ⇒ **高亮会错位**。

**目录所在的祖先链上不要出现 `position: relative/absolute`。**

### 前提：目录项与标题 id 一一对应

```html
<h2 id="mem">…</h2>          ← 标题必须有 id
<a class="toc__link" href="#mem">…</a>   ← 目录指向它
```

少一个，**那一项永远不会被高亮**。`refs.py` 会静态抓这个错。

---

---

## 目录的 sticky 必须在库里，不在 demo 里

🔴 第一版这条只写在 demo 的内联 `<style>` 里，**任何引了 `nav.css` 的页面都没有 sticky**
——目录随正文滚出视口，"跟着走"这个最基本的效果没有。

**布局规则写在 demo 里 = 分层崩了。** 现在 `nav.css` 里：

```css
@media (min-width: 60rem) {
  .toc { position: sticky; top: 76px; align-self: start; }
}
```

- `top` 要**大于页头高度**（56px + 20px 留白），否则会停在页头下面被遮住
- `align-self: start` **必须写** —— grid 子项默认 `stretch`，元素被拉高后 sticky 无处可动

---

## 抽屉：五条判据（都来自 08 规范）

### 1. 只动 `transform`，不动 `width/left/top`

```css
.nav__list { transform: translateX(100%); transition: transform 180ms; }
.nav__list[data-state="open"] { transform: translateX(0); }
```

动 `width` 会引起重排，页面抖一下。

### 2. 打开时背景必须锁

视觉上是覆盖层，逻辑上也要是模态——**两边必须一致**。
否则用户能 Tab 到抽屉外面看不见的地方。

### 3. 焦点必须移进抽屉，并且**关闭后回到汉堡按钮**

丢了焦点，键盘用户就不知道自己在哪了。

### 4. Esc 必须能关

这是唯一"所有人都知道"的操作，不能只靠点遮罩。

### 5. 窗口变宽时自动关掉

否则抽屉会留在打开状态，而桌面布局下 `nav__list` 是横排的——
用户会看到一个"开着但不对"的菜单。

---

## 三个无障碍细节

| 做法 | 原因 |
|---|---|
| 跳过链接用 `transform` 移出视口，**不用 `display:none`** | `display:none` 会把它移出 tab 顺序，键盘用户 Tab 不到 |
| 当前页用 `aria-current="page"` | 屏幕阅读器会播报"当前页面"，自定义 class 它不知道 |
| 目录高亮用 `aria-current="true"` | 表示"在当前范围内的当前位置"，目录高亮通行做法 |

---

## 汉堡按钮的三条线怎么变 X

```
默认：  ─────  三条线
        i::before / i::after 上下偏移 ±5.5px

展开：  i 自身 rotate(45deg)      → 变成 /
        i::before translateY + rotate(-90deg) → 变成 \
        i::after opacity 0        → 消失
```

**为什么偏移量是 5.5px**：线宽 1.5px，中心间距 11px，所以偏移 5.5px 让它们重合到中心。
这个数是算出来的，不是估的。

---

## 反模式

- ❌ **抽屉展开时动 `width` / `left` / `top`** —— 引起重排，页面抖
- ❌ **抽屉打开后背景仍可 Tab / 可点** —— 视觉是覆盖层，逻辑不是模态
- ❌ **汉堡按钮小于 44px** —— 触摸目标硬下限
- ❌ **当前页指示用自定义 class 而非 `aria-current`** —— 屏幕阅读器不知道
- ❌ **目录项允许换行** —— 行高跳变，目录看着散
- ❌ **没有 IntersectionObserver 就不做高亮** —— 目录变成死链接
- ❌ **跳过链接用 `display:none`** —— 移出 tab 顺序，键盘到不了
- ❌ **页头 sticky 但没背景色** —— 内容从下面透出来像重影

---

## 门禁

| 项 | 能否机械检查 |
|---|---|
| CSS 引用完整性 | ✅ `refs.py` |
| 状态切换的叠放/占位/溢出 | ✅ `switch.py` |
| 焦点管理、Esc、背景锁、点遮罩、变宽自关 | ✅ `05-audit/nav-drawer.js`（浏览器 + 键盘，22 条） |
| 读屏里到底听到了什么 | ❌ **必须真机开读屏** |
| 视觉上别扭不别扭 | ❌ **必须真机** |

🟡 0.11.2 之前这里写的是「焦点、Esc、背景锁**静态检查一个都查不出来**，必须真机」。
那句话当时是对的，但它描述的是一种**可以修的**状态 —— 现在这三件事由
`nav-drawer.js` 在真浏览器里跑（含连续 8 次 Tab 的焦点陷阱、Esc 后焦点归位、
`aria-hidden` 是否误伤祖先）。**仍然查不出来的是"读屏实际播报什么"**：
无头浏览器没有语音输出，`accessibility.snapshot()` 也只能读到树，读不到播报。
