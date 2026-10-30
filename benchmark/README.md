# 兼容性 Benchmark

> 用途：**用数据决定什么时候该放宽约束、什么时候该收紧。**
> 没有它，"该不该放宽"就会变成一场谁也说服不了谁的争论。

---

## 一、它回答什么问题

约束加下去之后，一定会有人问：

> 「这条约束是不是挡住了本来正确的编辑？」
> 「模型变强了，这条还必要吗？」

这两个问题**不能靠讨论回答**，只能靠跑数：

- **挡住正确编辑** ⇒ 误报率上升 ⇒ 该放宽（或把那条从 Contract 移到 Guidance）
- **没挡住任何东西** ⇒ 约束力可疑 ⇒ 要么判据写错了，要么它已经不需要了
- **两种都没有** ⇒ 保持现状

⇒ 三种结论都对应明确动作。**这就是 Benchmark 存在的理由。**

---

## 二、当前状态（诚实说明）

| 项 | 状态 |
|---|---|
| 任务集 | ✅ 10 个，覆盖六类真实编辑意图 |
| **参考解法的确定性断言** | ✅ 每次都能跑，已接 `npm run benchmark` |
| **跑批记录的形状校验** | ✅ `--check-records`，八条判据，已接门禁 |
| **「记录 → 评分」管线** | ✅ `models/reference.json`（参考解法，非模型）必须 10/10，已接门禁 |
| **真实模型跑批** | ❌ **一次都还没跑 —— 状态是 UNVERIFIED，不是 PASS** |

⚠️ 我没有模型 API 的访问权限，**所以这里没有任何模型跑分数据**。
我不会编一个数字出来 —— 那样这份 Benchmark 就失去全部意义了。

`benchmark/models/` 里目前只有一份 `reference.json`，
它是**参考解法自己的记录**（`model` 字段写的就是"参考解法（不是模型）"）。
它存在的唯一目的：证明"记录 → 评分"这条管线是通的 ——
管线自己都跑不满分时，任何模型的分数都不值得相信。

⚠️ `--check-records` 在**零模型记录**时输出 `UNVERIFIED` 且 RC=0。
这句话的意思是「没有坏记录」，**不是**「模型已验证」。
两者混为一谈，就是本项目最常登记的那类假绿。

---

## 三、怎么跑

```bash
npm run benchmark                        # 只跑参考解法的确定性断言
node benchmark/run.js --json             # 输出 JSON
node benchmark/run.js --record gpt-x     # 记录某个模型的跑批 ⇒ 输出**分布**
node benchmark/run.js --check-records    # 校验 models/ 下全部记录（门禁跑这条）
node benchmark/run.js --selftest         # 校验器的反向控制（八条判据各注入一次）
node benchmark/run.js --write-reference  # 由 TASKS 重新生成参考记录
```

⚠️ `--record <名字>` 在 `benchmark/models/<名字>.json` 不存在时是 **RC=2**。
旧版只打一行 `[WARN]` 就 RC=0 —— 那等于"声称跑了批，其实没跑"，
是这套工具里最典型的一处假绿，已修。

---

## 四、怎么给一个模型跑批

1. 建 `benchmark/models/<模型名>.json`（**v2 格式**）：

```json
{
  "schemaVersion": "2.0.0",
  "model": "示例模型",
  "modelVersion": "2026-01",
  "recordedAt": "2000-01-01",
  "settings": { "temperature": 0.2, "structuredOutput": true },
  "declaredCapabilities": {
    "structuredOutput": true,
    "toolCalling": true,
    "visualInspection": false,
    "patchEditing": true
  },
  "attemptsPerTask": 20,
  "runs": [
    { "task": "T01", "attempt": 1, "patch": { "ops": [ ... ] } },
    { "task": "T01", "attempt": 2, "patch": { "ops": [ ... ] } }
  ]
}
```

