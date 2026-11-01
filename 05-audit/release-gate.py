#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
release-gate.py — 发布契约门禁（检查项 J4/J5/J6）

===========================================================================
🔴 为什么需要
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
import glob
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


# ===========================================================================
# tag 锚点（[10]）—— 从「有这个 tag」升级为「这个 tag 声明了哪个提交」
# ===========================================================================
# 旧判据只比 `tag:VERSION == 当前 VERSION`：
#   同版本号打在 master 的历史提交上，它照样绿 —— 于是「发布了什么」仍然是
#   隐含选择，而不是一条可核的记录。
# 新判据要求 tag 消息显式写下 source-commit，并验证 tag 确实指向它。
#
# 🔴 为什么需要版本下限（而不是"白名单"或"日期"）：
#   v0.24.1 已经在远端，tag 对象不可改写；若立刻要求 source-commit，
#   今天这道门禁就会假红，而修复方式只能是改历史 tag —— 那比缺陷更糟。
#   ⇒ 用一个**一次性**常量把策略生效点钉在 0.24.2：那之后永久生效，不会腐化。
MIN_SOURCE_COMMIT = (0, 24, 2)

# tag 消息里的声明行。要求**完整 40 位**：短 SHA 有歧义空间，
# 而这条记录的全部价值就是"没有歧义地指认一个提交"。
RE_SOURCE_COMMIT = re.compile(r'^source-commit:[ \t]*(\S+)[ \t]*$', re.M)
RE_FULL_SHA = re.compile(r'^[0-9a-fA-F]{40}$')


def _ver_tuple(s):
    m = re.match(r'^(\d+)\.(\d+)\.(\d+)$', (s or '').strip())
    return tuple(int(x) for x in m.groups()) if m else None


