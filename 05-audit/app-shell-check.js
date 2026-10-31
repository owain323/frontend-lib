#!/usr/bin/env node
/* LAYER: component
 * ============================================================================
 * app-shell-check.js — 应用外壳：布局契约 / 窄屏退化 / 两个坑的回归
 *
 * 🔴 为什么这个组件需要门禁
 *   它的失败方式**不是**"看起来坏了"，是"看起来完全正常，但某类用户用不了"：
 *
 *     · 主区少了 `min-width: 0` ⇒ 1280px 屏幕上一切正常，
 *       数据表多两列之后整页横滚。你会先怀疑表格，不会怀疑外壳。
 *     · 侧栏用 `position: fixed` ⇒ 桌面看着一模一样，
 *       RTL 下侧栏跑到右边而主区仍在右边留白。
 *     · 高度用 `100vh` ⇒ 桌面永远看不出问题，只有手机地址栏展开时底部被裁。
 *
 *   三条都是"在开发者的屏幕上绿、在用户的屏幕上红"。所以判据必须在
 *   **缩小视口 / 塞宽内容 / 换方向** 的条件下量，而不是量默认状态。
 *
 * 🔴 判据分四组
 *   A 结构：三段式真的成立（不是三个浮盒子）
 *   B 布局契约：min-width / sticky / 滚动容器
 *   C 窄屏：768px 以下侧栏收走且页面不横滚
 *   D 反向控制：破坏每条前提，对应判据必须变红
 *
 * ⚠️ 为什么不用 demo 页当 fixture：demo 里为了截图给 `.shell` 加了固定高度
 *    （`min-height: 26rem`），那会盖掉 `100dvh`。判据要量的是**默认形态**。
 * ========================================================================== */

'use strict';

const path = require('path');
const fs = require('fs');
const { launch } = require('./browser.js');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.FL_BASE || 'http://127.0.0.1:8000';

const FIXTURE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<link rel="stylesheet" href="${BASE}/01-tokens/tokens.css">
<link rel="stylesheet" href="${BASE}/01-tokens/typography.css">
<link rel="stylesheet" href="${BASE}/01-tokens/page.css">
<link rel="stylesheet" href="${BASE}/04-recipes/app-shell/app-shell.css">
<style>body{margin:0;font:14px/1.5 sans-serif}</style>
</head><body>

<div class="shell" id="s1">
  <header class="shell__topbar" id="topbar">
    <h1 class="shell__title">标题</h1>
    <div class="shell__topbar-end"><span>已同步</span></div>
  </header>
  <nav class="shell__side" id="side" aria-label="主导航">
    <a class="shell__brand" href="#">品牌</a>
    <ul class="shell__side-group">
      <li><a class="shell__link" id="cur" href="#" aria-current="page">总览</a></li>
      <li><a class="shell__link" href="#">实体</a></li>
    </ul>
  </nav>
  <main class="shell__main" id="main">
    <!-- 宽内容放在 .shell__content **外面**：正文栏宽（--measure-page）本身会限制
         "内容能不能撑破主区"，放进里面就测不出 min-width: 0 的作用了。 -->
    <div class="shell__scroll"><div id="wide" style="min-width:80rem;height:20px;background:#eee">宽内容 80rem</div></div>
    <div class="shell__content">
      <div style="height:1400px;background:#f6f6f6">很高的内容（让页面能滚）</div>
    </div>
  </main>
</div>

<!-- 看板变体：只有主区滚 -->
<div class="shell shell--scroll-main" id="s2" style="margin-top:40px">
  <header class="shell__topbar" id="topbar2"><h1 class="shell__title">看板</h1></header>
  <nav class="shell__side" id="side2" aria-label="看板导航">
    <a class="shell__link" href="#" aria-current="page">看板</a>
  </nav>
  <main class="shell__main" id="main2">
    <div class="shell__content"><div style="height:1400px;background:#fafafa">内容</div></div>
  </main>
</div>

