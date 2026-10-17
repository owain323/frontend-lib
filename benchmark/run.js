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
var records = require(path.join(BM, 'records.js'));
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
    var msg;
    // 参考解法是内部夹具，但**夹具写坏了也必须判红、不能崩** ——
    // 崩溃会被读成"环境问题"，红才是"这里有缺陷"。
    try {
      var r = patch.apply(t.doc, t.patch);
      msg = t.expect(r, before);
    } catch (e) {
      msg = '执行异常（夹具）：' + (e && e.message ? e.message : String(e));
    }
    var det = patch.isDeterministic(t.doc, t.patch);
    rows.push({
      task: t.id, intent: t.intent,
      pass: msg === null && det,
      detail: msg || (det ? '' : '🔴 不可回放（同输入两次结果不同）')
    });
  });
  return rows;
}

/* ---------------------------------------------------------------------------
 * 🔴 跑批记录：校验 + 分布
 *
 * 旧版这里只做"能读就读、读不到就 WARN 然后 RC=0"。
 * 那个行为本身就是假绿 —— 见 benchmark/records.js 文件头的实证。
 * ⇒ 现在三条硬边界：
 *   · 文件不存在        ⇒ RC=2（不是"没有记录"，是**你说的那个记录不存在**）
 *   · 记录不合 schema   ⇒ RC=2，逐条打印问题
 *   · 记录合法          ⇒ 打**分布**（每任务 通过次数/总次数），不是单次结果
 * ------------------------------------------------------------------------ */
function recordAndReport(name) {
  var f = path.join(BM, 'models', name + '.json');
  if (!fs.existsSync(f)) {
    process.stdout.write('\n  [FAIL] `benchmark/models/' + name + '.json` 不存在。\n' +
      '         ⇒ 这是 **UNVERIFIED**：没有任何跑批数据，不能算通过。\n' +
      '         旧版在这里只打一行 WARN 就 RC=0 —— 那等于"声称跑了，其实没跑"。\n');
    return 2;
  }
  var rec;
  try {
    rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    process.stdout.write('\n  [FAIL] `' + name + '.json` 不是合法 JSON：' + e.message + '\n');
    return 2;
  }
  var ids = TASKS.map(function (t) { return t.id; });
  var v = records.validateRecord(rec, ids);
  if (!v.ok) {
    process.stdout.write('\n  [FAIL] 记录不合法（' + v.problems.length + ' 处）：\n');
    v.problems.forEach(function (p) { process.stdout.write('         · ' + p + '\n'); });
    return 2;
  }
  var dist = records.summarize(rec, TASKS, patch);
  process.stdout.write('\n  === 跑批分布：' + rec.model + ' ' + rec.modelVersion +
    '（' + rec.recordedAt + '，每任务 ' + rec.attemptsPerTask + ' 次）===\n');
  var allPass = 0, allTotal = 0;
  dist.forEach(function (d) {
    allPass += d.passed; allTotal += d.total;
    process.stdout.write('  ' + (d.rate === 1 ? '✅' : (d.rate >= 0.7 ? '⚠️ ' : '❌')) +
      ' ' + d.task + '  ' + d.passed + '/' + d.total +
      '  (' + records.pct(d.rate) + ')  ' + d.intent + '\n');
    if (d.failures.length && d.rate > 0) {
      process.stdout.write('       首次失败（attempt ' + d.failures[0].attempt + '）：' +
        d.failures[0].detail + '\n');
    }
  });
  var rate = allTotal ? allPass / allTotal : 0;
  process.stdout.write('  总体 ' + allPass + '/' + allTotal + ' (' +
    records.pct(rate) + ')\n');
  var allFail = dist.filter(function (d) { return d.passed === 0; });
  if (allFail.length) {
    process.stdout.write('  🔴 有 ' + allFail.length + ' 个任务**一次都没过**（' +
      allFail.map(function (d) { return d.task; }).join(', ') + '）\n' +
      '     ⇒ 先怀疑判据/任务本身，不要先怀疑模型（README §五 最后一条）。\n');
  }
  if (rate >= 0.95) {
    process.stdout.write('  ⇒ ≥95%：约束没挡住正确编辑，可考虑放宽（README §五）\n');
  } else if (rate < 0.7) {
    process.stdout.write('  ⇒ <70%：约束在挡路，查是哪一条，降级或改判据\n');
  }

  var outDir = path.join(BM, 'results');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, name + '.json'), JSON.stringify({
    model: rec.model, modelVersion: rec.modelVersion, recordedAt: rec.recordedAt,
    attemptsPerTask: rec.attemptsPerTask, overall: rate, tasks: dist
  }, null, 2) + '\n');
  return 0;
}

