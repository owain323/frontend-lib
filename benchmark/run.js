#!/usr/bin/env node
/*
 * run.js — 兼容性 Benchmark 的跑批器
 *
 * ============================================================================
 * 🔴 它存在的理由
 * ----------------------------------------------------------------------------
 * "什么时候该放宽约束" 这个问题，不跑数就只能靠争论。
 * 有了它，三种结论对应三个明确动作（见 README.md §五）。
 *
 * ⚠️ 诚实说明：**当前没有任何模型跑批数据** —— benchmark/models/ 是空的。
 *    本脚本能跑、且每次都能跑的，是**参考解法的确定性断言**：
 *    它证明的是"契约层本身没坏"，不是"某个模型有多好"。
 *    两者不能混为一谈，也**不许**用前者冒充后者。
 *
 * ============================================================================
 * 用法
 * ----------------------------------------------------------------------------
 *   node benchmark/run.js                  跑参考解法断言
 *   node benchmark/run.js --json           输出 JSON
 *   node benchmark/run.js --record <名字>  同时记录某模型的跑批
 * ============================================================================
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.dirname(__dirname);
var AI = path.join(ROOT, 'ai');
var BM = __dirname;

var validate = require(path.join(AI, 'validate.js'));
var patch = require(path.join(AI, 'patch.js'));
var comps = JSON.parse(fs.readFileSync(path.join(AI, 'components.json'), 'utf8')).components;

var stable = comps.filter(function (c) { return c.maturity === 'stable'; });
var beta = comps.filter(function (c) { return c.maturity === 'beta'; });
var s0 = stable[0].id;

/* ⚠️ 合成夹具：一个 beta + 一个 stable。
 *
 * 为什么必须有它：T08/T09 要测的是「beta 能不能被 strict 拒」这条**规则**。
 * 而真实组件表里的 beta 数量是会变的 —— 状态收敛完成后是 **0 个**，
 * 于是旧版写了 `b0 = beta.length ? beta[0].id : s0`（退化成 stable）
 * ⇒ T09 变成"拿 stable 去期待 strict 拒绝它" ⇒ **必然失败**。
 *
 * 那不是"测出缺陷"，是**基准自己退化成了假红**。
 * ⇒ 规则必须**独立于数据**被验证 ⇒ 用夹具，不靠真实表里恰好有 beta。
 */
var FIXTURE = [
  { id: 'fx-stable', rootClass: 'fx-stable', maturity: 'stable',
    variants: [], slots: [], states: { enum: { 'data-state': ['open', 'closed'] } } },
  { id: 'fx-beta', rootClass: 'fx-beta', maturity: 'beta',
    variants: [], slots: [], states: { enum: { 'data-state': ['open', 'closed'] } } }
];
var FX_S = 'fx-stable';
var FX_B = 'fx-beta';
function fxopt(p) { return { profile: p, components: FIXTURE }; }

function doc(nodes, root, extra) {
  var d = {
    schemaVersion: '1.0.0', profile: 'standard',
    nodes: nodes, root: root
  };
  if (extra) Object.keys(extra).forEach(function (k) { d[k] = extra[k]; });
  return d;
}

