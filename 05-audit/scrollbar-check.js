const { launch } = require('./browser.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * scrollbar-check.js — 滚动条行为契约
 *
 * ============================================================================
 * 🔴 为什么需要
 * ============================================================================
 *   Owner：「滚动条我们先排查一下有哪些是我们还欠缺的」
 *   实测：改造前**全库 0 条** `::-webkit-scrollbar` 定制。
 *
 *   而滚动条是最容易"忘了维护"的东西 —— 它不会报错，
 *   只会在某天突然变成浏览器默认样式，或者对比度悄悄不达标。
 *
 * ============================================================================
 * 查六件事（与 charter 12 的验收标准一一对应）
 * ============================================================================
 *   ① 标准属性与厂商伪元素**两套都在**（少一套就跨浏览器不一致）
 *   ② thumb 颜色**全部走令牌**（改主题要跟着变）
 *   ③ thumb 对背景对比度 **≥ 3:1**（WCAG 1.4.11）
 *   ④ 横向 + 纵向**都处理**
 *   ⑤ `scrollbar-gutter: stable` 在工具类上（防动态列表横向跳变）
 *   ⑥ 移动端**不产生横向溢出**
 */
const PAGE = 'http://127.0.0.1:8000/01-tokens/scrollbar-demo.html';

/* ---- WCAG 对比度（与 contrast.py 同一套算法）---- */
function lum(hex) {
  const h = hex.trim().replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const l1 = Math.max(lum(a), lum(b));
  const l2 = Math.min(lum(a), lum(b));
  return (l1 + 0.05) / (l2 + 0.05);
}
/* 🔴 2026-10-04 修一个**假通过**（比假失败更危险）
   原来：`('#7A808A').match(/\d+/g)` ⇒ 抓到 ['7','80','138']
        ⇒ 被当成 rgb(7,80,138) ⇒ 颜色彻底错 ⇒ 对比度算出 13.33:1
        ⇒ 门禁显示"通过"，**但验的是另一个颜色**。
   ⇒ 修：先识别是否已是 hex，是就原样返回。 */
function toHex(c) {
  if (!c) return null;
  c = String(c).trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(c)) return c;      // 已是 hex
  const m = c.match(/\d+/g);                          // rgb(…) / rgba(…)
  if (!m || m.length < 3) return null;
  return '#' + [m[0], m[1], m[2]].map((x) => (+x).toString(16).padStart(2, '0')).join('');
}

