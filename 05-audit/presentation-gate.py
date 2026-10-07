#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
presentation-gate.py — 呈现适配层的五条判据**真的会红**

背景（为什么补这道门禁）
------------------------
`adapters/presentation/` 里躺着两个脚本（`to-doc.js` / `check.js`）和一份
`deck.schema.json`，README 声称它们守着五条呈现形态特有的判据：

    ① 版面必须已登记        ② 单页元素 <= 12
    ③ 非封面页必须有标题    ④ 标题层级不跳级
    ⑤ 不得出现页面级选择器（.slide-N / .page-N）

🔴 实测（0.4.2 收口时）：**这五条从来没有被执行过**。
`core-boundary` 只验证了 `to-doc.js` 的往返（deck → 契约文档 → 核心校验器接受），
`check.js` 一次都没被调用 —— 一个声称"以门禁为核心卖点"的库，
却有一段**说自己会检查、实际没人跑**的代码。

这正是陌生人视角最容易踩的坑：README 说有，跑起来发现没人验证过。

判据
----
  A. 合规 deck（fixtures/deck-ok.json）⇒ check.js 必须 exit 0
  B. 违规 deck（fixtures/deck-bad.json）⇒ check.js 必须 exit != 0，
     且五条判据**各被命中一次**（缺一条 = 该判据已失效）
  C. `check.js` 的 MAX_PER_SLIDE 必须等于 `deck.schema.json` 的 nodes.maxItems
     ⇒ 两个真值源，改一个忘另一个就成了"文档说 12、代码放 20"

⚠️ 与 core-boundary 的分工
--------------------------
`core-boundary` 守**核心不含呈现语义** + **往返可用**；
本门禁守**呈现层自己的判据还在工作**。两者不重叠。

用法
----
  python3 05-audit/presentation-gate.py             # 正常跑
  python3 05-audit/presentation-gate.py --selftest   # 反向控制
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADAPTER = os.path.join(ROOT, 'adapters', 'presentation')
FIXTURES = os.path.join(ADAPTER, 'fixtures')

# 五条判据 ⇒ 在 check.js 输出里应当出现的特征串
# ⚠️ 特征串取自 check.js 的报错文案。**改文案必须同步改这里** ——
#    否则会出现「判据还在、门禁认不出它」的假绿。
CRITERIA = [
    ('① 版面必须已登记', '未登记'),
    ('② 单页元素上限', '超过上限'),
    ('③ 非封面页必须有标题', '没有标题'),
    ('④ 标题层级不跳级', '层级跳级'),
    ('⑤ 不得出现页面级选择器', '页面级选择器'),
]


def find_node():
    d = os.environ.get('NODE_DIR')
    if d and os.path.isfile(os.path.join(d, 'node')):
        return os.path.join(d, 'node')
    d = os.environ.get('NODE_DIR')
    if d and os.path.isfile(os.path.join(d, 'node.exe')):
        return os.path.join(d, 'node.exe')
    return 'node'


def run_check(adapter_dir, deck_path, node):
    """跑 check.js，返回 (returncode, stdout+stderr)。"""
    p = subprocess.run(
        [node, os.path.join(adapter_dir, 'check.js'), deck_path],
        capture_output=True, cwd=ROOT)
    out = (p.stdout or b'').decode('utf-8', 'replace') + \
          (p.stderr or b'').decode('utf-8', 'replace')
    return p.returncode, out


def missed(out):
    """返回没被命中的判据名列表。"""
    return [name for name, needle in CRITERIA if needle not in out]


def read_limit(adapter_dir):
    """读两个真值源里的「单页元素上限」。"""
    src = io.open(os.path.join(adapter_dir, 'check.js'), encoding='utf-8').read()
    m = re.search(r'MAX_PER_SLIDE\s*=\s*(\d+)', src)
    code = int(m.group(1)) if m else None
    sch = json.loads(io.open(os.path.join(adapter_dir, 'deck.schema.json'),
                             encoding='utf-8').read())
    doc = sch['definitions']['slide']['properties']['nodes'].get('maxItems')
    return code, doc


