#!/usr/bin/env node
/* LAYER: component
 * ============================================================================
 * container-query-check.js — 组件按「槽宽」自适应，而不是按「视口宽」
 *
 * 🔴 为什么需要这一道
 *   全库 44 个 CSS 文件里 `@container` 曾经是 0 处，断点全是 `@media`。
 *   有一类真实布局因此是错的，而且**在库自己的 demo 里永远测不出来**：
 *
 *     · 1440px 页面上，右侧 320px 栏里放 `.card--row`
 *       ⇒ 视口很宽，`@media (max-width: 560px)` 不触发 ⇒ 卡片保持横排，
 *         160px 图 + 160px 文字，标题折三行。
 *     · 同一个页面上，报告被放进 700px 的阅读栏
 *       ⇒ 视口 ≥1024，硬排 `1fr + 15rem`，正文每行七八个字。
 *
 *   症状不在组件里，在**拿错了参考系**：视口宽度不是组件所在槽位的宽度。
 *
 * 🔴 判据的三条，缺一条这个结论就站不住
 *   ① 槽窄 + 视口宽 ⇒ 必须切换（证明它看的是槽）
 *   ② 槽宽 + 视口宽 ⇒ 不许切换（证明它不是"见到容器就切换"）
 *   ③ **没有** `[data-cq]` ⇒ 行为与 0.15.0 完全一致（证明它是 opt-in，
 *      没有偷偷改变既有页面的渲染）
 *
 * 🔴 反向控制（每次运行都做，不是另开一个开关）
 *   把 `@container` 块从 CSS 文本里**剥掉**再加载：
 *     · 若剥掉之后布局仍然按槽切换 ⇒ 切换不是容器查询干的 ⇒ 判据在测别的东西
 *     · 若剥掉之后组件塌了（高度 0 / 图片宽度变了）⇒ 说明基础样式被写进了
 *       `@container` 里，老引擎（Chromium 97）会**整段丢失**
 *     ⇒ 这一条同时证明"判据有牙"和"降级安全"。
 *
 * ⚠️ 为什么不用 `@supports at-rule(@container)` 做特性检测：
 *   不支持时 `@container { … }` 整块被丢弃，不需要检测；而检测本身要双写。
 *   `[data-cq]` 的 `container-type` 在旧引擎上是**未知声明**，被忽略，无副作用。
 *
 * ⚠️ CSS 从磁盘读进来内联，不经过 HTTP：`setContent` 的页面源是 about:blank，
 *   在那里 fetch 同机 8000 端口会被 CORS 拦掉（实测 "Failed to fetch"）。
 *   顺带好处：这份判据不依赖静态服务，随时能跑。
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { launch } = require('./browser.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const TOKENS = read('01-tokens/tokens.css');
const CARD = read('02-primitives/card/card.css');
const REPORT = read('04-recipes/analysis-report/analysis-report.css');

const NARROW = 320;          /* 落在 35rem(560px) 之下 */
const WIDE = 800;

/* ---------------------------------------------------------------------------
 * 剥掉 `@container … { … }`（花括号配平，不是正则）
 * 返回 { css, removed }；removed === 0 说明剥了个寂寞，反向控制不成立。
 * ------------------------------------------------------------------------- */
function stripContainer(css) {
  let out = '';
  let i = 0;
  let removed = 0;
  while (i < css.length) {
    const at = css.indexOf('@container', i);
    if (at < 0) { out += css.slice(i); break; }
    out += css.slice(i, at);
    const b = css.indexOf('{', at);
    if (b < 0) { out += css.slice(at); break; }
    let depth = 0;
    let j = b;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    removed++;
    i = j;
  }
  return { css: out, removed: removed };
}

function cardMarkup(slotWidth, marked) {
  return `
  <div class="slot" ${marked ? 'data-cq' : ''} style="width:${slotWidth}px">
    <div class="card card--row" id="card">
      <div class="card__media"></div>
      <div class="card__body">
        <p class="card__title">季度收入</p>
        <p class="card__desc">同比变化</p>
      </div>
    </div>
  </div>`;
}

function reportMarkup(slotWidth, marked) {
  return `
  <div class="slot" ${marked ? 'data-cq' : ''} style="width:${slotWidth}px">
    <div class="report">
      <div class="report__body" id="rbody">
        <article class="report__main"><p>正文</p></article>
        <aside class="report__aside"><p>侧栏</p></aside>
      </div>
    </div>
  </div>`;
}

async function page(p, cssText, markup) {
  await p.setContent(`<!doctype html><html><head>
    <style>${TOKENS}</style>
    <style>${cssText}</style>
    <style>body { margin: 0 } .slot { outline: 1px dashed #999 }</style>
  </head><body>${markup}</body></html>`, { waitUntil: 'load' });
}

async function cardState(p) {
  return p.evaluate(() => {
    const slot = document.querySelector('.slot');
    const card = document.getElementById('card');
    const media = card.querySelector('.card__media');
    return {
      dir: getComputedStyle(card).flexDirection,
      slotW: Math.round(slot.getBoundingClientRect().width),
      slotType: getComputedStyle(slot).containerType,
      mediaW: Math.round(media.getBoundingClientRect().width),
      cardH: Math.round(card.getBoundingClientRect().height),
    };
  });
}

async function reportState(p) {
  return p.evaluate(() => {
    const body = document.getElementById('rbody');
    const as = document.querySelector('.report__aside');
    const cols = getComputedStyle(body).gridTemplateColumns.trim();
    return {
      tracks: cols.split(/\s+/).filter(Boolean).length,
      asidePos: getComputedStyle(as).position,
      slotType: getComputedStyle(document.querySelector('.slot')).containerType,
    };
  });
}

