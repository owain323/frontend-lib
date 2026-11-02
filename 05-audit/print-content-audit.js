#!/usr/bin/env node
/* ============================================================================
   内容完整性审计（print-content-audit）— 硬判据
   ----------------------------------------------------------------------------
   为什么需要它
     打印门禁（print-gate）的 12 条判据量的全是「印出来的部分好不好」：
     对比度、字体嵌入、run 数、每页有文本算子。**没有一条量「该印的是不是都在」。**

     实测（2026-11-02）：examples/finance-report 引了 3 个 tab 面板 + 4 个
     accordion，屏幕上只展开第一个 ⇒ 门禁判它 PASS（6 页 / 943 runs /
     5.44:1），而它 898 个字（68%）根本没印出来。

     这就是「静默截断」：页数正常、对比度合格、字体全嵌入、内容少了一半。

   🔴 为什么现在能转硬判据了（2026-11-02）
     上一版只报告不判红，理由写在当时的注释里：「先出清单 → 人工确认 →
     写成 printPolicy → 再转硬判据。直接硬 FAIL 的结果只有一个：被加进白名单关掉。」

     现在 printPolicy 已经在 ai/components.json 里（31 条规则），
     所以「为什么这块不上纸」这个问题有地方答了 —— 判据可以变硬，
     而且**不需要任何白名单**（见下面三条判据，它们互相咬合）。

   🔴 三条判据（全部相对「屏幕态」量，没有 allowlist）
     ① 契约违约：命中 `expand` 选择器的文字，打印时仍不印 ⇒ 红
        printPolicy 说「这块纸上要展开」，那就是承诺。承诺没兑现是硬错误。
        （tabs 面板、accordion 面板、表格滚动容器、模态遮罩都属于这一类）
     ② 屏幕可见 → 纸上消失：屏幕上看得见的字，打印后不见了，且没有任何
        `omit` 声明 ⇒ 红。这是「静默」的定义。
     ③ 屏幕也看不见 ⇒ 不算。交互状态（关闭的菜单、未触发的空态、反例演示）
        在屏幕与纸上都不可见，它们不是「被吞掉的内容」，而是「没发生的事」。
        这一条取代了上一版的 allowlist —— 白名单会腐烂，判据不会。

   🔴 为什么相对屏幕量（而不是绝对「有空隙就是错的」）
     实测全站 43 页：绝对口径下会列出 17 条 / 337 字「疑似」，逐条看下去
     全是关闭态菜单、listbox 选项、a11y 反例 —— 判据太粗，人就不看了。
     换成相对口径后残余归零，而真正的问题（①和②）一条都跑不掉。

   实现要点（踩过的坑，别再踩）
     · 页面内代码写成**真函数**再交给 evaluate，不用模板字符串 ——
       模板字符串里的反引号会截断字符串（本轮踩了三次）。
     · 不能靠 grid-template-rows: 0fr 判断收起：它的 computed 是 px
       （fr 被 min-content 撑开，实测 0fr → 24px）。
     · 必须先查 display:none 系，再查 visibility —— display:none 子树内
       所有元素的 computed visibility 也是 hidden，顺序反了会把折叠面板
       里的文字误标成 visibility:hidden 并重复计数。
     · 两次扫描（screen / print）必须共用**文本节点序号**当 key：
       emulateMediaType 不改 DOM，第 n 个文本节点两次是同一个节点。
       用 pathOf 当 key 会在「两个同样的 div」上撞车。

   用法
     node 05-audit/print-content-audit.js              # 13 页（门禁采样集）· 判红
     node 05-audit/print-content-audit.js --all        # 全集 43 页
     node 05-audit/print-content-audit.js --page finance-report
     node 05-audit/print-content-audit.js --report     # 旧的单次报告模式（只诊断，不判红）
     node 05-audit/print-content-audit.js --json out.json
     node 05-audit/print-content-audit.js --selftest   # 反向控制
   ========================================================================== */
'use strict';

const { launch } = require('./browser.js');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

/* 工具类：不来自任何组件的声明，而是本库提供的全局开关。 */
const UTILS = [
  ['.no-print', 'omit', 'wrote .no-print'],
  ['.sr-only', 'a11y', '读屏专用'],
  ['.visually-hidden', 'a11y', '读屏专用'],
  ['.skip-link', 'a11y', '跳转链接'],
];

