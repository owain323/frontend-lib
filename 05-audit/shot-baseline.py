#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
shot-baseline.py — 视觉回归基线（总 G2）

===========================================================================
🔴 为什么必须有这个门禁
---------------------------------------------------------------------------
  现有 33 道契约验的全是**行为**（能不能点、焦点在哪、能不能用键盘）。
  它们**验不了观感** —— 改坏了一行 CSS：
      · 按钮变成方的（border-radius 被删）
      · 卡片阴影没了
      · 暗色下文字看不清
    ⇒ **33 道契约全绿**，但用户看到的是坏的。

  唯一能自动发现这类问题的方式：**存基准截图 + 逐像素 diff**。

===========================================================================
⚠️ 三个必须做对的地方（都是"看起来能用，一用就露馅"的）
---------------------------------------------------------------------------
  ① **diff 阈值要可讨论**
     太松（如 >5% 像素不同）⇒ 明显改坏了也通过 ⇒ 等于没门禁
     太严（如 >0.05%）⇒ 字体渲染的亚像素抖动会天天假红 ⇒ 会被无视
     ⇒ 本脚本默认 **1.0%**，可用 `--threshold` 调，并在报告里写明"改了多少"。

  ② **基线必须能更新，否则第一次改就被卡住**
     ⇒ `--update` 显式重录。**不允许"自动更新"** ——
        自动更新等于"永远通过"，是视觉门禁最常见的死法。

  ③ **逐像素 diff 要用"容忍度"（抗锯齿噪声）**
     同一份代码在不同机器/不同 GPU 上渲染会有几个像素的差异。
     ⇒ 用 `tolerance`（默认 12/255）忽略微小色差，
        否则每个开发者都会被假红烦到关掉门禁。

===========================================================================
🔴 G2-06D：**一次加载拍三套**（浅色 / 暗色 / RTL）
---------------------------------------------------------------------------
  原来三套各跑一次本脚本，每页至少被加载两次，RTL 子集再第三次：
  47 + 47 + 15 = **109 次加载**。现在 **47 次**，图还是 109 张。

  合并的**前提**不是"看起来一样"，而是逐字节一样：
      109 / 109 张与三套既有基线**逐字节相同**（`--check` 会打出这个数）。
  任何一张不同 ⇒ 整个合并作废；不许用 `--update` 把差异盖过去。

  ⚠️ 合并唯一的真风险是**状态污染**（主题 / dir / 滚动位置 / 组件交互状态
     从上一张图漏到下一张）。所以顺序是 浅 → RTL → 暗，每页重新 goto、
     媒体特性每页重设、dir 按**加载时的原值**复位。
  ⚠️ 冻结 CSS 的覆盖范围要**枚举到实际会动的选择器**（E241）：
     `*` 选不到 UA shadow 里的 `::file-selector-button`，它自带 120ms 过渡，
     切暗色时照跑 ⇒ 会截到中间态。补上那条之后，"切完立刻拍"即逐字节一致，
     不需要任何 sleep 魔法数字。
  ⚠️ 门禁条目从三条（visual / visual-dark / visual-rtl）合成一条（visual），
     所以**条目数** 225 → 223；判据数没变（仍是 109 张）。别拿条目数当覆盖率。

===========================================================================
用法
---------------------------------------------------------------------------
  python 05-audit/shot-baseline.py --record     # 录基线（三套一次录完）
  python 05-audit/shot-baseline.py --check      # 门禁：一次加载拍三套并逐套 diff
  python 05-audit/shot-baseline.py --update     # 显式重录（改 CSS 前先问自己）
  python 05-audit/shot-baseline.py --list       # 列出所有受管页面
  python 05-audit/shot-baseline.py --check --threshold 2.0
  python 05-audit/shot-baseline.py --check --scheme dark   # 只复现暗色这一套
  python 05-audit/shot-baseline.py --check --dir rtl       # 只复现 RTL 这一套
