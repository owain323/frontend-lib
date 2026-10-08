const { launch } = require('./browser.js');

/**
 * emit-check.js — 「统一事件发射」工具核的行为契约
 *
 * ============================================================================
 * 🔴 为什么需要
 * ----------------------------------------------------------------------------
 *   本库此前**一个 DOM 事件都不发**，只有构造时传进来的回调。
 *   对陌生人来说这是最隐蔽的一类坑：
 *
 *     el.addEventListener('change', fn);   // 写得很自然
 *     // ⇒ 永远不触发，而且**没有任何报错**。
 *
 *   他不会去翻文档找"本库只支持回调"，只会认定"这个库是坏的"。
 *
 *   更糟的是：就算补上了事件，也有两个坑是**只有跑起来才看得见**的：
 *     · 事件名不加前缀 ⇒ 组件内部的 <input> 原生 `change` 会冒泡上来，
 *       调用方收到自己没订阅过的东西（静态正则一条都判不出来）；
 *     · `new CustomEvent(...)` 在老 WebView 上**抛异常**，而且是在
 *       **用户交互的路径上**抛 —— 本地 Chrome 永远测不出来。
 *
 * ============================================================================
 * 判据（八条）
 * ----------------------------------------------------------------------------
 *   ① 名字不带 `fl-` ⇒ 自动补；带了 ⇒ 不重复加（且不会触发原生 change）
 *   ② 冒泡到祖先 ⇒ 事件委托成立
 *   ③ `e.target` 是**组件根** ⇒ 委托时靠它认身份（见核文件头 ⑥）
 *   ④ `detail` 原样带过去（含 `value` 之外的自定义字段）
 *   ⑤ `cancelable === false`（本库的事件是通知，不是可撤销的动作）
 *   ⑥ 传 null / 没有 dispatchEvent 的元素 ⇒ 返回 null，**不抛异常**
 *   ⑦ 老 WebView 兜底：**现场摘掉** CustomEvent 构造函数 ⇒ 照样送到
 *   ⑧ 上面七条在**原样**下必须全绿（判据不得误报）
 *
 * ============================================================================
 * 反向控制：node 05-audit/emit-check.js --selftest
 *   改坏六处，每一次都必须被抓到。
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CORE = path.resolve(__dirname, '..', '01-tokens', 'behavior', 'emit.js');
const SCAN_DIRS = ['02-primitives', '03-patterns'];

/**
 * ⑨ 唯一入口：组件源码里**不许私自**造事件。
 *
 * ⚠️ 为什么这条必须静态扫：核会被整块注入进每个使用点，
 *    所以"搜 CustomEvent 这个字符串"在使用点里**必然命中**（那是注入进来的）。
 *    ⇒ 判据必须先把 INJECT 块整段摘掉，只看**块外面**的手写部分。
 *
 * ⚠️ 只扫源码，不扫 dist：dist 是压缩产物，注释（含 BEGIN/END 标记）被剥掉了，
 *    扫它必假红。改代码的是人，人改的是源码。
 */
const RE_CUSTOM_EVENT = /CustomEvent|initCustomEvent/;

/**
 * ⑩ 不许用 **HTML 属性**当回调（`data-on-*`）。
 *
 * ⚠️ 这一条来自一次真事故：`tabs.js` 的自动初始化写过
 *      `onChange: el.getAttribute('data-on-change') || null`
 *    —— 把一个**字符串**塞进了要求函数的位置，于是
 *      `typeof this.opts.onChange === 'function'` 永远不成立。
 *      ⇒ 这个属性**从第一天起就没生效过**，而且**没有任何报错**。
 *
 *    HTML 属性里放不出函数（只能放名字，而按名字找全局又是另一套约定），
 *    ⇒ 凡是 `data-on-*` 形式的回调，物理上只能是死代码。
 *    要收通知就用 `fl-*` 事件（见 API.md「事件」一节）。
 */
const RE_DATA_ON = /data-on-[a-z]/;

/**
 * 剥掉 JS 注释（带字符串状态，避免把 `'/*'` 之类的字面量当注释）。
 *
 * ⚠️ 为什么必须先剥：这条判据第一版扫**原始行**，结果把 tabs.js 里
 *    **解释这段历史的注释**也命中了（注释里引用了那句旧代码）。
 *    ⇒ 判据要管的是"代码真的去读这个属性"，不是"有人提到它"。
 */
