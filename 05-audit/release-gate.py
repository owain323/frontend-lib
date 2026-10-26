#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
release-gate.py — 发布契约门禁（检查项 J4/J5/J6）

===========================================================================
🔴 为什么需要（外部评审 P0：版本管理是"发布事故"）
---------------------------------------------------------------------------
  评审发现仓库里同时存在：
      VERSION        = 0.3.0
      package.json   = 1.0.0
      仓库描述        = "34 契约 + 55 门禁"（数字早已过时）
      README         = "35 个契约 + 60 多道检查"

  ⭐ 对一个**把契约与门禁当核心卖点**的库，这是反例 ——
     它最重要的品牌信任是「我说什么，系统就是什么」。

===========================================================================
判据
---------------------------------------------------------------------------
  ① VERSION 文件 == package.json.version == CHANGELOG 最新版本
     == **package-lock.json 的根包版本**（2026-10-09 补）
  ② repository.url 指向真实仓库（不是 example.invalid）
  ③ LICENSE 文件**真实存在**且 package.json 声明与它一致
  ④ package.json 的 files 里列出的路径**都真实存在**
  ⑤ 描述里**不含过时的数字**（"N 契约 + M 门禁"这种会漂移的说法）
===========================================================================
"""
import sys
import os
import io
import json
import re
import subprocess

# CHANGELOG 版本标题解析 —— 与 bump-version / doc-facts **共用同一份**（E31）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _changelog                                     # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_json(name):
    p = os.path.join(ROOT, name)
    if not os.path.isfile(p):
        return None
    try:
        return json.load(io.open(p, encoding='utf-8'))
    except Exception:
        return None


def read_text(name):
    p = os.path.join(ROOT, name)
    if not os.path.isfile(p):
        return None
    return io.open(p, encoding='utf-8', errors='replace').read()


def main():
    print('  === 发布契约门禁 ===')
    print('')
    bad = 0

    pkg = read_json('package.json')
    if not pkg:
        print('  X package.json 读不到')
        return 1
    ver_text = read_text('VERSION')
    ver = (ver_text or '').strip()
    cl = read_text('CHANGELOG.md') or ''

    # ---------- ① 版本三处一致 ----------
    print('  [1] 版本一致性')
    if not ver:
        print('      X VERSION 文件不存在')
        bad += 1
    else:
        print('      VERSION        = %s' % ver)
        print('      package.json   = %s' % pkg.get('version'))
        # 🔴 用共享解析器（0.8.9 修 · E31 的**第三次**）：
        #   这里原来是第三份本地正则 `##\s*\[?v?(\d+\.\d+\.\d+)\]?` ——
        #   它**不要求日期**，于是会匹配到正文里任何 `## x.y.z` 字样。
        #   实测被自己人坑：CHANGELOG 的条目里写了
        #   「往下扫到了正文里的 ## 0.4.0 的第二部分…」⇒ 本判据读出 0.4.0。
        #   ⇒ 三处（bump-version / doc-facts / 这里）现在共用 `_changelog.py`。
        cl_ver = _changelog.latest_version(cl) or '(未找到)'
        print('      CHANGELOG      = %s' % cl_ver)
        if pkg.get('version') != ver:
            print('      X package.json 与 VERSION 不一致')
            bad += 1
        if cl_ver != '(未找到)' and cl_ver != ver:
            print('      X CHANGELOG 最新版与 VERSION 不一致')
            bad += 1
        if cl_ver == '(未找到)' and cl:
            print('      ! CHANGELOG 里没识别到版本号（格式可能变了）')

        # ---- ①b package-lock.json 的根包版本（2026-10-09 外部评审实测）----
        #  评审实测：package.json = 0.7.7，而 package-lock.json 的根包还是 0.3.0。
        #  ⚠️ 这不一定让 `npm ci` 失败 —— 正因为**不一定**失败，它才会一直没人发现：
        #     锁文件里那个版本号是"我上一次 npm install 时的包版本"，
        #     它漂移时没有任何一处会报错，直到有人去读它。
        #  ⇒ 对一个把「我说什么，系统就是什么」当卖点的库，这是自己打自己的脸。
        lock = read_json('package-lock.json')
        if lock is None:
            print('      X package-lock.json 读不到 ⇒ 锁文件本身不存在或不合法')
            bad += 1
        else:
            # lockfile v2/v3 有两处：顶层 version 与 packages[""].version
            lock_v = lock.get('version')
            pkgs = lock.get('packages') or {}
            lock_root = (pkgs.get('') or {}).get('version')
            print('      package-lock   = %s（packages[""] = %s）'
                  % (lock_v, lock_root))
            for label, v in (('version', lock_v), ('packages[""].version', lock_root)):
                if v is not None and v != ver:
                    print('      X package-lock.json 的 %s = %s，与 VERSION(%s) 不一致'
                          % (label, v, ver))
                    bad += 1
            lock_name = lock.get('name')
            if lock_name and lock_name != pkg.get('name'):
                print('      X package-lock.json 的 name = %s，与 package.json(%s) 不一致'
                      % (lock_name, pkg.get('name')))
                bad += 1
            # 🔴 没有 node_modules 也要能判（锁文件是**提交物**，不是安装产物）
            if lock_root is None and lock_v is None:
                print('      X package-lock.json 里找不到根包版本 ⇒ 判据视野已空')
                bad += 1

    # ---------- ② repository ----------
    print('  [2] repository')
    repo = pkg.get('repository') or {}
    url = repo.get('url', '') if isinstance(repo, dict) else str(repo)
    if not url:
        print('      X repository.url 缺失')
        bad += 1
    elif 'example.invalid' in url or 'example.com' in url:
        print('      X repository.url 仍是占位地址：%s' % url)
        bad += 1
    else:
        print('      OK %s' % url[:64])

    # ---------- ③ LICENSE ----------
    print('  [3] LICENSE')
    lic = read_text('LICENSE')
    declared = (pkg.get('license') or '').upper()
    if not lic:
        print('      X LICENSE 文件不存在（但 package.json 声明 %s）' % declared)
        bad += 1
    else:
        first = lic.strip().split('\n')[0][:40]
        print('      OK 文件存在 · package.json 声明 %s' % declared)
        if declared and declared not in lic.upper()[:400]:
            print('      ! LICENSE 正文与声明的类型可能不一致（%s）' % declared)

    # ---------- ④ files 路径都存在 ----------
    print('  [4] package.json files')
    files = pkg.get('files') or []
    # 🔴 0.8.9：必须区分**包含项**与**排除项**。
    #   npm 的 files 数组支持 `!路径` 语法表示"排除"（0.8.9 起用它把
    #   `ai/surface.baseline.json`、`*/fixtures`、`dist/manifest.json`
    #   这三样内部产物挡在包外）。
    #   ⇒ 原来的判据「files 里列的都必须存在」会把 `!x` 也算进去，
    #      然后报「files 里列了但实际不存在」—— **判据本身错了**，
    #      它在惩罚一个正确的排除项。
    #   ⇒ 排除项的正确检查是：**它指向的东西确实存在**（否则这条排除毫无意义）。
    includes = [f for f in files if not f.startswith('!')]
    excludes = [f[1:] for f in files if f.startswith('!')]
    missing = [f for f in includes
               if not os.path.exists(os.path.join(ROOT, f.rstrip('/')))]
    if missing:
        print('      X files 里列了但**实际不存在**：%s' % ', '.join(missing))
    dead_excludes = [f for f in excludes
                     if not os.path.exists(os.path.join(ROOT, f.rstrip('/')))]
    if dead_excludes:
        print('      X files 里的**排除项指向的东西不存在**（这条排除毫无意义）：%s'
              % ', '.join(dead_excludes))
        missing = missing + dead_excludes
    if missing:
        print('      X files 路径有问题（详见上一行）')
        bad += 1
    else:
        print('      OK 包含项 %d 个、排除项 %d 个，路径都存在'
              % (len(includes), len(excludes)))


    # ---------- ⑤ 描述里没有会漂移的数字 ----------
    print('  [5] 描述不含漂移数字')
    desc = pkg.get('description') or ''
    risky = re.findall(r'\d+\s*(?:契约|门禁|道门禁|checks?|contracts?)', desc)
    if risky:
        print('      X 描述里含会漂移的计数：%s' % ', '.join(risky))
        print('        （数字会过时，评审点名批评过）')
        bad += 1
    else:
        print('      OK %s' % (desc[:52] or '(空)'))


    # ---------- ⑥ main 不得指向类型定义 ----------
    print('  [6] 入口契约')
    if pkg.get('main'):
        m = pkg['main']
        if m.endswith('.d.ts') or m.endswith('.ts'):
            print('      X main 指向类型定义：%s' % m)
            print('        运行时 require() 会拿到 .d.ts，导入即失败')
            bad += 1
        elif not os.path.isfile(os.path.join(ROOT, m)):
            print('      X main 指向的文件不存在：%s' % m)
            bad += 1
        else:
            print('      OK main = %s' % m)
    else:
        print('      OK 无 main（本库无 JS 运行时入口，行为走 script 标签）')

    # ---------- ⑦ exports 里的路径都真实存在 ----------
    #  ⚠️ 判的是**仓库内**存在性。这不是"包内也有"——
    #     两者是不同的东西，本库真踩过（外部审计第 1 条）：
    #     `exports["."].default` = `./index.html`，仓库里有，
    #     而 `files` 白名单没写它 ⇒ 0.9.0 的 tarball 里 0 个 index.html。
    #     ⇒ 本节只负责"路径有没有写错"，**包内清单由 `pack-closure.js` 判**
    #       （用 `npm pack --dry-run --json` 的权威清单）。别在这里补实现：
    #       E31 —— 同一判定写两遍必然漂移。
    print('  [7] exports 路径在仓库内存在（**包内**清单见 pack-closure）')
    ex = pkg.get('exports') or {}
    ex_bad = []

    def _walk_targets(v):
        """🔴 exports 的值有**四种**形态，都要走到。

        ① 字符串：`"./tokens.css": "./dist/01-tokens/tokens.css"`
        ② **条件导出对象**（0.8.9 为让现代 TS 能拿到类型才加的）：
             `".": { "types": "./types/index.d.ts", "default": "./index.html" }`
           ⇒ 最早的判据直接 `v.endswith('*')`，遇到 dict 抛
             `AttributeError: 'dict' object has no attribute 'endswith'`。
        ③ 嵌套条件：`{"node": {"import": ...}}`
        ④ 数组回退链：`["./a.js", "./b.js"]`

        ⚠️ 0.9.0 时这一版只认到 ② 的**第一层**（`v.values()` 里挑 str），
           ③④ 静默漏掉 —— 又是"判据只认一种形态"这个病。
           ⇒ 现在一律递归，string / list / dict 三种全展开。
        """
        if isinstance(v, str):
            return [v]
        if isinstance(v, list):
            out = []
            for x in v:
                out.extend(_walk_targets(x))
            return out
        if isinstance(v, dict):
            out = []
            for x in v.values():
                out.extend(_walk_targets(x))
            return out
        return []

    n_cond = 0
    for k, v in ex.items():
        if isinstance(v, (dict, list)):
            n_cond += 1
        for t in _walk_targets(v):
            if t.endswith('*') or k.endswith('.json'):
                continue          # 通配与元数据跳过
            if not os.path.isfile(os.path.join(ROOT, t.lstrip('./'))):
                ex_bad.append('%s -> %s' % (k, t))
    if ex_bad:
        print('      X exports 指向不存在的文件：%s' % ', '.join(ex_bad[:3]))
        bad += 1
    else:
        print('      OK exports %d 条（含 %d 个条件/数组入口）在仓库内存在'
              % (len(ex), n_cond))
        print('         ⚠️ 本节**不**判包内清单：tarball 是另一回事，'
              '由 pack-closure 判')

    # ---------- ⑧ devDependencies 存在（可复现）----------
    print('  [8] devDependencies 可复现')
    dev = pkg.get('devDependencies') or {}
    lock = [f for f in ('package-lock.json', 'pnpm-lock.yaml', 'yarn.lock')
            if os.path.isfile(os.path.join(ROOT, f))]
    if not dev:
        print('      ! devDependencies 为空 ⇒ 陌生开发者无法复现门禁环境')
    elif not lock:
        print('      ! 有 devDependencies 但**缺锁文件** ⇒ 版本会漂移')
    else:
        print('      OK devDependencies %d 项 + %s' % (len(dev), lock[0]))

    # ---------- ⑨ 对外文档必须进包（0.8.1 收口时发现）----------
    #  起因：README 里写着「START-HERE.md（根目录）是给人类复用者的三步清单」，
    #  而 files 白名单里根本没有它 —— npm 用户照着 README 找不到那个文件。
    #  同一批漏掉的还有 API.md / ERRORS.md / SUPPORT.md / CHANGELOG.md / docs/。
    #  ⇒ 文档写了、包里没有，等于这份文档对 npm 用户不存在。
    #  判据：仓库里的**对外文档**（根级 .md + docs/）必须在 files 白名单里。
    print('  [9] 对外文档都进了包')

    def in_files(rel):
        for f in files:
            f2 = f.rstrip('/')
            if rel == f2 or rel.startswith(f2 + '/'):
                return True
        return False

    miss = []
    for name in sorted(os.listdir(ROOT)):
        if name.endswith('.md') and os.path.isfile(
                os.path.join(ROOT, name)) and not in_files(name):
            miss.append(name)
    if os.path.isdir(os.path.join(ROOT, 'docs')) and not in_files('docs'):
        miss.append('docs/')
    if miss:
        print('      X 这些对外文档不在 files 白名单 ⇒ npm 包里读不到：%s'
              % '、'.join(miss))
        bad += 1
    else:
        print('      OK 根级 .md 与 docs/ 都在包里')
    print('')

    # ---------- ⑩ git tag 锚点（0.8.9 加 · 外部审计 P1-3）----------
    #  事故：本库此前 **0 个 tag**，于是「0.8.8 发布了什么」无法与某个
    #  提交点对应 —— 外部使用者按版本回溯不了。
    #  判据：当前版本必须有 **annotated** tag `v<版本>`，
    #        且该 tag 指向的提交里 VERSION 文件就是这个版本。
    #  ⚠️ 为什么要求"该提交的 VERSION 一致"：只查 tag 存在的话，
    #    给任意提交打个 v0.8.8 也能过 —— 那等于没有锚点。
    print('  [10] git tag 锚点')
    ver_now = read_text('VERSION').strip() if os.path.isfile(
        os.path.join(ROOT, 'VERSION')) else None
    tag = 'v%s' % ver_now if ver_now else None

    def _git(*args):
        """→ str（成功）/ None（**git 本身跑不起来**）。

        🔴 必须区分这两种失败（0.8.9 实测踩到）：
          第一版这里把异常吞成 ''，于是 `git cat-file` 因为
          **subprocess 没 import** 而抛错 ⇒ 判据说「没有 v0.8.8 这个 tag」，
          而 tag 明明在（`git tag -l` 打得出来）。
          ⇒ 「工具坏了」被报成「事实不满足」，是最难查的一类假红。
        """
        try:
            return subprocess.run(
                ('git',) + args, cwd=ROOT, capture_output=True, text=True,
                timeout=20).stdout.strip()
        except Exception:
            return None

    _probe = _git('rev-parse', '--git-dir')
    if _probe is None or _probe == '':
        print('      X git 不可用 ⇒ 「tag 锚点」这条判据**视野已空**，'
              '不许判通过（也不能判"没有 tag"）')
        bad += 1
        _git_ok = False
    else:
        _git_ok = True
    tag_type = _git('cat-file', '-t', tag) if (tag and _git_ok) else ''
    if not _git_ok:
        pass
    elif not tag_type:
        # 🔴 2026-10-23 实测：CI 从 10-19 起一直红在这条，而本地全绿 ——
        #    因为 actions/checkout 默认 fetch-depth: 1，tag 指向的是祖先提交，
        #    **根本不会被抓下来**，于是"没有 tag"被报成事实，实际是"没取到"。
        #    ⇒ 浅克隆必须单独说清楚，否则下一个人会去补一个已存在的 tag。
        _shallow = (_git('rev-parse', '--is-shallow-repository') or '').strip() == 'true'
        if _shallow:
            print('      X 这是**浅克隆**，`%s` 没有被取下来 ⇒ 无法判断 tag 是否存在'
                  % tag)
            print('        先 `git fetch --tags --unshallow`；CI 上应在 checkout 设')
            print('        `fetch-depth: 0` + `fetch-tags: true`（本仓只有 2 MB）')
        else:
            print('      X 没有 `%s` 这个 tag ⇒ 版本与提交点之间没有锚点'
                  % tag)
            print('        打一个：git tag -a %s <版本对应的提交>' % tag)
        bad += 1
    elif tag_type != 'tag':
        print('      X `%s` 是 lightweight tag（%s）'
              ' ⇒ 没有 tag message，回溯时看不到"这一版是什么"'
              % (tag, tag_type))
        bad += 1
    else:
        at_ver = _git('show', '%s:VERSION' % tag).strip()
        if at_ver != ver_now:
            print('      X `%s` 指向的提交里 VERSION=%r，而当前是 %r'
                  ' ⇒ 锚点指错了地方' % (tag, at_ver, ver_now))
            bad += 1
        else:
            print('      OK %s（annotated）指向的提交 VERSION 也是 %s'
                  % (tag, ver_now))
    print('')

    # ---------- ⑪ CHANGELOG 结构（0.8.9 加 · 外部审计 P1-3）----------
    #  之前是"自创格式"：版本标题 `## 0.8.8 — 2026-10-14`、文件里两个 H1、
    #  无 `[Unreleased]`。工具链解析不了（Keep a Changelog 的形状是
    #  `## [x.y.z] - YYYY-MM-DD`）。
    #  判据四条，全部机械可判：
    #    ① 恰有一个 H1，且在最前
    #    ② 有 `## [Unreleased]`
    #    ③ 每个版本标题都带日期（由 `_changelog.HEADING` 保证）
    #    ④ 版本条目严格降序（旧在上还是新在上要一致 —— 本库取新在上）
    print('  [11] CHANGELOG 结构')
    cl_path = os.path.join(ROOT, 'CHANGELOG.md')
    if not os.path.isfile(cl_path):
        print('      X 找不到 CHANGELOG.md')
        bad += 1
    else:
        cl = io.open(cl_path, encoding='utf-8').read()
        h1 = [i for i, l in enumerate(cl.split('\n'))
              if l.startswith('# ') and not l.startswith('## ')]
        if len(h1) != 1 or h1[0] != 0:
            print('      X 应**恰有一个** H1 且在第 1 行；实测 %d 个，'
                  '行号 %s' % (len(h1), [i + 1 for i in h1][:4]))
            bad += 1
        if not _changelog.UNRELEASED.search(cl):
            print('      X 缺 `## [Unreleased]` 段'
                  '（Keep a Changelog 的第一段）')
            bad += 1
        hs = _changelog.headings(cl)
        if not hs:
            print('      X 一个版本条目都没认出来 ⇒ 这条判据视野已空')
            bad += 1
        else:
            vers = [tuple(int(x) for x in h[0].split('.')) for h in hs]
            if vers != sorted(vers, reverse=True):
                print('      X 版本条目不是降序（新在上）：%s'
                      % [h[0] for h in hs][:6])
                bad += 1
            elif hs[0][0] != ver_now:
                print('      X 最新版本条目是 %s，而 VERSION 是 %s'
                      ' ⇒ 改了版本号却没在 CHANGELOG 加条目'
                      % (hs[0][0], ver_now))
                bad += 1
            else:
                print('      OK 单 H1 + [Unreleased] + %d 个版本条目降序'
                      '（最新 %s = VERSION）' % (len(hs), hs[0][0]))
    print('')

    # ---------- ⑫ 发布前自检（0.8.9 加 · 发布工程收口）----------
    #  这一节挡的是"**能发出去、但发错了**"的几种形状。
    #  全部可离线判定 —— 门禁不该在 CI 里依赖 registry。
    #
    #  为什么要有它：本库真实踩过「README 教人 `npm install frontend-lib`，
    #  而那个名字是别人 2017 年的包」。那次之后包名改成了 agentcss，
    #  但**没有任何东西**在守"README 里的包名 == package.json.name"。
    print('  [12] 发布前自检')
    pub = publish_problems(pkg, files, read_text('README.md') or '')
    if pub:
        for m in pub:
            print('      X %s' % m)
        bad += len(pub)
    else:
        print('      OK private 未设 · access=public · prepublishOnly 就位'
              ' · 无 prepack · files 无通配 · README 包名一致')
    print('')
    if bad:
        print('  => 有 %d 项发布契约未闭环' % bad)
        return 1
    print('  OK 发布契约闭环')
    return 0


# ---------------------------------------------------------------------------
# 发布前自检的判据（**纯函数**，便于自检）
# ---------------------------------------------------------------------------
#  为什么抽成函数：这些判断全是"看几个结构"，抽出来就能用合成输入做反向控制 ——
#  不用每次拷整个仓库（那样 5 个用例要几十秒，实际上没人会给它写测试）。
#  **可测性是判据能不能被守住的前提。**
def publish_problems(pkg, files, readme):
    """→ [问题描述]。空列表 = 通过。"""
    out = []

    if pkg.get('private') is True:
        out.append('`private: true` ⇒ npm 会直接拒绝发布')

    acc = (pkg.get('publishConfig') or {}).get('access')
    if acc != 'public':
        out.append('publishConfig.access = %r（未配 scope 的包应为 "public"）'
                   % acc)

    scripts = pkg.get('scripts') or {}
    if not (scripts.get('prepublishOnly') or '').strip():
        out.append('缺 `prepublishOnly` ⇒ `npm publish` 会**跳过全部门禁**，'
                   '把没验过的树发出去')
    if (scripts.get('prepack') or '').strip():
        out.append('有 `prepack` ⇒ 它连 `npm pack` 也会触发，'
                   '而 `pack-smoke` 内部就调 `npm pack` ⇒ 可能递归')

    wild = [f for f in files if f.strip() in ('*', './', '.', '')]
    if wild:
        out.append('`files` 里有 %r ⇒ 等于把整个仓库发出去' % wild)

    # README 里的**裸包名**必须等于 package.json.name
    toks = re.findall(r'npm (?:install|i)\s+([^\s`"\'）)]+)', readme or '')
    names = []
    for t in toks:
        t = t.rstrip('，。、,;')
        if ':' in t:                              # github: / file: / https:
            continue
        if t.startswith(('-', '.', '/')):
            continue
        if '/' in t and not t.startswith('@'):     # 相对路径
            continue
        names.append(t if t.startswith('@') else t.split('@')[0])
    wrong = sorted({n for n in names if n != pkg.get('name')})
    if wrong:
        out.append('README 里写了 `npm install %s`，而包名是 %r'
                   ' ⇒ 照做的人会装到别的东西（本库真实踩过）'
                   % (wrong[0], pkg.get('name')))
    return out


# ---------------------------------------------------------------------------
# 自检（本库纪律：没有反向控制的判据不算门禁）
#  6 个反样本（每个都必须被抓）+ 4 个正样本（不许误报）
# ---------------------------------------------------------------------------
def _selftest():
    OK_PKG = {
        'name': 'agentcss',
        'publishConfig': {'access': 'public'},
        'scripts': {'prepublishOnly': 'npm run publish:check'},
    }
    OK_FILES = ['dist/', 'ai/', 'README.md']
    OK_README = ('```bash\nnpm install agentcss\n```\n'
                 '也可以 `npm install github:owain323/frontend-lib`。')
    bad = 0

    def chk(label, got, want_red):
        nonlocal bad
        red = bool(got)
        ok = red == want_red
        print('  %s %-44s %s' % ('OK ' if ok else '🔴 ', label,
                                 (got[0][:46] if got else '(通过)')))
        if not ok:
            bad += 1

    def mod(fn, files=None, readme=None):
        import copy
        p = copy.deepcopy(OK_PKG)
        fn(p)
        return publish_problems(p, files or OK_FILES,
                                OK_README if readme is None else readme)

    chk('正：原样通过', publish_problems(OK_PKG, OK_FILES, OK_README), False)
    chk('反：private=true', mod(lambda p: p.update(private=True)), True)
    chk('反：access 不是 public',
        mod(lambda p: p.update(publishConfig={'access': 'restricted'})), True)
    chk('反：缺 prepublishOnly',
        mod(lambda p: p['scripts'].pop('prepublishOnly')), True)
    chk('反：有 prepack', mod(lambda p: p['scripts'].update(prepack='x')), True)
    chk('反：files 里有 "*"',
        mod(lambda p: None, files=OK_FILES + ['*']), True)
    chk('反：README 包名不符',
        mod(lambda p: None, readme='npm install frontend-lib'), True)
    for label, rd in [
        ('不误报：git 安装', 'npm install github:owain323/frontend-lib'),
        ('不误报：本地 tgz', 'npm install ./agentcss-0.8.9.tgz'),
        ('不误报：带版本号', 'npm install agentcss@0.9.0'),
        ('不误报：没写安装段', '# 安装\n\n见 docs/RELEASING.md'),
    ]:
        chk(label, publish_problems(OK_PKG, OK_FILES, rd), False)

    print('')
    print('  ' + ('🔴 %d 条自检未通过' % bad if bad
                  else '自检全部通过 ⇒ 判据有鉴别力、也不误报'))
    return 1 if bad else 0


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(_selftest())
    sys.exit(main())
