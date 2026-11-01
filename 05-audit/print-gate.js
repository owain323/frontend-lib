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
 *   ⑤ 横向溢出为 0（794px 视口下的**屏幕**布局，见下"不覆盖"）
 *   ⑥ 每个**结构类型**至少 1 页在采样集里（G2-02：类型由 DOM 算，不由人挑）
 *   ⑦ 每个类型的代表必须落在**度量最大那一档**（≥ 全集最大值的 90%，跨平台余量）
 *   ⑧ 采样集里的每个路径都必须存在于页面全集（防手写页面名 / 死链）
 *   ⑨ 判据自检：类型在全集里 0 命中（触发条件写错）；或命中但**度量恒为 0**
 *      （那样 ⑦ 的 `best < 0 * 0.9` 恒为 false ⇒ 安静地永远通过）
 *
 * 🔴 ⑥⑦⑧ 存在的理由：①–⑤ 都是"对**被测的那几页**下结论"。
 *    页面集本身选错了，前五条会**全绿**地告诉你"打印没问题"。
 *    这是最安静的假绿：判据没问题，样本有问题。
 *    实测教训：`form` 类在旧集合里只有 1 个控件（全集最大 13 个），
 *    `wide` 代表只有 294px（全集最大 370px）—— 两条都能被前五条判绿。
 *
 * ⚠️ 这些判据**不覆盖**（写在这里是为了不让它被当成"打印全过"）：
 *   · 字体回退：字体缺失时 Chromium 仍会嵌一个回退字体，产物照样"有字"；
 *   · 裁切：元素被 `overflow:hidden` 切掉的部分不会进 PDF，run 数也不变；
 *   · 页眉页脚 / 页码 / 章节分页：本库没有这些，也没有判据；
 *   · 空白页：靠 ③④ 间接兜（内容不见了 ⇒ run 数变），不是直接检测。
 *   · ⑤ 量的是 794px 视口下的**屏幕**布局（没扣 10mm×2 页边，也不是 print 媒体）
 *     ⇒ 只能当近似，不能当"打印没被裁"。
 *   这几条要么需要逐页解析内容流，要么需要"打印版式"这个尚不存在的概念。
 *
 * 用法：
 *   node 05-audit/print-gate.js            # 判据（含 ⑥⑦⑧ 与类型表）
 *   node 05-audit/print-gate.js --update   # 重录基线（同时记录采样页与类型快照）
 *   node 05-audit/print-gate.js --selftest # 反向控制（自带 fixture，不需要服务器）
 *
 * 依赖：静态服务（check-all 会起；单独跑时设 BASE，默认 http://127.0.0.1:8000）；
 *      页面全集来自 `shot-baseline.py --list`（要 python，PY 可覆盖解释器名）。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { withPage } = require('./browser.js');

const ROOT = path.dirname(__dirname);
const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const OUT = path.join(ROOT, '05-audit', 'print-baseline.json');

/* ============================================================================
 * 页面集：为什么是这三段，而不是"挑 6 个有代表性的"
 * ============================================================================
 *   ① DOC_PAGES  —— 交付面：站点首页 + 两个文档页
 *   ② KEEP_PAGES —— 历史样本：它们已有基线，删掉等于丢证据
 *   ③ TYPE_REPS  —— **结构类型代表**：每个类型取度量最大的那个实例
 *
 * 🔴 为什么要有 ③（G2-02）
 *   原来那 6 页（3 文档面 + 3 历史样本）不是"没覆盖"，是**覆盖得很虚**：
 *     · `form`：只有 `guide-index` 的 1 个控件凑到，而全集最大是 13 个 —— 强度 1/13；
 *     · `wide`：代表只有 294px 溢出，而 `04-recipes/table/demo.html` 是 370px、
 *       126 个元素越界 —— 差 26%，且最大的那页根本没进集合。
 *   ⚠️ 一开始我把它写成"form 零覆盖"——**那是只看 47 个受管页得出的结论**，
 *      文档面页（`/guide/*`）根本没进那次测量。判据 ⑥（覆盖）与 ⑦（强度）
 *      分开写，就是为了不再把这两件事混成一句。
 *
 *   ⇒ 判据不是"页数够多"，是"每个结构类型都有代表，且代表落在**度量最大**那一档"。
 *     类型不靠人写，靠 `probeTypes()` 在真实 DOM 上算（见 ⑥⑦⑧）。
 */
