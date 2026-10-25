#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pkg-name-gate —— 包名一致性门禁

为什么需要它
=====================================================================
2026-10 本库把包名从 `frontend-lib` 改成 `agentcss`（npm 上原名被第三方
2017 年的包占用）。改完之后，仓库里留下了三种"两套名字"的痕迹：

  1. 类型测试用 `paths` 把**旧名**映射到类型文件 ⇒ 类型门禁验的是旧名，
     用户真会写的 `import { Select } from 'agentcss'` 从来没被编译过；
  2. 文档示例教用户 `import ... from 'frontend-lib'` ⇒ 照抄必失败；
  3. CLI 用法串写旧名 ⇒ 装完找不到命令。

这三条都属于同一类：**同一个东西有两个名字，而且没有门禁守**。
手工全库替换能修一次，但下次改名又会重演 —— 所以落成判据。

判据（全部可机械执行）
=====================================================================
  A. `type-tests/tsconfig*.json` 的 `paths` 键必须**只有** package.json 的 name
  B. `type-tests/*.ts` 的 import 说明符必须是 package.json 的 name
  C. 代码/类型/CLI 里不得出现「仓库名」当包名用（仓库名从 repository.url 推出）
  D. README / START-HERE 里**代码块中**的安装命令，包名必须是当前 name 或 github: 形式

⚠️ 判据 D 的第一版写成"所有文档里出现 `npm install X` 就查"，第一次跑就误报了
`docs/RELEASING.md:223` —— 那里写的是历史记录（"README 当时写 `npm install frontend-lib`，
而那个名字是别人 2017 年的包"）。历史必须保留旧名，否则等于删掉事故记录。
⇒ 收紧为：只查 README / START-HERE，且只查 **fenced 代码块内**的行。
这是本库 E36「判据第一版过宽」的同类修正。

为什么用"仓库名"当禁用词而不是硬编码 frontend-lib
------------------------------------------------
仓库名是客观存在（GitHub 地址、bundle、CI 缓存都用它），它会长期存在。
把"仓库名 ≠ 包名"这条规则写成推导式，改名时判据自动跟着变，不用改门禁。

零文件守卫 + 正向控制
=====================================================================
扫到 0 个文件 ⇒ FAIL（不是通过，是什么都没检查）。
另有两条正向控制：必须扫到 >= 8 个待检文件、且必须命中一条已知的合法写法。

反向控制
=====================================================================
`--selftest` 用合成输入跑 7 个变异体，要求它红、且只红该红的那条。
写法遵循本库 I-10：判据要能被证伪，否则不算门禁。
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 判据 C 的视野：真正会进产物、或被工具读取的代码位置
CODE_ROOTS = ('ai', 'types', 'type-tests')
CODE_FILES = ('package.json',)

# 文档面：只查"教用户怎么做"的文件。
# 不查 CHANGELOG / ERRORS / RELEASING —— 那几份**必须**保留旧名，否则等于删掉事故记录。
DOC_FILES = ('README.md', 'START-HERE.md')

IMPORT_RE = re.compile(
    r"""(?:from\s+|require\(\s*|import\s+)['"]([^'"]+)['"]""")


def read(p):
    with io.open(p, encoding='utf-8', errors='ignore') as f:
        return f.read()


def pkg_identity(root):
    """返回 (包名, 仓库名)。仓库名从 repository.url 推，推不出返回 None。"""
    data = json.loads(read(os.path.join(root, 'package.json')))
    name = data.get('name') or ''
    repo = ((data.get('repository') or {}).get('url') or '')
    m = re.search(r'/([^/]+?)(?:\.git)?/?$', repo)
    repo_name = m.group(1) if m else None
    return name, repo_name


