#!/usr/bin/env node
/*
 * cli.js — 本库（包名 `agentcss`）的**独立校验入口**
 *
 * ============================================================================
 * 🔴 为什么必须是独立 CLI，而不是"写在提示词里让 AI 自己注意"
 * ----------------------------------------------------------------------------
 * 提示词里的规则是靠模型自觉执行的 —— 它会累、会忘、会在长上下文里丢掉。
 * 而 CLI 是**机器判定**：跑出来是几就是几，跟谁在调用无关。
 *
 * ⇒ 校验必须是**独立可执行的东西**，不能是给 AI 的一段说明。
 *    这也是为什么它不依赖任何模型、不联网、不读取任何环境变量：
 *    **它能被任何人在任何地方跑出同样的结果。**
 *
 * ============================================================================
 * 用法
 * ----------------------------------------------------------------------------
 *   agentcss ai check      <doc.json> [--profile=strict]
 *   agentcss ai validate   <file.json> --schema=contract|components|tokens|tokensAudience|tokensTree|deprecations|patch
 *   agentcss ai diff       <a.json> <b.json>
 *   agentcss ai patch      <doc.json> <patch.json> [-o out.json]
 *   agentcss ai components [--maturity=stable] [--json]
 *   agentcss ai tokens     [--set=light|dark] [--json]
 *   agentcss ai profile    列出三档及其差异
 *   agentcss ai capabilities
 * ============================================================================
 */
'use strict';

var fs = require('fs');
var path = require('path');
var validate = require('./validate.js');
var patch = require('./patch.js');

var AI = __dirname;

/* ⚠️ 不能用 `String#padEnd`：它是 ES2017，
   在老 WebView 上会**直接抛异常**（静默失效，只在真机炸）。
   本文件虽跑在 Node 里，但同一份代码被复制进页面用是完全可能的
   ⇒ `legacy-api` 门禁就是这么抓到它的。 */
function pad(s, n) {
  var out = String(s);
  while (out.length < n) out += ' ';
  return out;
}

function readJSON(file) {
  var txt = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(txt);
  } catch (e) {
    throw new Error(file + ' 不是合法 JSON：' + e.message);
  }
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

var CURRENT_CMD = '';

/* 🔴 失败也必须能被机器读。
   以前 die() 只往 stderr 写一行中文，`--json` 的调用方拿到的是
   退出码 1 + 空 stdout —— 它分不清「参数写错了」和「进程崩了」。
   现在：带 --json 时，失败输出一个**单一 JSON 文档**，与成功路径一样可解析。 */
function die(msg) {
  if (isJson()) {
    out({
      ok: false,
      command: CURRENT_CMD || null,
      error: { kind: 'usage', message: String(msg) }
    });
    process.exit(1);
  }
  process.stderr.write('[FAIL] ' + msg + '\n');
  process.exit(1);
}

/** 是否要求 JSON 输出。`--json` / `--json=true` 都认，`--json=false` 不认。 */
function isJson() {
  var v = flag('json', false);
  return v === true || v === 'true';
}

/**
 * 读命令行开关。支持两种写法：
 *   --profile strict
 *   --profile=strict
 * ⚠️ 第一版只支持空格写法 ⇒ `--maturity=beta` 被静默忽略，
 *    过滤器没生效却输出了全部 27 个组件（实测）。
 *    **参数解析失败时不报错、只是少做一件事**，是最难发现的一类假绿。
 */
function flag(name, def) {
  var eq = '--' + name + '=';
  for (var i = 0; i < process.argv.length; i++) {
    if (process.argv[i].indexOf(eq) === 0) {
      return process.argv[i].slice(eq.length);
    }
  }
  var i2 = process.argv.indexOf('--' + name);
  if (i2 < 0) return def;
  var v = process.argv[i2 + 1];
  if (v === undefined || v.charAt(0) === '-') return true;
  return v;
}

