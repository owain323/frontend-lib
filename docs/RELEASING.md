# 发布流程

> 目标只有一句：**发出去的包，就是门禁验过的那棵树。**
> 任何一步让这两者产生偏差（版本号不一致、dist 没重建、tag 指错地方），
> 这次发布的"可追溯性"就已经破了 —— 而追溯性是本库对外承诺的一部分。

---

## 一、版本号出现在四处（不要手改）

| 位置 | 说明 |
|---|---|
| `VERSION` | 最短、最不会被格式化影响 ⇒ 以它为准 |
| `package.json` → `version` | npm 实际用的那个 |
| `package-lock.json` | **两处**：根包 + `packages[""]`（手改最常漏这里） |
| `CHANGELOG.md` | 最新一个版本条目的标题 |

```bash
python3 05-audit/bump-version.py 0.9.0      # 一次性改四处 + 自检读回
python3 05-audit/bump-version.py --check    # 只查一致（已接进门禁 version-sync）
```

---

## 二、发布前的六步

### 第 1 步 · 决定版本号（人判断）

看 `CHANGELOG.md` 的 `## [Unreleased]` 段：

| 段里有什么 | 版本 |
|---|---|
| 只有 Fixed / Security（改 bug、改文案） | 修订号 +1（`0.8.9` → `0.8.10`） |
| 有 Added（新组件 / 新能力，下游不改代码也能升） | 次版本 +1（`0.8.x` → `0.9.0`） |
| 有 Changed 且**不兼容**（令牌或定义改了语义） | 主版本 +1 |

### 第 2 步 · 把 `[Unreleased]` 变成正式条目

在 `CHANGELOG.md` 里：

1. 把 `## [Unreleased]` 改成 `## [0.8.9] - 2026-10-17`（日期用发布当天）
2. 在 `# Changelog` 之后、`## 版本号约定` 之前**新加一个空的**

```markdown
## [Unreleased]

### Added

### Changed

### Fixed

### Security
```

> 空小节可以留，也可以只留标题 —— 但**标题 `## [Unreleased]` 必须在**
> （`release-gate` 的 `[11] CHANGELOG 结构` 会查）。

### 第 3 步 · 同步版本号

```bash
python3 05-audit/bump-version.py 0.8.9
```

⚠️ 如果 CHANGELOG 里已经有 `## [0.8.9] - ` 这个标题（第 2 步做得对），
脚本**不会**再插一个 TODO 骨架；否则它会插一个，插完记得写。

### 第 4 步 · 全量门禁

```bash
npm run gate          # MODE=full，约 12 分钟
```

**必须 0 FAIL。** 不是"我改的那几道绿了"就行 —— 见 `CONTRIBUTING.md`。
顺带看清它末尾那行「本轮：执行 N 道 · 按层跳过 M 道」：
`MODE=full` 下跳过数必须是 **0**。

### 第 5 步 · 重建产物并提交

```bash
python3 05-audit/build-dist.py            # 源码 → dist
python3 05-audit/build-dist.py --check    # 必须绿（sha256 对得上）
python3 05-audit/dist-cost-gate.py --update
git add -A && git commit -m "release: 0.8.9 —— <一句话>"
```

### 第 6 步 · 打 tag（annotated）

```bash
git tag -a v0.8.9 -m "0.8.9 — 2026-10-17

<从 CHANGELOG 抄两三条要点>"
```

⚠️ **必须 annotated**（`-a`），不能是 lightweight：lightweight tag 没有 message，
半年后回溯时看不到"这一版是什么"。
`release-gate` 的 `[10] git tag 锚点` 会核对：
tag 存在 + 是 annotated + **tag 指向的提交里 `VERSION` 就是这个版本**。

---

## 三、发布（这一步只能人做）

### 一条命令

```bash
bash 05-audit/publish.sh
```

它做四件事：查认证 → 查 registry 不是镜像源 → 查版本五处一致 → `npm publish`。
最后那一步会先跑 `prepublishOnly`，门禁红就什么都不发出去。

**认证有两条路**，脚本都支持：

| 路 | 怎么做 | 适用 |
|---|---|---|
| a | 先 `npm login`（浏览器授权 / 一次性验证码） | 常用 |
| b | 把 npm 的 **Automation Token** 存进仓库根的 `.npm-token` | `npm login` 打不开浏览器时 |

`.npm-token` 已被 `.gitignore` 挡住（`git check-ignore .npm-token` 可验证），
**发布完请删掉它**。凭据不进仓库、也不该贴进任何聊天窗口。

