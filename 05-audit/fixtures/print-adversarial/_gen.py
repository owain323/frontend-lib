# -*- coding: utf-8 -*-
"""生成 print-gate 的六个对抗夹具（50 页 / 一行表 / 200 列 / 嵌套浮层 / 近空白页 / 单块超一页）。

为什么要用脚本生成而不是手写：50 页和 200 列手写必然写错一个数字，
而错一个数字的夹具听起来仍然"通过"—— 它测的就不是原来那个极端了。
生成器留在库里，改规模是改一个常量，不是改 200 个 <td>。

用法：
    python 05-audit/fixtures/print-adversarial/_gen.py
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))

HEAD = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
  @page {{ size: A4; margin: 12mm 10mm; }}
  body {{ margin: 0; font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
          color: #15181c; background: #fff; }}
  h1 {{ font-size: 20px; margin: 0 0 10px; }}
  h2 {{ font-size: 16px; margin: 0 0 8px; }}
  p {{ margin: 0 0 6px; }}
{extra}
</style>
</head>
<body>
{body}
</body>
</html>
"""


def write(name, title, body, extra=""):
    path = os.path.join(HERE, name)
    with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(HEAD.format(title=title, body=body, extra=extra))
    print("写入 %-28s %6d 字节" % (name, os.path.getsize(path)))


# ---------------------------------------------------------------- ① 50 页
N_PAGES = 50
sections = []
for i in range(1, N_PAGES + 1):
    sections.append(
        '  <section>\n'
        '    <h2>第 %d 页 / 共 %d 页</h2>\n'
        '    <p>这一页是夹具生成的固定内容，用来把页数顶到 %d。'
        '每段都带自己的页码，出问题时能一眼看出是第几页塌了。</p>\n'
        '    <p>PAGE-%02d-MARKER</p>\n'
        '  </section>' % (i, N_PAGES, N_PAGES, i)
    )
write(
    "01-fifty-pages.html",
    "%d 页" % N_PAGES,
    "\n".join(sections),
    # 最后一段不再强制分页，否则会多出一张只有页眉的空页
    "  section { break-after: page; }\n"
    "  section:last-child { break-after: auto; }",
)

# ---------------------------------------------------------------- ② 一行表
write(
    "02-one-row-table.html",
    "一行表",
    '  <h1>只有一行数据的表</h1>\n'
    '  <p>表的标题行必须只出现一次。若打印引擎把 thead 重复到第二页，'
    '页数会变成 2，而第二页只有一行表头 —— 这就是要抓的那个缺陷。</p>\n'
    '  <table>\n'
    '    <thead><tr><th>科目</th><th>本期</th><th>上期</th><th>变动</th><th>说明</th></tr></thead>\n'
    '    <tbody>\n'
    '      <tr><td>营业收入</td><td>1,284</td><td>1,103</td><td>+16.4%</td>'
    '<td>主因是华东区新增两家经销商</td></tr>\n'
    '    </tbody>\n'
    '  </table>',
    "  table { width: 100%; border-collapse: collapse; break-inside: avoid; }\n"
    "  th, td { border: 1px solid #c9ced6; padding: 6px 8px; text-align: left; font-size: 12px; }\n"
    "  th { background: #f4f6f8; }",
)

# ---------------------------------------------------------------- ③ 200 列
N_COLS = 200
head_cells = "".join("<th>C%03d</th>" % c for c in range(1, N_COLS + 1))
rows = []
for r in range(1, 4):
    cells = "".join("<td>%d.%d</td>" % (r, c) for c in range(1, N_COLS + 1))
    rows.append("    <tr>%s</tr>" % cells)
table_200 = (
    "  <h1>%d 列的表</h1>\n"
    "  <p>%d 列在 A4 上无论如何都放不下。这份夹具**应该**被判出横向溢出；"
    "下面那份 fixed 版本是它的对照，证明判据不是「见到大表就红」。</p>\n"
    "  <table>\n    <thead><tr>%s</tr></thead>\n    <tbody>\n%s\n    </tbody>\n  </table>"
    % (N_COLS, N_COLS, head_cells, "\n".join(rows))
)
write(
    "03-200-cols.html",
    "%d 列" % N_COLS,
    table_200,
    "  table { border-collapse: collapse; }\n"
    "  th, td { border: 1px solid #c9ced6; padding: 2px 4px; font-size: 10px; white-space: nowrap; }",
)

# 对照组：同样的 200 列，但列宽被压进纸面
write(
    "03b-200-cols-fixed.html",
    "%d 列（压进纸面）" % N_COLS,
    table_200.replace("**应该**被判出横向溢出", "已经压进纸面，不该溢出")
    .replace(
        "下面那份 fixed 版本是它的对照，证明判据不是「见到大表就红」。",
        "这是对照：列宽被压进纸面，判据不该红。",
    ),
    "  table { border-collapse: collapse; table-layout: fixed; width: 100%; }\n"
    "  th, td { border: 1px solid #c9ced6; padding: 0; font-size: 4px;\n"
    "           overflow: hidden; white-space: nowrap; }",
)

