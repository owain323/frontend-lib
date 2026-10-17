# `@layer` 的 WebView 基线（W12）

> **当前状态：部分验证（5 行），且已出现 1 个阻塞样本。**
> 已有 5 行真机实测。**`@layer` 4 行通过、1 行不通过**：
>
> | 入口 | 结果 |
> |---|---|
> | iOS 18.7 · Safari | 15 / 15 |
> | Android 14 · 微信 8.0.47（XWEB / Chromium 146） | 14 / 15，缺 `scrollbar-width`（有私有回退） |
> | iOS 26.6.2 · 微信 8.0.79（WKWebView） | 15 / 15 |
> | iOS 18.7 · 企业微信 5.0.12（wxwork） | 15 / 15 |
> | **Android 14 · 百度浏览器 13.51（Chromium 97）** | **11 / 15，缺 `@layer`** 🔴 |
>
> ⚠️ **百度浏览器那一行是决定性的**：它证明"国产 App 内置浏览器长期停在老内核"
> 不是猜测 —— Chromium 97（2022 年初）不认识 `@layer`，切层后**那一层样式会整段消失**。
>
> 按下面第三节的判据：**已有一行 `@layer` 不通过 ⇒ 当前不能无条件切层**，
> 只能走 `@supports at-rule(@layer)` 双写，或者不切。

---

## 〇、数据是怎么来的

不是手抄的，也不是推测的：探针页把结果 **POST 回采集端**，落成 JSON 后原样贴进表格。
手机访问 `http://<电脑内网地址>:端口` 属于**非安全上下文**，
`navigator.clipboard` 在那里根本不存在 —— 所以页面提供的是"发送到电脑"（同源 POST）作为主路径，
剪贴板只作备用（详见 `ERRORS.md` E47）。

---

## 一、为什么切 `@layer` 之前必须先有这个基线

`@layer` 与其它 CSS 特性有一个**性质上的区别**：

| 特性 | 不支持时的表现 |
|---|---|
| `:has()` / `clamp()` / `dvh` / `aspect-ratio` | **单条声明或单条规则失效** —— 局部退化，页面还能看 |
| `@layer` | 引擎不认识 `@layer { … }` 这个**块**，整块规则被当作非法内容丢弃 —— **整段样式消失** |

⇒ 不支持 `@layer` 的引擎上，不是"层叠顺序不对"，而是"**这一层里的所有样式都没了**"。
`cascade-layer-gate.py` 现在只证明"我们**有能力**切层"（`!important` 都能归类、层数可控），
它证明不了"切完之后**目标浏览器**还认识它"。

⇒ 基线就是这个"目标浏览器认识不认识"的证据。没有它，切层是一次**没有安全网的改动**。

---

## 二、怎么测（三条路径，任选一条）

探针页：`10-review/webview/capability-probe.html`
（自包含单文件：不引本库 CSS、不引外部资源，拷到手机上直接能开）

1. **局域网**（最省事）
   在仓库根目录起静态服务（`npx serve` / `python -m http.server`），
   手机与电脑连同一个无线局域网，访问 `http://<电脑内网地址>:<端口>/10-review/webview/capability-probe.html`
2. **拷文件**
   把这个 HTML 单独发到手机（文件传输 / 数据线），用系统浏览器或目标 App 的 WebView 打开
3. **云真机**
   需要覆盖 iOS WKWebView 与 Android System WebView 两类内核时用

页面会输出一段 JSON（点「复制结果」按钮）⇒ 整段贴进下面表格的「结果」列即可。

⚠️ 一定要说明**从哪个入口打开的**：
Safari 里打开 ≠ WKWebView 里打开（同一内核，但 `WebKit` 的宿主配置会关掉部分能力），
Android 上 Chrome ≠ 系统 WebView ≠ 各家 App 内置 WebView。**入口写不清楚，数据就没法用。**

---

## 三、判据：什么时候才有资格切层

🔴 **先把两类缺失分开**（这一点是被真机数据纠正的）：
`@layer` 能不能用，与"某一项别的能力缺失"是**两件事**。
第一版判据把两者混在一起，于是微信缺一个 `scrollbar-width` 就会被判成"不能切层" ——
而那个缺失跟层叠毫无关系，且本库有私有回退。

| 类别 | 判据 | 动作 |
|---|---|---|
| **阻塞切层** | 任一行 `@layer` 实测**不通过** | 只能走 `@supports at-rule(@layer)` 双写，或者不切 |
| **不阻塞切层** | 除 `@layer` 外的其它能力缺失 | 不影响层叠决策；但必须逐条判定"有没有回退、降级后是否可接受"，并把结论写进「缺失能力」列 |
| **可以无条件切** | 目标受众内**每一行** `@layer` 都通过 | 直接切 |

⚠️ "每一行"是**字面意思**：目标受众里还有一台设备不过，就不能无条件切。
`docs/INVARIANT.md` 的口径是"约束要么成立、要么被写进合同"，不存在"大部分成立"。

**当前判定：不能无条件切层。**
5 行里 **百度浏览器（Chromium 97）不支持 `@layer`** —— 而 `@layer` 不支持时，
**整层规则会被丢弃**（不是"层序不对"，是"那一层的样式没了"）。
⇒ 要么 `@supports at-rule(@layer)` 双写，要么不切。

⚠️ 决策还差一步：**百度浏览器在本库的目标受众里占多少**。
这一条数据只能回答"支不支持"，回答不了"值不值得为它放弃切层" ——
那是产品判断，不该由基线表替使用者下结论。

| 已有 | 缺 |
|---|---|
| iOS Safari、iOS 微信、iOS 企业微信、Android 微信（XWEB）、Android 百度浏览器（Chromium 97） | Android 系统 WebView（Chrome）、其它 App 内置内核（抖音 / 小红书 / 支付宝…） |

