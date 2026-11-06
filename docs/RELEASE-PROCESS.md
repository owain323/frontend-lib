# 发布流程与版本不可变规则

> 本文规定**渠道语义、版本不可变、生成链顺序、发布状态机与恢复步骤**。
> 怎么核验一个已发布版本，见 [VERIFY-RELEASE.md](VERIFY-RELEASE.md)。

---

## 1. 两个交付渠道

同一份仓库，两个出口，语义不同：

| | npm 包 | 文档站 |
|---|---|---|
| 内容 | 源码 + `dist/` + `docs/` + `ai/` `esm/` `types/` + 根级文档 | 整棵工作树（除审计脚本、内部目录等） |
| 身份 | **版本快照**：`0.24.1` 这一版就是那一版 | **项目文档**：滚动更新 |
| 触发 | 打 tag `v<版本>` | 推主分支 |
| 页脚/元数据里的版本号 | 就是该快照的版本 | 是「生成时所用库的版本」，不是站点快照号 |
| 能否领先于已发布版本 | 不能（它就是被发布的那一份） | 可以（文档修正不必等发版） |
| 版本号相同是否意味内容相同 | — | **不意味**。两个渠道文件集不同，更新节奏也不同 |

**结论只有一句：版本快照以 npm 为准；站点是持续更新的文档，不是快照的镜像。**

明确禁止的推论：

- 不能因为站点页脚写着与 npm 相同的版本号，就认为两边内容一致。
- 不能因为两个渠道都来自同一个仓库，就认为它们发布的是同一份文件集合。

---

## 2. 版本不可变

### 2.1 四条硬规则

1. **已发布版本的产物不得修改。** 不重发、不覆盖、不在本地改完之后用同一版本号再发一次。
2. **发现已发布版本有错 ⇒ 进下一个 patch 版本。** 错误本身要登记（见第 3 节），但修正只能向前走。
3. **不追溯修改历史 tag。** tag 是发布锚点；改它就等于改写「当时发布了什么」。
4. **同一版本号不得用来暗示两个渠道内容相同。** 渠道差异必须写出来，而不是靠版本号掩盖。

这四条的目的是让「`0.24.1` 是什么」有一个**唯一且不会变**的答案。只要允许同版本号在不同时间、不同渠道悄悄演变，任何核验都没有意义——你核对的可能是另一份东西。

### 2.2 打 tag 的唯一正确形式

```bash
git tag -a v0.24.2 -m "source-commit: <40 位提交 SHA>"
git push --atomic origin master v0.24.2   # 提交与 tag 一起推；不要 git push --tags
```

- 必须是 **annotated tag**：轻量 tag 没有 message，也就没有可核的声明。
- `source-commit` 必须是**完整 40 位**：短 SHA 有歧义空间，而这条记录的全部价值就是"没有歧义地指认一个提交"。
- **提交与 tag 一次推完（`--atomic`）**：分两次推的时候，「提交已经在 master、tag 还没到」的那一瞬间，`release [10]` 必然红 —— 它要求 tag 指向的提交已被远端分支包含。核验记录不该以一次假红为代价。
- 发布门禁会核三件事：tag 消息里的声明 == tag 实际指向的提交；该提交被至少一个远端分支包含；tag 内 `VERSION` 与当前版本一致。
- 从 `0.24.2` 起这是**硬性要求**；更早的 tag 没有该字段是历史事实，门禁对它们走兼容判据（只核"是否属于某个远端分支"）。
- 它**不能**证明"这个提交是当时最合适的发布提交"。那条判断属于人，不属于门禁。

---

## 3. 发现已发布版本有错时

