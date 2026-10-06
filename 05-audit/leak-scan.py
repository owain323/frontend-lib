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


def _outside_repo_field(text, token):
    """token 是否有至少一次命中落在 package.json 的仓库身份字段之外。

    ⚠️ 不能只看「同一行有没有 key」——
    package.json 的 repository 是嵌套对象：
        "repository": {
          "type": "git",
          "url": "git+https://github.com/xxx/yyy.git"← key 在上一行
        }
    ⇒ 必须按 **JSON 结构**判断，而不是按行。
    做法：直接查这些字段的取值范围。
    """
    try:
        data = json.loads(text)
    except Exception:
        return True   # 解析不了就当有问题，宁可误报
    allowed = []
    for key in ('repository', 'homepage', 'bugs'):
        v = data.get(key)
        if isinstance(v, str):
            allowed.append(v)
        elif isinstance(v, dict):
            for vv in v.values():
                if isinstance(vv, str):
                    allowed.append(vv)
    for a in allowed:
        if token in a:
            return False
    return True

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
    ('仓库绝对路径', re.compile(r'E:[/' + re.escape(chr(92)) + r']frontend-lib|'
                                 r'(?<![\w:/])/e/frontend', re.I)),
    ('内部代号', re.compile('|'.join(re.escape(w) for w in terms.HARD_BAN), re.I)),
    ('自有域名', re.compile(terms.DOMAIN, re.I)),
    ('内部流程', re.compile('|'.join(re.escape(w) for w in terms.PROCESS_WORDS), re.I)),
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
COLLAB_RE_STRICT = re.compile(
    r'(?<![A-Za-z0-9_])' + '|'.join(re.escape(w) for w in terms.COLLAB_TRACE))

# 工作日期戳单独判：只在注释/文档里查，且必须命中 2026-09 / 2026-10
CHECK_STAMP = ('工作日期戳', re.compile(terms.WORK_STAMP_RE))

# 门禁目录：内部目录名在这些文件里出现是合理的
AUDIT_PREFIX = '05-audit/'

# ⭐ 门禁自身**必须豁免**：它们为了检测这些词，词表里就得含它们。
#    这是「工具属性」，不是「内容泄漏」—— 外人看到的是一条扫描规则。
# ⭐ 门禁自身**必须豁免**：它们为了检测这些词，词表里就得含它们。
#    这是「工具属性」，不是「内容泄漏」—— 外人看到的是一条扫描规则。
#
# 🔴🔴 2026-10-06 改成**按目录豁免**，不再逐个文件名列举。
#    为什么改：逐个列举必然会漏。
#    新加了 api-form-gate.py / doc-facts-gate.py / _probe.py 之后，
#    它们先因为含词表里的词被判红，接着 fixture 的「正常样本」用例
#    全部连锁失败 —— 一道门禁的措辞能拖垮另一道门禁的判据。
#    ⇒ 只要在 05-audit/ 下，就是门禁工具，按工具对待。
#    （对外的价值：门禁脚本本身是可读的自证材料，不该被自己的规则扫）
SELF_DIR_PREFIX = '05-audit/'

# 仍需单独豁免的（不在 05-audit/ 下的）
SELF_FILES = {'迁移脚本'}


def is_self_tool(rel):
    """门禁工具自身（要含禁词才能检测它们）。"""
    return rel.startswith(SELF_DIR_PREFIX) or rel.split('/')[-1] in SELF_FILES

# ⭐ 补 `.ts` —— 判别力验证抓到**门禁自己漏了类型定义文件**：
#   往 types/index.d.ts 注入内部代号，leak-scan 报"无敏感信息"。
#   根因：EXTS 列表里没有 .ts ⇒ .d.ts / .ts 从来没被扫过。
#   ⭐ 这就是「Test the Tests」的价值：门禁也需要被判别力验证。
EXTS = ('.js', '.ts', '.tsx', '.py', '.html', '.css', '.md', '.json',
        '.sh', '.mjs', '.yml', '.yaml', '.txt', '.tpl')


def main():
    print('  === 敏感信息扫描 ===')
    print('')
    try:
        out = subprocess.run(['git', '-c', 'core.quotePath=false', 'ls-files'],
                             cwd=ROOT, capture_output=True, timeout=30)
        files = [f for f in out.stdout.decode('utf-8', 'replace').split('\n')
                 if f.strip()]
    except Exception:
        files = []

    hits = {}
    for rel in files:
        if is_self_tool(rel) or not rel.endswith(EXTS):
            continue
        try:
            t = io.open(os.path.join(ROOT, rel), encoding='utf-8',
                        errors='replace').read()
        except Exception:
            continue
        for name, pat in PATTERNS:
            found = pat.findall(t)
            # ⭐ 过滤合法前缀（软件安装位置）——
            #    正则没法可靠表达「排除含空格的目录名」，只能在匹配后判断。
            if name.startswith('盘符'):
                found = [m for m in found
                         if not m.startswith(_OK_PREFIX)]
            if name == '自有域名' and rel == 'package.json':
                # ⭐ package.json 里的 repository/homepage/bugs
                #    **必须**是真实仓库地址 —— 否则 npm 页面点不开、
                #    依赖扫描器定位不到源码。
                #    域名本身就是仓库身份的一部分，不算泄漏。
                found = []
            n = len(found)
            if n:
                hits.setdefault(name, []).append((rel, n))

        # ---- 公开可用性三条 --------------------------------------------
        # 只在非门禁目录里查内部目录名：门禁脚本提到这些目录是正常的。
        for name, pat in CHECKS_EXTRA:
            if name == '内部目录引用' and rel.startswith(AUDIT_PREFIX):
                continue
            if name == '内部协作痕迹':
                # 用区分大小写的严格版，避开 CLASS_OWNER / owners 这类变量名
                found = COLLAB_RE_STRICT.findall(t)
                # ⭐ package.json 例外：repository / homepage / bugs 里出现的
                #   账号名是**仓库身份**（npm 页面靠它定位源码），不算痕迹。
                if rel == 'package.json':
                    found = [m for m in found if _outside_repo_field(t, m)]
                n = len(found)
                if n:
                    hits.setdefault(name, []).append((rel, n))
                continue
            # 占位符：只查**用户会照抄的文档**。
            #   门禁脚本里的 ${REPO} / ${HOME} 是它自己 docstring 里的示例，
            #   没人会去复制那些，不是缺陷。
            if name == '未替换占位符' and (
                    rel.startswith(AUDIT_PREFIX) or rel == 'CHANGELOG.md'):
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
            for line in t.split('\n'):
                s = line.lstrip()
                is_comment = (s.startswith(('*', '//', '/*', '#', '<!--', '-'))
                              or s.startswith('/*'))
                if is_comment:
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
    sys.exit(main())
