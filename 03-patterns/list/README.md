# list —— 列表

| 字段 | 内容 |
|---|---|
| **来源** | 原创。FLIP 原理是公开技术，无第三方代码 |
| **实测** | `demo.html` 四种交互可实际操作；JS 语法经 `node --check` 验证 |
| **适用** | 精简档 / B / C，`flip.js` 为 ES5 |
| **依赖** | `01-tokens/tokens.css` + `02-primitives/button/button.css` `03-patterns/states/states.css`（空状态用 `.state--empty`） + `01-tokens/typography.css`（`.note` 提示框）|

---

## 🔴 为什么不用 auto-animate

评估过 auto-animate（8 KB min+gzip，精简档 装得下，MIT 协议），
但列表真正需要的只有**"增删时其余项平滑移动"**这一件事。

| | auto-animate | 自己写 FLIP |
|---|---|---|
| 体积 | ~8 KB | **~1.5 KB** |
| 协议尽调 | 必需 | **零风险** |
| 依赖风险 | 供应链 / 更新 | 无 |
| 能力 | 增删改 + 颜色 + 尺寸 + 表单值 | 只做平滑移动 |

**为不需要的能力引入 8 KB 第三方，要承担协议尽调与供应链风险，不划算。**
（协议已核实：MIT，无条款冲突。但核实这件事本身就花掉了 70 行 + 3 波调研，
而且对方发新版时还要重新判断——这是持续的维护成本，不是一次性的。）

---

## FLIP 四步

```
First   记录变化前的位置（getBoundingClientRect）
Last    DOM 变化后记录新位置
Invert   用 transform 反向偏移回去（视觉上"没动"）
Play    过渡到 transform: 0（看起来平滑滑过去）
```

### 用法

```js
FLIP.flip(listEl, function () {
  listEl.removeChild(row);          // 任意 DOM 改动
});
```

```js
FLIP.remove(listEl, rowEl, function () {
  // 退场动画结束、元素已从 DOM 移除，此时再触发其余项的 FLIP 重排
});
```

🔴 **顺序很关键**：`FLIP.remove` 先让被删的行淡出**并留在原位**，
等它退场完毕再重排。直接先删再动画，其余项会瞬间跳过去，没有补间。

### 必须给每个项一个 `data-flip-id`

```html
<li class="list__item" data-flip-id="r42">…</li>
```

它是 FLIP 识别"这是同一个项"的**唯一依据**。缺了动画静默失效。

---

## 三个关键判断

### 1. hover 绝不能让内容跳动

```css
.list__item { border-left: 2px solid transparent; }   /* 预留位 */
.list__item:hover { border-left-color: var(--border-decor-str); }  /* 只改颜色 */
```

如果写成"hover 时才加 `border-left`"，内容会**横移 2px**——列表"在抖"。
**border 的宽度必须始终占位。**

### 2. Tab 不为每一行多停一次

```css
.list__item:focus-within { border-left-color: var(--accent); }
```

**不给整行加 `tabindex="0"`**。那样 20 行的列表，键盘用户要按 20 次 Tab 才能穿过。
行内按钮本身可聚焦就够了，用 `:focus-within` 给整行视觉反馈。

🔴 **配套要求**：行内操作用 `opacity: 0` 隐藏，**绝不能用 `display:none` /
`visibility:hidden`** —— 那会让"删除"按钮从 tab 顺序消失，键盘用户永远到不了。

### 3. 涨跌色用**红涨绿跌**

```css
.list__value--up   { color: var(--danger);  }  /* 涨 = 红 */
.list__value--down { color: var(--success); }  /* 跌 = 绿 */
```

🔴 与欧美惯例相反，是**刻意的**——本库面向中国 A 股用户，做反了会被当成数据出错。

---

## reduced-motion：跳过，不是缩短

```js
if (prefersReducedMotion()) { return; }   // 直接到最终态
```

**"省略"优于"缩短"**。位置直接跳到最终态，不是"用 1ms 过渡"。

CSS 里另外关掉 hover 等微交互过渡——那是**不同层次**，别漏。

---

## 窄屏：行内操作必须常显

```css
@media (max-width: 34rem) {
  .list__actions { width: 100%; opacity: 1; }
}
```

触屏**没有 hover**，操作会彻底消失。

---

## 反模式

- ❌ **hover 时加 border / 改 padding** —— 内容横移，列表在抖
- ❌ **整行加 `tabindex="0"`** —— Tab 为每行多停一次
- ❌ **行内操作用 `display:none`** —— 从 tab 顺序消失，键盘到不了
- ❌ **缺 `data-flip-id`** —— 动画静默失效，且**不报错**
- ❌ **先删元素再动画** —— 其余项瞬间跳位，没有补间
- ❌ **长文本直接换行** —— 行高跳变，破坏列表节奏。用 `ellipsis` + `title`
- ❌ **涨跌色按欧美习惯** —— 会被当成数据出错
- ❌ **窄屏仍隐藏行内操作** —— 触屏没有 hover
- ❌ **reduced-motion 下"缩短"动画** —— 应当完全跳过

---

## 门禁能查与查不到的

| 项 | 能否机械检查 |
|---|---|
| class 引用完整性 | ✅ `refs.py` |
| JS 语法 | ✅ `node --check`（**不启动浏览器，零负载**）|
| 动画是否真的顺 | ❌ **必须真机看** |
| hover 是否真的不抖 | ❌ **必须真机看** |
| `data-flip-id` 是否齐全 | ❌ 目前靠人工，`refs.py` 查不了 |

🔴 **诚实标注**：本 pattern 的核心价值（动画顺不顺、抖不抖）**静态检查查不出来**。
`demo.html` 的第一屏就是让你自己看的。
