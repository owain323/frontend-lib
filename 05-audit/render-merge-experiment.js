'use strict';
/**
 * G2-06 等价实验：**一次页面加载 → 三次截图**，与现有三趟独立渲染逐字节比对。
 *
 * ⚠️ 这是**实验**，不是门禁。它不写基线、不改任何既有判据、不进 check-all。
 *    它的唯一结论是：合并后的 PNG 与独立跑出来的 PNG 是否完全相同。
 *    任何一张不同 ⇒ 停下来报告，不许用"更新基线"把差异盖过去。
 *
 * 🔴 五趟里只有三趟产 PNG（这是必须先纠正的事实）：
 *    visual / visual-dark / visual-rtl  → 截图，共 47 + 47 + 15 张
 *    zoom-reflow / rtl-render           → **DOM 探针，不截图**，它们比的是数值
 *    所以本实验只能覆盖前者的等价性；后者的等价性要另做"探针数值对比"（未做）。
 *
 * 用法：
 *   node 05-audit/render-merge-experiment.js            # 全部受管页
 *   node 05-audit/render-merge-experiment.js --limit 6  # 前 6 页（冒烟）
 *   node 05-audit/render-merge-experiment.js --keep     # 把合并版 PNG 落到 _merge-<平台>/
 *   node 05-audit/render-merge-experiment.js --only upload --keep   # 只跑匹配路径的页
 *   node 05-audit/render-merge-experiment.js --wait 150  # 切换后等过渡走完（见 WAIT 注释）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { launch } = require('./browser.js');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const SHOTS = path.join(ROOT, '10-review', 'shots');
const PLAT = process.platform;
const VIEW = { width: 393, height: 852 };

const argv = process.argv.slice(2);
const SHOW = (n) => (argv.indexOf('--limit') >= 0 ? +argv[argv.indexOf('--limit') + 1] : n);
const ONLY = argv.indexOf('--only') >= 0 ? argv[argv.indexOf('--only') + 1] : '';
/* 切换后额外等待（毫秒）。默认 0 = **如实暴露**差异；
   实测 `02-primitives/upload` 的 `::file-selector-button` 有 120ms 的 transition，
   而冻结 CSS 的 `*` **选不到 UA shadow 里的伪元素** ⇒ 0ms 时截到中间态。
   设 150ms 后 47/47 + 15/15 全部逐字节一致 ⇒ 差异是时序，不是产品。 */
const WAIT = argv.indexOf('--wait') >= 0 ? +argv[argv.indexOf('--wait') + 1] : 0;
const KEEP = argv.indexOf('--keep') >= 0;

const FROZEN_CSS = '*,*::before,*::after{animation:none !important;' +
  'transition:none !important;caret-color:transparent !important}';

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 受管页清单：唯一来源是 shot-baseline.py（不另抄一份，E31）。 */
function pages() {
  const py = process.env.PY || 'python';
  const out = execFileSync(py, [path.join(ROOT, '05-audit', 'shot-baseline.py'), '--list'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 8 << 20,
  });
  const list = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*OK\s+(\S+)\s*$/.exec(line);
    if (m) list.push(m[1]);
  }
  if (list.length < 40) throw new Error('页面清单只解析到 ' + list.length + ' 个（<40）');
  return list;
}

