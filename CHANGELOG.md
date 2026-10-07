# 更新日志

本库的版本按**语义化版本**（`主.次.修`）：

- **主版本**：令牌或定义**不兼容**变更（下游必须改代码）
- **次版本**：新增组件 / 新增能力（下游不改代码也能升级）
- **修订号**：修 bug、修文案（下游无需任何改动）

---

## 0.5.0 — 2026-10-08

### 加：`dist/` —— 源码与交付物分离（M1 · 对标 Pico / Open Props）

实测：全库 CSS 原始 323.9 KB，**其中 207.5 KB 是注释（64%）**；
`01-tokens/tokens.css` 源码版 gzip 15.8 KB ⇒ 使用者下载的是我们的推理过程。

Pico 在 README 上按产物逐个公布体积；Open Props 的 CDN 清单区分源版与 min 版；
Web Awesome 从 `dist/` 交付。三家都是 **src 可读、dist 可 ship**，只有我们把二者混成一个文件。

⭐ 更要紧的一条理由来自我们自己：`.gitignore` 里早就写着
「内部工作文档不进仓库 —— 交付面只放提交物」（决策记录 / 复盘 / 作战计划三类目录全在名单里）。
⇒ **这条纪律我们已经执行了，只是只对 markdown 执行了。** M1 把它扩到 CSS。

- `dist/**/*.min.css`：去注释 + 压缩（`tokens` 15.8 KB → **2.1 KB**，省 86%）
- `dist/**/*.css`：只去注释、保留格式（便于 diff / 阅读）
- `dist/**/*.js`：只去注释，**不压缩** —— 手写 JS 压缩器有破坏 ES5 语义的风险，
  收益不抵风险，这一点如实写进 README 与 manifest，不假装 min 过
- `dist/manifest.json`：每个产物记录来源路径、源 sha256、原始/gzip 字节
- `dist/COSTS.md`：**采纳一个组件的真实成本**（tokens 必付 + 组件 CSS + 可选 JS）

### 加：三道门禁

- **`dist-fresh`**：源码 sha256 变了而 dist 没重建 ⇒ 红（防"交付的是旧产物"）。
- **`dist-parity`**：把 dist 与源码各自喂给浏览器 CSSOM，必须解析出
  **同一份规则集**（条数 + 每条 cssText）。判据交给浏览器，不写第二个手写正则去验证第一个。
  反向控制：在内存里改一个 dist 产物的色值 ⇒ 立刻红（其余 65 个不误报）。
- **`dist-cost`**：`COSTS.md` 上每个数字都必须能用同一脚本复算 ⇒ 手改一个数字就红。

### 这条工作里被门禁逼出来的三个真东西

1. **逗号后面的空格不能压**。CSSOM 序列化 `transition` 这类逗号列表时会**原样保留源码空白**，
   压成 `,border-color` 虽然解析结果一样，但 cssText 不同 ⇒ parity 红。
2. **`+` 两侧的空格不能压**。`calc(100% + 1px)` 压成 `calc(100%+1px)` 是**非法**的
   ⇒ 整条声明被丢弃，界面静默少一块。同理不碰 `/`（`font: 12px/1.5`）与 `-`（负号）。
   ⇒ 压缩器的标点白名单从 `{}:;,>+~` 收紧到 `{}:;`，是**被判据逼出来**的，不是拍的。
3. **判据自己也会写反**。第一版反向控制断言"产物里不许出现 `/*`"，
   而 `content: "/* 不是注释 */"` 是**值的一部分**，删了才是 bug。
   ⇒ 修正为同时管两头（真注释要删、字符串里的要留）。

> 体积：`dist/` 不计入 `size-baseline`（它是源文件的导出物，计入会双倍计数）；
> 源文件一字节没改，size-budget 不受影响。

## 0.4.2 — 2026-10-07

### 修掉根因：这个库**根本没有"全局"**

事故原话：「只要稍微去修改一下全局的，比方说有 14 个页面要改，那么立刻崩。」

复盘不是"模型笨"，是**页面骨架被 33 个页面各抄了一份**在内联 `<style>` 里。
脚本数过 39 个页面（数字都能复跑）：

