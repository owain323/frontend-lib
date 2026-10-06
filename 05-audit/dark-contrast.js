/**
 * dark-contrast.js — 暗色模式对比度门禁（ H2）
 * ============================================================================
 * 🔴🔴 为什么这个门禁存在（本项目最严重的一个假绿）
 * ---------------------------------------------------------------------------
 *   `contract-kit.js` 里的第 4 条判据「暗色仍达标」是这么做的：
 *       document.documentElement.setAttribute('data-theme-current', 'dark')
 *   然后测对比度。
 *
 *   🔴 但 `tokens.css` 里**根本没有 `data-theme` 相关规则**（出现 0 次），
 *      真正让暗色生效的只有 `@media (prefers-color-scheme: dark)`。
 *   🔴 实测：设完那个属性，body 底色 `rgb(246,247,248)` → `rgb(246,247,248)`
 *      **完全没变**。
 *   ⛔ 也就是说：33 个契约的"暗色检查"**从来没真的切到暗色**，
 *      测的一直是亮色的值 —— 而门禁报的是「✅ 暗色已切换」。
 *
 *   ⇒ 这不是"没测"，是**"假装测了"** —— 比没测更危险。
 *
 * ============================================================================
 * ⭐ 本门禁的正确做法
 * ---------------------------------------------------------------------------
 *   真正让浏览器切暗色：**emulateMediaFeatures**（Puppeteer/CDP 层面），
 *   它会真的改 `prefers-color-scheme` 的求值结果，触发 `@media` 规则。
 *   ⚠️ 任何"设 data-* 属性"的写法都是**自欺**（除非 CSS 里真有对应规则）。
 *
 *   然后**遍历页面上每一个可见元素**，测「文字色 vs 它自己的有效底色」。
 *   —— 自动发现所有暗色问题，不需要每个契约作者记得写。
 * ============================================================================
 */
const path = require('path');
const kit = require('./contract-kit.js');

/* ---------- 受管页面（与 shot-baseline 同一批，保证覆盖面一致）---------- */
const PAGES = [
  ['02-primitives/button', '按钮'],
  ['02-primitives/input', '输入框'],
  ['02-primitives/card', '卡片'],
  ['02-primitives/badge', '徽标'],
  ['02-primitives/choice', '单选/复选'],
  ['02-primitives/switch', '开关'],
  ['02-primitives/separator', '分隔线'],
  ['02-primitives/select', '下拉选择'],
  ['02-primitives/combobox', '组合框'],
  ['02-primitives/date-range', '日期区间'],
  ['03-patterns/list', '列表'],
  ['03-patterns/content', '正文'],
  ['03-patterns/states', '状态'],
  ['03-patterns/form-validation', '表单校验'],
  ['03-patterns/nav', '导航'],
  ['03-patterns/overlay', '弹层/toast'],
  ['03-patterns/tree', '树形视图'],
  ['03-patterns/drawer', '抽屉'],
  ['03-patterns/dropdown', '下拉菜单'],
  ['03-patterns/tooltip', '文字提示'],
  ['04-recipes/table', '表格'],
  ['09-assets/bar', '柱状图'],
  ['10-review/composition', '组合页'],
];

/* ---------- 对比度（WCAG 2.x 相对亮度公式）---------- */
function lum(rgb) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
function ratio(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function parseRgb(s) {
  if (!s) return null;
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((x) => parseFloat(x));
  if (p.length < 3) return null;
  if (p.length >= 4 && p[3] === 0) return null;      /* 全透明 = 没有底色 */
  return [p[0], p[1], p[2]];
}

/** ⭐ 在页面里执行：遍历所有可见元素，找「文字 vs 有效底色」对比度不足的 */
const SCAN = function () {
  /* ------------------------------------------------------------------
   * 🔴 豁免清单（2026-10-06，Owner 批准）
   *
   * 有些对比度不足是**故意的** —— demo 页面专门演示"这样做不对"，
   * 它们的存在意义就是让门禁报出来。
   *   `.btn--naive` —— button demo 里注释写明「反例演示用」，
   *                    白字压在 --accent 上（2.45:1），故意的。
   *   `.bad-err`    —— input demo 里的错误态示意色，故意用纯红。
   *
   * ⚠️ 豁免必须**显式列举**，不能靠"关键词包含 bad/naive 就跳过" ——
   *    那样真出问题时也会被跳过（这是"豁免机制"最常见的自毁方式）。
   * ⇒ 新增豁免必须在下面加一行，并写清**为什么它是故意的**。
   */
  const EXEMPT = ['btn--naive', 'bad-err'];
  const isExempt = (el) => {
    const cn = typeof el.className === 'string' ? el.className : '';
    return EXEMPT.some((c) => cn.split(/\s+/).indexOf(c) >= 0);
  };

  const parse = (s) => {
    if (!s) return null;
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    if (p.length < 3) return null;
    if (p.length >= 4 && p[3] === 0) return null;
    return [p[0], p[1], p[2]];
  };
  const lum = (c) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  /* 往上找第一个不透明底色（元素自己的 → 祖先的 → body）*/
  const effectiveBg = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c) return c;
      n = n.parentElement;
    }
    /* 🔴 2026-10-06 修一个**判据自身的 bug**（不是组件的问题）。
       原来的 fallback：`getComputedStyle(document.body).backgroundColor`，
       拿不到就用 **白色 [255,255,255]**。
       ⚠️ 实测：本库的 demo 页面把背景写在 `background: var(--paper)` 上，
          而 **body / html 的 computed `background-color` 都是透明**
          （`rgba(0, 0, 0, 0)`）⇒ 永远走 fallback ⇒ 暗色下按**白底**算对比度。
       ⇒ 结果：暗色下明明是 8.9:1 的文字被判成 2.05:1（**205 个假红**）。

       ⭐ 正解：fallback 依次取
          ① 元素链上第一个不透明背景
          ② `--paper` 令牌（**本库的页面底色权威值**，随主题变）
          ③ 白色
    */
    const b = parse(getComputedStyle(document.body).backgroundColor);
    if (b) return b;
    const rootCS = getComputedStyle(document.documentElement);
    const paperHex = (rootCS.getPropertyValue('--paper') || '').trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(paperHex)) {
      let h = paperHex.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16),
              parseInt(h.slice(2, 4), 16),
              parseInt(h.slice(4, 6), 16)];
    }
    return [255, 255, 255];
  };

  const bad = [];
  let checked = 0;
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    /* 只看有直接文字的叶子元素（避免重复统计容器）*/
    const hasText = Array.prototype.some.call(el.childNodes, function (n) {
      return n.nodeType === 3 && n.textContent.trim().length > 0;
    });
    if (!hasText) continue;
    if (isExempt(el)) continue;      /* 🔴 显式豁免（见上方清单） */
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (parseFloat(cs.opacity) < 0.15) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    /* 纯装饰（无 aria / 无 role / class 里带 deco）跳过 */
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = effectiveBg(el);
    const cr = ratio(fg, bg);
    checked++;
    if (cr < 4.5) {
      bad.push({
        sel: (el.tagName.toLowerCase() +
              (el.className && typeof el.className === 'string'
                ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')),
        text: (el.textContent || '').trim().slice(0, 24),
        ratio: Math.round(cr * 100) / 100,
        fg: cs.color, bg: 'rgb(' + bg.join(',') + ')',
        size: Math.round(parseFloat(cs.fontSize)),
        weight: cs.fontWeight,
      });
    }
  }
  return { checked: checked, bad: bad };
};

