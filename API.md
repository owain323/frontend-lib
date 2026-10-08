# API 契约

本文件定义哪些是**公开接口**，哪些是内部实现。

> ⭐ 为什么要写这份文件
> 组件库一旦发布，`.btn`、`data-select-btn` 这些名字就**事实上是 API**了
> —— 用户会依赖它们。写清楚哪些可以依赖、哪些会变，才不会突然破坏别人的项目。

---

## 稳定程度约定

| 标记 | 含义 | 你的风险 |
|---|---|---|
| ✅ 稳定 | 小版本内不会改 | 可以放心用 |
| 🟡 谨慎 | 可能在**大版本**调整 | 用了要能承受改动 |
| ⛔ 内部 | **随时可能变**，无通知 | 别用 |

---

## 全局对象

行为脚本挂在 `window` 上。**它们不是同一种东西** —— 有四种接入形态，
各有各的调用方式。下表由`05-audit/global-api-probe.js`在真实浏览器里
探测生成，门禁 `api-doc` 会核对本文与实现是否一致。

### 四种接入形态

| 形态 | 调用方式 | 适合 |
|---|---|---|
| **create** | `X.create(root, options)` → 返回实例 | 需要拿到实例做后续控制 |
| **attach** | `X.attach(root, options)` → 返回实例 |同上，但语义上「挂到已有 DOM」 |
| **construct** | `new X(root, options)` | 老式类；**没有静态成员** |
| **direct** | 直接调用 `X.xxx(root, options)` | 一次性动作，无需持有实例 |

⚠️ 早期版本的本文档写「所有脚本遵循 `.create()`」——
实际 18 个全局里只有 5 个是create。**按 create 写其余的会直接报错。**

### 全部全局对象

| 全局名 | 状态 | 形态 | 成员 |
|---|---|---|---|
| `Select` | ✅ | create | `create` |
| `Combobox` | ✅ | create | `create` |
| `DateRange` | ✅ | create | `create` + 纯函数 `iso` `addDays` `addMonths` `quarterOf` `quarterRange` |
| `Tree` | ✅ | create | `create` |
| `Dropdown` | ✅ | create | `create` |
| `Pagination` | ✅ | create | `create` `update` `pagesOf` |
| `Accordion` | ✅ | **construct** | 实例方法在原型上：`toggle` `set` `bind` `init` … |
| `Tabs` | ✅ | **construct** | 实例方法在原型上：`select` `focusables` `enabled` `rove` `bind`（方向键游走已并入 roving 核） |
| `Tooltip` | ✅ | attach | `attach` |
| `Popover` | ✅ | attach | `attach` `closeAll` `current` |
| `Overlay` | ✅ | direct | `dialog` `toast` |
| `Drawer` | ✅ | direct | `open` |
| `Toc` | ✅ | direct | `init` |
| `Chart` | ✅ | direct | `draw` `update` `emit` `observe` |
| `Bar` | ✅ | direct | `draw` |
| `FLIP` | ✅ | direct | `flip` `remove`（过渡工具） |
| `ChartAdapter` | ✅ | create | `create` `refresh` `palette` `theme` `cssVar` `defaults` `seriesColors` |
| `ModelViewer` | ✅ | direct | `update` `refresh` |
| `Theme` | ✅ | direct | `get` `isDark` `set` `toggle` `cycle`（在 `01-tokens/theme-toggle.js`）|

```js
// create 形态
const select = window.Select.create(root, { label: '城市', options: [...] });
select.value = 'shanghai';

// construct 形态（注意是 new）
const acc = new window.Accordion(root, { duration: 240 });
acc.toggle(acc.itemOf(root.querySelector('.accordion__trigger')));

// direct 形态
window.Overlay.dialog({ title: '确认', actions: [...] });
```

### 关于主题

主题优先走**纯 CSS**：`data-theme` 属性 + `prefers-color-scheme`，
不需要任何 JS。若需要程序化控制，`01-tokens/theme-toggle.js` 提供
`window.Theme`（`get` / `isDark` / `set` / `toggle` / `cycle`）。
**该脚本需单独引入**，token 层本身不依赖它。


每个 `create` 返回一个实例对象，**方法签名见 `types/index.d.ts`**（类型与实现由 CI 保证一致）。

---

## 事件

组件除了构造时传入的**回调**，还会派发 **DOM 事件**。两者不是二选一：

|  | 回调 | 事件 |
|---|---|---|
| 订阅者数量 | 一个（构造时那一个） | 任意多个 |
| 谁来订阅 | 只能是你自己创建实例的那一处 | 任何拿到 DOM 的代码，包括**没创建它**的代码 |
| 能不能委托 | 不能 | 能（事件冒泡，可在祖先上统一收） |

