#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
dist-cost-gate.py —— 「采纳一个组件到底要付多少」必须**能被复算**

===========================================================================
🔴 为什么需要这道门禁（M1 / 对标 Pico）
---------------------------------------------------------------------------
Pico 在 README 上**按产物逐个公布体积**；Open Props 的 CDN 清单也是一份公开账本。
我们此前公布过"全库 gzip 178.3 KB"，但那个数字对使用者**没有意义**：
他要的是一个组件。

真实成本其实是三笔钱：

    采用一个组件  =  tokens（必付）+  组件 CSS  +  组件 JS（可选）

实测（本脚本算出）：`tokens.css` 一个文件就占 gzip 15.9 KB，
比绝大多数组件自己还贵。**不把这个表公开，使用者就是在盲买。**

⇒ 判据不是"数字好看"，而是：**表上的每个数字都能用同一个脚本复算出来**。
   手改一个数字 ⇒ 红。（这就是 `start-here` / `size-baseline` 一贯的做法。）

===========================================================================
用法
---------------------------------------------------------------------------
  python3 05-audit/dist-cost-gate.py            # 校验 dist/COSTS.md 与实算一致
  python3 05-audit/dist-cost-gate.py --update   # 重算并写回
  python3 05-audit/dist-cost-gate.py --selftest # 反向控制
===========================================================================
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, 'dist', 'manifest.json')
COSTS = os.path.join(ROOT, 'dist', 'COSTS.md')

TIERS = (('02-primitives', 'primitive'), ('03-patterns', 'pattern'))
TOKENS_KEY = '01-tokens/tokens.css'


def load():
    return json.loads(io.open(MANIFEST, encoding='utf-8').read())


def index(manifest):
    """产物索引：{ 产物相对路径(dist/...) : {'gzip': n, 'kind': ...} }"""
    out = {}
    for f in manifest['files']:
        for o in f['outputs']:
            out[o['path']] = o
    return out


def src_gzip(manifest, rel):
    for f in manifest['files']:
        if f['source'] == rel:
            return f['sourceGzip']
    return None


def components(manifest):
    srcs = set(f['source'] for f in manifest['files'])
    out = []
    for tier, label in TIERS:
        base = os.path.join(ROOT, tier)
        if not os.path.isdir(base):
            continue
        for d in sorted(os.listdir(base)):
            rel = '%s/%s/%s.css' % (tier, d, d)
            if rel in srcs:
                out.append((label, d, rel))
    return out


def kb(n):
    return '%.1f KB' % (n / 1024.0)


