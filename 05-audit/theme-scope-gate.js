/*
 * theme-scope-gate.js — 真浏览器验证**容器级**主题作用域
 *
 * ============================================================================
 * 🔴 为什么需要它（theme-css-gate 覆盖不到的那一半）
 * ----------------------------------------------------------------------------
 * `theme-css-gate` 只验根元素上的四种组合（系统 × data-theme）。它能证明
 * "整页明暗正确"，但证不了下面这些 —— 而它们正是 P1 的全部价值：
 *
 *   · 一个 `[data-theme="dark"]` 容器里的按钮，真的用了暗色 `--accent` 吗？
 *   · 暗容器里再嵌一个 `[data-theme="light"]` 容器，真的能**回退**成浅色吗？
 *   · 容器作用域下，按钮的字/底对比度还达不达标？
 *   · 容器里的焦点环拿到了暗色加强版吗？
 *
 * 报告说"支持容器级"不算证据（INVARIANT I-10）。这里全部实测。
 *
 * ============================================================================
 * 判据
 * ----------------------------------------------------------------------------
 *  ① 作用域解析：容器内 `--paper` 取该作用域的值，容器外不受影响
 *  ② 组件跟随：同一种按钮在暗区里与区外**不同色**，在"暗区里的亮区"里
 *     与区外**同色**（回退成立）
 *  ③ 对比度：三个位置的按钮，字/底对比度都 ≥ 4.5:1（WCAG AA）
 *  ④ 焦点环：暗区里的焦点环用暗色加强版（outline-color 与区外不同）
 *  ⑤ 静态：组件 CSS 里**不许**再有 `@media (prefers-color-scheme: dark)`
 *     —— 主题从容器来之后，按系统偏好分支必然与周围不自洽（RFC D5）
 *
 * ============================================================================
 * 反向控制（--selftest，改的是真 CSS 文本，不是合成数据）
 * ----------------------------------------------------------------------------
 *   · 把暗色段选择器改回 `:root[data-theme="dark"]` ⇒ ② 必须红
 *   · 删掉 `[data-theme="light"]` 回退段          ⇒ ② 必须红
 *
 * ============================================================================
 * 用法
 * ----------------------------------------------------------------------------
 *   node 05-audit/theme-scope-gate.js
 *   node 05-audit/theme-scope-gate.js --selftest
 * ============================================================================
 */
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const { safeListen } = require('./safe-listen.js');
const { launch } = require('./browser.js');

const ROOT = path.resolve(__dirname, '..');
const MIN_CONTRAST = 4.5;

const SERVED = {
  '/focus-ring.css': '01-tokens/focus-ring.css',
  '/button.css': '02-primitives/button/button.css',
  '/tooltip.css': '03-patterns/tooltip/tooltip.css',
};

// 三个按钮位置：区外 / 暗区 / 暗区里的亮区。Tab 顺序与 DOM 顺序一致。
// 两个气泡（div 不可聚焦，不影响 Tab 顺序）：区外 / 暗区 —— 用来验证
// 曾经按系统偏好分支的组件，改成令牌后是否真的跟着容器走。
const HTML = '<!doctype html><html lang="zh"><head><meta charset="utf-8">' +
  '<link rel="stylesheet" href="/tokens.css">' +
  '<link rel="stylesheet" href="/focus-ring.css">' +
  '<link rel="stylesheet" href="/button.css">' +
  '<link rel="stylesheet" href="/tooltip.css"></head><body>' +
  '<button id="out" class="btn btn--primary">区外</button>' +
  '<div id="tipOut" class="tooltip tooltip--top" data-state="open">区外气泡</div>' +
  '<div id="dark" data-theme="dark">' +
  '<button id="inDark" class="btn btn--primary">暗区</button>' +
  '<div id="tipIn" class="tooltip tooltip--top" data-state="open">暗区气泡</div>' +
  '<div id="light" data-theme="light">' +
  '<button id="inLight" class="btn btn--primary">暗区里的亮区</button>' +
  '</div>' +
  '</div>' +
  '</body></html>';

/* ---------------------------------------------------------------- 颜色工具 */

function parseRGB(s) {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(s || '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function lum(rgb) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

function contrast(a, b) {
  const pa = parseRGB(a);
  const pb = parseRGB(b);
  if (!pa || !pb) return null;
  const la = lum(pa);
  const lb = lum(pb);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function isDarkHex(v) {
  const m = /^#([0-9a-f]{6})$/i.exec((v || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return lum([(n >> 16) & 255, (n >> 8) & 255, n & 255]) < 0.2;
}

/* ---------------------------------------------------------------- 起一个服务 */

function serve(tokensCss) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      if (url === '/' || url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(HTML);
        return;
      }
      if (url === '/tokens.css') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        res.end(tokensCss);
        return;
      }
      if (SERVED[url]) {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        res.end(fs.readFileSync(path.join(ROOT, SERVED[url]), 'utf8'));
        return;
      }
      res.writeHead(404);
      res.end('');
    });
    safeListen(srv).then(() => resolve(srv));
  });
}

