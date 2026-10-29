# drawer · 抽屉

依据 **APG Dialog 模式** —— 抽屉就是"从侧边滑进来的 Dialog"。

**与 dialog 的差别只有"从哪进来"，三条硬要求完全一样。**

## 🔴 三条硬要求（一条都不能少）

| # | 要求 | 做错的后果 |
|---|---|---|
| ① | **焦点陷阱**：Tab 在抽屉内循环 | Tab 跑到背景上去，抽屉等于没锁 |
| ② | `Esc` 关闭 | 键盘用户出不来 |
| ③ | **关闭后焦点归位**（回到触发它的那个按钮）| 键盘用户被"扔"回页面顶部，得从头 Tab 一遍 |

③ 最容易漏、**影响最大**。所以本组件的焦点归位走共享微行为核
`01-tokens/behavior/focus-return.js` 注入，不是各组件各写一遍。

## ⚠️ 抽屉是模态：背景必须 inert

```js
// 只把 body 的直接子元素（除抽屉容器）设 inert
```

不设 `inert` / `aria-hidden` 的后果：**读屏会同时读到抽屉与背景**
（业内叫"双重朗读"）—— 用户听到一半不知道自己在听哪。

## 结构

```html
<aside class="drawer drawer--right" role="dialog" aria-modal="true"
       aria-label="标题">
  <header class="drawer__head">
    <h2 class="drawer__title">…</h2>
    <button class="drawer__close" type="button">✕</button>
  </header>
  <div class="drawer__body">…</div>
  <footer class="drawer__foot">…</footer>
</aside>
```

| 部件 | 说明 |
|---|---|
| `--right`（默认）/ `--left` / `--top` / `--bottom` | 四个进入方向 |
| `.drawer__head` / `__title` / `__close` | 头部与关闭按钮 |
| `.drawer__body` | 内容 |
| `.drawer__foot` | 底部操作区 |

## 启用

```js
Drawer.open({ place: 'right' });   // 默认就是 right
```

全局只导出 `open`（不是 `create`）—— DOM 由 JS 建。

### 🔴 焦点必须在插入 DOM **之前**记

```js
// ⭐ 记住"打开那一刻的焦点" —— 必须在插入 DOM 之前，
//    否则会记到刚建出来的新节点上（那就等于没记）
```

抽屉没有 fallback：打开它的元素若被删了，就**维持现状不动**，
不假装"还回去了"（那样会把焦点送到一个已经不存在的地方）。

## 嵌套用锁计数

背景 `inert` 用 `lockCount` 计数管理 ⇒ 抽屉里再开抽屉时，
外层的锁不会因为内层关闭而被提前解掉。

## 成熟度：beta（两条行为债，如实列出）

| 债 | 现在的后果 |
|---|---|
| `dismissable:manual` | 点遮罩关闭是手写的，不是统一机制 |

## 反例

- ❌ **打开抽屉时不给背景加 `inert` / `aria-hidden`** —— 抽屉是**模态**：读屏会把抽屉与背景
  一起念出来（"双重朗读"），用户听到两套内容叠在一起
- ❌ **省掉焦点陷阱** —— Tab 会跑到抽屉外面，键盘用户在看不见的内容上操作，还以为抽屉坏了
- ❌ **`drawer__close` 做得很小** —— 它是独立目标，要 44px。抽屉滑进来之后，用户第一件事就是找关闭
- ❌ **在插入 DOM 之后才记录 `document.activeElement`** —— 记到的是新节点，
  关闭时焦点"归还"到一个已经不存在的位置，等于没还
- ❌ **嵌套抽屉不用锁计数** —— 内层关掉时会把外层的滚动锁一起解开，外层还在，背景却能滚了

---

## 门禁

`05-audit/drawer-check.js`