async function main() {
  const b = await launch();
  const p = await b.newPage();
  const rows = [];
  const add = (label, ok, note) => rows.push({ label, ok, note });

  await p.setViewport({ width: 1440, height: 900 });

  /* ---------------- ① card：槽窄 / 槽宽 / 未标记 ---------------- */
  await page(p, CARD, cardMarkup(NARROW, true));
  let s = await cardState(p);
  add(`card--row 槽 ${NARROW} + data-cq（视口 1440）`,
    s.dir === 'column' && s.slotType === 'inline-size',
    `flex-direction=${s.dir}（期望 column）· 槽 ${s.slotW}px · container-type=${s.slotType}`);

  await page(p, CARD, cardMarkup(WIDE, true));
  s = await cardState(p);
  add(`card--row 槽 ${WIDE} + data-cq（视口 1440）`,
    s.dir === 'row' && s.mediaW === 160,
    `flex-direction=${s.dir}（期望 row）· 图片宽 ${s.mediaW}px（期望 160）`);

  await page(p, CARD, cardMarkup(NARROW, false));
  s = await cardState(p);
  add(`card--row 槽 ${NARROW}、**没有** data-cq（视口 1440）`,
    s.dir === 'row' && s.slotType === 'normal',
    `flex-direction=${s.dir}（期望 row —— 未标记时保持 0.15.0 行为）`);

  /* 视口回退仍在：375 宽、未标记 ⇒ 竖排 */
  await p.setViewport({ width: 375, height: 800 });
  await page(p, CARD, cardMarkup(300, false));
  s = await cardState(p);
  add('card--row 视口 375、没有 data-cq',
    s.dir === 'column',
    `flex-direction=${s.dir}（期望 column —— 视口断点仍生效）`);

  /* 🔴 「容器一旦标记，就以容器为准」——包括**盖过**视口断点。
     构造方式：视口 375，槽 900（横向溢出）。这条不是常见布局，
     而是唯一能把"容器 vs 视口谁说了算"摆到台面上的构造。
     没有它，`@container (min-width: 35rem)` 那一段就是**没被测过的代码**。 */
  await page(p, CARD, cardMarkup(900, true));
  s = await cardState(p);
  add('card--row 视口 375、槽 900（溢出）+ data-cq',
    s.dir === 'row' && s.slotW === 900,
    `flex-direction=${s.dir}（期望 row —— 容器宽，盖过视口的窄断点）· 槽 ${s.slotW}px`);

  /* ---------------- ② report：槽窄 / 槽宽 / 未标记 ---------------- */
  await p.setViewport({ width: 1440, height: 900 });

  await page(p, REPORT, reportMarkup(700, true));
  let r = await reportState(p);
  add('report 槽 700 + data-cq（视口 1440）',
    r.tracks === 1 && r.asidePos === 'static',
    `grid 轨道 ${r.tracks}（期望 1）· aside position=${r.asidePos}（期望 static）`);

  await page(p, REPORT, reportMarkup(1200, true));
  r = await reportState(p);
  add('report 槽 1200 + data-cq（视口 1440）',
    r.tracks === 2 && r.asidePos === 'sticky',
    `grid 轨道 ${r.tracks}（期望 2）· aside position=${r.asidePos}（期望 sticky）`);

  await page(p, REPORT, reportMarkup(700, false));
  r = await reportState(p);
  add('report 槽 700、**没有** data-cq（视口 1440）',
    r.tracks === 2,
    `grid 轨道 ${r.tracks}（期望 2 —— 未标记时按视口，保持 0.15.0 行为）`);

  /* 同上：容器宽盖过窄视口（375 视口 + 1200 槽） */
  await p.setViewport({ width: 375, height: 800 });
  await page(p, REPORT, reportMarkup(1200, true));
  r = await reportState(p);
  add('report 视口 375、槽 1200（溢出）+ data-cq',
    r.tracks === 2 && r.asidePos === 'sticky',
    `grid 轨道 ${r.tracks}（期望 2）· aside position=${r.asidePos}（期望 sticky）`);

  /* ---------------- ③ 反向控制 + 降级安全 ---------------- */
  const stripped = stripContainer(CARD);
  await p.setViewport({ width: 1440, height: 900 });
  await page(p, stripped.css, cardMarkup(NARROW, true));
  s = await cardState(p);

  const fallbackOk =
    stripped.removed > 0 &&          /* 确实剥到了东西 */
    stripped.css.indexOf('@container') < 0 &&  /* 剥干净了 */
    s.dir === 'row' &&               /* 不再按槽切换 ⇒ 切换确实是 @container 干的 */
    s.cardH > 0 &&                   /* 没塌 */
    s.mediaW === 160;                /* 基础样式仍在（老引擎看到的就是这一份） */
  add('剥掉 @container 后：不按槽切换、布局不塌',
    fallbackOk,
    `剥掉 ${stripped.removed} 块 · flex-direction=${s.dir}（期望 row）` +
    ` · 卡片高 ${s.cardH}px（期望 >0）· 图片宽 ${s.mediaW}px（期望 160）`);

  await b.close();

  /* ---------------- 输出 ---------------- */
  let bad = 0;
  console.log('  === 容器查询：按槽宽自适应（不是按视口）===');
  rows.forEach((row) => {
    if (!row.ok) bad++;
    console.log('  [' + (row.ok ? 'OK  ' : 'FAIL') + '] ' + row.label);
    console.log('        ' + row.note);
  });
  console.log('');
  console.log(bad ? '  ❌ ' + bad + ' 条不满足'
    : '  ✅ 全部满足：切换由容器决定、未标记页面不变、剥掉 @container 不塌');
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
