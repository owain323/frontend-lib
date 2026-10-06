#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
release-gate.py — 发布契约门禁（工单 J4/J5/J6）

===========================================================================
🔴 为什么需要（外部评审 P0：版本管理是"发布事故"）
---------------------------------------------------------------------------
  评审发现仓库里同时存在：
      VERSION        = 0.3.0
      package.json   = 1.0.0
      仓库描述        = "34 契约 + 55 门禁"（数字早已过时）
      README         = "35 个契约 + 60 多道检查"

  ⭐ 对一个**把契约与门禁当核心卖点**的库，这是反例 ——
     它最重要的品牌信任是「我说什么，系统就是什么」。

===========================================================================
判据
---------------------------------------------------------------------------
  ① VERSION 文件 == package.json.version == CHANGELOG 最新版本
  ② repository.url 指向真实仓库（不是 example.invalid）
  ③ LICENSE 文件**真实存在**且 package.json 声明与它一致
  ④ package.json 的 files 里列出的路径**都真实存在**
  ⑤ 描述里**不含过时的数字**（"N 契约 + M 门禁"这种会漂移的说法）
===========================================================================
"""
import sys
import os
import io
import json
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_json(name):
    p = os.path.join(ROOT, name)
    if not os.path.isfile(p):
        return None
    try:
        return json.load(io.open(p, encoding='utf-8'))
    except Exception:
        return None


def read_text(name):
    p = os.path.join(ROOT, name)
    if not os.path.isfile(p):
        return None
    return io.open(p, encoding='utf-8', errors='replace').read()


def main():
    print('  === 发布契约门禁 ===')
    print('')
    bad = 0

    pkg = read_json('package.json')
    if not pkg:
        print('  X package.json 读不到')
        return 1
    ver_text = read_text('VERSION')
    ver = (ver_text or '').strip()
    cl = read_text('CHANGELOG.md') or ''

    # ---------- ① 版本三处一致 ----------
    print('  [1] 版本一致性')
    if not ver:
        print('      X VERSION 文件不存在')
        bad += 1
    else:
        print('      VERSION        = %s' % ver)
        print('      package.json   = %s' % pkg.get('version'))
        m = re.search(r'##\s*\[?v?(\d+\.\d+\.\d+)\]?', cl)
        cl_ver = m.group(1) if m else '(未找到)'
        print('      CHANGELOG      = %s' % cl_ver)
        if pkg.get('version') != ver:
            print('      X package.json 与 VERSION 不一致')
            bad += 1
        if cl_ver != '(未找到)' and cl_ver != ver:
            print('      X CHANGELOG 最新版与 VERSION 不一致')
            bad += 1
        if cl_ver == '(未找到)' and cl:
            print('      ! CHANGELOG 里没识别到版本号（格式可能变了）')

    # ---------- ② repository ----------
    print('  [2] repository')
    repo = pkg.get('repository') or {}
    url = repo.get('url', '') if isinstance(repo, dict) else str(repo)
    if not url:
        print('      X repository.url 缺失')
        bad += 1
    elif 'example.invalid' in url or 'example.com' in url:
        print('      X repository.url 仍是占位地址：%s' % url)
        bad += 1
    else:
        print('      OK %s' % url[:64])

    # ---------- ③ LICENSE ----------
    print('  [3] LICENSE')
    lic = read_text('LICENSE')
    declared = (pkg.get('license') or '').upper()
    if not lic:
        print('      X LICENSE 文件不存在（但 package.json 声明 %s）' % declared)
        bad += 1
    else:
        first = lic.strip().split('\n')[0][:40]
        print('      OK 文件存在 · package.json 声明 %s' % declared)
        if declared and declared not in lic.upper()[:400]:
            print('      ! LICENSE 正文与声明的类型可能不一致（%s）' % declared)

    # ---------- ④ files 路径都存在 ----------
    print('  [4] package.json files')
    files = pkg.get('files') or []
    missing = [f for f in files
               if not os.path.exists(os.path.join(ROOT, f.rstrip('/')))]
    if missing:
        print('      X files 里列了但**实际不存在**：%s' % ', '.join(missing))
        bad += 1
    else:
        print('      OK %d 项全部存在' % len(files))

    # ---------- ⑤ 描述里没有会漂移的数字 ----------
    print('  [5] 描述不含漂移数字')
    desc = pkg.get('description') or ''
    risky = re.findall(r'\d+\s*(?:契约|门禁|道门禁|checks?|contracts?)', desc)
    if risky:
        print('      X 描述里含会漂移的计数：%s' % ', '.join(risky))
        print('        （数字会过时，评审点名批评过）')
        bad += 1
    else:
        print('      OK %s' % (desc[:52] or '(空)'))


    # ---------- ⑥ main 不得指向类型定义 ----------
    print('  [6] 入口契约')
    if pkg.get('main'):
        m = pkg['main']
        if m.endswith('.d.ts') or m.endswith('.ts'):
            print('      X main 指向类型定义：%s' % m)
            print('        运行时 require() 会拿到 .d.ts，导入即失败')
            bad += 1
        elif not os.path.isfile(os.path.join(ROOT, m)):
            print('      X main 指向的文件不存在：%s' % m)
            bad += 1
        else:
            print('      OK main = %s' % m)
    else:
        print('      OK 无 main（本库无 JS 运行时入口，行为走 script 标签）')

    # ---------- ⑦ exports 里的路径都真实存在 ----------
    ex = pkg.get('exports') or {}
    ex_bad = []
    for k, v in ex.items():
        if v.endswith('*') or k.endswith('.json'):
            continue          # 通配与元数据跳过
        if not os.path.isfile(os.path.join(ROOT, v.lstrip('./'))):
            ex_bad.append('%s -> %s' % (k, v))
    if ex_bad:
        print('      X exports 指向不存在的文件：%s' % ', '.join(ex_bad[:3]))
        bad += 1
    else:
        print('      OK exports %d 条路径有效' % len(ex))

    # ---------- ⑧ devDependencies 存在（可复现）----------
    dev = pkg.get('devDependencies') or {}
    lock = [f for f in ('package-lock.json', 'pnpm-lock.yaml', 'yarn.lock')
            if os.path.isfile(os.path.join(ROOT, f))]
    if not dev:
        print('      ! devDependencies 为空 ⇒ 陌生开发者无法复现门禁环境')
    elif not lock:
        print('      ! 有 devDependencies 但**缺锁文件** ⇒ 版本会漂移')
    else:
        print('      OK devDependencies %d 项 + %s' % (len(dev), lock[0]))
    print('')
    if bad:
        print('  => 有 %d 项发布契约未闭环' % bad)
        return 1
    print('  OK 发布契约闭环')
    return 0


if __name__ == '__main__':
    sys.exit(main())
