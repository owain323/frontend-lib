#!/usr/bin/env node
/* ============================================================================
   分页代价标定（print-pagination-cost）— 标定工具，不判红
   ---------------------------------------------------------------------------
   它回答一个问题：**「不跨页切断」到底烧多少纸？**

   为什么需要标定而不是拍脑袋
     评审建议「不要对可能超过 1/3 页高的块用 break-inside: avoid」。
     这条建议方向对，但"1/3"从哪来？实测之后才知道真正的危险点不在一端 ——
     **在页高一半附近有断崖**：

         块高      占页     avoid 页数   auto 页数   通胀
         240px     0.24        23          23       0%
         330px     0.33        24          24       0%
         420px     0.42        30          26      +15%
         520px     0.53        50          26      +92%   ← 断崖
         700px     0.71        30          21      +43%

     机制：块高 532px、页内可用高约 990px ⇒ 每页只放得下 1 个 ⇒ 每页浪费 46%。
     块高 432px ⇒ 每页 2 个，浪费 12%。**略超一半是最坏点，不是最大点。**

   为什么必须用等高块
     在真实研报里（表格 + 段落 + 卡片混排），跨 3 页的长表格会让 Chrome
     直接忽略它的 break-inside（规范行为），而页尾已有的空隙刚好被后续卡片
     填掉 ⇒ **avoid 与 auto 页数完全相同，量出"代价 0%"的假结论**。
     本工具第一版就踩了这个坑。

   自检（关键）
     `--selftest` 验两件事：
       ① 断崖区（h≈页高一半）avoid 与 auto **必须**有差异 ——
          没差异说明规则没生效，此时"代价 0%"是假绿。
       ② 小区（h=240）avoid 与 auto **必须**没差异 ——
          有差异说明比对条件不一致（比如两次渲染的内容不同）。

   用法
     node 05-audit/print-pagination-cost.js
     node 05-audit/print-pagination-cost.js --selftest
     node 05-audit/print-pagination-cost.js --json out.json
   ========================================================================== */
'use strict';

const { launch } = require('./browser.js');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const FIXTURE = '/05-audit/fixtures/print-blocks/index.html';
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

/* 块高（px）/ 块数。块数按"总高度约 22 页"配平，让两种模式的页数都可比。 */
const CASES = [[240, 90], [330, 70], [420, 60], [520, 50], [700, 30]];

/* 页内可用高（A4 297mm − 上下边距 24mm = 273mm ≈ 1032px，实测约 990px）。
   不用硬编码去判，只用来算"占页比"，四舍五入到两位。 */
const PAGE_PX = 990;

/* 读页数与「无文字页」数。
   ⚠️ 不因 print-gate 退出码非 0 就抛错：`--pdf` 会跑完 12 条判据，
   `break-inside: auto` 把块切开后可能产生**只有图形没有文字**的页，
   那会触发判据 ⑫ 让退出码变 1 —— 但我们要的 pages 已经在输出里了。
   把这些判据结论当成"附加信息"而不是"失败"，否则工具会在最该量到
   差异的那一档（正是 auto 切出空白页的那一档）直接崩掉。 */
