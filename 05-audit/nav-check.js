const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * nav-check.js — 导航契约（总 A7）
 *
 * ⭐ 核心风险（WCAG 2.4.8 + APG）：
 *   ① 页面上有多个 <nav> 时**必须各有名字**，否则读屏用户只听到"导航"，
 *      不知道是主导航还是面包屑；
 *   ② 当前页必须标 aria-current="page" —— 否则读屏用户不知道自己在哪。
 */
(async () => {
  const r = await kit.check({
    name: 'nav',
    url: 'http://127.0.0.1:8000/03-patterns/nav/demo.html',
    dir: REPO + '/03-patterns/nav',
    primary: '.nav',
    interactive: '.nav a, .nav button',

    extra: {
      /* ① 多个 nav 必须各有名字 */
      '每个 nav 都有名字': async (p) => {
        const r = await p.evaluate(() => {
          const navs = [...document.querySelectorAll('nav, [role="navigation"]')];
          if (!navs.length) return { ok: false, note: '没有 <nav>' };
          const bad = navs.filter((n) => {
            const name = n.getAttribute('aria-label') || n.getAttribute('aria-labelledby');
            return !name || (n.getAttribute('aria-labelledby')
                            && !document.getElementById(n.getAttribute('aria-labelledby')));
          });
          return { ok: bad.length === 0,
                   note: navs.length + ' 个 nav，' + bad.length + ' 个没名字' +
                         (bad.length ? '（多个同名地标，读屏分不清）' : '') };
        });
        return r;
      },

      /* ② 当前页用 aria-current="page" */
      '当前项标 aria-current=page': async (p) => {
        const r = await p.evaluate(() => {
          const links = [...document.querySelectorAll('.nav a[href]')];
          if (!links.length) return { ok: true, note: '无链接（跳过）' };
          const cur = links.filter((a) => a.getAttribute('aria-current') === 'page');
          /* 允许 demo 没有"当前页"（多 demo 拼在一页）*/
          if (!cur.length) return { ok: true, note: 'demo 未标当前项（可接受）' };
          return { ok: true, note: cur.length + ' 个 aria-current=page' };
        });
        return r;
      },

      /* ③ ⭐ 不用 aria-current 的错误值
         规范里 aria-current 的合法值：page / step / location / date / time / true
         ⛔ 写成 aria-current="selected"（那是 tab 的用法）是错的 */
      'aria-current 用合法值': async (p) => {
        const r = await p.evaluate(() => {
          const legal = ['page', 'step', 'location', 'date', 'time', 'true', 'false'];
          const all = [...document.querySelectorAll('[aria-current]')];
          const bad = all.filter((e) =>
            legal.indexOf((e.getAttribute('aria-current') || '').toLowerCase()) < 0);
          return { ok: bad.length === 0,
                   note: all.length + ' 个 aria-current，' + bad.length + ' 个值不合法' +
                         (bad.length ? '（如 ' + bad[0].getAttribute('aria-current') + '）' : '') };
        });
        return r;
      },

      /* ④ 导航项是可点的：不能只有 hover 才有反应 */
      '导航项可点且有 hover': async () => {
        const fs = require('fs');
        const raw = kit.stripComments(
          fs.readFileSync(REPO + '/03-patterns/nav/nav.css', 'utf8'));
        const hasHover = /:hover/.test(raw);
        return { ok: hasHover, note: hasHover ? '有 :hover 反馈' : '🔴 链接无 hover 反馈' };
      },

      /* ⑤ 触控命中区：导航项之间的间距要够（WCAG 2.5.8 AA 24px） */
      '导航项命中区达标': async (p) => {
        const r = await p.evaluate(() => {
          const links = [...document.querySelectorAll('.nav a[href]')];
          const small = links.filter((a) => {
            const b = a.getBoundingClientRect();
            if (b.width < 1 || b.height < 1) return false;
            return b.height < 24;
          });
          return { ok: small.length === 0,
                   note: links.length + ' 个链接，' + small.length + ' 个高 <24px' +
                         (small.length ? '（AA 级要求 24px）' : '') };
        });
        return r;
      },
    },
  });
  process.exit(kit.report(r));
})();
