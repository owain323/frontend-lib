#!/usr/bin/env node
/*
 * engine-probe.js — 单个 CI 作业的**引擎自证**
 *
 * ============================================================================
 * 🔴 为什么需要它（评审给的验收标准）
 * ----------------------------------------------------------------------------
 *   评审的原话：「验收不能只看三个作业都显示绿色，
 *                还要确认三份报告确实来自三个不同的浏览器引擎。」
 *
 *   ⇒ 光有 `matrix.engine` 不够（它只用在 install 那一步，测试根本没收到）。
 *     必须由**作业自己**站起来说一句"我是 WebKit，我的 UA 是 …"，
 *     并且这句话要被**校验**——UA 与声明的引擎对不上就红。
 *
 * ============================================================================
 * 判据
 * ----------------------------------------------------------------------------
 *   ① 启动 `FL_ENGINE` 指定的引擎，打印真实 UA 与版本
 *   ② UA 必须属于**声明的那个引擎族**，否则退出 1
 *
 * ⚠️ 为什么不能只比"UA 相同/不同"
 * ----------------------------------------------------------------------------
 *   Chromium 的 UA 里**也含** `AppleWebKit/537.36`（它本来就是 WebKit 分叉出来的）。
 *   ⇒ 用 "AppleWebKit" 判 WebKit 会**把 Chromium 认成 WebKit**，
 *     而这恰恰是原来那个 bug 的形态 ⇒ 判据必须排除 Chrome/HeadlessChrome。
 *
 * 用法：FL_ENGINE=webkit node 05-audit/engine-probe.js
 * ============================================================================
 */
'use strict';

var browser = require('./browser.js');

/* 引擎族判定。顺序有意义：**先排除**再确认。 */
var FAMILY = {
  chromium: { re: /(Chrome\/|HeadlessChrome|CriOS\/)/i, not: null },
  webkit: { re: /AppleWebKit/i, not: /(Chrome\/|HeadlessChrome|Firefox\/)/i },
  firefox: { re: /Firefox\//i, not: /(Chrome\/|HeadlessChrome)/i },
};

function familyOf(ua) {
  var hits = [];
  Object.keys(FAMILY).forEach(function (k) {
    var f = FAMILY[k];
    if (f.re.test(ua) && !(f.not && f.not.test(ua))) hits.push(k);
  });
  return hits;
}

async function main() {
  var want = browser.engineOf({});          /* 从 FL_ENGINE 读，顺带校验名字合法 */
  var b = null;
  try {
    b = await browser.launch({ engine: want });
    var p = await b.newPage();
    var ua = String(await p.evaluate('navigator.userAgent'));
    var ver = (typeof b.version === 'function') ? String(await b.version()) : '?';

    var hits = familyOf(ua);
    var ok = hits.length === 1 && hits[0] === want;

    process.stdout.write('  engine=' + want + '  version=' + ver + '\n');
    process.stdout.write('  UA=' + ua + '\n');

    if (!ok) {
      process.stdout.write('\n  🔴 声明的引擎是 ' + want + '，但 UA 属于 ' +
        (hits.length ? hits.join('/') : '未知') + '\n');
      process.stdout.write('     ⇒ 这个作业跑的**不是**它声称的引擎。\n');
      process.stdout.write('       典型原因：matrix.engine 没传给启动器（历史 bug）。\n');
      return 1;
    }
    process.stdout.write('  ✅ 引擎自证一致（' + want + '）\n');
    return 0;
  } finally {
    if (b) { try { await b.close(); } catch (e) { /* 忽略 */ } }
  }
}

/* ==========================================================================
   反向控制（纯函数，不需要真启浏览器）
   -------------------------------------------------------------------------- */
function selftest() {
  var bad = 0;
  function expect(why, hit, detail) {
    process.stdout.write('  [' + (hit ? 'OK  ' : 'FAIL') + '] ' + why + '\n');
    if (!hit) { bad++; if (detail) process.stdout.write('         ' + detail + '\n'); }
  }
  var CHROMIUM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) HeadlessChrome/154.0.0.0 Safari/537.36';
  var WEBKIT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/26.6 Safari/605.1.15';
  var FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; rv:144.0) Gecko/20100101 Firefox/144.0';

  /* 🔴 这一条就是历史 bug 的形态：作业说是 webkit，跑的其实是 Chromium。
     注意 Chromium 的 UA **也含 "AppleWebKit"** —— 只判 AppleWebKit 会漏。 */
  var h = familyOf(CHROMIUM_UA);
  expect('声明 webkit 却跑 Chromium ⇒ 必须判为不匹配（历史 bug 形态）',
    !(h.length === 1 && h[0] === 'webkit'), 'familyOf=' + JSON.stringify(h));

  expect('真 WebKit UA ⇒ 判为 webkit',
    (function () { var x = familyOf(WEBKIT_UA); return x.length === 1 && x[0] === 'webkit'; })());
  expect('真 Chromium UA ⇒ 判为 chromium',
    (function () { var x = familyOf(CHROMIUM_UA); return x.length === 1 && x[0] === 'chromium'; })());
  expect('真 Firefox UA ⇒ 判为 firefox',
    (function () { var x = familyOf(FIREFOX_UA); return x.length === 1 && x[0] === 'firefox'; })());

  process.stdout.write('\n' + (bad ? '  ❌ 有 ' + bad + ' 条没抓到' : '  ✅ 反向控制全绿') + '\n');
  return bad ? 1 : 0;
}

if (require.main === module) {
  /* ⚠️ selftest 是同步的，main 是异步的 ⇒ 统一包成 Promise，别让 .then 炸掉 */
  var fn = process.argv.indexOf('--selftest') >= 0
    ? function () { return Promise.resolve(selftest()); }
    : main;
  fn().then(function (c) { process.exit(c); },
    function (e) { process.stdout.write('  🔴 崩了：' + e.message + '\n'); process.exit(1); });
}

module.exports = { familyOf: familyOf, selftest: selftest };
