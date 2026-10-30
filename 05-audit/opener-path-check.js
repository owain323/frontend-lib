#!/usr/bin/env node
/* LAYER: component
 * ============================================================================
 * opener-path-check.js — 「打开一个浮层」的三条输入路径必须得到同一个结果
 *
 * 🔴 为什么需要这一道
 *   一次真机读屏测试里，`dropdown` 的菜单开了、焦点却留在按钮上。
 *   当时**所有门禁都是绿的**，因为那条判据只按了 `↓`（键盘分支）。
 *   读屏在浏览模式按 Enter 时，浏览器把这次按键变成**一次点击** ⇒ 走的是
 *   click 分支 ⇒ 那条分支只 open() 不聚焦。
 *   ⇒ 缺陷不在实现里，在**判据的覆盖面上**：只测了一条输入路径。
 *
 *   这一道把"打开"拆成三条路径，同一条不变量各测一遍：
 *
 *     A 键盘        真 keydown（不是 el.click()，两者语义不等价）
 *     B 鼠标点击    pointerdown → mousedown → mouseup → click 全序列
 *     C 读屏合成点击  只有一个 click 事件（辅助技术激活元素时就是这样）
 *
 *   三条路径的差别是真的：只监听 `pointerdown` 的实现在 B 上过、在 C 上死；
 *   只监听 `keydown` 的实现在 A 上过、在 B/C 上死。`--selftest` 用一张
 *   故意写坏的夹具证明这道判据分得清这三条路，而不是"随便报个红"。
 *
 * 🔴 「焦点进弹层」不是所有组件的正确形态
 *   菜单 / 对话框 / 抽屉 / 气泡：焦点移进弹层（否则键盘用户到不了里面）。
 *   只有下拉选择（select-only combobox）：焦点**留在按钮**，用
 *   `aria-activedescendant` 指到弹层里的选项 —— 这是 APG 的另一种合法形态，
 *   也是本库 select 的实现。判据必须按组件声明的那一种来断，否则会误报。
 *
 * ⚠️ 依赖本地静态服务 :8000（check-all.sh 会起）。没有就 SKIP（RC=3），不冒充通过。
 * ============================================================================
 */
'use strict';

const { launch } = require('./browser.js');

const BASE = 'http://127.0.0.1:8000';

/* 三条路径。`how` 只是名字，真正的差别在 activate() 里 */
const PATHS = [
  { id: 'kbd', label: '键盘' },
  { id: 'mouse', label: '鼠标点击' },
  { id: 'at', label: '读屏合成点击' },
];

/* 被测组件。
 *   opener     触发元素的 CSS 选择器
 *   key        这条组件**文档里写明**的打开键（不是所有组件都用 Enter：
 *              select-only combobox 的打开键是 ↓，Enter 不打开 —— 这是 APG 允许的）
 *   focus      'inside' = 焦点必须在弹层内；'activedesc' = 焦点留按钮 + activedescendant
 *   popupMode  'selector' 直接选；'controls' 走 aria-controls；'visible' 取当前可见的那个
 */
const COMPS = [
  {
    id: 'dropdown', url: '/03-patterns/dropdown/demo.html',
    opener: '[data-dd-btn]', popup: '[data-dd-menu]', popupMode: 'selector',
    key: 'ArrowDown', focus: 'inside',
  },
  {
    id: 'select', url: '/02-primitives/select/demo.html',
    opener: '#b1', popup: '', popupMode: 'controls',
    key: 'ArrowDown', focus: 'activedesc',
  },
  {
    id: 'popover', url: '/02-primitives/popover/demo.html',
    opener: '#p5', popup: '.popover:not([data-demo-open])', popupMode: 'visible',
    key: 'Enter', focus: 'inside',
  },
  {
    id: 'overlay', url: '/03-patterns/overlay/demo.html',
    opener: '#d1', popup: '[role="dialog"]', popupMode: 'selector',
    key: 'Enter', focus: 'inside',
  },
  {
    id: 'drawer', url: '/03-patterns/drawer/demo.html',
    opener: '[data-place="left"]', popup: '.drawer', popupMode: 'selector',
    key: 'Enter', focus: 'inside',
  },
];

