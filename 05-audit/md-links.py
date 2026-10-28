#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
md-links.py — 文档里出现的**仓库路径必须存在**

============================================================================
🔴 为什么需要这道门禁（2026-10-29 发现）
---------------------------------------------------------------------------
  `README.zh-CN.md` 里指着四份**根本不存在的文档**：
      `docs/RELEASING.md`、`docs/GUIDANCE.md`、`docs/BENCHMARK.md`、
      `[docs/ROADMAP.md](docs/ROADMAP.md)`
  而 `docs/` 里实际只有 INVARIANT / AI-CONTRACT / LAYER-BASELINE 三份。

  为什么一直没人发现：文档里的路径有**两种写法**——
    ① markdown 链接 `[x](docs/y.md)` —— 生成站/渲染器会把它变成 href
    ② 行内代码 `` `docs/y.md` `` —— 读起来像能点，其实谁也没验过
  而全部既有判据都在看别的东西：pack-closure 判的是**包内 HTML** 的引用，
  docs-site 判的是**生成后的页面**链接。**md 里的路径一直没人管。**

  ⇒ 一个坏路径的代价不是"少一份文件"，是读者点开 404 之后**不再相信这一页**。

============================================================================
判据
============================================================================
  ① markdown 相对链接：必须落地（http(s) / mailto / # / data: 不算路径）
  ② 行内代码里的仓库路径：命中已知顶层目录、带扩展名、且不含占位符的，
     必须落地
  ③ 反向控制（--selftest）：造一份带坏链接的临时 md，判它**必须**报错；
     再造一份全对的，判它**必须**不报。没有反向控制的 0 报错不算证据。

  豁免：`internal/`（本地工作目录，不在版本控制里）、`node_modules/`（使用者装完才有）、
        含 `<` `>` `${` 的占位路径（那是文档在教人填，不是路径）。
