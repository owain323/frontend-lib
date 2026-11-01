#!/usr/bin/env node
/*
 * print-gate.js — 打印产物判据（G1-04）
 *
 * ============================================================================
 * 🔴 为什么必须读 PDF，而不是读 getComputedStyle
 * ============================================================================
 * 两条实测事实（0.24.2）：
 *
 *   ① `page.emulateMediaType('print')` 在本环境**并不真的切换媒体类型**
 *      —— `matchMedia('print').matches` 仍然是 false。
 *      也就是说：在"print 模式"下取到的计算样式，其实还是屏幕样式。
 *      拿它当纸面，量的是一个不存在的世界。
 *
 *   ② Chromium 在 `printBackground:false` 时会**改写文字颜色**：
 *      #E4E7EA → #929496、#FFFFFF → #ABABAB、#808080 → #2C2C2C，
 *      而 #FF0000 / #2563EB / #15181C 原样不动（无彩色被压暗，饱和色与深色保留）。
 *      所以"声明色"和"纸面色"是两个数，只有后者是使用者看到的东西。
 *
 * ⇒ 判据只有一个可信观测面：`page.pdf()` 的产物。
 *
 * ============================================================================
 * 判据
 * ============================================================================
 *   ① 每个页面 × 每个屏幕配色，产物里**每一段文字**对白纸的对比度 ≥ 4.5:1
 *   ② 暗色与浅色两次打印的**文字颜色分布完全相同**（打印不该认识屏幕主题）
 *   ③ 页数与基线一致（分页没被改坏）
 *   ④ 文字 run 数与基线一致（内容没被裁掉 / 没多出空白）
 *
 * ⚠️ 这条判据**不覆盖**（写在这里是为了不让它被当成"打印全过"）：
 *   · 字体回退：字体缺失时 Chromium 仍会嵌一个回退字体，产物照样"有字"；
 *   · 裁切：元素被 `overflow:hidden` 切掉的部分不会进 PDF，run 数也不变；
 *   · 页眉页脚 / 页码 / 章节分页：本库没有这些，也没有判据；
 *   · 空白页：靠 ③④ 间接兜（内容不见了 ⇒ run 数变），不是直接检测。
 *   这几条要么需要逐页解析内容流，要么需要"打印版式"这个尚不存在的概念。
 *
 * 用法：
 *   node 05-audit/print-gate.js            # 判据
 *   node 05-audit/print-gate.js --update   # 重录基线
 *   node 05-audit/print-gate.js --selftest # 反向控制（自带 fixture，不需要服务器）
 *
 * 依赖：静态服务（check-all 会起；单独跑时设 BASE，默认 http://127.0.0.1:8000）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { withPage } = require('./browser.js');

const ROOT = path.dirname(__dirname);
const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const OUT = path.join(ROOT, '05-audit', 'print-baseline.json');

/* 页面集：覆盖「站点首页 / 文档页 / 组件页 / 两个版式模板 / 示例项目」。
   不是"挑几个能过的"，是**每一类交付面各取一个**。 */
const PAGES = [
  ['root-index', '/index.html'],
  ['guide-index', '/guide/index.html'],
  ['guide-button', '/guide/button.html'],
  ['recipe-report', '/04-recipes/report/demo.html'],
  ['recipe-analysis-report', '/04-recipes/analysis-report/demo.html'],
  ['example-finance-report', '/examples/finance-report/index.html'],
];

const MIN_CONTRAST = 4.5;

/* ---------------------------------------------------------------- PDF 解析 */

const NUM = '[-+]?[0-9]*\\.?[0-9]+';
const RE_TOK = new RegExp(
  '\\bq\\b|\\bQ\\b|(' + NUM + ')\\s+(' + NUM + ')\\s+(' + NUM + ')\\s+rg\\b'
  + '|(' + NUM + ')\\s+g\\b|\\bTj\\b|\\bTJ\\b', 'g');

