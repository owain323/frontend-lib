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

/* 量一次：新开页 → 等到 networkidle0 → 读 navigation timing。
   ⚠️ 每次都要**新开页面**：同一个 page 连续 goto，第二次的
   `domContentLoadedEventEnd` 会受上一页的 bfcache / 缓存预热影响。 */
async function measure(b, rel) {
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  let resp;
  try {
    resp = await p.goto('http://127.0.0.1:8000/' + rel,
                        { waitUntil: 'networkidle0', timeout: 12000 });
  } catch (e) {
    await p.close();
    return null;                       // 网络错误 / 超时
  }
  /* 🔴 `goto` **不会**因为 404 抛错 —— HTTP 状态码不是 JS 异常。
     只 catch 的话，"路径写错"会被当成一个 3ms 的空白页，判 OK。
     （这条是写完判据后拿一个不存在的路径去破坏时当场发现的：
       插了一条 NOPE.html，门禁照样报"全部在基线内"。） */
  if (!resp || resp.status() < 200 || resp.status() >= 400) {
    const st = resp ? resp.status() : '无响应';
    await p.close();
    return { httpError: st };
  }
  const r = await p.evaluate(() => ({
    nodes: document.querySelectorAll('*').length,
    ms: Math.round((performance.getEntriesByType('navigation')[0] || {})
      .domContentLoadedEventEnd || 0),
    longTasks: (performance.getEntriesByType('longtask') || []).length,
  }));
  await p.close();
  return r;
}

(async () => {
  const b = await launch();
  let fails = 0;
  const pad = (s, n) => { s = String(s); let w = 0;
    for (const ch of s) w += ch.charCodeAt(0) > 255 ? 2 : 1;
    return s + ' '.repeat(Math.max(0, n - w)); };

  console.log('  ' + pad('页面', 12) + pad('DOM节点', 9) + pad('首屏ms', 8) + '判定');
  console.log('  ' + '-'.repeat(52));
  for (const [name, rel] of PAGES) {
    let r = await measure(b, rel);
    /* 🔴 加载失败**必须判失败**，不许 `continue` 跳过 ——
       原实现是 `catch { await p.close(); continue; }`，于是"页面打不开"
       在报告里既不算通过也不算失败，直接消失。那是最难发现的一类假绿：
       清单里少一行，没人会数。（与 E193「零值上全绿」同族。） */
    if (r === null || r.httpError) {
      fails++;
      console.log('  ' + pad(name, 12) + pad('-', 9) + pad('-', 8) +
                  '❌ 打不开（' + (r === null ? '网络错误或 12s 超时' : 'HTTP ' + r.httpError) + '）');
      continue;
    }

    /* 🔴 首屏只在**超阈值时**补测两次，取三次的中位数。
       起因（2026-10-31 实测）：全量门禁夜里跑时 form-validation 报 303ms，
       而同一台机器连测三次是 121 / 125 / 124ms —— 门槛 300ms、稳态 125ms，
       余量 2.4 倍，却被一次调度抖动顶红。
       ⚠️ 这不是"放宽门槛"：中位数拿掉的只是**单次离群**，
          真回归会让三次全超（中位数照样红）；门槛与余量一个字没动。
       ⚠️ 也**没有**改成"重试到通过就绿" —— 那才是放水。 */
    let samples = [r.ms];
    if (r.ms > MAX_DOM_MS) {
      for (let k = 0; k < 2; k++) {
        const again = await measure(b, rel);
        if (again) samples.push(again.ms);
      }
      samples.sort((a, c) => a - c);
      r.ms = samples[Math.floor(samples.length / 2)];
    }

    const bad = [];
    if (r.nodes > MAX_NODES) bad.push('DOM ' + r.nodes + ' > ' + MAX_NODES);
    if (r.ms > MAX_DOM_MS) {
      bad.push('首屏 ' + r.ms + 'ms > ' + MAX_DOM_MS +
               (samples.length > 1 ? '（' + samples.join('/') + ' 中位数）' : ''));
    }
    if (r.longTasks > 0) bad.push('长任务 ' + r.longTasks + ' 个');
    if (bad.length) fails++;
    console.log('  ' + pad(name, 12) + pad(r.nodes, 9) +
                pad(r.ms + (samples.length > 1 ? '*' : ''), 8) +
                (bad.length ? '❌ ' + bad.join(' / ') : 'OK'));
  }
  await b.close();
  console.log('');
  console.log('  门槛：DOM < ' + MAX_NODES + ' · 首屏 < ' + MAX_DOM_MS + 'ms · 长任务 0');
  console.log('  （门槛从实测反推，留 2.5–3 倍余量 —— 门禁只抓数量级劣化，不抓毫秒差异）');
  console.log('  （* = 首次超阈值，已补测两次取中位数；真回归三次都会超）');
  if (fails) { console.log(''); console.log('  ' + fails + ' 个页面超基线。'); process.exit(1); }
  console.log('');
  console.log('  ✅ 全部在基线内。');
})();