| 选择器 | 出现在 | 写法种数 |
|---|---|---|
| `h1` | 36 页 | 8 |
| `h2` | 35 页 | 11 |
| `.wrap` | 33 页 | 16 ← 列宽从 680px 到 900px 有 13 个不同数字 |
| `body` | 32 页 | 9 |
| `code` | 24 页 | 9 |
| `.lede` | 21 页 | 7 ← typography.css 里**早就有了**，页面还在重抄 |
| `.note` | 21 页 | 10 |
| `.box` | 13 页 | 2 |

⇒ "改全局"在物理上不成立：没有一处可改，只有 33 处要改。
机械化证据：`git worktree` 取出改动前的版本，在**同一把尺子**下量"改一个全局令牌，
这一页跟不跟着变" —— **36 处不跟随**（每页都写死了自己的列宽）。

### 加：`01-tokens/page.css`（页面骨架，单一真值源）

- 新增 `--measure-page: 52rem`（实测众数 820px，取干净的 rem 值）、
  `--tracking-title: -0.02em` 两个令牌。
- 骨架全部挂在 `.page` 下（`<body class="page">` 才生效）——
  裸标签选择器的作用域是整个文档，会污染宿主页面；
  `05-audit/bleed-gate.py` 就是拦这个的，骨架必须同样遵守。
- 收编 19 个选择器：`body` / `.wrap(+--prose)` / `h1` / `h2` /
  `.rule-top` / `.rule-bottom` / `code` / `.box(+.bad)` /
  `.lede` / `.small` / `.note(+--warn)` / `.rule` / `.num` / `.num-lg` 等。
- 39 个页面迁移：`<body class="page">` + 引 page.css + 删掉自己那份骨架，
  **共删 231 条重复规则**。
- `.note` 收敛到实测众数（21 页里 20 页当"灰底说明块"用），
  warning 语义显式化为 `.note--warn`（只有 responsive-demo 用）。
- `.lede` 从 `--fs-lg` 降到 `--fs-md`：原来与 `h2` 同档，导语抢了小节标题的层级。
- `h1` 取"讲究版"（字重 500 + 收紧字距 + `--measure-title` 限宽，list/nav/states 三页在用），
  不是数量最多的"没写完版"（19 页，缺的正是这三件事）。
- `h2` 的两种东西分开：光秃秃的小节标题留在骨架里，
  带分隔线的用 `.rule-top` / `.rule-bottom` 修饰类
  （原来 13 页用上边线、6 页用下边线，各写各的）。

### 加：两道门禁

- **`05-audit/shell-gate.py`** —— 骨架收编了的选择器，页面一律不许再声明。
  不拦的话，`.page h1`（0,1,1）会**静默盖掉**页面的 `h1`（0,0,1），
  页面那句变成死代码：不报错、看不出来，只在你以为改了的时候没改。
  自检含反向控制（坏样本 9 个选择器必须全被抓）+ 过宽检查（页面自己的
  `.row` / `.demo-grid` 必须放行）。
- **`05-audit/skeleton-lever-check.js`** —— 在真浏览器里量三个全局杠杆
  （`--measure-page` / `--fs-2xl` / `--sp-6`），**每一页**都必须跟着变：
  **106 次命中 / 0 次未命中**（改动前是 33 命中 / 36 未命中）。
  反向控制两条：不引骨架的宿主样板（`examples/react-vite`）必须纹丝不动；
  页面局部 class 不该被骨架令牌牵动。
  顺带量窄屏横向溢出（320 / 393px）。

### 修：窄屏横向溢出（新尺子量出来的既有缺口）

- `date-range.css` 的 `.drange__input` **漏了 `box-sizing: border-box`** ——
  `input` 的 UA 盒模型是 content-box，`width: 100%` 只是内容宽，
  加上 padding 12×2 + border 1×2 实际盒宽比容器多 **26px**
  ⇒ 393px 视口下 `scrollWidth 403 > 393`。
  全库 `box-sizing` 只出现过 5 次，都是某处临时补的 ⇒ 谁记得谁没事，谁忘谁溢出。
  修法两条：组件自己补 `border-box`（组件正确性不能依赖宿主引了骨架）；
  骨架里加 `.page * { box-sizing: border-box }`（只挂 `.page`，不做全局 reset）。
