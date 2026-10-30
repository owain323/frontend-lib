# dropdown · 下拉菜单

依据 **APG（ARIA Authoring Practices）Menu Button** 模式。

## 🔴 APG 的四条键盘契约（缺一条就不算合规）

| 键 | 行为 |
|---|---|
| `↑` `↓` | 在**项**之间移动 |
| `Esc` | 关闭，并把焦点**还给按钮** |
| `Tab` | 关闭菜单（焦点移到下一个元素）|
| `Enter` / `Space` | 激活当前项 |
| 字母 / 数字（**可选**） | 跳到名字以该前缀开头的项（APG 标为 `(Optional)`；见下） |

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

## 成熟度：stable（行为零欠账）

两条历史债都收编了，记账在 `ai/behaviors.json`：

| 曾经 | 现在 |
|---|---|
| `focus-return:manual` | 0.8.6 收编：`open()` 里 `save()`、`close()` 里 `restore()`，替掉手写的 `btn.focus()` |
| `typeahead:gap` | 0.15.0 收编：打字跳项走 typeahead 核（见下） |

### 打字跳项（APG 的 `(Optional)` 项）

打一个字母 ⇒ 跳到**下一个**以它开头的项；快速连打 ⇒ 前缀累积；连打同一个字母 ⇒
在匹配项之间循环；不匹配 ⇒ **什么都不做**（APG 不要求"没找到"有反馈）。

⚠️ **它天然只对拉丁字母标签有效**：中文标签靠输入法，而 IME 组字时 `keydown`
给的是 `Process` / `Unidentified`，拿不到字符。所以判据用一张英文夹具测
（`dropdown-check` ⑦），demo 的中文菜单不受影响、也不会因此变慢。

⚠️ 匹配前会**剥掉开头的装饰符号**：带勾选的项文本是「✓ 按日期」，
不剥的话打「按」永远匹配不到。这和 table 列头把 `↕` 念出来是同一类问题 ——
装饰符号不该混进"名字"里。

## 反例

- ❌ **菜单里一部分项 `aria-hidden`、一部分不设** —— APG 要求**全设或全不设**。
  半吊子会让读屏报"1 项中的 0 项"这种不可理解的计数
- ❌ **禁用项不给 `tabindex="-1"`** —— Tab 会停在点不动的项上，用户以为菜单坏了
- ❌ **Esc 关闭后焦点不还给 `dd__btn`** —— 焦点掉到 `<body>`，键盘用户要从页面开头重新 Tab（APG 明确要求归还）
- ❌ **给某个 `dd__item` 设 `tabindex="0"`** —— `role="menu"` 靠方向键步进，多一个 0
  就多出一个 Tab 停靠点，整个菜单的导航模型就混了
- ❌ **先写 `aria-controls` 再确保 `dd__menu` 有 id** —— 顺序反了会引用空字符串，
  读屏拿不到"这个按钮控制哪个菜单"（`dropdown.js` 里为此调过顺序）
- ❌ **用 `opacity: 0` 或 `visibility` 隐藏 `dd__menu`** —— 关闭态要用 `hidden`：
  它同时移出无障碍树并不可聚焦，另两种做法都还留着 Tab 停靠点

---

## 门禁

`05-audit/dropdown-check.js`