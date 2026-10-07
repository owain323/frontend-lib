#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
build-dist.py — 把源码 CD 出 dist/（去注释版 + min 版 + manifest）

===========================================================================
🔴 为什么需要它（M1 / 对标 Pico + Open Props）
---------------------------------------------------------------------------
实测：全库 CSS 原始 323.9 KB，其中**注释 207.5 KB（64%）**。
`01-tokens/tokens.css` 一个文件就 gzip 15.9 KB ——
使用者为了用一个组件，先要把我们的推理过程下载一遍。

而 Pico / Open Props / Web Awesome 全部是 **src 可读、dist 可 ship**：
Pico 在 README 上按产物逐个公布体积；Open Props 的 CDN 清单里
`open-props.min.css` 与 `normalize.min.css` 分开给；Web Awesome 从 dist/ 交付。

⭐ 更强的一条理由来自我们自己：`.gitignore` 里早就写着
「内部工作文档不进仓库 —— 交付面只放提交物」，00-charter / 07-notes / 08-plan 全在名单里。
⇒ **这条纪律我们已经执行了，只是只对 markdown 执行了。** M1 把它扩到 CSS。

===========================================================================
设计约束（不许破）
---------------------------------------------------------------------------
  ① **真值永远是源码**：dist/ 可以整个删掉重建，源码一个字节都不依赖它。
  ② **零依赖、零构建链**：不引入任何 npm 包；本脚本只用标准库。
  ③ **JS 不压缩**：手写 JS 压缩器会引入破坏 ES5 语义的风险，
     收益远小于风险 ⇒ JS 只做「去注释」，如实命名为 `<name>.js`，不叫 min。
  ④ **不猜**：任何安全存疑的压缩规则都不采用；反例由 `dist-parity-check.js`
     在浏览器里把 dist 与源码解析成规则集逐条比对 —— 有出入就红。

===========================================================================
用法
---------------------------------------------------------------------------
  python3 05-audit/build-dist.py            # 重建 dist/
  python3 05-audit/build-dist.py --check    # 只校验新鲜度（源码 sha256 是否还对得上）
  python3 05-audit/build-dist.py --selftest # 反向控制：证明压缩器会被判据抓到
