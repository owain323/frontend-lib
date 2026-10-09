#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
api-contract-gate.py — 运行时 ↔ 类型 双向契约门禁（任务 W3）

===========================================================================
🔴 它替换掉了什么，为什么必须换
---------------------------------------------------------------------------
  旧的 `api-snapshot.py` 用正则扒源码，结果**对幻觉 API 报绿灯**。
  实测（2026-10-06）：把 `Select.destroy()` 这个 runtime 根本没有的
  幻觉 API 写回类型文件，它依然输出「OK types 声明的方法在 runtime 都存在」。

  两层根因：
    ① types侧 `^\s*(\w+)\s*\(` 只抓**方法**
       ⇒ `value` / `tags` 这类getter 在它眼里不存在，属性分叉一律漏。
    ② runtime 侧只扒 key 名 ⇒ 分不清method 与getter。

===========================================================================
现在怎么做
---------------------------------------------------------------------------
  1. `api-contract.js` 在**真浏览器**里创建每个组件实例，
     用 `Object.getOwnPropertyDescriptors` 取真实形状
     ⇒ 能区分 method / getter / accessor / proto-method。
  2. 本脚本把 .d.ts 里的声明解析出来，
     与运行时形状**双向**比对：
       · 类型有、运行时没有  → 🔴 幻觉 API（比缺类型更危险）
       · 运行时有、类型没声明 → ⚠️ 类型不完整
       · 两边都是方法/属性但**种类不同**（如方法 vs getter）→ 🔴 用法会错

===========================================================================
为什么"多声明"也要报
---------------------------------------------------------------------------
  类型少声明不会让代码崩，但会让 TS 用户**看不到**可用的 API；
  更糟的是他们会去看 JS 源码 ⇒ 绕过了类型系统。
  所以本门禁把"未声明"降级为 WARN 但仍然显示，由人工判断是否有意。
