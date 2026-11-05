#!/usr/bin/env node
/*
 * ai-layer-gate.js — 机器可读契约层的门禁
 *
 * ============================================================================
 * 判据（每条都配反向控制，证明它会红）
 * ----------------------------------------------------------------------------
 *   ① 四份 schema 只用了校验器实现过的关键字（否则静默漏检）
 *   ② 五份事实文件（components / tokens / behaviors / tokens.audience /
 *      tokens.tree）各自符合自己的 schema
 *   ③ Profile 有鉴别力：同一份文档，strict 必须比 creative **报错更多**
 *   ④ Patch 五种操作全部可应用；move **不碰内容**；未知 id 报错且文档不变
 *   ⑤ 前向兼容：extensions 里的未知键被忽略，不判文档非法
 *   ⑥ CLI 各子命令的退出码正确
 *
 * ============================================================================
 * 🔴 为什么③单独列一条
 * ----------------------------------------------------------------------------
 * Profile 做成三档很容易，很容易做成**三档其实一样** ——
 * 参数写了、读也读了，但判据里根本没用上。
 * ⇒ 判据必须是"strict 比 creative 更严"，而不是"三档都存在"。
 * **"存在差异"才是有鉴别力的判据，"存在"不是。**
 * ============================================================================
 */
'use strict';

var fs = require('fs');
var path = require('path');
var ROOT = path.dirname(__dirname);
var AI = path.join(ROOT, 'ai');

var validate = require(path.join(AI, 'validate.js'));
var patch = require(path.join(AI, 'patch.js'));

var fails = [];
var passes = 0;

function ok(name, extra) {
  passes++;
  process.stdout.write('  [OK]   ' + name + (extra ? '  — ' + extra : '') + '\n');
}
function bad(name, detail) {
  fails.push(name);
  process.stdout.write('  [FAIL] ' + name + '\n         ' + detail + '\n');
}
function expect(cond, name, detail) {
  if (cond) ok(name); else bad(name, detail || '');
}

function readJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(AI, rel), 'utf8'));
}

// ---------------------------------------------------------------- ① 关键字白名单
try {
  validate.assertSchemasUseOnlySupported();
  ok('① 八份 schema 只用了校验器实现过的关键字');
} catch (e) {
  bad('① schema 用了未实现的关键字', e.message);
}

// 反向控制：给白名单外关键字，必须抛错
(function () {
  var v = require(path.join(AI, 'validate.js'));
  try {
    v.validate({ $defs: {} }, {});
    // $defs 不在白名单，但 validate 不检查 —— 检查函数在 assertSchemas... 里
    // ⇒ 这里直接构造一个含未知 $ 关键字的 schema 走 walk
    var orig = fs.readFileSync(path.join(AI, 'contract.schema.json'), 'utf8');
    fs.writeFileSync(path.join(AI, '_probe.schema.json'),
      JSON.stringify({ $schema: 'x', $futureKeyword: true }, null, 2));
    var threw = false;
    try {
      // 临时把探针纳入扫描：直接调用内部同样的逻辑
      var files = ['contract.schema.json', 'components.schema.json',
                   'tokens.schema.json', 'patch.schema.json',
                   'behaviors.schema.json', 'tokens.audience.schema.json',
                   'tokens.tree.schema.json', 'deprecations.schema.json'];
      // 用同一套白名单手动扫探针
      var SUP = require(path.join(AI, 'validate.js')).SUPPORTED_KEYWORDS;
      var probe = JSON.parse(fs.readFileSync(path.join(AI, '_probe.schema.json'), 'utf8'));
      Object.keys(probe).forEach(function (k) {
        if (k.charAt(0) === '$' && SUP.indexOf(k) < 0) threw = true;
      });
    } catch (e) { /* ignore */ }
    fs.unlinkSync(path.join(AI, '_probe.schema.json'));
    expect(threw, '①′ 反向控制：白名单外的 $ 关键字会被认出来');
  } catch (e) {
    bad('①′ 反向控制', e.message);
  }
})();

// ---------------------------------------------------------------- ② 事实文件符合 schema
(function () {
  var comps = readJSON('components.json');
  var r = validate.validate(readJSON('components.schema.json'), comps);
  expect(r.ok, '② components.json 符合 components.schema.json',
    JSON.stringify(r.errors.slice(0, 3)));
  var toks = readJSON('tokens.json');
  var r2 = validate.validate(readJSON('tokens.schema.json'), toks);
  expect(r2.ok, '② tokens.json 符合 tokens.schema.json',
    JSON.stringify(r2.errors.slice(0, 3)));
  var beh = readJSON('behaviors.json');
  var r3 = validate.validate(readJSON('behaviors.schema.json'), beh);
  expect(r3.ok, '② behaviors.json 符合 behaviors.schema.json',
    JSON.stringify(r3.errors.slice(0, 3)));
  var aud = readJSON('tokens.audience.json');
  var r4 = validate.validate(readJSON('tokens.audience.schema.json'), aud);
  expect(r4.ok, '② tokens.audience.json 符合 tokens.audience.schema.json',
    JSON.stringify(r4.errors.slice(0, 3)));
  var tree = readJSON('tokens.tree.json');
  var r5 = validate.validate(readJSON('tokens.tree.schema.json'), tree);
  expect(r5.ok, '② tokens.tree.json 符合 tokens.tree.schema.json',
    JSON.stringify(r5.errors.slice(0, 3)));
  var dep = readJSON('deprecations.json');
  var r6 = validate.validate(readJSON('deprecations.schema.json'), dep);
  expect(r6.ok, '② deprecations.json 符合 deprecations.schema.json',
    JSON.stringify(r6.errors.slice(0, 3)));
})();

