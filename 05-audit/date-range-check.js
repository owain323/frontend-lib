const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * date-range-check.js — 日期区间契约（总 E3 /
 *
 * ⭐ 三条最容易漏的（每条都做成判据）：
 *   ① **必须有「清除」**（一键清空，不是逐个退格）
 *   ② **约束校验**：开始晚于结束 / 超出范围 ⇒ **明确报错**（不静默）
 *   ③ 无障碍：每个 input 有 label；错误有 role=alert
 */
(async () => {
  const r = await kit.check({
    name: 'date-range',
    url: 'http://127.0.0.1:8000/02-primitives/date-range/demo.html',
    dir: REPO + '/02-primitives/date-range',
    primary: '.drange',
    interactive: '.drange__input, .drange__preset, .drange__clear',
    skipFocusRing: true,
    note: '容器不聚焦（焦点在 input 上）',
    /* 🔴 快捷按钮（本月/上月/今年…）用 **32px**，这是**有意的**：
       它们是**次要快捷方式**（主要路径是手填日期），
       若给 44px，一行放不下 5 个，日期框就被挤到换行。
       WCAG 2.5.8（AA）要求 24px，32px 已**超出**。
       ⚠️ 而 AAA 的 44px 是给**主要可点目标**的（日期框与清除按钮都是 44px）——
          这一点必须写清，否则会有人"为了达标"把布局撑坏。 */
    skipHitArea: true,
    hitAreaNote: '快捷按钮 32px（AA 只需 24px；主要目标日期框/清除按钮均为 44px）',

    extra: {
      /* 每个 input 有 label */
      '每个日期框都有 label': async (p) => {
        const r = await p.evaluate(() => {
          const ins = [...document.querySelectorAll('[data-dr-from], [data-dr-to]')];
          if (!ins.length) return { ok: false, note: '🔴 没有日期框' };
          const bad = ins.filter((el) => {
            if (el.getAttribute('aria-label')) return false;
            if (el.id && document.querySelector('label[for="' + el.id + '"]')) return false;
            if (el.closest('label')) return false;
            return true;
          });
          return { ok: bad.length === 0,
                   note: ins.length + ' 个日期框，' + bad.length + ' 个缺 label' };
        });
        return r;
      },

      /* ① ⭐ 必须有「清除」按钮 */
      '有清除按钮（且清得干净）': async (p) => {
        const hasBtn = await p.evaluate(() => !!document.querySelector('[data-dr-clear]'));
        if (!hasBtn) return { ok: false, note: '🔴 没有清除按钮（用户只能逐个退格）' };
        /* 真填两个值再点清除，验确实清空 */
        await p.evaluate(() => {
          const f = document.querySelector('#d1 [data-dr-from]');
          const t = document.querySelector('#d1 [data-dr-to]');
          if (f) f.value = '2026-01-01';
          if (t) t.value = '2026-03-31';
          f && f.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await new Promise((r) => setTimeout(r, 260));
        const filled = await p.evaluate(() => {
          const f = document.querySelector('#d1 [data-dr-from]');
          return f ? f.value : '';
        });
        await p.evaluate(() => {
          const b = document.querySelector('#d1 [data-dr-clear]');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 300));
        const after = await p.evaluate(() => {
          const f = document.querySelector('#d1 [data-dr-from]');
          const t = document.querySelector('#d1 [data-dr-to]');
          return { f: f ? f.value : '(无)', t: t ? t.value : '(无)' };
        });
        return { ok: filled !== '' && after.f === '' && after.t === '',
                 note: '填入「' + filled + '」→ 清除 → from=' + (after.f || '(空)') +
                       ' to=' + (after.t || '(空)') +
                       (after.f === '' && after.t === '' ? ' ✅ 已清空' : ' 🔴 没清干净') };
      },

      /* ②-a 开始晚于结束 ⇒ 报错 */
      '开始晚于结束会报错': async (p) => {
        await p.evaluate(() => {
          const f = document.querySelector('#d1 [data-dr-from]');
          const t = document.querySelector('#d1 [data-dr-to]');
          if (f) f.value = '2026-06-30';
          if (t) t.value = '2026-01-01';
          f && f.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await new Promise((r) => setTimeout(r, 300));
        const r = await p.evaluate(() => {
          const e = document.querySelector('#d1 [data-dr-error]');
          const f = document.querySelector('#d1 [data-dr-from]');
          return { shown: e ? !e.hidden : false,
                   msg: e ? e.textContent.trim().slice(0, 40) : '',
                   invalid: f ? f.getAttribute('aria-invalid') : null,
                   described: f ? !!f.getAttribute('aria-describedby') : false,
                   role: e ? e.getAttribute('role') : null };
        });
        /* 复原 */
        await p.evaluate(() => {
          const b = document.querySelector('#d1 [data-dr-clear]');
          if (b) b.click();
        });
        await new Promise((x) => setTimeout(x, 260));
        return { ok: r.shown && r.invalid === 'true' && r.described,
                 note: (r.shown ? '已报错：「' + r.msg + '」' : '🔴 没报错') +
                       ' · aria-invalid=' + r.invalid +
                       ' · describedby=' + r.described +
                       ' · role=' + r.role +
                       (r.shown && r.invalid === 'true' ? ' ✅' : '') };
      },

      /* ②-b 超出 min/max 会报错 */
      '超出 min/max 会报错': async (p) => {
        await p.evaluate(() => {
          const f = document.querySelector('#d2 [data-dr-from]');
          const t = document.querySelector('#d2 [data-dr-to]');
          if (f) f.value = '2019-05-01';
          if (t) t.value = '2019-12-31';
          f && f.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await new Promise((r) => setTimeout(r, 300));
        const r = await p.evaluate(() => {
          const e = document.querySelector('#d2 [data-dr-error]');
          const f = document.querySelector('#d2 [data-dr-from]');
          const t = document.querySelector('#d2 [data-dr-to]');
          return { shown: e ? !e.hidden : false,
                   msg: e ? e.textContent.trim().slice(0, 34) : '',
                   min: f ? f.getAttribute('min') : null,
                   max: t ? t.getAttribute('max') : null };
        });
        await p.evaluate(() => {
          const b = document.querySelector('#d2 [data-dr-clear]');
          if (b) b.click();
        });
        await new Promise((x) => setTimeout(x, 240));
        return { ok: r.shown && r.min === '2020-01-01' && r.max === '2026-12-31',
                 note: 'min=' + r.min + ' max=' + r.max +
                       (r.shown ? ' · 填 2019 年⇒ 已报错：「' + r.msg + '」 ✅' : ' · 🔴 没报错') };
      },

      /* ③ 错误框有 role=alert（会被读屏播报）*/
      '错误区有 role=alert': async (p) => {
        const r = await p.evaluate(() => {
          const e = document.querySelector('[data-dr-error]');
          if (!e) return { ok: false, note: '🔴 没有错误容器' };
          return { ok: e.getAttribute('role') === 'alert',
                   note: 'role=' + e.getAttribute('role') +
                         (e.getAttribute('role') === 'alert' ? ' ✅ 会被读屏播报' : ' 🔴 不会播报') };
        });
        return r;
      },

      /* 快捷区间：点了要填上日期 + 标记 aria-pressed */
      '快捷区间可用并标记选中': async (p) => {
        await p.evaluate(() => {
          const b = document.querySelector('#d2 [data-dr-preset="lastQ"]');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 320));
        const r = await p.evaluate(() => {
          const f = document.querySelector('#d2 [data-dr-from]');
          const t = document.querySelector('#d2 [data-dr-to]');
          const pressed = document.querySelectorAll('#d2 [aria-pressed="true"]');
          return { from: f ? f.value : '', to: t ? t.value : '', pressed: pressed.length,
                   n: document.querySelectorAll('#d2 [data-dr-preset]').length };
        });
        return { ok: r.from !== '' && r.to !== '' && r.from <= r.to && r.pressed === 1,
                 note: r.n + ' 个快捷项 · 点「上季度」→ ' + r.from + ' → ' + r.to +
                       ' · aria-pressed 选中 ' + r.pressed + ' 个' +
                       (r.pressed === 1 ? ' ✅' : ' 🔴 未标记') };
      },

      /* 月末溢出防护：1/31 加一个月应是 2/28，不是 3/3 */
      '月末加月不溢出': async (p) => {
        const r = await p.evaluate(() => {
          if (!window.DateRange || !DateRange.addMonths) {
            return { ok: true, note: 'addMonths 未暴露（跳过）' };
          }
          return { a: DateRange.addMonths('2026-01-31', 1),
                   b: DateRange.addMonths('2026-03-31', -1),
                   c: DateRange.addMonths('2024-02-29', 12) };
        });
        if (r.note) return { ok: true, note: r.note };
        /* +1 月 = 2026-02-28（2026 非闰年）*/
        return { ok: r.a === '2026-02-28' && r.b === '2026-02-28' && r.c === '2025-02-28',
                 note: '01-31 +1月=' + r.a + '（应 02-28）· 03-31 -1月=' + r.b +
                       '（应 02-28）· 2024-02-29 +12月=' + r.c + '（应 2025-02-28）' +
                       (r.a === '2026-02-28' ? ' ✅ 月末已收敛' : ' 🔴 溢出成了 3/3') };
      },

      /* 正常区间：天数计算正确（含首尾）*/
      '天数计算含首尾': async (p) => {
        const r = await p.evaluate(() => {
          const dr = window.__dr1;
          if (!dr) return { ok: true, note: '无探针（跳过）' };
          dr.set('2026-01-01', '2026-01-31');
          return { sum: document.querySelector('#d1 [data-dr-summary]').textContent };
        });
        if (r.note) return { ok: true, note: r.note };
        return { ok: r.sum.indexOf('31 天') >= 0,
                 note: '1/1→1/31 摘要「' + r.sum.trim() + '」' +
                       (r.sum.indexOf('31 天') >= 0 ? ' ✅ 含首尾' : ' 🔴 天数不对') };
      },
    },
  });
  process.exit(kit.report(r));
})();