1. **确认影响面**：哪些文件、哪些消费者、是否影响 API 或行为。
2. **在仓库与文档站修正**（这两处可以立即更新；npm 已发布包不动）。
3. **登记已知偏差**：写进 [VERIFY-RELEASE.md](VERIFY-RELEASE.md) 的「已知偏差」一节，必须含受影响版本、文件、错误内容、正确内容、影响对象、修复状态、处理方式，并给出可复现的检查命令。
4. **在下一个版本的 CHANGELOG 里说明**，让升级的人知道修了什么。
5. **不覆盖历史**：不改 tag、不重发同版本、不要求 registry 删除已发布版本。

现存的实例见 [VERIFY-RELEASE.md](VERIFY-RELEASE.md) 第 5 节。

---

## 4. 生成链：什么由什么生成，顺序是什么

### 4.1 生成器与依赖顺序

仓库里没有 `regen-all` 之类的编排脚本。顺序是**由依赖决定的**，不是约定：

| 顺序 | 生成器 | 真值输入 | 输出 | 改写源文件？ |
|---|---|---|---|---|
| 1 | `gen-ai-contract.py` | `ai/components.meta.json` + 组件 CSS/JS + `ai/behaviors.json` | `ai/components.json`、`ai/tokens.json` | 否 |
| 2 | `gen-tokens-tree.py` | `01-tokens/tokens.css` | `ai/tokens.tree.json` | 否 |
| 3 | `make-tiersnippet.py` | `01-tokens/tokens.css` | `04-recipes/tierA-tokens.css` | **是**（写进源目录） |
| 4 | `gen-behavior.py` | `01-tokens/behavior/*.js` | 组件 JS 里的内联 core 段 | **是**（就地改写） |
| 5 | `gen-docs.py` | `ai/components.json` + 各组件 `README.md` | `guide/`、`index.html`、`404.html` | 否 |
| 6 | `gen-llms.py` | `ai/components.json` + `ai/pitfalls*.json` + `ai/behaviors.json` | `llms-full.txt` | 否 |
| 7 | `fix-start-here.py` | `ai/components.json` | `ai/START-HERE.md` 的表格段 | 是（局部） |
| 8 | `build-dist.py` | `01`–`04`、`09` 的 CSS/JS | `dist/` | 否 |

两条必须记住的推论：

- **第 3、4 步写回源文件**，所以它们必须排在 `build-dist.py` **之前**。反过来做，`dist` 里装的是旧源。
- **第 1 步是第 5、6、7 步的输入**，所以 `ai/components.json` 变了却不重跑下游，页面与 `llms-full.txt` 会各自停在上一个版本。

这不是推测。把顺序颠倒（先 `build-dist` 再 `make-tiersnippet`）后，`dist-fresh` 会明确报：

```
源码改过但 dist 没重建：04-recipes/tierA-tokens.css
```

而按正确顺序重跑同一处改动，`dist-fresh` 是绿的。失败信息点名了文件，所以能确认红的原因是**产物过期**，不是环境噪声。

### 4.2 冻结点：发布前到底检查了什么

发布前跑的是 `npm run publish:check`，它等于：

```
check-all.sh --fast      # 静态层（跳过所有需要浏览器的判据）
pack-smoke.sh            # npm pack → 装进空项目 → 解析入口
```

`--fast` 覆盖第 4.1 节**全部 8 个生成器**的产物新鲜度（每个生成器都有对应的 `--check` 判据；其中 `gen-docs` 与 `gen-llms` 由同一道 `docs-site` 门禁覆盖）。所以"入库产物 == 生成器现算"在发布前是被验过的。

其中 `dist` 那条是**两段**：① 源 sha 与 `dist/manifest.json` 记录一致；② 产物字节 == 生成器现算字节（干跑一遍、逐文件比、不写盘）。第二段是后补的 —— 在此之前手改 `dist` 不会被任何判据发现，而文档却写着"不要手改 dist"，等于一道不存在的保护。

它**不覆盖**任何需要浏览器的判据。其中与发布物直接相关的是 `dist` 的语义一致性：

- `dist-parity-check.js`（CSS 经 CSSOM 逐条比对）
- `dist-js-parity-gate.js`（JS 的可观测行为）