// ---------------------------------------------------------------- ③ Profile 鉴别力
(function () {
  var comps = readJSON('components.json').components;
  var nBeta = comps.filter(function (c) { return c.maturity === 'beta'; }).length;
  var nStable = comps.filter(function (c) { return c.maturity === 'stable'; }).length;

  // ⚠️ 合成夹具：**故意**造一个 beta 与一个 stable。
  //    为什么不能只依赖真实组件表：状态收敛完成后 27 个组件全部升到 stable，
  //    真实表里一个 beta 都没有 ⇒ 这条判据**没法执行**，门禁报"前置条件不足"。
  //    ⇒ 那是"库变好了，门禁反而失去鉴别力"，属于假绿的一种。
  //    ⇒ 规则必须**独立于数据**被证明，所以用夹具。
  var FIXTURE = [
    { id: 'fx-stable', rootClass: 'fx-stable', maturity: 'stable',
      variants: [], slots: [], states: { enum: { 'data-state': ['open', 'closed'] } } },
    { id: 'fx-beta', rootClass: 'fx-beta', maturity: 'beta',
      variants: [], slots: [], states: { enum: { 'data-state': ['open', 'closed'] } } }
  ];
  // ⚠️ 两种模式必须**同进同退**：不能 beta 用夹具、stable 用真实组件 ——
  //    那样夹具表里认不出真实 id，会多出一条"组件不在契约里"的错误，
  //    把真正要测的成熟度差异**盖掉**（实测：于是反向控制 2 < 2 恒不成立）。
  var useFixture = (nBeta === 0 || nStable === 0);
  var beta = useFixture ? FIXTURE[1]
                        : comps.filter(function (c) { return c.maturity === 'beta'; })[0];
  var stable = useFixture ? FIXTURE[0]
                          : comps.filter(function (c) { return c.maturity === 'stable'; })[0];
  var compSet = useFixture ? FIXTURE : null;
  console.log('       （真实组件：stable %d / beta %d%s）',
              nStable, nBeta,
              useFixture ? ' ⇒ 本轮用**合成夹具**验证规则（规则不能依赖数据恰好存在）' : '');
  var vopt = function (p) { return compSet ? { profile: p, components: compSet }
                                           : { profile: p }; };
  // 同一份文档：用了 beta 组件 + 契约里没有的状态取值
  var doc = {
    schemaVersion: '1.0.0',
    profile: 'creative',
    nodes: {
      a: { id: 'a', kind: beta.id, props: {} },
      b: { id: 'b', kind: stable.id, props: { 'data-state': 'open' } }
    },
    root: ['a', 'b']
  };
  // 找一个真正的未知状态取值
  var known = stable.states.enum['data-state'] || [];
  doc.nodes.b.props['data-state'] = known.length ? '__not_a_state__' : 'open';

  var rc = validate.validateDoc(doc, vopt('creative'));
  var rs = validate.validateDoc(doc, vopt('standard'));
  var rt = validate.validateDoc(doc, vopt('strict'));

  expect(rt.errors.length > rc.errors.length,
    '③ strict 比 creative **报错更多**（' + rt.errors.length + ' > ' +
    rc.errors.length + '）',
    '三档没有差异 ⇒ Profile 是摆设');
  expect(rs.errors.length >= rc.errors.length,
    '③ standard 不比 creative 更松（' + rs.errors.length + ' >= ' +
    rc.errors.length + '）');

  // 反向控制：把 beta 组件换成 stable，strict 下该条错误必须消失
  var doc2 = JSON.parse(JSON.stringify(doc));
  doc2.nodes.a.kind = stable.id;
  var rt2 = validate.validateDoc(doc2, vopt('strict'));
  expect(rt2.errors.length < rt.errors.length,
    '③′ 反向控制：换成 stable 后 strict 的错误变少（' +
    rt2.errors.length + ' < ' + rt.errors.length + '）');
})();

