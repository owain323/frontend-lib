const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * overlay-check.js — 弹层契约（总 A8）
 *
 * ⭐ 弹层是**键盘与读屏最容易被做坏**的地方，三条硬要求（APG Dialog）：
 *   ① **焦点陷阱**：Tab 不能跑到弹层外面（否则键盘用户会"迷失"在背景里）
 *   ② **Esc 关闭**：不需要找关闭按钮
 *   ③ ⭐ **关闭后焦点归位**：必须回到触发它的那个元素
 *      （不归位 ⇒ 键盘用户被扔回页面顶部，得重新 Tab 一遍）
 */
(async () => {
  const r = await kit.check({
    name: 'overlay',
    url: 'http://127.0.0.1:8000/03-patterns/overlay/demo.html',
    dir: REPO + '/03-patterns/overlay',
    primary: '.dialog',
    /* ⭐ 焦点策略（准入清单第 ① 条）：
       dialog 是「**焦点陷阱**」型 —— 焦点在弹层内循环，关闭时归位。 */
    interactive: '.dialog button, .dialog a, .dialog [tabindex]',

    extra: {
      /* ⓪ 弹层由 JS 动态创建 ⇒ 必须先打开一个再查
         🔴 判据修正：原来只在初始 DOM 里找 `.dialog`，
            而它是点击后才由 overlay.js 插入的 ⇒ 永远查不到（假失败）。 */
      '0 先打开一个弹层': async (p) => {
        /* 🔴 实测更正：demo 的 #d1 **并没有绑定** open 行为
           （它只演示 toast，dialog 的用法写在文档片段里）⇒ 点它没反应。
           ⇒ 正确做法：**直接调组件公开 API** `Overlay.dialog({...})`，
              这才是"用组件的人会做的事"，也最贴近真实用法。 */
        const opened = await p.evaluate(() => {
          if (!window.Overlay || typeof window.Overlay.dialog !== 'function') return false;
          window.Overlay.dialog({
            title: '契约探测',
            desc: '这是一条由 overlay-check.js 打开的弹层。',
            actions: [{ label: '好', variant: 'primary' }],
          });
          return true;
        });
        if (!opened) return { ok: true, note: 'Overlay.dialog 不可用（后续跳过）', skip: true };
        await new Promise((r) => setTimeout(r, 450));
        const open = await p.evaluate(() => !!document.querySelector('.dialog'));
        return { ok: open, note: open ? '已通过 Overlay.dialog() 打开 .dialog' : '🔴 调 Overlay.dialog() 后没出现 .dialog' };
      },

      /* ① 弹层结构：role=dialog + aria-modal */
      '弹层有 role=dialog 与 aria-modal': async (p) => {
        const r = await p.evaluate(() => {
          const ovs = [...document.querySelectorAll(
            '.overlay, [role="dialog"], dialog, .drawer, .modal')];
          if (!ovs.length) return { ok: false, note: '没有弹层元素' };
          const bad = ovs.filter((o) => {
            const role = o.getAttribute('role');
            const isDialog = role === 'dialog' || role === 'alertdialog' ||
                             o.tagName === 'DIALOG';
            return !isDialog || o.getAttribute('aria-modal') !== 'true';
          });
          return { ok: bad.length === 0,
                   note: ovs.length + ' 个弹层，' + bad.length + ' 个缺 role=dialog 或 aria-modal=true' };
        });
        return r;
      },

      /* ② 弹层有可访问名 */
      '弹层有可访问名': async (p) => {
        const r = await p.evaluate(() => {
          const ovs = [...document.querySelectorAll('[role="dialog"], dialog, .overlay')];
          if (!ovs.length) return { ok: true, note: '无弹层（跳过）' };
          const bad = ovs.filter((o) =>
            !o.getAttribute('aria-label') && !o.getAttribute('aria-labelledby'));
          return { ok: bad.length === 0,
                   note: ovs.length + ' 个弹层，' + bad.length + ' 个没名字' };
        });
        return r;
      },

      /* ③ ⭐ Esc 能关闭（真实按键，不只是看代码里有没有监听） */
      'Esc 能关闭': async (p) => {
        const r = await p.evaluate(() => {
          const ov = document.querySelector('[role="dialog"], dialog, .overlay');
          if (!ov) return { ok: true, note: '无弹层（跳过）' };
          const open = ov.hasAttribute('open') ||
                       getComputedStyle(ov).display !== 'none' ||
                       ov.classList.contains('is-open') ||
                       ov.getAttribute('data-state') === 'open';
          return { ok: !!open, note: open ? '有打开的弹层（可用 Esc 测）' : 'demo 里弹层未打开（跳过）' };
        });
        if (!r.ok || r.note.indexOf('跳过') >= 0) return r;
        /* 真按一次 Esc，看有没有变化 */
        await p.keyboard.press('Escape');
        await new Promise((x) => setTimeout(x, 450));
        const after = await p.evaluate(() => {
          const ov = document.querySelector('.dialog, [role="dialog"], dialog');
          if (!ov) return { gone: true };
          const cs = getComputedStyle(ov);
          const gone = cs.display === 'none' || cs.visibility === 'hidden' ||
                       ov.hasAttribute('hidden') || !ov.isConnected;
          return { gone: gone, disp: cs.display };
        });
        return { ok: after.gone, note: after.gone ? 'Esc 已关闭弹层 ✅'
                 : '🔴 Esc 之后弹层仍在（display=' + after.disp + '）' };
      },

      /* ④ ⭐ 焦点陷阱：弹层打开时 Tab 不能跑到外面
         🔴 修正：上一条（Esc）已经把弹层关掉了 ⇒ 这里必须**重开**。 */
      '焦点陷阱（Tab 留在弹层内）': async (p) => {
        await p.evaluate(() => {
          if (document.querySelector('.dialog')) return;
          window.Overlay.dialog({ title: '焦点陷阱探测', actions: [{ label: '好' }] });
        });
        await new Promise((r) => setTimeout(r, 400));
        const r = await p.evaluate(() => {
          const ov = document.querySelector('.dialog, [role="dialog"], dialog');
          if (!ov) return { ok: true, note: '弹层未打开（跳过）', skip: true };
          const f = ov.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
          return { ok: f.length > 0, n: f.length, note: f.length + ' 个可聚焦元素' };
        });
        if (r.skip) return r;
        /* 连按 12 次 Tab，看焦点是否始终在弹层内 */
        let escaped = null;
        for (let i = 0; i < 12; i++) {
          await p.keyboard.press('Tab');
          const inOv = await p.evaluate(() => {
            const ov = document.querySelector('[role="dialog"], dialog, .overlay');
            const a = document.activeElement;
            return !!(ov && (a === ov || ov.contains(a)));
          });
          if (!inOv) { escaped = i + 1; break; }
        }
        return { ok: escaped === null,
                 note: escaped === null ? '连按 12 次 Tab 焦点都在弹层内'
                       : '🔴 第 ' + escaped + ' 次 Tab 焦点跑到弹层外' };
      },

      /* ⑤ ⭐ 关闭后焦点归位（最容易被漏、也最影响体验） */
      '关闭后焦点归位': async (p) => {
        /* 🔴 焦点归位的正确测法（与 ⓪ 同一个理由：demo 没有真实触发按钮）
           造一个触发器 → 用它打开 → Esc 关闭 → 焦点应回到它身上。 */
        /* 🔴 关键：**必须先聚焦探针按钮**再开弹层 ——
           组件的 `lastFocused = document.activeElement` 记的是**打开那一刻**的焦点。
           若此时焦点在 body，关闭后自然回不到探针上（那是测法错，不是组件错）。 */
        await p.evaluate(() => {
          let b = document.getElementById('probe-trigger');
          if (!b) {
            b = document.createElement('button');
            b.id = 'probe-trigger';
            b.textContent = '探针';
            document.body.insertBefore(b, document.body.firstChild);
          }
          b.focus();
        });
        await new Promise((r) => setTimeout(r, 120));
        await p.evaluate(() => {
          window.Overlay.dialog({
            title: '焦点归位探测',
            actions: [{ label: '好', variant: 'primary' }],
          });
        });
        await new Promise((r) => setTimeout(r, 450));
        const opened = await p.evaluate(() => !!document.querySelector('.dialog'));
        if (!opened) return { ok: true, note: '弹层未打开（跳过）' };

        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 400));
        const back = await p.evaluate(() => ({
          isProbe: !!(document.activeElement && document.activeElement.id === 'probe-trigger'),
          tag: document.activeElement ? document.activeElement.tagName : '?',
        }));
        return { ok: back.isProbe,
                 note: back.isProbe ? '焦点已回到触发器 ✅'
                                    : '🔴 关闭后焦点没归位（现在焦点在 ' + back.tag + '）' };
      },

      /* 🔴 补（ I3 复核时发现这条缺失）：背景隔离。
       *
       *  为什么必须查这条：
       *    focus trap 只拦住**键盘 Tab**，拦不住**读屏**。
       *    读屏用户在弹层打开时仍能浏览背景内容 ——
       *    对一个"正在确认删除"的对话框来说，背景在视觉上已不可见，
       *    读屏却还在念 ⇒ 严重的感官冲突。
       *
       *  判据：弹层打开时，body 下与弹层并列的可见元素
       *        必须带 inert 或 aria-hidden="true"。
       */
      '背景 inert（读屏不浏览背景内容）': async (p) => {
        await p.evaluate(() => {
          window.Overlay.dialog({
            title: '隔离检查',
            desc: '用于验证背景是否被隔离',
            actions: [{ label: '好', variant: 'primary' }],
          });
        });
        await new Promise((r) => setTimeout(r, 450));

        const v = await p.evaluate(() => {
          const d = document.querySelector('[role="dialog"]');
          if (!d) return { opened: false };
          const layers = [...document.body.children].filter(
            (el) => el.offsetParent !== null && !el.contains(d) && el !== d);
          const isolated = layers.filter(
            (el) => el.hasAttribute('inert') ||
                    el.getAttribute('aria-hidden') === 'true');
          return { opened: true, total: layers.length, isolated: isolated.length };
        });

        if (!v.opened) return { ok: false, note: '弹层未打开，无法验证' };
        if (v.isolated === 0) {
          return { ok: false,
                   note: '🔴 背景未标 inert / aria-hidden（' + v.total +
                         ' 个可见背景层）⇒ 读屏仍会浏览到"看不见"的内容' };
        }
        return { ok: true,
                 note: v.isolated + '/' + v.total + ' 个背景层已隔离 ✅' };
      },

      /* ---------- 嵌套弹层：焦点必须逐层归还 ---------- */
      '嵌套弹层：焦点逐层归还（栈行为）': async (p) => {
        /* 场景：A 打开 → A 内再打开 B → 关 B → 关 A
         * 要求：B 关后焦点回到 A 内；A 关后回到页面上的原按钮。
         * ⚠️ 早期实现用**全局单值**记录触发元素，
         *    B 会覆盖 A 的记录 ⇒ 第二次关闭时焦点无处可还。 */
        /* ⭐ 清理现场：契约的判据是**累积执行**的，
         *   前面的判据可能留下未关闭的弹层 ⇒ 后面拿到的
         *   `querySelector('[role="dialog"] button')` 会是**旧弹层**的按钮，
         *   场景完全跑偏。
         *   （踩过三次：点错按钮 / 忘记点 / 拿到残留弹层。） */
        await p.evaluate(() => {
          var old = document.querySelectorAll('.dialog-backdrop');
          for (var i = 0; i < old.length; i++) {
            old[i].parentNode && old[i].parentNode.removeChild(old[i]);
          }
          var locked = document.querySelectorAll('[inert]');
          for (var j = 0; j < locked.length; j++) { locked[j].inert = false; }
        });

        await p.evaluate(() => {
          window.__probe = document.createElement('button');
          window.__probe.id = 'probe-outer';
          window.__probe.textContent = '外层触发';
          document.body.appendChild(window.__probe);
          window.__probe.focus();
        });

        /* ⭐ 正确构造嵌套：A 的按钮在**不关闭 A** 的前提下打开 B
         *   （keepOpen + onClick 里再开一层）。
         *   ⚠️ 早先写成 `querySelector('button').click()` ——
         *      那点到的是 A 的**关闭按钮**，A 立刻被关掉，
         *      于是只剩 B 一层，看起来像"嵌套功能坏了"。
         *      ⇒ 契约本身写错时，会把 bug 报告在错误的层面上。 */
        await p.evaluate(() => {
          window.__openB = function () {
            window.Overlay.dialog({
              title: 'B', desc: '内层',
              actions: [{ label: '好', variant: 'primary' }],
            });
          };
          window.Overlay.dialog({
            title: 'A', desc: '外层',
            actions: [{ label: '打开 B', variant: 'primary', keepOpen: true,
                        onClick: function () { window.__openB(); } }],
          });
        });
        await new Promise((r) => setTimeout(r, 350));

        /* ⭐ 关键一步：点 A 里的「打开 B」—— 没有这一步 B 永远不会出现，
         *   后面的断言就在测一个"只有一层"的世界。
         *   （踩过：改构造方式时忘了加点击，误以为嵌套坏了。） */
        await p.evaluate(() => {
          /* ⚠️ 用**文本**找按钮，不能靠下标 ——
           *   dialog 里第一个 button 是**关闭按钮**，点了会把 A 关掉。 */
          const btns = document.querySelectorAll('[role="dialog"] button');
          for (let i = 0; i < btns.length; i++) {
            if ((btns[i].textContent || '').indexOf('B') >= 0) { btns[i].click(); return; }
          }
        });
        await new Promise((r) => setTimeout(r, 400));

        const depth = await p.evaluate(() =>
          document.querySelectorAll('[role="dialog"]').length);
        if (depth < 2) {
          return { ok: false,
                   note: '未能构造嵌套场景（只开出 ' + depth + ' 层）' };
        }

        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 600));  // 等离场动画（220ms）+ 焦点归位
        const afterB = await p.evaluate(() => {
          const d = document.querySelectorAll('[role="dialog"]');
          return {
            left: d.length,
            inA: d.length ? d[d.length - 1].contains(document.activeElement) : false,
          };
        });
        if (afterB.left !== 1) {
          return { ok: false,
                   note: '关掉内层后应剩 1 层，实际剩 ' + afterB.left };
        }
        if (!afterB.inA) {
          return { ok: false,
                   note: '关掉内层后焦点没回到外层弹层内 ⇒ 焦点栈实现有误' };
        }

        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 600));  // 等离场动画（220ms）+ 焦点归位
        const afterA = await p.evaluate(() => {
          const t = document.getElementById('probe-outer');
          const back = !!t && document.activeElement === t;
          if (t) t.parentNode.removeChild(t);
          try { delete window.__probe; } catch (e) { window.__probe = null; }
          return { left: document.querySelectorAll('[role="dialog"]').length,
                   back: back };
        });
        if (afterA.left !== 0) {
          return { ok: false, note: '外层未关闭，剩 ' + afterA.left + ' 层' };
        }
        if (!afterA.back) {
          return { ok: false, note: '关掉外层后焦点没回到最初的触发元素' };
        }
        return { ok: true, note: '两层弹层焦点逐层归还正确' };
      },

      /* ---------- 嵌套弹层：inert 的「归属权」（真bug 的回归测试） ----------
       *
       *  为什么必须单独一条：
       *   焦点栈能过，不代表 inert 也能过 —— 它们是两套独立机制。
       *   踩过的 bug：inert 记账写的是「这节点现在是 inert」，
       *   而正确语义是「这节点是**我**设成 inert 的」。
       *
       *   触发路径：
       *     A 开 → 背景被 A 锁
       *     B 开 → 看到背景「已经是 inert」，记账但**没设过**
       *     B 关 → 无脑解锁 ⇒ **A 还开着，背景却能点了**
       *
       *  判据：B 关闭之后、A 仍然打开的状态下，背景必须**仍然是 inert**。
       *        这条判据在旧实现上必然失败（这是它存在的意义）。
       */
      '嵌套弹层：内层关闭不得解除外层的背景隔离': async (p) => {
        /* 清理现场：契约累积执行，前面可能留下未关闭的弹层 */
        await p.evaluate(() => {
          var old = document.querySelectorAll('.dialog-backdrop');
          for (var i = 0; i < old.length; i++) {
            old[i].parentNode && old[i].parentNode.removeChild(old[i]);
          }
          var locked = document.querySelectorAll('[inert]');
          for (var j = 0; j < locked.length; j++) { locked[j].inert = false; }
        });

        /* 🔴 不再按"引擎支不支持"决定 skip。
           原来 `!supported` 直接 `ok: true, note: '该判据不适用，跳过'` ——
           于是 PR 补的 aria-hidden 兜底**没有任何自动回归**：把兜底删掉照样绿。
           两个机制回答的是同一个问题（「背景有没有对键盘/读屏隔离」），
           只是承载属性不同（inert vs aria-hidden），所以用同一场景 + 谓词切换。
           （专门的兜底回归在下面「无 inert 的旧 WebView」那一条里强制跑。） */
        const supported = await p.evaluate(
          () => 'inert' in HTMLElement.prototype);
        const MECH = supported ? 'inert' : 'aria-hidden';

        /* 造一个明确在背景里的元素 —— 它是否 inert 是可客观判定的 */
        await p.evaluate(() => {
          var bg = document.createElement('div');
          bg.id = 'probe-bg';
          bg.textContent = '背景容器';
          document.body.appendChild(bg);
          window.__openB2 = function () {
            window.Overlay.dialog({
              title: 'B2', desc: '内层',
              actions: [{ label: '好', variant: 'primary' }],
            });
          };
          window.Overlay.dialog({
            title: 'A2', desc: '外层',
            actions: [{ label: '打开 B2', variant: 'primary', keepOpen: true,
                        onClick: function () { window.__openB2(); } }],
          });
        });
        await new Promise((r) => setTimeout(r, 380));

        const afterA = await p.evaluate((useInert) => {
          const bg = document.getElementById('probe-bg');
          return {
            lockedByA: !!(bg && (useInert ? bg.inert
                                          : bg.getAttribute('aria-hidden') === 'true')),
            raw: bg ? (useInert ? String(bg.inert)
                                : String(bg.getAttribute('aria-hidden'))) : '(节点没了)',
          };
        }, supported);
        if (!afterA.lockedByA) {
          return { ok: false, note: '前置条件不成立：外层未隔离背景（机制=' + MECH +
                                    '，实际=' + afterA.raw + '），无法测归属权' };
        }

        /* 打开内层 */
        await p.evaluate(() => {
          const btns = document.querySelectorAll('[role="dialog"] button');
          for (let i = 0; i < btns.length; i++) {
            if ((btns[i].textContent || '').indexOf('B2') >= 0) { btns[i].click(); return; }
          }
        });
        await new Promise((r) => setTimeout(r, 400));

        const depth = await p.evaluate(() =>
          document.querySelectorAll('[role="dialog"]').length);
        if (depth < 2) {
          return { ok: false,
                   note: '未能构造嵌套（只开出 ' + depth + ' 层），判据无效' };
        }

        /* 🔴 核心断言点：只关内层，背景必须仍然是 inert */
        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 650));

        const mid = await p.evaluate((useInert) => {
          const bg = document.getElementById('probe-bg');
          return {
            layers: document.querySelectorAll('[role="dialog"]').length,
            stillInert: !!(bg && (useInert ? bg.inert
                                           : bg.getAttribute('aria-hidden') === 'true')),
          };
        }, supported);

        /* 收尾：关掉外层（顺便验"还原"——aria 兜底特有，不能只设不减） */
        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 650));
        const afterAll = await p.evaluate((useInert) => {
          const bg = document.getElementById('probe-bg');
          if (!bg) return { released: false, raw: '(节点没了)' };
          return {
            released: useInert ? bg.inert === false
                               : bg.getAttribute('aria-hidden') === null,
            raw: useInert ? String(bg.inert) : String(bg.getAttribute('aria-hidden')),
          };
        }, supported);
        await p.evaluate(() => {
          const bg = document.getElementById('probe-bg');
          if (bg) bg.parentNode.removeChild(bg);
          try { delete window.__openB2; } catch (e) { window.__openB2 = null; }
        });

        if (mid.layers !== 1) {
          return { ok: false,
                   note: '关内层后应剩 1 层，实际 ' + mid.layers + '（判据场景没跑对）' };
        }
        if (!mid.stillInert) {
          return { ok: false,
                   note: '🔴 关掉内层后，外层还在开着，但背景已被解锁（机制=' + MECH +
                         '）⇒ 记账混淆了「当前状态」与「归属权」' };
        }
        if (!afterAll.released) {
          return { ok: false,
                   note: '🔴 两层都关完后背景没还原（机制=' + MECH + '，实际=' +
                         afterAll.raw + '）⇒ 开的时候设了，关的时候没还原干净' };
        }
        return { ok: true, note: '内层关闭未解除外层的背景隔离，全关后已还原 ✅（机制=' +
                                 MECH + '）' };
      },

      /* 🔴 PR 补的 aria-hidden 兜底必须自己有一条回归。
         现代 Chromium 都有 inert，上面那条永远走不到兜底分支
         ⇒ 不主动构造就等于**没测**（把兜底删掉照样全绿）。
         做法：把 inert 从 HTMLElement.prototype 上删掉，模拟
         Safari < 15.5 / Chrome < 102 这类老 WebView。 */
      '旧 WebView（无 inert）：背景改用 aria-hidden 隔离': async (p) => {
        const env = await p.evaluate(() => {
          window.__inertDesc = Object.getOwnPropertyDescriptor(
            HTMLElement.prototype, 'inert') || null;
          try { delete HTMLElement.prototype.inert; } catch (e) { /* 只读就删不掉 */ }
          return { removed: !('inert' in HTMLElement.prototype) };
        });
        if (!env.removed) {
          return { ok: false,
                   note: '构造不出「没有 inert」的环境（原型上的 inert 删不掉）' };
        }

        /* 背景探针必须在弹层打开**之前**存在，才会被当成 body 的直接子节点 */
        await p.evaluate(() => {
          const bg = document.createElement('div');
          bg.id = 'probe-aria';
          bg.textContent = '背景容器（无 inert 环境）';
          document.body.appendChild(bg);
          window.Overlay.dialog({ title: 'A3', desc: '外层',
                                  actions: [{ label: '好', variant: 'primary' }] });
        });
        await new Promise((r) => setTimeout(r, 420));

        const s1 = await p.evaluate(() => {
          const bg = document.getElementById('probe-aria');
          return {
            aria: bg ? bg.getAttribute('aria-hidden') : '(节点没了)',
            inertUsed: bg ? bg.inert === true : false,
          };
        });

        /* 再开一层：只关内层时，引用计数不许把 aria-hidden 撤掉 */
        await p.evaluate(() => {
          window.Overlay.dialog({ title: 'B3', desc: '内层',
                                  actions: [{ label: '好', variant: 'primary' }] });
        });
        await new Promise((r) => setTimeout(r, 420));
        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 650));

        const s2 = await p.evaluate(() => {
          const bg = document.getElementById('probe-aria');
          return {
            layers: document.querySelectorAll('[role="dialog"]').length,
            aria: bg ? bg.getAttribute('aria-hidden') : '(节点没了)',
          };
        });

        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 650));

        const s3 = await p.evaluate(() => {
          const bg = document.getElementById('probe-aria');
          const out = { aria: bg ? bg.getAttribute('aria-hidden') : '(节点没了)' };
          if (bg) bg.parentNode.removeChild(bg);
          /* 还原原型，别把后面的用例带坏 */
          if (window.__inertDesc) {
            try { Object.defineProperty(HTMLElement.prototype, 'inert', window.__inertDesc); }
            catch (e) { /* 还原失败也只是影响后续用例，前面已判完 */ }
          }
          return out;
        });

        if (s1.aria !== 'true' || s1.inertUsed) {
          return { ok: false,
                   note: '🔴 无 inert 时背景必须被设 aria-hidden="true"；实际 aria=' +
                         String(s1.aria) + '、inert 被用了=' + s1.inertUsed };
        }
        if (s2.layers !== 1) {
          return { ok: false,
                   note: '关内层后应剩 1 层，实际 ' + s2.layers + '（判据场景没跑对）' };
        }
        if (s2.aria !== 'true') {
          return { ok: false,
                   note: '🔴 只关内层就把背景的 aria-hidden 撤了（实际=' +
                         String(s2.aria) + '）⇒ 引用计数没起作用，读屏会重新走进背景' };
        }
        if (s3.aria !== null) {
          return { ok: false,
                   note: '🔴 全关后 aria-hidden 没还原成原始值（实际=' +
                         String(s3.aria) + '，期望 null）' };
        }
        return { ok: true, note: '无 inert 时用 aria-hidden 隔离：设上了、嵌套不误撤、关闭后还原 ✅' };
      },
    },
  });
  process.exit(kit.report(r));
})();
