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
 *   ⇒ 只用 `require.resolve()` + 静态扫描相对 import：
 *     走的是 Node **真正的 exports 解析算法**，但一行代码都不执行。
 * ==========================================================================*/
'use strict';

var fs = require('fs');
var path = require('path');
var Module = require('module');

function argOf(argv, flag) {
  var i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

/** 把 npm 导出模式（`./a/*.js`）里的 `*` 翻成正则，并捕获被替换的那一段。 */
function patternWithStar(t) {
  var esc = String(t)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')   /* 不转义 * */
    .replace(/\*/g, '([\\s\\S]*?)');
  return new RegExp('^' + esc + '$');
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
 * 由 exports 的键/目标反推出**一个真实可解析的说明符**。
 * 通配键必须配一个真实存在 `*` 取值，否则解析它没有意义。
 */
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

    /* 通配键：从目标模式里取一个真实取值。优先取带 `*` 的目标。 */
    var hit = null;
    for (var i = 0; i < targets.length && !hit; i++) {
      if (targets[i].indexOf('*') < 0) continue;
      var re = patternWithStar(targets[i].replace(/^\.\//, ''));
      for (var j = 0; j < pkgFiles.length; j++) {
        var m = re.exec(pkgFiles[j]);
        if (m) { hit = m[1]; break; }
      }
    }
    if (hit === null) {
      skips.push(k + '（通配键在包里找不到任何匹配目标，无法构造说明符）');
      return;
    }
    specs.push({ spec: spec.replace('*', hit), label: k + '（* = ' + hit + '）' });
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

/* 静态 import / require 的相对说明符。只抓**字面量**，动态拼接算不出来也不猜。 */
var IMPORT_RE = /(?:\bimport\s*(?:[^'"();]*?\bfrom\s*)?|\bexport\s*[^'"();]*?\bfrom\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

/** 相对说明符按 Node 的候选顺序找真实文件。 */
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

function main(argv) {
  var consumer = argOf(argv, '--consumer');
  var name = argOf(argv, '--pkg');
  if (!consumer || !name) {
    console.log('  用法：node 05-audit/entry-resolve.js --consumer <dir> --pkg <name>');
    return 1;
  }
  consumer = path.resolve(consumer);
  var pkgDir = path.join(consumer, 'node_modules', name);

  console.log('  === 消费者侧解析（require.resolve 走真 exports 算法，不执行代码）===');
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
  var okN = 0;
  var resolvedFiles = [];

  built.specs.forEach(function (s) {
    var resolved = null;
    try {
      resolved = req.resolve(s.spec);
    } catch (e) {
      bad.push('exports ' + s.label + ' → `' + s.spec + '` 解析失败：' +
               (e && e.code ? e.code : String(e).slice(0, 80)));
      return;
    }
    okN++;
    if (/\.(?:js|mjs|cjs)$/i.test(resolved)) resolvedFiles.push(resolved);
  });

  built.skips.forEach(function (s) {
    bad.push('未验证：' + s);
  });

  /* ---------- 入口内的相对 import 是否闭合 ---------- */
  var depN = 0;
  var depBad = 0;
  resolvedFiles.forEach(function (f) {
    var text;
    try { text = fs.readFileSync(f, 'utf8'); } catch (e) { return; }
    if (text.length > 2 * 1024 * 1024) return;      /* 超大文件跳过，避免误伤产物 */
    IMPORT_RE.lastIndex = 0;
    var m;
    while ((m = IMPORT_RE.exec(text))) {
      var spec = m[1];
      if (spec.slice(0, 2) !== './' && spec.slice(0, 3) !== '../') {
        /* 裸说明符：只有"包内自引用"能在这里判，外部依赖交给依赖策略。 */
        if (spec !== name && spec.indexOf(name + '/') !== 0) continue;
        try { req.resolve(spec); } catch (e) {
          depBad++;
          bad.push(path.basename(f) + ' 里 import `' + spec + '` 解析失败（自引用）');
        }
        depN++;
        continue;
      }
      depN++;
      if (!resolveRelative(f, spec)) {
        depBad++;
        bad.push(path.basename(f) + ' 里 import `' + spec + '` → 文件不存在');
      }
    }
  });

  console.log('      [入口] ' + okN + ' / ' + built.specs.length + ' 条 exports 说明符被 Node 解析到真实文件');
  console.log('      [传递] ' + (depN - depBad) + ' / ' + depN + ' 条入口内相对 import 闭合');
  if (depN === 0) {
    /* 说清楚"0/0"是什么：本库入口是 <script> 标签用的，没有 import。
       这条判据是**为将来留的**，不是"检查过了没问题"。 */
    console.log('      ! 本库入口内没有静态 import（浏览器用 <script> 直接加载）')
    console.log('        ⇒ 传递检查本轮为 0 条，属"无可检查"，不计作已验证。');
  }

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
  console.log('  ⇒ 声明的每个入口都能被 Node 解析到真实文件，入口内引用也闭合。');
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { specifiersFor: specifiersFor, resolveRelative: resolveRelative };