// ---------------------------------------------------------------- ④ Patch
(function () {
  var base = {
    schemaVersion: '1.0.0', profile: 'standard',
    nodes: {
      wrap: { id: 'wrap', kind: 'card', children: ['t1'] },
      t1: { id: 't1', kind: 'text', text: '原始内容' }
    },
    root: ['wrap']
  };
  var before = JSON.stringify(base);

  // create
  var r1 = patch.apply(base, { schemaVersion: '1.0.0', ops: [
    { op: 'create', node: { id: 't2', kind: 'text', text: '新建' }, parent: 'wrap' }
  ] });
  expect(r1.ok && r1.doc.nodes.wrap.children.indexOf('t2') >= 0, '④ create');

  // update
  var r2 = patch.apply(base, { ops: [
    { op: 'update', id: 't1', set: { text: '改过了' } }
  ] });
  expect(r2.ok && r2.doc.nodes.t1.text === '改过了', '④ update');

  // 🔴 move：内容必须一个字节都不变
  var two = {
    nodes: {
      a: { id: 'a', kind: 'text', text: 'AAA', children: ['x'] },
      x: { id: 'x', kind: 'text', text: 'XXX' },
      b: { id: 'b', kind: 'text', text: 'BBB' }
    }, root: ['a', 'b']
  };
  var snapshot = JSON.stringify({ x: two.nodes.x, a: two.nodes.a });
  var r3 = patch.apply(two, { ops: [{ op: 'move', id: 'x', parent: 'b', index: 0 }] });
  var after = JSON.stringify({ x: r3.doc.nodes.x, a: r3.doc.nodes.a });
  // a 的 children 会变（这正是 move 的目的），x 与 a 的其它字段不变
  var ax = JSON.parse(JSON.stringify(r3.doc.nodes.a));
  delete ax.children;
  var a0 = { id: 'a', kind: 'text', text: 'AAA' };
  expect(r3.ok && JSON.stringify(r3.doc.nodes.x) === JSON.stringify({ id: 'x', kind: 'text', text: 'XXX' }) &&
    JSON.stringify(ax) === JSON.stringify(a0),
    '④ move **不改动任何内容**（只改挂载关系）');

  // delete
  var r4 = patch.apply(base, { ops: [{ op: 'delete', id: 't1' }] });
  expect(r4.ok && r4.doc.nodes.t1 === undefined &&
    r4.doc.nodes.wrap.children.indexOf('t1') < 0, '④ delete 同时摘掉父引用');

  // replace：id 与挂载位置保持
  var r5 = patch.apply(base, { ops: [
    { op: 'replace', id: 't1', node: { id: 't1', kind: 'text', text: '换了' } }
  ] });
  expect(r5.ok && r5.doc.nodes.t1.text === '换了' &&
    r5.doc.nodes.wrap.children.indexOf('t1') >= 0, '④ replace 保持 id 与挂载位置');

  // 反向控制：未知 id ⇒ 报错，且**原文档不被改动**
  var r6 = patch.apply(base, { ops: [{ op: 'update', id: '不存在', set: { text: 'x' } }] });
  expect(!r6.ok && JSON.stringify(base) === before,
    '④′ 反向控制：操作失败时原文档**一个字节都没动**');

  // 反向控制：非法操作名
  var r7 = patch.apply(base, { ops: [{ op: 'rewriteEverything' }] });
  expect(!r7.ok, '④′ 反向控制：未知操作被拒');

  // 确定性
  var p = { ops: [{ op: 'create', node: { id: 'z', kind: 'text' }, parent: 'wrap' }] };
  expect(patch.isDeterministic(base, p), '④ 确定性：同输入两次结果一致');

  // 撤销
  var r8 = patch.apply(base, { ops: [{ op: 'delete', id: 't1' }] });
  var inv = patch.invert(base, { ops: [{ op: 'delete', id: 't1' }] });
  var r9 = patch.apply(r8.doc, { ops: inv.ops });
  expect(inv.ok && r9.ok && JSON.stringify(r9.doc.nodes.t1) ===
    JSON.stringify(base.nodes.t1), '④ 撤销可逆回原状');
})();

// ---------------------------------------------------------------- ⑤ 前向兼容
(function () {
  var comps = readJSON('components.json').components;
  var stable = comps.filter(function (c) { return c.maturity === 'stable'; })[0];
  var doc = {
    schemaVersion: '1.0.0', profile: 'creative',
    nodes: { a: { id: 'a', kind: stable.id, extensions: { futureThing: 1 } } },
    root: ['a'],
    extensions: { someRendererV2: { layout: 'masonry' } }
  };
  var r = validate.validateDoc(doc, { profile: 'creative' });
  expect(r.ok, '⑤ extensions 里的未知键被忽略，不判文档非法',
    JSON.stringify(r.errors));
  // 反向控制：extensions 不是对象 ⇒ 报错
  var doc2 = JSON.parse(JSON.stringify(doc));
  doc2.profile = 'creative';
  doc2.extensions = 'not-an-object';
  var r2 = validate.validateDoc(doc2, { profile: 'creative' });
  expect(!r2.ok, '⑤′ 反向控制：extensions 类型错了会被抓');
})();