这两道属于 component 层，`--fast` 会跳过它们。**因此发布工作流里单独、无条件地跑这两步**（见 5.1）。这条不写在别处，只写在这里，因为"发布前跑过全部门禁"是一句会骗人的话。

---

## 5. 发布状态机

两条链**不是**一条链。它们各自独立，用提交 SHA 关联，但不能互相推断。

### 5.1 npm 链（tag 触发）

| 态 | 含义 | 探测方式（只读） |
|---|---|---|
| `TAGGED` | 存在 annotated tag `v<版本>` | `git cat-file -t v<版本>` |
| `GATES_OK` | `publish:check` + dist 语义比对全绿 | 工作流日志 |
| `NPM_PUBLISHED` | registry 上有该版本，且 provenance 指向本 tag 的提交 | `bash 05-audit/release-run.sh probe` |
| `RELEASE_CREATED` | GitHub Release 存在 | 同上 |

工作流按这个顺序落地：

1. 校验 tag 名 == `package.json.version`，并确认 npm 足够新（OIDC 需 ≥ 11.5.1）；
2. `npm ci`；
3. **probe**（只读）：输出 `npm=… release=… provenance=…`；
4. `publish:check`；
5. 装 Chromium，跑两道 `dist` 语义比对（**无条件**，不受第 6 步的跳过影响）；
6. `npm publish --provenance`，**仅当** `npm != present`；
7. `gh release create`，**仅当** `release != present`；
8. **verify**（`if: always()`）：npm + provenance + Release 三者齐备才算完成。

第 5 步之所以无条件：如果它和 `npm publish` 共用同一个 `if`，恢复一次半完成的发布会**在没跑 dist 校验的情况下**继续建 Release —— 那等于把发布验证变成可跳过的装饰。

第 5 步还有一条**同样重要**的前提：它是浏览器判据，必须先有 `:8000` 上这一棵树的静态服务。
第一次接线时直接 `node …` 跑，CI 上 21 个组件全部 `ERR_CONNECTION_REFUSED` ——
那不是"dist 与源码不等价"，是**观测条件没搭好**。现在统一套
`05-audit/with-server.sh`（与 `check-all` 同一个 `http-serve.py`，就绪判据是
`index.html` 字节一致 **且** 带 `X-FL-Gate-Server` 身份戳）。

⚠️ 由此得到一条通用纪律：**浏览器判据的失败信息必须能区分"观测失败"与"结论为假"**。
把 `ERR_CONNECTION_REFUSED` 报成"不等价"，等于让一道判据在环境问题时指控产品。

第 3 步之所以不能只看「版本存在」：`npm view` 只能回答「这个版本在不在」，不能回答「它是不是我们发的」。probe 会取 attestation 里的 `gitCommit` 与 tag 指向比对；不一致就判失败，而不是跳过。

⚠️ 第 8 步的回执必须**等 registry 索引**。`npm publish` 返回 0 之后，版本端点还要几十秒才可见；
回执在发布后立刻跑，会拿到 `npm=absent` 并把一次成功的发布报成「未完成」。
`release-run.sh verify` 现在对 `absent` 重试（默认 42 次 × 10 秒 = 420 秒），
对 `unreadable` **不重试**（那是接口/网络问题，等下去也不会变）。

这条不是推演，是 `v0.24.2` 第三次运行的现场：npm 与 Release 都建好了，
只有回执红。事后人工复核——`gitHead`、provenance 的 `gitCommit`、
registry `integrity` 与 attestation `subject` 全部一致——产物是对的，
错的是**回执比索引快**。

