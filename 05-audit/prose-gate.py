#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
prose-gate.py — 页面可见文本的「成品度」判据

===========================================================================
🔴 为什么需要这道门禁
---------------------------------------------------------------------------
  这类缺陷**不会报错、不会警告、页面也打得开**，只是难看：

    · `**两个每个人都会踩的坑**` 原样显示在页面上（Markdown 没渲染）
    · 首页摘要结尾是「会计正负是 ta」—— 生成器按字符硬切 `purpose[:56]`
    · 首页因此括号不配平（切在了 `（…` 中间）
    · 一个读屏 aria-label 是「财务数据表（可横」

  它们全部来自**生成侧**或**手写遗漏**，而现有门禁只看结构、对比度、类名、
  可访问性 —— 没有一条看"这段话读起来是不是完整的"。

  本轮外部评审的原话是「代码契约很强，尚未等价转化为自然语言输出也经过同等质量门禁」。
  这道门禁就是那句话的判据化：**能机械判定的部分，不留给人眼**。

===========================================================================
判据（每条都能被反向控制证伪）
---------------------------------------------------------------------------
  P1 可见文本含 `**`            → 未渲染的加粗
  P2 可见文本含反引号            → 未渲染的行内代码
  P3 可见文本含 `](`             → 未渲染的链接
  P4 整页可见文本括号不配平      → 通常是把 `（…）` 切断了

  S1 short_text 不超过上限（含省略号最多 +1）
  S2 上限内有句末标点 ⇒ 必须切在句末，不许再往后硬切
  S3 结果不得留半个 `（` / `(`
  S4 英文按空格切，不许切在单词中间
  S5 **反证**：把同一段文本用旧的 `t[:limit]` 切，必须被判为不合格

  没有 P5「句子读起来通顺」这种判据 —— 那需要人来判。宁可少一条，不要一条
  看起来在检查、其实恒真的规则。

用法：python 05-audit/prose-gate.py [--json]
===========================================================================
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, '05-audit'))

PAGE_DIRS = ['01-tokens', '02-primitives', '03-patterns', '04-recipes', '09-assets',
             'guide', 'examples', '10-review']

# 这些区域里的字符不算"可见文本"：注释、脚本、样式、代码示例
HIDDEN_PATTERNS = [
    r'<!--[\s\S]*?-->',
    r'<script\b[\s\S]*?</script>',
    r'<style\b[\s\S]*?</style>',
    r'<pre\b[\s\S]*?</pre>',
    r'<code\b[\s\S]*?</code>',
]

MD_RULES = [
    ('md-bold', re.compile(r'\*\*'), '未渲染的加粗：`**文字**` 原样显示在页面上'),
    ('md-code', re.compile(r'`'), '未渲染的行内代码：反引号原样显示'),
    ('md-link', re.compile(r'\]\('), '未渲染的链接：`[文字](地址)` 原样显示'),
]


def mask_hidden(text):
    """把不可见区域替换成等长空格（保留换行）—— 这样后续报的行号仍然准确。"""
    def blank(m):
        return re.sub(r'[^\n]', ' ', m.group(0))
    for pat in HIDDEN_PATTERNS:
        text = re.sub(pat, blank, text)
    return text


def visible_text(masked):
    """去掉标签，只留文本节点。标签替换成空格，避免把相邻节点的词粘在一起。"""
    return re.sub(r'<[^>]+>', ' ', masked)


def line_of(text, pos):
    return text.count('\n', 0, pos) + 1


def pages():
    out = [os.path.join(ROOT, 'index.html')]
    for d in PAGE_DIRS:
        base = os.path.join(ROOT, d)
        for cur, _, files in os.walk(base):
            for f in sorted(files):
                if f.endswith('.html'):
                    out.append(os.path.join(cur, f))
    return [p for p in out if os.path.isfile(p)]


