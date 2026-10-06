# progress · 进度条

> 进度**已知**时用它；进度**不知道**时用 [`skeleton`](../skeleton/)。
> ⭐ 两者混用是常见错误：不知道进度却给一个假的百分比，**比不给更糟**。

## 用法

```html
<link rel="stylesheet" href="progress.css">

<!-- 线形（最常用）-->
<span class="progress" role="progressbar" aria-valuenow="60"
      aria-valuemin="0" aria-valuemax="100" aria-label="上传进度"
      data-progress="60">
  <span class="progress__bar"></span>
</span>

<!-- 语义色 -->
<span class="progress progress--danger" ...>   <!-- success / warning / danger -->
<!-- 尺寸 -->  <span class="progress progress--lg"> / progress--sm

<!-- 环形（纯 CSS conic-gradient，零 SVG）-->
<span class="progress-ring" data-progress="72" role="progressbar" aria-valuenow="72">
  <span class="progress-ring__label" aria-hidden="true">72%</span>
</span>

<!-- 不确定进度（不知道要多久）-->
<span class="progress progress--indeterminate" aria-busy="true" aria-label="正在处理">
  <span class="progress__bar"></span>
</span>

<!-- 步骤分段（第 3 步 / 共 5 步）-->
<span class="progress-steps" role="progressbar" aria-valuenow="3" aria-valuemax="5">
  <span class="progress-steps__seg progress-steps__seg--done"></span>
  <span class="progress-steps__seg progress-steps__seg--current"></span>
  <span class="progress-steps__seg"></span>
</span>
```

**动态进度用 JS 写**（比行内 `style` 便宜，只改一个自定义属性）：

```js
el.style.setProperty('--progress', '60%');
```

## 令牌

| 令牌 | 默认 | 说明 |
|---|---|---|
| `--progress` | `0%` | **当前值**。默认 0% 是正确默认，不是占位 |
| `--progress-h` | `6px` | 线形高度（`--sm` 4px / `--lg` 10px）|
| `--progress-dur` | `240ms` | 宽度过渡 |
| `--ease-out` | `cubic-bezier(.23,1,.32,1)` | ⭐ 独立于 `--ease`：进度要"向前"的 feel，匀速反而像卡住 |
| `--r-full` | `999px` | 胶囊圆角 |
| `--ring-size` / `--ring-thickness` | `64px` / `8px` | 环形尺寸 |

## 无障碍（**红线**）

```html
<!-- ✅ 确定进度 -->
role="progressbar" + aria-valuenow/min/max + aria-label

<!-- ✅ 不确定进度：只标 aria-busy，**不要**给 valuenow -->
role="progressbar" aria-busy="true" aria-label="正在处理"
```

⚠️ **不确定时不要显示百分比** —— 那是撒谎。读屏只会听到「正在处理，进度未知」，这才是事实。

⚠️ `prefers-reduced-motion: reduce` 时扫光动画**停掉，但条子仍可见**（用户依然知道系统在忙）。

## 何时**不该**用

- ❌ **不知道进度时**（停在 0% 或乱跳的百分比）⇒ 用 `skeleton`
- ❌ **不足 ~1 秒就完成**的操作 ⇒ 闪一下更伤体验，直接不显示
- ❌ **代替"还剩多久"** ⇒ 百分比给的是"比例"，不是"时间"
- ❌ **环形用在极小尺寸**（< 32px）⇒ 环太细，读不出进度
- ❌ **在一个页面里同时出现 3 个以上进度条** ⇒ 用户不知道该看哪个

## 相关

- 未知进度 ⇒ [`skeleton`](../skeleton/)
- 短反馈（"已保存"）⇒ `toast`（**待补，见 08-plan/I-.md**）
