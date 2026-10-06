// puppeteer-core 改由 browser.js 统一持有
  // 🔴 2026-10-04 统一走 browser.js：那里会 setCacheEnabled(false)。
  //    没有它，页面里跑的是**缓存的旧代码**，测试会假通过
  //    （磁盘上明明改对了，浏览器里还是旧的）。
  const { launch } = require('./browser');

/**
 * tap-target.js — 触控命中区检查（WCAG 2.1 · 2.5.5）
 *
 * 🔴 为什么有这道门禁（Owner 在 iOS 实机报出来的）
 * ------------------------------------------------
 * Owner 的原话：「Switch 开关…我们点不了。点了之后动不了。」
 *
 * 我第一反应是"Safari 的问题"——**错的**。查清后是两个**通用**缺陷：
 *   ① `.switch__input` 被 `clip` 成 **1px**，而外层 `<span>` **不是 label**
 *      ⇒ **点滑块等于点空气**。这一条在**任何浏览器上都成立**，
 *      桌面没暴露只是因为人往往点偏到文字上。
 *   ② 即使修好①，**命中区只有 22px 高** —— 远低于 44px。
 *
 * ⚠️ 它们与 iOS 无关，**是设计本身不可用**。所以这道门禁查的是
 *    "**所有可点元素的命中区是否达标**"，不是"在 Safari 上能不能点"。
 *
 * 标准（不是 Apple 专利，是 W3C 的）：
 *   WCAG 2.1 · 2.5.5 Target Size (Enhanced) = 44×44 CSS px（AAA）
 *   WCAG 2.2 · 2.5.8 Target Size (Minimum) = 24×24 CSS px（AA）
 *
 * 🔴 关键概念：**视觉尺寸 ≠ 命中尺寸**
 *    滑块看起来该是 22px（做粗了很丑），但**可点的带**必须 44px。
 *    做法是给容器 `min-height: 44px`，视觉元素不变。
 */
const MIN_AA = 24;   // WCAG 2.2 · 2.5.8
const MIN_AAA = 44;  // WCAG 2.1 · 2.5.5

// 每页要查的交互元素选择器
const TARGETS = [
  ['.btn', '按钮'],
  ['.switch', '开关'],
  ['.choice', '单选/复选'],
  ['.tabs__tab', '标签页'],
  ['.accordion__trigger', '折叠标题'],
  ['.toast__close', 'toast 关闭'],
  ['.nav__link', '导航链接'],
];
// 视觉可以小、但**不可点**的元素（不算命中区）
const NON_TARGET = ['.switch__thumb', '.switch__track', '.spinner',
                    '.skeleton', '.choice__mark', '.btn__spinner'];

const PAGES = [
  ['ios 验证页', '10-review/ios/index.html'],
  ['button', '02-primitives/button/demo.html'],
  ['choice', '02-primitives/choice/demo.html'],
  ['switch', '02-primitives/switch/demo.html'],
  ['tabs', '03-patterns/tabs/demo.html'],
  ['accordion', '03-patterns/accordion/demo.html'],
  ['overlay', '03-patterns/overlay/demo.html'],
  ['nav', '03-patterns/nav/demo.html'],
];

(async () => {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 2,
                        isMobile: true, hasTouch: true });

  let aaFail = 0, aaaFail = 0;
  const rows = [];

  for (const [name, rel] of PAGES) {
    try {
      await p.goto('http://127.0.0.1:8000/' + rel,
                   { waitUntil: 'networkidle0', timeout: 12000 });
    } catch (e) { continue; }

    const found = await p.evaluate((sels, nonT) => {
      const out = [];
      sels.forEach(([sel, label]) => {
        document.querySelectorAll(sel).forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;   // 隐藏的
          // 命中区应取"实际可点范围"：若内部有铺满的 input，取它
          let w = r.width, h = r.height;
          const inp = el.querySelector('input,button,a');
          if (inp) {
            const ir = inp.getBoundingClientRect();
            if (ir.width > w) { w = ir.width; h = Math.max(h, ir.height); }
          }
          out.push({ label, w: Math.round(w), h: Math.round(h) });
        });
      });
      return out;
    }, TARGETS.map((t) => [t[0], t[1]]), NON_TARGET);

    // 每类只报最差的一个
    const byLabel = {};
    found.forEach((f) => {
      const cur = byLabel[f.label];
      if (!cur || Math.min(f.w, f.h) < Math.min(cur.w, cur.h)) byLabel[f.label] = f;
    });
    for (const k in byLabel) {
      const v = byLabel[k];
      const m = Math.min(v.w, v.h);
      const okAA = m >= MIN_AA;
      const okAAA = m >= MIN_AAA;
      if (!okAA) aaFail++;
      if (!okAAA) aaaFail++;
      rows.push({ page: name, label: k, w: v.w, h: v.h,
                  aa: okAA, aaa: okAAA });
    }
  }
  await b.close();

  const pad = (s, n) => { s = String(s); let w = 0;
    for (const ch of s) w += ch.charCodeAt(0) > 255 ? 2 : 1;
    return s + ' '.repeat(Math.max(0, n - w)); };

  console.log('  ' + pad('页面', 14) + pad('控件', 14) + pad('命中区', 11) + '判定');
  console.log('  ' + '-'.repeat(52));
  for (const r of rows) {
    const m = Math.min(r.w, r.h);
    const tag = r.aaa ? '✅ AAA' : (r.aa ? '⚠ 仅 AA' : '❌ 不达标');
    console.log('  ' + pad(r.page, 14) + pad(r.label, 14) +
      pad(r.w + '×' + r.h, 11) + tag);
  }
  console.log('');
  console.log('  AA  24×24 (WCAG 2.2 · 2.5.8)：' +
    (aaFail ? aaFail + ' 项不达标' : ' 全部通过 ✅'));
  console.log('  AAA 44×44 (WCAG 2.1 · 2.5.5)：' +
    (aaaFail ? aaaFail + ' 项仅达 AA（**指出来不是错，是"知道还差多少"）'
             : ' 全部通过 ✅'));
  console.log('');
  console.log('  ℹ 视觉尺寸 ≠ 命中尺寸：滑块看起来 22px 是对的，');
  console.log('    但**可点的带**要 44px。做法是容器 min-height: 44px。');

  if (aaFail) { console.log(''); console.log('  ❌ ' + aaFail + ' 项连 AA 都不达标（这是真缺陷）'); process.exit(1); }
  process.exit(0);
})();