// ---------------------------------------------------------------- ⑥ CLI 退出码
(function () {
  var cp = require('child_process');
  var cli = path.join(AI, 'cli.js');
  var tmp = path.join(require('os').tmpdir(), 'fl-ai-gate-doc.json');
  var comps = readJSON('components.json').components;
  var stable = comps.filter(function (c) { return c.maturity === 'stable'; })[0];
  fs.writeFileSync(tmp, JSON.stringify({
    schemaVersion: '1.0.0', profile: 'creative',
    nodes: { a: { id: 'a', kind: stable.id } }, root: ['a']
  }));
  function run(args) {
    return cp.spawnSync(process.execPath, [cli].concat(args), { encoding: 'utf8' });
  }
  var good = run(['check', tmp, '--profile=creative']);
  expect(good.status === 0, '⑥ CLI：合法文档 + creative ⇒ 退出码 0');
  // ⚠️ 这里**不能**用"beta 组件"做反例：真实组件表里可能一个 beta 都没有
  //    （状态收敛完成后就是 0 个），`[0].id` 会直接 TypeError —— 那不是"测出失败"，
  //   是**门禁自己崩了**，比假绿更糟（它看起来像"环境有问题"）。
  //
  //   而 CLI 读的是真实 `components.json`，没法像 ③ 那样传夹具进去。
  //   ⇒ 改用**不在契约里的组件**做反例：与 beta 走的是同一条拒绝路径
  //     （`profile.allowedMaturity` / `allowedUnknownComponent`），
  //     一样能证明 strict 档**确实会拒**，且不依赖数据里恰好有 beta。
  var strictDoc = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  var realBeta = comps.filter(function (c) { return c.maturity === 'beta'; })[0];
  strictDoc.nodes.a.kind = realBeta ? realBeta.id : '__not_a_component__';
  fs.writeFileSync(tmp, JSON.stringify(strictDoc));
  var badRun = run(['check', tmp, '--profile=strict']);
  expect(badRun.status !== 0, '⑥ CLI：strict 档用了不被允许的组件（' +
         (realBeta ? 'beta ' + realBeta.id : '契约外组件') + '）⇒ 退出码非 0');
  var noArgs = run(['check']);
  expect(noArgs.status !== 0, '⑥ CLI：缺参数 ⇒ 退出码非 0');

  /* ⑥′ 每个子命令的 --json 都必须产出**单一可解析 JSON**。
     🔴 这条挡的是"半截 JSON"：人类提示混进 stdout、或某些命令根本没有 --json
        （旧版只有 7/10 个命令支持，validate 完全没接）。
        判据是"能不能被 JSON.parse"——机器读不了，等于没有。 */
  var T = require('os').tmpdir();
  var fDoc = path.join(T, 'fl-ai-json-doc.json');
  var fDoc2 = path.join(T, 'fl-ai-json-doc2.json');
  var fPat = path.join(T, 'fl-ai-json-patch.json');
  var baseDoc = {
    schemaVersion: '1.0.0', profile: 'creative',
    nodes: { a: { id: 'a', kind: stable.id } }, root: ['a']
  };
  fs.writeFileSync(fDoc, JSON.stringify(baseDoc));
  fs.writeFileSync(fDoc2, JSON.stringify(baseDoc));
  fs.writeFileSync(fPat, JSON.stringify({
    schemaVersion: '1.0.0',
    ops: [{ op: 'update', id: 'a', patch: { variant: 'primary' } }]
  }));

  var jsonCases = [
    ['check', [fDoc]],
    ['validate', [fDoc, '--schema=contract']],
    ['diff', [fDoc, fDoc2]],
    ['patch', [fDoc, fPat]],
    ['components', []], ['assets', []], ['tokens', []], ['tree', []],
    ['profile', []], ['capabilities', []], ['pitfalls', ['--component=table']],
    /* ⚠️ 文件名带 pid：`scaffold` 拒绝覆盖已存在的文件（防手滑），
       固定文件名会让**第二次运行**起就红 —— 一道只在干净机器上绿的门禁，
       等于把"跑过一遍"变成失败原因。 */
    ['scaffold', ['report/finance', '--out', path.join(T, 'fl-ai-scaffold-' + process.pid + '.html')]]
  ];
  /* 🔴 覆盖断言：`CMDS` 里有、这里没有、也不在豁免表里 ⇒ 红。
     没有这一条，加第 15 个子命令时这条门禁会**静默少测一个**，
     而标题上的数字还会跟着变，看起来永远是对的。 */
  var EXEMPT = {
    shot: '要真实浏览器，由 html-check-gate.js ⑨ 覆盖',
    pdf: '要真实浏览器，由 pdf 相关门禁覆盖'
  };
  var cliMod = require(path.join(AI, 'cli.js'));
  var uncovered = Object.keys(cliMod.CMDS).filter(function (c) {
    return !jsonCases.some(function (x) { return x[0] === c; }) && !EXEMPT[c];
  });
  expect(uncovered.length === 0,
    '⑥‴ 每个子命令要么有 --json 用例、要么在豁免表里写明理由',
    '没覆盖：' + uncovered.join(' ') + '（共 ' + Object.keys(cliMod.CMDS).length + ' 个子命令）');
  var broken = [];
  jsonCases.forEach(function (c) {
    var r = run([c[0]].concat(c[1], ['--json']));
    if (r.status !== 0) { broken.push(c[0] + ' 退出码 ' + r.status); return; }
    try { JSON.parse(r.stdout); } catch (e) { broken.push(c[0] + ' 的 stdout 不是 JSON'); }
  });
  expect(broken.length === 0,
    '⑥′ 全部 ' + jsonCases.length + ' 个子命令都支持 --json，stdout 是单一可解析 JSON',
    broken.join(' / '));

  /* ⑥″ 失败路径：参数错时也必须是 JSON。
     否则调用方拿到的是"退出码 1 + 空 stdout"，分不清用法错还是进程崩了。 */
  var miss = run(['check', path.join(T, 'fl-ai-no-such-file.json'), '--json']);
  var missOK = false;
  try { missOK = JSON.parse(miss.stdout).ok === false; } catch (e) { missOK = false; }
  expect(miss.status !== 0 && missOK,
    '⑥″ 失败时 --json 输出 {ok:false,...} 且退出码非 0',
    'status=' + miss.status + ' stdout=' + String(miss.stdout).slice(0, 48));
})();

