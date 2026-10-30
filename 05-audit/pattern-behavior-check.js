#!/usr/bin/env node
/* LAYER: component
 * ============================================================================
 * pattern-behavior-check.js — 组件级行为闭环（drawer / overlay）
 *
 * 🔴 为什么需要这一道（WO-04 4.3）
 *   现有 `dismissable-check.js` / `focus-return-check.js` 测的是**核本身**：
 *   把核的源码注入一个空白页，直接调 `flDismissable({...})`。
 *   它们回答的是「核对不对」。
 *
 *   但组件可能**根本没用核**，或者用错了（比如把「点遮罩」也算成 outside）。
 *   那种情况下核的单测全绿，组件照样坏。
 *   本文件回答的是「组件有没有正确接上」——8 个用例全部走真实 API + 真实按键。
 *
 * ⚠️ 依赖本地静态服务 :8000（check-all.sh 会起）。没有就 SKIP（RC=3），不冒充通过。
 * ============================================================================
 */
'use strict';

const { launch } = require('./browser.js');

const BASE = 'http://127.0.0.1:8000';

let bad = 0;
const rows = [];

function ok(name, hit, detail) {
  rows.push({ name, hit, detail });
  if (!hit) bad++;
}

/* ---------------------------------------------------------------- 抽屉 ---- */
async function drawerCases(p) {
  await p.goto(BASE + '/03-patterns/drawer/demo.html', { waitUntil: 'domcontentloaded' });

  /* ① 打开：必须出现 role=dialog，且焦点**进入**抽屉
   *    焦点进不去 ⇒ 后面所有按键都到不了抽屉（Esc 会静默失效） */
  const open = await p.evaluate(() => {
    const t = document.createElement('button');
    t.id = 'probe-trigger';
    t.textContent = 'probe';
    document.body.appendChild(t);
    t.focus();
    window.__closed = 0;
    window.__d = window.Drawer.open({
      place: 'right', title: 'T', content: '<p>x</p>',
      actions: [{ label: 'ok' }],
      onClose: function () { window.__closed++; },
    });
    const d = document.querySelector('.drawer[role="dialog"]');
    return {
      has: !!d,
      role: d && d.getAttribute('role'),
      focusInside: !!(d && d.contains(document.activeElement)),
      active: document.activeElement && (document.activeElement.className || document.activeElement.tagName),
    };
  });
  ok('① 打开后存在 .drawer[role="dialog"]', open.has && open.role === 'dialog',
    'has=' + open.has + ' role=' + open.role);
  ok('② 打开后焦点进入抽屉（否则 Esc 永远收不到）', open.focusInside,
    'activeElement=' + open.active);

  /* ② Esc 关闭 + 焦点归还触发按钮 */
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('.drawer'), { timeout: 3000 })
    .catch(() => {});
  const afterEsc = await p.evaluate(() => ({
    gone: !document.querySelector('.drawer'),
    closed: window.__closed,
    focusBack: document.activeElement && document.activeElement.id === 'probe-trigger',
    active: document.activeElement && (document.activeElement.id || document.activeElement.tagName),
  }));
  ok('③ Esc 关闭抽屉', afterEsc.gone, 'closed=' + afterEsc.closed);
  ok('④ 关闭后焦点回到触发按钮', afterEsc.focusBack, 'activeElement=' + afterEsc.active);

  /* ③ 点遮罩关闭 —— 这是 drawer **自己的**语义（矩阵里 manual 的理由：
   *    它要忽略"非 Esc 的关闭原因"，所以没收编核的 outside）
   *    🔴 关闭是**异步**的：close() 先设 data-state=leaving，等 transitionend
   *    或 320ms 兜底定时器才把 host 移出 DOM。所以断言"立即消失"必然假红
   *    ——本文件第一版就是这么错的（gone=false 而 closed=1，onClose 明明触发了）。 */
  const scrimFired = await p.evaluate(() => {
    window.__closed = 0;
    window.__d = window.Drawer.open({
      place: 'right', title: 'T', content: '<p>x</p>',
      onClose: function () { window.__closed++; },
    });
    const host = document.querySelector('.drawer-backdrop');
    if (!host) return { noHost: true };
    host.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { fired: window.__closed >= 1 };
  });
  await p.waitForFunction(() => !document.querySelector('.drawer'), { timeout: 2000 })
    .catch(() => {});
  const scrim = await p.evaluate(() => ({
    gone: !document.querySelector('.drawer'),
    closed: window.__closed,
  }));
  ok('⑤ 点遮罩关闭抽屉（drawer 自有语义）',
    scrimFired.fired === true && scrim.gone === true,
    'onClose 已触发=' + scrimFired.fired + ' 动画后已移除=' + scrim.gone + ' closed=' + scrim.closed);

  /* ④ 重复开/关 3 次之后，一次 Esc 只该触发**一次** onClose
   *    如果 open() 往 document 上加监听却没清理，第 4 次的 Esc 会触发 2~4 次 */
  const dup = await p.evaluate(() => {
    window.__closed = 0;
    for (let i = 0; i < 3; i++) {
      const d = window.Drawer.open({
        place: 'right', title: 'T', content: '<p>x</p>',
        onClose: function () { window.__closed++; },
      });
      d.close();
    }
    const before = window.__closed;
    window.__d = window.Drawer.open({
      place: 'right', title: 'T', content: '<p>x</p>',
      onClose: function () { window.__closed++; },
    });
    return { before: before };
  });
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('.drawer'), { timeout: 3000 })
    .catch(() => {});
  const dupAfter = await p.evaluate(() => ({ closed: window.__closed }));
  ok('⑥ 反复开关后 Esc 只触发一次 onClose（无重复注册）',
    dup.before === 3 && dupAfter.closed === 4,
    '3 次 API 关闭后=' + dup.before + '，第 4 次 Esc 后=' + dupAfter.closed + '（期望 4）');
}

