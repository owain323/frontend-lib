const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * choice-check.js — 单选/复选契约（总 A6）
 *
 * ⭐ 核心原则：**用原生 input，不要用 div 模拟**。
 *   原生自带：键盘（Tab/方向键/空格）、表单提交、读屏播报、禁用态。
 *   div 模拟这些全要自己写 ⇒ 90% 的自建选择控件都漏了其中几项。
 */
(async () => {
  const r = await kit.check({
    name: 'choice',
    url: 'http://127.0.0.1:8000/02-primitives/choice/demo.html',
    dir: REPO + '/02-primitives/choice',
    primary: '.choice',
    // 🔴 原生 input 可能被视觉隐藏（opacity:0）⇒ 命中区要看 label
    interactive: '.choice__label, .choice input',

    extra: {
      /* ① 用原生 input，不用 div 模拟 */
      '用原生 input（不 div 模拟）': async (p) => {
        const r = await p.evaluate(() => {
          const groups = document.querySelectorAll('.choice, fieldset');
          if (!groups.length) return { ok: false, note: '没有选择组' };
          /* 找纯 div 模拟的（没有 input 在里面）*/
          const faux = [...groups].filter((g) =>
            !g.querySelector('input[type=radio], input[type=checkbox]'));
          return { ok: faux.length === 0,
                   note: groups.length + ' 组，' +
                         (groups.length - faux.length) + ' 组用了原生 input，' +
                         faux.length + ' 组是 div 模拟' };
        });
        return r;
      },

      /* ② 每个 input 都有可访问名（label for / 包裹 / aria-label） */
      '每个选项都有可访问名': async (p) => {
        const r = await p.evaluate(() => {
          const inputs = [...document.querySelectorAll('.choice input')];
          if (!inputs.length) return { ok: true, note: '无 input（跳过）' };
          const bad = inputs.filter((e) => {
            if (e.getAttribute('aria-label')) return false;
            if (e.getAttribute('aria-labelledby')) return false;
            const id = e.id;
            if (id && document.querySelector('label[for="' + id + '"]')) return false;
            if (e.closest('label')) return false;
            return true;
          });
          return { ok: bad.length === 0,
                   note: inputs.length + ' 个选项，' + bad.length + ' 个无可访问名' };
        });
        return r;
      },

      /* ③ ⭐ 分组要有 fieldset+legend 或 role=radiogroup + aria-label
         否则读屏只念"单选按钮 已选中"，不知道在选什么 */
      '选项组有分组语义': async (p) => {
        const r = await p.evaluate(() => {
          /* 找所有 radio 组（同名 radio）*/
          const byName = {};
          document.querySelectorAll('input[type=radio]').forEach((r) => {
            const n = r.name || '(无名)';
            (byName[n] = byName[n] || []).push(r);
          });
          const groups = Object.keys(byName).map((k) => byName[k]);
          const multi = groups.filter((g) => g.length > 1);
          if (!multi.length) return { ok: true, note: '无多选组（跳过）' };
          const bad = multi.filter((g) => {
            /* 在 fieldset 里，或祖先有 role=radiogroup */
            const box = g[0].closest('fieldset, [role="radiogroup"], .choice__group');
            if (!box) return true;
            const hasName = !!box.querySelector('legend') ||
                            !!box.getAttribute('aria-label') ||
                            !!box.getAttribute('aria-labelledby');
            return !hasName;
          });
          return { ok: bad.length === 0,
                   note: multi.length + ' 个 radio 组，' + bad.length + ' 组缺 fieldset/legend 或 radiogroup 标签' };
        });
        return r;
      },

      /* ④ 选中态不能只靠颜色（WCAG 1.4.1）—— 必须有勾/圆点等形状线索 */
      '选中态有非颜色线索': async () => {
        const fs = require('fs');
        const raw = kit.stripComments(
          fs.readFileSync(REPO + '/02-primitives/choice/choice.css', 'utf8'));
        /* 选中态规则里应有 ::after / content / border 变化 / 勾号 */
        const sel = raw.match(/[^{}]*:checked[^{}]*\{[^{}]*\}/g) || [];
        if (!sel.length) return { ok: false, note: '🔴 没有 :checked 规则' };
        const shape = sel.filter((r) =>
          /::after|::before|content\s*:|background|border-width|transform|scale/.test(r));
        return { ok: shape.length > 0,
                 note: sel.length + ' 条 :checked 规则，' +
                       shape.length + ' 条带形状/勾号线索' +
                       (shape.length ? '' : '（🔴 只改颜色）') };
      },

      /* ⑤ 禁用的选项：原生 disabled + 视觉可辨 */
      '禁用态用原生 disabled': async (p) => {
        const r = await p.evaluate(() => {
          const dis = [...document.querySelectorAll('.choice input')];
          const off = dis.filter((e) => e.disabled || e.getAttribute('aria-disabled') === 'true');
          if (!off.length) return { ok: true, note: 'demo 无禁用项（跳过）' };
          const proper = off.filter((e) => e.disabled);
          return { ok: proper.length === off.length,
                   note: off.length + ' 个禁用，' + proper.length + ' 个用原生 disabled' +
                         (proper.length < off.length ? '（其余只有 aria-disabled，仍可聚焦）' : '') };
        });
        return r;
      },
    },
  });
  process.exit(kit.report(r));
})();