- `input/demo` 的 `minmax(320px, 1fr)` → `minmax(min(320px, 100%), 1fr)`
  （窄于 320px 时轨道不缩 ⇒ 溢出 21px）。
- `pagination.css` 的 `.pagination__list` 补 `flex-wrap: wrap`
  （父级 `.pagination` 早就写了，页码列表自己没写 ⇒ 溢出 7px）。
- `scrollbar-demo` 的两张表加横向滚动容器（等宽标识符不可断行 ⇒ 溢出 21px）。
- `model-viewer` 同因（溢出 9px）已随列宽收敛消失。

⚠️ **一处已知未修**：`popover/demo.html` 的 `--end` / `--bottom` 演示。
浮层是绝对定位、按锚点**外侧**弹出（最小 200px），窄屏上锚点右侧没有 200px 空间，
而本库刻意不做 JS 落点检测（定位靠 CSS、不靠测量）
⇒ 关闭状态的浮层仍占着滚动溢出区，把整页撑出横向滚动。
门禁里以**显式例外**打印（每次都印，不静默）；修法见脚本注释。

### 补：呈现适配层的五条判据**此前一次都没被执行过**

`adapters/presentation/check.js` 声称守五条判据（版面必须已登记 / 单页元素 ≤ 12 /
非封面页必须有标题 / 标题层级不跳级 / 禁 `.slide-N` 这类页面级选择器），
而 `core-boundary` 只验了 `to-doc.js` 的往返 ⇒ **`check.js` 从来没被任何门禁跑过**。
读 README 的人会以为有人在看，实际没人看 —— 这是 I-10 的第 5 个实证，
也是最难发现的一类：它连"通过"报告都不产出。

- 新增 `05-audit/presentation-gate.py`（已接入 `check-all.sh`）：
  合规 deck（`fixtures/deck-ok.json`）必须过；违规 deck（`fixtures/deck-bad.json`）
  必须红，且**五条判据各命中一次**（少一条就红 ⇒ 判据被删/改文案立刻暴露）；
  `check.js` 的 `MAX_PER_SLIDE` 必须等于 `deck.schema.json` 的 `nodes.maxItems`
  （两个真值源，改一处忘一处就成了"文档说 12、代码放 20"）。
- 反向控制：把上限放宽到 999 / 去掉 `.slide-` 正则 / 把 schema 改成 8
  ⇒ 门禁必须认出对应判据已失效。

⚠️ 本版**没有**新增任何 PPT 能力：没有凭空造适配层，
`adapters/presentation/` 是既有的、只是第一次被真的跑起来。

### 修：tooltip 的左右方位**根本没有小三角**，而且落点算错了

两处都是**静默**的：不报错、门禁不红，只是"看着不太对"。

1. **类名对不上**：`tooltip.js` 的 `place='left'|'right'` 拼出 `tooltip--left` /
   `--right`，而 `tooltip.css` 与契约 `ai/components.json` 里只有
   `--inset-inline-start` / `--inset-inline-end` ⇒ 这两个方位的 `::after`
   四条边全是 transparent ⇒ **没有小三角**。演示页 `p-left` / `p-right` 正在用。
   修：`place` 按书写方向换算（物理左在 LTR 是内联起点、在 RTL 是内联终点），
   并新增 `start` / `end` 两个逻辑方位。
2. **量的时候元素还没进 DOM**：`show()` 先读 `getBoundingClientRect()` 再
   `appendChild` ⇒ 游离元素拿到全 0。实测后果：
   `top` 方位的气泡与锚点**完全重叠**（tip.top 398 == anchor.top 398，
   正确值应是 364），`left` / `right` 上下偏半个身位。
   修：先挂上去、藏起来量，量完再显示。顺带给 `top` 补了水平居中
   （原来只有 `bottom` 居中，`top` 的 left 是静态位置，实测偏 16px）。
