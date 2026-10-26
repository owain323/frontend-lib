#!/usr/bin/env node
/* LAYER: component */
/* ============================================================================
 * entry-resolve.js — 消费者侧解析冒烟：入口**真的能被 Node 解析到文件**
 *
 * 用法：
 *   node 05-audit/entry-resolve.js --consumer <装着包的目录> --pkg <包名>
 *
 * ---------------------------------------------------------------------------
 * 🔴 为什么要单独一道（外部审计 P1-3）
 *
 *   `pack-closure.js` 判的是「声明的目标**在包里**」——文件存在。
 *   但"文件在"不等于"入口能解析"：exports 写错层级、`*` 替换后落到
 *   不存在的路径、包内 `import './missing.js'` 缺文件……
 *   这些都能让消费者 `import` 直接抛错，而包内闭包判定全绿。
 *
 *   `pack-smoke.sh` 原本只有 `node --check`（最多 12 个文件，且只查语法），
 *   从没有一次「以消费者的身份真正解析这个包」。
 *
 * ⭐ 为什么不用 `import()` / `require()` 真执行
 *   这是 CSS / `<script>` 标签库，模块体里有 `document` 引用；
 *   在 Node 里执行必然抛错，那不是包的问题。
 *   ⇒ 只用真实解析器（`require.resolve` / `import.meta.resolve`）+ 静态扫描，
 *     走的是 Node **真正的 exports 解析算法**，但一行代码都不执行。
 *
 * ---------------------------------------------------------------------------
 * 🔁 第三轮外部审计（2026-10-26 深夜）补掉的四个盲区
 *
 *   审计原话逐条对照：
 *   ① 「只用 `require.resolve` 检查 `require` 条件……`import` 目标缺失或
 *      不可解析时，CJS 检查可以通过。」
 *      ⇒ 现在**两套条件分开验**：require 走 `createRequire().resolve()`
 *        （它会检查文件存在），import 走**子进程里的 `import.meta.resolve()`**。
 *        ⚠️ 实测（node 22.22.2）：`import.meta.resolve` **不做文件存在性检查**
 *           —— 目标不存在时它照样返回 file URL。所以拿到 URL 后必须自己
 *           `fs.existsSync` 一次，否则这一步等于没验。
 *   ② 「相对依赖只扫一层……入口 a.js → b.js 存在，但 b.js → missing.js 仍全绿。」
 *      ⇒ 改成**传递闭包**（BFS + 已访问集合 + 文件数上限，防病态图跑飞）。
 *   ③ 「动态 import 不会被当前正则发现（`import('./lazy.js')`）」；也没有
 *      `require.resolve(...)` 与 `new URL('./x', import.meta.url)`。
 *      ⇒ 三类字面量全部纳入；**动态拼接**（`import('./' + x)`）明确列为未验证，
 *        不是"没看到就算通过"。
 *   ④ 星号语义与 `pack-closure.js` **两份实现且已分叉**。
 *      ⇒ 现在共用 `05-audit/_pkg-target.js`（E31：同一判定写两遍必然漂移）。
 *
 * ⚠️ 仍然只是**近似**，写出来是为了别人能判断可信度：
 *   · 源码文本用正则扫字面量，先剥注释再扫（`stripJsComments()`）。
 *     剥注释是按引号状态做的，所以 `'http://x'` 里的 `//` 不会被误当注释；
 *     但**正则字面量**里出现引号时仍可能判断失误（本库源码是 ES5，
 *     由 `es5-gate` 守着，这个风险当前为 0）。
 *   · `#imports` 只在入口文件里出现时才验，不验"某个说明符从未被用到"。
 *   · 目录 `package.json` 的 `main` 这类解析，`resolveRelative()` 只覆盖
 *     常见候选顺序，不是完整 Node resolver —— 它保守地**偏向假红**。
 * ==========================================================================*/
'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var url = require('url');
var Module = require('module');
/* 星号语义只有一份（E31）。别在本文件里再写一遍正则。 */
var pkgTarget = require('./_pkg-target.js');

/** 传递闭包的上限：超过就停并**报未验证**，不假装扫完了。 */
var MAX_FILES = 400;
var MAX_EDGES = 4000;

