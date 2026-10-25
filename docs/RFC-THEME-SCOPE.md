# RFC · 令牌主题的容器级作用域（P1）

状态：**已实施**（0.11.0）。本文件记录决策与**不做什么**，实施细节见
`01-tokens/tokens.css` 的生成段与 `05-audit/theme-scope-gate.js`。

---

## 一、问题

现在暗色只有两条入口，都在**根元素**上：

```css
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }
:root[data-theme="dark"] { … }            /* 由 theme-sync.py 生成 */
```

后果是：**一个页面只能有一种主题**。做不了这些真实需求 ——

- 文档站里把"反色示例"放在一块区域（同一页同时展示明暗两版）
- 营销页的深色 hero + 浅色正文
- 嵌入第三方内容的容器强行用某一套配色（对方假设了底色）

对标对象：Primer 的 `[data-color-mode]`、Radix Themes 的 `<Theme>` 组件、
Material 3 的局部 surface —— 都是**容器级**的。

## 二、决定

### D1 · 选择器去掉 `:root` 限定

```css
:root[data-theme="dark"],
[data-theme="dark"] { … }
```

保留 `:root[...]` 一项是为了根元素上的特异性不降级（与旧行为逐字等价），
`[data-theme="dark"]` 这一项让**任何容器**也能用。

### D2 · 必须显式生成 `[data-theme="light"]` 块

CSS 的 `var()` 是**继承**的。容器里声明了 `--raw-*`，后代全部继承过去 ——
没有任何"取消声明、回到上一个作用域"的语法：

- `revert` 回滚到 UA/用户来源，自定义属性在 UA 里不存在 ⇒ 变成"未定义"，**不是**回到父级浅色值
- `unset` 对自定义属性等同 `inherit` ⇒ 继承的还是暗色值

所以"暗容器里再嵌一块浅色"只能靠**把浅色 L1 全部重写一遍**。

⚠️ 这等于造出**第三份真值**（浅色 L1 现在有两处）。按 `docs/INVARIANT.md` I-7，
第二份手写真值必然漂移 ⇒ 所以这块**由 `theme-sync.py` 生成**，并逐条校验（判据 ②）。
不手写。

### D3 · 容器不支持"未标注即跟随系统"

自动跟随仍然**只在根上**生效。理由不是偷懒：

要让容器"没写 data-theme 时跟着系统走"，选择器只能是
`*:not([data-theme])` 之类 —— 那会把 30 个令牌**写到每一个元素上**。
后果有两个，都是硬伤：

1. 每个元素各存一份令牌 ⇒ 使用者写在 `body` 上的 `--paper` 覆盖不了任何后代
2. 元素数 × 30 个自定义属性，长页面上是实打实的内存与样式重算开销

⇒ 约定：**容器要局部主题，就必须显式写 `data-theme="dark" | "light"`**。

### D4 · 本次**不加** `color-scheme`

`color-scheme` 能让原生滚动条、日期选择器、复选框跟随主题（`date-range.css`
已经在局部这么做了）。但把 `color-scheme: dark` 加到根上会**改原生控件的渲染**：

- 40 页视觉基线会全部变化
- 而"零视觉影响"正是本库用来证明改动安全的手段 —— 一旦基线全变，这次改动就失去了可比对的证据

⇒ 单独一轮做，并且要为它**专门**重建基线、写清"这次基线变化是预期的"。
不是 forgotten，是 deferred，见本文末"未决"。

### D5 · 组件里不许再按 `prefers-color-scheme` 分支

一旦主题可以来自容器，`@media (prefers-color-scheme)` 就**只反映系统**，
不反映"当前作用域实际是什么"。这类覆盖在三种情况下会失效：

| 场景 | 组件内的 media 查询 | 结果 |
|---|---|---|
| 系统浅色 + `data-theme="dark"` | 不命中 | 组件留在浅色样式 ⇒ **与周围不自洽** |
| 系统深色 + `data-theme="light"` | 命中 | 组件用了暗色样式 ⇒ **与周围不自洽** |
| 容器级 `data-theme` | 完全不反映 | 同上 |

