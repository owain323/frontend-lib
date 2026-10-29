#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""do-dont-gate.py —— 每个组件都要有「反例」章，且反例不许指向不存在的东西。

为什么要有这道门禁
==================
一份只写"✅ 这么用"的文档，读者学不到**边界**。反例才是边界。
但反例是最容易写坏的一种内容：

  · 没写过的人，会写「不要滥用」这种什么也没说的话；
  · 想凑数的人，会编一个看起来很像本库的类名（`btn--danger-lg`），
    读者照着搜不到，于是整页的可信度归零；
  · 最坏的一种：反例本身是错的 —— 它禁止的其实是本库推荐的用法。

这道门禁**管不了第三种**（那是判断题，得人判），它管前两种里
**可以被机器抓住的那一半**：

  ① 章节必须在，条目数量必须够，条目必须说完整话（不是占位符）；
  ② 反例里提到的**本库标识符必须真实存在** ——
     修饰符类名（`btn--block`）、CSS 变量（`--sp-4`）、文件（`button.css`）。

② 是这道门禁真正的价值：编造的反例，**恰恰会在标识符上露馅**。
一个人可以凭想象写出流畅的理由，但写不出一个真实存在的类名 ——
除非他去读了源码。这不是"我声明没编"，是"编了会被抓"。

判据边界（诚实说明）
====================
· 只检查反引号里的 token。反引号之外的自然语言不判。
· 只检查**长得像本库标识符**的 token：
    `--x`           ⇒ CSS 变量，必须在本库 CSS 里定义过
    含 `__` / `--`  ⇒ BEM 类名，必须在本库 CSS 选择器里出现过
    带 .css/.js/.html/.md 后缀 ⇒ 文件必须在（组件目录优先，仓库根其次）
  纯小写词（`primary` / `ghost`）**不查** —— 它们是取值名，不是类名，
  查了会大面积误报，而误报会让人关掉门禁。
· "理由对不对"不判。判不了的事就说不判，不假装判了。
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAYERS = ('02-primitives', '03-patterns', '04-recipes')

# 组件 README 里允许引用、但不在组件自己目录下的公共文件
COMMON_FILES = {
    'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SUPPORT.md',
    'ACCESSIBILITY.md', 'INVARIANT.md', 'AI-CONTRACT.md', 'CONVENTIONS.md',
    'demo.html', 'index.html',
}

# 🔴 标题形式不唯一：`## 反例` / `## 两个反例` / `## 何时**不该**用` 都是同一件事。
#    只认 `## 反例` 会逼已有内容改标题 —— 那是为过门禁改文案，不是改对。
#    `**` 必须先剥掉：`何时**不该**用` 里 "不该" 和 "用" 之间隔着星号，
#    直接搜 `不该用` 是搜不到的（这条害我误判了一次 progress）。
HEAD_RE = re.compile(r'(反例|反模式|不该用|不要用|别用|不适合用)')


def head_key(ln):
    """把标题行净化成可搜的纯文本。"""
    return ln.lstrip('#').replace('*', '').replace('`', '').replace('_', '').strip()
ITEM_RE = re.compile(r'^\s*(?:[-*]\s*)?❌?\s*\*\*([^*]{2,80})\*\*\s*(.*)$')
CODE_RE = re.compile(r'`([^`]+)`')
VAR_RE = re.compile(r'^--[a-zA-Z0-9-]+$')
BEM_RE = re.compile(r'^[a-z][a-z0-9]*(__|--)[a-z0-9-]+$')
FILE_RE = re.compile(r'^[\w./-]+\.(css|js|html|md|py|json)$')

MIN_ITEMS = 3
# 🔴 阈值必须按**中文**来定，不能照英文习惯拍。
#    最初写 HEAD=8 / BODY=12，结果把「没有错误汇总」（6 个汉字，意思完整）
#    和「—— 把用户卡死」（去掉破折号 6 字，理由充分）全判成红。
#    判据过严不是"更严格"，是**逼人往句子灌水**换取通过 —— 那比不判更坏。
#    这里只拦真正没有信息量的东西：「别这样」「不行」「注意」。
MIN_HEAD = 4       # 4 个汉字已能表达一条具体禁令
MIN_BODY = 4       # 理由下限（比较前先剥掉 `——` / `：` 这类引导符）


