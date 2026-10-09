#!/usr/bin/env node
/*
 * engine-gate.js — 浏览器引擎矩阵的**证据**门禁
 *
 * ============================================================================
 * 🔴 为什么需要这道门禁（2026-10-09 外部评审实测驱动）
 * ----------------------------------------------------------------------------
 *   CI 里声明了 chromium / webkit / firefox 三个引擎，
 *   但 `matrix.engine` **只用在 `npx playwright install` 那一步**，
 *   从来没传给测试启动器 ⇒ 三个作业跑的都是 Chromium。
 *
 *   ⚠️ 这比"没做跨浏览器"更坏：它产生了一份**看起来存在**的证据。
 *      评审会把它当覆盖率，使用者会把它当兼容承诺，而它一次都没测过。
 *      ⇒ 与 I-10「报告通过却什么也没查」是**同一类**失效。
 *
 * ============================================================================
 * 判据（每条都配反向控制）
 * ----------------------------------------------------------------------------
 *   ① 每个**可用**的引擎必须真的启动成功，并报出 UA 与版本
 *   ② 🔴 跑起来的引擎之间，UA 必须**两两不同**
 *      ⇒ 这条是本门禁存在的全部理由：证明矩阵不是"同一个浏览器跑了三遍"
 *   ③ 未知引擎名必须**报错**，不许静默退回默认引擎
 *      （静默退回会让"选了引擎"这个动作本身变成假的）
 *   ④ 可用引擎 < 2 ⇒ **SKIP**，不许报"通过"
 *      （只跑得起一个引擎时，② 根本无从判断 ⇒ 那是环境，不是"没问题"）
 *   ⑤ 证据落盘 `10-review/engine-evidence.json`：引擎 → UA / 版本
 *
 * ⚠️ 诚实边界：UA 不同只证明**真的启动了三个不同的浏览器**，
 *    不证明组件在这三个引擎上行为一致 —— 那是各组件契约测试的事。
 * ============================================================================
 * 用法
 * ----------------------------------------------------------------------------
 *   node 05-audit/engine-gate.js
 *   node 05-audit/engine-gate.js --selftest
 * ============================================================================
 */
'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');

var ROOT = path.dirname(__dirname);
var EVIDENCE = path.join(ROOT, '10-review', 'engine-evidence.json');
var ENGINES = ['chromium', 'webkit', 'firefox'];

/* 纯函数：给一份 {引擎: UA} 表，找出重复的 UA。 */
function duplicateUAs(rows) {
  var seen = {};
  var dups = [];
  rows.forEach(function (r) {
    if (seen[r.ua]) dups.push([seen[r.ua], r.engine]);
    else seen[r.ua] = r.engine;
  });
  return dups;
}

/**
 * 探针：逐个引擎尝试启动，取 UA 与版本。
 * ⚠️ 启动失败 ⇒ 记进 unavailable，**不**当成被测物坏（宪法第 4 条：环境 ≠ 样本）。
 */
async function probe(engines) {
  var browser;
  try {
    browser = require('./browser.js');
  } catch (e) {
    return { fatal: 'require ./browser.js 失败：' + e.message, rows: [], unavailable: engines.slice() };
  }
  var rows = [];
  var unavailable = [];
  for (var i = 0; i < engines.length; i++) {
    var eng = engines[i];
    var b = null;
    try {
      b = await browser.launch({ engine: eng });
      var p = await b.newPage();
      var ua = await p.evaluate('navigator.userAgent');
      var ver = (typeof b.version === 'function') ? await b.version() : '?';
      rows.push({ engine: eng, ua: String(ua), version: String(ver) });
    } catch (e) {
      unavailable.push({ engine: eng, why: String(e.message).split('\n')[0] });
    } finally {
      if (b) { try { await b.close(); } catch (e2) { /* 忽略 */ } }
    }
  }
  return { rows: rows, unavailable: unavailable, fatal: null };
}