def selftest():
    """反向控制：证明本门禁**会红**（否则它就是个摆设）。"""
    print('  === presentation 反向控制 ===')
    node = find_node()
    ok = True
    tmp = tempfile.mkdtemp(prefix='fl-presentation-')
    try:
        # ---- ① 弄瘫判据 ②（把上限放到 999）⇒ 门禁必须报「② 未被命中」----
        d1 = os.path.join(tmp, 'no-limit')
        shutil.copytree(ADAPTER, d1)
        p = os.path.join(d1, 'check.js')
        s = io.open(p, encoding='utf-8').read().replace(
            'MAX_PER_SLIDE = 12', 'MAX_PER_SLIDE = 999')
        io.open(p, 'w', encoding='utf-8', newline='').write(s)
        rc, out = run_check(d1, os.path.join(FIXTURES, 'deck-bad.json'), node)
        m = missed(out)
        if '② 单页元素上限' not in m:
            print('  [FAIL] 反向控制失效：上限被放宽到 999，门禁却没发现 ② 失效')
            ok = False
        else:
            print('  [OK]   上限放宽到 999 ⇒ 认出 ② 已失效')

        # ---- ② 弄瘫判据 ⑤（去掉 .slide- 正则）⇒ 必须报「⑤ 未被命中」----
        d2 = os.path.join(tmp, 'no-override')
        shutil.copytree(ADAPTER, d2)
        p = os.path.join(d2, 'check.js')
        s = io.open(p, encoding='utf-8').read().replace(
            r'/\.slide-/.test(dump) || ', '')
        io.open(p, 'w', encoding='utf-8', newline='').write(s)
        rc, out = run_check(d2, os.path.join(FIXTURES, 'deck-bad.json'), node)
        m = missed(out)
        if '⑤ 不得出现页面级选择器' not in m:
            print('  [FAIL] 反向控制失效：去掉 .slide- 正则后门禁没发现 ⑤ 失效')
            ok = False
        else:
            print('  [OK]   去掉 .slide- 正则 ⇒ 认出 ⑤ 已失效')

        # ---- ③ 一致性判据：把 schema 的 maxItems 改成 8 ⇒ 必须报不一致 ----
        d3 = os.path.join(tmp, 'drift')
        shutil.copytree(ADAPTER, d3)
        p = os.path.join(d3, 'deck.schema.json')
        s = io.open(p, encoding='utf-8').read().replace('"maxItems": 12',
                                                        '"maxItems": 8')
        io.open(p, 'w', encoding='utf-8', newline='').write(s)
        code, doc = read_limit(d3)
        if code == doc:
            print('  [FAIL] 反向控制失效：12 vs 8 的真值漂移没被认出来')
            ok = False
        else:
            print('  [OK]   schema 改成 8 / 代码仍是 12 ⇒ 认出真值漂移')

        # ---- ④ 正例不被误报：合规 deck 在**原样**适配层下必须过 ----
        rc, out = run_check(ADAPTER, os.path.join(FIXTURES, 'deck-ok.json'), node)
        if rc != 0:
            print('  [FAIL] 误报：合规 deck 被判失败')
            ok = False
        else:
            print('  [OK]   合规 deck 不被误报')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return 0 if ok else 1


def main():
    if '--selftest' in sys.argv:
        return selftest()

    print('  === 呈现适配层判据 ===')
    fails = 0

    for f in ('check.js', 'to-doc.js', 'deck.schema.json',
              'fixtures/deck-ok.json', 'fixtures/deck-bad.json'):
        if not os.path.isfile(os.path.join(ADAPTER, f)):
            print('  [FAIL] 适配层缺文件：%s' % f)
            fails += 1

    node = find_node()
    try:
        subprocess.run([node, '-v'], capture_output=True, timeout=30)
    except Exception:
        print('  SKIP（缺 node：装好 node 后才会跑）')
        return 0

    # ---- A. 合规 deck 必须过 ----
    rc, out = run_check(ADAPTER, os.path.join(FIXTURES, 'deck-ok.json'), node)
    if rc != 0:
        print('  [FAIL] A. 合规 deck 被判失败（误报）：\n%s' % out[:400])
        fails += 1
    else:
        print('  [OK]   A. 合规 deck 通过（3 页）')

    # ---- B. 违规 deck 必须红，且五条判据各命中一次 ----
    rc, out = run_check(ADAPTER, os.path.join(FIXTURES, 'deck-bad.json'), node)
    if rc == 0:
        print('  [FAIL] B. 违规 deck 竟然通过 ⇒ check.js 整体失效')
        fails += 1
    else:
        m = missed(out)
        if m:
            print('  [FAIL] B. 以下判据没被命中 ⇒ 已失效：%s' % '、'.join(m))
            fails += len(m)
        else:
            print('  [OK]   B. 违规 deck 被拦下，五条判据各命中一次')

    # ---- C. 两个真值源必须一致 ----
    code, doc = read_limit(ADAPTER)
    if code is None or doc is None:
        print('  [FAIL] C. 读不到单页元素上限（代码=%s schema=%s）' % (code, doc))
        fails += 1
    elif code != doc:
        print('  [FAIL] C. 真值漂移：check.js=%s 但 deck.schema.json=%s' % (code, doc))
        fails += 1
    else:
        print('  [OK]   C. 单页元素上限两处一致（%s）' % code)

    if fails:
        print('  ⇒ %d 处问题' % fails)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