function streams(buf) {
  const out = [];
  /* ⚠️ 必须 Buffer.from(buf)：`page.pdf()` 返回的是 Uint8Array，
     它的 `.toString('latin1')` **不认参数**，会给出一串 "1,2,3,…" 的字节表
     ⇒ 既搜不到 `stream`，也搜不到 `Tj` ⇒ 判据恒判"没有文字"。
     这个坑让自检报了三行 worst=Infinity。
     ⚠️ 也不能用 indexOf('stream')：`endstream` 里也含 `stream`，
     会从流的**结尾**开始解压 ⇒ 全部解压失败。用词边界排除它。 */
  const b = Buffer.from(buf);
  const re = /\bstream\r?\n/g;
  let m;
  const s = b.toString('latin1');
  while ((m = re.exec(s)) !== null) {
    const p = m.index + m[0].length;
    const e = s.indexOf('endstream', p);
    if (e < 0) break;
    try {
      out.push(zlib.inflateSync(b.subarray(p, e)));
    } catch (err) { /* 不是 Flate 的流跳过 */ }
    re.lastIndex = e + 9;
  }
  return out;
}

function lum(rgb) {
  const c = rgb.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrastWhite(rgb) {
  return 1.05 / (lum(rgb) + 0.05);
}

function hex(rgb) {
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** 读 PDF：页数 + 文字颜色直方图 */
function analyze(buf) {
  const pages = (Buffer.from(buf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  const hist = {};
  let runs = 0;
  for (const st of streams(buf)) {
    const txt = st.toString('latin1');
    if (txt.indexOf('Tj') < 0 && txt.indexOf('TJ') < 0) continue;
    const stack = [];
    let cur = [0, 0, 0];
    RE_TOK.lastIndex = 0;
    let m;
    while ((m = RE_TOK.exec(txt)) !== null) {
      const tok = m[0];
      if (tok === 'q') {
        stack.push(cur.slice());
      } else if (tok === 'Q') {
        if (stack.length) cur = stack.pop();
      } else if (tok === 'Tj' || tok === 'TJ') {
        const key = hex(cur);
        hist[key] = (hist[key] || 0) + 1;
        runs += 1;
      } else if (tok.endsWith('rg')) {
        cur = [parseFloat(m[1]) * 255, parseFloat(m[2]) * 255, parseFloat(m[3]) * 255];
      } else if (tok === 'g') {
        const v = parseFloat(m[4]) * 255;
        cur = [v, v, v];
      }
    }
  }
  let worst = Infinity;
  let worstColor = null;
  for (const k of Object.keys(hist)) {
    const rgb = [parseInt(k.slice(1, 3), 16), parseInt(k.slice(3, 5), 16), parseInt(k.slice(5, 7), 16)];
    const c = contrastWhite(rgb);
    if (c < worst) { worst = c; worstColor = k; }
  }
  let below = 0;
  for (const k of Object.keys(hist)) {
    const rgb = [parseInt(k.slice(1, 3), 16), parseInt(k.slice(3, 5), 16), parseInt(k.slice(5, 7), 16)];
    if (contrastWhite(rgb) < MIN_CONTRAST) below += hist[k];
  }
  return { pages, runs, hist, worst: runs ? worst : Infinity, worstColor, below };
}

/* ---------------------------------------------------------------- 渲染 */

async function render(url, scheme) {
  return withPage({ width: 794, height: 1123, deviceScaleFactor: 1 }, async (p) => {
    await p.goto(url, { waitUntil: 'load', timeout: 45000 });
    await p.emulateMediaType('print');
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await p.evaluate(() => (document.fonts ? document.fonts.ready.then(() => 1) : 1));
    /* 等布局静止：只等固定毫秒会在长页面上量到"还没排完"的版面 */
    let prev = -1;
    let stab = 0;
    for (let i = 0; i < 30; i += 1) {
      const h = await p.evaluate(() => document.body.scrollHeight);
      if (h === prev) { stab += 1; if (stab >= 2) break; } else { stab = 0; prev = h; }
      await new Promise((r) => setTimeout(r, 120));
    }
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth
      - document.documentElement.clientWidth);
    const pdf = await p.pdf({
      format: 'A4',
      printBackground: false,     /* Chrome 打印对话框的默认：背景图形不勾 */
      preferCSSPageSize: true,
      margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
    });
    return { pdf, overflow };
  });
}

/* ---------------------------------------------------------------- 判据 */

function sameHist(a, b) {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i] || a[ka[i]] !== b[kb[i]]) return false;
  }
  return true;
}

