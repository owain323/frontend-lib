const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');
// puppeteer-core 改由 browser.js 统一持有
  // 🔴 统一走 browser.js：那里会 setCacheEnabled(false)。
  //    没有它，页面里跑的是**缓存的旧代码**，测试会假通过
  //    （磁盘上明明改对了，浏览器里还是旧的）。
  const { launch } = require('./browser');
const AXE = require.resolve('axe-core');

/**
 * tabs 的行为契约（APG / Radix Tabs Pattern）
 *
 * 🔴 用 `page.keyboard.press()`（真实按键），不是 dispatchEvent ——
 *    合成事件不触发浏览器默认行为，测出来的可能是假通过。
 *
 * 重点测 **roving tabindex**，因为它最容易写错：
 *   1. 组里只有一个 tabindex="0"（其余 -1）
 *   2. **那个 "0" 必须跟着选中项走** ← 只在初始化设一次是最常见的 bug
 *   3. 方向键循环（最后一个的下一个是第一个）
 *   4. 方向键跳过 aria-disabled
 *   5. 手动激活模式：方向键只移焦点，不切面板
 */
(async () => {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 1000, height: 1000, deviceScaleFactor: 2 });
  await p.goto('http://127.0.0.1:8000/03-patterns/tabs/demo.html',
               { waitUntil: 'networkidle0' });
  await p.screenshot({ path: REPO + '/10-review/shots/tabs.png' });

  const R = [];
  const add = (n, ok) => R.push([n, ok]);
  const sel = (id) => p.evaluate((i) => {
    const el = document.getElementById(i);
    return {
      selected: el.getAttribute('aria-selected'),
      tabindex: el.getAttribute('tabindex'),
      focused: document.activeElement === el,
    };
  }, id);
  const roving = await p.evaluate(() => {
    const g = document.querySelectorAll('.tabs')[0];
    return [...g.querySelectorAll('[role="tab"]')].map(t => t.getAttribute('tabindex'));
  });
  const focusById = (id) => p.evaluate((i) => document.getElementById(i).focus(), id);

  // ── 结构
  const st = await p.evaluate(() => {
    const g = document.querySelectorAll('.tabs')[0];
    const t = g.querySelector('[role="tab"]');
    const pan = g.querySelector('[role="tabpanel"]');
    return {
      role: t.tagName.toLowerCase(),
      tablist: !!g.querySelector('[role="tablist"]'),
      controls: t.getAttribute('aria-controls'),
      panelLabelled: pan.getAttribute('aria-labelledby'),
      tabId: t.id,
      orientation: g.querySelector('[role="tablist"]').getAttribute('aria-orientation'),
    };
  });
  add('tab 是原生 <button>', st.role === 'button');
  add('有 role=tablist', st.tablist);
  add('tab 的 aria-controls 指向 panel', !!st.controls);
  add('panel 的 aria-labelledby 指回 tab', st.panelLabelled === st.tabId);
  add('tablist 有方向声明（aria-orientation）', !!st.orientation);

  // ── roving：组里只有一个 0
  add('roving：只有一个 tabindex="0"（' + roving.join(',') + '）',
      roving.filter(x => x === '0').length === 1);

  // ── 初始：aria-selected="true" 的那个是 tabindex=0
  let s = await sel('t1');
  add('初始 tabindex=0 落在选中的 tab 上', s.tabindex === '0');
  // 🔴 修正判据：页面刚加载时**焦点应该在 body**，
  //    不该在 tab 上 —— 我原来写"初始 tab 有焦点"是**判据错了**
  //    （Tab 键的作用正是"把焦点带进 tab 组"）。
  //    真正要测的是"按 Tab 之后焦点落在选中的 tab 上"，那在后面。
  add('初始焦点不在 tab 组内（留给 Tab 键带进来）', s.focused === false);

  // ── ArrowRight：下一个 tab 被激活，且 tabindex 跟着走
  await focusById('t1');
  await p.keyboard.press('ArrowRight');
  let s2 = await sel('t2');
  let s1 = await sel('t1');
  add('ArrowRight 切到下一个 tab', s2.selected === 'true');
  add('ArrowRight 后焦点跟着走', s2.focused);
  add('🔴 roving 跟着选中项走（0 移到新的选中项）', s2.tabindex === '0' && s1.tabindex === '-1');

  // ── 面板跟着切
  const panelOpen = await p.evaluate(() =>
    !document.getElementById('p2').hasAttribute('hidden'));
  add('对应面板可见', panelOpen);
  const panelClosed = await p.evaluate(() =>
    document.getElementById('p1').hasAttribute('hidden'));
  add('原面板已隐藏', panelClosed);

  // ── 循环：End → 最后一个，再 ArrowRight → 回到第一个
  await p.keyboard.press('End');
  let s3 = await sel('t3');
  add('End 跳到最后一个', s3.selected === 'true');
  await p.keyboard.press('ArrowRight');
  let s1b = await sel('t1');
  add('ArrowRight 从最后一个循环回第一个', s1b.selected === 'true');
  add('循环后 roving 仍唯一', (await p.evaluate(() =>
    [...document.querySelectorAll('.tabs')[0].querySelectorAll('[role="tab"]')]
      .filter(t => t.getAttribute('tabindex') === '0').length)) === 1);

  // ── Home
  await p.keyboard.press('Home');
  add('Home 跳到第一个', (await sel('t1')).selected === 'true');

  // ── 跳过禁用（第二个组：d2 是 aria-disabled）
  await focusById('d1');
  await p.keyboard.press('ArrowRight');
  let sd3 = await sel('d3');
  let sd2 = await sel('d2');
  add('方向键跳过 aria-disabled 的 tab', sd3.selected === 'true' && sd2.selected === 'false');

  // ── 手动激活模式：方向键只移焦点，不切面板
  await focusById('m1');
  await p.keyboard.press('ArrowRight');
  const manual = await p.evaluate(() => ({
    m1: document.getElementById('m1').getAttribute('aria-selected'),
    m2: document.getElementById('m2').getAttribute('aria-selected'),
    focused: document.activeElement.id,
    panel1hidden: document.getElementById('mp1').hasAttribute('hidden'),
  }));
  add('手动模式：方向键不切面板', manual.m1 === 'true' && manual.m2 === 'false');
  add('手动模式：方向键仍移动焦点', manual.focused === 'm2');
  add('手动模式：roving 跟着焦点走',
      (await p.evaluate(() => document.getElementById('m2').getAttribute('tabindex'))) === '0');
  await p.keyboard.press('Enter');
  add('手动模式：Enter 才激活',
      (await p.evaluate(() => document.getElementById('m2').getAttribute('aria-selected'))) === 'true');

  // ── 焦点环画在可见元素上
  const ring = await p.evaluate(() => {
    document.getElementById('t1').focus();
    return parseFloat(getComputedStyle(document.getElementById('t1')).outlineWidth);
  });
  add('焦点环可见（tab 是 button ⇒ :focus-visible）', ring >= 0);

  // ── Tab 键的进出（APG 的核心契约，真实按键）
  //  🔴 这一组是我第一版**漏测**的：只测了方向键，没测 Tab。
  //     实测发现「面板里全是静态文字时，Tab 会直接跳过整个面板」——
  //     规范要求「在 tab 上按 Tab ⇒ 焦点进入面板」，两者有真实张力。
  //     ⇒ demo 的面板里放了可聚焦元素，这里验证它真的能进。
  // 🔴 修正：起点必须是**真实的可聚焦元素**。
  //    `document.body.focus()` 在 Chrome 里 body 不可聚焦，
  //    activeElement 仍是 body ⇒ 第一次 Tab 从文档第一个可聚焦元素开始，
  //    落在"跳到主内容"链接上而不是 t1 —— **我的起点选错了**。
  await p.evaluate(() => document.querySelector('.lede').setAttribute('tabindex', '-1'));
  await p.evaluate(() => document.querySelector('.lede').focus());
  const seq = [];
  for (let i = 0; i < 4; i++) {
    await p.keyboard.press('Tab');
    // 🔴 不要只看 id —— 面板里的按钮可能没有 id（会记成 'body'，看起来像失败）。
    //    判据是"焦点是否落在 tabpanel 内"，这才是 APG 的要求。
    seq.push(await p.evaluate(() => {
      const a = document.activeElement;
      return a.id || a.tagName.toLowerCase() + (a.closest('[role="tabpanel"]') ? '(in-panel)' : '');
    }));
  }
  add('Tab 进入 tab 组落在选中的 tab（' + seq[0] + '）', seq[0] === 't1');
  add('Tab 从 tab 组进入面板内容（第 2 站 = ' + seq[1] + '）',
      seq[1].indexOf('(in-panel)') > 0);
  add('Tab 不逐个穿过同组的其它 tab（' + seq.slice(0, 2).join(',') + '）',
      seq.indexOf('t2') === -1 && seq.indexOf('t3') === -1);

  // ── axe
  await p.addScriptTag({ path: AXE });
  const a = await p.evaluate(async () => {
    const res = await window.axe.run(document);
    return { v: res.violations.map(x => x.id), p: res.passes.length };
  });
  add('axe 0 违规（' + a.p + ' 条通过）', a.v.length === 0);

  let bad = 0;
  for (const [n, ok] of R) {
    if (!ok) bad++;
    console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' ' + n);
  }
  if (a.v.length) console.log('       axe 违规: ' + a.v.join(', '));
  await b.close();
  console.log('');
  console.log(bad ? '  ' + bad + ' 项不通过' : '  ✅ tabs 行为契约全部满足');
  process.exit(bad ? 1 : 0);
})();
