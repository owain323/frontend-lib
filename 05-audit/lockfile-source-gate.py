#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
lockfile-source-gate.py — `npm ci` 到底从哪台服务器下载依赖

============================================================================
🔴 为什么这道门禁存在（2026-11-04 再探发现）
----------------------------------------------------------------------------
`.npmrc` 把 registry 钉在官方源，注释里还写着
「本仓的 package-lock.json 里所有 resolved 早就指向官方源」。
实测：92 个 resolved 里有 **1 个** 仍是

    "node_modules/yaml": { "resolved": "https://registry.npmmirror.com/yaml/-/..." }

这是 0.7.9 那次「91 处 npmmirror → npmjs」替换漏掉的一条，一直躺了 N 个版本。
`npm ci` 按 **lockfile 的 resolved 直取**，不看 `.npmrc` 的 registry ⇒
这一条依赖绕开官方源，而所有既有门禁都没有读过 lockfile 的内容：
`repo-hygiene.py` 只把 `.npmrc` 列进根目录白名单，判的是「文件在不在」，
不是「里面写了什么」。

⇒ 这不是"文档写错"而已：它是供应链面上一个**无人看守的入口**。
  修掉那一行只是把当前状态改对，这道门禁才是防止第 2 条悄悄回来的东西。

判据（每条都要能红）
----------------------------------------------------------------------------
  ① 零视野：一个 resolved 都没有 ⇒ 红（不是"通过"，是没检查）
  ② 每个 resolved 必须是 https
  ③ 每个 resolved 的 host 必须在官方源白名单里
  ④ 有 resolved 就必须有 integrity（否则换源也校验不了内容）
  ⑤ 文件不存在 / JSON 坏 / packages 为空 ⇒ 红，不许跳过

⚠️ 没有 resolved 的条目（根包、link/workspace 包）**合法跳过**，
   它们不产生下载动作。但整份 lock 一个都没有时判红（①）。

反向控制：`--selftest` 喂合成 packages，每条判据各有一个反例，
   并用元反向证明「非官方源」那条红确实来自白名单，不是别处顺手报的。
"""

import io
import json
import os
import sys
from collections import Counter
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCK = os.path.join(ROOT, 'package-lock.json')

# 唯一真值：发布源与下载源必须是同一个。要加第二个源，得先说服这道门禁。
ALLOWED_HOSTS = frozenset({'registry.npmjs.org'})


def violations(packages, allowed=ALLOWED_HOSTS):
    """纯函数：喂合成 packages 就能验判据有没有牙（见 selftest）。"""
    errs = []
    seen = 0
    for key in sorted(packages):
        meta = packages[key] or {}
        url = meta.get('resolved')
        if not url:
            continue                      # 根包 / link 包：不下载，合法
        seen += 1
        u = urlparse(url)
        if u.scheme != 'https':
            errs.append('%s：不是 https：%s' % (key, url))
        if u.hostname not in allowed:
            errs.append('%s：解析到非官方源（%s）：%s' % (key, u.hostname, url))
        if not meta.get('integrity'):
            errs.append('%s：有 resolved 却没有 integrity ⇒ 换源也校验不了内容' % key)
    if seen == 0:
        errs.append('零视野：package-lock.json 里一个 resolved 都没有 ⇒ 什么都没检查')
    return errs


def load():
    """返回 (packages, errs)。失败一律带错，不许静默跳过。"""
    if not os.path.isfile(LOCK):
        return None, ['找不到 package-lock.json ⇒ 不是"通过"，是没检查']
    try:
        data = json.load(io.open(LOCK, encoding='utf-8'))
    except Exception as exc:                                  # noqa: BLE001
        return None, ['package-lock.json 解析失败：%s' % exc]
    pkgs = data.get('packages')
    if not isinstance(pkgs, dict) or not pkgs:
        return None, ['lockfileVersion 3 需要非空 packages ⇒ 视野为空，判红']
    return pkgs, []


def main():
    pkgs, errs = load()
    if errs:
        for e in errs:
            print('  [FAIL] ' + e)
        return 1
    hosts = Counter(
        urlparse(m['resolved']).hostname
        for m in pkgs.values() if m and m.get('resolved'))
    print('  锁文件：%d 个 resolved 条目 · 源 %s'
          % (sum(hosts.values()), dict(hosts)))
    errs = violations(pkgs)
    if errs:
        for e in errs:
            print('  [FAIL] ' + e)
        print('  [FAIL] %d 处不满足' % len(errs))
        return 1
    print('  [OK] 全部指向官方源、https、且都有 integrity')
    return 0


def selftest():
    bad = 0

    def report(ok, label, extra=''):
        nonlocal bad
        print('  [%s] %s%s' % ('OK  ' if ok else 'FAIL', label,
                               '  ' + extra if extra else ''))
        if not ok:
            bad += 1

    good = {
        '': {'name': 'agentcss'},                       # 根包无 resolved，合法
        'node_modules/a': {
            'resolved': 'https://registry.npmjs.org/a/-/a-1.0.0.tgz',
            'integrity': 'sha512-AAAA'},
        'node_modules/link': {'link': True},            # link 包，合法
    }
    report(violations(good) == [], '全官方 + 根包/link 包 ⇒ 绿')

    mirror = dict(good)
    mirror['node_modules/yaml'] = {
        'resolved': 'https://registry.npmmirror.com/yaml/-/yaml-2.9.1.tgz',
        'integrity': 'sha512-BBBB'}
    e_mirror = violations(mirror)
    report(any('非官方源' in e and 'node_modules/yaml' in e for e in e_mirror),
           '混入 npmmirror ⇒ 红并点名', '; '.join(e_mirror))

    plain = dict(good)
    plain['node_modules/h'] = {
        'resolved': 'http://registry.npmjs.org/h/-/h-1.0.0.tgz',
        'integrity': 'sha512-CCCC'}
    report(any('不是 https' in e for e in violations(plain)), 'http 明文 ⇒ 红')

    nointeg = dict(good)
    nointeg['node_modules/n'] = {
        'resolved': 'https://registry.npmjs.org/n/-/n-1.0.0.tgz'}
    report(any('integrity' in e for e in violations(nointeg)), '缺 integrity ⇒ 红')

    report(any('零视野' in e for e in violations({})), '空 packages ⇒ 红')
    report(any('零视野' in e for e in violations({'x': {'link': True}})),
           '全是 link 包（0 个 resolved）⇒ 红')

    # 元反向：白名单里放进 npmmirror，同一份坏样本必须不再红
    # —— 证明上面那条红来自"源白名单"，不是别处顺手报的。
    report(violations(mirror, ALLOWED_HOSTS | {'registry.npmmirror.com'}) == [],
           '元反向：白名单加入该源 ⇒ 同一坏样本不再红')

    # 真实文件也必须绿（自检不能只在合成数据上成立）
    real, errs = load()
    report(not errs and real is not None and violations(real) == [],
           '真实 package-lock.json ⇒ 绿')

    print('  ' + ('✅ 反向控制全绿' if not bad else '❌ %d 条没通过' % bad))
    return 1 if bad else 0


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(main())
