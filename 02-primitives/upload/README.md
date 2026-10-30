# upload · 文件上传

> 本库表单控件一直是"缺一块"的状态：input / select / choice / switch 都有，
> 唯独没有"选文件"。于是每个项目自己糊一个 `<input type=file>`，
> 它长得和全站不一样，而且拖放区、多文件、失败原因全缺。

## 两层形态

| 形态 | 需要 JS | 得到什么 |
|---|---|---|
| `.upload` | **不需要** | 原生 `<input type=file>` + 美化过的 `::file-selector-button`；原生文件名回显、表单提交、`accept` 过滤全走浏览器 |
| `.upload--drop` | 需要 | 在上面加一层拖放区 + 文件列表 + 大小/类型/数量校验 + 移除 |

`.upload--drop` 是**加**在基础形态上的一层，不是替代品。原生 `<input>` 始终在 DOM 里、
始终可聚焦、始终在表单里。

## 用法

```html
<!-- ① 基础：零 JS -->
<link rel="stylesheet" href="upload.css">
<input class="upload__input" type="file" id="f1" name="statement" accept=".csv,.xlsx">
<label class="field__label" for="f1">导入对账单</label>

<!-- ② 增强：拖放区 + 列表 -->
<link rel="stylesheet" href="upload.css">
<script src="upload.js"></script>

<div class="upload upload--drop" data-upload data-max-size="20971520" data-max-files="5">
  <input class="upload__input" type="file" id="f2" name="files" multiple
         accept=".pdf,.xlsx" aria-describedby="f2-hint">
  <!-- 拖放区是 label for：点它 = 原生打开选择器，这一步不依赖 JS。
       ⚠️ 不要给它加 aria-hidden：加了它就从无障碍树里消失，
          input 只能靠外面的 .field__label 拿名字 —— 少写一个就是 axe critical。
          （0.18.0 的 axe 实测：对比块里漏了 .field__label ⇒ label 违规。） -->
  <label class="upload__dropzone" for="f2">
    <svg class="upload__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor"
         stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 11V2.6M4.4 6.2L8 2.6l3.6 3.6M2.6 11.4v1.2a.8.8 0 0 0 .8.8h9.2a.8.8 0 0 0 .8-.8v-1.2"/>
    </svg>
    <span class="upload__title">拖入文件，或 <span class="upload__browse">选择文件</span></span>
    <span class="upload__hint">PDF / XLSX，单个不超过 20 MB</span>
  </label>
  <ul class="upload__list"></ul>
  <span class="upload__status" role="status" aria-live="polite"></span>
</div>
<p class="field__hint" id="f2-hint">可以一次选多个</p>
```

## 声明式属性（写在 `.upload` 根上）

| 属性 | 含义 | 默认 |
|---|---|---|
| `data-upload` | 自动初始化标记 | — |
| `data-max-size` | 单文件上限（**字节**） | 0 = 不限 |
| `data-max-files` | 文件数上限 | 0 = 不限（`multiple` 时）／1（单选时） |
| `data-state` | **输出**：`dragover` 时存在 | — |
| `data-count` | **输出**：当前文件数（供"没选文件就不让提交"用） | `"0"` |

## JS API

```js
var u = document.getElementById('f2').closest('.upload').uploadInstance;
// 或 new Upload(root, { maxSize: 20 * 1024 * 1024 })
```

| 成员 | 说明 |
|---|---|
| `add(files[, dirCount])` | 收下一批文件（= 拖放入口）。**走同一条校验**，返回是否至少收下一个 |
| `removeAt(i)` | 移除第 i 个；返回 false 表示浏览器不支持写 `input.files` |
| `setProgress(i, pct)` | `0–99` 上传中；`-1` 或 `>=100` 标记完成并去掉进度条 |
| `render()` | 从 `input.files` 重画列表（你手动改了 `files` 之后调它） |
| `destroy()` | 解绑全部监听 |

### 事件

```js
document.addEventListener('fl-upload', function (e) {
  e.target  // .upload 根元素（认它，别认事件名 —— 嵌套组件会冒泡到一起）
  e.detail  // { files: File[], added: number, removed?: File, rejected: {file, reason, text}[] }
});
```