3. **RTL 尖角指反**：CSS 里 `--inset-inline-start` 配的是物理
   `border-left-color`。小三角是"给哪条边上色、尖角就指向反方向"，
   RTL 下左边变成内联终点 ⇒ 尖角指向气泡外侧。改成
   `border-inline-start-color` / `border-inline-end-color`。

配套：
- `tooltip-check.js` 新增判据⑥：在真浏览器里量 `::after` 的四条边 ——
  LTR/RTL × left/right 四个组合必须**各恰好一条边有色，且 RTL 落在相反的物理边**
  （修之前是 0 条）。判据写完后先跑一次确认它会红，才动手改代码。
- `rtl-check.js` 的物理属性词表补上 `border-left-color` / `border-right-color`
  —— 原来只收 margin/padding/left/right/text-align，**边框上色边漏了**，
  这正是它能静默到现在的原因。已反向控制（注入 1 处 ⇒ 门禁报 1 处）。

> 体积：`tooltip.js` 1.7 → 2.6 KB，`tooltip.css` 1.5 → 1.7 KB ⇒ 单文件容差（5%）
> 超了。成因可归因：新增 `resolve()` 方位换算 + 逻辑定位 + 两条"为什么"注释。
> 全库 gzip 177.2 → 178.3 KB（+0.62%，预算内）⇒ 已重录基线。

### 补：`check-all.sh` 的静态服务加 canary（"量另一棵树"第三次复发）

实测第三次栽在同一个坑上，这次是**运行器自己**：

1. 我在**源仓库目录**手动起过一个 `http.server` 忘了关；
2. 随后在一个**克隆副本**里跑全量验收；
3. 运行器探测到 8000 已通 ⇒ 打印「复用已在跑的服务」⇒
   100 多道浏览器门禁量的全是**源仓库**。

症状极具迷惑性：**107 道 PASS，只有 `selftest` 红** ——
因为它要现生成临时文件，在别人的根目录下 404。若不是它红，这就是一次完美的假绿。

修：拉 `index.html` 与本地**字节比对**（不是看返回码）。不一致 ⇒ `exit 2`，
并明确写出"继续跑下去量的就不是这份代码"。
反向控制：另起一棵假树占住 8000 ⇒ 运行器报「另一棵树」并退出 2（已实测）。

⭐ 三次复发的共同点：**"服务在跑"不等于"在跑这一份代码"**。
判据必须是**字节**，不能是**连通性**。

### 为什么可以重录视觉基线

31 页大小全部变化（页面高度 ±30 ~ ±150px）。变化**来源已逐条归因**：
标题阶梯、导语字号、列宽、页面框内边距、以及上面那条盒模型修复。
判据不是"看着像"，而是：`skeleton-lever-check` 证明三个杠杆每页都生效、
横向无溢出；`shell-gate` 证明没有第二份骨架定义；
余下 60+ 道行为契约全绿。此前 0.4.1 已证明过"改输入→输出完全没动"
是门禁在量另一棵树，那次之后截图门禁改用 OS 分配端口 + canary 字节比对。

---

## 0.4.1 — 2026-10-07

### 修掉一个 19 处、静默了很久的 bug：`border-inset-inline-*`

全库 19 处写的是 `border-inset-inline-start` / `-end` ——
**这不是一个存在的 CSS 属性**（正确的是 `border-inline-start` / `-end`）。
机械验证：`CSS.supports()` 两种形式 + `element.style.setProperty()` 三处一致返回
`false`；而 `border-inline-start` 三处都接受（带 `var()` 也成立）。

后果：这些边框**从来没有被渲染过**。而配套的
`border-left-color: var(--accent)` 只是给一条 **0 宽、style:none** 的边上色
⇒ 目录当前项指示条、引用块竖线、树形导引线、列表 hover 线、纵向选项卡选中线
**全部看不见**。

受影响 10 个组件：nav / content / tree / list / tabs / accordion / drawer /
popover / date-range / model-viewer。

⚠️ 为什么过去没被发现：写错属性名**不报错、不影响解析**，
lint / 注释平衡 / 令牌解析全认为这一行正常；33 道行为契约验的是
"能不能点、焦点在哪"，**验不了观感**；唯一能发现它的是视觉回归，
而视觉回归当时正在假绿（见下一节）。

