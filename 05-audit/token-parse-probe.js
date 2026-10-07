/*
 * token-parse-probe.js — 在**真浏览器**里读令牌的真实计算值
 *
 * ============================================================================
 * 🔴 为什么要这个脚本
 * ----------------------------------------------------------------------------
 * 生成 ai/tokens.json 时发现两处可疑：
 *
 *   ① tokens.css 里有一行**孤儿注释结束符**（注释缺开头，只有收尾），
 *      紧跟其后的 --switch-on 可能被浏览器当成"坏声明"丢掉。
 *      ⚠️ 本文件注释里不许写字面量的"注释结束符"，否则会把自己提前关掉
 *         —— 写这段注释时我就踩了一次，报 SyntaxError。
 *   ② `--surface-raised` 只在 dark 段定义，
 *      而 combobox/popover/select/dropdown/tooltip/table 六个组件都在用它。
 *      （10-review/ios/index.html 里早就记过这条，但一直没修）
 *
 * 这两条都不能靠"读源码"下结论 —— **浏览器怎么解析才算数**。
 * 尤其是①：CSS 的错误恢复规则不是靠猜的。
 *
 * ⇒ 本脚本只做一件事：加载真实 CSS，读 getComputedStyle 的真实值。
 * ============================================================================
 * 用法
 * ----------------------------------------------------------------------------
 *   node 05-audit/token-parse-probe.js            # 打印结果
 *   node 05-audit/token-parse-probe.js --json     # 输出 JSON
 * ============================================================================
 */
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.dirname(__dirname);
const { launch } = require(process.env.FL_BROWSER || path.join(__dirname, 'browser.js'));

// 值得单独点名的令牌：被多个组件引用，或位于可疑注释之后
const WATCH = [
  '--switch-on', '--surface-raised', '--surface', '--paper',
  '--sans', '--mono', '--serif', '--tracking-normal',
  '--skeleton-bg', '--text-on-solid', '--accent',
];

function serve(cssText) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html lang="zh"><head><meta charset="utf-8">' +
          '<link rel="stylesheet" href="/tokens.css"></head><body></body></html>');
        return;
      }
      if (req.url === '/tokens.css') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        res.end(cssText);
        return;
      }
      res.writeHead(404); res.end('');
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function wanted() {
  // 允许调用方指定要读哪些令牌（token-parse-gate.py 就是这么用的）。
  // 🔴 不指定的话用默认名单 —— 但调用方指定的优先级更高，
  //    避免出现"门禁查 A、探针读 B"这种两边各写一份名单的漂移。
  const arg = process.argv.find((a) => a.startsWith('--tokens='));
  if (arg) return arg.slice('--tokens='.length).split(',').filter(Boolean);
  return WATCH;
}

function readVars(page) {
  return page.evaluate((names) => {
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    names.forEach((n) => { out[n] = cs.getPropertyValue(n).trim(); });
    return out;
  }, wanted());
}

(async () => {
  const cssText = fs.readFileSync(path.join(ROOT, '01-tokens', 'tokens.css'), 'utf8');
  const srv = await serve(cssText);
  const port = srv.address().port;
  let browser;
  const result = { light: null, dark: null };
  try {
    browser = await launch();
    // ① 浅色
    let page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load' });
    result.light = await readVars(page);
    await page.close();

    // ② 暗色（跟随系统）
    page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load' });
    result.dark = await readVars(page);
    await page.close();
  } finally {
    if (browser) await browser.close();
    srv.close();
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log('  token              | light                  | dark');
  console.log('  -------------------+------------------------+------------------------');
  wanted().forEach((n) => {
    const l = result.light[n] || '(空)';
    const d = result.dark[n] || '(空)';
    const flag = (!l || !d) ? '  🔴' : '';
    console.log('  ' + n.padEnd(18) + '| ' + String(l).slice(0, 22).padEnd(22) +
      ' | ' + String(d).slice(0, 22) + flag);
  });
})().catch((e) => {
  console.error('[FAIL] ' + e.message);
  process.exit(1);
});
