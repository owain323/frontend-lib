# reveal · 入场动效

一个属性 `data-reveal`，六个方向的入场。**零 JS 也能看**，JS 只是让它动起来。

## 用法

```html
<!-- ① 引样式（必需） -->
<link rel="stylesheet" href="agentcss/patterns/reveal/reveal.css">

<!-- ② 想自动接管，在 <html> 上写一个属性 -->
<html lang="zh-CN" data-reveal-auto>

<!-- ③ 内容上标方向 -->
<section data-reveal="up">…</section>
```

不想自动接管，就手动调：`Reveal.enable()` / `Reveal.disable()` / `Reveal.replay()`。

## 属性协议

| 属性 | 作用 | 取值 |
|---|---|---|
| `data-reveal` | 方向 | `up` / `down` / `left` / `right` / `scale` / `none` |
| `data-reveal-children` | 容器内子元素依次入场，不用逐个标 | 方向名（省略按 `up`） |
| `data-reveal-delay` | 单独延迟 | `120ms` |
| `data-reveal-repeat` | 滚出后再次进入可重播（默认只播一次） | 空属性 |

> `data-reveal-repeat` 是本库与参考实现的**不同之处**：默认**只播一次**。
> 理由：产品页里内容"滚出去再藏起来"会让回看变成负担；
> 作品集那种一次性深度浏览的页面才需要重播，所以做成显式开启。

## 参数（不是随手定的）

| 参数 | 值 | 为什么 |
|---|---|---|
| 位移 | **8px** | 移动端信息密度高，24px 位移会把视线带离内容 |
| 时长 | `--dur-base`（180ms） | UI 动效超 300ms 会觉得卡（`motion.py` 会查） |
| 错峰 | 40ms | 6 个元素 240ms 播完 |
| 错峰封顶 | 6 个 | 不封顶时第 20 个要等 800ms，用户滚到那儿它还在播 |
| 出场动画 | **不做** | 产品元素不该"消失再出现" |

## 三条硬约束

1. **无 JS 必须全可见。** 隐藏只在 `<html data-reveal-ready>` 存在时生效，
   而这个标记由引擎在接管**之后**才加。没有 JS / JS 报错 / 没有 `IntersectionObserver`
   ⇒ 内容就是普通内容：透明度 1、位置不偏。
2. **降级是分级的。** `prefers-reduced-motion` 下位移与缩放**关掉**，
   内容直接出现（不做淡入）。全库那条 `0.01ms !important` 兜底会把一切灭掉，
   本文件用更具体的规则覆盖它 —— 因为"关掉位移"不等于"关掉可见性"。
3. **只用于区块级入场。** 不要给表格行、列表项逐行加：那是扫读场景，
   用户要在半秒内横向比三行数字，逐行错峰会让比较变成"等动画"。

## 类名

| 类名 | 是什么 |
|---|---|
| `.reveal` | 本组件在契约里的根名（属性驱动，**不需要**真的写这个类） |

## 边界

- **不做**：视差、滚动进度驱动（scroll-driven animations）、无限循环装饰动画。
- **不做**：出场动画。元素不该为了"好看"先消失。
- 老 WebView：`IntersectionObserver` 缺失时全部直接显示，不降级成 `scroll` 监听
  （那会把主线程拖住，是比"没有动效"更差的交换）。

## 为什么**没有**「动画进行中不打断」的守卫（实测结论）

参考实现（huxx.me）有一条经验：进场动画在跑的时候不要被打断，
用 `getAnimations().some(a => a.playState === 'running')` 判断，
说"快速滚动时这条决定了顺滑还是闪"。

**那条针对的是它自己的 JS 动画**（Web Animations API 重启动画会跳）。
我们用的是 CSS transition —— 被打断时是 **retarget**：从当前值继续插值，不重头再来。

`05-audit/motion-concurrency.js` 在真浏览器里量过，结论：

| 判据 | 实测 |
|---|---|
| 切状态是否产生动画对象 | ✅ 显示态 2 个（opacity + transform）、隐藏态 2 个 |
| 同属性同时运行的动画数 | ✅ 最多 **1**（快速触发 5 次、采样 39 帧） |
| `prefers-reduced-motion: reduce` | ✅ 动画 **0** 个，opacity 恒为 1 |

⇒ **不需要加守卫。** 加了反而会有害：隐藏方向若"等动画播完再执行"，
元素已经在离场，总位移变大，看起来是"走的时候还亮一下"。
（我第一版就是这么改的，被同一条判据算出来的总位移否掉了，已撤回。）

**重开条件**：某天 reveal 改用 Web Animations API（或换成 `@keyframes` 重启动画），
这条结论立即失效 —— 那时必须重新量，并且很可能需要守卫。

⚠️ 这属于**负面结论入档**：写下来是为了下次不要再"看到别人有就照抄一遍"。
