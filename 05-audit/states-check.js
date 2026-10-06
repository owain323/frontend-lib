const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * states-check.js — 状态组件契约（总 A4）
 *
 * ⭐ 状态组件的核心风险是「**只靠颜色表达状态**」（WCAG 1.4.1）：
 *   一个红色 badge，色觉障碍用户看不出是"错误"还是"警告"；
 *   ⇒ 每个状态必须有一条**非颜色**线索（文字 / 图标 / 形状 / role）。
 */
(async () => {
  const r = await kit.check({
    name: 'states',
    url: 'http://127.0.0.1:8000/03-patterns/states/demo.html',
    dir: REPO + '/03-patterns/states',
    primary: '.state',
    interactive: '.state button, .state a',
    skipFocusRing: true,
    note: 'states 的容器是纯展示；其中的按钮各自有焦点环',

    extra: {
      '状态不只靠颜色（WCAG 1.4.1）': async (p) => {
        const r = await p.evaluate(() => {
          const variants = new Set();
          document.querySelectorAll('[class*="state"], [class*="is-"]').forEach((e) => {
            String(e.className).split(/\s+/).forEach((c) => {
              if (/^(state--|is-)/.test(c)) variants.add(c);
            });
          });
          if (!variants.size) return { ok: true, note: '无状态变体（跳过）' };
          const noHint = [];
          variants.forEach((v) => {
            const el = document.querySelector('.' + v);
            if (!el) return;
            const hasText = (el.textContent || '').trim().length > 0;
            const hasIcon = !!el.querySelector('svg, img, i, [class*="icon"], [class*="dot"]');
            const hasRole = !!el.getAttribute('role');
            const hasAria = !!el.getAttribute('aria-label');
            if (!hasText && !hasIcon && !hasRole && !hasAria) noHint.push(v);
          });
          return { ok: noHint.length === 0,
                   note: variants.size + ' 个状态变体，' + noHint.length + ' 个无非颜色线索' +
                         (noHint.length ? '：' + noHint.join(' ') : '') };
        });
        return r;
      },

      'busy 态可被播报': async (p) => {
        const r = await p.evaluate(() => {
          const busy = document.querySelector('.is-busy, .state--busy, [aria-busy]');
          if (!busy) return { ok: true, note: 'demo 无 busy 态（跳过）' };
          const has = busy.hasAttribute('aria-busy') ||
                      busy.getAttribute('role') ||
                      busy.getAttribute('aria-label');
          return { ok: !!has, note: has ? '有 aria-busy/role/label' : '🔴 busy 态无任何提示' };
        });
        return r;
      },

      '空状态给出下一步': async (p) => {
        const r = await p.evaluate(() => {
          const empty = document.querySelector('.state--empty, .is-empty, [class*="empty"]');
          if (!empty) return { ok: true, note: 'demo 无空状态（跳过）' };
          const hasAction = !!empty.querySelector('a, button');
          return { ok: hasAction,
                   note: hasAction ? '有行动入口' : '🔴 空状态无任何可点操作' };
        });
        return r;
      },

      /* 骨架屏不能只靠灰块（要有 aria-busy 或文字说明在加载）
         🔴 判据修正：
            原来查 `.skeleton` 元素本身，但它被正确地标了 `aria-hidden="true"`
            （灰块是纯装饰，对 AT 无意义）⇒ 判据永远失败。
            ⇒ 正解：查**承载骨架屏的容器**，它才该带 role="status" / aria-busy。
            ⚠️ 顺带：把"内部灰块必须 aria-hidden"也一起查了 ——
               容器有了语义之后，灰块若不对 AT 隐藏，读屏会念出一堆空 div。 */
      '骨架屏有加载提示': async (p) => {
        const r = await p.evaluate(() => {
          const block = document.querySelector('.skeleton');
          if (!block) return { ok: true, note: 'demo 无骨架屏（跳过）' };
          /* 向上找承载容器（含 border / role 的那一层） */
          let host = block.parentElement, hops = 0;
          while (host && hops < 5) {
            const c = host.getAttribute('role');
            const busy = host.getAttribute('aria-busy');
            const lbl = host.getAttribute('aria-label');
            if (c || busy || lbl) break;
            host = host.parentElement; hops++;
          }
          const ok = host && host !== document.body && (
            host.getAttribute('role') === 'status' ||
            host.hasAttribute('aria-busy') ||
            !!host.getAttribute('aria-label'));
          /* 内部灰块必须对 AT 隐藏 */
          const blocks = [...document.querySelectorAll('.skeleton')];
          const notHidden = blocks.filter((b) => b.getAttribute('aria-hidden') !== 'true');
          return { ok: !!(ok && notHidden.length === 0),
                   note: !ok ? '🔴 承载容器无 role/aria-busy/aria-label'
                        : (notHidden.length
                            ? '🔴 ' + notHidden.length + ' 个灰块未标 aria-hidden（读屏会念空 div）'
                            : '容器有 role=status + ' + blocks.length + ' 个灰块已隐藏') };
        });
        return r;
      },
    },
  });
  process.exit(kit.report(r));
})();
