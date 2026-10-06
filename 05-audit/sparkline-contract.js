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
 * sparkline 的行为契约
 *
 * 🔴 这个文件是被一个**真实的 bug** 逼出来的：
 *   第一次跑时，9 个 sparkline **一个都没画出来**。
 *   根因：JS 里找的是 `.sparkline[data-spark]`，而 demo 里写的是 `class="spark"`。
 *   ⇒ **类名不一致 = 静默失效**，页面上什么都不显示、也不报错。
 *
 * 所以这个测试的第一条就是「**类名必须对得上**」，
 * 而且要测「**从 HTML 到 SVG 真的连上了**」——
 * 光检查属性存在是不够的。
 */
(async () => {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 1000, height: 1100, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto('http://127.0.0.1:8000/09-assets/sparkline/demo.html',
               { waitUntil: 'networkidle0' });
  await p.screenshot({ path: REPO + '/10-review/shots/sparkline.png' });

  const R = [];
  const add = (n, ok) => R.push([n, !!ok]);

  // ── 页面无报错
  add('页面无 JS 报错', errs.length === 0);
  if (errs.length) R.push(['  具体: ' + errs[0].slice(0, 60), false]);

  // ── 🔴 类名一致性（就是那个 bug）
  const names = await p.evaluate(() => {
    const all = document.querySelectorAll('.sparkline, .spark');
    return {
      sparkline: document.querySelectorAll('.sparkline').length,
      spark: document.querySelectorAll('.spark').length,   // 旧名，应该 0
      withData: document.querySelectorAll('.sparkline[data-spark]').length,
      total: all.length,
    };
  });
  add('类名统一为 .sparkline（无残留 .spark）',
      names.sparkline > 0 && names.spark === 0);
  add('每个都有 data-spark（' + names.withData + '/' + names.sparkline + '）',
      names.withData === names.sparkline);

  // ── 🔴 真的画出来了（从 HTML 到 SVG 连得上）
  const drawn = await p.evaluate(() => {
    const list = [...document.querySelectorAll('.sparkline[data-spark]')];
    const empty = list.filter((s) => !s.querySelector('svg'));
    return { total: list.length, drawn: list.length - empty.length,
             emptyData: empty.map((s) => s.getAttribute('data-spark')) };
  });
  add('🔴 全部画出来了（' + drawn.drawn + '/' + drawn.total + '）',
      drawn.drawn === drawn.total && drawn.total > 0);
  if (drawn.emptyData.length) R.push(['  未绘制: ' + drawn.emptyData[0].slice(0, 20), false]);

  // ── 🔴 无障碍：aria-hidden 且**不加** role=img
  const a11y = await p.evaluate(() => {
    const list = [...document.querySelectorAll('.sparkline svg')];
    return {
      total: list.length,
      hidden: list.filter((s) => s.getAttribute('aria-hidden') === 'true').length,
      roleImg: list.filter((s) => s.getAttribute('role') === 'img').length,
      focusable: list.filter((s) => s.getAttribute('focusable') === 'false').length,
    };
  });
  add('🔴 SVG 有 aria-hidden（' + a11y.hidden + '/' + a11y.total + '）',
      a11y.total > 0 && a11y.hidden === a11y.total);
  add('🔴 不加 role="img"（它没有可读等价物）', a11y.roleImg === 0);
  add('SVG 不可聚焦（focusable=false）',
      a11y.focusable === a11y.total);

  // ── 三种形态都真的画了东西
  const kinds = await p.evaluate(() => {
    const out = {};
    ['line', 'bar', 'area'].forEach((t) => {
      const el = document.querySelector('[data-spark-type="' + t + '"]')
              || document.querySelector('.sparkline[data-spark]');
      if (!el) return;
      const svg = el.querySelector('svg');
      out[t] = svg
        ? { paths: svg.querySelectorAll('path').length,
            rects: svg.querySelectorAll('rect').length }
        : null;
    });
    return out;
  });
  add('折线用 <path>', kinds.line && kinds.line.paths > 0);
  add('柱状用 <rect>', kinds.bar && kinds.bar.rects > 0);
  add('面积 = path + 淡填充（≥2 个 path）',
      kinds.area && kinds.area.paths >= 2);

  // ── 令牌驱动（不写死色）
  // 🔴 改判据：颜色**不再写在 stroke 属性上**
  //    （presentation attribute 里的 var() 各浏览器支持不一致，
  //     规范没保证，Safari 尤其不可靠 ⇒ 已全部改走 CSS 自定义属性）。
  //    所以查两件事：① 元素上没有写死色值 ② 计算值是令牌解析出来的
  const color = await p.evaluate(() => {
    const s = document.querySelector('.sparkline svg path[stroke-width]');
    if (!s) return null;
    return { attr: s.getAttribute('stroke'),
             varC: s.style.getPropertyValue('--spark-c'),
             computed: getComputedStyle(s).stroke };
  });
  add('🔴 颜色不写在 presentation attribute 上（避开 var() 支持差异）',
      !!color && color.attr === null);
  add('🔴 用令牌取色（--spark-c = ' + (color ? color.varC : '-') + '）',
      !!color && color.varC.indexOf('var(') === 0);
  add('🔴 计算值是解析后的颜色（' + (color ? color.computed : '-') + '，非 #hex）',
      !!color && color.computed.indexOf('var(') === -1
            && color.computed !== 'none');

  // ── 边界：全平数据不崩
  const flat = await p.evaluate(() => {
    const el = document.getElementById('upd');
    el.setAttribute('data-spark', '10,10,10,10,10');
    window.Chart.emit(el);
    const svg = el.querySelector('svg');
    if (!svg) return { drew: false };
    const path = svg.querySelector('path[stroke-width]');
    return { drew: true, d: path ? path.getAttribute('d') : '',
             hasNaN: path ? /NaN|Infinity/.test(path.getAttribute('d')) : true };
  });
  add('全平数据能画（不除零）', flat.drew);
  add('全平数据无 NaN / Infinity', flat.hasNaN === false);

  // ── 边界：点少于 2 个不画
  const one = await p.evaluate(() => {
    const el = document.getElementById('upd');
    el.setAttribute('data-spark', '5');
    window.Chart.emit(el);
    return el.querySelector('svg') === null;
  });
  add('少于 2 个点不画（画不出趋势）', one === true);

  // ── 边界：中间空项被跳过
  const gap = await p.evaluate(() => {
    const el = document.getElementById('upd');
    el.setAttribute('data-spark', '1,,3');
    window.Chart.emit(el);
    const svg = el.querySelector('svg');
    if (!svg) return null;
    const path = svg.querySelector('path[stroke-width]');
    return path ? path.getAttribute('d') : '';
  });
  add('中间空项被跳过（不产生 NaN）',
      gap !== null && gap.indexOf('NaN') === -1);

  // ── 🔴 reduced-motion：**用真实媒体模拟测计算值**，不要正则匹配 CSS 文本
  //
  // 第一版写成「在 CSS 文本里找 `animation: none`」⇒ **假失败**：
  //   浏览器会把 `animation: none` **规范化**成
  //   `animation: auto ease 0s 1 normal none running none`，
  //   正则匹配不到，但**行为完全正确**。
  //
  // 而且本组件是**两道保险**：
  //   ① JS 侧 `supportsReducedMotion()` ⇒ 直接不加 `.spark-line` 类
  //   ② CSS 侧 `@media (prefers-reduced-motion: reduce)` ⇒ 万一类被加上也关掉
  // 所以正确判据是：**模拟 reduce ⇒ .spark-line 不存在**。
  const pR = await b.newPage();
  await pR.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await pR.goto('http://127.0.0.1:8000/09-assets/sparkline/demo.html',
               { waitUntil: 'networkidle0' });
  const reduced = await pR.evaluate(() => {
    // 🔴 动画类已从 .spark-line 拆到 .spark-anim
    //    （.spark-line 现在常驻，负责 fill:none）
    const line = document.querySelector('.spark-anim');
    return {
      hasClass: !!line,
      // 保险 ②：CSS 里必须有这条规则（文本层面查，因为行为已被 ① 短路）
      hasCssRule: [...document.styleSheets].some((sh) => {
        try {
          return [...sh.cssRules].some((r) =>
            r.conditionText &&
            r.conditionText.indexOf('prefers-reduced-motion') > -1 &&
            [...r.cssRules].some((x) => /animation/.test(x.cssText)));
        } catch (e) { return false; }
      }),
      stillDrawn: document.querySelectorAll('.sparkline svg').length,
    };
  });
  await pR.close();
  add('🔴 reduce 下 JS 不加动画类（.spark-anim）', reduced.hasClass === false);
  add('reduce 下图表仍然画出来（只是不动）', reduced.stillDrawn > 0);
  add('🔴 CSS 里也有 reduced-motion 兜底规则', reduced.hasCssRule === true);

  // 对照：默认（无 reduce）必须有动画，否则上两条就没意义
  const withMotion = await p.evaluate(() => {
    const line = document.querySelector('.spark-anim');
    if (!line) return null;
    const cs = getComputedStyle(line);
    return { name: cs.animationName, dur: cs.animationDuration };
  });
  add('对照：默认下有动画（' +
      (withMotion ? withMotion.name + ' ' + withMotion.dur : '无') + '）',
      !!withMotion && withMotion.name !== 'none');

  // ── 🔴🔴 MISSING != ZERO
  //
  // 契约原文（演示项目名 ChartsPage L10 自己写的）：
  //     「MISSING != ZERO / INVALID != MISSING / 过滤必须可见」
  //
  // 本组件原来的错：`if (!isNaN(v)) out.push(v)` 把空值**直接丢弃**。
  // 后果：`"1,,3"` 变 `1,3` ⇒ 画成一条直线，看起来像"从 1 平滑升到 3"，
  //       而真相是"1，然后没数据，然后 3"。
  //       而且 `"1,0,3"`（0 是真值）与 `"1,,3"`（缺失）**在图上完全一样**。
  const miss = await p.evaluate(() => {
    const el = document.getElementById('upd');
    const segs = () => [...el.querySelectorAll('path[stroke-width]')]
      .map((x) => x.getAttribute('d'));
    const out = {};
    el.setAttribute('data-spark', '1,2,3,4,5');
    window.Chart.emit(el); out.continuous = segs().length;
    el.setAttribute('data-spark', '1,2,,4,5');
    window.Chart.emit(el); out.gap = segs();
    el.setAttribute('data-spark', '1,0,3');
    window.Chart.emit(el); out.zeroMid = segs().length;
    el.setAttribute('data-spark', ',,,,');
    window.Chart.emit(el); out.allMissing = segs().length;
    el.setAttribute('data-spark', '1,2,3,4,');
    el.setAttribute('data-spark-last', 'yes');
    window.Chart.emit(el); out.lastCircles = el.querySelectorAll('circle').length;
    el.removeAttribute('data-spark-last');
    el.setAttribute('data-spark', '1,2,3,4,5');
    window.Chart.emit(el);
    return out;
  });
  add('🔴 连续数据 = 1 段', miss.continuous === 1);
  add('🔴 中间缺失 = 2 段（**不跨空值连线**）', miss.gap.length === 2);
  // 关键：两段之间必须有**可见的横向间隔**（不是首尾相接假装连续）
  const segGap = (() => {
    const xs = miss.gap.map((d) => parseFloat(d.slice(1).split('L')[0]));
    const lastX = parseFloat(miss.gap[0].split('L').pop().split(' ')[0]);
    return xs[1] - lastX;
  })();
  add('🔴 两段之间有真实间隔（' + segGap.toFixed(0) + 'px，不是首尾相接）',
      segGap > 10);
  add('🔴 中间是 0 时仍是 1 段（0 是真值不是缺失）', miss.zeroMid === 1);
  add('🔴 全缺失不画（0 段，且不崩）', miss.allMissing === 0);
  add('🔴 末点缺失时不画 last 圆点（不假装知道末值）',
      miss.lastCircles === 0);

  // ── axe
  await p.addScriptTag({ path: AXE });
  const a = await p.evaluate(async () => {
    const res = await window.axe.run(document);
    return { v: res.violations.map((x) => x.id), p: res.passes.length };
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
  console.log(bad ? '  ' + bad + ' 项不通过' : '  ✅ sparkline 行为契约全部满足');
  process.exit(bad ? 1 : 0);
})();