function argOf(argv, flag) {
  var i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

/** 列出目录下所有文件（相对路径）。 */
function allFiles(root) {
  var out = [];
  (function walk(rel) {
    var abs = rel ? path.join(root, rel) : root;
    var names;
    try { names = fs.readdirSync(abs); } catch (e) { return; }
    names.forEach(function (n) {
      var r = rel ? rel + '/' + n : n;
      var st;
      try { st = fs.statSync(path.join(root, r)); } catch (e) { return; }
      if (st.isDirectory()) walk(r); else out.push(r);
    });
  })('');
  return out.sort();
}

/**
 * 由 exports 的键/目标反推出**真实可解析的说明符**。
 *
 * 🔴 通配键要展开成**多个**说明符，不能只采样一个。
 *    实测（2026-10-26）：第一版每个通配键只取第一个匹配文件，
 *    12 条说明符里只有 1 个 `.js` ⇒ 传递闭包"扫了 1 个文件、0 条引用"，
 *    等于这道检查在通配包上**空转**。而本库的消费者正是按
 *    `node_modules/agentcss/dist/03-patterns/…/x.js` 这类路径逐个加载的，
 *    通配键下**每一个**文件都是真实入口。
 */
var WILDCARD_MAX = 400;

function specifiersFor(name, exportsMap, pkgFiles) {
  var specs = [];
  var skips = [];

  if (!exportsMap) {
    specs.push({ spec: name, label: '(无 exports，直接解析包名)' });
    return { specs: specs, skips: skips };
  }

  var keys = (typeof exportsMap === 'string' || Array.isArray(exportsMap))
    ? ['.'] : Object.keys(exportsMap);
  var valueOf = (typeof exportsMap === 'string' || Array.isArray(exportsMap))
    ? function () { return exportsMap; } : function (k) { return exportsMap[k]; };

  keys.forEach(function (k) {
    var spec = k === '.' ? name : name + k.slice(1);
    var targets = collectTargets(valueOf(k));

    if (k.indexOf('*') < 0) {
      specs.push({ spec: spec, label: k });
      return;
    }

    /* 通配键：找第一个带 `*` 的目标作为模式，用共享的 starValue() 取样。
       🔴 用共享实现：多个 `*` 必须**同一个值**（Node 语义，见 _pkg-target.js）。 */
    var pat = null;
    for (var i = 0; i < targets.length; i++) {
      if (targets[i].indexOf('*') >= 0) { pat = targets[i].replace(/^\.\//, ''); break; }
    }
    if (pat === null) {
      skips.push(k + '（通配键的目标里没有 `*`，无法构造说明符）');
      return;
    }

    var subs = [];
    var seenSub = {};
    for (var j = 0; j < pkgFiles.length && subs.length < WILDCARD_MAX; j++) {
      var v = pkgTarget.starValue(pat, pkgFiles[j]);
      if (v === null || v === '') continue;
      if (seenSub[v]) continue;
      seenSub[v] = 1;
      subs.push(v);
    }
    if (!subs.length) {
      skips.push(k + '（通配键在包里找不到任何匹配目标，无法构造说明符）');
      return;
    }
    subs.forEach(function (sv) {
      specs.push({ spec: spec.split('*').join(sv), label: k + '（* = ' + sv + '）' });
    });
    if (subs.length >= WILDCARD_MAX) {
      skips.push(k + '（匹配数触及采样上限 ' + WILDCARD_MAX + '，只验了前 ' +
                 WILDCARD_MAX + ' 个 ⇒ 其余未验证）');
    }
  });

  return { specs: specs, skips: skips };
}

function collectTargets(v, out) {
  out = out || [];
  if (typeof v === 'string') { out.push(v); return out; }
  if (Array.isArray(v)) { v.forEach(function (x) { collectTargets(x, out); }); return out; }
  if (v && typeof v === 'object') {
    Object.keys(v).forEach(function (c) { collectTargets(v[c], out); });
  }
  return out;
}

/* ==========================================================================
 * 源码文本扫描
 * ========================================================================*/

/**
 * 剥掉 `//` 与 `/* *\/` 注释，**但不碰引号里的内容**。
 *
 * 🔴 为什么要按引号状态剥：源码里到处都是 `'https://…'`。
 *    无脑 `indexOf('//')` 会把这一行剩下的部分全删掉，连带删掉后面
 *    真正要检查的 `import './x.js'` ⇒ 假绿。
 */
function stripJsComments(src) {
  var s = String(src);
  var out = '';
  var i = 0;
  var n = s.length;
  var q = null;

  while (i < n) {
    var c = s.charAt(i);
    if (q) {
      out += c;
      if (c === '\\') { out += s.charAt(i + 1); i += 2; continue; }
      if (c === q) q = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && s.charAt(i + 1) === '/') {
      while (i < n && s.charAt(i) !== '\n') i++;
      continue;
    }
    if (c === '/' && s.charAt(i + 1) === '*') {
      var e = s.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/* 静态 import / require / **字面量**动态 import / require.resolve。
   只抓字面量：`import('./' + x)` 这种算不出来，也不猜（见文件头「近似」）。 */
var SPEC_RE = new RegExp(
  '(?:\\bimport\\s*(?:[^\'"();]*?\\bfrom\\s*)?' +   /* import x from '…' / import '…' */
  '|\\bexport\\s*[^\'"();]*?\\bfrom\\s*' +          /* export … from '…' */
  '|\\bimport\\s*\\(\\s*' +                        /* import('…')  ← 字面量动态 */
  '|\\brequire\\.resolve\\s*\\(\\s*' +              /* require.resolve('…') */
  '|\\brequire\\s*\\(\\s*' +                        /* require('…') */
  ')["\']([^"\'\\n]+)["\']', 'g');

/* `new URL('./asset', import.meta.url)` —— 资源引用，按文件位置解析。 */
var URL_RE = /\bnew\s+URL\s*\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url\s*\)/g;

/** 相对说明符按 Node 的候选顺序找真实文件。
 *  ⚠️ 不是完整 resolver（见文件头）—— 保守地偏向假红。 */
function resolveRelative(fromFile, spec) {
  var base = path.resolve(path.dirname(fromFile), spec);
  var cands = [base, base + '.js', base + '.mjs', base + '.cjs', base + '.json',
               path.join(base, 'index.js'), path.join(base, 'index.mjs'),
               path.join(base, 'index.cjs')];
  for (var i = 0; i < cands.length; i++) {
    try {
      if (fs.statSync(cands[i]).isFile()) return cands[i];
    } catch (e) { /* 继续试下一个 */ }
  }
  return null;
}

/* ==========================================================================
 * ESM 侧：`import` 条件
 * ========================================================================*/

var ESM_RUNNER_SRC = [
  "var out = [];",
  "for (var i = 2; i < process.argv.length; i++) {",
  "  var s = process.argv[i];",
  "  if (typeof import.meta.resolve !== 'function') { out.push({ s: s, unsupported: true }); continue; }",
  "  try { out.push({ s: s, ok: true, url: String(import.meta.resolve(s)) }); }",
  "  catch (e) { out.push({ s: s, ok: false, code: (e && e.code) || String(e).slice(0, 80) }); }",
  "}",
  "process.stdout.write(JSON.stringify(out));"
].join('\n');

/**
 * 用**子进程里的 `import.meta.resolve`** 解析一批说明符（`import` 条件）。
 *
 * 🔴 必须放进**消费者目录**：`import.meta.resolve` 的基准是**本模块文件**
 *    所在的 URL，只有放在消费者的位置，解析才会走"从包外看这个包"的路径。
 * 🔴 必须自己补一次 `fs.existsSync`：实测它不做存在性检查。
 *
 * @returns {{ok:boolean, map:object, why?:string}}
 */
function esmResolve(consumerDir, specs) {
  if (!specs.length) return { ok: true, map: {} };
  var runner = path.join(consumerDir, '__entry-resolve-esm.mjs');
  var created = false;
  try {
    if (!fs.existsSync(runner)) { fs.writeFileSync(runner, ESM_RUNNER_SRC); created = true; }
    var r = cp.spawnSync(process.execPath, [runner].concat(specs), {
      cwd: consumerDir, encoding: 'utf8', timeout: 60000
    });
    if (r.status !== 0) {
      return { ok: false, map: {}, why: 'ESM 解析子进程 exit ' + r.status +
               '：' + String(r.stderr || '').split('\n')[0].slice(0, 120) };
    }
    var parsed = JSON.parse(r.stdout);
    var map = {};
    parsed.forEach(function (x) {
      if (x.unsupported) { map[x.s] = { unsupported: true }; return; }
      map[x.s] = x;
    });
    return { ok: true, map: map };
  } catch (e) {
    return { ok: false, map: {}, why: String(e).slice(0, 120) };
  } finally {
    if (created) { try { fs.unlinkSync(runner); } catch (e2) { /* 留着也无害 */ } }
  }
}

/** file URL → 本地路径；失败返回 null。 */
function fileUrlToPath(u) {
  try { return url.fileURLToPath(u); } catch (e) { return null; }
}

/* ==========================================================================
 * 主流程
 * ========================================================================*/

function main(argv) {
  var consumer = argOf(argv, '--consumer');
  var name = argOf(argv, '--pkg');
  if (!consumer || !name) {
    console.log('  用法：node 05-audit/entry-resolve.js --consumer <dir> --pkg <name>');
    return 1;
  }
  consumer = path.resolve(consumer);
  var pkgDir = path.join(consumer, 'node_modules', name);

  console.log('  === 消费者侧解析（require.resolve + import.meta.resolve，都不执行代码）===');
  console.log('');

  if (!fs.existsSync(path.join(pkgDir, 'package.json'))) {
    console.log('      X 找不到 ' + pkgDir + '（第 2 步没装成？）');
    return 1;
  }
  var pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  var files = allFiles(pkgDir);

  /* 🔴 锚点必须放在**消费者**目录里：只有从包外 require，
       才会走 exports 解析。从包内 require 会把说明符当相对路径。 */
  var anchor = path.join(consumer, '__entry-resolve-anchor.js');
  if (!fs.existsSync(anchor)) fs.writeFileSync(anchor, '');
  var req = Module.createRequire(anchor);

  var built = specifiersFor(name, pkg.exports, files);
  var bad = [];
  var unverified = [];

  /* ---------- A. require 条件 ---------- */
  var reqOk = 0;
  var entryFiles = [];

  built.specs.forEach(function (s) {
    try {
      var resolved = req.resolve(s.spec);
      reqOk++;
      if (/\.(?:js|mjs|cjs)$/i.test(resolved)) entryFiles.push(resolved);
    } catch (e) {
      bad.push('exports ' + s.label + ' → `' + s.spec + '` 在 **require** 条件下解析失败：' +
               (e && e.code ? e.code : String(e).slice(0, 80)));
    }
  });

  /* ---------- B. import 条件（第三轮审计 ①） ---------- */
  var esmOk = 0;
  var esm = esmResolve(consumer, built.specs.map(function (s) { return s.spec; }));
  if (!esm.ok) {
    unverified.push('import 条件：' + esm.why);
  } else {
    built.specs.forEach(function (s) {
      var r = esm.map[s.spec];
      if (!r || r.unsupported) {
        unverified.push('import 条件（本机 Node 没有 import.meta.resolve）：' + s.spec);
        return;
      }
      if (!r.ok) {
        bad.push('exports ' + s.label + ' → `' + s.spec + '` 在 **import** 条件下解析失败：' +
                 r.code);
        return;
      }
      /* import.meta.resolve 只做映射、不查存在性（实测）⇒ 必须自己补一次 */
      var fp = fileUrlToPath(r.url);
      if (!fp || !fs.existsSync(fp)) {
        bad.push('exports ' + s.label + ' → `' + s.spec + '` 在 **import** 条件下映射到 ' +
                 r.url + '，但该文件不存在');
        return;
      }
      esmOk++;
      if (/\.(?:js|mjs|cjs)$/i.test(fp) && entryFiles.indexOf(fp) < 0) entryFiles.push(fp);
    });
  }

  built.skips.forEach(function (s) { unverified.push(s); });

  /* ---------- C. 入口内引用：传递闭包（第三轮审计 ②③） ---------- */
  var seen = {};
  var queue = entryFiles.slice();
  var scanned = 0;
  var edgeN = 0;
  var edgeBad = 0;
  var externalN = 0;
  var truncated = false;

  while (queue.length) {
    var f = queue.shift();
    var real;
    try { real = fs.realpathSync(f); } catch (e) { real = f; }
    if (seen[real]) continue;
    seen[real] = 1;

    if (scanned >= MAX_FILES) { truncated = true; break; }
    scanned++;

    var text;
    try { text = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    if (text.length > 2 * 1024 * 1024) continue;      /* 超大文件跳过，避免误伤产物 */
    text = stripJsComments(text);

    var rel = path.relative(pkgDir, f).split(path.sep).join('/');

    function take(spec, isUrl) {
      edgeN++;
      if (edgeN > MAX_EDGES) { truncated = true; return; }

      if (isUrl) {
        if (spec.slice(0, 1) !== '.') return;         /* 绝对 URL 属外部资源 */
        var asset = resolveRelative(f, spec);
        if (!asset) {
          edgeBad++;
          bad.push(rel + ' 里 new URL(`' + spec + '`, import.meta.url) → 文件不存在');
        }
        return;
      }

      var isRel = spec.slice(0, 2) === './' || spec.slice(0, 3) === '../';
      if (!isRel) {
        /* `#内部映射`：第三轮审计点名「实际使用说明符未由 req.resolve 验证」 */
        if (spec.charAt(0) === '#') {
          try { req.resolve(spec); } catch (e) {
            edgeBad++;
            bad.push(rel + ' 里 `' + spec + '`（#imports 映射）解析失败：' +
                     (e && e.code ? e.code : String(e).slice(0, 60)));
          }
          return;
        }
        /* 裸说明符：只有"包内自引用"能在这里判，外部依赖交给依赖策略。 */
        if (spec !== name && spec.indexOf(name + '/') !== 0) { externalN++; return; }
        try { req.resolve(spec); } catch (e) {
          edgeBad++;
          bad.push(rel + ' 里 import `' + spec + '` 解析失败（自引用）：' +
                   (e && e.code ? e.code : String(e).slice(0, 60)));
        }
        return;
      }

      var hit = resolveRelative(f, spec);
      if (!hit) {
        edgeBad++;
        bad.push(rel + ' 里 import/require `' + spec + '` → 文件不存在');
        return;
      }
      if (/\.(?:js|mjs|cjs)$/i.test(hit)) queue.push(hit);   /* ← 闭包，不是只扫一层 */
    }

    var m;
    SPEC_RE.lastIndex = 0;
    while ((m = SPEC_RE.exec(text))) take(m[1], false);

    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text))) take(m[1], true);
  }

  /* ---------- 输出 ---------- */
  console.log('      [require] ' + reqOk + ' / ' + built.specs.length +
              ' 条 exports 说明符被 require 条件解析到真实文件');
  console.log('      [import ] ' + esmOk + ' / ' + built.specs.length +
              ' 条 exports 说明符被 import 条件解析到真实文件' +
              (esm.ok ? '' : '（未验证）'));
  console.log('      [传递] 扫了 ' + scanned + ' 个入口文件、' + edgeN + ' 条引用：' +
              (edgeN - edgeBad) + ' 条闭合' +
              (externalN ? '、' + externalN + ' 条外部依赖（不判）' : '') +
              (truncated ? '；**触上限 ' + MAX_FILES + ' 文件 / ' + MAX_EDGES +
                           ' 边，未扫完 ⇒ 未验证**' : ''));
  if (scanned === 1 && edgeN === 0) {
    /* 说清楚"0/0"是什么：本库入口是 <script> 标签用的，没有 import。
       这条判据是**为将来留的**，不是"检查过了没问题"。 */
    console.log('      ! 入口内没有静态 import / require / 字面量动态 import');
    console.log('        ⇒ 传递检查本轮 0 条，属"无可检查"，**不计作已验证**。');
  }

  unverified.forEach(function (u) { console.log('      ! 未验证：' + u); });

  if (bad.length) {
    console.log('');
    console.log('  🔴 消费者会直接拿到解析错误：');
    bad.slice(0, 15).forEach(function (b) { console.log('      · ' + b); });
    if (bad.length > 15) console.log('      …还有 ' + (bad.length - 15) + ' 条');
    console.log('');
    console.log('  => 文件在包里 ≠ 入口可用（' + bad.length + ' 处）');
    return 1;
  }

  console.log('');
  console.log('  ⇒ require 与 import 两套条件都能解析到真实文件，入口内引用**传递**闭合。');
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  specifiersFor: specifiersFor,
  resolveRelative: resolveRelative,
  stripJsComments: stripJsComments,
  esmResolve: esmResolve
};
