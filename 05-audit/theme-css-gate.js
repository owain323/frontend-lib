/*
 * theme-css-gate.js — 在**真浏览器**里验证：暗色是不是真的不再依赖 JS
 *
 * ============================================================================
 * 🔴 为什么这道门禁存在
 * ----------------------------------------------------------------------------
 * 以前强制暗色靠 JS 往 `:root` 写 30 条 inline 属性。
 * 那个做法有个致命副作用（见 docs/INVARIANT.md I-4）：
 * inline style 压过**一切**样式表 ⇒ 使用者改 `--surface` 只能加 `!important`。
 *
 * 改成纯 CSS 之后，必须证明它**真的**成立 ——
 * 而"读源码说它应该成立"不算证据（本库在这个坑上栽过两次：
 * 裸声明被浏览器丢弃、`--switch-on` 被孤儿注释吃掉）。
 *
 * ⇒ 本门禁**不加载 theme-toggle.js**，只加载 tokens.css，
 *    然后四种组合逐一实测：
 *
 *     系统偏好 | data-theme | 期望
 *     ---------+------------+------
 *     light    | （无）     | 浅
 *     light    | dark       | 暗   ← 强制暗（过去靠 JS 才能做到）
 *     dark     | （无）     | 暗   ← 跟随系统
 *     dark     | light      | 浅   ← 强制亮（最容易被漏掉的一条路径）
 *
 * ============================================================================
 * 用法
 * ----------------------------------------------------------------------------
 *   node 05-audit/theme-css-gate.js
 * ============================================================================
 */
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.dirname(__dirname);
const { launch } = require(process.env.FL_BROWSER || path.join(__dirname, 'browser.js'));

// 读这两个就够判明暗，而且它们明暗差异极大（不会误判）
const PROBE = ['--paper', '--text-primary'];

const CASES = [
  { sys: 'light', attr: null, want: 'light', why: '默认浅色' },
  { sys: 'light', attr: 'dark', want: 'dark', why: '不加载 JS 也能强制暗' },
  { sys: 'dark', attr: null, want: 'dark', why: '跟随系统进入暗色' },
  { sys: 'dark', attr: 'light', want: 'light', why: '系统暗色下强制亮' },
];

function serve(cssText) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        // 🔴 故意**不引** theme-toggle.js —— 本门禁测的就是"没有 JS 也成立"
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

function isDark(v) {
  // 不比对具体色值（那会把门禁和实现焊死）；只判"这个底是深还是浅"。
  const m = /^#([0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // 相对亮度（WCAG 简化式）
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L < 0.2;
}

(async () => {
  const cssText = fs.readFileSync(path.join(ROOT, '01-tokens', 'tokens.css'), 'utf8');
  const srv = await serve(cssText);
  const port = srv.address().port;
  let browser;
  const problems = [];
  try {
    browser = await launch();
    for (const c of CASES) {
      const page = await browser.newPage();
      await page.emulateMediaFeatures([
        { name: 'prefers-color-scheme', value: c.sys }]);
      await page.goto('http://127.0.0.1:' + port + '/index.html',
                      { waitUntil: 'load' });
      if (c.attr) {
        await page.evaluate((a) => {
          document.documentElement.setAttribute('data-theme', a);
        }, c.attr);
      }
      const got = await page.evaluate((names) => {
        const cs = getComputedStyle(document.documentElement);
        const out = {};
        names.forEach((n) => { out[n] = cs.getPropertyValue(n).trim(); });
        return out;
      }, PROBE);
      await page.close();

      const dark = isDark(got['--paper']);
      const label = '系统=' + c.sys + ' data-theme=' + (c.attr || '(无)');
      const paper = got['--paper'];
      if (dark === null) {
        problems.push(label + ' ⇒ `--paper` 读出来是 `' + paper +
                      '`，不是 6 位 hex（判不了明暗）');
        continue;
      }
      const wantDark = c.want === 'dark';
      if (dark !== wantDark) {
        problems.push(label + ' ⇒ 期望' + (wantDark ? '暗' : '浅') +
                      '色，实际' + (dark ? '暗' : '浅') +
                      '色（`--paper` = ' + paper + '）');
      } else {
        console.log('  [OK] ' + label + ' ⇒ ' + (wantDark ? '暗' : '浅') +
                    '色（`--paper` = ' + paper + '）  // ' + c.why);
      }
    }
  } finally {
    if (browser) await browser.close();
    srv.close();
  }

  if (problems.length) {
    problems.forEach((p) => console.log('  [FAIL] ' + p));
    console.log('\n  ⇒ 纯 CSS 明暗不成立：暗色仍在依赖 JS，或三态开关有条路径被漏掉。');
    process.exit(1);
  }
  console.log('\n  [OK] 四种组合全部成立 —— 暗色不依赖 JS');
})();