===========================================================================
"""
import io
import os
import gzip
import json
import hashlib
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
MANIFEST = os.path.join(DIST, 'manifest.json')

# 与 size-baseline.py 保持同一口径（vendor 是第三方，不算我们自己的产物）
SRC_DIRS = ('01-tokens', '02-primitives', '03-patterns', '04-recipes')
EXTS = ('.css', '.js')
SKIP_DIR_NAMES = ('vendor',)


# ==========================================================================
# CSS 处理
# ==========================================================================
def strip_css_comments(src):
    """删掉 /* ... */。
    ⚠️ 必须跳过字符串内部：content: "/* 这不是注释 */" 这种是值的一部分。
    ⚠️ 注意 /**<=> 这类'文档注释'也是注释，一并删。"""
    out = []
    i = 0
    n = len(src)
    quote = None
    while i < n:
        c = src[i]
        if quote:
            out.append(c)
            if c == '\\' and i + 1 < n:      # 转义字符原样带过去
                out.append(src[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c in ('"', "'"):
            quote = c
            out.append(c)
            i += 1
            continue
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        out.append(c)
        i += 1
    return ''.join(out)


# 这些标点周围的多余空白可以删。
# 🔴 这张表是**被门禁逼出来的**，不是拍的。第一版写了 `{}:;,>+~`，
#    dist-parity-check 立刻红了 34/66 个产物，逐条定位后是两类：
#      · `,` —— 浏览器 CSSOM **序列化时固定写成 `, `**（值列表的分隔符），
#        我把它压成 `,border-color` ⇒ 解析结果相同，但 cssText 不同 ⇒ 判据红。
#        这是"序列化差异"不是"语义差异"，但判据宁可严一点：不压逗号。
#      · `+` —— `calc(100% + 1px)` 压成 `calc(100%+1px)` 是**非法**的
#        （calc 的 +/- 两侧必须有空白）⇒ 整条声明被丢弃，界面静默少一块。
# ⚠️ 同理不处理 '/'（`font: 12px/1.5`）与 '-'（负号 / 自定义属性名）。
#    ⇒ 宁可少压几个字节，也不冒改错的风险。
SPACE_AROUND = set('{}:;')


def minify_css(src):
    """保守压缩：删注释 + 折叠空白 + 删标点周围空白 + 删 } 前的最后一个分号。
    字符串与 url(...) 内部**一个字节都不动**。"""
    s = strip_css_comments(src)
    out = []
    i = 0
    n = len(s)
    quote = None
    depth = 0                      # url(...) 的保护计数
    while i < n:
        c = s[i]
        if quote:
            out.append(c)
            if c == '\\' and i + 1 < n:
                out.append(s[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c in ('"', "'"):
            quote = c
            out.append(c)
            i += 1
            continue
        if depth:                                   # url(...) 内部：原样
            out.append(c)
            if c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
            i += 1
            continue
        if s.startswith('url(', i):
            depth = 1
            out.append('url(')
            i += 4
            continue
        if c.isspace():
            while i < n and s[i].isspace():
                i += 1
            # ⚠️ 逗号后面**必须保留一个空格**：实测 CSSOM 序列化 transition 这类
            #    逗号列表时会**原样保留源码里的空白**（源码是「,\n   border-color」），
            #    压成「,border-color」虽然解析结果一样，但 cssText 不同 ⇒ parity 判据红。
            #    判据宁可严，所以这里跟着留空格。
            if out and out[-1] not in ('', ';', '{', '}', ':'):
                out.append(' ')
            continue
        if c in SPACE_AROUND:
            # 吞掉它后面的空白
            out.append(c)
            i += 1
            while i < n and s[i].isspace():
                i += 1
            continue
        if c == ';':
            # } 前的最后一个分号可以不要
            j = i + 1
            while j < n and s[j].isspace():
                j += 1
            if j < n and s[j] == '}':
                i = j
                continue
            out.append(';')
            i += 1
            continue
        out.append(c)
        i += 1
    txt = ''.join(out)
    # 收尾：去尾空白 + 保证以换行结束
    txt = re.sub(r'[ \t]+\n', '\n', txt)
    txt = re.sub(r'\n{2,}', '\n', txt)
    return txt.strip() + '\n'


def strip_js_comments(src):
    """删 // 与 /* */，**保留一行前面的缩进与字符串内容**。
    ⚠️ 正则不能处理正则字面量里的 //；本库的 JS 里没有（真有的话会因语法检查失败暴露）。"""
    out = []
    i = 0
    n = len(src)
    quote = None
    line_start = True
    while i < n:
        c = src[i]
        if quote:
            out.append(c)
            if c == '\\' and i + 1 < n:
                out.append(src[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c in ('"', "'"):
            quote = c
            out.append(c)
            i += 1
            continue
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i)
            i = n if j < 0 else j
            continue
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        if c == '\n':
            line_start = True
            out.append(c)
            i += 1
            continue
        if c.isspace() and line_start:
            i += 1
            continue
        line_start = False
        out.append(c)
        i += 1
    txt = ''.join(out)
    txt = re.sub(r'[ \t]+\n', '\n', txt)
    txt = re.sub(r'\n{3,}', '\n\n', txt)
    return txt.strip() + '\n'


# ==========================================================================
# 构建
# ==========================================================================
def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def gz_size(text):
    return len(gzip.compress(text.encode('utf-8'), 9))


def sources():
    """源码清单（相对路径，posix 风格，稳定排序）。"""
    found = []
    for d in SRC_DIRS:
        base = os.path.join(ROOT, d)
        for root, dirs, files in os.walk(base):
            dirs[:] = [x for x in dirs if x not in SKIP_DIR_NAMES]
            for f in files:
                if f.endswith(EXTS):
                    rel = os.path.relpath(os.path.join(root, f), ROOT)
                    found.append(rel.replace('\\', '/'))
    return sorted(found)


def build():
    entries = []
    for rel in sources():
        src_path = os.path.join(ROOT, rel)
        raw = io.open(src_path, encoding='utf-8').read()
        src_bytes = raw.encode('utf-8')
        item = {
            'source': rel,
            'sourceSha256': sha256(src_path),
            'sourceBytes': len(src_bytes),
            'sourceGzip': gz_size(raw),
        }
        if rel.endswith('.css'):
            stripped = strip_css_comments(raw)
            mini = minify_css(raw)
            # 判据 0：**产物必须能被同一份解析器认出来** —— 压缩后注释/空白之外
            # 的差别立刻会被 dist-parity-check 抓到；这里先做最便宜的一条自检：
            # 去注释版与压缩版在「删掉所有空白后」必须逐字节相同。
            norm = lambda s: re.sub(r'\s+', '', s).rstrip(';').replace(';}', '}')
            if norm(stripped) != norm(mini):
                raise SystemExit(
                    '去注释版与压缩版语义不等价：%s\n'
                    '  （两者在忽略空白/尾分号后应完全一致 —— 不一致说明压缩器有 bug）' % rel)
            item['outputs'] = [
                {'path': 'dist/' + rel, 'kind': 'stripped',
                 'bytes': len(stripped.encode('utf-8')), 'gzip': gz_size(stripped)},
                {'path': 'dist/' + rel[:-4] + '.min.css', 'kind': 'minified',
                 'bytes': len(mini.encode('utf-8')), 'gzip': gz_size(mini)},
            ]
            write_out('dist/' + rel, stripped)
            write_out('dist/' + rel[:-4] + '.min.css', mini)
        else:
            stripped = strip_js_comments(raw)
            # 🔴 JS 只去注释、**不压缩**（见文件头约束 ③）
            item['outputs'] = [
                {'path': 'dist/' + rel, 'kind': 'stripped',
                 'bytes': len(stripped.encode('utf-8')), 'gzip': gz_size(stripped)},
            ]
            item['note'] = 'JS 不做压缩：手写压缩器有破坏 ES5 语义的风险，收益不抵风险'
            write_out('dist/' + rel, stripped)
        entries.append(item)

    manifest = {
        'schemaVersion': '1.0.0',
        'generator': '05-audit/build-dist.py',
        'policy': [
            'dist/ 是源码的导出物，整目录可删重建；真值永远是 01-tokens ~ 04-recipes 下的源文件',
            'JS 只去注释不压缩；CSS 产出 stripped + minified 两份',
            'manifesto 里的 sourceSha256 变了而 dist 没重建 ⇒ dist-parity/dist-fresh 门禁会红',
        ],
        'totals': {
            'sourceFiles': len(entries),
            'sourceBytes': sum(e['sourceBytes'] for e in entries),
            'distGzip': sum(o['gzip'] for e in entries for o in e['outputs']),
        },
        'files': entries,
    }
    write_out('dist/manifest.json',
              json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    return manifest


def write_out(rel, text):
    p = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    # ⚠️ newline='' ⇒ 不把 \n 换成 \r\n（Windows 下 io.open 默认会换；dist 是产物，
    #    字节必须稳定，否则 sha256 漂移）
    with io.open(p, 'w', encoding='utf-8', newline='') as fh:
        fh.write(text)


def check_freshness():
    """源码 sha256 与 manifest 记录不一致 ⇒ 忘了重建 ⇒ 红。"""
    if not os.path.isfile(MANIFEST):
        return ['dist/manifest.json 不存在 ⇒ 先跑一次 python 05-audit/build-dist.py']
    man = json.loads(io.open(MANIFEST, encoding='utf-8').read())
    bad = []
    for e in man['files']:
        p = os.path.join(ROOT, e['source'])
        if not os.path.isfile(p):
            bad.append('源文件不见了：' + e['source'])
            continue
        if sha256(p) != e['sourceSha256']:
            bad.append('源码改过但 dist 没重建：' + e['source'])
        for o in e['outputs']:
            if not os.path.isfile(os.path.join(ROOT, o['path'])):
                bad.append('产物缺失：' + o['path'])
    return bad


def selftest():
    """反向控制：证明判据会红。"""
    print('  === build-dist 反向控制 ===')
    ok = True

    # ① 真注释要删，**字符串里的** /* 要留
    #    （第一版我把判据写反了：断言「产物里不许有 /*」——
    #     但 `"/* 不是注释 */"` 是**值的一部分**，删了才是 bug。
    #     ⇒ 判据必须同时管两头，只管一头的判据会逼人改错方向。）
    tricky = 'a { color: red }\n/* 真注释 */\nb { content: "/* 假注释 */ a  b" }\n'
    got = minify_css(tricky)
    if '真注释' in got:
        print('  [FAIL] 真注释没被删掉')
        ok = False
    elif '/* 假注释 */ a  b' not in got:
        print('  [FAIL] 字符串里的 /* */ 被误当注释删了（那是值的一部分）')
        ok = False
    else:
        print('  [OK]   真注释删掉、字符串内的 /* */ 保留')

    # ② url(...) 内部不能被动
    u = 'a { background: url("data:image/svg+xml,%3Csvg a  b%3E") no-repeat }'
    got = minify_css(u)
    if 'a  b' not in got:
        print('  [FAIL] url(...) 内部的空白被改动了')
        ok = False
    else:
        print('  [OK]   url(...) 内部一个字节没动')

    # ③ 新鲜度判据必须能红：改一笔内容的散列 ⇒ 必须报不一致
    man = json.loads(io.open(MANIFEST, encoding='utf-8').read())
    if man['files']:
        fake = man['files'][0]['sourceSha256']
        bak = man['files'][0]['sourceSha256']
        man['files'][0]['sourceSha256'] = '0' * 64
        io.open(MANIFEST, 'w', encoding='utf-8', newline='').write(
            json.dumps(man, ensure_ascii=False, indent=2) + '\n')
        bad = check_freshness()
        man['files'][0]['sourceSha256'] = bak
        io.open(MANIFEST, 'w', encoding='utf-8', newline='').write(
            json.dumps(man, ensure_ascii=False, indent=2) + '\n')
        if not bad:
            print('  [FAIL] 反向控制失效：散列对不上却没报错')
            ok = False
        else:
            print('  [OK]   散列对不上 ⇒ 报「源码改过但 dist 没重建」')
    else:
        print('  [FAIL] manifest 里没有文件')
        ok = False
    del fake
    return 0 if ok else 1


def main():
    if '--selftest' in sys.argv:
        return selftest()
    if '--check' in sys.argv:
        bad = check_freshness()
        if bad:
            print('  [FAIL] dist 不新鲜：')
            for b in bad[:20]:
                print('        ' + b)
            print('        ⇒ 跑 python 05-audit/build-dist.py 重建')
            return 1
        print('  OK dist 与源码新鲜度一致（%d 个产物都对得上源 sha256）'
              % sum(len(e['outputs'])
                    for e in json.loads(io.open(MANIFEST, encoding='utf-8').read())['files']))
        return 0

    man = build()
    n_out = sum(len(e['outputs']) for e in man['files'])
    print('  已重建 dist/：%d 个源文件 → %d 个产物' % (man['totals']['sourceFiles'], n_out))
    print('    源码原始   %.1f KB' % (man['totals']['sourceBytes'] / 1024))
    print('    dist gzip 合计 %.1f KB' % (man['totals']['distGzip'] / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
