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
> 所以现在可以在浏览器里直接审「打印态会不会显示」（`print-content-audit.js` 默认就跑两次扫描：屏幕一次、打印一次）。
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

上面每一条都是**可断言的**，不是文档承诺。守它的有五个东西：

| 工具 | 它回答的问题 | 它答不了什么 |
|---|---|---|
| `ai/components.json` 的 `printPolicy` | 这个组件在纸上会发生什么？（机器可读，AI 消费这一份） | 它只是声明，不等于生效 |
| `print-policy-gate.js` | 声明的都真的生效了吗？有没有没声明的隐藏？ | 它不判"印出来好不好看" |
| `print-gate.js` | 按 Ctrl+P 印出来的 PDF 合格吗？ | 它数得清 run，数不出"少了一半内容" |
| `print-content-audit.js` | 该印的在不在？（屏幕可见 → 纸上消失？） | 它只在浏览器里量，不读 PDF |
| `agentcss pdf` + `pdf-export-gate.js` | **导出成文件**这条路能用吗？（§八） | 它不做视觉比对 |

前四个判的是"浏览器里按 Ctrl+P"，最后一个判的是"导出一份文件"。两者都走 CDP，
但 `@page` 来源、就绪条件、底色参数与输出保护不同；打印策略全绿推不出导出链没有
旧文件假成功或异步漏内容，所以两边各有各的判据。

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
去掉 `.tabs ` 前缀，让组件 CSS 同特异性盖掉它；以及
只删 `visibility: visible`，display 与高度全对、一个字不印。

### 内容完整性是**硬判据**（2026-11-02 起）

`print-policy-gate` 管「声明与实现对不对得上」，`print-content-audit` 管
「纸上到底少了什么」。后者现在是硬 FAIL，三条判据全部相对**屏幕态**量：

| 判据 | 条件 | 为什么要它 |
|---|---|---|
| ① 契约违约 | 命中 `expand` 的文字，打印仍不印 | printPolicy 说「要展开」就是承诺 |
| ② 静默消失 | 屏幕可见 → 纸上消失，且无 `omit` 声明 | 这就是「静默截断」的定义 |
| ③ 不算 | 屏幕也看不见 | 关闭的菜单 / 未触发的空态 / a11y 反例 —— 不是"被吞掉"，是"没发生" |

**没有白名单。** 上一版靠手写 `DECLARED` 清单，绝对口径下全站会列出
17 条 / 337 字，逐条看全是关闭态菜单和反例 —— 判据太粗，人就不看了，
最后只能加白名单把它关掉。判据③ 取代了白名单：闭着的东西两态都闭着，
不需要谁批准。

```bash
node 05-audit/print-content-audit.js        # 13 页采样集（门禁跑这一档，22s）
node 05-audit/print-content-audit.js --all  # 47 页全站（发布前扫查，69s）
```

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

---

## 八、导出一份 PDF：`agentcss pdf`

上面七节讲的是"在浏览器里按 Ctrl+P 会怎样"。这一节讲**产出一份文件**——
这中间差一个东西：`@page`。

### 8.1 分工：`@media print` 管行为，`@page` 管版式

```
组件库  → @media print   隐藏什么 / 展开什么 / 不跨页切断     （行为）
导出器  → @page          纸多大 / 边距多少                    （版式）
```

🔴 **`@page` 绝不能写进 `tokens.css`。** 实测：同一份页面，库里多一条
`@page` 规则，产物从 943 runs 变成 978 runs —— 使用者的边距控制会**静默失效**，
而且没有任何报错。纸多大、边距多少，是"这份东西交给谁"决定的，
不是某个按钮决定的。所以它属于导出路径，不属于组件库。

```bash
npx agentcss pdf report.html --out report.pdf          # 默认 A4 / 18mm 15mm
npx agentcss pdf report.html --out report.pdf --paper=letter --margin="20mm"
npx agentcss pdf report.html --out report.pdf --max-pages=8
npx agentcss pdf report.html --out report.pdf --ready-selector="#report-ready" --wait-ms=0
```