def components():
    out = []
    for layer in LAYERS:
        d = os.path.join(ROOT, layer)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            p = os.path.join(d, name)
            if os.path.isdir(p):
                out.append((layer, name, p))
    return out


def css_text(comp_dir):
    """组件自己的 CSS + 全库 CSS（类名可能来自公共层）。"""
    files = []
    for base in (comp_dir, os.path.join(ROOT, '01-tokens')):
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames if x not in (
                'node_modules', '.git', '10-review')]
            for fn in filenames:
                if fn.endswith('.css'):
                    files.append(os.path.join(dirpath, fn))
    return files


_INDEX_CACHE = {}


def index_of(comp_dir):
    """返回 (已定义变量集合, 出现过的类名集合, 修饰符后缀集合)。

    第三个集合治的是一种**误伤**：文档里同一个组件反复出现 `card--flat` /
    `card--elevated` 之后，作者和读者都会简称 `--flat`。它不是 CSS 变量，
    但也不该被判成"编造" —— 只要某个真实类名以 `--flat` 结尾，就可解析。
    判据逼人写全名的结果，是**为了过门禁改文案**，这比不判更坏。
    """
    if comp_dir in _INDEX_CACHE:
        return _INDEX_CACHE[comp_dir]
    variables, classes = set(), set()
    for path in css_text(comp_dir):
        try:
            with open(path, 'r', encoding='utf-8', errors='replace') as fh:
                txt = fh.read()
        except OSError:
            continue
        # 去掉注释，避免注释里的示例污染索引
        txt = re.sub(r'/\*.*?\*/', ' ', txt, flags=re.S)
        for m in re.finditer(r'(--[a-zA-Z0-9-]+)\s*:', txt):
            variables.add(m.group(1))
        for m in re.finditer(r'\.(-?[a-zA-Z_][a-zA-Z0-9_-]*)', txt):
            classes.add(m.group(1))
    # 全库层（patterns 可能引用 primitives 的类）
    for layer in LAYERS:
        d = os.path.join(ROOT, layer)
        if not os.path.isdir(d):
            continue
        for name in os.listdir(d):
            sub = os.path.join(d, name)
            if sub == comp_dir or not os.path.isdir(sub):
                continue
            for path in css_text(sub):
                try:
                    with open(path, 'r', encoding='utf-8', errors='replace') as fh:
                        txt = fh.read()
                except OSError:
                    continue
                txt = re.sub(r'/\*.*?\*/', ' ', txt, flags=re.S)
                for m in re.finditer(r'\.(-?[a-zA-Z_][a-zA-Z0-9_-]*)', txt):
                    classes.add(m.group(1))
    suffixes = set()
    for cls in classes:
        if '--' in cls:
            suffixes.add(cls.split('--', 1)[1])
    _INDEX_CACHE[comp_dir] = (variables, classes, suffixes)
    return variables, classes, suffixes


_FILE_INDEX = {}


def _all_basenames():
    """全库文件名的集合（排除不该被公开文档指向的目录）。

    为什么需要它：文档里写的是 `tokens.css` 而不是 `01-tokens/tokens.css` ——
    同一份 README 里这个简称是清楚的。要求写全路径，等于为了过门禁改文案。
    """
    if _FILE_INDEX:
        return _FILE_INDEX
    skip = {'node_modules', '.git', '10-review', 'internal', 'dist'}
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in skip]
        for fn in filenames:
            _FILE_INDEX[fn] = os.path.join(dirpath, fn)
    return _FILE_INDEX


def resolve_file(comp_dir, token):
    for base in (comp_dir, ROOT, os.path.join(ROOT, '01-tokens')):
        if os.path.isfile(os.path.join(base, token)):
            return True
    if os.path.basename(token) in COMMON_FILES:
        return True
    return os.path.basename(token) in _all_basenames()