"""
import sys
import os
import io
import json
import glob
import subprocess
import shutil


def _hard_rmtree(path):
    """真删目录，**不进回收站**。

    为什么不用 `shutil.rmtree`：某些托管环境会在 Python 启动时注入
    `sitecustomize`，把 `os.remove` / `shutil.rmtree` / `pathlib` 的删除 API
    统统改写成"送回收站"（本机实测：WorkBuddy 的 safe-delete shim，
    `os.unlink` 等于 `_safe_remove`）。
    后果不是"删错"，而是**删了但空间没回来**：`_current` 每轮 16.9 MB，
    50 轮就是 845 MB，而且用户看到的是「截图目录一直在往回收站堆」。

    `cmd /c rd /s /q` 是 cmd 内建命令，不经过 Python 层、也不经过 bash 的
    `rm` 函数 ⇒ 不受任何 shim 影响。POSIX 上没有这个问题，直接 rmtree。
    """
    if sys.platform == 'win32':
        r = subprocess.run(
            ['cmd', '/c', 'rd', '/s', '/q', os.path.normpath(path)],
            capture_output=True,
        )
        if r.returncode == 0 or not os.path.exists(path):
            return
    shutil.rmtree(path)


class _ShootFailed(RuntimeError):
    """截图环节失败——必须让整道门禁失败，绝不能继续比 diff。"""


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, '10-review', 'shots')
BASELINE = os.path.join(SHOTS, '_baseline')
CURRENT = os.path.join(SHOTS, '_current')
DIFFS = os.path.join(SHOTS, '_diff')

# ===========================================================================
# 🔴 基线**按平台分集**（0.11.9 加 · 起因是这道门禁第一次在 CI 上跑）
# ---------------------------------------------------------------------------
#   本库不含任何 `@font-face`：字体全靠系统栈
#   （`Segoe UI` / `Microsoft YaHei` / `PingFang SC` / `Noto Sans CJK SC` …）。
#   同一份 HTML 换到 Linux，前面那几个字体**一个都不存在** ⇒ 落到别的字体
#   ⇒ 字宽、行高、换行位置全变 ⇒ 整页像素差 7~11%，单块最差处 60~97%。
#
#   2026-10-29：门禁第一次在 ubuntu 上跑，42 张基线**全红**。
#   基线没错，代码也没错 —— 错的是「把一台机器的渲染当成所有机器的标准」。
#
#   ⇒ 与 Playwright `toHaveScreenshot` 同一策略：基线目录名带平台
#     `_baseline-<平台>[-<scheme>][-rtl]`，各平台各存一套、互不覆盖。
#
#   ⚠️ 这不叫"跳过"：某平台没有基线集时，这门门禁在该平台**直接判红**，
#      并说清去哪弄。没有基线就**不许**说"观感没变"。
#   ⚠️ 同一平台内的字体差异（Win10 vs Win11、改 DPI、换字体）仍可能红 ——
#      那是对的：这时要么在本机重录，要么承认这台机器判不了。
# ===========================================================================
PLAT = {'win32': 'win32', 'linux': 'linux', 'darwin': 'darwin'}.get(
    sys.platform, sys.platform)   # 未知平台就用原值（本身就是文件名安全的）


# 🔴 明暗两套基线（0.9.0 加）。
#   `visual` 此前**只拍浅色** —— 而 D1/D3/D5 三项改造都要动 CSS，
#   暗色坏了没有任何门禁能发现（token-resolved 只覆盖令牌解析值，
#   覆盖不了阴影叠加 / 渐变 / 伪元素 / 图片资源在暗色下的实际观感）。
#   ⇒ 浅色仍是默认（目录名不带后缀，现有基线与路径**一个字节不变**），
#     暗色走 `--scheme dark`，落到 `-dark` 后缀的目录。
SCHEME = 'light'

# ---------------------------------------------------------------------------
# 受管页面（每个组件的 demo）
# ⚠️ 刻意**不包含**：01-tokens/focus-ring-demo、responsive-demo 等基建页 ——
#    它们改动频繁但不是"组件观感"，混进来只会让门禁变吵。
# ---------------------------------------------------------------------------
PAGES = [
    ('02-primitives/button',      'demo.html', '按钮'),
    ('02-primitives/input',       'demo.html', '输入框'),
    ('02-primitives/card',        'demo.html', '卡片'),
    ('02-primitives/badge',       'demo.html', '徽标'),
    ('02-primitives/delta',       'demo.html', '变化量'),
    ('02-primitives/choice',      'demo.html', '单选/复选'),
    ('02-primitives/switch',      'demo.html', '开关'),
    ('02-primitives/select',      'demo.html', '下拉选择'),
    ('02-primitives/combobox',    'demo.html', '组合框'),
    ('02-primitives/date-range',  'demo.html', '日期区间'),
    ('02-primitives/metric',      'demo.html', '指标块'),
    ('02-primitives/timeline',    'demo.html', '时间轴'),
    ('02-primitives/separator',   'demo.html', '分隔线'),
    ('03-patterns/list',          'demo.html', '列表'),
    ('03-patterns/content',       'demo.html', '正文'),
    ('03-patterns/states',        'demo.html', '状态'),
    ('03-patterns/form-validation', 'demo.html', '表单校验'),
    ('03-patterns/nav',           'demo.html', '导航'),
    ('03-patterns/overlay',       'demo.html', '弹层/toast'),
    ('03-patterns/tree',          'demo.html', '树形视图'),
    ('03-patterns/drawer',        'demo.html', '抽屉'),
    ('03-patterns/dropdown',      'demo.html', '下拉菜单'),
    ('03-patterns/tooltip',       'demo.html', '文字提示'),
    # ⭐ 下面这批是**补进来的**（原先漏了 ⇒ 覆盖缺口）：
    #    实测事故：tabs.css / accordion.css 改了"边框属性名"这种
    #    **会改变观感**的东西，而这两个组件**根本没有视觉基线**
    #    ⇒ 改坏了也无人报警。补齐的原则：**有 CSS 且有 demo 的，一律纳入。**
    #    （09-assets/echarts-adapter 不纳入：无 CSS，且依赖外部 CDN。）
    ('02-primitives/popover',     'demo.html', '气泡卡片'),
    ('02-primitives/progress',    'demo.html', '进度条'),
    ('02-primitives/skeleton',    'demo.html', '骨架屏'),
    ('02-primitives/upload',      'demo.html', '文件上传'),
    ('03-patterns/accordion',     'demo.html', '折叠面板'),
    ('03-patterns/pagination',    'demo.html', '分页'),
    ('03-patterns/tabs',          'demo.html', '选项卡'),
    ('03-patterns/reveal',        'demo.html', '入场动效'),
    ('09-assets/model-viewer',    'demo.html', '模型查看器'),
    ('09-assets/sparkline',       'demo.html', '迷你图'),
    ('04-recipes/table',          'demo.html', '表格'),
    ('09-assets/bar',             'demo.html', '柱状图'),
    ('10-review/composition',     'demo.html', '组合页'),
    # ⭐ 2026-10-10 新增（FL-NEXT-01 / VIZ-02 交付物接入现有机制，不另建截图框架）：
    #    原则不变 —— 有 CSS 且有 demo 的一律纳入。
    ('04-recipes/analysis-report', 'demo.html', '组合型研究报告'),
    ('04-recipes/app-shell',      'demo.html', '应用外壳'),
    ('04-recipes/report',          'demo.html', '研究报告'),
    ('04-recipes/data-showcase',   'demo.html', '数据展示对照'),
    ('04-recipes/detail-page',    'demo.html', '详情页-入口'),
    ('04-recipes/detail-page',    'full.html', '详情页-完整数据'),
    ('04-recipes/detail-page',    'partial.html', '详情页-部分缺失'),
    ('04-recipes/detail-page',    'null.html', '详情页-无数据'),
    ('09-assets/scientific-plot',  'demo.html', '科学绘图'),
    # ⭐ 2026-10-27 新增：组合示例页（examples/）也纳入回归。
    #    理由：它是"库能拼成什么样"的活证据，坏掉不会被任何组件门禁发现
    #    —— 单个组件都对、组合起来错位，正是组件库最典型的失败方式。
    #    ⚠️ 加入前已确认 40/40 页像素一致（本页是新增，不参与那 40 页的比对）。
    ('examples/finance-report',    'index.html', '金融分析示例页'),
    # 接入样板（0.11.15）：它是**唯一**证明 esm/ 入口在真实浏览器里能用的页面，
    # 所以更要有视觉基线 —— 这页改坏了，"证明"就悄悄失效了。
    ('examples/esm-native',        'index.html', '接入样板-原生 ESM'),
]

# ---------------------------------------------------------------------------
# RTL 受管页面（`--dir rtl`）
# ---------------------------------------------------------------------------
# 🔴 为什么**不**是全部 41 页
# ---------------------------------------------------------------------------
#   视觉基线只有一个职责：拦住"观感回归"。而在 RTL 下，回归的形态只有两类
#   会**随书写方向改变**：
#     · 布局镜像错了（侧栏跑到另一边、箭头留在错的一侧、上/下一页顺序反了）
#     · 字形没翻（▶ 仍指向右）
#   而纯文本页、纯色块页（separator / skeleton / progress / sparkline /
#   model-viewer …）在 RTL 下与 LTR 是同一套盒模型 —— 多录一张只是把仓库
#   再撑大一倍，不会多抓到任何一个 bug。**基线数量不是覆盖率。**
#
#   反过来，左右不对称的页面一旦镜像错，**既不横向溢出、也不改字形** ——
#   `rtl-render.js` 的三条判据全都看不见它；`rtl-check.js` 只查物理属性，
#   也查不到"属性用对了但摆错了"。这才是 RTL 视觉基线唯一能补的那块。
#
#   ⇒ 收录规则（三条任一命中就收，每行注明命中的是哪条）：
#       (a) 含方向性字形                (b) 左右不对称的槽位/边框/圆角/滑入方向
#       (c) 顺序有语义（上/下一页、首列、步骤）
#   ⚠️ 新增组件命中 (a)(b)(c) 时**必须**加进这张表，否则它的 RTL 观感
#      没有任何门禁看着。这条写进了 CONTRIBUTING。
#
#   ⚠️ 基线只能证明"没变"，不能证明"本来就对"。第一次录制会把**当前状态**
#      一并祝福下来。所以下面这 13 页录完做了一次人工目检（结论见
#      docs/ACCESSIBILITY.md 的 RTL 段），目检能看出"镜像错了"，
#      而基线永远看不出来。
RTL_PAGES = [
    ('03-patterns/tree',          'demo.html',   '树形视图',   'a 方向性字形 ▶/◀ + 层级引导线'),
    ('03-patterns/list',          'demo.html',   '列表',       'b 前置/后置槽位'),
    ('03-patterns/nav',           'demo.html',   '导航',       'b 侧栏在左'),
    ('03-patterns/pagination',    'demo.html',   '分页',       'c 上一页/下一页顺序'),
    ('03-patterns/tabs',          'demo.html',   '选项卡',     'c 顺序 + 指示条位置'),
    ('03-patterns/accordion',     'demo.html',   '折叠面板',   'a 展开箭头 + b 标题侧'),
    ('03-patterns/dropdown',      'demo.html',   '下拉菜单',   'b 菜单对齐边'),
    ('03-patterns/drawer',        'demo.html',   '抽屉',       'b 从哪一侧滑入'),
    ('04-recipes/table',          'demo.html',   '表格',       'c 首列/数字列对齐'),
    ('04-recipes/detail-page',    'full.html',   '详情页-完整数据', 'b 侧栏栅格'),
    ('10-review/composition',     'demo.html',   '组合页',     'b 多栏栅格'),
    ('02-primitives/button',      'demo.html',   '按钮',       'b 图标与文字间距（最小样本）'),
    ('02-primitives/delta',       'demo.html',   '变化量',     'c 符号在数字前/后 + 方向箭头'),
    ('02-primitives/metric',      'demo.html',   '指标块',     'b 单位与数字的先后'),
    ('09-assets/bar',             'demo.html',   '柱状图',     'c 坐标轴方向'),
]

DIRN = 'ltr'               # 'ltr' | 'rtl'，由 `--dir` 指定
VIEWPORT = (393, 852)      # iPhone 尺寸：移动端是这个尺寸


def managed():
    """本次运行真正受管的页面（LTR 全集 / RTL 子集）"""
    return RTL_PAGES if DIRN == 'rtl' else PAGES



def _which_node():
    """找 managed node（与其它门禁同一套）"""
    # 🔴 原来这里写的是字面量 '${HOME}/.toolchain/...'（**没做变量展开**）
    #    ⇒ 这个候选永远不存在，直接掉到系统 node；
    #    而系统 node 上没有 puppeteer ⇒ 一张截图都截不出来 ⇒
    #    视觉回归「未执行」但看不出是环境问题（E35）。
    #⇒ 用 os.path.expanduser 真正展开，并额外认 NODE_DIR 环境变量。
    home = os.path.expanduser('~')
    nd = os.environ.get('NODE_DIR', '')
    cands = [
        # ⚠️ NODE_DIR 可能是**目录**（check-all.sh 里就是这么传的），
        #    直接丢给 CreateProcess 会 WinError 5 ⇒ 这里补上 node.exe
        os.path.join(nd, 'node.exe') if nd else '',
        os.path.join(home, '.toolchain', 'binaries', 'node',
                     'versions', '22.17.0', 'node.exe'),
    ]
    for c in cands:
        if c and os.path.exists(c):
            return c
    return shutil.which('node') or shutil.which('node.exe')


def shot_name(d, f):
    """
    截图文件名。**写入侧与比对侧必须共用这一个函数**。

    🔴 一起真实假绿（陌生人 clone 才暴露）：
       写入侧用 `d + '_' + f` ⇒ `02-primitives_button_demo.html`
       比对侧却 glob `*.png` 并找同名 `02-primitives_button.png`
       ⇒ **两边从来不是同一批文件**。

       本地之所以还能"全绿"，是因为 `_current/` 里**残留着前一天的 .png**，
       比对拿那些旧图去比基线 ⇒ 恒等 ⇒ 恒绿。
       新 clone 的 `_current/` 是空的 ⇒ 23 页全部"当前截图缺失" ⇒ 真红。

       ⇒ 也就是说：这道门禁在过去一段时间里**根本没有在比较本次的截图**。
         它测的是"上次残留的图是否等于基线"—— 恒真。

    修法：两侧共用本函数，命名不可能再分叉；
          且比对侧若发现 `_current` 为空必须**判失败**，不能静默跳过。
    """
    stem = os.path.splitext(f)[0]
    # demo.html 沿用旧名（改名会让已有 40 张基线集体变成"缺失"，那是自造假红）；
    # 同一目录下的其它页面（full / partial / null …）必须带上自己的名字，
    # 否则会**互相覆盖** —— 2026-10-23 实测：detail-page 的四个页面只产出 1 张 PNG。
    if stem == 'demo':
        return d.replace('/', '_') + '.png'
    return d.replace('/', '_') + '_' + stem + '.png'


def _pages_exist():
    out = []
    for row in managed():
        d, f, label = row[0], row[1], row[2]
        p = os.path.join(ROOT, d, f)
        if os.path.exists(p):
            out.append((d, f, label, p))
        else:
            print('  [skip] 页面不存在：%s/%s' % (d, f))
    return out


SHOOT_JS = r"""
/* ==========================================================================
 * G2-06D：**一次页面加载 → 三套截图**
 * --------------------------------------------------------------------------
 * 原来三套（浅色 / 暗色 / RTL）各跑一次本脚本 ⇒ 每页至少被加载两次（浅 + 暗），
 * RTL 子集再第三次：47 + 47 + 15 = 109 次加载。现在 47 次。
 *
 * 顺序是**浅 → RTL → 暗**，不是随手排的：
 *   · 暗色是唯一"改主题"的一步，放最后 ⇒ 每页只切一次主题；
 *   · RTL 基线本来就是在**浅色**下拍的，所以 RTL 必须排在暗色之前；
 *   · 拍完 RTL 立刻把 dir 复位成**加载时的原值**（不是写死 ltr）——
 *     暗色基线是 LTR 的，带着 rtl 去拍就是"暗色 + RTL"的混合体。
 *
 * ⚠️ 这一步唯一的真风险是**状态污染**：主题、dir、滚动位置、组件交互状态
 *    都可能从上一张图漏到下一张。所以每页都从头 goto、媒体特性每页重设、
 *    dir 按原值复位。任何一张图不一致 ⇒ 整个合并不成立（G2-06D 工单）。
 */
