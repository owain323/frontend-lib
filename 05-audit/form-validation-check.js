const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * form-validation-check.js — 表单校验契约（总 A5）
 *
 * ⭐ 核心风险：**错误只画了红框/红字，读屏完全不知道**
 *   ⇒ 必须 aria-invalid="true" + aria-describedby 指向错误文案。
 */
(async () => {
  const r = await kit.check({
    name: 'form-validation',
    url: 'http://127.0.0.1:8000/03-patterns/form-validation/demo.html',
    dir: REPO + '/03-patterns/form-validation',
    primary: '.field',
    interactive: '.field input, .field select, .field textarea, .field button',

    extra: {
      '错误字段有 aria-invalid': async (p) => {
        const r = await p.evaluate(() => {
          const all = document.querySelectorAll('[aria-invalid]');
          const bad = [...all].filter((e) => {
            const v = e.getAttribute('aria-invalid');
            return v !== 'true' && v !== 'false';
          });
          return { ok: bad.length === 0,
                   note: all.length + ' 个字段标了，' + bad.length + ' 个值不合法' };
        });
        return r;
      },

      '错误文案被 aria-describedby 关联': async (p) => {
        const r = await p.evaluate(() => {
          const inv = [...document.querySelectorAll('[aria-invalid="true"]')];
          if (!inv.length) return { ok: true, note: 'demo 无错误态（跳过）' };
          const bad = inv.filter((e) => {
            const d = e.getAttribute('aria-describedby');
            return !d || !document.getElementById(d);
          });
          return { ok: bad.length === 0,
                   note: inv.length + ' 个错误字段，' + bad.length + ' 个未关联错误文案' };
        });
        return r;
      },

      /* ⭐ "输入有误" 是废话；"邮箱格式不对，应为 a@b.com" 才有用 */
      '错误文案具体（能说出怎么改）': async (p) => {
        const r = await p.evaluate(() => {
          const vague = ['有误', '错误', '无效', '不合法', 'error', 'invalid'];
          const ids = [...document.querySelectorAll('[aria-describedby]')]
            .map((e) => e.getAttribute('aria-describedby')).filter(Boolean);
          const texts = [...new Set(ids)].map((id) => {
            const el = document.getElementById(id);
            return el ? (el.textContent || '').trim() : '';
          }).filter(Boolean);
          if (!texts.length) return { ok: true, note: '无错误文案（跳过）' };
          const tooShort = texts.filter((t) => t.length < 6);
          const tooVague = texts.filter((t) =>
            vague.some((v) => t === v || t.length <= v.length + 2));
          return { ok: tooShort.length === 0 && tooVague.length === 0,
                   note: tooVague.length ? '🔴 太含糊：' + tooVague.join(' | ')
                        : (tooShort.length ? '🔴 太短：' + tooShort.join(' | ')
                                          : texts.length + ' 条文案都具体') };
        });
        return r;
      },

      '必填有 required 或 aria-required': async (p) => {
        const r = await p.evaluate(() => {
          const marked = document.querySelectorAll('[required], [aria-required="true"]');
          const inputs = document.querySelectorAll('.field input, .field select, .field textarea');
          const labelRequired = [...document.querySelectorAll('label')]
            .filter((l) => /[＊*]必填|required/i.test(l.textContent || ''));
          const unmark = labelRequired.filter((l) => {
            const f = l.getAttribute('for');
            const el = f ? document.getElementById(f) : l.querySelector('input,select,textarea');
            return el && !el.hasAttribute('required') &&
                   el.getAttribute('aria-required') !== 'true';
          });
          return { ok: unmark.length === 0,
                   note: inputs.length + ' 个输入，' + marked.length + ' 个标了必填，' +
                         unmark.length + ' 个视觉标了但语义没标' };
        });
        return r;
      },

      '错误态不能只靠颜色': async () => {
        const fs = require('fs');
        const raw = kit.stripComments(
          fs.readFileSync(REPO + '/03-patterns/form-validation/form-validation.css', 'utf8'));
        const errRules = raw.match(/[^{}]*(?:invalid|error)[^{}]*\{[^{}]*\}/gi) || [];
        if (!errRules.length) return { ok: true, note: '无错误态规则（跳过）' };
        const onlyColor = errRules.filter((r) => {
          const b = r.slice(r.indexOf('{') + 1);
          return /color\s*:/.test(b) && !/border|background|icon|content/.test(b);
        });
        return { ok: onlyColor.length === 0,
                 note: errRules.length + ' 条错误态规则，' +
                       (onlyColor.length ? '🔴 ' + onlyColor.length + ' 条只改颜色'
                                         : '都配合了边框/背景') };
      },
    },
  });
  process.exit(kit.report(r));
})();