const DOC_PAGES = [
  ['root-index', '/index.html'],
  ['guide-index', '/guide/index.html'],
  ['guide-button', '/guide/button.html'],
];
const KEEP_PAGES = [
  ['recipe-report', '/04-recipes/report/demo.html'],
  ['recipe-analysis-report', '/04-recipes/analysis-report/demo.html'],
  ['example-finance-report', '/examples/finance-report/index.html'],
];
const TYPE_REPS = [
  ['type-wide-table', '/04-recipes/table/demo.html'],       // wide 370px / 9 张表
  ['type-form', '/02-primitives/choice/demo.html'],          // form 13 个控件
  ['type-grid-media', '/02-primitives/upload/demo.html'],    // grid 4 列 / media 28 个 svg
];
/* ⚠️ `code`（代码块）没有单独的代表页：`/guide/button.html` 本身就是全集里代码最多的一页
   （preChars 339）。再加一页只是多 2 个 PDF，不多抓一个类型 —— 基线数量不是覆盖率。 */
const PAGES = DOC_PAGES.concat(KEEP_PAGES, TYPE_REPS);

/* 结构类型：**触发条件写在判据里，不写在文档里** —— 文档会漂，DOM 不会。
   metric 决定"谁算最大实例"；`within` 是跨平台渲染差异的容差（见 ⑦）。 */
const TYPES = {
  wide: { metric: 'maxOverflow', what: '横向溢出风险', within: 0.9 },
  tall: { metric: 'docH', what: '分页必然发生', within: 0.9 },
  grid: { metric: 'maxCols', what: '多栏栅格', within: 1 },
  overlay: { metric: 'fixedCount', what: '叠层（position:fixed）', within: 1 },
  media: { metric: 'mediaCount', what: '矢量/位图', within: 0.9 },
  form: { metric: 'controls', what: '表单控件', within: 0.9 },
  table: { metric: 'tables', what: '表格', within: 0.9 },
  code: { metric: 'preChars', what: '代码块', within: 0.9 },
};

const MIN_CONTRAST = 4.5;

/* ============================================================================
 * 结构类型：在真实 DOM 上算，不在文档里写
 * ============================================================================
 * 🔴 页面全集**不在这里再抄一份**
 *   受管页面的权威清单是 `shot-baseline.py` 的 `PAGES`（视觉门禁靠它录基线）。
 *   这里再写一份 ⇒ 两份清单必然漂移 ⇒ 打印测的页面和视觉录的页面不是同一批，
 *   而没人会发现（同一个决定写两遍迟早打架，见 E31）。
 *   所以跑 `shot-baseline.py --list`，**解析不到就报错**，不许当成"没有页面"。
 *
 * 🔴 探针视口是 393×852，不是 A4
 *   类型（有没有表格、会不会横向溢出、几栏）讲的是**内容形态**，
 *   和纸面尺寸无关；用截图那套视口算，才能和视觉基线对上。
 *
 * 🔴 强度判据带 10% 容差（`within`）
 *   平台差异会改 `docH` 和少量换行。要求"必须与最大值逐 px 相等"会在
 *   换一台机器时误报；要求"≥ 最大值的 90%"才是"代表确实落在最大那一档"。
 */
const PROBE = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const de = document.documentElement;
  let maxOverflow = 0, overflowCount = 0, beyond = 0, fixedCount = 0, maxCols = 1;
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const ov = el.scrollWidth - el.clientWidth;
    if (ov > 2) { overflowCount += 1; maxOverflow = Math.max(maxOverflow, ov); }
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > vw + 1) beyond += 1;
    if (cs.position === 'fixed') fixedCount += 1;
    if (cs.display === 'grid') {
      const n = cs.gridTemplateColumns.split(' ').filter(Boolean).length;
      if (n > maxCols) maxCols = n;
    }
  }
  const pre = Array.from(document.querySelectorAll('pre'));
  return {
    vw, vh, docW: de.scrollWidth, docH: de.scrollHeight,
    maxOverflow, overflowCount, beyond, fixedCount, maxCols,
    tables: document.querySelectorAll('table').length,
    pres: pre.length,
    preChars: pre.reduce((n, el) => n + (el.innerText || '').length, 0),
    canvas: document.querySelectorAll('canvas').length,
    svg: document.querySelectorAll('svg').length,
    img: document.querySelectorAll('img').length,
    mediaCount: document.querySelectorAll('canvas,svg,img').length,
    controls: document.querySelectorAll('input,select,textarea').length,
  };
};

