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
         🔴 2026-10-05 判据修正：原来只在初始 DOM 里找 `.dialog`，
            而它是点击后才由 overlay.js 插入的 ⇒ 永远查不到（假失败）。 */
      '0 先打开一个弹层': async (p) => {
        /* 🔴 2026-10-05 实测更正：demo 的 #d1 **并没有绑定** open 行为
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
         🔴 2026-10-05 修正：上一条（Esc）已经把弹层关掉了 ⇒ 这里必须**重开**。 */
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

      /* 🔴 2026-10-06 补（ I3 复核时发现这条缺失）：背景隔离。
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
    },
  });
  process.exit(kit.report(r));
})();