const fs = require('fs');
// 🔴 用**绝对路径** require，而不是 require('05-audit/browser.js')
//   ——后者依赖进程的 CWD 恰好是仓库根。一旦从别处调用本脚本，
//     它就找不到模块（实测踩过：Cannot find module '05-audit/browser.js'），
//   而截图失败原先只打印一行 ⇒ 视觉回归"假通过"。
const { launch } = require(process.env.FL_BROWSER || './browser.js');
const TASKS = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

/* 冻结动画 / 过渡。
 * 🔴 `*` **选不到 UA shadow 里的伪元素**（E241，实测）：
 *    `<input type=file>` 的 `::file-selector-button` 自带
 *    `transition: background var(--dur-fast)`（120ms）。切暗色时它照跑，
 *    于是合并在"切完就拍"时截到**中间态**：暗色 46/47，峰值通道差 5/255。
 *    ⇒ 冻结集必须**枚举到实际会动的选择器**，不能写个 `*` 就以为覆盖全了。
 *    实测：补上这一条之后，"切暗色 → 立刻截图"与基线**逐字节一致**，
 *    不需要 `sleep(150)` 这类魔法数字（见 G2-06D 的等价复核）。 */
const FROZEN = '*,*::before,*::after{animation:none !important;' +
  'transition:none !important;caret-color:transparent !important}' +
  'input::file-selector-button{animation:none !important;transition:none !important}';

