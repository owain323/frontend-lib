# -*- coding: utf-8 -*-
"""
_common.py — 门禁脚本共享的常量

===========================================================================
🔴 为什么要有这个文件
---------------------------------------------------------------------------
  同一天里 **三道门禁**（mojibake / viewport / contrast）同时变红，
  根因**完全一样**：`10-review/shots/_current/` 里存的是**截图产物**，
  但扩展名被写成 `.html`（内容其实是 PNG 二进制）。

  ⇒ 任何 `glob('**/*.htm*')` 或 `os.walk` 的门禁都会扫到它们，
    然后报出**莫名其妙的错**（"编码损坏" / "缺 meta viewport" / 直接崩）。

  ⚠️ 最坏的后果不是红，而是**红得没有意义** ——
     大家会习惯性忽略，然后真正的新问题也一起被忽略。

  ⇒ 正解：**产物目录集中在这里定义**，所有门禁从这里 import。
     新增产物目录时只改一处，不会再漏掉某个门禁。
===========================================================================
"""
import fnmatch
import io
import os
import subprocess

# ⭐ 视觉回归的产物目录（截图、diff 图、自检产物）。
#    ⚠️ 它们**不是交付物**，不该被任何内容门禁扫描。
#    ⚠️ `_current/` 里的文件扩展名是 .html 但内容是 PNG —— 这是坑的来源。
ARTIFACT_DIRS = (
    '10-review/shots/_current',
    '10-review/shots/_diff',
    '_selftest',
    'node_modules',
    '.git',
)


# ⭐ 派生产物目录：**是交付物，但由源码生成**（dist/ 由 build-dist.py 产出）。
#    ⚠️ 它和 ARTIFACT_DIRS 的处置**不同**，别混为一谈：
#      · ARTIFACT_DIRS（截图等）⇒ 内容门禁**不该扫**（扩展名骗人）
#      · DERIVED_DIRS（dist/）  ⇒ 内容门禁**要扫**，但判定规则必须与源路径一致
#
#    🔴 为什么必须一致（2026-10-08 实测，两个门禁同时误报红）
#       `dist/01-tokens/tokens.css` 是 `01-tokens/tokens.css` 的产物，内容同源。
#       但 bleed-gate 的 reset 例外、legacy-api-gate 的 polyfill 豁免
#       都是**按路径前缀**写的（`rel.startswith('01-tokens')`）⇒ dist 那一侧不生效。
#       结果：源码侧允许、产物侧报错 —— 同一份内容给出两个相反结论。
#       这不是「dist 有问题」，而是**门禁把规则写在了路径上而不是内容上**。
DERIVED_DIRS = ('dist/',)


def is_artifact(path, root=None):
    """判断一个路径是否属于「产物 / 不该被内容门禁扫」"""
    p = str(path).replace(os.sep, '/')
    return any(a in p for a in ARTIFACT_DIRS)


def origin_of(rel):
    """
    派生产物 ⇒ 源路径：'dist/01-tokens/tokens.css' ⇒ '01-tokens/tokens.css'
    非派生产物原样返回。

    用法：凡是要用**路径**决定例外/豁免/归属的地方，先过一遍这个函数，
          规则就只写一份（写在源码路径上），产物自动跟随。
    """
    r = str(rel).replace(os.sep, '/')
    for d in DERIVED_DIRS:
        if r.startswith(d):
            return r[len(d):]
    return r


def exclude_artifacts(paths):
    """从路径列表里剔除产物目录里的文件"""
    return [p for p in paths if not is_artifact(p)]


