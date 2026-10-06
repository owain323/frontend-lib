# model-viewer — 惰性加载的 3D 模型查看器

> 建立于 2026-10-04。定位：
> **「这个模块我们可能以后很久都不会去动它，必须一次性就做对。
> 我们的精力要放在其他的主要内容上面，这个只是我们给未来做的一个储备。但是不能错。」**

---

## 定位与边界

**它做什么**：点一下才加载 3D 引擎，拖动可从任意角度查看模型。

**它不做什么**（以及为什么）：

| 不做 | 原因 |
|---|---|
| **不把 three.js 打包成本库依赖** | 592KB，违背本库「零依赖、可拷贝即用」；且 `vendor/` 里那两个 loader 是 **ES6 class**（实测），与「**JS 一律 ES5**」（精简档 的 WebView 会直接语法错误）冲突 |
| **精简档（某项目）不做 3D** | WebGL 在老 WebView 上大概率不可用。本组件**会检测并给中文提示**，绝不白屏 |
| **不自己手搓 glTF 解析器** | 用成熟的 `GLTFLoader`（three 官方） |
| **不内置 Draco / KTX2 解码器** | 各自还几百 KB，等真需要时再加（见 TODO） |

**分层**：本库负责「**怎么正确地接**」（接入规范 + 降级 UI + 令牌驱动）；
**three.js 本身由主项目负责**（可以 CDN、可以 npm、可以本地文件）。

---

## 用法

```html
<link rel="stylesheet" href="09-assets/model-viewer/model-viewer.css">

<div class="mv"
     data-mv="models/fox.glb"              <!-- 模型路径（必填）-->
     data-mv-height="320"                  <!-- 画布高 px，默认 320 -->
     data-mv-three="vendor/three.min.js"   <!-- 引擎（必填）-->
     data-mv-gltf="vendor/GLTFLoader.js"   <!-- 模型加载器（必填）-->
     data-mv-orbit="vendor/OrbitControls.js"></div>  <!-- 拖动控制（可省）-->

<script src="09-assets/model-viewer/model-viewer.js"></script>
```

**API**：

| 方法 | 用途 |
|---|---|
| `ModelViewer.update(root?)` | 扫描并初始化 `[data-mv]` |
| `ModelViewer.refresh(root?)` | **换主题后调用**（three 内的材质要重建） |

⚠️ **HTML 里绝不要写 `<script src="three.min.js">`** —— 那等于 592KB 在首屏白给，
正好违背 要的「一定要快」。

---

## 🔴🔴 部署前提：服务器 CSP 必须允许 `blob:`

**这是 实测踩到的最重要一条**（本地能跑、线上挂）：

three 的 `GLTFLoader` 对 **glb 内嵌的贴图会创建 Blob URL**
（PNG 太大，不能用 data URI）。
如果服务器的 CSP 不允许 `blob:`，浏览器会直接拦下 ⇒ 报 `Failed to fetch`。

实测本服务器当前的头：

```
Content-Security-Policy:
  img-src      'self' data: https:      ← ❌ 缺 blob:
  connect-src  'self' https:            ← ❌ 缺 blob:
```

⇒ **需要改成**（只加 `blob:`，不放宽其他）：

```
img-src      'self' data: blob: https:
connect-src  'self' blob: https:
```

⚠️ **为什么本地测不出来**：`http://127.0.0.1` 没有 CSP，
   所以本地永远通过 —— **只有部署到 https 服务器才暴露**。
⇒ 改 CSP 之后，**必须去服务器上再验一次**（本地通过不算数）。

⚠️ 组件已经把这条写进错误提示了（不再抛 `Failed to fetch` 给用户）：
> 「模型加载失败：服务器的 Content-Security-Policy 缺少 blob:…」

---

## 三条硬指标（最终定的，逐条对应）

