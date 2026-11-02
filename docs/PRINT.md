# 打印与 PDF

> 这份文件回答两件事：**打印时库自动做了什么**、**哪些还需要你自己做**。
> 所有规则都在 `01-tokens/tokens.css` 的 `@media print` 块里，屏幕渲染零影响。

---

## 一、能做什么

把页面交给浏览器打印（`Ctrl/Cmd + P` → 另存为 PDF），或交给无头浏览器
`page.pdf({ format: 'A4', preferCSSPageSize: true })`，你会得到：

| 行为 | 说明 |
|---|---|
| **强制浅色** | 屏幕上是暗色主题，纸上照样是深字白纸（`color-scheme: light`） |
| **浮层不上纸** | toast / tooltip / popover / skeleton 自动隐藏 |
| **纯导航不上纸** | tabs 标签栏、nav 链接、分页器、汉堡按钮、accordion 箭头 |
| **表格不散架** | 取消滚动容器（否则只打印可视区那几行）；表头每页重复（HTML 默认行为，本库未覆盖） |
| **不跨页切断** | 表格行、图片、图表、卡片、指标卡整体换页，不从中间切开 |
| **折叠内容自动展开** | `tabs` 未选中的面板、`accordion` 收起的面板，打印时全部展开。**不展开 = 静默截断**：页数正常、对比度合格、内容少一半，只靠数 runs 抓不到 |
| **孤行寡行（仅 report 配方）** | `.rep` 内的段落首尾不留单行在另一页。**不全局生效** —— 裸 `p` / `li` 会改掉宿主页面所有段落，那是 `bleed-gate` 的红线 |
| **字体全嵌入** | 实测 87 个字体名、0 个引用链问题；不依赖阅读方装字体 |
| **对比度** | 每一段文字对白纸 ≥ 4.5:1（实测最差 5.44:1） |

这些不是"看起来对"，是 `05-audit/print-gate.js` 读**真实 PDF 产物**判出来的。

> 早期笔记写过「`page.emulateMediaType('print')` 在本环境并不切换媒体类型」——
> 2026-11-02 复测**这条不成立**：`emulateMediaType('print')` 之后
> `matchMedia('print').matches === true`，computed `display` 也随之变化。
> 所以现在可以在浏览器里直接审「打印态会显示什么」（见 `print-content-audit.js --print`）。
> 门禁本身仍然读真实 PDF —— 那是最终产物，比任何模拟都可靠。

### 折叠内容为什么要三条规则

`.accordion__panel[hidden]` 同时被三样东西挡住，少一条就是"看起来展开了、一个字不印"：

```css
.accordion .accordion__panel[hidden] {
  display: grid !important;   /* ① 组件自己写了 display:none !important */
  grid-template-rows: 1fr;    /* ② 收起态是 0fr，不改就还是 0 高 */
  visibility: visible;        /* ③ 组件还写了 visibility:hidden */
}
```

三条缺任一条的实测后果：`display` 与高度都对了，但内容仍是 `visibility:hidden`，
PDF 里一个字都不多。`tabs` 只需要第 ① 条（它没有 `!important`、没有 visibility、也不靠 grid 定高）。

还有一条**特异性**的坑：`tokens.css` 在 `<head>` 里最先加载，
不加组件根前缀（`.tabs` / `.accordion`）时同特异性的规则会被组件 CSS 覆盖 ——
实测：不加前缀时 PDF 与改动前**逐字节相同**，规则完全没生效。

---

## 二、三个工具类

### `.no-print` —— 这个元素不上纸

```html
<div class="report-actions no-print">
  <button class="btn">导出 Excel</button>
  <button class="btn">分享</button>
</div>
```

页面上照常显示，打印时整块消失。全库唯一的 `!important` 用在这里 ——
不加就永远可能被使用者自己写的 `display` 盖掉，等于没提供这个能力。

### `.print-only` —— 只在纸上出现

```html
<div class="print-only">内部资料 · 请勿外传</div>
```

屏幕上 `display: none`，打印时显示。用于打印版专用标题、页眉、落款、水印文字。
**放在块级元素上**（`div` / `p` / `h2`）；行内场景请自己写 `display`。

