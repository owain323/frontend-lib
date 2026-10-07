#!/usr/bin/env node
/* ============================================================================
 * css-validity-gate.js — 「写了但浏览器根本不认」的声明，必须拦住
 * ============================================================================
 *
 * 🔴🔴 为什么必须有这道门禁（一次真实事故）
 * ---------------------------------------------------------------------------
 *   库里曾经有 **19 处** `border-inset-inline-start` / `-end`。
 *   **这不是一个存在的 CSS 属性** —— 正确的是 `border-inline-start`。
 *
 *   后果：那条边框**从来没有被渲染过**，而它配套的
 *       `.toc__link[aria-current="true"] { border-left-color: var(--accent) }`
 *   只是给一条 **0 宽、style:none** 的边上色 ⇒ 目录"当前项"指示条消失。
 *
 *   ⚠️ 为什么 33 道行为契约 + 静态门禁全都抓不到：
 *     · CSS 里写了个不存在的属性 **不报错、不告警、不影响任何解析**；
 *     · lint / 注释平衡 / 令牌解析 全都认为"这一行很正常"；
 *     · 只有**视觉回归**能发现，而当时视觉门禁正在假绿。
 *   ⇒ 这类错误属于"静默失效"，必须有一道专门针对它的门禁。
 *
 * ============================================================================
 * ⭐ 判据从哪来：**浏览器自己**
 * ---------------------------------------------------------------------------
 *   最容易写错的做法是"我维护一份合法属性名单" ——
 *   那是**第二份手写的真相源**，必然漂移（见 INVARIANT I-7）。
 *
 *   ⇒ 本门禁把每条声明交给 `CSS.supports(prop, value)`：
 *      浏览器说不支持，就是**在这套目标浏览器里不生效**，判 FAIL。
 *   ⇒ 实测：`CSS.supports('border-inset-inline-start','2px solid red')`
 *     与单参数形式、以及 `element.style.setProperty()` 三处**一致返回 false**，
 *     而 `border-inline-start` 三处都 true（带 var() 也一样，已实测）。
 *
 * ============================================================================
 * ⚠️ 三个必须做对的地方
 * ---------------------------------------------------------------------------
 *   ① **必须先抠掉注释与字符串再切分声明**
 *      注释里写 `border-inset-inline-start` 是说明文字，不是声明 ⇒ 不能报。
 *      字符串里出现 `;` `{` 也不该把声明切开 ⇒ 替换成占位字符再扫。
 *      （直接"数 /* 和 *\/ 的个数"是假绿生成器，见 comment-balance.py 的教训。）
 *
 *   ② **只扫"叶子块"**
 *      `@media (…) { .a { … } }` 的外层块内容是规则、不是声明；
 *      只有不含嵌套块的块才是声明块。
 *      例外的描述符型 at-rule（@font-face/@property）本库没有（已核实）；
 *      真出现时按 prelude 以 `@` 开头跳过，避免误报。
 *
 *   ③ **厂商前缀必须分三档，不能一刀切**
 *      实测踩到过两种相反的错误：
 *      · `-moz-appearance`：给 Firefox 写的，Chromium 不认 ⇒ 报 FAIL 是**误伤**；
 *      · `-webkit-overflow-scrolling: touch`：**Safari 专有**（虽带 -webkit- 前缀，
 *        Chromium 从未实现）⇒ 报 FAIL 同样是**误伤**。
 *      ⇒ 三档：
 *         无前缀、Chromium 不认 ⇒ **FAIL**（这就是 border-inset-inline-* 那一类）
 *         `-webkit-` 不认        ⇒ **WARN**（可能是对端引擎专有，不阻断）
 *         他厂前缀（-moz/-ms/-o）⇒ **跳过并计数**（本机无从判定，不假装有结论）
 *
 * ============================================================================
 * 用法
 * ---------------------------------------------------------------------------
 *   node 05-audit/css-validity-gate.js              # 门禁
 *   node 05-audit/css-validity-gate.js --selftest   # 自检（含反向控制）
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const { launch } = require(path.join(__dirname, 'browser.js'));

const ROOT = path.dirname(__dirname);
const DIRS = ['01-tokens', '02-primitives', '03-patterns',
              '04-recipes', '09-assets', 'adapters'];

/* ---------------------------------------------------------------------------
 * ① 抠掉注释与字符串（返回等长字符串，保换行 ⇒ 行号不会错）
 * ------------------------------------------------------------------------ */
