const { launch } = require('./browser.js');

/**
 * pagination-check.js — 分页行为契约
 *
 * ============================================================================
 * 🔴 为什么需要
 * ============================================================================
 *   分页看似简单，但**无障碍契约极容易做错**，而且错了不会报错：
 *     · 没包 nav / 没 aria-label → 读屏器分不清这是哪个导航
 *     · 用了 aria-selected（那是 tab/option 专用）→ 播报错误
 *     · 翻页没有 aria-live → 读屏用户完全不知道页面变了
 *     · 首末页的"上一页"看着能点却不工作 → 最糟的交互
 *   ⇒ 这四条必须**用机械检查钉死**。
 *
 * ============================================================================
 * 查九件事（依据 W3C APG / USWDS / MDN / Component Gallery / Mironsoft）
 * ============================================================================
 *   ① 包在 `<nav>` 里且有唯一的 `aria-label`
 *   ② 用 `<ul>` + `<li>`（**不是** role=navigation 直接放 ul 上）
 *   ③ 当前页 `aria-current="page"`（**不是** aria-selected）
 *   ④ 当前页**仍然是按钮**（USWDS 的反直觉要求）
 *   ⑤ 页码 `aria-label` 说人话（"第 4 页"）
 *   ⑥ 首/末页用 `disabled`
 *   ⑦ 翻页有 `aria-live="polite"` 且**常驻 DOM**
 *   ⑧ 命中区 ≥ 44×44（WCAG 2.5.5 AAA）
 *   ⑨ 槽位数 ≤ 7（USWDS）
 */
const PAGE = 'http://127.0.0.1:8000/03-patterns/pagination/demo.html';

