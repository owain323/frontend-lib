#!/usr/bin/env node
/*
 * pdf-export-gate.js — 「HTML → PDF」这条路的判据
 *
 * ============================================================================
 * 🔴 为什么需要一道**新的**门禁，而不是给 print-gate 加几条
 * ============================================================================
 * `print-gate` 判的是「页面在 print 媒体下印出来好不好」（用 puppeteer 的
 * `page.pdf()`）—— 那是**我们自己**的渲染路径。
 * 使用者用的是 `agentcss pdf`（Chrome 命令行 `--print-to-pdf`），是**另一条**路。
 *
 * 两条路的差异是真实的，不是实现细节：
 *   · `@page` 由谁给：print-gate 用 CDP 的 margin 参数；导出器注入 `@page`
 *   · 底色：CDP 默认不印（`printBackground:false`）；命令行默认**印**
 *
 * 所以「print-gate 全绿」完全不能推出「`agentcss pdf` 能用」。
 * 一个功能没有判据 = 它在下一轮改动里随时会碎，而且没人知道。
 *
 * ============================================================================
 * 判据（每条都能单独红）
 * ============================================================================
 *   E1  真产出    退出码 0、文件以 `%PDF-` 开头、页数 ≥1
 *   E2  确定性    同一输入导两次：页数与字节数相同（异步渲染没排完会变）
 *   E3  纸幅       `--paper=letter` → 612×792pt；a4 → 595×842pt；两者不同
 *   E4  预算通过   页数 = 预算 ⇒ 退出码 0
 *   E5  预算超限   页数 > 预算 ⇒ 退出码 **5**、三條出路齐全、产物仍然保留
 *   E6  打印规则   引了 tokens.css 的页面比不引的多出隐藏面板的文字
 *   E7  边距生效   60mm 的页数 > 10mm 的页数（否则 `--margin` 是个摆设）
 *   E8  无浏览器   明确报错（退出码 3、提到 Chrome、没有堆栈）
 *   E9  参数校验   非法边距 / 未知纸幅 ⇒ 退出码 2（不是"导出一份奇怪的东西"）
 *   E10 默认输出   不给 `--out` 时落在同名 .pdf
 *   E11 产物合格   交给 print-gate 的分析器：字体引用链闭环、每页有文本算子
 *   E12 解析一致   导出器与测试侧的 Chrome 定位结果必须是同一个文件
 *
 * ⚠️ 这些判据**不覆盖**：
 *   · 视觉正确（底色位置、表格边框粗细）—— 要栅格化比对，不在本文件范围
 *   · 远程 URL 的 `@page`：我们拿不到远程页面的字节，**不注入**，只警告。
 *     E3/E7 因此只对本地文件成立（这正是"注入"这件事的边界）
 *
 * 用法：
 *   node 05-audit/pdf-export-gate.js            # 全部判据（约 12s，自带夹具，不需要服务器）
 *   node 05-audit/pdf-export-gate.js --selftest # 只跑"必须红"的那几条（约 2s）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.dirname(__dirname);
const CLI = path.join(ROOT, 'ai', 'cli.js');
const FIX = path.join(ROOT, '05-audit', 'fixtures', 'pdf-export');
const GATE = path.join(ROOT, '05-audit', 'print-gate.js');

let bad = 0;
function check(id, ok, detail) {
  console.log('  [' + (ok ? 'OK  ' : 'FAIL') + '] ' + id.padEnd(44)
    + (detail === undefined ? '' : String(detail)));
  if (!ok) bad += 1;
}

/** 按使用者会用的方式调用 CLI（真入口，不是内部函数）。 */
function cli(args, opt) {
  return spawnSync(process.execPath, [CLI].concat(args),
    Object.assign({ encoding: 'utf8', timeout: 120000 }, opt || {}));
}

function jsonOf(r) {
  try { return JSON.parse(r.stdout); } catch (e) { return null; }
}

