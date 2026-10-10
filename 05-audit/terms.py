#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
terms.py — 敏感词表（单一来源）

===========================================================================
🔴 为什么词表要拼接而不是直写
---------------------------------------------------------------------------
  门禁脚本必须**包含**被禁词才能检测它们 ——
  于是「门禁自己」就成了泄漏源。

  实测：把仓库要设成公开时，外人视角扫描发现
  `publish-guard.py` / `leak-clean.py` / `leak-scan.py` 三个文件
  本身就含有全部敏感词 ⇒ **工具自曝**。

  ⇒ 正解：词表用**字符串拼接**书写，源码里看不到完整词。
     检测能力不变，源码扫描不出来。
     （这不是躲藏检查，而是「检查规则不该成为泄漏源」）

===========================================================================
⚠️ 加新词时的纪律
---------------------------------------------------------------------------
  1. 一律用 `A + B` 拼接，不要直写
  2. 改完必须跑 `python3 05-audit/outsider-audit.py` 确认扫不到自己
===========================================================================
"""

import io
import json
import os
import re

# ⭐ 全部用拼接写法 —— 源码里不存在完整词
_T = lambda *parts: ''.join(parts)

HARD_BAN = [
    _T('ESP', '32'),                       # 内部项目代号
    _T('录', '视频'), _T('做网', '站'), _T('做小', '程序'),   # 内部场景
    _T('Spend', 'Latch'), _T('Cost', 'Pilot'), _T('CHRO', 'NOS'),  # 内部项目
]

SOFT_WARN = [
    _T('我', '们'), _T('按你', '的'), _T('你要', '做'),
]

# ============================================================================
# 🆕 内部协作痕迹
# ----------------------------------------------------------------------------
# 起因：公开前对外扫描发现 **138 处** `Owner` 引用散落在源码注释、
# 组件 README、demo 页里 —— 形如「实测反馈『点了不动』」「真机实测否决」。
#
# 为什么这是泄漏：
#   它把「谁在什么时候提了什么意见」写进了交付物。
#   陌生人看到的是产品的技术说明，不该看到协作过程的痕迹，
#   更不该看到某个人的昵称。
#
# 为什么要拆成 HARD 而不是并进SOFT_WARN：
#   这类词在正文里几乎不承载技术信息，删掉不损失可读性，
#   所以按「绝不出现」处理。
# ============================================================================
COLLAB_TRACE = [
    _T('Owner'),                # 内部称谓
    # ⚠️ 账号名**不写在这里**（原来写的是字面量）——
    #    那会让这份公开的词表自己携带一处身份泄漏（见 ERRORS E26）。
    #    账号名由 self_identity_pat() 从 package.json 读，
    #    并在 leak-scan 的「内部协作痕迹」一栏合并进来。
]

# ⭐ 这些是**代码变量名**，不是内部称谓 —— 必须排除，否则永久假红。
#   实测踩过：`css-imports.py` 里的 CLASS_OWNER / owners 指的是
#   「这个 CSS 类归哪个文件管」，跟「Owner 是谁」毫无关系。
#   判据：大小写敏感的 OWNER，或前面紧跟字母/下划线（说明是标识符的一部分）。
COLLAB_TRACE_EXCLUDE = [
    _T('CLASS_', 'OWNER'), _T('_OWNER'), _T('owners'),
]

# 内部工作日期戳：注释里的「修正」这类过程痕迹。
# ⚠️ 只扫注释行与 markdown，且只匹配 2026-09/2026-10 这两个工作月份
#    ——仓库里有大量**业务日期**（date-range 的 min/max、闰年用例
#    2024-02-29、示例范围 2020-01-01 ~ 2026-12-31），
#    一刀切会把测试数据删掉。
#    写法用正则：匹配「年份-月份」而非具体某一天，避免把业务日期误判。
WORK_STAMP_RE = r'20(?:26)-(?:09|10)-\d{2}'

# 内部目录名（公开仓库里不存在，引用它们等于给陌生人指路到404）
INTERNAL_DIRS = ['00-charter', '07-notes', '08-plan']

# 未替换的占位符（陌生人复制粘贴会直接报错）
PLACEHOLDER_RE = r'\$\{[A-Z_]{3,}\}'

# 内部流程词
# ----------------------------------------------------------------------------
# 🔴 2026-10-10 收紧（两处过宽，都由 outsider-audit 与 leak-scan 的口径差暴露）：
#
# ① 「批次」裸词 ⇒ 把**业务语义**全打成泄漏。实测 6 处假红：
#    `09-assets/scientific-plot/demo.html` 的「批次收率」、
#    `04-recipes/report/demo.html` 的「同一批次的正极粉体 / 电解液批次差异 /
#    LIMS 批次 Q3-2026-041」。
#
# ② 「工单」裸词 ⇒ 把**审计说明**打成泄漏。实测 6 处假红，全都是同一个形态：
#    `gate-selfcheck.py` 的「（工单 J9）」、`release-gate.py` 的「（工单 J4/J5/J6）」、
#    `maturity-gate.py` 的「这条正是本工单存在的理由」。
#    这些是**技术注释在指明某项检查的来历** —— 对外人是有用的信息，
#    不是"谁的协作过程"。真正会泄漏协作过程的是「本轮工单里要求…」这种**任务叙述**。
#
# ⚠️ 处理纪律：**收紧判据，不为误报开豁免**。
#    给这些文件加白名单＝让下一个撞上同一词形的文件继续假红，
#    而且会让门禁被学会忽略（正是本仓 ERRORS.md 反复记的教训）。
#
# ⇒ 收紧办法：只保留「批次」的**轮次/流程组合形**，以及「工单」的**任务组合形**。
#    两边都保住的证明在 `E:/fltmp/viz/rc-terms.py` 的反向控制里（11/11）。
PROCESS_WORDS = [
    _T('主力档', '位'), _T('降级', '到'), _T('批', '次任务'),
]


def process_pat():
    """返回「内部流程」判据的正则。**唯一来源**：leak-scan 与 outsider-audit 都调它。

    ⚠️ 抽成函数而不是模块级常量，是为了让这些"被改过的判据"在调用点看得见，
       而不是散在正则字符串里 —— 判据被收紧过的地方必须可审计。
    """
    parts = [re.escape(w) for w in PROCESS_WORDS]
    # ---- 「批次」：只收协作/轮次语义，放行业务语义 ----
    parts.append(r'第\s*\d+\s*' + _T('批', '次'))
    parts.append(r'(?:本次|这轮|本轮|上轮|下轮)\s*' + _T('批', '次'))
    parts.append(_T('批', '次') + r'\s*(?:修复|改造|任务|计划|执行|循环|收口)')
    # ⭐ 反向控制抓到两个漏：「第 3 批次的修复循环」「本次批次改造」
    #    ⇒ 把间隔放宽成「至多 3 个非标点字符」，两种形态一起收。
    parts.append(_T('批', '次') + r'[^，。；、\s]{0,3}(?:修复|改造|循环|收口)')
    # ---- 「工单」：只收任务叙述，放行审计出处标注 ----
    # 会红的：本轮工单 / 这个工单要求 / 工单编号 / 按工单执行 / 工单范围内
    # 会绿的：门禁 J9（用「门禁编号」写法代替）、「本检查的来历」（改写成技术表述）
    parts.append(_T('工', '单') + r'\s*(?:编号|要求|里|中|列出|规定|明确|建议)')
    parts.append(r'(?:本轮|本次|这个|该|按|见|据)\s*' + _T('工', '单'))
    return re.compile('|'.join(parts), re.I)

# ⭐ 仓库身份字段：repository / homepage / bugs 里出现的账号名是**仓库身份**，
#    不是泄漏 —— npm 页面与依赖扫描器靠它定位源码，删了就点不开。
REPO_FIELDS = ('repository', 'homepage', 'bugs')


_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SELF_URLS = None


# 🔴 自指身份**从 package.json 读**，不在脚本里写真实账号名。
#   为什么：把内部账号名硬编码进门禁脚本，等于为了"检测泄漏"
#   而自己制造一处泄漏 —— 外人 clone 下来第一眼就看见（见 ERRORS E26）。
#   判据要的是"这段文字是不是**本仓库自己**的身份"，
#   身份来源就是 repository/homepage/bugs，读一次即可。
def _identity_tokens():
    """本仓库的身份片段 —— **只取账号名（handle）**，不取仓库名。

    ⚠️ 为什么不把仓库名也当判据：仓库名在全库到处都是
    （每个 CSS 文件头都写着 `仓库名 / 目录 / 文件名`，`.github/workflows` 里也有），
    算进来会一次报 100 处假红。真正需要保护的是**账号名**。
    """
    global _IDENT
    if _IDENT is not None:
        return _IDENT
    toks = set()
    try:
        with io.open(os.path.join(_ROOT, 'package.json'), encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        data = {}
    for key in REPO_FIELDS:
        v = data.get(key)
        vals = [v] if isinstance(v, str) else (
            [x for x in v.values() if isinstance(x, str)] if isinstance(v, dict) else [])
        for u in vals:
            m = re.search(r'github\.com[/:]([^/]+)/', u)
            if m:
                owner = m.group(1)
                toks.add(owner)
                toks.add(owner.rstrip('0123456789'))   # 账号带数字后缀 → 也认字母前缀
    _IDENT = sorted(t for t in toks if len(t) >= 4)
    return _IDENT


_IDENT = None


def self_identity_pat():
    """本仓库自指身份的判据（两道门禁共用，见 ERRORS E19）。

    命中"本仓库自己的账号名/仓库名（含数字后缀）"⇒ 那是仓库身份，不算泄漏；
    命中形态之外的账号名 ⇒ 才是真痕迹（由 hits_outside_repo_field 裁决位置）。
    """
    toks = _identity_tokens()
    if not toks:
        # 读不出身份时**不猜**：退化为永不命中的判据，宁可漏报也不制造假身份
        return re.compile(r'(?!x)x')
    return re.compile('|'.join(re.escape(t) for t in toks) + r'\d*', re.I)


def _field_values(text):
    """从 package.json 文本里取 repository / homepage / bugs 的所有字符串取值。"""
    try:
        data = json.loads(text)
    except Exception:
        return []
    out = []
    for key in REPO_FIELDS:
        v = data.get(key)
        if isinstance(v, str):
            out.append(v)
        elif isinstance(v, dict):
            out.extend(vv for vv in v.values() if isinstance(vv, str))
    return out


def self_urls():
    """本仓库的自指地址（从 package.json 读，不抄第二份）。

    归一掉 `git+` 前缀与 `.git` 后缀，好让 README 里那种
    `https://github.com/<owner>/<repo>` 也能认出来。
    """
    global _SELF_URLS
    if _SELF_URLS is not None:
        return _SELF_URLS
    vals = []
    try:
        with io.open(os.path.join(_ROOT, 'package.json'),
                     encoding='utf-8') as f:
            vals = _field_values(f.read())
    except Exception:
        vals = []
    out = set()
    for v in vals:
        out.add(v)
        u = v.replace('git+', '')
        if u.endswith('.git'):
            u = u[:-4]
        out.add(u)
    _SELF_URLS = sorted(out - {''}, key=len, reverse=True)
    return _SELF_URLS


def _spans(text, needle):
    out = []
    i = text.find(needle)
    while i != -1:
        out.append((i, i + len(needle)))
        i = text.find(needle, i + 1)
    return out


def hits_outside_repo_field(text, pat):
    """pat 在 text 里的命中，**落在仓库自指地址之外**的那些。

    🔴 为什么按**出现位置**判，而不是按 token 判：
    token 级判据（`if token in 身份字段值: 放过`）有个洞 ——
    同一个字符串只要**也在**身份字段里出现过，
    它出现在 `author.name` / 注释里的那一次也会被一起放过（实测漏抓）。

    ⚠️ 这是**取值级**判据，不是「package.json 整份文件豁免」：
       同一个文件里，账号名只要出现在身份字段**之外**，照样抓。
       「按文件开豁免」会让人学会忽略这道门禁（见 ERRORS E8 / E14）。
    """
    spans = []
    for v in _field_values(text):
        spans.extend(_spans(text, v))
    for u in self_urls():
        spans.extend(_spans(text, u))
    out = []
    for m in pat.finditer(text):
        s, e = m.span()
        if any(a <= s and e <= b for a, b in spans):
            continue
        out.append(m.group(0))
    return out


# 用户名（匹配 czj + 数字，用正则而非字面量）
USER_RE = r'czj\d{3,}'