修复：一律改用逻辑属性，配套的 `border-*-color` 也一并改
⇒ RTL 下不会着错边（物理 `border-left-color` 不跟着翻转）。

顺带修掉同类一处：`scrollbar.css` 写了 `border-width: 2px solid transparent`
（`border-width` 只吃宽度，那是 `border` 简写的值）⇒ 整条被丢弃。
改成 `border` 简写，并补 `background-clip: content-box`
（否则底色画到透明边框底下，看上去**完全没变细**）。

### 新增门禁 `css-validity`（判据来自浏览器自己）

每条声明交给 `CSS.supports(prop, value)` 判定 ——
**不手写属性白名单**：手写的那份是第二份真相源，必然漂移（INVARIANT I-7）。

三档，避免误伤：无前缀却不认 ⇒ **FAIL**；`-webkit-` 不认 ⇒ **WARN**
（实测 `-webkit-overflow-scrolling` 是 Safari 专有，Chromium 从未实现）；
他厂前缀（-moz/-ms/-o）⇒ 跳过并计数（本机无从判定，不假装有结论）。

同一道门禁还查 **`var()` 悬空引用**：引用了全库从未定义、且**没有兜底**的
自定义属性 ⇒ 该声明在计算值阶段被整条丢弃（同一种静默失效）。
有兜底的不算错 —— 那是刻意留的扩展位（`--spark-c` 等 5 处由 JS 或使用者写）。

自检 9 条，含反向控制（坏夹具必须判红、好夹具必须判绿）。

### 修掉三处**门禁自身**的失效（比上面的 bug 更危险）

- **视觉回归可能在测另一棵树**（本次就是这样被发现的：CSS 修好后
  diff 数字**一字未变**）。`shot-baseline.py` 用固定端口 8000 起静态服务，
  端口被占时子进程立刻静默退出，`Popen` **不报错**、父进程毫无察觉
  ⇒ 所有截图来自那个残留进程。实测本机挂着一个残留 http.server，
  服务的是**另一个目录**。
  ⇒ 改用**操作系统分配端口**（bind 0，物理上不可能撞车）+ canary 校验
  （拉一个文件与磁盘字节比对，确认连上的是本仓库）。
- **「基线是否过期」漏掉 5 个文件**：指纹 glob 是 `0*/*/*.css`（三段），
  匹配不到 `01-tokens/tokens.css` 这类二级路径 ⇒ **只改令牌时指纹纹丝不动**，
  diff 出现了却没人知道为什么。⇒ 改为遍历库目录，并把会改变渲染的
  JS / HTML 一并纳入（改了 tree.js 的 DOM，观感一样会变）。
- **8 个组件根本没有视觉基线**：tabs / accordion / popover / progress /
  skeleton / pagination / model-viewer / sparkline 有 CSS、有 demo，
  却不在受管页面里 ⇒ 改坏了无人报警（tabs.css 这次恰好在改动范围内）。
  已补齐到 **31 页**。

### 基线已按「有意变更」流程重录（31 页，录完即测 31/31 一致）

重录前做过三方比对核实不是回归：

| 页面 | 基线 vs 基线所属提交的代码 | 该提交的代码 vs 现在 |
|---|---|---|
| card / button / overlay | 不一致（2299 / 7473 / 286 px） | **0 px** |

⇒ 这三页**当前代码与基线所属提交逐像素完全一致**，也就是说它们从没变过，
是那份**基线 PNG 本身录于更早的状态**；states / form-validation 的差异
来自有意改的演示文案（`.is-success` → `data-state="success"`、
`.is-dirty` → `data-dirty`）；list 的左侧指示条是
「曾经正常 → 被写坏 → 本次修好」，所以现在反而更接近旧基线。

基线戳现在也记录录制时的 `head`，下次能直接对上"这份基线属于哪份代码"
（这次就是因为只能看出"不一样"、答不出"差在哪"，才查了很久）。

### 体积

无新增 CSS，仅修正既有声明 ⇒ 体积无变化（基线重录不影响产物）。