/* 契约 → 声明清单。`omit` 的规则是「这块不上纸」的**书面理由**；
   `expand` 的规则是「这块必须印」的**承诺**（判据①就咬在它上面）。 */
function contractClaims() {
  const p = path.join(ROOT, 'ai', 'components.json');
  const doc = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const claims = [];
  const push = (r, by) => claims.push({
    sel: r.selector, kind: r.policy === 'omit' ? 'omit' : 'expand',
    by: by, why: r.why,
  });
  const d = doc.printDefaults || { rules: [] };
  (d.rules || []).forEach((r) => {
    if (r.policy === 'omit' || r.policy === 'expand') push(r, 'printDefaults');
  });
  for (const c of doc.components || []) {
    (c.printPolicy || []).forEach((r) => {
      if (r.policy === 'omit' || r.policy === 'expand') push(r, c.id);
    });
  }
  for (const [sel, kind, why] of UTILS) {
    claims.push({ sel: sel, kind: kind, by: 'util', why: why });
  }
  /* omit 在前：同一个元素既被 omit 命中又在 expand 里面时，
     「整块不上纸」是更强的决定（例如模态里的按钮被 .no-print 排除）。 */
  claims.sort((a, b) => (a.kind === 'omit' ? 0 : 1) - (b.kind === 'omit' ? 0 : 1));
  return claims;
}

/* ---------------------------------------------------------------- 页内扫描
   这是一个**真函数**，由 puppeteer 序列化后注入页面执行。
   只能用参数与 DOM API，不能引用外部变量。 */
function scanInPage(CLAIMS) {
  const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, NOSCRIPT: 1, TITLE: 1 };

  function label(el) {
    if (!el || el === document.body) return 'body';
    const tag = el.tagName.toLowerCase();
    if (el.id) return tag + '#' + el.id;
    const cls = (typeof el.className === 'string' ? el.className : '').trim();
    if (cls) return tag + '.' + cls.split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    return tag;
  }

  function pathOf(el) {
    const parts = [];
    let n = el;
    let depth = 0;
    while (n && n !== document.body && depth < 4) {
      parts.unshift(label(n));
      n = n.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  /* 隐藏原因。第一趟 display:none 系，第二趟 visibility 与裁切 —— 顺序写了理由。 */
  /* 返回「是谁把它藏起来的」，不只是原因字符串。
     判定需要这个元素：契约说 expand 的那个元素自己藏起来 = 违约；
     被别的元素（关闭的菜单、a11y 反例）藏起来 = 不是它的事。 */
  function hideReason(el) {
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none') {
        return { el: n, why: n.hasAttribute('hidden') ? 'hidden 属性' : 'display:none' };
      }
      n = n.parentElement;
    }
    /* visibility 会**继承**：子元素自己没写也是 hidden，所以「最近的那个」
       永远是文字的直接父元素，不是下决定的那个。
       取**最外层的 hidden 元素**（它的父元素已经恢复 visible）= 边界。
       实测代价：不这么写时，#promised{visibility:hidden} 的契约违约
       会被误报成「静默消失」，因为动手的人被认成了里面的 <p>。 */
    n = el;
    let topHidden = null;
    let clip = null;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden') topHidden = n;
      if (!clip && (cs.overflow === 'hidden' || cs.overflowY === 'hidden'
          || cs.overflowX === 'hidden')) {
        const r = n.getBoundingClientRect();
        if (r.height < 1) clip = n;
      }
      n = n.parentElement;
    }
    if (topHidden) return { el: topHidden, why: 'visibility:hidden' };
    if (clip) return { el: clip, why: '高度 0 + 裁切' };
    return null;
  }

  /* 声明表预先物化成 WeakMap（逐节点 closest 太慢：
     2000 个文本节点 × 20 个选择器 × 8 层祖先 = 32 万次匹配）。 */
  const claimOf = new WeakMap();
  for (let i = 0; i < CLAIMS.length; i++) {
    const list = document.querySelectorAll(CLAIMS[i].sel);
    for (let k = 0; k < list.length; k++) {
      if (!claimOf.has(list[k])) claimOf.set(list[k], CLAIMS[i]);
    }
  }

  /* 祖先里有没有「整块不上纸」的声明。
     🔴 只认 omit：实测反例（2026-11-02 首跑就撞上）—— report 的边注
     `.rep__aside` 是 omit，它里面嵌了一张 `.table`（expand）。按「最近的祖先」
     取到的是 .table，于是整张表被判成「契约违约」，而它本来就不该印。
     ⇒ 优先级不是深度，是**决定的范围**：整块不上纸 > 局部要展开。 */
  function hasOmitAncestor(el) {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = claimOf.get(n);
      if (c && c.kind === 'omit') return c;
      n = n.parentElement;
    }
    return null;
  }

  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const p = node.parentElement;
      if (!p || SKIP_TAGS[p.tagName]) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes = [];
  let i = 0;
  let visibleChars = 0;
  while (w.nextNode()) {
    const node = w.currentNode;
    const txt = node.nodeValue.replace(/\s+/g, ' ').trim();
    const el = node.parentElement;
    const hid = hideReason(el);
    /* 藏起来它的那个元素身上有没有**直接**声明（不是祖先链）——
       「谁动的手」和「谁的承诺」必须是同一个元素，判据①才有意义。 */
    const hc = hid ? claimOf.get(hid.el) : null;
    const oa = hasOmitAncestor(el);
    nodes.push({
      i: i++,
      chars: txt.length,
      hid: hid ? hid.why : '',
      where: pathOf(el),
      hideTag: hid ? label(hid.el) + (hid.el === el ? '' : ' ↑') : '',
      sample: txt.slice(0, 40),
      hideClaimKind: hc ? hc.kind : '',
      hideClaimBy: hc ? hc.by : '',
      hideClaimWhy: hc ? hc.why : '',
      omitAnc: oa ? oa.by : '',
    });
    if (!hid) visibleChars += txt.length;
  }
  return { visibleChars: visibleChars, nodes: nodes };
}

