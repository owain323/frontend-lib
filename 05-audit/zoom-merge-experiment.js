'use strict';
/**
 * G2-06B：`zoom-reflow` 的「三次加载」能否合并成「一次加载 + 改视口/字号」。
 *
 * ⚠️ 这是**实验**，不是门禁。不写基线、不改 `zoom-reflow.js`、不进 check-all。
 *
 * 为什么只有 zoom-reflow 有合并空间：
 *   · `zoom-reflow`  每页 **3 次** goto（320 宽 / 1280 宽 + 32px 字号 / 1280 宽默认）
 *   · `rtl-render`   每页**已经只有 1 次** goto（改 dir 与换文本都在同一次加载里）
 *   ⇒ 后者没有可合并的东西，本实验不涉及它。
 *
 * 探针来源：**直接读 `zoom-reflow.js` 的源码文本**，不复制一份。
 *   复制会让两份探针各自漂移（E31）；读源码则"实验测的就是生产测的那段代码"。
 *
 * 用法：
 *   node 05-audit/zoom-merge-experiment.js              # 默认 5 页
 *   node 05-audit/zoom-merge-experiment.js --all        # 全部页面（慢）
 *   node 05-audit/zoom-merge-experiment.js --only table # 只跑 id 含该串的页
 *   node 05-audit/zoom-merge-experiment.js --all --mode merged       # 只跑合并版，量耗时
 */
const fs = require('fs');
const path = require('path');
const { launch } = require('./browser');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.FL_BASE || 'http://127.0.0.1:8000';
const argv = process.argv.slice(2);
const ALL = argv.indexOf('--all') >= 0;
/* both = 两种都跑并比对（默认）；merged / independent = 只跑一种，用来**实测耗时**。
   只跑一种时不做比对（没有对照组），只打印墙钟 —— 它的用途就是量时间。 */
const MODE = argv.indexOf('--mode') >= 0 ? argv[argv.indexOf('--mode') + 1] : 'both';
/* 支持逗号分隔多个：`--only docs,report` */
const ONLY = argv.indexOf('--only') >= 0 ? argv[argv.indexOf('--only') + 1].split(',') : [];

/** 页面清单：与 zoom-reflow.js 同源（`ai/components.json` + 3 个文档页）。 */
function pages() {
  const cj = JSON.parse(fs.readFileSync(path.join(ROOT, 'ai', 'components.json'), 'utf-8'));
  const out = cj.components
    .filter((c) => c.files && c.files.demo)
    .map((c) => [c.id, c.files.demo]);
  out.push(['docs-index', 'guide/index.html']);
  out.push(['docs-page', 'guide/button.html']);
  out.push(['docs-conventions', 'guide/conventions.html']);
  return out;
}

/**
 * 从 `zoom-reflow.js` 抽出探针源码（形如 `() => { … }`）。
 * 抽不到就**报错**，不许退回本地副本 —— 退回会让"实验"与"生产"悄悄分叉。
 */
function probeSrc(name) {
  const file = path.join(ROOT, '05-audit', 'zoom-reflow.js');
  const txt = fs.readFileSync(file, 'utf8');
  const mark = 'const ' + name + ' = ';
  const start = txt.indexOf(mark);
  if (start < 0) throw new Error('在 zoom-reflow.js 里找不到 ' + name);
  const from = start + mark.length;
  const end = txt.indexOf('\n};', from);
  if (end < 0) throw new Error(name + ' 的结尾找不到');
  const src = txt.slice(from, end + 3).replace(/;\s*$/, '');
  if (!/^\s*\(\s*\)\s*=>/.test(src)) throw new Error(name + ' 不是箭头函数：' + src.slice(0, 40));
  return src;
}

const SRC = {
  overflow: probeSrc('overflowProbe'),
  clip: probeSrc('clipProbe'),
  occluded: probeSrc('occludedProbe'),
};

const run = (p, name) => p.evaluate('(' + SRC[name] + ')()');
const wait120 = () => new Promise((r) => setTimeout(r, 120));

/** 独立模式：逐字复刻 zoom-reflow.js 的三段（含 3 次 goto）。 */
async function independent(p, rel) {
  await p.setViewport({ width: 320, height: 640 });
  await p.goto(BASE + '/' + rel, { waitUntil: 'networkidle0', timeout: 15000 });
  const reflow = await run(p, 'overflow');

  await p.setViewport({ width: 1280, height: 900 });
  await p.goto(BASE + '/' + rel, { waitUntil: 'networkidle0', timeout: 15000 });
  await p.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  await wait120();
  const zoom = await run(p, 'overflow');
  const clipped = await run(p, 'clip');

  await p.goto(BASE + '/' + rel, { waitUntil: 'networkidle0', timeout: 15000 });
  const occl = await run(p, 'occluded');
  return { reflow, zoom, clipped, occl };
}