function mask(text) {
  const out = text.split('');
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '*') {          // 块注释
      let j = i + 2;
      while (j < n && !(text[j] === '*' && text[j + 1] === '/')) {
        if (text[j] !== '\n') out[j] = ' ';           // 保换行
        j++;
      }
      out[i] = ' '; out[i + 1] = ' ';
      if (j < n) { out[j] = ' '; out[j + 1] = ' '; }
      i = j + 2;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {          // 行注释（CSS 无，但兜底）
      let j = i;
      while (j < n && text[j] !== '\n') { out[j] = ' '; j++; }
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {                    // 字符串：保留引号，内部占位
      let j = i + 1;
      while (j < n && text[j] !== c) {
        if (text[j] === '\\') { j++; }
        if (text[j] !== '\n') out[j] = 'x';
        j++;
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join('');
}

/* ---------------------------------------------------------------------------
 * ② 取"叶子块"里的声明
 * ------------------------------------------------------------------------ */
function declarations(text, file) {
  const m = mask(text);
  // 行号：预计算每个字符所属行
  const lineOf = (idx) => {
    let L = 1;
    for (let k = 0; k < idx; k++) if (text[k] === '\n') L++;
    return L;
  };
  const out = [];
  const stack = [];
  let seg = 0;
  for (let i = 0; i < m.length; i++) {
    const c = m[i];
    if (c === '{') {
      if (stack.length) stack[stack.length - 1].child = true;
      stack.push({ open: i + 1, prelude: m.slice(seg, i).trim(), child: false });
      seg = i + 1;
    } else if (c === '}') {
      const b = stack.pop();
      if (!b) continue;
      seg = i + 1;
      if (b.child) continue;                 // 含嵌套 ⇒ 里面是规则，不是声明
      if (b.prelude.charAt(0) === '@') continue;  // 描述符型 at-rule，跳过
      // 按 ; 切分（跳过括号内的 ;）
      const body = m.slice(b.open, i);
      let depth = 0, start = 0;
      for (let k = 0; k <= body.length; k++) {
        const ch = k < body.length ? body[k] : ';';
        if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (ch === ';' && depth === 0) {
          const piece = body.slice(start, k).trim();
          start = k + 1;
          if (!piece) continue;
          const colon = piece.indexOf(':');
          if (colon <= 0) continue;          // 不是声明（或属性名为空）
          let prop = piece.slice(0, colon).trim();
          let val = piece.slice(colon + 1).trim();
          if (!val) continue;
          out.push({ file, line: lineOf(b.open), prop, val });
        }
      }
    } else if (c === ';') {
      seg = i + 1;
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * 追加判据：**var() 悬空引用**
 * ---------------------------------------------------------------------------
 *   `var(--foo)` 里的 `--foo` 全库从未定义 ⇒ 该声明在**计算值阶段无效**，
 *   整条被丢弃 —— 和"属性名拼错"是同一种静默失效：不报错、不影响解析。
 *
 *   ⚠️ 但**有兜底值**的（`var(--foo, red)`）不算错：
 *      那是**刻意留的扩展位**（实测本库有 5 处：
 *      `--spark-c` / `--spark-h` / `--spark-len` 由 JS 在运行时写，
 *      `--table-max-h` / `--accent-strong` 留给使用者覆盖）。
 *      ⇒ 判据必须是"**既没定义、又没有兜底**"，只查没定义会误伤扩展位。
 * ------------------------------------------------------------------------ */
const DEF_RE = /(--[A-Za-z0-9_-]+)\s*:/g;
const USE_RE = /var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])/g;

function collectVars(files) {
  const defined = new Set();
  const uses = new Map();          // name -> {bare:[], withFb:[]}
  const lineNo = (t, i) => t.slice(0, i).split('\n').length;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const m = mask(src);
    let d;
    DEF_RE.lastIndex = 0;
    while ((d = DEF_RE.exec(m))) defined.add(d[1]);
    USE_RE.lastIndex = 0;
    while ((d = USE_RE.exec(m))) {
      const name = d[1];
      const hasFb = d[2] === ',';
      if (!uses.has(name)) uses.set(name, { bare: [], withFb: [] });
      const where = path.relative(ROOT, f).replace(/\\/g, '/') +
                    ':' + lineNo(m, d.index);
      (hasFb ? uses.get(name).withFb : uses.get(name).bare).push(where);
    }
  }
  const dangling = [];
  for (const [name, v] of uses) {
    if (!defined.has(name) && v.bare.length) dangling.push({ name, where: v.bare });
  }
  return { defined, dangling };
}

function listCss() {
  const files = [];
  const walk = (d) => {
    let items = [];
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const it of items) {
      const p = path.join(d, it.name);
      if (it.isDirectory()) {
        if (it.name === 'node_modules' || it.name === 'shots') continue;
        walk(p);
      } else if (it.name.endsWith('.css')) {
        files.push(p);
      }
    }
  };
  for (const d of DIRS) walk(path.join(ROOT, d));
  return files.sort();
}

const OTHER_VENDOR = /^-(moz|ms|o)-/;
const WEBKIT = /^-webkit-/;

/** 写个临时 CSS 夹具（自检用），返回路径 */
function tmp2(body) {
  const p = path.join(require('os').tmpdir(),
                      'fl-cssvalid-var-' + Date.now() + '.css');
  fs.writeFileSync(p, body);
  return p;
}

async function checkInBrowser(pairs) {
  const b = await launch();
  const p = await b.newPage();
  await p.goto('about:blank');
  const res = await p.evaluate((ps) => ps.map((x) => CSS.supports(x[0], x[1])),
                               pairs);
  await b.close();
  return res;
}

async function run(files, label) {
  const all = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    all.push(...declarations(src, path.relative(ROOT, f).replace(/\\/g, '/')));
  }
  // 去重：只测唯一的 (prop,value)
  const seen = new Map();
  for (const d of all) {
    let val = d.val.replace(/\s*!important\s*$/, '');
    const key = d.prop + '\u0000' + val;
    if (!seen.has(key)) seen.set(key, { prop: d.prop, val, where: [] });
    seen.get(key).where.push(d.file + ':' + d.line);
  }
  const entries = Array.from(seen.values());
  const tested = entries.filter((e) => !OTHER_VENDOR.test(e.prop));
  const skipped = entries.filter((e) => OTHER_VENDOR.test(e.prop));
  const ok = await checkInBrowser(tested.map((e) => [e.prop, e.val]));
  const bad = [];        // 无前缀却不认 ⇒ 真错
  const warn = [];       // -webkit- 不认 ⇒ 可能是 Safari 专有
  tested.forEach((e, i) => {
    if (ok[i]) return;
    (WEBKIT.test(e.prop) ? warn : bad).push(e);
  });
  return { total: all.length, uniq: entries.length, tested: tested.length,
           skipped, bad, warn, label };
}

async function selftest() {
  /* 🔴 反向控制：门禁必须**证明自己会红**。
     只跑"当前代码没问题"是没有鉴别力的 —— 那叫恒绿，不叫门禁。 */
  const FIX_BAD = '.x { border-inset-inline-start: 2px solid var(--accent); }';
  const FIX_GOOD = '.x { border-inline-start: 2px solid var(--accent); }';
  let ok = true;
  const say = (pass, msg) => {
    if (!pass) ok = false;
    console.log('  %s %s', pass ? 'PASS' : 'FAIL', msg);
  };

  // ① 坏夹具必须被判为不合法
  const db = declarations(FIX_BAD, 'FIX_BAD');
  const vb = await checkInBrowser(db.map((d) => [d.prop, d.val]));
  say(db.length === 1 && vb[0] === false,
      '反向控制：不存在的属性 border-inset-inline-start 必须判 FAIL');

  // ② 好夹具必须被判为合法
  const dg = declarations(FIX_GOOD, 'FIX_GOOD');
  const vg = await checkInBrowser(dg.map((d) => [d.prop, d.val]));
  say(dg.length === 1 && vg[0] === true,
      '正向控制：border-inline-start 必须判 PASS');

  // ③ 注释里的坏属性**不能**被当成声明（否则说明文档一提就假红）
  const dc = declarations(
    '/* 别写 border-inset-inline-start */\n.x { color: red; }', 'FIX_C');
  say(dc.length === 1 && dc[0].prop === 'color',
      '注释里的同名文字不算声明（避免说明性文字触发假红）');

  // ④ 字符串里的 ; 和 { 不能把声明切坏
  const ds = declarations('.x { content: "a;b{c"; color: red; }', 'FIX_S');
  say(ds.length === 2 && ds[1].prop === 'color',
      '字符串内的 ; { 不会切坏声明');

  // ⑤ @media 外层块不能被当成声明块
  const dm = declarations('@media (min-width:1px) { .x { color: red } }', 'FIX_M');
  say(dm.length === 1 && dm[0].prop === 'color',
      '@media 外层块不被误当成声明块');

  // ⑥ -webkit- 未知属性必须落 WARN、不能落 FAIL（否则 Safari 专有属性会误伤）
  const tmp = path.join(require('os').tmpdir(), 'fl-cssvalid-fixture.css');
  fs.writeFileSync(tmp, '.a { -webkit-overflow-scrolling: touch; }\n' +
                        '.b { color: red; }\n');
  const rt = await run([tmp], 'fixture');
  try { fs.unlinkSync(tmp); } catch (e) { /* 清理失败不影响判定 */ }
  say(rt.bad.length === 0 && rt.warn.length === 1 &&
      rt.warn[0].prop === '-webkit-overflow-scrolling',
      '-webkit- 未知属性只 WARN、不 FAIL（避免误伤 Safari 专有属性）');

  // ⑦ 真实库当前状态必须通过（否则说明上面的修复没生效）
  const rr = await run(listCss(), 'repo');
  say(rr.bad.length === 0,
      '当前仓库 CSS 无非法属性（实测 ' + rr.tested + ' 条唯一声明）');

  // ⑧ var() 悬空引用：无定义且无兜底 ⇒ 必须报；有兜底 ⇒ 不能报（是扩展位）
  const v1 = collectVars([tmp2(
    '.a { color: var(--nope-nope); }\n' +
    '.b { color: var(--ok-knob, red); }\n')]);
  say(v1.dangling.length === 1 && v1.dangling[0].name === '--nope-nope',
      'var() 悬空且无兜底 ⇒ 必须报（计算值阶段整条声明被丢弃）');

  const files = listCss();
  const v2 = collectVars(files);
  say(v2.dangling.length === 0,
      '当前仓库无悬空 var()（定义了 ' + v2.defined.size +
      ' 个自定义属性；带兜底的扩展位不算错）');

  console.log('');
  console.log('  === 自检 %s ===', ok ? '通过' : '未通过');
  return ok ? 0 : 1;
}

(async () => {
  if (process.argv.includes('--selftest')) {
    process.exit(await selftest());
  }
  const r = await run(listCss(), 'repo');
  console.log('  === CSS 声明合法性（浏览器自判）===');
  console.log('  扫描 %d 个 CSS 文件，%d 条声明（去重后 %d 条，实检 %d 条）',
              listCss().length, r.total, r.uniq, r.tested);
  if (r.skipped.length) {
    console.log('  跳过（他厂前缀，Chromium 上无法判定，不算失败）：%s',
                r.skipped.map((e) => e.prop).join(', '));
  }
  const vr = collectVars(listCss());
  if (vr.dangling.length) {
    console.log('  FAIL %d 个 var() 引用了全库从未定义、且**没有兜底**的自定义属性' +
                '（该声明会在计算值阶段被整条丢弃）：', vr.dangling.length);
    for (const d of vr.dangling) {
      console.log('        %s  ← %s', d.name, d.where.slice(0, 6).join(', '));
    }
    console.log('  ⇒ 要么补定义，要么补兜底值 var(%s, 默认值)。',
                vr.dangling[0].name);
    process.exit(1);
  }
  console.log('  OK   var() 引用均有定义或有兜底（共 %d 个自定义属性）',
              vr.defined.size);
  if (r.warn.length) {
    console.log('  WARN %d 条 -webkit- 声明在 Chromium 上不生效（可能是对端引擎专有，不阻断）：',
                r.warn.length);
    for (const e of r.warn) {
      console.log('        %s: %s  ← %s', e.prop, e.val,
                  e.where.slice(0, 4).join(', '));
    }
  }
  if (!r.bad.length) {
    console.log('  OK   没有"浏览器不认"的非前缀声明');
    process.exit(0);
  }
  console.log('  FAIL  %d 条声明在目标浏览器里不生效：', r.bad.length);
  for (const e of r.bad) {
    console.log('        %s: %s', e.prop, e.val);
    console.log('        出现在：%s', e.where.slice(0, 6).join(', ') +
                (e.where.length > 6 ? ' …' : ''));
  }
  console.log('');
  console.log('  ⇒ 这类声明**静默失效**：不报错、不影响解析、行为契约也抓不到。');
  console.log('    通常是属性名拼错（如 border-inset-inline-start 应为 border-inline-start）。');
  process.exit(1);
})().catch((e) => { console.error('  [FAIL] ' + String(e).slice(0, 300)); process.exit(1); });
