const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * input-check.js — 输入框契约（B1.5  #3）
 *
 * 依据：WCAG 3.3.2 Labels or Instructions / 3.3.1 Error Identification /
 *      1.3.5 Identify Input Purpose + **HTML 规范对移动端的硬要求**
 */
(async () => {
  const r = await kit.check({
    name: 'input',
    url: 'http://127.0.0.1:8000/02-primitives/input/demo.html',
    dir: REPO + '/02-primitives/input',
    primary: '.field',
    interactive: '.field__input, .field__select, .field__textarea',

    extra: {
      /* ⭐ 移动端关键：inputmode 决定**弹出哪种键盘**。
         缺它 ⇒ 手机上 email 字段弹数字键盘、tel 弹全键盘。 */
      '数字/邮箱/电话类字段有 inputmode': async (p) => {
        const r = await p.evaluate(() => {
          const need = {
            email: 'email', tel: 'tel',
            number: 'numeric', search: 'search', url: 'url',
          };
          const out = { checked: 0, missing: [] };
          document.querySelectorAll('input, textarea').forEach((el) => {
            const t = (el.type || 'text').toLowerCase();
            const want = need[t];
            if (!want) return;
            out.checked++;
            const got = (el.getAttribute('inputmode') || '').toLowerCase();
            /* tel 允许空（有些场景不需要）*/
            if (want === 'tel' && !got) { out.checked--; return; }
            if (!got) out.missing.push(t + '(想要 ' + want + ')');
          });
          return out;
        });
        return { ok: r.missing.length === 0,
                 note: r.checked + ' 个字段检查' +
                       (r.missing.length ? '，缺 ' + r.missing.join(' ') : '') };
      },

      /* ⭐ 自动填充（移动端与效率的关键）：
         `autocomplete` 缺失 ⇒ 用户每次都要手打。 */
      '有 autocomplete 提示': async (p) => {
        const r = await p.evaluate(() => {
          const all = [...document.querySelectorAll('input:not([type=hidden])')];
          const withAc = all.filter((e) => e.getAttribute('autocomplete') !== null ||
                                         e.getAttribute('name'));
          return { n: all.length, ok: withAc.length };
        });
        return { ok: r.ok > 0,
                 note: r.ok + '/' + r.n + ' 个字段有 autocomplete/name' };
      },

      /* label 必须用 for 关联（点击 label 能聚焦输入框）
         🔴 判据修正（2026-10-04 反向控制发现的）：
            原来只报"有几个坏的"⇒ 删掉**一个** label 的 for 时，
            还有另外 7 个好的 ⇒ 报"0 个未关联"⇒ **假通过**。
         ⇒ 判据必须能**指出是哪一个**，这样删一个就会被点名。 */
      'label 用 for 关联输入框': async (p) => {
        const r = await p.evaluate(() => {
          const labels = [...document.querySelectorAll('label')];
          const bad = labels.filter((l) => {
            const f = l.getAttribute('for');
            return !f || !document.getElementById(f);
          }).map((l) => l.getAttribute('for') || '(无 for)');
          return { n: labels.length, bad: bad };
        });
        return { ok: r.bad.length === 0,
                 note: r.n + ' 个 label' + (r.bad.length
                   ? '，🔴 未关联：' + r.bad.join(' ') : '，全部正确') };
      },

      /* 点击 label 能真的聚焦输入框（label 的核心价值）*/
      '点 label 能聚焦输入框': async (p) => {
        const box = await p.evaluate(() => {
          const l = document.querySelector('label[for]');
          if (!l) return null;
          const r = l.getBoundingClientRect();
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
                   for: l.getAttribute('for') };
        });
        if (!box) return { ok: false, note: 'demo 里没有 label[for]' };
        /* 🔴 用真实鼠标坐标（见 contract-kit 坑 ⑤⑥）*/
        await p.mouse.click(box.x, box.y);
        await new Promise((r) => setTimeout(r, 250));
        const id = await p.evaluate(() => document.activeElement.id);
        return { ok: id === box.for,
                 note: '点 label 后焦点 = ' + (id || '(空)') + '，期望 ' + box.for };
      },

      /* 错误态要有 aria-invalid（读屏要播报"这个字段有错"）*/
      '错误态用 aria-invalid': async (p) => {
        const has = await p.evaluate(() => {
          /* demo 若没有错误态示例，则查 CSS 里有没有定义该状态 */
          const st = [...document.querySelectorAll('[aria-invalid="true"]')];
          if (st.length) return { ok: true, n: st.length };
          return { ok: false, n: 0 };
        });
        const cssHas = kit.stripComments(
          require('fs').readFileSync(
            REPO + '/02-primitives/input/input.css', 'utf8'));
        const cssOk = /aria-invalid|is-invalid|is-error|:invalid/.test(cssHas);
        return { ok: has.ok || cssOk,
                 note: (has.ok ? has.n + ' 个示例' : 'demo 无示例') +
                       (cssOk ? '；CSS 有错误态规则' : '；🔴 CSS 也没有错误态规则') };
      },

      /* 错误信息要能被读屏关联（aria-describedby 指向它）*/
      '错误信息用 aria-describedby 关联': async (p) => {
        const r = await p.evaluate(() => {
          const inv = document.querySelector('[aria-invalid="true"]');
          if (!inv) return { ok: true, note: 'demo 无错误态（跳过）' };
          const d = inv.getAttribute('aria-describedby');
          return { ok: !!d && !!document.getElementById(d),
                   note: d ? 'aria-describedby="' + d + '"' : '🔴 缺 aria-describedby' };
        });
        return r;
      },
    },
  });
  process.exit(kit.report(r));
})();