/* 逐个校验 models/ 下的全部记录（不重跑，只查形状与完整性）。
 * 🔴 判据：坏记录 ⇒ RC=1；**零记录 ⇒ RC=0 但输出写明 UNVERIFIED**。
 *    零记录不算失败（当前就是零），但也**不许**被读成"模型已验证"。 */
function checkRecords() {
  var dir = path.join(BM, 'models');
  var files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).sort()
    : [];
  var ids = TASKS.map(function (t) { return t.id; });
  if (!files.length) {
    process.stdout.write('  [UNVERIFIED] `benchmark/models/` 里 0 个模型记录。\n' +
      '        ⇒ 本项只说明"没有坏记录"，**不说明任何模型已验证**。\n' +
      '        ⇒ 要做真模型实测，按 README §四 建记录文件并 `--record`。\n');
    return 0;
  }
  var bad = 0;
  files.forEach(function (f) {
    var name = f.replace(/\.json$/, '');
    var rec;
    try {
      rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      process.stdout.write('  [FAIL] ' + f + '：不是合法 JSON（' + e.message + '）\n');
      bad++;
      return;
    }
    var v = records.validateRecord(rec, ids);
    if (!v.ok) {
      process.stdout.write('  [FAIL] ' + f + '：' + v.problems.length + ' 处不合法\n');
      v.problems.slice(0, 3).forEach(function (p) {
        process.stdout.write('         · ' + p + '\n');
      });
      bad++;
      return;
    }
    /* 🔴 参考解法记录额外两条（它验证的是**"记录 → 评分"这条管线**）：
     *    ① 记录里的补丁必须与当前 TASKS 的参考补丁逐字节一致
     *       —— 否则 TASKS 改了而记录没重生成，这份记录在验证**旧的**任务
     *    ② 评分必须 10/10
     *       —— 参考解法自己拿不到满分，说明管线（apply / expect / 统计）坏了，
     *          那么任何模型的分数都不可信
     */
    if (name === 'reference') {
      var stale = 0;
      rec.runs.forEach(function (r) {
        var t = TASKS.filter(function (x) { return x.id === r.task; })[0];
        if (JSON.stringify(r.patch) !== JSON.stringify(t.patch)) stale++;
      });
      if (stale) {
        process.stdout.write('  [FAIL] reference.json：' + stale +
          ' 条补丁与当前 TASKS 不一致 —— TASKS 改了，跑 ' +
          '`node benchmark/run.js --write-reference` 重新生成\n');
        bad++;
        return;
      }
      var dist = records.summarize(rec, TASKS, patch);
      var okN = dist.filter(function (d) { return d.passed === d.total; }).length;
      if (okN !== dist.length) {
        process.stdout.write('  [FAIL] reference.json：参考解法只拿到 ' + okN +
          '/' + dist.length + ' 个满分任务 ⇒ "记录→评分"管线本身有问题，' +
          '任何模型分数都不可信\n');
        bad++;
        return;
      }
      process.stdout.write('  [OK] reference.json：' + dist.length +
        ' 个任务全部满分（记录→评分管线自洽）\n');
      return;
    }
    process.stdout.write('  [OK] ' + f + '：' + rec.model + ' ' +
      rec.modelVersion + '，' + rec.runs.length + ' 条记录\n');
  });
  if (bad) {
    process.stdout.write('  ⇒ ' + bad + ' / ' + files.length + ' 份记录不合法\n');
    return 1;
  }
  process.stdout.write('  [OK] ' + files.length + ' 份模型记录形状合法\n');
  return 0;
}

