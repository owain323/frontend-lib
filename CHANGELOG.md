# 更新日志

本库的版本按**语义化版本**（`主.次.修`）：

- **主版本**：令牌或定义**不兼容**变更（下游必须改代码）
- **次版本**：新增组件 / 新增能力（下游不改代码也能升级）
- **修订号**：修 bug、修文案（下游无需任何改动）

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

