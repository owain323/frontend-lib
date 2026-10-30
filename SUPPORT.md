# 浏览器支持矩阵

> ⭐ 这份文件的作用是**诚实**。
> 定位里写了「移动 Web」，就必须说清楚**哪些是验证过的、哪些没有**。
> 没验证的不要写成支持的。
>
> 🔴 2026-10-09 更正：
>   这一页以前写着「桌面 Firefox ✅ 已验证」和「自动化跑的是桌面 Firefox」——
>   **两句都与事实不符**。当时的统一启动器只会找 Chromium，
>   Firefox 从来没被启动过一次。
>   ⇒ 这比"没验证"更糟：它给了一个**错误的**证据来源，
>     读者会以为"至少 Firefox 跑过了"。
>   现在引擎是真的切换了，并且每个作业都要**自己报 UA** 自证（见下）。
>
> 🔴 2026-10-30 更正（反方向）：
>   这一页曾把桌面 Firefox 标成 ⚠️，理由是「没装 firefox 时门禁显式 SKIP」。
>   **那句推测是错的**：CI 的 `浏览器矩阵（firefox）` 作业一直在跑，而且是绿的
>   （UA 自报 `X11; Linux x86_64; rv:155.0 Gecko/20100101 Firefox/155.0`）。
>   ⚠️ 与 ❌ 都会低估覆盖面，和 ✅ 高估一样是失真。

## 状态定义

| 标记 | 含义 |
|---|---|
| ✅ 已验证 | 有自动化检查覆盖，且**跑的就是这个引擎**（有 UA 证据） |
| ⚠️ 部分验证 | 只覆盖了部分功能或部分视口 |
| ❌ 未验证 | **没有在真实环境跑过** |

---

## 自动化覆盖的环境

下面这张表由 `05-audit/engine-gate.js` 在本机跑出来：`node 05-audit/engine-gate.js`。
产物是**你这台机器**的结果，不入库，也不该入库 —— 别人的环境不是你的环境。

| 平台 | 引擎 | 状态 | 覆盖内容 |
|---|---|---|---|
| 桌面 | Chromium | ✅ | 全部组件契约、暗色对比度、响应式三档、视觉回归 |
| 桌面 | WebKit | ✅ | nightly 矩阵的组件契约（select / combobox / date-range / overlay / tree / dropdown / popover / tooltip） |
| 桌面 | Firefox | ✅ | 与 WebKit 同一批组件契约（select / combobox / date-range / overlay / tree / dropdown / popover / tooltip），CI 作业自报 Gecko UA；另外 8 个组件（accordion / drawer / table / tabs / choice / input / overlay / dropdown）用 `FL_ENGINE=firefox` 在本机复跑同样全绿 |

### 🔴 怎么知道"跑的真的是这个引擎"

光有 `matrix.engine` 不够 —— 它以前只用在 `npx playwright install` 那一步，
测试启动器根本没收到 ⇒ 三个作业跑的都是 Chromium。
所以现在有两道独立的证明：

1. **每个作业自证**：`FL_ENGINE=… node 05-audit/engine-probe.js`
   站起来报一次自己的 UA，并校验 UA 属于声明的引擎族。
   （⚠️ Chromium 的 UA 里**也含** `AppleWebKit` ⇒ 只判子串会把 Chromium 认成 WebKit，
   判据必须同时排除 `Chrome/` 与 `HeadlessChrome`。）
2. **矩阵整体自证**：`05-audit/engine-gate.js` 逐个引擎启动，
   要求跑起来的引擎之间 **UA 两两不同** ⇒ 证明不是"同一个浏览器跑了三遍"。

装不上某个引擎时是 **SKIP** 而不是"通过"
⇒ 缺浏览器是环境问题，但**不许**被当成"矩阵没问题"。

### 门禁数量

不写死数字 —— 它由 `doc-facts-gate.py` 从 `05-audit/check-all.sh` **按名单**算，
文档里写错会被判红。查当前数字：