/* 从 TASKS 生成「参考解法」记录 —— 用来把"记录 → 评分"这条管线纳入门禁。
 * ⚠️ 它**不是**模型成绩：model 字段明写"参考解法（不是模型）"，
 *    任何把它当模型跑分的引用都是误用。 */
function writeReference() {
  var runs = [];
  TASKS.forEach(function (t) {
    for (var i = 1; i <= 3; i++) {
      runs.push({ task: t.id, attempt: i, patch: JSON.parse(JSON.stringify(t.patch)) });
    }
  });
  var dir = path.join(BM, 'models');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'reference.json'), JSON.stringify({
    schemaVersion: '2.0.0',
    model: '参考解法（不是模型）',
    modelVersion: 'benchmark/run.js 内联夹具',
    recordedAt: '1970-01-01',
    attemptsPerTask: 3,
    _note: '由 --write-reference 从 TASKS 生成。TASKS 的参考补丁一变就重跑；' +
      '--check-records 会比对补丁并要求和为满分。' +
      'recordedAt 固定为 1970-01-01：本文件不承载时间信息（重生成必须是**逐字节**' +
      '相同的，否则每次生成都产生假 diff）。',
    runs: runs
  }, null, 2) + '\n');
  process.stdout.write('  ✓ 已生成 benchmark/models/reference.json（' +
    runs.length + ' 条）\n');
}

function main() {
  var json = process.argv.indexOf('--json') >= 0;
  var recIdx = process.argv.indexOf('--record');

  // 记录形状校验（门禁用）；不重跑批
  if (process.argv.indexOf('--write-reference') >= 0) {
    writeReference();
    process.exit(0);
  }
  if (process.argv.indexOf('--check-records') >= 0) {
    process.exit(checkRecords());
  }
  // 反向控制（证明校验器有牙）
  if (process.argv.indexOf('--selftest') >= 0) {
    process.exit(records.selftest());
  }
  // 记录某个模型的跑批 ⇒ 只输出分布，不做"确定性断言"那份报告
  if (recIdx >= 0) {
    var name = process.argv[recIdx + 1];
    if (!name || name.slice(0, 2) === '--') {
      process.stdout.write('  [FAIL] `--record` 后面要跟模型名\n');
      process.exit(2);
    }
    process.exit(recordAndReport(name));
  }

  var rows = runDeterministic();
  var failed = rows.filter(function (r) { return !r.pass; });

  if (json) {
    process.stdout.write(JSON.stringify({
      tasks: rows.length, passed: rows.length - failed.length,
      failed: failed.length, rows: rows
    }, null, 2) + '\n');
    process.exit(failed.length ? 1 : 0);
  }

  process.stdout.write('  === 兼容性 Benchmark（参考解法 / 确定性）===\n\n');
  rows.forEach(function (r) {
    process.stdout.write('  ' + (r.pass ? '✅' : '❌') + ' ' + r.task + '  ' + r.intent + '\n');
    if (!r.pass) process.stdout.write('       ' + r.detail + '\n');
  });
  process.stdout.write('\n  通过 ' + (rows.length - failed.length) + ' / ' + rows.length + '\n');

  var modelDir = path.join(BM, 'models');
  var modelCount = fs.existsSync(modelDir)
    ? fs.readdirSync(modelDir).filter(function (f) { return /\.json$/.test(f); }).length
    : 0;
  if (modelCount === 0) {
    process.stdout.write('\n  ℹ️ 当前**没有任何模型跑批数据**（benchmark/models/ 为空）。\n' +
      '     上面这批只证明契约层本身没坏，不代表任何模型的表现。\n' +
      '     `--check-records` 在这里会输出 UNVERIFIED（不是 PASS）。\n');
  } else {
    process.stdout.write('\n  ℹ️ models/ 里有 ' + modelCount + ' 份记录；' +
      '逐份校验跑 `--check-records`。\n');
  }

  process.exit(failed.length ? 1 : 0);
}

if (require.main === module) main();
module.exports = { TASKS: TASKS, runDeterministic: runDeterministic };
