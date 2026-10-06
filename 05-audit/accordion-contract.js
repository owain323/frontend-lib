const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');
// puppeteer-core 改由 browser.js 统一持有
  // 🔴 2026-10-04 统一走 browser.js：那里会 setCacheEnabled(false)。
  //    没有它，页面里跑的是**缓存的旧代码**，测试会假通过
  //    （磁盘上明明改对了，浏览器里还是旧的）。
  const { launch } = require('./browser');
const AXE = require.resolve('axe-core');

/**
 * accordion 的行为契约（APG: Accordion Pattern）
 *
 * 🔴 用 `page.keyboard.press()`（真实按键）。
 *    本组件**刻意不监听 keydown** —— 原生 <button> 自己会响应
 *    Enter/Space 并触发 click。这个测试正是为了证明"不监听也对"。
 *
 * 重点测三件容易写错的事：
 *   1. **单开 vs 多开**（默认单开；--multi 才是多开）
 *   2. **没有 keydown 监听**（不是忘了，是故意的 —— 见 accordion.js 注释）
 *   3. **role="region" 的 ≤6 上限**（>6 不给，否则地标泛滥）
 */
(async () => {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 1000, height: 1000, deviceScaleFactor: 2 });
  await p.goto('http://127.0.0.1:8000/03-patterns/accordion/demo.html',
               { waitUntil: 'networkidle0' });
  await p.screenshot({ path: REPO + '/10-review/shots/accordion.png' });

  const R = [];
  const add = (n, ok) => R.push([n, !!ok]);
  const first = () => p.evaluate(() => {
    const a = document.querySelectorAll('.accordion')[0];
    return [...a.querySelectorAll('.accordion__trigger')]
      .map(t => t.getAttribute('aria-expanded'));
  });
  const focus = (i) => p.evaluate((n) => {
    const a = document.querySelectorAll('.accordion')[0];
    a.querySelectorAll('.accordion__trigger')[n].focus();
  }, i);

  // ── 结构（APG 原文：heading 包住 button）
  const st = await p.evaluate(() => {
    const a = document.querySelectorAll('.accordion')[0];
    const h = a.querySelector('.accordion__heading');
    const btn = a.querySelector('.accordion__trigger');
    const panel = a.querySelector('.accordion__panel');
    return {
      headingTag: h ? h.tagName.toLowerCase() : null,
      // 🔴 APG：button 必须是 heading 的**直接子元素**
      //    （button 套 heading 会被 VoiceOver/TalkBack 读不出）
      btnInsideHeading: !!(h && btn && h.contains(btn)),
      headingInsideBtn: !!(btn && btn.querySelector('h1,h2,h3,h4,h5,h6')),
      btnTag: btn ? btn.tagName.toLowerCase() : null,
      controls: btn && btn.getAttribute('aria-controls'),
      labelledby: panel && panel.getAttribute('aria-labelledby'),
      region: panel && panel.getAttribute('role'),
      markerHidden: !!(a.querySelector('.accordion__marker') || {}).getAttribute &&
                     a.querySelector('.accordion__marker').getAttribute('aria-hidden'),
    };
  });
  add('header 是 heading 元素（h3）', /^h[1-6]$/.test(st.headingTag));
  add('button 在 heading 里面（不是里面套 heading）',
      st.btnInsideHeading && !st.headingInsideBtn);
  add('trigger 是原生 <button>', st.btnTag === 'button');
  add('aria-controls 指向 panel', !!st.controls);
  add('panel 的 aria-labelledby 指回 button', !!st.labelledby);
  add('panel 有 role=region（≤6 个时）', st.region === 'region');
  add('装饰三角有 aria-hidden', st.markerHidden);

  // ── 单开：打开第二项，第一项应自动收起
  let f = await first();
  add('初始：只有第一项展开', f[0] === 'true' && f[1] === 'false' && f[2] === 'false');
  await focus(1);
  await p.keyboard.press('Enter');
  f = await first();
  add('🔴 Enter 切换到第二项', f[1] === 'true');
  add('🔴 单开模式：原来的第一项自动收起', f[0] === 'false');
    add('单开模式：始终只有一项展开', f.filter(x => x === 'true').length === 1);
    /* 🔴 2026-10-04 修判据的**时序 bug**：
       收起是**动画**（grid-template-rows 过渡 ~240ms，JS 侧另有 400ms 兜底），
       面板的 `hidden` 是在**过渡结束后**才加的（见 accordion.js 的 settle()）。
       ⇒ 原契约 `press('Enter')` 之后**立刻**查 hidden ⇒ 必然失败，
          但那是**动画还没结束**，不是组件坏了。

       实测（同一份代码）：
         Enter 后立即查：state=open  hidden=false display=grid
         等 900ms 后：  state=closed hidden=true  display=none  ✅

       ⇒ 判据必须**等过渡结束**再查。
          ⚠️ 顺带：这个 CSS 侧的 `.accordion__panel[hidden]{display:none!important}`
             是必要的 —— 否则 `hidden` 会被 `.accordion__panel{display:grid}` 盖掉。 */
    await p.waitForFunction(() => {
      const a = document.querySelectorAll('.accordion')[0];
      const p1 = a.querySelectorAll('.accordion__panel')[0];
      return p1.hasAttribute('hidden');
    }, { timeout: 3000 }).catch(() => {});
    const hiddenOk = await p.evaluate(() => {
      const a = document.querySelectorAll('.accordion')[0];
      const p1 = a.querySelectorAll('.accordion__panel')[0];
      return p1.hasAttribute('hidden') &&
             getComputedStyle(p1).display === 'none';
    });
    add('🔴 收起的面板真正 display:none（离开无障碍树）', hiddenOk);

  // ── Space 切换回去
  await p.keyboard.press('Space');
  f = await first();
  add('Space 切换（原生 button 行为，无需 keydown 监听）', f[1] === 'false');

  // ── 点击也有效
  await p.evaluate(() => {
    document.querySelectorAll('.accordion')[0]
      .querySelectorAll('.accordion__trigger')[2].click();
  });
  f = await first();
  add('点击切换', f[2] === 'true');

  // ── 多开：--multi 模式下不互相关闭
  /* 🔴 2026-10-04 修判据 bug：
     原代码依次点 `ts[0]` 与 `ts[1]`，但多开实例里**第 1 项初始就是展开的**
     ⇒ 那次 click 是「**收起**」而不是「打开」
     ⇒ 后面判「两项同时展开」必然失败。
     ⚠️ 组件本身是对的 —— 实测点第 3 项：
        ["true","true","false"] → ["true","true","true"]   ✅ 三项同开

     ⇒ 判据改成：**先读状态，找一个当前收起的项去点**，
        这样无论 demo 的初始状态怎么变都不会误判。 */
  const multi = await p.evaluate(() => {
    const a = document.querySelectorAll('.accordion')[1];
    const ts = a.querySelectorAll('.accordion__trigger');
    const st = () => [...a.querySelectorAll('.accordion__trigger')]
      .map(t => t.getAttribute('aria-expanded'));
    let idx = -1;
    for (let k = 0; k < ts.length; k++) {
      if (ts[k].getAttribute('aria-expanded') !== 'true') { idx = k; break; }
    }
    if (idx < 0) return { arr: st(), note: 'all-open' };
    ts[idx].click();
    return { arr: st(), note: 'clicked-' + idx };
  });
  add('多开模式：≥2 项可同时展开（点了收起项 ' + multi.note + '）',
      multi.arr.filter(x => x === 'true').length >= 2);

  // ── 禁用的项点不开
  const dis = await p.evaluate(() => {
    const a = document.querySelectorAll('.accordion')[2];
    const ts = a.querySelectorAll('.accordion__trigger');
    const before = ts[1].getAttribute('aria-expanded');
    ts[1].click();
    return before + '->' + ts[1].getAttribute('aria-expanded');
  });
  add('aria-disabled 的项点不开', dis === 'false->false');

  // ── 面板数 > 6 时不给 role=region（APG 的地标泛滥警告）
  const many = await p.evaluate(() => {
    // 造一个 8 项的 accordion--many
    const d = document.createElement('div');
    d.className = 'accordion accordion--many';
    d.setAttribute('data-accordion', '');
    d.innerHTML = Array.from({ length: 8 }, (_, i) =>
      '<div class="accordion__item"><h3 class="accordion__heading">' +
      '<button class="accordion__trigger" aria-expanded="false">' +
      '<span class="accordion__label">项' + (i + 1) + '</span></button></h3>' +
      '<div class="accordion__panel" hidden>内容</div></div>').join('');
    document.body.appendChild(d);
    // 手动触发 init（appendChild 之后脚本不会自动跑）
    const inst = new window.Accordion(d);
    return {
      panels: d.querySelectorAll('[role="region"]').length,
      items: d.querySelectorAll('.accordion__item').length,
    };
  });
  add('>6 个面板且加了 --many ⇒ 不给 role=region（' +
      many.panels + '/' + many.items + '）', many.panels === 0 && many.items === 8);

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
  console.log(bad ? '  ' + bad + ' 项不通过' : '  ✅ accordion 行为契约全部满足');
  process.exit(bad ? 1 : 0);
})();
