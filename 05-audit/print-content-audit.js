#!/usr/bin/env node
/* ============================================================================
   内容完整性审计（print-content-audit）— 审计模式，不判红
   ---------------------------------------------------------------------------
   为什么需要它
     现有 12 条打印判据量的全是「印出来的部分好不好」：对比度、字体嵌入、
     run 数、每页有文本算子。**没有一条量「该印的是不是都在」。**

     实测（2026-11-02）：examples/finance-report 引了 3 个 tab 面板 + 4 个
     accordion，屏幕上只展开第一个 ⇒ 门禁判它 PASS（6 页 / 943 runs /
     5.44:1），而它 898 个字（68%）根本没印出来。

     这就是「静默截断」：页数正常、对比度合格、字体全嵌入、内容少了一半。
     显眼错误（白页 / 裂开 / 几百页）人一眼能看出来，静默截断不能。

   判据定义
     静默截断 = 没印出来 + 没声明。

     所以审计做的是三分类，不是二分类：
       ① 可见          → 应该印
       ② 声明排除      → .no-print / omit 类组件 / 读屏专用文本，放行
       ③ 疑似静默      → 有文本、被隐藏、且没有声明理由

     第 ③ 类逐条列出来给人裁定：该 expand 的、还是该 omit 的。

   为什么第一版只报告不失败
     现在会把导航、装饰、屏幕提示一起列出来，几十条混在一起分不清真假。
     先出清单 → 人工确认哪些是 bug → 写成 printPolicy → 再转硬判据。
     直接硬 FAIL 的结果只有一个：被加到白名单里关掉。

   实现要点（踩过的坑，别再踩）
     · 页面内代码写成**真函数**再交给 evaluate，不用模板字符串 ——
       模板字符串里的反引号会截断字符串（本轮踩了三次）。
     · 不能靠 grid-template-rows: 0fr 判断收起：它的 computed 是 px
       （fr 被 min-content 撑开，实测 0fr → 24px）。
     · 必须先查 display:none 系，再查 visibility —— display:none 子树内
       所有元素的 computed visibility 也是 hidden，顺序反了会把折叠面板
       里的文字误标成 visibility:hidden 并重复计数。

   用法
     node 05-audit/print-content-audit.js              # 13 页（门禁采样 + 组件 demo）
     node 05-audit/print-content-audit.js --all        # 全集 43 页
     node 05-audit/print-content-audit.js --print      # 在 print 媒体下审（已应用 @media print）
     node 05-audit/print-content-audit.js --page finance-report
     node 05-audit/print-content-audit.js --json out.json
     node 05-audit/print-content-audit.js --selftest
   ========================================================================== */
'use strict';

const { launch } = require('./browser.js');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

/* 声明排除：这些有文本、但按设计不该上纸，或本来就只给读屏。
   每加一条都要能说出"它为什么不算内容"。 */
const DECLARED = [
  ['.no-print', 'wrote .no-print'],
  ['.toast', 'omit: toast'],
  ['.tooltip', 'omit: tooltip'],
  ['.popover', 'omit: popover'],
  ['.skeleton', 'omit: skeleton'],
  /* ⚠️ 这里曾经有一条 `.overlay`。2026-11-02 查 print-policy-gate 时发现：
     全库没有任何 CSS 定义过 `.overlay`（真正的遮罩叫 `.dialog-backdrop`），
     那条"声明排除"在给一个不存在的类发通行证。死条目比没有条目更坏 ——
     它会让人以为「这一块已经审过了」。 */
  ['.pagination', 'omit: pagination'],
  ['.tabs__list', 'omit: tab 标签栏'],
  ['.nav__list', 'omit: 导航链接'],
  ['.nav__toggle', 'omit: 汉堡按钮'],
  ['.accordion__marker', 'omit: 展开箭头'],
  ['.rep__aside', 'omit: report 屏幕边注（@media print 里 display:none）'],
  ['.sr-only', 'a11y: 读屏专用'],
  ['.visually-hidden', 'a11y: 读屏专用'],
  ['.skip-link', 'a11y: 跳转链接'],
];

/* ---------------------------------------------------------------- 页面内审计
   这是一个**真函数**，由 puppeteer 序列化后注入页面执行。
   只能用参数与 DOM API，不能引用外部变量。 */
