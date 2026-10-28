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
  5. **源码注释里承诺的 API 必须真实存在**：
     `<全局>.<方法>(` 以及 `var x = <全局>.create(...)` 之后的 `x.<方法>(`

===========================================================================
判据 5 是怎么来的（又一个「承诺了不存在的接口」）
---------------------------------------------------------------------------
  pagination.js 的文件头用法示例写着：

      var pg = Pagination.create(...);
      pg.on('change', fn);        // ← `on` 从来没实现过

  而 `Pagination` 上只有 `create` / `update` / `pagesOf`。
  照抄这段的人会在运行时拿到 `pg.on is not a function`。

  ⚠️ 它就是 `is-*` 状态类那次事故的同一形态（0.4.0）：
     **文档/注释说有，实现里没有**，而没有任何门禁在比对这两者。
     区别只是上次在 API.md，这次在源码注释。

  ⇒ 判据 5 把注释里的「用法示例」也挂到浏览器实测这根桩上。
     识别实例别名（`pg` ⇒ `Pagination`）是必需的，不然抓不到这一例。

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
    """ai/components.json 里每个组件声明的 global（含同目录的 globalAlso）。"""
    p = os.path.join(ROOT, 'ai', 'components.json')
    if not os.path.isfile(p):
        return None
    try:
        data = json.load(io.open(p, encoding='utf-8'))
    except Exception:
        return None
    out = []
    for c in data.get('components', []):
        out.append((c.get('id'), c.get('global')))
        for extra in c.get('globalAlso') or []:
            out.append((c.get('id') + '+', extra.get('global')))
    return out


def probe_targets():
    """探针表里登记了哪些全局（从探针源码里读，保证与真表同源）。

    🔴 为什么要专门读一次：探针表是**硬编码**的。新加一个全局却不登记，
       浏览器里根本没人去查它 ⇒ 判据 4 只会报「声明了不存在的全局」，
       而人看到这句话的第一反应是"契约生成器坏了"，不是"探针漏登记"。
       那种误导性的红，最后往往被"改契约"糊过去 —— 拿真实信息换绿灯。
    """
    p = os.path.join(ROOT, '05-audit', 'global-api-probe.js')
    if not os.path.isfile(p):
        return set()
    raw = io.open(p, encoding='utf-8').read()
    return set(re.findall(r"^\s*([A-Z][A-Za-z0-9]*)\s*:\s*'", raw, re.M))


def real_members_of(actual):
    """实现里**真的存在**的成员集合。

    ⚠️ 一个实例能调的方法都在原型上，与它是 `create` 出来的还是 `attach`
       出来的**无关**。旧版只在 `form == 'construct'` 时才并入 `protoMethods`，
       于是 `Nav`（attach 形态，实例方法 open/close/isOpen/destroy 都在原型上）
       被报成「文档写了实现没有的成员」—— 那是**量具**的错，不是文档的错。
       受影响的面：凡 create / attach 返回实例、且文档提到实例方法的组件，
       旧判据必然假红。假红比不查更坏：它会教人「改文档」来换绿灯。
    """
    out = set(actual.get('members') or {})
    if (actual.get('form') or '') in ('construct', 'attach', 'create'):
        out |= set(actual.get('protoMethods') or {})
    return out


def check_members(name, claimed, actual):
    """纯函数：文档声称的成员是否都存在。返回问题元组或 None。"""
    claimed = set(claimed or [])
    if not claimed:
        return None
    real = real_members_of(actual)
    missing = claimed - real
    if missing:
        return (name, '文档写了实现没有的成员',
                ', '.join(sorted(missing)), ', '.join(sorted(real)))
    return None


