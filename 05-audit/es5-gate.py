#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
es5-gate.py — 库代码的语法必须是 ES5

背景
------------------
精简档 是 **某项目 上的 WebView，版本不确定**。
所以 `01-tokens` / `02-primitives` / `03-patterns` 里的**库代码**必须只用 ES5 ——
ES6+ 在老 WebView 上是**语法错误**（整段脚本不执行，而不是降级）。

🔴 这条约束**曾经只写在各个 .js 的注释里**（「语法刻意用 ES5」），
**charter 里没有、也没有任何门禁在守** ——
典型的「看起来有约定，实际没人管」。
现收口到 charter + 本门禁。

**豁免**：`demo.html` 与 `04-recipes/**` 可以用现代语法 ——
它们是给人读的说明材料与自包含范例，**不部署到设备**。

判据
----
库代码里出现以下之一即失败：
  · `const` / `let`（词边界，排除注释里的文字）
  · 箭头函数 `=>`
  · 模板字符串（反引号）
  · 展开/剩余 `...`
  · `class` / `async` / `await`
  · 可选链 `?.` / 空值合并 `??`
  · CSS 里的 `:has()`

用法：python 05-audit/es5-gate.py

———
🔴 附：为什么本库**不能**对 `border-left: 2px+` 做一刀切
------------------------------------------------
提示框的左侧竖条被评价为"很蠢"，已从全库去掉。
但扫全库时会发现还剩 5 处 —— **它们必须留着**，逐条判定如下：

| 位置 | 选择器 | 为什么留 |
|---|---|---|
| `content.css` + `longform` ×3 | `.prose > blockquote` | **引言块的竖条是排版惯例**（Markdown 渲染出来就是这样），去掉就跟别的文档站长得不一样了 |
| `content.css` + `longform` | `.prose > pre` | 代码块的"左侧边线"同样属于代码块语汇，且配合 `border-radius: 0 r-sm r-sm 0` 的不对称圆角 |
| `nav.css` | `.toc__link` | 目录树的**层级指示线**，是"这在目录里的第几层"的信息，不是装饰 |

⇒ 判据：**竖条是"结构指示"就留，是"纯装饰"就去。**
本门禁不做这条检查（判断需要语义），只在注释里记下判据。
"""
import sys
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 🔴 补上 09-assets：原来只有 01/02/03，
#    导致 sparkline.js / echarts-adapter.js **从来没被 ES5 门禁检查过**
#    （实测：「ES5 合规：0 个库文件」——因为它们的目录不在范围里）。
#    ⚠️ 本库的硬约束是「JS 一律 ES5」，**素材层同样是库的一部分**。
LIB_DIRS = ('01-tokens', '02-primitives', '03-patterns', '09-assets')

# 逐条：正则 + 说明
JS_RULES = [
    (re.compile(r'(?<![\w$.])const\s'), 'const'),
    (re.compile(r'(?<![\w$.])let\s'), 'let'),
    (re.compile(r'=>'), '箭头函数'),
    (re.compile(r'`'), '模板字符串'),
    (re.compile(r'\.\.\.'), '展开/剩余'),
    (re.compile(r'(?<![\w$.])class\s'), 'class'),
    (re.compile(r'(?<![\w$.])async\s'), 'async'),
    (re.compile(r'(?<![\w$.])await\s'), 'await'),
    (re.compile(r'\?\.', re.S), '可选链 ?.'),
    (re.compile(r'\?\?', re.S), '空值合并 ??'),
]
CSS_RULES = [
    (re.compile(r':has\('), ':has()'),
]


def strip_comments_js(src):
    src = re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'),
                  src, flags=re.S)
    src = re.sub(r'(?<![:"\'])//[^\n]*', '', src)
    src = re.sub(r'(["\'])(?:\\.|(?!\1)[^\\\n])*\1', lambda m: '""', src,
                  flags=re.S)          # 字符串字面量
    return src


def strip_comments_css(src):
    return re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'),
                  src, flags=re.S)


def main():
    # 🔴 **修一个一直在骗人的假绿**
    #
    # 原来：`root = sys.argv[1]`
    #   而门禁入口统一是 `es5-gate.py --dir .`
    #   ⇒ argv[1] 是 `'--dir'` ⇒ root 变成 `<库>/--dir`（不存在）
    #   ⇒ **扫了 0 个文件** ⇒ 0 个违规 ⇒ **显示 PASS**
    #
    # ⚠️ 这是最危险的一类假绿：**门禁形同虚设，却一直报"通过"**。
    #   实测证据：传 `.` 时扫 26 个文件；传 `--dir .` 时扫 **0 个**。
    #
    # ⇒ 修：跳过所有 `--` 开头的 flag，取第一个位置参数。
    root = ROOT
    for a in sys.argv[1:]:
        if not a.startswith('-'):
            root = os.path.abspath(a)
            break

    issues = []
    files = 0
    skipped = []
    for base in LIB_DIRS:
        for f in glob.glob(os.path.join(root, base, '**', '*.js'),
                           recursive=True):
            # 🔴 豁免 `vendor/`：**第三方库，不是本库代码**
            #    （three.min.js / GLTFLoader.js / OrbitControls.js 是 ES6，
            #      它们**点击后才加载**，且精简档 根本不用 3D —— 见
            #      09-assets/model-viewer/README.md 的「边界」一节）
            #    ⚠️ 豁免的必须是**明确的第三方目录**，不允许通配。
            if 'vendor' in f.split(os.sep) or 'vendor' in f.split('/'):
                skipped.append(os.path.relpath(f, root))
                continue
            files += 1
            src = strip_comments_js(open(f, encoding='utf-8').read())
            for line_no, ln in enumerate(src.split('\n'), 1):
                for pat, name in JS_RULES:
                    if pat.search(ln):
                        issues.append((os.path.relpath(f, root).replace('\\', '/'),
                                       line_no, name, ln.strip()[:50]))
        for f in glob.glob(os.path.join(root, base, '**', '*.css'),
                           recursive=True):
            files += 1
            src = strip_comments_css(open(f, encoding='utf-8').read())
            for line_no, ln in enumerate(src.split('\n'), 1):
                for pat, name in CSS_RULES:
                    if pat.search(ln):
                        issues.append((os.path.relpath(f, root).replace('\\', '/'),
                                       line_no, name, ln.strip()[:50]))

    for rel, ln, name, txt in issues:
        print('  [es5-gate] %-34s L%-4d %-12s %s' % (rel, ln, name, txt))
    print('')
    if issues:
        print('%d 处 ES6+ —— 精简档 的老 WebView 上会**语法错误**（脚本整段不执行）。' % len(issues))
        print('  改法：换回 ES5 写法（var + function + 字符串拼接）。')
        return 1
    # 🔴 **空跑即失败**
    #   0 个文件 = 一定是路径传错了（root 解析失败）。
    #   没有这一步，这个门禁可以在"什么都没扫"的情况下一直报通过
    #   ——**它已经这样骗了我们很久**。
    if files == 0:
        print('[FAIL] 扫到 0 个文件 —— 路径解析有问题，**本门禁等于没跑**。')
        print('       期望至少扫到 01-tokens / 02-primitives / 03-patterns / 09-assets 下的文件。')
        print('       查：main() 里的 root 是否把 `--dir` 当成路径了。')
        return 1
    if skipped:
        print('（已豁免 vendor/ 第三方库 %d 个 —— 不是本库代码）' % len(skipped))
    print('ES5 合规：%d 个库文件全部通过（demo 与 recipe 豁免）。' % files)
    return 0


if __name__ == '__main__':
    sys.exit(main())
