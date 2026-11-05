# 核验一个已发布版本

> 读者：想确认「我装到的这个包、我看到的这个站点，到底来自哪个提交」的人。
> 本文只讲**核验**；发布流程与版本规则见 [RELEASE-PROCESS.md](RELEASE-PROCESS.md)。

---

## 0. 三个问题，三种证据

| 问题 | 证据 | 强度 |
|---|---|---|
| npm 包对应哪个提交？ | registry 元数据的 `gitHead`；provenance 的 `resolvedDependencies` | 前者是自报字段，后者由 CI 签发 |
| 这个包是不是那次构建产出的？ | attestation 的 subject 摘要 vs registry 的 `dist.integrity` | 密码学绑定 |
| 站点对应哪个提交？ | GitHub deployment 记录的 `sha` | 部署来源，不是内容校验 |

三条都能查，但**强度不同**。下面每一步都写明它能证明到哪一步为止。

---

## 1. npm 包 → 提交

```bash
npm view agentcss@0.24.1 version gitHead --registry=https://registry.npmjs.org/
```

实测输出：

```
version = '0.24.1'
gitHead = 'f090c86c1ba728a6cf904cc36dffe1a5eca887b2'
```

- `gitHead` 是 `npm publish` 时构建目录的 git HEAD，由 npm 自动写入。
- 显式写 `--registry=https://registry.npmjs.org/`：若本机把 npm 指向了镜像，`npm view` 读到的是镜像的缓存元数据，而镜像与公共 registry 之间可能有延迟。核验时不要用镜像。
- **`gitHead` 不是签名。** 能改 registry 元数据的一方也能改它。要签名级证据，必须做第 2 步。

---

## 2. 证明签名描述的就是这个 tarball

先取 provenance 里被绑定的三个字段：

```bash
curl -s https://registry.npmjs.org/-/npm/v1/attestations/agentcss@0.24.1 \
  | python3 -c '
import base64, json, sys
att = json.load(sys.stdin)["attestations"]
p = next(a for a in att if a["predicateType"].endswith("provenance/v1"))
st = json.loads(base64.b64decode(p["bundle"]["dsseEnvelope"]["payload"]))
bd = st["predicate"]["buildDefinition"]
print("workflow.ref   =", bd["externalParameters"]["workflow"]["ref"])
print("gitCommit      =", bd["resolvedDependencies"][0]["digest"]["gitCommit"])
print("subject.sha512 =", st["subject"][0]["digest"]["sha512"])
'
```

实测输出：

```
workflow.ref   = refs/tags/v0.24.1
gitCommit      = f090c86c1ba728a6cf904cc36dffe1a5eca887b2
subject.sha512 = df01f6d74818c4ed1e26129ed543355d4add76ccd31a09867b520df21d91ea586c6e4bb5eef293ef61b7250567ffc73b4cc69cd0f95a68b92261397c4271d742
```

再取 registry 记录的 tarball 摘要，并解码成同一进制：

```bash
npm view agentcss@0.24.1 dist.integrity --registry=https://registry.npmjs.org/ \
  | tr -d "'" \
  | python3 -c 'import base64,sys; s=sys.stdin.read().strip(); print(base64.b64decode(s.split("-",1)[1]).hex())'
```

实测输出（与上面 `subject.sha512` **逐字符相同**）：

```
df01f6d74818c4ed1e26129ed543355d4add76ccd31a09867b520df21d91ea586c6e4bb5eef293ef61b7250567ffc73b4cc69cd0f95a68b92261397c4271d742
```

**为什么必须做这一步：** attestation 是一个独立对象，它签的是「某个摘要」，不是「这个包」。不核对 subject 与 `dist.integrity` 的对应关系，就等于拿一张别人的证件复印件说「这是我」。

两者相等时，可以说：**这个 tarball 由 `release.yml` 在 `refs/tags/v0.24.1` 上、从 `f090c86…` 构建并签名。**
两者不等时，不要相信任何一方，先查是不是取错了版本。

---

## 3. 站点 → 提交

```bash
# 在仓库目录里执行：{owner} / {repo} 由 gh 按当前远端自动填充
gh api 'repos/{owner}/{repo}/deployments?environment=github-pages&per_page=1' \
  --jq '.[0] | "\(.sha)  \(.ref)"'
```

实测输出（`<提交>  <部署来源分支>`）：

```
200c01cee9c9e0e5a86461c0e7570262fa595974  master
```

- 这条记录说明：**最近一次 Pages 部署取自 `200c01c…`**。
- `ref` 是 `master`，不是 `v0.24.1`。站点跟随主分支，**不是版本快照**。
- 它**不证明**落盘文件与该提交逐字节一致：部署过程有一次 `rsync`，本次没有对它做全量校验。
- 想抽查单个文件是否一致，取线上文件与本地同路径文件的 sha256 对比即可；抽查只能支撑被抽查的那几个文件。

---

## 4. 能证明什么、不能证明什么

