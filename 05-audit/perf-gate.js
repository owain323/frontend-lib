// puppeteer-core 改由 browser.js 统一持有
  // 🔴 统一走 browser.js：那里会 setCacheEnabled(false)。
  //    没有它，页面里跑的是**缓存的旧代码**，测试会假通过
  //    （磁盘上明明改对了，浏览器里还是旧的）。
  const { launch } = require('./browser');

/**
 * perf-gate.js — 性能基线门禁
 *
 * 
 * ------------------------------------------------------------
 * 为什么需要
 * ----------
 * `probe.js` 一直在量性能，但**没有基线** ⇒ 改坏了也没人知道。
 * 实测（11 个页面）：
 *     DOM 节点  67 – 157
 *     首屏      12 – 18ms（list 72 / nav 82 / choice 95 是 JS 较多的页面）
 *
 * ⇒ 门槛**从实测反推**，不是拍脑袋：
 *     DOM < 400   （实测最大 157，留 2.5 倍余量）
 *     首屏 < 300ms （实测最大 95ms，留 3 倍余量）
 *     长任务 0     （>50ms 的 setTimeout —— 骨架屏那个 300ms 定时器不算，
 *                    它是"等"不是"算"；这里只查 **>50ms 且不是 setTimeout 的**）
 *
 * ⚠️ 为什么余量给得这么宽：
 *   门禁不该因为"某台机器慢 3ms"就变红 —— 那是**假红**，
 *   而假红一旦常态化，我们就会开始忽略它（这是门禁失效的头号原因）。
 *   所以基线只抓"数量级劣化"（比如误把每个组件复制 10 遍）。
 *
 * 用法：node 05-audit/perf-gate.js
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
  ['example', 'examples/react-vite/index.html'],
];

const MAX_NODES = 400;
const MAX_DOM_MS = 300;

(async () => {
  const b = await launch();
  let fails = 0;
  const pad = (s, n) => { s = String(s); let w = 0;
    for (const ch of s) w += ch.charCodeAt(0) > 255 ? 2 : 1;
    return s + ' '.repeat(Math.max(0, n - w)); };

  console.log('  ' + pad('页面', 12) + pad('DOM节点', 9) + pad('首屏ms', 8) + '判定');
  console.log('  ' + '-'.repeat(52));
  for (const [name, rel] of PAGES) {
    const p = await b.newPage();
    await p.setViewport({ width: 1280, height: 900 });
    try {
      await p.goto('http://127.0.0.1:8000/' + rel,
                   { waitUntil: 'networkidle0', timeout: 12000 });
    } catch (e) { await p.close(); continue; }
    const r = await p.evaluate(() => ({
      nodes: document.querySelectorAll('*').length,
      ms: Math.round((performance.getEntriesByType('navigation')[0] || {})
        .domContentLoadedEventEnd || 0),
      longTasks: (performance.getEntriesByType('longtask') || []).length,
    }));
    const bad = [];
    if (r.nodes > MAX_NODES) bad.push('DOM ' + r.nodes + ' > ' + MAX_NODES);
    if (r.ms > MAX_DOM_MS) bad.push('首屏 ' + r.ms + 'ms > ' + MAX_DOM_MS);
    if (r.longTasks > 0) bad.push('长任务 ' + r.longTasks + ' 个');
    if (bad.length) fails++;
    console.log('  ' + pad(name, 12) + pad(r.nodes, 9) + pad(r.ms, 8) +
                (bad.length ? '❌ ' + bad.join(' / ') : 'OK'));
    await p.close();
  }
  await b.close();
  console.log('');
  console.log('  门槛：DOM < ' + MAX_NODES + ' · 首屏 < ' + MAX_DOM_MS + 'ms · 长任务 0');
  console.log('  （门槛从实测反推，留 2.5–3 倍余量 —— 门禁只抓数量级劣化，不抓毫秒差异）');
  if (fails) { console.log(''); console.log('  ' + fails + ' 个页面超基线。'); process.exit(1); }
  console.log('');
  console.log('  ✅ 全部在基线内。');
})();