2. 跑 `node benchmark/run.js --record <模型名>`
   ⇒ 打印**每个任务 通过次数/总次数**的分布，并写 `benchmark/results/<模型名>.json`

### 为什么 v2 强制这些字段

| 字段 | 缺了会怎样 |
|---|---|
| `schemaVersion` | 不知道记录是哪个判据版本跑的，没法与别的记录比 |
| `modelVersion` | **不可复现**：同一个模型名的两个快照分数差很远，而记录说不清是哪个 |
| `recordedAt` | 无法判断"这条约束是不是在模型升级后还必要" |
| `attemptsPerTask` | 单次结果是抽样；缺了就只能拿抽样冒充分布 |
| `attempt` 编号 | 缺了分不清"20 次里过了 18 次"和"记了 18 条" |

`--check-records` 会逐条核对这八条判据（含 attempt 必须覆盖 1..N 不重不漏）。
`--selftest` 逐条注入反例，证明每条判据都会红。

⚠️ **同一任务要跑多次**（建议 ≥ 20 次）。

理由：单次结果是**抽样**，模型输出有随机性；
跑 20 次得到的是**分布**，才能区分"这条约束偶尔误报"和"它一直误报"。
只跑一次就下结论，跟不跑区别不大 —— 而且更容易误导。

---

## 五、判据

| 判据 | 含义 | 动作 |
|---|---|---|
| 参考解法全过 | 契约层本身没坏 | —— |
| 模型通过率 ≥ 95% | 约束没挡住正确编辑 | 可考虑放宽 |
| 模型通过率 < 70% | 约束在挡路 | 查是哪一条，降级或改判据 |
| 某个任务**所有模型**都失败 | 判据可能写错了 | 先怀疑判据，不要先怀疑模型 |

⇒ 最后一条最重要：**大家都过不了的任务，通常是任务本身有问题。**
   先怀疑自己的量具，这是本项目反复学到的东西。

---

## 六、十类任务

| # | 意图 | 它盯着的失效模式 |
|---|---|---|
| T01 | 改一处文本 | 改一处动了别处 |
| T02 | 改一处字号 | 写出页面级 override 链 |
| T03 | 移动节点 | 移动时把内容丢了 |
| T04 | 删除节点 | 父引用没摘掉 ⇒ 悬空引用 |
| T05 | 换主题（套一组令牌） | 引入裸颜色、绕过令牌 |
| T06 | 新增节点到指定位置 | 挂错父节点 |
| T07 | 批量改 5 处文本 | 部分成功部分失败 ⇒ 半改状态 |
| T08 | 把 beta 组件换成 stable | 用了没验证过的组件 |
| T09 | strict 档下用 beta 组件 | 该被拒却没被拒 |
| T10 | 携带未来的 extensions | 旧校验器判文档非法 ⇒ 前向兼容失效 |

---

## 七、第二组：真实页面生成（P01–P10）

上面 T01–T10 测的是**契约层**——Patch 能不能正确应用到组件骨架。
它们**回答不了**这个问题：模型用这个库生成的**页面**，在真实视口里能不能成立？

一个模型可以完美通过 T01–T10，同时产出一张 393px 横向溢出、暗色下对比度不足的页面。
**契约合规 ≠ 页面合格。**

P 组的十个任务、判据映射、对照实验协议（A/B/C 组）、记录格式与统计口径见
[`REAL-PAGE-TASKS.md`](REAL-PAGE-TASKS.md)。

评分器（对任意生成出来的 HTML 打分，不需要模型就能自检）：

```bash
node benchmark/score-page.js 04-recipes/table/demo.html --text
node benchmark/score-page.js --selftest      # 反向控制
```

**状态**：`BLOCKED_EXTERNAL_MODEL_ACCESS` —— 任务集、评分器、记录格式都已就绪，
缺的只有模型调用凭证。这道缺口由 `benchmark-records` 门禁盯着，它输出
`[UNVERIFIED]` 并返回 3（SKIP），不会被读成通过。