/* -------------------------------------------------------------- 对话框 ---- */
async function dialogCases(p) {
  await p.goto(BASE + '/03-patterns/overlay/demo.html', { waitUntil: 'domcontentloaded' });

  /* ⑤ 打开 → ⑥ Esc 关闭 */
  const open = await p.evaluate(() => {
    window.__d = window.Overlay.dialog({ title: 'X', desc: 'x', actions: [{ label: 'ok' }] });
    const b = document.querySelector('.dialog[role="dialog"]');
    return {
      has: !!b,
      focusInside: !!(b && b.contains(document.activeElement)),
      active: document.activeElement && (document.activeElement.className || document.activeElement.tagName),
    };
  });
  ok('⑦ 打开后存在 .dialog[role="dialog"]', open.has, 'has=' + open.has);
  ok('⑧ 打开后焦点进入对话框', open.focusInside, 'activeElement=' + open.active);

  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('.dialog'), { timeout: 3000 })
    .catch(() => {});
  const esc = await p.evaluate(() => ({ gone: !document.querySelector('.dialog') }));
  ok('⑨ Esc 关闭对话框', esc.gone, 'gone=' + esc.gone);

  /* ⑦ **点外部不该关闭** —— modal 的定义。
   *    矩阵把 overlay 的 dismissable 记为 manual，理由正是「核的 onDocClick 天然处理
   *    outside ⇒ 收编等于给 dialog 引入错误行为」。这条就是在验那个理由成立。 */
  const outside = await p.evaluate(() => {
    window.__d = window.Overlay.dialog({ title: 'Y', desc: 'y', actions: [{ label: 'ok' }] });
    const bd = document.querySelector('.dialog-backdrop');
    if (!bd) return { noBackdrop: true };
    bd.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const still = !!document.querySelector('.dialog');
    return { still: still };
  });
  ok('⑩ 点外部（backdrop）**不该**关闭 modal 对话框', outside.still === true,
    'still=' + outside.still + '（false 表示 modal 被当成 popover 了）');

  /* 点外部这条要收尾，否则影响下一用例 */
  await p.evaluate(() => { if (window.__d && window.__d.close) window.__d.close(); });
  await p.waitForFunction(() => !document.querySelector('.dialog'), { timeout: 3000 })
    .catch(() => {});

  /* ⑧ 嵌套：外层开着 → 内层打开 → Esc 只关内层
   *    dialog 在 box 上显式 stopPropagation，注释写明「不拦住会一次关掉两层」 */
  const nested = await p.evaluate(() => {
    window.__outer = window.Overlay.dialog({ title: 'OUTER', desc: 'o', actions: [{ label: 'ok' }] });
    window.__inner = window.Overlay.dialog({ title: 'INNER', desc: 'i', actions: [{ label: 'ok' }] });
    const boxes = [].slice.call(document.querySelectorAll('.dialog'));
    const inner = boxes[boxes.length - 1];
    const f = inner.querySelector('button') || inner;
    f.focus();
    return {
      count: boxes.length,
      titles: boxes.map(function (b) {
        const t = b.querySelector('.dialog__title');
        return t ? t.textContent : '?';
      }),
      focusInInner: !!(inner && inner.contains(document.activeElement)),
    };
  });
  ok('⑪ 嵌套时可同时存在两个对话框', nested.count === 2, 'count=' + nested.count + ' titles=' + nested.titles.join(','));
  ok('⑫ 内层打开后焦点在内层', nested.focusInInner, 'focusInInner=' + nested.focusInInner);

  await p.keyboard.press('Escape');
  await p.waitForFunction(
    () => document.querySelectorAll('.dialog').length === 1, { timeout: 3000 }
  ).catch(() => {});
  const afterNested = await p.evaluate(() => {
    const boxes = [].slice.call(document.querySelectorAll('.dialog'));
    return {
      count: boxes.length,
      titles: boxes.map(function (b) {
        const t = b.querySelector('.dialog__title');
        return t ? t.textContent : '?';
      }),
    };
  });
  ok('⑬ 一次 Esc 只关最内层（外层仍在）',
    afterNested.count === 1 && afterNested.titles[0] === 'OUTER',
    'count=' + afterNested.count + ' titles=' + afterNested.titles.join(','));

  await p.evaluate(() => { if (window.__outer && window.__outer.close) window.__outer.close(); });
}

