# 事实来源清单（G0-1）

> **这份文档登记"事实从哪来、谁在核"，不登记"事实是多少"。**
> 数值只存在于一个地方：`05-audit/facts.json`（生成物）。
> 文档、README、`llms*.txt`、页面里出现的数字，全部由 `05-audit/facts-gate.py` 对着它核。

---

## 为什么需要这份清单

同一个数字在仓库里有多个"手抄本"，一定会漂。已经真实发生过五次：

| 时间 | 现象 | 根因 |
|---|---|---|
| 0.24.1 | `llms-full.txt` 第 13 行写 `# 39 components`，第 118 行写 `Components (40)` | 生成器里那行是**写死的字符串**，标题用的是 `len()` |
| 0.24.1 | `AGENTS.md` 第 3 行写 `39 components` | 手写文件，没有任何判据看着它 |
| 0.24.1 | 讨论文档写 pitfalls `19 + 12 = 31` | 实际 20 + 12 = 32，手抄 |
| 0.24.1 | `README.zh-CN.md` 写 `共 **37** 个（stable 37 …）` | 加粗写法让老正则失配；同文件另一处 `40 个组件` 是对的，于是"找到了数"就放行 |
| 0.24.1 | 两份 README 的组件表都只有 **37 行**，标题却写着 40 / 17 | 加组件时改了数字、没补表；中文那份连数字都没改 |
| 更早 | `llms.txt` 写 38 个组件，契约里 39 | 同类（`docs-site-gate` 判据②抓到） |

**共同点**：数字是人抄的，而人不会在每次加组件后回头改所有地方。

> 上面这张表是**历史记录**，它的数字描述的是"当时错成什么样"，不是当前值；
> 和 CHANGELOG 一样，不在判据范围内。当前值只有一个来源：`05-audit/facts.json`。

⇒ 纪律：**机器算得出来的，不许手写。手写只能写解释，不能写计数。**

---

## 一、事实清单（登记表）

"当前结果"一栏故意只写 `facts.json` 的键路径，不写数值——写数值就等于再造一个手抄本。

| # | 事实 | 唯一权威来源 | 提取方式 | 当前结果 | 对外声明形态 | 谁在核 |
|---|---|---|---|---|---|---|
| F1 | 组件总数 | `ai/components.json` → `components[]` | `len()` | `components.total` | **数字**：`llms.txt` ×2、`llms-full.txt` ×2、`AGENTS.md`、`index.html`、`404.html`、`guide/index.html` ×2、`README.md`、`README.zh-CN.md` ×2 | ③ |
| F2 | 按层的组件数 | 同上 → `tier` | 分组计数 | `components.byTier` | **数字 ×2 形态**：每个分节标题里的 `（17）`，以及该分节表格的**行数**（两份 README 各 4 层） | **⑤** |
| F3 | 按成熟度的组件数 | 同上 → `maturity` | 分组计数 | `components.byMaturity` | **数字**：`README.md` 的 `stable 40 / beta 0`、`README.zh-CN.md` 的 `stable 40` | ③ |
| F4 | 带行为层的组件数 | 同上 → `global` 非 null | 计数 | `components.withBehaviorLayer` | 无数字声明（`README` 只写"行为层是可选的"，不报数） | — |
| F5 | 翻车点总数（组件/布局/流程） | `ai/pitfalls.json` → `pitfalls[]` | `len()` | `pitfalls.total` | 无独立声明，只作为 F7 的加数出现 | — |
| F6 | 写作类翻车点数 | `ai/pitfalls-writing.json` → `pitfalls[]` | `len()` | `pitfallsWriting.total` | 同上 | — |
| F7 | 翻车点合计 | F5 + F6 | 求和 | `pitfallsAll` | **数字**：`llms-full.txt` 的 `Known failure modes (32)` | ③ |
| F8 | 运行时依赖数 | `package.json` → `dependencies` | `len()`，且**必须为 0** | `dependencies.runtime` | **散文断言**（"Zero third-party runtime dependencies"），没有数字可核 | **① 结构判据**：出现任何 `dependencies` 即红 |
| F9 | 开发依赖数 | `package.json` → `devDependencies` | `len()` | `dependencies.dev` | 无数字声明 | — |
| F10 | 版本号 | `VERSION`（并与 `package.json.version` 互校） | 读文件 + 比对 | `version` | **版本戳**（不是计数）：`llms-full.txt` 头部、`docs/ACCESSIBILITY.md`、每个 `guide/*.html` 页脚 | `bump-version.py --check` + `doc-facts-gate.py`；`facts-gate` 只做 `VERSION` ↔ `package.json` 互校 |
| F11 | CLI 子命令数 | `ai/cli.js` → `module.exports.CMDS` | `node -e` 取 `Object.keys()` | `cli.subcommands` | 无数字声明（`llms.txt` 列命令，不报个数） | — |

### 1.1 三种"没有数字声明"要分清楚

"这项事实没有消费者"和"这项事实没人看着"不是一回事。上表里 `—` 有三种不同含义：

| 情形 | 例子 | 靠什么保证 |
|---|---|---|
| 有断言、但断言里没有数字 | F8 零依赖 | ① 结构判据（`dependencies` 非空即红）—— 比核数字更硬 |
| 只有生成物在用、生成物本身派生 | F10 版本戳 | 生成器从 `VERSION` 取，天然同源；另有 `bump-version` 兜手写文档 |
| 真的没有对外声明 | F4 / F5 / F6 / F9 / F11 | 无。**这是已知空白，不是已覆盖** |

> ⚠️ 不要因为"11 项都提取了"就说"11 项都被校验了"。
> 提取覆盖 11 项；**声明校验只覆盖 F1 / F2 / F3 / F7 四项的数字形态，外加 F8 的结构约束**。

