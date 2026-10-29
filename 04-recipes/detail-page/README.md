# detail-page · 实体详情页骨架

同一张图纸装三种数据状态：**字段齐全 / 部分缺失 / 一条数据都没有**。
三个变体的 DOM 结构**完全一致**，差异只在文案、数值、说明块。

## 为什么需要它

产品里"同一类对象、字段多少不一"是常态：有的字段齐全，有的只接了一半，
有的还没接。常见做法是每遇到一种情况就改一版结构 —— 结果是同一类页面越改越不像，
最后没人能说清"这页到底应该长什么样"。

这张配方把结构钉死，把差异收进三个变量层：

| 允许变的 | 不许变的 |
|---|---|
| 文案 / 数值 / 说明块写什么 | DOM 结构（节点数量与嵌套） |
| 色对（换肤挂在 `section` 上） | 组件层级与语义标签 |
| 媒体策略（缺图时的占位方式） | 类名 |

## 三个变体

| 文件 | 状态 | 关键点 |
|---|---|---|
| `full.html` | 字段齐全 | 说明块承担"数据完整度"的告知 |
| `partial.html` | 部分缺失 | 缺的那项写「未披露」+ 弱化色，**不是 0，也不是删节点** |
| `null.html` | 无数据 | 不隐藏、不冒充零、必须写清原因 |
| `demo.html` | 入口页 | 三者的索引 + 规则摘要 |

## 用法

```html
<link rel="stylesheet" href="agentcss/recipes/detail-page/detail-page.css">

<section class="detail-page">
  <div class="detail-hero">
    <div class="detail-hero__deco" aria-hidden="true"></div>
    <div class="detail-hero__body">
      <p class="detail-hero__eyebrow">分类 · 编号</p>
      <h1 class="detail-hero__title">对象名</h1>
      <p class="detail-hero__meta"><span>属性一</span><span>属性二</span></p>
    </div>
  </div>

  <div class="detail-kpis">
    <div class="detail-kpi">
      <span class="detail-kpi__label">指标名</span>
      <span class="num detail-kpi__value">128</span>
      <span class="num detail-kpi__delta">较上月 +6%</span>
    </div>
  </div>

  <div class="detail-null">
    <p class="detail-null__title">数据完整度：3 / 3</p>
    <p class="detail-null__reason">三项指标均已接入，更新至 2026-10-22。</p>
  </div>
</section>
```

数值一律带 `num` 类（来自 `01-tokens/typography.css`）——本库只有一套等宽数字规则，
组件不许自己写 `font-variant-numeric`（`numeric-gate` 会查）。

## 三条结构规则

1. **装饰层与内容层是平级兄弟**，不是父子。
   装饰层必须 `pointer-events: none` 且不含内容 —— 否则它会吃掉点击、挤走内容。
2. **皮肤挂在 `section`（`.detail-page`）上，不挂 `body`**。
   同一页不同区块可以各自换肤，这是"每块长得不一样但共用一套 CSS"的结构前提。
3. **DOM 不许变**。字段缺失是"值缺失"，不是"节点缺失"。

## 无数据态的三条硬规则

| 规则 | 为什么 |
|---|---|
| 不隐藏 | 整块消失会让读者以为"这页没有这项"，而不是"这项没有数据" |
| 不用 0 冒充 | 0 是"确实是零"，缺失是"没有数据"，语义相反，会直接导致错误结论 |
| 必须给理由 | 读者要知道"为什么看不到"；只留白等于让人猜 |

## 校验收口

```bash
python 04-recipes/detail-page/verify-skeleton.py    # 三变体同构 + 都进视觉基线
python 05-audit/no-data-gate.py                     # 无数据态三条规则
```

`verify-skeleton.py` 是转发入口，实现在 `05-audit/detail-page-contract.py` ——
**同一份代码**，避免门禁与配方各写一套然后慢慢漂移。

## 边界

- **不含业务字段**：示例用中性的"对象 / 指标"，不写营收、净利这类字段。
  一旦把某个业务的字段写进通用库，库的边界就没了。
- **不做图表**：指标卡只放数字。要图请用 `09-assets/` 的图表组件。
- **不做标签页 / 折叠**：那是 `03-patterns/` 的组件，这里只给骨架。

## 反例

- ❌ **缺的字段写成 `0`** —— `0` 是一个真实的值，用户会拿它去算同比。缺就是缺：
  写「未披露」+ 弱化色
- ❌ **缺的字段直接把节点删掉** —— 三个变体的 DOM 结构必须完全一致（节点数量与嵌套），
  删节点会让同一类页面越改越不像，最后没人能说清"这页该长什么样"
- ❌ **无数据时隐藏整块** —— 不隐藏、不冒充零，**必须写清原因**。
  空白让人以为是加载失败，反而会去刷新
- ❌ **三个变体各写一套类名** —— 允许变的是文案、数值、说明块；类名与语义标签不许变
- ❌ **换肤时改类名** —— 色对挂在 `section` 上，改类名等于换了一套结构，之后没法对比

---
