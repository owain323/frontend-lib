#!/usr/bin/env node
/* LAYER: component
 * ============================================================================
 * app-shell-check.js — 应用外壳：布局契约 / 窄屏退化 / 两个坑的回归
 *
 * 🔴 为什么这个组件需要门禁
 *   它的失败方式**不是**"看起来坏了"，是"看起来完全正常，但某类用户用不了"：
 *
 *     · 主区少了 `min-width: 0` ⇒ 1280px 屏幕上一切正常，
 *       数据表多两列之后整页横滚。你会先怀疑表格，不会怀疑外壳。
 *     · 侧栏用 `position: fixed` ⇒ 桌面看着一模一样，
 *       RTL 下侧栏跑到右边而主区仍在右边留白。
 *     · 高度用 `100vh` ⇒ 桌面永远看不出问题，只有手机地址栏展开时底部被裁。
 *
 *   三条都是"在开发者的屏幕上绿、在用户的屏幕上红"。所以判据必须在
 *   **缩小视口 / 塞宽内容 / 换方向** 的条件下量，而不是量默认状态。
 *
 * 🔴 判据分四组
 *   A 结构：三段式真的成立（不是三个浮盒子）
 *   B 布局契约：min-width / sticky / 滚动容器
 *   C 窄屏：768px 以下侧栏收走且页面不横滚
 *   D 反向控制：破坏每条前提，对应判据必须变红
 *
 * ⚠️ 为什么不用 demo 页当 fixture：demo 里为了截图给 `.shell` 加了固定高度
 *    （`min-height: 26rem`），那会盖掉 `100dvh`。判据要量的是**默认形态**。
 * ========================================================================== */

'use strict';

const path = require('path');
const fs = require('fs');
const { launch } = require('./browser.js');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.FL_BASE || 'http://127.0.0.1:8000';

const FIXTURE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<link rel="stylesheet" href="${BASE}/01-tokens/tokens.css">
<link rel="stylesheet" href="${BASE}/01-tokens/typography.css">
<link rel="stylesheet" href="${BASE}/01-tokens/page.css">
<link rel="stylesheet" href="${BASE}/04-recipes/app-shell/app-shell.css">
<style>body{margin:0;font:14px/1.5 sans-serif}</style>
</head><body>

<div class="shell" id="s1">
  <header class="shell__topbar" id="topbar">
    <h1 class="shell__title">标题</h1>
    <div class="shell__topbar-end"><span>已同步</span></div>
  </header>
  <nav class="shell__side" id="side" aria-label="主导航">
    <a class="shell__brand" href="#">品牌</a>
    <ul class="shell__side-group">
      <li><a class="shell__link" id="cur" href="#" aria-current="page">总览</a></li>
      <li><a class="shell__link" href="#">实体</a></li>
    </ul>
  </nav>
  <main class="shell__main" id="main">
    <!-- 宽内容放在 .shell__content **外面**：正文栏宽（--measure-page）本身会限制
         "内容能不能撑破主区"，放进里面就测不出 min-width: 0 的作用了。 -->
    <div class="shell__scroll"><div id="wide" style="min-width:80rem;height:20px;background:#eee">宽内容 80rem</div></div>
    <div class="shell__content">
      <div style="height:1400px;background:#f6f6f6">很高的内容（让页面能滚）</div>
    </div>
  </main>
</div>

<!-- 看板变体：只有主区滚 -->
<div class="shell shell--scroll-main" id="s2" style="margin-top:40px">
  <header class="shell__topbar" id="topbar2"><h1 class="shell__title">看板</h1></header>
  <nav class="shell__side" id="side2" aria-label="看板导航">
    <a class="shell__link" href="#" aria-current="page">看板</a>
  </nav>
  <main class="shell__main" id="main2">
    <div class="shell__content"><div style="height:1400px;background:#fafafa">内容</div></div>
  </main>
</div>