def check_globals(decls, rt, targets=None):
    """判据 4：声明的 global 必须是浏览器里真探到的全局。

    `targets` 给了就同时查第二件事：**探针表登记过它没有**。
    两件事的红必须分开报 —— 前者是实现/契约的问题，后者是量具的问题。
    混在一句话里，修的人就分不清该改代码还是该改探针。

    ⚠️ 纯函数（不读文件、不起浏览器）⇒ 反向控制可以直接喂合成数据，
       不必真去改仓库里的契约文件。
    """
    bad = []
    for cid, g in decls or []:
        if not g:
            continue          # 纯 CSS 组件没有全局，不算问题
        if targets is not None and g not in targets:
            bad.append((cid, g, 'probe-missing'))
            continue
        a = rt.get(g)
        if not a or a.get('absent') or a.get('error'):
            bad.append((cid, g, 'absent'))
    return bad


def js_comments(text):
    """取出 JS 里所有注释（块注释 + 行注释）。只用于**看注释里写了什么**。"""
    out = []
    i, n = 0, len(text)
    while i < n:
        if text[i:i + 2] == '/*':
            e = text.find('*/', i + 2)
            e = n if e < 0 else e
            out.append(text[i:e])
            i = e + 2
        elif text[i:i + 2] == '//':
            e = text.find('\n', i)
            e = n if e < 0 else e
            out.append(text[i:e])
            i = e
        else:
            i += 1
    return '\n'.join(out)


def promises_in(rel, raw, known_globals):
    """单个文件里，注释承诺了哪些 `<全局>.<方法>()` / `<实例>.<方法>()`。

    返回 [(相对路径, 全局名, 方法名, 是否经别名)]。

    ⚠️ 为什么要认别名：真实那一例是 `var pg = Pagination.create(...)`
       然后写 `pg.on(...)`。只认 `Pagination.on(` 这条判据当场失效
       —— 而它恰恰是为这一例才存在的。

    ⚠️ 纯函数（不读文件）⇒ 反向控制可以喂合成文本，不必改真仓库。
    """
    if not known_globals:
        return []
    alt = '|'.join(sorted(known_globals, key=len, reverse=True))
    re_alias = re.compile(r'\bvar\s+(\w+)\s*=\s*(%s)\s*\.' % alt)
    re_direct = re.compile(r'\b(%s)\.(\w+)\s*\(' % alt)
    out = []
    ctext = js_comments(raw)
    for m in re_direct.finditer(ctext):
        out.append((rel, m.group(1), m.group(2), False))
    aliases = {}
    for m in re_alias.finditer(raw):
        aliases.setdefault(m.group(1), m.group(2))
    for a, g in sorted(aliases.items()):
        for m in re.finditer(r'\b%s\.(\w+)\s*\(' % re.escape(a), ctext):
            out.append((rel, g, m.group(1), True))
    return out


def scan_comment_promises(known_globals):
    for d in ('02-primitives', '03-patterns'):
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            sub = os.path.join(base, name)
            if not os.path.isdir(sub):
                continue
            for f in sorted(os.listdir(sub)):
                if not f.endswith('.js'):
                    continue
                rel = '%s/%s/%s' % (d, name, f)
                raw = io.open(os.path.join(sub, f), encoding='utf-8').read()
                for item in promises_in(rel, raw, known_globals):
                    yield item


