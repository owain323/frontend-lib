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
 * switch 的行为契约（APG Switch Pattern）
 *
 * 🔴 修正过一次：第一版用 `dispatchEvent(keydown)` 测键盘，
 *    **那不是真实按键** —— 浏览器不会执行默认行为，
 *    所以"Enter 不切换"这条测出来是**假通过**。
 *    现在改用 `page.keyboard.press()`（真实按键），
 *    并与合成事件的结果做了对照（一致 ⇒ 结论可信）。
 *
 * APG 的硬要求：
 *   1. Space 切换 / **Enter 不切换**（switch 与 button 的关键区别）
 *   2. 可聚焦、焦点环画在**看得见**的元素上
 *   3. role="switch" + 原生 checkbox
 *   4. label[for] 关联（读屏能得到名字）
 */
(async () => {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 1000, height: 900, deviceScaleFactor: 2 });
  await p.goto('http://127.0.0.1:8000/02-primitives/switch/demo.html',
               { waitUntil: 'networkidle0' });
  await p.screenshot({ path: REPO + '/10-review/shots/switch.png' });

  const results = [];
  const add = (n, ok) => results.push([n, ok]);

  // ── 结构（DOM 层面）
  const st = await p.evaluate(() => {
    const el = document.getElementById('s1');
    el.focus();
    return {
      focusable: document.activeElement === el,
      role: el.getAttribute('role'),
      type: el.type,
      hasLabel: !!document.querySelector('label[for="s1"]'),
      labelText: (document.querySelector('label[for="s1"]') || {}).textContent || '',
    };
  });
  add('可聚焦', st.focusable);
  add('role="switch"', st.role === 'switch');
  add('type=checkbox（原生）', st.type === 'checkbox');
  add('label[for] 关联', st.hasLabel);
  add('label 有可读文字', st.labelText.trim().length > 0);

  // 焦点环画在可见元素上（原生被 clip，outline 看不见）
  const ring = await p.evaluate(() => {
    const el = document.getElementById('s1');
    el.focus();
    return parseFloat(getComputedStyle(document.querySelector('.switch__track')).outlineWidth);
  });
  add('焦点环在可见元素上', ring > 0);

  // ── 键盘（🔴 真实按键，不是 dispatchEvent）
  const c0 = await p.evaluate(() => document.getElementById('s1').checked);
  await p.evaluate(() => document.getElementById('s1').focus());
  await p.keyboard.press('Space');
  const c1 = await p.evaluate(() => document.getElementById('s1').checked);
  add('Space 切换（真实按键）', c1 !== c0);

  await p.keyboard.press('Enter');
  const c2 = await p.evaluate(() => document.getElementById('s1').checked);
  add('Enter 不切换（真实按键，APG 要求）', c2 === c1);

  // 滑块位移随状态变化
  const moved = await p.evaluate(() => {
    const el = document.getElementById('s1');
    const th = document.querySelector('.switch__thumb');
    const a = getComputedStyle(th).transform;
    el.click();
    const b = getComputedStyle(th).transform;
    el.click();
    return a !== b;
  });
  add('滑块位移随状态变化', moved);

  // ── axe
  await p.addScriptTag({ path: AXE });
  const a = await p.evaluate(async () => {
    const res = await window.axe.run(document);
    return { v: res.violations.map(x => x.id), p: res.passes.length };
  });
  add('axe 0 违规（' + a.p + ' 条通过）', a.v.length === 0);

  let bad = 0;
  for (const [n, ok] of results) {
    if (!ok) bad++;
    console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' ' + n);
  }
  if (a.v.length) console.log('       axe 违规: ' + a.v.join(', '));
  await b.close();
  console.log('');
  console.log(bad ? '  ' + bad + ' 项不通过' : '  ✅ switch 行为契约全部满足');
  process.exit(bad ? 1 : 0);
})();
