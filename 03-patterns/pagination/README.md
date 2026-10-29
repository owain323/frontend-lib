# pagination · 分页

判据：**WCAG 2.5.5Target Size** + 键盘 `←` `→` `Home` `End` 可达。

依据 5 个来源口径一致：W3C APG / MDN / USWDS / Component Gallery / Mironsoft。

## 🔴 六条结构硬要求（不是"最佳实践"）

### 1. 必须包在 `<nav>` 里，且 `aria-label` **唯一**

一个页面常常有多个 `<nav>` —— 主导航、面包屑、分页。
没有 `aria-label`，读屏用户分不清哪个是哪个。

⛔ **不要**把 `role="navigation"` 直接放在 `<ul>` 上 ——
那会**覆盖 `<ul>` 的列表语义**（Component Gallery 明确点出这是常见错误）。

### 2. 用 `<ul>` + `<li>`，不要用松散的 `<a>`

列表能传达"共几项"和"当前在第几项"。

### 3. 当前页用 `aria-current="page"`

⚠️ **不要**用 `aria-selected` —— 那是给 tab / option / row 用的。

### 4. 每个页码的 `aria-label` 要说人话

"第 4 页"，不是 "4"。脱离上下文时，孤零零的数字没有意义。

### 5. 上一页/下一页要有明确的 `aria-label`

"上一页"，不是只有一个箭头图标。
首/末页时用 **`disabled`** 标记 —— 不是"留在 DOM 里但不工作"。

### 6. ⭐ 客户端翻页必须有 `aria-live="polite"`，且**元素常驻 DOM**

只改 `textContent`。**插入新元素的话很多读屏器播报不出来** ——
这是实测里最容易踩的一条。

## 结构

```html
<nav class="pagination" aria-label="分页导航">
  <ul class="pagination__list" data-pg-list>
    <li class="pagination__item">
      <a class="pagination__link" href="?page=1"
         aria-label="上一页" data-goto="prev">上一页</a>
    </li>
    <li class="pagination__item">
      <a class="pagination__link" href="?page=4" aria-label="第 4 页"
         aria-current="page" data-page="4">4</a>
    </li>
    <li class="pagination__ellipsis" aria-hidden="true">…</li>
    …
  </ul>
  <p class="pagination__status pagination__sr" data-pg-live
     aria-live="polite"></p>
</nav>
```

| 部件 | 说明 |
|---|---|
| `.pagination` | 根（在 `<nav>` 里）|
| `.pagination__list` / `[data-pg-list]` | `<ul>` |
| `.pagination__item` / `.pagination__link` | `<li>` / `<a>` |
| `.pagination__ellipsis` | 省略号，`aria-hidden` |
| `.pagination__live` / `[data-pg-live]` | **常驻**的播报区，`aria-live="polite"` |
| `.pagination__sr` | 只给读屏的视觉隐藏文本 |
| `.pagination__status` | 当前状态文字 |

## 启用：配置全部从 DOM 属性读

```html
<nav class="pagination" aria-label="分页导航"
     data-pagination data-total="302" data-page-size="20" data-page="1">
```

```js
const pg = Pagination.create(元素);   // 单参数
```

| 属性 | 含义 | 默认 |
|---|---|---|
| `data-total` | 总条数 | 1 |
| `data-page-size` | 每页条数 | 20 |
| `data-page` | 当前页 | 1 |
| `data-pg-param` | URL 里的页码参数名 | `page` |

另外两个：

```js
Pagination.update();                  // 扫描 [data-pagination] 并逐个 create（可传 root 限定范围）
Pagination.pagesOf(total, pageSize);  // ⭐ 纯函数算页数 —— 表格用它显示「共 N 页」
```

`create()` 是**幂等**的：同一个元素第二次调用直接返回已有实例，不会重复绑。

### ⭐ 从 URL 恢复页码

```js
var u = node.getAttribute('data-pg-param') || 'page';
var q = parseInt(new URL(location.href).searchParams.get(u) || '0', 10);
if (q > 0) this.page = Math.min(q, this.pages);
```

刷新页面、别人分享链接，都能回到同一页 —— 而且会被**夹在合法页数范围内**。
这是"翻页"从一次性动作变成可分享状态的关键。

## 成熟度：stable（无行为债）

`ai/components.json` 里 `pagination` 的 `behaviorDebt` 为空。

## 反例

- ❌ **把 `role="navigation"` 直接放在 `pagination__list` 上** —— 会**覆盖 `ul` 的列表语义**，
  读屏不再报告"共 N 项"。要包在 `<nav aria-label>` 里
- ❌ **用 `aria-selected` 标当前页** —— 那是 tab / option / row 的语义；当前页用 `aria-current="page"`，
  用错了读屏会说"已选中"，而用户以为自己只是停在第 3 页
- ❌ **客户端翻页不放 `pagination__live`** —— 页码变了却没有任何播报，读屏用户不知道"内容已经换了"。
  而且这个 live 区必须**常驻 DOM**：新插入的节点很多读屏不播
- ❌ **页码无限铺开** —— 槽位一多就撑破窄屏（USWDS 的上限是 7）。该用 `pagination__ellipsis` 收中间
- ❌ **没跳过页码也显示省略号** —— 用户会以为中间少了页，去点它，什么也不会发生
- ❌ **禁用态用纯透明表示** —— 半透明会让人以为"再点一下就行"；本库是让它"退到背景里"

---

## 门禁

`05-audit/pagination-check.js`