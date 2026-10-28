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

      /* ② → 两段式：收起态按 → 只展开、不动焦点；再按一次才进子节点 */
      '→ 两段式（先展开，再进入）': async (p) => {
        /* 🔴 2026-10-29 重写（起因是 E86：demo 的「默认全部收起」其实全展开）。
           旧版在这里**手动把 aria-expanded 改成 'true'** 再按 →，
           于是它测的其实是"已展开的节点按 → 进子节点"，而断言里用
           `after1.expanded === 'true'` 当"焦点没动"的证据 ——
           这只有在子节点**恰好也展开**的时候才成立。
           demo 一修好（子节点真的是 false），断言立刻红，而它红的原因
           不是组件坏了，是这条判据一直在测别的东西。

           ⇒ 现在：前置状态**不手动改**，直接找真实收起节点；
             焦点是否移动用**元素标记**判，不用 aria / label 猜。 */
        const setup = await p.evaluate(() => {
          function walk(li, fn) {
            var cur = li && li.parentElement ? li.parentElement.closest('[role="treeitem"]') : null;
            while (cur) { fn(cur); cur = cur.parentElement ? cur.parentElement.closest('[role="treeitem"]') : null; }
          }
          const li = Array.prototype.slice
            .call(document.querySelectorAll('#t2 [role="treeitem"]'))
            .filter(function (i) {
              return i.getAttribute('aria-expanded') === 'false' &&
                     i.querySelector(':scope > [role="group"]');
            })[0];
          if (!li) return null;
          /* 祖先展开只是为了"它可见、能聚焦"，不改它自己的收起态 */
          walk(li, function (a) {
            a.setAttribute('aria-expanded', 'true');
            const g = a.querySelector(':scope > [role="group"]');
            if (g) g.hidden = false;
          });
          const n = li.querySelector(':scope > .tree__node');
          n.focus();
          n.setAttribute('data-fl-probe', '1');
          return { label: (n.textContent || '').trim().slice(0, 8) };
        });
        if (!setup) {
          return { ok: false,
                   note: '🔴 #t2 里找不到收起的父节点 ⇒ 两段式判据无法执行，' +
                         '这是红不是跳过（demo 的第 2 例本该是全收起）' };
        }
        await p.keyboard.press('ArrowRight');
        await new Promise((r) => setTimeout(r, 250));
        const after1 = await p.evaluate(() => {
          const a = document.activeElement;
          const li = a.closest('[role="treeitem"]');
          return { same: a.getAttribute('data-fl-probe') === '1',
                   expanded: li ? li.getAttribute('aria-expanded') : null };
        });
        await p.keyboard.press('ArrowRight');
        await new Promise((r) => setTimeout(r, 250));
        const after2 = await p.evaluate(() => {
          const a = document.activeElement;
          const probe = document.querySelector('[data-fl-probe="1"]');
          const li = probe ? probe.closest('[role="treeitem"]') : null;
          const g = li ? li.querySelector(':scope > [role="group"]') : null;
          return { same: a.getAttribute('data-fl-probe') === '1',
                   inChild: !!(g && g.contains(a)) };
        });
        const ok = after1.same && after1.expanded === 'true' && !after2.same && after2.inChild;
        return { ok,
                 note: '第一次→：焦点未动=' + after1.same + '、展开=' + after1.expanded +
                       ' · 第二次→：焦点进子节点=' + after2.inChild +
                       (ok ? ' ✅' : ' 🔴 两段式没成立') };
      },

      /* ③ ← 两段式：展开态按 ← 只收起、不动焦点；再按一次才回父节点 */
      '← 两段式（先收起，再回父）': async (p) => {
        /* 旧版取"全页第一个收起项"，E86 修好之后第一个是**顶层** src ——
           顶层没有父可回，断言自然永远不成立。
           ⇒ 现在只挑**有父 treeitem** 的收起项，并自己把祖先展开（可见性），
             两段式用两次 ← 现场走完，不依赖上一条测过什么。 */
        const setup = await p.evaluate(() => {
          function walk(li, fn) {
            var cur = li && li.parentElement ? li.parentElement.closest('[role="treeitem"]') : null;
            while (cur) { fn(cur); cur = cur.parentElement ? cur.parentElement.closest('[role="treeitem"]') : null; }
          }
          const li = Array.prototype.slice
            .call(document.querySelectorAll('#t2 [role="treeitem"]'))
            .filter(function (i) {
              return i.getAttribute('aria-expanded') === 'false' &&
                     i.querySelector(':scope > [role="group"]') &&
                     i.parentElement && i.parentElement.closest('[role="treeitem"]');
            })[0];
          if (!li) return null;
          walk(li, function (a) {
            a.setAttribute('aria-expanded', 'true');
            const g = a.querySelector(':scope > [role="group"]');
            if (g) g.hidden = false;
          });
          const n = li.querySelector(':scope > .tree__node');
          n.focus();
          n.setAttribute('data-fl-probe', '2');
          return { label: (n.textContent || '').trim().slice(0, 8) };
        });
        if (!setup) {
          return { ok: false,
                   note: '🔴 #t2 里找不到"有父节点且收起"的节点 ⇒ 判据无法执行，这是红不是跳过' };
        }
        /* 先按 → 把它展开（此时焦点应仍在本节点） */
        await p.keyboard.press('ArrowRight');
        await new Promise((r) => setTimeout(r, 220));
        const pre = await p.evaluate(() => ({
          same: document.activeElement.getAttribute('data-fl-probe') === '2',
          expanded: (document.activeElement.closest('[role="treeitem"]') || {})
            .getAttribute ? document.activeElement.closest('[role="treeitem"]').getAttribute('aria-expanded') : null,
        }));
        /* 第一次 ←：收起，焦点不动 */
        await p.keyboard.press('ArrowLeft');
        await new Promise((r) => setTimeout(r, 220));
        const a1 = await p.evaluate(() => ({
          same: document.activeElement.getAttribute('data-fl-probe') === '2',
          exp: (document.activeElement.closest('[role="treeitem"]') || {})
            .getAttribute ? document.activeElement.closest('[role="treeitem"]').getAttribute('aria-expanded') : null,
        }));
        /* 第二次 ←：回到父节点 */
        await p.keyboard.press('ArrowLeft');
        await new Promise((r) => setTimeout(r, 220));
        const a2 = await p.evaluate(() => {
          const a = document.activeElement;
          const probe = document.querySelector('[data-fl-probe="2"]');
          const li = probe ? probe.closest('[role="treeitem"]') : null;
          const parentLi = li && li.parentElement ? li.parentElement.closest('[role="treeitem"]') : null;
          return { same: a.getAttribute('data-fl-probe') === '2',
                   toParent: !!(parentLi && parentLi.contains(a)) };
        });
        const ok = pre.same && pre.expanded === 'true' &&
                   a1.same && a1.exp === 'false' && !a2.same && a2.toParent;
        return { ok,
                 note: '→ 展开：焦点未动=' + pre.same + '·展开=' + pre.expanded +
                       ' · 第一次←：焦点未动=' + a1.same + '·收起=' + a1.exp +
                       ' · 第二次←：回到父=' + a2.toParent +
                       (ok ? ' ✅' : ' 🔴 两段式没成立') };
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

      /* ③ `*` 展开本层同级 —— 只展开**同一层**，不动更深层（APG 特有） */
      '` * ` 展开本层全部同级': async (p) => {
        /* 🔴 2026-10-29 重写：旧版断言"按 * 之后 **整棵树**没有收起节点"，
           而 `*` 的语义是**只展开当前层同级**（tree.js 里 `levelOf(x) === lvl`）。
           旧版之所以一直是绿，是因为 E86 让 #t2 里根本没有收起节点 ⇒ 整条跳过。
           ⇒ 现在把同层全部收起来做前置，判"同层全展开"，
             并且**顺便判"更深的层没被动过"** —— 两件事一起才叫"本层"语义。 */
        const pre = await p.evaluate(() => {
          const all = Array.prototype.slice.call(
            document.querySelectorAll('#t2 [role="treeitem"]'));
          function level(li) {
            let n = 0;
            let cur = li.parentElement ? li.parentElement.closest('[role="treeitem"]') : null;
            while (cur) { n++; cur = cur.parentElement ? cur.parentElement.closest('[role="treeitem"]') : null; }
            return n;
          }
          const lv0 = all.filter(function (i) {
            return level(i) === 0 && i.querySelector(':scope > [role="group"]');
          });
          if (!lv0.length) return null;
          /* 允许聚焦：把祖先（这里没有）+ 自己设为收起 */
          lv0.forEach(function (i) {
            i.setAttribute('aria-expanded', 'false');
            const g = i.querySelector(':scope > [role="group"]');
            if (g) g.hidden = true;
          });
          /* 深层随便留几个收起的，用来验证"没被动" —— 若本来就都展开，
             手动收起一个二级父节点 */
          const lv1 = all.filter(function (i) {
            return level(i) === 1 && i.querySelector(':scope > [role="group"]');
          });
          if (lv1.length) {
            lv1[0].setAttribute('aria-expanded', 'false');
            const g = lv1[0].querySelector(':scope > [role="group"]');
            if (g) g.hidden = true;
          }
          const n = lv0[0].querySelector(':scope > .tree__node');
          n.focus();
          return { lv0: lv0.length, lv1: lv1.length };
        });
        if (!pre) {
          return { ok: false, note: '🔴 #t2 里没有带子节点的顶层项 ⇒ 判据无法执行，这是红不是跳过' };
        }
        await p.keyboard.press('*');
        await new Promise((r) => setTimeout(r, 300));
        const after = await p.evaluate(() => {
          const all = Array.prototype.slice.call(
            document.querySelectorAll('#t2 [role="treeitem"]'));
          function level(li) {
            let n = 0;
            let cur = li.parentElement ? li.parentElement.closest('[role="treeitem"]') : null;
            while (cur) { n++; cur = cur.parentElement ? cur.parentElement.closest('[role="treeitem"]') : null; }
            return n;
          }
          const still = function (lv) {
            return all.filter(function (i) {
              return level(i) === lv && i.querySelector(':scope > [role="group"]') &&
                     i.getAttribute('aria-expanded') === 'false';
            }).length;
          };
          return { lv0: still(0), lv1: still(1) };
        });
        const ok = after.lv0 === 0 && after.lv1 === pre.lv1;
        return { ok,
                 note: '按 * 后：同层仍收起 ' + after.lv0 + ' 个（应 0）· ' +
                       '更深层仍收起 ' + after.lv1 + ' 个（应 ' + pre.lv1 + '，即没被动）' +
                       (ok ? ' ✅' : ' 🔴 本层语义不成立') };
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