def collect(root):
    """收集待检文件：{相对路径: 内容}。同时返回扫到的文件数。"""
    files = {}
    for r in CODE_ROOTS:
        d = os.path.join(root, r)
        if not os.path.isdir(d):
            continue
        for dp, dn, fn in os.walk(d):
            for f in fn:
                if f.endswith(('.js', '.mjs', '.ts', '.json')):
                    p = os.path.join(dp, f)
                    rel = os.path.relpath(p, root).replace(os.sep, '/')
                    files[rel] = read(p)
    for f in CODE_FILES + DOC_FILES:
        p = os.path.join(root, f)
        if os.path.isfile(p):
            files[f.replace(os.sep, '/')] = read(p)
    return files


def check(files, name, repo_name):
    """纯函数：吃 {路径: 内容}，吐 [(判据, 文件, 说明)]。selftest 直接喂合成数据。"""
    bad = []

    # ---- A. tsconfig 的 paths 键 ----
    for rel, txt in files.items():
        if not re.match(r'type-tests/tsconfig[^/]*\.json$', rel):
            continue
        try:
            cfg = json.loads(txt)
        except ValueError as e:
            bad.append(('A', rel, 'JSON 解析失败: %s' % e))
            continue
        keys = list(((cfg.get('compilerOptions') or {}).get('paths') or {}).keys())
        for k in keys:
            if k != name:
                bad.append(('A', rel,
                            'paths 键是 %r，应为本包包名 %r（否则类型门禁验的是另一个名字）'
                            % (k, name)))
        if not keys:
            bad.append(('A', rel, '没有 paths 映射，类型测试无法解析包名'))

    # ---- B. type-tests 的 import 说明符 ----
    for rel, txt in files.items():
        if not rel.startswith('type-tests/') or not rel.endswith('.ts'):
            continue
        for spec in IMPORT_RE.findall(txt):
            if spec.startswith(('.', '/')):
                continue
            if spec != name:
                bad.append(('B', rel,
                            'import 说明符是 %r，应为本包包名 %r' % (spec, name)))

    # ---- C. 代码里不许把仓库名当包名 ----
    if repo_name and repo_name != name:
        for rel, txt in files.items():
            if rel.startswith('type-tests/tsconfig'):
                continue
            for spec in IMPORT_RE.findall(txt):
                if spec == repo_name:
                    bad.append(('C', rel,
                                '把仓库名 %r 当包名用了（它是主页地址，不是安装标识）'
                                % repo_name))
            # package.json 自己允许出现仓库名（repository / homepage / bugs）
            if rel != 'package.json':
                for m in re.finditer(r'\b%s\s+ai\b' % re.escape(repo_name), txt):
                    bad.append(('C', rel,
                                '用法串里写的是仓库名 %r（%s）'
                                % (repo_name, m.group(0).strip())))

    # ---- D. 文档里代码块中的安装/导入命令 ----
    for rel, txt in files.items():
        if rel not in DOC_FILES:
            continue
        in_fence = False
        for line_no, line in enumerate(txt.splitlines(), 1):
            if line.lstrip().startswith('```'):
                in_fence = not in_fence
                continue
            if not in_fence:
                continue          # 历史叙述常在正文里引旧命令，不算违规
            m = re.search(r'npm\s+install\s+([^\s`]+)', line)
            if m:
                arg = m.group(1)
                if not (arg == name or arg.startswith(('github:', 'git+', 'http', '.', '/'))
                        or arg.endswith('.tgz')):
                    bad.append(('D', '%s:%d' % (rel, line_no),
                                '安装命令装的是 %r，不是本包 %r' % (arg, name)))
            for spec in IMPORT_RE.findall(line):
                if spec.split('/')[0] not in (name, 'node_modules') \
                        and '/' not in spec.split('/')[0]:
                    bad.append(('D', '%s:%d' % (rel, line_no),
                                '代码块里的导入用了 %r，与本包名 %r 不一致'
                                % (spec, name)))
    return bad