/* ---------------------------------------------------------------- 实测 */

async function measure(browser, port) {
  const page = await browser.newPage();
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: 'light' }]);
  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });

  const res = await page.evaluate(() => {
    const read = (id) => {
      const el = document.getElementById(id);
      const cs = getComputedStyle(el);
      return {
        id,
        paper: cs.getPropertyValue('--paper').trim(),
        accent: cs.getPropertyValue('--accent').trim(),
        bg: cs.backgroundColor,
        fg: cs.color,
      };
    };
    const out = {
      boxes: ['out', 'inDark', 'inLight'].map(read),
      tips: ['tipOut', 'tipIn'].map(read),
      outline: {},
    };
    // 焦点环：用真实 Tab 键，而不是 el.focus()（后者不保证 :focus-visible）
    return out;
  });

  // Tab 三次，逐个记录 outline-color
  await page.evaluate(() => document.body.focus());
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    const got = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        id: el ? el.id : null,
        outline: el ? getComputedStyle(el).outlineColor : null,
      };
    });
    if (got.id) res.outline[got.id] = got.outline;
  }

  await page.close();
  return res;
}

function judge(m) {
  const problems = [];
  const by = {};
  m.boxes.forEach((b) => { by[b.id] = b; });

  // ① 作用域解析（isDarkHex 返回"是不是暗"，null = 读不出 6 位 hex）
  [['out', '区外', false], ['inDark', '暗容器', true], ['inLight', '暗区亮区', false]]
    .forEach(([id, where, wantDark]) => {
      const got = isDarkHex(by[id].paper);
      if (got === null) {
        problems.push('① ' + where + ' 的 `--paper` 读不出 6 位 hex（`' +
          by[id].paper + '`）—— 令牌没解析，判不了明暗');
      } else if (got !== wantDark) {
        problems.push('① ' + where + ' 的 `--paper` 是' + (got ? '暗' : '浅') +
          '色，期望' + (wantDark ? '暗' : '浅') + '（`' + by[id].paper +
          '`）' + (id === 'inDark' ? ' —— 容器级作用域没生效' : ''));
      }
    });

  // ② 组件跟随
  if (by.inDark.bg === by.out.bg) {
    problems.push('② 暗区里的按钮底色与区外相同（`' + by.out.bg +
      '`）—— 组件没跟随容器');
  }
  if (by.inLight.bg !== by.out.bg) {
    problems.push('② 暗区里的亮区按钮底色（`' + by.inLight.bg +
      '`）与区外（`' + by.out.bg + '`）不同 —— 回退没回到浅色');
  }

  // ② 的加强版：tooltip 以前靠 `@media (prefers-color-scheme)` 分支，
  //    那是 P1 里被删掉的东西 —— 删了之后必须仍在作用域里跟着翻转。
  if (m.tips[0].bg === m.tips[1].bg) {
    problems.push('② 暗区里的气泡底色与区外相同（`' + m.tips[0].bg +
      '`）—— tooltip 没跟随容器（它曾经按系统偏好分支）');
  } else {
    console.log('  [OK] ② 气泡随作用域翻转：区外 ' + m.tips[0].bg + ' / 暗区 ' +
      m.tips[1].bg);
  }

  // ③ 对比度（实测值，不是读源码）
  ['out', 'inDark', 'inLight'].forEach((id) => {
    const c = contrast(by[id].bg, by[id].fg);
    if (c === null) {
      problems.push('③ ' + id + ' 的颜色解析不了：bg=`' + by[id].bg +
        '` fg=`' + by[id].fg + '`');
      return;
    }
    if (c < MIN_CONTRAST) {
      problems.push('③ ' + id + ' 按钮对比度 ' + c.toFixed(2) + ':1 < ' +
        MIN_CONTRAST + ':1（bg=`' + by[id].bg + '` fg=`' + by[id].fg + '`）');
    } else {
      console.log('  [OK] ③ ' + id + ' 对比度 ' + c.toFixed(2) + ':1（高于 ' +
        MIN_CONTRAST + '）');
    }
  });

  // ④ 焦点环用暗色加强版
  if (!m.outline.out || !m.outline.inDark) {
    problems.push('④ 没能用 Tab 聚焦到两个按钮（outline 缺失）');
  } else if (m.outline.inDark === m.outline.out) {
    problems.push('④ 暗区里的焦点环颜色与区外相同（`' + m.outline.out +
      '`）—— 暗色加强版没跟着容器走');
  } else if (m.outline.inLight !== m.outline.out) {
    problems.push('④ 暗区里的亮区焦点环（`' + m.outline.inLight +
      '`）没有回到浅色版（区外是 `' + m.outline.out + '`）');
  }

  // ① 的补充：把结果打出来，便于人工核对
  console.log('  [--] ① --paper：区外 ' + by.out.paper + ' / 暗区 ' +
    by.inDark.paper + ' / 暗区亮区 ' + by.inLight.paper);
  console.log('  [--] ② 按钮底色：区外 ' + by.out.bg + ' / 暗区 ' +
    by.inDark.bg + ' / 暗区亮区 ' + by.inLight.bg);
  return problems;
}