# ---------------------------------------------------------------- ④ 嵌套浮层
write(
    "04-nested-overlays.html",
    "嵌套浮层",
    '  <h1 id="page-title">正文标题：这张纸不能被浮层吃掉</h1>\n'
    '  <p>屏幕上有两层叠着的对话框。打印时两层都要落回正常流，'
    '而且正文标题必须还在 —— 谁要是用 visibility:hidden 处理遮罩，正文就没了。</p>\n'
    '  <div class="dialog-backdrop" id="bd-a">\n'
    '    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="t-a">\n'
    '      <h2 class="dialog__title" id="t-a">外层对话框 A</h2>\n'
    '      <div class="dialog__body">外层的内容也要印在纸上。</div>\n'
    '    </div>\n'
    '  </div>\n'
    '  <div class="dialog-backdrop" id="bd-b">\n'
    '    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="t-b">\n'
    '      <h2 class="dialog__title" id="t-b">内层对话框 B</h2>\n'
    '      <div class="dialog__body">内层的内容同样不能丢。</div>\n'
    '    </div>\n'
    '  </div>',
    # 用真库的样式，不用自己编一套：编一套就只能证明"我编的那套没问题"
    "",
)
# 这份要引真 CSS，单独补 <link>
p = os.path.join(HERE, "04-nested-overlays.html")
html = io.open(p, encoding="utf-8").read()
html = html.replace(
    "</style>",
    "</style>\n"
    '<link rel="stylesheet" href="../../../01-tokens/tokens.css">\n'
    '<link rel="stylesheet" href="../../../03-patterns/overlay/overlay.css">',
)
io.open(p, "w", encoding="utf-8", newline="\n").write(html)

# ---------------------------------------------------------------- ⑤ 近空白页
write(
    "05-near-blank.html",
    "近空白页（有字）",
    '  <h1>·</h1>\n'
    '  <p>上面那行只有一个字符。它仍然是文字：判据 ⑫ 不该把它算成"没有文本算子的页"。</p>',
)

write(
    "05b-blank-first-page.html",
    "近空白页（首屏无字）",
    '  <div class="spacer"></div>\n'
    '  <h1>这一页在第一张纸之后</h1>\n'
    '  <p>第一张纸上只有一块空白占位，没有任何文字 —— 判据 ⑫ 必须报出来。</p>',
    "  .spacer { height: 700px; break-after: page; }",
)

# 中间一页无字：单张文档抓不出"哪一页没字"，
# 🔴 这条专门盯 ⑫ 的算法：它算的是 `页数 − 文本流数`（一个差），
#    不是"逐页有没有字"。差能报出总数，但不能定位；三页文档才能验证它没退化成恒 0。
write(
    "05c-blank-middle-page.html",
    "近空白页（中间一页无字）",
    '  <h1>第一页</h1>\n'
    '  <p>第一页有字。</p>\n'
    '  <div class="gap"></div>\n'
    '  <h1>第三页</h1>\n'
    '  <p>第二页只有一块空白占位，一个字都没有。</p>',
    "  .gap { height: 500px; break-before: page; break-after: page; }",
)

# ---------------------------------------------------------------- ⑥ 单块超一页
paras = "\n".join(
    "    <p>第 %d 段：这段文字属于一个整体不可拆的块。整块比 A4 还高，"
    "打印引擎只有两个选择 —— 拆开它，或者裁掉后半截。</p>" % i
    for i in range(1, 41)
)
write(
    "06-block-over-one-page.html",
    "单块超一页",
    '  <h1>一个比纸还高的块</h1>\n'
    '  <div class="unbreakable">\n%s\n  </div>' % paras,
    "  .unbreakable { break-inside: avoid; border: 1px solid #c9ced6; padding: 10px; }",
)

# 对照组：同样的字，但允许拆分。
# 🔴 为什么要它：判断"单块超一页有没有静默丢字"，唯一可靠的尺子就是
#    "同样的内容、允许拆分时 run 数是多少"。没有对照组，
#    "页数 2、run 数 900"这种结果既可能是完整印出，也可能是被裁掉了三成。
write(
    "06b-block-breakable.html",
    "单块超一页（对照组，允许拆分）",
    '  <h1>一个比纸还高的块（允许拆分）</h1>\n'
    '  <div class="breakable">\n%s\n  </div>' % paras,
    "  .breakable { border: 1px solid #c9ced6; padding: 10px; }",
)

print("完成，共 7 个文件（6 个对抗面）")
