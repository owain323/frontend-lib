/*
 * pdf-pages.js — 从 PDF 字节里读页数与纸幅。零依赖、不联网。
 *
 * ============================================================================
 * 🔴 为什么要有这个文件（而不是各写一份）
 * ============================================================================
 * 现在有两个地方要回答"这份 PDF 几页"：
 *   · `05-audit/print-gate.js` —— 判分页有没有被改坏
 *   · `ai/pdf.js`             —— 判导出产物有没有超出 `--max-pages`
 *
 * 各写一份的代价不是"多几行"，而是**两个数会在某次改动后不一致，且没人发现**：
 * 门禁说 7 页、导出器说 8 页，两边各自"通过"。同一个判定写两遍必然漂移（E31）。
 *
 * ============================================================================
 * ⚠️ 两种读法，必须一致
 * ============================================================================
 *   ① 数 `/Type /Page` 对象     —— Chromium 每页一个，直方图式可靠
 *   ② 读页树根 `/Count`         —— 语义上的权威值
 *
 * 不一致意味着"这个文件长了两套说法"，此时**不能挑一个继续**：
 * 预算判错的代价是"多印 40 页纸，而工具说通过"。
 * 所以 `inspect()` 把两个值都返回，由调用方决定：
 *   · 门禁（判分页变化）用 ①（历史基线就是按 ① 录的）
 *   · 导出器（判预算）要求 ①② 一致，不一致就报错退出
 *
 * ⚠️ 本解析器**只认**未压缩的对象表。Chromium 的产物实测 679 个对象、0 个
 *    `/Type /ObjStm`；若将来出现对象流，①② 会同时偏小 —— 这一条写在这里，
 *    是为了让"某天页数突然变 0"能被想到，而不是当成新 bug 查一整天。
 */
'use strict';

/** 数 `/Type /Page` 对象。正则与 print-gate 历史实现**逐字相同**（基线按它录的）。 */
function countPageObjects(raw) {
  return (raw.match(/\/Type\s*\/Page[^s]/g) || []).length;
}

/**
 * 页树**根节点**声明的 `/Count`（拿不到则 null）。
 *
 * 🔴 不能取"文件里第一个 `/Count`" —— 那是**叶节点**的数。
 *    实测一份 50 页的 Chromium 产物：文件里 8 个 `/Count`，依次是
 *    `8,8,8,8,8,8,2,50` —— 只有最后一个（根节点）是 50。
 *    按"第一个"取会读成 8，于是 `pages=50` 与 `countFromTree=8` 打架，
 *    导出器据此报"两套说法不一致，无法判定预算" —— **用户拿着一份 50 页的
 *    正常文档，被一个读法错误挡在门外**。
 *
 * 正确路径：catalog `/Type /Catalog` → 它的 `/Pages N 0 R` → 对象 N 的 `/Count`。
 * 对象内的键序不保证，所以两侧各开一个窗口找；找不到就返回 null
 * （null 表示"没有交叉核对"，`agree` 为真 —— 宁可少一道核对，
 *  也不能拿一个错数字去否决用户的文件）。
 */
function countFromTree(raw) {
  const s = Buffer.isBuffer(raw) ? raw.toString('latin1') : String(raw);
  const cat = s.search(/\/Type\s*\/Catalog/);
  if (cat < 0) return null;

  /* 键序不固定：在 catalog 前后各取一段找 /Pages 引用 */
  const win = s.slice(Math.max(0, cat - 2000), cat + 2000);
  const ref = /\/Pages\s+(\d+)\s+0\s+R/.exec(win);
  if (!ref) return null;

  /* 找 `N 0 obj` 本身，再在它后面找 /Count。
     ⚠️ 不用 `[\s\S]*?endobj` 截取：流数据里可能**恰好**出现 endobj 的字节。 */
  const at = s.search(new RegExp('(^|[^0-9])' + ref[1] + '\\s+0\\s+obj'));
  if (at < 0) return null;
  const body = s.slice(at, at + 2000);
  const c = /\/Count\s+(\d+)/.exec(body);
  return c ? +c[1] : null;
}

/** 第一张纸的 `/MediaBox [x0 y0 x1 y1]` → `{width, height}`（pt，1/72 英寸）。 */
function mediaBox(raw) {
  const m = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(raw);
  if (!m) return null;
  const x0 = +m[1];
  const y0 = +m[2];
  const x1 = +m[3];
  const y1 = +m[4];
  return {
    width: Math.round((x1 - x0) * 100) / 100,
    height: Math.round((y1 - y0) * 100) / 100,
  };
}

/**
 * @param {Buffer|String} raw PDF 字节（String 时按 latin1 处理）
 * @returns {{pages:number, countFromTree:number|null, agree:boolean, mediaBox:object|null}}
 */
function inspect(raw) {
  const s = Buffer.isBuffer(raw) ? raw.toString('latin1') : String(raw);
  const pages = countPageObjects(s);
  const tree = countFromTree(s);
  return {
    pages,
    countFromTree: tree,
    /* 没有 /Count 时不算分歧（有的生成器省它）；有就必须相等 */
    agree: tree === null || tree === pages,
    mediaBox: mediaBox(s),
  };
}

/** 只要页数。等价于 `inspect(buf).pages`，给"只关心页数"的调用方用。 */
function countPages(raw) {
  return inspect(raw).pages;
}

module.exports = { inspect, countPages, countPageObjects, countFromTree, mediaBox };
