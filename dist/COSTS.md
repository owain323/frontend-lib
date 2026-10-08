# 采纳成本表

> 这个文件由 `05-audit/dist-cost-gate.py` **生成**，不要手改（改了门禁会红）。
> 数字口径：**dist 里的 min 产物，gzip 9 级**。

## 一、为什么单独算这一笔

采用一个组件要付三笔钱：`tokens`（必付）+ 组件 CSS + 组件 JS（可选）。

实测两笔账，一笔不省：

- `tokens` 源码版 gzip **15.8 KB** → min 版 **2.1 KB**（省 86%）——
  源码多的那部分**全是注释**（全库 CSS 有 64% 是注释），而注释是给我们的，不是给使用者浏览器的。
- tokens 的 min 版 2.1 KB **比任何一个组件自己都贵** ⇒
  "只用一个组件"的真实起步价就是它。不公开这张表，等于让人盲买。

## 二、明码标价

| 档 | 组件 | tokens（必付） | CSS | JS | **合计** | 源码版合计 | 差 |
|---|---|---:|---:|---:|---:|---:|---:|
| primitive | `badge` | 2.1 KB | 0.5 KB | — | **2.6 KB** | 18.5 KB | −15.9 KB |
| primitive | `button` | 2.1 KB | 1.0 KB | — | **3.1 KB** | 22.0 KB | −18.9 KB |
| primitive | `card` | 2.1 KB | 0.9 KB | — | **3.1 KB** | 19.3 KB | −16.3 KB |
| primitive | `choice` | 2.1 KB | 1.1 KB | — | **3.2 KB** | 21.2 KB | −18.0 KB |
| primitive | `combobox` | 2.1 KB | 1.0 KB | 3.8 KB | **6.9 KB** | 23.2 KB | −16.3 KB |
| primitive | `date-range` | 2.1 KB | 0.8 KB | 2.5 KB | **5.5 KB** | 21.7 KB | −16.2 KB |
| primitive | `input` | 2.1 KB | 1.0 KB | — | **3.2 KB** | 19.4 KB | −16.2 KB |
| primitive | `popover` | 2.1 KB | 0.8 KB | 2.1 KB | **5.1 KB** | 22.9 KB | −17.8 KB |
| primitive | `progress` | 2.1 KB | 0.7 KB | — | **2.8 KB** | 18.7 KB | −15.9 KB |
| primitive | `select` | 2.1 KB | 0.8 KB | 2.9 KB | **5.8 KB** | 23.8 KB | −18.0 KB |
| primitive | `separator` | 2.1 KB | 0.2 KB | — | **2.4 KB** | 17.1 KB | −14.7 KB |
| primitive | `skeleton` | 2.1 KB | 0.5 KB | — | **2.6 KB** | 17.3 KB | −14.6 KB |
| primitive | `switch` | 2.1 KB | 0.8 KB | — | **2.9 KB** | 23.0 KB | −20.1 KB |
| pattern | `accordion` | 2.1 KB | 1.3 KB | 1.7 KB | **5.2 KB** | 29.6 KB | −24.4 KB |
| pattern | `content` | 2.1 KB | 1.0 KB | — | **3.2 KB** | 19.7 KB | −16.6 KB |
| pattern | `drawer` | 2.1 KB | 0.8 KB | 2.0 KB | **4.9 KB** | 21.1 KB | −16.3 KB |
| pattern | `dropdown` | 2.1 KB | 0.8 KB | 2.7 KB | **5.6 KB** | 23.2 KB | −17.6 KB |
| pattern | `form-validation` | 2.1 KB | 0.8 KB | — | **2.9 KB** | 20.3 KB | −17.4 KB |
| pattern | `list` | 2.1 KB | 0.6 KB | — | **2.7 KB** | 18.2 KB | −15.5 KB |
| pattern | `nav` | 2.1 KB | 1.2 KB | — | **3.4 KB** | 19.8 KB | −16.4 KB |
| pattern | `overlay` | 2.1 KB | 1.2 KB | 1.9 KB | **5.2 KB** | 25.5 KB | −20.3 KB |
| pattern | `pagination` | 2.1 KB | 0.8 KB | 2.5 KB | **5.4 KB** | 25.2 KB | −19.8 KB |
| pattern | `states` | 2.1 KB | 0.9 KB | — | **3.0 KB** | 20.0 KB | −17.0 KB |
| pattern | `tabs` | 2.1 KB | 0.6 KB | 2.0 KB | **4.8 KB** | 22.2 KB | −17.4 KB |
| pattern | `tooltip` | 2.1 KB | 0.6 KB | 1.1 KB | **3.8 KB** | 20.1 KB | −16.3 KB |
| pattern | `tree` | 2.1 KB | 0.6 KB | 2.9 KB | **5.7 KB** | 23.4 KB | −17.7 KB |

## 三、全库

- 全部组件都用上（min，含 tokens 一份）：**51.4 KB**
- 源码版（带注释）全库 gzip：199.1 KB

> ⚠️ 源码版那个数字**不是**要付的钱：它包含我们的注释（全库 CSS 有 64% 是注释）。
> 它的用途只有一个 —— 让人看清"dist 到底省了多少"。

