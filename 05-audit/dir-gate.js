/**
 * dir-gate.js — 涨跌方向色：口径要对调、符号要在、组件不许自判
 *
 * ============================================================================
 * 🔴 这条门禁补的是哪个洞
 * ---------------------------------------------------------------------------
 *  `delta` 把「涨跌」从「好恶」里拆了出来（`--dir-up` / `--dir-down`），
 *  并支持整体切换口径（`[data-market="intl"]`）。
 *
 *  这几件事有一个共同点：**写在 CSS 里全对，跑起来可能全是错的**。
 *
 *    · 令牌定义成 `var(--raw-dir-up)`，但暗色段漏了覆盖 ⇒ 暗色下红绿不变
 *      （暗底上的 #c0392b 只有 2.6:1，几乎看不见）；
 *    · `[data-market="intl"]` 写了，但特异性输给 `:root` ⇒ **交换从来没生效过**
 *      （第一版就是这样，`:where()` 是 0 特异性，抢不过 `:root` 的 0,1,0）；
 *    · 交换生效了，但把 up/down 对调写反了 ⇒ 国际口径下还是红涨；
 *    · `::before` 的符号被删了 ⇒ 方向只剩颜色，WCAG 1.4.1 不成立。
 *
 *  这四类里，前三条**静态读 CSS 都看不出来**（CSS 是合法的、注释是对的），
 *  必须在浏览器里读 computed 值。
 *
 * ============================================================================
 * 判据（八条）
 * ---------------------------------------------------------------------------
 *  ① 同一口径下 up 与 down **必须不同色**（否则颜色没有表达方向）
 *  ② 默认口径：up 色 == `--danger` 色，down 色 == `--success` 色
 *     —— 即「红涨绿跌」。这是当前约定，改了要改判据，不能悄悄漂
 *  ③ 国际口径：up 色 == 默认口径的 down 色（完整互换，不是只改一边）
 *  ④ 符号：up 是 `+`、down 是 `−`(U+2212)、flat **没有**符号
 *     —— 这是 1.4.1「不能只靠颜色」里**可以被机器判**的那一半
 *  ⑤ 暗色下 ①②③ 同样成立（暗色段最容易漏）
 *  ⑥ 组件 CSS 里**不出现** `[data-market`（口径是全局约定，不许抄进组件）
 *  ⑦ 符号必须**真的进可访问性树**（`::before` 的字符不进元素 name，
 *     但会作为独立 StaticText 出现 —— 这个机制很容易被改坏，
 *     而它对读屏用户是唯一的方向线索）
 *  ⑧ 用了 `data-market` 的页面**必须引 market.css**，且排在 tokens.css 之后
 *     —— 交换规则拆成可选文件后，引用点会漏；漏了不报错，只是静默失效
 *
 *  ⚠️ 判据 ② 是把「现在是红涨」这件事**钉死**，不是声称它永恒正确。
 *     哪天要改成国际口径为默认，改这一条 + CHANGELOG + 弃用登记，
 *     而不是让它在无人察觉时变掉。
 *
 * 用法：node 05-audit/dir-gate.js [--selftest]
 */
'use strict';

const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '..');
const PAGE = '/02-primitives/delta/demo.html';

/* -------------------------------------------------------------------------
 * 纯判据（自检直接喂假数据，不需要浏览器）
 * ---------------------------------------------------------------------- */

