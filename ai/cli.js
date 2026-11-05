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
 *   agentcss ai check      <page.html> [--recipe=report/finance] [--strict]
 *   agentcss ai validate   <file.json> --schema=<名字>（见 SCHEMAS，当前 8 份）
 *   agentcss ai diff       <a.json> <b.json>
 *   agentcss ai patch      <doc.json> <patch.json> [-o out.json]
 *   agentcss ai components [--maturity=stable] [--json]
 *   agentcss ai tokens     [--set=light|dark] [--json]
 *   agentcss ai profile    列出三档及其差异
 *   agentcss ai capabilities
 *   agentcss ai scaffold   <版式> --out <page.html>
 *   agentcss ai shot       <page.html> --out <png> [--width=390,1440] [--full]
 * ============================================================================
 */
'use strict';

var fs = require('fs');
var path = require('path');
var validate = require('./validate.js');
var patch = require('./patch.js');
/* 打印导出。⚠️ 只在 `pdf` 子命令里用 —— 主路径不许因为它多加载任何东西
   （`require` 是同步的，放在文件顶部是为了不把 CLI 拆成两截，代价是 ~2 KB 源码）。 */
var pdfExport = require('./pdf.js');

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

/* 读 JSON。`fromUser` 区分「调用方给我的文件」与「包内自带的文件」——
   这两类读失败的性质完全不同，退出码也不同：
     · 用户文件读不到/不是 JSON ⇒ usage（2）：改调用参数就能解决
     · 包内文件读不到          ⇒ internal（6）：包坏了，是工具/打包的问题
   不带这个区分时，两者都被顶层兜底成 internal（6），
   于是"你指错了文件"被报成"工具内部错误"—— 调用方会去查工具的 bug。 */
function readJSON(file, fromUser) {
  var txt;
  try {
    txt = fs.readFileSync(file, 'utf8');
  } catch (e) {
    var miss = new Error((fromUser ? '读不到 ' : '包内文件读不到 ') + file
      + '（' + (e.code || e.message) + '）');
    miss.kind = fromUser ? 'usage' : 'internal';
    throw miss;
  }
  try {
    return JSON.parse(txt);
  } catch (e) {
    var malformed = new Error(file + ' 不是合法 JSON：' + e.message);
    malformed.kind = fromUser ? 'usage' : 'internal';
    throw malformed;
  }
}

function out(obj) {
  /* 🔴 `JSON.stringify(undefined)` 返回的是 **undefined**（不是字符串），
     拼上 '\n' 之后 stdout 得到字面量 `undefined`，退出码还是 0。
     0.26.0 的 `ai tokens --set=<拼错的>` 就是这么"成功"的：
     调用方的 JSON.parse 拿到 `undefined` 三个字，报一个跟真实原因无关的解析错。
     枚举校验已经把已知那条路堵死，这里再加一道兜底 —— 任何**未来**的
     "忘了判断就 out()" 都会当场变成 internal（退出码 6），而不是一个假成功。 */
  var txt = JSON.stringify(obj, null, 2);
  if (txt === undefined) {
    fail('internal', '要输出的对象是 undefined —— 这是工具的问题（没有结果却走到了输出）');
  }
  process.stdout.write(txt + '\n');
}

var CURRENT_CMD = '';

/* 🔴 退出码表只有这一份 —— 调用方要能**按码分支**，不必按子命令写 switch。
 *
 *   0  通过
 *   1  判定不通过（页面/文档确实有错，跑完了，结论是不合格）
 *   2  用法错误（参数名、取值、组合不对）
 *   3  环境不具备（没有浏览器、node 不在 PATH）
 *   4  渲染失败（超时、读不出、视口没设成）
 *   5  超出预算（产出了完整文件，只是超了页数）
 *   6  工具内部错误（是工具的 bug，不是你的输入错）
 *
 * 为什么 2/3/4/5 是这个数：`pdf` 早就这么发（CHANGELOG 里公开过
 * 「2 用法 / 3 没浏览器 / 4 渲染失败 / 5 超预算」）。把它们收敛成全 CLI 唯一一套，
 * 而不是新增一套再共存 —— 两套码必然漂移。
 *
 * ⚠️ **1 只表示"判定不通过"**，不表示工具坏了。以前 `die()` 用 1，
 *    于是"参数写错"和"页面有 3 个错"拿到同一个码：调用方要么去改页面（改错方向），
 *    要么去改参数（也改错方向）。这是本轮审计点名的第一个问题。
 */
var EXIT = {
  findings: 1,
  usage: 2,
  'no-chrome': 3, env: 3,
  render: 4, timeout: 4, unreadable: 4, viewport: 4,
  'over-budget': 5,
  internal: 6
};

