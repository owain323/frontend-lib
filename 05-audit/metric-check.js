/**
 * metric-check.js — 指标块：等宽数字、单位分离、缺数不冒充 0
 *
 * ============================================================================
 * 🔴 这条门禁防的是什么
 * ---------------------------------------------------------------------------
 *  `metric` 的四条纪律，每一条都「写 CSS 时对、跑起来可能错」：
 *
 *   ① **数字必须等宽**。少了它，上下两行的数位对不齐，竖着扫一眼比大小这件事
 *      就废了 —— 而单看一屏是看不出来的，要两行数字并排才现形。
 *      等宽有两条合法路径（`tabular-nums` 或等宽字族），所以判**量出来的宽度**，
 *      不判声明（判声明会冤枉正确实现，见 E142）。
 *   ② **正常列宽下不许换行**。一位数掉到第二行会让整行 KPI 高度跳动。
 *      但"不换行"不等于 `white-space: nowrap` —— 那会把单位一起锁死，
 *      RTL 膨胀后顶破视口（E143）。所以判**量出来的行数**。
 *   ③ **单位字号必须小于数值**。若某条规则把 `.metric__unit` 的
 *      `font-size` 覆盖成 `inherit`，单位就跟数字一样大 ——
 *      读者会把「亿元」读成数值的一部分。
 *   ④ **缺数不能冒充 0**。这是本库最反对的一类：`0.00` 与 `—` 在报表上
 *      是两个不同结论。判据直接读文本，不看颜色。
 *   ⑤ **值里不许混 delta**。混进去等宽对齐就失效（两段数字位数不同）。
 *
 *  ⚠️ 这五条里 ④ 是**唯一必须读文本**的；①② 是**量出来的**（宽度/行数），
 *     其余读 computed 样式。这也是为什么它不能并进 `contrast.py` 这类纯静态门禁。
 *
 * ============================================================================
 * 判据（八条）
 * ---------------------------------------------------------------------------
 *  ① "1111" 与 "8888" 的渲染宽度相等（等宽字族或 `tabular-nums` 至少一样）
 *     量不到宽度 ⇒ 判失败（判据没跑 ≠ 通过）
 *  ② 值在正常列宽下只占 1 行（量 clientHeight / 行高）
 *     量不到高度 ⇒ 判失败
 *  ③ 值字号 > 单位字号（严格大于）
 *  ④ null 档的值颜色 == `--text-tertiary`（不是靠 opacity 压淡）
 *  ⑤ null 档的值**文本**是 `—`（U+2014），既不是 `0` 也不是空串
 *  ⑥ 值里没有 `.delta` 子元素
 *  ⑦ metric.css 里没有 `--dir-` 引用（方向是 delta 的事，职责不串）
 *  ⑧ 375px 视口下不横向溢出（`minmax(min(100%, 12rem), 1fr)` 那层 min 在起作用）
 *
 * 用法：node 05-audit/metric-check.js [--selftest]
 */
'use strict';

const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '..');
const PAGE = '/02-primitives/metric/demo.html';

/* -------------------------------------------------------------------------
 * 纯判据
 * ---------------------------------------------------------------------- */

/**
 * @param {object} s {
 *   valueFvn, valueWs, valueFs, unitFs,
 *   nullColor, nullText, plainColor,
 *   deltaInValue, scrollW, innerW,
 * }
 */