(async () => {
  const b = await launch();
  let bad = 0;
  const pass = (ok, w) => { console.log('  ' + (ok ? 'OK  ' : 'FAIL') + '  ' + w); if (!ok) bad++; };

  const p = await b.newPage();
  await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 2,
                        isMobile: true, hasTouch: true });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 60)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 60)); });
  await p.goto(PAGE, { waitUntil: 'networkidle0' });

  // ① nav + aria-label
  const nav = await p.evaluate(() => {
    const n = document.querySelector('.pagination');
    return { tag: n.tagName, label: n.getAttribute('aria-label'),
             role: n.getAttribute('role') };
  });
  pass(nav.tag === 'NAV', '① 包在 <nav> 里（实测 <' + nav.tag + '>）');
  pass(!!nav.label && nav.label.length > 2,
       '① 有意义的 aria-label（"' + nav.label + '"）');
  pass(nav.role === null, '① 没把 role 硬写在 nav 上（多余）');

  // ② ul + li
  const list = await p.evaluate(() => {
    const n = document.querySelector('.pagination');
    const ul = n.querySelector('ul');
    return { hasUl: !!ul, ulRole: ul ? ul.getAttribute('role') : null,
             items: n.querySelectorAll('li').length,
             looseA: n.querySelectorAll('a').length };
  });
  pass(list.hasUl, '② 用 <ul> 承载页码');
  pass(list.ulRole === null,
       '② 没把 role=navigation 放在 ul 上（那会覆盖列表语义）');
  pass(list.items > 0, '② 页码在 <li> 里（' + list.items + ' 个）');

  // ③ aria-current 而非 aria-selected
  const cur = await p.evaluate(() => {
    const c = document.querySelector('[aria-current="page"]');
    return { has: !!c, val: c ? c.getAttribute('aria-current') : null,
             selected: document.querySelectorAll('[aria-selected]').length };
  });
  pass(cur.has && cur.val === 'page', '③ 当前页 aria-current="page"');
  pass(cur.selected === 0, '③ 没用 aria-selected（那是 tab/option 专用）');

  // ④ 当前页仍是按钮
  const curTag = await p.evaluate(() => {
    const c = document.querySelector('[aria-current="page"]');
    return c ? c.tagName : null;
  });
  pass(curTag === 'BUTTON', '④ 当前页仍是 <button>（USWDS 反直觉要求）· 实测 <' + curTag + '>');

  // ⑤ aria-label 说人话
  const labels = await p.evaluate(() =>
    [...document.querySelectorAll('.pagination__link')]
      .map((b) => b.getAttribute('aria-label')));
  pass(labels.every((l) => l && /页/.test(l)),
       '⑤ 每个页码都有 "第 N 页" 式的 aria-label（' + JSON.stringify(labels.slice(0, 3)) + '）');
  pass(labels.indexOf('上一页') >= 0 && labels.indexOf('下一页') >= 0,
       '⑤ 上一页/下一页有明确标签（不是只有箭头）');

  // ⑥ 首/末页 disabled
  const dis = await p.evaluate(() => {
    const prev = document.querySelector('[data-goto="prev"]');
    const next = document.querySelector('[data-goto="next"]');
    return { prevOnFirst: prev.disabled, nextOnFirst: next.disabled,
             prevAria: prev.getAttribute('aria-disabled') };
  });
  pass(dis.prevOnFirst === true && dis.nextOnFirst === false,
       '⑥ 第 1 页：上一页 disabled ✅ 下一页可用 ✅');
  pass(dis.prevAria === 'true', '⑥ disabled 同时标 aria-disabled（读屏会播报）');

  // ⑦ aria-live 常驻
  const live = await p.evaluate(() => {
    const l = document.querySelector('[data-pg-live]');
    if (!l) return null;
    const r = l.getBoundingClientRect();
    return { attr: l.getAttribute('aria-live'), text: l.textContent,
             hidden: r.width <= 1 && r.height <= 1,
             isP: l.tagName === 'P' };
  });
  pass(live && live.attr === 'polite', '⑦ 有 aria-live="polite"');

  // 翻页 → 播报内容更新，且元素**没有被替换**
  const liveId = await p.evaluate(() => {
    const l = document.querySelector('[data-pg-live]');
    l.__mark = 1;
    return document.querySelector('[data-goto="next"]') ? 1 : 0;
  });
  await p.evaluate(() => {
    document.querySelector('[data-pagination]').setAttribute('data-page', '3');
    window.Pagination.create(document.querySelector('[data-pagination]')).go(3);
  });
  await new Promise((r) => setTimeout(r, 250));
  /* 🔴 不用 p.click('[data-goto="next"]')：
     重渲染后 Puppeteer 的元素句柄已失效 ⇒ 报 "not clickable"。
     改用**真实鼠标坐标**点击（与 focus-ring-check 里学到的同一坑）。 */
  const nb = await p.evaluate(() => {
    const r = document.querySelector('[data-goto="next"]').getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  await p.mouse.click(nb.x, nb.y);
  await new Promise((r) => setTimeout(r, 300));
  const after = await p.evaluate(() => {
    const l = document.querySelector('[data-pg-live]');
    return { text: l.textContent, sameNode: l.__mark === 1 };
  });
  pass(/第 4 页/.test(after.text), '⑦ 翻页后播报更新（"' + after.text + '"）');
  pass(after.sameNode, '⑦ live 区**常驻未替换**（只改 textContent · 依据 USWDS）');

  // 🔴 视觉层级
  //    真因：当前页同时带 aria-current 与 aria-disabled，
  //    而禁用规则排在后面 ⇒ **把底色覆盖成透明**（实测 rgba(0,0,0,0)）。
  /* 🔴 判据修正：必须在**第 1 页**查"上一页"的禁用态
     （之前在第 2 页查，那时它本来就不该是禁用的 ⇒ 判据错了） */
  await p.evaluate(() => {
    const n = document.querySelector('[data-pagination]');
    n.setAttribute('data-page', '1');
    window.Pagination.create(n).go(1, { scroll: false });
  });
  await new Promise((r) => setTimeout(r, 250));

  const vis = await p.evaluate(() => {
    const g = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const c = getComputedStyle(e);
      return { bg: c.backgroundColor, border: c.borderColor, op: c.opacity };
    };
    return { cur: g('[aria-current="page"]'),
             other: g('[data-goto="3"]'),
             dis: g('[data-goto="prev"]') };
  });
  const solid = (c) => c && c.bg !== 'rgba(0, 0, 0, 0)';
  pass(solid(vis.cur), '当前页有**实体底色**（实测 ' + (vis.cur ? vis.cur.bg : '无') + '）');
  pass(vis.cur && vis.cur.op === '1', '当前页 opacity=1（不被禁用态压暗）');
  pass(solid(vis.other), '普通页有底色+轻边框（实测 ' + (vis.other ? vis.other.bg : '无') + '）');
  pass(vis.other && vis.other.border !== 'rgba(0, 0, 0, 0)',
       '普通页有边框（实测 ' + (vis.other ? vis.other.border : '无') + '）');
  // ⚠️ 判据跟着实现走：禁用态我**不用 opacity**（半透明会让人以为还能点），
  //    而是"退到背景里"（--surface-sunken）⇒ 判据也比背景色。
  const isSunk = (c) => c && c.bg === 'rgb(241, 243, 245)';
  pass(vis.dis && isSunk(vis.dis),
       '禁用页退到背景里（实测 ' + (vis.dis ? vis.dis.bg : '无') + '，非半透明）');

  // ⑧ 命中区
  const sizes = await p.evaluate(() =>
    [...document.querySelectorAll('.pagination__link')]
      .map((b) => { const r = b.getBoundingClientRect();
        return [Math.round(r.width), Math.round(r.height)]; }));
  const small = sizes.filter((s) => s[0] < 44 || s[1] < 44);
  pass(small.length === 0,
       '⑧ 命中区全部 ≥44×44（WCAG 2.5.5 AAA）· 最小 ' +
       Math.min.apply(null, sizes.map((s) => Math.min(s[0], s[1]))) + 'px');

  // ⑨ 槽位数
  const slots = [];
  for (const pg of [1, 3, 5, 7, 12, 13]) {
    await p.evaluate((x) => {
      document.querySelector('[data-pagination]').setAttribute('data-page', x);
      window.Pagination.create(document.querySelector('[data-pagination]')).go(x);
    }, pg);
    await new Promise((r) => setTimeout(r, 200));
    /* 🔴 数「页码槽位」——**不含**上一页/下一页
       （USWDS 的 7 槽位指的是页码区，前后页是独立控件） */
    const n = await p.evaluate(() => {
      const items = [...document.querySelectorAll('.pagination__item')];
      const prev = document.querySelector('[data-goto="prev"]').closest('li');
      const next = document.querySelector('[data-goto="next"]').closest('li');
      return items.filter((li) => li !== prev && li !== next).length;
    });
    slots.push({ pg, n });
  }
  const over = slots.filter((s) => s.n > 7);
  pass(over.length === 0,
       '⑨ 槽位数 ≤7（USWDS）· ' + slots.map((s) => s.pg + '页:' + s.n).join(' '));

  // 键盘契约
  await p.evaluate(() => {
    document.querySelector('[data-pagination]').setAttribute('data-page', '1');
    window.Pagination.create(document.querySelector('[data-pagination]')).go(1);
    document.querySelector('[aria-current="page"]').focus();
  });
  await new Promise((r) => setTimeout(r, 200));
  await p.keyboard.press('ArrowRight');
  await new Promise((r) => setTimeout(r, 250));
  const k1 = await p.evaluate(() => document.querySelector('[aria-current="page"]').textContent);
  pass(k1 === '2', '键盘 → 翻到第 2 页（实测 ' + k1 + '）');
  await p.keyboard.press('End');
  await new Promise((r) => setTimeout(r, 250));
  const k2 = await p.evaluate(() => ({
    cur: document.querySelector('[aria-current="page"]').textContent,
    nextDis: document.querySelector('[data-goto="next"]').disabled }));
  pass(k2.cur === '13', '键盘 End → 末页（实测 ' + k2.cur + '）');
  pass(k2.nextDis === true, '末页时"下一页" disabled ✅');
  await p.keyboard.press('Home');
  await new Promise((r) => setTimeout(r, 250));
  const k3 = await p.evaluate(() => ({
    cur: document.querySelector('[aria-current="page"]').textContent,
    prevDis: document.querySelector('[data-goto="prev"]').disabled }));
  pass(k3.cur === '1', '键盘 Home → 首页（实测 ' + k3.cur + '）');
  pass(k3.prevDis === true, '首页时"上一页" disabled ✅');

  /* 🔴 逻辑关系（要求：注重逻辑关系，不只是表面上的视觉设计） */
  // ① URL 同步：翻页后 ?page=N
  await p.evaluate(() => {
    document.querySelector('[data-pagination]').setAttribute('data-page', '1');
    window.Pagination.create(document.querySelector('[data-pagination]')).go(1);
  });
  await new Promise((r) => setTimeout(r, 200));
  await p.evaluate(() => document.querySelector('[aria-current="page"]').focus());
  await p.keyboard.press('ArrowRight');
  await new Promise((r) => setTimeout(r, 400));
  const url = await p.evaluate(() => location.search);
  pass(/page=2/.test(url), '翻页后 URL 同步为 ?page=2（可分享/刷新保持）· 实测 "' + url + '"');

  // ② 刷新后保持页码
  await p.reload({ waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 400));
  const kept = await p.evaluate(() =>
    (document.querySelector('[aria-current="page"]') || {}).textContent || '');
  pass(kept === '2', '刷新后保持在第 2 页（实测 ' + kept + '）');

  // ③ 翻页后滚动位置重置到数据区（不是停在页面底部）
  await p.evaluate(() => {
    const n = document.querySelector('[data-pagination]');
    n.setAttribute('data-page', '1'); window.Pagination.create(n).go(1);
  });
  await new Promise((r) => setTimeout(r, 200));
  const s0 = await p.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    return Math.round(window.scrollY);
  });
  await new Promise((r) => setTimeout(r, 250));
  await p.evaluate(() => document.querySelector('[aria-current="page"]').focus());
  await p.keyboard.press('ArrowRight');
  await new Promise((r) => setTimeout(r, 500));
  const s1 = await p.evaluate(() => Math.round(window.scrollY));
  pass(s1 < s0, '翻页后滚动重置到数据区（' + s0 + ' → ' + s1 + '）');

  // 窄屏
  const ov = await p.evaluate(() => ({
    sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
  pass(ov.sw <= ov.vw + 1, '窄屏无横向溢出（' + ov.sw + ' ≤ ' + ov.vw + '）');

  pass(errs.length === 0, '控制台无错误' + (errs.length ? '：' + errs.join(' | ') : ''));

  await b.close();
  console.log('');
  if (bad) { console.log('  ❌ ' + bad + ' 项不满足'); process.exit(1); }
  console.log('  ✅ 分页契约全部满足');
})();
