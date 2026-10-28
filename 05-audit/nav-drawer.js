/**
 * nav-drawer.js — 导航抽屉的行为门禁（移动端）
 * ============================================================================
 * 🔴 为什么这道门禁必须存在
 * ---------------------------------------------------------------------------
 *   `nav.css` 早就定义了抽屉的**三个状态**（list/scrim 的 data-state、
 *   toggle 的 aria-expanded），但"谁来切它们"这段时间一直空着：
 *   demo 抄一份、示例页再抄一份。抄出来的版本里至少埋着两个 bug：
 *
 *     ① **aria-hidden 打在了抽屉的祖先上** —— `<header class="nav">` 是
 *        list 的祖先，被整块 aria-hidden ⇒ 抽屉打开后对读屏**完全不可读**。
 *        视觉上、截图里、像素比对里**全都正常**。
 *     ② 遮罩被算进「内部」/ 或者根本没接 —— 点遮罩关不掉。
 *
 *   这两个都不是 CSS 能表达的，也不是静态检查能抓的。必须有浏览器 + 键盘。
 *
 * ============================================================================
 * 判据（19 条，两个页面各跑一遍）
 * ---------------------------------------------------------------------------
 *   初始化：aria-expanded=false / 无 data-state / 实例已建 / aria-controls / scrim 标了 aria-hidden
 *   打开  ：list+scrim 的 data-state / aria-expanded / 换 label / 锁滚动 /
 *           焦点进抽屉 / **导航自身没被 aria-hidden** / 正文 aria-hidden+inert
 *   键盘  ：连续 8 次 Tab 仍在抽屉内（焦点陷阱）
 *   关闭  ：Esc 关掉 / 焦点回到汉堡 / 解锁滚动 / 正文恢复可读
 *   其它  ：点遮罩关掉 / 视口变宽自动关掉 / 无 JS 报错
 *
 * ⚠️ 「正文被隐藏」的判据是 `closest('[aria-hidden="true"]')` 而不是看 main 自身：
 *    inert/aria-hidden 是打在 body 的**直接子元素**上的，正文常常包在 .shell 里。
 *    第一版判据看自身，把正确实现报成了失败 —— 判据错，不是实现错。
 */
const { launch } = require('./browser.js');

const BASE = 'http://127.0.0.1:8000/';
const PAGES = [
  ['03-patterns/nav/demo.html', '导航 demo'],
  ['examples/finance-report/index.html', '金融示例页'],
];

let bad = 0, total = 0;
function chk(label, ok, extra) {
  total++;
  if (!ok) bad++;
  const tail = extra === undefined ? '' : '  → ' + JSON.stringify(extra);
  console.log('    ' + (ok ? 'OK  ' : 'FAIL') + ' ' + label + tail);
}

