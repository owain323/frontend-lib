/**
 * multi-browser-check.js — 多浏览器内核门禁（ H3）
 * ============================================================================
 * 🔴 为什么需要它
 * ---------------------------------------------------------------------------
 *   之前所有门禁只跑 **Chromium**。这漏掉了一整类问题：
 *     · `-webkit-` 前缀差异（Safari/iOS WebView）
 *     · Firefox 的 **flex 最小尺寸**默认行为（`min-width:auto` 导致不换行）
 *     · **滚动条宽度**（Firefox 经典 scrollbar 占位，Chromium 不占）
 *     · `:focus-visible` / `::backdrop` / 表单控件默认样式差异
 *   ⇒ 这些在真实用户设备上会出现，但我们的门禁完全看不到。
 *
 * ============================================================================
 * ⭐ 为什么用 Playwright 而不是 Puppeteer 的 Firefox
 * ---------------------------------------------------------------------------
 *   Puppeteer 的 Firefox 走的是 **Juggler**（它自己的补丁版 Firefox），
 *   **不是真 Firefox**，行为与用户实际用的有差异。
 *   Playwright 用的是 **Mozilla 官方构建** ⇒ 测出来的才作数。
 *   ⚠️ 两者的 Chromium 也不要混用，本门禁**只加 Firefox**，
 *      Chromium 仍由既有的 34 个契约负责（不重复跑，省时间）。
 *
 * ============================================================================
 * 测什么（只测"换内核就可能坏"的四类）
 * ---------------------------------------------------------------------------
 *   ① 横向溢出（Firefox 的 flex/表格布局更容易撑破）
 *   ② 交互可用性：按钮能否点、能否聚焦、能否用键盘触发
 *   ③ **CSS 特性支持**：用了 Firefox 不支持的属性会静默失效
 *   ④ 控制台无报错
 *
 * ============================================================================
 * ⚠️ 资源纪律（本机 16GB，已用 83%，有硬崩史）
 * ---------------------------------------------------------------------------
 *   **单实例、串行、跑完就关** —— 绝不开第二个浏览器。
 *   这是 M-0 白名单铁律要求的：宁可慢，也不能让机器假死。
 * ============================================================================
 */
const path = require('path');

/* 🔴 Node 的 console.log **不支持** `%-12s` 这种 printf 宽度修饰符
 * （要用 padStart/padEnd）—— 我在这项目上踩过两次，输出会变成一片 NaN。 */
const pad = (x, n) => String(x).padEnd(n);

/* playwright 装在受管 workspace 里，不在本库 */
const PW = require(process.env.PW_PATH ||
  path.join(process.env.USERPROFILE || '', '.toolchain', 'binaries', 'node',
            'workspace', 'node_modules', 'playwright'));

/* 只测这几页：布局敏感 + 有交互的组件 */
const PAGES = [
  ['02-primitives/button', '按钮'],
  ['02-primitives/select', '下拉选择'],
  ['02-primitives/date-range', '日期区间'],
  ['03-patterns/list', '列表'],
  ['03-patterns/nav', '导航'],
  ['03-patterns/table', '表格'],
  ['04-recipes/table', '表格 recipe'],
  ['10-review/composition', '组合页'],
];

