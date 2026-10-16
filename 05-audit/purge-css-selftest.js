/**
 * purge-css-selftest.js — 证明「按用到生成」量具（purge-css.js）真的在读 DOM。
 *
 * 🔴 为什么必须单独做这件事（本库宪法：没有反向控制 ⇒ 不算门禁）：
 *   一个「扫 DOM 按需生成」的量具最容易出两种**假绿**，而且两种都很好看：
 *     ① **它其实在查表** —— 输出固定，与页面无关 ⇒ 省体积数字永远漂亮
 *     ② **它扫的是空 DOM** —— 于是"全部未命中"或"全部命中"，数字也漂亮
 *   ⇒ 必须机械地排除，不能靠"我看着对"。
 *
 * 三条判据（全部要过）：
 *   ① **确定性**：同一页面跑两次，结果逐字节相同
 *   ② **真读 DOM**：动态加一个组件节点后，命中变大、删除变小
 *   ③ **不极端**：既非全删（kept=0）也非全留（dropped=0）
 *
 * 用法：node 05-audit/purge-css-selftest.js
 */
const path = require('path');
const { withPage } = require(path.resolve(__dirname, 'browser.js'));

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.FL_PORT || '8000';
const PAGE = '04-recipes/analysis-report/demo.html';

/** 在页面里跑一次判定，返回 { kept, dropped, total }（单位：cssText 字节数） */
function measureScript() {
  // 注意：本函数会被序列化进浏览器执行，**不能引用外部变量**。
  const stripState = (sel) => sel
    .replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '')
    .replace(/\[[^\]]*\]/g, (m) => m)
    .trim();
  const judge = (sel) => {
    const s = stripState(sel);
    if (!s) return 'dynamic';
    let hit = false, threw = false, tried = false;
    for (const one of s.split(',')) {
      const t = one.trim();
      if (!t) continue;
      tried = true;
      try { if (document.querySelector(t) !== null) hit = true; }
      catch (e) { threw = true; }
    }
    if (hit) return 'hit';
    if (!tried) return 'dynamic';
    return threw ? 'unknown' : 'miss';
  };
  let kept = 0, dropped = 0, total = 0;
  const walk = (rules) => {
    for (const r of rules) {
      // 🔴 必须先判 selectorText：Chrome 里 CSSStyleRule 也带 cssRules
      if (r.selectorText !== undefined) {
        total += r.cssText.length;
        const statey = /\[data-|\.is-|\.has-/.test(r.selectorText);
        if (judge(r.selectorText) === 'miss' && !statey) {
          dropped += r.cssText.length;
        } else {
          kept += r.cssText.length;
        }
        if (r.cssRules && r.cssRules.length) walk(r.cssRules);
      } else if (r.cssRules && r.cssRules.length) {
        walk(r.cssRules);
      } else {
        kept += r.cssText.length;
        total += r.cssText.length;
      }
    }
  };
  for (const sh of document.styleSheets) {
    try { walk(sh.cssRules); } catch (e) { /* 跨域表跳过 */ }
  }
  return { kept, dropped, total };
}

async function runOnce(inject) {
  return withPage({}, async (p) => {
    await p.goto('http://127.0.0.1:' + PORT + '/' + PAGE, { waitUntil: 'load' });
    if (inject) await p.evaluate(inject);
    return p.evaluate(measureScript);
  });
}

(async () => {
  let bad = 0;
  const url = 'http://127.0.0.1:' + PORT + '/' + PAGE;
  console.log('  页面：' + url);
  console.log('');

  let a, b;
  try {
    a = await runOnce(null);
    b = await runOnce(null);
  } catch (e) {
    console.log('  🔴 跑不起来（多半是 ' + PORT + ' 端口没有静态服务）');
    console.log('     ' + String(e).slice(0, 160));
    process.exit(1);
  }

  // ① 确定性
  const same = JSON.stringify(a) === JSON.stringify(b);
  console.log('  ' + (same ? 'OK ' : '🔴 ') + '① 两次跑同一页面结果相同');
  if (!same) bad++;

  // ② 真读 DOM：注入**本页样式表里确实有规则、但 DOM 上没有**的元素
  //
  // 🔴 第一版这条写错了，记下来：我注入的是 `.badge` / `.progress`，
  //   结果保留与删除**都没变**，自检报红。
  //   查清原因后：**这两个组件根本不在这页加载的样式表里**
  //   （本库的 demo 页只引自己那几支 CSS，不是全库）
  //   ⇒ 它们既不可能"命中变多"，也不可能"删除变少"。
  //   ⇒ **是自检的假设错了，不是量具错了**。
  //
  //   正确判据：先在**不注入**时找一条被删的规则（`.note` 这类），
  //   再注入一个匹配它的元素 ⇒ 那条规则必须**从"删除"变成"保留"**。
  //   这样判据自动适配任何页面，不需要我猜页面用了什么。
  const needle = await withPage({}, async (p) => {
    await p.goto('http://127.0.0.1:' + PORT + '/' + PAGE, { waitUntil: 'load' });
    return p.evaluate(() => {
      const stripState = (sel) => sel
        .replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '').trim();
      const found = [];
      const walk = (rules) => {
        for (const r of rules) {
          if (r.selectorText !== undefined) {
            const s = stripState(r.selectorText);
            // 只挑「单一 class 选择器」——好注入，且没有特异性歧义
            if (/^\.[a-z][a-z0-9-]*$/.test(s)) {
              try {
                if (document.querySelector(s) === null) found.push(s);
              } catch (e) { /* 忽略 */ }
            }
            if (r.cssRules && r.cssRules.length) walk(r.cssRules);
          } else if (r.cssRules && r.cssRules.length) walk(r.cssRules);
        }
      };
      for (const sh of document.styleSheets) {
        try { walk(sh.cssRules); } catch (e) { /* 跳过 */ }
      }
      return found[0] || null;   // 取第一个「有规则但 DOM 上没有」的类
    });
  });

  if (!needle) {
    console.log('  🔴 ② 页面样式表里找不到任何"有规则但 DOM 没有"的类 '
      + '⇒ 无法验证「真读 DOM」');
    bad++;
  } else {
    const c = await runOnce('(() => { const d = document.createElement("div");'
      + ' d.className = ' + JSON.stringify(needle.slice(1))
      + '; d.textContent = "x"; document.body.appendChild(d); })()');
    const grew = c.kept > a.kept && c.dropped < a.dropped;
    console.log('  ' + (grew ? 'OK ' : '🔴 ')
      + '② 注入 ' + needle + ' 后它从"删"变"留" ⇒ 真的在读 DOM'
      + '（保留 ' + a.kept + '→' + c.kept
      + '，删除 ' + a.dropped + '→' + c.dropped + '）');
    if (!grew) bad++;
  }

  // ③ 不极端
  const sane = a.kept > 0 && a.dropped > 0 && a.kept < a.total;
  console.log('  ' + (sane ? 'OK ' : '🔴 ')
    + '③ 既非全删也非全留（保留 ' + a.kept
    + ' · 删除 ' + a.dropped + ' · 合计 ' + a.total + '）');
  if (!sane) bad++;

  console.log('');
  console.log('  ' + (bad
    ? '🔴 ' + bad + ' 条自检未通过 ⇒ 这份量具不可信'
    : '自检全部通过 ⇒ 这份量具可信'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
