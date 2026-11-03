const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * 方位判据的公共壳：点开某个方向的抽屉 → 量它贴在哪条边 → Esc 关掉。
 *
 * 🔴 为什么必须逐方位量（0.25.2 实测）：
 *   四个方向的按钮一直在 demo 里，但**从来没有判据量过落位**。
 *   原来 CSS 只有容器一条 `justify-content: flex-end`，于是：
 *     left   → left=860（贴在右边，和 right 一模一样）
 *     bottom → top=0   （贴在顶上，和 top 一模一样）
 *   两个方向是错的，控制台干净、契约全绿、肉眼不点开也看不出。
 *   ⇒ 判据要量"矩形贴哪条边"，不能只量"类名加上了"。
 *     （类名对、位置错，正是这个 bug 的原始形态。）
 */
function dirCase(place, cls, edge) {
  return async (p) => {
    await p.evaluate((pl) => {
      const b = document.querySelector('[data-place="' + pl + '"]');
      if (b) b.click();
    }, place);
    await new Promise((r) => setTimeout(r, 420));
    const m = await p.evaluate(() => {
      const d = document.querySelector('.drawer');
      if (!d) return { missing: true };
      const r = d.getBoundingClientRect();
      return {
        cls: d.className,
        left: r.left, top: r.top, right: r.right, bottom: r.bottom,
        w: r.width, h: r.height,
        vw: window.innerWidth, vh: window.innerHeight,
      };
    });
    /* 收尾：无论判据成败都关掉，别把状态漏给下一条 */
    await p.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 420));

    if (m.missing) return { ok: false, note: '🔴 抽屉没打开 ⇒ 这条测不到' };
    const hasCls = (' ' + m.cls + ' ').indexOf(' ' + cls + ' ') >= 0;
    /* 容差 1px：亚像素取整不该让判据红 */
    const near = (a, b) => Math.abs(a - b) <= 1;
    let okEdge;
    if (edge === 'right') okEdge = near(m.right, m.vw) && m.w < m.vw;
    else if (edge === 'left') okEdge = near(m.left, 0) && m.w < m.vw;
    else if (edge === 'top') okEdge = near(m.top, 0) && m.h < m.vh;
    else okEdge = near(m.bottom, m.vh) && m.h < m.vh;

    const box = '矩形 ' + Math.round(m.left) + ',' + Math.round(m.top) + ' ' +
                Math.round(m.w) + '×' + Math.round(m.h) + '（视口 ' + m.vw + '×' + m.vh + '）';
    if (!hasCls) return { ok: false, note: '🔴 类名里没有 ' + cls + '：' + m.cls };
    return { ok: okEdge,
             note: box + (okEdge ? ' ⇒ 贴 ' + edge + ' 边 ✅'
                                 : ' ⇒ 🔴 没贴 ' + edge + ' 边') };
  };
}

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

      /* ① 🔴 打开即把焦点移进抽屉（APG Dialog 的开启动作）
       *  不重新点开：上一条已经把抽屉打开了，这里只读结果 ——
       *  再点一次会 toggle 把它关掉。
       *  为什么单独一条：dropdown 的同类缺陷就是「能打开、焦点没进」，
       *  而「Tab 陷阱」那条在焦点还在触发器时也可能照样绿 —— 它只证明
       *  按 Tab 之后没跑出去，证明不了"打开就已经在里面"。
       */
      '① 打开即把焦点移进抽屉': async (p) => {
        const r = await p.evaluate(() => {
          const d = document.querySelector('.drawer');
          if (!d) return { noDrawer: true };
          const a = document.activeElement;
          return {
            inside: !!(a && (d.contains(a) || a === d)),
            tag: a ? a.tagName : 'null',
            txt: a ? (a.textContent || '').trim().slice(0, 12) : '',
          };
        });
        if (r.noDrawer) return { ok: false, note: '🔴 抽屉未打开 ⇒ 无从判断' };
        return { ok: r.inside,
                 note: r.inside
                   ? '未按任何键，焦点已在 ' + r.tag + '「' + r.txt + '」（抽屉内）'
                   : '🔴 打开后焦点在抽屉外：' + r.tag + '「' + r.txt + '」' };
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

      /* ⑧ 点抽屉**内部**不该关闭（核的 inside 判定）
         ⚠️ 用真实鼠标坐标点，不用 el.click()：合成点击不产生 pointerdown，
            与"用户真的点了一下"不是同一条路径（opener-path-check 的教训）。 */
      '⑧ 点抽屉内部不关闭': async (p) => {
        await p.evaluate(() => {
          const b = document.querySelector('[data-place="right"]');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 380));
        const c = await p.evaluate(() => {
          const d = document.querySelector('.drawer');
          if (!d) return null;
          const r = d.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + 40 };
        });
        if (!c) return { ok: false, note: '🔴 抽屉没打开 ⇒ 这条测不到' };
        await p.mouse.click(c.x, c.y);
        await new Promise((r) => setTimeout(r, 300));
        const still = await p.evaluate(() => !!document.querySelector('.drawer'));
        return { ok: still, note: still ? '点抽屉内部未关闭 ✅' : '🔴 点内部把抽屉关了' };
      },

      /* ⑨ 点遮罩关闭 —— 0.14.0 起由 dismissable 核承担（以前是手写的
         `if (e.target === host) close()`）。判据看结果，不看实现。 */
      '⑨ 点遮罩关闭': async (p) => {
        const g = await p.evaluate(() => ({
          left: (document.querySelector('.drawer') || { getBoundingClientRect: () => ({ left: 0 }) })
            .getBoundingClientRect().left,
          h: window.innerHeight,
          w: window.innerWidth,
        }));
        if (!g.left) return { ok: false, note: '🔴 抽屉没打开 ⇒ 这条测不到' };
        /* 点抽屉左侧的遮罩条（抽屉右对齐，左边那段一定是遮罩） */
        await p.mouse.click(Math.max(2, Math.floor(g.left / 2)), Math.round(g.h / 2));
        await new Promise((r) => setTimeout(r, 520));
        const gone = await p.evaluate(() => !document.querySelector('.drawer'));
        return { ok: gone, note: gone ? '点遮罩已关闭 ✅' : '🔴 点遮罩没关掉' };
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

      /* ⑩ 四个方位各自贴哪条边（0.25.2 补：此前只测 right） */
      '⑩ 方位 right：贴内联终点': dirCase('right', 'drawer--right', 'right'),
      '⑩ 方位 left：贴内联起点': dirCase('left', 'drawer--left', 'left'),
      '⑩ 方位 top：贴上边': dirCase('top', 'drawer--top', 'top'),
      '⑩ 方位 bottom：贴下边': dirCase('bottom', 'drawer--bottom', 'bottom'),
    },
  });
  process.exit(kit.report(r));
})();
