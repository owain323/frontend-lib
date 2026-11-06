#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bump-version.py — 一处改版本，六处同步（0.8.8 新增 · 0.24.2 扩到六处）

===========================================================================
🔴 为什么要它（不是"少打几个字"那么浅）
---------------------------------------------------------------------------
   版本号在这仓库里出现在**四个地方**，而且 `release-gate.py` 会盯它们一致：

     ① VERSION
     ② package.json         .version
     ③ package-lock.json    .version（根包，lock 里有两处）
     ④ CHANGELOG.md         最新一个 `## [X.Y.Z] - YYYY-MM-DD` 标题
                              （旧写法 `## X.Y.Z — YYYY-MM-DD` 也认，见 `_changelog.py`）

   本库把「我说什么、系统就是什么」当核心卖点 ⇒ **手改这四处就是
   在破坏自己的卖点**。而手改的真实失效模式是：
   改了 ①② 忘了 ③ ⇒ 门禁变红 ⇒ 回头手工找；
   或者更糟：全部改完但 CHANGELOG 标题日期写错 ⇒ 门禁不查日期 ⇒ 悄悄错。

===========================================================================
用法
---------------------------------------------------------------------------
   python3 05-audit/bump-version.py <新版本号>      # 改四处 + 建 CHANGELOG 骨架
   python3 05-audit/bump-version.py --check         # 只查四处是否一致（CI 用）

===========================================================================
⭐ 它的自检（不是"跑完不报错"就算成功）
---------------------------------------------------------------------------
   改完之后本脚本会**自己反向验证**：
     · 读回四处，逐个比对，不一致就报错并指出是哪一处
     · 用 `release-gate.py` 的判据再核一遍（能跑就跑）
   ⇒ 「脚本 exit 0」= 四处真的同步了，而不是"我改了三个文件没报错"。