(async () => {
  console.log('  === 导航抽屉行为（移动端）===');
  const b = await launch();

  for (const [path, label] of PAGES) {
    console.log('  --- ' + label + ' ---');
    const p = await b.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

    await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 1 });
    await p.goto(BASE + path, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise((r) => setTimeout(r, 400));

    const s0 = await p.evaluate(() => {
      const t = document.querySelector('.nav__toggle');
      const l = document.querySelector('.nav__list');
      const root = document.querySelector('[data-nav]');
      return {
        expanded: t && t.getAttribute('aria-expanded'),
        listState: l && l.getAttribute('data-state'),
        inst: !!(root && root.navInstance),
        controls: t && t.getAttribute('aria-controls'),
        scrim: document.querySelector('.nav__scrim').getAttribute('aria-hidden'),
      };
    });
    chk('初始化 aria-expanded=false', s0.expanded === 'false', s0.expanded);
    chk('初始化 无 data-state', s0.listState === null, s0.listState);
    chk('data-nav 自动初始化', s0.inst === true);
    chk('aria-controls 指向列表', !!s0.controls, s0.controls);
    chk('scrim 无读屏噪音（aria-hidden）', s0.scrim === 'true', s0.scrim);

    await p.click('.nav__toggle');
    await new Promise((r) => setTimeout(r, 350));
    const s1 = await p.evaluate(() => {
      const nav = document.querySelector('[data-nav]');
      const main = document.querySelector('main');
      return {
        list: document.querySelector('.nav__list').getAttribute('data-state'),
        scrim: document.querySelector('.nav__scrim').getAttribute('data-state'),
        expanded: document.querySelector('.nav__toggle').getAttribute('aria-expanded'),
        label: document.querySelector('.nav__toggle').getAttribute('aria-label'),
        overflow: document.body.style.overflow,
        focusIn: document.querySelector('.nav__list').contains(document.activeElement),
        navHidden: nav.getAttribute('aria-hidden'),
        mainHidden: main && main.closest('[aria-hidden="true"]') ? true : false,
        mainInert: main ? !!main.closest('[inert]') : false,
      };
    });
    chk('打开 list data-state=open', s1.list === 'open', s1.list);
    chk('打开 scrim data-state=open', s1.scrim === 'open', s1.scrim);
    chk('打开 aria-expanded=true', s1.expanded === 'true');
    chk('打开 换 aria-label', s1.label === '关闭菜单', s1.label);
    chk('打开 锁背景滚动', s1.overflow === 'hidden', s1.overflow);
    chk('打开 焦点进抽屉', s1.focusIn === true);
    chk('打开 导航自身没被 aria-hidden（旧版真 bug）', s1.navHidden === null, s1.navHidden);
    chk('打开 正文 aria-hidden', s1.mainHidden === true);
    chk('打开 正文 inert', s1.mainInert === true);

    let trapped = true;
    for (let i = 0; i < 8; i++) {
      await p.keyboard.press('Tab');
      const inside = await p.evaluate(() =>
        document.querySelector('.nav__list').contains(document.activeElement));
      if (!inside) { trapped = false; break; }
    }
    chk('焦点陷阱：8 次 Tab 仍在抽屉内', trapped);

    await p.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 250));
    const s2 = await p.evaluate(() => ({
      list: document.querySelector('.nav__list').getAttribute('data-state'),
      expanded: document.querySelector('.nav__toggle').getAttribute('aria-expanded'),
      overflow: document.body.style.overflow,
      onToggle: document.activeElement === document.querySelector('.nav__toggle'),
      mainHidden: !!document.querySelector('main').closest('[aria-hidden="true"]'),
      mainInert: !!document.querySelector('main').closest('[inert]'),
    }));
    chk('Esc 关掉', s2.list === null && s2.expanded === 'false', [s2.list, s2.expanded]);
    chk('Esc 焦点回到汉堡', s2.onToggle === true);
    chk('Esc 解锁滚动', s2.overflow === '');
    chk('Esc 正文恢复可读', s2.mainHidden === false && s2.mainInert === false);

    await p.click('.nav__toggle');
    await new Promise((r) => setTimeout(r, 300));
    /* 点遮罩的左半部分（抽屉在右边，宽度 min(280px,82vw)） */
    await p.mouse.click(20, 420);
    await new Promise((r) => setTimeout(r, 300));
    const s3 = await p.evaluate(() =>
      document.querySelector('.nav__toggle').getAttribute('aria-expanded'));
    chk('点遮罩关掉', s3 === 'false', s3);

    await p.click('.nav__toggle');
    await new Promise((r) => setTimeout(r, 300));
    await p.setViewport({ width: 1200, height: 852, deviceScaleFactor: 1 });
    await new Promise((r) => setTimeout(r, 400));
    const s4 = await p.evaluate(() =>
      document.querySelector('.nav__toggle').getAttribute('aria-expanded'));
    chk('视口变宽自动关掉', s4 === 'false', s4);

    chk('无 JS 报错', errs.length === 0, errs[0] || '');
    await p.close();
  }

  await b.close();
  console.log(bad
    ? '  [FAIL] ' + bad + ' / ' + total + ' 条抽屉行为不成立'
    : '  [OK  ] ' + total + ' 条抽屉行为全部成立（两个页面）');
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error('  [FAIL] 环境问题（不是检查不通过）：' + e.message);
  process.exit(2);
});
