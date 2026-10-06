# skeleton · 骨架屏

> 加载态是移动端**最高频**的状态。没有它，每个业务方都会自己造一个
> ⇒ 形状不统一、闪烁频率不一致、暗色下颜色不对。

## 用法

```html
<link rel="stylesheet" href="skeleton.css">

<!-- 文本骨架（多行） -->
<div aria-busy="true">
  <span class="skeleton skeleton--text" aria-hidden="true" style="width:92%"></span>
  <span class="skeleton skeleton--text" aria-hidden="true" style="width:78%"></span>
</div>

<!-- 块状（图片/卡片占位） -->
<div class="skeleton skeleton--block" aria-hidden="true" style="height:96px"></div>

<!-- 圆形（头像占位） -->
<span class="skeleton skeleton--circle" aria-hidden="true"></span>

<!-- 列表骨架（最常用形态） -->
<div class="skeleton-list" aria-busy="true">
  <div class="skeleton-list__row">
    <span class="skeleton skeleton--circle" aria-hidden="true"></span>
    <div style="flex:1">
      <span class="skeleton skeleton--text" aria-hidden="true" style="width:40%"></span>
      <span class="skeleton skeleton--text" aria-hidden="true" style="width:88%"></span>
    </div>
  </div>
</div>
```

## 令牌

| 令牌 | 默认 | 说明 |
|---|---|---|
| `--skeleton-bg` | `#e9ecef` / 暗色 `#2E343C` | 底色。**与纸面亮度差必须 > 0.02**（契约强制）|
| `--skeleton-shimmer` | `rgba(255,255,255,.72)` | 微光高光 |
| `--skeleton-h` | `1em` | 单行高度 |
| `--skeleton-size` | `40px` | circle 直径 |
| `--skeleton-duration` | `1.4s` | 微光周期 |

## 无障碍（必读）

骨架屏**没有文字**。若不处理，读屏会念出一堆空白。

```html
<!-- ✅ 正确：外层标 aria-busy（读屏会念"忙"），骨架逐个 aria-hidden -->
<div aria-busy="true">
  <span class="skeleton" aria-hidden="true"></span>
</div>
```

⚠️ `prefers-reduced-motion: reduce` 时**动画停掉，但骨架屏仍显示** ——
用户依然知道正在加载。（WCAG 2.3.3）

## 何时**不该**用

- ❌ **很短的文字**（< 12px）：骨架屏会读成"渲染坏了"，读屏还会念空白
- ❌ **只要 200ms 就完成**的加载：闪一下更伤体验，直接不显示
- ❌ **已知时长的操作**（如上传 3MB）：用 `progress` 而不是骨架屏
- ❌ **骨架屏里放 spinner**：两者都是"不确定进度"的信号，同时出现是噪声

## 相关

- 已知进度 ⇒ `progress`（已提供）
- 短反馈 ⇒ `toast`（**待补**）
