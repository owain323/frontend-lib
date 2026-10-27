# 待办与判定台账（BACKLOG）

> 这份文件只回答三个问题：
> **① 那些"好想法"哪些已经落地、由什么守着；② 哪些裁定不做、什么条件下重开；
> ③ 哪些是环境边界（不是待办，别再当 TODO 挂着）。**
>
> 它的存在理由：这些结论原本散在四份报告里（交付报告 / huxx 借鉴评审 /
> 合并评审 / 交接单），要翻完才知道还剩什么。于是同一件事被反复讨论、
> 已被判"不做"的又被重新提出来做一遍。
>
> ⚠️ **本文件不写会变的数字**（门禁数、自检数、组件数）。要给数字，
> 就跑对应的门禁看它的输出 —— 数字只有运行时一个出处（I-7）。

---

## 一、已落地（每一项都有门禁守着，不是"写过"）

| 能力 | 落点 | 守着它的判据 |
|---|---|---|
| 入场动效（六方向、位移 ≤8px、默认不接管、只播一次） | `03-patterns/reveal/` | `reveal-contract.js`（10 条）+ `motion.py --reduced-audit` |
| 减少动效三档（位移必停 / 真实进度必留 / 颜色压到 `--dur-fast`） | `01-tokens/` 令牌层一条覆盖规则 | `motion.py`（三向核对，非文件计数） |
| 详情页三变体（full / partial / null 同构） | `04-recipes/detail-page/` | `detail-page-contract.py`（标签序列逐项比对 + 视觉覆盖） |
| 无数据是一等状态（不隐藏、不拿 0 冒充、必须给理由、版面不塌） | 同上 `null.html` | `no-data-gate.py` |
| 新页面必须进视觉基线（防"新配方无人看管"） | `05-audit/visual-coverage-gate.py` | 自身 `--selftest` + 反向控制 |
| 视觉基线防"改注释也算变更" | `shot-baseline.py` 的 `css_fingerprint()` | 剥注释/去空行后再哈希 |
| 包内闭包 + 消费者侧解析 | `pack-closure.js` / `entry-resolve.js` | `pack-closure` / `pkg-resolve`（判"消费者真去解析"） |
| 自动初始化写成契约（每个全局逐个写明 是 / 条件 / 否） | `API.md`「自动初始化」+ 源码 `@autoinit` 标记 | `autoinit-gate.py`（三条判据，双向） |
| 门禁自己也要有牙（反向控制被真的跑到） | `behavior-reverse.sh` + `selftest-all.py` | `selftest-all`（元门禁）+ `selftest-all-rev` |
| 文档事实与仓库一致（组件数 / 门禁数 / stable·beta） | `05-audit/doc-facts-gate.py` | 自身 `--selftest` |
| 真机能力矩阵（每一行都是 VERIFIED） | `docs/LAYER-BASELINE.md` | `webview-probe-gate.py`（清单与源码双向） |

---

## 二、本轮（autoinit 契约那一轮）做的事

| 事 | 性质 | 证据 |
|---|---|---|
| `selftest-all` 自备 `:8000`（canary 字节比对 + 退出时关掉） | **修真实缺陷**：fast 档无服务 ⇒ 一条自检假红，红的原因与检查内容无关 | `python 05-audit/selftest-all.py` → 全部通过 |
| 判定抽成 `verdict()` + 判据 ④「跑不起来 ≠ 通过」 | 新增牙：`RC=0` 但输出说跑不起来，判红 | 自带 `--selftest` 样本 |
| `dead-class-gate --selftest` 接进 `behavior-reverse.sh` | 补 P2 欠账：它有自检但**从没被跑过** | `behavior-reverse.sh` |
| 自动初始化契约 + `autoinit-gate` | 把 P3 的误判转成真闭环：**不改行为**，只补文档与判据 | 每个破坏样本都判对 |
| `CONTRIBUTING` 两处过时数字 | 一处被 `doc-facts` 抓到，一处（散文标题 `159 道`）判据够不着 ⇒ 改成不写数字 | `doc-facts-gate` 绿 |
| `ERRORS.md` E56 / E57 | 判据前提要自己造；注释不写会变的数量 | 台账 |

---

## 三、裁定不做（附重开条件）