| 要求 | 做法 | 实测 |
|---|---|---|
| **首屏要快** | 引擎**点击后**才 `<script>` 注入 | 首屏 **0 字节**引擎 ✅ |
| | 模型走 `XHR`（`arraybuffer`）以便显示**真实进度** | ✅ |
| **绝不能白屏** | WebGL 不支持 / 引擎 404 / loader 404 / 模型 404 / 解析失败 —— **五种**全部中文提示 + 重试 | ✅ 5/5 |
| **视觉统一** | 颜色、圆角、间距全部 `var(--*)` | ✅ |
| **iOS 手感** | `touch-action: none`（拖动不触发滚动）· 关 tap highlight · `devicePixelRatio` 上限 2 · **页面隐藏时停渲染** | ✅ |

---

## 已验证的行为

```
正常      → 状态 ok，模型 159 KB，引擎就绪 72ms，拖动可旋转
模型 404  → 中文提示「模型下载失败（HTTP 404）」+ 重试按钮
引擎 404  → 中文提示「3D 引擎加载失败：脚本加载失败…」+ 重试按钮
loader 404→ 同上
控制器 404→ 同上（且仍能出图，只是不能拖动）
WebGL 不可用 → 按钮禁用 + 明确说明
```

**交互实测**：真实触摸拖动后相机 x `0 → -1.97`（视角确实变了）· 缩放 z `2.4 → 3.97`。

### 调试用的 URL 参数

`demo.html?mv=models/NOPE.glb` / `?three=vendor/NOPE.js` / `?gltf=…` / `?orbit=…`
⇒ 可直接复现任意降级路径，**不必改代码**。

---

## 🔴 TODO —— 需要持续优化（明确要求标注）

按收益排序。每次改动都要跑 `05-audit/model-viewer-contract.js`。

| 优先级 | 项目 | 预期收益 | 代价 |
|---|---|---|---|
| **P0** | **Draco 几何压缩** | 模型可再降 **约 10 倍**（159KB → ~16KB） | 需 decoder wasm（~200KB，**只加载一次，可缓存**） |
| **P0** | **KTX2 / Basis 纹理压缩** | 贴图可降 **约 8 倍**，且**显存省一半** | 需 decoder（~200KB） |
| **P1** | **模型分级**（缩略图 → 低模 → 完整） | 首屏几乎为 0；适合素材库几十个模型的场景 | 需要离线生成流程 |
| **P1** | **`gltf-transform` 网格简化** | 高模降到适合网页的三角数 | 需 CLI 工具链 |
| **P2** | **首帧渲染耗时优化** | 当前引擎就绪 72ms（本地）→ 真实网络需测 | 取决于网络 |
| **P2** | **模型缓存**（`Cache Storage`） | 第二次访问 0 字节 | 需处理版本失效 |
| **P2** | **WebGL 上下文丢失恢复**（`webglcontextlost`） | 切后台回来可能黑屏 | 需重建场景 |
| **P3** | AR/VR（`<model-viewer>` 的 `ar` 属性）| 手机上看实景 | 需换库 |
| **P3** | 多个模型 + 材质切换 | 展陈类需求 | 视需求 |

### 素材现状（`内置素材目录`）

**20 个 glb，共 1.3GB**。体积差 **1700 倍**：

| 文件 | 体积 | 备注 |
|---|---|---|
| `Chick.glb` | 12.7 KB | 最小 |
| `Duck.glb` | 117.7 KB | |
| **`Fox.glb`** | **159 KB** | **本库采用**（指定的"小狐狸"）|
| `Lamp.glb` | 598 KB | |
| `DamagedHelmet.glb` | 3.7 MB | |
| `演示项目名.glb` | **21 MB** | ⚠️ **绝不能直接上网页** |

⚠️ **规矩**：新增素材**必须 ≤ 200KB**，超过先走 Draco 压缩。

---

## 相关

- 规范边界：同一条原则——**分析类可视化交给成熟库**
- 契约测试：`node 05-audit/model-viewer-contract.js`
- 素材备库：`内置素材目录`（20 个 glb，**本库只拷最小的**）
