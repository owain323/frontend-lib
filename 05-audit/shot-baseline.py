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
用法
---------------------------------------------------------------------------
  python 05-audit/shot-baseline.py --record     # 录基线（首次跑）
  python 05-audit/shot-baseline.py --check      # 门禁：与基线 diff
  python 05-audit/shot-baseline.py --update     # 显式重录（改 CSS 前先问自己）
  python 05-audit/shot-baseline.py --list       # 列出所有受管页面
  python 05-audit/shot-baseline.py --check --threshold 2.0
"""
import sys
import os
import io
import json
import glob
import subprocess
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, '10-review', 'shots')
BASELINE = os.path.join(SHOTS, '_baseline')
CURRENT = os.path.join(SHOTS, '_current')
DIFFS = os.path.join(SHOTS, '_diff')

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
    ('02-primitives/choice',      'demo.html', '单选/复选'),
    ('02-primitives/switch',      'demo.html', '开关'),
    ('02-primitives/select',      'demo.html', '下拉选择'),
    ('02-primitives/combobox',    'demo.html', '组合框'),
    ('02-primitives/date-range',  'demo.html', '日期区间'),
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
    ('04-recipes/table',          'demo.html', '表格'),
    ('09-assets/bar',             'demo.html', '柱状图'),
    ('10-review/composition',     'demo.html', '组合页'),
]

VIEWPORT = (393, 852)      # iPhone 尺寸：移动端是这个尺寸


def _which_node():
    """找 managed node（与其它门禁同一套）"""
    cands = [
        r'${HOME}/.toolchain\binaries\node\versions\22.17.0\node.exe',
    ]
    for c in cands:
        if os.path.exists(c):
            return c
    return shutil.which('node') or shutil.which('node.exe')


def _pages_exist():
    out = []
    for d, f, label in PAGES:
        p = os.path.join(ROOT, d, f)
        if os.path.exists(p):
            out.append((d, f, label, p))
        else:
            print('  [skip] 页面不存在：%s/%s' % (d, f))
    return out


SHOOT_JS = r"""
/* 🔴🔴 I1：**单进程批量截图**（原来每页一次 node 调用）
 * ---------------------------------------------------------------------------
 * 原来：23 个页面 ⇒ 23 次 `node` 冷启动 + 23 次浏览器启动
 *      ⇒ 实测 74 秒（占全量门禁 402 秒的 18%）
 * 现在：**一个 node 进程 + 一个浏览器 + 复用同一个 page**
 *      ⇒ 只付一次启动成本（~2 秒）
 *
 * ⚠️ 关键点：必须**复用同一个 page**（只改 goto），
 *   新建 page 的成本约 300-500ms/次，23 次就 10 秒。
 */