/* ---------------------------------------------------------------- 判定
   纯函数：只有两次扫描的结果与声明，没有 DOM。所以自检能直接喂合成样本。 */
function judgeNode(screen, print) {
  if (!print.hid) return null;                    // 纸上在，没话说
  /* ① 契约违约：藏起它的**正是**契约说「要展开」的那个元素。
     这一条不看屏幕态 —— tabs 的未选中面板在屏幕上也是隐藏的，
     但契约承诺了纸上要展开，那就必须展开（否则判据③会把它放过去，
     而那正是 finance-report 少印 68% 的那一次）。 */
  if (print.hideClaimKind === 'expand') {
    return { code: 'contract', why: 'printPolicy 声明了 expand（'
      + print.hideClaimBy + '），但纸上仍被 ' + print.hideTag
      + ' 藏起来：' + print.hid };
  }
  if (print.hideClaimKind === 'omit' || print.omitAnc) return null;  // 有书面理由
  if (screen.hid) return null;                    // ③ 屏幕也没有 —— 交互状态
  return { code: 'silent',                         // ②
    why: '屏幕上可见、纸上消失，且没有任何 omit 声明（被 ' + print.hideTag
      + ' 藏起来：' + print.hid + '）' };
}

/* ---------------------------------------------------------------- 页面集 */

const FIXED = [
  ['root-index', '/index.html'],
  ['guide-index', '/guide/index.html'],
  ['guide-button', '/guide/button.html'],
  ['recipe-report', '/04-recipes/report/demo.html'],
  ['recipe-analysis-report', '/04-recipes/analysis-report/demo.html'],
  ['example-finance-report', '/examples/finance-report/index.html'],
  ['type-wide-table', '/04-recipes/table/demo.html'],
  ['type-form', '/02-primitives/choice/demo.html'],
  ['type-grid-media', '/02-primitives/upload/demo.html'],
  ['pattern-tabs', '/03-patterns/tabs/demo.html'],
  ['pattern-accordion', '/03-patterns/accordion/demo.html'],
  ['pattern-pagination', '/03-patterns/pagination/demo.html'],
  ['pattern-modal', '/03-patterns/overlay/demo.html'],
];

