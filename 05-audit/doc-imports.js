#!/usr/bin/env node
/* LAYER: component */
/* ============================================================================
 * doc-imports.js — 文档里写的 import 路径，必须真的能解析
 *
 * 用法：
 *   node 05-audit/doc-imports.js --consumer <装好了本包的目录> [--pkg <包名>]
 *   node 05-audit/doc-imports.js --selftest       （反向控制，不碰仓库）
 *
 * ---------------------------------------------------------------------------
 * 🔴 为什么需要这一道（外部审计 2026-11-03 · P1-1/P1-2）
 *
 *   `entry-resolve.js` 判的是「**exports 声明的**每个入口能解析」。
 *   它遍历的是 package.json 的 key，用包内文件去套通配符。
 *   于是有一类事故它天生看不见：**文档写的路径，和 exports 的组合结果不一致**。
 *
 *   实测漏网的两个（0.25.2）：
 *     API.md 写      import { Accordion } from 'agentcss/esm/accordion.mjs'
 *     package.json   "./esm/*": "./esm/*.mjs"
 *     ⇒ 通配符把 `.mjs` 又拼一次 ⇒ `accordion.mjs.mjs` ⇒ ERR_MODULE_NOT_FOUND
 *
 *     types/index.d.ts 写   import { Select } from 'agentcss'
 *     package.json          ".": { "default": "./index.html" }
 *     ⇒ import 一个 HTML ⇒ ERR_UNKNOWN_FILE_EXTENSION
 *
 *   两个都躲过了 entry-resolve（它不读文档）、pack-closure（只判文件在不在）、
 *   `node --check`（只判语法）。**说明"读文档的那一方"从来没有被测过。**
 *
 * ⭐ 只解析、不执行：这是 CSS/标签库，模块体里碰 document，
 *    在 Node 里执行必然抛错（那是假红）。`require.resolve` 走的是
 *    Node 真正的 exports 算法，但不求值 —— 正是我们要的那一层。
 *
 * ---------------------------------------------------------------------------
 * 🔴 2026-11-04 重构（I-10：被跑到，却没自证有牙）
 *
 *   旧版有三个洞，都是「报告通过但什么都没检查」的同型：
 *     ① 读的是**仓库**的 6 份文档，却在**消费者**侧解析 ⇒ 验错了对象。
 *        装到用户手里的是 tarball 里那一份，不是工作区这一份。
 *     ② `scanned=0` / 抽出 0 条 / 全是占位符，都照样 `return 0`
 *        ⇒ 文档被删光、正则失效、路径全写成 `<组件>`，门禁全绿。
 *     ③ FILES 硬编码且没有「新文档漏网」的守卫：加一份写了入口的文档，
 *        没人知道它没被扫到。
 *
 *   ⇒ 现在判据对象是 **已安装包里的文档**；抽出纯函数 `auditDocs()`，
 *     由 `--selftest` 用合成输入 + 临时 mini 包做反向控制（含 0.25.3
 *     那次 `.mjs.mjs` 事故的**历史坏数据回放**）。`selftest-all.py` 会
 *     自动发现并跑它。
 *
 * ⚠️ 已知边界（写清楚，不假装覆盖）：
 *    · 只认出现在**引号里**的 specifier；散文里提到的 `agentcss/esm` 不算
 *    · 只判「对外承诺入口」的文档（FILES）。包内其它文档里含字面路径的
 *      必须**显式登记**：进 FILES 一起判，或进 EXEMPT 写明为什么豁免；
 *      没登记的一律报红。CHANGELOG.md 属于后者 —— 0.25.3 的事故记录里
 *      故意写着当时的坏路径，改它等于篡改历史。
 *    · HTML 里的 `<script src>` 由 `pack-closure.js` 判，不在本判据视野
 *    · 动态拼接（import('./' + x)）不算 specifier，也猜不出来
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '..');

/* 对外承诺入口的文档。这是「哪些文档算承诺」的**唯一真源**（I-7）。
   加新文档时补进来 —— 没被扫到的文档等于没人守。 */
const FILES = [
  'API.md',
  'START-HERE.md',
  'README.md',
  'README.zh-CN.md',
  'types/index.d.ts',
  'llms.txt',
];

/* 显式豁免：含 agentcss 字面路径、但**不是**对外承诺的文档。
   🔴 每条都要写理由；清单里的名字必须真的出现在包里（死豁免 ⇒ 红），
      防止「豁免了一个永远不存在的名字」变成没人看得见的空洞。 */