---

## 二、五个环节，分别验

```
源文件 ──提取──> facts.json ──引用──> 对外声明
   │                  │                  │
   └─ ① 结构校验 ─────┴─ ② 现算比对 ────┴─ ③ 数字比对 + ④ 未登记扫描 + ⑤ 清单核对
```

| 判据 | 抓什么 | 在哪 |
|---|---|---|
| ① 源结构 | 缺字段 / 字段类型错（`null`·数字·字符串冒充数组）/ 顶层不是对象 / id 重复 / 非法 `tier`·`maturity`·`scope` / 翻车点引用不存在的组件 / `VERSION` 与 `package.json` 不一致 / 出现运行时依赖 / `files` 漏了 `ai/` | `_facts.validate_sources()` |
| ② 现算 vs `facts.json` | "加了组件但没跑 `--write`" | `compare_facts()` |
| ③ 声明 vs 现算 | "文档里的数写错了"（报出文件、行号、两个值） | `_facts.check_claims()` |
| ④ 未登记扫描 | "新写了一句 `41 components`，没人管它" | 同上，`SCAN_FILES` |
| ⑤ 清单核对 | "标题数字改了、表格没改"／"表格行数对、内容里有个不存在的组件"／"中文写着 15、英文写着 17" | `_facts.check_listings()` |

**为什么 ②③④⑤ 不能合并成一条**：`docs-site-gate` 的判据 ① 是「`llms-full.txt` 逐字节等于生成器输出」——它只能证明**文件与生成器一致**，不能证明**这个数是对的**。生成器写死一个错数，两边一起错，判据照样绿。**自证式判据只能证明"一起错"。**

**为什么 ③ 还要配上 ⑤**：0.24.1 的英文 README 标题写 `primitives (17)`（对）、表格只有 15 行。③ 只看那个 17，看不见表格；⑤ 数两半。反过来，中文 README 是标题 15、表格 15 行——③⑤ 都能抓 ⑤ 更准。**一条判据只能看见它量的那个东西。**

---

## 三、什么不算事实（明确排除）

| 排除项 | 为什么 | 该去哪 |
|---|---|---|
| 门禁道数 | 运行时统计，随分层模式变化（`--fast` 只跑静态+视觉，`full` 跑全部），不是仓库常量 —— **本文档不写这个数** | 运行时打印 |
| `stable` 到底保证了什么 | 是契约语义，不是一个数 | `ai/components.meta.json` 的 `maturityCriteria` + `docs/STABILITY.md` |
| "是否经过真机验证" | 是证据状态，不是计数 | `docs/ACCESSIBILITY.md`、讨论文档的 UNKNOWN 区 |
| 体积（145.1 KB / 172 KB） | 由 `perf-gate.py` + `budget.json` 管，已有独立账本 | `docs/BUDGET.md` |
| 源码行数、文件数 | 随重构波动，没有对外声明依赖它 | 不登记 |
| CHANGELOG 里的历史数字 | 历史记录，改了就是篡改 | 不扫描 |

**注释/文档字符串里的数字也不在判据范围内**（例如 `gen-docs.py` 顶部还写着"35 个组件的 README"）。判据只管**对外声明**；注释漂移不影响读者，但要改就顺手改，不要为了它加一条判据。

---

## 四、新增一项事实的步骤

1. 确认它是**机器能可靠算出来的**。算不出来的，别加（见第三节）。
2. 在 `05-audit/_facts.py` 的 `collect()` 里加一个键，值从源文件现算。
3. 在 `validate_sources()` 里加对应的结构约束（否则源坏了会静默算出错数）。
4. 如果它有对外声明，在 `CLAIMS` 里登记**位置**（文件 + 正则），不登记数值。
5. 如果是"标题 + 清单"这种成对出现的声明，登记到 `TIER_HEADINGS` / `LISTING_FILES`。
6. 跑 `python 05-audit/facts-gate.py --write`，再跑 `python 05-audit/facts-gate.py`。
7. 在 `--selftest` 里补一条合成样本，证明新判据在该红时会红。
8. 更新本文件的登记表（只加行，不写数值）。

---

## 五、已知限制（不装作没有）

1. **未登记扫描只覆盖 `SCAN_FILES` 里的 8 个文件**。`docs/*.md` 里如果新写一句"40 个组件"，不会被抓。要扩就把文件加进 `SCAN_FILES`。
2. **数字与单位之间的形态有限**。认这些：
   - `N components` / `N 个组件`
   - `共 N 个`，**且 `个` 后面紧跟括号 / 句读 / 行尾**（`共 40 个（stable…）`、`共 37 个。`）
   - `stable|beta|alpha N`
   - 以上都容忍 Markdown 的 `**` `_` 反引号包在数字前后

   不认："四十个组件"、"4 打组件"。
   故意不认 `共 3 个步骤` 这类——`个` 后面接的是名词，省略的不是"组件"；
   把它算进来会让「装好需要 3 个步骤」这种句子误报。要报数就写 `N 个组件`。
   也故意不认 `一共就这么 37 个`——`共` 与数字不相邻就不算声明。
3. **清单核对只覆盖两份 README**。`guide/*.html` 里的组件表是 `gen-docs.py` 生成的，与契约同源，不重复登记。
4. **清单只比 id 集合，不比顺序**。顺序是排版偏好（两份 README 都按字母排，但不是事实）。
5. **`facts.json` 本身可能被手改**。判据 ② 会抓（现算 ≠ 存储），但它不是加密的——能改文件的人也能改源码。这里防的是**疏忽**，不是**恶意**。
6. **CLI 子命令数依赖 `node`**。`node` 不可用时这条会抛错而不是跳过——宁可红，不要静默绿。