function pdfInfo(file) {
  const r = spawnSync(process.execPath,
    [path.join(__dirname, 'print-gate.js'), '--pdf', file],
    { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  const out = String(r.stdout || '');
  const mp = out.match(/"pages":\s*(\d+)/);
  if (!mp) {
    throw new Error('读 PDF 页数失败：status=' + r.status
      + ' signal=' + r.signal
      + ' err=' + (r.error ? r.error.message : '-')
      + ' stderr=' + String(r.stderr || '-').slice(0, 160)
      + ' file=' + file);
  }
  const mw = out.match(/"pagesWithoutText":\s*(\d+)/);
  return { pages: parseInt(mp[1], 10), blank: mw ? parseInt(mw[1], 10) : 0 };
}

async function render(browser, h, n, mode, out) {
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  await p.goto(BASE + FIXTURE + '?h=' + h + '&n=' + n, { waitUntil: 'networkidle0', timeout: 30000 });
  await p.waitForFunction(() => document.documentElement.hasAttribute('data-ready'));
  if (mode === 'auto') {
    await p.addStyleTag({ content: '@media print{.blk{break-inside:auto !important}}' });
  }
  await new Promise((r) => setTimeout(r, 200));
  const buf = await p.pdf({
    format: 'A4', printBackground: false, preferCSSPageSize: true,
    margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
  });
  await p.close();
  fs.writeFileSync(out, buf);
  return buf.length;
}

async function measure(browser, h, n, dir) {
  const a = path.join(dir, '_cost-' + h + '-avoid.pdf');
  const b = path.join(dir, '_cost-' + h + '-auto.pdf');
  await render(browser, h, n, 'avoid', a);
  await render(browser, h, n, 'auto', b);
  const A = pdfInfo(a), B = pdfInfo(b);
  return { h: h, n: n, avoid: A.pages, auto: B.pages, blankAvoid: A.blank, blankAuto: B.blank };
}

async function main() {
  const dir = val('--dir') || require('os').tmpdir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const browser = await launch();
  const rows = [];
  for (const c of CASES) {
    const r = await measure(browser, c[0], c[1], dir);
    rows.push(r);
    console.log('  量 h=' + r.h + ' … avoid ' + r.avoid + ' 页 / auto ' + r.auto + ' 页');
  }
  await browser.close();

  if (has('--selftest')) {
    const cliff = rows.find((r) => r.h === 520);
    const small = rows.find((r) => r.h === 240);
    let pass = 0, fail = 0;
    const check = (name, ok, detail) => {
      if (ok) pass++; else fail++;
      console.log('  ' + (ok ? 'OK  ' : 'FAIL ') + name + '   ' + detail);
    };
    /* ① 断崖区必须能测出差异 —— 没差异说明 break-inside 没生效，
          此时工具会给出"代价 0%"的假结论。这是元反向控制。 */
    check('断崖区 h=520 必须 avoid > auto',
      cliff && cliff.avoid > cliff.auto,
      'avoid=' + (cliff && cliff.avoid) + ' auto=' + (cliff && cliff.auto));
    /* ② 小区代价必须很小 —— 用容差不用相等。
       夹具加一个 border 就会让块高变 2px，恰好落在页边界上时页数差 1 页（4%）。
       断言"严格相等"会在这种无害抖动上红，断言"<10%"仍然能抓住
       "规则整体没生效"（那会让大块小数一起归零，由 ① 抓）。 */
    const smallInfl = small ? (small.avoid - small.auto) * 100 / small.auto : 999;
    check('小区 h=240 代价必须 <10%', smallInfl < 10,
      'avoid=' + (small && small.avoid) + ' auto=' + (small && small.auto)
      + ' 通胀=' + smallInfl.toFixed(0) + '%');

    console.log('\n  自检 ' + pass + '/' + (pass + fail) + ' 通过');
    process.exit(fail ? 1 : 0);
  }

  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);
  console.log('');
  console.log('  分页代价标定（break-inside: avoid）');
  console.log('  ' + '-'.repeat(70));
  console.log('  ' + pad('块高', 10) + num('占页', 8) + num('avoid', 9)
    + num('auto', 9) + num('通胀', 10) + num('无文字页', 12));
  console.log('  ' + '-'.repeat(70));
  let worst = null;
  for (const r of rows) {
    const infl = (r.avoid - r.auto) * 100 / r.auto;
    if (!worst || infl > worst.infl) worst = { h: r.h, infl: infl };
    const blank = (r.blankAvoid || 0) + (r.blankAuto || 0);
    console.log('  ' + pad(r.h + ' px', 10) + num((r.h / PAGE_PX).toFixed(2), 8)
      + num(r.avoid, 9) + num(r.auto, 9) + num((infl >= 0 ? '+' : '') + infl.toFixed(0) + '%', 10)
      + num((r.blankAvoid || 0) + ' / ' + (r.blankAuto || 0), 12));
  }
  console.log('  ' + '-'.repeat(70));
  console.log('');
  console.log('  读法：块高略超页高一半时最坏（每页只塞得下 1 个，浪费近一半）。');
  console.log('  「占页 ≤ 0.35」时 avoid 几乎免费；「占页 0.45–0.75」时代价 15%–92%。');
  console.log('  ⇒ 高块想要省纸，给它加 .print-allow-break（显式允许被切开）。');
  console.log('');

  const json = val('--json');
  if (json) {
    fs.writeFileSync(json, JSON.stringify(rows.map((r) => ({
      h: r.h, n: r.n, avoid: r.avoid, auto: r.auto,
      blankAvoid: r.blankAvoid, blankAuto: r.blankAuto,
      inflation: +(((r.avoid - r.auto) * 100) / r.auto).toFixed(1),
    })), null, 1));
    console.log('  数据已写入 ' + json);
  }
  process.exit(0);
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