/** 把 `rgb(r, g, b)` / `rgba(...)` 归一成 `r,g,b`，忽略 alpha。 */
function rgb(s) {
  const m = String(s || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return m ? `${m[1]},${m[2]},${m[3]}` : String(s || '').trim();
}

/** 色相（0–360）。用来判「这个颜色到底是红的还是绿的」。 */
function hue(s) {
  const m = String(s || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => Number(x) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return null;                    // 灰阶没有色相
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

const RED = (h) => h !== null && (h <= 20 || h >= 345);
const GREEN = (h) => h !== null && h >= 90 && h <= 165;

/**
 * @param {object} s 采样：{
 *   light: { up, down, upSym, downSym, flatSym, danger, success },
 *   dark:  { up, down },
 *   intlLight: { up, down },
 *   intlDark:  { up, down },
 * }
 */
function judge(s) {
  const errs = [];
  if (!s || !s.light) return ['没有采样结果（页面可能没加载出来）'];
  const L = s.light;
  const D = s.dark || {};
  const IL = s.intlLight || {};
  const ID = s.intlDark || {};

  /* ① 方向必须可区分 */
  if (!L.up || !L.down) {
    errs.push('① 采样里缺 up 或 down 的颜色（元素没渲染出来？）');
  } else if (rgb(L.up) === rgb(L.down)) {
    errs.push(`① 浅色下 up 与 down 同色（${rgb(L.up)}）—— 颜色没有表达方向`);
  }
  if (D.up && D.down && rgb(D.up) === rgb(D.down)) {
    errs.push(`① 暗色下 up 与 down 同色（${rgb(D.up)}）`);
  }

  /* ② 默认口径真的是「红涨绿跌」—— 判色相，不判别名
     🔴 第一版判的是 `up === --danger`，那是**假判据**：把整个色板对调
        （danger 改成绿）之后它仍然绿，因为两边一起变了。
        「红涨」说的是颜色本身，只能从色相上看。 */
  if (L.up && !RED(hue(L.up))) {
    errs.push(`② 浅色 up 的色相是 ${Math.round(hue(L.up))}°，不在红区`
      + `（≤20° 或 ≥345°）—— 默认口径不再是「红涨」`);
  }
  if (L.down && !GREEN(hue(L.down))) {
    errs.push(`② 浅色 down 的色相是 ${Math.round(hue(L.down))}°，不在绿区`
      + `（90–165°）—— 默认口径不再是「绿跌」`);
  }
  if (D.up && !RED(hue(D.up))) {
    errs.push(`② 暗色 up 的色相是 ${Math.round(hue(D.up))}°，不在红区 —— 暗色段色相漂了`);
  }
  if (D.down && !GREEN(hue(D.down))) {
    errs.push(`② 暗色 down 的色相是 ${Math.round(hue(D.down))}°，不在绿区 —— 暗色段色相漂了`);
  }

  /* ③ 国际口径必须完整互换 */
  if (!IL.up) {
    errs.push('③ 拿不到 intl 口径的采样（[data-market="intl"] 没生效？）');
  } else {
    if (rgb(IL.up) !== rgb(L.down)) {
      errs.push(`③ intl 下 up 是 ${rgb(IL.up)}，应为默认 down 的 ${rgb(L.down)} —— `
        + '交换没生效或写反了');
    }
    if (rgb(IL.down) !== rgb(L.up)) {
      errs.push(`③ intl 下 down 是 ${rgb(IL.down)}，应为默认 up 的 ${rgb(L.up)}`);
    }
  }
  if (ID.up && IL.up && D.down && rgb(ID.up) !== rgb(D.down)) {
    errs.push(`③ 暗色 intl 下 up 是 ${rgb(ID.up)}，应为暗色 down 的 ${rgb(D.down)}`);
  }

  /* ④ 符号 = 第二线索 */
  const sym = (v) => String(v || '').replace(/^["']|["']$/g, '');
  if (sym(L.upSym) !== '+') {
    errs.push(`④ delta--up 的 ::before 是 ${JSON.stringify(sym(L.upSym))}，应为 "+"`);
  }
  if (sym(L.downSym) !== '\u2212') {
    errs.push(`④ delta--down 的 ::before 是 ${JSON.stringify(sym(L.downSym))}，`
      + '应为 U+2212（真减号，不是连字符）');
  }
  if (sym(L.flatSym) !== 'none') {
    errs.push(`④ delta--flat 的 ::before 是 ${JSON.stringify(sym(L.flatSym))}，应为 none`
      + '（0 没有方向，给符号等于借「误差」的概念）');
  }

  /* ⑤ 暗色段不能漏 */
  if (!D.up) errs.push('⑤ 拿不到暗色采样');
  if (!ID.up) errs.push('⑤ 拿不到暗色 intl 采样');

  /* ⑦ 符号必须**真的进可访问性树**
     🔴 这一条是本轮实测出来的：`::before { content: "+" }` 生成的字符
        **不会**进元素的可访问名字（`.delta--up` 的 name 只有 "3.21%"），
        但会作为**独立的 StaticText 节点**存在 ⇒ 读屏按顺序念「+」「3.21%」。
        也就是说「符号可读」是成立的，但成立在一个**很容易被改坏的机制**上：
        把 content 换成空串、换成背景图、或者加 `speak: none`，
        视觉上可能仍有符号，读屏那边就没了 —— 而颜色对读屏毫无意义。
        ⇒ 只判 computed content（④）不够，必须判"它进了树"。 */
  if (!(s.axPlus > 0)) {
    errs.push('⑦ 可访问性树里找不到 "＋" 符号节点 —— '
      + 'CSS 生成的 + 没有进入朗读序列，读屏用户只剩数字');
  }
  if (!(s.axMinus > 0)) {
    errs.push('⑦ 可访问性树里找不到 "−" 符号节点');
  }

  return errs;
}

/** ⑥ 组件不许自己判断口径（静态判据）
 *
 *  🔴 必须先剥注释再判。第一版直接正则扫全文，于是 delta.css 里
 *     「组件里若出现 `[data-market]` 分支…」这句**注释**把自己判红了 ——
 *     与 pkg-name / do-dont 在注释上踩过的坑是同一个（E129 类）。
 */
function stripComments(css) {
  return String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function judgeCss(cssText) {
  const errs = [];
  const code = stripComments(cssText);
  if (/\[data-market/.test(code)) {
    errs.push('⑥ delta.css 里出现了 [data-market 分支 —— '
      + '口径是全局约定，组件只该写 var(--dir-up)');
  }
  if (/--dir-(up|down)\s*:\s*#/.test(code)) {
    errs.push('⑥ delta.css 里直接把 --dir-* 定义成色值 —— 令牌只该定义在 01-tokens');
  }
  return errs;
}

/** ⑧ 用了 `data-market` 的页面必须引 market.css，且必须排在 tokens.css 之后
 *
 *  🔴 这条是补出来的，因为我自己就踩了：把交换规则从 tokens.css 挪到
 *     market.css 之后，delta demo 的「国际口径」对照栏**没跟着引新文件**，
 *     于是那一栏静默显示成 A 股配色 —— 页面在说谎，而所有门禁都是绿的。
 *
 *     这一类的共性：**可选文件被拆出去后，引用点会漏**。CSS 不报错，
 *     `data-market` 属性照样存在，只是没东西接它。静态判据能抓，就该静态抓。
 */
function judgeMarketLinks(html) {
  const errs = [];
  const code = String(html || '').replace(/<!--[\s\S]*?-->/g, '');
  if (!/data-market/.test(code)) return errs;   // 与口径无关的页面不判

  const links = (code.match(/<link\b[^>]*>/gi) || [])
    .filter((t) => /rel\s*=\s*["']?stylesheet/i.test(t));
  const hrefOf = (t) => (t.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
  const idx = links.findIndex((t) => /01-tokens\/market\.css$/.test(hrefOf(t)));

  if (idx < 0) {
    errs.push('⑧ 页面用了 data-market 却没引 01-tokens/market.css —— 口径切换会静默失效');
    return errs;
  }
  const tok = links.findIndex((t) => /01-tokens\/tokens\.css$/.test(hrefOf(t)));
  if (tok >= 0 && idx < tok) {
    errs.push('⑧ market.css 必须排在 tokens.css 之后 —— 否则被令牌盖掉');
  }
  return errs;
}

/** 仓库里所有 html（跳过生成物与评审截图目录） */
function htmlFiles(dir, acc) {
  acc = acc || [];
  const SKIP = new Set(['node_modules', 'dist', '.git', '10-review']);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.charAt(0) === '.' || SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, acc);
    else if (/\.html$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/* -------------------------------------------------------------------------
 * 反向控制
 * ---------------------------------------------------------------------- */
function selftest() {
  const R = [];
  const add = (name, ok) => R.push([name, !!ok]);

  /* 🔴 ③ 的定义就是「intl = 默认的互换」。
     所以拿默认值造突变时，intl 必须跟着同步 —— 否则一次突变会同时踩中
     ② 和 ③，自检就分不清「判据坏了」还是「样本写坏了」。
     第一次就是这么错的：4 条自检假红，而判据其实是对的。 */
  const withIntl = (s) => {
    s.intlLight = { up: s.light.down, down: s.light.up };
    s.intlDark = { up: s.dark.down, down: s.dark.up };
    return s;
  };

  const base = () => withIntl({
    light: {
      up: 'rgb(192, 57, 43)', down: 'rgb(47, 107, 58)',
      danger: 'rgb(192, 57, 43)', success: 'rgb(47, 107, 58)',
      upSym: '"+', downSym: '"\u2212"', flatSym: 'none',
    },
    dark: { up: 'rgb(224, 122, 110)', down: 'rgb(111, 170, 122)' },
    axPlus: 3, axMinus: 3,
  });

  /* 除目标判据外不许有别条同时红 —— 否则「红」的归因是错的。
     ③ 天然出两条（up 与 down 各一条）；① 与 ② 在构造上**必然重叠**
     （同色 ⇒ 其中一方色相必然不在自己的区），用 needles 显式声明允许连带。
     写法：第一个 needle 必须出现，其余是「允许一起红」的判据编号。 */
  const only = (name, errs, ...needles) => {
    const ok = errs.length >= 1
      && errs.some((e) => e.includes(needles[0]))
      && errs.every((e) => needles.some((n) => e.includes(n)));
    add(name, ok);
    if (!ok) console.log('     实际 %d 条：%s', errs.length, JSON.stringify(errs.slice(0, 3)));
  };

  add('全对的样本不报错（判据不能恒红）', judge(base()).length === 0);

  // ① up 与 down 同色（同时把 danger 对齐，免得 ② 跟着红）
  only('① up 与 down 同色被抓', judge((() => {
    const s = base();
    s.light.up = s.light.down;
    s.light.danger = s.light.down;
    return withIntl(s);
  })()), '同色', '②');

  // ② 默认口径变成绿涨（整个色板对调 —— 别名判据抓不到这种，色相判据能）
  only('② 默认口径变成绿涨被抓', judge((() => {
    const s = base();
    s.light.up = 'rgb(47, 107, 58)';     // 绿
    s.light.down = 'rgb(192, 57, 43)';   // 红
    s.light.danger = 'rgb(47, 107, 58)';
    s.light.success = 'rgb(192, 57, 43)';
    return withIntl(s);
  })()), '②');

  // ③ 交换没生效：intl 与默认相同
  only('③ intl 与默认相同（交换没生效）被抓', judge((() => {
    const s = base();
    s.intlLight = { up: s.light.up, down: s.light.down };
    s.intlDark = { up: s.dark.up, down: s.dark.down };
    return s;
  })()), '③');

  // ④ 符号
  only('④ 符号被删被抓', judge((() => {
    const s = base(); s.light.upSym = 'none'; return s;
  })()), '应为 "+"');
  only('④ 用连字符冒充减号被抓', judge((() => {
    const s = base(); s.light.downSym = '"-"'; return s;
  })()), 'U+2212');
  only('④ flat 多了符号被抓', judge((() => {
    const s = base(); s.light.flatSym = '"\u00b1"'; return s;
  })()), '应为 none');

  // ⑤ 暗色漏了（只清 dark，保留 intlDark ⇒ ③ 的暗色分支因缺 D.down 而跳过）
  only('⑤ 拿不到暗色采样被抓', judge((() => {
    const s = base(); s.dark = {}; return s;
  })()), '暗色');

  // ⑦ 符号没进可访问性树
  only('⑦ 符号没进可访问性树被抓', judge((() => {
    const s = base(); s.axPlus = 0; return s;
  })()), '⑦');
  only('⑦ 减号没进可访问性树被抓', judge((() => {
    const s = base(); s.axMinus = 0; return s;
  })()), '⑦');

  // ⑥
  add('⑥ 组件里出现 [data-market 被抓',
    judgeCss('.delta--up{color:var(--dir-up)}[data-market="intl"] .delta--up{color:green}').length === 1);
  add('⑥ 组件里直接定义色值被抓',
    judgeCss(':root{--dir-up:#c0392b}').length === 1);
  add('⑥ 正常写法不报错',
    judgeCss('.delta--up{color:var(--dir-up)}').length === 0);

  // ⑧ 引用点漏了
  const LINK_OK = '<link rel="stylesheet" href="../../01-tokens/tokens.css">'
    + '<link rel="stylesheet" href="../../01-tokens/market.css">';
  add('⑧ 用了 data-market 但没引 market.css 被抓',
    judgeMarketLinks('<div data-market="intl"></div>'
      + '<link rel="stylesheet" href="../../01-tokens/tokens.css">').length === 1);
  add('⑧ market.css 排在 tokens.css 之前被抓',
    judgeMarketLinks('<div data-market="intl"></div>'
      + '<link rel="stylesheet" href="../../01-tokens/market.css">'
      + '<link rel="stylesheet" href="../../01-tokens/tokens.css">').length === 1);
  add('⑧ 顺序正确的页面不报错',
    judgeMarketLinks('<div data-market="intl"></div>' + LINK_OK).length === 0);
  add('⑧ 没提 data-market 的页面不报错（不过度主张）',
    judgeMarketLinks('<link rel="stylesheet" href="../../01-tokens/tokens.css">').length === 0);
  add('⑧ html 注释里提到 data-market 不算使用',
    judgeMarketLinks('<!-- 支持 data-market="intl" -->' + LINK_OK).length === 0);

  let bad = 0;
  for (const [n, ok] of R) {
    if (!ok) bad++;
    console.log('  ' + (ok ? 'OK  ' : 'RED ') + n);
  }
  console.log('');
  console.log(bad ? `  ⇒ 🔴 判据自检 ${bad} 条不成立` : '  ⇒ ✅ 判据自检全部成立');
  return bad ? 1 : 0;
}

/* -------------------------------------------------------------------------
 * 浏览器采样
 * ---------------------------------------------------------------------- */
async function sample(page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    const pick = (sel, prop) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el)[prop] : null;
    };
    const sym = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el, '::before').content : null;
    };
    const read = () => ({
      up: pick('.delta--up', 'color'),
      down: pick('.delta--down', 'color'),
      upSym: sym('.delta--up'),
      downSym: sym('.delta--down'),
      flatSym: sym('.delta--flat'),
    });

    const out = {};
    // 用第一个 delta（页面上部「三个方向」那一组），它不受 demo 内部 intl 区块影响
    const scope = document.querySelectorAll('.delta--up');
    if (!scope.length) return { error: '页面上没有 .delta--up' };

    html.removeAttribute('data-market');
    html.removeAttribute('data-theme');
    out.light = read();
    out.light.danger = getComputedStyle(html).getPropertyValue('--danger').trim();
    out.light.success = getComputedStyle(html).getPropertyValue('--success').trim();

    html.setAttribute('data-theme', 'dark');
    out.dark = read();

    html.setAttribute('data-market', 'intl');
    out.intlDark = read();

    html.removeAttribute('data-theme');
    out.intlLight = read();

    html.removeAttribute('data-market');
    return out;
  });
}

/* ------------------------------------------------------------------------- */
(async () => {
  if (process.argv.includes('--selftest')) process.exit(selftest());

  const { launch } = require(path.resolve(__dirname, 'browser'));
  const BASE = process.env.FL_BASE || 'http://127.0.0.1:8000';
  let rc = 0;

  console.log('\n  === 涨跌方向色 ===\n');

  /* ⑥ 先做静态判据（不起浏览器也能红） */
  const css = fs.readFileSync(path.join(REPO, '02-primitives/delta/delta.css'), 'utf8');
  const cssErrs = judgeCss(css);
  if (cssErrs.length) {
    cssErrs.forEach((e) => console.log('  🔴 ' + e));
    rc = 1;
  } else {
    console.log('  OK ⑥ 组件 CSS 未自判口径');
  }

  /* ⑧ 引用点：用了 data-market 的页面必须引 market.css（同样是静态判据） */
  {
    const files = htmlFiles(REPO);
    const hits = [];
    for (const f of files) {
      const e = judgeMarketLinks(fs.readFileSync(f, 'utf8'));
      if (e.length) hits.push([path.relative(REPO, f).split(path.sep).join('/'), e]);
    }
    if (hits.length) {
      hits.forEach(([rel, es]) => es.forEach((e) => console.log('  🔴 ' + rel + '：' + e)));
      rc = 1;
    } else {
      console.log('  OK ⑧ ' + files.length + ' 个页面：用了 data-market 的都引了 market.css'
        + '（且顺序正确）');
    }
  }

  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(BASE + PAGE, { waitUntil: 'networkidle0', timeout: 20000 });

    const s = await sample(page);
    if (s.error) {
      console.log('  🔴 ' + s.error);
      rc = 1;
    } else {
      /* ⑦ 取可访问性树，数符号节点。
         ⚠️ 必须用 AX 树，不能用 DOM 文本 —— `::before` 的内容
            不在 textContent 里（实测 textContent = "3.21%"），
            但会作为独立 StaticText 出现在树里。 */
      const client = await page.target().createCDPSession();
      await client.send('Accessibility.enable');
      const { nodes } = await client.send('Accessibility.getFullAXTree');
      const countSym = (ch) => nodes.filter((n) => !n.ignored
        && n.role && n.role.value === 'StaticText'
        && String((n.name && n.name.value) || '').trim() === ch).length;
      s.axPlus = countSym('+');
      s.axMinus = countSym('\u2212');

      const errs = judge(s);
      if (errs.length) {
        errs.forEach((e) => console.log('  🔴 ' + e));
        rc = 1;
      } else {
        console.log('  OK ①–⑤ ⑦ 两种口径 × 明暗 全部成立');
        console.log('     默认 up=' + rgb(s.light.up) + ' down=' + rgb(s.light.down));
        console.log('     intl  up=' + rgb(s.intlLight.up) + ' down=' + rgb(s.intlLight.down));
        console.log('     可访问性树里的符号节点：+ ' + s.axPlus + ' 个 / − ' + s.axMinus + ' 个');
      }
    }
    await page.close();
  } finally {
    await browser.close();
  }

  console.log('');
  console.log(rc ? '  ❌ 方向色门禁未通过' : '  ✅ 方向色门禁通过');
  process.exit(rc);
})();
