#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
pack-hygiene-gate.py — 站在**装了包的人**那一边看：文档链接 + 文件卫生

============================================================================
🔴 为什么这道门禁存在（2026-11-04 再探发现）
----------------------------------------------------------------------------
`md-links.py` 判「文档里的仓库路径必须存在」，它看的是**仓库这一棵树**。
而 npm 包只装 `package.json` 的 `files` 白名单里的文件 —— 同一份 README，
在仓库里链接全绿，装进包里可能全是死链。实测 0.25.5 真包：

    README.md / README.zh-CN.md / SUPPORT.md / docs/LAYER-BASELINE.md
    共 8 个链接指向 05-audit/budget.json、10-review/webview/RESULTS.md、
    10-review/webview/capability-probe.html —— 三个文件都不在 `files` 里。

`md-links` 全绿、`pack-closure` 只判包内 HTML 引用、`doc-imports` 只抽
`agentcss/...` 字面路径 ⇒ **没有一道门禁站在"装包的人"那一侧**（I-10 实证 6/7
的同型：判据在测另一棵树）。

⇒ 修法不是把内部资产塞进包（门禁配置 / 真机记录不该随包分发），
   而是把这类链接指向公开仓库；这道门禁负责让第 9 个死链静默不进来。

判据
----------------------------------------------------------------------------
  ① 文件清单只认 `npm pack --dry-run --json` 的**真实输出**（不自己解析 files 白名单
     ⇒ 不产生第二份"包里有什么"的真值，I-7）
  ② 包内 .md 数为 0 / 一个链接都没扫到 ⇒ 红（零视野守卫）
  ③ 每个 markdown 相对链接的目标必须在包内清单里
  ④ http(s) / mailto / # / data / tel 与含占位符的示例路径 ⇒ 跳过
  ⑤ 包内不得出现反向控制 / 备份 / 临时文件（`.bak` / `.tmp` / `.pyc` …）

🔴 ⑤ 的由来（同一次再探）：第一次 `npm pack --dry-run` 抓到包里有
   `02-primitives/combobox/combobox.js.__reverse.bak` —— 某个反向控制当时
   正在改源码并留了备份，而 `files` 白名单按**目录**收，临时文件跟着进了包。
   现在 `package.json` 的 `files` 加了 `!**/*.bak` 一类排除；这道判据是
   「排除规则还在不在」的验证，不是重复实现一份排除逻辑（A/B 实测：
   加规则前探针进包、加规则后不进包）。

⚠️ 两件事共用**同一份** dry-run 清单：不为第二个判据再解析一次白名单（I-7）。

反向控制：`--selftest` 喂合成 (files, docs)，含「旧视野」元反向 ——
   把清单换成"整个仓库"时，同一条死链必须不再红，证明这红来自视野而不是别的。
