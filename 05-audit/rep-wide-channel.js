/**
 * rep-wide-channel.js — 「宽图 / 宽表通道」在**桌面宽度**下真的通吗
 * ============================================================================
 * 🔴 为什么必须单独一道门禁
 * ---------------------------------------------------------------------------
 *   ① **视觉基线只看 393 宽**（`shot-baseline.py` 的 `VIEWPORT` 是 iPhone 尺寸）。
 *      而正文行长这件事**只在桌面宽度才有区别** —— 393 下正文和列一样宽，
 *      改不改 `--wide` 都是 360px，像素比对**永远看不出差别**。
 *      ⇒ 这个功能的所有回归都可能发生而不被任何门禁发现。
 *   ② 这条通道自己就踩过一次坑：`.rep__fig--wide { max-width: none }`
 *      写在**裸类**（特异性 0,1,0）上，被 `.rep__body .rep__fig`（0,2,0）压住 ⇒
 *      加了 class 完全没有效果。而"没有效果"和"没有这个 class"在截图上
 *      长得一模一样 —— 手动看一眼是看不出来的，必须量宽度。
 *
 *   判据全部是**量的数字**，不是看截图：
 *     ① 正文块**不超过**正文列（`para <= body`）—— 行长是硬上限，永远不会溢出列
 *     ② 列比行长宽得多时（`body - para > 40`），带 `--wide` 的块必须用满列；
 *        列本来就≈行长时这条**不适用**（列就是最宽，通道没有可去的地方）
 *     ③ 不带 `--wide` 的图不超过列（默认仍受约束，不会自己乱跑）
 *     ④ 带 `rep__wide` 的表同样用满列
 *     ⑤ 页面没有横向溢出
 *     ⑥ 图里的刻度字**高度** ≥ 8px（等比缩放的判据是高度，不是宽度）
 *
 * 🟡 第一版判据写错过两条，记在这里免得再犯：
 *    · 「正文块比列窄 40px 以上」—— 在 report demo 上 34em(=544px) 恰好等于
 *      正文列宽（52rem 页宽 − 14em 边注），行长本来就不该比列窄，**判据不成立**。
 *    · 「图内文字宽度 > 18px」—— 单个数字「0」在 10px 字号下宽度只有 6px，
 *      这是**正常的**。真正被缩掉的字表现为**高度**只有 6px 左右（实测过 3×6）。
 *    ⇒ 判据写错会把正确实现报成失败，然后逼着人去改对的东西。
 *
 * ⚠️ 只在 ≥62rem（有边注那一档）量：窄屏下正文列 = 容器宽，通道本来就不该有差别。
 */
const { launch } = require('./browser.js');

const BASE = 'http://127.0.0.1:8000/';
const PAGES = [
  ['examples/finance-report/index.html', '金融示例页', '#cost'],
  ['04-recipes/report/demo.html', '报告配方 demo', null],
];

let bad = 0, total = 0;
function chk(label, ok, extra) {
  total++;
  if (!ok) bad++;
  console.log('    ' + (ok ? 'OK  ' : 'FAIL') + ' ' + label +
              (extra === undefined ? '' : '  → ' + JSON.stringify(extra)));
}

(async () => {
  console.log('  === 宽图 / 宽表通道（桌面宽度）===');
  const b = await launch();

  for (const [path, label, wideScope] of PAGES) {
    console.log('  --- ' + label + ' ---');
    const p = await b.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await p.goto(BASE + path, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise((r) => setTimeout(r, 500));

    const m = await p.evaluate(() => {
      const w = (el) => (el ? Math.round(el.getBoundingClientRect().width) : -1);
      const body = document.querySelector('.rep__body');
      const para = document.querySelector('.rep__body p');
      const figs = [...document.querySelectorAll('.rep__body .rep__fig')];
      const wideFigs = figs.filter((f) => f.classList.contains('rep__fig--wide'));
      const plainFigs = figs.filter((f) => !f.classList.contains('rep__fig--wide'));
      const wideTables = [...document.querySelectorAll('.rep__body .rep__wide')];
      const de = document.documentElement;
      const fs = body ? parseFloat(getComputedStyle(para || body).fontSize) : 16;
      const tick = document.querySelector('.rep__body figure text');
      const tr = tick ? tick.getBoundingClientRect() : null;
      return {
        measurePx: Math.round(fs * 30),   /* 金融/技术/杂志三档都 ≈ 30em 起算 */
        para: w(para),
        body: w(body),
        plain: plainFigs.length ? w(plainFigs[0]) : -1,
        plainN: plainFigs.length,
        wide: wideFigs.length ? w(wideFigs[0]) : -1,
        wideN: wideFigs.length,
        wideTable: wideTables.length ? w(wideTables[0]) : -1,
        wideTableN: wideTables.length,
        overflowX: de.scrollWidth > de.clientWidth,
        tick: tr ? Math.round(tr.width) + 'x' + Math.round(tr.height) : 'none',
      };
    });

    /* ① 硬约束：正文块永远不超过正文列。
       不硬编码 420/544 这些数 —— 换 profile（30em / 34em / 42em）时会假红。 */
    const room = m.body - m.para;
    chk('正文块不超过正文列', m.para > 0 && m.para <= m.body + 2,
        { 正文: m.para, 列: m.body });

    /* ② 通道是否"有意义"：列比行长宽出 40px 以上，才存在可去的空间。 */
    if (m.wideN > 0) {
      if (room > 40) {
        chk('列比行长宽 ⇒ 宽图必须用满列', Math.abs(m.wide - m.body) <= 2,
            { 图: m.wide, 列: m.body, 余量: room });
        chk('宽图确实比正文宽', m.wide > m.para + 40, { 图: m.wide, 正文: m.para });
      } else {
        chk('本页列≈行长，宽图只到列宽（通道无可去之处）',
            m.wide <= m.body + 2, { 图: m.wide, 列: m.body, 余量: room });
      }
    } else {
      chk('本页没有 --wide 图（这条不适用）', true, 'skip');
    }

    /* ③ 默认仍受约束：没申请宽度的图不会自己跑出列 */
    if (m.plainN > 0) {
      chk('不带 --wide 的图不超过列', m.plain <= m.body + 2,
          { 图: m.plain, 列: m.body });
    }

    /* ④ 表格同样有通道 */
    if (m.wideTableN > 0) {
      chk('带 rep__wide 的表用满列', Math.abs(m.wideTable - m.body) <= 2 || room <= 40,
          { 表: m.wideTable, 列: m.body });
    }

    /* ⑤ 桌面不能溢出 */
    chk('桌面无横向溢出', m.overflowX === false, m.overflowX);

    /* ⑥ 图里的字没有被等比缩放。
       🔴 判据是**高度**：10px 字号渲染出来约 11px 高；
          被缩到 0.52 时实测只有 6px 高（另有一例 3×6）。
          用宽度判会误报 —— 单个数字「0」宽只有 6px 是**正常**的。 */
    if (m.tick !== 'none') {
      const hNum = parseInt(m.tick.split('x')[1], 10);
      chk('图内刻度字没被缩掉（高 ≥ 8px）', hNum >= 8, m.tick);
    }

    chk('无 JS 报错', errs.length === 0, errs[0] || '');
    await p.close();
  }

  await b.close();
  console.log(bad
    ? '  [FAIL] ' + bad + ' / ' + total + ' 条宽通道判据不成立'
    : '  [OK  ] ' + total + ' 条宽通道判据全部成立');
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error('  [FAIL] 环境问题（不是检查不通过）：' + e.message);
  process.exit(2);
});