---

## 0.4.0 — 2026-10-07

> 0.3.0 之后的所有工作一次性发布（0.3.1 未对外发布，故不单列一节）。
> 本次含 **2 处不兼容变更**，见最末一节。

### 修掉两个**真浏览器实测**才看得见的 bug

建立机器可读令牌索引（`ai/tokens.json`）时顺带发现的，
两个都**不报错、页面能显示、门禁全绿**，但功能已经坏了：

- **`--switch-on` 在浅色模式下是空的**
  原因：`tokens.css` 里一段注释**缺开头**，第二行只有一个收尾符 ⇒
  CSS 的错误恢复把紧跟其后的 `--switch-on` 当成"坏声明"跳过了。
  ⇒ 开关组件在浅色下没有轨道色。
- **`--surface-raised` 只在暗色段定义**
  ⇒ `background: var(--surface-raised)` 在浅色下整条失效、计算值**完全透明**。
  实测受影响组件 6 个：combobox / popover / select / dropdown / tooltip / table。
  ⚠️ 这条在 `10-review/ios/index.html` 里**早就记过**，但当时只在那一页绕开
  （换个令牌），**没修根因** ⇒ 其余 5 个组件一直在踩。

### 新增：机器可读契约（对标 Open Props / Primer）

- `ai/components.json` —— 27 个组件的**结构化契约**：
  插槽（BEM 元素名即插槽名）、变体、状态、成熟度、专属门禁、ARIA
- `ai/tokens.json` —— 106 个浅色 + 30 个暗色令牌，
  `$value` / `$type` 按 W3C Design Tokens 草案形状，可被 Figma / Style Dictionary 直接消费
- 两者均由 `05-audit/gen-ai-contract.py` **从源码生成**，`--check` 已接门禁
  ⇒ 改了源码忘记重新生成就红（真值只有一份：CSS）

### 组件成熟度（对标 Primer 的 Alpha/Beta/Stable）

成熟度**算出来**的，不是拍的：

- `stable`：有 demo + 专属门禁 + 状态全部用 `data-*` 表达
- `beta`：仍有用 `is-*` class 表达的状态 ⇒ 违反不变式 I-8
  （状态不在 DOM 上，JS 改坏就静默错乱）

⇒ 约束力不再一刀切：模型变强时放宽的是 beta 区，stable 区一个字不动。

⭐ **本次状态收敛完成后，27 个组件全部达到 `stable`** ——
成熟度是**算出来的**（`ai/components.json` 由 `gen-ai-contract.py` 生成），
不是谁把 beta 改成了 stable。之前的 11 个 beta，卡的就是 I-8 这一条。

### 新增门禁（4 道）

- `theme-sync`：`theme-toggle.js` 与 `tokens.css` 同步
  🔴 **这条本来就该在，但一直没接进 check-all.sh**，而脚本自己的文档还写着
  「--check 已接进门禁 ⇒ 漂移会变红」⇒ 于是它真的漂移了（28 vs 27 个暗色令牌），
  门禁一声不响。**文档说做了、实际没接，比没做更危险。**
  顺带把挑令牌的**白名单**换成**差集规则**（暗色值与浅色不同就复制）——
  白名单永远还会漏，`--skeleton-bg` / `--text-on-solid` 就是这么丢的。
- `ai-contract`：机器可读契约与源码一致
- `token-parse`：孤儿注释收尾符 / `var()` 引用缺失 / 浏览器复核关键令牌
- `comment-balance` **重写**：原来是**数 `/*` 和 `*/` 的个数**，
  实测放过了一个真 bug（一处缺开头 + 一处嵌套，两个错误方向相反正好抵消）
  ⇒ 修好之后它反而报红 —— **它在惩罚修复**。改成真扫描器（跳过字符串与 JS 正则）。

---

## 0.4.0 的第二部分：规范分层、状态收敛、纯 CSS 暗色

### 🔴 规范分成三层（Invariant / Contract / Guidance）

起因是一个真实的两难：**今天的约束会变成明天的天花板。**
约束写死 ⇒ 模型变强了也放不开；写活 ⇒ 没有基准，每次都重新吵一遍。

