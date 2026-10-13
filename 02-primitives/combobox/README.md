# combobox · 组合框 / 标签输入

依据 **APG（ARIA Authoring Practices）Combobox with List Autocomplete**。

## ⭐ 与 `select` 的区别

多了两件事：**输入文字过滤** + **已选项标签**。

由此引出本组件最容易做错的两个点：

| # | 要求 | 做错的后果 |
|---|---|---|
| ① | 标签的删除必须**键盘可达**（`Backspace`）| 只能点那个 ✕ ⇒ 键盘用户删不掉已选项 |
| ② | 过滤结果要**明确标出"为什么匹配"**（`<mark>` 高亮命中片段）| 用户不知道是按拼音、首字母还是包含匹配的 ⇒ 以为搜索坏了 |

## 结构

```html
<div class="combo">
  <div class="combo__tags" data-combo-tags>…已选标签…</div>
  <div class="combo__field">
    <input class="combo__input" data-combo-input
           role="combobox" aria-expanded="false" aria-autocomplete="list">
  </div>
  <ul class="combo__list" data-combo-list id="combo-list-1" role="listbox">…</ul>
</div>
```

| 部件 | 说明 |
|---|---|
| `.combo` | 根，`position: relative`（列表定位靠它）|
| `[data-combo-input]` | 输入框，**必需** |
| `[data-combo-list]` | 候选列表，**必需** |
| `[data-combo-tags]` | 已选标签容器（可为空可不要）|
| `.combo__field` | 输入框外层 |

⚠️ 缺 `input` 或 `list` 时 `create()` **直接抛错**，不静默降级。

## 启用

```js
const cb = Combobox.create(元素, { … });
```

## 🔴 已选项列表必须有两个入口

1. 鼠标点标签上的 ✕
2. **键盘**：焦点在输入框、**输入框为空**时按 `Backspace` 删掉最后一个标签

```js
if (k === 'Backspace' && !input.value && tags.length) { … }
```

条件是「**输入框为空**」，不是「光标在开头」—— 输入框里有字时按 `Backspace`
必须正常删字符，不能顺手把标签也删了。

只有第 1 条 ⇒ 键盘用户无法删除已选项，这是最常见的可访问性缺陷。

## 🔴 一个实测教训：序号必须每个实例都领

```js
var seq = ++uid;   // 每个实例进来就领
if (!list.id) list.id = 'combo-list-' + seq;
```

以前是"**只有调用方没给 `list.id` 时**才递增序号" ⇒ 调用方自己给了 id 的场景下，
**多个实例共用一个序号** ⇒ `aria-controls` 指向同一个列表。
所以：**序号无条件递增**，不是按需递增。

## 成熟度：beta（一条行为债，如实列出）

| 债 | 现在的后果 |
|---|---|
| `dismissable:manual` | 点外部关闭是手写的，**不是统一机制** |

## 门禁

- `05-audit/combobox-check.js`
- `05-audit/combobox-instance-check.js` ←专门盯**多实例**那类问题（上面那条就出自这里）