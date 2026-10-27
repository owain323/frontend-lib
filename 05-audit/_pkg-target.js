/* LAYER: static */
/* ============================================================================
 * _pkg-target.js — 包目标（package target）语义的**唯一实现**
 *
 * 谁在用：05-audit/pack-closure.js、05-audit/entry-resolve.js
 *
 * ---------------------------------------------------------------------------
 * 🔴 为什么必须抽出来（第三轮外部审计 2026-10-26 晚 · 第 e) 条）
 *
 *   审计原话：「模式语义实现了两份且**已分叉**。`pack-closure.js` 和
 *   `entry-resolve.js` 各自把导出目标星号转正则；前者独立匹配每个 `*`，
 *   后者捕获多段但只用 `m[1]`，都不符合 Node 对目标中多个 `*` 使用同一
 *   捕获值的语义。应共享实现或让 resolver 从 Node 的解析结果生成目标样例。」
 *
 *   ⇒ 本库 E31：「同一判定写两遍必然漂移」。这次是**已经**漂了。
 *     现在星号语义只在本文件里，另外两个文件只调用、不实现。
 *
 * ---------------------------------------------------------------------------
 * ⭐ 这三条不是从文档推的，是**实测 node 22.22.2** 得到的（2026-10-26）：
 *
 *   ① `*` 是字符串替换，**可以跨 `/`**
 *        exports {"./x/*": "./dist/*.js"} + 子路径 `x/b/c` → dist/b/c.js
 *
 *   ② 目标里出现多个 `*` 时，**用同一个值**替换所有星号
 *        exports {"./x/*": "./dist/<star>/copy-<star>.js"} + 子路径 `x/a`
 *          · 包内只有 dist/a/copy-a.js  → 解析成功
 *          · 包内只有 dist/a/copy-b.js  → MODULE_NOT_FOUND
 *      ⇒ 旧实现把每个 `*` 独立展开成 `[\s\S]*`，于是 `a/copy-b.js` 也能过 ——
 *        这是一条**确定的假绿**（审计第 a) 条）。
 *
 *   ③ `*` **不能**匹配空串
 *        exports {"./a*": "./dist/*.js"} + 子路径 `a` → ERR_PACKAGE_PATH_NOT_EXPORTED
 *      ⚠️ 准确说：Node 是在**键**这一侧拒绝空匹配的（子路径 `a` 对键 `./a*`
 *         匹配出的那一段是空串）。本文件管的是**目标**一侧，所以用 `+` 而不是
 *         `*`，让两侧口径一致 —— 否则会出现"目标允许空、键不允许"的错位。
 *
 *   ④ exports 的目标**必须以 `./` 开头**
 *        exports {"./i": "dist/i.js"} → ERR_INVALID_PACKAGE_TARGET
 *      ⇒ 旧实现先 `replace(/^\.\//, '')` 再判存在，于是不带 `./` 的非法目标
 *        只要文件在包里就**判绿**（审计第 a) 条）。
 *
 *   ⚠️ ①② 的反例由 pack-closure.js 的 `--selftest` 用**真 Node 解析**
 *      （`Module.createRequire().resolve()`，只解析不执行）做差分比对，
 *      所以将来 Node 改了语义，自检会红，而不是我们悄悄继续假绿。
 * ==========================================================================*/
'use strict';

/** 正则元字符转义。**不转义 `*`** —— 星号由本文件自己处理。 */
function escapeRe(s) {
  return String(s).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** 目标里 `*` 的个数。 */
function starCount(t) {
  return String(t).split('*').length - 1;
}

/**
 * 目标模式 → 正则。
 * 第一个 `*` 变成捕获组，其余全部变成 `\1`（**同一个值**，Node 语义）。
 */
function toRegExp(target) {
  var segs = String(target).split('*');
  if (segs.length === 1) return new RegExp('^' + escapeRe(target) + '$');
  var re = '^' + escapeRe(segs[0]);
  for (var i = 1; i < segs.length; i++) {
    /* `+` 不是 `*`：Node 不接受空星号（实测见文件头 ③） */
    re += (i === 1 ? '([\\s\\S]+?)' : '\\1') + escapeRe(segs[i]);
  }
  return new RegExp(re + '$');
}

/**
 * 用目标模式去匹配一个文件路径，返回「`*` 被替换成的那一段」。
 * 没有星号时：命中返回 `''`，不命中返回 `null`。
 * 有星号但没命中：返回 `null`。
 */
function starValue(target, file) {
  var re = toRegExp(target);
  var m = re.exec(String(file));
  if (!m) return null;
  return m[1] === undefined ? '' : m[1];
}

/**
 * exports 目标的**形状**是否合法（不判文件在不在）。
 * 只用于 exports：`main` / `module` / `browser` 是更老的字段，
 * 允许 `index.js` 这种不带 `./` 的写法，不能套这一条。
 *
 * @returns {{ok:boolean, why?:string}}
 */
function checkExportsTarget(target) {
  if (typeof target !== 'string' || !target) {
    return { ok: false, why: '目标不是非空字符串' };
  }
  if (target.charAt(0) !== '.') {
    return {
      ok: false,
      why: 'exports 目标必须以 `./` 开头（Node: ERR_INVALID_PACKAGE_TARGET）；' +
           '实际是 `' + target + '`'
    };
  }
  if (target.slice(0, 2) !== './') {
    return { ok: false, why: 'exports 目标必须正好以 `./` 开头，实际是 `' + target + '`' };
  }
  if (target.indexOf('node_modules') >= 0) {
    return { ok: false, why: 'exports 目标不许包含 node_modules 段' };
  }
  /* `./a/../../b` 这类越界：按段看，任何一段是 `..` 都非法 */
  var segs = target.split('/');
  for (var i = 0; i < segs.length; i++) {
    if (segs[i] === '..') {
      return { ok: false, why: 'exports 目标不许含 `..` 段（越出包根）' };
    }
  }
  return { ok: true };
}

module.exports = {
  escapeRe: escapeRe,
  starCount: starCount,
  toRegExp: toRegExp,
  starValue: starValue,
  checkExportsTarget: checkExportsTarget
};