// ---------------------------------------------------------------- 任务集
var TASKS = [
  {
    id: 'T01', intent: '改一处文本，别的都不许动',
    doc: doc({
      a: { id: 'a', kind: 'text', text: '原文' },
      b: { id: 'b', kind: 'text', text: '不要动我' }
    }, ['a', 'b']),
    patch: { ops: [{ op: 'update', id: 'a', set: { text: '改过了' } }] },
    expect: function (r, before) {
      if (!r.ok) return '参考解法没应用成功';
      if (r.doc.nodes.a.text !== '改过了') return 'a 没被改';
      if (r.doc.nodes.b.text !== '不要动我') return '🔴 b 被误改了（改一处动了别处）';
      return null;
    }
  },
  {
    id: 'T02', intent: '改一处字号，不许写页面级 override',
    doc: doc({
      h: { id: 'h', kind: 'text', text: '标题', props: { role: 'title' } }
    }, ['h']),
    patch: { ops: [{ op: 'update', id: 'h', set: { props: { role: 'title', size: 'lg' } } }] },
    expect: function (r) {
      if (!r.ok) return '参考解法没应用成功';
      var dump = JSON.stringify(r.doc);
      if (/\.(page|slide)-\d/.test(dump)) return '🔴 出现了页面级 override';
      return null;
    }
  },
  {
    id: 'T03', intent: '把一个节点挪到另一个容器，内容必须一个字节不变',
    doc: doc({
      a: { id: 'a', kind: 'text', text: 'A', children: ['x'] },
      x: { id: 'x', kind: 'text', text: '要挪的内容' },
      b: { id: 'b', kind: 'text', text: 'B' }
    }, ['a', 'b']),
    patch: { ops: [{ op: 'move', id: 'x', parent: 'b', index: 0 }] },
    expect: function (r) {
      if (!r.ok) return '参考解法没应用成功';
      if (r.doc.nodes.x.text !== '要挪的内容') return '🔴 移动时内容被改了';
      if (r.doc.nodes.b.children[0] !== 'x') return '没挂到新父节点';
      if ((r.doc.nodes.a.children || []).indexOf('x') >= 0) return '🔴 旧父引用没摘掉';
      return null;
    }
  },
  {
    id: 'T04', intent: '删除节点，父引用必须同步摘掉',
    doc: doc({
      w: { id: 'w', kind: 'text', text: 'W', children: ['t'] },
      t: { id: 't', kind: 'text', text: '删我' }
    }, ['w']),
    patch: { ops: [{ op: 'delete', id: 't' }] },
    expect: function (r) {
      if (!r.ok) return '参考解法没应用成功';
      if (r.doc.nodes.t !== undefined) return '节点没被删掉';
      if ((r.doc.nodes.w.children || []).indexOf('t') >= 0) return '🔴 悬空引用';
      var v = validate.validateDoc(r.doc, { profile: 'standard' });
      if (!v.ok) return '删除后文档非法：' + JSON.stringify(v.errors[0]);
      return null;
    }
  },
  {
    id: 'T05', intent: '换主题：套一组令牌，不许出现裸颜色',
    doc: doc({ c: { id: 'c', kind: s0, props: {} } }, ['c']),
    patch: { ops: [{ op: 'update', id: 'c', set: { props: { theme: 'dark' } } }] },
    expect: function (r) {
      if (!r.ok) return '参考解法没应用成功';
      var dump = JSON.stringify(r.doc);
      // 裸颜色 / 裸间距：任何 #xxx 或 \d+px 都算绕过令牌
      var bare = dump.match(/#[0-9a-fA-F]{3,8}\b|\b\d+px\b/g);
      if (bare) return '🔴 出现裸值：' + bare.slice(0, 3).join(', ') + '（应引用令牌）';
      return null;
    }
  },
  {
    id: 'T06', intent: '新增节点，必须挂到指定父节点',
    doc: doc({ w: { id: 'w', kind: 'text', text: 'W', children: [] } }, ['w']),
    patch: { ops: [{ op: 'create', node: { id: 'n', kind: 'text', text: '新' },
                     parent: 'w', index: 0 }] },
    expect: function (r) {
      if (!r.ok) return '参考解法没应用成功';
      if (r.doc.nodes.w.children[0] !== 'n') return '挂错位置或没挂上';
      return null;
    }
  },
  {
    id: 'T07', intent: '批量改 5 处文本，要么全成功要么一个都不动',
    doc: doc({
      t1: { id: 't1', kind: 'text', text: '1' },
      t2: { id: 't2', kind: 'text', text: '2' },
      t3: { id: 't3', kind: 'text', text: '3' },
      t4: { id: 't4', kind: 'text', text: '4' },
      t5: { id: 't5', kind: 'text', text: '5' }
    }, ['t1', 't2', 't3', 't4', 't5']),
    patch: { ops: [1, 2, 3, 4, 5].map(function (i) {
      return { op: 'update', id: 't' + i, set: { text: '改' + i } };
    }) },
    expect: function (r, before) {
      if (!r.ok) return '参考解法没应用成功';
      for (var i = 1; i <= 5; i++) {
        if (r.doc.nodes['t' + i].text !== '改' + i) {
          return '🔴 t' + i + ' 没改成 ⇒ 半改状态';
        }
      }
      return null;
    }
  },
  {
    id: 'T08', intent: '把 beta 组件换成 stable 组件（收殓到可依赖的集合）',
    doc: doc({ n: { id: 'n', kind: FX_B, props: {} } }, ['n']),
    patch: { ops: [{ op: 'replace', id: 'n', node: { id: 'n', kind: FX_S } }] },
    expect: function (r) {
      if (!r.ok) return '参考解法没应用成功';
      if (r.doc.nodes.n.kind !== FX_S) return '没换成 stable';
      var v = validate.validateDoc(r.doc, fxopt('strict'));
      if (!v.ok) return '换完仍然过不了 strict：' + JSON.stringify(v.errors[0]);
      return null;
    }
  },
  {
    id: 'T09', intent: 'strict 档下用 beta 组件 ⇒ **必须被拒**',
    doc: doc({ n: { id: 'n', kind: FX_B, props: {} } }, ['n']),
    patch: { ops: [] },
    expect: function (r) {
      var v = validate.validateDoc(r.doc, fxopt('strict'));
      if (v.ok) return '🔴 strict 档放行了 beta 组件 ⇒ 档位形同虚设';
      return null;
    }
  },
  {
    id: 'T10', intent: '携带未来的 extensions ⇒ 旧校验器必须忽略，不得判非法',
    doc: doc({ n: { id: 'n', kind: s0, extensions: { futureLayout: 'masonry' } } },
      ['n'], { extensions: { rendererV2: { hint: 'ignored' } } }),
    patch: { ops: [] },
    expect: function (r) {
      var v = validate.validateDoc(r.doc, { profile: 'creative' });
      if (!v.ok) return '🔴 旧校验器拒绝了未知 extension ⇒ 前向兼容失效：' +
        JSON.stringify(v.errors[0]);
      return null;
    }
  }
];

// ---------------------------------------------------------------- 跑批
function runDeterministic() {
  var rows = [];
  TASKS.forEach(function (t) {
    var before = JSON.stringify(t.doc);
    var r = patch.apply(t.doc, t.patch);
    var msg = t.expect(r, before);
    var det = patch.isDeterministic(t.doc, t.patch);
    rows.push({
      task: t.id, intent: t.intent,
      pass: msg === null && det,
      detail: msg || (det ? '' : '🔴 不可回放（同输入两次结果不同）')
    });
  });
  return rows;
}

function runRecorded(name) {
  var f = path.join(BM, 'models', name + '.json');
  if (!fs.existsSync(f)) return null;
  var rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  var rows = [];
  (rec.runs || []).forEach(function (run) {
    var t = TASKS.filter(function (x) { return x.id === run.task; })[0];
    if (!t) { rows.push({ task: run.task, pass: false, detail: '未知任务' }); return; }
    var r = patch.apply(t.doc, run.patch);
    var msg = t.expect(r, JSON.stringify(t.doc));
    rows.push({ task: t.id, pass: msg === null, detail: msg || '' });
  });
  return { model: rec.model, capabilities: rec.declaredCapabilities, rows: rows };
}

function main() {
  var rows = runDeterministic();
  var failed = rows.filter(function (r) { return !r.pass; });
  var json = process.argv.indexOf('--json') >= 0;
  var recIdx = process.argv.indexOf('--record');
  var rec = recIdx >= 0 ? runRecorded(process.argv[recIdx + 1]) : null;

  if (json) {
    process.stdout.write(JSON.stringify({
      tasks: rows.length, passed: rows.length - failed.length,
      failed: failed.length, rows: rows, recorded: rec
    }, null, 2) + '\n');
    process.exit(failed.length ? 1 : 0);
  }

  process.stdout.write('  === 兼容性 Benchmark（参考解法 / 确定性）===\n\n');
  rows.forEach(function (r) {
    process.stdout.write('  ' + (r.pass ? '✅' : '❌') + ' ' + r.task + '  ' + r.intent + '\n');
    if (!r.pass) process.stdout.write('       ' + r.detail + '\n');
  });
  process.stdout.write('\n  通过 ' + (rows.length - failed.length) + ' / ' + rows.length + '\n');

  if (recIdx >= 0) {
    if (!rec) {
      process.stdout.write('\n  [WARN] benchmark/models/' + process.argv[recIdx + 1] +
        '.json 不存在 ⇒ **没有记录任何跑批**\n');
    } else {
      var rf = rec.rows.filter(function (r) { return !r.pass; });
      process.stdout.write('\n  === 跑批记录：' + rec.model + ' ===\n');
      rec.rows.forEach(function (r) {
        process.stdout.write('  ' + (r.pass ? '✅' : '❌') + ' ' + r.task +
          (r.pass ? '' : '  ' + r.detail) + '\n');
      });
      process.stdout.write('  通过率 ' + (rec.rows.length - rf.length) + '/' +
        rec.rows.length + '\n');
      process.stdout.write('  ⚠️ 单次结果只是抽样；判断约束该不该放宽要看 ≥20 次的分布\n');
      var outDir = path.join(BM, 'results');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
      fs.writeFileSync(path.join(outDir, process.argv[recIdx + 1] + '.json'),
        JSON.stringify(rec, null, 2) + '\n');
    }
  } else {
    process.stdout.write('\n  ℹ️ 当前**没有任何模型跑批数据**（benchmark/models/ 为空）。\n' +
      '     上面这批只证明契约层本身没坏，不代表任何模型的表现。\n');
  }

  process.exit(failed.length ? 1 : 0);
}

if (require.main === module) main();
module.exports = { TASKS: TASKS, runDeterministic: runDeterministic };