function stripComments(src) {
  const out = [];
  let i = 0, n = src.length, q = null;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (q) {
      if (c === '\\') { out.push(c, d || ''); i += 2; continue; }
      if (c === q) q = null;
      out.push(c); i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out.push(c); i++; continue; }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      i = (e < 0 ? n : e + 2);
      continue;
    }
    out.push(c); i++;
  }
  return out.join('');
}

function dataOnHits(text) {
  const out = [];
  text.split('\n').forEach(function (ln, i) {
    if (RE_DATA_ON.test(ln)) out.push(i + 1);
  });
  return out;
}

function scanDataOn() {
  const out = [];
  for (const d of SCAN_DIRS) {
    const base = path.join(ROOT, d);
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base)) {
      const sub = path.join(base, name);
      if (!fs.statSync(sub).isDirectory()) continue;
      for (const f of fs.readdirSync(sub)) {
        if (!f.endsWith('.js')) continue;
        const rel = d + '/' + name + '/' + f;
        dataOnHits(stripComments(fs.readFileSync(path.join(sub, f), 'utf8')))
          .forEach(function (ln) { out.push(rel + ':' + ln); });
      }
    }
  }
  return out;
}

function violationsIn(rel, text) {
  const out = [];
  let inBlock = false;
  text.split('\n').forEach(function (ln, i) {
    if (/BEHAVIOR INJECT BEGIN:/.test(ln)) { inBlock = true; return; }
    if (/BEHAVIOR INJECT END:/.test(ln)) { inBlock = false; return; }
    if (inBlock) return;
    if (RE_CUSTOM_EVENT.test(ln)) out.push(rel + ':' + (i + 1));
  });
  return out;
}

function scanRepo() {
  const out = [];
  for (const d of SCAN_DIRS) {
    const base = path.join(ROOT, d);
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base)) {
      const sub = path.join(base, name);
      if (!fs.statSync(sub).isDirectory()) continue;
      for (const f of fs.readdirSync(sub)) {
        if (!f.endsWith('.js')) continue;
        const rel = d + '/' + name + '/' + f;
        out.push.apply(out,
          violationsIn(rel, fs.readFileSync(path.join(sub, f), 'utf8')));
      }
    }
  }
  return out;
}

const PAGE_HTML = `<!doctype html><meta charset="utf-8"><body>
<div id="wrap">
  <div id="root">
    <button id="inner" type="button">inner</button>
  </div>
</div>
</body>`;

function probe() {
  const out = {};
  const $ = (id) => document.getElementById(id);
  const wrap = $('wrap');
  const root = $('root');

  const log = [];
  ['fl-change', 'fl-open', 'fl-select', 'change'].forEach(function (t) {
    wrap.addEventListener(t, function (e) { log.push(e); });
  });
  function reset() { log.length = 0; }
  function last() { return log[log.length - 1] || null; }

  /* ① 不带 fl- ⇒ 自动补前缀（且**不会**冒出一个原生 change） */
  reset();
  flEmit(root, 'change', { value: 7 });
  let e1 = last();
  out.prefix = { ok: log.length === 1 && e1 && e1.type === 'fl-change',
                 why: 'n=' + log.length + ' type=' + (e1 ? e1.type : '-') };

  /* ①b 已带前缀 ⇒ 不重复加成 fl-fl-change */
  reset();
  flEmit(root, 'fl-change', { value: 8 });
  let e2 = last();
  out.noDup = { ok: log.length === 1 && e2 && e2.type === 'fl-change',
                why: 'n=' + log.length + ' type=' + (e2 ? e2.type : '-') };

  /* ② 冒泡：祖先收得到 ⇒ 委托成立 */
  out.bubbles = { ok: log.length === 1 && e2.bubbles === true,
                  why: 'bubbles=' + (e2 ? e2.bubbles : '-') };

  /* ③ e.target 是组件根 ⇒ 委托时靠它认身份 */
  out.target = { ok: !!e2 && e2.target === root,
                 why: 'target=' + (e2 && e2.target ? e2.target.id : '-') };

  /* ④ detail 原样带过去（含自定义字段） */
  reset();
  flEmit(root, 'fl-change', { value: 'abc', extra: 1 });
  let e4 = last();
  out.detail = { ok: !!e4 && !!e4.detail && e4.detail.value === 'abc' &&
                     e4.detail.extra === 1,
                 why: JSON.stringify(e4 ? e4.detail : null) };

  /* ⑤ cancelable === false */
  out.cancelable = { ok: !!e4 && e4.cancelable === false,
                     why: 'cancelable=' + (e4 ? e4.cancelable : '-') };

  /* ⑥ 异常安全：null / 假元素 ⇒ 返回 null，不抛 */
  let threw = false; let r1 = 'x'; let r2 = 'x';
  try { r1 = flEmit(null, 'fl-change', null); } catch (err) { threw = true; }
  try { r2 = flEmit({ foo: 1 }, 'fl-change', null); } catch (err2) { threw = true; }
  out.safe = { ok: !threw && r1 === null && r2 === null,
               why: 'threw=' + threw + ' r1=' + String(r1) + ' r2=' + String(r2) };

  /* ⑦ 老 WebView 兜底：现场把 CustomEvent 构造函数**摘掉**，强制走
        createEvent + initCustomEvent 那条分支。
        ⚠️ 这条不是"顺便测一下"：老分支平时**永远走不到**，
           写错了本地一行报错都没有，只在真机上"点了没反应"。 */
  let savedCE = window.CustomEvent;
  let removed = false;
  let fb = null;
  try {
    try { delete window.CustomEvent; } catch (d0) { /* 有些内核删不掉 */ }
    if (typeof window.CustomEvent === 'function') {
      try {
        Object.defineProperty(window, 'CustomEvent',
          { value: undefined, configurable: true, writable: true });
      } catch (d1) { /* 再不行就认了，下面 removed=false 会判红 */ }
    }
    removed = typeof window.CustomEvent !== 'function';
    reset();
    flEmit(root, 'fl-change', { value: 'old' });
    fb = last();
    out.fallback = {
      ok: removed && log.length === 1 && !!fb && fb.type === 'fl-change' &&
          !!fb.detail && fb.detail.value === 'old' &&
          fb.bubbles === true && fb.target === root,
      why: 'removed=' + removed + ' n=' + log.length +
           ' type=' + (fb ? fb.type : '-') +
           ' detail=' + (fb ? JSON.stringify(fb.detail) : '-') +
           ' bubbles=' + (fb ? fb.bubbles : '-'),
    };
  } catch (d2) {
    out.fallback = { ok: false, why: 'probe threw: ' + String(d2 && d2.message) };
  } finally {
    try { window.CustomEvent = savedCE; } catch (d3) { /* 尽力恢复 */ }
  }

  return out;
}