def scan_page(path):
    raw = io.open(path, encoding='utf-8').read()
    masked = mask_hidden(raw)
    hits = []
    for rule, pat, why in MD_RULES:
        for m in pat.finditer(masked):
            hits.append({'rule': rule, 'line': line_of(masked, m.start()),
                         'what': m.group(0), 'why': why,
                         'near': visible_text(masked[max(0, m.start() - 30):m.start() + 30]).strip()[:50]})
    txt = visible_text(masked)
    for op, cl, name in (('（', '）', '全角'), ('(', ')', '半角')):
        if txt.count(op) != txt.count(cl):
            hits.append({'rule': 'paren-unbalanced', 'line': 1,
                         'what': '%s 开 %d / 闭 %d' % (name, txt.count(op), txt.count(cl)),
                         'why': '括号没配对：通常是把 `（…）` 从中切断，或漏了右括号',
                         'near': ''})
    return hits


# ---------------------------------------------------------------- 生成器判据
def check_short_text():
    """对 gen-docs 的 short_text 做单元判据 —— 它是首页文案的唯一出口。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        'gen_docs', os.path.join(ROOT, '05-audit', 'gen-docs.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    fails = []
    cases = []

    # 真实数据：每个组件的 purpose 都过一遍
    comps = json.load(io.open(os.path.join(ROOT, 'ai', 'components.json'), encoding='utf-8'))
    for c in comps.get('components', []):
        cases.append((c.get('purpose') or '', 56, 'component:' + str(c.get('id'))))

    # 人造边界：没有句末标点 / 没有分句边界 / 英文长句 / 半个括号
    cases += [
        ('中' * 200, 56, 'no-boundary'),
        ('Please read the following paragraph before you continue with the setup', 32, 'english'),
        ('系统的（第一层缓存（第二层缓存）在此处结束', 16, 'nested-paren'),
        ('短句。', 56, 'short'),
    ]

    def unmatched_paren(s):
        return s.count('（') != s.count('）') or s.count('(') != s.count(')')

    for text, limit, tag in cases:
        got = mod.short_text(text, limit)
        if len(got) > limit + 1:
            fails.append('S1 %s：长度 %d 超过上限 %d —— %r' % (tag, len(got), limit, got[:60]))
        if unmatched_paren(got):
            fails.append('S3 %s：留下半个括号 —— %r' % (tag, got[:60]))
        # S2：上限内有句末标点，就必须停在句末，不能把句子切开
        src = ' '.join(str(text).split())
        ends = [i + 1 for i, ch in enumerate(src[:limit]) if ch in mod._END_PUNCT]
        if ends and len(src) > limit:
            want = src[:max(ends)]
            if got != want:
                fails.append('S2 %s：应切在句末 %r，实际 %r' % (tag, want[:40], got[:40]))
        # S4：英文长句必须切在空格处，不能切出半个单词
        if tag == 'english' and got and got[-1] not in '…':
            fails.append('S4 %s：切出了半个单词 —— %r' % (tag, got[-12:]))

    # S5 反证：**用合成样本**证明"旧的硬切会被同一套判据抓住"。
    #   ⚠️ 不能用真实数据当样本：今天恰好没有超长 purpose 时，
    #      这条断言会永远为真（"没有样本" 冒充 "判据有牙"）——
    #      那正是 E319 那类错：判据看的是"当下恰好有没有"，不是"能不能抓"。
    demo = '第一句就把结论说完。第二句补充细节，再补一些内容' + '以及更多说明' * 12
    limit = 20
    naive = demo[:limit]                     # 旧写法
    want = demo[:demo.index('。') + 1]        # 正确写法
    if naive == want:
        fails.append('S5 反证失效：样本设计得让"硬切"恰好等于"按句末切"，测不出区别')
    if unmatched_paren(want):
        fails.append('S5 反证失效：期望值自己就没配平括号：%r' % want)
    if mod.short_text(demo, limit) != want:
        fails.append('S5 反证失效：short_text 没切到句末（%r ≠ %r）'
                     % (mod.short_text(demo, limit), want))
    return fails


def selftest():
    """反向控制：把每一类缺陷注入一份临时页面，判据必须**全部**抓到。

    只跑"正例 0 报"是不够的 —— 一条恒不触发的规则也会让正例全绿。
    这里逐条证明：改坏之后，它真的会红。
    """
    import tempfile
    base = ('<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>t</title>'
            '</head><body><p>干净的一段话（有头有尾）。</p></body></html>')
    bad = [
        ('md-bold', base.replace('干净的一段话（有头有尾）。', '干净的一段**话**。')),
        ('md-code', base.replace('干净的一段话（有头有尾）。', '干净的一段`话`。')),
        ('md-link', base.replace('干净的一段话（有头有尾）。', '见[这里](x.html)。')),
        ('paren-unbalanced', base.replace('（有头有尾）', '（有头有尾')),
    ]
    fails = []
    tmpdir = tempfile.mkdtemp(prefix='prose-')
    try:
        clean = os.path.join(tmpdir, 'clean.html')
        io.open(clean, 'w', encoding='utf-8', newline='\n').write(base)
        if scan_page(clean):
            fails.append('正例被误报：干净页面应当 0 命中')
        for rule, html in bad:
            p = os.path.join(tmpdir, rule + '.html')
            io.open(p, 'w', encoding='utf-8', newline='\n').write(html)
            got = {h['rule'] for h in scan_page(p)}
            if rule not in got:
                fails.append('反向控制失效：注入 %s 之后没被抓到（实际 %s）'
                             % (rule, ','.join(sorted(got)) or '无'))
            elif len(got) != 1:
                fails.append('%s 的注入串同时触发了 %s —— 判据互相串味'
                             % (rule, ','.join(sorted(got))))
        # 注释/代码块里的同样字符**不算**违规（否则判据会把示例当现状）
        hidden = os.path.join(tmpdir, 'hidden.html')
        io.open(hidden, 'w', encoding='utf-8', newline='\n').write(
            base.replace('<p>干净的一段话（有头有尾）。</p>',
                         '<!-- **注释里的** --><pre>**代码里的**</pre><p>正文。</p>'))
        if scan_page(hidden):
            fails.append('隐藏区域（注释/代码块）里的 Markdown 被误判成可见文本')
    finally:
        for f in os.listdir(tmpdir):
            os.remove(os.path.join(tmpdir, f))
        os.rmdir(tmpdir)
    return fails


def main():
    as_json = '--json' in sys.argv
    if '--selftest' in sys.argv:
        fails = selftest()
        for f in fails:
            print('  X %s' % f)
        if fails:
            print('  => 自检 %d 条未通过' % len(fails))
            return 1
        print('  OK 自检：四类注入全部抓到，正例与隐藏区域不误报')
        return 0

    files = pages()
    all_hits = []
    for p in files:
        for h in scan_page(p):
            h['file'] = os.path.relpath(p, ROOT).replace('\\', '/')
            all_hits.append(h)

    fails = check_short_text()

    if as_json:
        print(json.dumps({'ok': not all_hits and not fails,
                          'pages': len(files), 'findings': all_hits,
                          'generator': fails}, ensure_ascii=False, indent=2))
        return 0 if (not all_hits and not fails) else 1

    print('  扫了 %d 个页面的可见文本' % len(files))
    print('')
    if all_hits:
        for h in all_hits[:20]:
            print('  X %-18s %s:%d  %s' % (h['rule'], h['file'], h['line'], h['what']))
            print('       %s' % h['why'])
            if h['near']:
                print('       附近：%s' % h['near'])
        if len(all_hits) > 20:
            print('  … 另有 %d 处' % (len(all_hits) - 20))
        print('')
    if fails:
        for f in fails:
            print('  X 生成器  %s' % f)
        print('')

    if not all_hits and not fails:
        print('  OK 可见文本没有未渲染的 Markdown、括号配平；生成器切在语义边界上')
        return 0
    print('  => %d 处可见文本问题 + %d 条生成器问题' % (len(all_hits), len(fails)))
    return 1


if __name__ == '__main__':
    sys.exit(main())
