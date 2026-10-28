# 无障碍

目标等级是 **WCAG 2.2 AA**。本文说清三件事：**验过什么、怎么验的、还差什么**。
没说到的，就当作没验过 —— 这份文件的用处是让人不必猜。

## 一 · 已验证的范围

最近一次运行（`node 05-audit/a11y-scan.js`）：

| 项目 | 手段 | 结果 |
|---|---|---|
| 自动审计 | `axe-core`，跑 18 个页面（组件 demo + 文档页 + 长文页） | **0 类违规 / 991 条规则通过**；另有 **9 处**标记「待人工」 |
| 「0 违规」可信吗 | 反向控制：注入 5 类典型违规，看它抓不抓得到 | 5 类全部抓到。**没有反向控制的 0 违规不算证据** |
| 对比度（浅色） | `contrast.py` 从 `tokens.css` 读实色值逐对计算 | 正文 ≥ 4.5:1、控件边界 ≥ 3:1、装饰线不强制 |
| 对比度（暗色） | `dark-contrast.js` 单独算一遍 | 同上；暗色不是浅色取反，独立验收 |
| 组件级对比度 | `component-contrast.py` | 每个组件自己的配色再算一次 |
| 焦点可见 | `focus-ring-check.js` | 有焦点环，且不是 `outline: none` 代替品 |
| 焦点归还 | `focus-return-check.js` | 关闭弹层/抽屉后焦点回到触发元素 |
| 键盘可达 | `keyboard-nav.js` | Tab 顺序、Esc 关闭、不困在浮层里 |
| 触控目标 | `a11y.py` + 行为脚本 | 热区 44×44（WCAG 2.5.5） |
| 减少动效 | `motion.py --reduced-audit` | 位移关、真实进度留（3 处登记例外）、双向核对 |
| 页面结构 | 文档站门禁逐页判 | 每页有 `lang`、单一 `h1`、`main`、跳转链接、无重复 `id` |

目标尺寸、对比度阈值、动效分档这些**规则本身**写在
[全局约定](CONVENTIONS.md) 里，这里只报结论。

## 二 · 已知缺口

这一节比上一节重要。以下都是**没做到**的，不是"应该没问题"：

1. **没有真机读屏记录。** NVDA、VoiceOver、TalkBack 一个都没录过。
   axe 只覆盖 WCAG 问题的约 30–40%，它查不出"alt 写得有没有意义""阅读顺序对不对"
   "屏幕阅读器实际听到的是什么"—— 那几项只能用耳朵听。
   所以本库目前能说的是「**自动检查能覆盖的部分是干净的**」，不能说得更多。
2. **RTL 只有静态检查。** 交付 CSS 里物理方向属性 0 处、全部逻辑属性（`rtl-check.js` 守），
   但没有一张 `dir="rtl"` 的渲染基线，也没跑过阿拉伯语/希伯来语的文字膨胀案例。
3. **强制色板（forced-colors）只覆盖了一部分。** 6 个 CSS 写了
   `forced-colors` / `prefers-contrast` 的处理，不是全部组件。
   Windows 高对比度模式下的表现没有逐组件验证。
4. **Android 系统 WebView 未验证。** 真机矩阵里它是 ❌（见
   [浏览器支持矩阵](../SUPPORT.md)），已验的是微信内置内核、iOS/macOS Safari 等 7 行。
5. **没有 VPAT / ACR 正式符合性报告。** 采购流程里要的那种文档，本库没有出。
6. **9 处「待人工」还没有人工结论。** 自动审计把它们标出来了（需要人判断，
   比如图表的替代文本是否描述了数据），目前仍挂着。

## 三 · 怎么自己验

```bash
# 单个 demo 页的可访问性（结构、语言、标题层级、跳转链接…）
python3 05-audit/a11y.py 02-primitives/button/demo.html

# axe 审计（跑全部已登记的页面）
node 05-audit/a11y-scan.js

# 证明上面那个"0 违规"不是因为没查
node 05-audit/_a11y-reverse-control.js

# 亮色 / 暗色两套对比度
python3 05-audit/contrast.py
node 05-audit/dark-contrast.js

# 键盘与焦点
node 05-audit/keyboard-nav.js
node 05-audit/focus-ring-check.js
node 05-audit/focus-return-check.js
```

`python3 05-audit/a11y.py --dir .` 会连 `node_modules` 一起扫，
那里面的第三方 HTML 会报一堆与你无关的问题 —— 门禁里用的是逐目录调用，别用 `--dir .`。

## 四 · 报告问题

无障碍问题按**缺陷**处理，不按"改进建议"处理：请开 issue 并写清
**控件 + 输入方式（键盘 / 读屏 / 触摸）+ 期望行为**。
已知缺口里列的那些（读屏实测、RTL 渲染、高对比度）如果能提供你机器上的
实际结果，比任何自动化都值钱。
