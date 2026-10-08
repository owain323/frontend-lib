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
  4. `ai/components.json` 里声明的 `global`，必须是**浏览器里真探到**的全局

===========================================================================
判据 4 是怎么来的（一次真事故，不是推演）
---------------------------------------------------------------------------
  生成器用 `window\.([A-Z]\w*)\s*=` 抽组件暴露的全局名。
  注入 emit 核之后，核里有 `typeof window.CustomEvent === 'function'`
  ⇒ `===` 的**第一个** `=` 被当成赋值 ⇒ **10 个组件的 global 全变成
  `CustomEvent`**。

  ⚠️ 最恶劣的地方：这道事故**没有让任何门禁变红**。
     · 生成器重跑一次 ⇒ 契约与"源码"一致 ⇒ `ai-contract` 门禁绿
     · API.md 那张表是**另一套**判据（浏览器实测），它没看 components.json
  ⇒ 契约文件悄悄变成错的，而报告全绿。

  ⇒ 判据 4 把 components.json 挂到**浏览器实测**这根桩上：
     `CustomEvent` 不在探测名单里 ⇒ 立刻红。
===========================================================================
"""
import io
import json
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


def load_contract_globals():
    """ai/components.json 里每个组件声明的 global。"""
    p = os.path.join(ROOT, 'ai', 'components.json')
    if not os.path.isfile(p):
        return None
    try:
        data = json.load(io.open(p, encoding='utf-8'))
    except Exception:
        return None
    return [(c.get('id'), c.get('global')) for c in data.get('components', [])]


def check_globals(decls, rt):
    """判据 4：声明的 global 必须是浏览器里真探到的全局。

    ⚠️ 纯函数（不读文件、不起浏览器）⇒ 反向控制可以直接喂合成数据，
       不必真去改仓库里的契约文件。
    """
    bad = []
    for cid, g in decls or []:
        if not g:
            continue          # 纯 CSS 组件没有全局，不算问题
        a = rt.get(g)
        if not a or a.get('absent') or a.get('error'):
            bad.append((cid, g))
    return bad


def selftest():
    """判据 4 的反向控制：该红的必须红，该绿的必须绿。"""
    print('  === api-form · 契约 global 反向控制 ===')
    rt = {'Select': {'form': 'create'}, 'Tabs': {'form': 'construct'},
          'Toast': {'absent': True}}
    ok = True

    # ① 全对 ⇒ 不许报
    good = [('select', 'Select'), ('tabs', 'Tabs'), ('card', None)]
    if check_globals(good, rt):
        print('  [FAIL] 声明都对却报了问题 ⇒ 判据过严')
        ok = False
    else:
        print('  [OK]   声明都对 ⇒ 不报（含纯 CSS 组件的 null）')

    # ② 事故真值：global 被抽成 CustomEvent ⇒ 必须红
    if not check_globals([('accordion', 'CustomEvent')], rt):
        print('  [FAIL] global=CustomEvent 没被抓到 ⇒ 门禁是瞎的')
        ok = False
    else:
        print('  [OK]   global=CustomEvent ⇒ 抓到（0.7.1 那次事故的真值）')

    # ③ 全局名不在探测名单里（典型成因：把**组件 id** 当成全局名，
    #    `select` 而不是 `Select`）⇒ 必须红
    if not check_globals([('select', 'select')], rt):
        print('  [FAIL] 不在探测名单里的全局名没被抓到 ⇒ 门禁是瞎的')
        ok = False
    else:
        print('  [OK]   不在探测名单里的全局名 ⇒ 抓到')

    # ④ 声明了但页面里 absent ⇒ 必须红
    if not check_globals([('overlay', 'Toast')], rt):
        print('  [FAIL] 页面里 absent 的全局没被抓到 ⇒ 门禁是瞎的')
        ok = False
    else:
        print('  [OK]   页面里 absent 的全局 ⇒ 抓到')

    return 0 if ok else 1


def main():
    if '--selftest' in sys.argv:
        return selftest()

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

    # 判据 4：ai/components.json 声明的 global 必须是浏览器里真探到的
    decls = load_contract_globals()
    if decls is None:
        print('  FAIL  读不到 ai/components.json')
        return 1
    bad_globals = check_globals(decls, rt)
    if bad_globals:
        print('')
        print('  🔴 ai/components.json 声明了浏览器里不存在的 global：')
        for cid, g in bad_globals:
            print('     %-14s global=%s' % (cid, g))
        print('')
        print('     ⇒ 多半是「契约生成器的正则抓错了东西」（例如把 `===` 的')
        print('       第一个 `=` 当成赋值）。这是**静默**的错：重跑生成器')
        print('       会让契约与源码"一致"，于是没人发现它已经是错的。')

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

    if bad or bad_globals:
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