function allPages() {
  const r = spawnSync(process.env.PY || 'python',
    [path.join(__dirname, 'shot-baseline.py'), '--list'],
    { encoding: 'utf8', timeout: 60000 });
  if (r.error || r.status !== 0) {
    console.error('取页面全集失败（退回 13 页固定集）：'
      + (r.error ? r.error.message : '退出码 ' + r.status));
    return FIXED;
  }
  const out = [];
  for (const line of String(r.stdout || '').split('\n')) {
    const m = line.match(/^\s*(OK|缺)\s+(\S+)\s*$/);
    if (m && m[1] === 'OK') {
      const rel = '/' + m[2];
      const id = m[2].replace(/\/demo\.html$/, '').replace(/[\/.]/g, '-');
      out.push([id, rel]);
    }
  }
  return out.length >= 40 ? out : FIXED;
}

/* ---------------------------------------------------------------- 主流程 */

async function audit(browser, pages, claims) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const rows = [];
  for (const [id, url] of pages) {
    let s;
    let p;
    try {
      /* 绝对 URL（data: / http:）直接走：自检要拿 data: 页跑完整管线，
         而把 BASE 拼在 data: 前面会得到一个非法 URL（这条踩过）。 */
      const abs = /^(data:|https?:)/i.test(url) ? url : BASE + url;
      await page.goto(abs, { waitUntil: 'networkidle0', timeout: 20000 });
      await page.emulateMediaType('screen');
      await new Promise((res) => setTimeout(res, 120));
      s = await page.evaluate(scanInPage, claims);
      await page.emulateMediaType('print');
      await new Promise((res) => setTimeout(res, 180));
      p = await page.evaluate(scanInPage, claims);
    } catch (e) {
      rows.push({ id: id, url: url, err: e.message.slice(0, 80), bad: [] });
      continue;
    }
    /* 两次扫描的节点数必须一致 —— 不一致说明页面在两次之间变了
       （动画 / JS 定时器），按序号配对就是错的，宁可报错也不要错配。 */
    if (s.nodes.length !== p.nodes.length) {
      rows.push({ id: id, url: url,
        err: '屏幕 ' + s.nodes.length + ' 个文本节点 / 打印 ' + p.nodes.length
          + ' 个 —— 两次扫描之间 DOM 变了，配对不可信', bad: [] });
      continue;
    }
    const bad = [];
    for (let k = 0; k < p.nodes.length; k++) {
      const v = judgeNode(s.nodes[k], p.nodes[k]);
      if (v) {
        bad.push({ code: v.code, why: v.why, chars: p.nodes[k].chars,
          where: p.nodes[k].where, sample: p.nodes[k].sample, page: id });
      }
    }
    rows.push({ id: id, url: url, visible: s.visibleChars,
      printed: p.visibleChars, bad: bad });
  }
  await page.close();
  return rows;
}

function report(rows) {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);
  const all = [];
  rows.forEach((r) => r.bad.forEach((b) => all.push(b)));

  console.log('');
  console.log('  内容完整性（判据：契约违约 / 屏幕可见→纸上消失）');
  console.log('  ' + '-'.repeat(78));
  console.log('  ' + pad('页面', 26) + num('屏幕字', 9) + num('纸上字', 9)
    + num('违约', 7) + num('消失', 7) + num('少印', 8));
  console.log('  ' + '-'.repeat(78));
  const sorted = rows.slice().sort((a, b) => b.bad.length - a.bad.length);
  for (const r of sorted) {
    if (r.err) {
      console.log('  ' + pad(r.id, 26) + '  ⚠️ ' + r.err);
      continue;
    }
    if (!r.bad.length) continue;
    const c1 = r.bad.filter((b) => b.code === 'contract').length;
    const c2 = r.bad.filter((b) => b.code === 'silent').length;
    const lost = r.visible ? ((r.visible - r.printed) * 100 / r.visible).toFixed(0) : '0';
    console.log('  ' + pad(r.id, 26) + num(r.visible, 9) + num(r.printed, 9)
      + num(c1 || '.', 7) + num(c2 || '.', 7) + num(lost + '%', 8));
  }
  console.log('  ' + '-'.repeat(78));
  const totS = rows.reduce((a, r) => a + (r.visible || 0), 0);
  const totP = rows.reduce((a, r) => a + (r.printed || 0), 0);
  console.log('  ' + pad('合计 ' + rows.length + ' 页', 26) + num(totS, 9)
    + num(totP, 9) + num(all.filter((b) => b.code === 'contract').length || '.', 7)
    + num(all.filter((b) => b.code === 'silent').length || '.', 7));
  console.log('');

  if (all.length) {
    all.sort((a, b) => b.chars - a.chars);
    console.log('  🔴 违规明细');
    console.log('  ' + '-'.repeat(78));
    for (const b of all.slice(0, 30)) {
      console.log('  [' + (b.code === 'contract' ? '契约违约' : '静默消失') + '] '
        + num(b.chars, 4) + ' 字  ' + b.page);
      console.log('        ' + b.where);
      console.log('        "' + b.sample + '"');
      console.log('        ' + b.why);
    }
    if (all.length > 30) console.log('  ... 还有 ' + (all.length - 30) + ' 处');
    console.log('');
  } else {
    console.log('  ✅ 没有违约：屏幕上看得见的字，纸上都在；声明要展开的都展开了。');
    console.log('');
  }
  return all;
}