⚠️ 预算必须**明显大于**实测最大值，不能贴着它设。`v0.26.0`（2026-11-05）是第二次：
`npm publish` 在 `08:15:34` 返回成功，registry 到 `08:18:40` 才索引到——**186 秒**，
而当时的上界是 `17 × 10 = 170` 秒，回执在 `08:18:38` 放弃，比真相早 2 秒。
后果：包已经发出去了，回执却写 `npm=absent`，要再跑一遍 14 分钟的门禁才能拿到绿。
⇒ 现在的 420 秒是实测量级的 6 倍：慢只是多等，错判是回执说谎。

### 5.1.1 事后改包（dist-tag 等）：走 trusted publishing，不要走令牌

发布完成后要改**包管理类**的状态（例如删一个 dist-tag），**不要**想着用发布令牌去做：

- 勾了「绕过两步验证」的细粒度令牌（GAT）自 2026-07 起只能发布写，做包管理删除会被
  `403 Granular access tokens that bypass two-factor authentication may not perform this action` 挡住；
- npm 网页里**没有** dist-tag 管理入口（`/package/<pkg>/dist-tags` 是 404，
  Versions 的 Current Tags 只有只读表格）；
- 剩下唯一合法的口子是 **trusted publishing**：它的 Allowed actions 里明确有 `npm dist-tag`。

本仓的落地方式（一次性运维，不影响发版）：

1. npm 包设置 → Trusted Publisher → GitHub Actions，
   仓库标识（`owner/repo`，见 `package.json` 的 `repository`）与 `release.yml`，
   勾 `npm publish` 与 `npm dist-tag`；
2. `release.yml` 里的 `dist-tag-cleanup` job：只在 `workflow_dispatch` 且填了
   `dist_tag_rm` 时跑；`id-token: write` 换 OIDC 凭证；先 `npm i -g npm@latest`
   （OIDC 需 ≥ 11.5.1）；**不要**给 `setup-node` 传 `registry-url`
   （它会写一条空的 `_authToken` 行，值指向 `NODE_AUTH_TOKEN`，先撞 ENEEDAUTH，轮不到 OIDC）；
3. 触发：

```bash
gh workflow run release.yml -f dist_tag_rm=<tag 名>
```

2026-11-05 实测：run 41997717147 success，`probe-2fa` 删除后只剩 `latest`。
这条作业**不会**被 tag 推送触发（条件是 `github.event_name == 'workflow_dispatch'` 且输入非空）。

### 5.1.2 发版本身的凭据：OIDC，没有任何长期令牌

发版与上面的包管理动作共用同一套信任关系：npm 侧把 `release.yml` 登记为
trusted publisher（`Status: Valid`），工作流用 `id-token: write` 现换一次短期凭证。
**仓库里不再有任何 npm 令牌 secret**，也没有 7 天/90 天到期的东西会悄悄断掉发布。

两条硬约束（都实测踩过，`release-gate.py` 的 `workflow_problems` 逐条守着）：

1. `setup-node` **不传** `registry-url` —— 它会写一行空的 `_authToken`（值指向
   `NODE_AUTH_TOKEN`），npm 先撞 `ENEEDAUTH`，根本轮不到 OIDC；
2. 必须 `npm install -g npm@latest` —— Node 22 自带 npm 10.x，OIDC 需要 ≥ 11.5.1。

`workflow_problems` 同时**反向**断言：谁把 `NPM_TOKEN` / `NODE_AUTH_TOKEN` /
`registry-url` 加回来，门禁立刻红。这不是风格检查——长期令牌模型在 2027-01
会连直接发布权一起失效，留着它只是把断点推迟到下一次发版。

### 5.2 站点链（主分支触发）

| 态 | 含义 | 探测方式 |
|---|---|---|
| `COMMIT_PUSHED` | 主分支上有提交 | `git rev-parse HEAD` |
| `SITE_DEPLOYED` | Pages 部署记录指向某个提交 | `gh api repos/{owner}/{repo}/deployments?environment=github-pages` |

这条链没有"npm 版本"的概念：它部署的是主分支的当前状态。两条链的提交**可以不同**，见第 1 节。

---

## 6. 发布中断后怎么恢复