另有一条**方法论**上的收获，值得单独记下来：

> `scrollbar-width` 在微信 XWEB 里 `CSS.supports` 返回 `false`，
> 但本库的滚动条样式**照样生效** —— 因为 `01-tokens/scrollbar.css` 同时写了
> `::-webkit-scrollbar` 私有实现。
> ⇒ **「探针说这一项不支持」不等于「这个能力在本库里没有效果」。**
> 判读基线表时必须回到源码看一眼有没有第二条路，否则会把"可接受降级"误判成"缺陷"。

---

## 四、记录表

<!--
  填写规则（门禁 webview-probe-gate.py 会核对）：
  · 每一行 8 列都必须填，不许留 `?` / `TBD` / `待填` / `TODO`
  · 「状态」只能是 `UNVERIFIED` 或 `VERIFIED`
  · 标成 `VERIFIED` 的行，UA 必须是**从页面 JSON 里复制出来的完整 UA**（不是"iPhone 15"这种简称）
  · 「结果」列写 `支持 N / 15`，缺失项写在「缺失能力」列
  当前 4 行（iOS Safari / iOS 微信 / iOS 企微 / Android 微信 XWEB）。**Android 系统 WebView 与其它 App 内核一行都没有 —— 那是缺口，不是"没问题"。**
  「测试日期」不写死年月日：这个文件在公开仓里，写死日期等于把内部时间线留在仓库里
  （`leak-scan` 的「工作日期戳」判据就是为了这个）。日期以**提交时间**为准，精确到秒且无法伪造。
  「UA」里凡是**身份标识**（如微信的 `MMWEBID`）一律脱敏成 `<已脱敏>` ——
  基线需要的是技术信息（内核与版本），不是谁测的。
-->

| 设备 / 系统 | 入口 | UA | 结果 | 缺失能力 | 测试日期 | 记录人 | 状态 |
|---|---|---|---|---|---|---|---|
| iPhone（iOS 18.7，视口 430×932 @3x） | Safari（系统浏览器） | `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1` | 15 / 15 | 无 | 见采集所在提交（git log） | 项目所有者（真机） | VERIFIED |
| Android 14（视口 400×787 @2.7x） | 微信 8.0.47 内置 WebView（XWEB 内核，Chromium 146） | `Mozilla/5.0 (Linux; Android 14; PHZ110 Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/146.0.7680.178 Mobile Safari/537.36 XWEB/1460249 MMWEBSDK/20231202 MMWEBID/<已脱敏> MicroMessenger/8.0.47.2560 WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64` | 14 / 15 | `scrollbar-width` —— **标准 API 缺失，但本库有私有回退**：`01-tokens/scrollbar.css` 同时写了 `::-webkit-scrollbar` 伪元素族，XWEB 是 Chromium 内核，私有实现仍在 ⇒ 观感可接受降级，不是缺陷 | 见采集所在提交（git log） | 项目所有者（真机） | VERIFIED |
| iPhone（iOS 26.6.2，视口 430×834 @3x） | 微信 8.0.79 内置 WebView（WKWebView） | `Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.79(0x18004f2b) NetType/WIFI Language/zh_CN` | 15 / 15 | 无 | 见采集所在提交（git log） | 项目所有者（真机） | VERIFIED |
| iPhone（iOS 18.7，视口 430×800 @3x） | 企业微信 5.0.12 内置 WebView（wxwork） | `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)  Mobile/15E148 wxwork/5.0.12 MicroMessenger/7.0.1 Language/zh ColorScheme/Light wwmver/3.26.511.377` | 15 / 15 | 无 | 见采集所在提交（git log） | 项目所有者（真机） | VERIFIED |
| Android 14（视口 360×672 @3x） | 百度浏览器 13.51（baiduboxapp，Chromium 97 内核） | `Mozilla/5.0 (Linux; Android 14; PHZ110 Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/97.0.4692.98 Mobile Safari/537.36 T7/13.51 SP-engine/2.89.0 baiduboxapp/13.51.0.10 (Baidu; P1 14) NABar/1.0` | 11 / 15 | 🔴 **`@layer` —— 阻塞项**：Chromium 97 太老，分层不可用 ⇒ **不能无条件切层**。另缺三项，均非阻塞：`dvh`（`page.css` 先写 `100vh` 再写 `100dvh`，老内核丢后者留前者）；`scrollbar-width`（有 `::-webkit-scrollbar` 私有回退）；原生 Popover 属性（**本库未使用**，只有自研类名 `.popover`，与本库无关） | 见采集所在提交（git log） | 项目所有者（真机） | VERIFIED |

---

## 五、刻意不写的东西

**本文件不写任何引擎版本号。**

「iOS 16.4 才支持某个特性」这类说法在本文件里没有位置，原因很直接：
我没有在真机上验证过它，写下来就会被下一个人当成事实引用
（`ERRORS.md` E13 记过一类同源事故：文档里的结论没人回来复核，最后整份文档都在骗人）。

⇒ 需要版本结论时，**跑一次探针页**，用那一次的 UA 与结果说话。
UA 是证据，版本传闻不是。

---

## 六、与 `10-review/ios/` 的分工

| 文件 | 回答什么 | 谁来填 |
|---|---|---|
| `10-review/ios/index.html` | **观感与交互**在 Safari 下对不对（按钮、键盘弹起、暗色） | 人眼看，逐条对 |
| `10-review/webview/capability-probe.html` | **能力**在目标 WebView 里有没有（`@layer` 等 15 项） | 机器判定，人只负责贴 JSON |

两者不能互相替代：能力全支持而观感崩了，和观感正常但 `@layer` 被整段丢弃，
是两种完全不同的事故。