/* 字体就位 → 图片 load/error → 两帧。与旧版**逐条一致**：判据不跟着改。 */
const settle = (p) => p.evaluate(async () => {
  var jobs = [];
  if (document.fonts && document.fonts.ready) jobs.push(document.fonts.ready);
  var imgs = [].slice.call(document.images || []);
  imgs.forEach(function (im) {
    if (im.complete) return;
    jobs.push(new Promise(function (res) { im.onload = res; im.onerror = res; }));
  });
  if (jobs.length) {
    await Promise.race([
      Promise.all(jobs),
      new Promise(function (r) { setTimeout(r, 3000); }),
    ]);
  }
  await new Promise(function (r) {
    requestAnimationFrame(function () { requestAnimationFrame(r); });
  });
});

(async () => {
  /* ⚠️ 这里**不要**随手加 `showScrollbars` —— 量具一换，全基线作废。
     实测记档：基线 31 张里 28 张宽 393（headless 默认 `--hide-scrollbars`），
     只有 `overlay` / `composition` 两张是 378 —— 那 15px 不是滚动条，
     是当年 `overlay.css` 里无条件 `html{scrollbar-gutter:stable}` 在占位。
     那条规则已按"组件只影响自己"删掉 ⇒ 这两张回到 393 是**有意的**。
     若改成 showScrollbars，28 张会集体变 378，把"换了仪器"误记成"产品变了"。 */
  const b = await launch();
  const p = await b.newPage();
  const okBy = { light: 0, rtl: 0, dark: 0 };
  const T = { boot: 0, goto: 0, settle: 0, shot: 0, switch: 0 };
  const _m = () => Date.now();
  for (const t of TASKS) {
    try {
      let _t0 = _m();
      /* 🔴 deviceScaleFactor **必须写死为 1**，不能让它随环境变。
         原因：`--record` 与 `--check` 走的是同一个 `shoot()`，
         只要这里一改，基线尺寸就和"将来截的图"对不上 ⇒
         每一页都报「尺寸变了」，而真正的原因**不是 CSS 改坏了**。

         实测：`deviceScaleFactor: 2` 让图变成 786 宽，基线是 393
         ⇒ 23 页全红。而此前这道门因比对错文件一直假绿，
            所以这个不一致一直没被发现。

         选 1 而不是 2 的理由：① 现有基线就是 1×，Tile 判据
         （32×32 分块、最差块 10.5% 那个校准）也是在 1× 上验出来的；
         ② 2× 会让基线从 2.7MB 涨到 7.2MB，代价换不来等价的判据提升。 */
      await p.setViewport({ width: t.w, height: t.h, deviceScaleFactor: 1 });
      T.boot += _m() - _t0; _t0 = _m();
      /* 🔴 媒体特性**每页都要重设** —— page 是复用的，
         上一页留下的 prefers-color-scheme 会带到下一页。
         这里显式设 light：本页的起点永远是"浅色"，暗色由循环里再切。 */
      await p.emulateMediaFeatures([
        { name: 'prefers-color-scheme', value: 'light' }]);
      /* 🔴 等待条件 domcontentloaded（不是 networkidle0）：
       *   实测 goto(networkidle0) 占 60% 的时间，而本库是纯静态页面
       *   （无 XHR / 轮询），networkidle0 的 500ms 静默期纯属浪费。
       *   "到底渲染完了没有"由下面的 settle 判据负责，不靠这个等待条件。 */
      await p.goto(t.url, { waitUntil: 'domcontentloaded' });
      T.goto += _m() - _t0; _t0 = _m();
      await settle(p);
      T.settle += _m() - _t0; _t0 = _m();

      /* 冻结所有动画再截图（原来就有这条，务必保留）
         —— 同一份代码连截两次会不一致（spinner / 骨架屏扫光是 infinite），
            门禁必然假红。⚠️ `none` 而不是 `paused`：paused 会停在任意帧。 */
      await p.addStyleTag({ content: FROZEN });
      await new Promise((r) => setTimeout(r, 120));

      /* 记下**加载时**的 dir 原值：RTL 拍完要按原值复位，
         写死 'ltr' 会把"本来没有 dir 属性"变成"dir=''" （不是同一棵树）。 */
      const dir0 = await p.evaluate(
        () => document.documentElement.getAttribute('dir'));

      for (const kind of t.order) {
        const _s0 = _m();
        if (kind === 'rtl') {
          /* 🔴 RTL：在 goto **之后**改 dir，只让 CSS 反应。
             为什么不改 HTML：这一维要验的是"**样式表**在另一种书写方向下渲染成
             什么样"，不是"页面作者会不会写 dir"。改动 HTML 会连带触发页面脚本
             重跑，测出来的东西就说不清是谁的责任了。
             ⚠️ 改 dir 会让整页重排 ⇒ 必须重走一遍字体/图片/两帧，
                否则会截到重排中途的一帧。 */
          await p.evaluate(() => { document.documentElement.dir = 'rtl'; });
          await settle(p);
        } else if (kind === 'dark') {
          /* 🔴 暗色要**两条路一起设**，缺一不可：
               ① `emulateMediaFeatures` 走 `@media (prefers-color-scheme: dark)`
               ② `data-theme="dark"` 走 `[data-theme="dark"]`
             这两段是**两套规则**（theme-sync 保证它们逐条一致，但它们是两份代码）。
             只设一个 ⇒ 只测了一半路径，另一半坏了照样绿。 */
          await p.emulateMediaFeatures([
            { name: 'prefers-color-scheme', value: 'dark' }]);
          await p.evaluate(() => {
            document.documentElement.setAttribute('data-theme', 'dark');
          });
          await settle(p);
        }
        T.switch += _m() - _s0;
        await p.screenshot({ path: t.out[kind], fullPage: true });
        T.shot += _m() - _s0;
        okBy[kind]++;

        if (kind === 'rtl') {
          /* 复位：先把方向还回去，再让布局重新稳定。
             不复位就切暗色 ⇒ 拍出来是"暗色 + RTL"，与暗色基线不是一回事。 */
          await p.evaluate((prev) => {
            if (prev === null) document.documentElement.removeAttribute('dir');
            else document.documentElement.setAttribute('dir', prev);
          }, dir0);
          await settle(p);
        }
      }
    } catch (e) {
      console.log('  [FAIL] ' + t.label + '：' + String(e).slice(0, 80));
    }
  }
  await b.close();
  /* 🔴  I1：**分项耗时**（先量再改 —— 之前我改启动方式结果没提速，
     就是因为不知道时间到底花在哪）。单位：秒。 */
  const n = TASKS.length || 1;
  console.log('TIMING goto=' + (T.goto / 1000).toFixed(1) +
              's settle=' + (T.settle / 1000).toFixed(1) +
              's switch=' + (T.switch / 1000).toFixed(1) +
              's shot=' + (T.shot / 1000).toFixed(1) +
              's viewport=' + (T.boot / 1000).toFixed(1) +
              's  (per page: goto=' + (T.goto / n / 1000).toFixed(2) +
              's shot=' + (T.shot / n / 1000).toFixed(2) + 's)');
  console.log('SHOT_OK light=' + okBy.light + ' rtl=' + okBy.rtl +
              ' dark=' + okBy.dark);
  const want = TASKS.reduce((a, t) => {
    for (const k of t.order) a[k] = (a[k] || 0) + 1;
    return a;
  }, {});
  const okAll = Object.keys(want).every((k) => (okBy[k] || 0) === want[k]);
  process.exit(okAll ? 0 : 1);
})();
"""


class _ServerError(RuntimeError):
    """静态服务器没起成 / 起的不是本仓库 ⇒ 必须整道门禁失败。"""


def _start_server():
    """
    起一个**只属于本次运行**的静态服务器，返回 (server, port)。

    🔴🔴 为什么不能再用固定端口 8000（实测事故，后果很隐蔽）
    ---------------------------------------------------------------------------
    端口被占时，`Popen(['python','-m','http.server','8000'])` 起的**子进程会
    立刻以 "Address already in use" 退出**，而**父进程完全不知道** ——
    `Popen` 不报错、返回值正常、后面的代码照常往下跑。

    于是所有 `http://127.0.0.1:8000/...` 的请求都打到了**那个残留进程**上。
    实测：本机 8000 上挂着两个上次跑残留的 http.server（PID 17232/17800），
    而它们服务的目录是**另一个 clone**，里面的 nav.css 还是旧版。
    ⇒ **截图截的是别的树**，门禁却在报"本仓库"的结论。

    这类错误最危险的地方：它**既可能假绿也可能假红，而且没有任何告警**
    —— 报告长得很正常，只是结论属于另一份代码。
    （本次就是这么发现的：修好了 CSS，diff 数字却一字未变。）

    ⇒ 解法两条，缺一不可：
       ① **让操作系统分配端口**（bind 0）⇒ 物理上不可能撞车；
       ② **canary 校验**：拉一个文件跟磁盘字节比一遍，
          确认"我连上的确实是我要测的这个仓库"。
    """
    import http.server
    import functools
    import threading
    import urllib.request

    class _Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a, **k):   # 别把每条请求打到 stderr
            pass

    handler = functools.partial(_Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    srv.daemon_threads = True
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    # ---- ② canary：确认连上的是本仓库 ----
    canary = 'index.html'
    disk_path = os.path.join(ROOT, canary)
    if os.path.exists(disk_path):
        want = io.open(disk_path, 'rb').read()
        got = None
        last = None
        for _ in range(40):                      # 最多等 ~4 秒
            try:
                got = urllib.request.urlopen(
                    'http://127.0.0.1:%d/%s' % (port, canary), timeout=2).read()
                break
            except Exception as e:               # noqa: BLE001 起服务期间的短暂失败要重试
                last = e
                import time as _t
                _t.sleep(0.1)
        if got is None:
            srv.shutdown()
            raise _ServerError('静态服务器起不来（%s）：%s' % (canary, last))
        if got != want:
            srv.shutdown()
            raise _ServerError(
                'canary 校验失败：%d 端口上服务的 **不是本仓库**（%s 的字节对不上）\n'
                '        ⇒ 多半是有残留的 http.server 占了端口。'
                '本脚本已改用系统分配端口，若仍报此错请检查本机进程。'
                % (port, canary))
    return srv, port


SET_ORDER = ('light', 'rtl', 'dark')     # **截图顺序**：浅 → RTL → 暗（见 SHOOT_JS 头）
SET_PRINT = ('light', 'dark', 'rtl')     # **打印顺序**：与旧版三道门禁的先后一致


def _suffix(kind):
    """目录后缀。与旧版逐字相同 —— **基线路径一个字节都不能变**。"""
    s = '-' + PLAT
    if kind == 'dark':
        s += '-dark'
    elif kind == 'rtl':
        s += '-rtl'
    return s


def dirs_for(kind, mode):
    base = {'baseline': '_baseline', 'current': '_current', 'diff': '_diff'}[mode]
    return os.path.join(SHOTS, base + _suffix(kind))


def build_tasks(mode, kinds, port):
    """一页一条任务，任务里带本次要拍的那几套输出路径。"""
    rtl_keys = {(r[0], r[1]) for r in RTL_PAGES}
    tasks = []
    for d, f, label, path in _pages_exist():
        out = {}
        for k in kinds:
            if k == 'rtl' and (d, f) not in rtl_keys:
                continue
            out[k] = os.path.join(dirs_for(k, mode), shot_name(d, f))
        if not out:
            continue
        tasks.append({
            'url': 'http://127.0.0.1:%d/%s/%s' % (port, d, f),
            'out': out,
            'w': VIEWPORT[0], 'h': VIEWPORT[1],
            'label': label,
            'order': [k for k in SET_ORDER if k in out],
        })
    return tasks


def shoot(mode, kinds):
    """一次加载截 kinds 指定的那几套。返回 (ok_by, want_by)。

    🔴 mode 只有两个值：`baseline`（--record / --update）与 `current`（--check）。
       record 与 check 共用同一段代码 —— 否则"录的"与"比的"迟早分叉。
    """
    outdirs = {k: dirs_for(k, mode) for k in kinds}
    # 🔴 先清空目标目录。`_current` 里留着**上一轮**的图时，
    #    "本轮这一页没截到"会拿旧图去比 ⇒ 假绿，而且报告长得完全正常。
    #    （E35 家族里最阴的一种：错的不是判据，是"比的到底是不是这次的图"。）
    for k in kinds:
        d = outdirs[k]
        if os.path.isdir(d):
            _hard_rmtree(d)
        os.makedirs(d, exist_ok=True)

    node = _which_node()
    if not node:
        raise _ShootFailed('找不到 node')

    import json as _json
    import tempfile
    import time as _time

    srv, port = _start_server()
    tmpdir = tempfile.mkdtemp(prefix='fl-shoot-')
    try:
        tasks = build_tasks(mode, kinds, port)
        want = {k: sum(1 for t in tasks if k in t['out']) for k in kinds}
        _t0 = _time.time()
        tmp_js = os.path.join(tmpdir, 'shoot.js')
        tmp_jsn = os.path.join(tmpdir, 'tasks.json')
        io.open(tmp_js, 'w', encoding='utf-8', newline='\n').write(SHOOT_JS)
        io.open(tmp_jsn, 'w', encoding='utf-8', newline='\n').write(_json.dumps(tasks))
        # 🔴 子进程必须继承 NODE_PATH：puppeteer-core 装在受管 workspace 里
        env = dict(os.environ)
        # 🔴 并把 browser.js 的绝对路径传进去，避免子进程 CWD 不确定
        env['FL_BROWSER'] = os.path.join(ROOT, '05-audit', 'browser.js')
        # ⚠️ 必须把 NODE_MODULES 也接上：check-all.sh 用**它**传受管目录，
        #    而本脚本原先只认本地 node_modules ⇒ 受管环境下 puppeteer 找不到
        #    ⇒ 截 0 张却只报「未执行」，看不出是路径问题（E35）。
        env['NODE_PATH'] = os.pathsep.join(
            [p for p in (env.get('NODE_MODULES', ''),
                         os.path.join(ROOT, 'node_modules'),
                         env.get('NODE_PATH', '')) if p])
        r = subprocess.run([node, tmp_js, tmp_jsn], capture_output=True,
                           timeout=420, env=env, cwd=ROOT)
        _dt = _time.time() - _t0
        out = (r.stdout or b'').decode('utf-8', 'replace')
        print('  [I1] 一次加载截 %d 页 · %s（%.1f 秒）' % (
            len(tasks),
            ' / '.join('%s %d 张' % (k, want[k]) for k in SET_PRINT if k in want),
            _dt))
        ok = {k: 0 for k in kinds}
        for line in out.splitlines():
            if line.startswith('SHOT_OK '):
                for part in line.split()[1:]:
                    k, _, v = part.partition('=')
                    if k in ok and v.isdigit():
                        ok[k] = int(v)
            elif line.startswith('  [FAIL]'):
                print(line)
        for line in out.splitlines():
            if line.startswith('TIMING '):
                print('  [I1] 分项耗时 ' + line[7:])
        if r.returncode != 0 and sum(ok.values()) == 0:
            print('  [FAIL] 批量截图失败：%s'
                  % (r.stderr or b'').decode('utf-8', 'replace')[:300])
        # 🔴 每套单独报"截了几张 / 该截几张"：只报一个总数会把
        #    "暗色少 3 张"藏进"109 张里有 106 张"里。
        for k in SET_PRINT:
            if k in ok:
                print('  %s：截了 %d / %d 张' % (k, ok[k], want[k]))
        if sum(ok.values()) == 0:
            raise _ShootFailed('一张截图都没成功 —— 视觉回归**未执行**，不能算通过')
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
        srv.shutdown()
        srv.server_close()
    return ok, want


# ============================================================================
# 比对：零依赖（pngdiff）
# ============================================================================
# 🔴 2026-10-29 换掉 Pillow。
#   旧实现是 `_try_pil()` → 没有 Pillow 就 `return None, ['缺少 Pillow…']`，
#   而 check-all 把这条当成"跳过"。于是**日常改样式的那道防线在多数环境里根本不存在**，
#   而本仓库自己的规矩是"跳过不是通过" —— 装一次 Pillow 只是让某台机器不跳过，
#   判据本体仍然挂在可选依赖上。
#   ⇒ 正确修法是把依赖拿掉：pngdiff.py 用 zlib + 行过滤解 PNG，
#     并与 Pillow 做过逐字节交叉验证（393×1744 的基线图，解码结果完全相同）。
#   ⇒ 现在 diff_all 只有两种结局：通过 / 失败。**没有"缺依赖"这条路了。**
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pngdiff  # noqa: E402


def diff_set(kind, threshold=1.0, tolerance=12):
    """逐像素 diff 某一套。返回 (通过数, 失败列表, 逐字节一致数, 无基线页面)"""
    BASE, CUR, DIF = (dirs_for(kind, m) for m in ('baseline', 'current', 'diff'))
    if not os.path.isdir(BASE):
        return None, ['没有基线 —— 请先跑 --record'], 0, []

    bfiles = {os.path.basename(x) for x in glob.glob(os.path.join(BASE, '*.png'))}
    passed, failed, bytes_same = 0, [], 0
    os.makedirs(DIF, exist_ok=True)

    # 🔴 反假绿：`_current` 为空（或根本没有刚截的图）必须**判失败**。
    #    旧版只是逐页报"当前截图缺失"，但那 N 条 FAIL 会被误读成"图坏了"；
    #    真实原因常常是**一次都没截**。
    fresh = glob.glob(os.path.join(CUR, '*.png'))
    if not fresh:
        return 0, [('(全部)', 100.0,
                    '`_current` 里没有任何刚截的图 ⇒ 本次**没有可比的对象**。'
                    ' 这不是"图不一致"，是"压根没截到"，必须判失败')], 0, []

    for name in sorted(bfiles):
        bp = os.path.join(BASE, name)
        cp = os.path.join(CUR, name)
        if not os.path.exists(cp):
            failed.append((name, 100.0, '当前截图缺失'))
            continue
        # 先比字节：一致就一定观感一致 —— **直接记通过，不再解码**。
        #   （109 张全页 PNG 纯 Python 解码要 100 秒以上，而这条路本来就不需要看像素。）
        # 逐字节数是"这次合并有没有改变像素"的**直接证据**，所以单独数出来。
        try:
            same_bytes = io.open(bp, 'rb').read() == io.open(cp, 'rb').read()
        except Exception:
            same_bytes = False
        if same_bytes:
            bytes_same += 1
            passed += 1
            continue
        try:
            r = pngdiff.compare(bp, cp, os.path.join(DIF, name),
                                tile=32, tile_pct=3.0, page_pct=0.5,
                                tolerance=tolerance)
        except pngdiff.PngError as e:
            # 解不了就说解不了 —— 不许当成"通过"
            failed.append((name, 100.0, 'PNG 解不了：%s' % e))
            continue

        if r['size_mismatch']:
            # ⚠️ 尺寸不符**通常不是 CSS 回归**，而是截图设置变了
            #    （deviceScaleFactor / viewport）⇒ 必须把这层意思说出来，
            #    否则读报告的人会去 CSS 里找一个根本不存在的问题。
            a, b = r['size']
            if (b[0] % a[0] == 0 and b[1] % a[1] == 0
                    and b[0] // a[0] == b[1] // a[1] and b[0] // a[0] > 1):
                k = b[0] // a[0]
                why = ('截图倍率不一致（当前是基线的 %d 倍）⇒ 检查 '
                       'deviceScaleFactor，不是 CSS 回归' % k)
            else:
                why = '尺寸变了（viewport 或页面高度改了）：%s → %s' % (a, b)
            failed.append((name, 100.0, why))
            continue

        if not r['ok']:
            # 分块（tile）判据的语义保留在 pngdiff 里：
            #   视觉退化通常是**局部集中**的（一个按钮的圆角 ≈ 几百像素），
            #   摊到 150 万像素的全页就微不足道（实测 0.065% 被放过），
            #   所以判据是"任一块变化 > 3%"而不是"全页 > x%"。
            worst = max(r['bad_tiles'], key=lambda t: t[2]) if r['bad_tiles'] else (0, 0, 0)
            why = ('%d 个块变化超 3.0%%（最差 %s 处 %.1f%%）；全页 %.3f%%'
                   % (len(r['bad_tiles']), str(worst[:2]), worst[2], r['pct']))
            failed.append((name, r['pct'], why))
        else:
            passed += 1
    return passed, failed, bytes_same, sorted(bfiles)


def _strip_block_comments(text):
    """剥掉 /* ... */，**跳过字符串内部**（content: "/* 不是注释 */" 这种）

    写成状态机而不是正则：正则会把 `content: "/*"` 当成注释开头，
    从那儿一路吃掉半个文件，于是"改了真东西也不报"。
    """
    out = []
    i, n = 0, len(text)
    quote = None
    while i < n:
        ch = text[i]
        if quote:
            out.append(ch)
            if ch == '\\' and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in ('"', "'"):
            quote = ch
            out.append(ch)
            i += 1
            continue
        if ch == '/' and i + 1 < n and text[i + 1] == '*':
            j = text.find('*/', i + 2)
            if j == -1:
                break                      # 未闭合：剩下全当注释
            i = j + 2
            continue
        out.append(ch)
        i += 1
    return ''.join(out)


def _hash_text(path):
    """参与指纹的文本：归一化行尾 + 剥注释

    🔴 为什么必须剥注释（实测负担）：
      2026-10-23 只往 tokens.css 加了一段**说明**，指纹就变了
      ⇒ `visual-stamp` 判"基线过期" ⇒ 只能把 40 页重录一遍（30 秒 × 2 方案）。
      注释不参与渲染，却让"基线对不对得上"变成噪声 —— 噪声判据的下场一定是被无视。

    ⚠️ 只剥三种有把握的形态：CSS/JS 的 /* */、HTML 的 <!-- -->。
      JS 的 `//` 行注释**不剥**（`https://` 会骗掉它）——
      宁可对行注释多要求一次重录，也不要剥错让真改动被忽略。
    """
    raw = io.open(path, 'rb').read().replace(b'\r\n', b'\n')
    text = raw.decode('utf-8', 'replace')
    ext = os.path.splitext(path)[1].lower()
    if ext == '.html':
        import re as _re
        text = _re.sub(r'<!--.*?-->', '', text, flags=_re.S)
    else:
        text = _strip_block_comments(text)

    # 再去掉空行与行尾空白：**只加注释/只调空行**不该让基线"过期"。
    # ⚠️ 缩进仍然参与哈希（改缩进会要求重录，虽然不影响渲染）——
    #    宁可多报一次，也不要因为归一化过头而漏掉真改动。
    # ⚠️ 已知代价：字符串里恰好"行尾有空格"或"含空行"的极少数情况会被忽略。
    lines = [ln.rstrip() for ln in text.split('\n')]
    text = '\n'.join(ln for ln in lines if ln)
    return text.encode('utf-8')


def css_fingerprint():
    """
    所有 CSS 的内容指纹（用来判断基线是否录于当前代码）

    🔴 必须**先归一化行尾**再哈希。
    实测事故：Windows 上 `core.autocrlf=true` ⇒ `git clone` 检出的
    CSS 全是 CRLF，而录基线的机器上是 LF ⇒ 指纹**必然不等**
    ⇒ 视觉回归门禁在任何 Windows clone 上**永久红**，
    而报错只说"指纹不符"，看不出是行尾造成的。

    那不是"代码变了"，是"字节表示变了" —— 指纹不该区分这两者。
    ⇒ 统一把 CRLF 折成 LF 再哈希。

    🔴🔴 第二个实测事故（比行尾更隐蔽）：**旧版只 glob `0*/*/*.css`**。
    这个"三段"模式**匹配不到二级路径**的文件，实测漏掉 5 个：
        01-tokens/tokens.css、typography.css、focus-ring.css、
        scrollbar.css、04-recipes/tierA-tokens.css
    ⇒ 也就是说：**只改 tokens.css（改颜色、改暗色）时，指纹纹丝不动**，
      门禁不会提示"基线可能过期"，于是 diff 出现了却没人知道为什么。

    ⇒ 现在改为**遍历库目录**，取所有能影响渲染的文件（css/js/html）。
    之所以连 js/html 一起算：截图是**渲染结果**，
    改了 tree.js 的 DOM 结构或 demo.html 的内容，观感一样会变，
    只算 CSS 会让指纹对这类改动假装没看见。
    """
    import hashlib
    h = hashlib.sha256()
    skip = {'.git', 'node_modules', '06-vendor', 'shots',
            '_baseline', '_current', '_diff'}
    exts = {'.css', '.js', '.html'}
    files = []
    for d in ('01-tokens', '02-primitives', '03-patterns', '04-recipes',
              '09-assets', '10-review', 'adapters'):
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames if x not in skip]
            for fn in filenames:
                if os.path.splitext(fn)[1].lower() in exts:
                    files.append(os.path.join(dirpath, fn))
    for f in sorted(files):
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        h.update(rel.encode('utf-8'))
        h.update(_hash_text(f))
    return h.hexdigest()[:16]


def main():
    argv = sys.argv[1:]
    # G2-06D 之后默认**一次加载截三套**。`--scheme` / `--dir` 保留下来只做
    # 单套复现（调试用），不再参与全量门禁 —— 全量只留一道 `visual`。
    kinds = list(SET_ORDER)
    if '--scheme' in argv:
        i = argv.index('--scheme')
        scheme = argv[i + 1] if i + 1 < len(argv) else ''
        if scheme not in ('light', 'dark'):
            print('  --scheme 只接受 light / dark')
            return 2
        kinds = ['dark'] if scheme == 'dark' else ['light']
    if '--dir' in argv:
        i = argv.index('--dir')
        dirn = argv[i + 1] if i + 1 < len(argv) else ''
        if dirn not in ('ltr', 'rtl'):
            print('  --dir 只接受 ltr / rtl')
            return 2
        if kinds != list(SET_ORDER):
            print('  --scheme 与 --dir 不能同时用（没有"暗色 + RTL"那套基线）')
            return 2
        kinds = ['rtl'] if dirn == 'rtl' else ['light']

    global DIRN
    DIRN = 'rtl' if kinds == ['rtl'] else 'ltr'   # 只影响 --list 的清单

    if '--list' in argv:
        for row in managed():
            d, f, label = row[0], row[1], row[2]
            p = os.path.join(ROOT, d, f)
            print('  %s  %s/%s' % ('OK ' if os.path.exists(p) else '缺 ', d, f))
        return 0

    threshold = 1.0
    if '--threshold' in argv:
        i = argv.index('--threshold')
        try:
            threshold = float(argv[i + 1])
        except (IndexError, ValueError):
            print('  --threshold 需要一个数字（如 2.0）')
            return 2

    def head_sha():
        """
        当前 HEAD。写进基线戳里，用于回答"这份基线到底录在哪份代码上"。

        🔴 为什么必须记（一次真的查了很久的事故）：
        排查时发现 `_baseline` 与它名义上所属的那个提交 **渲染结果并不一致**
        —— 用该提交的代码重渲染，和基线差 2299 px（card）/ 7473 px（button）。
        也就是说基线**录于更早的某个状态**，而光看指纹只能知道"不一样"，
        答不出"差在哪份代码"。
        ⇒ 记下 HEAD，下次就能直接把基线和它所属的提交对上。
        """
        try:
            r = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'],
                               cwd=ROOT, capture_output=True, timeout=10)
            if r.returncode == 0:
                return (r.stdout or b'').decode('utf-8', 'replace').strip()
        except Exception:
            pass
        return None

    def read_stamp(d):
        try:
            return json.load(io.open(os.path.join(d, '_stamp.json'), encoding='utf-8'))
        except Exception:
            return None

    if '--record' in argv or '--update' in argv:
        try:
            ok, want = shoot('baseline', kinds)
        except _ShootFailed as e:
            print('  [FAIL] %s' % e)
            return 1
        # 🔴 少一张就不写戳：戳的作用是"证明这套基线是完整的、录在当前代码上"，
        #    残缺的基线配上完整的戳，比没有戳更坏。
        if any(ok[k] != want[k] for k in kinds):
            print('  [FAIL] 有页面没截到 ⇒ 基线**不完整**，拒绝写戳')
            return 1
        fp = css_fingerprint()
        for k in kinds:
            d = dirs_for(k, 'baseline')
            io.open(os.path.join(d, '_stamp.json'), 'w', encoding='utf-8',
                    newline='\n').write(json.dumps(
                        {'fingerprint': fp, 'pages': ok[k], 'head': head_sha(),
                         'sets': list(kinds)},
                        ensure_ascii=False, indent=2))
            print('  已录基线（%s）：%d 个页面 → %s'
                  % (k, ok[k], os.path.relpath(d, ROOT)))
        print('  渲染指纹（CSS+JS+HTML）：%s（用于判断基线是否过期）' % fp)
        return 0

    # 默认 --check
    missing = [k for k in kinds if not os.path.isdir(dirs_for(k, 'baseline'))]
    if missing:
        d = dirs_for(missing[0], 'baseline')
        print('  [FAIL] 本平台（%s）没有基线集：%s'
              % (PLAT, os.path.relpath(d, ROOT)))
        print('         ⇒ 这台机器**判不了**观感有没有变 —— 这不叫通过。')
        print('         ⇒ 但**不要**在 CI 上随手 --record：那等于把 CI 的渲染'
              '当成标准，')
        print('           下次真回归反而看不出来。正确做法是在目标平台上录一次，')
        print('           把 png 连同 _stamp.json 一起提交。')
        return 1

    try:
        ok, want = shoot('current', kinds)
    except _ShootFailed as e:
        # 🔴🔴截图环节失败 ⇒ 整道门禁失败，绝不继续比 diff。
        #   （原先只是打印一行，然后拿「基线 N 张 vs 当前 0 张」去比，
        #    结果输出「OK 23 / 0 个页面观感一致」—— 一张没截却报全绿。）
        print('')
        print('  [FAIL] 视觉回归**未执行**：%s' % e)
        print('         ⇒ 这次运行**不能算通过**（它压根没看任何东西）')
        return 1

    st = read_stamp(dirs_for(kinds[0], 'baseline'))
    if st:
        now_fp = css_fingerprint()
        if now_fp != st.get('fingerprint'):
            print('  === 视觉回归 ===')
            print('  ⚠️ 渲染指纹与基线不符：基线录于 %s，现在是 %s' % (
                st.get('fingerprint', '?'), now_fp))
            if st.get('head'):
                print('     基线录制时的 HEAD：%s（现在 %s）'
                      % (st.get('head'), head_sha() or '未知'))
            print('     ⇒ 如果这些 CSS 改动是**有意的**，请重录：--update')
            print('     ⇒ 否则这就是真回归，继续看下面的 diff：')
            print('')

    print('  === 视觉回归（阈值 %.2f%% · 平台 %s · 一次加载 %d 套）==='
          % (threshold, PLAT, len(kinds)))
    rc = 0
    total_pass = total_cmp = total_bytes = 0
    for k in [x for x in SET_PRINT if x in kinds]:
        label = {'light': '浅色', 'dark': '暗色 ', 'rtl': 'RTL  '}.get(k, k)
        if ok[k] == 0:
            print('  %s [FAIL] 一张都没截到 ⇒ 这套**未执行**，不能算通过' % label)
            rc = 1
            continue
        if ok[k] < want[k]:
            # 截了一部分：如实说"哪些没验证"，并且**判失败**（少一页就是少一页覆盖）
            print('  %s [FAIL] 只截到 %d / %d 页 ⇒ 其余页面本轮**未验证**'
                  % (label, ok[k], want[k]))
            rc = 1
        passed, failed, bytes_same, allnames = diff_set(k, threshold)
        if passed is None:
            print('  %s [FAIL] %s' % (label, failed[0]))
            rc = 1
            continue
        compared = passed + len(failed)
        total_pass += passed
        total_cmp += compared
        total_bytes += bytes_same
        print('  %s OK %2d / %2d 个页面观感一致（逐字节 %d / %d）'
              % (label, passed, compared, bytes_same, compared))
        # 🔴 诚实报告：截了但**没有基线可比**的页面 = 本轮**没被验证**。
        #    不写出来就会被当成"也通过了"（默认信任是最常见的假绿来源）。
        unverified = [shot_name(r[0], r[1]) for r in managed()
                      if os.path.exists(os.path.join(ROOT, r[0], r[1]))
                      and shot_name(r[0], r[1]) not in set(allnames)]
        if k != 'light':
            unverified = []
        if unverified:
            print('  ⚠️ %s：%d 个页面**截了但没有基线**，本轮未验证（跑 --update）：'
                  % (label, len(unverified)))
            for u in unverified:
                print('        %s' % u)
        for name, pct, why in failed:
            print('  %s FAIL  %-34s %s' % (label, name, why))
            print('        diff 图：%s' % os.path.relpath(
                os.path.join(dirs_for(k, 'diff'), name), ROOT))
        if failed:
            rc = 1

    print('  —— 合计：%d 张逐字节一致 / %d 张比过' % (total_bytes, total_cmp))
    if rc:
        print('')
        print('  ⇒ 如果这是**有意**的视觉改动，用：--update 重录基线')
        print('    如果不是，说明某处 CSS 被改坏了（而行为契约抓不到这类问题）')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