---

## 三、为什么不自动隐藏按钮

`.btn` 和 `.upload` **刻意不在隐藏清单里**。这是实测后改的主意：

- `guide/button.html` 是**按钮组件文档页**，也是打印门禁的采样页。
  把 `.btn` 全局隐藏，打印"按钮组件文档"就只剩标题 —— 组件展示页里的按钮是**内容**。
- `.upload` 是**带状态的表单控件**（已上传哪个文件），和 `.input` 同类，不是纯操作。

⇒ 业务页要排除操作区，给那个容器加 `.no-print`（见上）。
这条边界是"宁可少藏，不可多藏"。

### 模态（`.dialog`）：遮罩不隐藏，拉回正常流

屏幕上开着 dialog 时打印，`.dialog-backdrop` 的 computed 是
`position: fixed; inset: 0; background: rgba(21,24,28,.4)` —— 直接印，
**整页是 40% 黑**。实测（2026-11-02，`print-policy-gate` 的标本页）：

| 做法 | 结果 |
|---|---|
| 隐藏遮罩 `display: none` | 纸面干净了，但 `.dialog` 是它的子节点 ⇒ **弹窗里的字一起消失**，不报错 |
| **拉回正常流**（本库的选择） | 没有 fixed 遮罩、没有 `100vh` 限高，内容完整，接在文档末尾 |

```css
@media print {
  .dialog-backdrop { position: static; inset: auto; display: block;
                     padding: 0; background: none; }
  .dialog { max-height: none; overflow: visible; }
}
```

顺带量过一个相关项：dialog 打开时 `overlay.js` 会给 `body` 加
`data-scroll-locked`（`overflow: hidden`）。**它不会裁掉纸面** ——
body 高度是 auto，实测打印态 `scrollHeight === clientHeight`（2372 = 2372），
页数与不打开 dialog 时相同（都是 2 页）。所以不需要为它加打印规则。

🔴 这条规则写在 `03-patterns/overlay/overlay.css`，**不能**写进 `tokens.css`：
tokens 先加载，同特异性的 `position: static` 会被这里的 `position: fixed`
盖掉 —— 规则写了、不生效、不报错，与下面 §「折叠内容为什么要三条规则」
里那条特异性坑是同一个病。这次是写完当场被门禁 L3 抓到的。

### 自动隐藏清单（逐条理由）

| 选择器 | 为什么 |
|---|---|
| `.toast` `.tooltip` `.popover` | 只在屏幕交互中存在，纸上没有对应物 |
| `.skeleton` | 加载占位符，纸上永远是"未加载完"的假象 |
| `.tabs__list` | **只藏标签栏，不藏 `.tabs__panel`**（后者是内容） |
| `.nav__list` `.nav__toggle` | **只藏链接与汉堡，不藏 `.nav__brand`**（后者可能是页面标题） |
| `.pagination` | 纯导航 |
| `.accordion__marker` | **只藏箭头，不藏标题** |

**不用裸 `button` 标签选择器**：`.accordion__trigger` 就是个 `<button>`，
标题文字装在它里面 —— 按标签选会连正文一起干掉。

---

## 四、分页控制

```css
tr, img, figure, svg, .card, .metric, .sparkline, .splot { break-inside: avoid; }
```

**代价（实测）**：高于半页的卡片会被整体推到下一页，`guide/button.html` 因此
从 7 页变成 8 页（内容 run 数不变，仍是 1975）。宁可多一页，不要在纸中间切一半。

高于**一整页**的元素，Chrome 会忽略 `avoid` 并强制切断 —— 这是规范行为，不是缺陷。
**而且它不会报错**：规则写了、看起来生效了、页数一点没变。

### 代价到底多大：标定表

用等高块实测（`node 05-audit/print-pagination-cost.js`，可复跑）：

