# -*- coding: utf-8 -*-
"""CHANGELOG 版本标题的**唯一解析器**（0.8.9 · 外部审计 P1-3）。

为什么单独成一个模块（`ERRORS.md` E31：同一个判定不要写两遍）
---------------------------------------------------------------------------
两个脚本都要读 CHANGELOG 的版本标题，而它们各写了一份正则：

  · `bump-version.py`   要答「最新版本是哪个」
  · `doc-facts-gate.py` 的 F5 要答「版本标题后面是不是日期」

两份正则 = 同一个判定写两遍 ⇒ 必然漂移。**而且已经漂了**：

  实测（0.8.9）：CHANGELOG 从自创格式改成 Keep a Changelog 格式后，
  `bump-version.py` 的老正则 `^##\\s+(\\d+\\.\\d+\\.\\d+)` 不再匹配
  `## [0.8.8] - 2026-10-14`，于是**往下扫到了正文里的**
  `## 0.4.0 的第二部分：规范分层、状态收敛、纯 CSS 暗色`
  ⇒ 读出「CHANGELOG 版本 = 0.4.0」，与 package.json 的 0.8.8 不符 ⇒ `version-sync` 红。
  （那个正则一直有这个洞，只是以前正文里那条 H2 排在真版本标题之后，没轮到它。）

格式（唯一权威 = [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)）
---------------------------------------------------------------------------
  版本条目：`## [x.y.z] - YYYY-MM-DD`
  未发布：  `## [Unreleased]`

判据里最关键的一条：**必须带日期**。
  历史条目里可能还残留旧写法（`## x.y.z — YYYY-MM-DD`）—— 一并认，方便过渡。
  但**不带日期的 `## x.y.z 标题` 一律不算版本条目** ——
  正文里的 `## 0.4.0 的第二部分：…` 正是靠这条被排除的。
"""
import io
import re

# 版本条目：`## [0.8.8] - 2026-10-14` 与 `## 0.8.7 — 2026-10-14` 都认（都得带日期）
HEADING = re.compile(
    r'^##[ \t]+\[?(\d+\.\d+\.\d+)\]?[ \t]*(?:—|–|-)[ \t]*(\d{4}-\d{2}-\d{2})[ \t]*$',
    re.M)
# 未发布段
UNRELEASED = re.compile(r'^##[ \t]+\[Unreleased\]', re.M)

# **宽松**的版本标题形状：`## [x.y.z]`，**不要求日期**。
# 它是给"负向判据"用的 —— 例如 doc-facts 要问
# 「这一行的形状像版本标题，但它不是合法条目（缺日期）吗？」
# 🔴 为什么放在这里而不是各判据自己写（0.8.9）：
#   语法知识只能有一处。凡是在别处又写一遍 `##…\d+\.\d+\.\d+` 的，
#   都会被 `gate-selfcheck.py` 的判据 ④ 挡下（ERRORS.md E43）。
LOOSE = re.compile(r'^##[ \t]+\[?(\d+\.\d+\.\d+)\]?', re.M)


def headings(text):
    """→ [(version, date, line_no)]，按文件出现顺序（第一个通常是最新版本）。"""
    out = []
    for m in HEADING.finditer(text):
        out.append((m.group(1), m.group(2),
                    text.count('\n', 0, m.start()) + 1))
    return out


def latest_version(text):
    """最新一个版本条目的版本号（没有则 None）。"""
    hs = headings(text)
    return hs[0][0] if hs else None


def read(path):
    return io.open(path, encoding='utf-8').read()


# ---------------------------------------------------------------------------
# 自检（`ERRORS.md`：新判据必须带反向控制）
# ---------------------------------------------------------------------------
def _selftest():
    bad = 0

    def chk(label, got, want):
        nonlocal bad
        ok = got == want
        print('  %s %s' % ('OK ' if ok else '🔴 ', label))
        if not ok:
            print('       got=%r want=%r' % (got, want))
            bad += 1

    t = (
        '# Changelog\n\n'
        '## [Unreleased]\n\n### Fixed\n\n- x\n\n'
        '## [0.8.8] - 2026-10-14\n\n### Added\n\n- a\n\n'
        '## 0.8.7 — 2026-10-14\n\n- legacy 写法也要认\n\n'
        '## 0.4.0 的第二部分：规范分层\n\n'      # ← 正文里的 H2，不是版本条目
        '- 正文\n\n'
        '## 版本号约定\n\n'                      # ← 说明段，也不是
        '- 说明\n'
    )
    hs = headings(t)
    chk('认出 2 个版本条目（新格式 + 旧格式）', len(hs), 2)
    chk('第一个是 0.8.8（最新）', hs[0][0] if hs else None, '0.8.8')
    chk('第二个是 0.8.7', hs[1][0] if hs else None, '0.8.7')
    chk('latest_version', latest_version(t), '0.8.8')
    # 🔴 这条就是实测踩到的那个洞
    chk('正文里的 `## 0.4.0 的第二部分` 不算版本条目',
        '0.4.0' in [h[0] for h in hs], False)
    chk('不带日期的 `## [0.9.0]` 不算版本条目',
        latest_version('## [0.9.0]\n'), None)
    chk('空文档 → None', latest_version(''), None)

    print('')
    print('  ' + ('🔴 %d 条自检未通过' % bad if bad else '自检全部通过'))
    return 1 if bad else 0


if __name__ == '__main__':
    import sys
    sys.exit(_selftest())
