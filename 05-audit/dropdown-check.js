const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * dropdown-check.js — 下拉菜单契约（总 C2 /
 *
 * 依据 APG Menu Button 模式。⭐ 五条键盘契约全部用**真键盘**实测，
 *    不用 `el.click()`（那是编程式激活，键盘语义不等价）。
 */
(async () => {
  const r = await kit.check({
    name: 'dropdown',
    url: 'http://127.0.0.1:8000/03-patterns/dropdown/demo.html',
    dir: REPO + '/03-patterns/dropdown',
    primary: '.dd',
    /* ⭐ 焦点策略（准入清单第 ① 条）：
       本组件用 **roving tabindex**：菜单打开后焦点在**当前项**，
       ↑↓ 在项间移动（Tab 用来关闭菜单，不参与项间导航）。
       关闭时焦点**归位**到按钮。 */
    interactive: '.dd__btn, .dd__item',

    extra: {
      /* 语义结构 */
      '菜单语义完整': async (p) => {
        const r = await p.evaluate(() => {
          const btn = document.querySelector('[data-dd-btn]');
          const menu = document.querySelector('[data-dd-menu]');
          if (!btn || !menu) return { ok: false, note: '🔴 找不到按钮/菜单' };
          const items = menu.querySelectorAll('li[role="menuitem"]');
          const bad = [];
          if (btn.getAttribute('aria-haspopup') !== 'true') bad.push('按钮缺 aria-haspopup');
          if (btn.getAttribute('aria-expanded') === null) bad.push('按钮缺 aria-expanded');
          if (!btn.getAttribute('aria-controls')) bad.push('按钮缺 aria-controls');
          if (menu.getAttribute('role') !== 'menu') bad.push('菜单缺 role=menu');
          if (!menu.getAttribute('aria-label') && !menu.getAttribute('aria-labelledby')) {
            bad.push('菜单缺可访问名');
          }
          /* 菜单项必须 tabindex=-1（不参与 Tab）*/
          const inTab = [...items].filter((i) => i.getAttribute('tabindex') !== '-1');
          if (inTab.length) bad.push(inTab.length + ' 个菜单项未设 tabindex=-1');
          return { ok: bad.length === 0,
                   note: bad.length ? '🔴 ' + bad.join('；') : '语义完整' };
        });
        return r;
      },

      /* ① ↓ 打开并聚焦首项 */
      '↓ 打开菜单并聚焦首项': async (p) => {
        await p.evaluate(() => {
          const b = document.querySelector('[data-dd-btn]');
          if (b) b.focus();
        });
        await p.keyboard.press('ArrowDown');
        await new Promise((r) => setTimeout(r, 300));
        const r = await p.evaluate(() => {
          const menu = document.querySelector('[data-dd-menu]');
          const open = menu && !menu.hidden;
          const inItem = document.activeElement &&
                         document.activeElement.getAttribute &&
                         document.activeElement.getAttribute('role') === 'menuitem';
          return { open: open, inItem: inItem,
                   label: (document.activeElement || {}).textContent };
        });
        return { ok: r.open && r.inItem,
                 note: r.open ? (r.inItem ? '已打开并聚焦「' + (r.label || '').trim() + '」✅'
                                          : '🔴 打开了但焦点不在菜单项上')
                              : '🔴 ↓ 没能打开' };
      },

      /* ①b 鼠标点击打开：焦点同样要进菜单
         🔴 这条是补的。原来只测了 `↓`（键盘分支），于是漏掉了一个真实现：
            读屏用户在浏览模式下按 Enter，NVDA 会把它变成**一次点击**，
            走 click 分支 ⇒ 只 open() 不聚焦 ⇒ 焦点留在按钮上，菜单项永远进不去。
            真机用 NVDA + Edge 实测到：菜单已展开，焦点元素却仍是那个按钮，
            而当时 headless 的 ① 是绿的 —— 差别就在这条没被覆盖的路径。 */
      '点击打开也聚焦首项': async (p) => {
        /* 先回到关闭态（前一条 ① 结束时菜单是开着的） */
        await p.evaluate(() => {
          const b = document.querySelector('[data-dd-btn]');
          if (b && b.getAttribute('aria-expanded') === 'true') b.click();
        });
        await new Promise((r) => setTimeout(r, 200));
        const box = await p.evaluate(() => {
          const b = document.querySelector('[data-dd-btn]');
          const r = b.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await p.mouse.click(box.x, box.y);   /* 真鼠标点击，不是 el.click() */
        await new Promise((r) => setTimeout(r, 300));
        const r = await p.evaluate(() => {
          const menu = document.querySelector('[data-dd-menu]');
          const el = document.activeElement;
          const inItem = el && el.getAttribute && el.getAttribute('role') === 'menuitem';
          return { open: menu && !menu.hidden, inItem: inItem,
                   label: (el || {}).textContent };
        });
        return { ok: r.open && r.inItem,
                 note: r.open ? (r.inItem ? '点击打开后焦点在「' + (r.label || '').trim() + '」✅'
                                          : '🔴 点击打开了但焦点不在菜单项上')
                              : '🔴 点击没能打开' };
      },

      /* ② ↑↓ 在项间移动（循环）*/
      '↑↓ 在菜单项间循环': async (p) => {
        const seq = [];
        for (let i = 0; i < 3; i++) {
          await p.keyboard.press('ArrowDown');
          await new Promise((r) => setTimeout(r, 160));
          seq.push(await p.evaluate(() =>
            ((document.activeElement || {}).textContent || '').trim().slice(0, 8)));
        }
        const uniq = new Set(seq.filter(Boolean));
        return { ok: uniq.size >= 2,
                 note: '连按 ↓ 3 次：' + seq.join(' → ') +
                       (uniq.size >= 2 ? ' ✅ 焦点在移动' : ' 🔴 焦点没动') };
      },

      /* ③ Esc 关闭 + ⭐焦点归位（APG 硬要求）*/
      'Esc 关闭且焦点归位': async (p) => {
        /* 先确保菜单是开的 */
        const isOpen = await p.evaluate(() => {
          const m = document.querySelector('[data-dd-menu]');
          if (m && m.hidden) {
            const b = document.querySelector('[data-dd-btn]');
            if (b) b.click();
          }
          return true;
        });
        if (!isOpen) return { ok: true, note: '打不开菜单（跳过）' };
        await new Promise((r) => setTimeout(r, 250));
        await p.evaluate(() => {
          const m = document.querySelector('[data-dd-menu]');
          const it = m && m.querySelector('[role="menuitem"]');
          if (it) it.focus();
        });
        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 300));
        const r = await p.evaluate(() => {
          const m = document.querySelector('[data-dd-menu]');
          const b = document.querySelector('[data-dd-btn]');
          return { closed: m && m.hidden,
                   onBtn: document.activeElement === b };
        });
        return { ok: r.closed && r.onBtn,
                 note: r.closed
                   ? (r.onBtn ? '已关闭且焦点回到按钮 ✅' : '🔴 关闭了但焦点没回按钮（键盘用户迷路）')
                   : '🔴 Esc 没能关闭' };
      },

      /* ④ 禁用项不可激活 */
      '禁用项点不动': async (p) => {
        const r = await p.evaluate(() => {
          const dis = document.querySelector('[aria-disabled="true"][role="menuitem"]');
          if (!dis) return { ok: true, note: '无禁用项（跳过）' };
          const before = dis.textContent;
          dis.click();
          /* 若被激活，菜单会关闭；不该发生 */
          return { ok: !document.querySelector('[data-dd-menu]:not([hidden])'),
                   note: before ? '禁用项「' + before.trim() + '」点击后菜单未关闭 ✅' : '' };
        });
        return r;
      },

      /* ⑤ 菜单项命中区 ≥44px（密集列表也必须）*/
      '菜单项命中区 ≥44px': async (p) => {
        await p.evaluate(() => {
          const m = document.querySelector('[data-dd-menu]');
          if (m && m.hidden) {
            const b = document.querySelector('[data-dd-btn]');
            if (b) b.click();
          }
        });
        await new Promise((r) => setTimeout(r, 280));
        const r = await p.evaluate(() => {
          const items = [...document.querySelectorAll('[role="menuitem"]')]
            .filter((e) => e.getClientRects().length);
          if (!items.length) return { ok: true, note: '菜单未展开（跳过）' };
          const small = items.filter((e) => e.getBoundingClientRect().height < 44);
          return { ok: small.length === 0,
                   note: items.length + ' 个菜单项，' + small.length + ' 个高 <44px' };
        });
        await p.keyboard.press('Escape');
        return r;
      },

      /* ⑦ 打字跳项 —— APG Menu 的 `(Optional)` 项（0.15.0 收编 typeahead 核）
       *
       * 🔴 为什么要造夹具，而不是直接测 demo：
       *   demo 的菜单是**中文标签**，而 IME 组字时 keydown 只给
       *   `Process` / `Unidentified` ⇒ 中文标签**根本打不出来**，
       *   用 demo 测等于测了个寂寞。夹具只换标签，跑的仍是
       *   `Dropdown.create` 的同一份代码。
       *   （这也是 APG 把 typeahead 标成 Optional 的现实原因：
       *    它天然只对拉丁字母标签有效。）
       */
      '⑦ 打字跳项（首字母）': async (p) => {
        await p.evaluate(() => {
          /* 幂等：每条判据都调一次，谁先跑都能自建 */
          window.__ddSetup = function () {
            var root = document.getElementById('dd-fixture');
            if (!root) {
              root = document.createElement('div');
              root.className = 'dd';
              root.id = 'dd-fixture';
              root.innerHTML =
                '<button class="dd__btn" data-dd-btn>File <span class="dd__caret"></span></button>' +
                '<ul class="dd__menu" data-dd-menu hidden>' +
                '<li data-value="copy">Copy</li>' +
                '<li data-value="cut">Cut</li>' +
                '<li data-value="paste">Paste</li>' +
                '<li data-value="save">Save</li>' +
                '<li data-value="sel">Select all</li>' +
                '</ul>';
              document.body.appendChild(root);
            }
            if (!root.ddInstance) root.ddInstance = Dropdown.create(root, { label: 'File' });
            var btn = root.querySelector('[data-dd-btn]');
            var menu = root.querySelector('[data-dd-menu]');
            if (!menu.hidden) menu.hidden = true;   /* 从关闭态开始 */
            btn.focus();
            return true;
          };
          window.__ddSetup();
        });
        await p.keyboard.press('ArrowDown');         /* 打开并聚焦首项 Copy */
        await new Promise((r) => setTimeout(r, 220));
        await p.keyboard.press('p');
        await new Promise((r) => setTimeout(r, 220));
        const got = await p.evaluate(() => (document.activeElement.textContent || '').trim());
        return { ok: got === 'Paste',
                 note: got === 'Paste' ? '打 p ⇒ Paste ✅' : '🔴 打 p 落到了「' + got + '」' };
      },

      /* ⑦b 连打同一个字母 ⇒ 在匹配项之间**循环**（不是停住）
         夹具里 Copy / Cut 都以 c 开头 ⇒ 连按两次 c 必须从 Copy 走到 Cut */
      '⑦b 连打同一字母循环': async (p) => {
        await p.evaluate(() => window.__ddSetup());
        await p.keyboard.press('ArrowDown');
        await new Promise((r) => setTimeout(r, 200));
        await p.keyboard.press('c');
        await p.keyboard.press('c');
        await new Promise((r) => setTimeout(r, 220));
        const got = await p.evaluate(() => (document.activeElement.textContent || '').trim());
        return { ok: got === 'Cut',
                 note: got === 'Cut' ? 'c c ⇒ Copy → Cut ✅' : '🔴 连按 c 停在「' + got + '」' };
      },

      /* ⑦c 快速连打不同字母 ⇒ 前缀累积
         夹具里 Save / Select all 都以 s 开头 ⇒ "s" 到 Save，"se" 到 Select all */
      '⑦c 连打不同字母按前缀匹配': async (p) => {
        await p.evaluate(() => window.__ddSetup());
        await p.keyboard.press('ArrowDown');
        await new Promise((r) => setTimeout(r, 200));
        await p.keyboard.press('s');
        await new Promise((r) => setTimeout(r, 80));
        await p.keyboard.press('e');
        await new Promise((r) => setTimeout(r, 220));
        const got = await p.evaluate(() => (document.activeElement.textContent || '').trim());
        return { ok: got === 'Select all',
                 note: got === 'Select all' ? 's e ⇒ Select all ✅' : '🔴 "se" 落到了「' + got + '」' };
      },

      /* ⑦d 不匹配 ⇒ 不动焦点（APG 不要求"没找到"有反馈）
         也顺带守住"别跳回第一项"这个最烦人的实现错误 */
      '⑦d 不匹配时焦点不动': async (p) => {
        const before = await p.evaluate(() => (document.activeElement.textContent || '').trim());
        await p.keyboard.press('z');
        await new Promise((r) => setTimeout(r, 220));
        const after = await p.evaluate(() => (document.activeElement.textContent || '').trim());
        return { ok: before === after && before !== '',
                 note: before === after ? '打 z 焦点仍在「' + after + '」✅'
                                        : '🔴 焦点从「' + before + '」跳到了「' + after + '」' };
      },

      /* ⑦e 菜单关着时打字 ⇒ 不许把菜单打开（也不许动焦点） */
      '⑦e 菜单关闭时打字不开菜单': async (p) => {
        await p.evaluate(() => window.__ddSetup());
        await p.keyboard.press('e');
        await new Promise((r) => setTimeout(r, 220));
        const r = await p.evaluate(() => {
          const root = document.getElementById('dd-fixture');
          const menu = root.querySelector('[data-dd-menu]');
          const btn = root.querySelector('[data-dd-btn]');
          /* 收尾：把夹具拆掉，别影响后面的判据 */
          const out = { hidden: menu.hidden, onBtn: document.activeElement === btn };
          if (root.ddInstance) root.ddInstance.destroy();
          root.parentNode.removeChild(root);
          return out;
        });
        return { ok: r.hidden && r.onBtn,
                 note: r.hidden && r.onBtn ? '关闭态打字不会打开菜单 ✅'
                      : '🔴 菜单状态 ' + (r.hidden ? '仍关着' : '被打开了') };
      },

      /* ⑦f 带勾选标记的项也要能按名字命中
         "✓ Copy" 的文本以符号开头，不剥掉匹配不到 —— 与 table 列头 `↕`
         被念出来是同一类问题：装饰符号混进了"名字"里。 */
      '⑦f 装饰符号不进匹配文本': async (p) => {
        await p.evaluate(() => {
          var root = document.createElement('div');
          root.className = 'dd';
          root.id = 'dd-fixture2';
          root.innerHTML =
            '<button class="dd__btn" data-dd-btn>Pick <span class="dd__caret"></span></button>' +
            '<ul class="dd__menu" data-dd-menu hidden>' +
            '<li data-value="alpha">Alpha</li>' +
            '<li data-value="copy"><span class="dd__check" data-check>✓</span>Copy</li>' +
            '</ul>';
          document.body.appendChild(root);
          root.ddInstance = Dropdown.create(root, { label: 'Pick' });
          root.querySelector('[data-dd-btn]').focus();
        });
        await p.keyboard.press('ArrowDown');
        await new Promise((r) => setTimeout(r, 200));
        await p.keyboard.press('c');
        await new Promise((r) => setTimeout(r, 220));
        const r = await p.evaluate(() => {
          var root = document.getElementById('dd-fixture2');
          var txt = (document.activeElement.textContent || '').replace(/\s+/g, ' ').trim();
          if (root.ddInstance) root.ddInstance.destroy();
          root.parentNode.removeChild(root);
          return { txt: txt };
        });
        return { ok: r.txt.indexOf('Copy') >= 0,
                 note: r.txt.indexOf('Copy') >= 0 ? '打 c 命中了「✓ Copy」✅'
                      : '🔴 打 c 落到了「' + r.txt + '」' };
      },

      /* ⑥ 关闭态用 hidden（真正移出无障碍树）*/
      '关闭态移出无障碍树': async (p) => {
        const r = await p.evaluate(() => {
          const menus = [...document.querySelectorAll('[data-dd-menu]')];
          const bad = menus.filter((m) => {
            if (!m.hidden) return false;
            /* hidden 时不能还有可聚焦子元素暴露 */
            return m.querySelector('[tabindex]:not([tabindex="-1"]), button, a[href]');
          });
          return { ok: bad.length === 0,
                   note: menus.length + ' 个菜单，' + menus.filter((m) => m.hidden).length +
                         ' 个关闭，' + bad.length + ' 个关闭后仍可聚焦' };
        });
        return r;
      },
    },
  });
  process.exit(kit.report(r));
})();