### 统一约定（五个核都一样的五条）

| 约定 | 值 | 为什么 |
|---|---|---|
| 事件名 | 一律 `fl-` 前缀 | 组件内部有原生 `<input>` / `<button>`，它们的 `change` / `click` 会**冒泡上来**；不加前缀 ⇒ 你会收到自己没订阅过的东西 |
| 冒泡 | `bubbles: true` | 可以在祖先上做事件委托 |
| 可撤销 | `cancelable: false` | 本库的事件是**通知**，不是"可撤销的动作"。要拦就在回调里 `return false` |
| 派发位置 | **组件根元素** | ⇒ `e.target` 就是组件根 |
| 携带数据 | `e.detail.value` | 有值的组件都在 `value` 上；组件自己的字段另加 |

⚠️ **委托时必须认 `e.target`**：事件会冒泡，嵌套组件（例如 tabs 里放
   select）会在**同一个祖先**上给你两个 `fl-change`。事件名**不能**代替身份。

### 事件一览

| 组件 | 事件 | `e.detail` | 何时派发 |
|---|---|---|---|
| `Select` | `fl-change` | `{ value, text }` | 选中并关闭后 |
| `Select` | `fl-open` / `fl-close` | — | 展开 / 收起 |
| `Combobox` | `fl-change` | `{ value }`（字符串数组） | 标签增删 |
| `DateRange` | `fl-change` | `{ value: { from, to }, valid }` | 区间变化（**含校验失败**） |
| `Accordion` | `fl-change` | `{ value, open, item }` | 展开或收起 |
| `Tabs` | `fl-change` | `{ value, tab }` | 切换标签 |
| `Tree` | `fl-select` | `{ value, item }` | 选中节点 |
| `Dropdown` | `fl-select` | `{ value, item }` | 选中菜单项 |
| `Dropdown` | `fl-open` / `fl-close` | — | 展开 / 收起 |
| `Pagination` | `fl-change` | `{ value, page }` | 翻页 |
| `Popover` | `fl-open` / `fl-close` | — | 展开 / 收起 |
| `Drawer` | `fl-close` | — | 关闭**动画开始前**（晚一点它已不在 DOM 上） |

```js
// 直接订阅
root.addEventListener('fl-change', function (e) {
  console.log(e.detail.value);
});

// 在祖先上委托（认 e.target，不认事件名）
document.body.addEventListener('fl-change', function (e) {
  if (e.target.matches('[data-select]')) { /* … */ }
});
```

🔴 `Accordion` 的 `value` 是**按钮 id**（组件自己生成、实例内唯一）——
   手风琴没有 `data-value` 属性，别去找它。

---

## DOM 契约

组件通过 `data-*` 暴露结构与状态。**这些是公开的**：

| 属性 | 状态 | 含义 |
|---|---|---|
| `data-state` | ✅ | **状态表达的唯一公开方式**。取值见下表。样式与测试都读它 |
| `data-state` 的取值 | ✅ | `open` / `closed` / `active` / `disabled` / `leaving` / `success` / `valid` / `shown` |
| `data-dirty` | ✅ | 字段"已被校验过"（与 `data-state` **正交**：可同时 dirty 且 invalid） |
| `data-scroll-locked` | 🟡 | `<body>` 上：浮层打开期间锁滚动（读它，不要自己加） |
| `data-value` | 🟡 | 当前值 |
| `data-place` | 🟡 | 浮层位置 |
| `data-open` | 🟡 | 展开状态（旧写法，新代码用 `data-state`）|
| `data-validate` | 🟡 | 表单校验相关标记 |

🔴 **`is-*` 状态类名已移除（0.4.0 起）**

过去 CSS 里同时写着 `.tooltip.is-open, .tooltip[data-state="open"]` 两套，
但 JS 只加前者 ⇒ **文档让你用 `data-state`，实际它从来没被设过**。
这是"承诺了一个不工作的 API"，比不做更糟。

0.4.0 起统一为 `data-state`，`.is-*` 选择器全部删除。迁移是逐字替换：

| 旧 | 新 |
|---|---|
| `.tooltip.is-open` | `.tooltip[data-state="open"]` |
| `.combo__opt.is-active` | `.combo__opt[data-state="active"]` |
| `.combo__field.is-disabled` | `.combo__field[data-state="disabled"]` |
| `.drawer.is-leaving` / `.toast.is-leaving` | `[data-state="leaving"]` |
| `body.is-locked` | `body[data-scroll-locked]` |
| `.btn.is-success` | `.btn[data-state="success"]` |
| `.field__input.is-valid` | `.field__input[data-state="valid"]` |
| `.state--delayed.is-shown` | `.state--delayed[data-state="shown"]` |
| `.field.is-dirty` | `.field[data-dirty]` |

