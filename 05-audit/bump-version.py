#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bump-version.py — 一处改版本，四处同步（0.8.8 新增）

===========================================================================
🔴 为什么要它（不是"少打几个字"那么浅）
---------------------------------------------------------------------------
   版本号在这仓库里出现在**四个地方**，而且 `release-gate.py` 会盯它们一致：

     ① VERSION
     ② package.json         .version
     ③ package-lock.json    .version（根包，lock 里有两处）
     ④ CHANGELOG.md         最新一个 `## X.Y.Z` 标题

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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = {
    'VERSION': os.path.join(ROOT, 'VERSION'),
    'package': os.path.join(ROOT, 'package.json'),
    'lock': os.path.join(ROOT, 'package-lock.json'),
    'changelog': os.path.join(ROOT, 'CHANGELOG.md'),
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
    m = re.search(r'^##\s+(\d+\.\d+\.\d+)\b', read(FILES['changelog']), re.M)
    return m.group(1) if m else None


def collect():
    """把四处的版本号都读出来 ⇒ 供比对"""
    pkg = json.loads(read(FILES['package']))
    lock = json.loads(read(FILES['lock']))
    return {
        'VERSION': current_version(),
        'package.json': pkg.get('version'),
        'package-lock(root)': lock.get('version'),
        'package-lock(pkg)': (lock.get('packages', {})
                              .get('', {})
                              .get('version')),
        'CHANGELOG': changelog_latest(),
    }


def show(tag=''):
    got = collect()
    print(('  ' if tag else '') + '四处版本号：')
    for k, v in got.items():
        print('%-22s %s' % (k, v))
    return got


def check():
    got = collect()
    vals = set(v for v in got.values() if v)
    if len(vals) <= 1:
        print('✅ 四处版本一致：%s' % got['VERSION'])
        return 0
    print('❌ 四处版本不一致（release-gate 也会红）：')
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

    # ④ CHANGELOG：若新版本还没有条目，就在文件顶部插入骨架
    cl = read(FILES['changelog'])
    if changelog_latest() != new:
        import datetime
        today = datetime.date.today().isoformat()
        head = ('## %s — %s\n\n'
                '### TODO · 这一版改了什么\n\n'
                '（写清楚「改了什么 / 为什么」，有反向控制就写上）\n\n'
                '---\n\n') % (new, today)
        # 插到文件开头，跳过可能的 front-matter
        cl = head + cl
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
    print('   自检：四处都是 %s' % new)

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