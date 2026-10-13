# dropdown · 下拉菜单

依据 **APG（ARIA Authoring Practices）Menu Button** 模式。

## 🔴 APG 的四条键盘契约（缺一条就不算合规）

| 键 | 行为 |
|---|---|
| `↑` `↓` | 在**项**之间移动 |
| `Esc` | 关闭，并把焦点**还给按钮** |
| `Tab` | 关闭菜单（焦点移到下一个元素）|
| `Enter` / `Space` | 激活当前项 |

## ⚠️ 另有两条容易漏的

- **关闭后焦点必须归位** —— 不归位，键盘用户在页面里迷路
- **菜单项命中区 ≥ 44px** —— 密集列表也必须够大（WCAG 2.5.5AAA）

## 结构

⚠️ **类名前缀是 `dd__`，不是 `dropdown__`**；标记是 `data-dd-*`。

```html
<div class="dd">
  <button class="dd__btn" data-dd-btn aria-haspopup="menu" aria-expanded="false">
    <span>操作</span><span class="dd__caret" aria-hidden="true"></span>
  </button>
  <div class="dd__menu" data-dd-menu role="menu">
    <button class="dd__item" role="menuitem" data-value="edit">编辑</button>
    <hr class="dd__sep" data-dd-sep role="separator">
    <button class="dd__item" role="menuitem" data-value="del">删除</button>
  </div>
</div>
```

| 部件 | 说明 |
|---|---|
| `.dd` | 根 |
| `.dd__btn` / `[data-dd-btn]` | 触发按钮 |
| `.dd__menu` / `[data-dd-menu]` | 菜单本体，**必需** |
| `.dd__item` | 菜单项，带 `data-value` |
| `.dd__sep` / `[data-dd-sep]` | 分隔线 |
| `.dd__check` | 多选勾选位 |
| `.dd--end` | 菜单右对齐 |

## 启用

```js
const dd = Dropdown.create(元素);
```

- `[data-dd-btn]` 找不到时**退回第一个 `<button>`**（省事的写法也能跑）
- `[data-dd-menu]` 找不到 → **直接抛错**

## 🔴 `role="menu"` 要么全设要么全不设

```js
// APG：菜单要么全 aria-hidden，要么全不设 —— 不能半吊子
menu.setAttribute('role', 'menu');
```

`aria-hidden` 打了一半在个别项上，读屏会读到一半就断掉。

## 状态写在 DOM 属性上

`data-state` / `data-value`，**不用 class 切换** —— 这是全库 INVARIANT I-8
（状态必须活在 DOM 属性上），也是门禁会查的东西。

## 成熟度：beta（两条行为债，如实列出）

| 债 | 现在的后果 |
|---|---|
| `focus-return:manual` | 关闭后归位是手写的，不是统一机制 |
| `typeahead:gap` | **没有类型搜索** —— APG 的 Menu Button 不硬性要求，但列表长时体验缺失 |

## 门禁

`05-audit/dropdown-check.js`