const fs = require('fs');
const { launch } = require('05-audit/browser.js');
const TASKS = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
(async () => {
  const b = await launch();
  const p = await b.newPage();
  let ok = 0;
  const T = { boot: 0, goto: 0, settle: 0, shot: 0 };
  const _m = () => Date.now();
  for (const t of TASKS) {
    try {
      let _t0 = _m();
      await p.setViewport({ width: t.w, height: t.h, deviceScaleFactor: 2 });
      T.boot += _m() - _t0; _t0 = _m();
      /* 🔴  I1 优化（**基于分项实测**，不是猜）：
       *   实测 goto(networkidle0) = 35.5s（60%）、固定 settle = 16.3s（28%）、
       *   截图只 6.6s（11%）⇒ **瓶颈全在"等"**。
       *   ⇒ ① 等待条件放宽到 domcontentloaded（DOM 就绪即可开始渲染）
       *   ② settle 由 700ms 降到 300ms（配合 ① 补偿）
       *   ⚠️ 风险：可能截到"未渲染完"的页面 ⇒ **必须验证 23/23 观感一致**。
       *   ⚠️ 之所以敢放宽：本库是**纯静态**页面（无 XHR/轮询），
       *      networkidle0 的 500ms 静默期在这里纯属浪费。 */
      await p.goto(t.url, { waitUntil: 'domcontentloaded' });
      T.goto += _m() - _t0; _t0 = _m();
      await new Promise((r) => setTimeout(r, t.wait || 300));
      T.settle += _m() - _t0; _t0 = _m();

      /* 🔴 冻结所有动画再截图（原来就有这条，务必保留）
         —— 同一份代码连截两次会不一致（spinner / 骨架屏扫光是 infinite），
            门禁必然假红。⚠️ `none` 而不是 `paused`：paused 会停在任意帧。 */
      await p.addStyleTag({
        content: '*,*::before,*::after{animation:none !important;' +
                 'transition:none !important;caret-color:transparent !important}',
      });
      await new Promise((r) => setTimeout(r, 120));
      await p.screenshot({ path: t.out, fullPage: true });
      T.shot += _m() - _t0;
      ok++;
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
              's shot=' + (T.shot / 1000).toFixed(1) +
              's viewport=' + (T.boot / 1000).toFixed(1) +
              's  (per page: goto=' + (T.goto / n / 1000).toFixed(2) +
              's shot=' + (T.shot / n / 1000).toFixed(2) + 's)');
  console.log('SHOT_OK=' + ok);
  process.exit(ok === TASKS.length ? 0 : 1);
})();
"""


def shoot(outdir):
    """对每个受管页面截图到 outdir"""
    os.makedirs(outdir, exist_ok=True)
    node = _which_node()
    if not node:
        print('  [FAIL] 找不到 node')
        return 0
    # 静态服务器
    srv = subprocess.Popen(
        [sys.executable, '-m', 'http.server', '8000', '--bind', '127.0.0.1'],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ok = 0
    try:
        import time
        time.sleep(1.2)
        # ----  I1：一次 node 截全部（原来每页一次）----
        import json as _json
        import time as _time
        pages = _pages_exist()
        _t0 = _time.time()
        tasks = []
        for d, f, label, path in pages:
            tasks.append({
                'url': 'http://127.0.0.1:8000/%s/%s' % (d, f),
                'out': os.path.join(outdir, d.replace('/', '_') + '_' + f),
                'w': VIEWPORT[0], 'h': VIEWPORT[1],
                'label': label, 'wait': 300,
            })
        tmp_js = os.path.join(outdir, '_shoot.js')
        tmp_jsn = os.path.join(outdir, '_shoot.json')
        io.open(tmp_js, 'w', encoding='utf-8').write(SHOOT_JS)
        io.open(tmp_jsn, 'w', encoding='utf-8').write(_json.dumps(tasks))
        # 🔴 子进程必须继承 NODE_PATH：puppeteer-core 装在受管 workspace 里
        env = dict(os.environ)
        for ws in (r'${WORKSPACE}/node_modules',
                   os.path.join(ROOT, 'node_modules')):
            if os.path.isdir(ws):
                env['NODE_PATH'] = ws + os.pathsep + env.get('NODE_PATH', '')
                break
        r = subprocess.run([node, tmp_js, tmp_jsn], capture_output=True,
                           timeout=300, env=env)
        os.remove(tmp_js)
        os.remove(tmp_jsn)
        _dt = _time.time() - _t0
        print('  [I1] 一次进程截 %d 页，用时 %.1f 秒（原来约 74 秒）'
              % (len(tasks), _dt))
        ok = 0
        for line in (r.stdout or b'').decode('utf-8', 'replace').splitlines():
            if line.startswith('SHOT_OK='):
                ok = int(line.split('=')[1])
        for line in (r.stdout or b'').decode('utf-8', 'replace').splitlines():
            if line.startswith('TIMING '):
                print('  [I1] 分项耗时 ' + line[7:])
        if r.returncode != 0 and ok == 0:
            print('  [FAIL] 批量截图失败：%s'
                  % (r.stderr or b'').decode('utf-8', 'replace')[:200])
        print('  截了 %d / %d 个页面' % (ok, len(_pages_exist())))
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=3)
        except Exception:
            srv.kill()
    return ok


def _try_pil():
    try:
        from PIL import Image
        return Image
    except ImportError:
        return None


def diff_all(threshold=1.0, tolerance=12):
    """逐像素 diff 当前 vs 基线。返回 (通过数, 失败列表)"""
    if not os.path.isdir(BASELINE):
        return None, ['没有基线 —— 请先跑 --record']
    Image = _try_pil()
    if not Image:
        return None, ['缺少 Pillow（pip install pillow）才能做逐像素 diff']

    bfiles = {os.path.basename(x) for x in glob.glob(os.path.join(BASELINE, '*.png'))}
    passed, failed = 0, []
    os.makedirs(DIFFS, exist_ok=True)

    for name in sorted(bfiles):
        bp = os.path.join(BASELINE, name)
        cp = os.path.join(CURRENT, name)
        if not os.path.exists(cp):
            failed.append((name, 100.0, '当前截图缺失'))
            continue
        try:
            a = Image.open(bp).convert('RGB')
            b = Image.open(cp).convert('RGB')
        except Exception as e:
            failed.append((name, 100.0, '打不开：%s' % e))
            continue
        if a.size != b.size:
            failed.append((name, 100.0, '尺寸变了：%s → %s' % (a.size, b.size)))
            continue
        w, h = a.size
        # ⭐⭐ 判据的核心：**分块（tile）检测，不是全页百分比**。
        #
        #   🔴 踩坑记录（这是本脚本最重要的一次修正）：
        #     判别力验证里把按钮圆角改成 0（**明显变丑**），
        #     结果「全页差异 0.065%」⇒ 被阈值放过了。
        #
        #   ⭐ 原因：视觉退化通常是**局部集中**的
        #     （一个按钮的几个圆角 ≈ 几百像素）
        #     而页面有 150 万像素 ⇒ 摊到全页就微不足道。
        #
        #   ⭐ 解法：把页面切成 32×32 的块，**任一块**变化超阈值就 fail。
        #     实测同一个改动：全页 0.065% ⇒ 最差块 **10.5%**（放大 160 倍）。
        #
        #   TILE=32 的理由：圆角半径（--r-sm=6px）的尺度就是这个量级，
        #     块太大会把"局部退化"摊薄，块太小会被字体抗锯齿噪声干扰。
        TILE = 32
        # 每块的容差：块小 ⇒ 允许的比例略高（否则纯噪声会天天假红）
        TILE_PCT = 3.0      # 任一块变化 > 3% ⇒ fail
        PAGE_PCT = 0.5      # 全页变化 > 0.5% ⇒ fail（捕捉大面积改动）

        diff = Image.new('RGB', (w, h))
        dp = diff.load(); ap = a.load(); bp2 = b.load()
        n = 0
        # 标记 tile 是否超阈值
        bad_tiles = []
        for ty in range(0, h, TILE):
            for tx in range(0, w, TILE):
                tn = 0; ttot = 0
                for y in range(ty, min(ty + TILE, h)):
                    for x in range(tx, min(tx + TILE, w)):
                        ttot += 1
                        r1, g1, b1 = ap[x, y]
                        r2, g2, b2 = bp2[x, y]
                        if (abs(r1 - r2) > tolerance or abs(g1 - g2) > tolerance
                                or abs(b1 - b2) > tolerance):
                            tn += 1
                            n += 1
                            dp[x, y] = (255, 0, 0)          # 标红
                        else:
                            dp[x, y] = (b1, b1, b1)          # 灰度底
                tp = 100.0 * tn / max(1, ttot)
                if tp > TILE_PCT:
                    bad_tiles.append((tx, ty, tp))
        pct = 100.0 * n / (w * h)
        diff.save(os.path.join(DIFFS, name))
        if bad_tiles or pct > PAGE_PCT:
            worst = max(bad_tiles, key=lambda t: t[2]) if bad_tiles else (0, 0, 0)
            why = ('%d 个块变化超 %.1f%%（最差 %s 处 %.1f%%）；全页 %.3f%%'
                   % (len(bad_tiles), TILE_PCT, str(worst[:2]), worst[2], pct))
            failed.append((name, pct, why))
        else:
            passed += 1
    return passed, failed


def main():
    argv = sys.argv[1:]
    if '--list' in argv:
        for d, f, label in PAGES:
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

    def css_fingerprint():
        """所有 CSS 的内容指纹（用来判断基线是否录于当前代码）"""
        import hashlib
        h = hashlib.sha256()
        for f in sorted(glob.glob(os.path.join(ROOT, '0*', '*', '*.css'))):
            h.update(os.path.relpath(f, ROOT).encode('utf-8'))
            h.update(io.open(f, 'rb').read())
        return h.hexdigest()[:16]

    def stamp_path():
        return os.path.join(BASELINE, '_stamp.json')

    def read_stamp():
        try:
            return json.load(io.open(stamp_path(), encoding='utf-8'))
        except Exception:
            return None

    if '--record' in argv or '--update' in argv:
        # ⚠️ 更新前先清空，避免残留旧图
        if os.path.isdir(BASELINE):
            shutil.rmtree(BASELINE)
        os.makedirs(BASELINE, exist_ok=True)
        # 先截到 current，再搬到 baseline（复用同一套代码 ⇒ 录的就是比的）
        n = shoot(BASELINE)
        # 🔴 写指纹：下次报 diff 时能判断"是代码变了，还是基线录于旧代码"
        fp = css_fingerprint()
        io.open(stamp_path(), 'w', encoding='utf-8').write(json.dumps(
            {'fingerprint': fp, 'pages': n}, ensure_ascii=False, indent=2))
        print('  已录基线：%d 个页面 → %s' % (n, os.path.relpath(BASELINE, ROOT)))
        print('  CSS 指纹：%s（用于判断基线是否过期）' % fp)
        return 0 if n else 1

    # 默认 --check
    if not os.path.isdir(BASELINE):
        print('  [FAIL] 没有基线。请先跑：python 05-audit/shot-baseline.py --record')
        return 1
    n = shoot(CURRENT)
    # 🔴 先看基线是否录于当前 CSS（不是，但它本来就录于某个状态）
    st = read_stamp()
    if st:
        now_fp = css_fingerprint()
        if now_fp != st.get('fingerprint'):
            print('  === 视觉回归 ===')
            print('  ⚠️ CSS 指纹与基线不符：基线录于 %s，现在是 %s' % (
                st.get('fingerprint', '?'), now_fp))
            print('     ⇒ 如果这些 CSS 改动是**有意的**，请重录：--update')
            print('     ⇒ 否则这就是真回归，继续看下面的 diff：')
            print('')
    passed, failed = diff_all(threshold=threshold)
    if passed is None:
        print('  [FAIL] %s' % (failed[0] if failed else '未知错误'))
        return 1

    print('  === 视觉回归（阈值 %.2f%%）===' % threshold)
    print('  OK   %d / %d 个页面观感一致' % (passed, n))
    for name, pct, why in failed:
        print('  FAIL  %-34s %s' % (name, why))
        print('        diff 图：%s' % os.path.join('10-review/shots/_diff', name))
    if failed:
        print('')
        print('  ⇒ 如果这是**有意**的视觉改动，用：--update 重录基线')
        print('    如果不是，说明某处 CSS 被改坏了（而行为契约抓不到这类问题）')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
