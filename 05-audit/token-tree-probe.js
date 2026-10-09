/*
 * token-tree-probe.js — 用 **Chrome 自己的 CSS 解析器**（CSSOM）读一遍令牌
 *
 * ============================================================================
 * 🔴 为什么需要这根桩
 * ----------------------------------------------------------------------------
 * ai/tokens.tree.json 是**生成物**。生成物跟"再生成一遍"比，等于自己跟自己
 * 对答案，不引入任何新信息（docs/INVARIANT.md I-10 实证 9）。
 *
 * ⇒ 必须挂到一根**独立**的桩上。这根桩就是浏览器的 CSSOM：
 *     它走的是 Chrome 的词法/语法分析，不是本库任何一条正则。
 *
 *   · 名字对不对：CSSOM 枚举到的自定义属性名，才是浏览器真的认的
 *   · 值对不对：自定义属性在 CSSOM 里保留原始 token 流（不归一化），
 *     但**注释会被词法分析丢掉** ⇒ 生成器也必须丢（否则两边对不上）
 *
 *   这一类差异只有这根桩抓得到 —— 例如"孤儿注释收尾符把下一行令牌吃掉"
 *   （token-parse-gate.py 里记过的 bug A），正则照样能匹配到那一行，
 *   而浏览器里那条声明**根本不存在**。
 *
 * ============================================================================
 * 用法
 * ----------------------------------------------------------------------------
 *   node 05-audit/token-tree-probe.js --json
 *   ⇒ { "names": [...], "values": { "--paper": ["#f6f7f8", ...] } }
 * ============================================================================
 */
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.dirname(__dirname);
const { launch } = require(process.env.FL_BROWSER || path.join(__dirname, 'browser.js'));

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

(async () => {
  const cssText = fs.readFileSync(path.join(ROOT, '01-tokens', 'tokens.css'), 'utf8');
  const srv = await serve(cssText);
  const port = srv.address().port;
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load' });
    const out = await page.evaluate(() => {
      const names = [];
      const values = {};
      const walk = (list) => {
        for (const r of list) {
          if (r.style) {
            for (let i = 0; i < r.style.length; i++) {
              const n = r.style[i];
              if (n.indexOf('--') !== 0) continue;
              const v = r.style.getPropertyValue(n).trim();
              if (names.indexOf(n) < 0) names.push(n);
              (values[n] = values[n] || []).push(v);
            }
          }
          if (r.cssRules) walk(r.cssRules);
        }
      };
      for (const sheet of document.styleSheets) walk(sheet.cssRules);
      Object.keys(values).forEach((k) => {
        values[k] = values[k].filter((v, i, a) => a.indexOf(v) === i).sort();
      });
      return { names: names.sort(), values: values, ruleDecls: Object.keys(values).length };
    });
    await page.close();
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log('  CSSOM 解析到 %d 个不同的自定义属性', out.names.length);
      out.names.slice(0, 5).forEach((n) => console.log('    %s = %s', n, out.values[n][0]));
    }
  } finally {
    if (browser) await browser.close();
    srv.close();
  }
})().catch((e) => {
  console.error('[FAIL] ' + e.message);
  process.exit(1);
});