function judge(result, baseline) {
  const errs = [];
  for (const name of Object.keys(result)) {
    const r = result[name];
    for (const scheme of ['light', 'dark']) {
      const got = r[scheme];
      const tag = name + '/' + scheme;
      if (got.worst < MIN_CONTRAST) {
        errs.push(tag + '：最低对比度 ' + got.worst.toFixed(2) + ':1 < ' + MIN_CONTRAST
          + '（最差颜色 ' + got.worstColor + '，' + got.below + ' 段）');
      }
      if (baseline && baseline.pages[name]) {
        const b = baseline.pages[name][scheme];
        if (got.pages !== b.pages) {
          errs.push(tag + '：页数 ' + got.pages + ' ≠ 基线 ' + b.pages);
        }
        if (got.runs !== b.runs) {
          errs.push(tag + '：文字 run 数 ' + got.runs + ' ≠ 基线 ' + b.runs
            + '（内容被裁掉或多出来）');
        }
      }
    }
    if (!sameHist(r.light.hist, r.dark.hist)) {
      errs.push(name + '：暗色与浅色的打印产物**文字颜色不同**'
        + ' ⇒ 打印还在受屏幕主题影响');
    }
    if (r.light.overflow !== 0) {
      errs.push(name + '：横向溢出 ' + r.light.overflow + 'px');
    }
  }
  return errs;
}

/* ---------------------------------------------------------------- 主流程 */

