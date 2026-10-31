#!/usr/bin/env node
/* LAYER: component
 * ============================================================================
 * forced-colors-check.js — Windows 高对比度下，信息还在不在
 *
 * 🔴 为什么需要这一道
 *   全库 40 个 CSS 里，`@media (forced-colors: active)` 曾经只有 3 处
 *   （badge / accordion / delta），而且没人验证过那 3 处之外有没有问题。
 *   2026-10-31 用 CDP 把 `forced-colors` 打开逐页实拍，抓到的不是"样式略糙"：
 *
 *     · 线形进度条 735×6 **整块空白** —— 轨道与填充同色，进度归零
 *     · 环形进度 conic-gradient 被整条移除 —— 只剩一个漂着的 "72%"
 *     · 开关滑块**完全消失** —— 白底 + 阴影被丢弃 + 无边框，
 *       开关只剩一个空心胶囊，**开与关看不出区别**
 *     · 表格排序箭头、表单错误图标**变成白底上的白形状**
 *       （mask 还在，是 `background-color: currentColor` 被替换成了 Canvas）
 *     · 骨架屏整块变白 —— 看起来像"加载完了，内容为空"
 *     · 选项的勾选标记（choice__mark::after）同样消失
 *     · 侧栏"当前项"：用透明边框预留 3px 的做法，在强制色里**五项全都长出竖线**
 *       （透明边框会被解析成实线），当前项与其它项只剩一个色相差（0.22.1）
 *
 *   这些问题在正常截图里**一个都看不见**，在 axe / 对比度检查里也**全绿**：
 *   强制色不是"对比度不够"，而是"颜色被换掉之后语义丢失"。
 *   所以它必须单独一道，不能指望别的门禁顺带覆盖。
 *
 * 🔴 判据为什么只能问"前景 ≠ 背景"，不能问"等于某个色"
 *   实测（_fc-syscolors.js）：作者写系统色关键字时，
 *     Highlight  → rgb(55, 0, 110)   紫
 *     CanvasText → rgb(0, 0, 0)      黑
 *     GrayText   → rgb(96, 0, 0)     深红   ← 注意！
 *   `GrayText` 在**真实** Windows 高对比度主题下是灰，Chromium 的模拟色板
 *   里却是深红。⇒ 任何"断言 GrayText 应该是灰"的判据都会在模拟器里红、
 *   在真机上绿（或反过来）。
 *
 *   ⚠️ 更要紧的一条：**不能把 "rgb(0,0,0)" 当成 Canvas**。
 *      第一版判据就栽在这里 —— 它把"修复成功的黑箭头"判成了失败，
 *      因为黑既可能是 Canvas（暗色主题的底），也可能是 CanvasText（亮色主题的字）。
 *      **同一个 RGB 在两种主题下含义相反** ⇒ 绝对色值不可作为判据。
 *
 *   ⇒ 唯一稳定的判据是**相对**的：这个图形和它所在的那块背景，颜色一样吗？
 *      一样 ⇒ 看不见（不论具体是黑是白）
 *      不一样 ⇒ 看得见
 *   这条在模拟器与真机、亮色与暗色主题下同真同假。
 *
 * 🔴 三组判据，缺一组这个结论就站不住
 *   A 组 规则层：用 fixture + **真实的组件 CSS 文本**，精确控制状态
 *       （三态开关、60% 进度），断言"前景 ≠ 背景"
 *   B 组 页面层：把同样的**模式**扫过 37 个真实 demo 页，
 *       防止"修完这几个，别处还有同款"（误报进白名单，每条必须写理由）
 *   C 组 反向控制：把修复**剥掉**再跑 A 组同一套断言，必须变红
 *       —— 没有 C 组，A 组的绿只证明"代码现在是绿的"，不证明判据有牙
 *
 * ⚠️ 为什么用 CDP 而不是 `page.emulateMediaFeatures`
 *   puppeteer-core 的 `emulateMediaFeatures` 有一张**特性名白名单**，
 *   `forced-colors` 不在里面，直接抛 "Unsupported media feature"。
 *   底层 CDP 的 `Emulation.setEmulatedMedia` 支持任意特性名
 *   ⇒ 绕过白名单，直接发协议。这条不是偏好，是唯一可行的路。
 *
 * ⚠️ 强制色下的两条"免费"规则（实测，写在这里省得下个人再试一遍）
 *   · `border: 1px solid transparent`  → 强制色下自动变 CanvasText 实线
 *   · `outline: Npx solid transparent` → 同上，且**不占布局**
 *   · `box-shadow: 0 0 0 1px transparent` → **无效**，阴影整个被丢弃
 *   ⇒ 所以本库的"边界预留"统一用 transparent border/outline，不写 media query。
 *
 * 用法：
 *   python 05-audit/serve.py --port 8000 &
 *   node 05-audit/forced-colors-check.js
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { launch } = require('./browser.js');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.FL_BASE || 'http://127.0.0.1:8000';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const isTransparent = (c) =>
  c === 'rgba(0, 0, 0, 0)' || c === 'rgba(255, 255, 255, 0)' || c === 'transparent';
const zeroPx = (v) => (parseFloat(v) || 0) === 0;

/* ---------------------------------------------------------------------------
 * 剥掉 `@media (forced-colors: active) { … }`（花括号配平，不用正则）
 * ------------------------------------------------------------------------- */
function stripForcedColors(css) {
  let out = '';
  let i = 0;
  let removed = 0;
  const needle = '@media (forced-colors: active)';
  while (i < css.length) {
    const at = css.indexOf(needle, i);
    if (at < 0) { out += css.slice(i); break; }
    out += css.slice(i, at);
    const b = css.indexOf('{', at);
    if (b < 0) { out += css.slice(at); break; }
    let depth = 0;
    let j = b;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    removed++;
    i = j;
  }
  return { css: out, removed: removed };
}

