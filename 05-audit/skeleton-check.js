const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * skeleton-check.js — 骨架屏契约
 *
 * ============================================================================
 * ⭐ 为什么这个组件的契约要自己写死判据（而不是只靠通用契约）
 * ---------------------------------------------------------------------------
 *   骨架屏是**纯展示 + 无语义**的组件 —— 它里面**没有文字**。
 *   ⚠️ 于是通用契约里所有"文字对比度"判据对它**全部不适用**。
 *   而它自己最该被验的三件事，通用契约一条都不查：
 *     ① 底色不能和纸面同色（否则看不见 = 白屏）
 *     ② 动画必须尊重 prefers-reduced-motion（WCAG 2.3.3）
 *     ③ 屏幕阅读器不能把它读成一堆空白（无障碍红线）
 *   ⇒ 这三条就是本契约的全部内容。
 *
 *   📌 判据来源：Ant Design / MUI 的 Skeleton 都把"减少动态效果"作为
 *     必须项（它们用 CSS 变量开关，本库直接用 media query，更彻底）。
 */
(async () => {
  const r = await kit.check({
    name: 'skeleton',
    url: 'http://127.0.0.1:8000/02-primitives/skeleton/demo.html',
    dir: REPO + '/02-primitives/skeleton',
    primary: '.skeleton',

    /* 🔴 纯展示组件：不可点、不可聚焦 ⇒ 三条通用判据显式豁免
       （不是"删掉"，而是在框架里豁免并让报告仍显示这一行带理由）*/
    interactive: '.skeleton:not([tabi]), .skeleton--text, .skeleton--block, .skeleton--circle',
    skipFocusRing: true,
    note: 'skeleton 是纯展示占位（无文字、不可交互），焦点环与命中区不适用',

    extra: {
      /* ---------- ① 底色必须与纸面**可区分** ---------- */
      '骨架底色与纸面可区分（不能白屏）': async (p) => {
        const v = await p.evaluate(() => {
          const el = document.querySelector('.skeleton');
          if (!el) return null;
          const cs = getComputedStyle(el);
          return {
            bg: cs.backgroundColor,
            /* 往上找页面底色（body 通常是 transparent ⇒ 落到 html） */
            paper: getComputedStyle(document.documentElement)
              .getPropertyValue('--paper').trim(),
          };
        });
        if (!v) return { ok: false, why: 'demo 里找不到 .skeleton' };
        const parse = (s) => {
          const m = String(s).match(/rgba?\(([^)]+)\)/);
          if (!m) return null;
          const x = m[1].split(',').map(parseFloat);
          if (x.length >= 4 && x[3] === 0) return null;
          return [x[0], x[1], x[2]];
        };
        const lum = (c) => {
          const f = (v2) => {
            const s = v2 / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
        };
        const hex2rgb = (h) => {
          let x = h.replace('#', '');
          if (x.length === 3) x = x[0] + x[0] + x[1] + x[1] + x[2] + x[2];
          return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16),
                  parseInt(x.slice(4, 6), 16)];
        };
        const bg = parse(v.bg);
        const paper = hex2rgb(v.paper);
        if (!bg) return { ok: false, why: '骨架没有背景色（会看不见）: ' + v.bg };
        /* ⭐ 判据：与纸面**亮度差**要够（≥ 0.02 相对亮度）
           太小 ⇒ 用户看不出这是占位；太大 ⇒ 刺眼 */
        const d = Math.abs(lum(bg) - lum(paper));
        if (d < 0.02) {
          return { ok: false, why: '骨架底色与纸面太接近（亮度差 ' +
            d.toFixed(4) + ' < 0.02）⇒ 看起来像白屏' };
        }
        if (d > 0.45) {
          return { ok: false, why: '骨架底色与纸面反差过大（亮度差 ' +
            d.toFixed(3) + '）⇒ 在浅底上会刺眼' };
        }
        return { ok: true, why: '亮度差 ' + d.toFixed(3) + '（在合理区间）' };
      },

      /* ---------- ② 动画尊重 prefers-reduced-motion ---------- */
      '减少动态效果时动画停掉': async (p) => {
        const v = await p.evaluate(() => {
          const el = document.querySelector('.skeleton');
          if (!el) return null;
          const cs = getComputedStyle(el, '::after');
          return { name: cs.animationName, dur: cs.animationDuration };
        });
        if (!v) return { ok: false, why: 'demo 里找不到 .skeleton' };
        /* 在 reduce 模拟下，::after 的 animation-name 必须是 none */
        if (v.name && v.name !== 'none') {
          return { ok: false, why: 'prefers-reduced-motion: reduce 下动画仍在跑（' +
            v.name + ' ' + v.dur + '）⇒ 违反 WCAG 2.3.3' };
        }
        return { ok: true, why: 'reduce 下无动画（骨架本身仍显示）' };
      },

      /* ---------- ③ 无障碍：不能被读成一片空白 ---------- */
      '对屏幕阅读器隐藏（aria-hidden）': async (p) => {
        const v = await p.evaluate(() => {
          const list = [...document.querySelectorAll('.skeleton')];
          if (!list.length) return null;
          /* 判据：demo 里的骨架应当整体被 aria-hidden 包裹，
             或者逐个标注 —— 二者至少满足其一。
             ⚠️ 这里只查"逐个标注"，因为包裹式是更复杂的用法。 */
          const unlabelled = list.filter((el) =>
            el.getAttribute('aria-hidden') !== 'true' &&
            !el.closest('[aria-hidden="true"]') &&
            !el.closest('[aria-busy="true"]'));
          return { total: list.length, unlabelled: unlabelled.length };
        });
        if (!v) return { ok: false, why: 'demo 里找不到 .skeleton' };
        if (v.unlabelled > 0) {
          return { ok: false, why: v.unlabelled + '/' + v.total +
            ' 个骨架没被 aria-hidden / aria-busy 包裹 ⇒ 读屏会念出一堆空白' };
        }
        return { ok: true, why: v.total + ' 个骨架均已对读屏隐藏' };
      },

      /* ---------- ④ 形状变体齐全 ---------- */
      '三种形状变体齐全': async (p) => {
        const v = await p.evaluate(() => ({
          text: document.querySelectorAll('.skeleton--text').length,
          block: document.querySelectorAll('.skeleton--block').length,
          circle: document.querySelectorAll('.skeleton--circle').length,
        }));
        const missing = [];
        if (!v.text) missing.push('--text');
        if (!v.block) missing.push('--block');
        if (!v.circle) missing.push('--circle');
        if (missing.length) {
          return { ok: false, why: '缺少变体: ' + missing.join(', ') };
        }
        return { ok: true, why: 'text/block/circle 齐全' };
      },
    },
  });
  process.exit(r ? 0 : 1);
})();