</body></html>`;

/* ---------------------------------------------------------------- 探针 */

const PROBE = {
  /* 一次取齐：三段式的尺寸、sticky、滚动配置 */
  shell: (id) => {
    const s = document.getElementById(id);
    const side = s.querySelector('.shell__side');
    const top = s.querySelector('.shell__topbar');
    const main = s.querySelector('.shell__main');
    const cs = (el) => getComputedStyle(el);
    const r = (el) => el.getBoundingClientRect();
    return {
      shellW: Math.round(r(s).width),
      shellH: Math.round(r(s).height),
      sideW: Math.round(r(side).width),
      sideH: Math.round(r(side).height),
      topH: Math.round(r(top).height),
      mainW: Math.round(r(main).width),
      mainH: Math.round(r(main).height),
      sidePos: cs(side).position,
      sideAlignSelf: cs(side).alignSelf,
      sideOverflowY: cs(side).overflowY,
      sideMaxH: cs(side).maxHeight,
      sideDisplay: cs(side).display,
      topPos: cs(top).position,
      mainOverflowY: cs(main).overflowY,
      shellOverflow: cs(s).overflow,
      docScrollW: document.documentElement.scrollWidth,
      winW: window.innerWidth,
      winH: window.innerHeight,
    };
  },

  /* 当前项的三条线索 */
  current: () => {
    const a = document.getElementById('cur');
    const cs = getComputedStyle(a);
    return {
      ariaCurrent: a.getAttribute('aria-current'),
      fontWeight: cs.fontWeight,
      bg: cs.backgroundColor,
      shadow: cs.boxShadow,
      borderStartW: cs.borderInlineStartWidth,
      borderStartColor: cs.borderInlineStartColor,
      markW: getComputedStyle(a, '::before').width,
      markBg: getComputedStyle(a, '::before').backgroundColor,
      navLabel: a.closest('nav').getAttribute('aria-label'),
    };
  },

  /* 同一导航里的所有项 —— 判据要看"当前项与其它项的差别"，只看当前项会漏掉
     "每一项都被标记"这种回归（0.22.1 的强制色缺陷正是这一种）。 */
  navScan: () => {
    const a = document.getElementById('cur');
    const nav = a.closest('nav');
    return Array.prototype.slice.call(nav.querySelectorAll('.shell__link')).map((x) => {
      const cs = getComputedStyle(x);
      const b = getComputedStyle(x, '::before');
      return {
        txt: (x.textContent || '').trim().slice(0, 6),
        cur: x.getAttribute('aria-current') === 'page',
        fw: parseInt(cs.fontWeight, 10) || 0,
        bw: parseFloat(cs.borderInlineStartWidth) || 0,
        markW: parseFloat(b.width) || 0,
        markBg: b.backgroundColor,
      };
    });
  },

  /* 反例改造 ①：只去掉滚动容器的 overflow（模拟"忘了包 .shell__scroll"） */
  killScroller: () => {
    const w = document.querySelector('#main .shell__scroll');
    if (w) w.style.overflowX = 'visible';
    return {
      docScrollW: document.documentElement.scrollWidth,
      winW: window.innerWidth,
      mainW: Math.round(document.getElementById('main').getBoundingClientRect().width),
    };
  },

  /* 反例改造 ②：把轨道从 `minmax(0, 1fr)` 换成 `1fr`（= 轨道的最小值退回 auto）。
     此时**只有** `.shell__main { min-width: 0 }` 还能兜住 —— 用来证明它真的在起作用。 */
  dropMinmax: () => {
    const s = document.getElementById('s1');
    s.style.gridTemplateColumns = '15rem 1fr';
    const m = document.getElementById('main');
    return {
      mainW: Math.round(m.getBoundingClientRect().width),
      avail: window.innerWidth - Math.round(document.getElementById('side').getBoundingClientRect().width),
      minWidth: getComputedStyle(m).minWidth,
    };
  },

  /* 反例改造 ③：再把 `min-width: 0` 也去掉（两个保险都拆掉） */
  killMinWidth: () => {
    const m = document.getElementById('main');
    m.style.minWidth = 'auto';
    return {
      mainW: Math.round(m.getBoundingClientRect().width),
      minWidth: getComputedStyle(m).minWidth,
    };
  },

  /* 反例改造：侧栏改 fixed */
  makeFixed: () => {
    const s = document.getElementById('side');
    s.style.position = 'fixed';
    s.style.insetBlockStart = '0';
    s.style.insetInlineStart = '0';
    return getComputedStyle(s).position;
  },
};

/* ------------------------------------------------------------ 窄屏导航 fixture
 * F 组把 4 份文本直接内联进 fixture（不走 <link> / <script src>）。
 * 理由：反向控制要**改写文本再重渲染**（剥掉一条规则 / 一行监听），
 *      比对运行时状态更接近"代码真的变了"。
 *
 * ⚠️ 内联必须转义 `</script` / `</style`：CSS/JS 里只要出现一次，
 *    HTML 解析器就会提前闭合标签，后面整段变成页面上的文字 ——
 *    症状是"样式没生效 / 事件没绑上"，而源码看起来完全正确。
 */
function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

const NAV_TEXT = {
  tokens: readText('01-tokens/tokens.css'),
  typo: readText('01-tokens/typography.css'),
  appShellCss: readText('04-recipes/app-shell/app-shell.css'),
  drawerCss: readText('03-patterns/drawer/drawer.css'),
  drawerJs: readText('03-patterns/drawer/drawer.js'),
  shellNavJs: readText('04-recipes/app-shell/shell-nav.js'),
};

function inlineSafe(s) {
  return s.replace(/<\/(script|style)/gi, '<\\/$1');
}

function navFixture(opt) {
  const o = opt || {};
  const css = o.appShellCss || NAV_TEXT.appShellCss;
  const js = o.shellNavJs || NAV_TEXT.shellNavJs;
  const withDrawer = o.withDrawer !== false;

  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<style>' + inlineSafe(NAV_TEXT.tokens) + '</style>' +
    '<style>' + inlineSafe(NAV_TEXT.typo) + '</style>' +
    '<style>body{margin:0;font:14px/1.5 sans-serif}</style>' +
    '<style>' + inlineSafe(css) + '</style>' +
    '<style>' + inlineSafe(NAV_TEXT.drawerCss) + '</style>' +
    '</head><body>' +

    '<div class="shell" id="n1" data-shell-nav="主导航">' +
      '<header class="shell__topbar" id="ntop"><h1 class="shell__title">标题</h1>' +
        '<div class="shell__topbar-end"><span>已同步</span></div></header>' +
      '<nav class="shell__side" id="nside" aria-label="主导航">' +
        '<a class="shell__brand" href="#">品牌</a>' +
        '<ul class="shell__side-group">' +
          '<li><a class="shell__link" id="cur" href="#" aria-current="page">总览</a></li>' +
          '<li><a class="shell__link" href="#">实体</a></li>' +
          '<li><a class="shell__link" href="#">勾稽校验</a></li>' +
        '</ul>' +
      '</nav>' +
      '<main class="shell__main" id="nmain"><div class="shell__content">内容</div></main>' +
    '</div>' +

    /* 没 opt-in 的外壳：一个按钮都不该被注入（别人的顶栏布局不该被悄悄改） */
    '<div class="shell" id="n2" style="margin-top:24px">' +
      '<header class="shell__topbar"><h1 class="shell__title">没有 opt-in</h1></header>' +
      '<nav class="shell__side" aria-label="侧栏"><a class="shell__link" href="#">一</a></nav>' +
      '<main class="shell__main"><div class="shell__content">内容</div></main>' +
    '</div>' +

    (withDrawer ? '<script>' + inlineSafe(NAV_TEXT.drawerJs) + '</script>' : '') +
    '<script>' + inlineSafe(js) + '</script>' +
    '</body></html>';
}

/* 图标态（rail）的 fixture。
 * ----------------------------------------------------------------------------
 * 🔴 这里**故意不写 `title`**：`title` 会在没有内容时兜出一个可访问名，
 *    于是「把 `.shell__link-label` 改成 display:none」这种破坏会被它盖住 ——
 *    G4 就永远红不了（判据是装饰）。demo 页面写 title 是给鼠标用户的提示，
 *    与"名字从哪来"是两件事。
 * 🔴 用内联 SVG 而不是 <img>：`<img>` 需要 alt 才能不出噪声，而这里要证的正是
 *    名字只来自那个 span。 */
function railFixture(opt) {
  const o = opt || {};
  const css = o.appShellCss || NAV_TEXT.appShellCss;

  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<style>' + inlineSafe(NAV_TEXT.tokens) + '</style>' +
    '<style>' + inlineSafe(NAV_TEXT.typo) + '</style>' +
    '<style>body{margin:0;font:14px/1.5 sans-serif}</style>' +
    '<style>' + inlineSafe(css) + '</style>' +
    '<style>' + inlineSafe(NAV_TEXT.drawerCss) + '</style>' +
    '</head><body>' +

    '<div class="shell shell--rail" id="r1" data-shell-nav="图标导航">' +
      '<header class="shell__topbar"><h1 class="shell__title">图标导航</h1></header>' +
      '<nav class="shell__side" aria-label="图标导航">' +
        '<ul class="shell__side-group">' +
          '<li><a class="shell__link" id="rcur" href="#" aria-current="page">' +
            '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
              '<path d="M2 2h5v5H2z"/></svg>' +
            '<span class="shell__link-label">总览</span></a></li>' +
          '<li><a class="shell__link" href="#">' +
            '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
              '<path d="M2 8h12"/></svg>' +
            '<span class="shell__link-label">实体</span></a></li>' +
        '</ul>' +
      '</nav>' +
      '<main class="shell__main"><div class="shell__content">内容</div></main>' +
    '</div>' +

    '<script>' + inlineSafe(NAV_TEXT.drawerJs) + '</script>' +
    '<script>' + inlineSafe(NAV_TEXT.shellNavJs) + '</script>' +
    '</body></html>';
}

/* 窄屏导航的探针（全部在页面内执行） */
const NAV_PROBE = {
  /** 外壳 + 按钮 + 侧栏的当前状态 */
  shell: () => {
    const root = document.getElementById('n1');
    const btn = root.querySelector('.shell__menu');
    const side = root.querySelector('.shell__side');
    const top = root.querySelector('.shell__topbar');
    const r = btn ? btn.getBoundingClientRect() : null;
    return {
      instance: !!root.shellNavInstance,
      disabled: !!(root.shellNavInstance && root.shellNavInstance.disabled),
      btn: !!btn,
      btnVisible: !!btn && btn.offsetParent !== null,
      btnFirst: !!btn && top.firstElementChild === btn,
      btnLabel: btn && btn.getAttribute('aria-label'),
      btnPopup: btn && btn.getAttribute('aria-haspopup'),
      btnSize: r ? [Math.round(r.width), Math.round(r.height)] : null,
      sideDisplay: side ? getComputedStyle(side).display : null,
      /* 没 opt-in 的那个外壳有没有被误加按钮 */
      otherButtons: document.querySelectorAll('#n2 .shell__menu').length,
    };
  },

  /** 打开后的抽屉：结构 / 内容可见性 / 焦点 / id 去重 */
  dialog: () => {
    const host = document.querySelector('[data-drawer-host]');
    const d = host && host.querySelector('[role="dialog"]');
    if (!d) return { dialog: false };
    const links = [].slice.call(d.querySelectorAll('a'));
    const cur = d.querySelector('[aria-current="page"]');
    const rect = (n) => {
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height)];
    };
    const outside = [].slice.call(document.querySelectorAll('[id]'))
      .filter((n) => !host.contains(n)).map((n) => n.id);
    return {
      dialog: true,
      modal: d.getAttribute('aria-modal'),
      named: !!(d.getAttribute('aria-labelledby') || d.getAttribute('aria-label')),
      title: (d.querySelector('.drawer__title') || {}).textContent,
      linkCount: links.length,
      /* 只数"真的占位"的链接：display:none 的克隆会有 0 尺寸 */
      visibleLinks: links.filter((a) => a.offsetParent !== null && a.getBoundingClientRect().height > 0).length,
      hasCurrent: !!cur,
      curSize: rect(cur),
      dupIds: [].slice.call(d.querySelectorAll('[id]')).map((n) => n.id)
        .filter((i) => outside.indexOf(i) >= 0),
      focusInDialog: !!(document.activeElement && d.contains(document.activeElement)),
      focusIsCurrent: !!cur && document.activeElement === cur,
      bgInert: (function () {
        const kids = [].slice.call(document.body.children).filter((n) =>
          n !== host && n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE');
        return kids.length > 0 && kids.every((n) => n.inert === true);
      })(),
      bodyOverflow: document.body.style.overflow,
    };
  },

  /** 关闭后的复位情况 */
  afterClose: () => {
    const root = document.getElementById('n1');
    const btn = root.querySelector('.shell__menu');
    return {
      gone: !document.querySelector('[data-drawer-host]'),
      focusOnBtn: document.activeElement === btn,
      bodyOverflow: document.body.style.overflow,
      anyInert: [].slice.call(document.body.children).some((n) => n.inert === true),
    };
  },
};

/* 图标态（rail）的探针：桌面那份 vs 抽屉里那份 */
const RAIL_PROBE = {
  rail: () => {
    const link = document.getElementById('rcur');
    const label = link.querySelector('.shell__link-label');
    const icon = link.querySelector('svg');
    const lb = label.getBoundingClientRect();
    const lk = link.getBoundingClientRect();
    const ib = icon.getBoundingClientRect();
    const cs = getComputedStyle(label);
    const side = document.getElementById('r1').querySelector('.shell__side');
    return {
      linkSize: [Math.round(lk.width), Math.round(lk.height)],
      labelText: label.textContent,
      labelSize: [Math.round(lb.width), Math.round(lb.height)],
      labelDisplay: cs.display,
      sideW: Math.round(side.getBoundingClientRect().width),
      /* 图标中心与链接中心的偏差：文字若真的参与布局，图标会被挤偏 */
      iconOffset: Math.round((ib.left + ib.width / 2) - (lk.left + lk.width / 2)),
    };
  },

  drawer: () => {
    const d = document.querySelector('[data-drawer-host] [role="dialog"]');
    if (!d) return { dialog: false };
    const link = d.querySelector('.shell__link');
    const label = link && link.querySelector('.shell__link-label');
    const r = (n) => {
      const b = n.getBoundingClientRect();
      return [Math.round(b.width), Math.round(b.height)];
    };
    return {
      dialog: true,
      linkW: link ? Math.round(link.getBoundingClientRect().width) : 0,
      labelSize: label ? r(label) : null,
      labelText: label ? label.textContent : null,
      /* 抽屉挂在 <body> 下 ⇒ 克隆不在 `.shell--rail` 里面。
         这一条是"文字自己回来"的**机制本身**，不是顺带一提。 */
      insideRail: !!(link && link.closest('.shell--rail')),
      /* label 与图标的横向关系：文字应该排在图标后面，而不是压在图标上 */
      labelAfterIcon: (function () {
        if (!link || !label) return null;
        const icon = link.querySelector('svg');
        if (!icon) return null;
        return Math.round(label.getBoundingClientRect().left -
          icon.getBoundingClientRect().right);
      })(),
    };
  },
};

/* ---------------------------------------------------------------- 主流程 */

(async () => {
  const rows = [];
  const add = (group, label, ok, note) => rows.push({ group, label, ok: !!ok, note: note || '' });

  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 900 });

  /* E172：先确认 8000 上是门禁服务器（不是给人看 demo 的单线程那个） */
  const alive = await p.goto(BASE + '/04-recipes/app-shell/demo.html',
    { waitUntil: 'domcontentloaded', timeout: 15000 })
    .then(() => p.evaluate(() => document.title)).catch(() => '');
  if (!alive) {
    console.error('  ❌ 服务不可达：' + BASE + '（先用 python 05-audit/http-serve.py 8000 起服务）');
    process.exit(2);
  }

  await p.setContent(FIXTURE, { waitUntil: 'load', timeout: 20000 });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.evaluate(() => {
    document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) {} });
  });

  /* ==========================================================================
   * A 组 · 结构（三段式真的成立）
   * ========================================================================== */
  const s1 = await p.evaluate(PROBE.shell, 's1');

  add('A1', '三段式真的成立：侧栏有宽、顶栏有高、主区占剩余宽',
    s1.sideW > 100 && s1.topH > 30 && s1.mainW > 0 &&
    Math.abs(s1.sideW + s1.mainW - s1.shellW) <= 1,
    'shell=' + s1.shellW + ' · side=' + s1.sideW + ' + main=' + s1.mainW +
    ' = ' + (s1.sideW + s1.mainW) + ' · topbar h=' + s1.topH);

  const cur = await p.evaluate(PROBE.current);
  add('A2', '当前页用 aria-current="page"（不是只有 class）',
    cur.ariaCurrent === 'page',
    'aria-current=' + cur.ariaCurrent);

  add('A3', '当前页有三条线索（竖条 + 底色 + 字重），不只靠颜色',
    parseFloat(cur.fontWeight) >= 500 && cur.shadow !== 'none' && cur.bg !== 'rgba(0, 0, 0, 0)',
    '字重=' + cur.fontWeight + ' 底色=' + cur.bg + ' 竖条=' + (cur.shadow !== 'none' ? '有' : '无'));

  add('A4', '侧栏是带名字的 <nav>（页面上可能还有第二个 nav）',
    !!cur.navLabel,
    'aria-label="' + cur.navLabel + '"');

  /* ==========================================================================
   * B 组 · 布局契约
   * ========================================================================== */

  /* B1 主区不被撑破（= min-width: 0 生效）。
     🔴 与 B1b 是**两件**事，必须分开判：
        · 缺 min-width: 0 ⇒ grid 轨道被内容的最小宽度顶开，主区变宽、侧栏被挤走
        · 缺 .shell__scroll ⇒ 主区宽度正常，但内容溢出到页面上，整页横滚
        两者症状都是"横滚"，但病灶不同，修法也不同 —— 合在一条里会让
        "改对一个、另一个还坏"也显示绿。 */
  add('B1', '主区不被 80rem 宽内容撑破（min-width: 0 生效，轨道不被顶开）',
    s1.mainW <= s1.shellW - s1.sideW + 1,
    'main=' + s1.mainW + ' ≤ 可用 ' + (s1.shellW - s1.sideW));

  add('B1b', '页面不横滚（宽内容落在 .shell__scroll 里自己滚）',
    s1.docScrollW <= s1.winW,
    'docScrollW=' + s1.docScrollW + ' vs winW=' + s1.winW);

  /* B2 侧栏 sticky + align-self: start（缺一不可，缺了粘不住） */
  add('B2', '侧栏 sticky 且 align-self: start（stretch 会让"粘住"无从谈起）',
    s1.sidePos === 'sticky' && s1.sideAlignSelf === 'start',
    'position=' + s1.sidePos + ' align-self=' + s1.sideAlignSelf);

  /* B3 侧栏自己滚 */
  add('B3', '侧栏自己滚（max-height + overflow-y: auto），不把主区一起滚走',
    s1.sideOverflowY === 'auto' && s1.sideMaxH !== 'none',
    'overflow-y=' + s1.sideOverflowY + ' max-height=' + s1.sideMaxH);

  /* B4 顶栏 sticky */
  add('B4', '顶栏 sticky（长表单滚到一半还看得见"保存"）',
    s1.topPos === 'sticky',
    'position=' + s1.topPos);

  /* B5 滚动落在页面而不是主区（默认形态） */
  add('B5', '默认形态：滚动由页面承担，主区不自己滚',
    s1.mainOverflowY === 'visible' && s1.shellOverflow === 'visible',
    'main overflow-y=' + s1.mainOverflowY + ' · shell overflow=' + s1.shellOverflow);

  /* B6 看板变体：反过来，只有主区滚 */
  const s2 = await p.evaluate(PROBE.shell, 's2');
  add('B6', '看板变体：只有主区滚（侧栏与顶栏不滚），且 shell 自己锁住高度',
    s2.mainOverflowY === 'auto' && s2.shellOverflow === 'hidden' &&
    s2.sidePos === 'static' && s2.topPos === 'static',
    'main overflow-y=' + s2.mainOverflowY + ' · shell overflow=' + s2.shellOverflow +
    ' · side=' + s2.sidePos + ' · topbar=' + s2.topPos);

  /* B7 dvh 顺序：文本判据（dvh 必须在 vh 之后，否则退化）。
     ⚠️ 计算样式量不出来 —— `min-height: 100vh` 和 `100dvh` 在桌面浏览器上
        解析成同一个数，只有"顺序"能表达意图。所以这条必须读源码。 */
  const cssText = fs.readFileSync(path.join(ROOT, '04-recipes/app-shell/app-shell.css'), 'utf-8');
  const iVh = cssText.indexOf('min-height: 100vh;');
  const iDvh = cssText.indexOf('min-height: 100dvh;');
  add('B7', 'dvh 兜底写在 vh **之后**（反了就在不支持的引擎上永远走 dvh 的无效行）',
    iVh >= 0 && iDvh > iVh,
    'vh 在第 ' + (iVh + 1) + ' 字符 · dvh 在第 ' + (iDvh + 1) + ' 字符' +
    (iDvh > iVh ? ' · 顺序正确' : ' · ⚠️ 顺序反了'));

  /* ==========================================================================
   * C 组 · 窄屏退化
   * ========================================================================== */
  await p.setViewport({ width: 375, height: 700 });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const n1 = await p.evaluate(PROBE.shell, 's1');

  add('C1', '窄屏（375px）：侧栏整列收走',
    n1.sideDisplay === 'none',
    'display=' + n1.sideDisplay + ' · sideW=' + n1.sideW);

  add('C2', '窄屏：主区铺满且**不横滚**（收走侧栏不只是 display:none，列也要变成一列）',
    n1.docScrollW <= n1.winW && n1.mainW > 0,
    'docScrollW=' + n1.docScrollW + ' vs winW=' + n1.winW + ' · main=' + n1.mainW);

  add('C3', '窄屏：顶栏还在（导航收走不能连标题一起没了）',
    n1.topH > 30,
    'topbar h=' + n1.topH);

  /* 返回宽屏，确认侧栏回来 */
  await p.setViewport({ width: 1280, height: 900 });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const w1 = await p.evaluate(PROBE.shell, 's1');
  add('C4', '宽屏恢复：侧栏回到 15rem（不是"缩窄过就回不来了"）',
    w1.sideDisplay !== 'none' && w1.sideW > 100,
    'display=' + w1.sideDisplay + ' sideW=' + w1.sideW);

  /* ==========================================================================
   * D 组 · 强制色
   * ========================================================================== */
  const cdp = await p.target().createCDPSession();
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'forced-colors', value: 'active' }],
  });
  await p.evaluate(() => {
    document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) {} });
  });
  const fc = await p.evaluate(PROBE.current);

  /* 🔴 0.22.1 换了实现：原来靠 "给所有项预留 3px 透明边框 + 当前项换实色"，
     实测强制色会把透明边框也解析成实线 ⇒ 每一项都长出一条竖线。
     现在的契约是**零边框 + 字重 700 + 系统色圆点**（两条非颜色线索）。 */
  add('D1', '强制色：当前项靠非颜色线索区分（字重 700 + 系统色圆点），且不靠边框',
    parseFloat(fc.fontWeight) >= 700 && parseFloat(fc.markW) > 0 &&
      fc.markBg !== 'rgba(0, 0, 0, 0)' && parseFloat(fc.borderStartW) === 0,
    'fw=' + fc.fontWeight + ' 圆点=' + fc.markW + ' ' + fc.markBg +
    ' · 左边框=' + fc.borderStartW);

  const fcLinks = await p.evaluate(PROBE.navScan);
  add('D1b', '强制色：同一导航里只有当前项带圆点，且没有任何项带左竖线',
    fcLinks.filter((x) => x.cur).length === 1 &&
      fcLinks.filter((x) => !x.cur).every((x) => x.markW === 0 || x.markBg === 'rgba(0, 0, 0, 0)') &&
      fcLinks.every((x) => x.bw === 0),
    fcLinks.map((x) => x.txt + (x.cur ? '*' : '') + ' fw=' + x.fw + ' 点=' + x.markW +
      ' 边=' + x.bw).join(' / '));

  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await p.evaluate(() => {
    document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) {} });
  });

  /* ==========================================================================
   * E 组 · 反向控制
   * ========================================================================== */

  /* E1 只去掉滚动容器 ⇒ 页面横滚（B1b 会红），但主区宽度不变（B1 仍绿）
     —— 这正是"两者是两件事"的证据。 */
  const e1 = await p.evaluate(PROBE.killScroller);
  add('E1', '反向：只去掉 .shell__scroll 的 overflow ⇒ 页面横滚（B1b 红），主区宽度不变（B1 仍绿）',
    e1.docScrollW > e1.winW && e1.mainW <= w1.shellW - w1.sideW + 1,
    'docScrollW=' + e1.docScrollW + ' > winW=' + e1.winW +
    ' · main 仍=' + e1.mainW + '（没被撑破）⇒ 两条判据各自独立');

  /* E1b 只改轨道（去掉 minmax） ⇒ min-width: 0 单独就能兜住。
     🔴 这一条是 B1 之所以值得写的证据：证明 `.shell__main { min-width: 0 }`
        不是"抄来的样板"，它确实在 `git` 之外独立挡着一次真实的撑破。 */
  const e1b = await p.evaluate(PROBE.dropMinmax);
  add('E1b', '反向：轨道换成 `1fr`（去掉 minmax(0,…)）⇒ min-width: 0 单独兜住，主区仍不被撑破',
    e1b.mainW <= (await p.evaluate(() => window.innerWidth)) - 240 + 1 && e1b.minWidth === '0px',
    '轨道无 minmax 时 main=' + e1b.mainW + '（min-width=' + e1b.minWidth + '）⇒ 没被顶开');

  /* E1c 两个保险都拆掉 ⇒ 主区被撑破（B1 红） */
  const e1c = await p.evaluate(PROBE.killMinWidth);
  add('E1c', '反向：再把 min-width 也去掉 ⇒ 主区被撑破（B1 红）',
    e1c.mainW > 1040 + 1,
    'main=' + e1c.mainW + ' > 可用 1040（min-width=' + e1c.minWidth + '）⇒ 轨道被内容顶开');

  /* E2 侧栏改 fixed ⇒ position 不再是 sticky（B2 会红） */
  const e2 = await p.evaluate(PROBE.makeFixed);
  add('E2', '反向：侧栏改 position: fixed ⇒ B2 的 sticky 判据会判失败',
    e2 === 'fixed',
    'position=' + e2);

  /* E3 窄屏下强行让侧栏可见 ⇒ 主区被挤窄（C1 会红） */
  await p.setViewport({ width: 375, height: 700 });
  const e3 = await p.evaluate(() => {
    const s = document.getElementById('side');
    s.style.display = 'flex';           /* 强行让它回来，模拟"忘了写窄屏规则" */
    const r = s.getBoundingClientRect();
    return { display: getComputedStyle(s).display, w: Math.round(r.width) };
  });
  add('E3', '反向：窄屏下强行显示侧栏 ⇒ C1 会判失败（display 不再是 none）',
    e3.display !== 'none' && e3.w > 0,
    'display=' + e3.display + ' 宽=' + e3.w + ' ⇒ 375px 视口里挤掉一大块');

  /* ==========================================================================
   * F 组 · 窄屏导航的接线（shell-nav.js + drawer.js）
   * ==========================================================================
   * 🔴 这一层为什么也要门禁
   *   它坏起来不"难看"，是让人**走不出去**：
   *     · 抽屉里是空的（克隆继承了窄屏的 display: none）—— 看起来像"点开一个白框"
   *     · 焦点没进抽屉 ⇒ 背景已 inert ⇒ Tab 无处可去；Esc 的监听挂在抽屉上，
   *       也收不到 ⇒ 键盘用户被困在一个关不掉的模态里
   *   两条都只在键盘 / 手机上现形，鼠标用户看到的一切都正常。
   */
  async function renderNav(opt) {
    await p.setViewport({ width: 1200, height: 900 });
    /* 🔴 先真的导航一次。`setContent` 在已有文档上是 document.write ——
       **window 不会换**，于是上一次渲染定义的 `window.Drawer` 还在。
       后果：F11（缺 drawer.js 应拒绝初始化）永远测不出来 ——
       它会拿上一轮的 Drawer 继续工作，而判据看起来"通过了"。 */
    await p.goto('about:blank', { waitUntil: 'load', timeout: 10000 });
    await p.setContent(navFixture(opt), { waitUntil: 'load', timeout: 20000 });
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await p.waitForFunction(() => {
      const n = document.getElementById('n1');
      return !!(n && n.shellNavInstance);
    }, { timeout: 5000 }).catch(() => {});
  }

  async function renderRail(opt) {
    await p.setViewport({ width: 1200, height: 900 });
    /* 与 renderNav 同一个理由：setContent 不换 window（E183） */
    await p.goto('about:blank', { waitUntil: 'load', timeout: 10000 });
    await p.setContent(railFixture(opt), { waitUntil: 'load', timeout: 20000 });
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await p.waitForFunction(() => {
      const n = document.getElementById('r1');
      return !!(n && n.shellNavInstance);
    }, { timeout: 5000 }).catch(() => {});
  }

  /* 🔴 可访问名要问浏览器，不能数 DOM 里的字。
     `display: none` 的文字照样有 `textContent`，但它在可访问树里不存在 ——
     G4 证的就是这个差别。走 CDP 的 `Accessibility.getPartialAXTree`：
     返回的 `name.value` 就是读屏会念的那串字。
     （`cdp` 复用 D 组建的那个会话：同一个 target，强制色已复位。） */
  async function axName(selector) {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: 'document.querySelector(' + JSON.stringify(selector) + ')',
    });
    if (!result || !result.objectId) return null;
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
      objectId: result.objectId, fetchRelatives: false,
    });
    const n = nodes && nodes[0];
    return n && n.name ? n.name.value : null;
  }

  await renderNav();

  const f1 = await p.evaluate(NAV_PROBE.shell);
  add('F1', '宽屏：opt-in 后按钮已注入（顶栏首位 / aria-haspopup / 名字取自 data-shell-nav），但不可见',
    f1.instance && f1.btn && f1.btnFirst && f1.btnPopup === 'dialog' &&
      f1.btnLabel === '打开主导航' && !f1.btnVisible,
    'instance=' + f1.instance + ' 首位=' + f1.btnFirst + ' 名字="' + f1.btnLabel +
      '" haspopup=' + f1.btnPopup + ' 可见=' + f1.btnVisible);

  add('F1b', '宽屏：侧栏仍可见（按钮只是待命，不替代侧栏）',
    f1.sideDisplay !== 'none',
    'side display=' + f1.sideDisplay);

  add('F1c', '没有 data-shell-nav 的外壳一个按钮都不注入（opt-in 生效，别人的顶栏不被改）',
    f1.otherButtons === 0,
    '#n2 里的 .shell__menu 数量=' + f1.otherButtons);

  /* ---- 窄屏：按钮出现 ---- */
  await p.setViewport({ width: 375, height: 700 });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const f2 = await p.evaluate(NAV_PROBE.shell);
  add('F2', '窄屏：菜单按钮出现且热区 ≥44×44，侧栏已收走',
    f2.btnVisible && f2.sideDisplay === 'none' &&
      !!f2.btnSize && f2.btnSize[0] >= 44 && f2.btnSize[1] >= 44,
    '可见=' + f2.btnVisible + ' 尺寸=' + JSON.stringify(f2.btnSize) + ' side=' + f2.sideDisplay);

  /* ---- 点开 ---- */
  await p.click('#n1 .shell__menu');
  await new Promise((r) => setTimeout(r, 320));
  const f3 = await p.evaluate(NAV_PROBE.dialog);

  add('F3', '点开：出现 role=dialog + aria-modal + 有名字，标题取自 data-shell-nav',
    f3.dialog && f3.modal === 'true' && f3.named && f3.title === '主导航',
    'dialog=' + f3.dialog + ' modal=' + f3.modal + ' 有名字=' + f3.named +
      ' 标题="' + f3.title + '"');

  add('F4', '抽屉里是侧栏的**可见**克隆（窄屏的 display:none 不该跟着克隆过去）',
    f3.linkCount === 4 && f3.visibleLinks === 4,
    '链接 ' + f3.linkCount + ' 个，其中真的占位 ' + f3.visibleLinks + ' 个');

  add('F5', '克隆保留了 aria-current：当前页标记跟着过去，且真的有尺寸',
    f3.hasCurrent && !!f3.curSize && f3.curSize[1] > 0,
    'hasCurrent=' + f3.hasCurrent + ' 尺寸=' + JSON.stringify(f3.curSize));

  add('F6', '克隆里没有与文档重复的 id（否则 aria-labelledby / label[for] 会指到隐藏那份）',
    f3.dupIds.length === 0,
    '重复 id=' + JSON.stringify(f3.dupIds));

  add('F7', '初始焦点落在「当前页」且在抽屉内；背景已 inert、已锁滚动',
    f3.focusInDialog && f3.focusIsCurrent && f3.bgInert && f3.bodyOverflow === 'hidden',
    '焦点在抽屉内=' + f3.focusInDialog + ' 焦点=当前页 ' + f3.focusIsCurrent +
      ' 背景 inert=' + f3.bgInert + ' body.overflow="' + f3.bodyOverflow + '"');

  /* ---- Esc ---- */
  await p.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 460));
  const f4 = await p.evaluate(NAV_PROBE.afterClose);
  add('F8', 'Esc ⇒ 遮罩消失、焦点回到菜单按钮、锁滚动与 inert 全部复位',
    f4.gone && f4.focusOnBtn && f4.bodyOverflow === '' && !f4.anyInert,
    '消失=' + f4.gone + ' 焦点回按钮=' + f4.focusOnBtn +
      ' overflow="' + f4.bodyOverflow + '" 残留 inert=' + f4.anyInert);

  /* ---- 点链接先关 ---- */
  await p.click('#n1 .shell__menu');
  await new Promise((r) => setTimeout(r, 320));
  await p.evaluate(() => {
    /* 用 click() 而不是鼠标坐标：抽屉里的链接可能被遮罩动画盖住一瞬间 */
    const a = document.querySelector('[data-drawer-host] a[href]');
    if (a) a.click();
  });
  await new Promise((r) => setTimeout(r, 460));
  const f5 = await p.evaluate(() => ({
    gone: !document.querySelector('[data-drawer-host]'),
    overflow: document.body.style.overflow,
  }));
  add('F9', '点抽屉里的链接 ⇒ 先关掉抽屉（SPA 里不关会留一个盖住页面、还锁着焦点的遮罩）',
    f5.gone && f5.overflow === '',
    '消失=' + f5.gone + ' overflow="' + f5.overflow + '"');

  /* ---- 开着的抽屉遇到窗口变宽 ---- */
  await p.click('#n1 .shell__menu');
  await new Promise((r) => setTimeout(r, 320));
  const f6a = await p.evaluate(() => !!document.querySelector('[data-drawer-host]'));
  await p.setViewport({ width: 1200, height: 900 });
  await new Promise((r) => setTimeout(r, 460));
  const f6b = await p.evaluate(() => ({
    open: !!document.querySelector('[data-drawer-host]'),
    overflow: document.body.style.overflow,
    btnVisible: (function () {
      const b = document.querySelector('#n1 .shell__menu');
      return !!b && b.offsetParent !== null;
    })(),
    sideVisible: getComputedStyle(document.querySelector('#n1 .shell__side')).display !== 'none',
  }));
  add('F10', '开着抽屉把窗口拉宽 ⇒ 抽屉自动关闭（否则两个导航同时在场）',
    f6a && !f6b.open && f6b.overflow === '' && !f6b.btnVisible && f6b.sideVisible,
    '打开过=' + f6a + ' 拉宽后还开着=' + f6b.open + ' 按钮仍可见=' + f6b.btnVisible +
      ' 侧栏回来了=' + f6b.sideVisible);

  /* ---- 缺依赖：不许造"点了没反应"的按钮 ---- */
  const msgs = [];
  const onMsg = (m) => msgs.push({ type: m.type(), text: m.text() });
  p.on('console', onMsg);
  await renderNav({ withDrawer: false });
  await new Promise((r) => setTimeout(r, 260));
  const f7 = await p.evaluate(NAV_PROBE.shell);
  p.off('console', onMsg);
  /* ⚠️ 级别名在 puppeteer 各版本里是 'warning'，CDP 原生是 'warn' ——
     两边都收，别让一个字符串拼写决定这条判据的真假。 */
  const isWarn = (t) => t === 'warning' || t === 'warn';
  const warned = msgs.some((m) => isWarn(m.type) && m.text.indexOf('drawer.js') >= 0);
  add('F11', '缺 drawer.js ⇒ 不注入按钮，并 warn 点名缺什么（宁可没按钮，也不要点不动的按钮）',
    f7.instance && f7.disabled && !f7.btn && warned,
    '按钮=' + f7.btn + ' 已停用=' + f7.disabled + ' 点名警告=' + warned +
      (msgs.length ? ' · "' + msgs[0].text.slice(0, 46) + '…"' : ''));

  /* ---- 图标态（rail）：桌面是图标，抽屉里要补回文字 ---- */
  await renderRail();
  const r1 = await p.evaluate(RAIL_PROBE.rail);
  const r1name = await axName('#rcur');

  add('F12', 'rail：文字视觉隐藏（1×1，且不是 display:none），可访问名仍是「总览」',
    r1.labelSize[0] <= 2 && r1.labelSize[1] <= 2 && r1.labelDisplay !== 'none' &&
      r1name === '总览',
    '标签 ' + r1.labelSize.join('×') + ' display=' + r1.labelDisplay +
      ' 名字="' + r1name + '"（DOM 里的字="' + r1.labelText + '"）');

  add('F13', 'rail：文字不参与布局 —— 图标仍在 44px 命中区里居中，侧栏仍是 4.5rem',
    Math.abs(r1.iconOffset) <= 1 && r1.linkSize[0] <= 48 && Math.abs(r1.sideW - 72) <= 1,
    '图标偏移=' + r1.iconOffset + 'px 链接宽=' + r1.linkSize[0] +
      ' 侧栏宽=' + r1.sideW + 'px（文字参与布局会把图标挤偏）');

  await p.setViewport({ width: 375, height: 700 });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.click('#r1 .shell__menu');
  await new Promise((r) => setTimeout(r, 320));
  const r2 = await p.evaluate(RAIL_PROBE.drawer);
  const r2name = await axName('[data-drawer-host] .shell__link');

  add('F14', '抽屉：同一份标记自动恢复文字（克隆离开 .shell--rail 作用域），名字仍是「总览」',
    r2.dialog && !r2.insideRail && r2.linkW > 100 &&
      !!r2.labelSize && r2.labelSize[0] > 20 && r2.labelSize[1] > 10 &&
      r2.labelAfterIcon > 0 && r2name === '总览',
    '在 rail 作用域内=' + r2.insideRail + ' 链接宽=' + r2.linkW +
      ' 标签=' + JSON.stringify(r2.labelSize) + ' 与图标间距=' + r2.labelAfterIcon +
      'px 名字="' + r2name + '"');

  await p.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 420));

  /* ==========================================================================
   * G 组 · 反向控制：把接线拆掉，对应的 F 判据必须变红
   * ==========================================================================
   * 三条都用**改文本 + 重渲染**，不是改运行时状态 ——
   * 判据要证的是"这段代码有用"，而不是"我能把它掰弯"。
   */
  const MUT = {
    /* G1：窄屏那条 `display: inline-flex` */
    menuRule: '  .shell__menu {\n    display: inline-flex;\n  }',
    /* G2：resize 监听那一行 */
    resize: '    global.addEventListener(\'resize\', this.onResize);',
    /* G3：抽屉副本的修饰类选择器（换成不存在的类 = 那条规则不再命中） */
    cloneRule: '.shell__side.shell__side--drawer {',
    /* G4：rail 的"视觉隐藏"规则 */
    railLabel: '.shell--rail .shell__link-label {',
  };

  /* G1 剥掉窄屏菜单规则 ⇒ 375px 下按钮根本不出现 ⇒ F2 会红 */
  const cssNoMenu = NAV_TEXT.appShellCss.replace(MUT.menuRule, '');
  add('G0', '反向控制前提：G1 的替换真的改到了文件（否则下面三条全是空转）',
    cssNoMenu !== NAV_TEXT.appShellCss,
    '长度 ' + NAV_TEXT.appShellCss.length + ' → ' + cssNoMenu.length);

  await renderNav({ appShellCss: cssNoMenu });
  await p.setViewport({ width: 375, height: 700 });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const g1 = await p.evaluate(NAV_PROBE.shell);
  add('G1', '反向：剥掉窄屏的菜单按钮规则 ⇒ 按钮不可见而侧栏也没了（F2 会判失败）',
    !!g1.btn && !g1.btnVisible && g1.sideDisplay === 'none',
    '按钮存在=' + g1.btn + ' 可见=' + g1.btnVisible + ' side=' + g1.sideDisplay +
      ' ⇒ 窄屏上导航入口彻底消失');

  /* G3 剥掉副本的修饰类规则 ⇒ 抽屉里那份还是 display:none ⇒ F4 会红 */
  const cssNoClone = NAV_TEXT.appShellCss.replace(MUT.cloneRule, '.shell__side--not-used {');
  add('G0b', '反向控制前提：G3 的替换真的改到了文件',
    cssNoClone !== NAV_TEXT.appShellCss,
    '选择器 ' + MUT.cloneRule + ' → .shell__side--not-used {');

  await renderNav({ appShellCss: cssNoClone });
  await p.setViewport({ width: 375, height: 700 });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.click('#n1 .shell__menu');
  await new Promise((r) => setTimeout(r, 320));
  const g3 = await p.evaluate(NAV_PROBE.dialog);
  add('G3', '反向：剥掉抽屉副本的显示规则 ⇒ 抽屉打开但内容是隐藏的（F4 会判失败）',
    g3.dialog && g3.visibleLinks === 0,
    '对话框=' + g3.dialog + ' 可见链接 ' + g3.visibleLinks + '/' + g3.linkCount +
      ' ⇒ 看起来像"点开一个白框"');

  /* G4 把"视觉隐藏"换成 display:none ⇒ 字还在 DOM 里，可访问名却没了 ⇒ F12 会红。
     这条挡的是最常见的一种"优化"：既然看不见，不如 display:none 省事。 */
  const cssRailNone = NAV_TEXT.appShellCss.replace(
    MUT.railLabel, MUT.railLabel + '\n  display: none;');
  add('G0d', '反向控制前提：G4 的替换真的改到了文件',
    cssRailNone !== NAV_TEXT.appShellCss,
    '在 ' + MUT.railLabel + ' 后插入 display: none');

  await renderRail({ appShellCss: cssRailNone });
  const g4 = await p.evaluate(RAIL_PROBE.rail);
  const g4name = await axName('#rcur');
  add('G4', '反向：隐藏改成 display:none ⇒ 字还在 DOM 里，可访问名却没了（F12 会判失败）',
    g4.labelDisplay === 'none' && g4.labelText === '总览' && !g4name,
    'display=' + g4.labelDisplay + ' DOM 里的字="' + g4.labelText +
      '" 可访问名="' + g4name + '" ⇒ 读屏只剩"链接"');

  /* G2 剥掉 resize 监听 ⇒ 拉宽后抽屉仍开着 ⇒ F10 会红 */
  const jsNoResize = NAV_TEXT.shellNavJs.replace(MUT.resize, '');
  add('G0c', '反向控制前提：G2 的替换真的改到了文件',
    jsNoResize !== NAV_TEXT.shellNavJs,
    'shell-nav.js 长度 ' + NAV_TEXT.shellNavJs.length + ' → ' + jsNoResize.length);

  await renderNav({ shellNavJs: jsNoResize });
  await p.setViewport({ width: 375, height: 700 });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.click('#n1 .shell__menu');
  await new Promise((r) => setTimeout(r, 320));
  await p.setViewport({ width: 1200, height: 900 });
  await new Promise((r) => setTimeout(r, 460));
  const g2 = await p.evaluate(NAV_PROBE.dialog);
  const g2wrap = await p.evaluate(() => ({
    overflow: document.body.style.overflow,
    sideVisible: getComputedStyle(document.querySelector('#n1 .shell__side')).display !== 'none',
  }));
  add('G2', '反向：剥掉 resize 监听 ⇒ 拉宽后抽屉还开着、页面仍锁着滚动（F10 会判失败）',
    g2.dialog === true && g2wrap.overflow === 'hidden' && g2wrap.sideVisible,
    '拉宽后仍打开=' + g2.dialog + ' body.overflow="' + g2wrap.overflow +
      '" 侧栏已回来=' + g2wrap.sideVisible + ' ⇒ 两个导航同时在场');

  await p.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 420));

  await b.close();

  /* ==========================================================================
   * 输出
   * ========================================================================== */
  const GROUPS = {
    A1: '结构·三段式', A2: '结构·aria-current', A3: '结构·三条线索', A4: '结构·nav 名字',
    B1: '契约·min-width', B1b: '契约·滚动容器', B2: '契约·sticky', B3: '契约·侧栏自滚', B4: '契约·顶栏 sticky',
    B5: '契约·默认滚动', B6: '契约·看板变体', B7: '契约·dvh 顺序',
    C1: '窄屏·侧栏收走', C2: '窄屏·不横滚', C3: '窄屏·顶栏保留', C4: '窄屏·宽屏恢复',
    D1: '强制色·当前项',
    E1: '反向·滚动容器', E1b: '反向·minmax 兜底', E1c: '反向·两个保险都拆', E2: '反向·sticky', E3: '反向·侧栏收走',
    F1: '接线·宽屏', F1c: '接线·opt-in', F2: '接线·窄屏按钮',
    F3: '接线·抽屉结构', F4: '接线·克隆可见', F6: '接线·id 去重', F7: '接线·初始焦点',
    F8: '接线·Esc 归位', F9: '接线·点链接关闭', F10: '接线·宽屏复位', F11: '接线·缺依赖',
    F12: '接线·rail 名字', F13: '接线·rail 布局', F14: '接线·抽屉补文字',
    G0: '反向·前提', G1: '反向·菜单规则', G3: '反向·副本显示', G2: '反向·宽屏复位',
    G4: '反向·rail 标签',
  };

  let bad = 0;
  let last = '';
  console.log('  === app-shell：三段式 / min-width / sticky / 窄屏退化 ===');
  console.log('  引擎 chromium / ' + BASE);
  console.log('');
  rows.forEach((row) => {
    if (row.group.slice(0, 1) !== last) {
      console.log('  -- ' + row.group.slice(0, 1) + ' 组 ' + (GROUPS[row.group] || '') + ' --');
      last = row.group.slice(0, 1);
    }
    if (!row.ok) bad++;
    console.log('  [' + (row.ok ? 'OK  ' : 'FAIL') + '] ' + row.label);
    console.log('        ' + row.note);
  });
  console.log('');
  console.log(bad
    ? '  ❌ ' + bad + ' 条不满足'
    : '  ✅ 全部满足：三段式成立、主区不被撑破、侧栏粘住且自滚、窄屏侧栏收走不横滚' +
        '；窄屏导航接线完整（克隆可见 / 焦点落位 / Esc 归位 / 宽屏复位 / 缺依赖不装死）');
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
