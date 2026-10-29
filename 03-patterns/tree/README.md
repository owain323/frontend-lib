# tree · 树形视图

依据 **APG（ARIA Authoring Practices）Tree View** 模式。

## ⭐ 树是键盘契约最严的组件（APG 列了 12 条）

| 键 | 行为 |
|---|---|
| `↑` `↓` | 移动焦点 |
| `←` `→` | 收起 / 展开（并移动焦点）|
| `Home` / `End` | 跳首 / 末 |
| `*` | 展开当前层全部同级 |
| `Enter` | 激活 |
| `Space` | 选中 |
| `a`–`z` | 首字母跳转 |

## 🔴 roving tabindex —— 整棵树只占一个 Tab 位

```css
/* 只有"当前节点" tabindex="0"，其余 -1 */
```

**为什么**：若每个节点都 `tabindex="0"`，**Tab 30 次才能穿过一棵树**。

⚠️ 那个 `"0"` **必须跟着焦点走**。只在初始化时设一次是最常见的 bug ——
用户走到第 3 层后，按 Shift+Tab 回退会回到第 1 个节点。

实现走共享微行为核 `01-tokens/behavior/roving.js`，首字母跳转接`typeahead` 核
—— 不是各组件各写一遍游走逻辑。

## 结构

```html
<ul class="tree" role="tree" aria-label="目录">
  <li class="tree__item" role="treeitem" aria-expanded="true" tabindex="0">
    <span class="tree__node">
      <span class="tree__marker" aria-hidden="true"></span>
      <span class="tree__label">…</span>
      <span class="tree__count">12</span>
    </span>
    <ul role="group">
      <li class="tree__item" role="treeitem" tabindex="-1">…</li>
    </ul>
  </li>
</ul>
```

| 部件 | 说明 |
|---|---|
| `.tree` | 根，`role="tree"` |
| `.tree__item` | 节点，`role="treeitem"` + `aria-expanded` |
| `.tree__node` | 节点内层（marker + label + count）|
| `.tree__marker` | 展开/收起标记位（**符号由 CSS `::before` 生成**，不是文本）|
| `.tree__label` | 文字 |
| `.tree__count` | 计数徽标 |
| `<ul role="group">` | 子层 |

### 标记符号跟着 `aria-expanded` 走

```css
.tree__item[aria-expanded="true"] > .tree__node .tree__marker::before {
  content: "\25BC";       /* ▼ */
}
/* 收起是 ▸，叶子是 · （表示"这里没有子节点"）*/
```

符号是 **CSS 生成的，不是塞进 HTML 的文本** ⇒ 状态一变，符号自动跟着变，
不需要 JS 去同步两处。`.tree__marker` 本身固定占 `1em` 宽并居中，
切换时不会引起文字抖动。

## 启用

```js
const t = Tree.create(元素, { label: '目录' });
```

`create()` 会自己补齐 `role="tree"` 与 `aria-label`（**只在没写时**补，
不覆盖你已有的）。

## 缩进用 padding，不是 margin

```css
.tree ul { padding: 0; }   /* 嵌套层级靠 padding 体现 */
```

用 margin 的话，嵌套结构在视觉上"飘"着，层级读不出来。

## 成熟度：stable（无行为债）

`ai/components.json` 里 `tree` 的 `behaviorDebt` 为空。

## 反例

- ❌ **↑↓ 只移动焦点、←→ 只展开不移动焦点** —— APG 是**两段式**：↑↓ 移动焦点，←→ 展开/收起
  **并带着焦点走**。只做一半，键盘用户会觉得"按了没反应"
- ❌ **每个 `tree__item` 都 `tabindex="0"`** —— 整棵树只占**一个** Tab 位（roving tabindex）；
  否则穿过 200 个节点要按 200 次 Tab
- ❌ **只靠旋转箭头表示展开/收起** —— 必须有**三态形状线索**（`tree__marker`）：
  旋转只能看出"变过"，看不出"现在是哪一态"
- ❌ **RTL 下收起箭头不翻向** —— 阿拉伯语用户看到的是一个指错方向的符号；
  `tree.css` 里那条 `[dir="rtl"]` 就是为此
- ❌ **用 `margin` 做层级缩进** —— 缩进用 padding：`margin` 会把点击区一起缩窄，深层的节点点不中
- ❌ **把 ←→ 交给"左右移动"处理** —— 树里 ←→ 是展开/收起（APG 两段式），
  当成左右移动会被方向键库先吃掉

---

## 门禁

`05-audit/tree-check.js`