/* 🔴 失败也必须能被机器读，且**只有一种形状**：
     { ok:false, command, error:{ kind, message }, ...上下文 }
   以前 `pdf` 发 `{ok:false, code, message}`、其它子命令发 `{ok:false, error:{...}}`
   —— 同一个 CLI 的失败有两种形状，调用方要么写两个分支，要么只看 ok。
   现在 kind 的取值就是上面那张退出码表的键，`kind` → 码是确定的。 */
function fail(kind, msg, extra) {
  var k = EXIT[kind] === undefined ? 'internal' : kind;
  if (isJson()) {
    var doc = { ok: false, command: CURRENT_CMD || null,
                error: { kind: k, message: String(msg) } };
    if (extra) for (var ek in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, ek)) doc[ek] = extra[ek];
    }
    out(doc);
  } else {
    process.stderr.write('[FAIL] ' + msg + '\n');
    if (k === 'internal') {
      process.stderr.write('        这是工具内部错误，不是你参数写错了'
        + '（退出码 ' + EXIT.internal + '）\n');
    }
  }
  process.exit(EXIT[k]);
}

function die(msg) { fail('usage', msg); }

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

/* ---------------------------------------------------------------- 枚举参数
   🔴 非法取值**必须报错**，不许退化成"空结果"。
   0.26.0 的实测（本轮审计 F1）：
     ai tokens --set=not-a-theme --json     → stdout 是字面量 `undefined`，退出码 0
     ai tree   --set=not-a-theme --json     → 同上
     ai components --maturity=not-a-level   → `[]`，退出码 0
   对人是"没输出"，对 Agent 是**错误的控制流**：它会把拼错的参数读成
   "这个库没有 beta 组件"，再据此写出错误的结论，而且全程没有报错。

   取值**不在本文件里重抄**：
     · maturity 的词表来自 profiles.json 的 allowedMaturity（三档取并集）
     · set / cat 来自 tokens.json / tokens.tree.json 的键与 meta.categories
   抄一份就会漂 —— 组件升到 stable 后，这里还留着 beta，判据就恒真。 */
var ENUMS = {
  set: function () {
    return Object.keys(readJSON(path.join(AI, 'tokens.json')).sets);
  },
  cat: function () {
    return readJSON(path.join(AI, 'tokens.tree.json')).meta.categories;
  },
  maturity: function () {
    var p = readJSON(path.join(AI, 'profiles.json')).profiles;
    var seen = [];
    Object.keys(p).forEach(function (k) {
      (p[k].allowedMaturity || []).forEach(function (m) {
        if (seen.indexOf(m) < 0) seen.push(m);
      });
    });
    return seen;
  },
  profile: ['creative', 'standard', 'strict'],
  medium: ['screen', 'paper'],
  /* 版式清单来自 `ai/recipes.json`（由 `check-html.js` 读取并校验形状），
     不在这里重抄 —— 加一个版式只改一个地方。 */
  recipe: function () {
    var r = require('./check-html.js').readRecipes();
    return r ? Object.keys(r.recipes) : [];
  }
};

function enumValues(name) {
  var src = ENUMS[name];
  if (!src) return null;
  return typeof src === 'function' ? src() : src;
}

/* 同一个枚举开关出现两次 ⇒ 报错。`--set=light --set=dark` 以前**静默取第一个**：
   调用方以为切到了 dark，拿到的却是 light，而且没有任何迹象。 */
function flagCount(name) {
  var eq = '--' + name + '=', bare = '--' + name, n = 0;
  for (var i = 0; i < process.argv.length; i++) {
    var a = process.argv[i];
    if (a === bare || a.indexOf(eq) === 0) n++;
  }
  return n;
}

/* 读一个枚举开关；没给返回 null。给了就一定是合法值，否则当场退出（非 0）。 */
function enumFlag(name) {
  var v = flag(name, null);
  if (v === null) return null;
  var allowed = enumValues(name);
  if (!allowed) fail('internal', '枚举 ' + name + ' 没有登记在 ENUMS 里');
  var hint = '（可用：' + allowed.join(' | ') + '）';
  var n = flagCount(name);
  if (n > 1) die('--' + name + ' 给了 ' + n + ' 次。只认一个值 —— 想对比就分两次调用' + hint);
  if (v === true) die('--' + name + ' 后面要跟取值' + hint);
  if (String(v) === '') die('--' + name + '= 是空值' + hint);
  if (allowed.indexOf(String(v)) < 0) {
    die('--' + name + '=' + v + ' 不是合法值' + hint);
  }
  return String(v);
}