/* ---------------------------------------------------------------------------
 * 页面内探针
 * ------------------------------------------------------------------------- */
const probe = {
  /* 单元素签名：**同时**取它周围的底，用于判断"前景 vs 背景" */
  one: (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    /* seenBg = 人眼在这个位置上看到的"底"：从**父级**往上找第一层不透明的。
       找不到（整条链都透明）⇒ 就是浏览器默认画布色，亮色主题下是白。
       ⚠️ 不能从元素自己开始找：骨架屏自己就有底色，那样 seenBg 会等于自己，
          判据就变成"自己 ≠ 自己"，永远为假。 */
    let seenBg = 'rgb(255, 255, 255)';
    let cur = el.parentElement;
    while (cur) {
      const c = getComputedStyle(cur).backgroundColor;
      if (!isTransparentStatic(c)) { seenBg = c; break; }
      cur = cur.parentElement;
    }
    return {
      bg: cs.backgroundColor,
      seenBg: seenBg,
      color: cs.color,
      borderW: cs.borderTopWidth,
      borderColor: cs.borderTopColor,
      outlineW: cs.outlineWidth,
      outlineColor: cs.outlineColor,
      outlineStyle: cs.outlineStyle,
      shadow: cs.boxShadow,
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
    };
    function isTransparentStatic(c) {
      return c === 'rgba(0, 0, 0, 0)' || c === 'rgba(255, 255, 255, 0)' || c === 'transparent';
    }
  },

  /* 伪元素 + 宿主底色：伪元素"看得见"= 自己的色 ≠ 宿主的底 */
  pseudo: (sel, which) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const ps = getComputedStyle(el, which);
    const hostCs = getComputedStyle(el);
    let hostBg = 'rgb(255, 255, 255)';
    if (!isTransparentStatic(hostCs.backgroundColor)) {
      hostBg = hostCs.backgroundColor;
    } else {
      let cur = el.parentElement;
      while (cur) {
        const c = getComputedStyle(cur).backgroundColor;
        if (!isTransparentStatic(c)) { hostBg = c; break; }
        cur = cur.parentElement;
      }
    }
    return {
      bg: ps.backgroundColor,
      hostBg: hostBg,
      bw: ps.borderTopWidth,
      content: ps.content,
      w: ps.width, h: ps.height,
    };
    function isTransparentStatic(c) {
      return c === 'rgba(0, 0, 0, 0)' || c === 'rgba(255, 255, 255, 0)' || c === 'transparent';
    }
  },

  /* 开关三态签名。⚠️ 一次只测一个实例：
     实测（_fc-dbg-count.js）三个开关同页 + 独立哨兵 style 时，
     `Highlight` / `GrayText` 会**双双失效**（单实例同页正常）。
     我没有定位到 Chromium 的确切原因，所以不让判据依赖这个未解释的行为 ——
     每次 render 只放一个开关，分别读三态。 */
  switchOne: () => {
    const root = document.querySelector('.switch');
    if (!root) return null;
    const inp = root.querySelector('.switch__input');
    const tr = root.querySelector('.switch__track');
    const th = root.querySelector('.switch__thumb');
    if (!inp || !tr || !th) return null;
    const ct = getComputedStyle(tr), ch = getComputedStyle(th);
    return {
      checked: inp.checked,
      disabled: inp.disabled,
      trackBg: ct.backgroundColor,
      trackBorder: ct.borderTopColor,
      trackBorderW: ct.borderTopWidth,
      thumbBg: ch.backgroundColor,
      thumbBorder: ch.borderTopColor,
      thumbBorderW: ch.borderTopWidth,
      offset: Math.round(th.getBoundingClientRect().x - tr.getBoundingClientRect().x),
    };
  },

  /* 全库扫描 */
  scan: (tag) => {
    const px = (v) => parseFloat(v) || 0;
    const trans = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'rgba(255, 255, 255, 0)' || c === 'transparent';
    const rows = [];
    let i = 0;
    for (const el of document.body.querySelectorAll('*')) {
      if (/^(SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT|BR)$/.test(el.tagName)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || px(cs.opacity) === 0) continue;

      let idx = el.getAttribute('data-fci');
      if (tag === 'base') { idx = String(i); el.setAttribute('data-fci', idx); }
      else if (idx === null) idx = 'x' + i;
      i++;

      const par = el.parentElement;
      const pbg = par ? getComputedStyle(par).backgroundColor : '';

      const pseudoOf = (name) => {
        const p = getComputedStyle(el, name);
        if (!p.content || p.content === 'none' || p.content === 'normal') return null;
        return {
          bg: p.backgroundColor,
          bw: px(p.borderTopWidth),
          /* 伪元素的"背景"就是宿主自己 —— 同色即不可见 */
          hostBg: cs.backgroundColor,
        };
      };

      rows.push({
        idx: idx,
        tag: el.tagName,
        cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').toString().slice(0, 50),
        borderW: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(px),
        shadow: cs.boxShadow,
        bg: cs.backgroundColor,
        bgImg: cs.backgroundImage,
        color: cs.color,
        outlineW: px(cs.outlineWidth),
        pbg: pbg,
        before: pseudoOf('::before'),
        after: pseudoOf('::after'),
      });
    }
    return rows;
  },
};

const zeroAll = (arr) => arr.every(v => v === 0);

/* ---------------------------------------------------------------------------
 * 白名单：B 组扫描的已知非缺陷，每条必须写清"为什么不是缺陷"
 * key = 组件 id + '|' + 标签.类名[::伪元素]
 * ------------------------------------------------------------------------- */
const B_WHITELIST = {
  /* 图片占位色块：真正承载内容的是 <img>，底色消失不影响可读性 */
  'card|DIV.card__media': '图片占位底色，内容由 img 承载',
  /* 文档页的说明块：不属于组件，且文字本身可读 */
  'nav|P.note': '文档页说明块，文字本身可读',
  'nav|CODE.': '行内代码底，等宽字形已足够区分',
};

