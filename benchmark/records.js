#!/usr/bin/env node
/*
 * records.js — 模型跑批记录的**校验与统计**（W13）
 *
 * ============================================================================
 * 🔴 它修的是什么
 * ----------------------------------------------------------------------------
 * 旧版 `run.js --record <名字>`：文件不存在 ⇒ 打印一行 `[WARN]` ⇒ **退出码 0**。
 *
 *     $ node benchmark/run.js --record gpt-x
 *     [WARN] benchmark/models/gpt-x.json 不存在 ⇒ **没有记录任何跑批**
 *     $ echo $?
 *     0
 *
 * ⇒ CI 绿、`npm run gate` 绿，而"gpt-x 跑过批"这句话**一个字都没被验证**。
 *   这正是本项目 `INVARIANT.md` I-10 反复登记的那类假绿：
 *   **报告里出现了"跑批"，但没有任何判据要求它存在。**
 *
 * 旧版还有两个同源问题：
 *   · `rec.runs || []` ⇒ 空记录跑出"通过率 0/0"，仍然 RC=0
 *   · 记录的 `runs` 是**扁平**的，一个任务只有一条 ⇒ 无法表达 README 自己
 *     要求的"同一任务 ≥ 20 次"、也就给不出分布 —— **工具做不到它文档里说的事**
 *
 * ============================================================================
 * 记录格式 v2（有 schemaVersion，缺字段一律判不合法）
 * ----------------------------------------------------------------------------
 *   {
 *     "schemaVersion": "2.0.0",
 *     "model": "模型名",
 *     "modelVersion": "2026-01",          // 可复现的最小标识
 *     "recordedAt": "2000-01-01",
 *     "settings": { "temperature": 0.2, "structuredOutput": true },
 *     "declaredCapabilities": { "toolCalling": true, ... },
 *     "attemptsPerTask": 20,
 *     "runs": [ { "task": "T01", "attempt": 1, "patch": { "ops": [...] } }, ... ]
 *   }
 *
 * ============================================================================
 * 判据（八条）
 * ----------------------------------------------------------------------------
 *   ① schemaVersion 必须在受支持列表里（未知版本 ⇒ 红，不猜）
 *   ② model / modelVersion / recordedAt 必须是非空字符串
 *      —— 没有版本号的记录**不可复现**，等于没有记录
 *   ③ runs 非空（零条 ⇒ UNVERIFIED ⇒ 红，不是"通过"）
 *   ④ attemptsPerTask ≥ 1 且每个任务恰好这么多条
 *   ⑤ (task, attempt) 唯一，且 attempt 覆盖 1..N 不重不漏
 *   ⑥ task 必须是任务集里真实存在的 id（拼错 ⇒ 红，不静默跳过）
 *   ⑦ patch 必须是对象且 `ops` 是数组（否则"通过了"无从谈起）
 *   ⑧ 输出**分布**（每个任务几次通过 / 共几次），不是单次结果
 * ============================================================================
 */
'use strict';

var SUPPORTED = ['2.0.0'];

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function nonEmpty(v) { return typeof v === 'string' && v.trim() !== ''; }

/**
 * 校验一份跑批记录。
 * @param {object} rec  记录
 * @param {string[]} taskIds  任务集里真实存在的 id
 * @returns {{ok: boolean, problems: string[]}}
 */
