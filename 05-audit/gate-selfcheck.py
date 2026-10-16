#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gate-selfcheck.py — 门禁运行器自身的门禁（检查项 J9）

===========================================================================
🔴 为什么需要（外部评审：「门禁自身的门禁」）
---------------------------------------------------------------------------
  评审在 check-all.sh 里发现三个问题，**都是门禁自己的**：
    ① 4 条 run 写在 exit 之后 ⇒ **永不执行**（却显示"已接入"）
    ② hygiene 同名出现两次 ⇒ 报告里分不清是哪一道
    ③ set -u 下用到未初始化的变量 ⇒ 失败路径会中途崩掉

  ⭐ 讽刺之处：这是一个**以门禁为核心卖点**的库，
     而它的门禁运行器自己有「看起来在跑、其实没跑」的门禁。

===========================================================================
判据
---------------------------------------------------------------------------
  ① exit 之后**不得**再有 run（不可达 = 假通过）
  ② run 名称**不得重复**（重复 = 报告歧义）
  ③ set -u 下用到的变量**必须已初始化**
  ④ CHANGELOG 版本标题的解析**只允许一份**（`_changelog.py`）

🔴 第 ④ 条是 0.8.9 加的，起因是真事故（见 `ERRORS.md` E43）：
  `bump-version.py` / `doc-facts-gate.py` / `release-gate.py`
  **各写了一份版本标题正则**，而且松紧不同。
  CHANGELOG 格式一改，三处以**三种不同方式**坏掉，其中两种是
  **静默失去鉴别力**（判据还在跑，什么都没查）。
  ⇒ 同一判定写两遍必然漂移（E31）—— 这条判据让第四份写不出来。