/** 与 shot-baseline.py 的 shot_name() 同规则（那边改了两侧就会分叉）。 */
function shotName(rel) {
  const d = path.posix.dirname(rel);
  const f = path.posix.basename(rel);
  const stem = f.replace(/\.[^.]+$/, '');
  const base = d.replace(/\//g, '_');
  return stem === 'demo' ? base + '.png' : base + '_' + stem + '.png';
}

function baselineOf(kind, name) {
  const dir = path.join(SHOTS, kind === 'light' ? '_baseline-' + PLAT
    : kind === 'dark' ? '_baseline-' + PLAT + '-dark'
      : '_baseline-' + PLAT + '-rtl', name);
  return fs.existsSync(dir) ? fs.readFileSync(dir) : null;
}

/** 与 shot-baseline 的 settle 判据逐条对齐：字体就位 → 图片 load/error → 两帧。 */
async function settle(p) {
  await p.evaluate(async () => {
    const jobs = [];
    if (document.fonts && document.fonts.ready) jobs.push(document.fonts.ready);
    const imgs = [].slice.call(document.images || []);
    imgs.forEach((im) => {
      if (im.complete) return;
      jobs.push(new Promise((res) => { im.onload = res; im.onerror = res; }));
    });
    if (jobs.length) {
      await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 3000))]);
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

(async () => {
  const list = pages().filter((x) => !ONLY || x.indexOf(ONLY) >= 0).slice(0, SHOW(999));
  const b = await launch();
  const p = await b.newPage();
  const rows = [];
  const t0 = Date.now();

  for (const rel of list) {
    const name = shotName(rel);
    const url = BASE + '/' + rel;
    const row = { rel, name, light: '', dark: '', rtl: '' };
    try {
      await p.setViewport({ width: VIEW.width, height: VIEW.height, deviceScaleFactor: 1 });
      await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await settle(p);
      await p.addStyleTag({ content: FROZEN_CSS });
      await new Promise((r) => setTimeout(r, 120));

      /* ① 浅色 */
      let shot = Buffer.from(await p.screenshot({ fullPage: true }));
      const bl = baselineOf('light', name);
      row.light = !bl ? 'no-baseline' : (sha(shot) === sha(bl) ? 'same' : 'DIFF');
      if (KEEP) writeKeep('light', name, shot);

      /* ② 暗色：两条路一起设（媒体特性 + data-theme），与独立跑一字不差 */
      await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
      await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await settle(p);
      if (WAIT) await new Promise((r) => setTimeout(r, WAIT));
      shot = Buffer.from(await p.screenshot({ fullPage: true }));
      const bd = baselineOf('dark', name);
      row.dark = !bd ? 'no-baseline' : (sha(shot) === sha(bd) ? 'same' : 'DIFF');
      if (KEEP) writeKeep('dark', name, shot);

      /* ③ RTL：先把暗色**完整撤掉**再改方向 —— 回退不彻底会量到"暗色 + RTL"的混合体 */
      await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
      await p.evaluate(() => document.documentElement.removeAttribute('data-theme'));
      await p.evaluate(() => { document.documentElement.dir = 'rtl'; });
      await settle(p);
      if (WAIT) await new Promise((r) => setTimeout(r, WAIT));
      shot = Buffer.from(await p.screenshot({ fullPage: true }));
      const br = baselineOf('rtl', name);
      row.rtl = !br ? 'no-baseline' : (sha(shot) === sha(br) ? 'same' : 'DIFF');
      if (KEEP) writeKeep('rtl', name, shot);
    } catch (e) {
      row.light = row.dark = row.rtl = 'ERR';
      row.err = String(e).slice(0, 90);
    }
    rows.push(row);
    const mark = (v) => (v === 'same' ? '.' : v === 'DIFF' ? 'X' : v === 'no-baseline' ? '-' : '!');
    process.stdout.write(mark(row.light) + mark(row.dark) + mark(row.rtl) + ' ');
  }
  await b.close();

  const ms = Date.now() - t0;
  const count = (k, v) => rows.filter((r) => r[k] === v).length;
  const diff = rows.filter((r) => r.light === 'DIFF' || r.dark === 'DIFF' || r.rtl === 'DIFF');
  const err = rows.filter((r) => r.light === 'ERR');

  console.log('\n\n  === G2-06 合并渲染等价实验 ===');
  console.log('  页面 ' + rows.length + ' 个｜切换后额外等待 ' + WAIT
    + 'ms｜墙钟 ' + (ms / 1000).toFixed(1) + 's');
  console.log('  浅色   相同 ' + count('light', 'same') + ' / DIFF ' + count('light', 'DIFF')
    + ' / 无基线 ' + count('light', 'no-baseline'));
  console.log('  暗色   相同 ' + count('dark', 'same') + ' / DIFF ' + count('dark', 'DIFF')
    + ' / 无基线 ' + count('dark', 'no-baseline'));
  console.log('  RTL    相同 ' + count('rtl', 'same') + ' / DIFF ' + count('rtl', 'DIFF')
    + ' / 无基线 ' + count('rtl', 'no-baseline'));
  if (err.length) {
    console.log('  取数失败 ' + err.length + ' 页（**不是**结论为假）：');
    err.slice(0, 5).forEach((r) => console.log('    ' + r.rel + ' —— ' + r.err));
  }
  if (diff.length) {
    console.log('\n  🔴 以下页面的 PNG **与独立渲染不同**：');
    diff.slice(0, 12).forEach((r) => console.log('    ' + r.rel
      + '  浅色=' + r.light + ' 暗色=' + r.dark + ' RTL=' + r.rtl));
    console.log('  ⇒ 停止。不许用 --update 盖掉差异。');
  } else if (count('light', 'same') + count('dark', 'same') + count('rtl', 'same') === 0) {
    console.log('\n  🔴 一张都没比上 ⇒ 这不是"等价"，是**没有测到**（基线目录名或平台不对）');
  } else {
    console.log('\n  ✅ 所有比到的 PNG 都与独立渲染逐字节相同');
    console.log('     独立三趟的历史耗时：visual 112s + visual-dark 109s + visual-rtl 43s = 264s');
    console.log('     合并一趟实测：' + (ms / 1000).toFixed(1) + 's');
  }
  return diff.length || err.length ? 1 : 0;
})().then((rc) => process.exit(rc)).catch((e) => {
  console.error('  🔴 ' + (e && e.message ? e.message : e));
  process.exit(2);
});

function writeKeep(kind, name, buf) {
  const dir = path.join(SHOTS, '_merge-' + PLAT + (kind === 'light' ? '' : '-' + kind));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buf);
}
