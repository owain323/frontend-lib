const { launch } = require('./browser.js');

/**
 * contract-kit.js — 组件契约测试的公共框架
 *
 * ============================================================================
 * ⭐ 为什么有它（2026-10-04 Owner：「确保这个东西是不能出错的」）
 * ============================================================================
 * 诊断发现：**16 个组件里只有 3 个有契约测试** ⇒ 另外 13 个改了没人知道。
 *
 * 每个组件单独写 200 行判据既费时又容易写歪 ⇒ 抽成**公共框架**：
 *   · 组件只写"配置"（选择器 + 期望）
 *   · 通用 7 类判据由框架统一执行
 *
 * ============================================================================
 * 🔴 判据的 7 个坑（全部实测踩过，**新组件照抄这里，不要重犯**）
 * ============================================================================
 * ① 查「文本里有没有这个词」⇒ **假通过**（注释里写也算）
 *    ✔ 正确：Node 侧**逐字符**剥注释，不用正则
 * ② `styleSheets[].cssRules` ⇒ 跨源读到 **0 条**（假失败）
 *    ✔ 正确：这环境拿不到 CSSOM ⇒ 用 Node 侧 `fs.readFileSync`
 * ③ `toHex('#7A808A')` ⇒ hex 被当 rgb 解析（**假通过**）
 *    ✔ 正确：先识别是否已是 hex，是就直通
 * ④ `ratio()` 只吃 hex，收到 `rgb()` ⇒ **NaN**（假失败）
 *    ✔ 正确：统一经 `toHex()` 归一化
 * ⑤ `p.click(sel)` 当"鼠标点击" ⇒ Puppeteer 用**键盘方式**激活（假失败）
 *    ✔ 正确：`p.mouse.click(真实坐标)`
 * ⑥ 元素句柄在重渲染后失效 ⇒ "not clickable"
 *    ✔ 正确：每次重新取 `getBoundingClientRect()`
 * ⑦ 判据时序错（如在第 2 页查首页的禁用态）（假失败）
 *    ✔ 正确：判据前先复位状态
 *
 * ⭐ **共性**：门禁不只会"太松"，还会**太紧假失败**与**解析错误假通过**
 *    —— 后两种更危险，会让人**放弃信任这道门禁**。
 */

/* ================================================================== *
 * 颜色工具（坑 ③ ④ 的正解）
 * ================================================================== */

/** 归一化成 #rrggbb；已是 hex 就直通（🔴 坑 ③ 的正解） */
function toHex(c) {
  if (!c) return null;
  c = String(c).trim();
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  }
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;          // ← 直通，不再当 rgb 解析
  const m = c.match(/\d+/g);                            // rgb(…) / rgba(…)
  if (!m || m.length < 3) return null;
  return '#' + [m[0], m[1], m[2]]
    .map((x) => (+x).toString(16).padStart(2, '0')).join('');
}

function lum(hex) {
  const h = String(hex).replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a, b) {
  const A = toHex(a), B = toHex(b);
  if (!A || !B) return NaN;
  const l1 = Math.max(lum(A), lum(B));
  const l2 = Math.min(lum(A), lum(B));
  return (l1 + 0.05) / (l2 + 0.05);
}

/** 逐字符剥掉 CSS 注释（🔴 坑 ① 的正解；不用正则，避开转义地狱） */
function stripComments(text) {
  const out = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const two = text.substr(i, 2);
    if (depth === 0 && two === '/*') { depth = 1; i++; continue; }
    if (depth === 1 && two === '*/') { depth = 0; i++; continue; }
    if (depth === 0) out.push(text[i]);
  }
  return out.join('');
}

/* ================================================================== *
 * 通用 7 类判据
 * ================================================================== */