function validateRecord(rec, taskIds) {
  var p = [];
  if (!isObj(rec)) {
    return { ok: false, problems: ['记录不是对象'] };
  }
  // ① 版本
  if (!nonEmpty(rec.schemaVersion)) {
    p.push('① 缺 `schemaVersion` —— 旧格式（v1）没有可复现元数据，' +
      '请按 README §四 的 v2 格式重录（不是"兼容旧格式"，是旧格式信息不够）');
  } else if (SUPPORTED.indexOf(rec.schemaVersion) < 0) {
    p.push('① `schemaVersion` = `' + rec.schemaVersion +
      '`，本校验器只认 ' + SUPPORTED.join(' / ') + ' —— 不猜未知版本的含义');
  }
  // ② 可复现元数据
  ['model', 'modelVersion', 'recordedAt'].forEach(function (k) {
    if (!nonEmpty(rec[k])) {
      p.push('② `' + k + '` 缺失或为空 —— 没有它的记录无法复现，' +
        '也就无法与别的记录比较');
    }
  });
  // ③ 零记录
  var runs = rec.runs;
  if (!Array.isArray(runs) || runs.length === 0) {
    p.push('③ `runs` 为空 —— 这是 **UNVERIFIED**，不是"通过"。' +
      '零条记录跑出来的任何"通过率"都是无意义的');
    return { ok: false, problems: p };
  }
  // ④ 次数
  var n = rec.attemptsPerTask;
  if (typeof n !== 'number' || !isFinite(n) || n < 1 || n !== Math.floor(n)) {
    p.push('④ `attemptsPerTask` 必须是 ≥1 的整数（当前：' +
      JSON.stringify(n) + '）');
    return { ok: false, problems: p };
  }
  // ⑥⑦ 逐条
  var byTask = {};
  runs.forEach(function (r, i) {
    var at = 'runs[' + i + ']';
    if (!isObj(r)) { p.push('⑥ ' + at + ' 不是对象'); return; }
    if (taskIds.indexOf(r.task) < 0) {
      p.push('⑥ ' + at + ' 的 task = `' + r.task + '` 不在任务集里（拼错就会被静默跳过）');
      return;
    }
    if (!isObj(r.patch) || !Array.isArray(r.patch.ops)) {
      p.push('⑦ ' + at + ' 的 `patch.ops` 不是数组 —— 没有待应用的补丁，' +
        '"通过了"无从谈起');
      return;
    }
    byTask[r.task] = byTask[r.task] || [];
    byTask[r.task].push(r.attempt);
  });
  // ④⑤ 每个任务的次数与编号
  taskIds.forEach(function (id) {
    var got = byTask[id] || [];
    if (got.length === 0) {
      p.push('④ 任务 `' + id + '` 一条记录都没有（`attemptsPerTask` 声明了 ' +
        n + ' 次）—— 缺任务的"总体通过率"是**算不出来的**，不许拿部分冒充全体');
      return;
    }
    if (got.length !== n) {
      p.push('④ 任务 `' + id + '` 记了 ' + got.length + ' 次，' +
        '`attemptsPerTask` 是 ' + n + ' 次');
    }
    var seen = {};
    got.forEach(function (a) {
      if (typeof a !== 'number' || a !== Math.floor(a) || a < 1 || a > n) {
        p.push('⑤ 任务 `' + id + '` 的 attempt = ' + JSON.stringify(a) +
          '，应在 1..' + n + ' 内');
        return;
      }
      if (seen[a]) { p.push('⑤ 任务 `' + id + '` 的 attempt ' + a + ' 重复'); }
      seen[a] = true;
    });
    for (var k = 1; k <= n; k++) {
      if (!seen[k]) {
        p.push('⑤ 任务 `' + id + '` 缺 attempt ' + k + '（编号必须 1..' + n + ' 不重不漏）');
      }
    }
  });
  return { ok: p.length === 0, problems: p };
}

/**
 * 逐任务统计通过次数 ⇒ 分布。
 * @param {object} rec        已通过校验的记录
 * @param {Array}  tasks      benchmark 任务集（需要 id + expect）
 * @param {object} patch      ai/patch.js
 * @param {object} validate   ai/validate.js（传给 expect 的上下文由任务自取）
 */
