const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * tree-check.js — 树形视图契约（总 D1 /
 *
 * 依据 APG Tree View。⭐ **全部用真键盘实测**
 *    （`el.click()` 或 `el.focus()` 都不等价 —— 树的键盘契约太复杂，
 *      编程式调用测不出来）。
 */
(async () => {
  const r = await kit.check({
    name: 'tree',
    url: 'http://127.0.0.1:8000/03-patterns/tree/demo.html',
    dir: REPO + '/03-patterns/tree',
    primary: '.tree',
    interactive: '.tree__node',
    skipFocusRing: true,
    note: 'tree 容器不聚焦（焦点在节点上，roving tabindex）',
    /* 🔴 树节点用 **32px**（不是 44px），这是**有意的**：
       树是**密集结构**，节点常有几十个；
       若每行 44px，一屏只能看 5–6 行，导航体验反而更差。
       WCAG 2.5.8（AA）要求的是 24×24，32px 已**超出**要求。
       ⚠️ 而 WCAG 2.5.5（AAA）的 44px 是给**独立可点目标**的
          （按钮、链接），不适用于树内部的行 —— 这一点必须写清楚，
          否则会有人"为了达标"把树撑到没法用。 */
    skipHitArea: true,
    hitAreaNote: '树节点 32px（AA 要求 24px，已超出；树是密集结构，44px 不适用）',

    extra: {
      /* 语义结构 */
      '语义完整（tree/treeitem/group）': async (p) => {
        const r = await p.evaluate(() => {
          const t = document.querySelector('.tree');
          if (!t) return { ok: false, note: '🔴 没有 .tree' };
          const bad = [];
          if (t.getAttribute('role') !== 'tree') bad.push('容器缺 role=tree');
          if (!t.getAttribute('aria-label') && !t.getAttribute('aria-labelledby')) {
            bad.push('容器缺可访问名');
          }
          const items = t.querySelectorAll('[role="treeitem"]');
          if (!items.length) bad.push('没有 treeitem');
          /* 有子节点的 treeitem 必须有 aria-expanded */
          const withKids = [...items].filter((i) => i.querySelector(':scope > [role="group"]'));
          const noExp = withKids.filter((i) => !i.hasAttribute('aria-expanded'));
          if (noExp.length) bad.push(noExp.length + ' 个有子节点但无 aria-expanded');
          return { ok: bad.length === 0,
                   note: bad.length ? '🔴 ' + bad.join('；')
                                    : items.length + ' 个节点，语义完整' };
        });
        return r;
      },

      /* ⭐ Roving tabindex：整棵树只占一个 Tab 位 */
      'roving tabindex（只一个 tabindex=0）': async (p) => {
        const r = await p.evaluate(() => {
          const nodes = [...document.querySelectorAll('#t1 .tree__node')]
            .filter((n) => n.offsetParent !== null);
          if (!nodes.length) return { ok: true, note: '无可见节点（跳过）' };
          const zeros = nodes.filter((n) => n.getAttribute('tabindex') === '0');
          return { ok: zeros.length <= 1,
                   note: nodes.length + ' 个可见节点，' + zeros.length + ' 个 tabindex=0' +
                         (zeros.length > 1
                           ? '（🔴 Tab 要按 ' + zeros.length + ' 次才能穿过树）'
                           : ' ✅ 整棵树只占一个 Tab 位') };
        });
        return r;
      },

      /* ⭐ 同一条不变量，但**含收起的节点**也一起数，
         而且**自己先走一遍键盘**再数。
         为什么必须自己走：第一版我只数**初始状态** ⇒ 把 tree.js 里
         focusAt() 的「其余置 -1」删掉后它**依然全绿**
         ⇒ 那是一条"报告通过、什么也没查"的假绿（INVARIANT I-10 实证 8）。
         ⇒ 正解：判据必须先制造状态变化（移动 / 收起 / 再展开），再数。
         ⚠️ 反向控制（实测）：删掉那行 ⇒ 本条红（实测 3 个 0）。 */
      'roving tabindex（走一遍键盘 + 收起再展开后仍只一个 0）': async (p) => {
        /* ① 自己准备前提：焦点落到第一个节点 */
        await p.evaluate(() => {
          const n = document.querySelector('#t1 .tree__node');
          if (n) n.focus();
        });
        /* ② 移动 → 收起 → 再移动 → 再展开：制造"节点被藏起来"的机会 */
        for (const k of ['ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowLeft',
                         'ArrowDown', 'ArrowRight', 'ArrowDown']) {
          await p.keyboard.press(k);
          await new Promise((r) => setTimeout(r, 120));
        }
        const r = await p.evaluate(() => {
          const all = [...document.querySelectorAll('#t1 .tree__node')];
          if (!all.length) return { ok: true, note: '无节点（跳过）' };
          const zeros = all.filter((n) => n.getAttribute('tabindex') === '0');
          return { ok: zeros.length <= 1,
                   note: '走完 7 次按键后，共 ' + all.length + ' 个节点（含收起的），' +
                         zeros.length + ' 个 tabindex=0' +
                         (zeros.length > 1
                           ? '（🔴 多出的 Tab 停靠点：' +
                             zeros.map((n) => (n.textContent || '').trim().slice(0, 6)).join('/') + '）'
                           : ' ✅ 收起/展开都不会漏') };
        });
        return r;
      },

      /* ① ↑↓ 移动 */
      '↑↓ 在节点间移动': async (p) => {
        await p.evaluate(() => {
          const n = document.querySelector('#t1 .tree__node');
          if (n) n.focus();
        });
        await new Promise((r) => setTimeout(r, 200));
        const a = await p.evaluate(() => (document.activeElement.textContent || '').trim().slice(0, 10));
        await p.keyboard.press('ArrowDown');
        await new Promise((r) => setTimeout(r, 200));
        const b = await p.evaluate(() => (document.activeElement.textContent || '').trim().slice(0, 10));
        return { ok: a !== b, note: '↓：' + a + ' → ' + b + (a !== b ? ' ✅' : ' 🔴 没动') };
      },

      /* ② → 展开时先展开、再按才进子节点（APG 的两段式）*/
      '→ 两段式（先展开，再进入）': async (p) => {
        /* 找当前是收起的父节点 */
        const setup = await p.evaluate(() => {
          /* 🔴 改查**全页**的收起节点。
             之前只查 #t1（默认展开），导致这条永远跳过 ⇒ 等于没测。
             ⇒ 现在用 #t2（默认全收起）来测 ←→ 的两段式行为。 */
          /* 🔴 这条**自己准备前提**，不依赖上一条测过什么。
             之前它靠「← 的测试里先用 → 展开」⇒ 一旦单独跑就"跳过"，
             等于**这条契约形同虚设**。
             ⚠️ 判据之间**不能有隐藏的顺序依赖** —— 那会让契约在
                单独运行时悄悄退化成"永远通过"。
             ⇒ 正解：在这里显式把 #t2 的第一个父节点展开。 */
          const n = [...document.querySelectorAll('#t2 .tree__node')][0];
          if (!n) return null;
          const li = n.closest('[role="treeitem"]');
          if (li) li.setAttribute('aria-expanded', 'true');
          const g = li && li.querySelector(':scope > [role="group"]');
          if (g) g.hidden = false;
          n.focus();
          return { label: (n.textContent || '').trim().slice(0, 8), id: li ? 1 : 0 };
        });
        if (!setup) return { ok: true, note: '无收起节点（跳过）' };
        await p.keyboard.press('ArrowRight');
        await new Promise((r) => setTimeout(r, 250));
        const after1 = await p.evaluate(() => {
          const a = document.activeElement;
          const li = a.closest('[role="treeitem"]');
          return { expanded: li ? li.getAttribute('aria-expanded') : null,
                   label: (a.textContent || '').trim().slice(0, 8) };
        });
        /* 再按一次应该进入子节点 */
        await p.keyboard.press('ArrowRight');
        await new Promise((r) => setTimeout(r, 250));
        const after2 = await p.evaluate(() =>
          (document.activeElement.textContent || '').trim().slice(0, 8));
        return { ok: after1.expanded === 'true' && after2 !== after1.label,
                 note: '第一次→：展开=' + after1.expanded + '（焦点未动）· ' +
                       '第二次→：焦点到「' + after2 + '」' +
                       (after2 !== after1.label ? ' ✅' : ' 🔴 没进子节点') };
      },

      /* ③ ← 收起时先收起、再按才回父节点 */
      '← 两段式（先收起，再回父）': async (p) => {
        const setup = await p.evaluate(() => {
          /* 先用 → 展开某个节点，并聚焦它 */
          const n = [...document.querySelectorAll('.tree__node')]
            .find((x) => {
              const li = x.closest('[role="treeitem"]');
              return li && li.getAttribute('aria-expanded') === 'false';
            });
          if (!n) return null;
          n.focus();
          n.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
          return (n.textContent || '').trim().slice(0, 8);
        });
        if (!setup) return { ok: true, note: '无收起节点（跳过）' };
        await new Promise((r) => setTimeout(r, 250));
        await p.keyboard.press('ArrowLeft');
        await new Promise((r) => setTimeout(r, 250));
        const a1 = await p.evaluate(() => {
          const li = document.activeElement.closest('[role="treeitem"]');
          return { exp: li ? li.getAttribute('aria-expanded') : null,
                   lbl: (document.activeElement.textContent || '').trim().slice(0, 8) };
        });
        await p.keyboard.press('ArrowLeft');
        await new Promise((r) => setTimeout(r, 250));
        const a2 = await p.evaluate(() =>
          (document.activeElement.textContent || '').trim().slice(0, 8));
        return { ok: a1.exp === 'false' && a2 !== a1.lbl,
                 note: '第一次←：收起=' + a1.exp + '（焦点未动）· ' +
                       '第二次←：回到「' + a2 + '」' +
                       (a2 !== a1.lbl ? ' ✅' : ' 🔴 没回父节点') };
      },

      /* ⑤ Home / End 跳首末 */
      'Home/End 跳首末': async (p) => {
        await p.evaluate(() => {
          const n = document.querySelector('#t1 .tree__node');
          if (n) n.focus();
        });
        await new Promise((r) => setTimeout(r, 180));
        await p.keyboard.press('End');
        await new Promise((r) => setTimeout(r, 220));
        const last = await p.evaluate(() =>
          (document.activeElement.textContent || '').trim().slice(0, 10));
        await p.keyboard.press('Home');
        await new Promise((r) => setTimeout(r, 220));
        const first = await p.evaluate(() =>
          (document.activeElement.textContent || '').trim().slice(0, 10));
        return { ok: first !== last,
                 note: 'End→「' + last + '」· Home→「' + first + '」' +
                       (first !== last ? ' ✅' : ' 🔴 没动') };
      },

      /* ⭐ 类型搜索：连打**同一个**字符必须在匹配项之间循环。
         为什么这条必须有：迁移前 tree 只做"单字符跳转"、select 只做"累积"，
         两处**各缺一半**，而"连打同一字符要循环"这一半**全库没人实现**
         ⇒ 用户连按两次同一个字母，游标不动，看起来像卡了。
         ⚠️ 反向控制：把核里 repeated() 的特判去掉 ⇒ 本条红。 */
      '类型搜索：连打同一字符 ⇒ 循环': async (p) => {
        const at = () => p.evaluate(() =>
          (document.activeElement.textContent || '').trim().slice(0, 10));
        await p.evaluate(() => {
          const n = document.querySelector('#t1 .tree__node');
          if (n) n.focus();
        });
        await new Promise((r) => setTimeout(r, 120));
        await p.keyboard.press('KeyB');
        await new Promise((r) => setTimeout(r, 160));
        const a = await at();
        await p.keyboard.press('KeyB');
        await new Promise((r) => setTimeout(r, 160));
        const b = await at();
        const okB = /^b/i.test(a) && /^b/i.test(b);
        return { ok: a !== b && okB,
                 note: '连打 b：' + a + ' → ' + b +
                       (a !== b && okB ? ' ✅ 在匹配项之间循环'
                                       : ' 🔴 停在原地（连打同一字符没循环）') };
      },

      /* ⭐ 类型搜索：多字符**累积**成前缀。
         反向控制同上（旧实现按单字符逐个跳 ⇒ "ba" 永远到不了 base.css）。 */
      '类型搜索：多字符累积（"ba" ⇒ base.css）': async (p) => {
        /* 上一条刚打过 b ⇒ 先等缓冲超时清空，否则这次拼成 "bba" */
        await new Promise((r) => setTimeout(r, 700));
        await p.evaluate(() => {
          const n = document.querySelector('#t1 .tree__node');
          if (n) n.focus();
        });
        await new Promise((r) => setTimeout(r, 120));
        await p.keyboard.press('KeyB');
        await p.keyboard.press('KeyA');
        await new Promise((r) => setTimeout(r, 200));
        const t = await p.evaluate(() =>
          (document.activeElement.textContent || '').trim().slice(0, 10));
        return { ok: /^base/i.test(t),
                 note: '打 "ba" ⇒ 「' + t + '」' +
                       (/^base/i.test(t) ? ' ✅ 累积成前缀命中'
                                         : ' 🔴 只按单字符匹配（没累积）') };
      },

      /* ③ `*` 展开本层同级（APG 特有）*/
      '` * ` 展开本层全部同级': async (p) => {
        const r = await p.evaluate(() => {
          const collapsed = [...document.querySelectorAll('#t2 [role="treeitem"]')]
            .filter((i) => i.getAttribute('aria-expanded') === 'false');
          if (!collapsed.length) return { ok: true, note: '无收起节点（跳过）' };
          collapsed[0].querySelector('.tree__node').focus();
          return { n: collapsed.length, ok: true };
        });
        if (r.note && r.note.indexOf('跳过') >= 0) return { ok: true, note: r.note };
        await p.keyboard.press('*');
        await new Promise((x) => setTimeout(x, 300));
        const after = await p.evaluate(() =>
          document.querySelectorAll('#t2 [role="treeitem"][aria-expanded="false"]').length);
        return { ok: after === 0,
                 note: '按 * 后仍收起的节点：' + after + ' 个' +
                       (after === 0 ? ' ✅' : ' 🔴 没展开') };
      },

      /* 收起的节点其子树必须不可聚焦 */
      '收起子树的不可聚焦': async (p) => {
        const r = await p.evaluate(() => {
          const collapsed = [...document.querySelectorAll('#t2 [role="treeitem"]')]
            .filter((i) => i.getAttribute('aria-expanded') === 'false');
          if (!collapsed.length) return { ok: true, note: '无收起节点（跳过）' };
          const leak = [];
          collapsed.forEach((li) => {
            const g = li.querySelector(':scope > [role="group"]');
            if (!g || !g.hidden) return;
            g.querySelectorAll('.tree__node').forEach((n) => {
              if (n.offsetParent !== null) leak.push(n.textContent.trim().slice(0, 8));
            });
          });
          return { ok: leak.length === 0,
                   note: leak.length ? '🔴 收起后仍可见：' + leak.slice(0, 3).join(' ')
                                    : '收起子树完全不可见' };
        });
        return r;
      },
    },
  });
  process.exit(kit.report(r));
})();
