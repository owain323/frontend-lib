# 采纳成本表

> 这个文件由 `05-audit/dist-cost-gate.py` **生成**，不要手改（改了门禁会红）。
> 数字口径：**dist 里的 min 产物，gzip 9 级**。

## 一、为什么单独算这一笔

采用一个组件要付三笔钱：`tokens`（必付）+ 组件 CSS + 组件 JS（可选）。

实测两笔账，一笔不省：

- `tokens` 源码版 gzip **21.9 KB** → min 版 **2.9 KB**（省 87%）——
  源码多的那部分**全是注释**（全库 CSS 有 69% 是注释，字节口径），而注释是给维护者的，不是给浏览器的。
- tokens 的 min 版 2.9 KB **比任何一个组件自己都贵** ⇒
  "只用一个组件"的真实起步价就是它。不公开这张表，等于让人盲买。

## 二、明码标价

| 档 | 组件 | tokens（必付） | CSS | JS | **合计** | 源码版合计 | 差 |
|---|---|---:|---:|---:|---:|---:|---:|
| primitive | `badge` | 2.9 KB | 0.5 KB | — | **3.4 KB** | 24.7 KB | −21.2 KB |
| primitive | `button` | 2.9 KB | 1.0 KB | — | **3.9 KB** | 28.3 KB | −24.4 KB |
| primitive | `card` | 2.9 KB | 0.9 KB | — | **3.9 KB** | 26.0 KB | −22.1 KB |
| primitive | `choice` | 2.9 KB | 1.1 KB | — | **4.1 KB** | 28.1 KB | −24.0 KB |
| primitive | `combobox` | 2.9 KB | 1.0 KB | 5.4 KB | **9.3 KB** | 31.4 KB | −22.2 KB |
| primitive | `date-range` | 2.9 KB | 0.8 KB | 2.5 KB | **6.3 KB** | 28.4 KB | −22.1 KB |
| primitive | `delta` | 2.9 KB | 0.3 KB | — | **3.2 KB** | 24.7 KB | −21.5 KB |
| primitive | `input` | 2.9 KB | 1.0 KB | — | **4.0 KB** | 25.8 KB | −21.9 KB |
| primitive | `metric` | 2.9 KB | 0.5 KB | — | **3.4 KB** | 25.1 KB | −21.7 KB |
| primitive | `popover` | 2.9 KB | 0.8 KB | 2.2 KB | **5.9 KB** | 29.2 KB | −23.3 KB |
| primitive | `progress` | 2.9 KB | 0.8 KB | — | **3.7 KB** | 26.2 KB | −22.5 KB |
| primitive | `select` | 2.9 KB | 0.8 KB | 4.1 KB | **7.9 KB** | 32.9 KB | −24.9 KB |
| primitive | `separator` | 2.9 KB | 0.2 KB | — | **3.2 KB** | 23.2 KB | −20.0 KB |
| primitive | `skeleton` | 2.9 KB | 0.5 KB | — | **3.4 KB** | 23.8 KB | −20.4 KB |
| primitive | `switch` | 2.9 KB | 0.8 KB | — | **3.7 KB** | 30.3 KB | −26.5 KB |
| primitive | `timeline` | 2.9 KB | 0.5 KB | — | **3.4 KB** | 25.2 KB | −21.7 KB |
| primitive | `upload` | 2.9 KB | 1.4 KB | 4.2 KB | **8.5 KB** | 39.3 KB | −30.8 KB |
| pattern | `accordion` | 2.9 KB | 1.3 KB | 1.8 KB | **6.0 KB** | 36.4 KB | −30.4 KB |
| pattern | `content` | 2.9 KB | 1.0 KB | — | **4.0 KB** | 26.5 KB | −22.5 KB |
| pattern | `drawer` | 2.9 KB | 0.8 KB | 2.6 KB | **6.3 KB** | 30.1 KB | −23.8 KB |
| pattern | `dropdown` | 2.9 KB | 0.8 KB | 3.5 KB | **7.2 KB** | 31.6 KB | −24.4 KB |
| pattern | `form-validation` | 2.9 KB | 0.8 KB | — | **3.7 KB** | 26.8 KB | −23.1 KB |
| pattern | `list` | 2.9 KB | 0.6 KB | — | **3.5 KB** | 24.3 KB | −20.8 KB |
| pattern | `nav` | 2.9 KB | 1.2 KB | 2.6 KB | **6.8 KB** | 33.0 KB | −26.2 KB |
| pattern | `overlay` | 2.9 KB | 1.2 KB | 3.6 KB | **7.7 KB** | 38.5 KB | −30.8 KB |
| pattern | `pagination` | 2.9 KB | 0.8 KB | 2.6 KB | **6.3 KB** | 32.4 KB | −26.1 KB |
| pattern | `reveal` | 2.9 KB | 0.3 KB | 1.2 KB | **4.4 KB** | 26.5 KB | −22.0 KB |
| pattern | `states` | 2.9 KB | 0.9 KB | — | **3.8 KB** | 26.3 KB | −22.5 KB |
| pattern | `tabs` | 2.9 KB | 0.7 KB | 2.0 KB | **5.6 KB** | 29.1 KB | −23.5 KB |
| pattern | `tooltip` | 2.9 KB | 0.5 KB | 1.9 KB | **5.3 KB** | 28.5 KB | −23.2 KB |
| pattern | `tree` | 2.9 KB | 0.6 KB | 2.9 KB | **6.5 KB** | 30.1 KB | −23.6 KB |

## 三、全库

- 全部组件都用上（min，含 tokens 一份）：**70.4 KB**
- 源码版（带注释）全库 gzip：358.8 KB

> ⚠️ 源码版那个数字**不是**要付的钱：它包含我们的注释（全库 CSS 有 69% 是注释，字节口径）。
> 它的用途只有一个 —— 让人看清"dist 到底省了多少"。

