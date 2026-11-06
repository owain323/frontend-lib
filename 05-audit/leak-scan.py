#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
leak-scan.py — 敏感信息扫描（扫本地工作区里 git 跟踪的文件）

===========================================================================
词表从 terms.py 读 —— 那里用拼接写法，源码里不含完整词。
理由见 terms.py：门禁自己不能成为泄漏源。
===========================================================================
"""
import sys
import os
import io
import re
import json
import subprocess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import terms  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
from _common import scannable_files  # noqa: E402

# ============================================================================
# 词表
# ============================================================================
# ⚠⚠ 三条踩过的坑，写正则前务必记住：
#   1. 字符类 [/\] 里的 \] 会**提前闭合字符类** ⇒ "unterminated character set"
#   2. BS * 2 拼出来是「两个字面反斜杠」，不是一个 ⇒ 用 re.escape()
#   3. **必须排除合法路径**（下面每条都有说明），否则全是假红
# ============================================================================

# ⭐ 合法前缀白名单（软件安装位置，任何人机器上都一样 ⇒ 不暴露身份）
#   用**字符串匹配**而不是正则负向前瞻 —— 负向前瞻只看紧邻字符，
#   `C:/Program Files/...` 会被 `Program` 部分命中。
_OK_PREFIX = (
    'C:/Program', 'C:/Users', 'C:/Windows',
    'D:/Program', 'E:/Program',
)

# ⭐ package.json 的 repository / homepage / bugs 字段里，
#   仓库域名是**仓库身份**（npm 页面要靠它定位源码），不算协作痕迹。
_REPO_FIELD_KEYS = ('repository', 'homepage', 'bugs', 'url', 'directory')


# ⭐ 仓库身份字段的判定见 terms.outside_repo_field ——
#    单一来源：leak-scan 与 outsider-audit 共用同一份，
#    不再各写一份（口径不一致会让同一份内容一边干净一边脏，见 ERRORS E19）。

PATTERNS = [
    ('用户名', re.compile(terms.USER_RE, re.I)),
    # 盘符路径：匹配后**再判断**是否合法前缀（见 is_ok_path）
    ('盘符路径', re.compile(
        r'(?<![:/A-Za-z0-9])[A-Za-z]:/[A-Za-z0-9_.-]+')),
    ('盘符路径2', re.compile(
        r'(?<![:/A-Za-z0-9])[A-Za-z]:' +
        re.escape(chr(92) * 2) + r'[A-Za-z0-9_.-]+')),
    # 用户目录：只有 C:/Users/<某人> 才泄漏
    ('用户目录', re.compile(r'[A-Za-z]:/Users/|' +
                            '[A-Za-z]:' + re.escape(chr(92) * 2) + 'Users')),
    # posix 盘符（/d/ /e/ 等）：只查**真实盘符**
    # ⚠️ 必须排除文档里的示例路径（../x/y.css）——
    #    它长得像盘符但其实是相对路径，会造成永久假红。
    #    正解：要求盘符**前面不是点**（相对路径必有 ../ 或 ./）。
    ('posix 盘符', re.compile(
        r'(?<![\w:/.])/[a-z]/[A-Za-z0-9_.-]+')),
    # 🔴 判据只保留"这是别人机器上的绝对目录"这个**形状**，
    #   不再把本仓库自己的开发路径硬编码进来 ——
    #   那等于门禁自身携带一处路径痕迹（见 ERRORS E26）。
    ('仓库绝对路径', re.compile(
        r'(?<![A-Za-z0-9_])[A-Z]:[/' + re.escape(chr(92)) + r'][A-Za-z0-9_.-]+[/'
        + re.escape(chr(92)) + r']')),
    ('内部代号', re.compile('|'.join(re.escape(w) for w in terms.HARD_BAN), re.I)),
    # 内部失误台账编号（E123）：指向一份不随包分发的台账 ⇒ 读者拿到的是死索引。
    # 边界与豁免见 terms.internal_id_pat / changelog_future。
    ('内部台账编号', terms.internal_id_pat()),
    ('自有域名', terms.self_identity_pat()),
    ('内部流程', terms.process_pat()),
    # 回环与通配地址不是泄漏（本地测试的正常写法）
    ('私网 IP', re.compile(
        r'\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b')),
]

# ============================================================================
# 🆕 公开前体检
# ----------------------------------------------------------------------------
# 这三条不是「敏感信息」，是**公开可用性缺陷**。
# 起因：对外扫描时发现公开文档里写着「详见 00-charter/04-响应式规则.md」，
#      而那个目录根本不在仓库里（被 .gitignore 挡掉）⇒ 陌生人点进去只有 404。
#      同类问题共60 处。
#
# 判据设计要点：
#   · 内部目录名：只在**非门禁目录**里查—— 门禁脚本提到它们是正常的
#     （比如"这个目录不在仓库里"这类说明本身）。
#   · 工作日期戳：靠 terms.WORK_STAMP_RE 的**月份限定**避开业务日期。
#   · 占位符：${REPO} 这类未替换的模板变量，复制粘贴必然失败。
# ============================================================================
CHECKS_EXTRA = [
    ('内部目录引用', re.compile('|'.join(re.escape(d) for d in terms.INTERNAL_DIRS))),
    ('内部协作痕迹', re.compile('|'.join(re.escape(w) for w in terms.COLLAB_TRACE), re.I)),
    ('过程痕迹', terms.process_trace_pat()),
    ('未替换占位符', re.compile(terms.PLACEHOLDER_RE)),
]

# ============================================================================
# ⭐「内部协作痕迹」的假阳性排除（2026-10-06 实测踩到）
# ----------------------------------------------------------------------------
# 现象：leak-scan 报 css-imports.py 有 8 处 Owner，grep 却是 0。
# 根因：文件里是 CLASS_OWNER / owners —— **代码变量名**，
#       意思是「这个 CSS 类归哪个文件管」，与内部称谓毫无关系，
#       但 re.I 让它命中了。
#
# 正解：内部称谓一定是**首字母大写**的 Owner（行文里当名词用）。
#      所以判据从「忽略大小写」收紧成「区分大小写」，
#      同时排除标识符形态（前面紧跟字母/下划线）。
# ⇒ 顺带的好处：`owner` 作为 CSS 属性名、GitHub 术语等常见词不再误报。
# ============================================================================
# 🔴 「内部协作痕迹」= 内部称谓 + **本仓库账号名**。
#   账号名从 package.json 读（terms.self_identity_pat），不在词表里写字面量 ——
#   否则这份公开词表本身就携带一处身份泄漏（见 ERRORS E26）。
COLLAB_RE_STRICT = re.compile(
    r'(?<![A-Za-z0-9_])(?:' +
    '|'.join(re.escape(w) for w in terms.COLLAB_TRACE) +
    '|' + terms.self_identity_pat().pattern + r')')

# 工作日期戳单独判：只在注释/文档里查，且必须命中 2026-09 / 2026-10
CHECK_STAMP = ('工作日期戳', re.compile(terms.WORK_STAMP_RE))

# ⭐ 门禁自身**必须豁免**：它们为了检测这些词，词表里就得含它们。
#    这是「工具属性」，不是「内容泄漏」—— 外人看到的是一条扫描规则。
#
# 🔴🔴 2026-10-06 改成**按目录豁免**，不再逐个文件名列举。
#    为什么改：逐个列举必然会漏。
#    新加了 api-form-gate.py / doc-facts-gate.py / _probe.py 之后，
#    它们先因为含词表里的词被判红，接着 fixture 的「正常样本」用例
#    全部连锁失败 —— 一道门禁的措辞能拖垮另一道门禁的判据。
#    ⇒ 只要在 05-audit/ 下，就是门禁工具，按工具对待。
#
# 🔴 2026-10-29：判据**搬进 terms.py**（`terms.is_tool_file`）。
#    原因：outsider-audit.py 自己写了一份**只按文件名**的版本，
#    于是同一个仓库本地报干净、外网报 43 处。现在两边都调同一个函数。
def is_self_tool(rel):
    """门禁工具自身（要含禁词才能检测它们）。判据实现见 terms.is_tool_file。"""
    return terms.is_tool_file(rel)

# ⭐ 补 `.ts` —— 判别力验证抓到**门禁自己漏了类型定义文件**：
#   往 types/index.d.ts 注入内部代号，leak-scan 报"无敏感信息"。
#   根因：EXTS 列表里没有 .ts ⇒ .d.ts / .ts 从来没被扫过。
#   ⭐ 这就是「Test the Tests」的价值：门禁也需要被判别力验证。
EXTS = ('.js', '.ts', '.tsx', '.py', '.html', '.css', '.md', '.json',
        '.sh', '.mjs', '.yml', '.yaml', '.txt', '.tpl')


def _selftest():
    """判据的正反例 —— 除 companions 一节外都是纯内存。

    为什么必须自带：这几条判据的边界都很窄（要放过颜色、放过历史、
    放过**声明过的**配套仓库），任何一次"顺手放宽"都会让它们变成永远绿。
    反例必须在这里红。

    ⚠️ companions 一节要读 package.json（声明本身是数据，不抄第二份），
       这是唯一碰工作区文件的地方；读不出来按**失败**处理，不跳过。
    """
    bad = 0
    checks = [0]

    def chk(label, got, want):
        nonlocal bad
        checks[0] += 1
        ok = got == want
        print('  %s %-44s %s' % ('OK ' if ok else '🔴 ', label, got))
        if not ok:
            bad += 1

    p = terms.internal_id_pat()
    # ---- 正例：真实编号形态 ----
    chk('正：括号内编号（E137）', bool(p.search('（E137）')), True)
    chk('正：行首编号 E254（…', bool(p.search('E254（去掉前缀）')), True)
    chk('正：句中「见 E299」', bool(p.search('见 E299 的说明')), True)
    chk('正：大写无括号 E145', bool(p.search('修，E145：')), True)
    # ---- 反例：十六进制颜色与标识符，一个都不许咬 ----
    chk('反：颜色 #6E747E', bool(p.search('#6E747E')), False)
    chk('反：颜色 #2E343C', bool(p.search('#2E343C')), False)
    chk('反：标识符 parts_E123_x', bool(p.search('parts_E123_x')), False)
    chk('反：小写 e137', bool(p.search('e137')), False)

    # ---- changelog_future：历史豁免、未来必扫 ----
    cur = terms.current_version()
    parts = cur.split('.')
    fut = '%s.%s.0' % (parts[0], int(parts[1]) + 1)
    txt = ('## [Unreleased]\n\n- E999\n\n'
           '## [%s]\n\n- E998\n\n'
           '## [%s]\n\n- E997\n' % (cur, fut))
    got = terms.changelog_future(txt)
    chk('正：Unreleased 段被扫', 'E999' in got, True)
    chk('正：更高版本段被扫', 'E997' in got, True)
    chk('反：已发布段被豁免', 'E998' in got, False)

    # ---- companions：**声明过的**配套仓库放行，没声明的照旧红 ----
    # 为什么这对反例必须存在：README 想链到兄弟仓（只做适配、不含组件的插件包），
    # 而 `self_urls()` 原先只认本仓 ⇒ 一条正常的外链被判成"自有域名泄漏"。
    # 放开的正确方式是**逐个声明**；一旦有人把判据改成"只要是 github.com 都放过"，
    # 下面的反例就会从 1 变成 0 —— 这条断言就是那道闸。
    comps = terms.companion_urls()
    ipat = terms.self_identity_pat()
    m = re.search(r'github\.com/([A-Za-z0-9_.-]+)/', comps[0]) if comps else None
    if m:
        owner = m.group(1)
        chk('正：声明过的配套仓库地址',
            len(terms.hits_outside_repo_field('见 ' + comps[0], ipat)), 0)
        chk('反：同账号下没声明的仓库',
            len(terms.hits_outside_repo_field(
                '见 https://github.com/%s/not-declared-repo' % owner, ipat)), 1)
        chk('反：裸名字不算声明（要求 https 地址）',
            terms.companion_values('{"companions":["%s"]}' % owner), [])
    else:
        # 🔴 读不出声明就**判失败**，不是跳过：跳过等于这条判据从没验过。
        print('  🔴 找不到可用的 companions 声明 —— 豁免判据没有被验证')
        bad += 1

    if bad:
        print('  🔴 %d 条不符合预期' % bad)
        return 1
    print('  判据自检通过（%d 条）' % checks[0])
    return 0


def main():
    print('  === 敏感信息扫描 ===')
    print('  ' + terms.private_status())
    print('')
    # 🔴 视野 = 磁盘上要交付的东西（含未跟踪的新文件），不是 git 索引
    files = scannable_files(ROOT)

    hits = {}
    for rel in files:
        if not rel.endswith(EXTS):
            continue
        try:
            t = io.open(os.path.join(ROOT, rel), encoding='utf-8',
                        errors='replace').read()
        except Exception:
            continue
        # 🔴 2026-10-31：工具目录**不再整目录跳过**。
        #    事故：真实代号清单明文写在 `outsider-audit.py` 里，而两道扫描都把
        #    `05-audit/` 当"工具"跳过 ⇒ 一起报「零泄漏」，缺口正好在盲区里。
        #    ⇒ 工具只跳过"它必须列出来的词"（场景 / 流程 / Owner 称谓），
        #      身份类（真代号 / 用户名 / 本机路径）照抓 —— 见 terms.identity_hits。
        if is_self_tool(rel):
            for name, found in terms.identity_hits(t).items():
                hits.setdefault(name, []).append((rel, len(found)))
            continue
        for name, pat in PATTERNS:
            src = t
            # CHANGELOG 只判「以后」：0.26.0 及更早的条目是历史，
            # 改写历史才是篡改；但新写的条目不许再引内部编号。
            if name == '内部台账编号' and rel == 'CHANGELOG.md':
                src = terms.changelog_future(t)
            found = pat.findall(src)
            # ⭐ 过滤合法前缀（软件安装位置）——
            #    正则没法可靠表达「排除含空格的目录名」，只能在匹配后判断。
            if name.startswith('盘符'):
                found = [m for m in found
                         if not m.startswith(_OK_PREFIX)]
            if name == '自有域名':
                # ⭐ repository / homepage / bugs 里的账号名是**仓库身份**
                #    （npm 页面靠它定位源码），不算泄漏。
                #    ⚠️ 按**出现位置**判（terms.hits_outside_repo_field），
                #       不是「package.json 整份文件豁免」——
                #       整份豁免会让同文件里别的字段也漏过去。
                found = terms.hits_outside_repo_field(t, pat)
            n = len(found)
            if n:
                hits.setdefault(name, []).append((rel, n))

        # ---- 公开可用性三条 --------------------------------------------
        # ⚠️ 2026-10-31：`05-audit/` 不再整目录跳过（见循环开头），
        #    但这里的三条对工具目录仍不该生效：工具**必须**提到内部目录名与
        #    占位符才能检测它们。所以工具文件走上面对 identity_hits 的窄判据，
        #    根本不会走到这个循环 —— 这条注释是提醒，不是分支。
        for name, pat in CHECKS_EXTRA:
            if name == '内部协作痕迹':
                # 用区分大小写的严格版，避开 CLASS_OWNER / owners 这类变量名
                # ⭐ repository / homepage / bugs 里的账号名是**仓库身份**
                #    （npm 页面靠它定位源码），不算痕迹。
                #    按**出现位置**判，不再限定 rel == 'package.json'
                #    —— 限定文件会让别的 JSON 里的同类字段漏过去。
                found = terms.hits_outside_repo_field(t, COLLAB_RE_STRICT)
                n = len(found)
                if n:
                    hits.setdefault(name, []).append((rel, n))
                continue
            found = pat.findall(t)
            n = len(found)
            if n:
                hits.setdefault(name, []).append((rel, n))

        # 工作日期戳：只在注释行 / markdown 里查（业务日期不能误伤）
        # ⚠️ 06-vendor/ 豁免：那是**第三方协议合规台账**，
        #    里面的「核实日期」是台账的有效期（超过 6 个月要重查），
        #    删掉会让这份台账失去意义。那里是数据，不是过程痕迹。
        # ⚠️ CHANGELOG.md 也豁免：那里的日期是**发布日期**，
        #    属于发布记录的必要部分，不是内部过程痕迹。
        #    （不豁免的话，每次发版都会假红 ⇒ 门禁被学会忽略。）
        if (rel.endswith(('.css', '.html', '.md', '.py', '.js'))
                and not rel.startswith('06-vendor/')
                and rel != 'CHANGELOG.md'):
            stamp = []
            # ⚠️ 原来只认「行首带标记」的行（`*` / `//` / `#` …）。
            #    但块注释里的**续行**通常不带标记：
            #        /* 🔴 2026-10-04 滚动条令牌
            #           说明… */
            #    ⇒ 这类日期戳**一条都查不到**（实测漏了 4 处，都已随发布版出去）。
            #    ⇒ 改成跨行跟踪块注释状态：进入 `/*` 之后直到 `*/` 都算注释内。
            #      ⚠️ 不能用「数 /* 与 */ 的个数」判断（那是老假绿根因），
            #         必须按**位置**逐段推进。
            in_block = False
            for line in t.split('\n'):
                s = line.lstrip()
                scan_at = 0
                while True:
                    if not in_block:
                        open_at = line.find('/*', scan_at)
                        if open_at < 0:
                            break
                        close_at = line.find('*/', open_at + 2)
                        if close_at < 0:
                            # 本行开了块注释且没合上 ⇒ 从此处到行尾都在注释里
                            stamp.extend(CHECK_STAMP[1].findall(line[open_at:]))
                            in_block = True
                            break
                        # 同行开合 ⇒ 只查这段
                        stamp.extend(CHECK_STAMP[1].findall(
                            line[open_at:close_at + 2]))
                        scan_at = close_at + 2
                        continue
                    # 已在块注释内
                    close_at = line.find('*/', scan_at)
                    if close_at < 0:
                        stamp.extend(CHECK_STAMP[1].findall(line[scan_at:]))
                        break
                    stamp.extend(CHECK_STAMP[1].findall(line[scan_at:close_at + 2]))
                    in_block = False
                    scan_at = close_at + 2
                # 行注释 / markdown：整行都算
                if not in_block and s.startswith(('//', '#', '<!--', '-')):
                    stamp.extend(CHECK_STAMP[1].findall(line))
            if stamp:
                hits.setdefault(CHECK_STAMP[0], []).append((rel, len(stamp)))

    all_checks = list(PATTERNS) + CHECKS_EXTRA + [CHECK_STAMP]

    print('  扫了 %d 个文件' % len(files))
    print('')
    if not hits:
        print('  OK 无敏感信息')
        return 0

    total = 0
    for name, _ in all_checks:
        if name in hits:
            tot = sum(n for _, n in hits[name])
            total += tot
            print('  X %-12s %d 处 / %d 个文件' % (name, tot, len(hits[name])))
            for p, n in hits[name][:6]:
                print('       %s  x%d' % (p[:52], n))
    print('')
    print('  => 共 %d 处，必须清零后才能发布' % total)
    return 1


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        print('  === leak-scan 判据自检 ===')
        sys.exit(_selftest())
    sys.exit(main())