def git_anchor_problems(cwd, tag, ver_now, min_version=MIN_SOURCE_COMMIT):
    """判定 tag 锚点。返回 [问题]；空列表 = 通过。

    单独成函数的原因：它需要**真实 git 仓库**才能被有意义地测试
    （annotated vs lightweight、祖先关系都不可能在内存里伪造）。
    反向测试在 `_selftest()` 里用临时仓库跑。
    """
    def g(*args):
        try:
            return subprocess.run(
                ('git',) + args, cwd=cwd, capture_output=True, text=True,
                timeout=20).stdout.strip()
        except Exception:
            return None

    if g('rev-parse', '--git-dir') in (None, ''):
        return ['git 不可用 ⇒ 「tag 锚点」这条判据**视野已空**，'
                '不许判通过（也不能判"没有 tag"）']

    kind = g('cat-file', '-t', tag)
    if not kind:
        # 浅克隆与"真没有"必须分开说，否则下一个人会去补一个已存在的 tag
        shallow = (g('rev-parse', '--is-shallow-repository') or '') == 'true'
        if shallow:
            return ['这是**浅克隆**，`%s` 没有被取下来 ⇒ 无法判断 tag 是否存在' % tag,
                    '先 `git fetch --tags --unshallow`；CI 上应在 checkout 设 '
                    '`fetch-depth: 0` + `fetch-tags: true`（本仓只有 2 MB）']
        return ['没有 `%s` 这个 tag ⇒ 版本与提交点之间没有锚点' % tag,
                '打一个：git tag -a %s <版本对应的提交>' % tag]

    if kind != 'tag':
        # 两种成因要分开说，否则会去重打一个本来就对的 tag
        return ['`%s` 在**本地**是轻量 ref（指向 %s），没有 tag message' % (tag, kind),
                '若在 CI 上：checkout 只留了轻量 ref，tag 对象没抓下来。'
                '先 `git fetch --tags --force origin` 再判',
                '若在本机：说明确实打成了轻量 tag，重打一个：'
                'git tag -a %s <版本对应的提交>' % tag]

    out = []
    commit = g('rev-parse', '--verify', '%s^{commit}' % tag)
    if not commit:
        return ['无法解析 `%s` 指向的提交' % tag]

    # ② tag 内 VERSION 必须就是当前版本（旧判据，保留）
    at_ver = g('show', '%s:VERSION' % tag)
    if (at_ver or '').strip() != (ver_now or '').strip():
        out.append('`%s` 指向的提交里 VERSION=%r，而当前是 %r ⇒ 锚点指错了地方'
                   % (tag, (at_ver or '').strip(), ver_now))

    # ③ source-commit 声明
    obj = g('cat-file', '-p', tag) or ''
    body = obj.partition('\n\n')[2]          # 跳过 tag 对象头部
    decls = RE_SOURCE_COMMIT.findall(body)
    if len(decls) > 1:
        out.append('`%s` 的消息里有 %d 条 `source-commit:`（只允许 1 条）'
                   % (tag, len(decls)))
    elif len(decls) == 1:
        decl = decls[0]
        if not RE_FULL_SHA.match(decl):
            out.append('`%s` 的 source-commit=%r 不是完整 40 位十六进制'
                       % (tag, decl))
        else:
            resolved = g('rev-parse', '--verify', '%s^{commit}' % decl)
            if not resolved:
                out.append('`%s` 声明的 source-commit=%s 在仓库里无法解析'
                           % (tag, decl))
            elif resolved.lower() != commit.lower():
                out.append('`%s` 声明的 source-commit=%s，而 tag 实际指向 %s'
                           ' ⇒ 声明与指向不一致'
                           % (tag, decl[:12], commit[:12]))
    else:
        v = _ver_tuple(ver_now)
        if v and v >= min_version:
            out.append('`%s` 没有 `source-commit:` 声明 —— 从 %s 起，'
                       'tag 消息必须写明它指向哪个提交'
                       % (tag, '.'.join(str(x) for x in min_version)))
            out.append('模板：git tag -a %s -m "source-commit: <40 位提交>"'
                       % tag)

    # ④ 必须被至少一个远端分支包含（挡住"给游离提交打 tag"）
    tips = [x.split()[0] for x in (g(
        'for-each-ref', '--format=%(objectname)',
        'refs/remotes/origin') or '').splitlines() if x.strip()]
    if not tips:
        out.append('看不到任何 `refs/remotes/origin/*` ⇒ 无法判断这个 tag '
                   '是否属于已发布分支，**不许判通过**'
                   '（先 `git fetch origin`）')
    else:
        contained = False
        for tip in tips:
            rc = subprocess.run(
                ('git', 'merge-base', '--is-ancestor', commit, tip),
                cwd=cwd, capture_output=True).returncode
            if rc == 0:
                contained = True
                break
        if not contained:
            # 浅克隆里 merge-base 可能因为对象缺失而失败 —— 那是"看不到"，
            # 不是"不属于"。两者都判红（不许放行），但必须说清是哪一种。
            shallow = (g('rev-parse', '--is-shallow-repository') or '') == 'true'
            if shallow:
                out.append('这是**浅克隆** ⇒ 无法判断 %s 是否属于远端分支'
                           '（先 `git fetch --unshallow`）' % commit[:12])
            else:
                out.append('`%s` 指向的提交 %s 不被任何远端分支包含 '
                           '⇒ 它不属于任何已发布分支'
                           % (tag, commit[:12]))
    return out


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

        # ---- ①b package-lock.json 的根包版本----
        #  package.json = 0.7.7，而 package-lock.json 的根包还是 0.3.0。
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
            # 🔴 通配符可能**在中间**（`./esm/*.mjs`），不能只判 `endswith('*')`。
            #   0.11.15 加 esm 入口时踩到：判据把 `esm/*.mjs` 当成字面路径，
            #   报「exports 指向不存在的文件」—— 其实它匹配 17 个真实文件。
            #   正确判据是「通配至少匹配到一个文件」，而不是「跳过」：
            #   跳过会让 `./nope/*.js` 这种真打错的路径也过。
            if '*' in t:
                if not glob.glob(os.path.join(ROOT, t.lstrip('./'))):
                    ex_bad.append('%s -> %s（通配无匹配）' % (k, t))
                continue
            if k.endswith('.json'):
                continue          # 元数据
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

    # ---------- ⑩ git tag 锚点（0.8.9 加 · 外部审计 P1-3；2026-11 强化）----------
    #  演进：
    #    0.8.9  只要求"有这个 annotated tag，且 tag 里 VERSION 对得上"。
    #           问题：同版本号打在 master 的**历史提交**上，它照样绿 ——
    #           「发布了什么」仍然是隐含选择，而不是一条可核的记录。
    #    现在   要求 tag 消息显式写 `source-commit: <40 位>`，并验证
    #           tag 确实指向它；另外要求该提交被至少一个远端分支包含。
    #  仍然**抓不到**：同版本号打在 master 的历史提交上（它仍是祖先）。
    #    这是有意的边界 —— 要抓它只能引入发布台账或 CI 输入，
    #    而两者都会把"提交前不知道 SHA"的循环再引回来。
    print('  [10] git tag 锚点')
    ver_now = read_text('VERSION').strip() if os.path.isfile(
        os.path.join(ROOT, 'VERSION')) else None
    tag = 'v%s' % ver_now if ver_now else None
    if not tag:
        print('      X VERSION 读不到 ⇒ 无法确定该锚哪个 tag')
        bad += 1
    else:
        probs = git_anchor_problems(ROOT, tag, ver_now)
        for p in probs:
            print('      X %s' % p)
        if probs:
            bad += 1
        else:
            _tip = subprocess.run(
                ('git', 'rev-parse', '--short=12', '%s^{commit}' % tag),
                cwd=ROOT, capture_output=True, text=True).stdout.strip()
            print('      OK %s（annotated）→ %s · VERSION 一致 · 被远端分支包含'
                  % (tag, _tip))
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
    # ---------- ⑬ 发版自动化（0.11.9 加）----------
    #  这一节挡的是"**发得出去，但发得不可信**"：
    #  手工 publish 无法产生 provenance（本机不是受信任构建环境），
    #  而 provenance 是使用者能独立核对"这个包确实来自这个提交"的唯一手段。
    print('  [13] 发版工作流（tag → 签名发布 → Release）')
    wf = read_text('.github/workflows/release.yml')
    if wf is None:
        print('      X 没有 .github/workflows/release.yml'
              ' ⇒ 发版仍是手工动作，且不可能有 provenance')
        bad += 1
    else:
        wp = workflow_problems(wf)
        if wp:
            for m in wp:
                print('      X %s' % m)
            bad += len(wp)
        else:
            print('      OK tag 触发 · id-token 就位 · --provenance · '
                  'tag==version · secret 缺失有明确报错')
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