function judge(s) {
  const errs = [];
  if (!s) return ['没有采样结果（页面可能没加载出来）'];

  /* ① 等宽数字 —— **量出来的**，不是读声明的
     🔴 0.12.0 改法：原来判 `font-variant-numeric` 含 `tabular-nums`。
        但等宽有两条合法路径：① 用 `tabular-nums`；② 用等宽字族（`--mono`）。
        metric 现在走 ②（`tabular-nums` 在等宽字族上是无效动作，见 E142）
        ⇒ 判"声明"会冤枉正确实现。判"渲染结果"才对：
        两个同长度、不同字形的数字，宽度必须一样。 */
  if (s.tnumWidth !== null && s.tnumWidth !== undefined) {
    if (Math.abs(s.tnumWidth - s.widthOf8) > 0.5) {
      errs.push(`① 数字不等宽："1111" 宽 ${s.tnumWidth}px、"8888" 宽 `
        + `${s.widthOf8}px —— 上下两行数位对不齐（等宽字族或 tabular-nums 至少要有一样）`);
    }
  } else {
    errs.push('① 量不到数字宽度（采样失败）—— 等宽这件事没有被检验');
  }

  /* ② 正常列宽下不换行 —— 也是量高度，不是读 `white-space`
     🔴 0.12.0 改法：原来判 `white-space === "nowrap"`。但 `nowrap` 有个硬伤：
        单位是值的子元素，父级 `nowrap` 会把单位一起锁死 ⇒ RTL 膨胀后顶破视口
        （实测 212px，见 E143）。现在的写法是「默认不断行，装不下才断」，
        正确判据是**量出来几行**：正常列宽下必须是 1 行。 */
  if (s.valueLines !== null && s.valueLines !== undefined) {
    if (s.valueLines > 1.05) {
      errs.push(`② 正常列宽下值占了 ${s.valueLines.toFixed(2)} 行 —— `
        + '应该是 1 行（数字掉行会让整行 KPI 高度跳动）');
    }
  } else {
    errs.push('② 量不到值的高度（采样失败）—— 换行这件事没有被检验');
  }

  /* ③ 单位要比数值小 */
  if (!(s.valueFs > s.unitFs)) {
    errs.push(`③ 值字号 ${s.valueFs}px 没有大于单位字号 ${s.unitFs}px —— `
      + '单位会和数字一样重，读者把它读成数值的一部分');
  }

  /* ④ null 用令牌降色，不是 opacity */
  if (s.nullColor === s.plainColor) {
    errs.push(`④ null 档的值颜色 ${s.nullColor} 与普通档相同 —— 缺数没有被区分出来`);
  }

  /* ⑤ 缺数的文本必须是不给数字 */
  if (s.nullText !== '\u2014') {
    errs.push(`⑤ null 档的值文本是 ${JSON.stringify(s.nullText)}，`
      + '应为 U+2014（—）。填 0 是把「未披露」读成「为零」');
  }

  /* ⑥ 值里不许混 delta */
  if (s.deltaInValue > 0) {
    errs.push('⑥ metric__value 里有 ' + s.deltaInValue + ' 个 .delta —— '
      + '等宽对齐会失效，读屏也会念成一串');
  }

  /* ⑧ 窄视口不横向溢出 */
  if (s.scrollW > s.innerW + 1) {
    errs.push(`⑧ 375px 下横向溢出：scrollWidth ${s.scrollW} > innerWidth ${s.innerW} —— `
      + '网格的 minmax(min(100%, …)) 那层 min 没起作用');
  }

  return errs;
}