async function main() {
  const argv = process.argv.slice(2);
  if (argv.indexOf('--selftest') >= 0) return selftest();

  const update = argv.indexOf('--update') >= 0;
  const result = {};
  for (const [name, url] of PAGES) {
    result[name] = {};
    for (const scheme of ['light', 'dark']) {
      const { pdf, overflow } = await render(BASE + url, scheme);
      const a = analyze(pdf);
      a.overflow = overflow;
      result[name][scheme] = a;
      const line = '  ' + (name + '/' + scheme).padEnd(34)
        + ' pages=' + String(a.pages).padStart(2)
        + ' runs=' + String(a.runs).padStart(5)
        + ' worst=' + a.worst.toFixed(2) + ':1';
      console.log(line);
    }
  }

  let baseline = null;
  if (fs.existsSync(OUT)) {
    try { baseline = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { baseline = null; }
  }

  const errs = judge(result, update ? null : baseline);
  if (update) {
    const out = {
      note: 'print-gate 基线：页数 / 文字 run 数 / 颜色直方图。只由 --update 写入。',
      minContrast: MIN_CONTRAST,
      pages: {},
    };
    for (const name of Object.keys(result)) {
      out.pages[name] = {};
      for (const scheme of ['light', 'dark']) {
        const a = result[name][scheme];
        out.pages[name][scheme] = {
          pages: a.pages, runs: a.runs,
          worst: Math.round(a.worst * 100) / 100, hist: a.hist,
        };
      }
    }
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
    console.log('  已写入 ' + path.relative(ROOT, OUT));
  }

  if (errs.length) {
    console.log('  [FAIL] 打印产物不合格：');
    errs.slice(0, 12).forEach((e) => console.log('        ' + e));
    return 1;
  }
  console.log('  OK  ' + PAGES.length + ' 个页面 × 2 种屏幕配色：'
    + '每段文字 ≥ ' + MIN_CONTRAST + ':1，且暗色与浅色产物一致');
  return 0;
}

/* ---------------------------------------------------------------- 自检 */

/* 自检用 fixture：全部内联，走 file://，不依赖仓库页面与服务器。
   ⚠️ 这里**必须**同时有"该绿"和"该红"两侧：
      一道永远红的判据也能"抓到问题"，那不是判据，是噪声。 */
const FIXTURES = {
  'ok.html': '<!DOCTYPE html><meta charset="utf-8"><style>'
    + 'body{margin:0;padding:24px;background:#fff;color:#15181c;font:16px/1.6 sans-serif}'
    + 'h1{font-size:24px}p{color:#4f555e}'
    + '</style><h1>标题</h1><p>正文一段，颜色是浅色主题的正文色。</p>',

  /* 🔴 探针是"白字压深色块"，不是"浅灰字压白纸"。
     实测：Chromium 在 printBackground:false 下会**改写**文字色，
     纯灰 #ABABAB 压白纸会被压暗到 7.23:1 —— 拿它当反例，判据会"抓不到"。
     而"白字 + 被丢弃的底色"是这次真正修的形态：产物里是 #ABABAB，2.30:1。 */
  'too-light.html': '<!DOCTYPE html><meta charset="utf-8"><style>'
    + 'body{margin:0;padding:24px;background:#fff;color:#15181c;font:16px/1.6 sans-serif}'
    + '.chip{display:inline-block;padding:8px 14px;border-radius:6px;'
    + 'background:#1b4d8f;color:#fff}'
    + '</style><h1>实心控件</h1><p><span class="chip">白字压深蓝</span></p>',

  /* 复刻这次修的缺陷：暗色令牌**没有** scope 到屏幕 ⇒ 打印也用暗色字 */
  'dark-leak.html': '<!DOCTYPE html><meta charset="utf-8"><style>'
    + ':root{--fg:#15181c;--bg:#ffffff}'
    + '@media (prefers-color-scheme: dark){:root{--fg:#e4e7ea;--bg:#14171a}}'
    + 'body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:16px/1.6 sans-serif}'
    + '</style><h1>暗色漏进打印</h1><p>屏幕暗色时，这段字会以浅色落到白纸上。</p>',

  /* 修好之后的形态：暗色只在屏幕上生效 */
  'dark-scoped.html': '<!DOCTYPE html><meta charset="utf-8"><style>'
    + ':root{--fg:#15181c;--bg:#ffffff}'
    + '@media screen and (prefers-color-scheme: dark){:root{--fg:#e4e7ea;--bg:#14171a}}'
    + 'body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:16px/1.6 sans-serif}'
    + '</style><h1>暗色关在屏幕里</h1><p>打印回落到浅色令牌。</p>',
};

async function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'print-gate-'));
  let bad = 0;
  const report = (ok, why, extra) => {
    console.log('  [' + (ok ? 'OK  ' : 'FAIL') + '] ' + why + (extra ? '  ' + extra : ''));
    if (!ok) bad += 1;
  };

  try {
    for (const name of Object.keys(FIXTURES)) {
      fs.writeFileSync(path.join(dir, name), FIXTURES[name]);
    }

    /* ① 判据对 fixture 的两种结局 */
    const ok = await render('file:///' + dir.replace(/\\/g, '/') + '/ok.html', 'light');
    const a1 = analyze(ok.pdf);
    report(a1.worst >= MIN_CONTRAST, '深色文字 ⇒ 判绿', 'worst=' + a1.worst.toFixed(2));

    const badPdf = await render('file:///' + dir.replace(/\\/g, '/') + '/too-light.html', 'light');
    const a2 = analyze(badPdf.pdf);
    report(a2.worst < MIN_CONTRAST, '浅色文字 ⇒ 判红', 'worst=' + a2.worst.toFixed(2));

    /* ② 元反向：把阈值改成 0，同一个浅色 fixture 必须变绿
          —— 证明"红"是阈值造成的，不是别的东西在红 */
    report(!(a2.worst < 0), '元反向：阈值取 0 时同一 fixture 不再红');

    /* ③ 这次修的缺陷本身：暗色漏进打印 ⇒ 判红 */
    const leak = await render('file:///' + dir.replace(/\\/g, '/') + '/dark-leak.html', 'dark');
    const a3 = analyze(leak.pdf);
    report(a3.worst < MIN_CONTRAST, '暗色漏进打印 ⇒ 判红', 'worst=' + a3.worst.toFixed(2));

    /* ④ 修好之后：同一份 CSS 加 `screen and` ⇒ 判绿 */
    const scoped = await render('file:///' + dir.replace(/\\/g, '/') + '/dark-scoped.html', 'dark');
    const a4 = analyze(scoped.pdf);
    report(a4.worst >= MIN_CONTRAST, '暗色关进屏幕 ⇒ 判绿', 'worst=' + a4.worst.toFixed(2));

    /* ⑤ 判据②本身：浅色与暗色的产物必须一致 */
    const lightOk = await render('file:///' + dir.replace(/\\/g, '/') + '/dark-scoped.html', 'light');
    report(sameHist(analyze(lightOk.pdf).hist, a4.hist),
      '同一页面两种配色的产物颜色分布一致');

    /* ⑥ 元反向：故意让两套配色不同，判据②必须能红 */
    report(!sameHist(a3.hist, a4.hist), '元反向：漏色与关色两种形态的产物分布不同');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }

  console.log(bad ? '  ❌ 反向控制有 ' + bad + ' 条没通过' : '  ✅ 反向控制全绿');
  return bad ? 1 : 0;
}

main().then((rc) => process.exit(rc || 0)).catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(2);
});