/** 在页面里执行：抓"换内核就坏"的四类 */
const SCAN = function () {
  const out = { overflow: null, deadButtons: [], unsupported: [] };

  /* ① 横向溢出 */
  const de = document.documentElement;
  out.overflow = { sw: de.scrollWidth, cw: de.clientWidth };

  /* ② 交互可用性：可见按钮必须有足够命中区且不是 pointer-events:none */
  for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.bottom < 0 || r.top > innerHeight * 3) continue;
    /* 🔴 2026-10-06 修正判据（原来报了一个**误报**）：
       `pointer-events:none` 在下面两种状态是**完全正确**的：
         ① `disabled` 按钮        —— 本来就不该点
         ② `[aria-busy="true"]`  —— loading 态，**防重复提交**
            （实测按钮 demo 的「提交」就是这种：它带 aria-busy，
              于是 button.css 的 `.btn[aria-busy="true"]{pointer-events:none}`
              生效 —— 这**恰好证明 loading 态是有效的**）
       ⇒ 判据必须先排除这两种，否则会把"正确实现"报成"点不着"。 */
    const isDisabled = el.disabled === true ||
                       el.getAttribute('aria-disabled') === 'true';
    const isBusy = el.getAttribute('aria-busy') === 'true';
    if (cs.pointerEvents === 'none' && !isDisabled && !isBusy) {
      out.deadButtons.push({
        cls: String(el.className).slice(0, 24) || el.tagName,
        why: 'pointer-events:none 且非 disabled/busy（看得见点不着）',
      });
    }
  }

  /* ③ CSS 特性支持：逐个问浏览器"你认不认这个属性" */
  /* 🔴 2026-10-06 修正：第一版问法是错的（`CSS.supports('color', p)`）
     ⇒ 把 `text-underline-offset` 这类**Firefox 其实支持**的属性误报成不支持。
     ⇒ 正确用法：`CSS.supports(属性名, 值)`。
     ⚠️ 教训与"判据比规范严"同源：**问法错了，结论就全错**。 */
  const PROPS = [
    ['backdrop-filter', 'blur(2px)'],
    ['-webkit-backdrop-filter', 'blur(2px)'],
    ['text-underline-offset', '2px'],
    ['aspect-ratio', '1/1'],
    ['inset', '0'],
    ['gap', '4px'],
    ['place-items', 'center'],
    ['accent-color', 'red'],
    ['container-type', 'inline-size'],
    ['color-mix', 'in srgb, red 50%, blue'],
    ['oklch', '0.6 0.2 250'],
  ];
  for (const [prop, val] of PROPS) {
    try {
      if (!CSS.supports(prop, val)) out.unsupported.push(prop);
    } catch (e) { /* 老浏览器没有 CSS.supports ⇒ 跳过 */ }
  }
  return out;
};

(async () => {
  let browser;
  try {
    browser = await PW.firefox.launch({ headless: true });
  } catch (e) {
    console.log('  SKIP  Firefox 启动失败：' + String(e).slice(0, 90));
    console.log('        （若提示找不到浏览器，先跑：npx playwright install firefox）');
    process.exit(0);
  }

  console.log('  === 多浏览器（ H3 · Firefox ' + browser.version() +
    ' · 官方构建，非 Juggler）===');

  let fails = 0;
  let checks = 0;
  const allUnsupported = new Set();

  for (const [dir, label] of PAGES) {
    /* ⚠️ 串行：一次只开一个页面，用完即关 */
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 60)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 60)); });

    try {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto('http://127.0.0.1:8000/' + dir + '/demo.html',
                      { waitUntil: 'networkidle0', timeout: 20000 });
      await page.waitForTimeout(400);
      const r = await page.evaluate(SCAN);
      checks++;

      if (r.overflow.sw > r.overflow.cw + 1) {
        fails++;
        console.log('  FAIL  ' + pad(label) + ' 横向溢出 ' +
          r.overflow.sw + ' > ' + r.overflow.cw);
      } else if (r.deadButtons.length) {
        fails++;
        console.log('  FAIL  ' + pad(label) + r.deadButtons.length +
          ' 个元素 pointer-events:none ⇒ ' + r.deadButtons[0].cls);
      } else if (errs.length) {
        fails++;
        console.log('  FAIL  ' + pad(label) + '控制台报错：' + errs[0]);
      } else {
        r.unsupported.forEach((p) => allUnsupported.add(p));
        console.log('  OK    ' + pad(label) + '无溢出 / 交互正常 / 控制台干净');
      }
    } catch (e) {
      fails++;
      console.log('  FAIL  ' + pad(label) + String(e).slice(0, 50));
    }
    await ctx.close();      /* 每个页面用完立刻关，别攒着 */
  }

  await browser.close();    /* ⭐ 跑完立刻释放内存 */

  if (allUnsupported.size) {
    console.log('');
    console.log('  ⚠️ Firefox 不支持的属性（Chromium 支持）：' +
      [...allUnsupported].join(', '));
    console.log('    ⇒ 这些属性在 Firefox 上会**静默失效**，需要 @supports 兜底。');
  }

  console.log('');
  console.log('  跑了 ' + checks + ' 页，' + fails + ' 页有问题');
  if (fails) {
    console.log('  ⇒ 🔴 Chromium 全绿但 Firefox 有问题 ⇒ 这就是只测单内核的盲区');
  }
  process.exit(fails ? 1 : 0);
})();
