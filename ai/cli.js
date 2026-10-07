#!/usr/bin/env node
/*
 * cli.js — frontend-lib 的**独立校验入口**
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
 *   frontend-lib ai check      <doc.json> [--profile=strict]
 *   frontend-lib ai validate   <file.json> --schema=contract|components|tokens|patch
 *   frontend-lib ai diff       <a.json> <b.json>
 *   frontend-lib ai patch      <doc.json> <patch.json> [-o out.json]
 *   frontend-lib ai components [--maturity=stable] [--json]
 *   frontend-lib ai tokens     [--set=light|dark] [--json]
 *   frontend-lib ai profile    列出三档及其差异
 *   frontend-lib ai capabilities
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

function die(msg) {
  process.stderr.write('[FAIL] ' + msg + '\n');
  process.exit(1);
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
  var json = flag('json', false) === true || flag('json', false) === 'true';

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

  var json = flag('json', false) === true || flag('json', false) === 'true';
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
    r.errors.forEach(function (e) {
      process.stdout.write('  [FAIL] ' + e.path + '  ' + e.msg + '\n');
    });
    process.stdout.write('\n  ⇒ 补丁**未应用**，原文档没有被改动\n');
    process.exit(1);
  }
  var det = patch.isDeterministic(doc, p);
  process.stdout.write('  OK  已应用 ' + r.applied + ' 个操作 · 确定性：' +
    (det ? '是（同输入两次结果一致）' : '否（🔴 不可回放）') + '\n');
  if (!det) process.exit(1);
  var o = flag('o', null);
  if (o) {
    fs.writeFileSync(o, JSON.stringify(r.doc, null, 2) + '\n');
    process.stdout.write('  已写出 ' + o + '\n');
  } else if (flag('json', false)) {
    out(r.doc);
  }
  process.exit(0);
}

// ---------------------------------------------------------------- 列表类
function cmdComponents(args) {
  var doc = readJSON(path.join(AI, 'components.json'));
  var m = flag('maturity', null);
  var list = doc.components.filter(function (c) {
    return !m || c.maturity === m;
  });
  if (flag('json', false)) { out(list); process.exit(0); }
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
  });
  process.stdout.write('\n  ✅ stable  🟡 beta（状态仍在 class 里，I-8 未达标）  🔴 alpha\n');
  process.exit(0);
}

function cmdTokens(args) {
  var doc = readJSON(path.join(AI, 'tokens.json'));
  var set = flag('set', null);
  if (flag('json', false)) {
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

function cmdProfile() {
  var doc = readJSON(path.join(AI, 'profiles.json'));
  if (flag('json', false)) { out(doc); process.exit(0); }
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
  if (flag('json', false)) { out(doc); process.exit(0); }
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
  tokens: cmdTokens,
  profile: cmdProfile,
  capabilities: cmdCapabilities
};

function main() {
  var argv = process.argv.slice(2);
  if (!argv.length || argv[0] === 'help' || argv[0] === '--help') {
    process.stdout.write(
      'frontend-lib ai —— 独立校验入口（零依赖、不联网、不依赖任何模型）\n\n' +
      '  ai check        <doc.json> [--profile=creative|standard|strict]\n' +
      '  ai validate     <file.json> --schema=contract|components|tokens|patch\n' +
      '  ai diff         <改动前.json> <改动后.json>      按语义 id 比对\n' +
      '  ai patch        <doc.json> <patch.json> [-o out.json]\n' +
      '  ai components   [--maturity=stable|beta|alpha]\n' +
      '  ai tokens       [--set=light|dark]\n' +
      '  ai profile      列出三档及其差异\n' +
      '  ai capabilities 列出可协商的能力\n');
    process.exit(0);
  }
  var name = argv.shift();
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
