# report · 报告版式系统 v1

给「有结论、有数据、有出处」的材料用的一套**排版约定**：实验报告、技术评估、
产业跟踪、金融研究。它解决的不是"怎么把字变好看"，而是
**同一份内容在三种不同目的的阅读场景下，各自该长什么样、又各自放弃了什么**。

## 它不是什么（边界先划清，免得当万能模板用）

| 不是 | 说明 |
|---|---|
| 不是 CMS / 出版引擎 | 没有内容管理、没有模板继承、没有构建步骤 |
| 不是「喂 Markdown 出 PDF」 | 不接受任何输入格式，只有 CSS |
| **不做分页 PDF / 印刷分页** | 页边距、页眉页脚、页码、跨页控制**一律没有**，也不假装有。见下「明确不做」 |

## 文件

| 文件 | 说明 |
|---|---|
| `report.css` | 全部版式（共享基础 + 科研技术 profile + 三套版式） |
| `demo.html` | 三套版式各一个完整实例，可直接打开 |
| `README.md` | 本文件 |

## 依赖

**零新增运行时依赖。** 只引用库内已有资产：

```
01-tokens/tokens.css         ← 设计令牌
01-tokens/typography.css     ← 排版基线
01-tokens/page.css           ← 页面骨架（.page / .wrap）
04-recipes/table/table.css   ← 数据表格（复用，不另造）
09-assets/scientific-plot/…  ← 图表（复用，不另造）
report.css                   ← 本系统
```

## 一 · 共享基础：六个可变量

整套系统的行为由**六个变量**决定。换版式＝改这六个，不改选择器。

| 变量 | 管什么 | 默认 |
|---|---|---|
| `--rep-measure` | 正文行长（最关键的一个数） | `--measure-prose` |
| `--rep-body-fs` | 正文字号 | `--fs-base` |
| `--rep-title-fs` | 文章标题字号 | `--fs-2xl` |
| `--rep-lead-fs` | 导语字号 | `--fs-lg` |
| `--rep-body-lh` | 行距 | `--lh-base` |
| `--rep-sec-num` | 章节编号前缀（`''` = 不编号） | `''` |

另外定义**六种字体角色**，不多不少：

`.rep__kicker`（眉题）· `.rep__meta`（作者/日期/版本）· `.rep__cap`（图表说明）·
`.rep__source`（来源脚注）· `.rep__note`（编者注）· `.rep__risk`（风险披露）

> ⭐ 为什么钉死六种：报告里每多一种"自创角色"，读者的解读负担就多一分。
> 发现自己在写第七种时，应该回头用**结构**（列表、表格、引用）而不是字号表达。

### 标记骨架

```html
<article class="rep rep--technical">          <!-- 或 rep--magazine / rep--finance -->
  <header>
    <p class="rep__kicker">栏目</p>
    <h2 class="rep__title">标题</h2>            <!-- 🔴 必须是 h2 -->
    <p class="rep__standfirst">导语</p>
    <ul class="rep__meta"><li>作者</li><li>日期</li></ul>
  </header>

  <div class="rep__grid">                      <!-- 正文 + 边注，窄屏自动堆叠 -->
    <div class="rep__body">
      <section class="rep__sec">
        <h3>小节</h3>                           <!-- 🔴 用 h3，不是 h4 -->
        <p>…</p>
        <figure class="rep__fig">
          <div id="chart"></div>
          <figcaption class="rep__cap">图说</figcaption>
        </figure>
      </section>
    </div>
    <aside class="rep__aside">短提醒 / 次要读数</aside>
  </div>
</article>
```

**只用两级标题**：`h2` 是文章标题，`h3` 是小节。出现第四级通常意味着该拆的是**文档**
而不是再给一级字号 —— 所以 CSS 里刻意没有 `h4` 的规则，没定义就是没定义。

## 二 · 三种版式的取舍

| | `rep--magazine` | `rep--technical` | `rep--finance` |
|---|---|---|---|
| **给谁看** | 通读一遍的人 | 要逐条核对的人 | 要快速比数字的人 |
| 正文行长 | 42em（最宽） | 34em | 30em |
| 正文字号 | 基准 | 基准 | 小一档（`--fs-sm`） |
| 行距 | 基准 | **最松**（`--lh-loose`） | 基准 |
| 图/表编号 | 不要 | **自动编号**（fig / tab 两路） | 不要 |
| 章节编号 | 不要 | 可选（默认开） | 不要 |
| 必有件 | 引语块 / 出血宽图 | 来源脚注 / 方法写明 | 关键数字条 / 风险披露 |
| **它放弃了** | 审计级追溯（没编号就引用不了"第几图"） | 快速通读（窄行长 + 松行距，读得慢） | 长论证（超过两屏的推理会被跳过） |