⛔ **内部实现（别依赖）**：
- 以 `_` 或 `js-` 开头的类名与属性
- 未列出的 `data-*`
- DOM 层级与子元素顺序（除非本文件明确写了）

### 状态表达为什么要统一

同一件事**只该有一种表达方式**。如果 `open` 同时用
`data-open` / `data-state` / `[aria-expanded]` 三处表示，
改一处就会漏另一处 —— 第三方扩展成本极高。

| 谁读 | 读什么 |
|---|---|
| CSS | `[data-state="open"]` |
| 行为脚本 | 读写 `data-state` |
| 自动化检查 | 断言 `data-state` |

`aria-*` 是**语义**，与样式状态正交，两者都要保留。

---

## CSS 类名

| 类名 | 状态 | 说明 |
|---|---|---|
| `.btn` `.btn--primary` `.btn--sm` `.btn--md` | ✅ | 按钮 |
| `.badge` `.card` `.list` `.input` | 🟡 | 基础类名 |
| `<块名>__<元素>`（如 `.btn__label`）| ✅ | BEM 元素 |
| `<块名>--<变体>`（如 `.btn--primary`）| ✅ | BEM 变体 |
| `<块名>--<状态>`（如 `.btn--primary`）| ✅ | BEM 变体（**静态**外观差异） |
| 「当前处于哪个状态」 | ✅ | 一律写 **属性** `[data-state="…"]`，**不写状态类名** |

⚠️ 区分两者：变体是"它长什么样"（静态，类名）；状态是"它现在怎么样"（会变，属性）。
   状态写成类名的代价见 `docs/INVARIANT.md` I-8：类没了 CSS 规则还在 ⇒ 静默错乱、无报错。

### ⚠️ 命名空间冲突

短类名（`.btn` / `.card` / `.list`）**可能与宿主已有样式撞名**。

**规避方式一 · 加前缀**（推荐，库自带工具）

```bash
# 预览会被改写哪些类
python3 05-audit/prefix-build.py --check

# 生成带前缀的副本（源码不动，产物在 prefixed/）
python3 05-audit/prefix-build.py --prefix fl
```

`.btn` → `.fl-btn`，BEM 元素与变体**自动跟随**
（`.btn--primary` → `.fl-btn--primary`）。

**规避方式二 · 调整加载顺序**
把本库样式放在宿主样式**之后**加载。

**规避方式三 · 让宿主改自己的类名**（最稳，但需要改动宿主）

⚠️ `prefix-build.py` 的限制（诚实说明）：它是**文本级**替换，
对写在 JS 字符串里的类名无效。真正稳妥的做法是 CSS Modules 或 shadow DOM。

---

## 令牌

所有可覆盖项都是 CSS 变量。覆盖 `:root` 或容器即可。

| 令牌 | 状态 | 用途 |
|---|---|---|
| `--accent` | ✅ | 主色 |
| `--paper` / `--surface` / `--surface-raised` | ✅ | 背景层级 |
| `--text-primary` / `-secondary` | ✅ | 文字 |
| `--sp-1` … `--sp-7` | ✅ | 间距 |
| `--r-xs` / `-sm` / `-md` / `-lg` | ✅ | 圆角 |
| `--fs-xs` … `--fs-2xl` | ✅ | 字号 |
| `--border-decor` | ✅ | 分隔线 |
| `--shadow-1` / `--shadow-2` | ✅ | 阴影 |
| `--dur` / `--ease-out` | ✅ | 动效 |

新增令牌算**小版本变更**；移除或改默认值算**破坏性变更**。

---

## 无障碍保证

每个组件都保证：

- 可通过键盘操作完整流程（Tab / 方向键 / Esc / Enter / Space）
- 焦点环跟随系统设置，浅色深色下均可见
- 读屏能读到组件名与当前状态
- 尊重 `prefers-reduced-motion`
- 文本对比度满足 WCAG AA

> ⚠️ 这由**自动化检查**保证（键盘路径 + axe + 对比度实测）。
> 读屏软件的真机播报尚未逐项人工验证。

---

## 破坏性变更怎么走

- 只在**大版本**移除或重命名公开类名、`data-*`、方法
- 弃用项先加警告并保留一个完整版本周期
- 变更记录写在 `CHANGELOG.md`
