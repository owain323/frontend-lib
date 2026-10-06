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

# ⭐ 门禁自身**必须豁免**：它们为了检测这些词，词表里就得含它们。
#    这是「工具属性」，不是「内容泄漏」—— 外人看到的是一条扫描规则。
SELF = {'leak-scan.py', 'leak-clean.py', 'leak-fix-paths.py', 'terms.py',
        'outsider-audit.py', 'publish-guard.py', 'api-snapshot.py',
        'gate-selfcheck.py', 'release-gate.py', 'hype-scan.py',
        'proper-noun-scan.py', '_common.py', 'repo-hygiene.py'}

# ⭐ 2026-10-06 补 `.ts` —— 反向控制抓到**门禁自己漏了类型定义文件**：
#   往 types/index.d.ts 注入内部代号，leak-scan 报"无敏感信息"。
#   根因：EXTS 列表里没有 .ts ⇒ .d.ts / .ts 从来没被扫过。
#   ⭐ 这就是「Test the Tests」的价值：门禁也需要被反向控制。
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
        if rel.split('/')[-1] in SELF or not rel.endswith(EXTS):
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

    print('  扫了 %d 个文件' % len(files))
    print('')
    if not hits:
        print('  OK 无敏感信息')
        return 0

    total = 0
    for name, _ in PATTERNS:
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
