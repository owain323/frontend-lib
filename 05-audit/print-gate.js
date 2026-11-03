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
 *   ⑪ 字体**引用链**必须闭合（G2-07）：
 *      Font →(/DescendantFonts)→ CIDFont → /FontDescriptor → /FontFile{,2,3}，
 *      目标对象必须存在、是流、长度非 0，并有 /ToUnicode 或 /Encoding+宽度表。
 *      ⚠️ **不再**用"`/BaseFont` 有没有六位子集前缀"当嵌入证据 ——
 *      前缀只说明名字按子集命名，不说明文件里带了字形（两者会独立出错，见自检）。
 *      Type3（字形在 /CharProcs）与标准 14 字体允许不嵌入。
 *   ⑫ 每一页都必须有文本算子（G2-08）。
 *      ⚠️ 这是「页面文本操作存在性检查」，**不是**「空白页证明」：
 *      白字压白纸、被裁切、不可见渲染模式、被遮挡的内容都有文本算子。
 *      真正判空白要栅格化后比纸色，不在本解析器范围。
 *   ⑬ 页数不得超过**写在源码里**的预算。
 *      ③ 是"和上次比有没有变"，⑬ 是"和该有的页数比"。两者缺一不可：
 *      CSS 改动让 7 页变 13 页，跑一次 `--update` 之后 ③ 就绿了 ——
 *      而 ⑬ 不会，因为预算**不经 `--update` 重录**。
 *      预算数字的来源写在 PAGES 的注释里（基线页数 × 1.4），不是拍脑袋。
 *
 * ⚠️ 这些判据**不覆盖**（写在这里是为了不让它被当成"打印全过"）：
 *   · 字体回退：字体缺失时 Chromium 仍会嵌一个回退字体，产物照样"有字"；
 *   · 裁切：**明确没实现**（G2-03 实测过的死路）。
 *     Chrome 把内容画在一个 2250×3275 的矩形里，再用 `re W n` 裁到纸面 ——
 *     路径坐标越出纸边是常态（实测最右 2091pt vs 纸宽 596pt），bbox 判不出
 *     "看得见的部分有没有被切"。要判它得算字形宽度（字体度量表），解析器里没有。
 *     现在能兜裁切的只有「run 数与基线不一致」这一条间接判据。
 *   · 页眉页脚 / 页码 / 章节分页：本库没有这些，也没有判据；
 *   · 空白页：⑫ 只证明"这一页没有文字对象"，不证明"纸上是空的"；
 *     ③④ 用"页数 + run 数"间接兜，也不是直接检测。
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
/* 页数解析与导出器（ai/pdf.js）共用一份实现：两处各写一次，
   两个数会在某次改动后不一致，而两边都"通过"（E31）。 */
const pdfPages = require('../ai/pdf-pages.js');

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
  ['root-index', '/index.html', 7],
  ['guide-index', '/guide/index.html', 9],
  ['guide-button', '/guide/button.html', 12],
];
const KEEP_PAGES = [
  ['recipe-report', '/04-recipes/report/demo.html', 7],
  ['recipe-analysis-report', '/04-recipes/analysis-report/demo.html', 6],
  ['example-finance-report', '/examples/finance-report/index.html', 10],
];
const TYPE_REPS = [
  ['type-wide-table', '/04-recipes/table/demo.html', 7],       // wide 370px / 9 张表
  ['type-form', '/02-primitives/choice/demo.html', 5],          // form 13 个控件
  ['type-grid-media', '/02-primitives/upload/demo.html', 6],    // grid 4 列 / media 28 个 svg
];
/* 第三个数字 = 页数预算（⑬）。**只在这里改，不从基线文件读** ——
   基线是 `--update` 写的，预算要是也写进基线，"翻倍之后重录一次"就把证据洗掉了。
   数字来源：0.24.2 的基线页数 × 1.4 向上取整（5→7 / 6→9 / 8→12 / 4→6 / 3→5 / 7→10）。
   1.4 这个系数是照着"分页通胀断崖"定的：实测块高 520px 时页数 +92%，
   1.4 倍一定抓得住它；而正常的段落增删离 1.4 倍还远。 */
/* ⚠️ `code`（代码块）没有单独的代表页：`/guide/button.html` 本身就是全集里代码最多的一页
   （preChars 339）。再加一页只是多 2 个 PDF，不多抓一个类型 —— 基线数量不是覆盖率。 */
const PAGES = DOC_PAGES.concat(KEEP_PAGES, TYPE_REPS);

/** 页数预算表（⑬）。由 PAGES 派生，不单独维护 —— 两处写必然漂移（E31）。 */
const PAGE_BUDGET = PAGES.reduce((m, p) => { m[p[0]] = p[2]; return m; }, {});

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
      await loadStyled(p, BASE + url);
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
/* 一整套内容流算子。顺序即分组顺序，改的时候别动次序 —— 下面按组号取值。
   q/Q 0 · cm 1-6 · re 7-10 · c 11-16 · m|l 17-18 · rg 19-21 · g 22 · Tj|TJ 最后 */
const RE_OPS = new RegExp(
  '\\bq\\b|\\bQ\\b'
  + '|(' + NUM + ')\\s+(' + NUM + ')\\s+(' + NUM + ')\\s+(' + NUM + ')\\s+(' + NUM + ')\\s+(' + NUM + ')\\s+cm\\b'
  + '|(' + NUM + ')\\s+(' + NUM + ')\\s+(' + NUM + ')\\s+(' + NUM + ')\\s+re\\b'
  + '|(' + NUM + ')\\s+(' + NUM + ')\\s+(' + NUM + ')\\s+(' + NUM + ')\\s+(' + NUM + ')\\s+(' + NUM + ')\\s+c\\b'
  + '|(' + NUM + ')\\s+(' + NUM + ')\\s+[ml]\\b'
  + '|(' + NUM + ')\\s+(' + NUM + ')\\s+(' + NUM + ')\\s+rg\\b'
  + '|(' + NUM + ')\\s+g\\b'
  + '|\\bTj\\b|\\bTJ\\b', 'g');

