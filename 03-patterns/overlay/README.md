# Toast / Dialog（反馈层）

| 字段 | 内容 |
|---|---|
| **来源** | 原创。判据部分来自 WCAG 2.1 与原生 `<dialog>` 行为 |
| **实测** | `demo.html` 顶部面板**实时显示焦点位置**，可直接验证 focus trap |
| **适用** | 精简档 / B / C（JS 用 ES5 写，见下） |
| **依赖** | `01-tokens/tokens.css` + `02-primitives/button/button.css`  + `01-tokens/typography.css`（`.note` 提示框）|

---

## 核心是一条判断，不是样式

### 类清单

| 类 | 作用 |
|---|---|
| `.overlay` | 遮罩层（`role="dialog"` 的宿主） |
| `.dialog` | 弹窗面板 |
| `.dialog__title` / `__body` / `__actions` | 弹窗内部结构 |
| `.toast-region` | 通知容器（`role="status" aria-live="polite"`）|
| `.toast` | 单条通知 |
| `.toast__icon` / `__body` | 通知内部结构 |
| `.toast--success` / `--error` / `--warning` | 三种变体（**靠底色 + 图标双编码**，不只靠颜色）|

⚠️ **三种 toast 变体在本 demo 里没有演示** ——
它们是给复用者的钩子，样式已备好，需要你自己触发。
`state--delayed` / `is-valid` 同理（见各自 README）。


| | toast | dialog |
|---|---|---|
| 语义 | 通知一下 | 必须处理完 |
| 用户不做任何操作 | **能继续** | **不能继续** |
| 焦点 | 不抢 | 困住 |
| 关闭 | 自动消失 | Esc / 按钮 |
| role | `status` | `dialog` + `aria-modal` |

**判据只有一条：用户不做任何操作，任务能不能继续？**

用错比做丑严重得多：

- ❌ **把"确认删除"做成 toast** —— 用户可能根本没看见就把文件删了
- ❌ **把"已保存"做成 dialog** —— 打断用户没在做别的事，白白多一次点击

---

## 三件 CSS 做不到的事

### 1. focus trap

Tab 在弹层内循环，**绝不跑到背后的页面去**。
不做的后果：Tab 跑到背景按钮上，屏幕阅读器读到"你在模态框里，但按钮在背景上"，彻底混乱。

实现：监听 `keydown`，到边界时 `preventDefault()` 并折回。

**并加一层保险**：支持 `inert` 的浏览器上，把背景节点整体 `inert = true`——
比 focus trap 更彻底（鼠标点击也失效）。不支持就靠 focus trap 兜。

### 2. 焦点归还

**关闭后焦点必须回到触发它的那个元素。**
不还的话焦点掉到 `<body>`，键盘用户要重新 Tab 一遍才能回到原处。

触发元素可能已被移除（用户点了别处），所以要有 fallback。

### 3. 滚动锁定 + 滚动条补偿

锁背景滚动时**必须把滚动条宽度补到 body 上**：

```js
var sbw = window.innerWidth - document.documentElement.clientWidth;
document.body.style.paddingRight = sbw + 'px';
```

滚动条消失后内容会横向跳一下——**弹层"闪"的感觉大半来自这里。**
最容易被忽略、也最容易被当成"动画没做好"。

---

## 危险操作的两个特殊处理

**1. 初始焦点给"取消"按钮**

```js
Overlay.dialog({ danger: true, initialFocus: 'cancel', ... })
```

默认初始焦点是弹层容器（`tabindex="-1"`，让屏幕阅读器读出标题和描述）。
但**破坏性操作必须给"取消"**——用户看清标题之前条件反射按 Enter，不该把文件删掉。

**2. 点遮罩不关闭**

`closeOnBackdrop: false`。误点遮罩的代价太大。

---

## 错误 toast 不自动消失

```js
if (auto === undefined) auto = (opts.variant === 'error') ? 0 : 4000;
```

**3 秒后悄悄消失 = 用户还没读完就等于没说。**
错误要么不自动消失，要么给足时间 + 保留手动关闭。

---

## 动效克制

| 属性 | 值 | 理由 |
|---|---|---|
| dialog `scale` | 0.98 → 1 | 大幅缩放 + 回弹 = 廉价感 |
| dialog 位移 | 8px | 模态是"出现"，不是"跳出来" |
| backdrop | 纯半透明，**不用 blur** | 旧 WebView 上要么无效要么掉帧 |

`prefers-reduced-motion` 下：进场动画全关，**`toast__timer` 进度条也停住**——
不假装还在倒计时。

---

## 无障碍要点

1. toast region 标 `role="status" aria-live="polite"` —— 不用 focus
2. dialog 标 `role="dialog" aria-modal="true"` + `aria-labelledby` / `aria-describedby`
3. dialog 容器 `tabindex="-1"` 让它本身可聚焦，作为初始焦点
4. 背景 `inert`（支持就用）
5. 关闭按钮要有 `aria-label`

---

## 🔴 库代码用 ES5

`overlay.js` **不使用箭头函数 / const / let / 模板字符串**。
精简档 是 某项目 上的 WebView，版本不确定。demo 可以用现代语法（跑在用户浏览器上），
**库代码不行**。

提交前可自查：

```bash
grep -n '=>\|\bconst\b\|\blet\b' 03-patterns/overlay/overlay.js   # 应无输出
```

---

## 一个诚实的说明

本库用 `div + role="dialog" + aria-modal` 而不是原生 `<dialog>` 元素——
为了动画和样式完全可控。

**如果不需要自定义动画，`<dialog>` 的 focus trap 和 Esc 是浏览器免费提供的，应该优先用它。**
手写 focus trap 的代码永远不如原生可靠。

---

## 反例

- ❌ **toast 抢焦点** —— 通知不该打断当前操作
- ❌ **用 toast 做需要确认的操作** —— 见上
- ❌ **dialog 不困住焦点** —— 混乱
- ❌ **dialog 关闭后焦点不回去** —— 键盘用户要重新 Tab
- ❌ **锁滚动不补偿滚动条宽度** —— 页面"闪"一下
- ❌ **错误 toast 3 秒消失** —— 还没读完就走了
- ❌ **危险操作初始焦点在"删除"上** —— 条件反射误触
- ❌ **危险操作点遮罩即关闭** —— 手滑就完了
- ❌ **dialog 大幅缩放/回弹** —— 廉价感
- ❌ **backdrop 加 `backdrop-filter: blur`** —— 旧 WebView 掉帧
- ❌ **用自定义 div 替代 `<dialog>` 且不需要自定义动画** —— 原生的 focus trap 更可靠
