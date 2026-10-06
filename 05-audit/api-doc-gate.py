#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
api-doc-gate.py — API 文档与实现的一致性门禁

===========================================================================
🔴 为什么需要（K4：Public API 必须有正式定义，且必须与实现一致）
---------------------------------------------------------------------------
  `.btn`、`data-select-btn` 这些名字一旦发布，事实上就是 API。
  如果文档与代码分叉，比没有文档更糟 —— **文档会骗人**。

  ⭐ 本门禁做两件事：
    ① 从源码提取实际挂载到全局的对象
    ② 与 API.md 里声明的比对，任一方向不一致即失败
===========================================================================
"""
import sys
import os
import io
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_DOC = os.path.join(ROOT, 'API.md')


def declared():
    """API.md 里声明的全局对象（表格里的 `X` 与 `window.X` 都算）"""
    if not os.path.isfile(API_DOC):
        return None
    txt = io.open(API_DOC, encoding='utf-8').read()
    names = set(re.findall(r'window\.(\w+)', txt))
    # 表格第一列的反引号内容
    for m in re.finditer(r'^\|\s*`([A-Za-z]\w*)`\s*\|', txt, re.M):
        names.add(m.group(1))
    return names


def implemented():
    """源码里实际挂载的全局对象"""
    out = subprocess.run(['git', '-c', 'core.quotePath=false', 'ls-files'],
                         cwd=ROOT, capture_output=True, timeout=30)
    files = [f for f in out.stdout.decode('utf-8', 'replace').split('\n')
             if f.strip()]
    found = set()
    for rel in files:
        if not rel.endswith('.js') or rel.startswith('05-audit/'):
            continue
        try:
            s = io.open(os.path.join(ROOT, rel), encoding='utf-8',
                        errors='replace').read()
        except Exception:
            continue
        # ⚠️ 两种挂载写法都要认：
        #    global.X = { ... }   （IIFE 内部）
        #    window.X = X         （挂到 window 上的对象）
        for m in re.findall(r'global\.(\w+)\s*=', s):
            found.add(m)
        for m in re.findall(r'window\.(\w+)\s*=\s*\w+\s*;', s):
            found.add(m)
    return found


def main():
    print('  === API 文档一致性（K4）===')
    print('')
    d = declared()
    if d is None:
        print('  X 找不到 API.md —— 公开库必须有一份正式的 API 契约')
        return 1
    impl = implemented()

    print('  实现里挂载的全局对象：%d 个' % len(impl))
    print('  API.md 声明的：%d 个' % len(d))

    bad = 0
    missing = sorted(impl - d)      # 有实现但没写进文档 ⇒ 使用者不知道
    extra = sorted(d - impl)        # 文档写了但没实现 ⇒ 使用者用了发现没有
    if missing:
        print('  X 实现里有、文档没写：%s' % ', '.join(missing))
        print('    ⇒ 使用者不知道它们存在，等于没有')
        bad += 1
    if extra:
        print('  X 文档写了、实现没有：%s' % ', '.join(extra))
        print('    ⇒ 比没有文档更糟：文档会骗人')
        bad += 1

    print('')
    if bad:
        print('  => 文档与实现有 %d 处分叉' % bad)
        return 1
    print('  OK 文档与实现一致（%d 个公开对象）' % len(impl))
    return 0


if __name__ == '__main__':
    sys.exit(main())
