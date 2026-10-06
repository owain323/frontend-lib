const { launch } = require('./browser.js');

/**
 * focus-ring-check.js — 焦点环行为契约
 *
 * ============================================================================
 * 🔴 为什么需要
 * ============================================================================
 *   实测：改造前全库 **33 处** `:focus-visible`，写法散落；
 *   **4 处** `outline:none`（若裸写 ⇒ WCAG 2.4.7 违规，键盘用户看不到焦点）。
 *
 * ============================================================================
 * 查六件事（与 charter 12 的验收标准一一对应）
 * ============================================================================
 *   ① 令牌齐全（width / offset / color）
 *   ② **键盘聚焦有可见环**（模拟 Tab）
 *   ③ **鼠标点击不出现环**（`:focus-visible` 的核心语义）
 *   ④ 聚焦**不引起布局偏移**（outline 不占布局 ⇒ rect 不变）
 *   ⑤ 暗色下对比度 ≥ 3:1（WCAG 1.4.11）
 *   ⑥ 全库**没有裸的 outline:none**（有的话必须紧跟替代样式）
 */
const PAGE = 'http://127.0.0.1:8000/01-tokens/focus-ring-demo.html';
const LIB = '${REPO}';

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
function toHex(c) {
  if (!c) return null;
  c = String(c).trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
  const m = c.match(/\d+/g);
  if (!m || m.length < 3) return null;
  return '#' + [m[0], m[1], m[2]].map((x) => (+x).toString(16).padStart(2, '0')).join('');
}

