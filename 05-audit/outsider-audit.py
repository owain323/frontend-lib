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

# 🔴 判据**单一来源**：本文件曾自带一套比词表更宽的判据，
#    结果同一份内容在 leak-scan 是干净的、在这里是 6 处泄漏
#    （裸「批次」「默认尺寸」「Tier A」+ 仓库地址里的域名 + 报错样本里的占位用户名）。
#    两道门禁口径不一致 ⇒ 修一处漏一处。现在统一走 terms。
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import terms  # noqa: E402

# 🔴 账号名与仓库名**从 package.json 读**，不写死。
#   为什么：门禁脚本是要公开的，把内部账号名硬编码进去，
#   等于为了"检测泄漏"而**自己制造了一处泄漏**（见 ERRORS E26）。
#   读的是同一份身份来源（repository/homepage/bugs 里的自指地址），
#   所以门禁自身不再携带任何真实身份字面量。
def _identity():
    import json as _json
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, 'package.json'), encoding='utf-8') as f:
        data = _json.load(f)
    urls = []
    for k in ('repository', 'homepage', 'bugs'):
        v = data.get(k)
        if isinstance(v, str):
            urls.append(v)
        elif isinstance(v, dict):
            urls += [x for x in v.values() if isinstance(x, str)]
    for u in urls:
        m = re.search(r'github\.com[/:]([^/]+)/([^/#?]+?)(?:\.git)?(?:$|[/#?])', u)
        if m:
            return m.group(1), m.group(2)
    raise SystemExit('⛔ 从 package.json 读不出仓库身份，无法继续')


OWNER, REPO = _identity()

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
    #
    # 🔴🔴 2026-10-10：这两条判据整体加上「排除自证样本」。
    #    起因：`engine-gate.js` 里的 `C:\\Users\\someone\\AppData\\...` 与
    #    `/home/alice/.cache/ms-playwright` 是**故意写的假路径** ——
    #    它们是「引擎探测失败时要解析的报错样本」，本机用户名根本不在里面。
    #    同理 `gate-selfcheck-fixtures.py` 里的 `C:/Users/probe-user/x`
    #    是**判别力夹具**（用来证明"这道门禁抓得到用户名路径"）。
    #    把这四类当成泄漏，等于要求"门禁不许有测试样本" ⇒ 自相矛盾。
    #    ⇒ 判据保留，但对**这些占位形态**放行：
    #       someone / alice / probe-user / <占位符> 之类明确非真名的词。
    #    ⚠️ 这不是给文件开豁免（那是另一回事）：同一个文件里若写了**真**用户名，
    #       仍然照抓 —— 白名单只针对词形，不针对文件。
    ('用户目录', re.compile(r'[A-Za-z]:/Users/(?!someone|probe-user|<)' +
                            r'|[A-Za-z]:' + re.escape(chr(92) * 2) +
                            r'Users' + re.escape(chr(92) * 2) + r'(?!someone)')),
    # 🔴 判据：**其他盘符**下的具体目录（D:/xxx/ 之类）。
    #   原来写的是 `E:[/\\]frontend-lib|/e/frontend` —— 把本仓库自己的
    #   开发路径硬编码进判据里，等于门禁自身携带一处路径痕迹
    #   （见 ERRORS E26）。现在只保留"这是别人的机器上的目录"这个**形状**。
    ('仓库绝对路径', re.compile(r'(?<![A-Za-z0-9_])[A-Z]:[/\\][A-Za-z0-9_.-]+[/\\]', re.I)),
    ('内部代号', re.compile(r'ESP32|SpendLatch|CostPilot|CHRONOS', re.I)),
    ('内部场景', re.compile(r'录视频|做网站|做小程序')),
    # ⚠️ 自带域名判据收窄（2026-10-10）：
    #    原来是裸 `owain\d*` ⇒ 把 `package.json` 里 repository/homepage/bugs
    #    的 **GitHub 仓库地址**判成泄漏 3 处。那不是泄漏，那是仓库身份：
    #    npm 页面靠它定位源码，删了 npm 就点不开。
    #    同一处判定 leak-scan.py 里早就写明了（"域名本身就是仓库身份的一部分"），
    #    两道门禁在此**口径不一致** —— 本轮统一。
    #  ⇒ 判据与 leak-scan 共用同一份（terms.self_identity_pat()），
    #    身份片段也从 package.json 读，脚本里**不留真实账号名字面量**
    #    （见 ERRORS E26）。
    ('自有域名', terms.self_identity_pat()),
    # ⚠️ 判据收窄：「我们」在技术说明里是**正常表述**
    #    （例："让我们有几个断点有唯一答案"）⇒ 整词匹配会全库假红。
    #    ⇒ 只查**对话口吻**（对读者说话）与**自夸式团队叙述**。
    ('对话口吻', re.compile(r'按你的|你要做|你也可以|咱们|我方|我司')),
    # ⚠️ 自带流程判据与词表口径不一致（2026-10-10 统一）：
    #    这里裸写「批次」「默认尺寸」「Tier A」⇒
    #      · 「批次」把业务语义（样品批次 / 电解液批次 / 批次收率）打成泄漏
    #      · 「默认尺寸」把 `button.css` 里那句**正常技术说明**打成泄漏
    #      · 「Tier A」是 `05-audit/` 门禁自己的档位术语，且 05-audit 已在下文豁免
    #    ⇒ 统一走 `terms.process_pat()`（与 leak-scan 同一份判据，只写一份）。
    ('内部流程', terms.process_pat()),
    # ⚠️ `/tmp` 与 `$HOME` 是**通用路径与变量**，不含身份信息
    #    （每个 Linux 用户都有 /tmp，每台机器都有 $HOME）。
    #    ⇒ 只有**具体用户名**与**具体盘符目录**才算泄漏。
    #    ⚠️ 同上：`/home/alice/` 是引擎报错样本里的占位名，不是真用户名。
    ('本地路径痕迹', re.compile(
        r'[A-Za-z]:/Users/(?!someone|probe-user|<)|'   # C:/Users/<某人>
        r'/home/(?!alice/|user/)[A-Za-z0-9_.-]+/|'     # /home/<某人>/
        r'/Users/(?!someone/|probe-user/)[A-Za-z0-9_.-]+/|'  # macOS
        r'[Dd]:/[A-Za-z0-9_.-]+/',                     # 其他盘符下的具体目录
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
            found = pat.findall(t)
            if name == '自有域名':
                # 仓库自指地址（repository / homepage / bugs 取值）里的
                # 账号名不算泄漏 —— 按**出现位置**判，不是按文件豁免
                found = terms.hits_outside_repo_field(t, pat)
            n = len(found)
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
