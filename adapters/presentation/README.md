# Presentation Adapter（呈现适配层）

> **这一层刻意在核心库之外。**
> 核心（`01-tokens` ~ `04-recipes`、`ai/`）里**没有**任何 slide / deck / page 的概念。

---

## 一、为什么 PPT 语义不进核心

一次真实事故：用本库做 14 页 PPT，AI 反复局部修改后整体崩坏，
人工修 1.5 小时仍未收口。

复盘时最容易得出的结论是「核心库要懂 PPT」——**这个结论是错的**。

理由：

| 如果进核心 | 后果 |
|---|---|
| 核心要知道"一页是什么" | 核心就从「组件库」变成「演示文稿引擎」 |
| 核心要知道"一页能放几个元素" | 这个数字每换一种呈现形态（报告 / 海报 / 长图）就不一样 |
| 核心要处理"翻页" | 翻页跟组件没有任何关系 |

⇒ **呈现形态是会变的，组件是不变的。把易变的和不变的绑在一起，两边都动不了。**

真正该做的是：**让核心提供一个稳定底座，让呈现语义挂在外层。**

---

## 二、怎么挂：用 `extensions`

核心契约 `ai/contract.schema.json` 给每个节点和整个文档留了 `extensions`：

```json
{
  "id": "title-1",
  "kind": "text",
  "text": "季度复盘",
  "extensions": {
    "presentation": { "slide": 1, "role": "title" }
  }
}
```

关键性质：

- **核心校验器看到 `extensions` 就忽略**，既不报错也不读取。
  ⇒ 核心不需要知道 PPT 存在。
- **本适配器读取 `extensions.presentation`**，做呈现特有的检查。
- ⇒ 两边通过**数据**耦合，不通过**代码**耦合。

这不是"为了优雅"，是为了**前向兼容**：

> 一个旧版核心遇到 `extensions.presentation` 不会判文档非法；
> 一个新版本核心也不会因为多了一种呈现形态就要改自己的 schema。

---

## 三、用法

```bash
# deck → 核心契约文档（丢掉呈现语义，剩下纯组件结构）
node adapters/presentation/to-doc.js deck.json -o doc.json

# 用核心校验器校验（它会忽略 extensions）
node ai/cli.js check doc.json --profile=standard

# 呈现特有的检查（每页元素数、标题层级、字号下限）
node adapters/presentation/check.js deck.json
```

---

## 四、这一层负责什么，不负责什么

| 负责 | 不负责 |
|---|---|
| slide / deck 的语义 | 组件长什么样（核心的事） |
| 每页元素数量、层级结构 | 颜色令牌（核心的事） |
| 呈现形态特有的约束 | 无障碍（核心的事，且**任何形态下都要成立**） |
| — | **"改一处全局，N 页是否跟着变"**（那是页面骨架的事：`01-tokens/page.css` + `shell` / `skel-lever` 两道门禁） |

⚠️ **无障碍不因呈现形态而打折。** 一页 PPT 也是给人看的，
对比度、焦点可见、键盘可达在任何形态下都要成立 —— 这是核心的事，
本层不能为了"好看"把它绕过去。

---

## 五、这些检查有人跑吗

🔴 曾经没有。`check.js` 的五条判据从写下到 0.4.2 之前，**一次都没被执行过** ——
README 说有，实际没人跑。这是最隐蔽的一种假绿：它连"通过"报告都不产出。

现在有 `05-audit/presentation-gate.py`（已接入 `check-all.sh`）：

| 判据 | 怎么验 |
|---|---|
| 合规 deck 必须过 | `fixtures/deck-ok.json` ⇒ check.js exit 0 |
| 违规 deck 必须红 | `fixtures/deck-bad.json` ⇒ exit ≠ 0 |
| **五条判据各命中一次** | 少一条就红 ⇒ 判据被删/被改文案会立刻暴露 |
| 两个真值源不漂移 | `check.js` 的 `MAX_PER_SLIDE` 必须等于 `deck.schema.json` 的 `nodes.maxItems` |
| 门禁自己也会失效 | `--selftest`：把上限放宽到 999、去掉 `.slide-` 正则、把 schema 改成 8 ⇒ 门禁必须认出判据已失效 |

自测：

```bash
python 05-audit/presentation-gate.py            # 正常跑
python 05-audit/presentation-gate.py --selftest # 反向控制
```

## 六、如果以后要加别的形态

照这个目录再加一个 `adapters/<形态>/`，同样用 `extensions.<形态>` 承载。
**核心不需要改一行代码** —— 这就是它被分出来的全部意义。