// ---------------------------------------------------------------- check
function cmdCheck(args) {
  var file = args[0];
  if (!file) die('用法：ai check <doc.json> [--profile=creative|standard|strict]');
  var doc = readJSON(file);
  var profile = flag('profile', doc.profile || 'standard');
  var r = validate.validateDoc(doc, { profile: profile });
  var json = isJson();

  if (json) {
    out(r);
    process.exit(r.ok ? 0 : 1);
  }
  process.stdout.write('  === 契约校验（档位：' + r.profile + '）===\n\n');
  if (r.errors.length === 0) {
    process.stdout.write('  OK  ' + Object.keys(doc.nodes || {}).length +
      ' 个节点，无违规\n');
  } else {
    r.errors.forEach(function (e) {
      process.stdout.write('  [FAIL] ' + e.path + '\n         ' + e.msg + '\n');
    });
  }
  if (r.warnings.length) {
    process.stdout.write('\n  ⚠️ 提示（不阻断）：\n');
    r.warnings.forEach(function (w) {
      process.stdout.write('       ' + w.path + '  ' + w.msg + '\n');
    });
  }
  process.exit(r.ok ? 0 : 1);
}

// ---------------------------------------------------------------- validate
var SCHEMAS = {
  contract: 'contract.schema.json',
  components: 'components.schema.json',
  tokens: 'tokens.schema.json',
  tokensAudience: 'tokens.audience.schema.json',
  tokensTree: 'tokens.tree.schema.json',
  deprecations: 'deprecations.schema.json',
  patch: 'patch.schema.json'
};

function cmdValidate(args) {
  var file = args[0];
  var which = flag('schema', 'contract');
  if (!file) die('用法：ai validate <file.json> --schema=' + Object.keys(SCHEMAS).join('|'));
  if (!SCHEMAS[which]) die('未知 schema：' + which);
  validate.assertSchemasUseOnlySupported();
  var schema = readJSON(path.join(AI, SCHEMAS[which]));
  var data = readJSON(file);
  var r = validate.validate(schema, data);
  if (isJson()) {
    out({ ok: r.ok, schema: which, file: file, errors: r.errors || [] });
    process.exit(r.ok ? 0 : 1);
  }
  if (r.ok) {
    process.stdout.write('  OK  ' + file + ' 符合 ' + which + ' 契约\n');
    process.exit(0);
  }
  r.errors.forEach(function (e) {
    process.stdout.write('  [FAIL] ' + e.path + '  ' + e.msg + '\n');
  });
  process.exit(1);
}

// ---------------------------------------------------------------- diff
/**
 * 语义 diff：按 id 比对，输出 added / removed / changed / **moved**。
 * 🔴 moved 单独一类是关键：
 *    "内容没变，只是挪了位置" 和 "内容被改了" 是两种完全不同的风险，
 *    混在一起报告，人就没法判断要不要紧。
 */