⇒ 组件的明暗差异必须**全部由令牌表达**。本次清理出两处：

- `badge.css`：那段 media 块与基础规则**逐字相同**（`--text-on-solid` 在两个
  主题下都已正确翻转）⇒ 纯死代码，删除
- `tooltip.css`：这段是真分支（暗色下把气泡从"反色"改成 `--surface-raised`）。
  改成两个新语义令牌 `--tooltip-bg` / `--tooltip-fg`，由 L1 按作用域翻转

## 三、影响面

| 文件 | 变化 | 是否影响既有页面渲染 |
|---|---|---|
| `01-tokens/tokens.css` | 生成段变成两个（dark 加选择器、新增 light） | **否**（`:root` 下的解析值不变） |
| `01-tokens/tierA-tokens.css` | 重新生成 | 否 |
| `01-tokens/focus-ring.css` | 4 个选择器去掉 `:root` 限定 | 否（根上特异性不变，仍是 `[data-theme]` 0,1,0 vs 原 0,2,0 —— 见下注） |
| `02-primitives/badge/badge.css` | 删一段等价 media 块 | 否 |
| `03-patterns/tooltip/tooltip.css` | media 块 → 令牌 | **否**（新令牌在两种主题下取的就是原来那两组颜色） |
| 其余 33 个组件 | 不动 | 否 |

> 焦点环那 4 个选择器：原本 `:root[data-theme="dark"] :focus-visible` 是 0,2,0；
> 改成 `[data-theme="dark"] :focus-visible` 是 0,1,0。它的对手是
> `:focus-visible { outline-color: var(--accent) }`（0,1,0，位置更靠前）——
> 仍然后者被覆盖，因为同类特异性下**后出现者赢**。已由 `focus-ring-check.js` 与
> 新增的容器用例共同守住。

## 四、验收判据（全部机械可跑）

| 编号 | 判据 | 门禁 |
|---|---|---|
| ① | 暗色生成段与 `@media` 段**逐条一致** | `theme-sync --check` |
| ② | 浅色生成段与 `:root` 的 L1 **逐条一致** | `theme-sync --check` |
| ③ | 根上四种组合（系统 × data-theme）判色仍正确 | `theme-css-gate` |
| ④ | 容器内组件随容器变色、容器外不变 | `theme-scope-gate` |
| ⑤ | 嵌套回退：暗容器里的浅容器真的是浅色 | `theme-scope-gate` |
| ⑥ | 组件在容器作用域下对比度仍达标 | `theme-scope-gate`（实测对比度，不读源码） |
| ⑦ | 全库不再有"组件按系统偏好分支" | `theme-scope-gate` 静态判据 |

反向控制（必须能红）：把 `[data-theme="dark"]` 改回 `:root[data-theme="dark"]` ⇒
④⑤ 立刻红；删掉 `[data-theme="light"]` 段 ⇒ ⑤ 红；把 tooltip 的 media 块加回去 ⇒ ⑦ 红。

## 五、回滚

改动按三次提交落地（RFC / 核心作用域 / 组件去 media），每一提交都可单独
`git revert` 而不影响另两步。回滚"核心作用域"后，组件侧的新令牌仍能工作
（只是不再支持容器级），不会留下悬空 `var()`。

## 六、未决（下次拍板）

1. **`color-scheme`**（D4）：加不加、加到哪一层、基线怎么重录 —— 需要单独一轮。
   建议做法：只在**显式** `data-theme` 作用域上设 `color-scheme`，根上不改 ⇒
   既有页面基线不变，容器内的原生控件才跟随。
2. **容器级"跟随系统"**（D3）：如果确实需要，正确做法不是 `*:not([data-theme])`，
   而是让使用者显式写 `data-theme="auto"`，由 CSS 无法表达 ⇒ 必须 JS 落地。
   这会破坏"纯 CSS 明暗"（I-4 的教训），所以**默认不做**。
3. **主题内的阴影**：`--shadow-1/2` 是固定 `rgba(31,29,25,…)`，暗色下几乎不可见。
   这是既有问题，与作用域无关，留到令牌色阶工程（D5b）一起处理。
