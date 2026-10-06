const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * drawer-check.js — 抽屉契约（总 D2 /
 *
 * 依据 APG Dialog。三条硬要求全部**真键盘**实测：
 *   ① 焦点陷阱  ② Esc 关闭  ③ ⭐ 关闭后焦点归位
 * 外加模态特有的两条：背景 inert、锁滚动。
 */
(async () => {
  const r = await kit.check({
    name: 'drawer',
    url: 'http://127.0.0.1:8000/03-patterns/drawer/demo.html',
    dir: REPO + '/03-patterns/drawer',
    primary: '.drawer',
    /* ⭐ 焦点策略（准入清单第 ① 条 · 写下来才算设计）：
       本组件是「**焦点陷阱**」型 ——
         · 焦点在**弹层内部**循环（Tab / Shift+Tab 都不出界）
         · 关闭时焦点**归位**到触发元素
       ⇒ 属于第三种模式（既非 roving tabindex，也非 aria-activedescendant）。
       ⚠️ 用错 roving 会让 Tab 跳出弹层；用错 activedescendant 会让读屏读不出当前项。 */
    interactive: '.drawer__close, .drawer button',

    extra: {
      /* 0 打开一个抽屉（后续判据都基于它）*/
      '0 能打开抽屉': async (p) => {
        await p.evaluate(() => {
          const b = document.querySelector('[data-place="right"]');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 400));
        const ok = await p.evaluate(() => !!document.querySelector('.drawer'));
        return { ok: ok, note: ok ? '已打开 .drawer' : '🔴 打不开' };
      },

      /* 语义 */
      'role=dialog + aria-modal + 有名字': async (p) => {
        const r = await p.evaluate(() => {
          const d = document.querySelector('.drawer');
          if (!d) return { ok: false, note: '🔴 抽屉未打开' };
          const bad = [];
          if (d.getAttribute('role') !== 'dialog') bad.push('缺 role=dialog');
          if (d.getAttribute('aria-modal') !== 'true') bad.push('缺 aria-modal=true');
          if (!d.getAttribute('aria-label') && !d.getAttribute('aria-labelledby')) {
            bad.push('缺可访问名');
          }
          return { ok: bad.length === 0,
                   note: bad.length ? '🔴 ' + bad.join('；') : '语义完整' };
        });
        return r;
      },

      /* ① 焦点陷阱：连按 14 次 Tab 焦点都在抽屉内 */
      '焦点陷阱（Tab 留在抽屉内）': async (p) => {
        let escaped = 0;
        for (let i = 0; i < 14; i++) {
          await p.keyboard.press('Tab');
          await new Promise((r) => setTimeout(r, 90));
          const out = await p.evaluate(() => {
            const d = document.querySelector('.drawer');
            const a = document.activeElement;
            return !(d && (a === d || d.contains(a)));
          });
          if (out) { escaped = i + 1; break; }
        }
        return { ok: escaped === 0,
                 note: escaped === 0 ? '连按 14 次 Tab 焦点都在抽屉内 ✅'
                                      : '🔴 第 ' + escaped + ' 次 Tab 焦点跑出抽屉' };
      },

      /* ② Esc 关闭 */
      'Esc 能关闭': async (p) => {
        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 500));
        const gone = await p.evaluate(() => !document.querySelector('.drawer'));
        return { ok: gone, note: gone ? 'Esc 已关闭抽屉 ✅' : '🔴 Esc 没能关闭' };
      },

      /* ③ ⭐ 焦点归位：必须回到刚才点的那一个按钮 */
      '关闭后焦点归位': async (p) => {
        const back = await p.evaluate(() => {
          const a = document.activeElement;
          return { txt: (a ? a.textContent || '' : '').trim().slice(0, 10),
                   tag: a ? a.tagName : '?' };
        });
        return { ok: back.txt === '右侧',
                 note: back.txt === '右侧' ? '焦点已回到触发按钮「右侧」✅'
                      : '🔴 焦点在 ' + back.tag + '「' + back.txt + '」，没归位' };
      },

      /* ④ 模态：背景 inert + aria-hidden */
      '背景被设为 inert': async (p) => {
        /* 重新打开来检查背景状态 */
        await p.evaluate(() => {
          const b = document.querySelector('[data-place="right"]');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 380));
        const r = await p.evaluate(() => {
          const others = [...document.body.children].filter((n) =>
            !n.hasAttribute('data-drawer-host') &&
            n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE');
          const inert = others.filter((n) => n.inert === true);
          const hidden = others.filter((n) => n.getAttribute('aria-hidden') === 'true');
          return { n: others.length, inert: inert.length, hidden: hidden.length,
                   own: !!document.querySelector('.drawer') };
        });
        /* 收尾：关掉抽屉，别影响后续判据 */
        await p.keyboard.press('Escape');
        await new Promise((x) => setTimeout(x, 420));
        return { ok: r.n > 0 && r.inert === r.n && r.hidden === r.n,
                 note: r.n + ' 个背景元素，' + r.inert + ' 个 inert、' +
                       r.hidden + ' 个 aria-hidden' +
                       (r.inert === r.n && r.hidden === r.n ? ' ✅' : ' 🔴 漏了 ' + (r.n - r.inert) + ' 个') };
      },

      /* ⑤ 关闭后必须解锁滚动 */
      '关闭后解锁滚动': async (p) => {
        const r = await p.evaluate(() => ({
          overflow: document.body.style.overflow || '(空)',
        }));
        return { ok: r.overflow === '' || r.overflow === '(空)',
                 note: r.overflow === '(空)' ? 'body 滚动已恢复 ✅'
                                            : '🔴 body 仍锁着：' + r.overflow };
      },

      /* ⑥-b 🔴 补这条是因为**契约有盲区**：
         同名冲突那处漏网（`close.textContent` 绑到了函数上）
         ⇒ 关闭按钮**文字为空**（× 不显示），而契约**全绿**。
         ⚠️ 这说明"功能契约"不能覆盖"内容是否真的显示出来"。
         ⇒ 正解：加一条判据量**可见内容**（不是只看 aria-label）。 */
      '关闭按钮有可见内容': async (p) => {
        await p.evaluate(() => {
          const b = document.querySelector('[data-place="right"]');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 380));
        const r = await p.evaluate(() => {
          const btn = document.querySelector('.drawer__close');
          if (!btn) return { ok: false, note: '🔴 找不到关闭按钮' };
          const txt = (btn.textContent || '').trim();
          const label = btn.getAttribute('aria-label') || '';
          return { ok: txt.length > 0 && label.length > 0,
                   note: (txt ? '文字「' + txt + '」' : '🔴 文字为空（× 不显示）') +
                         ' + aria-label「' + label + '」' };
        });
        await p.keyboard.press('Escape');
        await new Promise((x) => setTimeout(x, 420));
        return r;
      },

      /* ⑥ 关闭按钮的命中区（它是独立可点目标，要 44px）*/
      '关闭按钮命中区 ≥44px': async (p) => {
        await p.evaluate(() => {
          const b = document.querySelector('[data-place="right"]');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 380));
        const r = await p.evaluate(() => {
          const c = document.querySelector('.drawer__close');
          if (!c) return { ok: false, note: '🔴 找不到关闭按钮' };
          const b = c.getBoundingClientRect();
          return { ok: b.width >= 44 && b.height >= 44,
                   note: Math.round(b.width) + '×' + Math.round(b.height) };
        });
        await p.keyboard.press('Escape');
        await new Promise((x) => setTimeout(x, 420));
        return r;
      },
    },
  });
  process.exit(kit.report(r));
})();