===========================================================================
"""
import sys
import os
import io
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(ROOT, '05-audit', 'check-all.sh')

# 环境自带的变量（不算"未初始化"）
BUILTIN = {
    'PATH', 'HOME', 'PWD', 'TMPDIR', 'USER', 'SHELL', 'LANG', 'IFS',
    'BASH_SOURCE', 'OSTYPE', 'PYTHONPATH', 'RANDOM', 'SECONDS', 'LINENO',
}
# 本库约定的环境变量（由运行者提供）
ALLOWED_ENV = {'NODE_PATH', 'NODE_DIR', 'NODE_MODULES', 'PW_PATH',
               'TIMING', 'PY', 'AUDIT_REF', 'GITHUB_TOKEN', 'GH_TOKEN'}

# 判据 ④ 用的谓词：这一行是不是"自己解析 CHANGELOG 版本标题"的正则？
# 形状 = 同行里同时出现 ① 正则调用 ② `##` ③ `\d+\.\d+\.\d+` 的**转义形式**。
# ⚠️ 只按"转义形式"认（`\\d+\\.\\d+`），所以**不会**命中
#    普通字符串里的 `0.8.8` 或注释里的说明文字。
CALL = ('re.search(', 're.match(', 're.finditer(', 're.compile(',
        'search(', 'match(', 'finditer(')


def is_version_regex_line(l):
    return (re.search(r'\\d\+\s*\\\.\s*\\d\+\s*\\\.\s*\\d\+', l) is not None
            and '##' in l
            and any(c in l for c in CALL))


# ⚠️ 也要跳过本文件：它**持有反向控制的样本串**（下面 `_dup_probe` 里的
#    那三条），否则判据会把自己的 fixture 当成"又写了一份"。
#    代价：本文件里真出现第四份解析器时抓不到 —— 可接受，
#    因为本文件本来就不解析 CHANGELOG。
def dup_parsers(skip=('_changelog.py', 'gate-selfcheck.py')):
    """除 `_changelog.py` 外，自己解析 CHANGELOG 版本标题的地方。"""
    hits = []
    d = os.path.join(ROOT, '05-audit')
    for f in sorted(os.listdir(d)):
        if not f.endswith('.py') or f in skip:
            continue
        txt = io.open(os.path.join(d, f), encoding='utf-8',
                      errors='replace').read()
        for i, l in enumerate(txt.split('\n'), 1):
            if is_version_regex_line(l):
                hits.append((f, i, l.strip()[:66]))
    return hits


def _dup_probe():
    """反向控制：合成"又写了一份"的两种真实形状 ⇒ 必须都被识别。"""
    samples = [
        # 实测踩到的第一、二份的形状
        r"    m = re.search(r'^##\s+(\d+\.\d+\.\d+)\b', text, re.M)",
        r"    for m in re.finditer(r'^##\s+(\d+\.\d+\.\d+)', text[:pos], re.M):",
        # 第三份（release-gate）
        r"        m = re.search(r'##\s*\[?v?(\d+\.\d+\.\d+)\]?', cl)",
    ]
    # 反例：普通版本号字符串 / 注释里提到版本号 ⇒ **不许**被识别
    negatives = [
        "version = '0.8.8'",
        "# 版本号在四处（VERSION / package.json / …）",
        "    print('      CHANGELOG      = %s' % cl_ver)",
    ]
    return (all(is_version_regex_line(s) for s in samples)
            and not any(is_version_regex_line(s) for s in negatives))


def main():
    print('  === 门禁运行器自检 ===')
    print('')
    if not os.path.isfile(SH):
        print('  X 找不到 check-all.sh')
        return 1
    src = io.open(SH, encoding='utf-8').read()
    lines = src.split('\n')
    bad = 0

    # ---------- ① exit 之后不得有 run ----------
    exit_at = None
    for i, l in enumerate(lines):
        if l.strip().startswith('exit '):
            exit_at = i
    if exit_at is None:
        print('  [1] X 找不到 exit 退出点')
        bad += 1
    else:
        after = [l.strip() for l in lines[exit_at + 1:]
                 if l.strip().startswith('run ')]
        if after:
            print('  [1] X exit 之后还有 %d 条门禁（**永不执行**）：'
                  % len(after))
            for a in after[:5]:
                print('        %s' % a[:58])
            bad += 1
        else:
            print('  [1] OK exit 之后无门禁（全部可达）')

    # ---------- ② run 名称不得重复 ----------
    names = []
    for l in lines:
        m = re.match(r'\s*run\s+"([a-z0-9_-]+)"', l)
        if m:
            names.append(m.group(1))
    dup = sorted(set(n for n in names if names.count(n) > 1))
    if dup:
        print('  [2] X 门禁名称重复：%s' % ', '.join(dup))
        print('        （同名会让报告无法分辨是哪一道）')
        bad += 1
    else:
        print('  [2] OK %d 条门禁名称唯一' % len(names))

    # ---------- ③ set -u 的变量必须已初始化 ----------
    has_u = re.search(r'^\s*set\s+-[a-z]*u', src, re.M) is not None
    if not has_u:
        print('  [3] - 未启用 set -u，跳过')
    else:
        assigned = set()
        for m in re.finditer(r'^\s*(?:local\s+|export\s+)?(\w+)=', src, re.M):
            assigned.add(m.group(1))
        for m in re.finditer(r'^\s*(?:local|export)\s+(\w+)', src, re.M):
            assigned.add(m.group(1))
        for m in re.finditer(r'for\s+(\w+)\s+in', src):
            assigned.add(m.group(1))
        # `while read -r a b` 也是赋值（0.8.9 补）：
        #   漏了它就会永久报一条假警告（实测：dt / nm），
        #   而**永久存在的假警告会训练人忽略所有警告**。
        for m in re.finditer(r'read\s+-[a-z]*\s+([^\n;|&]+)', src):
            for v in m.group(1).split():
                if re.match(r'^\w+$', v):
                    assigned.add(v)
        used = set()
        for m in re.finditer(r'\$\{?([A-Za-z_]\w*)', src):
            used.add(m.group(1))
        undef = sorted(u for u in used
                       if u not in assigned
                       and u not in BUILTIN
                       and u not in ALLOWED_ENV)
        if undef:
            print('  [3] ! set -u 下未初始化的变量：%s' % ', '.join(undef[:8]))
            print('        （只在失败路径用到时，失败会中途崩掉而非报出）')
        else:
            print('  [3] OK 未发现未初始化变量')

    # ---------- ④ CHANGELOG 解析只允许一份 ----------
    hits = dup_parsers()
    if hits:
        print('  [4] X 有 %d 处**自己解析 CHANGELOG 版本标题**（应只用 '
              '`_changelog.py`）：' % len(hits))
        for f, i, t in hits[:5]:
            print('        %s:%d  %s' % (f, i, t))
        print('        ⇒ 同一判定写两遍必然漂移（ERRORS.md E43 / E31）')
        bad += 1
    else:
        print('  [4] OK CHANGELOG 版本标题只有一份解析器（`_changelog.py`）')

    # 反向控制：合成样本必须被抓到（否则这条判据是瞎的）
    if not _dup_probe():
        print('  [4] X 反向控制失效：合成样本没被识别成"又写了一份"')
        bad += 1

    print('')
    if bad:
        print('  => 门禁运行器自身有 %d 处问题' % bad)
        return 1
    print('  OK 门禁运行器自身无问题')
    return 0


if __name__ == '__main__':
    sys.exit(main())