`--paper` 支持 `a4` / `letter` / `a5` / `a3` / `legal`。边距是 CSS 简写
（`18mm`、`"18mm 15mm"`、四段都认）。这两个参数靠**注入一条 `@page` 规则**实现，
注入位置在使用者样式之后 —— 否则同特异性会被盖掉（同一个病）。

零运行时依赖：用使用者机器上**已装好的** Chrome / Chromium / Edge，经共享 CDP
管道调用 `Page.printToPDF`，不打包 Puppeteer。找不到浏览器明确报错（退出码 3）：

```bash
npx agentcss pdf report.html --out report.pdf --chrome="C:/Program Files/Google/Chrome/Application/chrome.exe"
# 或环境变量 AGENTCSS_CHROME / CHROME_PATH
```

#### 就绪、失败与旧文件保护

导出顺序是：页面 `load` → `document.fonts.ready` → 可选可见元素 → 额外等待 →
固定动画终态 → PDF。`--wait-ms` 默认 `800`，可设 `0`，上限 `60000`；它只是额外缓冲，
**不是任意异步数据已经完成的证明**。动态报告应在数据与图表都渲染完后显示一个元素，
再传 `--ready-selector="#report-ready"`；只存在但 `display:none`、不可见或没有尺寸不算就绪。

整个导出默认有 60 秒总预算，超时退出码为 `4`。非法 CSS 选择器、空值与非法等待
都是用法错误（退出码 `2`）。未捕获的页面 JS 异常会放进 JSON 的 `jsErrors` 供复核，
普通 `console.error` 不会擅自让导出失败。

浏览器只写暂存 PDF；确认本次成功后才原子替换输出文件。浏览器崩溃、就绪超时、
非法选择器或产物校验失败时，**已有 PDF 保持不变，结论明确为失败**。超页数预算不同：
完整的新 PDF 会保留，退出码 `5`，由作者决定如何拆改，绝不静默截断。

### 8.2 页数预算：超了报错，不替你截断

```bash
npx agentcss pdf report.html --out report.pdf --max-pages=8
```

```
[FAIL] 超出页数预算：12 页 > 8 页（A4，595×842pt，边距 18mm 15mm）
  产出文件保留在：…/report.pdf
  三条出路（按代价从低到高）：
   ① 拆文档   把一章拆成单独文件分别导出
   ② 进附录   明细移到附录，正文只留汇总 —— 需要作者改内容
   ③ 截断     **本工具不代做**。静默丢内容正是这套判据在防的事
```

退出码 `5`。**没有全局默认预算** —— 页数取决于内容，任何默认值都是猜的。
不传 `--max-pages` 就是无界，工具会明确说"预算未设（无界）"而不是假装有个上限。

为什么不实现 `--on-exceed=truncate`：一个会替你悄悄删掉后半份报告的工具，
比一个报错停下的工具危险得多。真要截断，请删掉要删的段落再导出 ——
那样它会出现在 `git diff` 里，有人会看见。

### 8.3 `--medium=paper`：校验时的打印义务

`ai check` 多了一根**与档位正交**的轴：

```bash
npx agentcss ai check doc.json --medium=paper
```

`screen`（默认）下什么都不变 —— 95% 的人不该看到"打印"两个字。
`paper` 下追加三条义务：

| 判据 | 结果 | 为什么 |
|---|---|---|
| 必须声明 `pageBudget` | 错 | 没有它，"印了 40 页"是惊喜不是错误 |
| 不允许 `pagination:"server"` 的组件 | 错 | 纸上只有当前一页，而文件看起来完整 |
| 用了 `printPolicy:"omit"` 的组件 | 提示 | 那部分不会出现在纸上，作者得知道 |

为什么不做成第四个 `profile`：档位是"允许多不成熟的东西进来"，
介质是"这份东西给屏幕还是给纸"。`strict+paper` 与 `creative+paper` 都必须合法，
压成一维就会丢掉四种组合里的两种。

### 8.4 一条必须知道的观测差异：底色