async function main() {
  if (argv.indexOf('--selftest') >= 0) return selftest();

  const only = val('--page');
  let pages = has('--all') ? allPages() : FIXED;
  if (only) pages = pages.filter(([id, u]) => id === only || u.indexOf(only) >= 0);
  if (!pages.length) { console.error('没有匹配的页面：' + only); process.exit(2); }

  const claims = contractClaims();
  const browser = await launch();
  let rows;
  try {
    rows = await audit(browser, pages, claims);
  } finally {
    await browser.close();
  }

  const all = report(rows);
  const json = val('--json');
  if (json) {
    fs.writeFileSync(json, JSON.stringify({
      claims: claims.length,
      rows: rows.map((r) => ({ id: r.id, url: r.url, visible: r.visible,
        printed: r.printed, err: r.err || null, bad: r.bad })),
      violations: all,
    }, null, 1));
    console.log('  明细已写入 ' + json);
  }

  /* --report：只诊断不判红（旧行为）。默认是硬判据。 */
  if (has('--report')) return 0;
  const broken = rows.filter((r) => r.err);
  if (broken.length) {
    console.log('  🔴 ' + broken.length + ' 页没量成（不是通过）：'
      + broken.map((r) => r.id).join(' / '));
  }
  return (all.length || broken.length) ? 1 : 0;
}

/* ---------------------------------------------------------------- 自检
   两段：① 判定表（纯函数，喂合成样本）② 真 DOM 扫描（证明扫描器不是空转） */

