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
| `Enter` / `Space` | 选中并关闭 |
| `Esc` | 关闭，并**把焦点还给按钮** |
| `Alt` + `↓` | 直接打开 |

**① 为什么强调"落在选中项"**：这是 APG 明确要求的，也是最常做错的一条。
打开后焦点在第一项，用户按一次`↓` 就跳到第二项 —— 原来选的那项被跳过了。

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

## 门禁

`05-audit/select-check.js` —— 覆盖键盘契约与 ARIA 属性同步。