async function main() {
  process.stdout.write('  === 浏览器引擎矩阵（要证据，不要声明）===\n\n');

  var r = await probe(ENGINES);
  if (r.fatal) {
    process.stdout.write('  🔴 ' + r.fatal + '\n');
    return 1;
  }

  r.rows.forEach(function (x) {
    process.stdout.write('  [OK]   ' + x.engine.padEnd(9) + ' v' + String(x.version).slice(0, 12) +
      '  ' + x.ua.slice(0, 62) + '\n');
  });
  r.unavailable.forEach(function (x) {
    process.stdout.write('  [SKIP] ' + x.engine.padEnd(9) + ' 本机跑不起来：' + x.why.slice(0, 70) + '\n');
  });

  /* ④ 可用引擎 < 2 ⇒ 无从证明"不同" ⇒ SKIP，绝不报通过 */
  if (r.rows.length < 2) {
    process.stdout.write('\n  SKIP  可用引擎只有 ' + r.rows.length + ' 个 ⇒ 无法判断矩阵是否真的分引擎\n');
    process.stdout.write('        ⇒ 这是**环境问题**（没装浏览器），不是"矩阵没问题"\n');
    process.stdout.write('        ⇒ 装上：`npx playwright install --with-deps chromium webkit firefox`\n');
    return 0;
  }

  var errs = [];

  /* ② 🔴 核心判据：UA 必须两两不同 */
  var dups = duplicateUAs(r.rows);
  if (dups.length) {
    dups.forEach(function (d) {
      errs.push('🔴 ' + d[0] + ' 与 ' + d[1] + ' 报出**同一个 UA**' +
        ' ⇒ 矩阵里至少有一个作业其实跑的是别的引擎（这正是本门禁要防的事）');
    });
  }

  /* ③ 未知引擎名必须报错 */
  var browser = require('./browser.js');
  var rejected = false;
  try {
    browser.engineOf({ engine: 'netscape' });
  } catch (e) {
    rejected = /未知浏览器引擎/.test(e.message);
  }
  if (!rejected) errs.push('未知引擎名没有报错 ⇒ "选引擎"这个动作可能是假的（写错就静默退回）');

  /* ⑤ 落盘证据 */
  var out = {
    generatedAt: new Date().toISOString(),
    engines: r.rows,
    unavailable: r.unavailable,
    distinctUA: dups.length === 0,
  };
  try {
    fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
    fs.writeFileSync(EVIDENCE, JSON.stringify(out, null, 2) + '\n', 'utf8');
    process.stdout.write('\n  [OK]   证据已写入 10-review/engine-evidence.json\n');
  } catch (e) {
    errs.push('证据写盘失败：' + e.message);
  }

  if (!errs.length) {
    process.stdout.write('\n  ✅ 引擎矩阵闭环（' + r.rows.length + ' 个引擎，UA 两两不同）\n');
    return 0;
  }
  process.stdout.write('\n  🔴 引擎矩阵有问题：\n');
  errs.forEach(function (s) { process.stdout.write('     ' + s + '\n'); });
  return 1;
}

/* ==========================================================================
   反向控制
   -------------------------------------------------------------------------- */
async function selftest() {
  var bad = 0;
  function expect(why, hit, detail) {
    process.stdout.write('  [' + (hit ? 'OK  ' : 'FAIL') + '] ' + why + '\n');
    if (!hit) { bad++; if (detail) process.stdout.write('         ' + detail + '\n'); }
  }

  /* ② 的核心：两个引擎报同一个 UA ⇒ 必须红（这是"矩阵造假"的形态） */
  var d = duplicateUAs([
    { engine: 'chromium', ua: 'UA-X' },
    { engine: 'webkit', ua: 'UA-X' },
  ]);
  expect('两个引擎报同一个 UA ⇒ 必须红（矩阵造假的形态）',
    d.length === 1, 'duplicateUAs=' + JSON.stringify(d));

  expect('UA 都不同 ⇒ 不红（不误报）',
    duplicateUAs([
      { engine: 'chromium', ua: 'UA-A' },
      { engine: 'webkit', ua: 'UA-B' },
      { engine: 'firefox', ua: 'UA-C' },
    ]).length === 0);

  /* ③ 未知引擎名 */
  var browser = require('./browser.js');
  var threw = false;
  try { browser.engineOf({ engine: 'netscape' }); } catch (e) { threw = /未知浏览器引擎/.test(e.message); }
  expect('未知引擎名 ⇒ 必须报错（不许静默退回）', threw);

  var okKnown = ['chromium', 'webkit', 'firefox'].every(function (e) {
    return browser.engineOf({ engine: e }) === e;
  });
  expect('三个已知引擎名都能正确归一（含 chrome→chromium）',
    okKnown && browser.engineOf({ engine: 'Chrome' }) === 'chromium');

  process.stdout.write('\n' + (bad ? '  ❌ 反向控制有 ' + bad + ' 条没抓到' : '  ✅ 反向控制全绿') + '\n');
  return bad ? 1 : 0;
}

if (require.main === module) {
  var fn = process.argv.indexOf('--selftest') >= 0 ? selftest : main;
  fn().then(function (c) { process.exit(c); },
    function (e) { process.stdout.write('  🔴 崩了：' + e.message + '\n'); process.exit(1); });
}

module.exports = { duplicateUAs: duplicateUAs, probe: probe, ENGINES: ENGINES };
