'use strict';
/*
 * demo-claim-gate.js —— 「对错对照块」的断言必须能被机器验
 *
 * ============================================================================
 * 🔴 它补的是哪一半
 * ============================================================================
 * `demo-counterexample-gate.py` 判的是「反例**在不在**」：块在、没被藏、
 * 块后有标题。它判不了「这块反例**是不是真的坏**」—— 那句话当时写在脚本头部，
 * 承认了没判。
 *
 * 而这个缺口是真实存在的，不是理论上的：
 *   · `03-patterns/nav` 的反例栏，`.toc__link` 自带 `white-space: nowrap`，
 *     长标题**根本没换行**，只是被裁掉了 —— 标题却写着「允许换行」。
 *   · `03-patterns/list` 同一形态：两栏都是 1 行，`.list__title` 自带 ellipsis。
 *   · 更早的 `02-primitives/dropdown`：反例写了 `display:flex; min-height:44px`，
 *     恰好绕开了真实坑，两栏像素级相同。
 * 三次都是「块在、标题对、但反例不成立」。只判「在不在」时，这三处全绿。
 *
 * ============================================================================
 * 🔴 怎么判：每栏一条可证伪的数字，且两栏断言**互斥**
 * ============================================================================
 * 写法（写在栏容器上）：
 *
 *   <div class="cmp__pane cmp__bad"  data-bad="li.dd-bug|h|<=24">
 *   <div class="cmp__pane cmp__good" data-good="li.dd__item|h|>=44">
 *
 * 格式：`选择器|指标|断言`，断言 = 比较符 + 数值（选择器写 `.` 表示这一栏本身）
 *
 * 判三件事：
 *   ① 两栏都写了断言（缺一条就红 —— 没有断言就没有可验证的东西）
 *   ② 两栏各自**成立**（量出来的数真的落在断言里）
 *   ③ 两条断言**互斥**：不存在任何一个数能同时满足两边
 *
 * ③ 是这套判据的关键。只做 ①② 的话，`>=24` 与 `>=44` 也能双双成立 ——
 * 那什么也证明不了。互斥成立 ⇒ 两栏在那个维度上**必然不同**，
 * 这是「错的样子真的摆出来了」能被机器捡到的那一半。
 *
 * ============================================================================
 * 🔴 它判不了什么（不假装判了）
 * ============================================================================
 *   · 反例**该不该**算错 —— 那是判断，机器判不了。
 *     （例：`progress` 那块量的是"反例里有 success 色的满进度条"，
 *       这证明演示物在，不证明"到 100% 变绿"这个做法不好。）
 *   · 文案说得准不准 —— `cmp__why` 里那句话对不对，只能人读。
 *   · 只覆盖 `cmp__bad` / `cmp__good` 成对出现的块；`box bad` 那批
 *     （10 页）没有成对结构，**不覆盖**，条数打在末尾。
 *
 * ============================================================================
 * 🔴 为什么在 900px 宽下量
 * ============================================================================
 * `.cmp` 在 640px 以下叠成单栏（见 `01-tokens/page.css`），
 * 叠起来就没有"并排"了。900px 是两栏并排时的典型宽度，
 * 所有数字都以它为准 —— 换宽度量，阈值要重定，那是另一件事。
 *
 * 用法：
 *   node 05-audit/demo-claim-gate.js             # 判
 *   node 05-audit/demo-claim-gate.js --selftest  # 自检（N 条反向控制 + 1 条正例）
 * ========================================================================= */

const fs = require('fs');
const path = require('path');
const { launch } = require(path.join(__dirname, 'browser.js'));

const ROOT = path.dirname(__dirname);
/* 默认走 check-all.sh 起的 8000；开发时可用 FL_BASE 指到别的端口，
   免得为了跑一次门禁去抢 8000（那会让 check-all 的 canary 判定混乱）。 */
const BASE = process.env.FL_BASE || 'http://127.0.0.1:8000/';
const VIEW = { width: 900, height: 900 };

/* 指标表。加一个指标要想清楚"它一句话说清的是哪件事"，
   加不进去的，说明那个反例其实量化不了 —— 那就别硬凑。 */