| 事项 | 为什么不做 | 什么条件下重开 |
|---|---|---|
| **T4 全局事件总线** | 没有第二个消费者（图表不订阅主题切换）。为一个假想消费者加全局单例，是把"零依赖"换成"零依赖但有隐含全局状态" | 出现**第二个真实消费者**（例如表格排序要通知图表重绘），且实现 ≤30 行 |
| **View Transitions** | 真机基线含 **Chromium 97**（百度浏览器），而它要 111+。收益是"更好看"不是"更能用" | 有 Chromium 97–111 区间的实测基线，且能给出降级路径 |
| **装饰层兄弟门禁**（`deco-sibling`） | 库里只有 **1 个**装饰层节点（`.detail-hero__deco`），且它已经做对了（`pointer-events:none` + `aria-hidden` + 空 div）。门禁判据只能靠 `deco` 这个**命名约定**触发 —— 第二个人把那层叫 `.hero__glow` 就漏了。**靠命名的守卫是弱判据**，不如不建 | 出现第 2 个装饰层，且命名不统一 ⇒ 改成**形态判据**（绝对定位 + 覆盖父容器 + 无文本/无交互子树），不再看名字 |
| **滚动位置还原**（S5） | 实测三组 A/B/C 全部 `1600 → 1600`：桌面 Chromium 后退走 **bfcache** 整页恢复，脚本那段根本不需要跑。按"无法实测不合并"回退，没有留死代码 | 有**不走 bfcache** 的目标（旧 WebView），或页面返回后必然重渲染 |
| **给 9 个 create-only 组件加自动初始化**（P3 的 A 方案） | 自动初始化拿不到 `options` ⇒ 给一个"看起来能用、行为不对"的默认实例，比不初始化更坏；且会与用户手写的 `create` **双初始化**（双重事件、泄漏） | 组件出现"零配置也能正确工作"的形态（例如全部改由 `data-*` 驱动），且能给出去重机制 |
| **把散文里的数字也纳入 doc-facts** | 实测全库 6 处「NNN 道」，其中 4 处是**历史事故记录**（本来就是旧数字，改了才是篡改）。扩宽正则只会误伤历史叙述 —— 判据咬错人比不咬更坏 | 文档里出现"当前值"与"历史值"可区分的写法约定（例如统一 `@fact:` 标记），再据标记判 |

---

## 四、环境边界（不是待办，别再挂 TODO）

这三件事**代码侧已经就绪或已到边界**，缺的是外部条件。写在这里是为了
下次不再重新讨论一遍"要不要做""是不是没做"。

### 4.1 真机覆盖：只到现有矩阵，不再扩

| 已有（全部 VERIFIED） | 缺口 |
|---|---|
| iPhone Safari / iPad Safari / iPad 微信 / iPad 企微 / Android 微信（XWEB 146）/ Android 百度浏览器（Chromium 97） | Android **系统浏览器 / 其它 App 内置内核**（抖音、小红书、支付宝…） |

**为什么不再扩**：国内环境下拿不到稳定的 Android 系统浏览器与 Google 组件，
云真机又要实名与费用；使用者能提供的机器已经全部采过。

**在现有条件下已经做到了什么（这些不需要新设备）**：

1. **语法下限**：`es5-gate.py` 保证库代码不会用到 Chromium 97 不认识的语法。
2. **特性探测而非 UA 猜测**：`@layer` 不可用时整层回退（`LAYER-BASELINE.md` 已记录
   Chromium 97 **不支持 `@layer`** 这条阻塞项，并按"每一行都通过才无条件切"处理）。
3. **能力探针页可复用**：`10-review/webview/capability-probe.html` 是自包含的，
   任何人用手机自带浏览器打开就能采一行；采集结果按 `LAYER-BASELINE.md`
   的表头填（必须写清**从哪个入口**打开）。
4. **不虚构结论**：没有实测的内核一律标 `UNVERIFIED`，不写成"应该没问题"。

### 4.2 npm 发布

代码与发布脚本已就绪（`05-audit/publish.sh`，`.npmrc` 钉官方源）。
缺的是账号 + 2FA 的人工动作。**注意历史坑**（`ERRORS.md` E55）：
publish 返回 0 之后 registry 可能仍显示旧占位，**不要据此删包**。

### 4.3 W13 真模型跑批

工具链封闭（记录 v2 / 八条判据 / `models/reference.json` 必须 10/10），
**记录数 0 ⇒ UNVERIFIED**。缺的是模型 API 访问权。现有结论（"一次生成半分到
一毛钱，瓶颈是轮次不是 token"）来自人工实测，不是跑批。

---

## 五、如果还要往前推，按性价比排序

| 顺序 | 事项 | 为什么值得 | 前置 |
|---|---|---|---|
| 1 | **把 `docs/ROADMAP.md` 的评分表按真值重写** | 它现在还写着「运行时描述符比对待做（W3）」「npm ci + WebKit 待做（W7）」「事实门禁待做（W4）」，而这三项**实测都已完成**（`api-form-gate` 消费 `global-api-probe`；CI 有 `npm ci` + nightly webkit 矩阵；`doc-facts-gate` 在跑）。过时的路线图会让下一个人重做一遍 | 无 |
| 2 | 真机矩阵补一行（任何人的手机自带浏览器） | 成本 5 分钟，直接减少一个 `UNVERIFIED` | 一台能扫二维码的手机 |
| 3 | 把 `capability-probe` 的采集流程写成一页 SOP | 现在采集格式只写在表格里，靠人猜 | 无 |
| 4 | 次要：`ERRORS.md` 按"触发面"重新索引 | 查"我是不是又要犯某条"很不方便 | 无 |

---

## 六、怎么复查这份台账

```bash
cd <仓库根>

# ① 已落地的东西还在不在（全量，约 10 分钟）
MODE=full bash 05-audit/check-all.sh

# ② 判据有没有牙（含本轮新增的 autoinit / selftest-all / dead-class）
python 05-audit/selftest-all.py
bash 05-audit/behavior-reverse.sh

# ③ 文档说的和仓库是不是一回事
python 05-audit/doc-facts-gate.py
python 05-audit/autoinit-gate.py
```

**判定纪律**：本文件里说"已落地"的条目，如果哪天门禁红了，以门禁为准 ——
台账只是索引，不是证据。