/* 页内执行的取值逻辑。参数只有一个对象 —— puppeteer 只传可序列化的东西 */
function readState(args) {
  const opener = document.querySelector(args.opener);
  const visible = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  let box = null;
  if (args.popupMode === 'controls') {
    const id = opener && opener.getAttribute('aria-controls');
    box = id ? document.getElementById(id) : null;
  } else if (args.popupMode === 'visible') {
    box = Array.prototype.slice.call(document.querySelectorAll(args.popup))
      .filter(visible)[0] || null;
  } else {
    box = document.querySelector(args.popup);
  }

  const act = document.activeElement;
  const desc = opener ? opener.getAttribute('aria-activedescendant') : null;
  const descEl = desc ? document.getElementById(desc) : null;

  let focusOk = false;
  if (args.focus === 'activedesc') {
    focusOk = !!(act === opener && descEl && box && box.contains(descEl));
  } else {
    focusOk = !!(box && act && box.contains(act));
  }

  return {
    open: visible(box),
    focusOk: focusOk,
    active: act ? (act.tagName + (act.id ? '#' + act.id : '')) : 'null',
    desc: desc || '',
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 用指定路径激活触发元素，然后读状态。
 * 三条路径唯一的差别就是「怎么把这次激活送到元素上」。
 */
async function activate(p, comp, how) {
  await p.goto(BASE + comp.url, { waitUntil: 'load' });
  await sleep(220);

  const st = { opener: comp.opener, popup: comp.popup, popupMode: comp.popupMode, focus: comp.focus };

  /* 前提自证：此刻必须是关着的，否则后面读到的是上一条路径留下的状态 */
  const pre = await p.evaluate(readState, st);
  if (pre.open) return { err: '打开前弹层就是开的（前提不成立，不作判断）' };

  if (how === 'kbd') {
    await p.evaluate((s) => { const e = document.querySelector(s); if (e) e.focus(); }, comp.opener);
    await p.keyboard.press(comp.key);
  } else if (how === 'mouse') {
    const geo = await p.evaluate((s) => {
      const e = document.querySelector(s);
      e.scrollIntoView({ block: 'center' });
      const r = e.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      /* 前提自证：这个坐标上必须真的是它（或它的子元素）—— 元素在视口外或被盖住时，
         鼠标点出去的是空气，而失败会看起来像"点不开"。
         ⚠️ 不能要求 `elementFromPoint === e`：按钮里的 <span> 会先接住命中测试，
         点它和点按钮是同一件事（实测 select 的 `.select__value` 就是这样）。 */
      const hit = document.elementFromPoint(x, y);
      return { x: x, y: y, onTop: hit === e || (hit !== null && e.contains(hit)) };
    }, comp.opener);
    if (!geo.onTop) return { err: '点击坐标上不是那个按钮（在视口外或被遮住）' };
    await p.mouse.click(geo.x, geo.y);
  } else {
    await p.evaluate((s) => document.querySelector(s).click(), comp.opener);
  }

  /* 等"打开"这件事落地：轮询到 open 为止，最多 1.5 秒。
     不用固定 sleep —— 全量是 4 路并发跑的，固定 sleep 在负载下会偶发假红，
     而假红会让人学会忽略这道门禁（比没有门禁更糟）。 */
  let st2 = null;
  for (let i = 0; i < 18; i++) {
    st2 = await p.evaluate(readState, st);
    if (st2.open) break;
    await sleep(80);
  }
  await sleep(140);          /* 再给焦点一跳的时间（很多实现是 next frame 才移焦） */
  return p.evaluate(readState, st);
}

async function matrix(p, comps) {
  const out = [];
  for (const comp of comps) {
    const row = { id: comp.id, cells: {} };
    for (const path of PATHS) {
      const r = await activate(p, comp, path.id);
      row.cells[path.id] = r;
    }
    out.push(row);
  }
  return out;
}

function cellText(r) {
  if (r.err) return '⚠ ' + r.err;
  if (!r.open) return '🔴 没打开';
  if (!r.focusOk) return '🔴 打开了但焦点没进弹层（active=' + r.active + '）';
  return '✅';
}

function report(rows) {
  let bad = 0;
  console.log('  === 「打开」三路径（键盘 / 鼠标点击 / 读屏合成点击）===');
  console.log('  ' + '组件'.padEnd(10) + PATHS.map((x) => x.label.padEnd(14)).join(''));
  rows.forEach((row) => {
    const cells = PATHS.map((x) => cellText(row.cells[x.id]).padEnd(14)).join('');
    console.log('  ' + row.id.padEnd(10) + cells);
    PATHS.forEach((x) => {
      const r = row.cells[x.id];
      if (r.err) bad++;                     /* 前提不成立也算没验成 */
      else if (!r.open || !r.focusOk) bad++;
    });
    /* 三条路径的结果必须一致。不一致本身就是缺陷（同一件事两种结果），
       哪怕每种结果单独看都能自圆其说。 */
    const sigs = PATHS.map((x) => {
      const r = row.cells[x.id];
      return r.err ? 'err' : (r.open ? '1' : '0') + (r.focusOk ? '1' : '0');
    });
    if (new Set(sigs).size > 1) {
      console.log('  ' + ' '.repeat(10) + '🔴 三条路径结果不一致：' + sigs.join(' / '));
      bad++;
    }
  });
  return bad;
}

/* ---------------------------------------------------------------- 自检 ---- */
/* 一张故意写坏的夹具：四种触发实现，期望矩阵是**已知的**。
 * 判据只有在"该红的红了、该绿的绿了"时才算有牙。
 * 期望写成两个分量（o=开没开 / f=焦点进没进），而不是一个布尔：
 * 否则"没打开"和"打开了但没移焦"在自检里长得一样，判据说自己分得清就没根据。 */
const FIXTURE = '/05-audit/_opener-fixture.html';
const O = { o: 1, f: 1 }, N = { o: 0, f: 0 }, OF = { o: 1, f: 0 };
const EXPECT = {
  'f-ok': { kbd: O, mouse: O, at: O },
  'f-kbd': { kbd: O, mouse: N, at: N },
  'f-pointer': { kbd: N, mouse: O, at: N },
  'f-nofocus': { kbd: OF, mouse: OF, at: OF },
};

async function selftest() {
  const b = await launch();
  const p = await b.newPage();
  const comps = Object.keys(EXPECT).map((id) => ({
    id: id, url: FIXTURE, opener: '#' + id, popup: '#pop-' + id.slice(2),
    popupMode: 'selector', key: 'Enter', focus: 'inside',
  }));
  const rows = await matrix(p, comps);
  await b.close();

  let bad = 0;
  console.log('  === 自检：夹具上的期望矩阵（开没开 / 焦点进没进，两个分量分开比）===');
  rows.forEach((row) => {
    const exp = EXPECT[row.id];
    const diff = [];
    PATHS.forEach((x) => {
      const r = row.cells[x.id];
      const got = { o: r.open ? 1 : 0, f: r.focusOk ? 1 : 0 };
      if (got.o !== exp[x.id].o || got.f !== exp[x.id].f) {
        diff.push(x.label + ' 期望 ' + exp[x.id].o + '/' + exp[x.id].f +
                  ' 实得 ' + got.o + '/' + got.f);
      }
    });
    if (diff.length) bad++;
    console.log('  [' + (diff.length ? 'FAIL' : 'OK  ') + '] ' + row.id.padEnd(12) +
      diff.join('；'));
  });
  console.log(bad ? '\n  ❌ 自检失败：判据分不清这几条输入路径'
                  : '\n  ✅ 自检通过：该红的红了、该绿的绿了，两种失败也分得开');
  process.exit(bad ? 1 : 0);
}

/* ------------------------------------------------------------------ 主 ---- */
(async () => {
  /* 先确认 :8000 可用；不可用就 SKIP（RC=3） */
  let reachable = true;
  try {
    const probe = await launch();
    const p0 = await probe.newPage();
    await p0.goto(BASE + '/index.html', { timeout: 8000 });
    await probe.close();
  } catch (e) {
    reachable = false;
  }
  if (!reachable) {
    console.log('  SKIP  :8000 上没有本地静态服务 ⇒ 无法验证输入路径');
    console.log('        ⇒ check-all.sh 会自动起；单独跑请先起服务');
    process.exit(3);
  }

  if (process.argv.indexOf('--selftest') >= 0) return selftest();

  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 900, height: 700 });
  const rows = await matrix(p, COMPS);
  await b.close();

  const bad = report(rows);
  console.log('\n  ' + (bad ? '❌ ' + bad + ' 处没通过' : '✅ ' + (rows.length * PATHS.length) + ' 格全部一致'));
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error('  ERROR ' + String((e && e.message) || e));
  process.exit(2);
});