</body></html>`;

/* ---------------------------------------------------------------- 探针 */

const PROBE = {
  /* 一次取齐：三段式的尺寸、sticky、滚动配置 */
  shell: (id) => {
    const s = document.getElementById(id);
    const side = s.querySelector('.shell__side');
    const top = s.querySelector('.shell__topbar');
    const main = s.querySelector('.shell__main');
    const cs = (el) => getComputedStyle(el);
    const r = (el) => el.getBoundingClientRect();
    return {
      shellW: Math.round(r(s).width),
      shellH: Math.round(r(s).height),
      sideW: Math.round(r(side).width),
      sideH: Math.round(r(side).height),
      topH: Math.round(r(top).height),
      mainW: Math.round(r(main).width),
      mainH: Math.round(r(main).height),
      sidePos: cs(side).position,
      sideAlignSelf: cs(side).alignSelf,
      sideOverflowY: cs(side).overflowY,
      sideMaxH: cs(side).maxHeight,
      sideDisplay: cs(side).display,
      topPos: cs(top).position,
      mainOverflowY: cs(main).overflowY,
      shellOverflow: cs(s).overflow,
      docScrollW: document.documentElement.scrollWidth,
      winW: window.innerWidth,
      winH: window.innerHeight,
    };
  },

  /* 当前项的三条线索 */
  current: () => {
    const a = document.getElementById('cur');
    const cs = getComputedStyle(a);
    return {
      ariaCurrent: a.getAttribute('aria-current'),
      fontWeight: cs.fontWeight,
      bg: cs.backgroundColor,
      shadow: cs.boxShadow,
      borderStartW: cs.borderInlineStartWidth,
      borderStartColor: cs.borderInlineStartColor,
      navLabel: a.closest('nav').getAttribute('aria-label'),
    };
  },

  /* 反例改造 ①：只去掉滚动容器的 overflow（模拟"忘了包 .shell__scroll"） */
  killScroller: () => {
    const w = document.querySelector('#main .shell__scroll');
    if (w) w.style.overflowX = 'visible';
    return {
      docScrollW: document.documentElement.scrollWidth,
      winW: window.innerWidth,
      mainW: Math.round(document.getElementById('main').getBoundingClientRect().width),
    };
  },

  /* 反例改造 ②：把轨道从 `minmax(0, 1fr)` 换成 `1fr`（= 轨道的最小值退回 auto）。
     此时**只有** `.shell__main { min-width: 0 }` 还能兜住 —— 用来证明它真的在起作用。 */
  dropMinmax: () => {
    const s = document.getElementById('s1');
    s.style.gridTemplateColumns = '15rem 1fr';
    const m = document.getElementById('main');
    return {
      mainW: Math.round(m.getBoundingClientRect().width),
      avail: window.innerWidth - Math.round(document.getElementById('side').getBoundingClientRect().width),
      minWidth: getComputedStyle(m).minWidth,
    };
  },

  /* 反例改造 ③：再把 `min-width: 0` 也去掉（两个保险都拆掉） */
  killMinWidth: () => {
    const m = document.getElementById('main');
    m.style.minWidth = 'auto';
    return {
      mainW: Math.round(m.getBoundingClientRect().width),
      minWidth: getComputedStyle(m).minWidth,
    };
  },

  /* 反例改造：侧栏改 fixed */
  makeFixed: () => {
    const s = document.getElementById('side');
    s.style.position = 'fixed';
    s.style.insetBlockStart = '0';
    s.style.insetInlineStart = '0';
    return getComputedStyle(s).position;
  },
};

/* ---------------------------------------------------------------- 主流程 */

(async () => {
  const rows = [];
  const add = (group, label, ok, note) => rows.push({ group, label, ok: !!ok, note: note || '' });

  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 900 });

  /* E172：先确认 8000 上是门禁服务器（不是给人看 demo 的单线程那个） */
  const alive = await p.goto(BASE + '/04-recipes/app-shell/demo.html',
    { waitUntil: 'domcontentloaded', timeout: 15000 })
    .then(() => p.evaluate(() => document.title)).catch(() => '');
  if (!alive) {
    console.error('  ❌ 服务不可达：' + BASE + '（先用 python 05-audit/http-serve.py 8000 起服务）');
    process.exit(2);
  }

  await p.setContent(FIXTURE, { waitUntil: 'load', timeout: 20000 });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.evaluate(() => {
    document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) {} });
  });

  /* ==========================================================================
   * A 组 · 结构（三段式真的成立）
   * ========================================================================== */
  const s1 = await p.evaluate(PROBE.shell, 's1');

  add('A1', '三段式真的成立：侧栏有宽、顶栏有高、主区占剩余宽',
    s1.sideW > 100 && s1.topH > 30 && s1.mainW > 0 &&
    Math.abs(s1.sideW + s1.mainW - s1.shellW) <= 1,
    'shell=' + s1.shellW + ' · side=' + s1.sideW + ' + main=' + s1.mainW +
    ' = ' + (s1.sideW + s1.mainW) + ' · topbar h=' + s1.topH);

  const cur = await p.evaluate(PROBE.current);
  add('A2', '当前页用 aria-current="page"（不是只有 class）',
    cur.ariaCurrent === 'page',
    'aria-current=' + cur.ariaCurrent);

  add('A3', '当前页有三条线索（竖条 + 底色 + 字重），不只靠颜色',
    parseFloat(cur.fontWeight) >= 500 && cur.shadow !== 'none' && cur.bg !== 'rgba(0, 0, 0, 0)',
    '字重=' + cur.fontWeight + ' 底色=' + cur.bg + ' 竖条=' + (cur.shadow !== 'none' ? '有' : '无'));

  add('A4', '侧栏是带名字的 <nav>（页面上可能还有第二个 nav）',
    !!cur.navLabel,
    'aria-label="' + cur.navLabel + '"');

  /* ==========================================================================
   * B 组 · 布局契约
   * ========================================================================== */

  /* B1 主区不被撑破（= min-width: 0 生效）。
     🔴 与 B1b 是**两件**事，必须分开判：
        · 缺 min-width: 0 ⇒ grid 轨道被内容的最小宽度顶开，主区变宽、侧栏被挤走
        · 缺 .shell__scroll ⇒ 主区宽度正常，但内容溢出到页面上，整页横滚
        两者症状都是"横滚"，但病灶不同，修法也不同 —— 合在一条里会让
        "改对一个、另一个还坏"也显示绿。 */
  add('B1', '主区不被 80rem 宽内容撑破（min-width: 0 生效，轨道不被顶开）',
    s1.mainW <= s1.shellW - s1.sideW + 1,
    'main=' + s1.mainW + ' ≤ 可用 ' + (s1.shellW - s1.sideW));

  add('B1b', '页面不横滚（宽内容落在 .shell__scroll 里自己滚）',
    s1.docScrollW <= s1.winW,
    'docScrollW=' + s1.docScrollW + ' vs winW=' + s1.winW);

  /* B2 侧栏 sticky + align-self: start（缺一不可，缺了粘不住） */
  add('B2', '侧栏 sticky 且 align-self: start（stretch 会让"粘住"无从谈起）',
    s1.sidePos === 'sticky' && s1.sideAlignSelf === 'start',
    'position=' + s1.sidePos + ' align-self=' + s1.sideAlignSelf);

  /* B3 侧栏自己滚 */
  add('B3', '侧栏自己滚（max-height + overflow-y: auto），不把主区一起滚走',
    s1.sideOverflowY === 'auto' && s1.sideMaxH !== 'none',
    'overflow-y=' + s1.sideOverflowY + ' max-height=' + s1.sideMaxH);

  /* B4 顶栏 sticky */
  add('B4', '顶栏 sticky（长表单滚到一半还看得见"保存"）',
    s1.topPos === 'sticky',
    'position=' + s1.topPos);

  /* B5 滚动落在页面而不是主区（默认形态） */
  add('B5', '默认形态：滚动由页面承担，主区不自己滚',
    s1.mainOverflowY === 'visible' && s1.shellOverflow === 'visible',
    'main overflow-y=' + s1.mainOverflowY + ' · shell overflow=' + s1.shellOverflow);

  /* B6 看板变体：反过来，只有主区滚 */
  const s2 = await p.evaluate(PROBE.shell, 's2');
  add('B6', '看板变体：只有主区滚（侧栏与顶栏不滚），且 shell 自己锁住高度',
    s2.mainOverflowY === 'auto' && s2.shellOverflow === 'hidden' &&
    s2.sidePos === 'static' && s2.topPos === 'static',
    'main overflow-y=' + s2.mainOverflowY + ' · shell overflow=' + s2.shellOverflow +
    ' · side=' + s2.sidePos + ' · topbar=' + s2.topPos);

  /* B7 dvh 顺序：文本判据（dvh 必须在 vh 之后，否则退化）。
     ⚠️ 计算样式量不出来 —— `min-height: 100vh` 和 `100dvh` 在桌面浏览器上
        解析成同一个数，只有"顺序"能表达意图。所以这条必须读源码。 */
  const cssText = fs.readFileSync(path.join(ROOT, '04-recipes/app-shell/app-shell.css'), 'utf-8');
  const iVh = cssText.indexOf('min-height: 100vh;');
  const iDvh = cssText.indexOf('min-height: 100dvh;');
  add('B7', 'dvh 兜底写在 vh **之后**（反了就在不支持的引擎上永远走 dvh 的无效行）',
    iVh >= 0 && iDvh > iVh,
    'vh 在第 ' + (iVh + 1) + ' 字符 · dvh 在第 ' + (iDvh + 1) + ' 字符' +
    (iDvh > iVh ? ' · 顺序正确' : ' · ⚠️ 顺序反了'));

  /* ==========================================================================
   * C 组 · 窄屏退化
   * ========================================================================== */
  await p.setViewport({ width: 375, height: 700 });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const n1 = await p.evaluate(PROBE.shell, 's1');

  add('C1', '窄屏（375px）：侧栏整列收走',
    n1.sideDisplay === 'none',
    'display=' + n1.sideDisplay + ' · sideW=' + n1.sideW);

  add('C2', '窄屏：主区铺满且**不横滚**（收走侧栏不只是 display:none，列也要变成一列）',
    n1.docScrollW <= n1.winW && n1.mainW > 0,
    'docScrollW=' + n1.docScrollW + ' vs winW=' + n1.winW + ' · main=' + n1.mainW);

  add('C3', '窄屏：顶栏还在（导航收走不能连标题一起没了）',
    n1.topH > 30,
    'topbar h=' + n1.topH);

  /* 返回宽屏，确认侧栏回来 */
  await p.setViewport({ width: 1280, height: 900 });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const w1 = await p.evaluate(PROBE.shell, 's1');
  add('C4', '宽屏恢复：侧栏回到 15rem（不是"缩窄过就回不来了"）',
    w1.sideDisplay !== 'none' && w1.sideW > 100,
    'display=' + w1.sideDisplay + ' sideW=' + w1.sideW);

  /* ==========================================================================
   * D 组 · 强制色
   * ========================================================================== */
  const cdp = await p.target().createCDPSession();
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'forced-colors', value: 'active' }],
  });
  await p.evaluate(() => {
    document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) {} });
  });
  const fc = await p.evaluate(PROBE.current);

  add('D1', '强制色：当前项靠实色边框区分（inset 阴影在强制色下被整个移除）',
    parseFloat(fc.borderStartW) >= 1 && fc.borderStartColor !== 'rgba(0, 0, 0, 0)',
    'border-inline-start=' + fc.borderStartW + ' ' + fc.borderStartColor);

  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await p.evaluate(() => {
    document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) {} });
  });

  /* ==========================================================================
   * E 组 · 反向控制
   * ========================================================================== */

  /* E1 只去掉滚动容器 ⇒ 页面横滚（B1b 会红），但主区宽度不变（B1 仍绿）
     —— 这正是"两者是两件事"的证据。 */
  const e1 = await p.evaluate(PROBE.killScroller);
  add('E1', '反向：只去掉 .shell__scroll 的 overflow ⇒ 页面横滚（B1b 红），主区宽度不变（B1 仍绿）',
    e1.docScrollW > e1.winW && e1.mainW <= w1.shellW - w1.sideW + 1,
    'docScrollW=' + e1.docScrollW + ' > winW=' + e1.winW +
    ' · main 仍=' + e1.mainW + '（没被撑破）⇒ 两条判据各自独立');

  /* E1b 只改轨道（去掉 minmax） ⇒ min-width: 0 单独就能兜住。
     🔴 这一条是 B1 之所以值得写的证据：证明 `.shell__main { min-width: 0 }`
        不是"抄来的样板"，它确实在 `git` 之外独立挡着一次真实的撑破。 */
  const e1b = await p.evaluate(PROBE.dropMinmax);
  add('E1b', '反向：轨道换成 `1fr`（去掉 minmax(0,…)）⇒ min-width: 0 单独兜住，主区仍不被撑破',
    e1b.mainW <= (await p.evaluate(() => window.innerWidth)) - 240 + 1 && e1b.minWidth === '0px',
    '轨道无 minmax 时 main=' + e1b.mainW + '（min-width=' + e1b.minWidth + '）⇒ 没被顶开');

  /* E1c 两个保险都拆掉 ⇒ 主区被撑破（B1 红） */
  const e1c = await p.evaluate(PROBE.killMinWidth);
  add('E1c', '反向：再把 min-width 也去掉 ⇒ 主区被撑破（B1 红）',
    e1c.mainW > 1040 + 1,
    'main=' + e1c.mainW + ' > 可用 1040（min-width=' + e1c.minWidth + '）⇒ 轨道被内容顶开');

  /* E2 侧栏改 fixed ⇒ position 不再是 sticky（B2 会红） */
  const e2 = await p.evaluate(PROBE.makeFixed);
  add('E2', '反向：侧栏改 position: fixed ⇒ B2 的 sticky 判据会判失败',
    e2 === 'fixed',
    'position=' + e2);

  /* E3 窄屏下强行让侧栏可见 ⇒ 主区被挤窄（C1 会红） */
  await p.setViewport({ width: 375, height: 700 });
  const e3 = await p.evaluate(() => {
    const s = document.getElementById('side');
    s.style.display = 'flex';           /* 强行让它回来，模拟"忘了写窄屏规则" */
    const r = s.getBoundingClientRect();
    return { display: getComputedStyle(s).display, w: Math.round(r.width) };
  });
  add('E3', '反向：窄屏下强行显示侧栏 ⇒ C1 会判失败（display 不再是 none）',
    e3.display !== 'none' && e3.w > 0,
    'display=' + e3.display + ' 宽=' + e3.w + ' ⇒ 375px 视口里挤掉一大块');

  await b.close();

  /* ==========================================================================
   * 输出
   * ========================================================================== */
  const GROUPS = {
    A1: '结构·三段式', A2: '结构·aria-current', A3: '结构·三条线索', A4: '结构·nav 名字',
    B1: '契约·min-width', B1b: '契约·滚动容器', B2: '契约·sticky', B3: '契约·侧栏自滚', B4: '契约·顶栏 sticky',
    B5: '契约·默认滚动', B6: '契约·看板变体', B7: '契约·dvh 顺序',
    C1: '窄屏·侧栏收走', C2: '窄屏·不横滚', C3: '窄屏·顶栏保留', C4: '窄屏·宽屏恢复',
    D1: '强制色·当前项',
    E1: '反向·滚动容器', E1b: '反向·minmax 兜底', E1c: '反向·两个保险都拆', E2: '反向·sticky', E3: '反向·侧栏收走',
  };

  let bad = 0;
  let last = '';
  console.log('  === app-shell：三段式 / min-width / sticky / 窄屏退化 ===');
  console.log('  引擎 chromium / ' + BASE);
  console.log('');
  rows.forEach((row) => {
    if (row.group.slice(0, 1) !== last) {
      console.log('  -- ' + row.group.slice(0, 1) + ' 组 ' + (GROUPS[row.group] || '') + ' --');
      last = row.group.slice(0, 1);
    }
    if (!row.ok) bad++;
    console.log('  [' + (row.ok ? 'OK  ' : 'FAIL') + '] ' + row.label);
    console.log('        ' + row.note);
  });
  console.log('');
  console.log(bad
    ? '  ❌ ' + bad + ' 条不满足'
    : '  ✅ 全部满足：三段式成立、主区不被撑破、侧栏粘住且自滚、窄屏侧栏收走不横滚');
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