===========================================================================
"""
import io
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SKIP_URL = ('http://', 'https://', 'mailto:', '#', 'data:', 'tel:', '//')
LINK_RE = re.compile(r'\[[^\]]*\]\(([^)\s]+)\)')

# 行内代码里"看起来是仓库路径"的形态
PATH_CODE_RE = re.compile(r'`([^`\n]+)`')
TOP_DIRS = ('docs', 'ai', 'types', 'examples', 'benchmark', 'adapters',
            '01-tokens', '02-primitives', '03-patterns', '04-recipes',
            '05-audit', '09-assets', '10-review')
EXT_RE = re.compile(r'\.(md|json|css|js|mjs|py|d\.ts|ts|sh|html|txt|yml|yaml)$')

# 允许"写出来但不必存在"的前缀：本地目录 / 装完才有 / 占位
ALLOW_PREFIX = ('internal/', 'node_modules/', 'dist/', 'prefixed/')


def _norm(p):
    return p.replace(os.sep, '/').replace('\\', '/')


def resolve(base_file, target):
    """相对 md 所在目录解析；返回仓库内相对路径。"""
    base = os.path.dirname(base_file)
    full = os.path.normpath(os.path.join(base, target))
    return _norm(full)


def _exists(rel):
    return os.path.exists(os.path.join(ROOT, rel))


def check_text(rel_file, text):
    """一份 md 的判定。返回 [(行号, 形式, 目标, 理由)]。"""
    errs = []
    for i, line in enumerate(text.split('\n'), 1):
        for m in LINK_RE.finditer(line):
            u = m.group(1).strip()
            if u.startswith(SKIP_URL):
                continue
            path = u.split('#')[0].split('?')[0]
            if not path:
                continue
            full = resolve(rel_file, path)
            if full.startswith('..'):
                errs.append((i, '链接', u, '跑到仓库外'))
            elif not _exists(full):
                errs.append((i, '链接', u, '指向不存在的 %s' % full))
        for m in PATH_CODE_RE.finditer(line):
            code = m.group(1).strip()
            if '/' not in code or '<' in code or '>' in code or '${' in code:
                continue
            # 通配符不是路径：`ai/*.json` 指的是"那一批文件"，
            # 判它不存在是判据自己不懂通配（实测第一条候选实现就误报了 3 处）。
            if '*' in code or '?' in code:
                continue
            if code.startswith(('http', '#', '--')):
                continue
            if code.startswith(ALLOW_PREFIX) or '/' + 'internal/' in code:
                continue
            head = code.split('/')[0]
            if head not in TOP_DIRS:
                continue
            if not EXT_RE.search(code):
                continue          # `01-tokens/` 这种目录名不算路径引用
            if code.endswith('/'):
                continue
            full = _norm(code)
            if not _exists(full):
                errs.append((i, '行内代码', code, '指向不存在的 %s' % full))
    return errs


def tracked_md():
    out = subprocess.run(['git', 'ls-files', '*.md'], cwd=ROOT,
                         capture_output=True, text=True)
    return [f for f in out.stdout.split('\n') if f]


# 🔴 CHANGELOG 整体豁免：它是**历史**。
#    旧版本条目里写着 `docs/GUIDANCE.md` —— 那份文件在 0.11.4 之前确实存在，
#    后来被移进内部目录。把它当"坏路径"修掉，等于改写历史，
#    读者看到的版本记录就对不上当时的事实了。
#    ⚠️ 豁免的代价要知道：CHANGELOG 里若新写了坏路径，本判据抓不到。
#       那道口子由 review 兜 —— 一行新条目写了不存在的文件，人眼能看出来。
HISTORY_FILES = ('CHANGELOG.md',)


def selftest():
    """反向控制：证明这道门禁**真的会红**。"""
    ok = 0
    bad = 0

    def case(label, text, want_errs):
        nonlocal ok, bad
        # 用临时目录里的真文件结构来判
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, 'docs'), exist_ok=True)
        io.open(os.path.join(d, 'docs', 'real.md'), 'w', encoding='utf-8').write('x')
        f = os.path.join(d, 'T.md')
        io.open(f, 'w', encoding='utf-8').write(text)
        global ROOT
        old = ROOT
        ROOT = d
        try:
            got = check_text('T.md', text)
        finally:
            ROOT = old
        hit = len(got) == want_errs
        ok += 1 if hit else 0
        bad += 0 if hit else 1
        print('  %s %-34s 期望 %d 处，实际 %d 处%s'
              % ('OK ' if hit else 'RED', label, want_errs, len(got),
                 '' if hit else '  ← %r' % (got[:1],)))

    case('好链接：不报', '[a](docs/real.md) `docs/real.md`', 0)
    case('坏链接：要报', '[a](docs/ghost.md)', 1)
    case('坏行内代码：要报', '见 `docs/ghost.md`', 1)
    case('外链与锚点：不算路径', '[a](https://x) [b](#top) [c](mailto:a@b)', 0)
    case('占位符：不算路径', '填 `docs/<你的>.md` 与 `node_modules/x/y.css`', 0)
    case('目录名不算路径', '看 `01-tokens/` 这一层', 0)

    if bad:
        print('  ⇒ 🔴 判据自身有 %d 条不成立' % bad)
        return 1
    print('  ⇒ ✅ 反向控制 6/6 成立（好链接不误报、坏路径必须报）')
    return 0


def main():
    if '--selftest' in sys.argv:
        return selftest()

    print('  === 文档路径落地检查 ===')
    print('')
    files = tracked_md()
    total = 0
    for rel in files:
        if rel in HISTORY_FILES:
            continue
        try:
            t = io.open(os.path.join(ROOT, rel), encoding='utf-8',
                        errors='replace').read()
        except Exception:
            continue
        errs = check_text(rel, t)
        if errs:
            total += len(errs)
            for line, form, target, why in errs:
                print('  🔴 %s:%d  %s %s —— %s' % (rel, line, form, target, why))
    print('')
    if total:
        print('  扫了 %d 份受版本控制的 .md（豁免历史文件 %d 份）⇒ 🔴 %d 处路径不存在'
          % (len(files) - len(HISTORY_FILES), len(HISTORY_FILES), total))
        print('')
        print('  ⇒ 读者点开是 404。补文件，或把引用改成真实存在的那一份。')
        return 1
    print('  扫了 %d 份受版本控制的 .md（豁免历史文件 %d 份）⇒ ✅ 全部路径落地'
          % (len(files) - len(HISTORY_FILES), len(HISTORY_FILES)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