先探测，再决定，不要重头再来：

```bash
bash 05-audit/release-run.sh probe
```

| probe 输出 | 含义 | 该做什么 |
|---|---|---|
| `npm=absent release=absent` | 全新发布 | 正常跑完工作流 |
| `npm=present provenance=ok release=absent` | npm 已发、Release 没建 | **重跑同一条工作流**；发布步骤会自动跳过，只补 Release |
| `npm=present provenance=ok release=present` | 已完成 | 不需要动作；`verify` 会打印回执 |
| `npm=present provenance=mismatch` | registry 上的版本不是这个 tag 构建的 | **停**。这不是"已完成"，是"发错了"。按第 3 节处理 |
| `npm=present provenance=absent` | 该版本不是本工作流发的（可能是手工发布） | **停**，人工判断来源 |
| `npm=absent release=present` | 异常态（Release 有、包没有） | 人工核对；不要在没弄清原因前重发 |

禁止的恢复方式：

- **已发布之后**删除 tag 重新打 —— 那会改写"当时发布了什么"。
- `npm unpublish` 之后再发同版本 —— 版本号不可变规则不允许。
- 只手工 `gh release create` 而不跑 `verify` —— 回执是"三者同时成立"的唯一记录。

**唯一的例外，判据是"有没有产出物"**：`probe` 明确给出
`npm=absent release=absent` 时，这个 tag 从未产生任何可被消费的东西，
它可以删掉、在同一版本号上重打。判据不是"我觉得没发出去"，是那两行输出
——两个渠道都查过，都不存在。

这条例外有实际先例：`v0.24.2` 第一次打 tag 后，`release.yml` 在
**发布前门禁**就失败了（`selftest-all` 里 `release-gate` 的夹具在 Linux 上失真：
夹具缺 `.gitignore`，`__pycache__` 让"工作区干净"那条正确地变红）。
npm 与 Release 都是 absent ⇒ 删 tag、修夹具、在同一提交树上重打 `v0.24.2`。
**版本号没有跳号，也没有第二份同版本内容。**

⚠️ 反过来说：只要 `npm=present`，哪怕 Release 没建，也不许删 tag 重打 ——
那时 registry 上已经有一个别人可以 `npm install` 的包，tag 是它唯一的来源锚点。

---

## 7. 发布记录

记录的作用不是复盘情绪，是把三类**不同**的事实分开：改造做完了没有 / 产物对不对 / 流程走通了没有。
三者可以同时成立两个而第三个不成立——`0.24.2` 就是这种情况。

### 7.1 `0.24.2` 的三层状态

| 层次 | 状态 |
|---|---|
| 改造实施（十项） | 完成，十项都有落点 |
| `0.24.2` 产物 | **有效**：registry 有版本、provenance 与 tag 提交一致、包内文档与仓库逐字节相同、站点抽样一致 |
| 这一次的发布运行 | **未通过**：CI 在最后一步回执上失败，红叉保留 |

**这三句话不能互相代替。** 不能因为回执误判就把前面的发布抹掉；也不能因为产物有效就把那次运行改判为成功。

### 7.1.1 关闭登记

| 项 | 结论 |
|---|---|
| 改造项 | 十项全部落地，无新增注册门禁（结构断言并进既有 `workflow-gate`） |
| 产物 | `0.24.2` 有效，独立核验通过（见上表第二行） |
| 发布运行 | **未通过，红叉保留**。回执重试修复（`e837d52`）**不重发**同版本 |
| 回执重试 | 已修、**未被真实发布走过** ⇒ 转入待验清单，按 §7.3 六条验 |
| 遗留 | 无"待修但没人管"的项；`0.24.2` 那次运行的红叉是历史事实，不是待办 |

⇒ **这一轮关闭。** 关闭不等于"发布流程全绿"，只等于"这一轮要做的十件事做完了、
产物可信、剩下的不确定性已经被明确登记"。CI 侧的稳定性由定时运行连续观察
（`05-audit/nightly-observe.py` 提供判据：连续若干次定时运行全绿才算稳定）。