| 块高 | 占页 | avoid 页数 | auto 页数 | 通胀 |
|---|---|---|---|---|
| 240 px | 0.24 | 23 | 22 | +5% |
| 330 px | 0.33 | 24 | 24 | 0% |
| 420 px | 0.42 | 30 | 26 | +15% |
| **520 px** | **0.53** | **50** | **26** | **+92%** |
| 700 px | 0.71 | 30 | 21 | +43% |

**最坏点不在最高处，在页高一半附近。** 机制：532px 的块、页内可用高约 990px
⇒ 每页只塞得下 1 个 ⇒ 每页浪费 46%。432px 的块 ⇒ 每页 2 个，浪费 12%。

读法：

- 占页 ≤ 0.35 → `avoid` 几乎免费
- 占页 0.42 左右 → 一成半的代价
- **占页 0.5 上下 → 可能翻倍**，这是断崖
- 占页 0.7 → 四成多（每页 1 块，浪费固定）

### 不想要这个代价：`.print-allow-break`

```html
<figure class="card print-allow-break">   <!-- 这张图很大，切一刀我能接受 -->
```

它把 `break-inside` 改回 `auto`。实测（h=520 的 50 个块）：

```
默认（avoid）        50 页
.print-allow-break   26 页      ← 省 48%，与强制 auto 完全相同
```

**默认仍然是「不切断」**：一份被切开的图往往比多一页更难读。这个类是给
"我知道它在 500px 左右、我宁可他切开"的场景用的。

### 长文档夹具的两条结论

`05-audit/fixtures/print-long/`（8 章 / 960 行表格 / 24 个卡片 / **56 页**）跑出来的：

1. **表格套在 `figure` 里且超过一页时，`avoid` 被忽略** —— `avoid` 与 `auto`
   页数**完全相同**（85 页时的实测）。这不是 bug，是规范；但意味着
   "给 `figure` 加 avoid 就安全" 是错觉。
2. **混排文档里，卡片填进表格留下的空隙，不产生额外代价** —— 所以
   "长文档一定通胀" 也是错的。代价来自**块高与页高的比例**，不来自文档长度。

⇒ 判据应该是「块高 / 页高」，不是「文档页数」。

### 孤行寡行为什么不全局

```css
/* 04-recipes/report/report.css */
.rep p, .rep li, .rep blockquote { orphans: 2; widows: 2; }
```

只写在 `.rep` 容器内。裸 `p, li, blockquote` 会改掉宿主页面**所有**段落 ——
`bleed-gate` 把这条列为硬红线（"组件只影响自己"）。
你自己的文档容器需要这一条，抄上面三行、把 `.rep` 换成你的容器类名即可。

### 为什么没写 `thead { display: table-header-group }`

那是 `thead` 的 HTML **默认值**，Chrome 默认就让表头每页重复，而本库没有任何规则
覆盖它（已 grep 确认）。写一条与默认值相同的声明，只会让下一个人以为
"表头重复是我们加的"。

---

## 五、不覆盖什么（这一段比上面都重要）

| 缺口 | 现状 |
|---|---|
| **裁切检测** | **没有**。Chrome 把内容画在 2250×3275 的矩形里再用 `re W n` 裁到纸面，`bbox` 判不出"看得见的部分有没有被切"。要判得算字形宽度或栅格化比纸色，两者都不在本库 |
| **页码 / 页眉 / 页脚** | **没有**。CSS 的 `@page` 只能定尺寸与页边，给不了内容；要页码得用浏览器打印对话框的选项，或自己接 `page.pdf({ headerTemplate })` |
| **目录 / 书签** | **没有**。那是 PDF 生成器（或 PDF 库）的事，不是 CSS |
| **空白页检测** | 只有间接判据（页数 + run 数），不是直接检测 |
| **字体回退** | 检测不到。缺字体时 Chromium 会嵌一个回退字体，产物照样"有字" |

⇒ 一句话：**库保证的是"页面能干净地打出来"，不是"能出版"**。
页码、目录、书签这类出版级需求，要在调用 `page.pdf()` 那一层解决。

---

## 六、怎么自己验

```bash
# 打印判据（需要静态服务在 8000）
node 05-audit/print-gate.js

# 判定单个已有 PDF 的字体链与文本算子
node 05-audit/print-gate.js --pdf 某文件.pdf
```