三种取舍都是**真取舍**，不是文案差异 —— 每一条都有门禁判据盯着：

- 正文行长按**各版自身字号**换算成 em 后必须严格递减（42 > 34 > 30）
- 文章标题字号必须真的随 profile 变化（金融版明显小于另两版）
- 金融版正文字号必须小于另两版；科研版行距比必须最松
- 编号必须是"该编号的有、不该编号的没有"（technical 的正文小节有、文章标题与边注标题没有）

### 编号：为什么用 CSS counter

```css
.rep--technical .rep__sec > h3::before { content: counter(rep-sec) ' · '; }
.rep--technical .rep__cap::before      { content: '图 ' counter(rep-fig) ' · '; }
.rep--technical .rep__cap--table::before { content: '表 ' counter(rep-tab) ' · '; }
```

写死编号会在改稿后全部错位；counter 由 CSS 自己维护。
**图与表走两路独立计数** —— "图 3"和"表 3"不是同一个东西。
表格说明加 `rep__cap--table` 即可；同一个标记在 financial 版里不出编号，
因为那是 **profile 说了算，不是标记说了算**。

## 三 · 与 `04-recipes/analysis-report` 的分工

| | `analysis-report` | `report`（本系统） |
|---|---|---|
| 是什么 | 一份**具体实例**（一种固定版式的完整页面） | 一套**版式系统**（共享基础 + 三种可选 profile） |
| 解决的问题 | 组合能力：正文 + 辅助栏 + 表格 + 图表怎么拼 | 取舍：同内容在三种阅读目的下各自长什么样 |
| 换版式 | 改 CSS | 只换 `rep--*` 一个类 |

**两者不互相替代。** 如果只需要一种固定版式，用 `analysis-report` 更省事；
需要"同一批内容按不同目的重新排"时，用本系统。

## 四 · 🔴 本轮明确不做

1. **分页 PDF / 印刷分页**：`@page` 页边距、页眉页脚、页码、跨页不断行、孤行寡行控制
   —— 全部不在本版范围内，它需要 `@page`、实物打样与 PDF 引擎验证。
   CSS 里只有 `@media print` 的**最小保障**（隐藏边注、图表与表格不跨撕裂），
   那是"不更糟"，**不是"能出版"**。
   门禁里有一条**反向判据**盯着这件事：`report.css` 一旦出现 `@page` 或
   `break-after: page` 就报红 —— 谁偷偷做了一半，谁这条就红。
2. **自动目录、脚注尾注、交叉引用、参考文献样式**：编号只做到"写第几就显示第几"，
   再往上的引用维护（"详见第 3 图"自动跟随）不支持。
3. **Markdown / 文档输入、CMS、多语言排版（竖排、RTL）**：不是本系统的目标。

## 五 · 已知限制（实测记录，不是"也许"）

- **边注列只有 14em（252px）**：正文 + 边注共享库的标准页宽 832px，
  取库默认的 `--measure-aside`（32em=576px）会把正文压到 **220px ≈ 12em**（一行 12 字，读不了）。
  ⇒ 就地收窄到 14em，正文恢复到 30em。**代价：边注装不下大图表** ——
  大图请放进正文流（`figure.rep__fig--wide`），不要塞进边注。
- **边注折叠在 62rem** 以下：窄屏没有边注，只有正文流。
- **CSS counter 的具体数字无法被自动断言**：`::before` 的生成文字既不在 DOM 里，
  也不在无障碍树里（实测 `accessibility.snapshot()` 抓不到）。
  门禁能验证的是「规则命中 + 用对了哪一路计数器 + 生成框真的占了像素」，
  **数字本身（"图 1"里的 1）属于未验证项**，不拿绿色冒充。

## 六 · 门禁

```bash
node 05-audit/report-check.js      # 单独跑
bash 05-audit/check-all.sh         # 全量
```

`report-check.js` 复用 `contract-kit.js`（通用 7 类判据）**加 17 条本系统专属判据**，
全部读**计算值/几何**而不是 CSS 文本 —— 因为"写了 ≠ 生效"在本系统上翻过车：
`.rep h2 / .rep h3`（特异度 0,1,1）曾经压过 `.rep__title`（0,1,0），
使 `--rep-title-fs` 静默失效、三套版式的标题被钉死在同一个字号。
