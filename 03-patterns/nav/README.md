# nav —— 页头 / 目录 / 移动端抽屉

| 字段 | 内容 |
|---|---|
| **来源** | 原创。`toc.js` 是从 `04-recipes/longform` 内联脚本**提取并加固**的 |
| **实测** | demo 三件事都能真机验证（页头/目录/抽屉） |
| **适用** | 精简档 / B / C，`toc.js` 为 ES5 |
| **依赖** | `01-tokens/tokens.css` + `02-primitives/button/button.css` |
| **规范** | 见本文件「状态切换」一节|

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
.nav__list.is-open { transform: translateX(0); }
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
| 焦点管理、Esc、背景锁 | ❌ **必须真机** |
| 视觉上别扭不别扭 | ❌ **必须真机** |

🔴 **诚实标注**：抽屉最难的三件事（焦点、Esc、背景锁）**静态检查一个都查不出来**。
demo 的第一屏就是让你自己试的。