def workflow_problems(text):
    """发版工作流必须具备的五件事。→ [问题描述]，空列表 = 通过。

    为什么是这五条而不是"有没有这个文件"：
      文件存在但缺任意一条，等于**看起来自动化了、实际上发不出可信的包** ——
      这比手工发布更危险，因为没人会再去核对。
    """
    out = []
    if 'tags:' not in text or 'v*' not in text:
        out.append('没在 tag（v*）上触发 ⇒ 打标签不会发版')
    if 'id-token: write' not in text:
        out.append('缺 `id-token: write` 权限 ⇒ npm 无法签发 provenance')
    if '--provenance' not in text:
        out.append('`npm publish` 没有 `--provenance` ⇒ 包没有来源签名')
    if 'package.json' not in text or 'GITHUB_REF_NAME' not in text:
        out.append('没有校验 tag 与 package.json 版本一致 ⇒ 可能发出错版本号的包')
    if 'secrets.NPM_TOKEN' not in text:
        out.append('没引用 NPM_TOKEN secret ⇒ 发不出去（且报错会是难懂的 401）')
    if 'contents: write' not in text:
        out.append('缺 `contents: write` ⇒ 建不了 Release')
    return out


def _publish_entry_selftest():
    """证明 publish.sh **不再能发布**（而不是"读起来像不发布"）。

    做法：在临时仓库里放真实脚本 + 一个假 npm（记录 argv），
    然后断言假 npm 从未收到 `publish`。
    这条测试的意义：如果哪天有人把 `npm publish` 加回去，
    它必须在这里变红 —— 所以最后还有一条"元反向"：把 publish 加回去，
    本测试必须能发现。
    """
    import tempfile
    import shutil

    bad = 0
    tmp = tempfile.mkdtemp(prefix='fl-pub-')
    try:
        for d in ('05-audit', 'ai'):
            os.makedirs(os.path.join(tmp, d))
        # 复制**真实脚本**：重写一份就测不到发布入口本身
        for f in ('publish.sh', 'bump-version.py', '_changelog.py'):
            shutil.copy(os.path.join(ROOT, '05-audit', f),
                        os.path.join(tmp, '05-audit', f))

        def w(rel, text):
            with io.open(os.path.join(tmp, rel), 'w',
                         encoding='utf-8', newline='\n') as f:
                f.write(text)

        w('VERSION', '0.24.1\n')
        w('package.json', json.dumps(
            {'name': 'agentcss', 'version': '0.24.1'}, indent=2) + '\n')
        w('package-lock.json', json.dumps({
            'name': 'agentcss', 'version': '0.24.1', 'lockfileVersion': 3,
            'packages': {'': {'name': 'agentcss', 'version': '0.24.1'}},
        }, indent=2) + '\n')
        w('CHANGELOG.md', '# 变更\n\n## [0.24.1] - 2026-01-01\n\n- 初始\n')
        w('ai/components.json', json.dumps(
            {'libraryVersion': '0.24.1'}, indent=2) + '\n')

        def git(*a):
            return subprocess.run(('git',) + a, cwd=tmp,
                                  capture_output=True, text=True)

        git('init', '-q')
        git('config', 'user.email', 'pub@example.invalid')
        git('config', 'user.name', 'pub-test')
        git('add', '-A')
        git('commit', '-qm', 'base')
        git('tag', '-a', 'v0.24.1', '-m', 'selftest')

        bin_posix = os.path.join(tmp, 'bin').replace('\\', '/')

        def run_script(script):
            # 日志放在临时仓库**之外**：放里面会让 `git status` 变脏，
            # 于是"干净工作区"那条永远过不去（第一版就踩了这个）。
            logp = os.path.join(tempfile.gettempdir(),
                                'fl-pub-npm-%d.log' % os.getpid())
            if os.path.isfile(logp):
                os.remove(logp)
            env = dict(os.environ)
            env['FL_NPM_LOG'] = logp.replace('\\', '/')
            # 用**导出函数**替身 npm，而不是往 PATH 里塞脚本：
            # Windows 上无扩展名脚本不一定可执行（实测：找不到 ⇒ 静默走 else 分支）。
            fn = ('npm() { printf "%s\\n" "$*" >> "$FL_NPM_LOG"; '
                  'if [ "$1" = config ]; then '
                  'printf "https://registry.npmjs.org/\\n"; fi; }; ')
            cmd = fn + 'export -f npm; bash "' + script + '"'
            r = subprocess.run(('bash', '-c', cmd), cwd=tmp,
                               capture_output=True, text=True, env=env,
                               timeout=90)
            log = (io.open(logp, encoding='utf-8').read()
                   if os.path.isfile(logp) else '')
            return r, log

        def chk(label, cond, detail=''):
            nonlocal bad
            print('  %s %-48s %s' % ('OK ' if cond else '🔴 ', label, detail))
            if not cond:
                bad += 1

        print('  ---- 发布入口（publish.sh 只诊断）----')

        r, log = run_script('05-audit/publish.sh')
        chk('正：干净工作区 + tag ⇒ 退出 0', r.returncode == 0,
            '' if r.returncode == 0 else (r.stdout or '')[-120:])
        chk('正：输出指向 tag 流程', '诊断通过' in r.stdout)
        chk('反：假 npm 从未收到 publish', 'publish' not in log,
            ('收到：' + log.strip()[:80]) if 'publish' in log else '')

        w('dirty.txt', 'x\n')
        r, log = run_script('05-audit/publish.sh')
        chk('反：脏工作区 ⇒ 非 0 且点名', r.returncode != 0
            and '工作区不干净' in r.stdout)
        os.remove(os.path.join(tmp, 'dirty.txt'))

        git('tag', '-d', 'v0.24.1')
        r, log = run_script('05-audit/publish.sh')
        chk('反：没有 tag ⇒ 非 0 且点名', r.returncode != 0
            and 'annotated tag' in r.stdout)

        # 元反向：把发布动作加回去，本测试必须能发现
        src = io.open(os.path.join(tmp, '05-audit', 'publish.sh'),
                      encoding='utf-8').read()
        head, _, rest = src.partition('\n')
        with io.open(os.path.join(tmp, '05-audit', 'publish-meta.sh'),
                     'w', encoding='utf-8', newline='\n') as f:
            f.write(head + '\nnpm publish --dry-run\n' + rest)
        r, log = run_script('05-audit/publish-meta.sh')
        chk('元反：把 npm publish 加回去 ⇒ 本测试能发现', 'publish' in log)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return bad