function auditInPage(DECLARED) {
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

  function hideReason(el) {
    /* 第一趟：display:none 系（含 hidden 属性）。
       display:none 子树内所有元素的 computed visibility 也是 hidden，
       先查 visibility 会把折叠面板里的文字误标并重复计数。 */
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none') {
        return { el: n, why: n.hasAttribute('hidden') ? 'hidden 属性' : 'display:none' };
      }
      n = n.parentElement;
    }
    /* 第二趟：visibility 与裁切 */
    n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden') return { el: n, why: 'visibility:hidden' };
      if (cs.overflow === 'hidden' || cs.overflowY === 'hidden' || cs.overflowX === 'hidden') {
        const r = n.getBoundingClientRect();
        if (r.height < 1) return { el: n, why: '高度 0 + 裁切' };
      }
      n = n.parentElement;
    }
    return null;
  }

  function declaredBy(el) {
    for (let i = 0; i < DECLARED.length; i++) {
      const sel = DECLARED[i][0];
      const why = DECLARED[i][1];
      const hit = el.closest(sel);
      if (hit) return { el: hit, why: why, sel: sel };
    }
    return null;
  }

  function textNodes() {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p || SKIP_TAGS[p.tagName]) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (w.nextNode()) out.push(w.currentNode);
    return out;
  }

  const nodes = textNodes();
  const groups = new Map();
  let visibleChars = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const txt = node.nodeValue.replace(/\s+/g, ' ').trim();
    if (!txt) continue;
    const el = node.parentElement;

    /* 顺序很重要：先判「有没有声明」，再判「隐没隐藏」。
       .no-print 在屏幕上是可见的（display:none 在 @media print 里），
       先判隐藏会让它走进"可见"分支，永远进不了"声明排除"。 */
    const dec = declaredBy(el);
    if (dec) {
      const key = 'D|' + dec.sel;
      if (!groups.has(key)) {
        groups.set(key, {
          kind: 'declared', why: dec.why, where: pathOf(dec.el),
          whereTag: label(dec.el), chars: 0, samples: [],
        });
      }
      const g = groups.get(key);
      g.chars += txt.length;
      if (g.samples.length < 2) g.samples.push(txt.slice(0, 40));
      continue;
    }

    const hid = hideReason(el);
    if (!hid) { visibleChars += txt.length; continue; }

    const key = 'H|' + pathOf(hid.el) + '|' + hid.why;
    if (!groups.has(key)) {
      groups.set(key, {
        kind: 'silent', why: hid.why, where: pathOf(hid.el),
        whereTag: label(hid.el), chars: 0, samples: [],
      });
    }
    const g = groups.get(key);
    g.chars += txt.length;
    if (g.samples.length < 2) g.samples.push(txt.slice(0, 40));
  }

  return { visibleChars: visibleChars, groups: Array.from(groups.values()) };
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

async function main() {
  if (has('--selftest')) { await selftest(); return; }

  const only = val('--page');
  let pages = has('--all') ? allPages() : FIXED;
  if (only) pages = pages.filter(([id, u]) => id === only || u.indexOf(only) >= 0);
  if (!pages.length) { console.error('没有匹配的页面：' + only); process.exit(2); }

  const browser = await launch();
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 900 });

  /* `--print`：切到 print 媒体再审计。
     这才是「最终会印什么」的权威口径 —— 屏幕态看不到 @media print 的效果
     （比如 .no-print 在屏幕上可见、tabs 面板在屏幕上仍是 hidden）。
     不加这个参数时审的是屏幕态，用来定位「结构性隐藏」。 */
  const inPrint = has('--print');

  const rows = [];
  let totVisible = 0, totSilent = 0, totDeclared = 0;

  for (const [id, url] of pages) {
    let r;
    try {
      await p.goto(BASE + url, { waitUntil: 'networkidle0', timeout: 20000 });
      if (inPrint) await p.emulateMediaType('print');
      else await p.emulateMediaType('screen');
      await new Promise((res) => setTimeout(res, 300));
      r = await p.evaluate(auditInPage, DECLARED);
    } catch (e) {
      console.log('  ⚠️  ' + id + ' 打不开：' + e.message.slice(0, 60));
      continue;
    }
    const silent = r.groups.filter((g) => g.kind === 'silent');
    const declared = r.groups.filter((g) => g.kind === 'declared');
    const sChars = silent.reduce((a, g) => a + g.chars, 0);
    const dChars = declared.reduce((a, g) => a + g.chars, 0);
    totVisible += r.visibleChars; totSilent += sChars; totDeclared += dChars;
    rows.push({ id: id, url: url, visible: r.visibleChars, silent: sChars,
      declared: dChars, groups: r.groups });
  }
  await browser.close();

  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);

  console.log('');
  console.log('  内容完整性审计（审计模式 · 只报告不判红）  媒体: '
    + (inPrint ? 'print' : 'screen'));
  console.log('  ' + '-'.repeat(76));
  console.log('  ' + pad('页面', 30) + num('可见字', 8) + num('声明排除', 9)
    + num('疑似', 9) + num('不印占比', 10));
  console.log('  ' + '-'.repeat(76));
  const sorted = rows.slice().sort((a, b) => b.silent - a.silent);
  for (const row of sorted) {
    if (row.silent + row.declared === 0) continue;
    const denom = row.visible + row.silent + row.declared;
    const pct = denom ? (row.silent * 100 / denom).toFixed(0) + '%' : '-';
    console.log('  ' + pad(row.id, 30) + num(row.visible, 8) + num(row.declared, 9)
      + num(row.silent || '.', 9) + num(pct, 10));
  }
  console.log('  ' + '-'.repeat(76));
  const denomAll = totVisible + totSilent + totDeclared;
  console.log('  ' + pad('合计', 30) + num(totVisible, 8) + num(totDeclared, 9)
    + num(totSilent, 9) + num((totSilent * 100 / denomAll).toFixed(0) + '%', 10));
  console.log('');

  const allSilent = [];
  for (const row of rows) {
    for (const g of row.groups) {
      if (g.kind === 'silent') {
        allSilent.push({ page: row.id, url: row.url, why: g.why, where: g.where,
          whereTag: g.whereTag, chars: g.chars, samples: g.samples });
      }
    }
  }
  allSilent.sort((a, b) => b.chars - a.chars);

  if (allSilent.length) {
    console.log('  疑似静默截断（有文本 / 被隐藏 / 没有声明理由）');
    console.log('  ' + '-'.repeat(76));
    for (const g of allSilent.slice(0, 40)) {
      console.log('  ' + num(g.chars, 5) + ' 字  ' + g.whereTag
        + '    [' + g.why + ']  ' + g.page);
      console.log('         "' + (g.samples[0] || '').slice(0, 34) + '"'
        + (g.samples[1] ? ' / "' + g.samples[1].slice(0, 26) + '"' : ''));
    }
    if (allSilent.length > 40) console.log('  ... 还有 ' + (allSilent.length - 40) + ' 处');
    console.log('');
  }

  console.log('  -- 怎么读这份清单 --');
  console.log('  「声明排除」= .no-print / omit 类组件 / 读屏专用，按设计该排除。');
  console.log('  「疑似」= 有文本、被隐藏、没有任何声明 —— 每一条都要人裁定：');
  console.log('           该 expand（tabs/accordion 折叠内容）、还是该 omit（写 .no-print）。');
  console.log('  裁定完写进 printPolicy，疑似才会变成 0。');
  console.log('');

  const json = val('--json');
  if (json) {
    fs.writeFileSync(json, JSON.stringify({
      rows: rows.map((r) => ({ id: r.id, url: r.url, visible: r.visible,
        silent: r.silent, declared: r.declared })),
      silent: allSilent,
    }, null, 1));
    console.log('  明细已写入 ' + json);
  }

  /* 审计模式：永远 0。要判红得等清单收敛 + printPolicy 落地。 */
  process.exit(0);
}

