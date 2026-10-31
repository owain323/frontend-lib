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
import io
import re
import json
import zipfile
import urllib.error
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
CONTENTS = 'https://api.github.com/repos/%s/%s/contents/' % (OWNER, REPO)

# 🔴 2026-10-29：读取方式改成「一次取整库快照」。
#    事故：本机 `raw.githubusercontent.com` 被强制断连（WinError 10054），
#    而脚本只有它一条通道 ⇒ 每个文件都抛异常 ⇒ `checked` 停在 0，
#    末尾照样打印「✅ 零泄漏」。**一个文件都没读到，却宣布干净。**
#
#    逐文件抓还有两个隐患，就算通道通着也不该这么干：
#      · 配额：匿名 60 次/小时，几百个文件必然 403
#      · 一致性：边抓边有人推 ⇒ 扫的是"拼接出来的半新旧混合体"
#    ⇒ 主路径改成 zipball：**一条请求**拿到同一个 commit 的完整树
#      （实测 1.9s / 12.2MB / 757 个条目，且返回的顶层目录名自带 commit sha）。
#    逐文件通道保留为**降级路径**：zipball 万一被挡，仍能逐个取，
#    只是要显式说明"现在是降级模式"，且覆盖率判据一样生效。
def _channels(p):
    q = urllib.parse.quote(p)
    ref = ('?ref=' + urllib.parse.quote(COMMIT)) if COMMIT else ''
    return [
        ('raw', RAW + q + ref, HDR),
        ('api', CONTENTS + q + ref,
         dict(HDR, Accept='application/vnd.github.raw')),
    ]


def fetch_text(p, tries=2):
    """返回 (内容, None) 或 (None, 失败原因)。失败原因要能看出是哪条通道、什么事。"""
    last = 'no-channel'
    for _ in range(tries):
        for tag, url, hdr in _channels(p):
            try:
                with urllib.request.urlopen(
                        urllib.request.Request(url, headers=hdr), timeout=25) as r:
                    return r.read().decode('utf-8', 'replace'), None
            except urllib.error.HTTPError as e:
                last = '%s:HTTP%s' % (tag, e.code)
            except Exception as e:
                last = '%s:%s' % (tag, type(e).__name__)
    return None, last


def fetch_snapshot():
    """整库快照。返回 (paths, read_fn, note)；失败返回 (None, None, 原因)。

    read_fn(path) -> 文本（只对调用方要的文件读，避免把 12MB 全解码）。
    """
    ref = COMMIT or 'master'
    url = '%s/zipball/%s' % (API, urllib.parse.quote(ref))
    try:
        with urllib.request.urlopen(
                urllib.request.Request(url, headers=HDR), timeout=120) as r:
            blob = r.read()
        z = zipfile.ZipFile(io.BytesIO(blob))
        names = [n for n in z.namelist() if not n.endswith('/')]
        if not names:
            return None, None, 'zipball 是空的'
        # 顶层目录形如 `<owner>-<repo>-<sha7>/` ⇒ 顺手把远端 commit 记下来，
        # 报告里能写清"验的是哪一版"，而不是"某个时刻的 master"。
        prefix = names[0].split('/')[0] + '/'
        sha = prefix.rstrip('/').rsplit('-', 1)[-1]
        rel = {n[len(prefix):]: n for n in names}
        cache = {}

        def read_fn(p):
            if p not in rel:
                raise KeyError(p)
            if p not in cache:
                cache[p] = z.read(rel[p]).decode('utf-8', 'replace')
            return cache[p]

        return rel, read_fn, 'zipball %s（%.1f MB / %d 个文件）' % (
            sha, len(blob) / 1048576.0, len(rel))
    except Exception as e:
        return None, None, 'zipball 失败：%s' % str(e)[:70]