def check_comment_promises(promises, rt):
    """承诺的方法必须在浏览器实测的成员里（静态成员或原型方法）。"""
    bad = []
    for rel, g, method, via_alias in promises:
        a = rt.get(g)
        if not a or a.get('absent') or a.get('error'):
            bad.append((rel, g, method, '这个全局本身就没探到'))
            continue
        real = set(a.get('members', {})) | set(a.get('protoMethods', {}))
        if method not in real:
            bad.append((rel, g, method, '实测成员：' + ', '.join(sorted(real))))
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

    # ④b 探针表漏登记 ⇒ 必须红，且理由必须是 probe-missing（不能混成"探不到"）
    #     真事故（0.11.2）：加 nav.js 导出 `Nav` 后没人把它补进 TARGETS，
    #     门禁报的是"声明了浏览器里不存在的 global"，读起来像是契约生成器坏了。
    got = check_globals([('nav', 'Nav')], rt, {'Select', 'Tabs'})
    if not got or got[0][2] != 'probe-missing':
        print('  [FAIL] 探针表漏登记没被单独识别出来 ⇒ 两种红混成一种，修的人会改错地方')
        ok = False
    else:
        print('  [OK]   探针表漏登记 ⇒ 单独报 probe-missing')

    # ④c 探针表登记了、页面里也真有 ⇒ 不许报
    if check_globals([('nav', 'Select')], rt, {'Select', 'Nav'}):
        print('  [FAIL] 探针表登记且真探到却报了问题 ⇒ 判据过严')
        ok = False
    else:
        print('  [OK]   探针表登记且真探到 ⇒ 不报')

    # ⑤ 判据 5：注释里承诺的方法必须真实存在
    rt5 = {'Pagination': {'members': {'create': 'function',
                                      'update': 'function',
                                      'pagesOf': 'function'}},
           'Tabs': {'members': {}, 'protoMethods': {'select': 'function'}}}

    # ⑤-a 先验证**扫描器本身**（上面几条只验了判定函数，没验扫描器 ——
    #     第一版扫描器的别名正则用了非捕获组 ⇒ group(2) 直接 IndexError，
    #     而自检**没抓到**，因为它根本没跑扫描器。这是又一条"没跑到的判据"。）
    sample = ('/*\n * var pg = Pagination.create(el);\n'
              ' * pg.on(\'change\', fn);\n */\n'
              'var pg = Pagination.create(el);\npg.update(2);\n')
    got = promises_in('x.js', sample, ['Pagination'])
    # `create` 也在注释里（那句 `var pg = Pagination.create(el)`），
    # 所以命中两条才对 —— `create` 是**真存在**的，由判定函数放行。
    want = {('x.js', 'Pagination', 'create', False),
            ('x.js', 'Pagination', 'on', True)}
    if set(got) != want:
        print('  [FAIL] 扫描器抓不出 `pg.on`（或抓出了别的）⇒ %s' % (got,))
        ok = False
    else:
        print('  [OK]   扫描器抓得到别名形式 `pg.on`，且不放过实现里的同名调用')

    # ⑤-b 只扫注释：实现里 `pg.update(...)` 不该算"承诺"
    if promises_in('x.js', 'pg.update(2);\n', ['Pagination']):
        print('  [FAIL] 实现里的调用被当成注释承诺 ⇒ 判据会假红')
        ok = False
    else:
        print('  [OK]   只扫注释：实现里的同名调用不算承诺')
    good5 = [('x.js', 'Pagination', 'create', False),
             ('x.js', 'Tabs', 'select', True)]
    if check_comment_promises(good5, rt5):
        print('  [FAIL] 注释里承诺的方法都存在却报了问题 ⇒ 判据过严')
        ok = False
    else:
        print('  [OK]   注释里承诺的方法都存在 ⇒ 不报（含原型方法与别名）')

    # ⭐ 事故真值：pagination.js 文件头写过 `pg.on('change', ...)`
    bad5 = check_comment_promises([('p.js', 'Pagination', 'on', True)], rt5)
    if not bad5:
        print('  [FAIL] 注释里承诺的 `pg.on` 没被抓到 ⇒ 门禁是瞎的')
        ok = False
    else:
        print('  [OK]   注释里承诺的 `pg.on` ⇒ 抓到（本判据存在的理由）')

    # ⑥ 直接调用形式也不能漏
    if not check_comment_promises([('p.js', 'Pagination', 'nothing', False)],
                                  rt5):
        print('  [FAIL] 直接写 `Pagination.nothing(` 没被抓到 ⇒ 门禁是瞎的')
        ok = False
    else:
        print('  [OK]   直接写 `Pagination.nothing(` ⇒ 抓到')

    # ⑦ 成员核对：attach 形态的实例方法在原型上，必须算"实现里有"。
    #    ⚠️ 这是 0.11.2 的**假红真值**：Nav 加进 API.md 后，
    #       旧判据只在 construct 时并入 protoMethods ⇒ open/close/isOpen/destroy
    #       全被报成"文档写了实现没有的成员"。人看到这句就会去删文档。
    nav_rt = {'form': 'attach', 'members': {'attach': 'function'},
              'protoMethods': {'open': 'function', 'close': 'function'}}
    if check_members('Nav', ['attach', 'open', 'close'], nav_rt):
        print('  [FAIL] attach 形态的原型方法被当成"实现没有" ⇒ 量具假红')
        ok = False
    else:
        print('  [OK]   attach 形态的实例方法按原型算 ⇒ 不假红')

    # ⑧ 但"文档写了真不存在的实例方法"必须抓到
    #    —— `Nav.toggle` 就是这么被发现的：原型上只有 isOpen/open/close/destroy
    if not check_members('Nav', ['toggle'], nav_rt):
        print('  [FAIL] 文档写了不存在的实例方法没被抓到 ⇒ 门禁是瞎的')
        ok = False
    else:
        print('  [OK]   文档写了不存在的实例方法 ⇒ 抓到')

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
        p = check_members(name, claimed, actual)
        if p:
            bad.append(p)

    # 判据 4：ai/components.json 声明的 global 必须是浏览器里真探到的
    decls = load_contract_globals()
    if decls is None:
        print('  FAIL  读不到 ai/components.json')
        return 1
    bad_globals = check_globals(decls, rt, probe_targets())
    if bad_globals:
        print('')
        print('  🔴 ai/components.json 声明了浏览器里不存在的 global：')
        for item in bad_globals:
            cid, g = item[0], item[1]
            why = item[2] if len(item) > 2 else 'absent'
            tag = '（探针表没登记）' if why == 'probe-missing' else '（页面里探不到）'
            print('     %-14s global=%-16s %s' % (cid, g, tag))
        print('')
        if any(len(i) > 2 and i[2] == 'probe-missing' for i in bad_globals):
            print('     ⇒ 「探针表没登记」这类红**不是实现坏了**：')
            print('       `05-audit/global-api-probe.js` 的 TARGETS 是硬编码表，')
            print('       新全局不登记 ⇒ 浏览器里根本没人查它 ⇒ 会被误读成"契约坏了"。')
            print('       修法是把全局补进 TARGETS（选一个真的加载它的页面），')
            print('       **不是**把契约里的 global 删掉。')
            print('       （同一个坑已经在 shot-baseline 的 PAGES 上发生过一次。）')
        if any(len(i) <= 2 or i[2] == 'absent' for i in bad_globals):
            print('     ⇒ 「页面里探不到」这类红，先分清再改：')
            print('       ① 「契约生成器的正则抓错了东西」（例如把 `===` 的第一个 `=`')
            print('          当成赋值）—— 重跑生成器会让契约与源码"一致"，')
            print('          于是没人发现它已经是错的。')
            print('       ② 该组件真的没把全局挂到 window 上。')

    # 判据 5：源码注释里承诺的 API 必须真实存在
    promises = scan_comment_promises(list(rt.keys()))
    bad_promises = check_comment_promises(promises, rt)
    if bad_promises:
        print('')
        print('  🔴 源码注释里承诺了不存在的 API（照抄会 TypeError）：')
        for rel, g, method, why in bad_promises:
            print('     %s' % rel)
            print('        %s.%s ⇒ %s' % (g, method, why))
        print('')
        print('     ⇒ 这是 `is-*` 状态类那次事故的同一形态：说有、实现没有。')
        print('       改成文档里真实存在的写法，或把该方法实现出来。')

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

    if bad or bad_globals or bad_promises:
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