function typesOf(m) {
  const t = [];
  if (m.maxOverflow > 2 || m.beyond > 0 || m.docW > m.vw + 2) t.push('wide');
  if (m.docH > 2 * m.vh) t.push('tall');
  if (m.maxCols >= 2) t.push('grid');
  if (m.fixedCount > 0) t.push('overlay');
  if (m.mediaCount > 0) t.push('media');
  if (m.controls > 0) t.push('form');
  if (m.tables > 0) t.push('table');
  if (m.preChars > 0) t.push('code');
  return t;
}

function pyExe() {
  if (process.env.PY) return process.env.PY;
  return process.platform === 'win32' ? 'python' : 'python3';
}

/** 可预期的失败：只打一行原因，不甩栈（栈会淹没原因，见 check-all 的失败输出规范） */
function friendly(msg) {
  const e = new Error(msg);
  e.friendly = true;
  return e;
}

/** 受管页面全集：**唯一来源**是 shot-baseline.py */
function pagesFromShotBaseline() {
  const r = spawnSync(pyExe(), [path.join(__dirname, 'shot-baseline.py'), '--list'],
    { encoding: 'utf8', timeout: 60000 });
  if (r.error) throw friendly('取页面全集失败：' + r.error.message
    + '（用 PY 指定解释器；没有 python 就取不到页面全集）');
  if (r.status !== 0) {
    throw friendly('取页面全集失败：shot-baseline.py --list 退出码 ' + r.status
      + '：' + String(r.stderr || '').trim().slice(0, 200));
  }
  const out = [];
  for (const line of String(r.stdout || '').split('\n')) {
    const m = line.match(/^\s*(OK|缺)\s+(\S+)\s*$/);
    if (m && m[1] === 'OK') out.push('/' + m[2]);
  }
  if (out.length < 40) {
    throw friendly('页面全集只解析到 ' + out.length + ' 个（<40）⇒ 解析规则与'
      + ' `shot-baseline.py --list` 的输出格式不一致。**不许当成"没有页面"**，'
      + '那会让覆盖判据永远绿。');
  }
  return out;
}

async function probeTypes(universe) {
  return withPage({ width: 393, height: 852, deviceScaleFactor: 1 }, async (p) => {
    const rows = [];
    for (const url of universe) {
      await p.goto(BASE + url, { waitUntil: 'load', timeout: 45000 });
      await p.evaluate(() => (document.fonts ? document.fonts.ready.then(() => 1) : 1));
      const m = await p.evaluate(PROBE);
      rows.push({ url: url, m: m, types: typesOf(m) });
    }
    return rows;
  });
}

/** 一个类型的统计：全集里有几页、度量最大的是谁、采样集里最大的是谁。
 *  ⚠️ typeErrs 与 typeTable 共用它 —— 否则"表里显示的最大值"和"判据用的最大值"
 *  会各算一遍，两处迟早不一致（同 E31）。 */
function typeStat(cfg, universe, pages) {
  const byUrl = {};
  for (const r of universe) byUrl[r.url] = r;
  const members = universe.filter((r) => r.types.indexOf(cfg.type) >= 0);
  let max = -1, argmax = '';
  for (const r of members) {
    const v = r.m[cfg.metric] || 0;
    if (v > max) { max = v; argmax = r.url; }
  }
  const chosen = (pages || []).filter((pr) => byUrl[pr[1]] && byUrl[pr[1]].types.indexOf(cfg.type) >= 0);
  let best = -1, bestName = '';
  for (const pr of chosen) {
    const v = byUrl[pr[1]].m[cfg.metric] || 0;
    if (v > best) { best = v; bestName = pr[0]; }
  }
  return { members: members, max: max, argmax: argmax, chosen: chosen, best: best, bestName: bestName };
}

/**
 * ⑥ 每个类型至少 1 页在集合里  ⑦ 代表必须落在"度量最大那一档"  ⑧ 页面必须在全集里
 * 纯函数：喂合成样本就能验判据有没有牙（见 selftest）。
 */
