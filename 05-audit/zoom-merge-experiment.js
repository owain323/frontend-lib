'use strict';
/**
 * G2-06B / G2-06C：`zoom-reflow` 的「三次加载」合并成「一次加载」是否等价。
 *
 * ⚠️ 这是**实验 / 复核工具**，不是门禁。不写基线、不进 check-all。
 *    但它是 G2-06C 的**差异验证器**：改造后再跑一遍就能知道有没有走样。
 *
 * 为什么只有 zoom-reflow 有合并空间：
 *   · `zoom-reflow`  改造前每页 **3 次** goto（320 宽 / 1280 宽 + 32px 字号 / 1280 宽默认）
 *   · `rtl-render`   每页**已经只有 1 次** goto（改 dir 与换文本都在同一次加载里）
 *   ⇒ 后者没有可合并的东西，本实验不涉及它。
 *
 * 探针与流程的来源：**直接 require `zoom-reflow.js`**，不复制副本。
 *   G2-06B 时是"读源码文本再抽函数"（防 E31 双份漂移）；
 *   G2-06C 之后生产侧直接导出了 `measure()`，
 *   ⇒ 本实验的 merged 一侧**就是**生产代码路径，连"抽取"这一层都不存在了。
 *   独立一侧（3 次加载）保留在本文件里，作为"永远在线"的对照组。
 *
 * 两种等待口径（`--legacy-wait`）：
 *   默认两侧都用生产的 `settle()`（布局指纹连续 3 帧不变，超时判红）；
 *   加 `--legacy-wait` 则独立侧退回 G2-06B 当时的「两帧 rAF + 120ms sleep」，
 *   用来回答"加了稳定等待以后，对照组本身有没有变值"。
 *
 * 用法：
 *   node 05-audit/zoom-merge-experiment.js                    # 默认 5 页，两种都跑
 *   node 05-audit/zoom-merge-experiment.js --all              # 全部 43 页（慢）
 *   node 05-audit/zoom-merge-experiment.js --only table       # 只跑 id 含该串的页
 *   node 05-audit/zoom-merge-experiment.js --all --mode merged       # 只跑合并版，量耗时
 *   node 05-audit/zoom-merge-experiment.js --all --dump out.json     # 存逐页数值备查
 */
const fs = require('fs');
const path = require('path');
const { launch } = require('./browser');
const Z = require('./zoom-reflow');

const BASE = process.env.FL_BASE || 'http://127.0.0.1:8000';
const argv = process.argv.slice(2);
const ALL = argv.indexOf('--all') >= 0;
/* both = 两种都跑并比对（默认）；merged / independent = 只跑一种，用来**实测耗时**。
   只跑一种时不做比对（没有对照组），只打印墙钟 —— 它的用途就是量时间。 */
const MODE = argv.indexOf('--mode') >= 0 ? argv[argv.indexOf('--mode') + 1] : 'both';
/* 支持逗号分隔多个：`--only docs,report` */
const ONLY = argv.indexOf('--only') >= 0 ? argv[argv.indexOf('--only') + 1].split(',') : [];
const LEGACY = argv.indexOf('--legacy-wait') >= 0;
const DUMP = argv.indexOf('--dump') >= 0 ? argv[argv.indexOf('--dump') + 1] : '';

const run = (p, name) => p.evaluate(Z[name]);
const wait120 = () => new Promise((r) => setTimeout(r, 120));
const twoFrames = (p) => p.evaluate(
  () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** 独立模式：逐字复刻改造前 zoom-reflow.js 的三段（含 3 次 goto）。
 *  默认在每次 goto 之后用生产同款 `settle()`；`--legacy-wait` 退回旧口径。 */
async function independent(p, rel, id) {
  const waits = [];
  const afterLoad = async (tag) => {
    if (LEGACY) { await twoFrames(p); return; }
    waits.push(await Z.settle(p, id + ' ' + tag));
  };

  await p.setViewport({ width: 320, height: 640 });
  await p.goto(BASE + '/' + rel, { waitUntil: 'networkidle0', timeout: 15000 });
  await afterLoad('@320');
  const reflow = await run(p, 'overflowProbe');

  await p.setViewport({ width: 1280, height: 900 });
  await p.goto(BASE + '/' + rel, { waitUntil: 'networkidle0', timeout: 15000 });
  await p.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  await wait120();
  if (!LEGACY) waits.push(await Z.settle(p, id + ' @200%'));
  const zoom = await run(p, 'overflowProbe');
  const clipped = await run(p, 'clipProbe');

  await p.goto(BASE + '/' + rel, { waitUntil: 'networkidle0', timeout: 15000 });
  await afterLoad('@reset');
  const occl = await run(p, 'occludedProbe');
  return { reflow, zoom, clipped, occl, waits };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const strip = (m) => ({ reflow: m.reflow, zoom: m.zoom, clipped: m.clipped, occl: m.occl });

(async () => {
  let list = Z.pages();
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
      if (MODE !== 'merged') a = await independent(p, rel, id);
      if (MODE !== 'independent') c = await Z.measure(p, rel, id);
    } catch (e) {
      err = String(e).slice(0, 100);
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
      // 逐页原始值：验收要求"结果可复核"，那就要能看见数字，不能只有对勾
      values: { 独立: strip(a), 合并: strip(c) },
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
  const wall = (Date.now() - t0) / 1000;

  if (DUMP) {
    fs.writeFileSync(DUMP, JSON.stringify({
      at: new Date().toISOString(),
      mode: MODE,
      wait: LEGACY ? 'legacy(2 帧 + 120ms)' : 'settle(指纹 3 帧 / 1500ms 超时)',
      base: BASE,
      pages: rows,
      wall,
    }, null, 2) + '\n');
    console.log('\n  逐页数值已写入 ' + path.relative(process.cwd(), DUMP));
  }

  if (MODE !== 'both') {
    console.log('\n  === 单一模式计时（' + MODE + '）===');
    console.log('  页面 ' + rows.length + ' 个｜墙钟 ' + wall.toFixed(1) + 's');
    return 0;
  }
  const ok = rows.filter((r) => !r.err && r.reflow && r.zoom && r.clipped && r.occl);
  const bad = rows.filter((r) => r.err || !(r.reflow && r.zoom && r.clipped && r.occl));

  console.log('\n  === G2-06B/C zoom-reflow 合并等价实验 ===');
  console.log('  页面 ' + rows.length + ' 个｜墙钟 ' + wall.toFixed(1) + 's' +
              '｜等待口径 ' + (LEGACY ? '旧口径（两帧 + 120ms）' : '生产 settle()'));
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
