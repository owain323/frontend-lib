const kit = require('./contract-kit.js');

/**
 * popover-check.js — 气泡卡片契约
 *
 * ============================================================================
 * ⭐ 这个组件最该被守住的是什么
 * ---------------------------------------------------------------------------
 *  popover 与 dialog 的**唯一区别**是「非模态」：
 *    dialog : 背景锁死 + focus trap + 必须处理完
 *    popover: 背景**仍可交互** + 焦点进入但不 trap
 *
 *  ⚠️ 一旦有人给 popover 加了 aria-modal 或 focus trap，
 *     它就退化成了 dialog，而用户仍然以为它非模态 ⇒ 交互行为与预期不符。
 *  ⇒ 本契约专门守这条分界线。
 * ============================================================================
 */
(async () => {
  const r = await kit.check({
    name: 'popover',
    url: 'http://127.0.0.1:8000/02-primitives/popover/demo.html',
    dir: require('path').resolve(__dirname, '..', '02-primitives', 'popover'),
    primary: '.popover',
    interactive: '.btn, button',
    note: 'popover 本身是浮层，焦点环判据由触发器承担',

    extra: {
      /* ---------- ① 四个方向齐全 ---------- */
      '四个方向齐全': async (p) => {
        const v = await p.evaluate(() => ({
          bottom: !!document.querySelector('.popover--bottom'),
          top: !!document.querySelector('.popover--top'),
          end: !!document.querySelector('.popover--end'),
          start: !!document.querySelector('.popover--start'),
        }));
        const miss = Object.keys(v).filter((k) => !v[k]);
        if (miss.length) return { ok: false, why: '缺少方向：' + miss.join(', ') };
        return { ok: true, why: 'bottom / top / end / start 齐全' };
      },

      /* ---------- ② ⭐ 非模态：绝不能有 aria-modal ---------- */
      '非模态：没有 aria-modal（这是与 dialog 的分界）': async (p) => {
        const v = await p.evaluate(async () => {
          const btn = document.getElementById('p1');
          btn.click();
          await new Promise((r) => setTimeout(r, 300));
          const box = document.querySelector('.popover');
          return {
            role: box ? box.getAttribute('role') : null,
            modal: box ? box.getAttribute('aria-modal') : null,
            roleDesc: box ? box.getAttribute('aria-description') : null,
            open: box ? box.getAttribute('data-open') : null,
          };
        });
        if (!v.open || v.open !== 'true') {
          return { ok: false, why: '点击后浮层未打开（data-open 不是 true）' };
        }
        if (v.modal === 'true') {
          return { ok: false, why: '🔴 popover 上有 aria-modal="true" ⇒ ' +
            '它被当成了模态框，与 dialog 混为一谈' };
        }
        if (v.role !== 'dialog') {
          return { ok: false, why: 'role 应为 dialog（实际 ' + v.role + '）' };
        }
        return { ok: true, why: 'role=dialog 且**无** aria-modal（非模态）' };
      },

      /* ---------- ③ 背景仍可交互 ---------- */
      '非模态：背景未被 inert 锁死': async (p) => {
        const v = await p.evaluate(() => {
          const layers = [...document.body.children].filter(
            (el) => el.offsetParent !== null);
          const locked = layers.filter(
            (el) => el.hasAttribute('inert') ||
                    el.getAttribute('aria-hidden') === 'true');
          return { total: layers.length, locked: locked.length };
        });
        if (v.locked > 0) {
          return { ok: false, why: '🔴 背景有 ' + v.locked + ' 层被 inert/aria-hidden ⇒ ' +
            '这是模态行为，popover 不该锁背景' };
        }
        return { ok: true, why: v.total + ' 层背景均未被锁定 ✅' };
      },

      /* ---------- ④ 焦点进入但不 trap ---------- */
      '焦点进入浮层，但不被 trap 困住': async (p) => {
        const before = await p.evaluate(() => {
          const b = document.getElementById('p5');
          b.focus();
          return document.activeElement === b;
        });
        if (!before) return { ok: false, why: '无法聚焦触发器' };

        await p.evaluate(() => document.getElementById('p5').click());
        await new Promise((r) => setTimeout(r, 300));

        /* 🔴 判据修正：demo 里有多个 popover，必须**按触发器定位**，
         *   用 document.querySelector('.popover') 只会拿到第一个 ——
         *   测的根本不是刚打开的那个（本次就因此误报）。 */
        const inside = await p.evaluate(() => {
          const anchor = document.getElementById('p5').closest('.popover-anchor');
          const box = anchor ? anchor.querySelector('.popover') : null;
          return box ? box.contains(document.activeElement) : false;
        });
        if (!inside) {
          return { ok: false, why: '打开后焦点没进入浮层 ⇒ 键盘用户无法直接操作' };
        }

        /* ⭐ 反向：连按 14 次 Tab，焦点**应该**能走出浮层（非模态不该困住） */
        let escaped = 0;
        for (let i = 0; i < 14; i++) {
          await p.keyboard.press('Tab');
          const out = await p.evaluate(() => {
            const anchor = document.getElementById('p5').closest('.popover-anchor');
            const box = anchor ? anchor.querySelector('.popover') : null;
            return !!(box && !box.contains(document.activeElement));
          });
          if (out) escaped++;
        }
        if (escaped === 0) {
          return { ok: false, why: '🔴 连按 14 次 Tab 都出不去 ⇒ ' +
            '被 focus trap 困住了，那是 dialog 的行为' };
        }
        return { ok: true, why: '焦点能进入，也能走出去（非模态正确）' };
      },

      /* ---------- ⑤ Esc 关闭 + 焦点归还 ---------- */
      'Esc 关闭且焦点归还到触发器': async (p) => {
        await p.evaluate(() => {
          window.Popover.closeAll();
          document.getElementById('p6').focus();
        });
        await new Promise((r) => setTimeout(r, 200));
        await p.evaluate(() => document.getElementById('p6').click());
        await new Promise((r) => setTimeout(r, 300));

        const opened = await p.evaluate(() =>
          !!document.querySelector('.popover[data-open="true"]'));
        if (!opened) return { ok: false, why: '未能打开浮层' };

        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 300));

        const v = await p.evaluate(() => ({
          closed: !document.querySelector('.popover[data-open="true"]'),
          back: document.activeElement ? document.activeElement.id : '(none)',
        }));
        if (!v.closed) return { ok: false, why: 'Esc 关不掉' };
        if (v.back !== 'p6') {
          return { ok: false, why: '关闭后焦点在「' + v.back + '」⇒ ' +
            '应归还到触发器 p6' };
        }
        return { ok: true, why: 'Esc 关闭 + 焦点已归还' };
      },

      /* ---------- ⑥ 点内部不关闭、点外部才关闭 ---------- */
      '点浮层内部不关闭，点外部才关闭': async (p) => {
        await p.evaluate(() => {
          window.Popover.closeAll();
          document.getElementById('p1').click();
        });
        await new Promise((r) => setTimeout(r, 300));

        /* 点浮层内部（不关） */
        await p.evaluate(() => {
          const box = document.querySelector('.popover[data-open="true"]');
          if (box) box.click();
        });
        await new Promise((r) => setTimeout(r, 250));
        const stillOpen = await p.evaluate(() =>
          !!document.querySelector('.popover[data-open="true"]'));
        if (!stillOpen) {
          return { ok: false, why: '🔴 点浮层**内部**就关了 ⇒ ' +
            '最常见的 popover bug（点任何交互元素都会被关掉）' };
        }

        /* 点外部（关） */
        await p.evaluate(() => {
          window.Popover.closeAll();
          document.getElementById('p1').click();
        });
        await new Promise((r) => setTimeout(r, 300));
        await p.evaluate(() => document.body.click());
        await new Promise((r) => setTimeout(r, 250));
        const closed = await p.evaluate(() =>
          !document.querySelector('.popover[data-open="true"]'));
        if (!closed) {
          return { ok: false, why: '点外部没关闭' };
        }
        return { ok: true, why: '内部点击保持打开，外部点击关闭 ✅' };
      },

      /* ---------- ⑦ 关闭态内容不可聚焦 ---------- */
      '关闭态的内容不可被 Tab 到': async (p) => {
        const v = await p.evaluate(() => {
          const anchor = document.getElementById('p1').closest('.popover-anchor');
          const box = anchor ? anchor.querySelector('.popover') : null;
          if (!box) return null;
          /* ⭐ 判据用 **inert**，不是 pointer-events ——
           *   实测：pointer-events:none 拦不住 Tab。 */
          const inner = box.querySelector('button, input, a[href]');
          return {
            open: box.getAttribute('data-open'),
            inert: box.hasAttribute('inert'),
            innerTabbable: inner ? !inner.hasAttribute('inert') &&
                                  inner.getAttribute('tabindex') !== '-1' : false,
          };
        });
        if (!v) return { ok: false, why: '找不到 p1 对应的浮层' };
        if (v.open === 'true') return { ok: false, why: '浮层当前是打开态，无法验证关闭态' };
        if (!v.inert) {
          return { ok: false, why: '关闭态没有 inert ⇒ 内部按钮仍能被 Tab 到' +
            '（pointer-events 拦不住 Tab）' };
        }
        return { ok: true, why: '关闭态已 inert，内部不可聚焦 ✅' };
      },
    },
  });
  process.exit(kit.report ? kit.report(r) : (r ? 0 : 1));
})();