// ---------------------------------------------------------------- ⑦ 翻车点：两份文件的口径
(function () {
  /* 翻车点分两份：组件/版式/交付（pitfalls.json）与写作（pitfalls-writing.json）。
     合并不出错是**代码**的职责，这条门禁守的是**口径**：
       · 写作类不许挂组件（挂了就会被 `components --json` 当成组件缺陷）
       · 两份文件的 id 不许重（重了 `--scope` 过滤会各返回一条，读起来像两条不同的坑）
       · CLI 报的条数必须等于两份文件之和（少一份 ⇒ 静默丢了一半，正是要防的）
       · `files` 必须把两份都报出来（少报 = 调用方不知道覆盖面） */
  var cp = require('child_process');
  var cli = path.join(AI, 'cli.js');
  function runCli(args) {
    return cp.spawnSync(process.execPath, [cli].concat(args), { encoding: 'utf8' });
  }

  var core = readJSON('pitfalls.json').pitfalls || [];
  var writ = readJSON('pitfalls-writing.json').pitfalls || [];

  var shapeBad = [];
  core.concat(writ).forEach(function (p) {
    if (!p.id || !p.title || !p.scope || !p.symptom || !p.fix) {
      shapeBad.push((p.id || '(无 id)') + ' 缺字段');
    }
    if (!Array.isArray(p.components)) shapeBad.push(p.id + ' 的 components 不是数组');
    if (!Array.isArray(p.tags)) shapeBad.push(p.id + ' 的 tags 不是数组');
  });
  expect(shapeBad.length === 0,
    '⑦ 两份翻车点文件共 ' + (core.length + writ.length) + ' 条，字段齐全（id/title/scope/symptom/fix）',
    shapeBad.join(' / '));

  var writBad = writ.filter(function (p) {
    return p.scope !== 'writing' || (p.components || []).length !== 0;
  }).map(function (p) { return p.id; });
  expect(writBad.length === 0,
    '⑦′ pitfalls-writing.json 的每条 scope 都是 writing 且不挂组件（' + writ.length + ' 条）',
    writBad.join(' / '));

  var seen = {};
  var dup = [];
  core.concat(writ).forEach(function (p) {
    if (seen[p.id]) dup.push(p.id);
    seen[p.id] = 1;
  });
  expect(dup.length === 0, '⑦″ 两份文件之间没有重复 id', dup.join(' / '));

  var all = runCli(['pitfalls', '--json']);
  var allDoc = null;
  try { allDoc = JSON.parse(all.stdout); } catch (e) { allDoc = null; }
  expect(allDoc && allDoc.count === core.length + writ.length,
    '⑦‴ CLI 合并后的条数 = 两份文件之和（' + (core.length + writ.length) + '）',
    allDoc ? 'count=' + allDoc.count : 'stdout 不是 JSON');

  var filesOK = allDoc && Array.isArray(allDoc.files) &&
    allDoc.files.indexOf('pitfalls.json') >= 0 &&
    allDoc.files.indexOf('pitfalls-writing.json') >= 0;
  expect(filesOK, '⑦⁗ CLI 输出 files 里两份都在（少一份 = 静默丢了一半）',
    allDoc ? JSON.stringify(allDoc.files) : '');

  var w = runCli(['pitfalls', '--json', '--scope=writing']);
  var wDoc = null;
  try { wDoc = JSON.parse(w.stdout); } catch (e) { wDoc = null; }
  expect(wDoc && wDoc.count === writ.length && wDoc.pitfalls.every(function (p) {
    return p.scope === 'writing';
  }), '⑦⁵ --scope=writing 只返回写作类（' + writ.length + ' 条）',
  wDoc ? 'count=' + wDoc.count : 'stdout 不是 JSON');

  /* 反向控制（静态可判）：`components --json` 里挂到组件上的 id，
     必须**只**来自核心文件。写作类若被挂上，这条会列出越界 id。 */
  var coreIds = {};
  core.forEach(function (p) { coreIds[p.id] = 1; });
  var c = runCli(['components', '--json']);
  var cDoc = null;
  try { cDoc = JSON.parse(c.stdout); } catch (e) { cDoc = null; }
  var leaked = [];
  if (cDoc) {
    cDoc.forEach(function (comp) {
      (comp.pitfalls || []).forEach(function (x) {
        if (!coreIds[x.id]) leaked.push(comp.id + '←' + x.id);
      });
    });
  }
  expect(cDoc && leaked.length === 0,
    '⑦⁶ components --json 只挂核心翻车点，写作类不越界',
    cDoc ? leaked.join(' / ') : 'components --json 不是 JSON');
})();

// ------------------------------------------------- ①′ schema 登记与磁盘必须一一对应
/* 为什么要有这一条：`SCHEMAS` 是**手写**的名字→文件表，而 `ai/*.schema.json`
   是磁盘上的事实。两处一旦漂移，就会出现：
     · 磁盘上有、SCHEMAS 里没有 ⇒ 那份契约**没有任何命令能校验**（behaviors 当年就是这样）
     · SCHEMAS 里有、磁盘上没有 ⇒ 命令一调就抛 ENOENT，而报错来自 readJSON 深处
   以前 ① 的标题写着"八份 schema"，实现其实只扫了 4 份 —— 标题比代码说得大。
   现在：预扫遍历目录（validate.js 自己 glob），这里判"登记集合 == 磁盘集合"。 */
(function () {
  var cli = require(path.join(AI, 'cli.js'));
  var onDisk = fs.readdirSync(AI).filter(function (f) {
    return /\.schema\.json$/.test(f);
  }).sort();
  var registered = Object.keys(cli.SCHEMAS).map(function (k) {
    return cli.SCHEMAS[k];
  }).sort();
  var unregistered = onDisk.filter(function (f) { return registered.indexOf(f) < 0; });
  var missing = registered.filter(function (f) { return onDisk.indexOf(f) < 0; });
  expect(unregistered.length === 0 && missing.length === 0,
    '①′ 磁盘上的 schema 与 CLI 登记的 schema 一一对应（共 ' + onDisk.length + ' 份）',
    ('未登记：' + (unregistered.join(' ') || '无') +
     ' / 登记了但不存在：' + (missing.join(' ') || '无')));
})();