const EXEMPT = {
  'CHANGELOG.md':
    '历史事故记录（0.25.3 修掉的四处）里故意写下的坏路径，不是给读者照抄的入口',
};

/* 算「文档」的后缀。包内其它文件（HTML/CSS/JS）各有自己的判据。 */
const DOC_RE = /\.(?:md|txt|d\.ts)$/i;

/* 五种写法：from 'x' / import('x') / import 'x' / require('x') /
   require.resolve('x') / import.meta.resolve('x')。
   `export { X } from 'x'` 已被第一条（from）覆盖。 */
const PATTERNS = [
  /(?:^|[^A-Za-z0-9_$])from\s+['"](agentcss[^'"\n]*)['"]/g,
  /\bimport\s*\(\s*['"](agentcss[^'"\n]*)['"]/g,
  /\bimport\s+['"](agentcss[^'"\n]*)['"]/g,
  /\bimport\.meta\.resolve\s*\(\s*['"](agentcss[^'"\n]*)['"]/g,
  /\brequire\.resolve\s*\(\s*['"](agentcss[^'"\n]*)['"]/g,
  /\brequire\s*\(\s*['"](agentcss[^'"\n]*)['"]/g,
];

/* 占位符：文档里教「换成你的组件名」的地方，机械解析必然失败。
   🔴 不静默跳过 —— 单列出来；而且**一条都没真验证过**时要报红。 */
const PLACEHOLDER = /[<>{}*$]/;

function argOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

function extractSpecifiers(src) {
  const found = new Map(); /* specifier -> 首次出现的行号 */
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const spec = m[1].trim();
      if (!found.has(spec)) {
        found.set(spec, src.slice(0, m.index).split('\n').length);
      }
    }
  }
  return found;
}

/** 读已安装包里的全部文档：{ 相对路径: 文本 }。 */
function readDocs(pkgDir) {
  const out = {};
  (function walk(rel) {
    const abs = rel ? path.join(pkgDir, rel) : pkgDir;
    let names;
    try { names = fs.readdirSync(abs); } catch (e) { return; }
    for (const n of names) {
      if (n === 'node_modules' || n === '.git' || n === '_attic') continue;
      const r = rel ? rel + '/' + n : n;
      const p = path.join(pkgDir, r);
      let st;
      try { st = fs.statSync(p); } catch (e) { continue; }
      if (st.isDirectory()) { walk(r); continue; }
      if (!DOC_RE.test(n)) continue;
      try { out[r] = fs.readFileSync(p, 'utf8'); } catch (e) { /* 读不了交给守卫 */ }
    }
  })('');
  return out;
}

/**
 * 纯判据（可注入）：把文档当消费者，逐条真解析。
 *
 * @param docs    {rel: text} —— **包内**文档；不是仓库里的副本
 * @param resolve fn(spec) —— 抛错即「照抄会失败」；真跑时传 createRequire().resolve
 * @param opts    {files, exempt} —— 供反向控制注入合成清单
 * @returns {scanned,total,ok,bad,placeholders,uncovered,deadExempt,errs}
 *
 * 🔴 零视野守卫（README「新增门禁清单」第 2 条）：
 *    扫到 0 份 / 抽出 0 条 / 0 条被真验证 / 死豁免 ⇒ 一律红，不判通过。
 */
function auditDocs(docs, resolve, opts) {
  opts = opts || {};
  const files = opts.files || FILES;
  const exempt = opts.exempt || EXEMPT;
  const r = {
    scanned: [], total: 0, ok: [], bad: [], placeholders: [],
    uncovered: [], deadExempt: [], errs: [],
  };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /* ① 承诺文档必须在包里；少一份就是判据没视野，不是「没问题」。 */
  for (const rel of files) {
    if (!has(docs, rel)) r.errs.push('对外承诺文档不在包里：' + rel);
    else r.scanned.push(rel);
  }
  if (!r.scanned.length) r.errs.push('零视野：一份承诺文档都没扫到');

  /* ② 豁免必须真用到。 */
  for (const rel of Object.keys(exempt)) {
    if (!has(docs, rel)) r.deadExempt.push(rel);
  }
  if (r.deadExempt.length) {
    r.errs.push('死豁免（包里没有这些文档，豁免毫无意义）：' +
                r.deadExempt.join(', '));
  }

  /* ③ 视野发现：包内任何**未登记**文档里出现了 agentcss 字面路径 ⇒ 红。
        这是「加了一份写了入口的新文档，没人知道它没被扫」的守卫。 */
  for (const rel of Object.keys(docs).sort()) {
    if (!DOC_RE.test(rel)) continue;
    if (files.indexOf(rel) >= 0 || has(exempt, rel)) continue;
    if (extractSpecifiers(docs[rel]).size > 0) r.uncovered.push(rel);
  }
  if (r.uncovered.length) {
    r.errs.push('未登记文档含 agentcss 字面路径（进 FILES 一起判，或进 EXEMPT 写明理由）：' +
                r.uncovered.join(', '));
  }

  /* ④ 逐条真解析。 */
  for (const rel of r.scanned) {
    for (const [spec, line] of extractSpecifiers(docs[rel])) {
      r.total += 1;
      if (PLACEHOLDER.test(spec)) {
        r.placeholders.push({ file: rel, line, spec });
        continue;
      }
      try {
        resolve(spec);
        r.ok.push({ file: rel, line, spec });
      } catch (e) {
        r.bad.push({ file: rel, line, spec, code: e.code || e.message });
      }
    }
  }
  if (r.total === 0) {
    r.errs.push('零视野：从承诺文档里抽出 0 条 agentcss 字面路径');
  }
  if (r.ok.length === 0 && r.bad.length === 0) {
    /* 有 bad 时已经红了，不再叠一条零视野噪音；这里专抓「全占位符」形态 */
    r.errs.push('零视野：0 条路径被真验证过' +
                (r.placeholders.length ? '（抽出来的全是占位符）' : ''));
  }
  return r;
}

function fails(r) {
  return r.errs.length > 0 || r.bad.length > 0;
}

function printReport(r) {
  console.log('  === 文档里的 import 路径（判据对象＝已安装包里的文档）===');
  console.log('  扫了 ' + r.scanned.length + ' 份承诺文档 · 抽出 ' + r.total +
              ' 条字面路径 · 真解析通过 ' + r.ok.length + ' 条 · 占位符 ' +
              r.placeholders.length + ' 条');
  if (r.placeholders.length) {
    console.log('  ·    ' + r.placeholders.length +
                ' 条是占位符（含 <>/{}/*），单列出来、不计作已验证：');
    for (const p of r.placeholders.slice(0, 6)) {
      console.log('        ' + p.file + ':' + p.line + '  ' + p.spec);
    }
  }
  if (r.uncovered.length) {
    for (const u of r.uncovered) console.log('  X    未登记文档：' + u);
  }
  if (r.bad.length) {
    console.log('  X    ' + r.bad.length + ' 条解析不了（照着文档写会直接构建失败）：');
    for (const b of r.bad.slice(0, 20)) {
      console.log('        ' + b.file + ':' + b.line + '  ' + b.spec + '  → ' + b.code);
    }
    if (r.bad.length > 20) console.log('        …还有 ' + (r.bad.length - 20) + ' 条');
  }
  for (const e of r.errs) console.log('  X    ' + e);
  if (!fails(r)) {
    console.log('  OK   ' + r.ok.length + ' 条路径全部能被消费者侧解析，视野守卫齐全');
    return 0;
  }
  return 1;
}

function main(argv) {
  const consumer = argOf(argv, '--consumer');
  if (!consumer || !fs.existsSync(consumer)) {
    console.error('用法：node 05-audit/doc-imports.js --consumer <目录> [--pkg <包名>]');
    return 2;
  }
  const cDir = path.resolve(consumer);
  let name = argOf(argv, '--pkg');
  if (!name) {
    try { name = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name; }
    catch (e) { console.error('  X    读不到仓库 package.json，请传 --pkg'); return 2; }
  }
  const pkgDir = path.join(cDir, 'node_modules', name);
  if (!fs.existsSync(path.join(pkgDir, 'package.json'))) {
    console.log('  X    找不到已安装的包：' + pkgDir);
    return 1;
  }
  const req = createRequire(path.join(cDir, '__probe__.js'));
  return printReport(auditDocs(readDocs(pkgDir), (s) => req.resolve(s)));
}

/* ==========================================================================
 * --selftest：反向控制。全部在内存 / 系统临时目录里造，不碰仓库（selftest-all
 * 判据 ③ 要求跑完工作区一字不变）。
 * ========================================================================*/
function fakeResolve(badSet) {
  return function (s) {
    if (badSet && badSet.indexOf(s) >= 0) {
      const e = new Error('synthetic: not found');
      e.code = 'ERR_MODULE_NOT_FOUND';
      throw e;
    }
    return 'resolved:' + s;
  };
}

/** 造一个最小的真包：用于回放 0.25.3 的 `.mjs.mjs` 事故。 */
function miniPackage(exportsMap, md) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcss-docimports-'));
  const consumer = path.join(tmp, 'consumer');
  const pkg = path.join(consumer, 'node_modules', 'agentcss');
  fs.mkdirSync(path.join(pkg, 'esm'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'),
    JSON.stringify({ name: 'agentcss', version: '0.0.0', exports: exportsMap }));
  fs.writeFileSync(path.join(pkg, 'esm', 'accordion.mjs'), 'export const x = 1;');
  fs.writeFileSync(path.join(pkg, 'README.md'),
    md || "import 'agentcss/esm/accordion.mjs'\n");
  fs.writeFileSync(path.join(pkg, 'CHANGELOG.md'),
    "历史事故：import 'agentcss/esm/nope.mjs' 曾解析失败\n");
  return {
    tmp: tmp,
    docs: readDocs(pkg),
    resolve: function (s) {
      return createRequire(path.join(consumer, '__probe__.js')).resolve(s);
    },
  };
}

function selftest() {
  const bad = [];
  const report = (cond, name, detail) => {
    if (!cond) bad.push(name + (detail ? '（' + detail + '）' : ''));
    console.log('  ' + (cond ? '[OK]  ' : '[FAIL]') + ' ' + name);
  };
  const F = ['README.md'];
  const E = { 'CHANGELOG.md': '合成夹具里的历史记录' };
  const okResolve = fakeResolve([]);
  const good = { 'README.md': "import 'agentcss'\n", 'CHANGELOG.md': '无路径' };

  /* ① 正向控制 + 良性对照 */
  let r = auditDocs(good, okResolve, { files: F, exempt: E });
  report(!fails(r) && r.ok.length === 1 && r.scanned.length === 1,
    '合法包 ⇒ 绿，且确实真解析了 1 条（不是 0/0 通过）');

  /* ② 坏路径 ⇒ 红；并证明只红该红的那一条 */
  r = auditDocs({ 'README.md': "import 'agentcss/esm/nope.mjs'\n", 'CHANGELOG.md': '无路径' },
    fakeResolve(['agentcss/esm/nope.mjs']), { files: F, exempt: E });
  report(fails(r) && r.bad.length === 1 &&
         r.bad[0].spec === 'agentcss/esm/nope.mjs',
    '坏路径 ⇒ 红，且精确报出那一条');

  /* ③ 元反向：把同一条坏路径换成能解析的，红必须消失 */
  r = auditDocs({ 'README.md': "import 'agentcss/esm/nope.mjs'\n", 'CHANGELOG.md': '无路径' },
    okResolve, { files: F, exempt: E });
  report(!fails(r), '元反向：同一份文档、只让解析成功 ⇒ 不再红（红来自路径）');

  /* ④ 零视野的三种形态，都得红 */
  report(fails(auditDocs({}, okResolve, { files: F, exempt: E })),
    '零视野：包里一份文档都没有 ⇒ 红');
  report(fails(auditDocs({ 'README.md': '纯散文，没有引用', 'CHANGELOG.md': '无路径' },
    okResolve, { files: F, exempt: E })),
    '零视野：抽出 0 条字面路径 ⇒ 红');
  report(fails(auditDocs({ 'README.md': "import 'agentcss/esm/<组件>'\n", 'CHANGELOG.md': '无路径' },
    okResolve, { files: F, exempt: E })),
    '零视野：抽出来的全是占位符、0 条被验证 ⇒ 红');

  /* ⑤ 承诺文档缺失 / 死豁免 */
  report(fails(auditDocs({ 'CHANGELOG.md': '无路径' }, okResolve, { files: F, exempt: E })),
    '承诺文档不在包里 ⇒ 红');
  report(fails(auditDocs({ 'README.md': "import 'agentcss'\n" }, okResolve,
    { files: F, exempt: E })),
    '死豁免：豁免清单里的文档不在包里 ⇒ 红');

  /* ⑥ 视野发现：新文档含路径必须登记 */
  const extra = Object.assign({}, good, { 'docs/NEW.md': "import 'agentcss/new'\n" });
  r = auditDocs(extra, okResolve, { files: F, exempt: E });
  report(fails(r) && r.uncovered.length === 1 && r.uncovered[0] === 'docs/NEW.md',
    '未登记的新文档含字面路径 ⇒ 红（防漏网）');
  report(!fails(auditDocs(Object.assign({}, good, { 'docs/NEW.md': '没有引用' }),
    okResolve, { files: F, exempt: E })),
    '良性对照：新文档不含字面路径 ⇒ 绿（只红该红的）');
  report(!fails(auditDocs(Object.assign({}, good,
    { 'docs/NEW.md': "import 'agentcss/new'\n" }), okResolve,
    { files: F.concat(['docs/NEW.md']), exempt: E })),
    '登记进 FILES 后 ⇒ 绿（修法就是把新文档纳入判据）');

  /* ⑦ 豁免确实生效：CHANGELOG 里写着坏路径，不能因此红 */
  report(!fails(auditDocs({ 'README.md': "import 'agentcss'\n",
    'CHANGELOG.md': "import 'agentcss/esm/nope.mjs'\n" },
  fakeResolve(['agentcss/esm/nope.mjs']), { files: F, exempt: E })),
    '豁免生效：历史事故里的坏路径不判红');

  /* ⑧ 正则覆盖：三种容易漏的写法都要被抽到 */
  const shapes = [
    "export { X } from 'agentcss/one'\n",
    "require.resolve('agentcss/two')\n",
    "import.meta.resolve('agentcss/three')\n",
    "await import('agentcss/four')\n",
    "import 'agentcss/five'\n",
  ];
  const found = extractSpecifiers(shapes.join(''));
  report(found.size === 5, '五种 specifier 写法全被抽到',
    '实际 ' + found.size + ' 条：' + Array.from(found.keys()).join(','));

  /* ⑨ 占位符单列、不静默跳过 */
  r = auditDocs({ 'README.md': "import 'agentcss'\nimport 'agentcss/esm/<组件>'\n",
    'CHANGELOG.md': '无路径' }, okResolve, { files: F, exempt: E });
  report(!fails(r) && r.placeholders.length === 1 && r.ok.length === 1,
    '占位符单列输出、不计作已验证');

  /* ⑩ 历史坏数据回放：0.25.3 的 `.mjs.mjs` —— 用 Node 真解析器 */
  let broken = null, fixed = null;
  try {
    broken = miniPackage({ '.': './esm/index.mjs', './esm/*': './esm/*.mjs' });
    const rb = auditDocs(broken.docs, broken.resolve, { files: F, exempt: E });
    report(fails(rb) && rb.bad.length === 1 &&
           rb.bad[0].spec === 'agentcss/esm/accordion.mjs',
      '历史事故回放：exports 二次拼 .mjs ⇒ 真解析器报红');

    fixed = miniPackage({ '.': './esm/index.mjs', './esm/*.mjs': './esm/*.mjs' });
    const rf = auditDocs(fixed.docs, fixed.resolve, { files: F, exempt: E });
    report(!fails(rf) && rf.ok.length === 1,
      '同一文档只改 exports ⇒ 绿（元反向，红来自声明而非文档）');
  } catch (e) {
    report(false, '历史事故回放可执行', String(e).slice(0, 120));
  } finally {
    [broken, fixed].forEach(function (m) {
      if (m) { try { fs.rmSync(m.tmp, { recursive: true, force: true }); } catch (e2) { /* 临时目录 */ } }
    });
  }

  /* ⑪ 真实包（良性对照）：若本机已有解包目录则验，没有就明说不假装跑过 */
  console.log('  --- 合成判据共 ' + (bad.length ? '有 ' + bad.length + ' 条失败' : '全绿') + ' ---');
  if (bad.length) {
    bad.forEach(function (x) { console.log('  🔴 ' + x); });
    return 1;
  }
  console.log('  ⇒ 反向控制全绿');
  return 0;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.indexOf('--selftest') >= 0) process.exit(selftest());
  process.exit(main(argv));
}

module.exports = {
  auditDocs: auditDocs,
  extractSpecifiers: extractSpecifiers,
  readDocs: readDocs,
  fails: fails,
  FILES: FILES,
  EXEMPT: EXEMPT,
};
