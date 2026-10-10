# 素材（图表与可视化）

> 这一层放**按需取用**的可视化能力 —— 用哪个拿哪个，互不牵连。
> 本库**不内置图标**；需要图形时怎么加，见文末。

## 这一层有什么

<!-- ==== ASSET-LIST-BEGIN ==== -->
| 目录 | 它解决什么 |
|---|---|
| `09-assets/bar/` | 柱状图，含 charter 13 图表规范的裁剪铁律 |
| `09-assets/echarts-adapter/` | 把令牌喂给 ECharts，按需引入；本库不含 ECharts |
| `09-assets/model-viewer/` | 惰性加载的 3D 模型查看器 |
| `09-assets/scientific-plot/` | 二维科学绘图：坐标轴 / 误差棒 / 置信区间带 / 对数轴 |
| `09-assets/sparkline/` | 迷你趋势线，没有坐标轴的走势提示 |
<!-- ==== ASSET-LIST-END ==== -->

> 上面这张表由 `python 05-audit/fix-start-here.py` 生成，与 `ai/START-HERE.md` 同源。
> 新增目录后先在那份脚本里补一句「它解决什么」，再跑脚本。

每个目录下都有 `demo.html`。起个静态服务就能直接看：

```bash
python -m http.server 8000
# 然后打开 http://127.0.0.1:8000/09-assets/sparkline/demo.html
```

## 图标：本库不内置，需要就自己内联

要"关闭""警告""箭头"这类图形时，**一律内联 SVG** ——
不引图标字体、不引图片文件。三条都是硬收益：

- **零外部请求** —— 不能外链的页面（精简档）依然能用
- 颜色随 `currentColor`，**暗色模式自动跟随**
- 描边粗细随字号变，不会出现"小图标过粗、大图标过细"

反例（不要这样做）：

```html
<!-- ❌ 引入字体：一个大文件 + FOUT + 违反零外部资产 -->
<link rel="stylesheet" href="//cdn.example.com/icons.css">
<i class="icon icon-close"></i>

<!-- ❌ 引入图片：无法跟随 currentColor，暗色模式下要换图 -->
<img src="close.png" alt="">
```

### 规格

按下面这套参数内联，与 Lucide 混用看不出接缝：

```
viewBox   0 0 24 24
width     1em          ← 跟随字号，不是固定 px
height    1em
fill      none
stroke    currentColor
stroke-width  2
stroke-linecap  round
stroke-linejoin round
```

图标本体请自备：从 [lucide.dev](https://lucide.dev) 取（**ISC 协议**，商用无需署名），
按上面规格内联进页面即可。本库不提供图标文件，也不设图标目录。

## 一条已经做过的决定

**不做"签名图标"**（本库自画的品牌性图形）。

画过 3 个后停了，原因不是画不好，而是**没有使用场景**：
全库没有任何地方引用它们 —— 有真实场景才画得出来，脱离场景画出来的图形读不出概念。

⇒ 什么时候再做：等真出现一个现成图标库没有、而我们确实需要的概念时，画那一个。
在那之前，先把现成图标用起来更有价值。
