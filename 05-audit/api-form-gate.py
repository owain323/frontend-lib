#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
api-form-gate.py — API.md 的「接入形态」必须与实现一致（任务 W5）

===========================================================================
🔴 它抓什么
---------------------------------------------------------------------------
  API.md 曾写「所有行为脚本遵循 `<组件名>.create(root, options)`」，
  但实测 18 个全局里：
      create形态 5 个 · attach 2 个 · **construct 2 个** · direct 9 个
  ⇒ 按 create 写其余 13 个，会直接报 TypeError。

  更隐蔽的是：表格里 `Accordion` 写 `attach`、
  `Drawer` 写 `create`、`Bar` 写 `create` —— **全是错的**，
  而旧门禁只比对"名字有没有出现"，一律通过。

===========================================================================
判据
---------------------------------------------------------------------------
  1. 跑 global-api-probe.js，在真浏览器里取每个全局的真实形态
  2. 解析 API.md 表格的「形态」列
  3. 双向比对：
       · 形态不符            → 🔴 使用者会照着错的写法调
       · 成员列表不符        → 🔴 写了不存在的成员
       · 文档漏了整个全局    → 🔴 使用者根本不知道它存在
===========================================================================
"""
import io
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_DOC = os.path.join(ROOT, 'API.md')
PROBER = os.path.join(ROOT, '05-audit', 'global-api-probe.js')

# API.md 的形态列用词 → probe.js 的 form 值
FORM_ALIASES = {
    'create': 'create',
    'attach': 'attach',
    'construct': 'construct',
    'direct': 'direct',     # probe 已按成员名细分，不再统一叫 namespace
}

# 表格里形态列可能出现的位置：`| Name | ✅ | create | members |`
ROW_RE = re.compile(
    r'^\|\s*`([A-Za-z]\w*)`\s*\|[^|]*\|\s*\*{0,2}([a-z]+)\*{0,2}\s*\|([^|]*)\|',
    re.M)


def probe_forms():
    """走公共 helper：自动确保 :8000 在跑，失败时给出可操作的提示。"""
    import _probe
    return _probe.run_probe('05-audit/global-api-probe.js')


def parse_doc_rows():
    """从 API.md 表格取 (全局名, 形态词, 成员串)。"""
    if not os.path.isfile(API_DOC):
        return None
    txt = io.open(API_DOC, encoding='utf-8').read()
    rows = {}
    for m in ROW_RE.finditer(txt):
        name, form, members = m.group(1), m.group(2), m.group(3)
        rows[name] = (form, members)
    return rows


def members_from_cell(cell):
    """从成员单元格里取出反引号包着的成员名。"""
    return set(re.findall(r'`([A-Za-z_$][\w$]*)`', cell))


def main():
    print('  === API 接入形态一致性（任务 W5）===')
    print('')

    rt = probe_forms()
    if not rt:
        print('  FAIL  拿不到运行时形态')
        print('        ⇒ 脚本已自动尝试起服务仍失败。检查：')
        print('          ·8000 端口是否被别的程序占着')
        print('          ·  05-audit/browser.js 能否找到浏览器')
        return 1

    rows = parse_doc_rows()
    if not rows:
        print('  FAIL  API.md 里没解析到表格行—— 格式变了？')
        return 1

    bad = []

    for name, (form_word, cell) in sorted(rows.items()):
        actual = rt.get(name)
        if not actual or actual.get('absent') or actual.get('error'):
            bad.append((name, '文档列了但实现里找不到', form_word, '-'))
            continue

        real_form = actual.get('form')
        want = FORM_ALIASES.get(form_word)
        if want is None:
            bad.append((name, '形态列写了他看不懂的词',
                        form_word, real_form))
            continue

        ok = (real_form == want)

        if not ok:
            bad.append((name, '形态不符', form_word, real_form))
            continue

        # 成员列表核对（只查有写成员的行）
        claimed = members_from_cell(cell)
        if not claimed:
            continue
        real_members = set(actual.get('members', {}))
        # construct 形态的成员在原型上，用实例方法比
        if real_form == 'construct':
            real_members |= set(actual.get('protoMethods', {}))
        missing = claimed - real_members
        if missing:
            bad.append((name, '文档写了实现没有的成员',
                        ', '.join(sorted(missing)),
                        ', '.join(sorted(real_members))))

    # 实现里有、文档里完全没提的
    documented = set(rows)
    undocumented = sorted(k for k, v in rt.items()
                          if not v.get('absent') and not v.get('error')
                          and k not in documented)

    if bad:
        print('  🔴 API.md 的接入形态与实现不符：')
        for name, why, doc_v, rt_v in bad:
            print('     %-14s %s' % (name, why))
            print('       文档=%s  实现=%s' % (doc_v, rt_v))
        print('')
        print('     ⇒ 使用者会照着错的写法调用，直接 TypeError。')

    if undocumented:
        print('')
        print('  ⚠️ 实现里有但 API.md 未列出（使用者可能不知道）：')
        for n in undocumented:
            print('     %s（%s）' % (n, ', '.join(sorted(
                rt[n].get('members', {}))) or '无静态成员'))

    if bad:
        return 1

    n_by_form = {}
    for name in rows:
        f = FORM_ALIASES.get(rows[name][0], rows[name][0])
        n_by_form[f] = n_by_form.get(f, 0) + 1
    print('')
    print('  ⇒ 形态一致（%s）'
          % ' · '.join('%s %d' % (k, v) for k, v in sorted(n_by_form.items())))
    return 0


if __name__ == '__main__':
    sys.exit(main())