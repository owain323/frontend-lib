#!/usr/bin/env node
/* LAYER: component
 * ============================================================================
 * timeline-check.js — 时间轴：几何契约 / 语义契约 / 反向控制
 *
 * 🔴 为什么这个组件需要门禁
 *   它的失败方式**不会让页面崩**，而是「看起来像画错了」：
 *
 *     · 圆点直径一改（8 → 12），圆心没跟着走 ⇒ 连接线拐个弯，
 *       差 2px，说不清哪里不对，但一眼就是歪的。
 *     · 连接线用 `inset-block: 0` 画 ⇒ 第一条上方多出一小截悬空的线，
 *       看起来像「上面还有一个事件没渲染出来」。
 *     · 圆点纵向对齐整块的中心（而不是首行的中心）⇒ 正文一长，
 *       圆点就往下滑，同一屏里的几条圆点高低不齐。
 *     · 有人把圆点画成字符 `content: "●"` ⇒ 视觉一样，
 *       但可访问名变成「圆点 季报披露」（本库 E189 记过）。
 *
 *   四条都是「静态读代码看不出来、渲染出来要盯半天」的类型。
 *
 * 🔴 判据分三组
 *   A 语义：示范用 <ol>，但 CSS **只认类名**（div 也要能跑）
 *   B 几何：圆心 ↔ 轴线 ↔ 首行中心，三条线必须在同一点上
 *   C 反向控制：把前提破坏掉，对应判据必须变红
 *
 * ⚠️ 为什么 fixture **不引** page.css：本组件声称「不依赖全局重置」。
 *   引了 page.css 就等于把这条声称的前提删掉了 —— 那样量出来的绿是假的。
 * ========================================================================== */

'use strict';

const path = require('path');
const fs = require('fs');
const { launch } = require('./browser.js');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.FL_BASE || 'http://127.0.0.1:8000';

const FIXTURE = (light) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<link rel="stylesheet" href="${BASE}/01-tokens/tokens.css">
${light ? `<link rel="stylesheet" href="${BASE}/01-tokens/typography.css">` : ''}
<link rel="stylesheet" href="${BASE}/02-primitives/timeline/timeline.css">
<style>body{margin:0;font-family:system-ui,sans-serif}</style>
</head><body>
<ol class="timeline" id="tl">
  <li class="timeline__item timeline__item--latest">
    <time class="timeline__time" datetime="2026-10-29">2026-10-29</time>
    <h3 class="timeline__title">短正文</h3>
    <p class="timeline__body">一行。</p>
  </li>
  <li class="timeline__item">
    <time class="timeline__time" datetime="2026-10-28">2026-10-28</time>
    <h3 class="timeline__title">长正文</h3>
    <p class="timeline__body">${'这是一段刻意写得很长的正文，用来证明圆点不会跟着内容往下滑。'.repeat(4)}</p>
  </li>
  <li class="timeline__item">
    <time class="timeline__time" datetime="2026-10-27">2026-10-27</time>
    <h3 class="timeline__title">无正文</h3>
  </li>
</ol>
<ol class="timeline timeline--compact" id="cp">
  <li class="timeline__item"><time class="timeline__time" datetime="2026-10-29">10-29</time><h3 class="timeline__title">紧凑</h3></li>
</ol>
<div class="timeline" id="dv">
  <div class="timeline__item"><span class="timeline__time">10-29</span><span class="timeline__title">div 版</span></div>
