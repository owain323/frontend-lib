# button

| 字段 | 内容 |
|---|---|
| **来源** | 原创（依据 WCAG 2.1 + 实测诊断） |
| **实测** | 对比度见下，全部由 `05-audit/contrast.py` 得出；44px 依据 WCAG 2.5.5 |
| **适用** | 精简档 / B / C，纯 CSS，可整段复制 |
| **依赖** | `01-tokens/tokens.css`  + `01-tokens/typography.css`（`.note` 提示框）|

---

## 七态清单（按钮取的是这七个，不是九个）

| # | 状态 | 实现 | 不做会怎样 |
|---|---|---|---|
| 1 | default | `.btn--primary` | — |
| 2 | hover | `:hover` + `--accent-hover` | 用户不知道能点 |
| 3 | active | `:active` 下沉 1px | 点了没反馈 |
| 4 | **focus-visible** | `:focus-visible` 2px outline | **键盘用户彻底迷失** |
| 5 | **disabled** | `:disabled` 明确色值（不用 opacity） | **点了没反应，以为坏了** |
| 6 | **loading** | `[aria-busy]` + `pointer-events:none` | **重复提交** |
| 7 | success | `.is-success`（约 1.2s） | 不知道成没成 |

🔴 实测动机：某项目 的按钮**只有 default + hover 两态**，`:disabled` 0 处。
用户不会抱怨"你缺 disabled 态"，只会觉得"这个按钮点了没反应，是不是坏了"。

---

## 用法

```html
<button class="btn btn--md btn--primary">提交</button>

<!-- loading：宽度不变，防重复点击 -->
<button class="btn btn--md btn--primary" aria-busy="true">
  <span class="btn__label">提交</span>
  <span class="btn__spinner"></span>
</button>

<!-- 图标按钮必须带 aria-label -->
<button class="btn btn--icon btn--ghost" aria-label="关闭">
  <svg ...></svg>
</button>
```

变体：`primary` / `secondary` / `ghost` / `danger`
尺寸：`sm`(32) / `md`(44) / `lg`(52)

---

## 🔴 最关键的一个判断：`disabled` 还是 `aria-disabled`

这两个不是同义词，选错会直接伤到键盘用户。

| | `disabled` 属性 | `aria-disabled="true"` |
|---|---|---|
| Tab 能聚焦 | ❌ 不能，从 tab 顺序移除 | ✅ 能 |
| 屏幕阅读器 | 直接跳过，用户不知道有这个按钮 | 读到"不可用" |
| 适用 | **永久**不可用（权限不足、功能下线） | **暂时**不可用（表单没填完） |

**表单提交按钮应该用 `aria-disabled`**。理由：用户 Tab 到它，才知道"哦，还差点什么"；
用 `disabled` 的话他永远找不到这个按钮，也不知道为什么提交不了。

两个都不要的情况：**别用视觉上的"灰掉"来假装禁用**。灰了但还能点，是欺骗。

---

## 反例 —— 什么时候不该用

- ❌ **一个视图里出现两个 `primary`** —— 有两个就等于没有重点。其余全降为 secondary/ghost。
- ❌ **`danger` 做成和 `primary` 一样大** —— 破坏性动作不该被引导去点。
- ❌ **普通操作加 `success` 态** —— 只有不可逆动作（提交、支付）需要确认反馈，其余是噪音。
- ❌ **桌面端用 `btn--block`** —— 全宽按钮把视觉动线压成一条竖线。它是移动端方案。
- ❌ **`ghost` 用在主路径上** —— ghost 的语义是"我不建议你点这个"，不是"这个比较淡"。

---

## 两个容易被跳过的细节

**1. loading 时宽度不能变**

常见做法是把文字换成 spinner，结果按钮缩窄 → 整行布局跳动。
解法：文字 `visibility: hidden` 保留占位，spinner 绝对定位居中。

**2. spinner 要豁免 `prefers-reduced-motion`**

全局兜底会把动画压到 0.01ms，spinner 就停了 —— 用户会以为页面卡死。
WCAG 的 reduced-motion 针对**大幅位移**（前庭功能障碍），
小幅度原地旋转不属于此类。**放慢但保留，不要停。**

这是"照抄规范"和"理解规范"的区别。

---

## 已记录的废弃写法

详见 `button.css` 末尾。要点：
`filter: brightness()` 当 hover / `transition: all` / `opacity` 当 disabled /
loading 换文字 / hover 用 `scale()`。