def _tag_anchor_selftest():
    """用**真实临时 git 仓库**验证 tag 锚点判据。

    为什么不能用内存夹具：annotated / lightweight、祖先关系、`^{commit}` 解析
    都是 git 的行为，伪造不出来；伪造出来的"通过"不构成证据。

    三条纪律（与本仓其它反向控制同构）：
      ① 每条判据都要有一个**只差一个变量**的对照，否则红了也不知道为什么；
      ② 版本下限要跨版本验证（0.24.1 不假红 / 0.24.2 缺字段红 / 0.25.0 同样生效）；
      ③ 至少一条"把判据参数放宽 ⇒ 必须变绿"，证明红是判据造成的。
    """
    import tempfile
    import shutil

    bad = 0
    dirs = []

    def chk(label, probs, want_red):
        nonlocal bad
        red = bool(probs)
        ok = red == want_red
        print('  %s %-46s %s' % ('OK ' if ok else '🔴 ', label,
                                 (probs[0][:44] if probs else '(通过)')))
        if not ok:
            bad += 1

    def mk(ver, extra_commits=0):
        """建一个仓库，返回 (目录, 提交列表, git 调用器)。"""
        d = tempfile.mkdtemp(prefix='fl-anchor-')
        dirs.append(d)

        def g(*a):
            return subprocess.run(('git',) + a, cwd=d,
                                  capture_output=True, text=True)

        g('init', '-q')
        g('config', 'user.email', 'anchor@example.invalid')
        g('config', 'user.name', 'anchor-test')
        with io.open(os.path.join(d, 'VERSION'), 'w',
                     encoding='utf-8', newline='\n') as f:
            f.write(ver + '\n')
        g('add', '-A')
        g('commit', '-qm', 'base')
        shas = [g('rev-parse', 'HEAD').stdout.strip()]
        for i in range(extra_commits):
            with io.open(os.path.join(d, 'f%d' % i), 'w',
                         encoding='utf-8', newline='\n') as f:
                f.write('x\n')
            g('add', '-A')
            g('commit', '-qm', 'c%d' % i)
            shas.append(g('rev-parse', 'HEAD').stdout.strip())
        return d, shas, g

    print('  ---- tag 锚点（真实 git 仓库）----')

    # ① 旧版本、无声明、提交在远端分支上 ⇒ 必须绿（今天不能假红）
    d, s, g = mk('0.24.1')
    g('update-ref', 'refs/remotes/origin/master', s[0])
    g('tag', '-a', 'v0.24.1', '-m', 'release')
    chk('正：0.24.1 无声明（下限之前）', git_anchor_problems(d, 'v0.24.1', '0.24.1'), False)

    # ② 新版本、无声明 ⇒ 必须红（下限生效）
    d2, s2, g2 = mk('0.24.2')
    g2('update-ref', 'refs/remotes/origin/master', s2[0])
    g2('tag', '-a', 'v0.24.2', '-m', 'release')
    probs = git_anchor_problems(d2, 'v0.24.2', '0.24.2')
    chk('反：0.24.2 无 source-commit', probs, True)
    # ③ 元反向：只把下限抬到该版本之上（等价于"这条策略还没生效"），
    #    同一夹具必须变绿 ⇒ 红确实是下限造成的，而不是夹具本身坏了
    chk('元反：下限抬到版本之上后变绿',
        git_anchor_problems(d2, 'v0.24.2', '0.24.2', min_version=(9, 9, 9)), False)

    # ④ 新版本、声明正确 ⇒ 必须绿
    g2('tag', '-f', '-a', 'v0.24.2', '-m', 'source-commit: ' + s2[0], s2[0])
    chk('正：0.24.2 声明正确', git_anchor_problems(d2, 'v0.24.2', '0.24.2'), False)

    # ⑤ 声明指向另一个提交 ⇒ 必须红（只差"声明"这一个变量）
    d3, s3, g3 = mk('0.24.2', extra_commits=1)
    g3('update-ref', 'refs/remotes/origin/master', s3[1])
    g3('tag', '-a', 'v0.24.2', '-m', 'source-commit: ' + s3[1], s3[0])
    chk('反：声明与指向不一致', git_anchor_problems(d3, 'v0.24.2', '0.24.2'), True)

    # ⑥ 短 SHA ⇒ 必须红
    g3('tag', '-f', '-a', 'v0.24.2', '-m', 'source-commit: ' + s3[0][:7], s3[0])
    chk('反：source-commit 是短 SHA', git_anchor_problems(d3, 'v0.24.2', '0.24.2'), True)

    # ⑦ 重复声明 ⇒ 必须红
    g3('tag', '-f', '-a', 'v0.24.2',
       '-m', 'source-commit: ' + s3[0] + '\nsource-commit: ' + s3[0], s3[0])
    chk('反：两条 source-commit', git_anchor_problems(d3, 'v0.24.2', '0.24.2'), True)

    # ⑧ 版本更高同样受约束（不是只针对 0.24.2 的特例）
    d4, s4, g4 = mk('0.25.0')
    g4('update-ref', 'refs/remotes/origin/master', s4[0])
    g4('tag', '-a', 'v0.25.0', '-m', 'release')
    chk('反：0.25.0 无 source-commit', git_anchor_problems(d4, 'v0.25.0', '0.25.0'), True)
    g4('tag', '-f', '-a', 'v0.25.0', '-m', 'source-commit: ' + s4[0], s4[0])
    chk('正：0.25.0 声明正确', git_anchor_problems(d4, 'v0.25.0', '0.25.0'), False)

    # ⑨ 游离提交（不被任何远端分支包含）⇒ 必须红
    d5, s5, g5 = mk('0.24.2')
    g5('update-ref', 'refs/remotes/origin/master', s5[0])
    g5('checkout', '-q', '--orphan', 'side')
    with io.open(os.path.join(d5, 'side.txt'), 'w',
                 encoding='utf-8', newline='\n') as f:
        f.write('side\n')
    g5('add', '-A')
    g5('commit', '-qm', 'side')
    side = g5('rev-parse', 'HEAD').stdout.strip()
    g5('tag', '-a', 'v0.24.2', '-m', 'source-commit: ' + side, side)
    chk('反：tag 指向游离提交', git_anchor_problems(d5, 'v0.24.2', '0.24.2'), True)

    # ⑩ 轻量 tag ⇒ 必须红（读不到 message）
    d6, s6, g6 = mk('0.24.2')
    g6('update-ref', 'refs/remotes/origin/master', s6[0])
    g6('tag', 'v0.24.2', s6[0])
    chk('反：轻量 tag', git_anchor_problems(d6, 'v0.24.2', '0.24.2'), True)

    # ⑪ 没有任何远端分支 ⇒ 视野为空，必须红（不许"看不到就算过"）
    d7, s7, g7 = mk('0.24.1')
    g7('tag', '-a', 'v0.24.1', '-m', 'release')
    chk('反：看不到远端分支', git_anchor_problems(d7, 'v0.24.1', '0.24.1'), True)

    for d in dirs:
        shutil.rmtree(d, ignore_errors=True)
    return bad


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

    # ---- 发版工作流判据（同样要既能过、也能抓到缺项）----
    # 用 chr(10) 拼行而不是写转义换行：这段已经是「生成 Python 的 Python」，
    # 再叠一层反斜杠转义就会写出一份语法坏掉的门禁脚本（实际发生过一次）。
    NL = chr(10)
    GOOD_WF = NL.join([
        'on:', '  push:', '    tags:', "      - 'v*'",
        'permissions:', '  contents: write', '  id-token: write',
        'jobs:', '  publish:', '    steps:',
        '      - run: |', '          TAG="${GITHUB_REF_NAME#v}"',
        "          PKG=$(node -p \"require('./package.json').version\")",
        '      - run: npm publish --provenance --access public',
        '        env:', '          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}',
    ])
    chk('正：工作流五条齐备', workflow_problems(GOOD_WF), False)
    chk('反：去掉 --provenance',
        workflow_problems(GOOD_WF.replace('--provenance ', '')), True)
    chk('反：去掉 id-token',
        workflow_problems(GOOD_WF.replace('  id-token: write' + NL, '')), True)
    chk('反：不校验 tag 与版本',
        workflow_problems(GOOD_WF.replace("require('./package.json')", 'x')), True)
    chk('反：没引用 NPM_TOKEN',
        workflow_problems(GOOD_WF.replace('{{ secrets.NPM_TOKEN }}', 'token')), True)

    bad += _tag_anchor_selftest()
    bad += _publish_entry_selftest()

    # release-run.sh 的状态机自检由本门禁代跑：避免为它再加一条注册
    # （"每条风险都配一道新门禁"正是要避免的那种治理）。
    try:
        _rr = subprocess.run(
            ('bash', os.path.join(ROOT, '05-audit', 'release-run.sh'), '--selftest'),
            cwd=ROOT, capture_output=True, text=True, timeout=180)
        if _rr.returncode != 0:
            print('  🔴 release-run.sh --selftest 未通过')
            print((_rr.stdout or '')[-600:])
            bad += 1
        else:
            print('  OK  release-run.sh 状态机自检（7 条）')
    except Exception as e:
        print('  🔴 release-run.sh --selftest 跑不起来：%s' % e)
        bad += 1

    print('')
    print('  ' + ('🔴 %d 条自检未通过' % bad if bad
                  else '自检全部通过 ⇒ 判据有鉴别力、也不误报'))
    return 1 if bad else 0


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(_selftest())
    sys.exit(main())
