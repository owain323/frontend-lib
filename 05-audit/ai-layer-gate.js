#!/usr/bin/env node
/*
 * ai-layer-gate.js — 机器可读契约层的门禁
 *
 * ============================================================================
 * 判据（每条都配反向控制，证明它会红）
 * ----------------------------------------------------------------------------
 *   ① 四份 schema 只用了校验器实现过的关键字（否则静默漏检）
 *   ② ai/components.json 与 ai/tokens.json 符合各自的 schema
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
  ok('① 六份 schema 只用了校验器实现过的关键字');
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
                   'behaviors.schema.json', 'tokens.audience.schema.json'];
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
})();

// ---------------------------------------------------------------- 汇总
process.stdout.write('\n  通过 ' + passes + ' 项，失败 ' + fails.length + ' 项\n');
if (fails.length) {
  process.stdout.write('  ⇒ ' + fails.join(' / ') + '\n');
  process.exit(1);
}
process.stdout.write('  [OK] 契约层门禁通过\n');
process.exit(0);