def parse_section(text):
    """抽出所有「反例」类章节的条目，**合并**统计。

    🔴 只看第一个匹配的章节是不行的：有的组件先写 `## 什么时候不该用`
    （一段散文），再写 `## 反例`（条目列表）。只取第一章会得 0 条，
    然后判它"反例太少" —— 明明是判据只看了一半。
    """
    lines = text.split('\n')
    items = []
    heads = []
    in_sec = False
    prev_blank = True
    for ln in lines:
        if re.match(r'^##\s+', ln):
            in_sec = bool(HEAD_RE.search(head_key(ln)))
            if in_sec:
                heads.append(ln.strip())
            prev_blank = True
            continue
        if in_sec:
            # 🔴 带列表标记的行天然是条目，不需要空行分隔（`- ❌ …` 连着写是常态）；
            #    只有"纯加粗开头"的行才要求另起一段 —— 否则正文里的加粗续行
            #    （`…… 对读屏\n**什么都没有**。`）会被数成独立条目，凑够数量给假绿。
            is_list = bool(re.match(r'^\s*[-*]\s', ln))
            m = ITEM_RE.match(ln) if (is_list or prev_blank) else None
            if m:
                items.append((m.group(1).strip(), m.group(2).strip(), ln.strip()))
        prev_blank = not ln.strip()
    if not heads:
        return False, [], ['没有 `## 反例` 章节（或「何时不该用」）']
    return True, items, []


def check_component(comp_dir, text):
    """返回问题列表（空 = 通过）。"""
    found, items, problems = parse_section(text)
    if not found:
        return problems
    if len(items) < MIN_ITEMS:
        problems.append('反例只有 %d 条，至少要 %d 条（读者靠它认边界）'
                        % (len(items), MIN_ITEMS))
        return problems

    variables, classes, suffixes = index_of(comp_dir)
    for head, body, raw in items:
        if len(head) < MIN_HEAD:
            problems.append('条目标题太短（%d 字）：%s' % (len(head), raw[:40]))
        # `—— 理由` / `：理由` / `- 理由` 都是正常的引导符，剥掉再数
        reason = re.sub(r'^[\s—\-–:：,，、]+', '', body).strip()
        if len(reason) < MIN_BODY:
            problems.append('条目没有说理由（只写了「%s」）' % head[:20])
        for token in CODE_RE.findall(head + ' ' + body):
            token = token.strip()
            hit = None
            if VAR_RE.match(token):
                # `--flat` 可能是变量，也可能只是 `card--flat` 的简称
                if token not in variables and token[2:] not in suffixes:
                    hit = 'CSS 变量 `%s` 在本库没有定义（也不是任何修饰符的简称）' % token
            elif BEM_RE.match(token):
                if token not in classes:
                    hit = '类名 `%s` 在本库 CSS 里不存在' % token
            elif FILE_RE.match(token):
                if not resolve_file(comp_dir, token):
                    hit = '文件 `%s` 不存在' % token
            if hit:
                problems.append(hit + '（反例不许指向不存在的东西）')
    return problems


def main():
    if '--selftest' in sys.argv:
        return selftest()
    bad = 0
    total = 0
    for layer, name, comp_dir in components():
        rp = os.path.join(comp_dir, 'README.md')
        if not os.path.isfile(rp):
            print('  FAIL %s/%s  没有 README.md' % (layer, name))
            bad += 1
            continue
        total += 1
        with open(rp, 'r', encoding='utf-8', errors='replace') as fh:
            text = fh.read()
        problems = check_component(comp_dir, text)
        if problems:
            bad += 1
            print('  FAIL %s/%s' % (layer, name))
            for p in problems[:6]:
                print('       · %s' % p)
    if bad:
        print('  ⇒ %d / %d 个组件的反例章不达标' % (bad, total))
        return 1
    print('  %d 个组件的反例章都达标（章节在、条目够、标识符真实）' % total)
    return 0


# ============================ 反向控制 ============================
GOOD = """# widget

## 用法

正文。

## 反例

- ❌ **一个视图里两个 primary** —— 两个重点等于没有重点，其余降为 ghost
- ❌ **桌面端用 `wgt--block`** —— 全宽把动线压成一条竖线，它是移动端方案
- ❌ **把间距写死 12px** —— 用 `--sp-3` 跟随主题，写死会在换皮时错位
"""