判据共 12 条：对比度、暗色一致性、页数、文字 run 数、横向溢出、结构类型覆盖、
字体引用链闭合、每页文本算子存在性。9 个采样页 × 2 种屏幕配色 = 18 份 PDF。

**屏幕不受影响**由另一道守着：`shot-baseline.py --check` 的 109 张截图逐字节比对。
本目录所有规则改完，那 109 张必须一个字节都不变 —— 变了就是规则漏到屏幕了。

---

## 七、这些保证由谁守着

上面每一条都是**可断言的**，不是文档承诺。守它的有三个东西：

| 工具 | 它回答的问题 | 它答不了什么 |
|---|---|---|
| `ai/components.json` 的 `printPolicy` | 这个组件在纸上会发生什么？（机器可读，AI 消费这一份） | 它只是声明，不等于生效 |
| `print-policy-gate.js` | 声明的都真的生效了吗？有没有没声明的隐藏？ | 它不判"印出来好不好看" |
| `print-gate.js` | 印出来的 PDF 合格吗？ | 它数得清 run，数不出"少了一半内容" |

`printPolicy` 是**有限枚举**，每个值对应一组能在浏览器里量的断言：

| policy | 含义 | 断言（`print-policy-gate` L3） |
|---|---|---|
| `omit` | 内容不上纸 | 打印态 `display: none` |
| `expand` | 放开屏幕上的限制（隐藏/收起/限高/固定定位） | `display≠none`、`visibility≠hidden`、`position≠fixed`、`max-height:none`、`overflow` 不裁、有文字时高度 > 0 |
| `reveal` | 只在纸上出现 | 屏幕 `display:none` 且打印态不是 `none` |
| `keep-together` | 不跨页切断 | `break-inside: avoid` |
| `allow-break` | 退出 `keep-together` | `break-inside: auto` |

⚠️ **什么叫"没声明"**：`printPolicy: []` 是明确值「原样保留」。缺字段才算漏 ——
门禁会红。这条区分很重要：空的数组是结论，缺的字段是疏忽，两者不能长得一样。

门禁分四条腿（少一条就有一类失效看不见）：

```
L0 归属      组件规则的选择器必须在该组件 CSS（打印块之外）里真的存在
             ⇒ 抓「藏一个库里不存在的类」。实测抓到 `.overlay`：
               tokens.css 一直在隐藏它，而全库没有任何 CSS 定义过它，
               真正的遮罩 `.dialog-backdrop` 反而没被处理
L1 声明→实现 契约里每条规则，全库 print 块里都要有值相符的声明
L2 实现→声明 每条会丢内容的声明都要有规则认领（display:none / visibility:hidden /
             max-height:0 / opacity:0 / break-inside …）
L3 声明→生效 在真浏览器的 print 媒体下量标本页的计算值
             ⇒ 抓「写了不生效」。实测抓到自己刚写的 `.dialog-backdrop`
               规则被 overlay.css 同特异性盖掉
```

反向控制 7 条（覆盖四条腿），其中两条是历史事故的**逐字复刻**：
E254（去掉 `.tabs ` 前缀，让组件 CSS 同特异性盖掉它）与
E255（只删 `visibility: visible`，display 与高度全对、一个字不印）。

想加一个新组件的打印行为，流程是三步，顺序不能换：

1. 在 `ai/components.meta.json` 的该组件下写 `printPolicy`（`why` 必须能回答"不这么做会怎样"）
2. 在 CSS 里实现；**库级**行为写 `01-tokens/tokens.css`，**组件自己的**写组件 CSS
   （写反了会被同特异性盖掉，且不报错）
3. 在 `05-audit/fixtures/print-policy/probe.html` 补标本 —— 没有标本就没有证据，
   L3 会报「命中 0 个元素」

```bash
python3 05-audit/gen-ai-contract.py            # 重新生成 ai/components.json
node 05-audit/print-policy-gate.js             # 四条腿
node 05-audit/print-policy-gate.js --selftest  # 反向控制
```