/** 页面内坐标容差（pt）。1pt ≈ 0.35mm：描边压线不算越界。 */
const PAGE_TOL_PT = 1;

/**
 * 扫一段内容流：文字颜色直方图 + 图形包围盒 + 绘制指令数。
 * 纯函数（只吃字符串），所以 `--selftest` 能喂合成算子验它有没有牙。
 *
 * ⚠️ 能测什么、不能测什么（写清楚，免得被当成"完整的 PDF 检查"）：
 *   · 能测：路径/矩形的**坐标**是否越过 MediaBox（精确，坐标就在流里）
 *   · 不能测：文字的**右边界** —— 那要字体宽度表（字宽 × 字号），解析器里没有
 *     ⇒ 文字被切只能靠「文字起点越界」与「run 数与基线不一致」间接兜。
 */
function scanOps(txt, box) {
  const hist = {};
  let runs = 0;
  let drawOps = 0;
  let maxX = -Infinity;
  let minX = Infinity;
  let maxY = -Infinity;
  let minY = Infinity;
  let cur = [0, 0, 0];
  const cstack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const mstack = [];

  const mul = (a, b) => [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
  ];
  const hit = (x, y) => {
    const X = ctm[0] * x + ctm[2] * y + ctm[4];
    const Y = ctm[1] * x + ctm[3] * y + ctm[5];
    if (X > maxX) maxX = X;
    if (X < minX) minX = X;
    if (Y > maxY) maxY = Y;
    if (Y < minY) minY = Y;
  };

  RE_OPS.lastIndex = 0;
  let m;
  while ((m = RE_OPS.exec(txt)) !== null) {
    const tok = m[0];
    if (tok === 'q') { cstack.push(cur.slice()); mstack.push(ctm.slice()); continue; }
    if (tok === 'Q') {
      if (cstack.length) cur = cstack.pop();
      if (mstack.length) ctm = mstack.pop();
      continue;
    }
    if (tok === 'Tj' || tok === 'TJ') {
      const key = hex(cur);
      hist[key] = (hist[key] || 0) + 1;
      runs += 1;
      continue;
    }
    if (m[1] !== undefined) {                      // cm
      ctm = mul([+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]], ctm);
      continue;
    }
    if (m[7] !== undefined) {                      // re
      const x = +m[7]; const y = +m[8]; const w = +m[9]; const h = +m[10];
      hit(x, y); hit(x + w, y); hit(x, y + h); hit(x + w, y + h);
      drawOps += 1;
      continue;
    }
    if (m[11] !== undefined) {                     // c（三次贝塞尔：三个点都在控制盒内）
      hit(+m[11], +m[12]); hit(+m[13], +m[14]); hit(+m[15], +m[16]);
      drawOps += 1;
      continue;
    }
    if (m[17] !== undefined) {                     // m / l
      hit(+m[17], +m[18]);
      drawOps += 1;
      continue;
    }
    if (m[19] !== undefined) {                     // rg
      cur = [+m[19] * 255, +m[20] * 255, +m[21] * 255];
      continue;
    }
    if (m[22] !== undefined) {                     // g
      const v = +m[22] * 255;
      cur = [v, v, v];
      continue;
    }
  }
  const overX = Math.max(maxX - box[2], box[0] - minX, 0);
  const overY = Math.max(maxY - box[3], box[1] - minY, 0);
  return { runs, hist, drawOps, overX, overY, maxX, minX };
}

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
/** 页数：`/Type /Page`（排除 `/Pages`）。 */
function countPages(raw) {
  /* 判据用的是「/Type /Page 对象数」——历史基线就是按它录的。
     页树 `/Count` 只用来做交叉核对，不参与判定（两者不一致时报到 ⑬ 的说明里）。 */
  return pdfPages.countPageObjects(raw.toString('latin1'));
}

/* ------------------------------------------------------------ 字体嵌入（G2-07） */

/**
 * 顶层间接对象表：`obj 号 → 字典正文`。
 *
 * ⚠️ 只索引**顶层** `N 0 obj`。Chromium 产物实测 679 个对象、**0 个** `/Type /ObjStm`
 *    （对象流是别的生成器常用的压缩手段）。一旦出现对象流，本解析器会**少看到对象**，
 *    表现为"引用指向不存在的对象" —— 那是宁可误报不可漏报的方向。
 * ⚠️ `endobj` 用 `indexOf` 找，若某个流的二进制里恰好含这 6 个字节，会截断后面
 *    的对象。同样只会导致误报，不会导致假绿。
 */
function pdfObjects(raw) {
  const objs = new Map();
  const re = /(?:^|[\r\n\s])(\d+)\s+0\s+obj\b/g;
  let m;
  let guard = 0;
  while ((m = re.exec(raw)) !== null) {
    if (++guard > 20000) break;          // 防御：畸形文件不许把门禁挂死
    const start = m.index + m[0].length;
    let end = raw.indexOf('endobj', start);
    if (end < 0) end = raw.length;
    objs.set(+m[1], raw.slice(start, end));
    re.lastIndex = end;                  // 跳过 stream 数据，不在二进制里空转
  }
  return objs;
}

/** 从字典正文里取一个 `/Key N 0 R` 引用；没有就返回 null。 */
function refOf(body, key) {
  const m = new RegExp('/' + key + '\\s+(\\d+)\\s+0\\s+R').exec(body || '');
  return m ? +m[1] : null;
}

/** 从字典正文里取一个 `/Key [N 0 R M 0 R …]` 数组引用。 */
function refsOf(body, key) {
  const m = new RegExp('/' + key + '\\s*\\[([^\\]]*)\\]').exec(body || '');
  if (!m) return [];
  return [...m[1].matchAll(/(\d+)\s+0\s+R/g)].map((x) => +x[1]);
}

/** PDF 的 14 个标准字体：允许不嵌入（阅读器自带替代字形）。 */
const STD14 = /^(Helvetica|Times|Courier|Symbol|ZapfDingbats)(-|$)/;

