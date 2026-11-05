#!/usr/bin/env node
/*
 * pdf-export-gate.js — 「HTML → PDF」这条路的判据
 *
 * ============================================================================
 * 🔴 为什么需要一道**新的**门禁，而不是给 print-gate 加几条
 * ============================================================================
 * `print-gate` 与 `agentcss pdf` 都用 CDP，但参数与 `@page` 来源不同：
 *   · print-gate 自己传 margin；导出器给本地 HTML 注入 `@page`
 *   · print-gate 默认不印底色；导出器显式 printBackground:true
 * 所以一道门禁不能代替另一道，导出器还要独自证明就绪、原子替换与失败语义。
 *
 * ============================================================================
 * 判据（每条都能单独红）
 * ============================================================================
 *   E1–E13  真产物 / 确定性 / 纸幅 / 预算 / 打印规则 / 边距 / 参数 / 页树
 *   E14     ready-selector 等到延迟新增内容进入 PDF（比较文字 runs）
 *   E15     真实金融长文每页都有文字，抓透明面板与空白尾页
 *   E16     浏览器失败时 ok:false，已有 PDF 的 SHA-256 不变
 *   E17     ready 永不出现时有界 timeout，旧产物仍不变
 *   E18     非法 wait / 空 selector / 非法 CSS 都是 usage
 *   E19     浏览器进程起不来 ⇒ 结构化失败，而不是未处理的 EPIPE 崩溃
 *   E20     强杀留下的临时 HTML：下次导出清旧的，不碰新的
 *
 * ⚠️ 不覆盖视觉像素比对；远程 URL 也不注入 `@page`，纸幅由页面自己决定。
 *
 * 用法：
 *   node 05-audit/pdf-export-gate.js            # 全部判据，自带夹具，不需要服务器
 *   node 05-audit/pdf-export-gate.js --selftest # 失败保护、超时与非法参数
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

    if (!only) {
      /* E14：等待不是看耗时，而是看延迟新增的文字 run 是否真的进入 PDF。 */
      const delayed = path.join(FIX, '03-delayed.html');
      const rEarly = cli(['pdf', delayed, '--out', out('early.pdf'), '--wait-ms=0', '--json']);
      const rReady = cli(['pdf', delayed, '--out', out('ready.pdf'), '--wait-ms=0',
        '--ready-selector=#late-ready', '--json']);
      const jReady = jsonOf(rReady);
      const earlyRuns = pdfRuns(out('early.pdf'));
      const readyRuns = pdfRuns(out('ready.pdf'));
      check('E14 ready-selector 等到延迟内容进入 PDF',
        rEarly.status === 0 && rReady.status === 0 && !!jReady
        && jReady.readySelector === '#late-ready' && jReady.waitMs === 0
        && earlyRuns > 0 && readyRuns >= earlyRuns + 5,
        'runs early=' + earlyRuns + ' ready=' + readyRuns);

      /* E15：真实长金融文档同时抓“透明面板”与“全空白尾页”。
         print-gate 的 PDF 分析器逐页要求文字算子，不能只验 %PDF- 与总页数。 */
      const finance = path.join(ROOT, 'examples', 'finance-report', 'index.html');
      const rFinance = cli(['pdf', finance, '--out', out('finance.pdf'), '--json']);
      const jFinance = jsonOf(rFinance);
      const financeAudit = spawnSync(process.execPath, [GATE, '--pdf', out('finance.pdf')],
        { encoding: 'utf8', timeout: 60000 });
      let aFinance = null;
      try { aFinance = JSON.parse(financeAudit.stdout); } catch (e) { /* 下方判红 */ }
      check('E15 真实金融长文：完整 PDF 且每页都有文字',
        rFinance.status === 0 && !!jFinance && jFinance.ok
        && financeAudit.status === 0 && !!aFinance
        && aFinance.pages === jFinance.pages && aFinance.fontProblems.length === 0,
        aFinance ? '页=' + aFinance.pages + ' runs=' + aFinance.runs
          + ' 字体问题=' + aFinance.fontProblems.length : '分析器输出无法解析');
    }

    /* E16：旧实现最危险的假成功 —— 浏览器失败，旧 PDF 却被当成本次产物。 */
    const staleOut = out('stale.pdf');
    const made = cli(['pdf', panelOn, '--out', staleOut, '--wait-ms=0', '--json']);
    const digest = () => require('crypto').createHash('sha256')
      .update(fs.readFileSync(staleOut)).digest('hex');
    const before = made.status === 0 && fs.existsSync(staleOut) ? digest() : '';
    const failed = pdfMod.exportPdf({ src: panelOn, out: staleOut,
      chrome: process.execPath, waitMs: 0, timeoutMs: 10000 });
    const after = fs.existsSync(staleOut) ? digest() : '';
    check('E16 浏览器失败：非零结论且旧 PDF 逐字节保留',
      made.status === 0 && !!before && !failed.ok && failed.code === 'render'
      && before === after, 'code=' + failed.code + ' hash不变=' + (before === after));

    /* E17：永远不出现的 ready 元素必须有界失败，而且不能碰旧产物。 */
    const timed = pdfMod.exportPdf({ src: panelOn, out: staleOut,
      readySelector: '#never-ready', waitMs: 0, timeoutMs: 1000 });
    check('E17 ready-selector 永不出现：有界 timeout 且旧文件不变',
      !timed.ok && timed.code === 'timeout' && digest() === before,
      'code=' + timed.code + ' ms=' + timed.ms + ' hash不变=' + (digest() === before));

    /* E19：浏览器起不来时，命令管道会以 EPIPE 结束。没有 error 监听的话
       Node **直接抛出** —— 调用方看到的是堆栈，而不是一份结构化结论。
       这条用"指向不存在的可执行文件"端到端复现，判的是结论形状。 */
    fs.mkdirSync(path.join(dir, 'no-chrome'), { recursive: true });
    const renderer = spawnSync(process.execPath,
      [path.join(ROOT, 'ai', 'pdf-renderer.js')], {
        input: JSON.stringify({
          src: panelOn, target: require('url').pathToFileURL(panelOn).href,
          chrome: path.join(dir, 'no-chrome', 'chrome-does-not-exist'),
          profile: path.join(dir, 'no-chrome', 'profile'),
          stagedPdf: path.join(dir, 'no-chrome.pdf'),
          waitMs: 0, readySelector: null, timeoutMs: 5000,
        }),
        encoding: 'utf8', timeout: 20000,
      });
    let jNoChrome = null;
    try { jNoChrome = JSON.parse(renderer.stdout); } catch (e) { /* 下方判红 */ }
    const crashed = /Unhandled 'error' event|EPIPE/.test(String(renderer.stderr));
    check('E19 浏览器进程起不来：结构化失败，不是 EPIPE 崩溃',
      renderer.status === 0 && !!jNoChrome && jNoChrome.ok === false
      && jNoChrome.code === 'render' && !crashed,
      'rc=' + renderer.status + ' code=' + (jNoChrome && jNoChrome.code)
      + ' 未捕获堆栈=' + crashed);

    /* E20：硬杀（Ctrl+C / 断电）会留下 `.agentcss-print-*.html`，finally 跑不到。
       下次导出要顺手清掉**陈旧**残留，但不能碰刚生成的（可能是并发导出）。 */
    const sweepDir = path.join(dir, 'sweep');
    fs.mkdirSync(sweepDir, { recursive: true });
    const sweepSrc = path.join(sweepDir, 'page.html');
    fs.writeFileSync(sweepSrc, '<!doctype html><html lang="zh-CN"><head>'
      + '<meta charset="utf-8"><title>sweep</title></head><body><p>SWEEP</p></body></html>');
    const staleTmp = path.join(sweepDir, '.agentcss-print-0000000000000-dead.html');
    const freshTmp = path.join(sweepDir, '.agentcss-print-0000000000001-live.html');
    fs.writeFileSync(staleTmp, 'stale');
    fs.writeFileSync(freshTmp, 'fresh');
    const sevenHoursAgo = (Date.now() - 7 * 3600 * 1000) / 1000;
    fs.utimesSync(staleTmp, sevenHoursAgo, sevenHoursAgo);
    const rSweep = cli(['pdf', sweepSrc, '--out', out('sweep.pdf'), '--wait-ms=0', '--json']);
    check('E20 硬杀留下的临时 HTML：清旧的、不碰新的',
      rSweep.status === 0 && !fs.existsSync(staleTmp) && fs.existsSync(freshTmp),
      'rc=' + rSweep.status + ' 陈旧已删=' + !fs.existsSync(staleTmp)
        + ' 新的保留=' + fs.existsSync(freshTmp));

    /* E18：新参数的用法错误必须走统一 usage，不许悄悄按默认值导出。 */
    const badWait = cli(['pdf', panelOn, '--out', out('bad-wait.pdf'), '--wait-ms=-1']);
    const badReady = cli(['pdf', panelOn, '--out', out('bad-ready.pdf'), '--ready-selector=']);
    const badCss = cli(['pdf', panelOn, '--out', out('bad-css.pdf'),
      '--wait-ms=0', '--ready-selector=[']);
    check('E18 非法 wait / 空 selector / 非法 CSS ⇒ 退出码 2',
      badWait.status === 2 && badReady.status === 2 && badCss.status === 2,
      'wait=' + badWait.status + ' empty=' + badReady.status + ' css=' + badCss.status);

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