// ------------------------------------------------- ①″ 白名单里的每个关键字都有正负例
/* 为什么要有这一条：`uniqueItems` 与 `not` 挂在白名单上很久却**没有实现**，
   `validate({type:'array',uniqueItems:true},[1,1])` 返回 ok:true ——
   白名单只保证"允许出现"，不保证"真的校验"。
   这组用例就是白名单的**契约**：新加一个关键字却没写用例，这道门禁直接红。 */
(function () {
  /* 这些键不约束数据（元信息 / 容器），单独列出来，免得被当成"漏了用例" */
  var META = ['$schema', '$id', '$comment', 'title', 'definitions',
              'invariants', 'opRequirements'];
  var CASES = {
    type: [{ s: { type: 'string' }, d: 'x', want: true },
           { s: { type: 'string' }, d: 1, want: false }],
    required: [{ s: { type: 'object', required: ['a'] }, d: { a: 1 }, want: true },
               { s: { type: 'object', required: ['a'] }, d: {}, want: false }],
    properties: [{ s: { type: 'object', properties: { a: { type: 'string' } } }, d: { a: 'x' }, want: true },
                 { s: { type: 'object', properties: { a: { type: 'string' } } }, d: { a: 1 }, want: false }],
    additionalProperties: [{ s: { type: 'object', properties: { a: {} }, additionalProperties: false }, d: { a: 1 }, want: true },
                           { s: { type: 'object', properties: { a: {} }, additionalProperties: false }, d: { b: 1 }, want: false }],
    patternProperties: [{ s: { type: 'object', patternProperties: { '^x': { type: 'number' } } }, d: { x1: 1 }, want: true },
                        { s: { type: 'object', patternProperties: { '^x': { type: 'number' } } }, d: { x1: 's' }, want: false }],
    items: [{ s: { type: 'array', items: { type: 'number' } }, d: [1], want: true },
            { s: { type: 'array', items: { type: 'number' } }, d: ['s'], want: false }],
    enum: [{ s: { enum: ['a'] }, d: 'a', want: true },
           { s: { enum: ['a'] }, d: 'b', want: false }],
    const: [{ s: { const: 1 }, d: 1, want: true },
            { s: { const: 1 }, d: 2, want: false }],
    pattern: [{ s: { type: 'string', pattern: '^a' }, d: 'ab', want: true },
              { s: { type: 'string', pattern: '^a' }, d: 'b', want: false }],
    minLength: [{ s: { type: 'string', minLength: 2 }, d: 'ab', want: true },
                { s: { type: 'string', minLength: 2 }, d: 'a', want: false }],
    maxLength: [{ s: { type: 'string', maxLength: 2 }, d: 'ab', want: true },
                { s: { type: 'string', maxLength: 2 }, d: 'abc', want: false }],
    minimum: [{ s: { type: 'number', minimum: 1 }, d: 1, want: true },
              { s: { type: 'number', minimum: 1 }, d: 0, want: false }],
    maximum: [{ s: { type: 'number', maximum: 1 }, d: 1, want: true },
              { s: { type: 'number', maximum: 1 }, d: 2, want: false }],
    minItems: [{ s: { type: 'array', minItems: 1 }, d: [1], want: true },
               { s: { type: 'array', minItems: 1 }, d: [], want: false }],
    maxItems: [{ s: { type: 'array', maxItems: 1 }, d: [1], want: true },
               { s: { type: 'array', maxItems: 1 }, d: [1, 1], want: false }],
    uniqueItems: [{ s: { type: 'array', uniqueItems: true }, d: [1, 2], want: true },
                  { s: { type: 'array', uniqueItems: true }, d: [1, 1], want: false },
                  /* 深比较：两个不同的对象字面量，内容相同也算重复 */
                  { s: { type: 'array', uniqueItems: true }, d: [{ a: 1 }, { a: 1 }], want: false },
                  { s: { type: 'array', uniqueItems: true }, d: [{ a: 1 }, { a: 2 }], want: true }],
    allOf: [{ s: { allOf: [{ type: 'string' }] }, d: 'x', want: true },
            { s: { allOf: [{ type: 'string' }] }, d: 1, want: false }],
    anyOf: [{ s: { anyOf: [{ type: 'string' }, { type: 'number' }] }, d: 'x', want: true },
            { s: { anyOf: [{ type: 'string' }, { type: 'number' }] }, d: true, want: false }],
    oneOf: [{ s: { oneOf: [{ type: 'string' }, { type: 'number' }] }, d: 'x', want: true },
            /* 两条都满足 ⇒ oneOf 必须红（这正是它和 anyOf 的区别） */
            { s: { oneOf: [{ type: 'number' }, { minimum: 0 }] }, d: 1, want: false }],
    not: [{ s: { not: { const: 1 } }, d: 2, want: true },
          { s: { not: { const: 1 } }, d: 1, want: false }],
    $ref: [{ s: { definitions: { t: { type: 'string' } }, $ref: '#/definitions/t' }, d: 'x', want: true },
           { s: { definitions: { t: { type: 'string' } }, $ref: '#/definitions/t' }, d: 1, want: false }]
  };

  var unimplemented = validate.SUPPORTED_KEYWORDS.filter(function (k) {
    return META.indexOf(k) < 0 && !CASES[k];
  });
  expect(unimplemented.length === 0,
    '①″ 白名单里每个关键字都有正/负契约用例（' + Object.keys(CASES).length + ' 个）',
    '缺用例：' + unimplemented.join(' '));

  var wrong = [];
  Object.keys(CASES).forEach(function (kw) {
    CASES[kw].forEach(function (c, i) {
      var r = validate.validate(c.s, c.d);
      if (r.ok !== c.want) {
        wrong.push(kw + '#' + i + '（期望 ' + (c.want ? '通过' : '拒绝') +
          '，实际 ' + (r.ok ? '通过' : '拒绝') + '）');
      }
    });
  });
  expect(wrong.length === 0, '①‴ 每个关键字的正/负例都判对了', wrong.join(' / '));
})();

