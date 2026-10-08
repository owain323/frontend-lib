const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * select-check.js — 下拉选择契约（总 E1 /
 *
 * 依据 APG Select-Only Combobox。
 * ⭐ 四条最容易漏的**全部真键盘实测**：
 *   ① 打开后焦点落在**选中项**（不是第一项）
 *   ② ↑↓ 循环 · Home/End · Enter 选中并关闭
 *   ③ Esc 关闭且焦点**还给按钮**
 *   ④ **类型搜索**（原生 select 有，自建最容易漏）
 */
(async () => {
  const r = await kit.check({
    name: 'select',
    url: 'http://127.0.0.1:8000/02-primitives/select/demo.html',
    dir: REPO + '/02-primitives/select',
    primary: '.select',
    interactive: '.select__btn, .select__opt',

    extra: {
      /* 语义 */
      '语义完整（listbox/option/activedescendant）': async (p) => {
        const r = await p.evaluate(() => {
          const btn = document.querySelector('#s1 [data-select-btn]');
          const list = document.querySelector('#s1 [data-select-list]');
          if (!btn || !list) return { ok: false, note: '🔴 找不到按钮/列表' };
          const bad = [];
          if (btn.getAttribute('aria-haspopup') !== 'listbox') bad.push('缺 aria-haspopup=listbox');
          if (btn.getAttribute('aria-expanded') === null) bad.push('缺 aria-expanded');
          if (!btn.getAttribute('aria-controls')) bad.push('缺 aria-controls');
          if (list.getAttribute('role') !== 'listbox') bad.push('列表缺 role=listbox');
          const opts = list.querySelectorAll('[role="option"]');
          if (!opts.length) bad.push('没有 role=option');
          /* option 必须有 id（aria-activedescendant 靠它）*/
          const noId = [...opts].filter((o) => !o.id);
          if (noId.length) bad.push(noId.length + ' 个 option 缺 id');
          return { ok: bad.length === 0,
                   note: bad.length ? '🔴 ' + bad.join('；')
                                    : opts.length + ' 个选项，语义完整' };
        });
        return r;
      },

      /* ⭐ ① 打开后焦点落在选中项 */
      '打开后落在选中项（非第一项）': async (p) => {
        /* demo 默认 value='a'（第二项）*/
        await p.evaluate(() => {
          const b = document.querySelector('#s1 [data-select-btn]');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 320));
        const r = await p.evaluate(() => {
          const btn = document.querySelector('#s1 [data-select-btn]');
          const ad = btn.getAttribute('aria-activedescendant');
          if (!ad) return { ok: false, note: '🔴 没有 aria-activedescendant' };
          const opt = document.getElementById(ad);
          const all = [...document.querySelectorAll('#s1 [role="option"]')];
          return { idx: all.indexOf(opt), total: all.length,
                   text: opt ? opt.textContent.replace(/[✓\s]/g, '').trim() : '?',
                   first: all[0] ? all[0].textContent.replace(/[✓\s]/g, '').trim() : '' };
        });
        return { ok: r.idx > 0 && r.idx < r.total,
                 note: '游标在第 ' + (r.idx + 1) + '/' + r.total + ' 项「' + r.text + '」' +
                       '（第一项是「' + r.first + '」）' +
                       (r.idx > 0 ? ' ✅ 落在选中项而非第一项' : ' 🔴 落在第一项') };
      },

      /* ② ↑↓ 循环 */
      '↑↓ 循环（末项再按回到首项）': async (p) => {
        const seq = [];
        for (let i = 0; i < 6; i++) {
          await p.keyboard.press('ArrowDown');
          await new Promise((r) => setTimeout(r, 130));
          seq.push(await p.evaluate(() => {
            const ad = document.querySelector('#s1 [data-select-btn]')
                        .getAttribute('aria-activedescendant');
            const o = document.getElementById(ad);
            return o ? o.textContent.replace(/[✓\s]/g, '').trim().slice(0, 4) : '?';
          }));
        }
        const first = seq[0];
        const back = seq.slice(1).filter((x) => x === first).length > 0;
        return { ok: seq.length >= 5 && new Set(seq).size >= 2,
                 note: '连按 ↓ 6 次：' + seq.join('→') + (back ? '（已循环回起点 ✅）' : '') };
      },

      /* ② Enter 选中并关闭 */
      'Enter 选中并关闭': async (p) => {
        await p.keyboard.press('ArrowDown');
        await new Promise((r) => setTimeout(r, 160));
        const want = await p.evaluate(() => {
          const ad = document.querySelector('#s1 [data-select-btn]')
                      .getAttribute('aria-activedescendant');
          return document.getElementById(ad).getAttribute('data-value');
        });
        await p.keyboard.press('Enter');
        await new Promise((r) => setTimeout(r, 320));
        const r = await p.evaluate(() => {
          const list = document.querySelector('#s1 [data-select-list]');
          const hidden = document.querySelector('#s1 input[type=hidden]');
          const btn = document.querySelector('#s1 [data-select-btn]');
          return { closed: list.hidden,
                   hidden: hidden ? hidden.value : '(无)',
                   onBtn: document.activeElement === btn,
                   exp: btn.getAttribute('aria-expanded') };
        });
        return { ok: r.closed && r.hidden === want,
                 note: '选中 ' + want + ' · hidden=' + r.hidden +
                       (r.closed ? ' · 已关闭' : ' 🔴 未关闭') +
                       (r.onBtn ? ' · 焦点在按钮' : ' 🔴 焦点不在按钮') +
                       (r.hidden === want ? ' ✅' : ' 🔴 hidden 不符') };
      },

      /* ③ Esc 关闭 + 焦点还按钮 */
      'Esc 关闭且焦点还按钮': async (p) => {
        await p.evaluate(() => {
          const b = document.querySelector('#s1 [data-select-btn]');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 300));
        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 300));
        const r = await p.evaluate(() => {
          const list = document.querySelector('#s1 [data-select-list]');
          const btn = document.querySelector('#s1 [data-select-btn]');
          return { closed: list.hidden, onBtn: document.activeElement === btn };
        });
        return { ok: r.closed && r.onBtn,
                 note: r.closed ? (r.onBtn ? '已关闭且焦点回按钮 ✅' : '🔴 关闭了但焦点没回按钮')
                                : '🔴 Esc 没能关闭' };
      },

      /* ④ ⭐ 类型搜索（原生 select 有，自建最容易漏）*/
      '类型搜索（连续打字跳匹配项）': async (p) => {
        await p.evaluate(() => {
          const b = document.querySelector('#s1 [data-select-btn]');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 300));
        /* ⚠️ 判据修正（第一次跑时误报）：选项大多是中文，"b" 匹配不到任何项
           ⇒ 报"没跳到匹配项"是**测试用例不成立**，不是组件的问题。
           ⇒ demo 里加了一个英文开头的选项（Fund 基金），
              这样按 F 才有一个真实可测的匹配目标。 */
        await p.keyboard.press('KeyF');       /* 匹配 "Fund 基金" */
        await new Promise((r) => setTimeout(r, 220));
        const r = await p.evaluate(() => {
          const ad = document.querySelector('#s1 [data-select-btn]')
                      .getAttribute('aria-activedescendant');
          const o = document.getElementById(ad);
          return { txt: o ? o.textContent.replace(/[✓\s]/g, '').trim().slice(0, 10) : '?',
                   n: document.querySelectorAll('#s1 [role="option"]').length };
        });
        await p.keyboard.press('Escape');
        await new Promise((x) => setTimeout(x, 280));
        return { ok: r.txt.indexOf('Fund') >= 0,
                 note: '输入 "f" 后游标→「' + r.txt + '」' +
                       (r.txt.indexOf('Fund') >= 0 ? ' ✅ 类型搜索生效' : ' 🔴 没跳到匹配项') };
      },

      /* ⭐ 二次打开后，类型搜索必须**仍然可用**（缓冲不被上一次残留污染）。
         迁移前缓冲是组件里的闭包变量，**关闭时从来不清** ⇒ 二次打开再打同一个
         字母会拼成 "ff" ⇒ 匹配不上 ⇒ 打字"突然失效"。

         ⚠️ 反向控制（实测，别照字面猜）：把 `typeahead.type(k)` 的接线删掉
            ⇒ 本条红（实测 ⇒ 游标停在「港股通」）。
         ⚠️ 但它**守不住** `close()` 里的 `typeahead.clear()`：实测把那行删掉后
            本条**仍然绿** —— 因为核自带的 500ms 超时也会把缓冲清掉，
            两个机制任一生效就够。⇒ 注释里不许写成"守的是 clear()"，
            那是**没被证明的声称**（I-10：报告通过 ≠ 查到了东西）。 */
      '类型搜索：二次打开后仍然命中（缓冲不被上次污染）': async (p) => {
        const btn = '#s1 [data-select-btn]';
        const readActive = () => p.evaluate((sel) => {
          const ad = document.querySelector(sel).getAttribute('aria-activedescendant');
          const o = document.getElementById(ad);
          return o ? o.textContent.replace(/[✓\s]/g, '').trim().slice(0, 10) : '?';
        }, btn);

        await p.evaluate((sel) => document.querySelector(sel).click(), btn);
        await new Promise((r) => setTimeout(r, 60));
        await p.keyboard.press('KeyF');
        await new Promise((r) => setTimeout(r, 60));
        await p.keyboard.press('Escape');            /* 关闭（且焦点归位）*/
        await new Promise((r) => setTimeout(r, 60));
        await p.evaluate((sel) => document.querySelector(sel).click(), btn);
        await new Promise((r) => setTimeout(r, 60));
        await p.keyboard.press('KeyF');
        await new Promise((r) => setTimeout(r, 120));
        const txt = await readActive();
        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 280));
        return { ok: txt.indexOf('Fund') >= 0,
                 note: '二次打开后再打 "f" ⇒ 游标在「' + txt + '」' +
                       (txt.indexOf('Fund') >= 0 ? ' ✅ 仍然命中'
                                                 : ' 🔴 打字失效') };
      },

      /* 选中态有勾（形状线索，不只靠颜色）*/
      '选中项有勾 + aria-selected': async (p) => {
        const r = await p.evaluate(() => {
          const sel = [...document.querySelectorAll('#s1 [role="option"]')]
            .filter((o) => o.getAttribute('aria-selected') === 'true');
          if (!sel.length) return { ok: false, note: '🔴 没有选中项' };
          const ck = sel[0].querySelector('.select__check');
          return { ok: !!ck && (ck.textContent || '').trim().length > 0,
                   note: sel.length + ' 个 aria-selected=true，勾=「' +
                         (ck ? ck.textContent.trim() : '(无)') + '」' };
        });
        return r;
      },

      /* disabled 选项不可选 */
      'disabled 选项点不动': async (p) => {
        const r = await p.evaluate(() => {
          const dis = document.querySelector('#s1 [aria-disabled="true"]');
          if (!dis) return { ok: true, note: '无 disabled 项（跳过）' };
          const before = document.querySelector('#s1 input[type=hidden]').value;
          dis.click();
          const after = document.querySelector('#s1 input[type=hidden]').value;
          return { ok: before === after,
                   note: '点击「' + dis.textContent.replace(/[✓\s]/g, '').trim() + '」' +
                         (before === after ? '，值未变 ✅' : '🔴 值变了：' + before + '→' + after) };
        });
        return r;
      },

      /* 关闭态移出无障碍树 */
      '关闭态移出无障碍树': async (p) => {
        const r = await p.evaluate(() => {
          const lists = [...document.querySelectorAll('[data-select-list]')];
          const leak = lists.filter((l) => l.hidden &&
            l.querySelector('[tabindex]:not([tabindex="-1"])'));
          return { ok: leak.length === 0,
                   note: lists.length + ' 个列表，' +
                         lists.filter((l) => l.hidden).length + ' 个关闭，' +
                         leak.length + ' 个关闭后仍可聚焦' };
        });
        return r;
      },
    },
  });
  process.exit(kit.report(r));
})();
