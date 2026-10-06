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
| `Tabs` | ✅ | **construct** | 实例方法在原型上：`select` `focusables` `rove` `step` `edge` |
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

## DOM 契约

组件通过 `data-*` 暴露结构与状态。**这些是公开的**：

| 属性 | 状态 | 含义 |
|---|---|---|
| `data-state` | ✅ | **状态表达的唯一公开方式**。取值见下表。样式与测试都读它 |
| `data-state` 的取值 | ✅ | `open` / `closed` / `active` / `inactive` / `checked` / `unchecked` / `disabled` / `loading` / `selected` |
| `data-value` | 🟡 | 当前值 |
| `data-place` | 🟡 | 浮层位置 |
| `is-open` / `is-active` / `is-disabled` / `is-leaving` / `is-locked` | ⛔ | **内部实现**，请改用 `data-state`。随时可能变 |
| `data-open` | 🟡 | 展开状态（旧写法，新代码用 `data-state`）|
| `data-validate` | 🟡 | 表单校验相关标记 |

⛔ **内部实现（别依赖）**：
- 以 `_` 或 `js-` 开头的类名与属性
- `is-*` 状态类名（请用 `data-state`）
- 未列出的 `data-*`
- DOM 层级与子元素顺序（除非本文件明确写了）

### 状态表达为什么要统一

同一件事**只该有一种表达方式**。如果 `open` 同时用
`data-open` / `.is-open` / `[aria-expanded]` 三处表示，
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
| `<块名>--<状态>`（如 `.is-disabled`）| ⛔ | 状态类名属**内部**。新代码请写 `[data-state="disabled"]` |

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