/* ---------------------------------------------------------------------------
 * fixtures：用真实 CSS 文本 + 最小结构，精确控制状态
 * ------------------------------------------------------------------------- */
const FIXTURE = {
  progress:
    '<span class="progress" style="--progress:60%;width:400px">' +
      '<span class="progress__bar"></span>' +
    '</span>',
  ring:
    '<span class="progress-ring" style="--ring-size:64px;--ring-thickness:2px;--progress-num:72">' +
      '<span class="progress-ring__label">72%</span>' +
    '</span>',
  /* 开关：三种状态各一个 fixture，**一次只渲染一个**（理由见 probe.switchOne） */
  switchOff:
    '<label class="switch"><input class="switch__input" type="checkbox">' +
      '<span class="switch__track"><span class="switch__thumb"></span></span>' +
      '<span class="switch__label">关</span></label>',
  switchOn:
    '<label class="switch"><input class="switch__input" type="checkbox" checked>' +
      '<span class="switch__track"><span class="switch__thumb"></span></span>' +
      '<span class="switch__label">开</span></label>',
  switchDis:
    '<label class="switch"><input class="switch__input" type="checkbox" disabled>' +
      '<span class="switch__track"><span class="switch__thumb"></span></span>' +
      '<span class="switch__label">禁用</span></label>',
  /* 拖放区：idle 与 dragover 的差别必须**不止颜色** ——
     强制色会把作者色全部换掉，只靠色差的"拖到这里"提示会整块消失。 */
  upload:
    '<div class="upload upload--drop" style="width:360px">' +
      '<input class="upload__input" type="file" id="fc-up">' +
      '<label class="upload__dropzone" for="fc-up">' +
        '<span class="upload__title">拖入文件</span>' +
      '</label>' +
    '</div>',
  /* 侧栏导航：一条 aria-current + 两条普通项。
     判据要看的是「当前项与其它项的差别」—— 只渲染一条链接测不出来。 */
  shellNav:
    '<nav class="shell__side" style="width:220px">' +
      '<a class="shell__link" href="#" aria-current="page">总览</a>' +
      '<a class="shell__link" href="#">实体</a>' +
      '<a class="shell__link" href="#">勾稽校验</a>' +
    '</nav>',
  sort: '<table><thead><tr><th aria-sort="ascending">' +
        '<button class="table__sort">公司</button></th></tr></thead>' +
        '<tbody><tr><td>甲</td></tr></tbody></table>',
  error:
    '<p class="field__error" role="alert">请输入有效金额</p>',
  skeleton:
    '<span class="skeleton skeleton--text" style="width:300px"></span>',
  choice:
    '<label class="choice"><input class="choice__input" type="checkbox" checked>' +
      '<span class="choice__mark"></span><span class="choice__label">已选</span></label>' +
    '<label class="choice choice--radio"><input class="choice__input" type="radio" checked>' +
      '<span class="choice__mark"></span><span class="choice__label">单选</span></label>',
};

const CSS_FILES = {
  progress: '02-primitives/progress/progress.css',
  switch: '02-primitives/switch/switch.css',
  table: '04-recipes/table/table.css',
  input: '02-primitives/input/input.css',
  skeleton: '02-primitives/skeleton/skeleton.css',
  choice: '02-primitives/choice/choice.css',
  shell: '04-recipes/app-shell/app-shell.css',
  upload: '02-primitives/upload/upload.css',
};