```
python3 05-audit/doc-facts-gate.py
```

⚠️ **不要用 `grep -c 'run "'` 去数**：那会给出 **99** 这种偏小的数。
原因是 `check-all.sh` 里有 `for g in …` 循环（里面的 `run "$g"` 是缩进的、名字是变量，
grep 一条都数不到），还有 `skip "…"`（这台机器跑不了的门禁，也是注册数的一部分）。
`doc-facts-gate.py` 会展开循环、把 `run` / `run_report` / `skip` 三种登记方式
按**名字去重**后计数 ⇒ **任何机器上都是同一个数**。

---

## 尚未验证的环境

| 平台 | 引擎 | 状态 | 说明 |
|---|---|---|---|
| iOS | WKWebView | ❌ | **未在真机或模拟器验证** |
| iOS | Safari | ❌ | 未在真机验证 |
| Android | Android WebView | ❌ | **未在真机验证** |
| Android | Chrome（移动版）| ⚠️ | 仅用**桌面**引擎模拟了移动视口，**非真机引擎** |

⚠️ 桌面 WebKit 自动化（上面那个 ✅）**不等于** iOS WKWebView：
真机上的软键盘、可视视口变化、安全区、`100vh`、页面回弹、VoiceOver
都没有被上面任何一项覆盖。

---

## 已知风险（未验证带来的）

1. **`:has()`** —— 已在 `theme-toggle` 里避免使用；其余用法需在 WebKit 上实测
2. **`backdrop-filter`** —— Firefox 与旧 WebKit 行为不一致，用了 `@supports` 兜底
3. **`conic-gradient`**（环形进度）—— Safari 15.4+ 才支持
4. **滚动条样式** —— `::-webkit-scrollbar` 与 Firefox 的 `scrollbar-width` 是两套语法，组件里都写了
5. **iOS 输入框的 `font-size < 16px` 会触发缩放** —— 输入类组件已避免
6. **`@container`**（0.16.0 起使用，`[data-cq]` 标记的槽位）—— 与 `@layer` 同类：
   不支持时**整块丢弃**。区别在于**基础样式不在块里**，所以降级后与标记前完全一致；
   `container-query-check.js` 每次运行都会把 `@container` 剥掉再跑一遍，证明布局不塌。
   Chromium 97 不会白屏，只会"按视口断点"（即旧行为）。

## 已知限制（已验证存在，不是"待验证"）

| 限制 | 说明 |
|---|---|
| **popover 没有碰撞翻转** | 浮层按声明的方向挂出（`end` 方向 = 锚点右侧），**不会**因为贴边而自动翻到另一侧。⇒ 锚点靠近视口右缘时 `end` 方向会溢出。使用者需要自己选方向，或把锚点放在有余量的位置。 |
| **没有 codemod / 运行时废弃告警** | 废弃流程（`ai/deprecations.json`）只是**版本号承诺**：到期允许移除，但不会在运行时警告你还在用。要真拦截得自己在 CI 加 lint。 |
| **弹层锁滚动只补流式内容** | 锁滚动时补偿加在 `body` 的 `padding-right` 上，`position: fixed` 的元素相对视口定位、管不到 ⇒ 页面里若有吸底条，需要自己用 `--overlay-scrollbar-width` 补（见 `03-patterns/overlay/README.md`）。这是当前方案的**已知取舍**，不是还没做。 |

---

## 打算怎么补

优先级从高到低：

1. **Android WebView 真机**（用户量最大）
2. **iOS WKWebView**（`100vh` / 滚动 / 输入框是重灾区）
3. popover 的碰撞翻转（上面"已知限制"第 1 条）

⚠️ 在补齐之前，请勿把「移动 WebView 支持」当作已验证的能力对外承诺。

> 2026-10-31 记：前两项**卡在设备上** —— 手上没有可用的安卓机，也没有 iOS 设备，
> 云真机需要账号。这条不是"忘了做"，是"缺外部条件"，所以不写进版本承诺。