`reason` 取值：`size` / `type` / `count` / `dir` / `unsupported`。

> ⚠️ **程序性改 `input.files` 不会触发原生 `change`**（这是规范，不是本库的选择）。
> 本组件不补发假 `change`（那会形成"渲染两遍"的循环），
> 所以 **HTML 表单校验请监听 `fl-upload`，不要监听 `change`**。

## 三条硬约定

### 1 · `input.files` 是唯一真值，列表是镜像

拖放不是"第二条通道"：它把文件塞进 `input.files`，然后重画。
代价是**再次选择/拖入会替换整个列表**（与原生 `<input multiple>` 一致）。
不做"下一次追加"—— 否则同一个控件里存在两种累加规则，迟早打架。

### 2 · 校验只有一份实现

拖放与原生选择都调 `_validate`。写成两遍的后果不是"难看"，是它们会**漂移**：
某天给拖放加了大小限制，忘了给原生选择加 ⇒ 同一页面上，
拖进去的被拒、点选进去的通过。这种 bug 只有用户会碰到。

`accept` 必须二次校验：它只约束**文件选择器**，拖放完全绕过它。
只写 `accept=".pdf"` 而拖入 `.exe` 时，浏览器不会拦 —— 这是规范行为。

### 3 · `DataTransfer` 不存在时，拖放明确拒绝

老 Safari（< 14.1）没有 `new DataTransfer()` ⇒ `input.files` 不可写。
此时照样渲染列表、照样派发事件，用户会看到"文件进去了"，点提交却什么都没有，
**且不报错**。所以本组件直接提示"当前浏览器不支持拖放，请点选择文件"，不接收。

## 无障碍

- **状态不只靠颜色**：左侧图形（空心圆 / 勾 / 叹号）+ 右侧文本（"上传中 42%" / "2.4 MB" / "超过 20 MB"）。
  灰度打印、色盲、强制色三种条件下信息都不丢。
- **播报走单独的 `role="status"`**，不给 `<ul>` 加 `aria-live` ——
  后者会把"进度 42% → 43%"每 200ms 打断一次。
  同一句话连续播两次时读屏不再读，所以 `announce()` 先清空再延迟写入。
- **移除按钮的 `aria-label` 带文件名**（"移除 2025年度审计报告.pdf"），
  否则读屏用户听到一排"移除、移除、移除"。
- 拖放区是 `<label for>`，本身**不进 Tab 序列**（焦点属于 input）；
  聚焦时焦点环画在 dropzone 上，视觉上看到的是"这一块被选中了"。
- **可访问名字来自两处**：`.field__label`（"上传审计底稿"）与 dropzone 里的文字。
  读屏会连着念，略啰嗦，但这是**安全的冗余** —— 只用 dropzone、不写 `.field__label`
  的页面也有名字。反过来（dropzone 加 `aria-hidden`、靠 `.field__label` 给名）
  看起来更干净，代价是少写一个 label 就变成 axe critical，而且没有任何门禁拦得住。
- 强制色模式下**不需要额外 media query**：边界全是 `border`（会自动变 CanvasText 实线），
  图标全是内联 SVG + `currentColor`。这是 0.17.0 逐页实拍定下的两条规律。

## 何时**不该**用

- **需要断点续传 / 分片上传** ⇒ 这不是纯前端控件能解决的，本组件只负责"选与校验"，
  传输交给你的上传库。它不发送任何请求。
- **单个文件且没有校验** ⇒ 用基础形态（`.upload__input` 一行）就够了，不要套拖放区。
- **图片裁剪/预览** ⇒ 需要 canvas 预览与交互，超出本组件范围。

## 相关

- `progress` —— 列表里的进度条复用它；没引入时退化成空槽，不报错
- `field`（在 `input` 里）—— `field__label` / `field__hint` / `field__error` 的外层结构
- `form-validation` —— 提交前校验；错误提示用 `field__error` + `aria-describedby`