// ---------------------------------------------------------------- check
function cmdCheck(args) {
  var file = args[0];
  /* 这两个开关**自己就能构成一次调用**（`ai check --list-recipes`），
     所以必须在"必须有文件"之前处理 —— 否则它会被当成文件名去读。 */
  var lr = flag('list-recipes', false);
  if (lr === true || lr === 'true') return cmdCheckHtml(null);
  if (!file) {
    die('用法：ai check <doc.json> [--profile=creative|standard|strict] [--medium=screen|paper]\n'
      + '      ai check <page.html> [--recipe=<版式>] [--strict] [--list-recipes]');
  }
  /* 🔴 产物与计划是两种东西，判据也不重叠：
       · `.json` → 文档模型（组件在不在档位里、节点类型对不对）
       · `.html` → 写出来的那一页（类名有没有定义、结构缺不缺件）
     用扩展名分派，是因为调用方最容易做对的一件事就是"把文件名给对"。
     显式 `--html` 留给没有扩展名/扩展名不是 html 的临时文件；
     `--recipe` 同理（版式判据只对页面有意义）。 */
  var wantHtml = flag('html', false);
  var hasRecipe = flag('recipe', null) !== null;
  if (wantHtml === true || wantHtml === 'true' || hasRecipe || /\.html?$/i.test(file)) {
    return cmdCheckHtml(file);
  }
  var doc = readJSON(file, true);
  /* 档位优先取命令行，其次取文档自己声明的，最后 standard。
     ⚠️ 枚举校验必须在**取值之后**做：「文档里写了什么」也要是合法档位。 */
  var profile = enumFlag('profile') || doc.profile || 'standard';
  if (enumValues('profile').indexOf(String(profile)) < 0) {
    die('文档的 profile 字段是 ' + JSON.stringify(profile)
      + '，不是合法档位（可用：' + enumValues('profile').join(' | ') + '）');
  }
  /* 介质是**与档位正交**的第二根轴：
     strict+paper 与 creative+paper 都必须合法，做成第四个 profile 会把两维压成一维。
     默认 screen ⇒ 今天所有调用零成本；paper 才追加打印义务。 */
  var medium = enumFlag('medium') || 'screen';
  var r = validate.validateDoc(doc, { profile: profile, medium: medium });
  var json = isJson();

  if (json) {
    out(r);
    process.exit(r.ok ? 0 : 1);
  }
  process.stdout.write('  === 契约校验（档位：' + r.profile
    + '，介质：' + r.medium + '）===\n\n');
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

// ------------------------------------------------------- check（产物 / HTML）
/* ⚠️ 判据全在 `ai/check-html.js` 里，这里只负责"把结果说人话"和退出码。
   分开的理由：门禁（05-audit/html-check-gate.js）要能直接 require 判据，
   不必为了拿一份结论去 fork 一个进程、再去解析中文输出。 */
function cmdCheckHtml(file) {
  var checkHtml = require('./check-html.js');
  /* 🔴 `--profile` / `--medium` 是**文档模型**的轴，对一页 HTML 没有任何意义。
     以前它们被静默忽略 ⇒ `check page.html --profile=strict` 退出码 0，
     调用方以为"按 strict 档查过了"。**善意的忽略就是假绿。** */
  if (flag('profile', null) !== null) {
    die('--profile 只对 doc.json 有效（HTML 用 --recipe 指定版式）');
  }
  if (flag('medium', null) !== null) {
    die('--medium 只对 doc.json 有效（HTML 用 --recipe 指定版式）');
  }
  /* `enumFlag` 已经把"没给值 / 空值 / 非法值 / 给两次"都挡在外面了，
     这里拿到的要么是 null，要么是合法版式名。 */
  var recipe = enumFlag('recipe');
  var listRecipes = flag('list-recipes', false);
  if (listRecipes === true || listRecipes === 'true') {
    var all = checkHtml.readRecipes();
    if (!all) die('ai/recipes.json 读不到 —— 这份包不完整');
    if (isJson()) { out(all); process.exit(0); }
    process.stdout.write('  === 可校验的版式 ===\n\n');
    Object.keys(all.recipes).forEach(function (k) {
      var r = all.recipes[k];
      process.stdout.write('  ' + pad(k, 20) + r.label + '\n');
      process.stdout.write('       ' + r.root + '  必有件 ' + r.requires.length + ' 条'
        + (r.unchecked && r.unchecked.length
          ? ' · 另有 ' + r.unchecked.length + ' 条只能人工判' : '') + '\n');
    });
    process.exit(0);
  }
  /* `--strict` 把警告当失败。默认不这么做：警告里有一类是"页面自己的类名"，
     那在单文件页面上完全合法，不该把一页正常的报告判死。 */
  var strictFlag = flag('strict', false);
  var r = checkHtml.checkPage(file, {
    recipe: recipe || null,
    strict: strictFlag === true || strictFlag === 'true'
  });

  if (r.code === 'unreadable') die(r.message);
  if (r.code === 'unknown-recipe') die(r.message);

  if (isJson()) {
    out(r);
    process.exit(r.ok ? 0 : 1);
  }

  process.stdout.write('  === 页面检查（' + r.file + '）===\n');
  process.stdout.write('  ' + r.rules.length + ' 条判据 · 本地样式表 ' + r.sources.localSheets
    + ' 个 · 库内类名 ' + r.sources.libraryClasses
    + '（' + r.sources.libraryCssFiles + ' 个 CSS）'
    + (r.recipe ? ' · 版式 ' + r.recipe : '') + '\n\n');

  r.findings.forEach(function (f) {
    process.stdout.write('  [' + (f.level === 'error' ? 'FAIL' : 'WARN') + '] '
      + pad(f.line + ' 行', 8) + pad(f.rule, 18) + f.msg + '\n');
    process.stdout.write('         ' + checkHtml.RULES[f.rule].hint + '\n');
  });

  if (r.skipped.length) {
    process.stdout.write('\n  ⚠️ 未判定（**不计入通过**）：\n');
    r.skipped.forEach(function (s) {
      process.stdout.write('     · ' + s.rule + ' —— ' + s.why + '\n');
    });
  }
  if (r.notes.length) {
    process.stdout.write('\n  ⚠️ 这一版还有判不了的部分（只提示，不判过）：\n');
    r.notes.forEach(function (n) {
      process.stdout.write('     · ' + n.label + ' —— ' + n.why + '\n');
    });
  }

  process.stdout.write('\n');
  if (r.ok) {
    process.stdout.write('  OK  ' + r.rules.length + ' 条判据没有发现问题（'
      + r.counts.error + ' 错误 / ' + r.counts.warn + ' 警告）\n');
  } else {
    process.stdout.write('  FAIL  ' + r.counts.error + ' 个错误 / '
      + r.counts.warn + ' 个警告\n');
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
  patch: 'patch.schema.json',
  /* behaviors 是稳定性承诺里的核心契约（微行为矩阵），
     它的 schema 文件一直都在，但这里漏登记 ⇒ `--schema=behaviors` 报
     "未知 schema"，等于这份契约**没有任何工具能校验**。 */
  behaviors: 'behaviors.schema.json'
};

function cmdValidate(args) {
  var file = args[0];
  var which = flag('schema', 'contract');
  if (!file) die('用法：ai validate <file.json> --schema=' + Object.keys(SCHEMAS).join('|'));
  if (!SCHEMAS[which]) die('未知 schema：' + which);
  validate.assertSchemasUseOnlySupported();
  var schema = readJSON(path.join(AI, SCHEMAS[which]));
  var data = readJSON(file, true);
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
  var a = readJSON(fa, true), b = readJSON(fb, true);
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
  var doc = readJSON(fdoc, true);
  var p = readJSON(fpatch, true);
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
  var m = enumFlag('maturity');
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
  var set = enumFlag('set');
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
  var set = enumFlag('set');
  var cat = enumFlag('cat');
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

function cmdProfile(args) {
  /* 多余的位置参数以前被**静默忽略**：`ai profile zzz` 打印三档、退出码 0，
     调用方会以为"zzz 这一档存在"。只拒绝位置参数，开关照收（`--json`）。 */
  var extra = (args || []).filter(function (a) { return String(a).charAt(0) !== '-'; });
  if (extra.length) {
    die('ai profile 不接受位置参数（收到 ' + extra.join(' ')
      + '）。想查某一档的行为，用 ai check <doc.json> --profile=<档位>');
  }
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

// ---------------------------------------------------------------- pdf
/* 退出码用全局那一套（顶部 `EXIT`）：2 用法 / 3 没浏览器 / 4 渲染失败 / 5 超预算。
   这几条**先于其它子命令**定下来、也早在 CHANGELOG 里公开过 ——
   所以收敛方向是「其它子命令向它看齐」，不是再定义一套。 */
function cmdPdf(args) {
  /* 用法错误一律 usage（退出码 2），与全 CLI 其它子命令同一个出口。 */
  function bad(msg) { die(msg); }
  var src = args[0];
  if (!src) {
    bad('用法：agentcss pdf <页面.html|URL> --out <file.pdf> '
      + '[--paper=a4|letter|a5|a3|legal] [--margin="18mm 15mm"] '
      + '[--max-pages=N] [--chrome=<path>] [--json]');
  }
  var remote = /^https?:\/\//i.test(src);
  var outFile = flag('out', null);
  if (outFile === null || outFile === true) {
    /* 远程地址推不出本地文件名，必须显式给 —— 猜一个出来只会让人找不到文件在哪 */
    if (remote) bad('远程地址必须显式给 --out');
    outFile = src.replace(/\.(html?|xhtml)$/i, '') + '.pdf';
  }
  var budget = flag('max-pages', null);
  if (budget === true) bad('--max-pages 后面要跟数字（不设 = 无界）');
  /* 先按字符串校验再转数字：让报错里出现**使用者打进去的那串字符**。
     直接 Number() 再报错时，`abc` 已经变成 NaN，报「收到 NaN/null」是在念实现细节。 */
  if (budget !== null && !/^\d+$/.test(String(budget))) {
    bad('--max-pages 必须是 ≥1 的整数，收到 ' + JSON.stringify(String(budget)));
  }
  var chrome = flag('chrome', null);
  if (chrome === true) bad('--chrome 后面要跟可执行文件路径');

  var r = pdfExport.exportPdf({
    src: src,
    out: outFile,
    paper: flag('paper', pdfExport.DEFAULT_PAPER),
    margin: flag('margin', pdfExport.DEFAULT_MARGIN),
    budget: budget === null ? null : Number(budget),
    chrome: chrome
  });

  var box = r.mediaBox
    ? Math.round(r.mediaBox.width) + '×' + Math.round(r.mediaBox.height) + 'pt' : '?';
  var report = {
    ok: r.ok,
    command: 'pdf',
    code: r.ok ? null : r.code,
    message: r.ok ? null : r.message,
    out: r.out || null,
    pages: r.pages === undefined ? null : r.pages,
    budget: r.budget === undefined ? null : r.budget,
    paper: r.paper || null,
    paperSize: box,
    margin: r.margin || null,
    bytes: r.bytes || null,
    injected: r.injected === undefined ? null : r.injected,
    chrome: r.chrome || null,
    ms: r.ms || null
  };
  if (!r.ok) {
    /* 失败时**保留上下文**（产物路径 / 页数 / 预算）：
       超预算这一类的产物是完整的，把这些字段丢掉等于让调用方再猜一次。 */
    if (r.code === 'over-budget' && !isJson()) {
      process.stderr.write('         （预算超了不是渲染出错，产物是完整的）\n');
    }
    fail(r.code || 'render', r.message, {
      out: r.out || null,
      pages: r.pages === undefined ? null : r.pages,
      budget: r.budget === undefined ? null : r.budget
    });
  }
  if (isJson()) {
    out(report);
    process.exit(0);
  }
  process.stdout.write('  OK  ' + r.out + '\n');
  process.stdout.write('      ' + r.pages + ' 页 · ' + report.paperSize + ' · '
    + (r.margin ? '边距 ' + r.margin : '边距由页面决定')
    + ' · ' + r.bytes + ' 字节 · ' + r.ms + ' ms\n');
  process.stdout.write('      预算 ' + (r.budget === null ? '未设（无界）' : r.budget + ' 页')
    + ' · ' + (r.injected
      ? '纸幅 ' + r.paper
      : '纸幅由页面自己的 CSS 决定（远程页面：未注入 @page，--paper/--margin 不生效）')
    + '\n');
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

// ---------------------------------------------------------------- scaffold
function cmdScaffold(args) {
  var scaffold = require('./scaffold.js');
  var id = args[0];

  if (!id || id === 'list') {
    if (isJson()) { out({ ok: true, command: 'scaffold', recipes: scaffold.list() }); process.exit(0); }
    process.stdout.write('  === 可生成的壳 ===\n\n');
    scaffold.list().forEach(function (r) {
      process.stdout.write('  ' + pad(r.id, 20) + r.label + '\n');
    });
    process.stdout.write('\n  用法：agentcss ai scaffold <版式> --out <page.html>\n');
    process.exit(0);
  }

  var outFile = flag('out', null);
  if (!outFile || outFile === true) {
    die('用法：ai scaffold ' + id + ' --out <page.html> [--css-prefix=<样式表前缀>]');
  }
  var prefix = flag('css-prefix', null);
  if (prefix === true) die('--css-prefix 后面要跟路径（例：node_modules/agentcss）');

  var r = scaffold.render(id, { cssPrefix: prefix === null ? undefined : prefix });
  if (!r.ok) die(r.message);

  var abs = path.resolve(outFile);
  if (fs.existsSync(abs)) {
    /* 不覆盖：壳是用来改的，覆盖掉一份正在写的页面比报错更贵。
       真要覆盖就自己删 —— 这一步不该由工具代做。 */
    die('目标文件已存在：' + abs + '\n  壳不会覆盖已有文件（它可能正在被改）。'
      + '换一个 --out，或先删掉它。');
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, r.html, 'utf8');

  if (isJson()) {
    out({
      ok: true, command: 'scaffold', recipe: r.id, out: abs,
      bytes: Buffer.byteLength(r.html), requires: r.requires
    });
    process.exit(0);
  }
  process.stdout.write('  OK  已写出 ' + abs + '（' + Buffer.byteLength(r.html) + ' 字节）\n');
  process.stdout.write('      版式 ' + r.id + ' · 必有件 ' + r.requires.length + ' 条'
    + (r.requires.length ? '：' + r.requires.join(' ') : '') + '\n');
  process.stdout.write('      下一步：agentcss ai check ' + outFile + ' --recipe=' + r.id + '\n');
  process.stdout.write('      再下一步：agentcss ai shot ' + outFile + ' --out shot-{width}.png --width=390,1440 --full\n');
  process.exit(0);
}

// ---------------------------------------------------------------- shot
/* shot 的 code 与 pdf 同一批语义（usage / no-chrome / render / timeout），
   多一点 viewport（视口没设成 = 渲染失败）。都走顶部那张全局 `EXIT` ——
   调用方按码分支时，不该因为换了个子命令就得记第二张表。 */

function cmdShot(args) {
  var shot = require('./shot.js');
  var src = args[0];

  function bad(msg) { die(msg); }

  if (!src) {
    bad('用法：agentcss shot <页面.html|URL> --out <file.png> [--width=390,1440] [--height=900] '
      + '[--full] [--scale=2] [--wait=800] [--chrome=<path>] [--json]');
  }
  var outFile = flag('out', null);
  if (!outFile || outFile === true) bad('缺 --out（多宽度时用 {width} 占位，例：shot-{width}.png）');

  var wRaw = flag('width', null);
  var widths = [1440];
  if (wRaw === true) bad('--width 后面要跟数字（多个用逗号分隔，例：390,1440）');
  if (typeof wRaw === 'string') {
    widths = wRaw.split(',').map(function (s) { return s.trim(); })
      .filter(Boolean).map(function (s) { return /^\d+$/.test(s) ? Number(s) : NaN; });
    if (!widths.length || widths.some(function (n) { return !isFinite(n); })) {
      bad('--width 只接受整数，收到 ' + JSON.stringify(wRaw));
    }
  }

  var hRaw = flag('height', null);
  if (hRaw === true) bad('--height 后面要跟数字（例：900）');
  if (typeof hRaw === 'string' && !/^\d+$/.test(hRaw)) {
    bad('--height 只接受整数，收到 ' + JSON.stringify(hRaw));
  }

  var scaleRaw = flag('scale', null);
  if (scaleRaw === true) bad('--scale 后面要跟数字（1 / 2）');
  if (typeof scaleRaw === 'string' && !/^\d+(\.\d+)?$/.test(scaleRaw)) {
    bad('--scale 只接受数字，收到 ' + JSON.stringify(scaleRaw));
  }

  var waitRaw = flag('wait', null);
  if (waitRaw === true) bad('--wait 后面要跟毫秒数');
  if (typeof waitRaw === 'string' && !/^\d+$/.test(waitRaw)) {
    bad('--wait 只接受整数毫秒，收到 ' + JSON.stringify(waitRaw));
  }

  var chrome = flag('chrome', null);
  if (chrome === true) bad('--chrome 后面要跟可执行文件路径');

  var fullFlag = flag('full', false);
  var full = fullFlag === true || fullFlag === 'true';

  shot.shoot({
    src: src,
    out: outFile,
    widths: widths,
    height: hRaw === null ? undefined : Number(hRaw),
    full: full,
    scale: scaleRaw === null ? undefined : Number(scaleRaw),
    wait: waitRaw === null ? undefined : Number(waitRaw),
    chrome: chrome === null ? undefined : chrome
  }).then(function (r) {
    /* 🔴 视口必须等于请求的宽度。不等就说明"设视口"这一步没生效
       （正是 `--screenshot --window-size` 那条老路会静默发生的失败）。
       这时候不能把图交出去：一张宽度不对的图比没有图更误导。 */
    if (r.ok) {
      var wrong = r.shots.filter(function (s) { return s.viewport !== null && s.viewport !== s.width; });
      if (wrong.length) {
        r.ok = false;
        r.code = 'viewport';
        r.message = '视口没有设成请求的宽度：' + wrong.map(function (s) {
          return '要 ' + s.width + ' 实际 ' + s.viewport;
        }).join('；') + '\n  这类图看起来是对的，实际是另一个宽度下的排版。';
      }
    }

    if (isJson()) {
      out(r);
      process.exitCode = r.ok ? 0 : (EXIT[r.code] || EXIT.render);
      return;
    }
    if (!r.ok) {
      process.stderr.write('  [FAIL] ' + r.message + '\n');
      process.exitCode = EXIT[r.code] || EXIT.render;
      return;
    }
    r.shots.forEach(function (s) {
      process.stdout.write('  OK  ' + s.out + '\n');
      process.stdout.write('      ' + s.png.width + '×' + s.png.height + ' px'
        + ' · 视口宽 ' + s.width + ' · 内容高 ' + s.scrollHeight
        + ' · ' + Math.round(s.bytes / 1024) + ' KB · ' + s.ms + ' ms'
        + (s.truncatedAt ? ' · 🔴 已截断到 ' + s.png.height + '（原 ' + s.truncatedAt + '）' : '') + '\n');
      if (s.overflowCount) {
        process.stdout.write('      ⚠️ 这个宽度下横向溢出 ' + s.overflowCount + ' 处'
          + '（页面宽 ' + s.scrollWidth + ' > 视口 ' + s.viewport + '）：' + s.overflow.join('、') + '\n');
      }
    });
    if (r.consoleErrors.length) {
      process.stdout.write('\n  ⚠️ 页面里有 ' + r.consoleErrors.length + ' 条 JS 报错 ——'
        + '图可能看起来是空的：\n');
      r.consoleErrors.slice(0, 5).forEach(function (e) {
        process.stdout.write('     · ' + e + '\n');
      });
    }
    process.exitCode = 0;
  }).catch(function (e) {
    fail('render', String(e && e.message || e));
  });
}

// ---------------------------------------------------------------- 分发
/* 🔴 每个命令认识哪些开关，**只在这一处声明**。
   为什么要声明：以前无关开关被静默忽略 ——
   `ai components --set=dark` 退出码 0、什么都不说，
   调用方会以为"按 dark 过滤过了"。**善意的忽略就是假绿**，
   而 Agent 不会去核对"这个开关到底生效没有"。
   `json` / `h` 是所有命令共有的（输出格式与帮助）。 */
var GLOBAL_FLAGS = ['json', 'h', 'help'];

var FLAGS = {
  check: ['profile', 'medium', 'recipe', 'strict', 'list-recipes', 'html'],
  validate: ['schema'],
  diff: [],
  patch: ['o'],
  components: ['maturity'],
  assets: [],
  tokens: ['set'],
  tree: ['set', 'cat'],
  profile: [],
  capabilities: [],
  pitfalls: ['component', 'scope', 'tag'],
  pdf: ['out', 'paper', 'margin', 'max-pages', 'chrome'],
  scaffold: ['out', 'css-prefix'],
  shot: ['out', 'width', 'height', 'full', 'scale', 'wait', 'chrome']
};

function rejectUnknownFlags(cmd, allowed) {
  for (var i = 2; i < process.argv.length; i++) {
    var a = process.argv[i];
    if (a.charAt(0) !== '-' || a === '-' || a === '--') continue;
    var name = a.replace(/^--?/, '').split('=')[0];
    if (allowed.indexOf(name) >= 0) continue;
    die('`' + cmd + '` 不认识开关 ' + (a.charAt(1) === '-' ? '--' : '-') + name
      + '（本命令支持：' + allowed.join(' / ') + '）');
  }
}

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
  pitfalls: cmdPitfalls,
  pdf: cmdPdf,
  scaffold: cmdScaffold,
  shot: cmdShot
};

/* 帮助正文单独成函数：`main()` 里有三处要打印它
   （无参数 / 显式 help / 任意位置的 --help），复制三份必然漂。 */
function usage() {
  process.stdout.write(
      'agentcss ai —— 独立校验入口（零依赖、不联网、不依赖任何模型）\n\n' +
      '  ai check        <doc.json> [--profile=creative|standard|strict] [--medium=screen|paper] [--json]\n' +
      '  ai check        <page.html> [--recipe=<版式>] [--strict] [--list-recipes] [--json]\n' +
      '                  产物检查：类名有没有定义、引没引到样式表、图/表/标题缺不缺件\n' +
      '  ai validate     <file.json> --schema='
        + Object.keys(SCHEMAS).join('|') + ' [--json]\n' +
      '  ai diff         <改动前.json> <改动后.json> [--json]   按语义 id 比对\n' +
      '  ai patch        <doc.json> <patch.json> [-o out.json] [--json]\n' +
      '  ai components   [--maturity=' + enumValues('maturity').join('|') + '] [--json]\n' +
      '  ai assets       [--json]   组件之外的资产：布局 / 微行为核 / 示例页 / 适配器\n' +
      '  ai tokens       [--set=light|dark] [--json]\n' +
      '  ai tree         [--set=light|dark] [--cat=color] [--json]\n' +
      '  ai pitfalls     [--component=<id>] [--scope=component|layout|process|writing] [--tag=<t>] [--json]\n' +
      '  ai profile      [--json]   列出三档及其差异\n' +
      '  ai capabilities [--json]   列出可协商的能力\n' +
      '  ai pdf          <页面.html|URL> --out <file.pdf> [--paper=a4|letter|a5|a3|legal]\n' +
      '                  [--margin="18mm 15mm"] [--max-pages=N] [--chrome=<path>] [--json]\n' +
      '                  HTML → PDF。零依赖（用你机器上已装的 Chrome），@page 由导出方给。\n' +
      '  ai scaffold     <版式> --out <page.html> [--css-prefix=<前缀>] [--json]\n' +
      '                  生成最小壳（正确的骨架 + 必有件位置），不含内容。`list` 看有哪些版式。\n' +
      '  ai shot         <页面.html|URL> --out <shot-{width}.png> [--width=390,1440] [--height=900]\n' +
      '                  [--full] [--scale=2] [--wait=800] [--chrome=<path>] [--json]\n' +
      '                  HTML → PNG（真实视口，不是"按窗口宽度裁一刀"）。会报横向溢出与 JS 报错。\n' +
      '\n' +
      '  打印：`--medium=paper` 才会校验 printPolicy 与 pageBudget；默认 screen 零成本。\n' +
      '  每个组件的纸面行为：ai/components.json 的 printPolicy。\n' +
      '\n' +
      '  每个子命令都支持 --json；失败时输出 {ok:false, command, error:{kind, message}}。\n' +
      '\n' +
      '  退出码（全 CLI 同一套，kind 与码一一对应）：\n' +
      '    0  通过\n' +
      '    1  判定不通过（页面/文档确实有错 —— 是结论，不是工具坏了）\n' +
      '    2  用法错误（参数名、取值、组合不对）\n' +
      '    3  环境不具备（没有浏览器 / node 不在 PATH）\n' +
      '    4  渲染失败（超时、读不出、视口没设成）\n' +
      '    5  超出预算（产物是完整的，只是超了页数）\n' +
      '    6  工具内部错误（是工具的问题，不是你参数写错）\n' +
      '  前缀 `ai` 可写可不写：`agentcss ai components` 与 `agentcss components` 等价。\n');
}

function main() {
  var argv = process.argv.slice(2);
  if (!argv.length || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    process.exit(0);
  }
  var name = argv.shift();
  /* 🔴 `ai` 是可选的**前缀别名**（2026-11-02 补）：
     帮助里的命令一直写成 `ai components`，AGENTS.md / llms.txt / STABILITY.md /
     VERIFY-RELEASE.md 也都教 `npx agentcss ai components --json` ——
     而分发器只认 `components`，于是「照着文档敲第一条命令」直接得到
     「未知子命令：ai」。消费者视角的硬伤：文档里最靠前的那条命令不能用，
     后面写得再准也读不到。
     两种写法都认，免得已经抄下去的人再改一遍。 */
  if (name === 'ai') {
    name = argv.length ? argv.shift() : '';
    if (!name) {
      die('`agentcss ai` 后面要跟子命令（可用：' + Object.keys(CMDS).join(' / ') + '）');
    }
  }
  if (argv.indexOf('--help') >= 0 || argv.indexOf('-h') >= 0) {
    usage();
    process.exit(0);
  }
  CURRENT_CMD = name;
  var fn = CMDS[name];
  if (!fn) die('未知子命令：' + name + '（可用：' + Object.keys(CMDS).join(' / ') + '）');
  /* 未知开关在**调用命令之前**拒掉：命令内部各自判断的话，
     遇到不认识的开关就只剩"忽略"和"崩"两种选择。 */
  rejectUnknownFlags(name, GLOBAL_FLAGS.concat(FLAGS[name] || []));
  try {
    fn(argv);
  } catch (e) {
    /* 🔴 这里是**兜底**：走到这儿说明是工具自己的 bug（TypeError / 读不到自带的文件）。
       以前一律 `die(e.message)` ⇒ kind 恒为 'usage'、退出码 1。
       实测（0.26.0）：`ai tree --set=zzz --cat=nope` 报的是
         {"ok":false,"error":{"kind":"usage","message":"Cannot read properties of undefined (reading 'nope')"}}
       —— 调用方看到 kind=usage，会去改自己的参数，而真正该改的是工具。
       现在：kind=internal、退出码 6、并且带一行为"这是工具的问题"。 */
    fail((e && e.kind) || 'internal', (e && e.message) || String(e));
  }
}

if (require.main === module) main();
/* 导出给门禁做**反漂移**用：
   · `SCHEMAS` —— 判"磁盘上每份 *.schema.json 都已登记"，以及"登记的都存在"
   · `ENUMS`   —— 判"每个枚举开关的取值都来自数据，不是手抄"
   门禁直接 require 本文件拿真值，**不复制一份清单**（I-7）。 */
module.exports = { CMDS: CMDS, SCHEMAS: SCHEMAS, ENUMS: ENUMS, EXIT: EXIT, FLAGS: FLAGS,
                   /* 只给门禁验「输出 undefined 必须当场失败」这条兜底 */
                   _out: out };