def scannable_files(root):
    """
    门禁应当扫描的文件清单 = 已跟踪 ∪ 未跟踪但未被 .gitignore 忽略。

    🔴 为什么不能只用 `git ls-files`（2026-10-08 实测事故）
       dist/ 刚生成、还没 `git add` 时，`git ls-files` **看不见它**
       ⇒ bleed / legacy-api 两道门禁本地全绿 ⇒ 提交 ⇒ clone 里跑 ⇒ 立刻红。
       同一份内容，门禁因为**索引状态**给出两个相反结论。

       ⚠️ 这类假绿最难查：maintainer 本地永远绿，只有陌生人一上来就撞上。
       ⚠️ 而未跟踪文件恰恰是**最该被门禁看的** —— 它是刚写完的新代码。

    ⇒ 门禁的视野必须是「磁盘上要交付的东西」，不是「git 索引里有什么」。

    ⚠️ 本函数**不适合** repo-hygiene 那类「判断是否混进库」的门禁
       —— 那种门禁的正确语义正是「只查索引」（工作区里留着是对的）。
    """
    def _run(args):
        try:
            out = subprocess.run(
                ['git', '-c', 'core.quotePath=false'] + args,
                cwd=root, capture_output=True, timeout=60)
        except Exception:
            return []
        return [f for f in out.stdout.decode('utf-8', 'replace').split('\n')
                if f.strip()]

    seen, files = set(), []
    for f in _run(['ls-files']) \
            + _run(['ls-files', '--others', '--exclude-standard']):
        if f not in seen:
            seen.add(f)
            files.append(f)

    # 🔴 没有 git（zip / tarball 解压出来的树、或机器没装 git）⇒ 退回文件系统遍历
    #    ⚠️ 不退回的后果是**假绿**：扫到 0 个文件 ⇒ 什么都没抓到 ⇒ 报"通过"。
    #       api-doc 会红（它要求两边数量一致），但 leak-scan 这类"扫到才算问题"
    #       的门禁会**安静地通过** —— 这比红更危险。
    #    实测发现路径：把远端 tarball（无 .git）当干净克隆跑全套门禁，
    #       api-doc 报"实现里挂载的全局对象：0 个"、leak-scan 四个注入全没抓到。
    if not files:
        files = _walk_all(root)
    return files


def _ignore_patterns(root):
    """.gitignore 里的模式（够用的子集）。

    ⚠️ 诚实的边界：这不是一个完整的 gitignore 实现。只认三种最常见的写法 ——
       目录名（`node_modules/`）、扩展名（`*.png`）、整条路径（`dist/x.css`）。
       否定式（`!foo`）与 `**` 不认。
       它服务于"无 git 时的兜底"，不是要替代 git。
    """
    pats = []
    p = os.path.join(root, '.gitignore')
    if not os.path.isfile(p):
        return pats
    try:
        raw = io.open(p, encoding='utf-8', errors='replace').read()
    except IOError:
        return pats
    for ln in raw.splitlines():
        s = ln.strip()
        if not s or s.startswith('#'):
            continue
        neg = s.startswith('!')
        if neg:
            s = s[1:]
        pats.append((neg, s.rstrip('/')))
    return pats


def _ignored(rel, pats):
    """后写的规则说了算（与 git 一致），`!` 开头的把前面命中的重新放行。

    ⚠️ 为什么必须认否定式：`.gitignore` 里就有
         `10-review/shots/*.png` + `!10-review/shots/_baseline/`
       —— 不认 `!` 的话，兜底视野会把**已入库的基线截图**也排除掉
         （实测本地 git 视野 463 个文件、兜底只剩 432）。
    """
    hit = False
    name = os.path.basename(rel)
    for neg, pat in pats:
        if '/' in pat:
            m = fnmatch.fnmatch(rel, pat) or rel.startswith(pat + '/')
        else:
            m = (fnmatch.fnmatch(rel, pat) or fnmatch.fnmatch(name, pat)
                 or rel.split('/')[0] == pat)
        if m:
            hit = not neg
    return hit


def _walk_all(root):
    """兜底：遍历文件系统，跳过产物目录与 .gitignore 命中的路径"""
    pats = _ignore_patterns(root)
    out = []
    for dirpath, _dirnames, filenames in walk_filtered(root):
        for fn in filenames:
            rel = os.path.relpath(os.path.join(dirpath, fn), root)
            rel = rel.replace(os.sep, '/')
            if pats and _ignored(rel, pats):
                continue
            out.append(rel)
    return sorted(out)


def walk_filtered(root, skip_dirs=None):
    """
    os.walk 的包装：自动跳过产物目录。

    ⚠️ 必须**在遍历时就剪枝**（改 dirnames），
       事后过滤文件名是不行的 —— 那样仍会进到产物目录里。
    用法：
        for dirpath, dirnames, filenames in walk_filtered(ROOT):
            ...
    """
    skip = set(ARTIFACT_DIRS) | set(skip_dirs or ())
    for dirpath, dirnames, filenames in os.walk(root):
        rel = os.path.relpath(dirpath, root).replace(os.sep, '/')
        rel = '' if rel == '.' else rel
        dirnames[:] = [d for d in dirnames
                       if d not in skip
                       and ((rel + '/' + d) if rel else d) not in skip]
        yield dirpath, dirnames, filenames