async function selftest() {
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail) => {
    if (ok) pass++; else fail++;
    console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' ' + name + (detail ? '    ' + detail : ''));
  };

  /* ① 判定表 */
  const node = (hid, kind, by) => ({ hid: hid || '', hideClaimKind: kind || '',
    hideClaimBy: by || '', hideTag: 'x', omitAnc: '', chars: 10,
    where: 'x', sample: 'x' });
  const cases = [
    ['纸上可见 ⇒ 不判', node('', '', ''), node('', '', ''), null],
    ['屏幕可见 + 纸上消失 + 无声明 ⇒ 静默', node('', '', ''), node('display:none', '', ''), 'silent'],
    ['屏幕可见 + 纸上消失 + omit 声明 ⇒ 放行', node('', '', 'omit'), node('display:none', 'omit', 'nav'), null],
    ['屏幕可见 + 纸上消失 + 违约（hideClaim=expand）', node('', '', 'expand'), node('visibility:hidden', 'expand', 'tabs'), 'contract'],
    ['屏幕也隐藏 + hideClaim=expand ⇒ 仍违约（finance 少印 68% 的那个形状）', node('display:none', '', ''), node('display:none', 'expand', 'tabs'), 'contract'],
    ['屏幕也隐藏 ⇒ 交互状态，不判', node('display:none', '', ''), node('display:none', '', ''), null],
    ['屏幕隐藏但纸上可见 ⇒ 不判（没有损失）', node('display:none', '', ''), node('', '', ''), null],
  ];
  for (const [name, s, p, want] of cases) {
    const got = judgeNode(s, p);
    const code = got ? got.code : null;
    check('判定 · ' + name, code === want, '→ ' + (code || 'pass'));
  }

  /* ② 真 DOM 扫描：一个页面同时造出四类样本 */
  const browser = await launch();
  const page = await browser.newPage();
  await page.setContent(
    '<!doctype html><meta charset="utf-8"><style>'
    + '.gone{display:none}'
    + '</style><body>'
    + '<p>可见文字</p>'
    + '<div class="gone"><p>屏幕隐藏</p></div>'
    + '<div class="gone"><p>也隐藏</p></div>'
    + '</body>');
  const claims = [{ sel: '.gone', kind: 'omit', by: 'selftest', why: 'x' }];
  const scr = await page.evaluate(scanInPage, claims);
  await page.emulateMediaType('print');
  const prt = await page.evaluate(scanInPage, claims);
  await browser.close();

  const byText = (arr, t) => arr.nodes.filter((n) => n.sample === t)[0] || {};
  check('扫描 · 两次节点数一致', scr.nodes.length === prt.nodes.length,
    scr.nodes.length + ' / ' + prt.nodes.length);
  check('扫描 · 「可见文字」没被误判', !byText(scr, '可见文字').hid
    && !byText(prt, '可见文字').hid);
  check('扫描 · 「屏幕隐藏」两态都判隐藏',
    !!byText(scr, '屏幕隐藏').hid && !!byText(prt, '屏幕隐藏').hid);
  check('扫描 · 声明命中（omit via .gone）',
    byText(prt, '屏幕隐藏').hideClaimKind === 'omit');
  /* ③ 端到端：拿 data: 页走完整流程（扫描 → 配对 → 判定 → 计分）。
     为什么用 data: 而不是落盘夹具：写文件的门禁会在并发跑的时候互相踩，
     而这条控制要证明的恰恰是「整条管线能判红」，不需要真文件。 */
  const html = '<!doctype html><meta charset="utf-8"><style>'
    + '@media print{#silent{display:none}#promised{visibility:hidden}}'
    + '</style><body><p id="ok">这段两态都在</p>'
    + '<p id="silent">屏幕看得见，纸上不该消失</p>'
    + '<div id="promised"><p>契约说这块要印</p></div>'
    + '<div id="gone"><p>屏幕就没有</p></div><style>#gone{display:none}</style>'
    + '</body>';
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  const claims2 = [
    { sel: '#promised', kind: 'expand', by: 'selftest', why: '契约说要印' },
    { sel: '#gone', kind: 'omit', by: 'selftest', why: '声明不上纸' },
  ];
  const b2 = await launch();
  let rows2;
  try {
    rows2 = await audit(b2, [['e2e', dataUrl]], claims2);
  } finally {
    await b2.close();
  }
  const codes = (rows2[0] && rows2[0].bad || []).map((x) => x.code).sort();
  check('端到端 · 一页同时抓出 silent 与 contract',
    codes.join(',') === 'contract,silent', '→ [' + codes.join(',') + ']');
  check('端到端 · 可见文字与已声明 omit 不计',
    (rows2[0] && rows2[0].bad || []).length === 2,
    '→ ' + ((rows2[0] && rows2[0].bad || []).length) + ' 条');
  check('端到端 · 屏幕上可见的字量到了', (rows2[0] && rows2[0].visible) > 0,
    '→ ' + (rows2[0] && rows2[0].visible)
    + ((rows2[0] && rows2[0].err) ? '  err=' + rows2[0].err : ''));

  console.log('');
  console.log('  自检 ' + pass + '/' + (pass + fail) + ' 通过');
  return fail ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e) => {
  const msg = String((e && e.message) || e);
  if (/ECONNREFUSED|net::ERR|Navigation failed|timeout/i.test(msg)) {
    console.error('  静态服务没起（BASE=' + BASE + '）—— 先 bash 05-audit/with-server.sh');
    process.exit(3);
  }
  console.error('ERR ' + msg);
  process.exit(1);
});