# ============================================================================
# 词表（全部是"外人看到就会觉得奇怪"的东西）
# ============================================================================
PATTERNS = [
    # 🔴 用户名的「形状」也要从私有词表读（`re:user=`）——
    #    写死在这里等于门禁自己携带一处身份泄漏（E26）。
    #    读不到就是永不匹配，`private_status()` 会在输出里点名。
    ('盘符/用户名', re.compile(terms.USER_RE, re.I)),
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
    # 🔴 判据：**别人机器上的具体目录**（某个盘符下的目录），排除两种形态：
    #   ① 本仓库自己的开发路径 —— 原写死了具体盘符目录，等于门禁自身携带痕迹（E26）
    #   ② **判别力夹具**里的**占位**路径（`C:/Users/probe-user/`、
    #      `C:\Users\<用户名>\`）—— 这些是门禁**用来证明自己能抓到真路径**的样本，
    #      把它们判成泄漏 = 要求"门禁不许有测试样本"，自相矛盾。
    #   ⚠️ 排除的是**词形**（占位名 / 尖括号），不是文件 ——
    #      同一个文件里写真用户名仍然照抓。
    ('仓库绝对路径', re.compile(
        r'(?<![A-Za-z0-9_])[A-Z]:[/\\](?!Users[/\\](?:probe-user|someone|<))'
        r'[A-Za-z0-9_.-]+[/\\]', re.I)),
    # 🔴 内部代号：真实清单**不在这个文件里**（它曾经在这里，等于把
    #    "我们有哪些项目"直接写进公开仓）。现在统一走 terms：
    #    真实代号在 `internal/private-terms.txt`（.gitignore），读不到就只剩
    #    公开的假代号 + 场景词。判据与 leak-scan 同一份，口径不会再分叉。
    ('内部代号', re.compile('|'.join(re.escape(w) for w in terms.HARD_BAN), re.I)),
    ('内部场景', re.compile(r'录视频|做网站|做小程序')),
    # ⚠️ 自带域名判据收窄（2026-10-10）：
    #    原来是裸写账号名正则 ⇒ 把 `package.json` 里 repository/homepage/bugs
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
    # 过程痕迹：第三方来源 / 评审轨迹 / 账号与凭据细节。
    # 与 leak-scan 共用 `terms.process_trace_pat()`（同一份判据，只写一份）。
    ('过程痕迹', terms.process_trace_pat()),
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
#    ⚠️ 判据不在这里写 —— 调 `terms.is_tool_file`（单一来源）。
#    本文件曾经自带一份"只按文件名豁免"的版本，于是同一个仓库
#    本地 leak-scan 报干净、这里报 43 处，两边谁对说不清（见 terms.py 那段注释）。


def scannable(p):
    """这个远端路径要不要扫。返回 (要不要, 不计入分母的理由)。"""
    if terms.is_tool_file(p):
        return False, 'tool'
    if p.lower().endswith(SKIP_EXT):
        return False, 'binary'
    if not p.lower().endswith(TEXT_EXT):
        return False, 'binary'
    if '_baseline' in p:
        return False, 'baseline'
    return True, ''


def coverage_verdict(eligible, checked):
    """覆盖率判据：**没读到文件 ≠ 干净**。

    🔴 起因（2026-10-29）：旧实现只打印「扫了 0 个文本文件」，
       随后照样输出「✅ 零泄漏」。分母和结论之间没有绑定关系，
       于是"一条通道被墙"就能变成"全部干净"。
       ⇒ 分母 > 0 时必须 100% 读到，少一个都不许下结论。
    """
    if eligible <= 0:
        return 2, '分母为 0：没有可扫的文本文件，判据本身失效'
    if checked == 0:
        return 2, '一个文件都没读到 —— 无法取证，不等于干净'
    if checked < eligible:
        return 2, '只读到 %d/%d 个文件，%d 个未取证' % (
            checked, eligible, eligible - checked)
    return 0, '全部 %d 个文本文件均已读取' % eligible


def selftest():
    cases = [
        ((0, 0), 2, '分母为 0'),
        ((400, 0), 2, '全都没读到'),      # ← 本次事故，旧实现在这里返回 0
        ((400, 1), 2, '差一个也算未取证'),
        ((400, 399), 2, '差一个也算未取证'),
        ((400, 400), 0, '读全了'),
    ]
    bad = 0
    for args, want, why in cases:
        got, msg = coverage_verdict(*args)
        ok = got == want
        bad += 0 if ok else 1
        print('  %s %-14s → %d  %s' % ('OK ' if ok else 'RED', '%d/%d' % args, got, why))
    if bad:
        print('  ⇒ 🔴 判据自身有 %d 条不成立' % bad)
    else:
        print('  ⇒ ✅ 覆盖率判据 5/5 成立（含"0 个文件必须红"）')
    # 再加一条反向控制：全读到但发现泄漏，不能被覆盖率判据洗白
    if coverage_verdict(10, 10)[0] != 0:
        print('  ⇒ 🔴 反向控制失败'); bad += 1
    return 1 if bad else 0


def _paths_from_tree():
    """降级路径用：拿不到 zipball 时先列清单。读不到 ⇒ None（判红，不是跳过）。"""
    try:
        with urllib.request.urlopen(urllib.request.Request(
                API + '/git/trees/' + (COMMIT or 'master') + '?recursive=1',
                headers=HDR), timeout=25) as r:
            tree = json.loads(r.read().decode('utf-8'))
    except Exception as e:
        print('  🔴 读不到仓库清单：%s' % str(e)[:70])
        return None
    return [t['path'] for t in tree.get('tree', []) if t['type'] == 'blob']


def main():
    if '--selftest' in sys.argv:
        return selftest()

    print('  === 外人视角审查（直接读 GitHub）===')
    print('  ' + terms.private_status())
    print('')
    rel, read_fn, note = fetch_snapshot()
    if rel is not None:
        # 主路径：一个 commit 的完整快照 —— 原子、且只烧 1 次配额
        paths = list(rel.keys())
        print('  快照：%s' % note)
        getter = lambda p: read_fn(p)  # noqa: E731
    else:
        # 降级：逐文件抓。**必须显式说明现在是降级模式**，
        # 否则"少扫了一半"会被读成"全都干净"（本次事故就是这种读法）。
        print('  ⚠️ %s' % note)
        print('  ⚠️ 降级为逐文件读取（易受配额/一致性影响）')
        paths = _paths_from_tree()
        if paths is None:
            return 2

        def getter(p, _c={}):
            if p not in _c:
                _c[p] = fetch_text(p)
            t, why = _c[p]
            if t is None:
                raise IOError(why)
            return t

    eligible = []
    tools = set()
    skipped = {}
    for p in paths:
        # 🔴 工具目录也进分母 —— 但只查身份（真代号 / 用户名 / 本机路径）。
        #    事故：代号清单就在 `05-audit/outsider-audit.py` 里，而这里把它
        #    整目录跳过 ⇒ 报告"零泄漏"。缺口藏在扫描器的盲区里最坏。
        if terms.is_tool_file(p):
            tools.add(p)
            eligible.append(p)
            continue
        keep, why = scannable(p)
        if keep:
            eligible.append(p)
        else:
            skipped[why] = skipped.get(why, 0) + 1
    print('  远端文件 %d 个：需扫 %d 个（其中工具目录 %d 个只查身份），不计入分母 %d 个（%s）' % (
        len(paths), len(eligible), len(tools), sum(skipped.values()),
        '，'.join('%s %d' % (k, v) for k, v in sorted(skipped.items()))))
    # ⚠️ 豁免要**打出来**，不能静默：`baseline` / `binary` 意味着这些文件
    #    不在本次覆盖范围内。不打印就等于"少扫了 200 个文件但报告看起来像扫了全部"。

    bad = {}
    fails = {}
    checked = 0
    for p in eligible:
        try:
            t = getter(p)
        except Exception as e:
            fails.setdefault(str(e)[:22] or 'unknown', []).append(p)
            continue
        checked += 1
        if p in tools:
            for name, found in terms.identity_hits(t).items():
                bad.setdefault(name, []).append((p, len(found)))
            continue
        for name, pat in PATTERNS:
            found = pat.findall(t)
            if name == '自有域名':
                # 仓库自指地址（repository / homepage / bugs 取值）里的
                # 账号名不算泄漏 —— 按**出现位置**判，不是按文件豁免
                found = terms.hits_outside_repo_field(t, pat)
            n = len(found)
            if n:
                bad.setdefault(name, []).append((p, n))

    code, cov_msg = coverage_verdict(len(eligible), checked)
    print('  已读 %d / %d 个文本文件' % (checked, len(eligible)))
    print('')
    if fails:
        print('  ⚠️ 未取证 %d 个文件（读不到，不当作干净）：' % sum(len(v) for v in fails.values()))
        for why, ps in sorted(fails.items(), key=lambda kv: -len(kv[1])):
            print('     %-22s x%d  例：%s' % (why, len(ps), ps[0][:44]))

    if not bad and code == 0:
        print('  ✅ 外人视角：零泄漏 —— 干净（%s）' % cov_msg)
        return 0
    if bad:
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
    if code != 0:
        print('  ⇒ 🔴 %s' % cov_msg)
    return 1 if bad else 2


if __name__ == '__main__':
    sys.exit(main())
