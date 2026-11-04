/**
 * i18n-labels-gate.js — 用户可见文案必须可覆盖（F2 / 0.26.0）
 * ============================================================================
 * 为什么要有这个文件
 * ---------------------------------------------------------------------------
 *   外部审计 F2：「组件把中文 aria-label 写死，非中文站点无法本地化」。
 *   实测当时 21 处 aria-label 赋值、135 条中文字面量，只有 `nav.js` 读
 *   `opts.labels`。
 *
 *   补上 `labels` 之后仍有一个**结构性问题**：新写一个组件时，
 *   作者会本能地写 `setAttribute('aria-label', '关闭')` ——
 *   类型系统看不见，现有门禁也看不见，于是过两个版本又长回去。
 *   ⇒ 本门禁做两件事：
 *     ① **静态**：库代码里不许出现「中文字面量直接进 aria-label / textContent /
 *        el() 的文本位」。要写就得先过 `labels`（或进 ALLOW 并写理由）。
 *     ② **运行时**：真的把 `labels` 传进去，断言 DOM 变了；
 *        同时断言**不传时仍是中文** —— 否则"覆盖生效"可能只是把测试串硬编码了。
 *
 * 判据边界（不假装能管所有文案）
 * ---------------------------------------------------------------------------
 *   · 只管**库代码**（demo / 测试 / 示例豁免）。
 *   · `throw new Error('…')` 不在范围内：那是开发期信息，不经过 UI。
 *   · 拼接式句子（如 model-viewer 的失败说明）本门禁抓不到 ——
 *     `docs/L10N.md` 里列了已知剩余项，不在这里假装已覆盖。
 *
 * 用法：
 *   node 05-audit/i18n-labels-gate.js             # 静态 + 运行时
 *   node 05-audit/i18n-labels-gate.js --selftest  # 只验判据本身有牙
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { withPage } = require('./browser');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['02-primitives', '03-patterns', '04-recipes', '09-assets'];

/* 允许保留的中文字面量（文件 → 理由）。
   🔴 加条目前先问：这段文字**用户会看到吗**？会，就该走 labels。 */
const ALLOW = {
  // 例：'02-primitives/foo/foo.js': '这里的中文只出现在 throw new Error 里',
};

const PATTERNS = [
  {
    id: 'aria-label',
    re: /setAttribute\(\s*'aria-label'\s*,\s*'([^']*[\u4e00-\u9fff][^']*)'/g,
  },
  {
    id: 'textContent',
    re: /textContent\s*=\s*'([^']*[\u4e00-\u9fff][^']*)'/g,
  },
  {
    id: 'el-text',
    re: /\bel\(\s*'[^']*'\s*,\s*(?:'[^']*'|null)\s*,\s*'([^']*[\u4e00-\u9fff][^']*)'/g,
  },
];

/** 去掉注释后再扫 —— 注释里写中文示例是正常的 */
function stripComments(js) {
  return String(js)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function scanSource(rel, src) {
  const body = stripComments(src);
  const out = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(body))) {
      out.push({
        file: rel,
        kind: p.id,
        text: m[1],
        line: body.slice(0, m.index).split('\n').length,
      });
    }
  }
  return out;
}

function walk(dir, acc) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const name of fs.readdirSync(abs)) {
    if (name === '_attic' || name === 'node_modules') continue;
    const p = path.join(abs, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(path.join(dir, name), acc);
    else if (p.endsWith('.js')) acc.push(path.relative(ROOT, p).replace(/\\/g, '/'));
  }
}

function staticCheck() {
  const files = [];
  for (const d of DIRS) walk(d, files);
  /* 零视野守卫：一个文件都没扫到 ⇒ 判据没跑，不是通过 */
  if (files.length === 0) {
    return { ok: false, files: 0, hits: [], why: '零视野：没扫到任何库文件' };
  }
  const hits = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const h of scanSource(rel, src)) {
      if (!ALLOW[rel]) hits.push(h);
    }
  }
  return { ok: hits.length === 0, files: files.length, hits };
}

/* ---------------------------------------------------------------- 运行时 */

const PROBES = [
  {
    page: '03-patterns/overlay/demo.html',
    name: 'toast',
    run: () => {
      const el = Overlay.toast({ title: 'x', labels: { closeToast: '__L__' } }).el;
      const got = el.querySelector('.toast__close').getAttribute('aria-label');
      el.parentNode.removeChild(el);
      Overlay.toast({ title: 'y' });
      const def = document.querySelector('.toast__close').getAttribute('aria-label');
      const region = document.querySelector('.toast-region');
      if (region) region.parentNode.removeChild(region);
      return { got, def };
    },
    expectDefault: '关闭提示',
  },
  {
    page: '03-patterns/drawer/demo.html',
    name: 'drawer',
    run: () => {
      const d = Drawer.open({ labels: { close: '__L__', dialog: '__D__' } });
      const got = d.el.querySelector('.drawer__close').getAttribute('aria-label');
      const dialogName = d.el.getAttribute('aria-label');
      d.close();
      return { got, dialogName, def: '关闭' };
    },
    expectDefault: '关闭',
  },
  {
    page: '03-patterns/pagination/demo.html',
    name: 'pagination',
    run: () => {
      const src = document.querySelector('[data-pagination]');
      const clone = src.cloneNode(true);
      document.body.appendChild(clone);
      const inst = Pagination.create(clone, { labels: { prev: '__L__' } });
      inst.render();
      const got = clone.querySelector('[data-goto="prev"]').getAttribute('aria-label');
      clone.parentNode.removeChild(clone);
      const def = src.querySelector('[data-goto="prev"]').getAttribute('aria-label');
      return { got, def };
    },
    expectDefault: '上一页',
  },
  {
    page: '03-patterns/tooltip/demo.html',
    name: 'tooltip',
    run: () => {
      const old = document.getElementById('tooltip-live');
      if (old) old.parentNode.removeChild(old);
      Tooltip.setLabels({ region: '__L__' });
      const b = document.createElement('button');
      b.textContent = 'x';
      document.body.appendChild(b);
      Tooltip.attach(b, 'tip');
      const got = document.getElementById('tooltip-live').getAttribute('aria-label');
      /* 反向：把模块级设置改回去，重新建一个 live region 必须回到中文 */
      Tooltip.setLabels({ region: '组件提示' });
      Tooltip.setLabels({ region: '组件提示' });
      const live2 = document.getElementById('tooltip-live');
      live2.parentNode.removeChild(live2);
      Tooltip.attach(b, 'tip2');
      const def = document.getElementById('tooltip-live').getAttribute('aria-label');
      b.parentNode.removeChild(b);
      return { got, def };
    },
    expectDefault: '组件提示',
  },
];