function typeErrs(pages, universe, types) {
  const errs = [];
  const byUrl = {};
  for (const r of universe) byUrl[r.url] = r;

  for (const pair of pages) {
    if (!byUrl[pair[1]]) {
      errs.push('⑧ ' + pair[0] + '（' + pair[1] + '）不在受管页面全集里'
        + ' ⇒ 页面名写错了，或者页面被删了（后者要先补视觉基线）');
    }
  }

  for (const t of Object.keys(types)) {
    const cfg = Object.assign({ type: t }, types[t]);
    const st = typeStat(cfg, universe, pages);
    if (!st.members.length) {
      errs.push('⑥ 类型 ' + t + '（' + cfg.what + '）：全集里 0 页命中'
        + ' ⇒ 触发条件写错了（判据自己也可能是坏的）');
      continue;
    }
    if (st.max <= 0) {
      // 🔴 类型命中、度量却恒为 0 ⇒ 触发条件与度不是一回事（判据自己写错了）。
      //    不报错的话 ⑦ 会安静通过：`best < 0 * 0.9` 永远是 false。
      errs.push('⑨ 类型 ' + t + '（' + cfg.what + '）：' + st.members.length
        + ' 页命中，但度量 `' + cfg.metric + '` 最大值为 0'
        + ' ⇒ 触发条件与度量不一致，⑦ 会恒真。改触发条件或换度量。');
      continue;
    }
    if (!st.chosen.length) {
      errs.push('⑥ 类型 ' + t + '（' + cfg.what + '）：集合里 0 页'
        + ' —— 全集里有 ' + st.members.length + ' 页属于这一类，一页都没测');
      continue;
    }
    if (st.max > 0 && st.best < st.max * cfg.within) {
      errs.push('⑦ 类型 ' + t + '（' + cfg.what + '）：代表里最大的是 ' + st.bestName
        + '（' + st.best + '），而全集最大是 ' + st.argmax + '（' + st.max + '）'
        + ' ⇒ 集合里这一类的代表不够强');
    }
  }
  return errs;
}

