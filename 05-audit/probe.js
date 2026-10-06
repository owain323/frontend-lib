// puppeteer-core 改由 browser.js 统一持有
  // 🔴 统一走 browser.js：那里会 setCacheEnabled(false)。
  //    没有它，页面里跑的是**缓存的旧代码**，测试会假通过
  //    （磁盘上明明改对了，浏览器里还是旧的）。
  const { launch } = require('./browser');

/**
 * probe.js — 一次性探测"从来没量过"的维度
 *
 * 为什么需要
 * ----------------------
 * 本库有 23 道门禁，但它们全部集中在"代码写对了吗"。
 * 下面这几件事**从来没被量过**，因此也就不知道是好是坏：
 *   · 性能（DOM 规模、首屏时间）
 *   · 极端内容（超长文本会不会撑破布局）
 *   · 触摸目标（375px 下的可点区域）
 *   · 横向溢出
 *
 * ⚠️ 这不是新门禁，是**摸底** —— 先知道现状，才知道该不该建门禁。
 *    摸出来没问题 ⇒ 不建；摸出问题 ⇒ 才建（这才是"有效保护"）。
 */
const PAGES = [
  ['index', 'index.html'],
  ['button', '02-primitives/button/demo.html'],
  ['card', '02-primitives/card/demo.html'],
  ['choice', '02-primitives/choice/demo.html'],
  ['input', '02-primitives/input/demo.html'],
  ['form-valid', '03-patterns/form-validation/demo.html'],
  ['list', '03-patterns/list/demo.html'],
  ['nav', '03-patterns/nav/demo.html'],
  ['overlay', '03-patterns/overlay/demo.html'],
  ['states', '03-patterns/states/demo.html'],
  ['longform', '04-recipes/longform/longform.html'],
];

(async () => {
  const b = await launch();
  const rows = [];
  for (const [name, rel] of PAGES) {
    const p = await b.newPage();
    await p.setViewport({ width: 1280, height: 900 });
    try {
      await p.goto('http://127.0.0.1:8000/' + rel,
                   { waitUntil: 'networkidle0', timeout: 12000 });
    } catch (e) { await p.close(); continue; }

    const desk = await p.evaluate(() => ({
      nodes: document.querySelectorAll('*').length,
      ms: Math.round((performance.getEntriesByType('navigation')[0] || {})
        .domContentLoadedEventEnd || 0),
    }));

    // 超长中文：能不能撑破容器
    const longText = await p.evaluate(() => {
      const targets = [...document.querySelectorAll('p,li,td,th,h1,h2,h3,span,div')]
        .filter((e) => e.offsetWidth > 0 && e.offsetHeight > 0)
        .slice(0, 60);
      let broken = 0;
      for (const t of targets) {
        const old = t.textContent;
        t.textContent = '超长中文测试'.repeat(30);
        if (t.scrollWidth > t.clientWidth + 2) broken++;
        t.textContent = old;
      }
      return { tested: targets.length, broken };
    });

    // 375px 移动端
    // 🔴 修：必须**重新加载**页面，不能只改 viewport。
    //    原因：上面刚把 60 个元素的 textContent 塞成长文本又改回来，
    //    那些元素的 scrollWidth 还留着脏值；此时测 scrollWidth 会**假报溢出**
    //    （实测 375→672，而同一页面重载后是 375）。
    //    ⇒ 溢出检测必须在**干净的页面**上做。
    await p.setViewport({ width: 375, height: 720 });
    await p.reload({ waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 350));
    const mob = await p.evaluate(() => {
      const small = [...document.querySelectorAll('button,a,input,select,[role=button]')]
        .filter((e) => { const r = e.getBoundingClientRect();
                         return r.width > 0 && (r.height < 24 || r.width < 24); })
        .map((e) => e.tagName.toLowerCase() +
              (e.className ? '.' + String(e.className).split(' ')[0] : ''));
      return {
        hOverflow: document.documentElement.scrollWidth > 376,
        smallCount: small.length,
        smallSample: [...new Set(small)].slice(0, 3),
      };
    });

    rows.push({ name, desk, longText, mob });
    await p.close();
  }
  await b.close();

  // 表格输出（自己拼，不用 %d —— Node 的 console.log 不支持 printf）
  const pad = (s, n) => { s = String(s); let w = 0;
    for (const ch of s) w += ch.charCodeAt(0) > 255 ? 2 : 1;
    return s + ' '.repeat(Math.max(0, n - w)); };
  console.log('  ' + pad('页面', 12) + pad('DOM节点', 9) + pad('首屏ms', 8) +
              pad('超长撑破', 11) + pad('375溢出', 9) + '小触摸目标');
  console.log('  ' + '-'.repeat(72));
  for (const r of rows) {
    console.log('  ' + pad(r.name, 12) + pad(r.desk.nodes, 9) + pad(r.desk.ms, 8) +
                pad(r.longText.broken + '/' + r.longText.tested, 11) +
                pad(r.mob.hOverflow ? '有' : '无', 9) +
                (r.mob.smallCount ? r.mob.smallCount + ' 个 ' +
                  r.mob.smallSample.join(' ') : '0'));
  }
  const t = rows.reduce((s, r) => s + r.longText.broken, 0);
  const o = rows.filter((r) => r.mob.hOverflow).length;
  const s2 = rows.reduce((s, r) => s + r.mob.smallCount, 0);
  console.log('');
  console.log('  合计：超长文本撑破 ' + t + ' 处 · 375px 横向溢出 ' + o +
              ' 个页面 · 小于 24px 的触摸目标 ' + s2 + ' 个');
  console.log('');
  console.log('  ⚠ 判读：以上是**现状**，不是合格/不合格。');
  console.log('    · 触摸目标：WCAG 2.2 的 AA 门槛是 24×24（2.5.8），本库按 44px 设计');
  console.log('    · 超长文本撑破：中文没有词边界，overflow-wrap:anywhere 之类才是解');
})();
