#!/usr/bin/env node
/* LAYER: component */
/* ============================================================================
 * doc-imports.js — 文档里写的 import 路径，必须真的能解析
 *
 * 用法：
 *   node 05-audit/doc-imports.js --consumer <装好了本包的目录>
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
 *   所以这一道专门补那个缺口：**把文档当成消费者**，
 *   把里面出现的每个 `agentcss/...` 字面量拿去真解析一次。
 *
 * ⭐ 只解析、不执行：这是 CSS/标签库，模块体里碰 document，
 *    在 Node 里执行必然抛错（那是假红）。`require.resolve` 走的是
 *    Node 真正的 exports 算法，但不求值 —— 正是我们要的那一层。
 *
 * ⚠️ 已知边界（写清楚，不假装覆盖）：
 *    · 只认出现在**引号里**的 specifier；散文里提到的 `agentcss/esm` 不算
 *    · 只扫下面 FILES 列的文件（发布物里对外承诺入口的那几份）
 *    · 反例段落（"错写法"对比）若写了 agentcss 开头的路径，会一并被判 ——
 *      这是有意的：文档里任何能被人复制走的路径都必须能用
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '..');

/* 对外承诺入口的文档。加新文档时补进来 —— 没被扫到的文档等于没人守。 */
const FILES = [
  'API.md',
  'START-HERE.md',
  'README.md',
  'README.zh-CN.md',
  'types/index.d.ts',
  'llms.txt',
];

/* 三种写法：from 'x' / import('x') / import 'x' / require('x') */
const PATTERNS = [
  /(?:^|[^A-Za-z0-9_$])from\s+['"](agentcss[^'"\n]*)['"]/g,
  /\bimport\s*\(\s*['"](agentcss[^'"\n]*)['"]/g,
  /\bimport\s+['"](agentcss[^'"\n]*)['"]/g,
  /\brequire\s*\(\s*['"](agentcss[^'"\n]*)['"]/g,
];

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

function main() {
  const consumer = argOf(process.argv, '--consumer');
  if (!consumer || !fs.existsSync(consumer)) {
    console.error('用法：node 05-audit/doc-imports.js --consumer <目录>');
    process.exit(2);
  }
  const anchor = path.join(path.resolve(consumer), '__probe__.js');
  const req = createRequire(anchor);

  const bad = [];
  const ok = [];
  let scanned = 0;

  for (const rel of FILES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    scanned += 1;
    const src = fs.readFileSync(p, 'utf8');
    for (const [spec, line] of extractSpecifiers(src)) {
      try {
        req.resolve(spec);
        ok.push({ file: rel, line, spec });
      } catch (e) {
        bad.push({ file: rel, line, spec, code: e.code || e.message });
      }
    }
  }

  console.log('  === 文档里的 import 路径 ===');
  console.log('  扫了 ' + scanned + ' 份文档，抽出 ' + (ok.length + bad.length) + ' 条 agentcss 字面路径');

  if (!bad.length) {
    console.log('  OK   ' + ok.length + ' 条路径全部能被消费者侧解析');
    return 0;
  }

  console.log('  X    ' + bad.length + ' 条解析不了（照着文档写会直接构建失败）：');
  for (const b of bad.slice(0, 20)) {
    console.log('        ' + b.file + ':' + b.line + '  ' + b.spec + '  → ' + b.code);
  }
  if (bad.length > 20) console.log('        …还有 ' + (bad.length - 20) + ' 条');
  return 1;
}

process.exit(main());