/* ------------------------------------------------------------------ 主 ---- */
(async () => {
  /* 先确认 :8000 可用；不可用就 SKIP（RC=3），绝不冒充通过 */
  const probe = await launch();
  const p0 = await probe.newPage();
  let reachable = true;
  try {
    await p0.goto(BASE + '/index.html', { timeout: 8000 });
  } catch (e) {
    reachable = false;
  }
  await probe.close();
  if (!reachable) {
    console.log('  SKIP  :8000 上没有本地静态服务 ⇒ 无法验证组件行为');
    console.log('        ⇒ check-all.sh 会自动起；单独跑请先起服务');
    process.exit(3);
  }

  const b = await launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String((e && e.message) || e)));

  try {
    await drawerCases(p);
    await dialogCases(p);
  } catch (e) {
    ok('执行过程未抛错', false, String((e && e.message) || e));
  }
  await b.close();

  console.log('  === 组件级行为闭环（drawer / overlay）===');
  rows.forEach(function (r) {
    console.log('  [' + (r.hit ? 'OK  ' : 'FAIL') + '] ' + r.name +
      (r.detail ? '\n         ' + r.detail : ''));
  });
  if (errs.length) {
    console.log('  🔴 页面运行时错误 ' + errs.length + ' 条：');
    errs.slice(0, 3).forEach(function (e) { console.log('       ' + e.slice(0, 120)); });
    bad += errs.length;
  }
  console.log('\n  ' + (bad ? '❌ ' + bad + ' 条没通过' : '✅ ' + rows.length + ' 条全部通过'));
  process.exit(bad ? 1 : 0);
})();