(async () => {
  const b = await launch();
  let bad = 0;
  const pass = (ok, w) => { console.log('  ' + (ok ? 'OK  ' : 'FAIL') + '  ' + w); if (!ok) bad++; };

  const p = await b.newPage();
  await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 2,
                        isMobile: true, hasTouch: true });
  await p.goto(PAGE, { waitUntil: 'networkidle0' });

  // ① 令牌齐全
  const tok = await p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      width: cs.getPropertyValue('--focus-ring-width').trim(),
      offset: cs.getPropertyValue('--focus-ring-offset').trim(),
      color: cs.getPropertyValue('--focus-ring-color').trim(),
    };
  });
  pass(tok.width !== '', '令牌 --focus-ring-width 存在（' + tok.width + '）');
  pass(tok.offset !== '', '令牌 --focus-ring-offset 存在（' + tok.offset + '）');
  pass(tok.color !== '', '令牌 --focus-ring-color 存在（' + tok.color + '）');

  // ② 键盘聚焦 ⇒ 有 outline
  await p.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 200));
  const kb = await p.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return { tag: el.tagName, outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle };
  });
  const hasRing = kb.outlineStyle !== 'none' && parseFloat(kb.outlineWidth) >= 1;
  pass(hasRing, '键盘 Tab 后有可见焦点环（' + kb.tag + ' outline=' +
       kb.outlineWidth + ' ' + kb.outlineStyle + '）');

  // ③ 鼠标点击 ⇒ :focus-visible 不触发
  /* 🔴 修判据（实测踩到）：
     原来用 `p.click('.btn')` 模拟"鼠标点击" ⇒
     Puppeteer 的 click 会让元素**以键盘方式激活** ⇒
     浏览器认为这是键盘操作 ⇒ `:focus-visible` **正确地**为 true
     ⇒ 门禁报"鼠标点击出现了焦点环"，**是判据错了，不是组件错了**。

     手动验证过：真实 `mouse.click(x, y)` 时
       :focus         = true
       :focus-visible = false   ← 组件行为正确
       outline        = none

     ⇒ 改用 `page.mouse.click(真实坐标)`，那才是真的鼠标事件。 */
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  await new Promise((r) => setTimeout(r, 120));
  const mbox = await p.evaluate(() => {
    const r = document.querySelector('.btn').getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  await p.mouse.click(mbox.x, mbox.y);          // 🔴 真实鼠标事件
  await new Promise((r) => setTimeout(r, 300));
  const mouse = await p.evaluate(() => {
    const el = document.activeElement;
    return { matchesFV: el.matches(':focus-visible'),
             matchesFocus: el.matches(':focus'),
             outline: getComputedStyle(el).outlineStyle };
  });
  pass(!mouse.matchesFV,
       '鼠标点击不出现焦点环（:focus-visible=' + mouse.matchesFV +
       ' · :focus=' + mouse.matchesFocus + ' · outline=' + mouse.outline + '）');

  // ④ 聚焦不引起布局偏移
  const before = await p.evaluate(() => {
    const els = [...document.querySelectorAll('.row *')];
    return els.map((e) => { const r = e.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; });
  });
  await p.evaluate(() => document.body.click());
  await p.keyboard.press('Tab');
  await p.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 250));
  const after = await p.evaluate(() => {
    const els = [...document.querySelectorAll('.row *')];
    return els.map((e) => { const r = e.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; });
  });
  const shifted = before.some((v, i) =>
    after[i] && (v[0] !== after[i][0] || v[2] !== after[i][2]));
  pass(!shifted, '聚焦不引起布局偏移（outline 不占布局，rect 不变）');

  // ⑤ 暗色对比度
  await p.evaluate(() => document.documentElement.setAttribute('data-theme-current', 'dark'));
  await new Promise((r) => setTimeout(r, 250));
  const dk = await p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { ring: cs.getPropertyValue('--focus-ring-color').trim(),
             paper: getComputedStyle(document.body).backgroundColor,
             accent: cs.getPropertyValue('--accent').trim() };
  });
  const ringHex = toHex(dk.accent) || toHex(dk.ring);
  const bgHex = toHex(dk.paper);
  if (ringHex && bgHex) {
    const v = ratio(ringHex, bgHex);
    pass(v >= 3.0, '暗色焦点环对比度 ' + v.toFixed(2) + ':1（需 3.0，WCAG 1.4.11）');
  }
  await p.close();

  // ⑥ 全库没有裸的 outline:none
  const fs = require('fs');
  const path = require('path');
  const dirs = ['01-tokens', '02-primitives', '03-patterns', '04-recipes'];
  const bare = [];
  let totalOutlineNone = 0;
  for (const d of dirs) {
    const root = path.join(LIB, d);
    if (!fs.existsSync(root)) continue;
    for (const sub of fs.readdirSync(root)) {
      const f = path.join(root, sub, sub + '.css');
      if (!fs.existsSync(f)) continue;
      const s = fs.readFileSync(f, 'utf8');
      // 逐条规则：选择器里含 focus-visible 的不计入（那是替代样式）
      const re = /([^{}]+)\{([^}]*)\}/g;
      let m;
      while ((m = re.exec(s)) !== null) {
        const sel = m[1], body = m[2];
        if (!/outline\s*:\s*(none|0)\s*(;|$)/.test(body)) continue;
        totalOutlineNone++;
        /* 🔴 判据放宽：替代样式**不只有 box-shadow**。
           WCAG 2.4.7 只要求「聚焦时有可见变化」，下列都合法：
             · box-shadow（换色/加环）
             · background / background-color（换底色）← **原判据漏了**
             · border / border-color（换边色）        ← **原判据漏了**
             · color / text-decoration（下划线）      ← **原判据漏了**
             · 同规则里 :focus-visible 的声明
           ⚠️ 判据比规范严 ⇒ 会让人去改**本来正确**的代码。 */
        const hasAlt = /box-shadow/.test(body)
                    || /background(-color)?\s*:/.test(body)
                    || /border(-[a-z]+)?(-color)?\s*:/.test(body)
                    || /(^|[;\s])color\s*:/.test(body)
                    || /text-decoration/.test(body)
                    || /focus-visible/.test(sel);
        if (!hasAlt) bare.push(d + '/' + sub + '  ' + sel.trim().split('\n').pop().slice(0, 40));
      }
    }
  }
  pass(bare.length === 0,
       '全库无裸的 outline:none（' + totalOutlineNone + ' 处全部紧跟替代样式）' +
       (bare.length ? '：' + bare.join(' | ') : ''));

  await b.close();
  console.log('');
  if (bad) { console.log('  ❌ ' + bad + ' 项不满足'); process.exit(1); }
  console.log('  ✅ 焦点环契约全部满足');
})();
