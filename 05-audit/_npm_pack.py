#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
_npm_pack.py — `npm pack --dry-run --json` 输出的**唯一**读法。

===========================================================================
🔴 为什么要它（2026-11-06，v0.27.0 发布现场）
---------------------------------------------------------------------------
npm 12 在 CI 上把清单之外的东西也写进了 stdout（版本提示一类）。于是三处
解析**同时**炸，而且炸法不同：

    pack-hygiene   json.loads(整个 stdout)              → Extra data
    pkg-resolve    json.loads(stdout[第一个 '[':])       → Extra data
    pack-closure   JSON.parse(stdout)                   → 读不出 ⇒ 降级"未判定"

前两条报红还算好；**第三条最危险**：它不计失败、只记一行 SKIP，
在一屏 PASS 里几乎看不见 —— 等于发布时少跑了一道闭包检查。

⇒ 结论不是"npm 有 bug"，而是我们假设了「stdout 里只有一个 JSON」。
   npm 只承诺 `--json` 会给出 JSON，**没承诺它是 stdout 的全部**。
   所以：从文本里**找**清单，并且按**结构**认，不按位置认。

===========================================================================
用法
---------------------------------------------------------------------------
    from _npm_pack import run, extract
    manifest, err = run(ROOT)          # manifest = [{'files': [...], ...}]
    manifest, err = extract(stdout)    # 已有文本时

    python3 05-audit/_npm_pack.py      # 自检（四种形态）
"""
import json
import os
import subprocess
import sys

NPM = 'npm.cmd' if os.name == 'nt' else 'npm'

_DEC = json.JSONDecoder()

#: 扫描上限。正常输出里 '[' 出现次数是个位数；设上限只为避免病态输入 O(n²)。
_MAX_CANDIDATES = 64


def _as_manifest(value):
    """把一段 JSON 认成"npm pack 清单"，认不出返回 None。

    只认两种形状：
      · [{'files': [...]}, ...]   —— npm 的 normal 输出
      · {'files': [...]}          —— 理论上不会出现，但认了不亏
    判据是**结构**（有 files 数组），不是"它正好在开头"。
    """
    if isinstance(value, list):
        if not value:
            return None
        first = value[0]
        if isinstance(first, dict) and isinstance(first.get('files'), list):
            return value
        return None
    if isinstance(value, dict) and isinstance(value.get('files'), list):
        return [value]
    return None


def _diagnose(text):
    """读不出清单时，把有用的东西一次说清 —— 下次不用再猜。"""
    head = (text or '')[:160].replace('\n', '\\n')
    tail = (text or '')[-160:].replace('\n', '\\n')
    return ('npm 输出里找不到 pack 清单（%d 字节）。开头：%s ｜ 结尾：%s'
            % (len(text or ''), head, tail))


def extract(text):
    """从任意文本里找出 pack 清单。→ (manifest, error)。"""
    if not text or not text.strip():
        return None, 'npm pack 没有任何输出'

    pos = 0
    tries = 0
    while tries < _MAX_CANDIDATES:
        starts = [p for p in (text.find('[', pos), text.find('{', pos)) if p >= 0]
        if not starts:
            break
        at = min(starts)
        try:
            value, _end = _DEC.raw_decode(text, at)
        except ValueError:
            pos = at + 1
            continue
        got = _as_manifest(value)
        if got is not None:
            return got, None
        tries += 1
        pos = at + 1

    return None, _diagnose(text)


def run(root, timeout=180, ignore_scripts=True):
    """跑一次干包并把清单读出来。→ (manifest, error)。"""
    cmd = [NPM, 'pack', '--dry-run', '--json']
    if ignore_scripts:
        cmd.append('--ignore-scripts')
    try:
        r = subprocess.run(cmd, cwd=root, capture_output=True, text=True,
                           timeout=timeout, shell=False)
    except Exception as exc:                                   # noqa: BLE001
        return None, 'npm pack 执行失败：%s' % exc
    if r.returncode != 0:
        return None, 'npm pack 返回 %d：%s' % (
            r.returncode, (r.stderr or '').strip()[:300])
    return extract(r.stdout)


def _selftest():
    """四种形态：干净 / 前面有噪音 / 后面有噪音 / 两个数组。"""
    good = [{'name': 'x', 'files': [{'path': 'a.md', 'size': 1}]}]
    payload = json.dumps(good, indent=2, ensure_ascii=False)

    cases = [
        ('干净输出', payload, True),
        ('前面有 npm notice', 'npm notice New version!\n' + payload, True),
        ('后面有提示', payload + '\nnpm notice done\n', True),
        ('前后都有', 'npm warn [deprecated] x\n' + payload + '\nadded 1 package\n', True),
        ('两个数组，第二个才是清单',
         '[1,2,3]\n' + payload, True),
        ('空输出', '', False),
        ('完全不是 JSON', 'hello world', False),
        ('只有空数组', '[]', False),
    ]
    bad = 0
    for name, text, want in cases:
        got, err = extract(text)
        ok = (got is not None) == want
        if ok and want:
            ok = got[0]['files'][0]['path'] == 'a.md'
        print('  %-4s %s' % ('OK' if ok else 'X', name))
        if not ok:
            bad += 1
            print('       err=%s' % err)
    print('  %d/%d' % (len(cases) - bad, len(cases)))
    return 1 if bad else 0


if __name__ == '__main__':
    # `selftest-all.py` 按「调用点里有 `--selftest`」发现脚本，只认字面量不认注释。
    if '--selftest' in sys.argv or len(sys.argv) == 1:
        sys.exit(_selftest())
    print('用法：python3 05-audit/_npm_pack.py [--selftest]')
    sys.exit(2)