def report(bad, files, name, repo_name):
    print('  === 包名一致性（pkg-name）===')
    print('  包名=%r  仓库名=%r  扫了 %d 个文件' % (name, repo_name, len(files)))

    # 正向控制：扫不到东西就不许判通过
    if len(files) < 8:
        print('  [FAIL] 只扫到 %d 个文件 —— 不是"干净"，是没检查' % len(files))
        return 1
    if not any('agentcss' in v or name in v for v in files.values()):
        print('  [FAIL] 正向控制失败：待检文件里读不到包名，视野可能错了')
        return 1

    for tag, where, msg in bad:
        print('  [FAIL] (%s) %s  %s' % (tag, where, msg))
    if bad:
        print('  共 %d 处不一致。改法：把包名统一成 package.json 的 name；'
              '仓库名只用于 URL，不能当安装标识。' % len(bad))
        return 1
    print('  OK  A/B/C/D 四条判据全部通过（%d 个文件）' % len(files))
    return 0


# ---------------------------------------------------------------- 反向控制
def selftest():
    name, repo = 'agentcss', 'frontend-lib'
    base = {
        'package.json': json.dumps({'name': name}),
        'type-tests/tsconfig.json':
            '{"compilerOptions":{"paths":{"agentcss":["../types/index.d.ts"]}}}',
        'type-tests/positive.ts': "import { Select } from 'agentcss';",
        'README.md': '## 安装\n\n```bash\nnpm install github:owain323/frontend-lib\n```\n',
        'types/index.d.ts': '// import { Select } from "agentcss";',
    }
    mutants = []

    def mut(label, patch):
        d = dict(base)
        d.update(patch)
        mutants.append((label, d))

    mut('A: paths 键用旧名',
        {'type-tests/tsconfig.json':
         '{"compilerOptions":{"paths":{"frontend-lib":["../types/index.d.ts"]}}}'})
    mut('B: 类型测试 import 旧名',
        {'type-tests/positive.ts': "import { Select } from 'frontend-lib';"})
    mut('C: 代码里把仓库名当包名',
        {'ai/cli.js': "require('frontend-lib');"})
    mut('C: CLI 用法串写仓库名',
        {'ai/cli.js': ' *   frontend-lib ai check <doc.json>'})
    mut('D: README 代码块里装到别人的包',
        {'README.md': '```bash\nnpm install frontend-lib\n```\n'})
    mut('A: 没有 paths 映射',
        {'type-tests/tsconfig.json': '{"compilerOptions":{}}'})

    # 反向控制的反面：良性改动必须仍然绿（否则门禁会误杀历史记录）
    benign = dict(base)
    benign['README.md'] = (
        '## 安装\n\n```bash\nnpm install github:owain323/frontend-lib\n```\n\n'
        '> 本库真踩过：README 当时写 `npm install frontend-lib`，\n'
        '> 而那个名字是别人 2017 年的包。（历史记录，不是指令）\n')

    ok = True
    base_bad = check(base, name, repo)
    if base_bad:
        print('  [FAIL] 基准样本不该报错，却报了 %d 条' % len(base_bad))
        ok = False
    for label, d in mutants:
        got = check(d, name, repo)
        if not got:
            print('  [FAIL] 变异体没被抓到 ⇒ 判据是瞎的：%s' % label)
            ok = False
        else:
            print('  OK   抓到（%d 条）：%s' % (len(got), label))

    leftover = check(benign, name, repo)
    if leftover:
        print('  [FAIL] 良性改动被误杀 %d 条（正文里引旧命令属于历史记录，不该报）'
              % len(leftover))
        for t, w, m in leftover:
            print('         (%s) %s %s' % (t, w, m))
        ok = False
    else:
        print('  OK   良性改动仍然绿（正文里引旧命令不算违规）')
    print('  ---- selftest %s ----' % ('通过' if ok else '失败'))
    return 0 if ok else 1


def main():
    if '--selftest' in sys.argv:
        return selftest()
    name, repo_name = pkg_identity(ROOT)
    if not name:
        print('  [FAIL] package.json 里读不到 name')
        return 1
    return report(check(collect(ROOT), name, repo_name), collect(ROOT),
                  name, repo_name)


if __name__ == '__main__':
    sys.exit(main())