FAKE_CLASS = GOOD.replace('`wgt--block`', '`wgt--nonexistent`')
FAKE_VAR = GOOD.replace('`--sp-3`', '`--sp-999`')
FAKE_FILE = GOOD.replace('`--sp-3`', '`nope.css`')
# `--block` 是 `wgt--block` 的简称，不是变量 —— 必须放行。
# 与 ⑦（`--sp-999` 既不是变量也不是任何修饰符的简称 ⇒ 必须红）配成一对，
# 才证明"简称放行"这条没有变成后门。
MOD_SHORT = GOOD.replace('`--sp-3`', '`--block`')
SHORT_HEAD = GOOD.replace('- ❌ **一个视图里两个 primary** —— 两个重点等于没有重点，其余降为 ghost',
                          '- ❌ **别这样** —— 不行')
NO_BODY = GOOD.replace('- ❌ **桌面端用 `wgt--block`** —— 全宽把动线压成一条竖线，它是移动端方案',
                       '- ❌ **桌面端用 `wgt--block`** —— 不行')
ONLY_TWO = '\n'.join(GOOD.split('\n')[:10]) + '\n'   # 保留到第 2 条为止


def selftest():
    """每条用例指向一个**具体的**判据，且必须证明它真的会红/绿。"""
    fixture_css = os.path.join(ROOT, 'internal', 'tmp', '_dd_fixture')
    os.makedirs(fixture_css, exist_ok=True)
    with open(os.path.join(fixture_css, 'widget.css'), 'w', encoding='utf-8') as fh:
        fh.write('.wgt { color: red; }\n.wgt--block { width: 100%; }\n'
                 ':root { --sp-3: 12px; }\n')

    cases = [
        # (标签, 文本, 期望红, 期望抓到的关键字)
        # 🔴 关键字不是装饰：只断言"红"会给假绿留门 ——
        #    「只有 2 条」那次，判据实际报的是"0 条"，断言 boolean 照样通过。
        ('① 合格样本放行', GOOD, False, ''),
        ('② 缺章节要红', '# widget\n\n## 用法\n\n正文。\n', True, '没有 `## 反例`'),
        ('③ 只有 2 条要红', ONLY_TWO, True, '只有 2 条'),
        ('④ 标题太短要红', SHORT_HEAD, True, '标题太短'),
        ('⑤ 只有标题没理由要红', NO_BODY, True, '没有说理由'),
        ('⑥ 虚构类名要红', FAKE_CLASS, True, '在本库 CSS 里不存在'),
        ('⑦ 虚构 CSS 变量要红', FAKE_VAR, True, '在本库没有定义'),
        ('⑧ 不存在的文件要红', FAKE_FILE, True, '不存在'),
        ('⑨ 修饰符简称放行（不是后门）', MOD_SHORT, False, ''),
    ]
    fail = 0
    for label, text, want_bad, want_kw in cases:
        problems = check_component(fixture_css, text)
        got_bad = bool(problems)
        ok = got_bad == want_bad
        why = ''
        if ok and got_bad:
            ok = any(want_kw in p for p in problems)
            if not ok:
                why = '  ← 红了，但报的不是「%s」：%s' % (want_kw, problems[0])
        elif not ok:
            why = '  ← 期望%s，实际%s' % ('红' if want_bad else '绿',
                                        '红' if got_bad else '绿')
        print('  %s %s%s' % ('OK  ' if ok else 'FAIL', label, why))
        if got_bad and ok:
            print('       抓到：%s' % problems[0])
        fail += 0 if ok else 1
    # 清理
    try:
        for fn in os.listdir(fixture_css):
            os.remove(os.path.join(fixture_css, fn))
        os.rmdir(fixture_css)
    except OSError:
        pass
    if fail:
        print('  ⇒ 自检 %d 条不通过：判据本身是坏的，别信它的结果' % fail)
        return 2
    print('  %d 条自检全绿（含 5 条必须红的反例）' % len(cases))
    return 0


if __name__ == '__main__':
    sys.exit(main())
