/**
 * unit.test.mjs — 纯函数单元测试（ H5）
 * ============================================================================
 * 🔴 为什么需要它（解一个死结）
 * ---------------------------------------------------------------------------
 *   33 个契约每次全量跑要 **3 分钟**（要起浏览器）。
 *   ⇒ **慢的门禁会被跳过** ⇒ 慢 = 等于没有门禁。
 *
 *   ⭐ 解法：把**纯函数**（不碰 DOM）抽出来做单测 —— **毫秒级**，
 *     可以在每次改代码后立刻跑几百遍。
 *     契约负责"浏览器里的行为"，单测负责"算法的边界"。
 *
 *   两者互补：契约抓不到 `addMonths('2026-01-31', 1)` 到底是几号。
 *
 * ============================================================================
 * ⭐ 怎么在 node 里加载组件脚本
 * ---------------------------------------------------------------------------
 *   组件是 IIFE `(function(global){ ... })(window)`，直接 require 会在
 *   `window is not defined` 处崩。
 *   ⇒ 正解：先给 global 造一个最小的 `window`，再 `vm.runInNewContext`。
 *   ⚠️ 这比"起浏览器"快 4 个数量级，正是本的意义。
 * ============================================================================
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 在沙箱里跑一个组件脚本，返回它挂到 window 上的 API */
function loadComponent(relPath) {
  const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.console = console;
  /* 组件可能摸到这些全局（即使只是 typeof 判断）*/
  sandbox.document = undefined;
  sandbox.navigator = { userAgent: 'node' };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: relPath });
  return sandbox;
}

/* ============================================================================
 * date-range 的日期算法
 * ========================================================================== */
const DR = loadComponent('02-primitives/date-range/date-range.js');
const DRAPI = DR.DateRange;

/* 🔴 关键辅助：把 **vm 沙箱**里造出来的对象转成主 realm 的普通对象。
 * 原因：`vm.createContext` 会给沙箱一套**独立的 Object.prototype**，
 *      所以 `assert.deepEqual`（严格版）判它们"不相等"，
 *      即使字段一模一样 —— 我第一版就踩了这个坑（2 个假红）。
 * ⇒ 对付手段：`JSON.parse(JSON.stringify(x))` 或 `{...x}`。 */
const plain = (x) => (x === null || typeof x !== 'object' ? x : JSON.parse(JSON.stringify(x)));

test('date-range 暴露了 4 个纯函数', () => {
  for (const fn of ['iso', 'addDays', 'addMonths', 'quarterOf', 'quarterRange']) {
    assert.equal(typeof DRAPI[fn], 'function', '缺少 ' + fn);
  }
});

test('iso(): Date → YYYY-MM-DD（本地时区，不用 toISOString）', () => {
  assert.equal(DRAPI.iso(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(DRAPI.iso(new Date(2026, 11, 31)), '2026-12-31');
  /* 🔴 陷阱：跨时区时 toISOString() 会偏移一天，本函数必须不用它 */
  const d = new Date(2026, 0, 1, 0, 30);   // 本地时间 1/1 凌晨
  assert.equal(DRAPI.iso(d), '2026-01-01');
});

test('addDays(): 跨月/跨年/闰年', () => {
  assert.equal(DRAPI.addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(DRAPI.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(DRAPI.addDays('2026-01-01', -1), '2025-12-31');
  /* 2028 是闰年（能被 4 整除且不被 100 整除）*/
  assert.equal(DRAPI.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(DRAPI.addDays('2026-02-28', 1), '2026-03-01');   // 平年
});

test('addMonths(): 月末夹取（1/31 + 1 月 = 2/28，不是 3/3）', () => {
  /* 🔴 这是最容易写错的一处：不能简单 +30 天 */
  assert.equal(DRAPI.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(DRAPI.addMonths('2028-01-31', 1), '2028-02-29');   // 闰年
  assert.equal(DRAPI.addMonths('2026-01-15', 1), '2026-02-15');   // 非月末不受影响
  assert.equal(DRAPI.addMonths('2026-12-15', 1), '2027-01-15');   // 跨年
  assert.equal(DRAPI.addMonths('2026-03-31', -1), '2026-02-28');  // 往前也要夹取
  assert.equal(DRAPI.addMonths('2026-01-31', 0), '2026-01-31');   // 0 个月 = 不变
});

test('quarterOf(): 返回 {y, q}，q 是 **0-based**', () => {
  /* ⚠️ 实际 API 返回对象而不是数字，且 q 从 0 起算 —— 单测必须按**真实契约**写，
     不能按"我以为的"写（我第一版就写错了，抓到 2 个假红）。 */
  assert.deepEqual(plain(DRAPI.quarterOf(new Date(2026, 0, 1))),  { y: 2026, q: 0 });
  assert.deepEqual(plain(DRAPI.quarterOf(new Date(2026, 3, 1))),  { y: 2026, q: 1 });
  assert.deepEqual(plain(DRAPI.quarterOf(new Date(2026, 11, 31))), { y: 2026, q: 3 });
});

test('quarterRange(): q 是 **0-based**（0=Q1）', () => {
  assert.deepEqual(plain(DRAPI.quarterRange(2026, 0)), { from: '2026-01-01', to: '2026-03-31' });
  assert.deepEqual(plain(DRAPI.quarterRange(2026, 1)), { from: '2026-04-01', to: '2026-06-30' });
  assert.deepEqual(plain(DRAPI.quarterRange(2026, 3)), { from: '2026-10-01', to: '2026-12-31' });
  /* 🔴 Q1 的结束日必须是 3/31 而不是 4/1（Off-by-one 最常见）*/
  assert.notEqual(DRAPI.quarterRange(2026, 0).to, '2026-04-01');
});

test('quarterRange(): 季度号越界必须**抛错**，不能静默算错', () => {
  /* 🔴 这是本轮加防呆的原因：原来传 1（以为 1=Q1）会静默返回 Q2。 */
  assert.throws(() => DRAPI.quarterRange(2026, 4), /0-3/);
  assert.throws(() => DRAPI.quarterRange(2026, -1), /0-3/);
  assert.throws(() => DRAPI.quarterRange(2026, 1.5), /0-3/);
});
