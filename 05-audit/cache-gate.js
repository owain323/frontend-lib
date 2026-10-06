const fs = require('fs');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');
const os = require('os');
const { launch } = require('./browser.js');

/**
 * cache-gate.js — 门禁自己的门禁：**证明测试环境没有缓存**
 *
 * ============================================================================
 * 🔴 为什么需要这道门禁
 * ============================================================================
 * 当天做判别力验证时遇到一个诡异现象：
 *   · 磁盘上的 JS 明明改对了（grep 确认）
 *   · 浏览器里跑出来的**还是旧代码**
 *   · ⇒ 判别力验证"失败"（抓不到注入的 bug）
 *
 * 真因：**Chrome 磁盘缓存**。当时 **11 个测试脚本一个都没关缓存**。
 *
 * ⚠️ 为什么这件事严重到要做成门禁：
 *   **页面里跑的是旧代码，测试却"通过"了。**
 *   而判别力验证是判断"门禁有没有鉴别力"的唯一手段 ——
 *   门禁没鉴别力 ⇒ 它抓不抓得到问题**都不可信**。
 *   ⇒ 也就是说：在关缓存之前，本库所有门禁的"通过"都可以是假的。
 *
 * 这道门禁的做法：**改文件 → 页面读到哪个值**。
 * 因为这正是判别力验证的真实场景（改代码、URL 不变、重跑）。
 *
 * ⚠️ 它**不检查**源码里有没有 setCacheEnabled（那是形式），
 *   它**检查行为**：改了文件到底能不能读到新的。
 */
const F = REPO + '/05-audit/_cache-probe.js';
const H = REPO + '/05-audit/_cache-probe.html';

async function readValue() {
  const b = await launch();
  try {
    // 🔴 故意用 `b.newPage()`（而不是 browser.js 的 newPage()）——
    //    因为所有现有脚本都是这么开的页面，必须证明这条路也被覆盖了。
    const p = await b.newPage();
    await p.goto('http://127.0.0.1:8000/05-audit/_cache-probe.html',
                 { waitUntil: 'networkidle0' });
    return await p.evaluate(() => window.__PROBE__);
  } finally {
    await b.close();
  }
}

(async () => {
  const bad = [];
  fs.writeFileSync(H,
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
    '<body><script src="_cache-probe.js"></script></body></html>');

  // 连续改三次，URL 完全不变 —— 与判别力验证的场景一致
  const marks = ['PROBE_A', 'PROBE_B', 'PROBE_C'];
  for (let i = 0; i < marks.length; i++) {
    fs.writeFileSync(F, 'window.__PROBE__ = "' + marks[i] + '";');
    const got = await readValue();
    const ok = got === marks[i];
    if (!ok) bad.push({ want: marks[i], got });
    console.log('  ' + (ok ? 'OK  ' : 'FAIL') +
      ' 期望 ' + marks[i] + ' · 实读 ' + got +
      (ok ? '' : '   ← **页面读到的是缓存的旧代码**'));
  }

  try { fs.unlinkSync(F); } catch (e) {}
  try { fs.unlinkSync(H); } catch (e) {}

  console.log('');
  if (bad.length) {
    console.log('  ❌ 测试环境有缓存 —— 页面里跑的不是磁盘上的代码。');
    console.log('     ⇒ **「判别力验证成立」「门禁通过」这类结论全部不可信**。');
    console.log('     修法：所有脚本必须走 05-audit/browser.js 的 launch()');
    console.log('     （它会在启动参数禁缓存 + wrap newPage 自动 setCacheEnabled(false)）。');
    process.exit(1);
  }
  console.log('  ✅ 测试环境无缓存 —— 页面读到的就是磁盘上的代码');
  console.log('     ⇒ 现在「判别力验证成立」这句话是可信的。');
})();