| 级别 | 能回答 | 本库现状 | 不能回答 |
|---|---|---|---|
| L0 声明 | 「我声明它来自 X」 | 文档、CHANGELOG、tag 消息 | 声明是否为真 |
| L1 抽样 | 「我抽查了 N 个文件，都与 X 一致」 | 有人做过小样本抽查 | 未抽查的文件是否一致 |
| L2 全量 | 「每一个文件都与 X 的对应文件一致」 | `0.25.6` 起：npm 包的 335 个文件与提交树逐字节比对，0 处不一致；**站点全量仍未做** | 构建过程是否被污染 |
| L3 密码学 | 「这个 tarball 由这条 workflow、这个提交构建」 | npm provenance（SLSA provenance v1） | 仓库之外的东西 |

三条必须说清的话：

1. **L2 只覆盖 npm 包，而且锚定在版本快照上。** `0.25.6` 发布后把真 tarball
   的 335 个文件逐个与 `0668838…` 提交树比对，0 处不一致 ⇒ 对**那一版**
   可以说「包内每个文件都来自该提交」。两个边界必须一起说清：
   ① 站点全量从来没有比过；② 主分支后续的文档修正属于滚动更新，
   不改变已发布快照，也不让这句结论自动延伸到以后的版本。
   每次发布都要重新做一次全量比对，不能拿上一次的结果顶。
2. **站点不是 npm 包的镜像。** 两个渠道发布的文件集本来就不同（包里有 `dist/`、没有 `guide/`；站点有 `guide/` 与演示页、没有构建清单）。
3. **同一版本号不保证同一内容。** 历史上出现过一次，见下一节。

---

## 5. 已知偏差：0.24.1

| 项 | 内容 |
|---|---|
| 受影响版本 | `0.24.1`（npm 上已发布的包） |
| 受影响文件 | 包内 `llms-full.txt` |
| 错误内容 | 第 13 行的命令示例注释写成 `39 components` |
| 正确内容 | 同一文件第 24 行写的是 `Components (40)`；`ai/components.json` 当时也是 40 条 |
| 影响对象 | 读取该文件、按其中数字理解组件规模的 AI 编码助手与自动化工具 |
| 修复状态 | 仓库与文档站已修正；**npm 上已发布的 0.24.1 未修正**（已发布版本不覆盖） |
| 处理方式 | 由下一个 patch 版本自然带走；本文件保留记录，不追溯改历史 |

复现（两条命令，前者读包内文件，后者读线上文档）：

```bash
SITE=$(npm view agentcss homepage --registry=https://registry.npmjs.org/)

curl -sL https://registry.npmjs.org/agentcss/-/agentcss-0.24.1.tgz \
  | tar xzO package/llms-full.txt | grep -n "components, joined"

curl -s "$SITE/llms-full.txt" | grep -n "components, joined"
```

实测输出（同一版本号，两个渠道，两个数字）：

```
13:npx agentcss ai components --json                     # 39 components, joined with pitfalls
13:npx agentcss ai components --json                     # 40 components, joined with pitfalls
```

两份文件的 sha256（实测，供交叉核对）：

```
a3d36f35ee748632ba05705e669ce950260dd81a3d32b5f3f46fadae0bd084ef   # npm 包内
530de90aa18c2e36b6463409566ba4db4a47dc2212c7fd0bab6a11850b7d845d   # 文档站 / 仓库当前
```

**这不是「版本快照可以变」的证据**，恰恰相反：它是「快照已经发出、错误只能在下一个版本修正」的实例。规则见 [RELEASE-PROCESS.md](RELEASE-PROCESS.md) 第 2 节。

---

## 6. 更早的版本

provenance 不是从第一个版本就有的。实测 `0.10.0` 的 attestation 接口返回 404 —— 这类版本只能核对 `gitHead`（L0），不要把它当作签名证据。

---

## 7. 已知偏差：2026-11-05 的历史重写

| 项 | 内容 |
|---|---|
| 发生了什么 | 仓库提交历史被重写一次，用于移除早期版本里误留的真实项目代号与本机用户名 |
| 受影响范围 | **`0.26.0` 及更早**的 provenance 里记录的 `gitCommit` |
| 具体表现 | 那个 SHA 在重写后的仓库里**不再是任何分支的祖先**；`git cat-file -p <sha>` 会报 `Not a valid object` |
| 仍然成立的部分 | npm 上的 attestation 本身**没有被改动**（sigstore 签名是不可变的）。它仍然能证明：这个 tarball 由本仓库的 `release.yml` 在某个提交上构建 |
| 从什么时候恢复正常 | `0.27.0` 起，provenance 的 `gitCommit` 与仓库历史一致 |
| GitHub 侧 | 旧提交会以**不可达对象**状态保留一段时间，知道 SHA 仍能按地址访问；之后由平台 GC。仓库已无任何 ref 指向它们 |

核验旧版本时正确的读法：**签名证明"构建来源与工作流"，不证明"那个提交现在还在仓库里"**。
这两件事在重写前是重合的，重写后必须分开看 —— 本文件不打算把这一点藏起来。