const METRICS = {
  count: '栏内匹配元素的个数',
  h: '第一个匹配元素的高度（px）',
  w: '第一个匹配元素的宽度（px）',
  lines: '高度 ÷ 行高，即行数',
  fs: '第一个匹配元素的字号（px）',
  uniq: '不同"渲染字形"的个数（textContent + ::before/::after）',
  glyphs: '第一个匹配元素的字形字符数（含伪元素）',
  hidden: '有效不可见的匹配元素个数（opacity 0 / visibility hidden / 零尺寸）',
  gh: 'hover 引起的高度变化（px，正数=变大）',
  gw: 'hover 引起的宽度变化（px，正数=变宽）',
};

const OPS = ['=', '<=', '>=', '<', '>'];

/* ---------------------------------------------------------------------------
 * ① 解析 & 断言代数
 * ------------------------------------------------------------------------ */

function parseClaim(raw) {
  if (raw === null || raw === undefined) return { err: '没写断言' };
  const parts = raw.split('|');
  if (parts.length !== 3) {
    return { err: `格式应为 选择器|指标|断言（如 li|h|>=44），实际 ${parts.length} 段：${raw}` };
  }
  const [sel, metric, assert] = parts.map((x) => x.trim());
  if (!sel) return { err: '选择器为空' };
  if (!METRICS[metric]) {
    return { err: `未知指标 ${metric}（可用：${Object.keys(METRICS).join(' / ')}）` };
  }
  const m = /^(<=|>=|=|<|>)(-?\d+(?:\.\d+)?)$/.exec(assert);
  if (!m) {
    return { err: `断言应形如 >=44 / <24 / =0，实际是 ${assert}`
      + `（可用比较符：${OPS.join(' ')}）` };
  }
  return { sel, metric, op: m[1], value: Number(m[2]) };
}

/** 量出来的值是否落在断言里。`=` 用 0.51 容差：值统一保留一位小数。 */
function holds(measured, claim) {
  if (measured === null) return false;
  const { op, value } = claim;
  const eps = 0.51;
  switch (op) {
    case '=': return Math.abs(measured - value) <= eps;
    case '<': return measured < value - eps;        // 严格小于，且留出测量噪声
    case '>': return measured > value + eps;
    case '<=': return measured <= value + eps;
    case '>=': return measured >= value - eps;
    default: return false;
  }
}

/** 把一条断言化成区间 [lo, hi, lo含端点, hi含端点]。 */
function interval(c) {
  switch (c.op) {
    case '=': return [c.value, c.value, true, true];
    case '<': return [-Infinity, c.value, false, false];
    case '<=': return [-Infinity, c.value, false, true];
    case '>': return [c.value, Infinity, false, false];
    case '>=': return [c.value, Infinity, true, false];
    default: return [NaN, NaN, false, false];
  }
}

/** 两个断言能否被同一个数同时满足。能 ⇒ 它们证明不了"两栏不同"。 */
function overlap(a, b) {
  const [al, ah, alIn, ahIn] = interval(a);
  const [bl, bh, blIn, bhIn] = interval(b);
  const lo = al > bl ? { v: al, i: alIn } : al < bl ? { v: bl, i: blIn }
    : { v: al, i: alIn && blIn };
  const hi = ah < bh ? { v: ah, i: ahIn } : ah > bh ? { v: bh, i: bhIn }
    : { v: ah, i: ahIn && bhIn };
  if (lo.v > hi.v) return false;
  if (lo.v < hi.v) return true;
  return lo.i && hi.i;
}

/* ---------------------------------------------------------------------------
 * ② 页面内测量
 * ------------------------------------------------------------------------ */