function typeTable(universe, pages, types) {
  const lines = [];
  for (const t of Object.keys(types)) {
    const cfg = Object.assign({ type: t }, types[t]);
    const st = typeStat(cfg, universe, pages);
    lines.push('  ' + t.padEnd(9) + String(st.members.length).padStart(3) + ' 页   '
      + (st.argmax || '-').padEnd(44) + ' 集合内最大=' + st.best
      + (st.chosen.length ? '' : '（无代表）'));
  }
  return lines;
}

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

  /* 先算结构类型：页面集选错了，后面 18 个 PDF（9 页 × 2 配色）白测。
     全集 = 视觉受管页 ∪ 文档面页 —— 后者不在 shot-baseline 里（它只收组件/配方页），
     但它们确实是要被打印的交付面，⑧ 必须认它们。 */
  const docUrls = DOC_PAGES.map((p) => p[1]);
  const universe = await probeTypes(pagesFromShotBaseline().concat(docUrls));
  const tErrs = typeErrs(PAGES, universe, TYPES);
  console.log('  === 结构类型（受管页面全集 ' + universe.length + ' 页，探针视口 393×852）===');
  for (const line of typeTable(universe, PAGES, TYPES)) console.log(line);

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

  const errs = tErrs.concat(judge(result, update ? null : baseline));
  if (update) {
    const out = {
      note: 'print-gate 基线：页数 / 文字 run 数 / 颜色直方图 + 采样页与结构类型快照。'
        + '只由 --update 写入；判据不从这份快照读（它只是给人看的记录）。',
      minContrast: MIN_CONTRAST,
      sampled: PAGES.map((p) => p[1]),
      types: {},
      pages: {},
    };
    for (const t of Object.keys(TYPES)) {
      const members = universe.filter((r) => r.types.indexOf(t) >= 0);
      out.types[t] = {
        what: TYPES[t].what, metric: TYPES[t].metric, members: members.length,
        pages: members.map((r) => r.url),
      };
    }
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
    console.log('  [FAIL] 打印判据未通过：');
    errs.slice(0, 14).forEach((e) => console.log('        ' + e));
    return 1;
  }
  console.log('  OK  ' + PAGES.length + ' 个页面 × 2 种屏幕配色：'
    + '每段文字 ≥ ' + MIN_CONTRAST + ':1，暗色与浅色产物一致，'
    + '且 ' + Object.keys(TYPES).length + ' 个结构类型各有代表（代表落在度量最大那一档）');
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

    /* ---------------------------------------------------------------
     * 类型覆盖与强度（⑦–⑫）：纯函数，喂合成样本
     * ------------------------------------------------------------- */
    const U = [
      { url: '/weak.html', types: ['wide'],
        m: { maxOverflow: 100, controls: 0 } },
      { url: '/worst.html', types: ['wide', 'form', 'table'],
        m: { maxOverflow: 370, controls: 13 } },
      { url: '/mid.html', types: ['form'],
        m: { maxOverflow: 0, controls: 2 } },
    ];
    const T = {
      wide: { metric: 'maxOverflow', what: '横向溢出风险', within: 0.9 },
      form: { metric: 'controls', what: '表单控件', within: 0.9 },
    };
    const full = [['weak', '/weak.html'], ['worst', '/worst.html']];

    report(typeErrs(full, U, T).length === 0, '⑦ 全集全覆盖 ⇒ 类型判据全绿',
      'errs=' + typeErrs(full, U, T).length);

    /* ⑥：一页 form 都不放 ⇒ 点名"集合里 0 页"，并说清全集里有几页 */
    const noFormAtAll = [['weak', '/weak.html']];
    const e1b = typeErrs(noFormAtAll, U, T).join(' | ');
    report(/类型 form.*集合里 0 页/.test(e1b), '⑥ 集合里 0 页 form ⇒ 点名"0 页"');

    /* ⑦：wide 只放弱的那页 ⇒ 点名强度不够，并指出最大的是谁 */
    const weakWide = [['weak', '/weak.html'], ['mid', '/mid.html']];
    const e2 = typeErrs(weakWide, U, T).join(' | ');
    report(/类型 wide.*不够强/.test(e2) && /worst\.html/.test(e2),
      '⑦ 代表不在度量最大那一档 ⇒ 判红并指出最大页');

    /* ⑧：页面不在全集里 ⇒ 判红（防手写页面名/死链） */
    const ghost = full.concat([['ghost', '/no-such-page.html']]);
    const e3 = typeErrs(ghost, U, T).join(' | ');
    report(/⑧ ghost.*不在受管页面全集里/.test(e3), '⑧ 手写了一个不存在的页面 ⇒ 判红');

    /* ⑨：类型在全集里一页都没有 ⇒ 说明触发条件写错了，不许静默通过 */
    const fakeType = Object.assign({}, T, {
      overlay: { metric: 'controls', what: '叠层', within: 1 },
    });
    const e4 = typeErrs(full, U, fakeType).join(' | ');
    report(/类型 overlay.*0 页命中/.test(e4), '⑨ 类型在全集里 0 页 ⇒ 报"触发条件写错"');

    /* ⑨-b：类型命中、度量恒为 0 ⇒ 必须报"触发条件与度量不一致"，
       否则 ⑦ 的 `best < max * within` 恒为 false（判据安静地永远通过） */
    const zeroMetric = Object.assign({}, T, {
      ghostly: { metric: 'nope', what: '不存在的度量', within: 0.9 },
    });
    const U2 = [{ url: '/x.html', types: ['ghostly'], m: { maxOverflow: 5, controls: 1 } }];
    const e5 = typeErrs([['x', '/x.html']], U2, zeroMetric).join(' | ');
    report(/类型 ghostly.*最大值为 0/.test(e5), '⑨ 度量恒为 0 ⇒ 报"与触发条件不一致"');

    /* ⑩ 元反向：把类型表清空，同一组"坏样本"必须不再报错
          —— 证明上面那些红确实来自类型判据，而不是别的分支 */
    report(typeErrs(noFormAtAll, U, {}).length === 0, '元反向：类型表清空后同一坏样本不再红');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }

  console.log(bad ? '  ❌ 反向控制有 ' + bad + ' 条没通过' : '  ✅ 反向控制全绿');
  return bad ? 1 : 0;
}

main().then((rc) => process.exit(rc || 0)).catch((e) => {
  console.error('  🔴 ' + ((e && e.friendly && e.message) || (e && e.stack) || e));
  process.exit(2);
});