(async () => {
  const { launch } = require('./browser.js');
  const browser = await launch();
  const results = [];
  let totalChecked = 0;
  let totalBad = 0;

  console.log('  === 暗色对比度（ H2 · 真用 emulateMediaFeatures 切暗色）===');

  for (const [dir, label] of PAGES) {
    const p = await browser.newPage();
    try {
      await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 1 });
      await p.goto('http://127.0.0.1:8000/' + dir + '/demo.html',
                   { waitUntil: 'networkidle0' });
      await new Promise((r) => setTimeout(r, 400));

      /* 🔴 关键：真的让浏览器求值 prefers-color-scheme: dark */
      await p.emulateMediaFeatures([
        { name: 'prefers-color-scheme', value: 'dark' },
      ]);
      await new Promise((r) => setTimeout(r, 350));

      /* ⭐ 先自证：暗色真的生效了吗（底色应该变了）*/
      const themeCheck = await p.evaluate(() => ({
        dark: matchMedia('(prefers-color-scheme: dark)').matches,
        bg: getComputedStyle(document.body).backgroundColor,
      }));
      if (!themeCheck.dark) {
        results.push({ label: label, skip: '暗色未生效（emulateMediaFeatures 失败）' });
        await p.close();
        continue;
      }

      const r = await p.evaluate(SCAN);
      totalChecked += r.checked;
      totalBad += r.bad.length;
      results.push({ label: label, checked: r.checked, bad: r.bad, bg: themeCheck.bg });
    } catch (e) {
      results.push({ label: label, skip: '出错：' + String(e).slice(0, 50) });
    }
    await p.close();
  }
  await browser.close();

  /* ---------- 报告 ---------- */
  let badPages = 0;
  for (const r of results) {
    if (r.skip) {
      console.log('  SKIP  ' + String(r.label).padEnd(14) + r.skip);
      continue;
    }
    if (!r.bad || !r.bad.length) {
      console.log('  OK    ' + String(r.label).padEnd(14) + r.checked +
                  ' 个文字全部达标（底色 ' + r.bg + '）');
    } else {
      badPages++;
      console.log('  FAIL  ' + String(r.label).padEnd(14) + r.bad.length +
                  '/' + r.checked + ' 个文字对比度不足');
      /* 只列前 3 个，避免刷屏 */
      r.bad.slice(0, 3).forEach((b) => {
        console.log('          ' + b.sel + ' 「' + b.text + '」 ' +
                    b.ratio.toFixed(2) + ':1（需 4.5） ' + b.fg + ' on ' + b.bg +
                    ' ' + b.size + 'px/' + b.weight);
      });
      if (r.bad.length > 3) console.log('          …另有 %d 个' % (r.bad.length - 3));
    }
  }

  console.log('');
  console.log('  扫了 ' + totalChecked + ' 个文字元素，其中 ' + totalBad +
              ' 个对比度不足（' + badPages + ' 个页面有问题）');
  if (badPages) {
    console.log('');
    console.log('  ⇒ 🔴 暗色下确有读不清的文字。这在之前的 33 个契约里**从未被测到**');
    console.log('    （因为它们用 data-theme-current 切主题，而 CSS 里没这个规则）。');
  }
  process.exit(badPages ? 1 : 0);
})();
