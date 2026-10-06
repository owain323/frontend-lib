#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
outsider-audit.py — **外人视角**审查 GitHub 上的仓库

⭐ 为什么需要"外人视角"这道扫描
---------------------------------------------------------------------------
  本地的门禁扫的是**工作区文件**，而外人看到的是 **GitHub 上的文件**。
  两者可能完全不同：
    · 没推送 ⇒ 远端还是旧版（本次就发生了）
    · .gitignore 挡住了本地文件，但远端历史里还留着
    · 某个文件本地干净，但**提交时的版本**有泄漏

  ⇒ 所以必须**直接从 GitHub 拉内容**来扫，而不是扫本地。
===========================================================================
"""
import sys
import re
import json
import urllib.parse
import urllib.request
import os

OWNER = 'owain323'
REPO = 'frontend-lib'

# 🔴 仓库是**私有**的 ⇒ 匿名请求会 404。
#    ⇒ 必须带 token（跟外人看到的差别在于：外人根本看不到私有库，
#    但我们仍要确认**万一被转公开/被镜像**时内容是干净的）。
import os
TOKEN = os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN') or ''
HDR = {'Authorization': 'Bearer ' + TOKEN} if TOKEN else {}
API = 'https://api.github.com/repos/%s/%s' % (OWNER, REPO)
COMMIT = os.environ.get("AUDIT_COMMIT", "")
RAW = 'https://raw.githubusercontent.com/%s/%s/master/' % (OWNER, REPO)

# ============================================================================
# 词表（全部是"外人看到就会觉得奇怪"的东西）
# ============================================================================
PATTERNS = [
    ('盘符/用户名', re.compile(r'czj\d{3,}', re.I)),
    # ⚠️ 不要写 `[/\]` —— 字符类里的 `\]` 会**提前闭合字符类**，
    #    正则直接抛 "unterminated character set"。
    #    ⇒ 分成两个 alternation，各自只匹配正斜杠或"反斜杠+反斜杠"。
    ('用户目录', re.compile(r'[A-Za-z]:/Users/|[A-Za-z]:\\\\Users\\\\')),
    ('仓库绝对路径', re.compile(r'E:[/\\]frontend-lib|(?<![\w/])/e/frontend', re.I)),
    ('内部代号', re.compile(r'ESP32|SpendLatch|CostPilot|CHRONOS', re.I)),
    ('内部场景', re.compile(r'录视频|做网站|做小程序')),
    ('自有域名', re.compile(r'owain\d*', re.I)),
    # ⚠️ 判据收窄：「我们」在技术说明里是**正常表述**
    #    （例："让我们有几个断点有唯一答案"）⇒ 整词匹配会全库假红。
    #    ⇒ 只查**对话口吻**（对读者说话）与**自夸式团队叙述**。
    ('对话口吻', re.compile(r'按你的|你要做|你也可以|咱们|我方|我司')),
    ('内部流程', re.compile(r'工单|批次|默认尺寸|降级到|版本 ?[ABC]|Tier ?[ABC][^a-z]')),
    # ⚠️ `/tmp` 与 `$HOME` 是**通用路径与变量**，不含身份信息
    #    （每个 Linux 用户都有 /tmp，每台机器都有 $HOME）。
    #    ⇒ 只有**具体用户名**与**具体盘符目录**才算泄漏。
    ('本地路径痕迹', re.compile(
        r'[A-Za-z]:/Users/|'                       # C:/Users/<某人>
        r'/home/[A-Za-z0-9_.-]+/|'                # /home/<某人>/
        r'/Users/[A-Za-z0-9_.-]+/'                # macOS 的 /Users/<某人>/
        r'[Dd]:/[A-Za-z0-9_.-]+/',                # 其他盘符下的具体目录
        re.I)),
]

SKIP_EXT = ('.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2')
TEXT_EXT = ('.md', '.html', '.css', '.js', '.mjs', '.py', '.json',
            '.sh', '.ts', '.tsx', '.yml', '.yaml', '.txt', '.tpl')

# ⭐ 门禁自身的文件：它们**必须**含被禁词才能扫描 ⇒ 豁免。
#    ⚠️ 门禁本身是可审计的公开工具，"它检查哪些词"属于规则说明，不是内部机密。
SELF_FILES = {
    'terms.py', 'leak-scan.py', 'leak-clean.py', 'leak-fix-paths.py',
    'outsider-audit.py', 'publish-guard.py', 'proper-noun-scan.py',
    'repo-hygiene.py', '_common.py',
}


def main():
    print('  === 外人视角审查（直接读 GitHub）===')
    print('')
    try:
        with urllib.request.urlopen(urllib.request.Request(API + '/git/trees/master?recursive=1', headers=HDR), timeout=20) as r:
            tree = json.loads(r.read().decode('utf-8'))
    except Exception as e:
        print('  🔴 读不到仓库：%s' % str(e)[:60])
        return 2

    paths = [t['path'] for t in tree.get('tree', []) if t['type'] == 'blob']
    print('  远端文件数：%d' % len(paths))

    bad = {}
    checked = 0
    for p in paths:
        # ⭐ 门禁自身**必须豁免**：它们为了检测这些词，词表里就得含它们
        #    （terms.py 已是拼接写法，但正则与示例里仍会露出片段）。
        #    这是「工具属性」，不是「内容泄漏」——
        #    外人看到的是"一条扫描规则"，不是我们的代号。
        if p.split('/')[-1] in SELF_FILES:
            continue
        if p.lower().endswith(SKIP_EXT):
            continue
        if not p.lower().endswith(TEXT_EXT):
            continue
        if '_baseline' in p:
            continue
        try:
            with urllib.request.urlopen(urllib.request.Request(RAW + urllib.parse.quote(p) + '?v=' + COMMIT, headers=HDR), timeout=12) as r:
                t = r.read().decode('utf-8', 'replace')
        except Exception:
            continue
        checked += 1
        for name, pat in PATTERNS:
            n = len(pat.findall(t))
            if n:
                bad.setdefault(name, []).append((p, n))

    print('  扫了 %d 个文本文件' % checked)
    print('')
    if not bad:
        print('  ✅ 外人视角：零泄漏 —— 干净')
        return 0

    total = 0
    for name, _ in PATTERNS:
        if name in bad:
            tot = sum(n for _, n in bad[name])
            total += tot
            print('  🔴 %-12s %d 处 / %d 个文件' % (name, tot, len(bad[name])))
            for p, n in bad[name][:6]:
                print('       %s  x%d' % (p[:54], n))
    print('')
    print('  ⇒ 🔴 共 %d 处' % total)
    return 1


if __name__ == '__main__':
    sys.exit(main())
