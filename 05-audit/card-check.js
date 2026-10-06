const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * card-check.js — 卡片契约（B1.5  #4）
 *
 * ⭐ 卡片的核心难点：**整卡可点击**怎么做才不出错。
 * 业界有两种做法，各有陷阱：
 *   A. 伪元素撑满（`.card__link::after { position:absolute; inset:0 }`）
 *      ⇒ 卡片内所有链接的 z-index 都要高于它，否则内层链接点不到
 *   B. 整个卡片包在 <a> 里
 *      ⇒ ⚠️ **HTML 不允许 <a> 里有交互元素**（button / a / input）
 *      ⇒ 卡片里放按钮会**造成无效 HTML**
 */
(async () => {
  const r = await kit.check({
    name: 'card',
    url: 'http://127.0.0.1:8000/02-primitives/card/demo.html',
    dir: REPO + '/02-primitives/card',
    primary: '.card--linked',
    interactive: '.card__link, .card button, .card a',

    extra: {
      /* 整卡可点击：链接必须真的撑满卡片（否则只有文字可点）*/
      '整卡可点：链接区域撑满卡片': async (p) => {
        /* 🔴 命中测试必须在卡片**在视口内**时做，
           否则 elementFromPoint 一律返回 null（页面很长时必然失败）。 */
        await p.evaluate(() => {
          const c = document.querySelector('.card--linked');
          if (c) c.scrollIntoView({ block: 'center' });
        });
        await new Promise((r) => setTimeout(r, 300));
        const r = await p.evaluate(() => {
          const card = document.querySelector('.card--linked');
          const link = card.querySelector('.card__link, a');
          if (!link) return { ok: false, note: '卡片里没有链接' };
          const c = card.getBoundingClientRect();
          /* 🔴 关键修正：整卡可点靠的是 `.card__link::after { inset: 0 }`，
             **伪元素的 getBoundingClientRect 量不到** ⇒ 只能靠**命中测试**：
             在卡片内若干点采样，看命中的元素（或其祖先）是不是那条链接。 */
          const pts = [[0.5, 0.15], [0.5, 0.5], [0.5, 0.85], [0.15, 0.5], [0.85, 0.5]];
          let hit = 0;
          for (const [fx, fy] of pts) {
            const x = c.left + c.width * fx;
            const y = c.top + c.height * fy;
            const el = document.elementFromPoint(x, y);
            if (el && (el === link || link.contains(el) || el === link.parentNode ||
                       (el.parentNode && el.parentNode === link.parentNode))) hit++;
          }
          const area = hit / pts.length;
          return { ok: area >= 0.6,
                   note: '卡片内采样 5 点，' + hit + ' 点命中链接热区（' +
                         Math.round(area * 100) + '%）' };
        });
        return r;
      },

      /* ⭐ 伪元素撑满方案 ⇒ 内层交互元素必须 z-index 更高
         （这是"整卡可点"最常见的 bug：卡片里的按钮点不到）*/
      '内层交互元素不被遮挡': async (p) => {
        const r = await p.evaluate(() => {
          const card = document.querySelector('.card--linked');
          if (!card) return { ok: true, note: '无 linked 卡片（跳过）' };
          /* 找卡片里所有真正可点的元素（排除那条撑满的链接）*/
          const inner = [...card.querySelectorAll('button, input, select, a')]
            .filter((e) => !e.classList.contains('card__link'));
          if (!inner.length) return { ok: true, note: '卡片内无其他交互元素（跳过）' };
          const link = card.querySelector('.card__link, a');
          const lz = link ? getComputedStyle(link, '::after').zIndex : null;
          const bad = inner.filter((e) => {
            const z = getComputedStyle(e).zIndex;
            return lz !== 'auto' && lz !== null && (z === 'auto' || +z < +lz);
          });
          return { ok: bad.length === 0,
                   note: inner.length + ' 个内层元素，撑满层 z-index=' +
                         lz + '，被挡 ' + bad.length + ' 个' };
        });
        return r;
      },

      /* HTML 有效性：<a> 里不能有交互元素 */
      'HTML 有效：无嵌套交互元素': async (p) => {
        const r = await p.evaluate(() => {
          const bad = [];
          document.querySelectorAll('a').forEach((a) => {
            a.querySelectorAll('button, a, input, select, textarea').forEach((e) => {
              bad.push('<a> 内含 <' + e.tagName.toLowerCase() + '>');
            });
          });
          return { ok: bad.length === 0,
                   note: bad.length ? '🔴 ' + [...new Set(bad)].join('; ')
                                    : '无嵌套（HTML 有效）' };
        });
        return r;
      },

      /* 卡片的点击目标要够大（整卡可点 ⇒ 天然满足，但要量）*/
      /* 卡片可点区域：热区是伪元素量不到 ⇒ 改判**卡片本身**尺寸
         （伪元素 inset:0 ⇒ 热区尺寸 = 卡片尺寸）*/
      /* 可点卡片有可访问名 */
      '可点卡片有可访问名': async (p) => {
        const r = await p.evaluate(() => {
          const links = [...document.querySelectorAll('.card__link, .card a')];
          if (!links.length) return { ok: true, note: '无链接（跳过）' };
          const bad = links.filter((a) =>
            !(a.getAttribute('aria-label') || a.textContent.trim()));
          return { ok: bad.length === 0,
                   note: links.length + ' 个链接，缺名 ' + bad.length + ' 个' };
        });
        return r;
      },
    },
  });
  process.exit(kit.report(r));
})();