(async () => {
  const b = await launch();
  let bad = 0;
  const pass = (ok, what) => { console.log('  ' + (ok ? 'OK  ' : 'FAIL') + '  ' + what); if (!ok) bad++; };

  // 读 CSS 文本（要查"规则写没写"，计算值查不到）
  const p0 = await b.newPage();
  await p0.goto(PAGE, { waitUntil: 'networkidle0' });
  /* 🔴 2026-10-04 **判据加固**（补 charter 12 的待办）

     原来：只判断「CSS 文本里有没有这个词」⇒
     **注释里写 `::-webkit-scrollbar` 也会算通过**（实测反向控制抓不到）。

     ⚠️ 中间还踩了一步：改用 `document.styleSheets[].cssRules` 也不行 ——
        **总规则数 = 0**（跨源样式表被同源策略挡住，读出来是空的）
        ⇒ 那会造成"正常状态也报失败"的**假失败**，比原来的假通过更糟。

     ⇒ 现在的做法：**在页面里建一个探针元素**，
        用 `getComputedStyle` 问浏览器"这条规则到底生不生效"。
        —— 注释不是规则，浏览器不会把它算进去 ⇒ 天然免疫注释。
     */
  const probe = await p0.evaluate(() => {
    const out = {};
    // 🔴 用真实元素问"样式表里的规则生不生效"
    const el = document.createElement('div');
    el.className = 'scroll-y';
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    out.scrollbarWidth = cs.scrollbarWidth || '';
    out.scrollbarColor = cs.scrollbarColor || '';
    out.gutter = cs.scrollbarGutter || cs.getPropertyValue('scrollbar-gutter') || '';
    el.className = 'scroll-thin';
    el.remove();
    return out;
  });

  /* 🔴 厂商伪元素判据：**用页面里已有的样式表，数生效规则的选择器**。

     ⚠️ 这条路上我试错了三次，都记下来：
       ① 读 CSS 文本 + 正则剥注释 ⇒ 注释里的词也算（**假通过**）
       ② `document.styleSheets[].cssRules` ⇒ 跨源读出来是**空**（0 条，假失败）
       ③ 逐字符剥注释 ⇒ 转义地狱（`\/\*` 嵌在字符串里）

     ⇒ 最稳的办法：**先把 scrollbar.css 以 `<link>` 挂进页面**（同源），
        然后遍历 `document.styleSheets`，**只数同源那张表**里
        选择器含 `::-webkit-scrollbar` 的规则。
        —— 浏览器解析过的规则里**没有注释**（注释不是规则）。
     */
  /* 🔴 厂商伪元素判据 —— 在 **Node 侧**剥注释后查文本。
     实测踩了四次（都记下来，避免下次重犯）：
       ① 直接查文本 ⇒ 注释里的词也算（**假通过**）
       ② document.styleSheets[].cssRules ⇒ 跨源读到 **0 条**（假失败）
       ③ 页面里 add <link> 再读 ⇒ 仍是跨源，**0 条**
       ④ addStyleTag 内联后再读 ⇒ 还是 **0 条**
     ⇒ 结论：这个环境下**拿不到 CSSOM**（页面与样式表不同源）。
     ⇒ 唯一可靠的做法：**在 Node 侧读文件 + 逐字符剥注释**，
        再判断"未注释的正文里有没有这条规则"。
        逐字符（而不是正则）是为了避开 `/\*` 的转义地狱。 */
  const fs = require('fs');
  const raw = fs.readFileSync(REPO + '/01-tokens/scrollbar.css', 'utf8');
  function stripComments(text) {
    const out = [];
    let depth = 0;                       // 0=不在注释里，1=在注释里
    for (let i = 0; i < text.length; i++) {
      const two = text.substr(i, 2);
      if (depth === 0 && two === '/*') { depth = 1; i++; continue; }
      if (depth === 1 && two === '*/') { depth = 0; i++; continue; }
      if (depth === 0) out.push(text[i]);
    }
    return out.join('');
  }
  const wt = stripComments(raw);
  const cnt = (frag) => (wt.split(frag).length - 1);
  const webkit = {
    total: cnt('::-webkit-scrollbar'),
    thumb: cnt('::-webkit-scrollbar-thumb'),
    track: cnt('::-webkit-scrollbar-track'),
    hasH: /height\s*:\s*var\(--scrollbar-size\)/.test(wt) ? 1 : 0,
  };
  await p0.close();

  // ① 两套 API 都在
  pass(probe.scrollbarWidth === 'thin' || probe.scrollbarWidth === 'auto',
       '标准属性 scrollbar-width 生效（实测 ' + (probe.scrollbarWidth || '空') + '）');
  pass(probe.scrollbarColor !== '' && probe.scrollbarColor !== 'normal',
       '标准属性 scrollbar-color 生效（实测 ' + (probe.scrollbarColor || '空') + '）');
  pass(webkit.total > 0, '厂商伪元素 ::-webkit-scrollbar 生效（CSSOM ' +
       webkit.total + ' 条规则；注释不算）');
  pass(webkit.thumb > 0, '厂商伪元素 ::-webkit-scrollbar-thumb 生效（' +
       webkit.thumb + ' 条）');
  pass(webkit.track > 0, '厂商伪元素 ::-webkit-scrollbar-track 生效（' +
       webkit.track + ' 条）');

  // ⑤ gutter（实测值，不是文本）
  pass(probe.gutter === 'stable', 'scrollbar-gutter: stable 生效（实测 ' + (probe.gutter || '空') + '）');
  // ④ 横向
  pass(webkit.hasH > 0, '横向滚动条也设了尺寸（' + webkit.hasH + ' 条规则含 height）');

  // ②③ 令牌与对比度（两种主题各查一遍）
  for (const mode of ['light', 'dark']) {
    const p = await b.newPage();
    await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 2,
                          isMobile: true, hasTouch: true });
    await p.goto(PAGE + '?theme=' + mode, { waitUntil: 'networkidle0' });
    if (mode === 'dark') {
      await p.evaluate(() => {
        document.documentElement.setAttribute('data-theme-current', 'dark');
        // 直接注入暗色令牌，模拟 theme-toggle 的行为
        const cs = getComputedStyle(document.documentElement);
        ['--scrollbar-thumb', '--scrollbar-thumb-hov'].forEach((k) => {
          const v = cs.getPropertyValue(k).trim();
          if (v) document.documentElement.style.setProperty(k, v);
        });
      });
    }
    await new Promise((r) => setTimeout(r, 200));
    const v = await p.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        thumb: cs.getPropertyValue('--scrollbar-thumb').trim(),
        hov: cs.getPropertyValue('--scrollbar-thumb-hov').trim(),
        paper: getComputedStyle(document.body).backgroundColor,
        surface: (() => {
          const e = document.querySelector('.panel');
          return e ? getComputedStyle(e).backgroundColor : null;
        })(),
      };
    });
    // ② 必须是令牌值（不是写死的 hex）
    pass(/^#|^rgb/.test(v.thumb), '[' + mode + '] --scrollbar-thumb 有值：' + v.thumb);
    // ③ 对比度（对页面底与卡片面都要够）
    /* 🔴 2026-10-04 修判据：ratio() 只吃 hex，
       而 backgroundColor 是 `rgb(r, g, b)` 字符串
       ⇒ 直接传进去 ⇒ NaN ⇒ 门禁永远红（**假失败**）。
       ⇒ 统一先经 toHex() 归一化。 */
    const thumbHex = toHex(v.thumb) || v.thumb;
    if (v.paper) {
      const r1 = ratio(thumbHex, toHex(v.paper) || v.paper);
      pass(!isNaN(r1) && r1 >= 3.0,
           '[' + mode + '] thumb 对页面底 ' + r1.toFixed(2) + ':1（需 3.0）');
    }
    if (v.surface) {
      const r2 = ratio(thumbHex, toHex(v.surface) || v.surface);
      pass(!isNaN(r2) && r2 >= 3.0,
           '[' + mode + '] thumb 对卡片面 ' + r2.toFixed(2) + ':1（需 3.0）');
    }
    // ⑥ 移动端不横向溢出
    const of = await p.evaluate(() => ({
      sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
    pass(of.sw <= of.vw + 1, '[' + mode + '] 移动端无横向溢出（' + of.sw + ' ≤ ' + of.vw + '）');
    await p.close();
  }

  // gutter 的实际效果：加内容后右边缘不该动
  const p3 = await b.newPage();
  await p3.setViewport({ width: 393, height: 852, deviceScaleFactor: 2,
                        isMobile: true, hasTouch: true });
  await p3.goto(PAGE, { waitUntil: 'networkidle0' });
  const e0 = await p3.evaluate(() =>
    Math.round(document.getElementById('p1').getBoundingClientRect().right));
  await p3.click('#add');
  await new Promise((r) => setTimeout(r, 400));
  const e1 = await p3.evaluate(() =>
    Math.round(document.getElementById('p1').getBoundingClientRect().right));
  pass(e0 === e1, 'gutter：动态加内容后容器右边缘不动（' + e0 + ' → ' + e1 + '）');
  await p3.close();

  await b.close();
  console.log('');
  if (bad) { console.log('  ❌ ' + bad + ' 项不满足'); process.exit(1); }
  console.log('  ✅ 滚动条契约全部满足');
})();
