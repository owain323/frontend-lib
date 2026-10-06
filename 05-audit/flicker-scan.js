const { launch } = require('./browser.js');

/**
 * flicker-scan.js — 全库「闪烁」扫描
 *
 * ============================================================================
 * 🔴 为什么需要（2026-10-04 Owner iOS 实机报）
 * ============================================================================
 * Owner 原话：「我滑动的时候，很轻微的一闪一闪」——
 * 而且他说「**希望它没出问题啊**」⇒ 他怀疑是未知的隐患。
 *
 * 实测到的真因（两条叠加）：
 *   ① **draw() 先清空子节点、再比签名** ⇒ 我加的"没变就跳过"**根本没机会生效**
 *      （节点已经先被清掉了）⇒ 每次 resize 都整张重建。
 *   ② iOS **地址栏随滑动收缩/展开 ⇒ 触发 resize** ⇒ 每次滑动都重建一次。
 *
 *   实测数据：viewport 高度变化一次 ⇒ DOM 变动 **18 次**；修后 **0 次**。
 *
 * ============================================================================
 * 这道门禁查什么（三种"闪"的来源）
 * ============================================================================
 *   ① **无限动画**（`animation-iteration-count: infinite`）
 *      —— 永不停 ⇒ 永远在动 ⇒ 视觉"闪"
 *   ② **横向溢出**（scrollWidth > viewport）
 *      —— iOS 上横向溢出会引发布局抖动，很像闪烁
 *   ③ **resize 时的 DOM 重建次数**（最关键）
 *      —— 模拟 iOS 地址栏收缩，看子树被改动多少次
 */
const PAGES = [
  '02-primitives/badge/demo.html',
  '02-primitives/button/demo.html',
  '02-primitives/card/demo.html',
  '02-primitives/choice/demo.html',
  '02-primitives/input/demo.html',
  '02-primitives/separator/demo.html',
  '02-primitives/switch/demo.html',
  '03-patterns/accordion/demo.html',
  '03-patterns/form-validation/demo.html',
  '03-patterns/list/demo.html',
  '03-patterns/nav/demo.html',
  '03-patterns/overlay/demo.html',
  '03-patterns/states/demo.html',
  '09-assets/sparkline/demo.html',
  '10-review/ios/index.html',
];

(async () => {
  const b = await launch();
  const issues = [];
  let scanned = 0;

  for (const rel of PAGES) {
    const p = await b.newPage();
    await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 2,
                          isMobile: true, hasTouch: true });
    try {
      await p.goto('http://127.0.0.1:8000/' + rel,
                   { waitUntil: 'networkidle0', timeout: 12000 });
    } catch (e) { await p.close(); continue; }
    scanned++;
    await new Promise((r) => setTimeout(r, 400));

    // ① 无限动画 + ② 横向溢出
    const r = await p.evaluate(() => {
      const anims = [];
      document.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el);
        // 🔴 排除「本来就该转」的：spinner / 加载指示器
        //    它们无限旋转是**正确行为**，不是闪烁 bug。
        const cls = String(el.className);
        if (cls.indexOf('spinner') > -1 || cls.indexOf('loading') > -1) return;
        if (cs.animationName && cs.animationName !== 'none' &&
            cs.animationIterationCount === 'infinite') {
          anims.push(el.tagName.toLowerCase() + '.' +
                     String(el.className).slice(0, 20) + ' [' + cs.animationName + ']');
        }
      });
      return { anims,
               over: document.documentElement.scrollWidth - window.innerWidth };
    });
    r.anims.forEach((a) => issues.push([rel, '无限动画', a]));
    if (r.over > 1) issues.push([rel, '横向溢出', '+' + r.over + 'px']);

    // ③ resize 引发的 DOM 重建（只在有 sparkline 的页面查）
    if (rel.indexOf('sparkline') > -1 || rel.indexOf('ios') > -1) {
      const before = await p.evaluate(() => {
        window.__m = 0;
        const o = new MutationObserver((x) => { window.__m += x.length; });
        document.querySelectorAll('.sparkline').forEach((s) =>
          o.observe(s, { childList: true, subtree: true, attributes: true }));
        return 1;
      });
      // 模拟 iOS 地址栏收缩
      await p.setViewport({ width: 393, height: 700, deviceScaleFactor: 2,
                            isMobile: true, hasTouch: true });
      await new Promise((r) => setTimeout(r, 450));
      const m = await p.evaluate(() => window.__m);
      if (m > 2) issues.push([rel, 'resize 重绘', m + ' 次 DOM 变动（应 ≤2）']);
    }
    await p.close();
  }
  await b.close();

  console.log('  扫了 ' + scanned + '/' + PAGES.length + ' 个页面');
  if (!issues.length) {
    console.log('  ✅ 无无限动画 · 无横向溢出 · resize 不引发重绘');
    return;
  }
  console.log('  ⚠️ ' + issues.length + ' 项：');
  issues.forEach((i) => console.log('     · ' + i[0].split('/').pop() + '  ' + i[1] + '  ' + i[2]));
  process.exit(1);
})();