function main() {
  const only = process.argv.indexOf('--selftest') >= 0;
  /* 导出器本体：E12 交叉核对 / E8′ 的"无浏览器"报错都要直接调它 */
  const pdfMod = require(path.join(ROOT, 'ai', 'pdf.js'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcss-pdfexport-'));
  const out = (n) => path.join(dir, n);
  const panelOn = path.join(FIX, '01-panel-on.html');
  const panelOff = path.join(FIX, '01-panel-off.html');
  const longDoc = path.join(FIX, '02-long.html');
  const t0 = Date.now();

  try {
    if (!only) {
      /* ---------------- E1 真产出 ---------------- */
      const r1 = cli(['pdf', panelOn, '--out', out('a.pdf'), '--json']);
      const j1 = jsonOf(r1);
      const exists = fs.existsSync(out('a.pdf'));
      const head = exists ? fs.readFileSync(out('a.pdf')).slice(0, 5).toString('latin1') : '';
      check('E1 导出一份真 PDF', r1.status === 0 && !!j1 && j1.ok === true
        && exists && head === '%PDF-' && j1.pages >= 1,
        'rc=' + r1.status + ' 头=' + JSON.stringify(head)
        + ' 页=' + (j1 && j1.pages) + ' 注入=' + (j1 && j1.injected));

      /* ---------------- E2 确定性 ---------------- */
      const r2 = cli(['pdf', panelOn, '--out', out('b.pdf'), '--json']);
      const j2 = jsonOf(r2);
      check('E2 同一输入两次导出：页数与字节数相同',
        !!j1 && !!j2 && j1.pages === j2.pages && j1.bytes === j2.bytes,
        (j1 && j2) ? j1.pages + ' 页/' + j1.bytes + 'B vs '
          + j2.pages + ' 页/' + j2.bytes + 'B' : '解析失败');

      /* ---------------- E3 纸幅 ---------------- */
      const rl = cli(['pdf', panelOn, '--out', out('letter.pdf'), '--paper=letter', '--json']);
      const jl = jsonOf(rl);
      const w = jl && jl.paperSize ? jl.paperSize : '';
      check('E3 --paper 真的换纸幅（a4 595×842 / letter 612×792）',
        !!jl && jl.ok && w === '612×792pt' && j1.paperSize === '595×842pt',
        'a4=' + (j1 && j1.paperSize) + ' letter=' + w);

      /* ---------------- E4 预算通过 ---------------- */
      const pagesA = j1 ? j1.pages : 0;
      const r4 = cli(['pdf', panelOn, '--out', out('c.pdf'),
        '--max-pages=' + pagesA, '--json']);
      const j4 = jsonOf(r4);
      check('E4 页数 = 预算 ⇒ 通过', r4.status === 0 && !!j4 && j4.ok === true,
        'rc=' + r4.status + ' 预算=' + pagesA + ' 页=' + (j4 && j4.pages));

      /* ---------------- E5 预算超限 ---------------- */
      const r5 = cli(['pdf', longDoc, '--out', out('over.pdf'), '--max-pages=1']);
      const txt5 = String(r5.stderr || '') + String(r5.stdout || '');
      const remedies = ['拆文档', '进附录', '截断'].filter((k) => txt5.indexOf(k) >= 0);
      check('E5 超预算 ⇒ 退出码 5 + 三条出路 + 产物保留',
        r5.status === 5 && remedies.length === 3 && fs.existsSync(out('over.pdf')),
        'rc=' + r5.status + ' 出路=' + remedies.join('/'));

      /* ---------------- E6 打印规则到达产物 ---------------- */
      /* 两个夹具除 <link> 行外必须逐字节相同 —— 否则 on>off 可能来自别处，
         这条断言就变成了"两个不同页面的 runs 不同"，毫无意义。 */
      const strip = (f) => fs.readFileSync(f, 'utf8')
        .split('\n').filter((l) => l.indexOf('<link rel="stylesheet"') < 0).join('\n');
      const same = strip(panelOn) === strip(panelOff);
      const ro = cli(['pdf', panelOn, '--out', out('on.pdf'), '--json']);
      const rf = cli(['pdf', panelOff, '--out', out('off.pdf'), '--json']);
      const runsOn = pdfRuns(out('on.pdf'));
      const runsOff = pdfRuns(out('off.pdf'));
      check('E6 引 tokens.css ⇒ 隐藏面板的文字进了 PDF',
        same && ro.status === 0 && rf.status === 0 && runsOn > 0 && runsOn > runsOff,
        'runs on=' + runsOn + ' off=' + runsOff + '（差 ' + (runsOn - runsOff)
        + '）夹具同源=' + same);

      /* ---------------- E7 边距生效 ---------------- */
      const rT = cli(['pdf', longDoc, '--out', out('m10.pdf'), '--margin=10mm', '--json']);
      const rW = cli(['pdf', longDoc, '--out', out('m60.pdf'), '--margin=60mm', '--json']);
      const jT = jsonOf(rT);
      const jW = jsonOf(rW);
      check('E7 边距影响页数（60mm > 10mm）',
        !!jT && !!jW && jW.pages > jT.pages,
        '10mm=' + (jT && jT.pages) + ' 页 / 60mm=' + (jW && jW.pages) + ' 页');

      /* ---------------- E10 默认输出 ---------------- */
      const defOut = longDoc.replace(/\.html$/i, '.pdf');
      try { fs.unlinkSync(defOut); } catch (e) { /* 不存在才对 */ }
      const r10 = cli(['pdf', longDoc]);
      check('E10 不给 --out ⇒ 落在同名 .pdf',
        r10.status === 0 && fs.existsSync(defOut), defOut.replace(ROOT, '.'));
      try { fs.unlinkSync(defOut); } catch (e) { /* 已删 */ }

      /* ---------------- E11 产物合格（交给 print-gate 的分析器） ---------------- */
      const r11 = spawnSync(process.execPath, [GATE, '--pdf', out('a.pdf')],
        { encoding: 'utf8', timeout: 60000 });
      let a11 = null;
      try { a11 = JSON.parse(r11.stdout); } catch (e) { /* 下面判 */ }
      check('E11 产物通过 PDF 分析器（字体链闭环 / 每页有文本）',
        r11.status === 0 && !!a11 && a11.pages >= 1 && a11.runs > 0
        && a11.fontProblems.length === 0,
        a11 ? '页=' + a11.pages + ' runs=' + a11.runs + ' 字体问题=' + a11.fontProblems.length
          : '分析器输出无法解析');

      /* ---------------- E12 Chrome 定位一致 ---------------- */
      const res = pdfMod.resolveChrome();
      const browser = require(path.join(ROOT, '05-audit', 'browser.js'));
      const sameChrome = !res.path || !browser.CHROME
        || path.resolve(res.path) === path.resolve(browser.CHROME);
      check('E12 导出器与测试侧定位到同一个 Chrome', sameChrome,
        (res.path || '(无)') + ' vs ' + (browser.CHROME || '(无)'));
    }

    /* ================= 以下"必须红"，--selftest 也跑 ================= */
    const r8 = cli(['pdf', panelOn, '--out', out('x.pdf'),
      '--chrome', path.join(dir, 'no-such-chrome.exe')]);
    const t8 = String(r8.stderr || '');
    /* 既要有话说，又不许把内部堆栈甩给使用者（那是"工具坏了"的样子） */
    check('E8 没有浏览器 ⇒ 退出码 3 + 说人话 + 无堆栈',
      r8.status === 3 && /Chrome/.test(t8) && !/\n\s+at /.test(t8),
      'rc=' + r8.status + ' 提到Chrome=' + /Chrome/.test(t8));

    /* E8′：**一个候选都没有**时的报错。这条不能靠"这台机器恰好没装 Chrome"，
       所以用 resolveChrome 的可测性口子喂一个空候选表（开发机上这条永远测不到）。 */
    const none = pdfMod.resolveChrome(null, { candidates: [] });
    check('E8′ 一个候选都没有 ⇒ 报错给出两条自救路径',
      !none.path && /Chrome/.test(none.error) && /AGENTCSS_CHROME/.test(none.error)
      && !/\n\s+at /.test(none.error),
      none.path ? '居然找到了 ' + none.path : '提到Chrome=' + /Chrome/.test(none.error)
        + ' 提到环境变量=' + /AGENTCSS_CHROME/.test(none.error));

    const r9a = cli(['pdf', panelOn, '--out', out('y.pdf'), '--margin=abc']);
    const r9b = cli(['pdf', panelOn, '--out', out('z.pdf'), '--paper=b5']);
    /* 报错必须回显**使用者打进去的那串字符**。E264 就是这么漏的：
       `JSON.stringify(NaN)` 是 `"null"`，于是 `--max-pages=abc` 报「收到 null」，
       使用者会去查一个他从未输入过的值。 */
    const r9c = cli(['pdf', panelOn, '--out', out('z2.pdf'), '--max-pages=abc']);
    const t9c = String(r9c.stderr || '');
    check('E9 非法参数 ⇒ 退出码 2（不产出怪文件）',
      r9a.status === 2 && r9b.status === 2,
      'margin=abc→' + r9a.status + ' paper=b5→' + r9b.status);
    check('E9″ 报错回显原始输入（不是 NaN→null）',
      r9c.status === 2 && /abc/.test(t9c) && !/null/.test(t9c),
      'rc=' + r9c.status + ' 回显=' + JSON.stringify((t9c.match(/收到 (.*)/) || [])[1] || ''));

    /* 元反向：把预算调到 0 —— 参数校验必须拦住它（不然 0 会被当成"无界"混过去） */
    const r0 = cli(['pdf', panelOn, '--out', out('w.pdf'), '--max-pages=0']);
    check('E9′ 预算 0 被拒（0 不许被当成无界）', r0.status === 2, 'rc=' + r0.status);

    /* ---------------------------------------------------------------
     * E13 长文档的页树：`/Count` 必须解析到**根**，不是叶节点
     * ---------------------------------------------------------------
     * 🔴 这个 bug 是被 50 页样本抓出来的：
     *    Chromium 的分层页树里，文件里第一个 `/Count` 是**叶节点**的数。
     *    实测一份 50 页产物：8 个 `/Count` = 8,8,8,8,8,8,2,50 —— 只有最后一个是根。
     *    旧实现取第一个 ⇒ `pages=50` vs `countFromTree=8` ⇒ 导出器报
     *    "两套说法不一致，无法判定预算" ⇒ **用户的正常长文档被读法错误挡在门外**。
     */
    const pagesMod = require(path.join(ROOT, 'ai', 'pdf-pages.js'));

    /* ① 纯函数：合成一份"叶节点 /Count 在前、根在后"的字节 */
    const N = 50;
    const objs = [];
    objs.push('1 0 obj\n<</Type /Pages /Count 8 /Kids [2 0 R]>>\nendobj\n');
    objs.push('2 0 obj\n<</Type /Catalog /Pages 9 0 R>>\nendobj\n');
    let kids = '';
    for (let i = 0; i < N; i += 1) {
      objs.push((100 + i) + ' 0 obj\n<</Type /Page /Parent 9 0 R>>\nendobj\n');
      kids += (100 + i) + ' 0 R ';
    }
    objs.push('9 0 obj\n<</Type /Pages /Count ' + N + ' /Kids [' + kids + ']>>\nendobj\n');
    const nested = pagesMod.inspect(Buffer.from('%PDF-1.7\n' + objs.join(''), 'latin1'));
    check('E13 分层页树：/Count 取根节点的数',
      nested.pages === N && nested.countFromTree === N && nested.agree,
      'pages=' + nested.pages + ' tree=' + nested.countFromTree);

    /* ② 元反向：把"取第一个 /Count"那份旧逻辑拿回来，同一定义必须读成 8
          —— 证明上面那条绿来自**定位到根**，不是这份样本恰好只有一个 /Count */
    const firstCount = (s) => {
      const m = /\/Count\s+(\d+)/.exec(String(s));
      return m ? +m[1] : null;
    };
    const legacy = firstCount('%PDF-1.7\n' + objs.join(''));
    check('E13′ 元反向：旧读法在同样本上读成 8（证明差别是定位方式）',
      legacy === 8, '旧读法=' + legacy);

    /* ③ 端到端：真长文档带预算导出，两向都要给出**正确的结论** */
    /* ⚠️ 变量名不能叫 longDoc：外层同名的 `const longDoc`（02-long.html）会被这个
       块**遮蔽**，于是同一块里更早的引用（E5/E10）全部落进 TDZ ——
       报错指向第 122 行，跟这里毫无关系。 */
    const longFifty = path.join(ROOT, '05-audit', 'fixtures', 'print-adversarial',
      '01-fifty-pages.html');
    const rOk = cli(['pdf', longFifty, '--out', out('long-ok.pdf'), '--max-pages=60']);
    const rOver = cli(['pdf', longFifty, '--out', out('long-over.pdf'), '--max-pages=40']);
    /* 40 页预算那份必须是"超预算"（退出码 5），不能是"无法判定"（退出码 4）：
       两者的区别是"你的文档超了"还是"我读不懂" —— 后者会让使用者去查 PDF 有没有坏。 */
    check('E13 端到端：50 页文档 · 预算 60 ⇒ 通过',
      rOk.status === 0, 'rc=' + rOk.status);
    check('E13 端到端：50 页文档 · 预算 40 ⇒ 报超预算（不是"无法判定"）',
      rOver.status === 5, 'rc=' + rOver.status
        + ' 提到无法判定=' + /无法判定/.test(String(rOver.stderr)));

    console.log('');
    console.log('  ' + (bad ? '❌ 有 ' + bad + ' 条没通过' : '✅ 全部通过')
      + '（' + Math.round((Date.now() - t0) / 1000) + 's）');
    return bad ? 1 : 0;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 系统清理 */ }
  }
}

/** 借 print-gate 的分析器数文字 run（不重复实现 PDF 解析，见 E31）。 */
function pdfRuns(file) {
  const r = spawnSync(process.execPath, [GATE, '--pdf', file],
    { encoding: 'utf8', timeout: 60000 });
  try { return JSON.parse(r.stdout).runs; } catch (e) { return -1; }
}

/* 顶层兜底：门禁自己崩了必须**判红**，不能因为异常让 check-all 看到 0。
   （这行 `process.exit(1)` 也是 gate-verdict-gate 认的"判红路径"：
     它读源码找非零退出，找不到就当"这道门禁不会失败"。） */
try {
  process.exit(main());
} catch (e) {
  console.error('  🔴 门禁自己出错：' + ((e && e.stack) || e));
  process.exit(1);
}
