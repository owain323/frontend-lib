# 采纳成本表

> 这个文件由 `05-audit/dist-cost-gate.py` **生成**，不要手改（改了门禁会红）。
> 数字口径：**dist 里的 min 产物，gzip 9 级**。

## 一、为什么单独算这一笔

采用一个组件要付三笔钱：`tokens`（必付）+ 组件 CSS + 组件 JS（可选）。

实测两笔账，一笔不省：

- `tokens` 源码版 gzip **20.4 KB** → min 版 **2.7 KB**（省 87%）——
  源码多的那部分**全是注释**（全库 CSS 有 67% 是注释，字节口径），而注释是给维护者的，不是给浏览器的。
- tokens 的 min 版 2.7 KB **比任何一个组件自己都贵** ⇒
  "只用一个组件"的真实起步价就是它。不公开这张表，等于让人盲买。

## 二、明码标价

| 档 | 组件 | tokens（必付） | CSS | JS | **合计** | 源码版合计 | 差 |
|---|---|---:|---:|---:|---:|---:|---:|
| primitive | `badge` | 2.7 KB | 0.5 KB | — | **3.2 KB** | 23.1 KB | −19.9 KB |
| primitive | `button` | 2.7 KB | 1.0 KB | — | **3.7 KB** | 26.8 KB | −23.1 KB |
| primitive | `card` | 2.7 KB | 0.9 KB | — | **3.7 KB** | 24.5 KB | −20.8 KB |
| primitive | `choice` | 2.7 KB | 1.1 KB | — | **3.8 KB** | 25.8 KB | −22.0 KB |
| primitive | `combobox` | 2.7 KB | 1.0 KB | 5.4 KB | **9.1 KB** | 29.9 KB | −20.9 KB |
| primitive | `date-range` | 2.7 KB | 0.8 KB | 2.5 KB | **6.1 KB** | 26.9 KB | −20.8 KB |
| primitive | `delta` | 2.7 KB | 0.3 KB | — | **3.0 KB** | 23.1 KB | −20.2 KB |
| primitive | `input` | 2.7 KB | 1.0 KB | — | **3.7 KB** | 24.0 KB | −20.3 KB |
| primitive | `metric` | 2.7 KB | 0.5 KB | — | **3.2 KB** | 23.6 KB | −20.4 KB |
| primitive | `popover` | 2.7 KB | 0.8 KB | 2.2 KB | **5.7 KB** | 27.7 KB | −22.0 KB |
| primitive | `progress` | 2.7 KB | 0.7 KB | — | **3.4 KB** | 23.3 KB | −19.9 KB |
| primitive | `select` | 2.7 KB | 0.8 KB | 3.5 KB | **7.1 KB** | 30.0 KB | −22.9 KB |
| primitive | `separator` | 2.7 KB | 0.2 KB | — | **3.0 KB** | 21.7 KB | −18.7 KB |
| primitive | `skeleton` | 2.7 KB | 0.5 KB | — | **3.2 KB** | 21.8 KB | −18.6 KB |
| primitive | `switch` | 2.7 KB | 0.8 KB | — | **3.5 KB** | 27.5 KB | −24.1 KB |
| pattern | `accordion` | 2.7 KB | 1.3 KB | 1.8 KB | **5.8 KB** | 34.9 KB | −29.1 KB |
| pattern | `content` | 2.7 KB | 1.0 KB | — | **3.7 KB** | 25.0 KB | −21.2 KB |
| pattern | `drawer` | 2.7 KB | 0.8 KB | 2.4 KB | **5.9 KB** | 26.9 KB | −21.0 KB |
| pattern | `dropdown` | 2.7 KB | 0.8 KB | 3.4 KB | **6.9 KB** | 29.8 KB | −22.9 KB |
| pattern | `form-validation` | 2.7 KB | 0.8 KB | — | **3.5 KB** | 24.9 KB | −21.4 KB |
| pattern | `list` | 2.7 KB | 0.6 KB | — | **3.3 KB** | 22.8 KB | −19.5 KB |
| pattern | `nav` | 2.7 KB | 1.2 KB | 2.6 KB | **6.6 KB** | 31.5 KB | −24.9 KB |
| pattern | `overlay` | 2.7 KB | 1.1 KB | 3.3 KB | **7.1 KB** | 35.3 KB | −28.1 KB |
| pattern | `pagination` | 2.7 KB | 0.8 KB | 2.6 KB | **6.1 KB** | 30.9 KB | −24.9 KB |
| pattern | `reveal` | 2.7 KB | 0.3 KB | 1.2 KB | **4.2 KB** | 24.9 KB | −20.7 KB |
| pattern | `states` | 2.7 KB | 0.8 KB | — | **3.6 KB** | 24.4 KB | −20.9 KB |
| pattern | `tabs` | 2.7 KB | 0.7 KB | 2.0 KB | **5.4 KB** | 27.6 KB | −22.2 KB |
| pattern | `tooltip` | 2.7 KB | 0.5 KB | 1.9 KB | **5.1 KB** | 26.8 KB | −21.7 KB |
| pattern | `tree` | 2.7 KB | 0.6 KB | 2.9 KB | **6.3 KB** | 28.6 KB | −22.3 KB |

## 三、全库

- 全部组件都用上（min，含 tokens 一份）：**62.7 KB**
- 源码版（带注释）全库 gzip：307.3 KB

> ⚠️ 源码版那个数字**不是**要付的钱：它包含我们的注释（全库 CSS 有 67% 是注释，字节口径）。
> 它的用途只有一个 —— 让人看清"dist 到底省了多少"。

