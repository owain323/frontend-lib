#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
nightly-observe.py — 定时运行的观察台账（**只读**，不是门禁）

===========================================================================
为什么需要它
---------------------------------------------------------------------------
  G2-01 的判据是"连续若干次**定时**运行绿"，而这件事只能靠时间累积。
  累积过程有两个坑，都踩过了：

   ① 同一条红因会被当成两条新问题。
      10-29 与 10-31 的红全是"Linux 基线集没随源改动重录"，
      按日期记就会得出"又回归了一次"的结论 —— 而它是同一个原因。

   ② 手工触发被当成稳定性证据。
      `workflow_dispatch` 证明"我现在跑一次能过"，
      不证明"没人动它也不会坏"。两者混在一起，观察期永远结不了。

  ⇒ 台账必须从 **run 历史**里生成，而不是手抄；
    分类必须有**未分类**这个出口，而不是"归到最像的那一类"。
    默认归类 = 把新问题伪装成旧问题，这比不分类更坏。

===========================================================================
四类 + 一个出口（判据是"红在说明什么"，不是"哪一步红的"）
---------------------------------------------------------------------------
  产品       红说明产品/仓库状态**确实**违反了契约（例：版本已 bump 但没有 tag 锚点）
  测试       红说明**判据自己的前提**不成立（夹具依赖运行身份、名单误报）
  环境       同一提交在本机绿、在该 runner 红，差异来自平台（字体/渲染/基线平台集）
  外部依赖   registry / CDN / runner 本身不可达或不一致
  未分类     **证据不足，必须人工定性**；不许默认落到上面任何一类

  ⚠️ "已修"列只说明**修复提交存在**，不说明这个红因不会再出现。
     稳定性只能由后续的定时运行序列回答，不能由这张表回答。

===========================================================================
为什么不进 check-all.sh
---------------------------------------------------------------------------
  它要 `gh` + 网络 + 凭据。把门禁建立在外部服务上，等于把"能不能判"
  交给别人 —— 与 `release-run.sh` 拒绝"没网就报没发布"是同一条理由。
  它**不产生 PASS/FAIL**，只打印台账；`--selftest` 是纯内存的。

用法：
  python 05-audit/nightly-observe.py                 # 最近 10 次（含手工触发）
  python 05-audit/nightly-observe.py --limit 20
  python 05-audit/nightly-observe.py --json          # 机器消费
  python 05-audit/nightly-observe.py --selftest      # 反向控制（离线）

退出码：0 所有红因已定性；3 存在未分类（观察未完成，**不是**门禁失败）；
        2 环境不可用（没有 gh / 未登录 / 网络断）