/**
 * 字体是否**真的**带上了字体程序（G2-07）。
 *
 * 🔴 为什么不能看 `/BaseFont` 有没有六位子集前缀
 *   前缀只说明"这个字体名是按子集命名的"，**不**说明文件里带了字形。两者会独立出错：
 *     · 名字带前缀、FontDescriptor 却没有 FontFile  → 旧判据绿，实际没有字形；
 *     · 名字不带前缀、字体却以完整形式嵌入          → 旧判据红，实际有字形。
 *   决定"换台机器会不会换字"的是这条引用链：
 *     Font ─┬─ /FontDescriptor ─┬─ /FontFile2  (TrueType)
 *           │                    ├─ /FontFile3  (CFF / OpenType)
 *           │                    └─ /FontFile   (Type1)
 *           └─ /DescendantFonts → CIDFont → 同上（Type0 复合字体）
 *
 * ⚠️ 本判据**不校验**：字形内容（TrueType/CFF 表结构）、CMap 的码位正确性。
 *    它验的是"引用链闭合、流非空、有字符映射的声明"，不是"字形画得对"。
 */
function fontChain(raw) {
  const objs = pdfObjects(raw);
  const problems = [];
  const programs = new Set();
  let type3 = 0;
  let std14 = 0;

  /* 🔴 先按 BaseFont **分组**，再按组判定。
     实测踩到：Chromium 把 CIDFont 子对象写在页面附近（obj 476），把 Type0 父对象
     写在文件前部（obj 4）—— 物理顺序与逻辑顺序相反。原来"先遇到谁就按谁判"，
     于是先判了 CIDFont（它没有 /ToUnicode，映射在父上）⇒ 每个字体都报
     "没有字符映射"，11 个页面 × 2 配色全红。
     一个字体的父与子是**共同**描述它的，必须合并看。 */
  const groups = new Map();
  for (const [num, body] of objs) {
    if (!/\/Type\s*\/Font\b/.test(body)) continue;
    const base = (/\/BaseFont\s*\/([A-Za-z0-9+#,_-]+)/.exec(body) || [])[1] || null;
    const key = base || ('#' + num);
    if (!groups.has(key)) {
      groups.set(key, { label: base || ('obj' + num), subs: [], bodies: [] });
    }
    const g = groups.get(key);
    g.subs.push((/\/Subtype\s*\/([A-Za-z0-9]+)/.exec(body) || [])[1] || '');
    g.bodies.push(body);
  }

  for (const [, g] of groups) {
    const merged = g.bodies.join('\n');
    const label = g.label;

    /* Type3：字形是 PDF 里的绘制过程（/CharProcs），本来就在文件里，不需要 FontFile。 */
    if (g.subs.indexOf('Type3') >= 0) {
      type3 += 1;
      if (!/\/CharProcs\s*(\d+\s+0\s+R|<<\/)/.test(merged)) {
        problems.push(label + ' 是 Type3 但没有 /CharProcs（没有字形定义）');
      }
      continue;
    }

    /* FontDescriptor：父或子任一带了就算（Type0 自身不带，子带）。 */
    let descNum = null;
    for (const b of g.bodies) {
      const d = refOf(b, 'FontDescriptor');
      if (d !== null) { descNum = d; break; }
    }
    const isStd = STD14.test(label.replace(/^[A-Z]{6}\+/, ''));
    if (isStd) std14 += 1;

    if (descNum === null) {
      if (isStd) continue;
      problems.push(label + '（' + (g.subs.join('/') || '无 Subtype') + '）没有 /FontDescriptor'
        + ' ⇒ 字形没有进文件');
      continue;
    }
    const desc = objs.get(descNum);
    if (desc === undefined) {
      problems.push(label + ' 的 /FontDescriptor ' + descNum + ' 0 R 指向不存在的对象');
      continue;
    }

    let ffKey = null;
    let ffNum = null;
    for (const k of ['FontFile2', 'FontFile3', 'FontFile']) {
      const n = refOf(desc, k);
      if (n !== null) { ffKey = k; ffNum = n; break; }
    }
    if (ffNum === null) {
      if (isStd) continue;
      problems.push(label + ' 的 FontDescriptor ' + descNum
        + ' 没有 /FontFile /FontFile2 /FontFile3 ⇒ 只声明了字体名，没有字形');
      continue;
    }
    const ff = objs.get(ffNum);
    if (ff === undefined) {
      problems.push(label + ' 的 /' + ffKey + ' ' + ffNum + ' 0 R 指向不存在的对象');
      continue;
    }
    if (!/\bstream\b/.test(ff)) {
      problems.push(label + ' 的 /' + ffKey + ' ' + ffNum + ' 0 R 不是流对象');
      continue;
    }
    const len = (/\/Length\s+(\d+)/.exec(ff) || [])[1];
    if (!len || +len === 0) {
      problems.push(label + ' 的 /' + ffKey + ' 流长度为空');
      continue;
    }
    programs.add(ffNum);

    /* 字符映射：组内任一对象有 /ToUnicode，或有 /Encoding + 宽度表。只验声明存在。 */
    const hasToUni = g.bodies.some((b) => refOf(b, 'ToUnicode') !== null);
    const hasEnc = /\/Encoding\s*(\/|[<]|\d+\s+0\s+R)/.test(merged);
    const hasWidths = /\/Widths\s*\[/.test(merged) || /\/W\s*\[/.test(merged);
    if (!hasToUni && !(hasEnc && hasWidths)) {
      problems.push(label + ' 没有字符映射（既无 /ToUnicode，也无 /Encoding + 宽度表）');
    }
  }

  return {
    fonts: groups.size,
    names: [...groups.keys()],
    programs: programs.size,
    type3, std14, problems,
  };
}

/** 读 PDF：页数 + 文字颜色直方图 + 字体引用链 + 无文本算子的页 */
function analyze(buf) {
  const raw = Buffer.from(buf).toString('latin1');
  const pages = countPages(raw);
  const chain = fontChain(raw);

  const hist = {};
  let runs = 0;
  let textStreams = 0;
  let textStreamsLoose = 0;
  for (const st of streams(buf)) {
    const txt = st.toString('latin1');
    /* 🔴 只认带 `BT` 的流当"这一页有文字"。
       试过用"有绘制指令的流数"判空白页 —— 132 个流里只有 8 个真带文字，
       其余是字体 / ICC 等二进制，inflate 出来的字节会**偶然匹配** `m`/`l` 这类算子
       ⇒ 计数虚高 ⇒ 空白页判据恒不触发（又一个"安静地永远通过"）。
       只认 `BT`：少报（可能漏一张全图页），但不会把有字的页判成空的。

       🔴 但**只认 BT 还不够**：字体 / cmap 的二进制里也会偶然出现 `BT` 两个字节。
       实测一份 50 页产物：50 页却有 51 个"含 BT 的流"。
       而 ⑫ 算的是 `无字页 = 页数 − 文本流数` —— 一个**差**。
       多计一个流，正好抵掉一张真没字的纸 ⇒ 空白页被判成"没有空白页"。
       所以要求同一流里还有 `Tf`（选字体）与 `Tj`/`TJ`（真的在写字）：
       三个算子同时偶然出现，概率低到可以忽略；实测 10 个夹具逐个精确。 */
    if (txt.indexOf('BT') < 0) continue;
    textStreamsLoose += 1;
    if (!/\bTf\b/.test(txt) || !/(Tj|TJ)/.test(txt)) continue;
    textStreams += 1;
    const r = scanOps(txt, [0, 0, 0, 0]);
    runs += r.runs;
    for (const k of Object.keys(r.hist)) hist[k] = (hist[k] || 0) + r.hist[k];
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
  return {
    pages, runs, hist, worst: runs ? worst : Infinity, worstColor, below,
    /* G2-07：字体**引用链**（不再是"名字有没有前缀"）。
       G2-08：`pagesWithoutText` 只说明"这一页没有文本算子"，
       不等于"页面空白" —— 白字压白纸、被裁掉、不可见渲染模式都算"有算子"。
       真正的空白页要靠"渲染后像素与纸同色"来判，那需要栅格化，不在本解析器范围。 */
    fonts: chain.fonts,
    fontNames: chain.names,
    programs: chain.programs,
    type3: chain.type3,
    std14: chain.std14,
    fontProblems: chain.problems,
    textStreams,
    textStreamsLoose,
    pagesWithoutText: Math.max(0, pages - textStreams),
  };
}

/* ---------------------------------------------------------------- 渲染 */

/**
 * 打开页面并确认**样式表真的到了**。
 *
 * 🔴 为什么不能只 `goto(waitUntil:'load')`：
 *    `load` 事件只说明"该发的请求发完了"，不说明 CSS 拿到了。
 *    实测（并发 6 跑全量）`print` 门禁两次挂在同一页：
 *      guide-button/light：页数 4 ≠ 基线 8、文字 run 数 1528 ≠ 1975
 *      guide-button：暗色与浅色的打印产物文字颜色不同
 *    三条症状同源 —— **其中一个配色渲染成了裸 HTML**：
 *    页数变少（没样式排版更紧凑）、run 数变少（没有 span 包裹）、
 *    深浅两色看起来"不同"（其中一个压根没吃到主题变量）。
 *
 *    单跑必然通过，全量偶发 —— 这正是 `05-audit/http-serve.py` 头里记的那类
 *    "页面样式没落地就被量"。它有两个后果，第二个更糟：
 *      ① 假红（把一个好页面判成回归）
 *      ② **假绿**（裸 HTML 的文字对比度往往"够高"，对抗度判据会一路放行）
 *
 *  ⇒ 判据之前先自证"我量的是这个库的页面"，不是浏览器默认样式下的 HTML。
 *    失败重试一次（服务端的瞬时排队不值得报假红），仍然失败就明确报错。
 */
async function loadStyled(p, url) {
  let why = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    /* 信号一：CSS 请求本身失败（404 / 连接被拒 / file 不存在）。
       🔴 不能用 `document.styleSheets` 判活：加载失败的 <link> **仍然占一个表对象**
          （实测 file:// 下能看到 href，只是 cssRules 抛 SecurityError），
          按"表对象数>0"判会把它当成加载成功 —— 等于判据自己骗自己。 */
    const failedCss = [];
    const onFail = (req) => {
      if (/\.css(\?|#|$)/i.test(req.url())) failedCss.push(req.url());
    };
    p.on('requestfailed', onFail);
    try {
      await p.goto(url, { waitUntil: 'load', timeout: 45000 });
    } finally {
      /* puppeteer 各版本解绑方法名不一致（off / removeListener）。
         两个都没有就留着不管：页面在 withPage 结束时关闭，监听器随之消失。 */
      if (typeof p.off === 'function') p.off('requestfailed', onFail);
      else if (typeof p.removeListener === 'function') p.removeListener('requestfailed', onFail);
    }

    /* 信号二：页面写了 <link rel=stylesheet>，但一张带 href 的表都没挂上。 */
    const st = await p.evaluate(() => ({
      links: document.querySelectorAll('link[rel~="stylesheet"]').length,
      loaded: Array.from(document.styleSheets).filter((s) => s.href).length,
    }));

    /* 信号三（E296）：懒加载 iframe 必须真的加载完。
       guide 的每个页面都把「可运行示例」嵌在 `<iframe loading="lazy">` 里，
       而**打印产物包含它的内容**。并发 6 路时那个 iframe 可能整页没开始加载
       ⇒ 打印版面直接腰斩。实测 guide-button/light：
           基线 8 页 / 2321 runs  →  失败那次 4 页 / 1679 runs
       而信号一二**看不见它**：顶层文档的 <link> 全都挂上了，判据照样"通过自检"，
       然后拿一份少了一半的版面去跟基线比 ⇒ 报成"内容回归"，其实什么都没变。

       ⇒ 先强制 eager 并触发加载，再等每个 frame 的 document 就绪且样式表挂上。
         这不是放宽判据：真内容缺失时页数照样对不上，只是不再把
         "iframe 没起来"算成"库改坏了"。 */
    const fr = await p.evaluate(async () => {
      const list = Array.from(document.querySelectorAll('iframe'));
      const blank = (f) => {
        try {
          return !f.contentWindow || f.contentWindow.location.href === 'about:blank';
        } catch (e) { return false; }
      };
      list.forEach((f) => { if (f.loading === 'lazy') { f.loading = 'eager'; } });
      list.forEach((f) => {
        const src = f.getAttribute('src');
        if (src && blank(f)) { f.setAttribute('src', src); }
      });
      await Promise.all(list.map((f) => new Promise((res) => {
        if (!blank(f)) { return res(true); }
        let done = false;
        const fin = (ok) => { if (!done) { done = true; res(ok); } };
        f.addEventListener('load', () => fin(true), { once: true });
        setTimeout(() => fin(false), 20000);
      })));
      const rows = list.map((f) => {
        try {
          const d = f.contentDocument;
          const n = d ? Array.from(d.styleSheets).filter((s) => s.href).length : 0;
          return { ok: !!(d && d.readyState === 'complete' && d.body), sheets: n };
        } catch (e) { return { ok: false, sheets: 0 }; }
      });
      return {
        count: list.length,
        bad: rows.filter((r) => !r.ok || r.sheets === 0).length,
      };
    });

    const bad = failedCss.length > 0 || (st.links > 0 && st.loaded === 0)
      || fr.bad > 0;
    if (!bad) return st;

    why = failedCss.length
      ? (failedCss.length + ' 个样式表请求失败：' + failedCss.slice(0, 3).join(', '))
      : (st.links > 0 && st.loaded === 0)
        ? (st.links + ' 个 <link> 全部没挂上')
        : (fr.bad + '/' + fr.count + ' 个内嵌 iframe 没加载完或没样式');
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('页面样式没落地（' + why + '）：' + url
    + '\n     ⇒ 静态服务在并发下打了个嗝。判据会对不完整的版面下结论，本页结果作废。');
}

async function render(url, scheme) {
  return withPage({ width: 794, height: 1123, deviceScaleFactor: 1 }, async (p) => {
    await loadStyled(p, url);
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

    /* ⑬ 页数预算。**写在 PAGES 里，不从基线读** —— 否则跑一次 `--update`
       就把"翻倍"重录成了新常态，判据等于自己把证据洗掉。
       只看 light：两套配色判据 ② 已经要求产物一致，页数不一致会在别处红。 */
    const budget = PAGE_BUDGET[name];
    if (budget && r.light.pages > budget) {
      errs.push('⑬ ' + name + '：页数 ' + r.light.pages + ' 超过预算 ' + budget
        + '（预算写在 PAGES 里，--update 不会重录它）');
    }

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

    /* ⑪⑫ 是 PDF **产物侧**的维度，和颜色是独立的两件事。
       浅色/暗色各算一遍 —— 打印产物不该因为屏幕主题而换一种字体或换一种分页。 */
    for (const scheme of ['light', 'dark']) {
      const g = r[scheme];
      const tag = name + '/' + scheme;
      /* ⚠️ ⑩（裁切）**没有实现**，原因写在文件头的判据表里：
         Chrome 把内容画在一个 2250×3275 的矩形里，再用 `re W n` 裁到纸面 ——
         路径坐标越出纸边是**常态**（实测 2091pt vs 纸宽 596pt），bbox 判不出"看得见的部分"
         有没有被切。要判它得算字形宽度，那需要字体度量表。 */
      if (g.fontProblems.length) {
        errs.push('⑪ ' + tag + '：' + g.fontProblems.length
          + ' 处字体引用链不完整：' + g.fontProblems.slice(0, 3).join('；')
          + (g.fontProblems.length > 3 ? ' …（共 ' + g.fontProblems.length + ' 处）' : '')
          + ' ⇒ 打印机会换字体，版式会变');
      }
      if (g.pagesWithoutText > 0) {
        errs.push('⑫ ' + tag + '：' + g.pagesWithoutText + ' 页没有文本算子'
          + '（共 ' + g.pages + ' 页，有文本算子的 ' + g.textStreams + ' 页）'
          + ' —— 注意这只说明"没有文字对象"，不证明"页面空白"');
      }
    }
  }
  return errs;
}

/* ---------------------------------------------------------------- 主流程 */

async function main() {
  const argv = process.argv.slice(2);
  if (argv.indexOf('--selftest') >= 0) return selftest();
  if (argv.indexOf('--adversarial') >= 0) return adversarial();

  /* `--pdf <文件>`：对一份**已生成的** PDF 单独跑判据，不改基线、不影响 PASS/FAIL。
     用途：判断"某个真实产物到底哪里不合格"时，不必重跑 18 个 PDF。 */
  const pi = argv.indexOf('--pdf');
  if (pi >= 0) {
    const f = argv[pi + 1];
    if (!f || !fs.existsSync(f)) {
      console.error('  🔴 找不到文件：' + f);
      return 2;
    }
    const a = analyze(fs.readFileSync(f));
    console.log(JSON.stringify({
      pages: a.pages,
      textStreams: a.textStreams,
      textStreamsLoose: a.textStreamsLoose,
      pagesWithoutText: a.pagesWithoutText,
      runs: a.runs,
      worst: Math.round(a.worst * 100) / 100,
      fonts: a.fonts,
      programs: a.programs,
      type3: a.type3,
      std14: a.std14,
      fontProblems: a.fontProblems,
    }, null, 2));
    return (a.fontProblems.length || a.pagesWithoutText > 0) ? 1 : 0;
  }

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
        + '/' + String(PAGE_BUDGET[name] || '?').padEnd(2)
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
  /* 汇总里必须报"判据实际看了多少字体"：
     否则 ⑪ 在 0 个字体上通过，也会打印成一模一样的 OK（空转的绿）。 */
  const names = new Set();
  const progs = new Set();
  let t3 = 0;
  for (const name of Object.keys(result)) {
    for (const sc of ['light', 'dark']) {
      const a = result[name][sc];
      (a.fontNames || []).forEach((x) => names.add(x));
      progs.add(a.programs);
      t3 = Math.max(t3, a.type3);
    }
  }
  console.log('  OK  ' + PAGES.length + ' 个页面 × 2 种屏幕配色：'
    + '每段文字 ≥ ' + MIN_CONTRAST + ':1，暗色与浅色产物一致，'
    + '页数都在预算内（⑬：基线 × 1.4），'
    + '且 ' + Object.keys(TYPES).length + ' 个结构类型各有代表（代表落在度量最大那一档）');
  console.log('      ⑪ 实际检查 ' + names.size + ' 个字体名（含 Type3 ' + t3
    + ' 个）；单页最多 ' + Math.max(...progs) + ' 个字体程序；⑫ 每页都有文本算子');
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

  /* 引一张不存在的样式表：模拟"静态服务打嗝、CSS 全 404"。
     这份不该被判红也不该被判绿 —— 应该**直接报错**，否则判据是在对裸 HTML 下结论。 */
  'nostyle.html': '<!DOCTYPE html><meta charset="utf-8">'
    + '<link rel="stylesheet" href="./no-such-sheet.css">'
    + '<h1>标题</h1><p>正文一段。</p>',

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

    /* ---------- ⑬ 页数预算：纯函数，喂合成结果 ---------- */
    const synth = (n) => {
      const one = () => ({ pages: n, runs: 1, worst: 9, hist: {}, overflow: 0,
        fontProblems: [], pagesWithoutText: 0 });
      return { 'root-index': { light: one(), dark: one() } };
    };
    const budget = PAGE_BUDGET['root-index'];
    report(judge(synth(budget), null).length === 0,
      '⑬ 页数正好等于预算 ⇒ 判绿（边界在内）', '预算=' + budget);
    const over = judge(synth(budget + 1), null).join(' | ');
    report(/⑬ root-index：页数 \d+ 超过预算/.test(over),
      '⑬ 超预算 1 页 ⇒ 判红并点名', '预算=' + budget);

    /* ---------- ⑪⑫ 的纯函数自检（G2-03）---------- */
    /* ---- ⑪ 字体引用链（G2-07）：正反样本都用手写的 9 个对象 ---- */
    const mkPdf = (objs) => 'x\n' + objs.map((o, i) => (i + 1) + ' 0 obj\n' + o + '\nendobj\n').join('');
    const FONT_OK = mkPdf([
      '<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+SegoeUI /Encoding /Identity-H'
        + ' /DescendantFonts [2 0 R] /ToUnicode 5 0 R >>',
      '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /AAAAAA+SegoeUI /FontDescriptor 3 0 R /W [0 [1]] >>',
      '<< /Type /FontDescriptor /FontName /AAAAAA+SegoeUI /FontFile2 4 0 R >>',
      '<< /Length 1234 /Filter /FlateDecode >>\nstream\nBINARY\nendstream',
      '<< /Length 99 >>\nstream\nCMAP\nendstream',
    ]);
    const fc = fontChain(FONT_OK);
    report(fc.problems.length === 0 && fc.programs === 1,
      '⑪ 完整链 Font→Descendant→Descriptor→FontFile2 ⇒ 绿', 'problems=' + fc.problems.join('|'));

    /* 🔴 关键反例：**名字带六位子集前缀，但描述符没有 FontFile**。
       旧判据（看前缀）在这里给绿 —— 这正是它证明不了的结论。 */
    const PREFIX_NO_FILE = mkPdf([
      '<< /Type /Font /Subtype /TrueType /BaseFont /AAAAAA+SegoeUI /FontDescriptor 2 0 R /Encoding /WinAnsiEncoding /Widths [500] >>',
      '<< /Type /FontDescriptor /FontName /AAAAAA+SegoeUI >>',
    ]);
    const bad = fontChain(PREFIX_NO_FILE);
    report(bad.problems.length === 1 && /没有 \/FontFile/.test(bad.problems[0]),
      '⑪ 有子集前缀但没有 FontFile ⇒ 红（旧判据在这里是绿的）', bad.problems.join('|'));

    /* 元反向：把判据换回"只看前缀"，同一份反例必须**不再红**
       —— 证明上面那条红来自引用链，而不是别处顺手报的。 */
    const prefixOnly = (raw) => {
      const all = (raw.match(/\/BaseFont\s*\/([A-Za-z0-9+#,_-]+)/g) || [])
        .map((x) => x.replace(/^\/BaseFont\s*\//, ''));
      return all.filter((f) => !/^[A-Z]{6}\+/.test(f));
    };
    report(prefixOnly(PREFIX_NO_FILE).length === 0,
      '元反向：换回"只看前缀" ⇒ 同一反例不再红');

    /* 没前缀但有完整字体程序：旧判据在这里给红（误报），新判据给绿。 */
    const FULL_FONT = mkPdf([
      '<< /Type /Font /Subtype /TrueType /BaseFont /Arial /FontDescriptor 2 0 R /Encoding /WinAnsiEncoding /Widths [500] >>',
      '<< /Type /FontDescriptor /FontName /Arial /FontFile2 3 0 R >>',
      '<< /Length 4096 >>\nstream\nTTF\nendstream',
    ]);
    report(fontChain(FULL_FONT).problems.length === 0,
      '⑪ 无子集前缀但带完整 FontFile2 ⇒ 绿（旧判据在这里是红的）');
    report(prefixOnly(FULL_FONT).length === 1,
      '元反向：换回"只看前缀" ⇒ 同一份合规文件被误报');

    report(fontChain(mkPdf([
      '<< /Type /Font /Subtype /TrueType /BaseFont /Arial /FontDescriptor 9 0 R /Encoding /WinAnsiEncoding /Widths [500] >>',
    ])).problems.some((x) => /指向不存在的对象/.test(x)),
      '⑪ FontDescriptor 引用悬空 ⇒ 红');
    report(fontChain(mkPdf([
      '<< /Type /Font /Subtype /TrueType /BaseFont /X /FontDescriptor 2 0 R /Encoding /WinAnsiEncoding /Widths [500] >>',
      '<< /Type /FontDescriptor /FontName /X /FontFile2 9 0 R >>',
    ])).problems.some((x) => /FontFile2 9 0 R 指向不存在的对象/.test(x)),
      '⑪ FontFile 引用悬空 ⇒ 红');
    report(fontChain(mkPdf([
      '<< /Type /Font /Subtype /TrueType /BaseFont /X /FontDescriptor 2 0 R /Encoding /WinAnsiEncoding /Widths [500] >>',
      '<< /Type /FontDescriptor /FontName /X /FontFile2 3 0 R >>',
      '<< /Length 0 >>\nstream\nendstream',
    ])).problems.some((x) => /流长度为空/.test(x)),
      '⑪ FontFile 流长度为 0 ⇒ 红');
    /* Type3 与标准 14 是**合规**的不嵌入，不许误报 */
    report(fontChain(mkPdf([
      '<< /Type /Font /Subtype /Type3 /CharProcs 2 0 R /Encoding 3 0 R /Widths [500] >>',
      '<< /Length 10 >>\nstream\nD\nendstream',
      '<< /Type /Encoding /Differences [0 /A] >>',
    ])).problems.length === 0, '⑪ Type3（字形在 /CharProcs 里）⇒ 绿，不要求 FontFile');
    report(fontChain(mkPdf([
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /Widths [500] >>',
    ])).problems.length === 0, '⑪ 标准 14 字体不带 FontFile ⇒ 绿（阅读器有替代字形）');
    /* 非标准字体、无描述符、无前缀 ⇒ 红（这才是旧判据唯一抓得到的形态） */
    report(fontChain(mkPdf([
      '<< /Type /Font /Subtype /TrueType /BaseFont /Mystery >>',
    ])).problems.some((x) => /没有 \/FontDescriptor/.test(x)),
      '⑪ 非标准字体没有 FontDescriptor ⇒ 红');

    /* ---- ⑫ 只数 /Page，不把 /Pages 算成页 ---- */
    report(countPages('/Type /Page /Type /Page /Type /Pages') === 2,
      '⑫ 只数 /Page，不把 /Pages 算成页');

    /* ---- ⑬ 样式表全失败 ⇒ 必须报错，不许"判红"也不许"判绿" ----
       这是并发下真实发生过的事：某个配色渲染成裸 HTML，
       页数 4≠8、run 数少一截、深浅两色"看起来不同"。
       若只当回归报红，下次有人会去改样式；若恰好对比度够高还会变假绿。
       ⇒ 判据只能有一个动作：**这页结果作废**。 */
    let guardThrew = '';
    try {
      await render('file:///' + dir.replace(/\\/g, '/') + '/nostyle.html', 'light');
    } catch (e) {
      guardThrew = String((e && e.message) || e);
    }
    report(/页面样式没落地/.test(guardThrew),
      '⑬ 样式表全 404 ⇒ 报错而不是对裸 HTML 下结论');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }

  console.log(bad ? '  ❌ 反向控制有 ' + bad + ' 条没通过' : '  ✅ 反向控制全绿');
  return bad ? 1 : 0;
}

/* ------------------------------------------------------------ 对抗夹具
 *
 * 为什么单开一组：前面那些用例测的是"判据判得对不对"，被喂的是**合成数字**。
 * 这一组测的是"判据拿到真实极端页面还认不认得出来" —— 喂的是真浏览器渲染出来的
 * PDF，六个面：50 页 / 一行表 / 200 列 / 嵌套浮层 / 近空白页 / 单块超一页。
 *
 * 每条都必须给出**可证伪的**结论，而不是"没崩"：
 *   ① 50 页      —— 页数必须**正好** 50。多一页 = 尾部多出一张空页；少一页 = 两页并了。
 *   ② 一行表      —— 必须 1 页。thead 若被重复到第二页，就会出现"只有表头的第二张纸"。
 *   ③ 200 列      —— 必须判出横向溢出；配一份压进纸面的对照，证明不是"见大表就红"。
 *   ④ 嵌套浮层    —— 打印态下两层遮罩都得落回正常流，正文标题与两层弹窗的字都不能丢。
 *   ⑤ 近空白页    —— 一个字符也算字（⑫ 不许误报）；首屏真没字时必须抓得到。
 *   ⑥ 单块超一页  —— 与"同内容可拆分"的对照组比 run 数：少了就是**静默丢字**。
 *
 * ⚠️ 这些数字都是**实测**的，不是设计目标。改渲染参数（视口 / 边距 / printBackground）
 *    会让它们变，届时要么改夹具，要么承认判据变了 —— 不许直接把断言放宽到不报错。
 */
const ADV_DIR = path.join(ROOT, '05-audit', 'fixtures', 'print-adversarial');

/* 夹具清单写死在这里，是为了让"少了一个文件"变成**有名字的失败**。
   没有这条前置：夹具被误删时 puppeteer 在 goto 上抛栈，
   读起来像门禁坏了，实际是"这一面根本没测"——而"没测"绝不能算过。 */
const ADV_FILES = [
  '01-fifty-pages.html',
  '02-one-row-table.html',
  '03-200-cols.html',
  '03b-200-cols-fixed.html',
  '04-nested-overlays.html',
  '05-near-blank.html',
  '05b-blank-first-page.html',
  '05c-blank-middle-page.html',
  '06-block-over-one-page.html',
  '06b-block-breakable.html',
];

async function adversarial() {
  let bad = 0;
  let total = 0;
  const report = (ok, why, extra) => {
    total += 1;
    console.log('  [' + (ok ? 'OK  ' : 'FAIL') + '] ' + why + (extra ? '  ' + extra : ''));
    if (!ok) bad += 1;
  };

  const missing = ADV_FILES.filter((n) => !fs.existsSync(path.join(ADV_DIR, n)));
  if (missing.length) {
    console.log('  ❌ 对抗夹具不齐：缺 ' + missing.length + '/' + ADV_FILES.length
      + ' 个 —— ' + missing.join(', '));
    console.log('     重新生成：python 05-audit/fixtures/print-adversarial/_gen.py');
    return 1;
  }
  const url = (name) => 'file:///' + path.join(ADV_DIR, name).replace(/\\/g, '/');
  const shot = async (name) => analyze((await render(url(name), 'light')).pdf);

  /* ① 50 页：页数是硬数字 */
  const p50 = await shot('01-fifty-pages.html');
  report(p50.pages === 50, '① 50 页：页数正好 50',
    'pages=' + p50.pages + (p50.pages > 50 ? '（多了 ' + (p50.pages - 50) + ' 页 ⇒ 尾部空页）' : ''));
  report(p50.pagesWithoutText === 0 && p50.textStreams === p50.pages,
    '① 50 页：文本流与页数**逐个**对上（不是"差为 0"）',
    'textStreams=' + p50.textStreams + '/' + p50.pages
      + ' 宽松计数=' + p50.textStreamsLoose);

  /* ② 一行表：表头不许重复出一张只有表头的纸 */
  const p1 = await shot('02-one-row-table.html');
  report(p1.pages === 1, '② 一行表：整表落在一页里', 'pages=' + p1.pages);

  /* ③ 200 列：判据必须在真页面上有牙，同时不能"见大表就红" */
  const wide = await render(url('03-200-cols.html'), 'light');
  const wideFixed = await render(url('03b-200-cols-fixed.html'), 'light');
  report(wide.overflow > 0, '③ 200 列：判出横向溢出（判据④在真页面上是有牙的）',
    'overflow=' + wide.overflow + 'px');
  report(wideFixed.overflow === 0, '③ 对照：同样 200 列压进纸面后不报溢出',
    'overflow=' + wideFixed.overflow + 'px');

  /* ④ 嵌套浮层：两层遮罩都要落回正常流，字一个都不能少 */
  const dom = await withPage({ width: 794, height: 1123, deviceScaleFactor: 1 }, async (p) => {
    await loadStyled(p, url('04-nested-overlays.html'));
    await p.emulateMediaType('print');
    await p.evaluate(() => (document.fonts ? document.fonts.ready.then(() => 1) : 1));
    return p.evaluate(() => {
      const seen = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { found: false };
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          found: true,
          pos: s.position,
          bg: s.backgroundColor,
          visible: s.display !== 'none' && s.visibility !== 'hidden' && r.height > 0,
        };
      };
      return {
        a: seen('#bd-a'), b: seen('#bd-b'),
        title: seen('#page-title'),
        ta: seen('#t-a'), tb: seen('#t-b'),
      };
    });
  });
  const flat = (x) => x.pos !== 'fixed' && (x.bg === 'rgba(0, 0, 0, 0)' || x.bg === 'transparent');
  report(dom.a.found && dom.b.found && flat(dom.a) && flat(dom.b),
    '④ 嵌套浮层：两层遮罩都落回正常流、且不铺底色',
    'A pos=' + dom.a.pos + ' bg=' + dom.a.bg + ' · B pos=' + dom.b.pos + ' bg=' + dom.b.bg);
  report(dom.title.visible && dom.ta.visible && dom.tb.visible,
    '④ 正文标题与两层弹窗的字都还在（没有被 visibility:hidden 吞掉）',
    'title=' + dom.title.visible + ' A=' + dom.ta.visible + ' B=' + dom.tb.visible);

  /* ⑤ 近空白页：一个字符也算字；首屏真空了必须抓得到 */
  const near = await shot('05-near-blank.html');
  report(near.pages === 1 && near.pagesWithoutText === 0,
    '⑤ 只有一个字符的页：不许判成"没有文本算子"',
    'pages=' + near.pages + ' textStreams=' + near.textStreams);
  const blankFirst = await shot('05b-blank-first-page.html');
  report(blankFirst.pagesWithoutText >= 1,
    '⑤ 首屏只有占位块：必须报出"有一页没有文本算子"',
    'pages=' + blankFirst.pages + ' 无字页=' + blankFirst.pagesWithoutText);
  /* 🔴 这条盯的是 ⑫ 的算法本身：`无字页 = 页数 − 文本流数` 是个差，
     不是逐页判定。三页文档里中间一页无字 ⇒ 差必须是 1；
     差算成 0（比如把"有 BT 的流"按页去重错了）就说明 ⑫ 已经瞎了。 */
  const blankMid = await shot('05c-blank-middle-page.html');
  report(blankMid.pages === 3 && blankMid.pagesWithoutText === 1,
    '⑤ 三页文档里中间一页无字：无字页数必须正好 1（不是 0，也不是 3）',
    'pages=' + blankMid.pages + ' 无字页=' + blankMid.pagesWithoutText
      + ' textStreams=' + blankMid.textStreams);

  /* ⑥ 单块超一页：与可拆分对照组比 run 数，少了就是静默丢字 */
  const unbreakable = await shot('06-block-over-one-page.html');
  const breakable = await shot('06b-block-breakable.html');
  report(unbreakable.runs === breakable.runs,
    '⑥ 超一页的不可拆块：文字 run 数与可拆分的对照组一致（没有静默丢字）',
    'unbreakable=' + unbreakable.runs + ' breakable=' + breakable.runs
      + '（页数 ' + unbreakable.pages + ' vs ' + breakable.pages + '）');
  report(unbreakable.pages >= 2,
    '⑥ 超一页的块确实占了多页（若只有 1 页，说明内容被裁掉了）',
    'pages=' + unbreakable.pages);

  console.log(bad
    ? '  ❌ 对抗夹具 ' + bad + '/' + total + ' 条没通过'
    : '  ✅ 对抗夹具全绿（' + total + ' 条 · 6 个面）');
  return bad ? 1 : 0;
}

main().then((rc) => process.exit(rc || 0)).catch((e) => {
  console.error('  🔴 ' + ((e && e.friendly && e.message) || (e && e.stack) || e));
  process.exit(2);
});