function summarize(rec, tasks, patch) {
  var byTask = {};
  rec.runs.forEach(function (r) {
    var t = tasks.filter(function (x) { return x.id === r.task; })[0];
    byTask[r.task] = byTask[r.task] || { id: r.task, intent: t.intent, runs: [] };
    // 🔴 模型的补丁是**外部输入**，`patch.apply` 与 `expect` 都可能抛
    //    （实测：空 ops 让 T03 的 expect 读 `nodes.b.children` 时抛 TypeError）。
    //    抛异常必须计为"这次没过"，不能让整份跑批崩掉 ——
    //    否则一个坏样本就能让 benchmark **跑不完**，
    //    而"跑不完"在报告里最容易被写成"跳过"。
    var msg;
    try {
      var res = patch.apply(t.doc, r.patch);
      msg = t.expect(res, JSON.stringify(t.doc));
    } catch (e) {
      msg = '执行异常：' + (e && e.message ? e.message : String(e));
    }
    byTask[r.task].runs.push({ attempt: r.attempt, pass: msg === null, detail: msg || '' });
  });
  return Object.keys(byTask).sort().map(function (id) {
    var b = byTask[id];
    var ok = b.runs.filter(function (x) { return x.pass; }).length;
    return {
      task: id, intent: b.intent,
      passed: ok, total: b.runs.length,
      rate: b.runs.length ? ok / b.runs.length : 0,
      failures: b.runs.filter(function (x) { return !x.pass; })
    };
  });
}

function pct(x) { return (x * 100).toFixed(0) + '%'; }

// ---------------------------------------------------------------- 反向控制
function selftest() {
  var ok = true;
  var TASKS = [
    { id: 'T01', intent: 'a' }, { id: 'T02', intent: 'b' }
  ];
  var ids = ['T01', 'T02'];
  var PATCH = { ops: [{ op: 'update', id: 'a', set: { text: 'x' } }] };

  function good() {
    var runs = [];
    ids.forEach(function (id) {
      for (var i = 1; i <= 3; i++) {
        runs.push({ task: id, attempt: i, patch: JSON.parse(JSON.stringify(PATCH)) });
      }
    });
    return {
      schemaVersion: '2.0.0', model: 'm', modelVersion: 'v1',
      recordedAt: '2000-01-01', attemptsPerTask: 3, runs: runs
    };
  }

  function run(why, rec, shouldFail, needle) {
    var r = validateRecord(rec, ids);
    var got = !r.ok;
    var hit = needle ? r.problems.some(function (p) { return p.indexOf(needle) >= 0; }) : got;
    var good_ = got === shouldFail && hit === shouldFail;
    if (!good_) {
      console.log('       ↳ 实际：' + (r.problems[0] || '(无)'));
    }
    console.log('  [' + (good_ ? 'OK ' : 'FAIL') + '] ' + why +
      '  期望' + (shouldFail ? '红' : '绿') + ' ⇒ 实际' + (got ? '红' : '绿'));
    if (!good_) ok = false;
  }

  run('完整合法记录', good(), false);

  var noRuns = good(); noRuns.runs = [];
  run('零条记录 ⇒ UNVERIFIED 必须红', noRuns, true, '③');

  var noVer = good(); delete noVer.modelVersion;
  run('缺 modelVersion（不可复现）', noVer, true, '②');

  var badVer = good(); badVer.schemaVersion = '3.0.0';
  run('未知 schemaVersion', badVer, true, '①');

  var typo = good(); typo.runs[0].task = 'T99';
  run('task id 拼错', typo, true, '⑥');

  var missing = good(); missing.runs = missing.runs.filter(function (r) {
    return !(r.task === 'T02');
  });
  run('整条任务缺失', missing, true, '④');

  var short = good(); short.runs.pop();
  run('某任务少一次', short, true, '④');

  var dup = good(); dup.runs[1].attempt = 1;
  run('attempt 重复', dup, true, '⑤');

  var noOps = good(); delete noOps.runs[0].patch.ops;
  run('patch 没有 ops', noOps, true, '⑦');

  var notObj = 'nope';
  run('记录不是对象', notObj, true);

  console.log('');
  console.log('  ' + (ok ? '反向控制全部通过 ⇒ 八条判据都有牙'
    : '🔴 有反向控制未通过'));
  return ok ? 0 : 1;
}

module.exports = {
  SUPPORTED: SUPPORTED,
  validateRecord: validateRecord,
  summarize: summarize,
  selftest: selftest,
  pct: pct
};

if (require.main === module) {
  process.exit(selftest());
}
