/*
 * webview-probe-check.js — 在真浏览器里跑一遍探针页（W10 / W12）
 *
 * ============================================================================
 * 🔴 为什么静态门禁之外还要这一道
 * ----------------------------------------------------------------------------
 * `webview-probe-gate.py` 只做**静态**判据：自包含、条目数、与源码用法的双向一致、
 * 基线表结构。它**不会**执行页面里的探测函数。
 *
 * ⇒ 探测函数全都写错（比如每个 `supports()` 参数都传反），静态判据**全绿**：
 *   条目在、名字对、格式对，只是每一台真机都会得到"全不支持"。
 *   那是最坏的一种：**量具坏了，而它给出的数字看起来很有信息量。**
 *
 * ⇒ 这道检查在 Chromium 里真跑一次，判四条：
 *   ① 页面无 JS 错误（探测代码本身得能跑完）
 *   ② 表格行数 == 条目数（渲染没漏）
 *   ③ 输出的 JSON 能解析，且 `missing` 是数组（人要靠它填基线表）
 *   ④ **至少有 10 项为 true**（Chromium 里 15 项全支持；低于 10 说明
 *      探测器大面积失灵 —— 真机差异不会这么整齐）
 *
 * ⚠️ 判据 ④ 用的是**下界**而不是"全部为真"：
 *    全部为真会把这道检查焊死在某个 Chrome 版本上；
 *    而下界足以抓住"探测器集体失灵"，又不会因为某个特性被移除而假红。
 * ============================================================================
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.dirname(__dirname);
const PAGE = path.join(ROOT, '10-review', 'webview', 'capability-probe.html');
const MIN_SUPPORTED = 10;

(async () => {
  const { launch } = require(process.env.FL_BROWSER ||
    path.join(__dirname, 'browser.js'));
  const problems = [];
  let browser;
  let total = 0;
  let supported = 0;
  const url = 'file:///' + PAGE.replace(/\\/g, '/');
  try {
    browser = await launch();
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errs.push('console.error: ' + m.text());
    });
    await page.goto(url, { waitUntil: 'load' });

    const r = await page.evaluate(() => {
      const rows = document.querySelectorAll('#rows tr').length;
      const raw = document.getElementById('out').textContent;
      let json = null;
      try { json = JSON.parse(raw); } catch (e) { json = null; }
      return { rows: rows, json: json };
    });
    await page.close();
    total = (r.json && r.json.total) || 0;
    supported = (r.json && r.json.supported) || 0;

    // ① 无错误
    if (errs.length) {
      errs.slice(0, 5).forEach((e) => problems.push('① ' + e));
    }
    // ③ JSON 可解析
    if (!r.json) {
      problems.push('③ 页面输出的 JSON 解析不出来 —— 基线表靠它填，坏了就没法用');
    } else if (!Array.isArray(r.json.missing)) {
      problems.push('③ 输出里 `missing` 不是数组');
    }
    // ② 行数 == 条目数
    if (r.json && r.json.total !== r.rows) {
      problems.push('② 表格有 ' + r.rows + ' 行，但 JSON 里 total = ' +
        r.json.total + ' —— 有条目没被渲染出来');
    }
    if (r.rows === 0) {
      problems.push('② 表格 0 行 —— 探测清单是空转的');
    }
    // ④ 下界
    if (r.json && r.json.supported < MIN_SUPPORTED) {
      problems.push('④ 只有 ' + r.json.supported + ' / ' + r.json.total +
        ' 项判为支持（下限 ' + MIN_SUPPORTED + '）—— 探测器大概率写坏了；' +
        '真机差异不会这么整齐。缺失：' + (r.json.missing || []).join('、'));
    }
  } finally {
    if (browser) await browser.close();
  }

  if (problems.length) {
    problems.forEach((p) => console.log('  [FAIL] ' + p));
    console.log('\n  ⇒ 探针页在本地 Chromium 里没跑对。' +
      '先修它，再去真机上采数据 —— 坏量具采出来的基线比没有基线更糟。');
    process.exit(1);
  }
  console.log('  [OK] 探针页在 Chromium 里跑通：' + supported + ' / ' + total +
    ' 项给出结论（探针逻辑有效；真机数据仍需人工采集）');
})();
