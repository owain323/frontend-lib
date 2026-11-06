# 采纳成本表

> 这个文件由 `05-audit/dist-cost-gate.py` **生成**，不要手改（改了门禁会红）。
> 数字口径：**dist 里的 min 产物，gzip 9 级**。

## 一、为什么单独算这一笔

采用一个组件要付三笔钱：`tokens`（必付）+ 组件 CSS + 组件 JS（可选）。

实测两笔账，一笔不省：

- `tokens` 源码版 gzip **24.2 KB** → min 版 **3.1 KB**（省 87%）——
  源码多的那部分**全是注释**（全库 CSS 有 69% 是注释，字节口径），而注释是给维护者的，不是给浏览器的。
- tokens 的 min 版 3.1 KB **比任何一个组件自己都贵** ⇒
  "只用一个组件"的真实起步价就是它。不公开这张表，等于让人盲买。

## 二、明码标价

| 档 | 组件 | tokens（必付） | CSS | JS | **合计** | 源码版合计 | 差 |
|---|---|---:|---:|---:|---:|---:|---:|
| primitive | `badge` | 3.1 KB | 0.5 KB | — | **3.5 KB** | 26.9 KB | −23.4 KB |
| primitive | `button` | 3.1 KB | 1.0 KB | — | **4.0 KB** | 30.6 KB | −26.5 KB |
| primitive | `card` | 3.1 KB | 0.9 KB | — | **4.0 KB** | 28.3 KB | −24.3 KB |
| primitive | `choice` | 3.1 KB | 1.1 KB | — | **4.2 KB** | 30.4 KB | −26.2 KB |
| primitive | `combobox` | 3.1 KB | 1.0 KB | 5.7 KB | **9.7 KB** | 34.1 KB | −24.4 KB |
| primitive | `date-range` | 3.1 KB | 0.8 KB | 2.8 KB | **6.7 KB** | 31.2 KB | −24.5 KB |
| primitive | `delta` | 3.1 KB | 0.3 KB | — | **3.3 KB** | 26.9 KB | −23.6 KB |
| primitive | `input` | 3.1 KB | 1.0 KB | — | **4.1 KB** | 28.1 KB | −24.0 KB |
| primitive | `metric` | 3.1 KB | 0.5 KB | — | **3.5 KB** | 27.4 KB | −23.8 KB |
| primitive | `popover` | 3.1 KB | 0.8 KB | 2.3 KB | **6.2 KB** | 32.0 KB | −25.8 KB |
| primitive | `progress` | 3.1 KB | 0.8 KB | — | **3.8 KB** | 28.5 KB | −24.6 KB |
| primitive | `select` | 3.1 KB | 0.8 KB | 4.3 KB | **8.2 KB** | 35.4 KB | −27.2 KB |
| primitive | `separator` | 3.1 KB | 0.2 KB | — | **3.3 KB** | 25.5 KB | −22.2 KB |
| primitive | `skeleton` | 3.1 KB | 0.5 KB | — | **3.6 KB** | 26.1 KB | −22.5 KB |
| primitive | `switch` | 3.1 KB | 0.8 KB | — | **3.9 KB** | 32.5 KB | −28.6 KB |
| primitive | `timeline` | 3.1 KB | 0.5 KB | — | **3.6 KB** | 27.4 KB | −23.9 KB |
| primitive | `upload` | 3.1 KB | 1.4 KB | 4.5 KB | **8.9 KB** | 42.0 KB | −33.1 KB |
| pattern | `accordion` | 3.1 KB | 1.3 KB | 1.8 KB | **6.2 KB** | 38.7 KB | −32.5 KB |
| pattern | `content` | 3.1 KB | 1.0 KB | — | **4.1 KB** | 29.1 KB | −25.0 KB |
| pattern | `drawer` | 3.1 KB | 0.8 KB | 2.8 KB | **6.7 KB** | 33.1 KB | −26.4 KB |
| pattern | `dropdown` | 3.1 KB | 0.8 KB | 3.6 KB | **7.4 KB** | 34.1 KB | −26.6 KB |
| pattern | `form-validation` | 3.1 KB | 0.8 KB | — | **3.8 KB** | 29.1 KB | −25.2 KB |
| pattern | `list` | 3.1 KB | 0.6 KB | — | **3.7 KB** | 26.6 KB | −22.9 KB |
| pattern | `nav` | 3.1 KB | 1.2 KB | 2.6 KB | **6.9 KB** | 35.2 KB | −28.3 KB |
| pattern | `overlay` | 3.1 KB | 1.2 KB | 3.8 KB | **8.0 KB** | 41.5 KB | −33.5 KB |
| pattern | `pagination` | 3.1 KB | 0.8 KB | 2.8 KB | **6.6 KB** | 35.0 KB | −28.4 KB |
| pattern | `reveal` | 3.1 KB | 0.3 KB | 1.2 KB | **4.6 KB** | 28.7 KB | −24.2 KB |
| pattern | `states` | 3.1 KB | 0.9 KB | — | **3.9 KB** | 28.5 KB | −24.6 KB |
| pattern | `tabs` | 3.1 KB | 0.7 KB | 2.0 KB | **5.8 KB** | 31.5 KB | −25.7 KB |
| pattern | `tooltip` | 3.1 KB | 0.5 KB | 2.0 KB | **5.6 KB** | 31.0 KB | −25.4 KB |
| pattern | `tree` | 3.1 KB | 0.6 KB | 3.1 KB | **6.8 KB** | 32.6 KB | −25.8 KB |

## 三、全库

- 全部组件都用上（min，含 tokens 一份）：**72.8 KB**
- 源码版（带注释）全库 gzip：391.5 KB

> ⚠️ 源码版那个数字**不是**要付的钱：它包含我们的注释（全库 CSS 有 69% 是注释，字节口径）。
> 它的用途只有一个 —— 让人看清"dist 到底省了多少"。