"""

import io
import json
import os
import posixpath
import re
import subprocess
import sys
from urllib.parse import unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINK_RE = re.compile(r'\[[^\]]*\]\(([^)\s]+)\)')
SKIP_URL = ('http://', 'https://', 'mailto:', '#', 'data:', 'tel:', '//')
PLACEHOLDER = ('<', '>', '${', '*', '{')


def links_in(text):
    """返回 [(url, 行号)]。与 md-links.py 同一口径（只认 markdown 链接）。"""
    out = []
    for i, line in enumerate(text.split('\n'), 1):
        for raw in LINK_RE.findall(line):
            out.append((raw, i))
    return out


def linkErrs(files, docs):
    """纯函数：files = 包内路径集合，docs = {md路径: 文本}。"""
    if not docs:
        return ['零视野：包里一份 .md 都没有 ⇒ 没检查']
    errs = []
    total = 0
    for md in sorted(docs):
        for raw, line in links_in(docs[md]):
            u = raw.split('#')[0].split('?')[0]
            if not u or u.startswith(SKIP_URL):
                continue
            if any(p in u for p in PLACEHOLDER):
                continue                       # 文档在教人填，不是路径
            total += 1
            target = posixpath.normpath(
                posixpath.join(posixpath.dirname(md), unquote(u)))
            if u.endswith('/'):
                # 目录链接（如 `../skeleton/`）：包内文件清单是**文件**，没有目录项。
                # 实测第一版把它当文件查，误报了 progress/README.md 的两条 ——
                # 而 skeleton 目录在包里其实有 3 个文件。⇒ 按前缀判目录是否存在。
                prefix = target.rstrip('/') + '/'
                exists = any(f.startswith(prefix) for f in files)
            else:
                exists = target in files
            if not exists:
                errs.append('%s:%d → %s（包里没有 %s）'
                            % (md, line, raw, target))
    if total == 0:
        errs.append('零视野：一份相对链接都没扫到 ⇒ 没检查')
    return errs


# ⑤ 「包里不该出现的东西」。与 package.json 的 `!**/*.xxx` 同一组后缀，
#   但这不是第二份真值：那份是**排除规则**，这份是**规则有没有生效**的判据。
TRANSIENT_SUFFIX = ('.bak', '.tmp', '.orig', '.rej', '.old', '.pyc', '.log', '~')
# `__parity_probe.js` 是 dist-js-parity 反向控制往 dist/ 写的临时探针（E312），
#   由 package.json 的 `!**/__parity_probe.js` 排除；这里验证排除没被撤掉。
TRANSIENT_NAMES = ('.DS_Store', 'Thumbs.db', '__parity_probe.js')


def contentErrs(files, suffixes=TRANSIENT_SUFFIX, names=TRANSIENT_NAMES):
    """纯函数：喂合成清单就能验它有没有牙（见 selftest ⑤）。"""
    errs = []
    for p in sorted(files):
        base = p.rsplit('/', 1)[-1]
        if base in names or (suffixes and base.endswith(suffixes)):
            errs.append('包内出现临时/备份文件：%s' % p)
    return errs


def pack_files():
    """真实干跑的文件清单。失败一律带错，不许静默退回白名单解析。"""
    cmd = 'npm pack --dry-run --json --ignore-scripts'
    try:
        r = subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True,
                           text=True, timeout=180)
    except Exception as exc:                                   # noqa: BLE001
        return None, ['npm pack 执行失败：%s' % exc]
    if r.returncode != 0:
        return None, ['npm pack 返回 %d：%s'
                      % (r.returncode, (r.stderr or '').strip()[:300])]
    try:
        data = json.loads(r.stdout)
        fs = set(f['path'] for f in data[0]['files'])
    except Exception as exc:                                   # noqa: BLE001
        return None, ['npm pack 输出解析失败：%s' % exc]
    if not fs:
        return None, ['零视野：npm pack 报告 0 个文件 ⇒ 没检查']
    return fs, []


def main():
    files, errs = pack_files()
    if errs:
        for e in errs:
            print('  [FAIL] ' + e)
        return 1
    docs = {}
    for p in sorted(files):
        if not p.endswith('.md'):
            continue
        full = os.path.join(ROOT, p.replace('/', os.sep))
        if os.path.isfile(full):
            docs[p] = io.open(full, encoding='utf-8', errors='replace').read()
    print('  真实包：%d 个文件 · 其中 %d 份 .md' % (len(files), len(docs)))
    errs = linkErrs(files, docs) + contentErrs(files)
    if errs:
        for e in errs:
            print('  [FAIL] ' + e)
        print('  [FAIL] %d 处不满足' % len(errs))
        return 1
    print('  [OK] 包内文档的相对链接全部落在包里，且没有临时/备份文件')
    return 0


def selftest():
    bad = 0

    def report(ok, label, extra=''):
        nonlocal bad
        print('  [%s] %s%s' % ('OK  ' if ok else 'FAIL', label,
                               '  ' + extra if extra else ''))
        if not ok:
            bad += 1

    files = {'README.md', 'API.md', 'docs/GUIDE.md', '01-tokens/tokens.css'}
    good = {
        'README.md': '看 [API](API.md) 与 [指南](docs/GUIDE.md)，还有 [外链](https://example.com)。',
        'docs/GUIDE.md': '回 [首页](../README.md)，令牌在 [tokens](../01-tokens/tokens.css)。',
    }
    report(linkErrs(files, good) == [], '全部落在包内 ⇒ 绿')

    withDir = dict(good)
    withDir['README.md'] += '\n未知进度用 [skeleton](02-primitives/skeleton/)。'
    report(any('skeleton' in e for e in linkErrs(files, withDir)),
           '目录链接：包里没这个目录 ⇒ 红')
    report(linkErrs(files | {'02-primitives/skeleton/README.md'}, withDir) == [],
           '目录链接：包内有该目录下的文件 ⇒ 绿（良性对照）')

    dead = dict(good)
    dead['README.md'] += '\n真机结果见 [RESULTS](10-review/webview/RESULTS.md)。'
    e_dead = linkErrs(files, dead)
    report(any('RESULTS' in e for e in e_dead), '指向包外的仓库文件 ⇒ 红并点名',
           '; '.join(e_dead))

    report(any('零视野' in e for e in linkErrs(files, {})), '0 份 .md ⇒ 红')
    report(any('零视野' in e for e in linkErrs(files, {'README.md': '纯文字，没有链接'})),
           '一份链接都没扫到 ⇒ 红')

    # 元反向：把清单换成"整个仓库"（md-links.py 的旧视野），同一条死链不再红
    # —— 证明这条红来自"只看包内文件"，不是正则或别处顺手报的。
    repo_view = files | {'10-review/webview/RESULTS.md'}
    report(linkErrs(repo_view, dead) == [],
           '元反向：换回仓库视野 ⇒ 同一死链不再红（旧门禁就是这样全绿的）')

    mixed = dict(good)
    mixed['README.md'] += ('\n填 [你的路径](<YOUR_PATH>)、'
                           '[外链](https://example.com/x.md#a)、[锚点](#top)。')
    report(linkErrs(files, mixed) == [],
           '占位符 / 绝对 URL / 锚点被跳过 ⇒ 不误报（良性对照）')

    # ---- ⑤ 包内文件卫生 ----
    report(contentErrs(files) == [], '包内无临时/备份文件 ⇒ 绿')
    dirty = files | {'02-primitives/combobox/combobox.js.__reverse.bak'}
    e_dirty = contentErrs(dirty)
    report(any('__reverse.bak' in e for e in e_dirty),
           '包内混入反向控制备份 ⇒ 红并点名', '; '.join(e_dirty))
    report(contentErrs(dirty, suffixes=()) == [],
           '元反向：后缀表清空 ⇒ 同一坏样本不再红')
    probe = files | {'dist/__parity_probe.js'}
    report(any('__parity_probe' in e for e in contentErrs(probe)),
           '包内混入 dist 临时探针 ⇒ 红并点名')
    report(contentErrs(probe, names=()) == [],
           '元反向：名字表清空 ⇒ 同一探针不再红')

    real, errs = pack_files()
    if errs:
        report(False, '真实包清单可读', '; '.join(errs))
    else:
        realDocs = {}
        for p in sorted(real):
            if p.endswith('.md') and os.path.isfile(
                    os.path.join(ROOT, p.replace('/', os.sep))):
                realDocs[p] = io.open(os.path.join(ROOT, p.replace('/', os.sep)),
                                      encoding='utf-8', errors='replace').read()
        report(linkErrs(real, realDocs) == [] and contentErrs(real) == [],
               '真实 npm 包 ⇒ 绿（文档链接 + 文件卫生）')

    print('  ' + ('✅ 反向控制全绿' if not bad else '❌ %d 条没通过' % bad))
    return 1 if bad else 0


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(main())