===========================================================================
"""
import json
import os
import re
import subprocess
import sys
import unicodedata

WORKFLOW = 'gate.yml'
API = 'repos/{owner}/{repo}/actions/workflows/' + WORKFLOW + '/runs'
UNKNOWN = '未分类'

# 还没出结果的运行。**既不算绿也不算红** ——
#   ⚠️ 把它当"打断"会让人以为刚红了一次，而它其实还在跑（观察者最不该制造假红）。
PENDING = ('queued', 'in_progress', 'pending', 'waiting', 'requested')

# ---------------------------------------------------------------------------
# 已知红因的记忆
# ---------------------------------------------------------------------------
#   gates   —— 出现在**外层**门禁名里（`  visual-stamp  FAIL  1s`）
#   pat     —— 必须匹配到**具体那句话**。只按门禁名认，会把同一个门禁的
#              新缺陷认成旧缺陷（visual-stamp 以后可能因为别的原因红）。
#   fixed   —— 修复提交/动作；空串表示"已知但还没有修复"。
SIGS = [
    dict(
        # G2-06D 把 visual / -dark / -rtl 合成了一条 `visual`；旧名留在这里
        # 只为认得**改动之前**的 CI 运行记录。
        gates=('visual-stamp', 'visual', 'visual-dark', 'visual-rtl'),
        pat=r'基线录于|渲染指纹与基线不符',
        cls='环境',
        cause='Linux 基线集未随源改动重录（同提交本机绿、runner 红）',
        fixed='42f2684 在 CI 上重录 Linux 三套基线'),
    dict(
        gates=('release',),
        pat=r'没有 `v[\d.]+` 这个 tag',
        cls='产品',
        cause='版本已 bump，tag 锚点在远端不存在',
        fixed='v0.22.0/0.22.1 等 tag 于 10-31 补齐（状态项，不是代码改动）'),
    dict(
        gates=('selftest-all',),
        pat=r'回执：registry 索引延迟|release-gate\.py\s+RC=1',
        cls='测试',
        cause='自检夹具依赖运行身份（/nonexistent 在非 root Linux 下可写）',
        fixed='e837d52 夹具改为不依赖运行身份'),
    dict(
        gates=('proper-noun',),
        pat=r'不在白名单',
        cls='测试',
        cause='判据误报：把公开 API 名（Windows UIA 属性）当成内部代号',
        fixed='709d9c2 改写文档绕开，判据未放宽'),
]

RE_GATE = re.compile(r'^\s*([a-z0-9][a-z0-9._-]*)\s+(FAIL|ERROR)\b')
RE_PREFIX = re.compile(r'^\d{4}-\d{2}-\d{2}T[0-9:.]+Z\s?')


# ------------------------------------------------------------------------------
# 取数
# ------------------------------------------------------------------------------
def sh(args):
    """跑 gh；失败返回 (None, 原因)。调用方必须区分"没取到"与"结论为空"。"""
    try:
        r = subprocess.run(args, capture_output=True, timeout=180)
    except (OSError, subprocess.SubprocessError) as e:
        return None, 'gh 无法执行：%s' % e
    if r.returncode != 0:
        err = (r.stderr or b'').decode('utf-8', 'replace').strip().splitlines()
        return None, 'gh 退出码 %d：%s' % (r.returncode, err[0] if err else '')
    return r.stdout.decode('utf-8', 'replace'), ''


def fetch_runs(limit):
    # 一次多取一些：台账只收定时运行，而窗口里混着手工触发与 PR 运行。
    # 抓多少就取多少，取不够就让调用方看见"窗口不满"，而不是假装满了。
    per_page = min(100, max(limit * 8, 20))
    out, why = sh(['gh', 'api', '-X', 'GET',
                   '%s?per_page=%d' % (API, per_page),
                   '--jq', '[.workflow_runs[] | {id, created_at, head_sha,'
                           ' status, conclusion, event, display_title}]'])
    if out is None:
        return None, why
    try:
        return json.loads(out), ''
    except ValueError as e:
        return None, 'gh 输出不是 JSON：%s' % e


def fetch_failed_log(run_id):
    out, why = sh(['gh', 'run', 'view', str(run_id), '--log-failed'])
    return (out, '') if out is not None else (None, why)


# ------------------------------------------------------------------------------
# 解析：日志 → [(门禁, 明细)]
# ------------------------------------------------------------------------------
def parse_failed_log(text):
    """把 `--log-failed` 的输出折成「哪个门禁 + 它下面那几句」。

    🔴 必须按"门禁行"切，不能全文 grep FAIL：
       明细里也有 `X ...` 和 `RC=1`，全文搜会把 selftest-all 的一条内层
       失败认成外层门禁失败，于是同一个红因被记两次。
    """
    diags = []
    for raw in text.splitlines():
        line = raw
        if '\t' in line:                      # job \t step \t 时间戳 \t 正文
            line = line.split('\t', 3)[-1]
        line = RE_PREFIX.sub('', line)
        m = RE_GATE.match(line)
        if m:
            diags.append([m.group(1), []])
            continue
        # 明细行的两种历史形态都要收：
        #   0.11.9 之后 `       │ <门禁自己的话>`
        #   之前         `         [1] 小节名`（带 8 空格缩进、没有竖线）
        # 只认"比门禁行缩进更深"的行 —— 否则收尾统计（`1 道门禁失败。`）
        # 会被算进最后一道门禁的明细里。
        indent = len(line) - len(line.lstrip())
        if diags and (indent >= 4 or line.lstrip().startswith(('│', '|'))):
            diags[-1][1].append(re.sub(r'^\s*[│|]\s*', '', line).rstrip())
    return [(g, '\n'.join(d)) for g, d in diags if d or True]


def classify(gate, detail):
    for s in SIGS:
        if gate in s['gates'] and re.search(s['pat'], detail):
            return s['cls'], s['cause'], s['fixed']
    return UNKNOWN, '没有匹配到已知红因 —— 必须人工定性', ''


# ------------------------------------------------------------------------------
# 台账
# ------------------------------------------------------------------------------
def _looks_truncated(detail):
    """只有小节清单、没有一句结论 ⇒ 输出被截断过，别猜。"""
    lines = [l for l in detail.splitlines() if l.strip()]
    heads = [l for l in lines if re.match(r'^\[\d+\]', l.strip())]
    tail = [l for l in lines if re.match(r'^(X |·|🔴)', l.strip())]
    return len(heads) >= 3 and not tail


def build_rows(runs, log_of):
    """一行一次运行，但**逐条红因**分类。

    ⚠️ 一次运行可能有两个互不相干的红因（10-31 就是：基线过期 + tag 缺失）。
       只给整次运行贴一个标签，等于把两条证据压成一条 —— 修好其中一个之后，
       另一个会被当成"同一个问题又复发了"。
    """
    rows = []
    for r in runs:
        row = dict(id=r['id'], at=r['created_at'][:10], sha=(r['head_sha'] or '')[:7],
                   event=r['event'], conclusion=r['conclusion'] or r['status'],
                   items=[], cls='', gates='', fixed='')
        if row['conclusion'] == 'failure':
            log, why = log_of(r['id'])
            if log is None:
                row['items'] = [('-', UNKNOWN, '日志取不到：%s' % why, '')]
            else:
                diags = parse_failed_log(log)
                if not diags:
                    row['items'] = [('-', UNKNOWN,
                                     '日志里没有门禁行（失败发生在门禁之外）', '')]
                for gate, detail in diags:
                    if _looks_truncated(detail):
                        row['items'].append(
                            (gate, UNKNOWN, '日志只有小节清单、没有失败原因（输出被截断）', ''))
                    else:
                        cls, cause, fixed = classify(gate, detail)
                        row['items'].append((gate, cls, cause, fixed))
            row['gates'] = '、'.join(i[0] for i in row['items'])
            row['cls'] = '、'.join(dict.fromkeys(i[1] for i in row['items']))
            row['fixed'] = '；'.join(dict.fromkeys(i[3] for i in row['items'] if i[3]))
        rows.append(row)
    return rows


def is_pending(row):
    return row['conclusion'] in PENDING


def scheduled_streak(rows):
    """连续绿：只看**定时**运行。

    取消（cancelled）既不是绿也不是红；还没出结果（queued/in_progress）更不是 ——
    两种都**打断不了**序列，但也都**不能算绿**（绿要一次跑完的成功）。
    """
    n = 0
    for row in rows:                       # rows 已按新→旧排序
        if row['event'] != 'schedule':
            continue
        if is_pending(row):
            continue
        if row['conclusion'] != 'success':
            return n, row
        n += 1
    return n, None


# ------------------------------------------------------------------------------
# 渲染
# ------------------------------------------------------------------------------
def w(s):
    return sum(2 if unicodedata.east_asian_width(c) in 'WF' else 1 for c in s)


def pad(s, n):
    return s + ' ' * max(0, n - w(s))


def trim(s, n):
    """按**显示宽度**截断（中文占两格）。超宽会把整张表挤歪，读的人会看错行。"""
    if w(s) <= n:
        return s
    out, used = '', 0
    for c in s:
        cw = 2 if unicodedata.east_asian_width(c) in 'WF' else 1
        if used + cw > n - 1:
            return out + '…'
        out, used = out + c, used + cw
    return out


def render(rows, others):
    head = [('日期', 11), ('运行', 12), ('提交', 8), ('结论', 10), ('红因', 18),
            ('类别', 11), ('已知修复', 50)]
    print('  ' + ''.join(pad(h, n) + '  ' for h, n in head))
    print('  ' + '-' * sum(n + 2 for _, n in head))
    for r in rows:
        cells = [(r['at'], 11), (str(r['id']), 12), (r['sha'], 8),
                 (r['conclusion'], 10), (r['gates'] or '-', 18),
                 (r['cls'] or '-', 11), (r['fixed'] or '-', 50)]
        print('  ' + ''.join(pad(trim(c, n), n) + '  ' for c, n in cells))

    streak, blocker = scheduled_streak(rows)
    unknown = [i for r in rows for i in r['items'] if i[1] == UNKNOWN]
    print()
    print('  === G2-01 判定 ===')
    if blocker is None:
        print('  定时运行连续绿：%d 次（窗口内没有红）' % streak)
    else:
        print('  定时运行连续绿：%d 次 —— 被 %s（%s）打断：%s'
              % (streak, blocker['id'], blocker['sha'],
                 blocker['gates'] or blocker['conclusion']))
    pending = [r for r in rows if is_pending(r)]
    if pending:
        print('  另有 %d 次定时运行**还没出结果**（既不算绿也不算红）：%s'
              % (len(pending), '、'.join(str(r['id']) for r in pending)))
    print('  窗口内非定时运行 %d 次（**不计入**稳定性序列）：' % len(others))
    for r in others[:4]:
        print('    %s %-16s %-11s %s' % (r['at'], r['conclusion'], r['event'], r['sha']))
    print('  未分类红因：%d 条%s' % (len(unknown), '' if unknown else '（窗口内全部已定性）'))
    for gate, _cls, cause, _f in unknown:
        print('    %-16s %s' % (gate, cause))
    print()
    print('  ⚠️ 这张表只记**发生了什么**。"已知修复"是修复提交存在，'
          '不是"不会复发"。')
    return 3 if unknown else 0


# ------------------------------------------------------------------------------
# 反向控制（纯内存，不联网）
# ------------------------------------------------------------------------------
def _run(i, at, event, conclusion):
    return dict(id=i, created_at=at + 'T00:00:00Z', head_sha='a' * 40,
                status='completed', conclusion=conclusion, event=event,
                display_title='gate')


def _log(*blocks):
    """拼出 `gh run view --log-failed` 的形态：job\\tstep\\t时间戳\\t正文"""
    out = []
    for b in blocks:
        for line in b.strip('\n').splitlines():
            out.append('job\tstep\t2026-11-01T10:36:23.6647192Z ' + line)
    return '\n'.join(out)


def selftest():
    print('  === nightly-observe 判据合成（离线）===')

    cases = [
        ('基线过期 ⇒ 环境', 'visual-stamp', '  visual-stamp     FAIL    1s\n'
         '       │   FAIL 浅色（_baseline-linux）基线录于 02e2899be9c56e33'
         '（head=3eb9923），当前 c5208457cb1f8a25', '环境'),
        ('tag 缺失 ⇒ 产品', 'release', '  release          FAIL    0s\n'
         '       │   [10] git tag 锚点\n'
         '       │       X 没有 `v0.22.1` 这个 tag ⇒ 版本与提交点之间没有锚点', '产品'),
        ('自检夹具 ⇒ 测试', 'selftest-all', '  selftest-all     FAIL  229s\n'
         '       │   🔴  release-gate.py                RC=1   171111ms\n'
         '       │           X   回执：registry 索引延迟 ⇒ 等到 present 再判', '测试'),
        ('白名单误报 ⇒ 测试', 'proper-noun', '  proper-noun      FAIL    0s\n'
         '       │   ! 以下驼峰词不在白名单，请确认是否为内部代号：', '测试'),
        ('疑似新红因 ⇒ 未分类', 'foo-gate', '  foo-gate         FAIL    0s\n'
         '       │   断言失败：某个没人见过的形态', UNKNOWN),
    ]
    bad = 0
    for name, gate, log, want in cases:
        diags = parse_failed_log(_log(log))
        got = classify(diags[0][0], diags[0][1])[0] if diags else '（解析不到）'
        ok = got == want
        bad += 0 if ok else 1
        print('  %s  %-24s 期望=%-6s 实得=%s' % ('OK ' if ok else 'X  ', name, want, got))

    # 元反向 ①：只按门禁名认，不看那句具体的话 ⇒ 必须变成"未分类"
    diags = parse_failed_log(_log('  visual-stamp     FAIL    1s\n'
                                  '       │   另一种没人见过的失败'))
    got = classify(diags[0][0], diags[0][1])[0]
    ok = got == UNKNOWN
    bad += 0 if ok else 1
    print('  %s  %-24s 期望=%s 实得=%s'
          % ('OK ' if ok else 'X  ', '元反：同门禁、新原因', UNKNOWN, got))

    # 元反向 ②：明细里出现 FAIL 字样，不许被当成第二条门禁行
    diags = parse_failed_log(_log('  visual           FAIL   86s\n'
                                  '       │   FAIL 某个页面不一致'))
    ok = len(diags) == 1
    bad += 0 if ok else 1
    print('  %s  %-24s 期望=1 条 实得=%d 条'
          % ('OK ' if ok else 'X  ', '元反：明细不重复计数', len(diags)))

    # 正：取消不算绿也不算红（连续绿必须在它这里断掉）
    rows = build_rows([_run(1, '2026-11-03', 'schedule', 'success'),
                       _run(2, '2026-11-02', 'schedule', 'cancelled'),
                       _run(3, '2026-11-01', 'schedule', 'success')], lambda _i: (None, '不取'))
    streak, blocker = scheduled_streak(rows)
    ok = streak == 1 and blocker is not None and blocker['id'] == 2
    bad += 0 if ok else 1
    print('  %s  %-24s 期望=1 实得=%d' % ('OK ' if ok else 'X  ', '取消打断连续绿', streak))

    # 还在跑（in_progress）既不算绿也不算红，**不许**当成"被打断"
    rows = build_rows([_run(1, '2026-11-03', 'schedule', 'in_progress'),
                       _run(2, '2026-11-02', 'schedule', 'success')], lambda _i: (None, '不取'))
    streak, blocker = scheduled_streak(rows)
    ok = streak == 1 and blocker is None
    bad += 0 if ok else 1
    print('  %s  %-24s 期望=1/无打断 实得=%d/%s'
          % ('OK ' if ok else 'X  ', '未出结果不打断连续绿', streak,
             '无' if blocker is None else blocker['id']))

    print()
    if bad:
        print('  🔴 %d 条未通过' % bad)
        return 1
    print('  自检全部通过 ⇒ 分类有鉴别力、"未分类"出口真的会开')
    return 0


# ------------------------------------------------------------------------------
def main():
    argv = sys.argv[1:]
    if '--selftest' in argv:
        return selftest()

    limit = 10
    if '--limit' in argv:
        i = argv.index('--limit')
        limit = int(argv[i + 1]) if i + 1 < len(argv) else 10
    as_json = '--json' in argv

    runs, why = fetch_runs(limit)
    if runs is None:
        sys.stderr.write('观察失败（不是"没有红"）：%s\n' % why)
        return 2
    if not runs:
        sys.stderr.write('观察失败：窗口里没有任何运行\n')
        return 2

    cache = {}

    def log_of(rid):
        if rid not in cache:
            cache[rid] = fetch_failed_log(rid)
        return cache[rid]

    sched = [r for r in runs if r['event'] == 'schedule']
    others = [r for r in runs if r['event'] != 'schedule']
    if not sched:
        sys.stderr.write('观察失败：窗口里没有定时运行（手工触发不算稳定性样本）\n')
        return 2
    sched = sched[:limit]
    # 非定时运行只取**同一时间窗**内的：否则会列出上个月的手工触发，
    # 让人误以为"这段时间一直在手工跑"。
    cutoff = sched[-1]['created_at']
    others = [r for r in others if r['created_at'] >= cutoff]
    rows = build_rows(sched, log_of)
    other_rows = build_rows(others, log_of)
    if as_json:
        print(json.dumps(dict(schedule=rows, others=other_rows),
                         ensure_ascii=False, indent=2))
        return 3 if any(i[1] == UNKNOWN for r in rows for i in r['items']) else 0
    print()
    print('  === 定时运行台账（%d 次，新 → 旧）===' % len(rows))
    print()
    return render(rows, other_rows)


if __name__ == '__main__':
    sys.exit(main())