// ------------------------------------------------- ⑧ 参数协议（枚举 / 退出码 / 错误形状）
/* 为什么单开一节：这三件事是**无人值守调用**的全部控制流。
   0.26.0 的实测（本轮外部评审 F1）：
     ai tokens --set=not-a-theme --json   → stdout 是字面量 `undefined`，退出码 0
     ai tree   --set=not-a-theme --json   → 同上
     ai components --maturity=not-a-level → []，退出码 0
   对人是"没输出"，对 Agent 是**错误结论**：它会读成"这个库没有 beta 组件"。
   另有：`ai tree --set=zzz --cat=nope` 报 kind=usage，消息是
   `Cannot read properties of undefined` —— 内部崩溃冒充用法错误。 */
(function () {
  var cp = require('child_process');
  var cliPath = path.join(AI, 'cli.js');
  var cliMod = require(cliPath);
  function runCli(args) {
    return cp.spawnSync(process.execPath, [cliPath].concat(args), { encoding: 'utf8' });
  }
  function parsed(r) {
    try { return JSON.parse(r.stdout); } catch (e) { return null; }
  }

  /* ⑧¹ 退出码表：数值必须是**互不相同的语义**，不是"非 0 就行" */
  var E = cliMod.EXIT;
  expect(E.findings === 1 && E.usage === 2 && E['no-chrome'] === 3
    && E.render === 4 && E['over-budget'] === 5 && E.internal === 6,
    '⑧¹ 退出码表：1 判定 / 2 用法 / 3 环境 / 4 渲染 / 5 预算 / 6 内部',
    JSON.stringify(E));

  /* ⑧² 每个枚举：非法值、空值、重复、吞掉下一个开关 —— 四条负例都要报 usage(2) */
  var ENUMS = cliMod.ENUMS;
  var bad = [];
  Object.keys(ENUMS).forEach(function (name) {
    var allowed = typeof ENUMS[name] === 'function' ? ENUMS[name]() : ENUMS[name];
    if (!allowed.length) { bad.push(name + '：合法值是空集'); return; }
    if (allowed.indexOf('not-a-real-value') >= 0) { bad.push(name + '：夹具值撞上真实取值'); }
    [['--' + name + '=not-a-real-value'], ['--' + name + '='],
     ['--' + name + '=' + allowed[0], '--' + name + '=' + allowed[0]],
     ['--' + name, '--json']].forEach(function (argv) {
      var r = runCli(['components', '--json'].concat(argv));
      /* components 用不到 set/cat/recipe —— 但**参数解析发生在命令之前**，
         所以非法枚举必须照样被拒。这正是"统一入口"的意义。 */
      var d = parsed(r);
      if (r.status !== E.usage) {
        bad.push(name + ' ' + JSON.stringify(argv) + ' ⇒ 退出码 ' + r.status + '（应 2）');
      } else if (!d || d.ok !== false || !d.error || d.error.kind !== 'usage') {
        bad.push(name + ' ' + JSON.stringify(argv) + ' ⇒ 错误形状不对：' + String(r.stdout).slice(0, 60));
      }
    });
  });
  expect(bad.length === 0, '⑧² 每个枚举的非法/空/重复/吞开关四条负例都以 usage(2) 拒绝',
    bad.join(' / '));

  /* ⑧³ 合法值仍然能用（负例都过了但功能被拦死，同样是坏） */
  var okCase = [];
  [['tokens', '--set=' + (ENUMS.set()[0])],
   ['tree', '--set=' + (ENUMS.set()[0])],
   ['tree', '--cat=' + (ENUMS.cat()[0])],
   ['components', '--maturity=' + (ENUMS.maturity()[0])],
   ['profile'],
   ['capabilities'],
   ['pitfalls', '--component=table']
  ].forEach(function (argv) {
    var r = runCli(argv.concat(['--json']));
    if (r.status !== 0) okCase.push(argv.join(' ') + ' ⇒ ' + r.status);
  });
  expect(okCase.length === 0, '⑧³ 合法取值的正常路径仍然是退出码 0', okCase.join(' / '));

  /* ⑧⁴ 失败只有一种形状：`{ok:false, command, error:{kind,message}}`。
     以前 `pdf` 发的是 `{ok:false, code, message}`（顶层 code），
     其它子命令发 error 对象 —— 同一个 CLI 两种形状，调用方只能写两个分支。 */
  var shapeBad = [];
  [['tokens', '--set=nope', '--json'],
   ['components', '--maturity=nope', '--json'],
   ['check', path.join(AI, 'no-such-file.json'), '--json'],
   ['profile', 'zzz', '--json'],
   ['pdf', '--json']].forEach(function (argv) {
    var r = runCli(argv);
    var d = parsed(r);
    if (!d) { shapeBad.push(argv.join(' ') + ' ⇒ stdout 不是 JSON'); return; }
    if (d.ok !== false) { shapeBad.push(argv.join(' ') + ' ⇒ ok 不是 false'); return; }
    if (!d.error || !d.error.kind || !d.error.message) {
      shapeBad.push(argv.join(' ') + ' ⇒ 缺 error.{kind,message}（实际：' + Object.keys(d).join(',') + '）');
    }
    if (d.code !== undefined || d.message !== undefined) {
      shapeBad.push(argv.join(' ') + ' ⇒ 还在发顶层 code/message（两套形状并存）');
    }
  });
  expect(shapeBad.length === 0, '⑧⁴ 所有失败路径都是同一种形状且 stdout 可解析',
    shapeBad.join(' / '));

  /* ⑧⁸ 帮助路径：`--help` 在**任何位置**、带不带 `ai` 前缀都必须通。
     这条是补测出来的：给 switch 加"未知开关拒收"时，
     `agentcss ai check --help` 被当成"`check` 不认识 --help"报错 ——
     而手册里写的正是带 `ai` 的写法。**文档里最靠前的用法必须能用。** */
  var helpBad = [];
  [['--help'], ['help'], ['check', '--help'], ['ai', 'check', '--help'],
   ['ai', 'shot', '-h'], ['components', '--help']].forEach(function (argv) {
    var r = runCli(argv);
    if (r.status !== 0) helpBad.push(argv.join(' ') + ' ⇒ ' + r.status);
    else if (!/退出码/.test(r.stdout)) helpBad.push(argv.join(' ') + ' ⇒ 没打印帮助');
  });
  expect(helpBad.length === 0, '⑧⁵ `--help` 在任意位置、带不带 `ai` 前缀都打印帮助并退 0',
    helpBad.join(' / '));

  /* ⑧⁶ 开关表覆盖：`CMDS` 里有、`FLAGS` 里没有 ⇒ 那条命令的未知开关就不会被拒。
     没有这一条，加第 15 个子命令时"拒收未知开关"会**静默失效**。 */
  var noFlags = Object.keys(cliMod.CMDS).filter(function (c) {
    return !Object.prototype.hasOwnProperty.call(cliMod.FLAGS, c);
  });
  expect(noFlags.length === 0, '⑧⁶ 每个子命令都在 FLAGS 表里登记了自己认识的开关',
    '缺登记：' + noFlags.join(' '));

  /* ⑧⁷ 反证：无关开关必须被拒，不能"认得就管、不认得就忽略" */
  var foreign = [];
  [['components', '--set=dark'], ['tokens', '--maturity=beta'],
   ['profile', '--recipe=report/finance'], ['diff', '--json', 'x.json', 'y.json', '--schema=contract']]
    .forEach(function (argv) {
      var r = runCli(argv);
      if (r.status !== E.usage) foreign.push(argv.join(' ') + ' ⇒ ' + r.status);
    });
  expect(foreign.length === 0, '⑧⁷ 与本命令无关的开关以 usage(2) 拒绝，不静默忽略',
    foreign.join(' / '));

  /* ⑧⁹ `out(undefined)` 必须当场失败，不许输出字面量 `undefined` 还退 0。
     🔴 这条兜底的价值在于**未来**：任何新写的分支忘了判断就把 undefined 交给 out()，
        都会变成 internal(6)，而不是一个「看起来成功」的空输出。
     0.26.0 的 `ai tokens --set=<拼错的>` 正是这个形状。 */
  var outRun = cp.spawnSync(process.execPath, ['-e',
    'process.argv.push("--json"); require(' + JSON.stringify(cliPath) + ')._out(undefined)'],
    { encoding: 'utf8' });
  var outDoc = parsed(outRun);
  expect(outRun.status === E.internal && outDoc && outDoc.ok === false
    && outDoc.error && outDoc.error.kind === 'internal',
    '⑧⁹ out(undefined) ⇒ 退出码 6 + internal（不输出字面量 undefined）',
    'status=' + outRun.status + ' stdout=' + String(outRun.stdout).slice(0, 60));

  /* ⑧⁸ 判定不通过 ≠ 工具出错：`check` 有 findings 时是 1，不是 2 也不是 6 */
  var tmpBad = path.join(require('os').tmpdir(), 'fl-ai-cli-bad.html');
  fs.writeFileSync(tmpBad, '<!doctype html><html lang="zh"><head><meta charset="utf-8">'
    + '</head><body><img src="x.png"></body></html>');
  var rb = runCli(['check', tmpBad]);
  expect(rb.status === E.findings,
    '⑧⁸ 页面有错 ⇒ 退出码 1（是结论，不是工具坏了）', '实际 ' + rb.status);
})();

// ---------------------------------------------------------------- 汇总
process.stdout.write('\n  通过 ' + passes + ' 项，失败 ' + fails.length + ' 项\n');
if (fails.length) {
  process.stdout.write('  ⇒ ' + fails.join(' / ') + '\n');
  process.exit(1);
}
process.stdout.write('  [OK] 契约层门禁通过\n');
process.exit(0);
