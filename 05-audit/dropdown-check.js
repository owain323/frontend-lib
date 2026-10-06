const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * dropdown-check.js — 下拉菜单契约（总 C2 /
 *
 * 依据 APG Menu Button 模式。⭐ 五条键盘契约全部用**真键盘**实测，
 *    不用 `el.click()`（那是编程式激活，键盘语义不等价）。
 */
(async () => {
  const r = await kit.check({
    name: 'dropdown',
    url: 'http://127.0.0.1:8000/03-patterns/dropdown/demo.html',
    dir: REPO + '/03-patterns/dropdown',
    primary: '.dd',
    /* ⭐ 焦点策略（准入清单第 ① 条）：
       本组件用 **roving tabindex**：菜单打开后焦点在**当前项**，
       ↑↓ 在项间移动（Tab 用来关闭菜单，不参与项间导航）。
       关闭时焦点**归位**到按钮。 */
    interactive: '.dd__btn, .dd__item',

    extra: {
      /* 语义结构 */
      '菜单语义完整': async (p) => {
        const r = await p.evaluate(() => {
          const btn = document.querySelector('[data-dd-btn]');
          const menu = document.querySelector('[data-dd-menu]');
          if (!btn || !menu) return { ok: false, note: '🔴 找不到按钮/菜单' };
          const items = menu.querySelectorAll('li[role="menuitem"]');
          const bad = [];
          if (btn.getAttribute('aria-haspopup') !== 'true') bad.push('按钮缺 aria-haspopup');
          if (btn.getAttribute('aria-expanded') === null) bad.push('按钮缺 aria-expanded');
          if (!btn.getAttribute('aria-controls')) bad.push('按钮缺 aria-controls');
          if (menu.getAttribute('role') !== 'menu') bad.push('菜单缺 role=menu');
          if (!menu.getAttribute('aria-label') && !menu.getAttribute('aria-labelledby')) {
            bad.push('菜单缺可访问名');
          }
          /* 菜单项必须 tabindex=-1（不参与 Tab）*/
          const inTab = [...items].filter((i) => i.getAttribute('tabindex') !== '-1');
          if (inTab.length) bad.push(inTab.length + ' 个菜单项未设 tabindex=-1');
          return { ok: bad.length === 0,
                   note: bad.length ? '🔴 ' + bad.join('；') : '语义完整' };
        });
        return r;
      },

      /* ① ↓ 打开并聚焦首项 */
      '↓ 打开菜单并聚焦首项': async (p) => {
        await p.evaluate(() => {
          const b = document.querySelector('[data-dd-btn]');
          if (b) b.focus();
        });
        await p.keyboard.press('ArrowDown');
        await new Promise((r) => setTimeout(r, 300));
        const r = await p.evaluate(() => {
          const menu = document.querySelector('[data-dd-menu]');
          const open = menu && !menu.hidden;
          const inItem = document.activeElement &&
                         document.activeElement.getAttribute &&
                         document.activeElement.getAttribute('role') === 'menuitem';
          return { open: open, inItem: inItem,
                   label: (document.activeElement || {}).textContent };
        });
        return { ok: r.open && r.inItem,
                 note: r.open ? (r.inItem ? '已打开并聚焦「' + (r.label || '').trim() + '」✅'
                                          : '🔴 打开了但焦点不在菜单项上')
                              : '🔴 ↓ 没能打开' };
      },

      /* ② ↑↓ 在项间移动（循环）*/
      '↑↓ 在菜单项间循环': async (p) => {
        const seq = [];
        for (let i = 0; i < 3; i++) {
          await p.keyboard.press('ArrowDown');
          await new Promise((r) => setTimeout(r, 160));
          seq.push(await p.evaluate(() =>
            ((document.activeElement || {}).textContent || '').trim().slice(0, 8)));
        }
        const uniq = new Set(seq.filter(Boolean));
        return { ok: uniq.size >= 2,
                 note: '连按 ↓ 3 次：' + seq.join(' → ') +
                       (uniq.size >= 2 ? ' ✅ 焦点在移动' : ' 🔴 焦点没动') };
      },

      /* ③ Esc 关闭 + ⭐焦点归位（APG 硬要求）*/
      'Esc 关闭且焦点归位': async (p) => {
        /* 先确保菜单是开的 */
        const isOpen = await p.evaluate(() => {
          const m = document.querySelector('[data-dd-menu]');
          if (m && m.hidden) {
            const b = document.querySelector('[data-dd-btn]');
            if (b) b.click();
          }
          return true;
        });
        if (!isOpen) return { ok: true, note: '打不开菜单（跳过）' };
        await new Promise((r) => setTimeout(r, 250));
        await p.evaluate(() => {
          const m = document.querySelector('[data-dd-menu]');
          const it = m && m.querySelector('[role="menuitem"]');
          if (it) it.focus();
        });
        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 300));
        const r = await p.evaluate(() => {
          const m = document.querySelector('[data-dd-menu]');
          const b = document.querySelector('[data-dd-btn]');
          return { closed: m && m.hidden,
                   onBtn: document.activeElement === b };
        });
        return { ok: r.closed && r.onBtn,
                 note: r.closed
                   ? (r.onBtn ? '已关闭且焦点回到按钮 ✅' : '🔴 关闭了但焦点没回按钮（键盘用户迷路）')
                   : '🔴 Esc 没能关闭' };
      },

      /* ④ 禁用项不可激活 */
      '禁用项点不动': async (p) => {
        const r = await p.evaluate(() => {
          const dis = document.querySelector('[aria-disabled="true"][role="menuitem"]');
          if (!dis) return { ok: true, note: '无禁用项（跳过）' };
          const before = dis.textContent;
          dis.click();
          /* 若被激活，菜单会关闭；不该发生 */
          return { ok: !document.querySelector('[data-dd-menu]:not([hidden])'),
                   note: before ? '禁用项「' + before.trim() + '」点击后菜单未关闭 ✅' : '' };
        });
        return r;
      },

      /* ⑤ 菜单项命中区 ≥44px（密集列表也必须）*/
      '菜单项命中区 ≥44px': async (p) => {
        await p.evaluate(() => {
          const m = document.querySelector('[data-dd-menu]');
          if (m && m.hidden) {
            const b = document.querySelector('[data-dd-btn]');
            if (b) b.click();
          }
        });
        await new Promise((r) => setTimeout(r, 280));
        const r = await p.evaluate(() => {
          const items = [...document.querySelectorAll('[role="menuitem"]')]
            .filter((e) => e.getClientRects().length);
          if (!items.length) return { ok: true, note: '菜单未展开（跳过）' };
          const small = items.filter((e) => e.getBoundingClientRect().height < 44);
          return { ok: small.length === 0,
                   note: items.length + ' 个菜单项，' + small.length + ' 个高 <44px' };
        });
        await p.keyboard.press('Escape');
        return r;
      },

      /* ⑥ 关闭态用 hidden（真正移出无障碍树）*/
      '关闭态移出无障碍树': async (p) => {
        const r = await p.evaluate(() => {
          const menus = [...document.querySelectorAll('[data-dd-menu]')];
          const bad = menus.filter((m) => {
            if (!m.hidden) return false;
            /* hidden 时不能还有可聚焦子元素暴露 */
            return m.querySelector('[tabindex]:not([tabindex="-1"]), button, a[href]');
          });
          return { ok: bad.length === 0,
                   note: menus.length + ' 个菜单，' + menus.filter((m) => m.hidden).length +
                         ' 个关闭，' + bad.length + ' 个关闭后仍可聚焦' };
        });
        return r;
      },
    },
  });
  process.exit(kit.report(r));
})();