</div>
</body></html>`;

const rows = [];
function add(id, label, ok, detail) {
  rows.push({ id, label, ok: !!ok, detail });
}

/* 页面内：量一个列表的几何 */
const PROBE = (sel) => {
  const list = document.querySelector(sel);
  const items = [...list.querySelectorAll('.timeline__item')];
  return items.map((li) => {
    const dot = getComputedStyle(li, '::after');
    const line = getComputedStyle(li, '::before');
    const time = li.querySelector('.timeline__time');
    const tcs = time ? getComputedStyle(time) : null;
    const lh = tcs ? parseFloat(tcs.lineHeight) : 0;
    const fs = tcs ? parseFloat(tcs.fontSize) : 0;
    const num = (v) => parseFloat(v) || 0;
    const dotW = num(dot.width);
    const dotH = num(dot.height);
    // inset-inline-start 在 LTR 下等于 left；用 left 更直白
    const dotLeft = num(dot.left);
    const lineLeft = num(line.left);
    return {
      dotCx: dotLeft + dotW / 2,
      dotCy: num(dot.top) + dotH / 2,
      dotW,
      lineCx: lineLeft + num(line.width) / 2,
      lineTop: num(line.top),
      hasLine: line.content !== 'none' && num(line.width) > 0,
      firstLineCx: lh ? lh / 2 : fs * 0.6,
      padEnd: num(getComputedStyle(li).paddingBottom),
      label: (li.textContent || '').trim().slice(0, 6),
    };
  });
};

(async () => {
  const b = await launch({});
  const p = await b.newPage();
  await p.setViewport({ width: 720, height: 900 });
  /* 🔴 必须**先导航到同源的真页面**再 setContent。
     `about:blank` 是不透明源，外链 <link rel=stylesheet> 会被浏览器拦掉
     （实测 net::ERR_FAILED，而 getComputedStyle 全员返回 0 —— 于是
     B1「圆心都等于 0」这种判据会假绿）。 */
  const nav = await p.goto(BASE + '/02-primitives/timeline/demo.html',
    { waitUntil: 'load', timeout: 20000 });
  if (!nav || !nav.ok()) {
    console.error('  [FAIL] 打不开 ' + BASE + '（先起 python3 05-audit/http-serve.py 8000）');
    process.exit(1);
  }
  await p.setContent(FIXTURE(true), { waitUntil: 'load' });
  await p.evaluate(() => document.fonts && document.fonts.ready);

  /* 🔴 G0 前提：样式真的生效了才谈几何。
     第一版没有这一条，而样式因为上面的源问题**整份没加载** ——
     结果 B4/B5 在「所有值都是 0」的状态下**通过**了。零值上的相等不是相等。 */
  const g0 = await p.evaluate(() => {
    const list = document.querySelector('#tl');
    // 取**第二条**：第一条是 --latest（12px），拿它当基准会一直差 4px
    const li = list.querySelectorAll('.timeline__item')[1];
    return {
      sheets: document.styleSheets.length,
      dotVar: getComputedStyle(list).getPropertyValue('--tl-dot').trim(),
      dotW: parseFloat(getComputedStyle(li, '::after').width) || 0,
    };
  });
  if (!(g0.sheets >= 2 && g0.dotVar === '8px' && g0.dotW === 8)) {
    console.error('  [FAIL] G0 前提不成立：样式没加载全（sheets=' + g0.sheets +
      ' --tl-dot="' + g0.dotVar + '" 圆点=' + g0.dotW + 'px）');
    console.error('        后面的几何判据在这个状态下的「通过」没有意义，直接退出。');
    await b.close();
    process.exit(1);
  }

  const g = await p.evaluate(PROBE, '#tl');
  const close = (a, b2, tol) => Math.abs(a - b2) <= (tol === undefined ? 0.75 : tol);

  /* ---- A 语义 ---- */
  // A1 读文件：demo 必须是 <ol>（示范正确语义），不是 <div>
  const demo = fs.readFileSync(path.join(ROOT, '02-primitives/timeline/demo.html'), 'utf8');
  const olCount = (demo.match(/<ol class="timeline/g) || []).length;
  const divTl = (demo.match(/<div class="timeline/g) || []).length;
  add('A1', 'demo 里每个时间轴都是 <ol>（顺序即信息；div 堆出来的在无障碍树里没有「第 N 项」）',
    olCount >= 3 && divTl === 0, `<ol class="timeline"> ${olCount} 处 / <div class="timeline"> ${divTl} 处`);

  // A2 CSS 只认类名：换成 div 也要能画
  const dv = await p.evaluate(PROBE, '#dv');
  add('A2', 'CSS 只认类名：<div class="timeline"> 同样画出圆点（8px）与连接线',
    dv.length === 1 && dv[0].dotW === 8 && !dv[0].hasLine,
    JSON.stringify(dv[0]));

  // A3 紧凑档只压间距，不缩字号/圆点
  const cp = await p.evaluate((sel) => {
    const li = document.querySelector(sel + ' .timeline__item');
    return {
      dotW: parseFloat(getComputedStyle(li, '::after').width),
      fs: parseFloat(getComputedStyle(li.querySelector('.timeline__title')).fontSize),
      padEnd: parseFloat(getComputedStyle(li).paddingBottom),
    };
  }, '#cp');
  const baseFs = await p.evaluate(() => parseFloat(getComputedStyle(
    document.querySelector('#tl .timeline__title')).fontSize));
  add('A3', '紧凑档只收间距：字号与圆点不变（缩字号 = 承认这块内容不重要，而事实相反）',
    cp.fs === baseFs && cp.dotW === 8, `紧凑 fs=${cp.fs} 常规 fs=${baseFs} 圆点=${cp.dotW}`);

  /* ---- B 几何 ---- */
  const cx = g.map((r) => r.dotCx);
  add('B1', '三条（含 --latest 的 12px）圆心在同一条竖线上 —— 否则连接线会在这一条拐弯',
    g.every((r) => r.dotW > 0) && Math.max(...cx) - Math.min(...cx) <= 0.75,
    g.map((r) => r.label + ' 圆心x=' + r.dotCx.toFixed(2) + ' 直径=' + r.dotW).join(' · '));

  add('B2', '连接线中心与圆心重合（左右各让一半，不是各自算一遍）',
    g.every((r) => !r.hasLine || close(r.lineCx, r.dotCx)),
    g.filter((r) => r.hasLine).map((r) => '线' + r.lineCx.toFixed(2) + '/点' + r.dotCx.toFixed(2)).join(' · '));

  add('B3', '圆点纵向对齐**首行时间**的中心，不是整块的中心（正文长短不影响）',
    g.every((r) => close(r.dotCy, r.firstLineCx, 1)),
    g.map((r) => r.label + ' 圆心y=' + r.dotCy.toFixed(2) + ' 首行中心=' + r.firstLineCx.toFixed(2)).join(' · '));

  add('B4', '连接线从自己的圆心开始（第一条上方不许有悬空的一截）',
    close(g[0].lineTop, g[0].dotCy, 1),
    `首条 线顶=${g[0].lineTop.toFixed(2)} 圆心=${g[0].dotCy.toFixed(2)}`);

  add('B5', '最后一条没有连接线、也没有底部留白（否则像「还有一个事件没加载」）',
    !g[g.length - 1].hasLine && g[g.length - 1].padEnd === 0,
    `末条 hasLine=${g[g.length - 1].hasLine} padEnd=${g[g.length - 1].padEnd}`);

  /* ---- C 反向控制 ---- */
  const inject = async (css) => {
    await p.evaluate((c) => {
      const s = document.createElement('style');
      s.id = 'probe';
      s.textContent = c;
      document.head.appendChild(s);
    }, css);
  };
  const drop = async () => p.evaluate(() => {
    const s = document.getElementById('probe');
    if (s) s.remove();
  });

  /* ⚠️ 不能拿 `--tl-axis` 当反向控制：它是**整体平移**，圆点和线会一起走，
     差永远是 0。第一版就是这么写的，于是「破坏了前提」的那条判据自己不会红。 */
  /* ⚠️ 选择器必须**不弱于**被覆盖的那条：组件的规则是
     `.timeline__item:not(:last-child)::before`（0,2,1），
     只写 `.timeline__item::before`（0,1,1）会被压住 —— 注入静默失效，
     判据看到的是「没变化」，而它会把这件事记成"破坏不了"。
     这是反向控制最阴的一种失败：**探针自己没生效，却报告"防线很稳"**。 */
  await inject('.timeline__item:not(:last-child)::before { inset-inline-start: 6px; }');
  const gAxis = await p.evaluate(PROBE, '#tl');
  add('C1', '反向：只把连接线挪 2px ⇒ 线心与圆心分离（B2 会因此变红）',
    gAxis.some((r) => r.hasLine && Math.abs(r.lineCx - r.dotCx) > 1),
    gAxis.filter((r) => r.hasLine).map((r) => '差' + (r.lineCx - r.dotCx).toFixed(1)).join(' · '));
  await drop();

  /* C4 正着来一次：改轴线，两边必须**一起**跟着走 ——
     证明圆心和线心是从同一个数派生的，不是各写了一遍。 */
  await inject('.timeline { --tl-axis: 6px; }');
  const gMove = await p.evaluate(PROBE, '#tl');
  add('C4', '改 --tl-axis（4→6px）：圆点与连接线一起平移 2px，且仍然重合',
    gMove.every((r) => Math.abs(r.dotCx - 6) <= 0.75 && !r.hasLine || Math.abs(r.lineCx - r.dotCx) <= 0.75),
    gMove.map((r) => '点' + r.dotCx.toFixed(1) + '/线' + (r.hasLine ? r.lineCx.toFixed(1) : '-')).join(' · '));
  await drop();

  await inject('.timeline__item::before { content: ""; position: absolute; inset-block: 0;' +
    ' inset-inline-start: 3px; width: 2px; background: currentColor; }');
  const gAll = await p.evaluate(PROBE, '#tl');
  add('C2', '反向：去掉 :not(:last-child) ⇒ 最后一条也长出连接线（B5 会因此变红）',
    gAll[gAll.length - 1].hasLine,
    `末条 hasLine=${gAll[gAll.length - 1].hasLine}`);
  await drop();

  await inject('.timeline__time { line-height: 1.1; }');
  const gLh = await p.evaluate(PROBE, '#tl');
  add('C3', '反向：时间行高改成 1.1 ⇒ 圆心不再对首行中心（B3 会因此变红）',
    gLh.some((r) => Math.abs(r.dotCy - r.firstLineCx) > 1.5),
    gLh.map((r) => '偏' + (r.dotCy - r.firstLineCx).toFixed(1)).join(' · '));
  await drop();

  /* ---- D 强制色 ---- */
  const cdp = await p.target().createCDPSession();
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'forced-colors', value: 'active' }],
  });
  /* ⚠️ 不能 `p.reload()`：这一页是 `setContent` 给的，没有 URL，
     刷新会回到 about:blank（本库 E183 记过同一件事）。重新灌一次。 */
  await p.goto(BASE + '/02-primitives/timeline/demo.html', { waitUntil: 'load' });
  await p.setContent(FIXTURE(true), { waitUntil: 'load' });
  const fc = await p.evaluate(() => {
    const li = document.querySelector('#tl .timeline__item');
    const dot = getComputedStyle(li, '::after');
    const line = getComputedStyle(li, '::before');
    return {
      dot: dot.backgroundColor,
      line: line.backgroundColor,
      page: getComputedStyle(document.body).backgroundColor,
      dotW: parseFloat(dot.width),
    };
  });
  add('D1', '强制色：圆点与连接线都不是背景色（作者色会被替换掉，系统色不会）',
    fc.dot !== fc.page && fc.line !== fc.page && fc.dotW > 0,
    `点=${fc.dot} 线=${fc.line} 底=${fc.page}`);

  await b.close();

  /* ---- 汇总 ---- */
  const GROUPS = {
    A1: '语义·ol', A2: '语义·只认类名', A3: '紧凑档',
    B1: '几何·圆心', B2: '几何·线心', B3: '几何·首行', B4: '几何·起点', B5: '几何·收尾',
    C1: '反向·线错位', C4: '派生·轴线', C2: '反向·末条', C3: '反向·行高',
    D1: '强制色',
  };
  let fail = 0;
  console.log('  === timeline：几何 / 语义 / 反向 ===');
  for (const r of rows) {
    console.log('  ' + (r.ok ? '[OK]' : '[--]') + ' ' + r.id.padEnd(3) +
      ' ' + (GROUPS[r.id] || ''));
    if (!r.ok) {
      fail += 1;
      console.log('        ✗ ' + r.label);
      if (r.detail) console.log('          ' + String(r.detail).slice(0, 180));
    }
  }
  console.log(fail ? `  ⇒ ${fail} 项未通过` : '  ✅ 全部通过：圆心/线心/首行中心三点重合，末条收干净，强制色不丢信息');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("  [FAIL] 跑不起来：" + e.message);
  process.exit(1);
});