拆法：

| 层 | 文件 | 性质 | 改它需要 |
|---|---|---|---|
| **不变式** | `docs/INVARIANT.md` | 客观事实，永不变 | 物理定律变了 |
| **契约** | `ai/*.json` + `API.md` | 约定，随版本变 | 发个版本 |
| **建议** | `docs/GUIDANCE.md` | 工作建议，可整份推翻 | 什么都不需要 |

⇒ 放宽约束时动的是 Guidance；Invariant 一个字不动。
`05-audit/invariant-gate.py` 守着第一层的边界（出现组件名 / 令牌名 /
版本号 / 档位名 / 建议性措辞 ⇒ 红）。

配套：

- `docs/BENCHMARK.md` —— 对标 Pico / Radix / Open Props / Web Awesome / Primer，
  每一条写清"学什么、不学什么、**为什么不学**"
- `docs/GUIDANCE.md` —— 5 条建议，**每条都写明"什么时候可以删掉它"**

### 修掉一个只在**真暗色**下才暴露的链接 bug

`03-patterns/content` 的链接规则写的是 `.prose > a`（**直接子元素**）
⇒ 正文里的链接几乎都在 `<p>` 里，一个都没被选中，落到浏览器默认蓝
`rgb(0,0,238)`，暗色下对比度 **1.91:1**（需 4.5）。

更糟的是旁边还有一条"补救"规则 `.content a` —— 而 `.content` 这个类名
在全库 **0 处出现**（本组件的根类是 `.prose`）⇒ 整段是死的，
且它的注释还写着「.content 是本组件的根」。
⇒ 于是"链接已经处理过"这个判断一直是假的。

亮色下默认蓝看着"还能看"，所以一直没人发现。
是 `dark-contrast` 在真暗色下实测抓出来的。

### 🔴 状态表达统一为 `data-*`（0.4.0 不兼容变更之一）

发现的是一个**已经随发布版出去的 bug**，不只是风格问题：

1. CSS 里长期同时写着两套：
   `.combo__field.is-disabled` **和** `.combo__field[data-state="disabled"]`，
   但 JS **只加前者** ⇒ `API.md` 明明写着"请改用 `data-state`"，
   而那个分支**从来不会被设上** —— 承诺了一个不工作的 API。
2. 一次半自动改写把 `.a.is-disabled .b` 拆成
   `.a.is-disabled, .a[data-state="disabled"] .b` ⇒ 前半截**丢了后代选择器**，
   规则落到容器自己身上，真正该变灰的 `.b` 再也没有这条样式。
   受影响：`combobox` 的禁用态输入文字与标签删除按钮、`button` 的 success 态
   label/spinner 反转。

⇒ 收敛为一套：`data-state`（状态枚举）/ `data-dirty`（正交标记）/
`data-scroll-locked`（`<body>` 锁滚动）。`is-*` 选择器全部删除。
`API.md` 里给了逐字替换的迁移表。

### 🔴 强制暗色改为纯 CSS（0.4.0 不兼容变更之二）

过去：JS 往 `:root` 写 **30 条 inline 属性**。
代价：inline style 压过**一切**样式表 ⇒ 使用者改 `--surface` 只能加 `!important`
（不变式 I-4）。为了一个开关，把整个配色层抬到了样式表之上。

现在：CSS 自己表达，JS 只翻属性。

```css
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }
:root[data-theme="dark"] { … }            /* 由 theme-sync.py 生成 */
```

- 真值仍然只有一份（`@media` 段），`[data-theme]` 段由
  `05-audit/theme-sync.py` **生成**，`--check` 已接门禁 ⇒ 漂移会红
- `theme-toggle.js` **不再含任何色值**（门禁逐字检查：hex / rgb / hsl 一律红）
- 新增 `theme-css` 门禁：真浏览器里跑四种组合，且**不加载 `theme-toggle.js`**
  ⇒ 证明"没有 JS 也成立"

### 机器可读契约的配套能力

- `ai/validate.js` + `ai/cli.js` —— 零依赖校验器与命令行
  （`ai check / validate / diff / patch / components / tokens / profile / capabilities`）