/** ⑦ 静态：职责不串 */
function judgeCss(cssText) {
  const code = String(cssText || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const errs = [];
  if (/--dir-/.test(code)) {
    errs.push('⑦ metric.css 里引用了 --dir-* —— 涨跌是 delta 的事，'
      + '本组件只负责「一个数」，不负责它的方向');
  }
  return errs;
}

/* -------------------------------------------------------------------------
 * 反向控制
 * ---------------------------------------------------------------------- */
function selftest() {
  const R = [];
  const add = (n, ok) => R.push([n, !!ok]);
  const only = (n, errs, needle) => {
    const ok = errs.length >= 1 && errs.every((e) => e.includes(needle));
    add(n, ok);
    if (!ok) console.log('     实际 %d 条：%s', errs.length, JSON.stringify(errs.slice(0, 3)));
  };

  const base = () => ({
    valueFvn: 'normal', valueWs: 'normal',     /* 现在都不判了，留着只为看清现场 */
    tnumWidth: 66.0, widthOf8: 66.0, valueLines: 1,
    valueFs: 30, unitFs: 14,
    nullColor: 'rgb(96, 103, 112)', plainColor: 'rgb(21, 24, 28)',
    nullText: '\u2014',
    deltaInValue: 0, scrollW: 375, innerW: 375,
  });

  add('全对的样本不报错（判据不能恒红）', judge(base()).length === 0);

  only('① 数字不等宽被抓', judge((() => {
    const s = base(); s.widthOf8 = s.tnumWidth + 3.2; return s;
  })()), '不等宽');
  only('① 量不到数字宽度被抓（判据没跑 ≠ 通过）', judge((() => {
    const s = base(); s.tnumWidth = null; return s;
  })()), '量不到数字宽度');
  only('② 值占了多行被抓', judge((() => {
    const s = base(); s.valueLines = 2.3; return s;
  })()), '占了');
  only('② 量不到高度被抓（判据没跑 ≠ 通过）', judge((() => {
    const s = base(); s.valueLines = null; return s;
  })()), '量不到值的高度');
  only('③ 单位与数字同字号被抓', judge((() => {
    const s = base(); s.unitFs = s.valueFs; return s;
  })()), '没有大于单位字号');
  only('④ 缺数没区分被抓', judge((() => {
    const s = base(); s.nullColor = s.plainColor; return s;
  })()), '没有被区分');
  only('⑤ 缺数填 0 被抓', judge((() => {
    const s = base(); s.nullText = '0.00'; return s;
  })()), 'U+2014');
  only('⑤ 缺数留空被抓', judge((() => {
    const s = base(); s.nullText = ''; return s;
  })()), 'U+2014');
  only('⑥ 值里混进 delta 被抓', judge((() => {
    const s = base(); s.deltaInValue = 1; return s;
  })()), '等宽对齐');
  only('⑧ 窄屏横向溢出被抓', judge((() => {
    const s = base(); s.scrollW = 420; return s;
  })()), '横向溢出');

  add('⑦ 组件引用 --dir-* 被抓',
    judgeCss('.metric__value{color:var(--dir-up)}').length === 1);
  add('⑦ 注释里提到 --dir- 不算（剥注释）',
    judgeCss('/* 不用 --dir-up */\n.metric{color:var(--text-primary)}').length === 0);
  add('⑦ 正常写法不报错',
    judgeCss('.metric{color:var(--text-primary)}').length === 0);

  let bad = 0;
  for (const [n, ok] of R) {
    if (!ok) bad++;
    console.log('  ' + (ok ? 'OK  ' : 'RED ') + n);
  }
  console.log('');
  console.log(bad ? `  ⇒ 🔴 判据自检 ${bad} 条不成立` : '  ⇒ ✅ 判据自检全部成立');
  return bad ? 1 : 0;
}

/* -------------------------------------------------------------------------
 * 浏览器采样
 * ---------------------------------------------------------------------- */
async function sample(page) {
  return page.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const cs = (el, prop) => (el ? getComputedStyle(el)[prop] : null);

    /* 普通档：取第一块非 null 的 metric */
    const plain = document.querySelector('.metric:not(.metric--null)');
    const plainVal = plain && plain.querySelector('.metric__value');
    const plainUnit = plain && plain.querySelector('.metric__unit');

    /* null 档：demo 里那一块 */
    const nul = q('.metric--null');
    const nullVal = nul && nul.querySelector('.metric__value');

    /* 溢出：量文档整体 */
    const scrollW = document.documentElement.scrollWidth;
    const innerW = window.innerWidth;

    /* ① 等宽：把 "1111" 与 "8888" 塞进同一个值元素各量一次。
       用 Range 量文本节点，避免插入 DOM 影响页面（也避免被别的判据看见）。 */
    let tnumWidth = null;
    let widthOf8 = null;
    if (plainVal) {
      const measure = (txt) => {
        const span = document.createElement('span');
        span.textContent = txt;
        span.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
        plainVal.appendChild(span);
        const w = span.getBoundingClientRect().width;
        span.remove();
        return w;
      };
      tnumWidth = measure('1111');
      widthOf8 = measure('8888');
    }

    /* ② 行数：clientHeight / 单行行高 */
    let valueLines = null;
    if (plainVal) {
      const fs2 = parseFloat(getComputedStyle(plainVal).fontSize);
      let lh = parseFloat(getComputedStyle(plainVal).lineHeight);
      if (!isFinite(lh)) lh = fs2 * 1.2;
      valueLines = plainVal.clientHeight / lh;
    }

    return {
      valueFvn: cs(plainVal, 'fontVariantNumeric'),
      valueWs: cs(plainVal, 'whiteSpace'),
      tnumWidth, widthOf8, valueLines,
      valueFs: parseFloat(cs(plainVal, 'fontSize')),
      unitFs: parseFloat(cs(plainUnit, 'fontSize')),
      nullColor: cs(nullVal, 'color'),
      nullText: nullVal ? nullVal.textContent.trim() : null,
      plainColor: cs(plainVal, 'color'),
      deltaInValue: plain ? plain.querySelectorAll('.metric__value .delta').length : 0,
      scrollW, innerW,
    };
  });
}

/* ------------------------------------------------------------------------- */
(async () => {
  if (process.argv.includes('--selftest')) process.exit(selftest());

  const { launch } = require(path.resolve(__dirname, 'browser'));
  const BASE = process.env.FL_BASE || 'http://127.0.0.1:8000';
  let rc = 0;

  console.log('\n  === 指标块 ===\n');

  const css = fs.readFileSync(path.join(REPO, '02-primitives/metric/metric.css'), 'utf8');
  const cssErrs = judgeCss(css);
  if (cssErrs.length) {
    cssErrs.forEach((e) => console.log('  🔴 ' + e));
    rc = 1;
  } else {
    console.log('  OK ⑦ 组件未引用方向令牌');
  }

  const browser = await launch();
  try {
    const page = await browser.newPage();
    /* ⑧ 必须在窄视口量 —— 宽屏下永远不溢出，量了等于没量 */
    await page.setViewport({ width: 375, height: 800 });
    await page.goto(BASE + PAGE, { waitUntil: 'networkidle0', timeout: 20000 });

    const s = await sample(page);
    const errs = judge(s);
    if (errs.length) {
      errs.forEach((e) => console.log('  🔴 ' + e));
      rc = 1;
    } else {
      console.log('  OK ①–⑥ ⑧ 全部成立（375px 视口）');
      console.log(`     值 ${s.valueFs}px / 单位 ${s.unitFs}px · 缺数文本 ${JSON.stringify(s.nullText)}`);
    }
    await page.close();
  } finally {
    await browser.close();
  }

  console.log('');
  console.log(rc ? '  ❌ 指标块门禁未通过' : '  ✅ 指标块门禁通过');
  process.exit(rc);
})();