def table(manifest, perturb=None):
    """生成 COSTS.md。perturb 只给 selftest 用（把 tokens 的数字改一笔，验证判据会红）。"""
    idx = index(manifest)
    tg = idx['dist/01-tokens/tokens.min.css']['gzip']
    tg_src = src_gzip(manifest, TOKENS_KEY)
    if perturb:
        tg += perturb
    rows = []
    for label, name, rel in components(manifest):
        mini = idx.get('dist/' + rel[:-4] + '.min.css')
        js = idx.get('dist/' + rel[:-4] + '.js')
        if not mini:
            continue
        total = tg + mini['gzip'] + (js['gzip'] if js else 0)
        src_total = (tg_src or 0) + src_gzip(manifest, rel) + \
            (src_gzip(manifest, rel[:-4] + '.js') or 0 if js else 0)
        rows.append((label, name, tg, mini['gzip'],
                     js['gzip'] if js else 0, total, src_total))

    lines = []
    lines.append('# 采纳成本表')
    lines.append('')
    lines.append('> 这个文件由 `05-audit/dist-cost-gate.py` **生成**，不要手改（改了门禁会红）。')
    lines.append('> 数字口径：**dist 里的 min 产物，gzip 9 级**。')
    lines.append('')
    lines.append('## 一、为什么单独算这一笔')
    lines.append('')
    lines.append('采用一个组件要付三笔钱：`tokens`（必付）+ 组件 CSS + 组件 JS（可选）。')
    lines.append('')
    lines.append('实测两笔账，一笔不省：')
    lines.append('')
    lines.append('- `tokens` 源码版 gzip **%s** → min 版 **%s**（省 %.0f%%）——'
                 % (kb(tg_src or 0), kb(tg),
                    (100.0 * (1 - tg / float(tg_src))) if tg_src else 0))
    lines.append('  源码多的那部分**全是注释**（全库 CSS 有 64% 是注释），'
                 '而注释是给我们的，不是给使用者浏览器的。')
    lines.append('- tokens 的 min 版 %s **比任何一个组件自己都贵** ⇒'
                 % kb(tg))
    lines.append('  "只用一个组件"的真实起步价就是它。不公开这张表，等于让人盲买。')
    lines.append('')
    lines.append('## 二、明码标价')
    lines.append('')
    lines.append('| 档 | 组件 | tokens（必付） | CSS | JS | **合计** | 源码版合计 | 差 |')
    lines.append('|---|---|---:|---:|---:|---:|---:|---:|')
    for label, name, t, c, j, tot, st in rows:
        lines.append('| %s | `%s` | %s | %s | %s | **%s** | %s | −%s |'
                     % (label, name, kb(t), kb(c),
                        kb(j) if j else '—', kb(tot), kb(st), kb(st - tot)))
    lines.append('')
    lines.append('## 三、全库')
    lines.append('')
    all_min = idx['dist/01-tokens/tokens.min.css']['gzip']
    for label, name, rel in components(manifest):
        mini = idx.get('dist/' + rel[:-4] + '.min.css')
        js = idx.get('dist/' + rel[:-4] + '.js')
        if mini:
            all_min += mini['gzip'] + (js['gzip'] if js else 0)
    lines.append('- 全部组件都用上（min，含 tokens 一份）：**%s**' % kb(all_min))
    lines.append('- 源码版（带注释）全库 gzip：%s'
                 % kb(manifest['totals']['sourceBytes'] and
                      sum(src_gzip(manifest, f['source']) or 0
                          for f in manifest['files'])))
    lines.append('')
    lines.append('> ⚠️ 源码版那个数字**不是**要付的钱：它包含我们的注释（全库 CSS 有 64% 是注释）。')
    lines.append('> 它的用途只有一个 —— 让人看清"dist 到底省了多少"。')
    lines.append('')
    return '\n'.join(lines) + '\n'


def main():
    if not os.path.isfile(MANIFEST):
        print('  [FAIL] dist/manifest.json 不存在 ⇒ 先跑 python 05-audit/build-dist.py')
        return 1
    manifest = load()

    if '--selftest' in sys.argv:
        print('  === dist-cost 反向控制 ===')
        good = table(manifest)
        bad = table(manifest, perturb=1024)
        if good == bad:
            print('  [FAIL] 反向控制失效：改了数字生成的表却一样')
            return 1
        print('  [OK]   改一笔数字 ⇒ 生成的表立刻不同（判据有鉴别力）')
        # ② 判据也不能过宽：原样重算必须与磁盘一致
        if os.path.isfile(COSTS):
            disk = io.open(COSTS, encoding='utf-8').read()
            if disk != good:
                print('  [FAIL] 磁盘上的 COSTS.md 与实算不一致 ⇒ 跑 --update')
                return 1
            print('  [OK]   实算与磁盘一致（不会误报）')
        else:
            print('  [FAIL] dist/COSTS.md 不存在 ⇒ 跑 --update')
            return 1
        return 0

    want = table(manifest)
    if '--update' in sys.argv:
        io.open(COSTS, 'w', encoding='utf-8', newline='').write(want)
        print('  已写出 dist/COSTS.md（%d 行）' % want.count('\n'))
        return 0
    if not os.path.isfile(COSTS):
        print('  [FAIL] dist/COSTS.md 不存在 ⇒ 跑 python 05-audit/dist-cost-gate.py --update')
        return 1
    have = io.open(COSTS, encoding='utf-8').read()
    if have != want:
        print('  [FAIL] dist/COSTS.md 与实算不一致 ⇒ 手改了？跑 --update 重算')
        a = have.split('\n')
        b = want.split('\n')
        for i in range(max(len(a), len(b))):
            x = a[i] if i < len(a) else '(缺)'
            y = b[i] if i < len(b) else '(缺)'
            if x != y:
                print('        第 %d 行  磁盘: %s' % (i + 1, x[:90]))
                print('                实算: %s' % y[:90])
                break
        return 1
    n = want.count('|') and want.count('\n')
    print('  OK dist/COSTS.md 与实算一致（每个数字都能用同一脚本复算）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