### ⚠️ 先确认 registry 不是镜像源

作者这台机器上 `npm config get registry` 返回 `https://registry.npmmirror.com/`
（淘宝镜像）。**镜像源是只读的**，`npm publish` 会得到：

```
npm ERR! 403 Forbidden - PUT https://registry.npmmirror.com/agentcss
```

这不是权限问题、也不是网络问题 —— 改密码、重登都没用。
仓库根目录的 `.npmrc` 已经把 registry 钉在官方源，**在仓库目录里执行**就不会踩到；
换个目录执行则仍会用镜像。

```bash
npm config get registry     # 必须是 https://registry.npmjs.org/
```

```bash
npm login            # 需要账号 + 2FA
npm run publish:check   # 可选：手工再跑一次发布前自检（prepublishOnly 也会跑）
npm publish             # 会先跑 prepublishOnly ⇒ 门禁不过就发不出去
```

### 为什么 `publish` 必须由人执行

- 需要 npm 账号的密码 / 2FA（一次性验证码）
- 发布是**对外不可逆动作**：npm 对"撤回"有严格限制
  （72 小时内可 `npm unpublish <包>@<版本>`，之后基本只能发 patch；
  政策会变，以 npm 官方文档为准）
- 发错版本号的代价通常不是"改一下"，而是"多一个永久存在的难看的版本"

### 发布前自检挡住的是什么（`prepublishOnly`）

`package.json` 里有：

```json
"prepublishOnly": "npm run publish:check"
```

它跑「`MODE=fast` 全量静态门禁（约 100 秒）+ `pack-smoke`（真打 tarball 再装一次）」。
⇒ **门禁红的时候 `npm publish` 会直接失败**，而不是把一颗雷发出去。
⚠️ 不要把它改成 `prepack`：`pack-smoke` 内部会调 `npm pack`，会递归。

---

## 四、发布后必须核对的五件事

```bash
# ① registry 上真的有这个版本
npm view agentcss version dist.tarball

# ② 装进空项目，exports 每条都能解析（这是使用者唯一关心的事）
mkdir -p /tmp/pkgcheck && cd /tmp/pkgcheck
npm init -y >/dev/null && npm i agentcss
node -e "console.log(require.resolve('agentcss/package.json'))"
ls node_modules/agentcss/dist/01-tokens/tokens.css

# ③ 包内没有内部产物（fixtures / baseline / manifest）
npm pack agentcss --dry-run --json | grep -E "fixtures|baseline|manifest" || echo "干净"

# ④ 包名没有被"近似名"混淆（搜一下会不会装错）
npm search agentcss --json | head -40

# ⑤ 远端 tag 也推了（npm 与 git 的锚点要成对）
git push origin v0.8.9
```

然后**把 README 的安装段改成已发布**：

```markdown
## 安装

```bash
npm install agentcss
```
```

这是发布流程的**最后一步，也是最容易忘的一步** ——
忘了它，README 会一直说"尚未发布"，而包其实已经在 registry 上了。

---

## 五、发布出问题怎么办

| 情况 | 处置 |
|---|---|
| 版本号写错 / 忘了改某处 | 还没 `npm publish` ⇒ 直接改；已发 ⇒ 发 patch，**不要**强行覆盖 |
| 包里混进不该有的文件 | 已发 ⇒ 立刻发 patch（`files` 改好再发）；不要靠 `unpublish` 兜底 |
| 发出去发现功能坏了 | 优先发 patch 修；`unpublish` 只在前 72 小时内可靠 |
| tag 指错提交 | `git tag -d` + 重打 + `git push --force origin <tag>`（tag 是唯一的例外，可以强推） |

---

## 六、三种典型错法（都真实发生过）

1. **改了版本号但没重建 `dist`** ⇒ 发出去的包里是旧产物。
   `dist-fresh` 判据守着（源码 sha256 变了而 dist 没重建 ⇒ 红）。
2. **手改了 `package-lock.json` 的一处**（根包改了、`packages[""]` 没改）⇒
   `version-sync` 红。这是 `bump-version.py` 存在的主要理由。
3. **README 的安装命令与包名不一致** ⇒ 照做的人装错东西。
   本库真踩过：README 当时写 `npm install frontend-lib`，而那个名字是别人 2017 年的包。
   `release-gate` 的 `[12] 发布前自检` 现在会核对**README 里的裸包名必须等于
   `package.json.name`**。
