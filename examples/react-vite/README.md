# 接入样板：React + Vite

> · **这是 T-01 的交付物**：证明这个库能被真实项目用上，
> 同时把"接入会踩什么坑"写在前面（不是写完就算）。

---

## 一、能直接做什么

**本库零依赖、零构建**，所以在 Vite 里**不需要任何额外配置**：

```js
// main.js / main.tsx
import '../01-tokens/tokens.css'     // 令牌（含暗色模式）
import '../01-tokens/typography.css'  // 排版
import '../02-primitives/button/button.css'
import '../02-primitives/input/input.css'
```

**就这样。没有 `vite.config` 的 alias，没有 `package.json` 依赖，没有插件。**

### 如果不想跨盘引

把需要的 CSS 拷进项目（这就是"零构建"的含义）：

```bash
cp 01-tokens/tokens.css     <你的项目>/src/styles/
cp 01-tokens/typography.css  <你的项目>/src/styles/
cp 02-primitives/button/button.css <你的项目>/src/styles/
```

---

## 二、🔴 接入前必须知道的坑（实测数据，不是猜测）

我用**真实项目**（演示项目名 的 `tokens.css`）试过对齐，结果：

### 坑 1：同名令牌值不同 —— 直接引会静默破坏对方的体系

12 个同名令牌里 **8 个值不同**：

| 令牌 | 演示项目名 | 本库 | 后果 |
|---|---|---|---|
| `--accent` | `#185fa5` | `#1b4d8f` | 强调色变深 |
| `--danger` | `#a32d2d` | `#c0392b` | 危险色偏亮 |
| `--accent-soft` | `#e6f1fb` | `#e6eef7` | 淡底微偏 |
| `--sp-4` | `16px` | `clamp(1rem, …, 1.25rem)` | ⚠️ **从固定变流体** |
| `--sp-6` | `24px` | `clamp(1.5rem, …, 2.25rem)` | ⚠️ 同上 |
| `--sp-8` | `32px` | `clamp(2.5rem, …, 4.5rem)` | ⚠️ 同上 |
| `--mono` | 4 个字体 | 8 个（含中文回退）| 变化不大但不同 |
| `--sans` | 4 个 | 11 个（含阿/希）| 同上 |

**`--sp-*` 那三条最危险**：演示项目名 是**固定像素**的紧凑金融终端布局，
本库是**流体**的。**同名会让 CSS 静默用错值** —— 不报错，只是间距全变。

### ⇒ 三种接入方式，按风险从低到高

| 方式 | 做法 | 风险 | 适合 |
|---|---|---|---|
| **① 只取组件，不取令牌**（推荐）| 引入 `button.css` / `input.css`，**不引 tokens.css**；组件里 `var(--accent)` 全部在对方项目里已定义或补上别名 | 低 | 已有设计体系、只想补组件 |
| **② 令牌别名** | 在项目里写一层别名，把对方的令牌名指向本库的值 | 中 | 想统一令牌 |
| **③ 全量替换** | 直接引 `tokens.css` 覆盖对方 | **高** | 决定完全换体系 |

**方式 ① 的代价**：组件用到的 25–32 个令牌得在项目里定义（可以只补缺的那几个）。
**方式 ③ 的代价**：整个视觉风格变。

---

## 三、这个库能立刻解决的一个真实问题

演示项目名 的 focus ring：

```css
input:focus { outline: 2px solid var(--accent-soft); }   /* #e6f1fb */
```

**实测对比度 = 1.15 : 1**（压在白色 `--surface` 上）。
**WCAG 2.2 的焦点外观（2.4.11，AA 级）要求 ≥ 3 : 1** ⇒ **差 2.6 倍**。
键盘用户基本看不出焦点在哪。

本库的写法：

```css
:focus-visible {
  outline: 2px solid var(--accent);      /* 不用 soft —— soft 是"底色"不是"线条" */
  outline-offset: 2px;
}
```

**这类问题正是本库的价值**：不是"再写一套样式"，
而是**"该用哪个色、对比度够不够、什么条件下用 `:focus-visible`"这些判断**。

---

## 四、React 里怎么用（不需要组件封装）

```jsx
export function SaveButton({ onSave, busy }) {
  return (
    <button
      className={`btn btn--primary ${busy ? 'is-loading' : ''}`}
      aria-busy={busy}
      onClick={onSave}
    >
      {busy ? '保存中…' : '保存'}
    </button>
  );
}
```

**注意**：本库给的是 **CSS 类**，不是 React 组件。
**这是有意的** —— CSS 类跨框架通用，React 组件会绑死框架。

---

## 五、验证接入是否成功

```bash
# 1. 样式有没有真的进来
curl -s http://localhost:5173 | grep -c 'btn--primary'   # 或直接看 DevTools

# 2. 无障碍有没有过（推荐 axe）
#    打开 DevTools → 装 axe DevTools → 跑一遍
```

**如果焦点环看不见 / 对比度不够，那说明项目覆盖了本库的 `:focus-visible`** ——
查一下自己的 CSS 里有没有 `outline: none`。