"""
import io
import json
import os
import re
import subprocess
import sys

# `_changelog.py` 与本文件同目录 —— 跑法与 import 法都要能找到它
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = {
    'VERSION': os.path.join(ROOT, 'VERSION'),
    'package': os.path.join(ROOT, 'package.json'),
    'lock': os.path.join(ROOT, 'package-lock.json'),
    'changelog': os.path.join(ROOT, 'CHANGELOG.md'),
    # 🔴 第五处（0.9.0 发布时才发现漏了）：`ai/components.json` 里有
    #    `libraryVersion`，而 `ai-contract` 门禁会比对它。
    #    漏掉的后果很具体：bump 之后 `ai-contract` **必然红**，
    #    必须再手跑一次生成器才过 —— 而 bump-version.py 自己只跑 release-gate，
    #    看不到这一项。发布当天就是被这个卡住的。
    'contract': os.path.join(ROOT, 'ai', 'components.json'),
    # 🔴 第六处（0.24.2 发布时才发现）：`docs/ACCESSIBILITY.md` 里有一行
    #    `| 声明适用版本 | agentcss `X.Y.Z` |`。它不是"介绍当前版本"的闲话，
    #    而是一份**声明**：写哪个版本，就等于声称对那个版本做过无障碍复核。
    #    漏掉的后果很具体：bump 之后 `doc-facts-gate` 必然红
    #    （「声明承诺了一个不存在的版本」），而 release-gate 只核前五处 ⇒
    #    `bump-version.py` 自检全绿、发版门禁才红。0.24.2 的全量 222 道里
    #    唯一的真失败就是它。
    'a11y': os.path.join(ROOT, 'docs', 'ACCESSIBILITY.md'),
}

# 仓库自己的版本号形如 0.8.7 / 1.2.3
VER_RE = re.compile(r'^\d+\.\d+\.\d+$')


def read(p):
    return io.open(p, encoding='utf-8').read()


def write(p, s):
    io.open(p, 'w', encoding='utf-8', newline='').write(s)


def current_version():
    """以 VERSION 文件为准（它是最短、最不会被格式化影响的那个）"""
    return read(FILES['VERSION']).strip()


def changelog_latest():
    """最新版本条目 —— 解析交给 `_changelog.py`（唯一来源）。

    🔴 0.8.9 修：这里原来是本地正则 `^##\\s+(\\d+\\.\\d+\\.\\d+)`。
      CHANGELOG 改成 Keep a Changelog 格式（`## [0.8.8] - 2026-10-14`）后
      它匹配不到真版本标题，**往下扫到了正文里的**
      `## 0.4.0 的第二部分：规范分层…` ⇒ 读出 0.4.0 ⇒ `version-sync` 红。
      ⇒ 改用共享解析器（同时修掉那个"正文 H2 被当版本标题"的老洞）。
    """
    import _changelog
    return _changelog.latest_version(read(FILES['changelog']))


def a11y_declared_version():
    """`docs/ACCESSIBILITY.md` 里声明的适用版本（读不到返回 None）。"""
    p = FILES['a11y']
    if not os.path.isfile(p):
        return None
    m = re.search(r'声明适用版本\s*\|\s*agentcss\s*`([^`]+)`', read(p))
    return m.group(1) if m else None


def collect():
    """把六处的版本号都读出来 ⇒ 供比对"""
    pkg = json.loads(read(FILES['package']))
    lock = json.loads(read(FILES['lock']))
    contract = json.loads(read(FILES['contract']))
    return {
        'VERSION': current_version(),
        'package.json': pkg.get('version'),
        'package-lock(root)': lock.get('version'),
        'package-lock(pkg)': (lock.get('packages', {})
                              .get('', {})
                              .get('version')),
        'CHANGELOG': changelog_latest(),
        'ai/components.json': contract.get('libraryVersion'),
        'docs/ACCESSIBILITY.md': a11y_declared_version(),
    }


def show(tag=''):
    got = collect()
    print(('  ' if tag else '') + '六处版本号：')
    for k, v in got.items():
        print('%-22s %s' % (k, v))
    return got


def check():
    got = collect()
    vals = set(v for v in got.values() if v)
    if len(vals) <= 1:
        print('✅ 六处版本一致：%s' % got['VERSION'])
        return 0
    print('❌ 六处版本不一致（release-gate 也会红）：')
    ref = got['VERSION']
    for k, v in got.items():
        mark = '' if v == ref else'  ← 不一致'
        print('   %-22s %s%s' % (k, v, mark))
    return 1


def bump(new):
    if not VER_RE.match(new):
        print('❌ 版本号格式不对：%r（应形如 0.8.8）' % new)
        return 2
    old = current_version()

    # ① VERSION
    write(FILES['VERSION'], new + '\n')

    # ② package.json（保持原缩进与结尾风格，别整文件重排）
    raw = read(FILES['package'])
    raw2 = re.sub(r'("version"\s*:\s*)"[^"]+"',
                  lambda m: m.group(1) + '"%s"' % new, raw, count=1)
    write(FILES['package'], raw2)

    # ③ package-lock.json —— 🔴 有**两处**（根 + packages[""]），
    #    只改第一处是本脚本存在的理由（人手最容易漏这里）
    raw = read(FILES['lock'])
    lock_hits = [0]

    def _repl(m):
        lock_hits[0] += 1
        return m.group(1) + '"%s"' % new

    raw = re.sub(r'("version"\s*:\s*)"[^"]+"', _repl, raw, count=2)
    write(FILES['lock'], raw)
    lock_hits_n = lock_hits[0]

    # ③b ai/components.json 的 libraryVersion（0.9.0 补 · 第五处）
    raw = read(FILES['contract'])
    raw2, n_contract = re.subn(r'("libraryVersion"\s*:\s*)"[^"]+"',
                               lambda m: m.group(1) + '"%s"' % new, raw, count=1)
    if n_contract:
        write(FILES['contract'], raw2)

    # ③c docs/ACCESSIBILITY.md：声明版本 + 声明日期（第六处）
    #     日期也必须改 —— 声明的意思是"针对这一版复核过"，留旧日期会自相矛盾。
    import datetime as _dt
    acc = FILES['a11y']
    if os.path.isfile(acc):
        raw = read(acc)
        raw2, n_acc = re.subn(
            r'(\|\s*声明适用版本\s*\|\s*agentcss\s*`)[^`]+(`\s*\|)',
            lambda m: m.group(1) + new + m.group(2), raw, count=1)
        raw3, n_date = re.subn(
            r'(\|\s*声明日期\s*\|\s*)[0-9]{4}-[0-9]{2}-[0-9]{2}',
            lambda m: m.group(1) + _dt.date.today().isoformat(), raw2, count=1)
        if n_acc:
            write(acc, raw3)
        else:
            print('⚠️  docs/ACCESSIBILITY.md 里没找到「声明适用版本」行 —— '
                  'doc-facts-gate 会红，先修判据或修文档')

    # ④ CHANGELOG：把 [Unreleased] 的内容**归入**新版本，Unreleased 清空
    cl = read(FILES['changelog'])
    if changelog_latest() != new:
        import _changelog as CL
        import datetime
        today = datetime.date.today().isoformat()
        # 🔴 标题格式 = Keep a Changelog（0.8.9 改）：
        #     `## [x.y.z] - YYYY-MM-DD`。原来是自创的 `## x.y.z — date`，
        #     工具链解析不了（审计 P1-3）。
        empty_skeleton = ('## [%s] - %s\n\n'
                          '### TODO · 这一版改了什么\n\n'
                          '（写清楚「改了什么 / 为什么」，有反向控制就写上）\n\n'
                          '---\n\n') % (new, today)
        # 🔴🔴 2026-11-06 修（0.27.3 事故）：
        #     旧逻辑只**插入一个 TODO 骨架**，不搬 Unreleased 的内容。
        #     结果是发布后 `## [0.27.3]` 段里只有 TODO，而所有真实改动
        #     都留在 `## [Unreleased]` 里 —— GitHub Release 正文（取该段）
        #     就是一句"（写清楚改了什么）"，npm 包里的 CHANGELOG 同样。
        #     ⇐ 发布链上"我说什么系统就是什么"的核心卖点，被一个插入位置毁了。
        #     正确语义：Unreleased 是"待发"，发版时它的内容 **属于** 新版本。
        u = CL.UNRELEASED.search(cl)
        if u:
            rest = cl[u.end():]
            _nxt = re.search(r'^## ', rest, re.M)
            released = (rest[:_nxt.start()] if _nxt else rest).strip()
            remainder = rest[_nxt.start():] if _nxt else ''
            block = ('## [%s] - %s\n\n%s\n\n---\n\n' % (new, today, released)
                     if released else empty_skeleton)
            cl = cl[:u.start()] + '## [Unreleased]\n\n' + block + remainder
        else:
            # 没有 Unreleased 段（历史仓）：插到第一个已有版本条目前
            _m = CL.HEADING.search(cl)
            if _m:
                cl = cl[:_m.start()] + empty_skeleton + cl[_m.start():]
            else:
                cl = cl.rstrip('\n') + '\n\n' + empty_skeleton
        write(FILES['changelog'], cl)

    print('✅ 已改：%s → %s' % (old, new))
    print('   package-lock 改了 %d 处（根包 + packages[""]）' % lock_hits_n)

    # ---- ⭐ 自检：读回来比对，不靠"没报错" ----
    got = collect()
    bad = [(k, v) for k, v in got.items() if v != new]
    if bad:
        print('❌ 自检失败：以下位置仍是旧值：')
        for k, v in bad:
            print('   %-22s %s' % (k, v))
        return 1
    print('   自检：六处都是 %s' % new)

    # 再让release-gate 自己核一遍（它管得比本脚本宽）
    r = subprocess.run([sys.executable,
                        os.path.join(ROOT, '05-audit', 'release-gate.py')],
                       cwd=ROOT, capture_output=True, text=True,
                       encoding='utf-8')
    print('   release-gate：%s' % ('PASS' if r.returncode == 0 else 'FAIL'))
    if r.returncode != 0:
        print((r.stdout or '')[-400:])
    return 0


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == '--check':
        return check()
    if len(sys.argv) >= 2 and not sys.argv[1].startswith('-'):
        return bump(sys.argv[1])
    print(__doc__)
    print('用法：bump-version.py <新版本号> | bump-version.py --check')
    return 2


if __name__ == '__main__':
    sys.exit(main())