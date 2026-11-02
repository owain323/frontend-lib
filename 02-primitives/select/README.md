# select · 自建下拉选择

依据 **APG（ARIA Authoring Practices）Select-Only Combobox** 模式。

## ⭐ 什么场景用、什么场景别用

| 场景 | 用什么 |
|---|---|
| 表单提交、移动端体验 | **原生 `<select>`** |
| 需要自定义外观（圆角/字体/阴影、选项带说明） | 本组件 |

**为什么需要自建**：原生 `<select>` 在 Windows 上**无法定制样式**（下拉列表由
系统绘制），圆角/字体/阴影全部无效 ⇒ 跨平台观感不一致。

⛔ 但**表单提交**仍由本组件通过 `hidden input` 承接，`create()` 时会自己建。

## 结构

```html
<div class="select">
  <button class="select__btn" data-select-btn aria-haspopup="listbox"
          aria-expanded="false" aria-controls="select-list-1">
    <span class="select__value">…</span>
    <span class="select__caret" aria-hidden="true"></span>
  </button>
  <ul class="select__list" data-select-list id="select-list-1" role="listbox">
    <li class="select__opt" role="option" aria-selected="false">
      <span class="select__opt-text">…</span>
    </li>
  </ul>
</div>
```

| 部件 | 说明 |
|---|---|
| `.select` | 根（**必须**），`position: relative` 靠它定位列表 |
| `[data-select-btn]` / `[data-select-list]` | **两个都必需**，缺一个 `create()` 直接抛错 |
| `.select__value` | 按钮里显示当前值 |
| `.select__check` | 多选时的勾选位 |
| `.select--block` | 整块宽度（省掉 `min-width: 12rem`）|
| `.select--end` | 列表右对齐 |

⚠️ `id` 可以不写，`create()` 会自动补`select-list-N`。

## 启用

```js
const sel = Select.create(元素, { multiple: false, value: 'b', label: '选项' });
```

| 参数 | 说明 |
|---|---|
| `multiple` | 多选（会写 `aria-multiselectable`）|
| `value` | 初始选中项的 value |
| `label` | 列表的 `aria-label` |

## 🔴 APG 的键盘契约（三条最容易漏）

| 键 | 行为 |
|---|---|
| 打开后焦点 | **落在选中项**（不是第一项，也不是按钮）|
| `↑` `↓` | 循环上下移动 |
| `Home` / `End` | 跳首/ 末 |
| `Enter` / `Space` | 单选：选中并关闭；**多选：切换该项、列表不关** |
| `Esc` | 关闭，并**把焦点还给按钮** |
| `Alt` + `↓` | 直接打开 |
| 关闭态打字 | 打开并跳到首个匹配项（同原生 `<select>`） |

**① 为什么强调"落在选中项"**：这是 APG 明确要求的，也是最常做错的一条。
打开后焦点在第一项，用户按一次`↓` 就跳到第二项 —— 原来选的那项被跳过了。

⚠️ 这里的"焦点"是**活动项**：用 `aria-activedescendant` 指到选中项，DOM 焦点仍留在
按钮上。这是 APG「select-only combobox」的合法形态 —— 拿 `document.activeElement`
去要求它落进 `<ul>` 会判成缺陷，实际不是。本库的判据也是按前一种断的
（`opener-path-check` 里这条组件的 `focus` 声明为 `activedesc`）。

## 多选与表单提交

`multiple: true` 时：

- 内部状态是**数组**，`aria-multiselectable="true"` 与 `aria-selected` 都按它写
  —— 不是"写着多选、其实只有一个值"。
- 按钮文本按勾选顺序拼成 `A、B、C`，过长由 CSS 截断，`title` 里保留全量。
- **提交值一个选项一个 `input[type=hidden]`，同名多条**：

  ```html
  <input type="hidden" name="sector" value="a">
  <input type="hidden" name="sector" value="c">
  ```

  name 依次取 `create({name})` → 根上的 `data-name` → 作者自己写的 hidden 的 name → 根元素 `id`。
  一个都不给的话多选提交不出去，所以最后一档兜底到 `id`。

- 每次值变化都会在**根元素上派发原生 `change`**（冒泡），
  React 受控组件 / `form.reset` 监听器认的是这个；`fl-change` 仍然发，给本库自己的使用者。

## API

```js
const sel = Select.create(el, { multiple: true, value: ['a', 'c'], name: 'sector' });

sel.value          // 单选：字符串或 null；多选：数组
sel.values         // 数组副本（多选常用）
sel.value = 'b'    // 赋值后立即重绘 + 派发 change
sel.open() / sel.close()
sel.destroy()      // 摘掉 keydown/click/dismissable/typeahead，删掉自己补的 hidden
```

`destroy()` 之前没暴露过：动态移除组件时 `document` 上的 dismissable 监听、
typeahead 缓冲、按钮上的 keydown 会一直留着。现在必须调，重复调是安全的。

## 类型搜索（typeahead）

连续打字跳到匹配项。**原生 `<select>` 有这个能力，所以自建的必须有**。

它不是在这里实现的，而是**接线**到共享微行为核
`01-tokens/behavior/typeahead.js`（`BEHAVIOR INJECT: typeahead` 段）——
`tabs` / `tree` 等也接同一份，所以各组件只有一半接线代码，不是各抄一遍规则。

⚠️ 已知盲点（实测结论，记在 `select-check.js` 里）：
把 `typeahead.type(k)` 那行接线删掉，门禁**会红**；
但把 `close()` 里的 `typeahead.clear()` 删掉，**守不住**。
⇒ 这类"接线"类缺陷目前只能靠人读，别把门禁绿当成"接线全对"。

## 成熟度：beta（两条行为债，如实列出）

| 债 | 现在的后果 |
|---|---|
| `dismissable:manual` | 点外部空白能关，但**不是统一机制** |
| `focus-return:manual` | `Esc` 关闭后焦点能回按钮，但**不是统一机制** |

接统一行为层前，别当`stable` 用。

## 反例

- ❌ **不实现类型搜索** —— 原生 select 支持连续打字跳转；自建却丢掉这个，是**功能倒退**。
  `select.js` 里做了 500ms 缓冲（超时清空，否则 "abc" 永远搜不到）
- ❌ **把焦点放进 `select__list`** —— 焦点必须常驻 `select__btn`，"当前在第几项"靠
  `aria-activedescendant` 表达；焦点进了 list，读屏会开始念"列表"而不是"选项"
- ❌ **`select__opt` 命中区不足 44px** —— 本库按 AAA 要求做命中区；选项挤在一起，触屏必点错
- ❌ **把 `select__value--placeholder` 当已选值** —— 占位不是值：表单提交时它是空的，
  而用户以为自己选了

---

## 门禁

`05-audit/select-check.js` —— 覆盖键盘契约、ARIA 同步、多值与表单提交。

外部审计（2026-11）指出"↑↓ 一次走两格、多选 Enter 选上又取消、空列表抛错、
没有 destroy"之后，这四条变成了**精确断言**（一次按键只准走一格、Enter 只准切一次、
空列表不准抛、destroy 后不准再响应）。旧断言只判"序列有变化"，所以双处理器能混过去。