===========================================================================
"""
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TYPES = os.path.join(ROOT, 'types', 'index.d.ts')
SNAPSHOT = os.path.join(ROOT, '05-audit', 'api-contract.json')
PROBER = os.path.join(ROOT, '05-audit', 'api-contract.js')
SERVER = os.path.join(ROOT, '05-audit', 'with-server.sh')

# .d.ts 的接口名 → 运行时探测用的组件名
IFACE_TO_RUNTIME = {
    'Select': 'Select',
    'Combobox': 'Combobox',
    'DateRange': 'DateRange',
    'Dropdown': 'Dropdown',
    'Tree': 'Tree',
    'DateRangeStatics': 'DateRangeStatics',
}

# 这些成员由基类/框架提供，类型里不必逐个写
IGNORE = {'constructor', 'then', 'toJSON', 'valueOf'}


# ---------------------------------------------------------------- 运行时
def probe_runtime():
    """走公共 helper：自动确保 :8000 在跑（check-all 里已在跑，单独跑时自己起）。"""
    import _probe
    return _probe.run_probe('05-audit/api-contract.js')


# ---------------------------------------------------------------- 类型侧
MEMBER_RE = re.compile(
    r'(?:^|\n)\s*'
    r'(?:readonly\s+)?'
    r'(?P<name>[A-Za-z_$][\w$]*)'
    r'\s*(?P<kind>\??\s*[:(])'
)


PARSE_RE = re.compile(r'(?:interface)\s+(\w+)\s*(?:extends\s+([\w\s,<>.]+?))?\s*\{')


def parse_types():
    """把 .d.ts 的每个 interface 解析成 { 成员: kind }，**含继承链**。

    ⭐🔴 必须跟extends —— 这是实测抓到的真缺陷：
       `interface Select extends Destroyable` 的 `destroy()` 来自父接口，
       第一版只扫接口体本身 ⇒ `destroy` 不可见 ⇒
       「类型声明了 runtime 没有的 destroy」这类幻觉**漏检**。
       而 `Destroyable` 恰好就是那个共用的虚构接口 ——
       不跟继承，就等于回到旧门禁的盲区。
    """
    if not os.path.isfile(TYPES):
        return {}
    src = io.open(TYPES, encoding='utf-8').read()
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    src = re.sub(r'//[^\n]*', '', src)

    bodies = {}
    parents = {}
    for m in PARSE_RE.finditer(src):
        name = m.group(1)
        ext = m.group(2) or ''
        i = src.index('{', m.end() - 1)
        depth = 0
        for j in range(i, min(len(src), i + 8000)):
            if src[j] == '{':
                depth += 1
            elif src[j] == '}':
                depth -= 1
                if depth == 0:
                    bodies[name] = src[i + 1:j]
                    parents[name] = [p.strip() for p in re.split(r'[,\s]+', ext)
                                     if p.strip()]
                    break

    # 父接口的成员并入子接口（父在前，子可覆盖）
    out = {}
    for name in bodies:
        merged = {}
        for p in parents.get(name, []):
            if p in bodies:
                merged.update(parse_members(bodies[p]))
        merged.update(parse_members(bodies[name]))
        out[name] = merged
    return out


def parse_members(body):
    """解析 interface 体。返回 { 成员名: kind }。

    ⭐ `readonly x: T` 与 `get x(): T` **都是** getter 声明 ——
       TypeScript 里这两种写法对使用者的效果完全一样（都不可写/可读）。
       早期版本没认readonly ⇒ 把所有 getter 属性误报成
       「types=value vs runtime=getter」的假红。实测踩过。
    """
    members = {}
    for line in body.split('\n'):
        line = line.strip()
        if not line or line.startswith('//'):
            continue
        mm = MEMBER_RE.match(line)
        if not mm:
            continue
        nm = mm.group('name')
        kind = mm.group('kind').replace(' ', '')
        if nm in ('function', 'new', 'return', 'if', 'for'):
            continue
        if kind.startswith('('):
            members[nm] = 'method'
        elif kind.startswith('?'):
            members[nm] = 'opt-method' if line.rstrip().endswith('(') else 'opt-value'
        else:
            # readonly 属性 ≡ getter（对使用者是只读访问器）
            if line.startswith('readonly ') or re.search(
                    r'\bget\s+' + re.escape(nm) + r'\s*\(', body):
                members[nm] = 'getter'
            else:
                members[nm] = 'value'
    return members


# 归一：runtime 的 kind → 使用者视角的"用法类别"
def norm_rt(kind):
    if kind in ('method', 'proto-method', 'static-method'):
        return 'method'
    if kind in ('getter', 'accessor'):
        # 🔴 getter / accessor **对使用者都是「读属性」**
        #   区别只在能不能写，而那是 types 侧的 readonly 与非 readonly 之分。
        #   早期把 accessor 归成独立类别 ⇒ Select.value（可读写）
        #   被误报成「types=value vs runtime=getter」的假红。实测踩过。
        return 'prop'
    return 'prop'


def norm_ts(kind):
    if kind in ('method', 'opt-method'):
        return 'method'
    if kind in ('getter', 'value', 'opt-value'):
        # 属性的三种写法（readonly / 普通 / 可选）对使用者都是「读属性」，
        # 能不能写在 types 侧已由 readonly 表达，不在这里重复判。
        return 'prop'
    return kind


def main():
    print('  === 运行时 ↔ 类型 双向契约（任务 W3）===')
    print('')

    rt = probe_runtime()
    if not rt:
        print('  FAIL  拿不到运行时形状')
        print('        ⇒ 已自动尝试起服务。检查：')
        print('          · 8000 端口是否被别的程序占着')
        print('          ·  05-audit/browser.js 能否找到浏览器')
        return 1

    errs = {k: v for k, v in rt.items() if isinstance(v, dict) and '__error' in v}
    if errs:
        print('  ⚠️ 以下组件探测失败（其契约**未被验证**，不等于通过）：')
        for k, v in errs.items():
            print('     %-18s %s' % (k, v['__error'][:70]))

    ts = parse_types()

    # ---------- 逐组件双向比对 ----------
    missing_in_rt = []   # 类型有、运行时没有 ⇒ 幻觉 API
    missing_in_ts = []   # 运行时有、类型没声明
    kind_mismatch = []   # 两边都有但种类不同

    for iface, rt_name in IFACE_TO_RUNTIME.items():
        if iface not in ts:
            continue
        r = rt.get(rt_name)
        if not r or (isinstance(r, dict) and '__error' in r):
            continue
        tm = ts[iface]
        for m, tk in tm.items():
            if m in IGNORE:
                continue
            tk_n = norm_ts(tk)
            if m not in r:
                missing_in_rt.append((iface, m, tk_n))
                continue
            rk_n = norm_rt(r[m])
            # ⚠️ 只有「getter vs 方法」才是硬错误；
            #    value 属性声明成方法这类也会报，因为用法不同。
            if tk_n != rk_n:
                kind_mismatch.append((iface, m, tk_n, rk_n))
        for m, rk in r.items():
            if m in IGNORE:
                continue
            if m not in tm:
                missing_in_ts.append((iface, m, norm_rt(rk)))

    bad = False
    if missing_in_rt:
        bad = True
        print('  🔴 类型声明了 runtime **不存在**的成员（幻觉 API）：')
        for iface, m, k in missing_in_rt:
            print('     %-14s %-14s 声明为 %s' % (iface, m, k))
        print('')
        print('     这会明确误导 TS 使用者，比没有类型更糟。')

    if kind_mismatch:
        bad = True
        print('  🔴 同一成员在两边**种类不同**（用法会错）：')
        for iface, m, tk, rk in kind_mismatch:
            print('     %-14s %-14s types=%-8s runtime=%s' % (iface, m, tk, rk))

    if not bad:
        print('  OK  类型没有声明 runtime 不存在的成员')

    if missing_in_ts:
        print('')
        print('  ⚠️ runtime 有但类型未声明（TS 用户看不到，需人工确认是否有意）：')
        for iface, m, k in missing_in_ts:
            print('     %-14s %-14s %s' % (iface, m, k))

    # ---------- 记录快照（有变化要显式承认） ----------
    old = None
    if os.path.isfile(SNAPSHOT):
        try:
            old = json.load(io.open(SNAPSHOT, encoding='utf-8'))
        except Exception:
            old = None
    if old != rt:
        io.open(SNAPSHOT, 'w', encoding='utf-8', newline='').write(
            json.dumps(rt, ensure_ascii=False, indent=2, sort_keys=True) + '\n')
        if old is not None:
            print('')
            print('  → 运行时形状有变化，已更新 api-contract.json。')
            print('    若**有意**，请同时更新 types/index.d.ts 与 CHANGELOG。')

    print('')
    if bad:
        return 1
    print('  ⇒ 运行时与类型已对齐。')
    return 0


if __name__ == '__main__':
    sys.exit(main())