/* ---------------------------------------------------------------- 静态判据 ⑤ */

/** 去掉 CSS 注释。⚠️ 注释里**提到** `@media (prefers-color-scheme: dark)`（解释
 *  为什么删掉它）不算分支 —— 不遮蔽的话，写清楚理由反而会让门禁变红。
 *  这是本库 E18「判据聋/瞎」的同类坑，已在 _attic 的教训里记过。 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const STATIC_SKIP = {
  // 精简档单文件里没有 L1/L2 间接层（值是平铺的），"跟随系统"是它唯一机制。
  // 它是 make-tiersnippet.py 从 tokens.css 生成的产物，不参与容器作用域。
  'tierA-tokens.css': '精简档单文件：平铺值，无作用域概念',
};

function checkNoComponentMediaQuery() {
  const dirs = ['02-primitives', '03-patterns', '04-recipes'];
  const hits = [];
  const walk = (d) => {
    fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) return walk(p);
      if (!e.name.endsWith('.css')) return;
      if (STATIC_SKIP[e.name]) return;
      const txt = stripComments(fs.readFileSync(p, 'utf8'));
      if (/@media[^{]*prefers-color-scheme\s*:\s*dark/.test(txt)) {
        hits.push(path.relative(ROOT, p).replace(/\\/g, '/'));
      }
    });
  };
  dirs.forEach((d) => walk(path.join(ROOT, d)));
  return hits;
}

/* ---------------------------------------------------------------- 主流程 */

async function run(tokensCss, label) {
  const srv = await serve(tokensCss);
  const port = srv.address().port;
  let browser;
  const problems = [];
  try {
    browser = await launch();
    const m = await measure(browser, port);
    problems.push.apply(problems, judge(m));
  } finally {
    if (browser) await browser.close();
    srv.close();
  }
  return problems;
}

function mutate(css, label) {
  if (label === 'root-only') {
    return css.replace(':root[data-theme="dark"],\n[data-theme="dark"] {',
      ':root[data-theme="dark"] {');
  }
  if (label === 'no-light') {
    const a = css.indexOf('/* === BEGIN: light-via-attr');
    const bEnd = css.indexOf('/* === END: light-via-attr === */');
    if (a < 0 || bEnd < 0) return css;
    return css.slice(0, a) + css.slice(bEnd + '/* === END: light-via-attr === */'.length);
  }
  return css;
}

(async () => {
  const raw = fs.readFileSync(path.join(ROOT, '01-tokens', 'tokens.css'), 'utf8');

  if (process.argv.includes('--selftest')) {
    console.log('  === theme-scope 反向控制（改真 CSS 文本）===');
    let ok = true;
    const cases = [
      ['改成根限定', 'root-only'],
      ['删掉浅色回退段', 'no-light'],
    ];
    for (const [why, key] of cases) {
      const mutated = mutate(raw, key);
      if (mutated === raw) {
        console.log('  [FAIL] 变异体没生效（样本搜不到目标文本）：' + why);
        ok = false;
        continue;
      }
      const probs = await run(mutated, why);
      const bad = probs.length > 0;
      console.log('  [' + (bad ? 'OK ' : 'FAIL') + '] ' + why +
        ' 期望红 ⇒ 实际' + (bad ? '红' : '绿') +
        (bad ? '' : ' —— 判据是瞎的'));
      if (!bad) ok = false;
    }
    process.exit(ok ? 0 : 1);
  }

  console.log('  === 容器级主题作用域（真浏览器）===');
  const problems = await run(raw, 'base');
  const staticHits = checkNoComponentMediaQuery();
  if (staticHits.length) {
    staticHits.forEach((f) => problems.push(
      '⑤ ' + f + ' 仍按 `prefers-color-scheme` 分支 —— 主题从容器来之后' +
      '必然与周围不自洽（改成令牌，见 RFC-THEME-SCOPE D5）'));
  } else {
    console.log('  [OK] ⑤ 组件 CSS 里没有 `prefers-color-scheme` 分支');
  }

  if (problems.length) {
    problems.forEach((p) => console.log('  [FAIL] ' + p));
    console.log('\n  ⇒ 容器级主题不成立（' + problems.length + ' 处）。');
    process.exit(1);
  }
  console.log('  [OK] 容器级主题作用域成立（含嵌套回退、组件跟随、对比度、焦点环）');
})().catch((e) => {
  console.error('  [FAIL] 门禁异常：' + (e && e.stack || e));
  process.exit(1);
});