async function main() {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  const cdp = await p.target().createCDPSession();

  const setFC = (mode) => cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'forced-colors', value: mode }],
  });

  const TOKENS = read('01-tokens/tokens.css');

  /** 用给定的 CSS 文本渲染 fixture（含一个"系统色哨兵"） */
  async function render(fixtures, cssTexts) {
    const styleTags = cssTexts.map(c => '<style>' + c + '</style>').join('');
    await setFC('none');
    await p.setContent('<!doctype html><html><head>' +
      '<style>' + TOKENS + '</style>' +
      '<style>body{margin:0;padding:16px;font:14px/1.5 sans-serif}</style>' +
      /* 哨兵：它是"系统色关键字已经解析完"的唯一可观测信号。
         ⚠️ 固定 sleep 不够 —— 实测同一个 fixture，等 60ms 读到 Highlight 是白的，
            等 400ms 才变紫（_fc-dbg-seq.js）。切媒体特性 ≠ 样式已重算完，
            这和 a11y-ax 那次「networkidle0 ≠ JS 就绪」是同一类错误。
         ⇒ 每次切换后轮询哨兵，而不是赌一个毫秒数。 */
      '<style>@media (forced-colors: active){#__fc_sentinel{background:Highlight}}</style>' +
      styleTags +
      '</head><body><span id="__fc_sentinel" style="position:fixed;left:-9999px;top:0;' +
      'width:1px;height:1px;display:block"></span>' +
      fixtures.join('') + '</body></html>', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 40));
  }

  /** 切到 forced-colors，并等到系统色真的解析完成 */
  let lastWaitMs = 0;
  let fcTimeouts = 0;
  let fcMaxWait = 0;
  async function activate() {
    const t0 = Date.now();
    await setFC('active');
    for (let i = 0; i < 60; i++) {                 /* 最多约 1.5s */
      const s = await p.evaluate(() => {
        const el = document.getElementById('__fc_sentinel');
        if (!el) return null;
        return getComputedStyle(el).backgroundColor;
      });
      if (s && s !== 'rgba(0, 0, 0, 0)' && s !== 'rgba(255, 255, 255, 0)' && s !== 'transparent') {
        /* 🔴 哨兵过了还不够：**带 transition 的属性此刻正在过渡途中**。
           实测（2026-10-31）：`.switch__track` 有
             `transition: background var(--dur-fast) var(--ease-out)`
           切到 forced-colors 后读它，拿到的是**过渡起点**（纯白），
           等 250ms 才是终态的 Highlight 紫。
           而 progress / table / choice 没有对 background 做过渡 ⇒ 立刻就对。
           ⇒ 判据必须在"过渡已到终态"之后读，否则测的是动画中间帧。

           把动画推到终态（而不是 sleep）：对无限动画（skeleton 的 shimmer）
           `finish()` 会抛 InvalidStateError，忽略即可 —— 它本来就永不结束。 */
        await p.evaluate(() => {
          const anims = document.getAnimations ? document.getAnimations() : [];
          for (const a of anims) {
            try { a.finish(); } catch (e) { /* 无限动画，跳过 */ }
          }
        });
        lastWaitMs = Date.now() - t0;
        if (lastWaitMs > fcMaxWait) fcMaxWait = lastWaitMs;
        return true;
      }
      await new Promise(r => setTimeout(r, 25));
    }
    lastWaitMs = Date.now() - t0;
    if (lastWaitMs > fcMaxWait) fcMaxWait = lastWaitMs;
    fcTimeouts++;
    return false;
  }

  const rows = [];
  const add = (group, label, ok, note) => rows.push({ group, label, ok, note });

  /* ==========================================================================
   * A 组：规则层（fixture + 真实 CSS）
   * ========================================================================== */
  const P = read(CSS_FILES.progress);
  const S = read(CSS_FILES.switch);
  const T = read(CSS_FILES.table);
  const I = read(CSS_FILES.input);
  const K = read(CSS_FILES.skeleton);
  const C = read(CSS_FILES.choice);
  const SH = read(CSS_FILES.shell);
  const U = read(CSS_FILES.upload);

  /* ---- A1 线形进度 ---- */
  await render([FIXTURE.progress], [P]);
  const barNone = await p.evaluate(probe.one, '.progress');
  await activate();
  const barTrack = await p.evaluate(probe.one, '.progress');
  const barFill = await p.evaluate(probe.one, '.progress__bar');

  add('A1', '线形进度：填充块与轨道底色不同（进度可辨）',
    !!(barFill && barTrack) && barFill.bg !== barTrack.bg,
    '轨道 ' + (barTrack && barTrack.bg) + ' vs 填充 ' + (barFill && barFill.bg));

  add('A1', '线形进度：轨道有可见轮廓（不靠底色也能看出范围）',
    !!barTrack && !zeroPx(barTrack.outlineW) && barTrack.outlineStyle !== 'none',
    'outline ' + (barTrack && (barTrack.outlineW + ' ' + barTrack.outlineStyle)) +
    ' / ' + (barTrack && barTrack.outlineColor));

  add('A1', '线形进度：正常态 outline 不可见（改这条不进视觉基线）',
    !!barNone && (!zeroPx(barNone.outlineW) ? isTransparent(barNone.outlineColor) : true),
    '正常态 outline-color=' + (barNone && barNone.outlineColor));

  /* ---- A2 环形进度 ---- */
  await render([FIXTURE.ring], [P]);
  await activate();
  const ring = await p.evaluate(probe.one, '.progress-ring');
  add('A2', '环形进度：强制色下有实线轮廓（渐变被移除后的替代）',
    !!ring && ring.outlineStyle === 'solid' && !zeroPx(ring.outlineW),
    'outline ' + (ring && (ring.outlineW + ' ' + ring.outlineStyle + ' ' + ring.outlineColor)) +
    ' · 中心 label 承载数字');

  /* ---- A3 开关三态 ---- */
  await render([FIXTURE.switchOff], [S]);
  await activate();
  const swOff = await p.evaluate(probe.switchOne);

  await render([FIXTURE.switchOn], [S]);
  await activate();
  const swOn = await p.evaluate(probe.switchOne);

  /* 调试开关：`FL_FC_DEBUG=1 node 05-audit/forced-colors-check.js`
     打开后会把「匹配到 .switch__track 且声明了背景/边框的全部规则」按
     cascade 顺序打出来。2026-10-31 排查 "Highlight 明明是最后一条却没生效"
     时靠的就是它 —— 那次最终发现不是 cascade 问题、是过渡未结束（E170），
     但**没有这张表就分不清这两种可能**。留着，下次红了先开它。 */
  if (process.env.FL_FC_DEBUG) {
    const dump = await p.evaluate(() => {
      const tr = document.querySelector('.switch__track');
      const res = [];
      const walk = (rs, media) => {
        for (const r of rs) {
          if (r.type === 4) { walk(r.cssRules, (media ? media + ' && ' : '') + r.conditionText); continue; }
          if (r.type !== 1 || !r.selectorText) continue;
          let hit = false; try { hit = tr.matches(r.selectorText); } catch (e) { hit = false; }
          if (!hit) continue;
          const bg = r.style.getPropertyValue('background') || r.style.getPropertyValue('background-color');
          const bc = r.style.getPropertyValue('border-color');
          if (bg || bc) res.push({ sel: r.selectorText, media: media || '(none)', bg: bg, bc: bc });
        }
      };
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
        walk(rules, '');
      }
      return { computed: getComputedStyle(tr).backgroundColor, res: res };
    });
    console.log('  [debug] computed=' + dump.computed);
    dump.res.forEach(d => console.log('  [debug] [' + d.media + '] ' + d.sel + ' { bg:' + d.bg + ' bc:' + d.bc + ' }'));
  }

  await render([FIXTURE.switchDis], [S]);
  await activate();
  const swDis = await p.evaluate(probe.switchOne);

  add('A3', '开关：滑块有可见描边（描边色 ≠ 滑块底色）',
    !!swOff && !zeroPx(swOff.thumbBorderW) && swOff.thumbBorder !== swOff.thumbBg,
    swOff ? 'thumb border ' + swOff.thumbBorderW + ' ' + swOff.thumbBorder +
      ' / bg ' + swOff.thumbBg : '找不到关态');

  add('A3', '开关：开与关的轨道底色不同',
    !!swOn && !!swOff && swOn.trackBg !== swOff.trackBg,
    '开 ' + (swOn && swOn.trackBg) + ' vs 关 ' + (swOff && swOff.trackBg));

  add('A3', '开关：开与关的滑块位置不同（第二条线索，不依赖颜色）',
    !!swOn && !!swOff && swOn.offset !== swOff.offset,
    '开 x=' + (swOn && swOn.offset) + ' vs 关 x=' + (swOff && swOff.offset));

  add('A3', '开关：禁用态与可用关态可区分',
    !!swDis && !!swOff && swDis.trackBorder !== swOff.trackBorder,
    '禁用边框 ' + (swDis && swDis.trackBorder) + ' vs 可用 ' + (swOff && swOff.trackBorder));

  /* ---- A4 mask 图标：前景 ≠ 宿主底色 ---- */
  await render([FIXTURE.sort], [T]);
  await activate();
  const sort = await p.evaluate(probe.pseudo, '.table__sort', '::after');
  add('A4', '表格排序箭头：箭头色 ≠ 按钮底色（不是白底白箭头）',
    !!sort && !isTransparent(sort.bg) && sort.bg !== sort.hostBg,
    '::after ' + (sort && sort.bg) + ' / 宿主底 ' + (sort && sort.hostBg));

  await render([FIXTURE.error], [I]);
  await activate();
  const err = await p.evaluate(probe.pseudo, '.field__error', '::before');
  add('A4', '表单错误图标：图标色 ≠ 所在底色',
    !!err && !isTransparent(err.bg) && err.bg !== err.hostBg,
    '::before ' + (err && err.bg) + ' / 所在底 ' + (err && err.hostBg));

  /* ---- A5 骨架屏 ---- */
  await render([FIXTURE.skeleton], [K]);
  await activate();
  const sk = await p.evaluate(probe.one, '.skeleton');
  add('A5', '骨架屏：填充色 ≠ 页面底色（不伪装成"加载完了"）',
    !!sk && !isTransparent(sk.bg) && sk.bg !== sk.seenBg,
    '骨架 ' + (sk && sk.bg) + ' / 页面底 ' + (sk && sk.seenBg));

  /* ---- A6 选择控件（B3 扫出来的第 6 个缺陷） ---- */
  await render([FIXTURE.choice], [C]);
  await activate();
  const radioDot = await p.evaluate(probe.pseudo, '.choice--radio .choice__mark', '::after');
  add('A6', '单选圆点：圆点色 ≠ 框底色（圆点是用 background 画的，最危险）',
    !!radioDot && !isTransparent(radioDot.bg) && radioDot.bg !== radioDot.hostBg,
    '::after ' + (radioDot && radioDot.bg) + ' / 框底 ' + (radioDot && radioDot.hostBg));

  /* 同组对照：checkbox 的勾是 border 画的，本来就该活着 —— 这条是"别乱改"的护栏。
     ⚠️ 勾的 border-width 是 `0 2px 2px 0`（top 为 0，因为是对勾的两条边），
        所以必须看 **right** 而不是 top —— 第一版看 top 得到 0px，假红。 */
  const cbTick = await p.evaluate(() => {
    const el = document.querySelector('.choice:not(.choice--radio) .choice__mark');
    if (!el) return null;
    const ps = getComputedStyle(el, '::after');
    const host = getComputedStyle(el);
    return {
      bw: ps.borderRightWidth,
      borderColor: ps.borderRightColor,
      bg: ps.backgroundColor,
      hostBg: host.backgroundColor,
    };
  });
  add('A6b', '复选勾：仍由 border 表达，且勾色 ≠ 框底色（反向样本，不该被一起改掉）',
    !!cbTick && !zeroPx(cbTick.bw) && cbTick.borderColor !== cbTick.hostBg,
    cbTick ? '勾 border-right ' + cbTick.bw + ' ' + cbTick.borderColor +
      ' / 框底 ' + cbTick.hostBg : '找不到');

  /* ---- A7 侧栏当前项（0.22.1 实拍抓到的第 7 类缺陷） ---- */
  /* 🔴 这一条守的是**状态差别**，不是"有没有样式"。
     0.21 的做法是给所有链接预留 `border-inline-start: 3px solid transparent`，
     只给当前项换实色。强制色把透明边框解析成实线（链接上实测 LinkText 深蓝
     rgb(0,0,159)，当前项 CanvasText 黑）⇒ **每一项都长出一条竖线**，
     当前项与其它项只剩一个色相差。旧判据（只看"当前项有边框"）会全绿。 */
  const readNav = () => p.evaluate(() => {
    return Array.prototype.slice.call(document.querySelectorAll('.shell__link')).map((a) => {
      const s = getComputedStyle(a);
      const b = getComputedStyle(a, '::before');
      return {
        txt: (a.textContent || '').trim(),
        cur: a.getAttribute('aria-current') === 'page',
        bw: s.borderInlineStartWidth,
        bs: s.borderInlineStartStyle,
        fw: parseInt(s.fontWeight, 10) || 0,
        before: b.content,
        beforeBg: b.backgroundColor,
        beforeW: b.width,
      };
    });
  });

  await render([FIXTURE.shellNav], [SH]);
  await activate();
  const nav = await readNav();
  const navCur = nav.filter(r => r.cur);
  const navOther = nav.filter(r => !r.cur);
  /* 「有标记」的定义要写成**可观测的三件事**：字重、圆点尺寸、圆点颜色。
     第一版用 `content: "•"`，实测会被算进可访问名（读屏念「圆点 总览」）——
     所以改成空内容的系统色圆点，判据也跟着看"圆点画出来没有"，而不是看字符。 */
  const hasMark = (r) => r.fw >= 700 && !zeroPx(r.beforeW) && !isTransparent(r.beforeBg);
  const noMark = (r) => r.fw < 700 &&
    (r.before === 'none' || zeroPx(r.beforeW) || isTransparent(r.beforeBg));

  add('A7', '侧栏当前项：只有当前项带非颜色标记（字重 ≥700 + 系统色圆点）',
    navCur.length === 1 && navCur.every(hasMark) && navOther.every(noMark),
    '当前项 ' + navCur.map(r => r.txt + ' fw=' + r.fw + ' 圆点 ' + r.beforeW + ' ' +
      r.beforeBg).join(' / ') +
    ' · 其它 ' + navOther.map(r => r.txt + ' fw=' + r.fw + ' 圆点 ' + r.beforeW).join(' / '));

  /* A7c 圆点不能污染可访问名。`content: "•"` 的写法实测念成「圆点 总览」，
     这条就是那个坑的护栏 —— 判据问浏览器要名字，不数 DOM 里的字。 */
  const snap = await p.accessibility.snapshot({ interestingOnly: false });
  const axNames = [];
  (function walk(n) {
    if (!n) return;
    if (n.role === 'link') axNames.push(n.name);
    (n.children || []).forEach(walk);
  })(snap);
  add('A7c', '侧栏当前项：圆点不进可访问名（读屏念「总览」，不是「圆点 总览」）',
    axNames.length === nav.length && axNames.every(n => !/[•·]/.test(n)) &&
      axNames.indexOf('总览') >= 0,
    '名字：' + axNames.join(' / '));

  add('A7b', '侧栏当前项：所有项都没有左竖线（透明边框预留会被强制色解析成实线）',
    nav.every(r => zeroPx(r.bw)),
    nav.map(r => r.txt + ' ' + r.bw + ' ' + r.bs).join(' / '));

  /* ---- A8 拖放区：dragover 不能只靠底色差（0.18.0 引入的状态，0.22.1 才补判据） ---- */
  const readDrop = async (state) => {
    await p.evaluate((st) => {
      const root = document.querySelector('.upload--drop');
      if (st) root.setAttribute('data-state', st);
      else root.removeAttribute('data-state');
    }, state);
    return p.evaluate(() => {
      const dz = document.querySelector('.upload__dropzone');
      const s = getComputedStyle(dz);
      return { bs: s.borderStyle, bc: s.borderColor, bw: s.borderWidth, bg: s.backgroundColor };
    });
  };

  await render([FIXTURE.upload], [U]);
  await activate();
  const dropIdle = await readDrop(null);
  const dropOver = await readDrop('dragover');
  /* 判据：**边框样式**必须变（dashed → solid）。边框色在强制色下会被统一，
     底色会被丢掉，只有"线型"是结构差异 —— 它替读者回答了"现在能松手吗"。 */
  add('A8', '拖放区：dragover 与 idle 的差别不止颜色（线型 dashed → solid）',
    !!dropIdle && !!dropOver && dropIdle.bs !== dropOver.bs,
    'idle ' + (dropIdle && dropIdle.bs) + ' / dragover ' + (dropOver && dropOver.bs) +
    ' · 色差 ' + (dropIdle && dropIdle.bc) + ' → ' + (dropOver && dropOver.bc));

  /* ==========================================================================
   * B 组：页面层（37 个真实 demo）
   * ========================================================================== */
  const cj = JSON.parse(read('ai/components.json'));
  const pages = cj.components.filter(c => c.files && c.files.demo).map(c => [c.id, c.files.demo]);

  const bFound = { maskIcon: [], shadowEdge: [], pseudoShape: [] };
  const bSentinelFailed = [];

  for (const pair of pages) {
    await setFC('none');
    await p.goto(BASE + '/' + pair[1], { waitUntil: 'load', timeout: 15000 });
    await new Promise(r => setTimeout(r, 120));
    /* 真实页面没有哨兵 ⇒ 注入一个（1×1，会被 scan 的宽度过滤掉） */
    await p.evaluate(() => {
      if (document.getElementById('__fc_sentinel')) return;
      const st = document.createElement('style');
      st.textContent = '@media (forced-colors: active){#__fc_sentinel{background:Highlight}}';
      document.head.appendChild(st);
      const sp = document.createElement('span');
      sp.id = '__fc_sentinel';
      sp.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;display:block';
      document.body.appendChild(sp);
    });
    const base = await p.evaluate(probe.scan, 'base');
    const fcOk = await activate();
    if (!fcOk) bSentinelFailed.push(pair[0]);
    const act = await p.evaluate(probe.scan, 'act');

    const byIdx = new Map(act.map(r => [r.idx, r]));
    for (const o of base) {
      const a = byIdx.get(o.idx);
      if (!a) continue;
      const key = pair[0] + '|' + o.tag + '.' + o.cls;

      /* B1 currentColor 画的图形：原色 == 文字色，强制后 == 自身背景 ⇒ 不可见 */
      if (o.bg === o.color && !isTransparent(o.bg) && a.bg === a.pbg) {
        if (!B_WHITELIST[key]) bFound.maskIcon.push(key + ' ' + o.bg + ' → ' + a.bg);
      }

      /* B2 靠阴影立边界：无边框 + 有阴影 + 无底色；强制后仍无任何边界 */
      if (zeroAll(o.borderW) && o.shadow !== 'none' && o.bg === o.pbg) {
        const hasEdge = a.borderW.some(v => v > 0) || a.outlineW > 0;
        if (!hasEdge && !B_WHITELIST[key]) bFound.shadowEdge.push(key);
      }

      /* B3 伪元素图形：原色有色、无边框；强制后 == 宿主底色 ⇒ 不可见 */
      for (const k of ['before', 'after']) {
        const po = o[k], pa = a[k];
        if (!po || !pa) continue;
        if (isTransparent(po.bg) || po.bw > 0) continue;
        if (pa.bg === pa.hostBg) {
          const key2 = key + '::' + k;
          if (!B_WHITELIST[key2]) bFound.pseudoShape.push(key2 + ' ' + po.bg + ' → ' + pa.bg);
        }
      }
    }
  }

  add('B1', '全库 37 页：用 currentColor 画的图标没有消失',
    bFound.maskIcon.length === 0,
    bFound.maskIcon.length ? bFound.maskIcon.slice(0, 5).join(' ; ') : '0 处');

  add('B2', '全库 37 页：靠阴影立边界的元素仍有边界',
    bFound.shadowEdge.length === 0,
    bFound.shadowEdge.length ? bFound.shadowEdge.slice(0, 5).join(' ; ') : '0 处');

  add('B3', '全库 37 页：伪元素画的图形没有和底色重合',
    bFound.pseudoShape.length === 0,
    bFound.pseudoShape.length ? bFound.pseudoShape.slice(0, 5).join(' ; ') : '0 处');

  add('A0', '系统色哨兵：每次切换都等到 Highlight 真的解析完成',
    fcTimeouts === 0 && bSentinelFailed.length === 0,
    'A 组超时 ' + fcTimeouts + ' 次 · B 组页面失败 ' + bSentinelFailed.length +
    ' 页' + (bSentinelFailed.length ? '（' + bSentinelFailed.slice(0, 5).join(',') + '）' : '') +
    ' · 单次最长等待 ' + fcMaxWait + 'ms');

  /* ==========================================================================
   * C 组：反向控制
   * ========================================================================== */
  const st = {
    progress: stripForcedColors(P),
    switch: stripForcedColors(S),
    table: stripForcedColors(T),
    input: stripForcedColors(I),
    skeleton: stripForcedColors(K),
  };
  const removedTotal = Object.keys(st).reduce((n, k) => n + st[k].removed, 0);

  add('C0', '反向控制前提：确实剥到了 @media 块',
    removedTotal >= 5,
    '剥掉 ' + removedTotal + ' 块（' + Object.keys(st).map(k => k + ' ' + st[k].removed).join(' / ') + '）');

  /* C1 进度条：剥掉后填充与轨道重新同色 */
  /* ⚠️ 进度条的修复有两半：media 块里的 `Highlight` + 基础规则里的
     `outline: 1px solid transparent`。只剥 media 块不算"完全回退"，
     因为透明 outline 是靠浏览器**自动显形**的，不需要 media query。 */
  const P_noOutline = st.progress.css
    .replace(/outline:\s*1px solid transparent;/g, '')
    .replace(/outline-offset:\s*-1px;/g, '');
  /* ⚠️ 断言必须匹配"带分号的声明"，不能用裸字符串：
     progress.css 的**注释里**也写着 `outline: 1px solid transparent`（解释为什么用它），
     裸 indexOf 会命中注释 ⇒ 第一版这条假红。 */
  const HAS_OUTLINE_DECL = /outline:\s*1px solid transparent\s*;/;
  add('C1', '反向控制前提：进度条的透明 outline 也已剥掉',
    !HAS_OUTLINE_DECL.test(P_noOutline) && HAS_OUTLINE_DECL.test(st.progress.css),
    '剥前有声明=' + HAS_OUTLINE_DECL.test(st.progress.css) +
    ' · 剥后还有=' + HAS_OUTLINE_DECL.test(P_noOutline) +
    ' · media 块剥了 ' + st.progress.removed + ' 块');

  await render([FIXTURE.progress], [P_noOutline]);
  await activate();
  const rTrack = await p.evaluate(probe.one, '.progress');
  const rFill = await p.evaluate(probe.one, '.progress__bar');
  add('C1b', '剥掉修复后：进度填充与轨道重新同色（判据确实在看这条规则）',
    !!(rTrack && rFill) && rFill.bg === rTrack.bg,
    '轨道 ' + (rTrack && rTrack.bg) + ' vs 填充 ' + (rFill && rFill.bg));

  add('C1c', '剥掉修复后：轨道重新没有轮廓',
    !!rTrack && (rTrack.outlineStyle === 'none' || zeroPx(rTrack.outlineW)),
    'outline ' + (rTrack && (rTrack.outlineW + ' ' + rTrack.outlineStyle)));

  /* C2 环形：剥掉后没有轮廓 */
  await render([FIXTURE.ring], [st.progress.css]);
  await activate();
  const rRing = await p.evaluate(probe.one, '.progress-ring');
  add('C2', '剥掉修复后：环形进度重新没有轮廓（渐变也已消失）',
    !!rRing && (rRing.outlineStyle === 'none' || zeroPx(rRing.outlineW)),
    'outline ' + (rRing && (rRing.outlineW + ' ' + rRing.outlineStyle)));

  /* C3 开关：剥掉 media 块**并且**把透明边框退回 0 —— 修复有两半，只剥一半不算数 */
  const S_noBorder = st.switch.css
    .replace(/border:\s*1px solid transparent;/g, 'border: 0;');
  const borderReverted = (S_noBorder.match(/border:\s*0;/g) || []).length;
  add('C3', '反向控制前提：开关的透明边框也已退回 border:0',
    borderReverted >= 1,
    '退回 ' + borderReverted + ' 处（media 块剥了 ' + st.switch.removed + ' 块）');

  await render([FIXTURE.switchOff], [S_noBorder]);
  await activate();
  const rSwOff = await p.evaluate(probe.switchOne);
  await render([FIXTURE.switchOn], [S_noBorder]);
  await activate();
  const rSwOn = await p.evaluate(probe.switchOne);

  add('C3b', '剥掉修复后：滑块重新无描边（白底白影）',
    !!rSwOff && zeroPx(rSwOff.thumbBorderW),
    'thumb border=' + (rSwOff && rSwOff.thumbBorderW));
  add('C3c', '剥掉修复后：开与关的轨道重新同色',
    !!rSwOn && !!rSwOff && rSwOn.trackBg === rSwOff.trackBg,
    '开 ' + (rSwOn && rSwOn.trackBg) + ' vs 关 ' + (rSwOff && rSwOff.trackBg));

  /* C4 排序箭头：剥掉后箭头重新和底色重合 */
  await render([FIXTURE.sort], [st.table.css]);
  await activate();
  const rSort = await p.evaluate(probe.pseudo, '.table__sort', '::after');
  add('C4', '剥掉修复后：排序箭头重新与底色重合（白底白箭头）',
    !!rSort && rSort.bg === rSort.hostBg,
    '::after ' + (rSort && rSort.bg) + ' / 宿主底 ' + (rSort && rSort.hostBg));

  /* C5 错误图标 */
  await render([FIXTURE.error], [st.input.css]);
  await activate();
  const rErr = await p.evaluate(probe.pseudo, '.field__error', '::before');
  add('C5', '剥掉修复后：错误图标重新与底色重合',
    !!rErr && rErr.bg === rErr.hostBg,
    '::before ' + (rErr && rErr.bg) + ' / 所在底 ' + (rErr && rErr.hostBg));

  /* C6 骨架屏 */
  await render([FIXTURE.skeleton], [st.skeleton.css]);
  await activate();
  const rSk = await p.evaluate(probe.one, '.skeleton');
  add('C6', '剥掉修复后：骨架屏重新与页面同色',
    !!rSk && rSk.bg === rSk.seenBg,
    '骨架 ' + (rSk && rSk.bg) + ' / 页面底 ' + (rSk && rSk.seenBg));

  /* C7 侧栏当前项：剥掉 media 块 ⇒ 行首标记消失（只剩正常态的底色与 500 字重，
     而底色在强制色下被丢掉） */
  const stShell = stripForcedColors(SH);
  await render([FIXTURE.shellNav], [stShell.css]);
  await activate();
  const navBare = await readNav();
  add('C7', '剥掉修复后：当前项重新没有圆点（标记确实来自那段 media 块）',
    navBare.every(r => zeroPx(r.beforeW) || isTransparent(r.beforeBg)),
    navBare.map(r => r.txt + ' 圆点 ' + r.beforeW + ' ' + r.beforeBg).join(' / ') +
    ' · media 块剥了 ' + stShell.removed + ' 块');

  /* C7b 🔴 关键：把**旧写法**注回去，A7b 必须能抓住它。
     只证明"删掉修复会红"还不够 —— 真正要防的回归是"有人又把透明边框预留加回来"。 */
  const OLD_RESERVE = [
    '.shell__link { border-inline-start: 3px solid transparent; }',
    '.shell__link[aria-current="page"] { border-inline-start-color: CanvasText; }',
  ].join(' ');   /* 用空格拼接：CSS 规则之间不需要换行 */
  await render([FIXTURE.shellNav], [stShell.css + OLD_RESERVE]);
  await activate();
  const navOld = await readNav();
  add('C7b', '旧写法注回去：每一项都长出 3px 左竖线（A7b 会因此变红）',
    navOld.filter(r => !zeroPx(r.bw)).length === navOld.length,
    navOld.map(r => r.txt + ' ' + r.bw).join(' / '));

  /* C8 拖放区：剥掉 `border-style: solid` ⇒ 两态线型相同（提示只剩色差） */
  const U_noStyle = U.replace(/border-style:\s*solid;\s*/g, '');
  await render([FIXTURE.upload], [U_noStyle]);
  await activate();
  const dropIdle2 = await readDrop(null);
  const dropOver2 = await readDrop('dragover');
  add('C8', '剥掉修复后：dragover 重新与 idle 同线型（判定确实在看那条声明）',
    !!dropIdle2 && !!dropOver2 && dropIdle2.bs === dropOver2.bs,
    'idle ' + (dropIdle2 && dropIdle2.bs) + ' / dragover ' + (dropOver2 && dropOver2.bs) +
    ' · 剥掉 ' + ((U.match(/border-style:\s*solid;/g) || []).length) + ' 处声明');

  await b.close();

  /* ==========================================================================
   * 输出
   * ========================================================================== */
  const GROUPS = {
    A0: '证据有效性', A1: '线形进度', A2: '环形进度', A3: '开关三态',
    A4: 'mask 图标', A5: '骨架屏', A6: '选择控件', A6b: '复选勾（反向样本）',
    A7: '侧栏当前项', A7b: '侧栏（无竖线）', A7c: '侧栏（可访问名）', A8: '拖放区状态',
    B1: '全库·currentColor 图标', B2: '全库·阴影边界', B3: '全库·伪元素图形',
    C0: '反向控制前提', C1: '反向·进度前提', C1b: '反向·进度条', C1c: '反向·进度轮廓',
    C2: '反向·环形',
    C3: '反向·开关前提', C3b: '反向·滑块', C3c: '反向·开关底色',
    C4: '反向·排序箭头', C5: '反向·错误图标', C6: '反向·骨架屏',
    C7: '反向·侧栏当前项', C7b: '反向·透明边框预留', C8: '反向·拖放区线型',
  };

  let bad = 0;
  let last = '';
  console.log('  === 强制色模式（Windows 高对比度）：信息还在不在 ===');
  console.log('  引擎 chromium / puppeteer-core / CDP Emulation.setEmulatedMedia');
  console.log('  判据只用「前景 ≠ 背景」，不断言具体 RGB（模拟色板与真机不是一套）');
  console.log('');
  rows.forEach((row) => {
    if (row.group !== last) {
      console.log('  -- ' + row.group + ' ' + (GROUPS[row.group] || '') + ' --');
      last = row.group;
    }
    if (!row.ok) bad++;
    console.log('  [' + (row.ok ? 'OK  ' : 'FAIL') + '] ' + row.label);
    console.log('        ' + row.note);
  });
  console.log('');
  console.log(bad
    ? '  ❌ ' + bad + ' 条不满足'
    : '  ✅ 全部满足：7 类实拍缺陷已闭合，37 页无同款，剥掉修复全部变红');
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
