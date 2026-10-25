# 05-audit —— 门禁目录

> **唯一注册处是 `check-all.sh`。** 想知道"这库到底检查了什么"，只读那一个文件就够。
> 本文件只解释**目录约定**，不重复门禁清单（清单会漂移，规则不会）。

---

## 一、脚本分四类，别的都不是

| 类 | 特征 | 谁在跑 |
|---|---|---|
| **门禁** | 在 `check-all.sh` 里有一条 `run "…"` | CI（`MODE=fast`）与本地全量 |
| **工具模块** | 文件名以 `_` 开头（`_common.py` `_css.py` `_probe.js` `contract-kit.js`…） | 被门禁 `import` / `require`，自己不单独跑 |
| **人工工具** | 前 40 行里有 `MANUAL-ONLY: <理由>` | **没有人自动跑**，人按需手动执行 |
| **退役** | 在 `_attic/` 下 | 不跑，留作墓碑（见 `_attic/README.md`） |

`orphan-gate.py` 守这条约定：任何一个 `.py/.js/.mjs/.sh` 不属于上面四类 ⇒ 红。
**这就是"没有孤儿"的机器定义**，不靠谁记得。

---

## 二、怎么跑

```bash
npm run gate:fast      # 静态层，不用浏览器（约 1 分钟）
npm run gate           # 全量（含真浏览器、视觉回归、打包实装）
```

单独跑一道：

```bash
python 05-audit/doc-facts-gate.py
node   05-audit/reveal-contract.js
```

⚠️ **真浏览器类门禁需要 `127.0.0.1:8000` 上有静态服务**：

```bash
python -m http.server 8000 &
```

⚠️ 参数约定**不统一**，这是本目录最大的坑（`ERRORS.md` 有记录）：
- 吃**位置参数**的：`es5-gate.py`、`a11y.py`、`states.py`、`refs.py`…
- 吃 `--dir` 的：`numeric-gate.py`、`hardcode-gate.py`、`license-gate.py`…
- 吃 `--path <file>` 的：`contrast.py`

传错不会报错，只会**扫 0 个文件然后判 PASS**。所以每道门禁都该打印"扫了 N 个文件"
（新门禁必须打），你看到 0 就要怀疑。

---

## 三、新增一道门禁的清单（缺一条就不算门禁）

1. **注册**进 `check-all.sh`（否则等于没写）
2. **零文件守卫**：扫到 0 个输入 ⇒ 红，不判通过
3. **正向控制**：断言"确实扫到了 N 个东西"（N > 0）
4. **反向控制**：注入坏样本 ⇒ 必须红；并尽量证明"只红该红的那一条"
5. **良性对照**：合法的改动必须仍然绿（防误杀，`ERRORS.md` E36）
6. 把**这次踩的坑**记进 `ERRORS.md`（症状 → 根因 → 可执行的规则）

判据本身的纪律见 `docs/INVARIANT.md` I-10：
> 一个"报告通过但什么都没检查"的门禁，比没有门禁更危险。

---

## 四、目录里的几个大件

| 文件 | 作用 |
|---|---|
| `check-all.sh` | 注册表 + 分层（`MODE=fast/component/full`）+ 静态服务托管 |
| `browser.js` | 浏览器启动器（puppeteer-core + 本机 Chrome / playwright） |
| `contract-kit.js` | 组件通用契约（焦点环 / 命中区 / 可访问名 / 暗色对比度…） |
| `_common.py` | 共享：取文件清单（已跟踪 ∪ 未跟踪且未忽略）、路径、报告格式 |
| `build-dist.py` | 生成 `dist/`（真值永远是源码） |
| `gen-ai-contract.py` | 从源码生成 `ai/*.json`（成熟度、能力面） |
| `shot-baseline.py` | 视觉基线录制 / 比对（`--update` 才写） |
| `publish.sh` | 发布（人工触发，跑 `prepublishOnly`） |

---

## 五、不要做的事

- **不要手改 `dist/`**：它是产物，`dist-fresh` 会红。
- **不要手改 `ai/*.json`**：`gen-ai-contract --check` 会红。
- **不要在门禁里写死绝对路径或本机用户名**：换台机器就静默失效
  （`ERRORS.md` E26 / E35）。
- **不要用 `runtime` 里删掉的东西当"已经验过"**：`_attic/` 里的脚本是墓碑，不是备份。