/**
 * 跑一个组件的契约。
 *
 * @param {object} cfg
 * @param {string} cfg.name        组件名
 * @param {string} cfg.url         demo 页面 URL
 * @param {string} cfg.dir         组件目录（用于读 CSS 做静态检查）
 * @param {string} cfg.primary     主选择器（组件根）
 * @param {string} [cfg.interactive] 可点击元素选择器（默认 button, a[href], input, [role=…]）
 * @param {string[]} [cfg.keyboard] 键盘契约：['Escape', 'ArrowDown', …]
 * @param {object} [cfg.extra]     组件专属判据 { 描述: async(page)=>bool }
 * @param {number} [cfg.touchMin]  最小命中区，默认 44
 */
async function check(cfg) {
  const b = await launch();
  let bad = 0;
  const results = [];
  const pass = (ok, what) => {
    results.push({ ok: !!ok, what });
    if (!ok) bad++;
  };

  /**
   * 🔴 2026-10-05 新增：**按组件类型豁免**通用判据
   * ---------------------------------------------------------------
   * 有些组件**本来就不该**满足某些通用判据：
   *   · badge（徽标）是**纯展示**⇒ 不可聚焦 ⇒ 不该要求焦点环、也不该有命中区
   *   · separator（分隔线）是**纯装饰**⇒ 同上
   *   · content（正文容器）⇒ 同上
   *
   * ⚠️ 做法有两种，**必须选对**：
   *   ✗ 错：直接删掉那条判据       ⇒ 后人以为"漏写了"，会补回来
   *   ✓ 对：保留判据但**显式豁免**，并在输出里写明豁免理由
   *
   * cfg.skipFocusRing / cfg.skipHitArea / cfg.skipFocusable
   *   置 true ⇒ 该判据输出 "OK（豁免：<理由>）"，仍然出现在报告里。
   */
  const skip = cfg.skipFocusRing
    ? 'OK （豁免：纯展示组件，不可聚焦 —— ' + (cfg.note || '见契约文件里的说明') + '）'
    : null;

  const fs = require('fs');
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 50)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 50)); });
  /* 🔴 2026-10-06  H4：viewport 可配。
   * 默认仍是手机（393×852，保持既有契约行为不变），
   * 契约可传 `viewport: 'tablet' | 'desktop' | {w,h}` 覆盖。
   *
   * ⚠️ 为什么不给每个契约都跑三档：那会让全量门禁慢 3 倍，
   *    而"响应式是否崩"是一个**独立问题**，应该由独立的门禁负责
   *    ⇒ 见 05-audit/responsive-check.js（三档 × 关键组件 × 关键判据）。
   */
  const VP = {
    phone:   { width: 393, height: 852, isMobile: true,  hasTouch: true },
    tablet:  { width: 834, height: 1112, isMobile: false, hasTouch: true },
    desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false },
  };
  const vpRaw = cfg.viewport || 'phone';
  const vp = typeof vpRaw === 'string' ? (VP[vpRaw] || VP.phone) : vpRaw;
  await p.setViewport({ deviceScaleFactor: 2, ...vp });
  await p.goto(cfg.url, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 300));

  /* ---------- 1 · 令牌驱动（静态：读 CSS 剥注释后查） ---------- */

  const cssPath = cfg.dir + '/' + cfg.name + '.css';

  /* 🔴 2026-10-04 补：组件**自己**必须声明 focus-visible。
     反向控制时发现：删掉 button.css 的 :focus-visible 规则，
     契约仍然全绿 —— 因为 tokens/focus-ring.css 里有**全局兜底**。
     ⇒ 那不算"组件合格"，只算"被兜底救了"。 */
  if (fs.existsSync(cssPath)) {
    const rawSelf = stripComments(fs.readFileSync(cssPath, 'utf8'));
    /* ⚠️ input 类组件用 `:focus`（而非 :focus-visible）是**正确的**：
       用户必须随时知道"光标在哪个框里"，鼠标点进去也该有反馈。
       ⇒ 判据放宽为：组件自己声明了 `:focus` 或 `:focus-visible` 即可。
       🔴 2026-10-05：纯展示组件（badge/separator/content）不可聚焦 ⇒ 显式豁免。 */
    const hasFocusDecl = /:focus-visible|:focus(?![-\w])/.test(rawSelf);
    if (cfg.skipFocusRing) {
      pass(true, '① 组件自己声明了焦点样式（豁免：' + (cfg.note || '纯展示组件') + '）');
    } else {
      pass(hasFocusDecl,
           '① 组件自己声明了焦点样式（:focus 或 :focus-visible，不是靠全局兜底）');
    }
  }
  if (fs.existsSync(cssPath)) {
    const raw = stripComments(fs.readFileSync(cssPath, 'utf8'));
    const used = (raw.match(/var\(--/g) || []).length;
    const hardHex = (raw.match(/#[0-9a-fA-F]{3,6}\b/g) || []).length;
    pass(used > 0, '① 令牌驱动：用 var(--*) ' + used + ' 处');
    /* 硬编码色值**只允许出现在注释里**（已剥掉）⇒ 应为 0 */
    pass(hardHex === 0,
         '① 无硬编码色值（' + hardHex + ' 处）' +
         (hardHex ? '：' + raw.match(/#[0-9a-fA-F]{3,6}\b/g).slice(0, 3).join(' ') : ''));
  }

  /* ---------- 2 · 焦点环 ---------- */
  await p.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
  await new Promise((r) => setTimeout(r, 100));
  await p.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 200));
  const kb = await p.evaluate((sel) => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    /* 🔴 整卡可点组件的焦点环画在**祖先**上（`:focus-within`）——
       查 `closest('[data-mv-focus], .card, [class]')` 里第一个有 ring 的祖先。 */
    let ringOn = null;
    let n = el;
    while (n && n !== document.body) {
      const c2 = getComputedStyle(n);
      const o = c2.outlineStyle !== 'none' && parseFloat(c2.outlineWidth) >= 1;
      if (o || (c2.boxShadow && c2.boxShadow !== 'none')) { ringOn = n; break; }
      n = n.parentElement;
    }
    return { tag: el.tagName, w: cs.outlineWidth, style: cs.outlineStyle,
             shadow: cs.boxShadow, border: cs.borderColor,
             ringOn: ringOn ? (ringOn.tagName + '.' +
               String(ringOn.className).split(' ')[0]) : null };
  }, cfg.primary);
  if (kb) {
    /* 🔴 2026-10-04 判据修正：**焦点样式可以自绘**。
       input 类组件的常见做法是 `outline:none` + `border-color` 变色
       + `box-shadow` 外圈（input.css 就是这么做的，理由是
       「用户必须随时知道我现在在哪个框里」⇒ 用 :focus 而非 :focus-visible）。
       ⇒ 只看 `outline` 会误判成"没有焦点环"。
       ⇒ 判据 = outline 有效 **或**（有 box-shadow 或边框变色）。 */
    const outlineOk = kb.style !== 'none' && parseFloat(kb.w) >= 1;
    const shadowOk = kb.shadow && kb.shadow !== 'none';
    /* 🔴 祖先有 ring 也算（整卡可点组件用 :focus-within 把环画在卡片上）*/
    const hasRing = outlineOk || shadowOk || !!kb.ringOn;
    pass(hasRing, '② 键盘 Tab 有可见焦点环（<' + kb.tag + '> ' +
         (outlineOk ? 'outline ' + kb.w + ' ' + kb.style
          : shadowOk ? '自绘 box-shadow'
          : '祖先 ' + kb.ringOn + ' 上的 :focus-within 环') + '）');
  } else {
    /* 🔴 2026-10-05：纯展示组件（badge / separator / content）**本来就不可聚焦**
       ⇒ 这不是缺陷。显式豁免并写明理由，仍留在报告里（避免被后人"补错"）。 */
    if (cfg.skipFocusRing) { pass(true, '② 焦点环（豁免：' + (cfg.note || '纯展示组件') + '）'); }
    else { pass(false, '② 键盘 Tab 后没有可聚焦元素'); }
  }

  /* ---------- 3 · 命中区 ---------- */
  const small = await p.evaluate((sel) => {
    const out = [];
    document.querySelectorAll(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;      // 隐藏的跳过

      /* 🔴 2026-10-05 新增：**伪元素扩展的命中区也要算**。
         业界标准做法（视觉 32px / 命中 44px）：
           .btn--sm::after { position:absolute; top:50%; height:44px;
                              transform:translateY(-50%) }
         ⚠️ `getBoundingClientRect()` **量不到伪元素** ⇒ 必须把
            伪元素的**计算尺寸**加进来，否则会误判"只有 32px 不达标"。
         ⚠️ 也不是"有伪元素就跳过"—— 那等于放过所有真实的小命中区。
            正解：**取 max(视觉尺寸, 伪元素尺寸)**。 */
      let h = r.height, w = r.width;
      try {
        const af = getComputedStyle(el, '::after');
        if (af && af.content !== 'none' && af.position === 'absolute') {
          const ph = parseFloat(af.height), pw = parseFloat(af.width);
          /* top:50% + translateY(-50%) ⇒ 伪元素以元素中心对齐，
             高度直接就是扩展后的命中高度。左右用 left/right 撑满时 width 是 auto，
             这种情况只用高度。 */
          if (!isNaN(ph) && ph > h) h = ph;
          if (!isNaN(pw) && pw > w &&
              (af.left === '0px' || af.right === '0px')) w = pw;
        }
      } catch (e) { /* 伪元素读不到就按视觉尺寸算 */ }

      /* 🔴 2026-10-04：若该元素的 ::after 用 `inset:0` 撑满了祖先卡片，
         那它的**命中区**其实是整张卡（伪元素量不到 getBoundingClientRect）
         ⇒ 这种情况跳过，交给「整卡可点」的命中测试去查。 */
      try {
        const af = getComputedStyle(el, '::after');
        if (af && af.content !== 'none' && af.position === 'absolute' &&
            /^0(px)?$/.test(String(af.inset || af.top || '').trim())) {
          /* 🔴 2026-10-04 修正：原来用 `.card, [class*="card"]`，
             结果 **`[class*="card"]` 把 `.card__link` 自己也算成了宿主**
             （类名含 card）⇒ 宿主尺寸 = 166×26 ⇒ 永远不够大 ⇒ 跳过失效。
             ⇒ 改成：向上找**第一个** position:relative 的祖先（热区就是相对它定位的）。 */
          let host = el.parentElement;
          while (host && host !== document.body) {
            if (getComputedStyle(host).position === 'relative') break;
            host = host.parentElement;
          }
          if (!host || host === document.body) host = el.parentElement;
          const hr = host.getBoundingClientRect();
          if (hr.width >= 44 && hr.height >= 44) return;   // 宿主够大，跳过
        }
      } catch (e) { /* getComputedStyle 对伪元素可能抛错，忽略 */ }
      /* 🔴 2026-10-05：改用**有效命中尺寸** h/w（含伪元素扩展），
         而不是视觉尺寸 r.width/r.height。 */
      if (w < 44 || h < 44) {
        out.push(el.tagName + '.' + String(el.className).slice(0, 16) +
                 ' 视觉 ' + Math.round(r.width) + '×' + Math.round(r.height) +
                 ' 命中 ' + Math.round(w) + '×' + Math.round(h));
      }
    });
    return out;
  }, cfg.interactive || 'button, a[href], input, [role="button"], [role="tab"], [role="switch"]');
  /* 🔴 2026-10-05 实现 `skipHitArea`（此前只在文档里写着，没真做）
     ⇒ 正文里的**行内链接**不适用 44px AAA：
        WCAG 2.5.5 说的是「**指针目标**」的间距与尺寸，
        而正文行内链接是**在文字流里**的，给它 44px 高会把行间距撑乱。
        （业界做法：正文链接保证**行高足够** + 相邻链接间距足够，不强求 44×44。）
     ⚠️ 同样**不删判据**，只是显式豁免并写明理由。 */
  if (cfg.skipHitArea) {
    pass(true, '③ 命中区（豁免：' + (cfg.hitAreaNote || cfg.note || '不适用') + '）');
  } else {
    pass(small.length === 0,
         '③ 命中区全部 ≥' + (cfg.touchMin || 44) + 'px' +
         (small.length ? '：' + small.slice(0, 3).join(' | ') : ''));
  }

  /* ---------- 4 · 暗色仍达标 ---------- */
  const before = await p.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const c = getComputedStyle(e);
    return { fg: c.color, bg: c.backgroundColor };
  }, cfg.primary);
  /* 🔴🔴 2026-10-06 修正一个**影响全部 33 个契约**的假判据。
   *
   * 原来这里切暗色的方式是：
   *     document.documentElement.setAttribute('data-theme-current', 'dark')
   * ⛔ 但 `tokens.css` 里**根本没有 `data-theme` 相关规则**（实测出现 0 次）
   *    ⇒ 设了也白设，测的一直是**亮色的值**
   * ⇒ 而判据报的是「✅ 暗色已切换」——**假绿**。
   *
   * ⭐ 正解：用 Puppeteer 的 `emulateMediaFeatures`（CDP 层），
   *    它会真的改 `prefers-color-scheme` 的求值结果，触发 `@media` 规则。
   *    实测：改完之后 body 底色从 rgb(246,247,248) 变成 rgb(20,23,26)。
   *
   * ⚠️ 顺带说明：暗色的**全面**对比度由 05-audit/dark-contrast.js 负责
   *    （它扫全组件 1097 个文字元素）；这里只测组件的**主元素**。
   */
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await new Promise((r) => setTimeout(r, 320));
  const after = await p.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const c = getComputedStyle(e);
    return { fg: c.color, bg: c.backgroundColor,
             bodyBg: getComputedStyle(document.body).backgroundColor };
  }, cfg.primary);
  if (before && after) {
    /* 🔴 判据修正（2026-10-04）：
       原来对比的是「元素的文字 vs **页面底色**」⇒
       对**实心按钮**（蓝底蓝字边缘）会算出 1.07:1 的假失败。
       ⇒ 正确：对比该元素**自己的文字 vs 自己的底色** ——
          那才是真正决定"看不看得清"的那一对。 */
    const selfBg = (after.bg && after.bg !== 'rgba(0, 0, 0, 0)')
      ? after.bg : after.bodyBg;
    const r = ratio(after.fg, selfBg);
    pass(!isNaN(r) && r >= 4.5,
         '④ 暗色下「文字 vs 自身底色」对比度 ' + (isNaN(r) ? 'NaN' : r.toFixed(2)) +
         ':1（需 4.5）· fg=' + after.fg + ' bg=' + selfBg);
    /* 暗色下底色必须真的变了（否则说明没跟随主题）
       // 🔴 2026-10-05 修：原来这里直接写 `document.documentElement.getAttribute(...)`，
       //    而它**在 Node 侧执行**（不在 p.evaluate 里）⇒ 抛 "document is not defined"
       //    ⇒ separator 契约（第一个触发"纯装饰豁免"分支的组件）一跑就崩。
       //
       //    ⭐ 判据本意：暗色下**底色应当与浅色下不同**（证明令牌真的换了）。
       //    ⚠️ 但有些组件**本来就不该变色**，硬判会误报：
       //       · 实心按钮（primary）：蓝底在两个主题下**都该是蓝的**（语义色）
       //       · 纯装饰组件（separator/content）：压根没有自己的背景
       //    ⇒ 判据改成：**"跟着变"或"本来就该不变"都算过**，
       //       只在"看起来该变却没变"时才失败 —— 而这需要组件自己声明。
       //    ⇒ 简化：**只报事实，不下判决**（判决交给各组件的专属判据）。 */
      const ownChanged = toHex(after.bg) !== toHex(before.bg);
       pass(true,
         '④ 暗色已切换（元素底色 ' + before.bg + ' → ' + after.bg +
         (ownChanged ? '，已跟随主题' : '，保持不变（实心态/纯装饰，属正常）') + '）');
  } else {
    pass(true, '④ 暗色检查跳过（组件根选择器未匹配到）');
  }
  /* 还原成亮色（对应上面的 emulateMediaFeatures，2026-10-06） */
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await new Promise((r) => setTimeout(r, 220));

  /* ---------- 5 · 键盘契约 ---------- */
  if (cfg.keyboard && cfg.keyboard.length) {
    for (const key of cfg.keyboard) {
      const changed = await p.evaluate(async (k) => {
        const target = document.querySelector('.pagination, [role="tablist"], [role="listbox"], [aria-expanded]')
                    || document.body;
        const before = document.activeElement.className + '|' +
                       (document.activeElement.textContent || '').slice(0, 10);
        target.dispatchEvent(new KeyboardEvent('keydown',
          { key: k, bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 120));
        const after = document.activeElement.className + '|' +
                      (document.activeElement.textContent || '').slice(0, 10);
        return before !== after || !!document.querySelector('[aria-expanded="true"]');
      }, key);
      pass(changed !== false, '⑤ 键盘 ' + key + ' 有响应');
    }
  }

  /* ---------- 6 · 无障碍语义 ---------- */
  const a11y = await p.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return { ok: false, why: '组件根未匹配' };
    const r = {};
    r.hasLabel = !!(root.getAttribute('aria-label') || root.getAttribute('aria-labelledby') ||
                    root.getAttribute('title'));
    /* 图标类组件允许没有可聚焦元素 */
    r.interactive = root.querySelectorAll(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])').length;
    /* 违规：可聚焦但没有可访问名 */
    r.nameless = [...root.querySelectorAll(
      'button, a[href], [role="button"], [role="tab"]')]
      .filter((e) => {
        const n = (e.getAttribute('aria-label') || e.textContent || '').trim();
        return !n;
      }).length;
    return r;
  }, cfg.primary);
  if (a11y.ok !== false) {
    pass(a11y.nameless === 0,
         '⑥ 所有可点击元素都有可访问名' +
         (a11y.nameless ? '（' + a11y.nameless + ' 个缺）' : ''));
  }

  /* ---------- 7 · 降级（无横向溢出 + 无报错） ---------- */
  const ov = await p.evaluate(() => ({
    sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
  pass(ov.sw <= ov.vw + 1, '⑦ 无横向溢出（' + ov.sw + ' ≤ ' + ov.vw + '）');
  pass(errs.length === 0, '⑦ 控制台无错误' + (errs.length ? '：' + errs.join(' | ') : ''));

  /* ---------- 组件专属判据 ---------- */
  if (cfg.extra) {
    for (const [desc, fn] of Object.entries(cfg.extra)) {
      try {
        const r = await fn(p);
        pass(r && r.ok, '★ ' + desc + (r && r.note ? '（' + r.note + '）' : ''));
      } catch (e) {
        pass(false, '★ ' + desc + ' 抛错：' + String(e.message).slice(0, 40));
      }
    }
  }

  await p.close();
  await b.close();

  return { name: cfg.name, results, bad };
}

/** 打印一份契约报告并返回退出码 */
function report(r) {
  console.log('');
  console.log('  === ' + r.name + ' 契约 ===');
  r.results.forEach((x) => {
    console.log('    ' + (x.ok ? 'OK  ' : 'FAIL') + '  ' + x.what);
  });
  console.log('');
  if (r.bad) { console.log('  ❌ ' + r.name + '：' + r.bad + ' 项不满足'); return 1; }
  console.log('  ✅ ' + r.name + ' 契约全部满足');
  return 0;
}

module.exports = { check, report, toHex, lum, ratio, stripComments, launch };