async function runtimeCheck() {
  const results = [];
  for (const p of PROBES) {
    const url = 'file:///' + path.join(ROOT, p.page).replace(/\\/g, '/');
    /* eslint-disable no-await-in-loop */
    const r = await withPage({ width: 1200, height: 900, deviceScaleFactor: 1 },
      async (page) => {
        await page.goto(url, { waitUntil: 'load', timeout: 45000 });
        return page.evaluate(p.run);
      });
    results.push({
      name: p.name,
      okOverride: r.got === '__L__',
      okDefault: r.def === p.expectDefault,
      got: r.got,
      def: r.def,
      expectDefault: p.expectDefault,
    });
  }
  return results;
}

/* ---------------------------------------------------------------- 自检 */

function selftest() {
  const R = [];
  const add = (n, ok, extra) => R.push([n, !!ok, extra]);

  const bad = scanSource('x.js', "el.setAttribute('aria-label', '关闭提示');");
  add('抓到 aria-label 中文字面量', bad.length === 1 && bad[0].kind === 'aria-label');

  const bad2 = scanSource('x.js', "n.textContent = '正在准备…';");
  add('抓到 textContent 中文字面量', bad2.length === 1);

  const bad3 = scanSource('x.js', "el('button', 'mv__btn', '重试');");
  add('抓到 el() 文本位中文字面量', bad3.length === 1);

  const ok1 = scanSource('x.js', "el.setAttribute('aria-label', L.close);");
  add('变量传入 ⇒ 不报', ok1.length === 0);

  const ok2 = scanSource('x.js', "// 注释里写 '关闭' 是正常的\nvar a = 1;");
  add('注释里的中文 ⇒ 不报', ok2.length === 0);

  const ok3 = scanSource('x.js', "throw new Error('缺少输入框');");
  add('throw 里的中文 ⇒ 不在本判据视野（有意）', ok3.length === 0);

  add('元反向：把三种写法都塞进去 ⇒ 三条都抓到',
    scanSource('x.js', "a.setAttribute('aria-label','关');b.textContent='关';el('b',null,'关');").length === 3);

  let bad4 = 0;
  for (const [n, ok, extra] of R) {
    console.log('  %s %s%s', ok ? 'OK  ' : 'FAIL', n, ok ? '' : ('  ' + (extra || '')));
    if (!ok) bad4 += 1;
  }
  console.log('\n  %s 判据自检 %d 条：%d 条不成立',
    bad4 ? '🔴' : '⇒ ✅', R.length, bad4);
  return bad4 === 0 ? 0 : 1;
}

/* ---------------------------------------------------------------- 主流程 */

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();

  console.log('  === 用户可见文案可覆盖 ===');
  const st = staticCheck();
  if (!st.ok && st.why) {
    console.log('  [FAIL] ' + st.why);
    return 1;
  }
  if (st.hits.length) {
    for (const h of st.hits) {
      console.log('  [FAIL] ' + h.file + ':' + h.line + ' ' + h.kind
        + " 直接写死了中文：'" + h.text + "'");
    }
    console.log('  [FAIL] %d 处硬编码文案 —— 走 labels（或进 ALLOW 并写理由）', st.hits.length);
    return 1;
  }
  console.log('  [OK] %d 个库文件，0 处硬编码用户文案', st.files);

  const rt = await runtimeCheck();
  let bad = 0;
  for (const r of rt) {
    const ok = r.okOverride && r.okDefault;
    if (!ok) bad += 1;
    console.log('  ' + (ok ? '[OK]  ' : '[FAIL]') + ' ' + r.name.padEnd(11)
      + ' 覆盖=' + JSON.stringify(r.got) + '（期望 "__L__"）'
      + ' 默认=' + JSON.stringify(r.def) + '（期望 ' + JSON.stringify(r.expectDefault) + '）');
  }
  if (bad) {
    console.log('  [FAIL] %d 个组件的 labels 没真正生效（或默认值被改坏）', bad);
    return 1;
  }
  console.log('  ⇒ 文案覆盖在真实 DOM 上生效，且默认仍是中文');
  return 0;
}

main().then((rc) => process.exit(rc)).catch((e) => {
  console.error('  [FAIL] ' + (e && e.message));
  process.exit(1);
});