那一次运行的事实，按来源分列：

- 来自**运行记录**：`npm publish` 步骤退出码 0；GitHub Release 已创建；失败步骤 = 回执
- 来自**事后独立核验**：registry 的 `gitHead`、provenance 的 `gitCommit`、attestation `subject` 与 registry `integrity` 解码后相等、包内 `llms-full.txt` 与仓库同哈希、站点三个文件抽样同哈希
- 失败原因：回执在 `npm publish` 返回后立刻查询，版本端点尚未索引 ⇒ `npm=absent` ⇒ 判"未完成"。**是回执早了，不是发布失败**
- 后续修复：回执对 `absent` 重试、对 `unreadable` 不重试。该修复**不在那个 tag 的代码里**，重跑同 tag 不会生效

⇒ **不为了一个绿叉重发同版本**。CI 运行记录是历史事实，不是可以修辞的状态。

### 7.2 三类故障分开登记

同一次失败里混着三种**故障模型**，防护手段完全不同。合成一句"发布失败"会让下一个人修错地方：

| 类型 | 表现 | 防护 |
|---|---|---|
| 测试环境失真 | 夹具里的临时仓库缺 `.gitignore`，`__pycache__` 让"工作区干净"正确地变红 | 夹具必须复刻真实环境的**全部**约束；要修夹具，不改判据 |
| 观测条件缺失 | 浏览器判据没起 `:8000` 静态服务，21 个组件全是 `ERR_CONNECTION_REFUSED` | 浏览器判据自带观测条件；失败信息要能区分"没测成"与"结论为假" |
| 外部系统最终一致性 | `npm publish` 成功，版本端点数十秒后才可见 | 只对 `absent` 重试，对 `unreadable` 不重试；上界用**次数**不用累计秒数 |

### 7.3 下一次真实发布要验的六条（提前固定，不许事后放宽）

`0.25.6` 的真实发布走通了**第 2 条**：`npm publish` 成功后 registry 索引延迟，
回执对 `absent` 连续重试 13 次（每次约 10 秒）后拿到
`npm=present provenance=ok release=present`，退出码 0；既没误入
`unreadable` 分支，也没把重试次数用尽。这是这条修复第一次被真实发布走过。

其余五条**仍只有 `release-run.sh --selftest` 的合成用例**，没有真实样本 ——
"没被触发过"不等于"验过了"。后续打 tag 继续按这张表逐条判定：

| # | 场景 | 通过条件 |
|---|---|---|
| 1 | npm 立即可见 | `verify` 一次就输出 `npm=present`，退出码 0 |
| 2 | npm 延迟可见 | 首次 `absent` 后继续等，最终 `present`，退出码 0 |
| 3 | npm 始终 `absent` | 重试次数用尽后失败，且输出点名"重试 N 次仍未见版本端点" |
| 4 | npm `unreadable` | **不进入** `absent` 重试路径，立即报查询错误（接口/网络问题重试也不会变） |
| 5 | npm 已存在、Release 不存在 | 先核已有包的 provenance `gitCommit` 与 tag 指向一致，再继续建 Release |
| 6 | npm 已存在、provenance 不匹配 | 停止。**"版本存在"不等于"发布正确"** |

第 5、6 条是同一条原则的两面：幂等不是跳过已完成的步骤，而是确认已完成的步骤与本次预期一致。

---

## 8. 本文档的边界

本文覆盖：渠道语义、版本不可变、生成链顺序、冻结点范围、发布状态机、恢复步骤、发布记录。

本文**不**覆盖：视觉回归基线、体积预算、组件行为契约等与"发布身份"无关的门禁；也不承诺对发布物做逐文件完整性校验（见 [VERIFY-RELEASE.md](VERIFY-RELEASE.md) 第 4 节）。