async function run(coreSrc) {
  const b = await launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  await p.setContent(PAGE_HTML);
  await p.addScriptTag({ content: coreSrc });
  const out = await p.evaluate(probe);
  await b.close();
  return { out: out, errs: errs };
}

const NAMES = {
  prefix: '① 不带 fl- ⇒ 自动补前缀（不触发原生 change）',
  noDup: '①b 已带前缀 ⇒ 不重复加',
  bubbles: '② 冒泡到祖先 ⇒ 事件委托成立',
  target: '③ e.target 是组件根 ⇒ 委托靠它认身份',
  detail: '④ detail 原样带过去（含自定义字段）',
  cancelable: '⑤ cancelable === false（是通知，不是可撤销动作）',
  safe: '⑥ 传 null / 假元素 ⇒ 返回 null 且不抛异常',
  fallback: '⑦ 老 WebView 兜底：摘掉 CustomEvent 构造函数后照样送到',
};

(async () => {
  const raw = fs.readFileSync(CORE, 'utf8');
  const statics = scanRepo();
  const dataOn = scanDataOn();

  if (process.argv.includes('--selftest')) {
    /* ⑩ 的反向控制：三向验证 */
    if (dataOnHits("el.getAttribute('data-on-change')").length !== 1) {
      console.log('  [FAIL] ⑩ 抓不到 data-on-* 回调 ⇒ 门禁是瞎的');
      process.exit(1);
    }
    if (dataOnHits("root.setAttribute('data-open', 'true')").length !== 0) {
      console.log('  [FAIL] ⑩ 把 `data-open` 误判成回调 ⇒ 门禁会假红');
      process.exit(1);
    }
    if (dataOn.length) {
      console.log('  [FAIL] ⑩ 真仓库就有命中 ⇒ 判据过严：' + dataOn.join(', '));
      process.exit(1);
    }
    console.log('  [OK]   ⑩ 不许用 HTML 属性当回调：抓得到、不误伤、真仓库 0 命中');

    /* ⑨ 的反向控制：三向验证（该抓的抓到 / 该放的放过 / 真仓库不误报） */
    if (violationsIn('x.js', 'var e = new CustomEvent("fl-x");').length !== 1) {
      console.log('  [FAIL] ⑨ 抓不到块外手写的 new CustomEvent ⇒ 门禁是瞎的');
      process.exit(1);
    }
    if (violationsIn('x.js',
      '/* BEHAVIOR INJECT BEGIN: emit */\nvar e = new CustomEvent("x");\n' +
      '/* BEHAVIOR INJECT END: emit */').length !== 0) {
      console.log('  [FAIL] ⑨ 把**注入进来**的核误判成手写 ⇒ 门禁会假红');
      process.exit(1);
    }
    if (statics.length) {
      console.log('  [FAIL] ⑨ 真仓库就有命中 ⇒ 判据过严：' + statics.join(', '));
      process.exit(1);
    }
    console.log('  [OK]   ⑨ 唯一入口：块外手写抓得到，注入块内不误报，真仓库 0 命中');

    const mutants = [
      ['去掉 fl- 前缀自动补（⇒ 事件名撞原生 change）',
        /var type = name\.indexOf\('fl-'\) === 0 \? name : 'fl-' \+ name;/,
        'var type = name;'],
      ['bubbles 改成 false（⇒ 事件委托静默失效，本地看不出来）',
        /detail: detail \|\| null, bubbles: true, cancelable: false/,
        'detail: detail || null, bubbles: false, cancelable: false'],
      ['cancelable 改成 true（⇒ 本库事件变成"可撤销的动作"）',
        /detail: detail \|\| null, bubbles: true, cancelable: false/,
        'detail: detail || null, bubbles: true, cancelable: true'],
      ['丢掉 detail（⇒ 调用方 e.detail.value 永远是 null）',
        /detail: detail \|\| null, bubbles: true, cancelable: false/,
        'detail: null, bubbles: true, cancelable: false'],
      ['去掉空值保护（⇒ el 为 null 时在交互路径上抛异常）',
        /if \(!el \|\| !el\.dispatchEvent\) return null;/,
        'if (false) return null;'],
      ['兜底分支 initCustomEvent 参数写反（⇒ 老 WebView 上不冒泡）',
        /ev\.initCustomEvent\(type, true, false, detail \|\| null\);/,
        'ev.initCustomEvent(type, false, true, detail || null);'],
    ];
    let bad = 0;
    for (const [why, from, to] of mutants) {
      const src = raw.replace(from, to);
      if (src === raw) {
        console.log('  [FAIL] 突变没生效（正则没匹配上）：' + why);
        bad++;
        continue;
      }
      const r = await run(src);
      const caught = Object.keys(NAMES).some((k) => !r.out[k].ok) || r.errs.length > 0;
      if (caught) console.log('  [OK]   判据抓到突变：' + why);
      else { console.log('  [FAIL] 突变没被抓到 ⇒ 门禁是瞎的：' + why); bad++; }
    }
    const ok = await run(raw);
    const allGreen = Object.keys(NAMES).every((k) => ok.out[k].ok) && !ok.errs.length;
    if (allGreen) console.log('  [OK]   原样八条全绿（判据没有误报）');
    else {
      console.log('  [FAIL] 原样就有不通过的项 ⇒ 判据过严');
      Object.keys(NAMES).forEach((k) => {
        if (!ok.out[k].ok) console.log('        %s ⇒ %s', NAMES[k], ok.out[k].why);
      });
      ok.errs.forEach((e) => console.log('        页面报错：%s', e));
      bad++;
    }
    process.exit(bad ? 1 : 0);
  }

  const r = await run(raw);
  console.log('');
  console.log('  === emit 核契约 ===');
  if (r.errs.length) console.log('    X 页面报错：' + r.errs.join(' | '));
  let bad = 0;
  for (const k of Object.keys(NAMES)) {
    const v = r.out[k];
    if (!v.ok) bad++;
    console.log('    %s %s%s', v.ok ? 'OK  ' : 'X   ', NAMES[k], v.ok ? '' : '  ⇒ ' + v.why);
  }
  if (statics.length) {
    bad++;
    console.log('    X    ⑨ 唯一入口：组件源码不许私自造事件 ⇒ ' + statics.join(', '));
  } else {
    console.log('    OK   ⑨ 唯一入口：组件源码里没有私自造事件');
  }
  if (dataOn.length) {
    bad++;
    console.log('    X    ⑩ 不许用 HTML 属性当回调（data-on-* 只能是死代码）⇒ ' +
                dataOn.join(', '));
  } else {
    console.log('    OK   ⑩ 不许用 HTML 属性当回调（要收通知用 fl-* 事件）');
  }
  console.log('');
  if (bad || r.errs.length) {
    console.log('  ❌ ' + (bad || r.errs.length) + ' 项不满足');
    process.exit(1);
  }
  console.log('  ✅ emit 核契约全部满足');
})();
