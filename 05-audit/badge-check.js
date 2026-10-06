const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * badge-check.js — 徽标契约（B1.5  #5）
 *
 * ⭐ badge 是**纯展示**组件（不可点、不可聚焦）⇒ 通用契约里的
 *   「焦点环」「命中区」两条**不适用**，必须显式跳过并说明理由。
 *   ⚠️ 这类"按组件类型豁免"要写清理由，否则会被后人当成"漏做了"。
 */
(async () => {
  const r = await kit.check({
    name: 'badge',
    url: 'http://127.0.0.1:8000/02-primitives/badge/demo.html',
    dir: REPO + '/02-primitives/badge',
    // 🔴 badge 用 .badge（不是 .btn 之类），且它不可聚焦
    primary: '.badge',
    // 🔴 徽标不是可点元素 ⇒ 不查命中区（否则会报一堆"44px 不足"）
    interactive: '.badge--none, .badge[role="button"], .badge[tabindex], .badge--clickable',

    // 🔴 **显式豁免**焦点环：badge 是**纯展示**组件。
    //   ⚠️ 不是"删掉那条判据"—— 删掉后人会以为漏写了，又补回来。
    //   而是在框架里显式豁免，并让报告里仍然出现这一行（带豁免理由）。
    skipFocusRing: true,
    note: 'badge 是纯展示徽标，不可聚焦（组件专属判据里有"不可聚焦"一条兜着）',

    extra: {
      /* ---------- badge 专属：纯展示的三个必要条件 ---------- */

      '不可聚焦（纯展示）': async (p) => {
        const r = await p.evaluate(() => {
          const all = [...document.querySelectorAll('.badge')];
          if (!all.length) return { ok: false, note: 'demo 里没有 .badge' };
          const focusable = all.filter((e) =>
            e.hasAttribute('tabindex') || e.hasAttribute('contenteditable'));
          return { ok: focusable.length === 0,
                   note: all.length + ' 个徽标，' + focusable.length + ' 个可聚焦' };
        });
        return r;
      },

      '变体齐全（至少 4 个语义色）': async (p) => {
        const r = await p.evaluate(() => {
          const set = new Set();
          document.querySelectorAll('.badge').forEach((e) => {
            String(e.className).split(/\s+/).forEach((c) => {
              if (/^badge--/.test(c)) set.add(c);
            });
          });
          return { n: set.size, names: [...set] };
        });
        return { ok: r.n >= 4, note: r.n + ' 种：' + r.names.join(' ') };
      },

      /* ⭐ 语义色不能只靠颜色区分（WCAG 1.4.1）
         纯色块的徽标，色觉障碍用户分不清"警告"和"危险"。
         ⇒ 每个语义变体必须有一个**非颜色**线索：
            文字内容不同 / 前置图标 / aria-label。 */
      '语义色有非颜色线索': async (p) => {
        const r = await p.evaluate(() => {
          const sem = ['success', 'warning', 'danger', 'info'];
          const missing = [];
          sem.forEach((k) => {
            const el = document.querySelector('.badge--' + k);
            if (!el) return;                        // demo 没演示这个变体 ⇒ 跳过
            const txt = (el.textContent || '').trim();
            /* 有文字（且各变体文字不同）或带 aria-label 或带图标 任一即可 */
            const hasIcon = !!el.querySelector('svg, img, i, [class*="dot"], [class*="icon"]');
            const hasLabel = !!el.getAttribute('aria-label') ||
                             !!el.getAttribute('title');
            if (!txt && !hasIcon && !hasLabel) missing.push(k);
          });
          return { ok: missing.length === 0,
                   note: missing.length ? '🔴 纯色无线索：' + missing.join(' ')
                                        : '每个变体都有文字/图标/aria-label' };
        });
        return r;
      },

      /* 徽标不该有 hover 效果（它不是可点的）——
         有 :hover 却不能点，是"看起来能点其实不能"的反模式。 */
      'hover 只在可点变体上': async (p) => {
        const fs = require('fs');
        const raw = kit.stripComments(
          fs.readFileSync(REPO + '/02-primitives/badge/badge.css', 'utf8'));
        /* 找出所有 :hover 规则，看它们是否都限定在可点变体上 */
        const rules = raw.match(/[^{}]*:hover[^{}]*\{[^}]*\}/g) || [];
        const loose = rules.filter((s) => {
          const sel = s.slice(0, s.indexOf('{'));
          /* 限定了具体类/属性（.badge--x、[role=…]）才算可点 */
          return !/(\.badge--[a-z]|\[role=|\[tabindex|\.badge--clickable)/i.test(sel);
        });
        return { ok: loose.length === 0,
                 note: rules.length + ' 处 :hover，其中不限定的 ' + loose.length + ' 处' +
                       (loose.length ? '：' + loose[0].slice(0, 40) : '') };
      },
    },
  });
  process.exit(kit.report(r));
})();