- **Profiles** `creative / standard / strict` —— 门槛不同。
  门禁证明它有鉴别力：**同一份文档在 strict 下的报错数必须多于 creative**
- **Patch API** —— 对**语义 ID** 的 create/update/move/delete/replace；
  `move` 只改挂载关系、不碰内容；非法操作 ⇒ 文档**字节级不变**
- **能力协商** `ai/capabilities.json` —— 按声明的能力给可用操作集，
  **不按模型名分支**
- **前向兼容** `extensions: {}` —— 旧版校验器遇到未知扩展只忽略，不判非法
- `adapters/presentation/` —— 呈现形态（演示文稿）语义**不进核心**，
  走适配层；`core-boundary` 门禁守着核心里 0 命中
- `benchmark/` —— 10 类编辑意图的兼容性基准骨架（**当前没有任何模型实测记录**，
  这是诚实的现状，不是成果）

### 新增门禁（6 道）

`ai-layer` · `invariant` · `benchmark` · `core-boundary`
· `cascade-layer` · `theme-css`（浏览器）

外加两处**门禁自身的判别力修复**：

- `leak-scan` 的「工作日期戳」原来只查**行首带注释标记**的行 ⇒
  块注释里的缩进行一条都查不到（实测漏了 4 处，都已随发布版出去）。
  改成跨行跟踪块注释状态 ⇒ 立即又抓出 5 处，现已清零。
- `invariant-gate` 的自检原来没测「档位名」这一条 ——
  而它恰恰是唯一在真实运行中触发过的判据。已补。

### 体积

- 令牌多了一份 30 条的 `[data-theme="dark"]` 段 ⇒ `tokens.css` +4.7%
- 总体积 gzip **+0.4 KB（+0.23%）**
- 已按"有意变更"流程重录基线，不是把阈值调大

---

## 0.3.0 — 2026-10-06

### 新增

- **暗色模式**（`prefers-color-scheme: dark`）：21 个令牌，
  全部按 WCAG 公式计算，**不是把浅色反过来**——
  `--accent` 在暗色下**变亮**（深底上深色看不见）、
  `--text-on-accent` **翻转**为深字（按钮变亮 ⇒ 白底白字）。
  `05-audit/dark-gate.py` 守住文字 AA 与分层可见。
- **i18n 度量令牌** `--measure-*`：按 `:lang()` 切换单位
  （CJK 用 `em`、拉丁用 `ch`、RTL 与连字语言各一套）。
  实测中/英/日/阿四语言，标题均 ≤ 2 行。
- **统一检查入口** `bash 05-audit/check-all.sh`（75 道门禁一条命令，
  `MODE=fast` 只跑跨平台安全的静态检查）
- **自停服务器** `bash 05-audit/with-server.sh <命令>`——
  起服务器、跑命令、**一定停掉**（trap 绑退出路径）
- **结构依赖清单** `05-audit/struct-deps.sh`（改 HTML 结构前先跑）
- 组件零依赖；验证工具（puppeteer-core）装在库外

### 新增门禁（8 道）

`hover-gate` · `measure-gate` · `license-gate` · `numeric-gate`
· `dark-gate` · `hardcode-gate` · `reuse-check` · `accent-gate`

每道都做过**判别力验证**（构造已知失败，确认工具抓得到）。

### 修复

- **勾选框点不动 / 框是空的**：改结构后 7 处 `+` 选择器失效（自白勾在白底上不可见）
- **错误提示永远在**：`.form--has-summary` 把空元素也显示了
- **中文标题被挤成三行**：`13ch` 实际只能放 6 个汉字
- **左侧竖条 / 等宽并排 / 大面积饱和色**：去 AI 味
- **文档与实现脱节**：同步 4 处色值、撤掉 5 条"看起来有道理但做不到"的假原则
- **版权**：清掉 2 处逐字外部引用，登记 5 条外部方法论来源

### 已知边界

- 浏览器只在 Chrome / Edge（Chromium）验过
- 屏幕阅读器未做真人验证（只能验结构层）
- 移动端只有 Chrome 模拟，无真机