| | 底色 | 白字压深色块 |
|---|---|---|
| 浏览器打印对话框（默认不勾"背景图形"） | 丢弃 | 被压成 #ABABAB，看起来发灰 |
| `agentcss pdf` | **保留** | 白字压深蓝，可读 |

两者不是谁错了，是两个产品。所以 `print-gate` 的对比度判据（对白纸量）
只对对话框那一路成立；导出产物走的是 8.5 那套判据，不套用对比度。

### 8.5 这条路谁守着

```bash
node 05-audit/pdf-export-gate.js            # E1–E20，不需要静态服务，约 40s
node 05-audit/pdf-export-gate.js --selftest # 旧文件保护 / 超时 / 崩溃结论 / 非法参数
```

| 判据 | 它问什么 | 实测抓到过什么 |
|---|---|---|
| E1 | 真的产出了一份 PDF 吗 | 退出码 0 但文件不存在 |
| E2 | 同一输入两次导出结果一样吗 | 异步渲染没排完 ⇒ 页数会变 |
| E3 | `--paper` 真的换纸幅吗 | 注入逻辑被改坏 ⇒ 回落成 Letter 612×792 |
| E4/E5 | 预算的两向：以内通过、超出报错 | 超限不给退出码 5 |
| E6 | 库的打印规则到得了产物里吗 | 删掉 `.tabs__panel[hidden]` 那条 ⇒ 隐藏面板的字消失 |
| E7 | `--margin` 真的影响页数吗 | 不注入 `@page` 时 60mm 与 10mm 页数相同 |
| E8/E9″ | 没有浏览器时说人话吗；报错回显原始输入吗 | 退出码不对 / `abc` 被报成 `null` |
| E11 | 产物本身合格吗（字体链 / 每页有文本） | 交给 `print-gate --pdf` 的分析器判，不重复实现解析 |
| E13 | 页树 `/Count` 与 `/Type /Page` 数一致吗 | 分段页树按"第一个"取 ⇒ 50 页读成 8 页 |
| E14 | ready-selector 等到的是内容，不只是耗时吗 | 延迟新增行的文字 runs 必须增加（48 → 143） |
| E15 | 真实金融长文每页都有内容吗 | 透明面板与全空白尾页；现为 7 页、每页有文字 |
| E16 | 浏览器失败会冒用旧 PDF 吗 | 旧文件 SHA-256 必须不变，结论必须失败 |
| E17 | 就绪条件永不出现会无限等吗 | 有界 timeout，且不碰旧文件 |
| E18 | 新参数写错会静默按默认值导出吗 | 非法 wait / 空值 / 非法 CSS 都是退出码 2 |
| E19 | 浏览器起不来时给的是结论还是堆栈 | 去掉管道 error 监听 ⇒ 进程以 EPIPE 崩溃 |
| E20 | 强杀留下的临时 HTML 会一直堆着吗 | 下次导出清掉 6 小时前的残留，刚生成的不碰 |

🔴 E3 与 E7 是同一件事的两面：`@page` 注入是这套东西唯一的技术前提。
把它改坏，门禁必须红 —— 实测过：注释掉注入那行，E3 报
`a4=612×792pt`（回落成 Letter），E7 报 `10mm=2 页 / 60mm=2 页`。

E14–E20 则保证“导出链说成功”与“这份产物真是本次、完整、可用”不会脱节。

### 8.6 不覆盖什么

- **远程 URL 不注入 `@page`**：拿不到远程页面的字节，硬注入等于假装改了它。
  这类导出会明确打印"（远程页面：未注入 @page）"，纸幅由页面自己的 CSS 决定。
- **跨机器像素基线**：库内不把字体光栅化差异当成回归；正式交付仍需对实际 PDF
  逐页栅格化，检查空白、裁切、边框与图表，并做一次实体打印打样。
- **页眉页脚 / 页码**：导出器显式 `displayHeaderFooter:false`，本工具不生成自己的。
  需要页码时用浏览器打印对话框的页眉页脚选项，或在自有 CDP/Puppeteer 层提供
  `headerTemplate` / `footerTemplate`；不要假设 `@page + counter(page)` 在 Chrome 可用。