/* ---------------------------------------------------------------- 自检 */

async function selftest() {
  const cases = [
    { name: '全可见', html: '<p>AAA</p>', expect: { silent: 0, declared: 0 } },
    { name: '.no-print 归声明（屏幕态它可见）',
      html: '<div class="no-print"><p>BBB</p></div>',
      expect: { silent: 0, declared: 3 } },
    { name: 'tabs 面板 hidden 归疑似',
      html: '<div class="tabs__panel" hidden><p>CCC</p></div>',
      expect: { silent: 3, declared: 0 } },
    { name: 'accordion 0fr + inner 裁切归疑似',
      html: '<style>.ap{display:grid;grid-template-rows:0fr}.ap>.in{overflow:hidden}</style>'
        + '<div class="ap"><div class="in"><div>DDD</div></div></div>',
      expect: { silent: 3, declared: 0 } },
    { name: 'grid 1fr 算可见',
      html: '<div style="display:grid;grid-template-rows:1fr"><div>EEE</div></div>',
      expect: { silent: 0, declared: 0 } },
    { name: '高度 0 + 裁切归疑似',
      html: '<div style="height:0;overflow:hidden"><div>FFF</div></div>',
      expect: { silent: 3, declared: 0 } },
    { name: 'display:none 子树只计一次（不重复）',
      html: '<div style="display:none"><p>GGG</p><p>HHH</p></div>',
      expect: { silent: 6, declared: 0 } },
  ];
  const browser = await launch();
  const p = await browser.newPage();
  let pass = 0, fail = 0;
  for (const c of cases) {
    await p.setContent('<!doctype html><meta charset="utf-8"><body>' + c.html + '</body>');
    const r = await p.evaluate(auditInPage, DECLARED);
    const silent = r.groups.filter((g) => g.kind === 'silent')
      .reduce((a, g) => a + g.chars, 0);
    const declared = r.groups.filter((g) => g.kind === 'declared')
      .reduce((a, g) => a + g.chars, 0);
    const ok = silent === c.expect.silent && declared === c.expect.declared;
    if (ok) pass++; else fail++;
    console.log('  ' + (ok ? 'OK  ' : 'FAIL ') + c.name
      + '   疑似=' + silent + '（期望 ' + c.expect.silent + '）'
      + '  声明=' + declared + '（期望 ' + c.expect.declared + '）');
  }
  await browser.close();
  console.log('\n  自检 ' + pass + '/' + (pass + fail) + ' 通过');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