/** 合并模式：一次加载，按 320 → 1280+32px → 复位 的顺序测。 */
async function merged(p, rel) {
  await p.setViewport({ width: 320, height: 640 });
  await p.goto(BASE + '/' + rel, { waitUntil: 'networkidle0', timeout: 15000 });
  const reflow = await run(p, 'overflow');

  await p.setViewport({ width: 1280, height: 900 });
  /* 改视口会触发一次重排 + 媒体查询重算；给它两帧再动字号，
     否则量到的是"重排还没提交"的中间状态。 */
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  await wait120();
  const zoom = await run(p, 'overflow');
  const clipped = await run(p, 'clip');

  /* 复位：内联样式置空 ⇒ 落回 CSS 里的值，与"从未改过"等价。
     复位后必须重新等两帧 —— 否则量的是 32px 时的布局。 */
  await p.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const occl = await run(p, 'occluded');
  return { reflow, zoom, clipped, occl };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  let list = pages();
  if (ONLY.length) list = list.filter(([id]) => ONLY.some((k) => id.indexOf(k) >= 0));
  if (!ALL) list = list.slice(0, 5);

  const b = await launch();
  const rows = [];
  const t0 = Date.now();

  for (const [id, rel] of list) {
    const p = await b.newPage();
    let a;
    let c;
    let err = '';
    try {
      if (MODE !== 'merged') a = await independent(p, rel);
      if (MODE !== 'independent') c = await merged(p, rel);
    } catch (e) {
      err = String(e).slice(0, 80);
    }
    await p.close();
    if (err) {
      rows.push({ id, err });
      console.log('  !  ' + id.padEnd(20) + '取数失败：' + err);
      continue;
    }
    if (MODE !== 'both') { rows.push({ id, single: true }); console.log('  ' + id); continue; }
    const r = {
      id,
      reflow: same(a.reflow, c.reflow),
      zoom: same(a.zoom, c.zoom),
      clipped: same(a.clipped, c.clipped),
      occl: same(a.occl, c.occl),
      diff: {},
    };
    for (const k of ['reflow', 'zoom', 'clipped', 'occl']) {
      if (!r[k]) r.diff[k] = { 独立: a[k], 合并: c[k] };
    }
    rows.push(r);
    const mark = (v) => (v ? '.' : 'X');
    console.log('  ' + id.padEnd(20)
      + ' 重排' + mark(r.reflow) + ' 200%' + mark(r.zoom)
      + ' 裁切' + mark(r.clipped) + ' 遮挡' + mark(r.occl));
  }
  await b.close();

  if (MODE !== 'both') {
    console.log('\n  === 单一模式计时（' + MODE + '）===');
    console.log('  页面 ' + rows.length + ' 个｜墙钟 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    return 0;
  }
  const ok = rows.filter((r) => !r.err && r.reflow && r.zoom && r.clipped && r.occl);
  const bad = rows.filter((r) => r.err || !(r.reflow && r.zoom && r.clipped && r.occl));

  console.log('\n  === G2-06B zoom-reflow 合并等价实验 ===');
  console.log('  页面 ' + rows.length + ' 个｜墙钟 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  console.log('  四项测量全部一致：' + ok.length + ' / ' + rows.length);
  if (bad.length) {
    console.log('\n  🔴 以下页面不一致（合并会改变测量值 ⇒ 不许合并）：');
    for (const r of bad.slice(0, 6)) {
      if (r.err) { console.log('    ' + r.id + ' —— 取数失败：' + r.err); continue; }
      for (const k of Object.keys(r.diff)) {
        console.log('    ' + r.id + ' / ' + k);
        console.log('      独立: ' + JSON.stringify(r.diff[k].独立));
        console.log('      合并: ' + JSON.stringify(r.diff[k].合并));
      }
    }
  } else {
    console.log('\n  ✅ 所有页面的四项测量与独立执行完全相同');
    console.log('     独立：3 次 goto/页；合并：1 次 goto/页（省 2 次加载）');
  }
  return bad.length ? 1 : 0;
})().then((rc) => process.exit(rc)).catch((e) => {
  console.error('  🔴 ' + (e && e.message ? e.message : e));
  process.exit(2);
});