/* 这个函数会被 page.evaluate 序列化进去，只能用页面里有的东西 */
function measureInPage([blockIdx, side, spec]) {
  const block = document.querySelectorAll('.cmp')[blockIdx];
  if (!block) return null;
  const pane = block.querySelector(side === 'bad' ? '.cmp__bad' : '.cmp__good');
  if (!pane) return null;

  const glyph = (el) => {
    const pick = (v) => (v && v !== 'none' && v !== 'normal')
      ? v.replace(/^["']|["']$/g, '') : '';
    return pick(getComputedStyle(el, '::before').content)
      + (el.textContent || '').trim()
      + pick(getComputedStyle(el, '::after').content);
  };

  if (spec.metric === 'count') return pane.querySelectorAll(spec.sel).length;

  if (spec.metric === 'hidden') {
    return [...pane.querySelectorAll(spec.sel)].filter((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display === 'none' || cs.visibility === 'hidden'
        || parseFloat(cs.opacity) === 0 || r.width === 0 || r.height === 0;
    }).length;
  }

  if (spec.metric === 'uniq') {
    return new Set([...pane.querySelectorAll(spec.sel)].map(glyph)).size;
  }

  const el = spec.sel === '.' ? pane : pane.querySelector(spec.sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  switch (spec.metric) {
    case 'h': return r.height;
    case 'w': return r.width;
    case 'fs': return parseFloat(cs.fontSize);
    case 'glyphs': return glyph(el).length;
    case 'lines': {
      let lh = parseFloat(cs.lineHeight);
      if (!Number.isFinite(lh)) lh = parseFloat(cs.fontSize) * 1.2;
      /* 取整：padding 也被算进高度里，比值天然带小数
         （实测 2 行的链接量出 2.39）—— 取整才对应"几行"。 */
      return Math.round(r.height / lh);
    }
    default: return null;
  }
}

const HOVER = new Set(['gh', 'gw']);

/** hover 前后各量一次。必须先把元素滚进视口 —— mouse.move 用的是视口坐标。 */
async function measureHover(page, blockIdx, side, spec) {
  const rect = await page.evaluate(([i, s, sel]) => {
    const pane = document.querySelectorAll('.cmp')[i]
      .querySelector(s === 'bad' ? '.cmp__bad' : '.cmp__good');
    const el = sel === '.' ? pane : pane.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  }, [blockIdx, side, spec.sel]);
  if (!rect) return null;
  await page.mouse.move(rect.x, rect.y);
  await new Promise((r) => setTimeout(r, 700));
  const after = await page.evaluate(([i, s, sel]) => {
    const pane = document.querySelectorAll('.cmp')[i]
      .querySelector(s === 'bad' ? '.cmp__bad' : '.cmp__good');
    const el = sel === '.' ? pane : pane.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }, [blockIdx, side, spec.sel]);
  await page.mouse.move(3, 3);
  await new Promise((r) => setTimeout(r, 350));
  if (!after) return null;
  return spec.metric === 'gh' ? after.h - rect.h : after.w - rect.w;
}

async function measure(page, blockIdx, side, spec) {
  if (HOVER.has(spec.metric)) return measureHover(page, blockIdx, side, spec);
  return page.evaluate(measureInPage, [blockIdx, side, spec]);
}

/* ---------------------------------------------------------------------------
 * ③ 判一个块
 * ------------------------------------------------------------------------ */

function readBlocks() {
  const out = [];
  for (const top of fs.readdirSync(ROOT)) {
    if (!/^0\d-/.test(top)) continue;
    const dir = path.join(ROOT, top);
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name, 'demo.html');
      if (!fs.existsSync(file)) continue;
      if (/cmp__bad/.test(fs.readFileSync(file, 'utf8'))) {
        out.push({ rel: `${top}/${name}/demo.html` });
      }
    }
  }
  return out;
}

async function judgePage(page) {
  const raws = await page.evaluate(() => [...document.querySelectorAll('.cmp')].map((b) => {
    const bad = b.querySelector('.cmp__bad');
    const good = b.querySelector('.cmp__good');
    return {
      hasBad: !!bad, hasGood: !!good,
      bad: bad ? bad.getAttribute('data-bad') : null,
      good: good ? good.getAttribute('data-good') : null,
      title: bad && bad.querySelector('h3') ? bad.querySelector('h3').textContent.trim() : '',
    };
  }));

  const problems = [];
  for (let i = 0; i < raws.length; i++) {
    const b = raws[i];
    if (!b.hasBad || !b.hasGood) {
      /* 少一栏就是"对照不存在"。这里**不能**只报"有反例栏却缺正例栏"——
         反过来（只有正例栏）更常见，而且更隐蔽：删掉反例栏，页面看起来
         依然是个正经的两栏块，`demo-counter` 也只是"少一个块"而不会红。 */
      problems.push(`块#${i}（${b.title || '无标题'}）`
        + (b.hasBad ? '只有反例栏，没有正例栏' : b.hasGood ? '只有正例栏，没有反例栏' : '两栏都没有')
        + ' —— 对照必须有两侧');
      continue;
    }
    const cb = parseClaim(b.bad);
    const cg = parseClaim(b.good);
    if (cb.err) { problems.push(`块#${i}（${b.title}）反例栏：${cb.err}`); continue; }
    if (cg.err) { problems.push(`块#${i}（${b.title}）正例栏：${cg.err}`); continue; }
    if (cb.metric !== cg.metric) {
      problems.push(`块#${i}（${b.title}）两栏量的不是同一件事：`
        + `${cb.metric} vs ${cg.metric} —— 这样的对比说明不了任何问题`);
      continue;
    }
    if (overlap(cb, cg)) {
      problems.push(`块#${i}（${b.title}）两栏断言可以同时成立`
        + `（${cb.metric} ${cb.op}${cb.value} 与 ${cg.op}${cg.value}）`
        + ' —— 那它就证明不了"两栏不同"');
      continue;
    }
    const mb = await measure(page, i, 'bad', cb);
    const mg = await measure(page, i, 'good', cg);
    if (!holds(mb, cb)) {
      problems.push(`块#${i}（${b.title}）反例栏断言不成立：`
        + `${cb.sel} 的 ${cb.metric} 量得 ${mb === null ? '找不到元素' : fmt(mb)}，`
        + `断言是 ${cb.op}${cb.value}`);
      continue;
    }
    if (!holds(mg, cg)) {
      problems.push(`块#${i}（${b.title}）正例栏断言不成立：`
        + `${cg.sel} 的 ${cg.metric} 量得 ${mg === null ? '找不到元素' : fmt(mg)}，`
        + `断言是 ${cg.op}${cg.value}`);
      continue;
    }
    console.log('    OK    %s  %s 量得 %s', pad(cb.metric), b.title.slice(0, 22), fmt(mb));
  }
  return problems;
}

const fmt = (v) => (Math.round(v * 10) / 10).toString();
const pad = (s) => (s + '            ').slice(0, 10);

/* ---------------------------------------------------------------------------
 * ④ 主流程
 * ------------------------------------------------------------------------ */

async function main() {
  const pages = readBlocks();
  const b = await launch();
  const page = await b.newPage();
  await page.setViewport(VIEW);
  let blocks = 0;
  const all = [];
  for (const p of pages) {
    await page.goto(BASE + p.rel, { waitUntil: 'networkidle0' });
    const n = await page.evaluate(() => document.querySelectorAll('.cmp').length);
    blocks += n;
    const problems = await judgePage(page);
    if (problems.length) all.push({ rel: p.rel, problems });
    else console.log('  ✅ %s（%d 块）', p.rel, n);
  }

  /* 没覆盖到的那批要报出条数 —— 悄悄跳过等于假绿 */
  const boxPages = [];
  for (const top of fs.readdirSync(ROOT)) {
    if (!/^0\d-/.test(top)) continue;
    for (const name of fs.readdirSync(path.join(ROOT, top))) {
      const f = path.join(ROOT, top, name, 'demo.html');
      if (!fs.existsSync(f)) continue;
      const s = fs.readFileSync(f, 'utf8');
      if (/class="box bad"/.test(s) && !/cmp__bad/.test(s)) boxPages.push(`${top}/${name}`);
    }
  }
  await b.close();

  console.log('\n  判了 %d 个对照块（%d 页）', blocks, pages.length);
  console.log('  ⚠️ 未覆盖：%d 页仍是 `box bad` 单栏反例，没有成对结构可量'
    + '（%s）', boxPages.length, boxPages.join(' / '));

  if (all.length) {
    console.log('\n  🔴 %d 页有断言不成立：', all.length);
    for (const x of all) {
      console.log('\n  · %s', x.rel);
      x.problems.forEach((m) => console.log('      %s', m));
    }
    process.exit(1);
  }
  console.log('\n  ✅ %d 个对照块：每栏都写了可证伪的断言，且两两互斥、各自成立', blocks);
}

/* ---------------------------------------------------------------------------
 * ⑤ 自检：门禁必须证明自己会红
 * ------------------------------------------------------------------------ */

async function selftest() {
  /* 只跑"当前代码全绿"是没有鉴别力的 —— 那叫恒绿。下面每条都必须是红的。 */
  const FIXTURE = (bad, good, body) => `<style>
      .cmp{display:grid;grid-template-columns:1fr 1fr}
      .cmp__pane{border:1px solid #ccc;padding:8px}
      li{height:24px} .tall li{height:44px}
    </style><div class="cmp">
      <div class="cmp__pane cmp__bad" ${bad === null ? '' : `data-bad="${bad}"`}>
        <h3>反例</h3>${body}</div>
      <div class="cmp__pane cmp__good" ${good === null ? '' : `data-good="${good}"`}>
        <h3>正例</h3><ul class="tall"><li>a</li></ul></div>
    </div>`;

  const cases = [
    ['没写断言', null, 'li|h|>=44', '<ul><li>a</li></ul>'],
    ['格式不对（缺少比较符）', 'li|h|44', 'li|h|>=44', '<ul><li>a</li></ul>'],
    ['格式不对（两段）', 'li|h>=44', 'li|h|>=44', '<ul><li>a</li></ul>'],
    ['未知指标', 'li|height|<=24', 'li|h|>=44', '<ul><li>a</li></ul>'],
    ['选择器找不到', 'li.nope|h|<=24', 'li|h|>=44', '<ul><li>a</li></ul>'],
    ['断言不成立（量得 24 却写 <=20）', 'li|h|<=20', 'li|h|>=44', '<ul><li>a</li></ul>'],
    ['两栏可同时成立', 'li|h|>=24', 'li|h|>=44', '<ul><li>a</li></ul>'],
    ['两栏量的不是同一件事', 'li|h|<=24', 'li|w|>=44', '<ul><li>a</li></ul>'],
  ];

  const b = await launch();
  const page = await b.newPage();
  await page.setViewport(VIEW);
  let ok = true;
  let nRed = 0;
  let nGreen = 0;
  /* kind 必须显式传：自检结论里的条数要能**数出来**，不能手写 ——
     手写的数字会在下次加用例时变成谎话（这一条本轮已经踩过两次）。 */
  const say = (pass, msg, kind = 'red') => {
    if (!pass) ok = false;
    if (kind === 'green') nGreen++; else nRed++;
    console.log('  %s %s', pass ? 'PASS' : 'FAIL', msg);
  };

  for (const [name, bad, good, body] of cases) {
    await page.setContent(FIXTURE(bad, good, body), { waitUntil: 'load' });
    const problems = await judgePage(page);
    say(problems.length > 0, `反向控制：${name} → 必须红（${problems[0] || '却绿了'}）`);
  }

  // 反向控制的另一半：合法夹具必须绿，否则这道门禁只会恒红
  await page.setContent(FIXTURE('li|h|<=24', 'li|h|>=44', '<ul><li>a</li></ul>'),
    { waitUntil: 'load' });
  const green = await judgePage(page);
  say(green.length === 0, '正例：合法断言（24 vs 44，互斥且各自成立）→ 必须绿', 'green');

  // 少一栏：两个方向都要红。只有正例栏那条最容易被漏掉 ——
  // 删掉反例栏之后，页面看起来仍是个正经的两栏块。
  for (const [name, html] of [
    ['只有正例栏', '<div class="cmp"><div class="cmp__pane cmp__good" '
      + 'data-good="li|h|>=44"><h3>正例</h3><ul class="tall"><li>a</li></ul></div></div>'],
    ['只有反例栏', '<div class="cmp"><div class="cmp__pane cmp__bad" '
      + 'data-bad="li|h|<=24"><h3>反例</h3><ul><li>a</li></ul></div></div>'],
  ]) {
    await page.setContent(html, { waitUntil: 'load' });
    const missing = await judgePage(page);
    say(missing.length > 0 && /对照必须有两侧/.test(missing[0]),
      `反向控制：${name} → 必须红（${missing[0] || '却绿了'}）`);
  }

  await b.close();
  console.log(ok ? '\n  ✅ 自检通过：' + nRed + ' 条反向控制全红，'
    + nGreen + ' 条正例全绿'
    : '\n  🔴 自检失败：门禁抓不住上面的错误，它给的绿不可信');
  if (!ok) process.exit(1);
}

if (require.main === module) {
  (process.argv.includes('--selftest') ? selftest() : main())
    .catch((e) => { console.error(e); process.exit(1); });
}
