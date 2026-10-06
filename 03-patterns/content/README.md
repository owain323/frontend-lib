# content —— 内容渲染样式

| 字段 | 内容 |
|---|---|
| **来源** | 依据 CommonMark 0.31.2 与 GFM 扩展，**不发明任何结构** |
| **实测** | 由 `05-audit/md-render.py` 渲染 `04-recipes/longform/content.md` 验证 |
| **适用** | 精简档 / B / C，纯 CSS |
| **依赖** | `01-tokens/tokens.css` |
| **规范** | `00-charter/06-内容渲染规范.md`（**先读那份再改这份**）|

---

## 一句话原则

> **结构用标准，样式用 token。**

元素和类名由 CommonMark / GFM 决定；颜色、字号、间距由 token 决定。
**两者之间不需要发明任何东西。**

所以 `content.css` 按**元素选择器**接管，**不给每个元素加类**：

```css
.prose > h2 { ... }
.prose > pre > code { ... }
.prose > table { ... }
```

结果：**从任何 CommonMark 兼容渲染器拿到的 HTML，不需要任何后处理就能正确显示。**

唯一的自定义类名是 `.prose`——它不改变语义，只是"这块是正文"的标记。

---

## 三层能力，不能混为一谈

| 层 | 表格 | 删除线 | 任务列表 |
|---|---|---|---|
| **CommonMark** | ❌ 不支持 | ❌ | ❌ |
| **GFM**（生态事实标准）| ✅ | ✅ | ✅ |
| 本库自定义 | 证据等级标记（`<sup class="evi">`）|

🔴 **纯 CommonMark 项目里表格会直接失效**（渲染成 `<p>`）。
要表格就必须用 GFM，这是硬依赖，不能假装有。

本库的 CSS **两层都支持**，用不用由渲染器决定——**样式不挑食**。

---

## 🔴 两个实测踩到的坑

### 1. 不同渲染器的输出**不完全一致**

| 语法 | GitHub/GFM | markdown-it 实测 |
|---|---|---|
| `~~删除线~~` | `<del>` | **`<s>`** |

两者都合法但语义不同（`<s>`=不再准确，`<del>`=已删除），
所以 CSS **必须同时支持**，否则换渲染器就掉样式。

> 这证明了一件事：**不存在"唯一正确的输出"，只有"规范允许的输出范围"。**
> CSS 要覆盖那个范围，而不是假设某一种。

### 2. `data:` URI 被渲染器拒绝 —— **不要"解决"它**

想把图片内联进单文件（精简档 硬要求），自然会想到 data URI。
但 markdown-it 的默认 `validateLink` 把 `data:` 列入黑名单（防 XSS），
于是 `![x](data:image/svg+xml;base64,...)` **原样输出成文本**。

🔴 **关掉 `validateLink` 就是降安全性**，正是本规范反对的"自己发挥"。

替代方案：图片用真实相对路径（`04-recipes/longform/agc-memory.svg` 就是例子），
或在构建阶段把图片转 base64 注入 HTML（渲染后处理，不在 Markdown 里写 data URI）。

---

## 怎么用

```bash
# Markdown → 自包含单文件 HTML（精简档）
python 05-audit/md-render.py 内容.md -o out.html --title "标题"

# 只跑检查，不输出
python 05-audit/md-render.py 内容.md --check
```

`md-render.py` 做三件事：
1. 用 markdown-it 渲染（commonmark preset + table + strikethrough）
2. 检查标题层级 / `img` alt / 表格语义
3. 内联 `tokens.css` + `content.css`，输出精简档 单文件

---

## 反模式

- ❌ **给每个元素加类**（`.prose h2`、`.prose p2`…）—— 渲染器输出没有这些类
- ❌ **`<div class="code-block">` 装代码** —— 用 `<pre><code class="language-x">`
- 🔴 **`<div class="table">` 模拟表格** —— **最严重**：辅助技术会当普通 div 念，
  屏幕阅读器用户拿不到行列关系。必须用 `<table>`
- ❌ **`<div class="heading">` 代替标题** —— 文档大纲全废，"跳到标题"失效
- ❌ **缩进代码块硬加 `class="language-"`** —— CommonMark 规定它没有 class
- ❌ **`<b>` / `<i>` 代替 `<strong>` / `<em>`** —— `<b>` 只是视觉加粗，无语义
- ❌ **hr 不清 `height` 和 `border-top`** —— 默认有 inset 边框，会出双线
- ❌ **不排除代码块内的 `<code>`** —— 代码块每行都会带上行内代码的边框和底色
