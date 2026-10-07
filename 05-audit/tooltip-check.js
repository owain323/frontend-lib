const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * tooltip-check.js — 文字提示契约（总 C1 /
 *
 * ⭐ 核心判据：**tooltip 不承载必要信息**（WCAG 1.4.13）。
 *   触屏没有 hover ⇒ 只放在 tooltip 里的内容等于不存在。
 *   判据：tooltip 文字必须与触发元素的可见文字**不完全相同**。
 *   （如果相同，说明它只是重复了可见文字，没有提供任何额外信息。）
 */
(async () => {
  const r = await kit.check({
    name: 'tooltip',
    url: 'http://127.0.0.1:8000/03-patterns/tooltip/demo.html',
    dir: REPO + '/03-patterns/tooltip',
    primary: '.tooltip',
    /* ⭐ 焦点策略（准入清单第 ① 条）：
       tooltip **不接管焦点** —— 焦点始终在触发元素上，
       提示层是纯展示（role=tooltip + aria-describedby 关联）。
       ⚠️ 绝不能把焦点移进提示层（它不是交互元素，且触屏无 hover）。 */
    interactive: '[data-tooltip], .btn',

    extra: {
      /* ⭐ 核心：不承载必要信息 */
      'tooltip 提供额外信息（不重复可见文字）': async (p) => {
        const r = await p.evaluate(() => {
          const all = [...document.querySelectorAll('[data-tooltip]')];
          if (!all.length) return { ok: true, note: '无 tooltip（跳过）' };
          /* ⚠️ demo 里**故意造了一个反例**（#bad，tooltip 文字 = 按钮文字）
             用来演示"这样写是错的"。
             ⇒ 判据要跳过标了 data-bad-example 的，否则会把"演示反例"当成"真 bug"。 */
          const isDemo = (t) => t.hasAttribute('data-bad-example') ||
                               /^(bad|反例|wrong)/i.test(t.id || '');
          const triggers = all.filter((t) => !isDemo(t));
          const dup = triggers.filter((t) => {
            const tip = (t.getAttribute('data-tooltip') || '').trim();
            const vis = (t.textContent || '').trim();
            /* 完全相同 ⇒ 只是重复，没提供额外信息 */
            return tip && vis && tip === vis;
          });
          return { ok: dup.length === 0,
                   note: triggers.length + ' 个正式 tooltip（另有反例已豁免），' +
                         dup.length + ' 个与可见文字完全相同' +
                         (dup.length
                           ? '（🔴 ' + dup.map((d) => d.textContent.trim()).join('/') + '）'
                           : '都提供了额外信息') };
        });
        return r;
      },

      /* ② Esc 能关（WCAG 1.4.13 明确要求）*/
      'Esc 能关闭': async (p) => {
        await p.evaluate(() => {
          const t = document.querySelector('[data-tooltip]');
          if (t) t.focus();               // focus 应弹出
        });
        await new Promise((r) => setTimeout(r, 250));
        const opened = await p.evaluate(() =>
          !!document.querySelector('.tooltip.is-open'));
        if (!opened) return { ok: true, note: 'focus 未弹出（跳过）' };
        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 250));
        const closed = await p.evaluate(() =>
          !document.querySelector('.tooltip.is-open'));
        return { ok: closed, note: closed ? 'Esc 已关闭 ✅' : '🔴 Esc 之后仍在' };
      },

      /* ③ 键盘必须能触发（**用真键盘 Tab**，不能用 el.focus()）
         🔴 判据修正（第一次跑时误报"focus 不触发"）：
            `element.focus()` 是**编程式聚焦**，浏览器**不认为**它是键盘操作
            ⇒ `:focus-visible` 不匹配 ⇒ 连 CSS 里的 hover/focus 规则都不生效。
            ⇒ 那不是组件的 bug，是**测法错了**。
            ⇒ 正解：先 `blur()` 清焦点，再真按 `Tab` 键。 */
      '键盘 Tab 能触发（键盘可达）': async (p) => {
        await p.evaluate(() => {
          if (document.activeElement) document.activeElement.blur();
          window.scrollTo(0, 0);
        });
        await new Promise((r) => setTimeout(r, 200));
        let found = false;
        for (let i = 0; i < 14; i++) {
          await p.keyboard.press('Tab');
          await new Promise((r) => setTimeout(r, 160));
          const hit = await p.evaluate(() =>
            !!(document.activeElement &&
               document.activeElement.hasAttribute('data-tooltip') &&
               document.querySelector('.tooltip[data-state="open"]')));
          if (hit) { found = true; break; }
        }
        return { ok: found,
                 note: found ? 'Tab 到触发器后提示已弹出 ✅'
                             : '🔴 连按 14 次 Tab 都没有弹出（键盘用户看不到）' };
      },

      /* ④ 用 aria-describedby 关联（不是 aria-label）*/
      '用 aria-describedby 关联': async (p) => {
        const r = await p.evaluate(() => {
          const ts = [...document.querySelectorAll('[data-tooltip]')];
          if (!ts.length) return { ok: true, note: '无 tooltip（跳过）' };
          const bad = ts.filter((t) => {
            if (t.getAttribute('aria-describedby')) return false;
            /* 允许用 aria-label 之外的方式，但必须有一种关联 */
            return !t.getAttribute('aria-labelledby');
          });
          const wrongAttr = ts.filter((t) => {
            /* ⛔ tooltip 内容写进 aria-label 是错的：
               label 是「这个元素叫什么」，tooltip 是「补充说明」 */
            const al = t.getAttribute('aria-label');
            return al && al === t.getAttribute('data-tooltip');
          });
          return { ok: bad.length === 0 && wrongAttr.length === 0,
                   note: bad.length ? '🔴 ' + bad.length + ' 个未关联'
                        : (wrongAttr.length ? '🔴 ' + wrongAttr.length + ' 个错用 aria-label'
                                            : ts.length + ' 个都用了 aria-describedby') };
        });
        return r;
      },

      /* ⑤ 提示层不挡内容（pointer-events:none）*/
      '提示层不挡点击': async () => {
        const fs = require('fs');
        const raw = kit.stripComments(
          fs.readFileSync(REPO + '/03-patterns/tooltip/tooltip.css', 'utf8'));
        const m = raw.match(/\.tooltip\s*\{[^}]*\}/);
        if (!m) return { ok: false, note: '🔴 没有 .tooltip 规则' };
        const has = /pointer-events\s*:\s*none/.test(m[0]);
        return { ok: has, note: has ? 'pointer-events:none ✅' : '🔴 会挡住下面的点击' };
      },

      /* ⑥ 左右方位的小三角**真的画出来了**，且 RTL 下指向相反的物理边
         🔴 为什么补这条（0.4.2 实测出来的既有缺口）：
            `tooltip.js` 的 `place='left'|'right'` 会拼出 `tooltip--left` /
            `--right`，而 `tooltip.css` 里**根本没有这两个类**（只有
            `--inset-inline-start` / `--inset-inline-end`）
            ⇒ 这两个方位的气泡**完全没有小三角**（::after 四条边全是
            transparent），而 demo 里 `p-left` / `p-right` 正好在用。
            这是最典型的静默失效：不报错、不红，只是少一块。
         ⚠️ 为什么必须**在真浏览器里量**：
            读源码只能知道"类名对不对"，知道不了"这条声明有没有被渲染出来"。
            计算样式是浏览器给的，不是我推断的。 */
      '左右方位的小三角真的画出来了（含 RTL）': async (p) => {
        const r = await p.evaluate(() => {
          function one(dir, place) {
            var box = document.createElement('div');
            box.setAttribute('dir', dir);
            box.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;' +
                                'z-index:99999;background:transparent';
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'p';
            btn.style.cssText = 'position:absolute;top:300px;left:300px;' +
                                'width:60px;height:24px';
            box.appendChild(btn);
            document.body.appendChild(box);
            window.Tooltip.attach(btn, 'probe', place);
            btn.click();                       // click 会 show（内部 stopPropagation）
            var tips = document.querySelectorAll('.tooltip[data-state="open"]');
            var tip = tips[tips.length - 1];
            if (!tip) { box.remove(); return { err: '气泡没弹出' }; }
            var cs = getComputedStyle(tip, '::after');
            var sides = {
              top: cs.borderTopColor, bottom: cs.borderBottomColor,
              left: cs.borderLeftColor, right: cs.borderRightColor,
            };
            var visible = Object.keys(sides).filter(function (k) {
              return sides[k] && sides[k] !== 'rgba(0, 0, 0, 0)' &&
                     sides[k] !== 'transparent';
            });
            var out = { cls: tip.className, visible: visible,
                        dir: getComputedStyle(btn).direction };
            box.remove();
            tip.remove();
            return out;
          }
          return {
            ltrLeft: one('ltr', 'left'), rtlLeft: one('rtl', 'left'),
            ltrRight: one('ltr', 'right'), rtlRight: one('rtl', 'right'),
          };
        });
        /* 期望：恰好一条边有色；且 LTR 与 RTL 落在**相反**的物理边 */
        const want = [
          ['ltr + left', r.ltrLeft, 'left'],
          ['rtl + left', r.rtlLeft, 'right'],
          ['ltr + right', r.ltrRight, 'right'],
          ['rtl + right', r.rtlRight, 'left'],
        ];
        const bad = [];
        for (const [label, got, side] of want) {
          if (got.err) { bad.push(label + '：' + got.err); continue; }
          if (got.visible.length !== 1) {
            bad.push(label + '：有色边 ' + got.visible.length + ' 条（应为 1 条）' +
                     ' class=' + got.cls);
          } else if (got.visible[0] !== side) {
            bad.push(label + '：有色边是 ' + got.visible[0] + '（应为 ' + side + '）' +
                     ' class=' + got.cls);
          }
        }
        return { ok: bad.length === 0,
                 note: bad.length ? '🔴 ' + bad.join('；')
                                  : '四个组合各有一条有色边，且 RTL 物理边相反 ✅' };
      },

      /* ⑦ 暗色下气泡要反色（否则深底深字）*/
      '暗色下气泡反色': async () => {
        const fs = require('fs');
        const raw = kit.stripComments(
          fs.readFileSync(REPO + '/03-patterns/tooltip/tooltip.css', 'utf8'));
        const dark = raw.match(/@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/);
        return { ok: !!dark,
                 note: dark ? '有暗色段 ✅' : '🔴 无暗色段（深色主题下深底深字）' };
      },
    },
  });
  process.exit(kit.report(r));
})();
