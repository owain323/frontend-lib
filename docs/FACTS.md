# 事实来源清单（G0-1）

> **这份文档登记"事实从哪来"，不登记"事实是多少"。**
> 数值只存在于一个地方：`05-audit/facts.json`（生成物）。
> 文档、README、`llms*.txt`、页面里出现的数字，全部由 `05-audit/facts-gate.py` 对着它核。

---

## 为什么需要这份清单

同一个数字在仓库里有多个"手抄本"，一定会漂。已经真实发生过四次：

| 时间 | 现象 | 根因 |
|---|---|---|
| 0.24.1 | `llms-full.txt` 第 13 行写 `# 39 components`，第 118 行写 `Components (40)` | 生成器里那行是**写死的字符串**，标题用的是 `len()` |
| 0.24.1 | `AGENTS.md` 第 3 行写 `39 components` | 手写文件，没有任何判据看着它 |
| 0.24.1 | 讨论文档写 pitfalls `19 + 12 = 31` | 实际 20 + 12 = 32，手抄 |
| 更早 | `llms.txt` 写 38 个组件，契约里 39 | 同类（`docs-site-gate` 判据②抓到） |

**共同点**：数字是人抄的，而人不会在每次加组件后回头改所有地方。

> 上面这张表是**历史记录**，它的数字描述的是"当时错成什么样"，不是当前值；
> 和 CHANGELOG 一样，不在判据范围内。当前值只有一个来源：`05-audit/facts.json`。

⇒ 纪律：**机器算得出来的，不许手写。手写只能写解释，不能写计数。**

---

## 一、事实清单（登记表）

"当前结果"一栏故意只写 `facts.json` 的键路径，不写数值——写数值就等于再造一个手抄本。

| # | 事实 | 唯一权威来源 | 提取方式 | 当前结果 | 谁在用 |
|---|---|---|---|---|---|
| F1 | 组件总数 | `ai/components.json` → `components[]` | `len()` | `components.total` | `llms.txt`、`llms-full.txt`、`AGENTS.md`、`index.html`、`404.html`、`guide/index.html`、`README.zh-CN.md` |
| F2 | 按层的组件数 | 同上 → `tier` | 分组计数 | `components.byTier` | 仅 `facts-gate` 打印（无对外声明） |
| F3 | 按成熟度的组件数 | 同上 → `maturity` | 分组计数 | `components.byMaturity` | `ai/components.meta.json` 的 strict 档说明 |
| F4 | 带行为层的组件数 | 同上 → `global` 非 null | 计数 | `components.withBehaviorLayer` | 暂无对外声明（预留给"行为层可选"类说明） |
| F5 | 翻车点总数（组件/布局/流程） | `ai/pitfalls.json` → `pitfalls[]` | `len()` | `pitfalls.total` | `llms-full.txt`（`Known failure modes (N)`） |
| F6 | 写作类翻车点数 | `ai/pitfalls-writing.json` → `pitfalls[]` | `len()` | `pitfallsWriting.total` | 同上（合并计数） |
| F7 | 翻车点合计 | F5 + F6 | 求和 | `pitfallsAll` | `llms-full.txt` |
| F8 | 运行时依赖数 | `package.json` → `dependencies` | `len()`，且必须为 0 | `dependencies.runtime` | README、`llms.txt` 的"零依赖"声明 |
| F9 | 开发依赖数 | `package.json` → `devDependencies` | `len()` | `dependencies.dev` | 暂无对外声明（讨论文档在仓库外） |
| F10 | 版本号 | `VERSION`（并与 `package.json.version` 互校） | 读文件 + 比对 | `version` | 全部生成物的版本戳 |
| F11 | CLI 子命令数 | `ai/cli.js` → `module.exports.CMDS` | `node -e` 取 `Object.keys()` | `cli.subcommands` | `llms.txt` 的用法段 |

---

## 二、三个环节，分别验

```
源文件 ──提取──> facts.json ──引用──> 对外声明
   │                  │                  │
   └─ ① 结构校验 ─────┴─ ② 现算比对 ────┴─ ③ 数字比对 + ④ 未登记扫描
```

| 判据 | 抓什么 | 在哪 |
|---|---|---|
| ① 源结构 | 缺字段 / id 重复 / 非法 `tier`·`maturity`·`scope` / 翻车点引用不存在的组件 / `VERSION` 与 `package.json` 不一致 / 出现运行时依赖 / `files` 漏了 `ai/` | `_facts.validate_sources()` |
| ② 现算 vs `facts.json` | "加了组件但没跑 `--write`" | `compare_facts()` |
| ③ 声明 vs 现算 | "文档里的数写错了"（报出文件、行号、两个值） | `_facts.check_claims()` |
| ④ 未登记扫描 | "新写了一句 `41 components`，没人管它" | 同上，`SCAN_FILES` |

**为什么 ②③④ 不能合并成一条**：`docs-site-gate` 的判据 ① 是「`llms-full.txt` 逐字节等于生成器输出」——它只能证明**文件与生成器一致**，不能证明**这个数是对的**。生成器写死一个错数，两边一起错，判据照样绿。**自证式判据只能证明"一起错"。**

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
5. 跑 `python 05-audit/facts-gate.py --write`，再跑 `python 05-audit/facts-gate.py`。
6. 在 `--selftest` 里补一条合成样本，证明新判据在该红时会红。
7. 更新本文件的登记表（只加行，不写数值）。

---

## 五、已知限制（不装作没有）

1. **未登记扫描只覆盖 `SCAN_FILES` 里的 8 个文件**。`docs/*.md` 里如果新写一句"40 个组件"，不会被抓。要扩就把文件加进 `SCAN_FILES`。
2. **数字与单位之间的形态有限**。目前认 `N components` / `N 个组件`。写成"四十个组件"或"4 打组件"抓不到。
3. **`facts.json` 本身可能被手改**。判据 ② 会抓（现算 ≠ 存储），但它不是加密的——能改文件的人也能改源码。这里防的是**疏忽**，不是**恶意**。
4. **CLI 子命令数依赖 `node`**。`node` 不可用时这条会抛错而不是跳过——宁可红，不要静默绿。
