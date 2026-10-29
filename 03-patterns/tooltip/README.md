# tooltip · 文字提示

补充说明，**不是**主要信息的载体。

## 🔴 一条铁律：tooltip 不承载必要信息

触屏设备**没有 hover** ⇒ tooltip 在手机上等于不存在。
凡是"用户必须知道"的内容，绝不能只放在 tooltip 里。

**怎么自己查**：tooltip 里的文字必须与触发元素的可见文字或 `aria-label`
**不重复**。重复了，就说明它本该直接可见。

> 这是本库唯一一条"用法约束"级别的规则，也是最常被违反的一条。

## 结构（JS 生成，不要手写）

```js
Tooltip.attach(按钮, '说明文字', 'top');
```

生成的结构：

```html
<button data-tooltip="说明文字" aria-describedby="tt1">…</button>
<div id="tt1" class="tooltip tooltip--top" role="tooltip">说明文字</div>
```

| 参数 | 取值 | 说明 |
|---|---|---|
| `el` | Element | 触发元素 |
| `text` | string | 纯文本（用 `textContent` 写入，**天然免疫注入**）|
| `place` | `top`（默认）/ `bottom` / `inset-inline-start` / `inset-inline-end` | 方位 |

公开 API 只有 `Tooltip.attach()`，**没有** `show` / `hide` ——
显隐由 hover / focus / click 自动驱动。

## 🔴 用 `aria-describedby`，不是 `aria-label`

tooltip 与触发元素的关系是**描述**，不是**命名**。
`aria-label` 会**覆盖**元素本来的可访问名——按钮上的文字会被抹掉。

```js
el.setAttribute('aria-describedby', cur ? (cur + ' ' + id) : id);
```

⚠️ 已有 `aria-describedby` 时是**追加空格**，不是覆盖 —— 可能同时有多个描述。

`role="tooltip"` + `aria-live="polite"`：内容变化时读屏会念出来。

## 键盘与触屏

| 输入 | 行为 |
|---|---|
| 键盘 `focus` | 出（**键盘必须可达**，只做 hover 等于对键盘用户不存在）|
| `Esc` | 关（WCAG 1.4.13 Content on Hover or Focus）|
| 触屏 `click` | 切换开/关 |

## 🔴 定位前必须先入 DOM

游离元素的 `getBoundingClientRect()` **全是 0**。

实测踩过：`top` 方位的气泡与锚点完全重叠 —— 原因就是先量尺寸、
后插进 DOM。正确顺序是**先挂上去、藏起来量，量完再显示**。

## 显隐靠 `data-state`，别写 `display`

```css
.tooltip[data-state="open"] { … }
```

JS 只切`data-state`，显隐与动画全交给 CSS。
写 `style.display` 会把过渡动画彻底干掉。

## 降级

| 场景 | 处理 |
|---|---|
| `prefers-color-scheme: dark` | 已适配 |
| `prefers-reduced-motion: reduce` | 已关闭动效 |
| 无 `(hover: hover) and (pointer: fine)` | 只保留点击触发 |

## 成熟度：beta（两条行为债，如实列出）

契约里标的是 `beta`，两条债都记在这儿，**别当stable 用**：

| 债 | 含义 | 现在能做什么 |
|---|---|---|
| `dismissable:manual` | 关闭逻辑是手写的，不是统一机制 | 点击/`Esc` 能关，但**点击外部空白不关** |
| `focus-return:manual` | 焦点归位是手写的 | 关闭后焦点**不一定**回到触发元素 |

要接统一行为层，得先清这两条债。

## 反例

- ❌ **把必须知道的信息只放在 tooltip 里** —— 触屏没有 hover，键盘用户也未必停留。
  判据很硬：tooltip 的文字**不能**与触发元素的可见文字/`aria-label` 重复 ——
  一旦重复，说明它承载了本该可见的信息
- ❌ **只做 hover、不做 focus** —— 键盘用户永远看不到（WCAG 1.4.13 要求 focus 也能出）
- ❌ **Esc 关不掉** —— WCAG 1.4.13 的硬性要求：hover/focus 出现的内容必须可以关掉
- ❌ **用 `display: none` 隐藏气泡** —— 读屏读不到；淡入用透明度
- ❌ **`role="tooltip"` 不给 `aria-label`** —— 光靠内容拿不到可访问名，读屏只会念"提示"（0.8.9 补的）
- ❌ **触屏只靠 hover 触发** —— 触屏上 hover 会"粘住"不褪；触屏必须走 JS 的 click / focus

---

## 门禁

`05-audit/tooltip-check.js`（契约 `gates` 里登记的唯一一道）——
覆盖 `aria-describedby` 关联、`Esc` 关闭、触屏点击三条。