function cmdDiff(args) {
  var fa = args[0], fb = args[1];
  if (!fa || !fb) die('用法：ai diff <改动前.json> <改动后.json>');
  var a = readJSON(fa), b = readJSON(fb);
  var na = a.nodes || {}, nb = b.nodes || {};
  var added = [], removed = [], changed = [], moved = [];

  function parentOf(nodes, id) {
    var found = null;
    Object.keys(nodes).forEach(function (pid) {
      var at = (nodes[pid].children || []).indexOf(id);
      if (at >= 0) found = { parent: pid, index: at };
    });
    if (!found) {
      var at2 = (nodes.__root || []).indexOf(id);
      if (at2 >= 0) found = { parent: null, index: at2 };
    }
    return found;
  }

  Object.keys(nb).forEach(function (id) { if (!(id in na)) added.push(id); });
  Object.keys(na).forEach(function (id) { if (!(id in nb)) removed.push(id); });
  Object.keys(na).forEach(function (id) {
    if (!(id in nb)) return;
    var x = JSON.parse(JSON.stringify(na[id]));
    var y = JSON.parse(JSON.stringify(nb[id]));
    var cx = x.children, cy = y.children;
    delete x.children; delete y.children;
    if (JSON.stringify(x) !== JSON.stringify(y)) changed.push(id);
    else if (JSON.stringify(cx || []) !== JSON.stringify(cy || [])) moved.push(id);
  });

  var json = isJson();
  var res = { added: added, removed: removed, changed: changed, moved: moved };
  if (json) { out(res); process.exit(0); }

  process.stdout.write('  === 语义 diff ===\n\n');
  process.stdout.write('  新增     ' + added.length + '\n');
  process.stdout.write('  删除     ' + removed.length + '\n');
  process.stdout.write('  内容变更 ' + changed.length +
    '  ⇒ 需要复查渲染结果\n');
  process.stdout.write('  仅移动   ' + moved.length +
    '  ⇒ 内容未变，风险低\n');
  if (added.length) process.stdout.write('\n  新增：' + added.join(', ') + '\n');
  if (removed.length) process.stdout.write('  删除：' + removed.join(', ') + '\n');
  if (changed.length) process.stdout.write('  变更：' + changed.join(', ') + '\n');
  if (moved.length) process.stdout.write('  移动：' + moved.join(', ') + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------- patch
function cmdPatch(args) {
  var fdoc = args[0], fpatch = args[1];
  if (!fdoc || !fpatch) die('用法：ai patch <doc.json> <patch.json> [-o out.json]');
  var doc = readJSON(fdoc);
  var p = readJSON(fpatch);
  var r = patch.apply(doc, p);

  if (!r.ok) {
    if (isJson()) {
      out({ ok: false, applied: 0, errors: r.errors || [] });
      process.exit(1);
    }
    r.errors.forEach(function (e) {
      process.stdout.write('  [FAIL] ' + e.path + '  ' + e.msg + '\n');
    });
    process.stdout.write('\n  ⇒ 补丁**未应用**，原文档没有被改动\n');
    process.exit(1);
  }

  var det = patch.isDeterministic(doc, p);
  var o = flag('o', null);
  if (o) fs.writeFileSync(o, JSON.stringify(r.doc, null, 2) + '\n');

  /* --json 永远输出**一个** JSON 文档：{ok, applied, deterministic, out, doc}。
     旧版只在"没写 -o"时把 doc 裸打出来 ⇒ 带 -o 时调用方什么也拿不到。 */
  if (isJson()) {
    out({
      ok: true, applied: r.applied, deterministic: det,
      out: o || null, doc: r.doc
    });
    process.exit(det ? 0 : 1);
  }

  process.stdout.write('  OK  已应用 ' + r.applied + ' 个操作 · 确定性：' +
    (det ? '是（同输入两次结果一致）' : '否（🔴 不可回放）') + '\n');
  if (o) process.stdout.write('  已写出 ' + o + '\n');
  process.exit(det ? 0 : 1);
}

// ---------------------------------------------------------------- 翻车点
/* 已知翻车点：`ai/pitfalls.json` 是**人工策展**的事实文件，不是构建产物。
   为什么不塞进 components.json：那份是机器生成的契约，加一条叙述性字段
   会让生成器每次重新生成时都要决定"保留还是覆盖"。两份文件各管一件事。 */
/* 分两份文件，因为读者不同：
   · `pitfalls.json`         —— 组件 / 版式 / 交付过程。能对上组件的写进 `components`，
                                `ai components --json` 会把它们挂到组件上。
   · `pitfalls-writing.json` —— 写文案、做演示、发页面时的失效模式，`components` 恒空。
   合成一份的代价：`components` 字段会混进一堆「没有组件可挂」的条目，
   读的人分不清「这个组件没有坑」和「这条本来就不属于组件」。 */
var PITFALL_FILES = ['pitfalls.json', 'pitfalls-writing.json'];
var PITFALLS = null;

function pitfallsDoc() {
  if (PITFALLS) return PITFALLS;
  var merged = { schemaVersion: '1.0.0', files: [], pitfalls: [] };
  for (var i = 0; i < PITFALL_FILES.length; i++) {
    var f = PITFALL_FILES[i];
    var d = null;
    try {
      d = readJSON(path.join(AI, f));
    } catch (e) {
      /* 🔴 读不到要**吵**。静默跳过会让 `--scope=writing` 返回 0 条，
         而 0 条会被读成「这类没有翻车点」—— 实际是「这份文件不存在」。
         写 stderr 而不是 stdout：stdout 要留给 JSON。 */
      process.stderr.write('[WARN] 读不到 ai/' + f +
        '：该文件覆盖的翻车点本次**未提供**\n');
      continue;
    }
    merged.files.push(f);
    if (d.schemaVersion) merged.schemaVersion = d.schemaVersion;
    var list = d.pitfalls || [];
    for (var j = 0; j < list.length; j++) merged.pitfalls.push(list[j]);
  }
  PITFALLS = merged;
  return PITFALLS;
}

function pitfallsFor(id) {
  var all = pitfallsDoc().pitfalls || [];
  var outList = [];
  for (var i = 0; i < all.length; i++) {
    if ((all[i].components || []).indexOf(id) >= 0) {
      outList.push({ id: all[i].id, title: all[i].title });
    }
  }
  return outList;
}

function cmdPitfalls(args) {
  var doc = pitfallsDoc();
  var list = (doc.pitfalls || []).slice();
  var comp = flag('component', null);
  var scope = flag('scope', null);
  var tag = flag('tag', null);

  if (comp) {
    // 拼错的组件名要**吵**：静默返回 0 条会被读成"这个组件没坑"。
    var ids = readJSON(path.join(AI, 'components.json')).components.map(function (c) {
      return c.id;
    });
    if (ids.indexOf(comp) < 0) {
      die('未知组件：' + comp + '（可用：' + ids.join(' / ') + '）');
    }
    list = list.filter(function (x) {
      return (x.components || []).indexOf(comp) >= 0;
    });
  }
  if (scope) {
    list = list.filter(function (x) { return x.scope === scope; });
  }
  if (tag) {
    list = list.filter(function (x) { return (x.tags || []).indexOf(tag) >= 0; });
  }

  if (isJson()) {
    /* `files` 是**覆盖面**，不是元数据：调用方看到只加载了一份文件时，
       才知道「writing 0 条」是这类没有坑，还是那份文件根本没读到。 */
    out({
      schemaVersion: doc.schemaVersion,
      files: doc.files,
      count: list.length,
      pitfalls: list
    });
    process.exit(0);
  }

  process.stdout.write('  === 已知翻车点（' + list.length + ' 条' +
    (comp ? ' · 组件 ' + comp : '') + (scope ? ' · scope ' + scope : '') + '）===\n\n');
  if (!list.length) {
    process.stdout.write('  （没有匹配项）\n');
    process.exit(0);
  }
  list.forEach(function (x) {
    process.stdout.write('  [' + ((x.components || []).length
      ? x.components.join(',') : x.scope) +
      '] ' + x.title + '\n');
    process.stdout.write('      现象：' + x.symptom + '\n');
    process.stdout.write('      改法：' + x.fix + '\n');
  });
  process.exit(0);
}

// ---------------------------------------------------------------- 列表类
function cmdComponents(args) {
  var doc = readJSON(path.join(AI, 'components.json'));
  var m = flag('maturity', null);
  var list = doc.components.filter(function (c) {
    return !m || c.maturity === m;
  });
  /* 🔴 每个组件都带上自己的翻车点（id + 标题），字段恒存在（空数组也写）。
     形状恒定比"有值才出现"好：调用方不用写 if，也不会因为某个组件
     恰好没有翻车点而少一个键。 */
  var joined = list.map(function (c) {
    var one = {};
    for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) one[k] = c[k];
    one.pitfalls = pitfallsFor(c.id);
    return one;
  });
  if (isJson()) { out(joined); process.exit(0); }
  process.stdout.write('  === 组件契约（' + list.length + ' 个）===\n\n');
  list.forEach(function (c) {
    process.stdout.write('  ' + (c.maturity === 'stable' ? '✅' :
      c.maturity === 'beta' ? '🟡' : '🔴') + ' ' + c.id +
      '  [' + c.tier + '/' + c.maturity + ']\n');
    process.stdout.write('       ' + (c.purpose || '') + '\n');
    if (c.slots.length) {
      process.stdout.write('       插槽: ' + c.slots.join(' ') + '\n');
    }
    if (c.states.legacyClass.length) {
      process.stdout.write('       ⚠️ 未收敛状态类: .is-' +
        c.states.legacyClass.join(' .is-') + '\n');
    }
    var ps = pitfallsFor(c.id);
    if (ps.length) {
      process.stdout.write('       ⚠️ 翻车点 ' + ps.length + ' 条: ' +
        ps.map(function (x) { return x.title; }).join(' / ') + '\n');
    }
  });
  process.stdout.write('\n  ✅ stable  🟡 beta（状态仍在 class 里，I-8 未达标）  🔴 alpha\n');
  process.exit(0);
}

// 🔴 ai assets —— 组件之外那批资产的机器可读目录（WO-03）
// ---------------------------------------------------------------------------
// 为什么要有这条：
//   `ai components` 只认 `components.json`，而它只收「有独立 CSS 的目录」⇒ 37 个。
//   磁盘上还有 5 项不是组件、但 AI 不知道就会自己重写的东西：
//     · 01-tokens/page.css      页面骨架与响应式两栏
//     · 01-tokens/behavior/     微行为核（Esc 关闭 / 焦点归还 / 方向键游走）
//     · 04-recipes/longform     单文件长文示例页（连 demo.html 都没有）
//     · 04-recipes/data-showcase
//     · 09-assets/echarts-adapter  依赖宿主已有 ECharts（本库不含）
//   后果很具体：不知道 page.css 就自己写布局，不知道 behavior/ 就手写
//   dismissable —— 后者正是 4 个 beta 组件被判 beta 的原因（dismissable:manual）。
//
// ⚠️ 本命令的清单**从磁盘扫描生成**，禁止手工维护第二份事实。
//    `05-audit/assets-catalog-gate.py` 校验「磁盘目录数 == 本命令输出数」，
//    两边一旦漂移就变红。
var ROOT = path.join(AI, '..');
var ASSET_LAYERS = ['02-primitives', '03-patterns', '04-recipes', '09-assets'];

function readFirstUsefulLine(file) {
  try {
    var s = fs.readFileSync(file, 'utf8').split('\n');
    for (var i = 0; i < s.length && i < 90; i++) {
      var t = s[i].trim();
      if (!t) continue;
      // 块注释边界与装饰线：跳过，不是描述
      if (/^\/\*+[=\s*-]*$/.test(t)) continue;
      if (/^[=\s-]*\*+\/$/.test(t)) continue;
      if (/^\*+[=\s*-]*$/.test(t)) continue;
      if (/^={3,}/.test(t) || /^-{3,}/.test(t)) continue;
      // 注释内的内容行：去掉前导 * 再判断
      if (t.charAt(0) === '*') { t = t.replace(/^\*+\s*/, '').trim(); if (!t) continue; }
      if (t.length > 2 && t.slice(-2) === '*/') { t = t.slice(0, -2).trim(); if (!t) continue; }
      if (t.charAt(0) === '#') { t = t.replace(/^#+\s*/, '').trim(); if (t) return t.slice(0, 72); continue; }
      // Markdown 表格：只认「用途」这类带说明的字段，其余（来源/门禁/文件）跳过
      var m = t.match(/^\|\s*\*\*([^*]+)\*\*\s*\|\s*([^|]+)\|/);
      if (m) {
        if (m[1].indexOf('用途') >= 0 || m[1].indexOf('定位') >= 0) return m[2].trim().slice(0, 72);
        continue;
      }
      if (t.charAt(0) === '|') continue;
      // 无中文的「a / b / c」是路径面包屑，不是描述
      if (!/[\u4e00-\u9fa5]/.test(t) && t.indexOf(' / ') >= 0) continue;
      if (!/[\u4e00-\u9fa5]/.test(t) && /\.(css|js|html)$/.test(t)) continue;
      return t.slice(0, 72);
    }
  } catch (e) { /* 读不到就当没描述，不抛 */ }
  return '';
}

function describeAsset(dir, name, purpose) {
  // 在契约里的，直接用契约的 purpose（比 README 标题精确）
  if (purpose) return purpose;
  var d = path.join(ROOT, dir, name);
  var rd = path.join(d, 'README.md');
  if (fs.existsSync(rd)) {
    var txt = fs.readFileSync(rd, 'utf8');
    var m = txt.match(/\|\s*\*\*用途\*\*\s*\|\s*([^|\n]+)/);
    if (m) return m[1].trim().slice(0, 72);
    return readFirstUsefulLine(rd);
  }
  // 没有 README：回退到目录内第一个脚本的头部注释
  var f2 = fs.readdirSync(d).filter(function (f) {
    return /\.(js|css)$/.test(f) && f.indexOf('demo') !== 0;
  });
  if (f2.length) return readFirstUsefulLine(path.join(d, f2[0]));
  return '';
}

// 类型判定必须机械可判，不查名单：
//   在组件契约里        → component
//   09-assets 下的目录  → adapter（都是「消费外部能力」的适配层）
//   有 CSS 但不在契约   → component（意味着契约漏了它，门禁会报）
//   无 CSS 有 demo.html → recipe（示例页）
//   其余                → example（单文件示例）
function classifyAsset(layer, name, inContract, files) {
  if (inContract[name]) return 'component';
  if (layer === '09-assets') return 'adapter';
  if (files.some(function (f) { return /\.css$/.test(f); })) return 'component';
  if (files.indexOf('demo.html') >= 0) return 'recipe';
  return 'example';
}

function collectAssets() {
  var doc = readJSON(path.join(AI, 'components.json'));
  var inContract = {};
  var purposeOf = {};
  doc.components.forEach(function (c) {
    inContract[c.id] = true;
    purposeOf[c.id] = c.purpose || '';
  });

  var rows = [];
  ASSET_LAYERS.forEach(function (layer) {
    var abs = path.join(ROOT, layer);
    if (!fs.existsSync(abs)) return;
    fs.readdirSync(abs).sort().forEach(function (n) {
      // 下划线/点开头是临时目录与隐藏目录，不是资产（扫描口径，不是白名单）
      if (n.charAt(0) === '_' || n.charAt(0) === '.') return;
      var p = path.join(abs, n);
      if (!fs.statSync(p).isDirectory()) return;
      var files = fs.readdirSync(p);
      rows.push({
        id: n, layer: layer, type: classifyAsset(layer, n, inContract, files),
        demo: files.indexOf('demo.html') >= 0, contract: !!inContract[n],
        desc: describeAsset(layer, n, purposeOf[n])
      });
    });
  });

  // 01-tokens 层：同样靠扫描，不写死名字。
  //   behavior/ 目录 → behavior；*.css → base；*.js → behavior；*.html 是 demo，跳过
  var tk = path.join(ROOT, '01-tokens');
  if (fs.existsSync(tk)) {
    fs.readdirSync(tk).sort().forEach(function (n) {
      if (n.charAt(0) === '_' || n.charAt(0) === '.') return;
      var p = path.join(tk, n);
      var st = fs.statSync(p);
      if (st.isDirectory()) {
        rows.push({ id: n, layer: '01-tokens', type: 'behavior', demo: false,
          contract: false, desc: describeAsset('01-tokens', n, '') });
        return;
      }
      if (/\.html$/.test(n)) return;
      var t = /\.css$/.test(n) ? 'base' : /\.js$/.test(n) ? 'behavior' : null;
      if (!t) return;
      rows.push({ id: n, layer: '01-tokens', type: t, demo: false, contract: false,
        desc: readFirstUsefulLine(p) });
    });
  }
  return rows;
}

function cmdAssets(args) {
  var rows = collectAssets();
  if (isJson()) { out(rows); process.exit(0); }
  var miss = rows.filter(function (r) { return !r.contract; });
  process.stdout.write('  === 全部资产（' + rows.length + ' 项）===\n');
  process.stdout.write('  契约内 ' + (rows.length - miss.length) + ' 项 · 契约外 ' + miss.length + ' 项\n\n');
  rows.forEach(function (r) {
    process.stdout.write('  ' + (r.contract ? '✅' : '○') + ' ' + pad(r.id, 22) +
      '[' + r.type + ']' + (r.demo ? ' demo' : '     ') + '  ' + r.desc + '\n');
  });
  process.stdout.write('\n  ✅ 在组件契约内（可 ai components 查详情）  ○ 契约外（需看本节）\n');
  process.exit(0);
}

function cmdTokens(args) {
  var doc = readJSON(path.join(AI, 'tokens.json'));
  var set = flag('set', null);
  if (isJson()) {
    out(set ? doc.sets[set] : doc);
    process.exit(0);
  }
  process.stdout.write('  === 令牌（浅色 ' + doc.coverage.lightCount +
    ' / 暗色 ' + doc.coverage.darkCount + '）===\n\n');
  ['light', 'dark'].forEach(function (k) {
    if (set && set !== k) return;
    process.stdout.write('  -- ' + k + ' --\n');
    Object.keys(doc.sets[k]).sort().forEach(function (n) {
      var t = doc.sets[k][n];
      process.stdout.write('    ' + pad(n, 24) + t.$value.slice(0, 34) +
        '   [' + t.$type + ']\n');
    });
    process.stdout.write('\n');
  });
  process.exit(0);
}

function cmdTree(args) {
  var doc = readJSON(path.join(AI, 'tokens.tree.json'));
  var set = flag('set', null);
  var cat = flag('cat', null);
  if (isJson()) {
    out(cat && set ? doc.sets[set][cat] : (set ? doc.sets[set] : doc));
    process.exit(0);
  }
  /* 第二种导出是给**工具链**（Style Dictionary / Figma Tokens）的：
     分层、键名不带 --、字段用 value/type（不带 $）。
     `ai tokens` 那份是 DTCG 形状，喂不进这两套工具 ⇒ 两种各出一份。 */
  process.stdout.write('  === 令牌（第二种导出 · 分层 / 无 -- 前缀 / value 不带 $）===\n');
  process.stdout.write('  浅色 ' + doc.meta.lightCount + ' / 暗色 ' +
    doc.meta.darkCount + ' · 类别 ' + doc.meta.categories.length + '\n\n');
  ['light', 'dark'].forEach(function (k) {
    if (set && set !== k) return;
    process.stdout.write('  -- ' + k + ' --\n');
    Object.keys(doc.sets[k]).sort().forEach(function (c) {
      if (cat && cat !== c) return;
      process.stdout.write('    ' + c + '\n');
      Object.keys(doc.sets[k][c]).sort().forEach(function (leaf) {
        var t = doc.sets[k][c][leaf];
        process.stdout.write('      ' + pad(leaf, 22) + t.value.slice(0, 30) +
          '   [' + t.type + ']\n');
      });
    });
    process.stdout.write('\n');
  });
  process.exit(0);
}

function cmdProfile() {
  var doc = readJSON(path.join(AI, 'profiles.json'));
  if (isJson()) { out(doc); process.exit(0); }
  process.stdout.write('  === 三档 Profile ===\n\n');
  Object.keys(doc.profiles).forEach(function (k) {
    var p = doc.profiles[k];
    process.stdout.write('  ' + k + '（' + p.label + '）\n');
    process.stdout.write('    允许成熟度      ' + p.allowedMaturity.join(' / ') + '\n');
    process.stdout.write('    未知组件        ' + (p.allowedUnknownComponent ? '放行' : '拒绝') + '\n');
    process.stdout.write('    未知状态取值    ' + (p.allowedUnknownState ? '放行' : '拒绝') + '\n');
    process.stdout.write('    extensions      ' + (p.allowedExtensions ? '允许' : '拒绝') + '\n');
    process.stdout.write('\n');
  });
  process.stdout.write('  🔴 任何档位下都必须成立：\n');
  doc.alwaysEnforced.rules.forEach(function (r) {
    process.stdout.write('     · ' + r + '\n');
  });
  process.exit(0);
}

function cmdCapabilities() {
  var doc = readJSON(path.join(AI, 'capabilities.json'));
  if (isJson()) { out(doc); process.exit(0); }
  process.stdout.write('  === 能力协商 ===\n\n');
  Object.keys(doc.capabilities).forEach(function (k) {
    var c = doc.capabilities[k];
    process.stdout.write('  ' + k + ' —— ' + c.label + '\n');
    process.stdout.write('    有 → 开放 ' + c.unlocks.join(', ') + '\n');
    process.stdout.write('    无 → ' + c.without.join('；') + '\n\n');
  });
  process.stdout.write('  无人值守自动编辑的最低要求：' +
    doc.minimumForSafeEditing.requires.join(' + ') + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------- 分发
var CMDS = {
  check: cmdCheck,
  validate: cmdValidate,
  diff: cmdDiff,
  patch: cmdPatch,
  components: cmdComponents,
  assets: cmdAssets,
  tokens: cmdTokens,
  tree: cmdTree,
  profile: cmdProfile,
  capabilities: cmdCapabilities,
  pitfalls: cmdPitfalls
};

function main() {
  var argv = process.argv.slice(2);
  if (!argv.length || argv[0] === 'help' || argv[0] === '--help') {
    process.stdout.write(
      'agentcss ai —— 独立校验入口（零依赖、不联网、不依赖任何模型）\n\n' +
      '  ai check        <doc.json> [--profile=creative|standard|strict] [--json]\n' +
      '  ai validate     <file.json> --schema=contract|components|tokens|tokensAudience|tokensTree|deprecations|patch [--json]\n' +
      '  ai diff         <改动前.json> <改动后.json> [--json]   按语义 id 比对\n' +
      '  ai patch        <doc.json> <patch.json> [-o out.json] [--json]\n' +
      '  ai components   [--maturity=stable|beta|alpha] [--json]\n' +
      '  ai assets       [--json]   组件之外的资产：布局 / 微行为核 / 示例页 / 适配器\n' +
      '  ai tokens       [--set=light|dark] [--json]\n' +
      '  ai tree         [--set=light|dark] [--cat=color] [--json]\n' +
      '  ai pitfalls     [--component=<id>] [--scope=component|layout|process|writing] [--tag=<t>] [--json]\n' +
      '  ai profile      [--json]   列出三档及其差异\n' +
      '  ai capabilities [--json]   列出可协商的能力\n' +
      '\n' +
      '  每个子命令都支持 --json；失败时输出 {ok:false, command, error} 并以非 0 退出。\n');
    process.exit(0);
  }
  var name = argv.shift();
  CURRENT_CMD = name;
  var fn = CMDS[name];
  if (!fn) die('未知子命令：' + name + '（可用：' + Object.keys(CMDS).join(' / ') + '）');
  try {
    fn(argv);
  } catch (e) {
    die(e.message);
  }
}

if (require.main === module) main();
module.exports = { CMDS: CMDS };
