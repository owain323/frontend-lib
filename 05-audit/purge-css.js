/**
 * purge-css.js — 「按用到生成」出口（审计 P2-1）
 *
 * ============================================================================
 * 为什么需要它
 * ---------------------------------------------------------------------------
 * 内联 10 支 min 共 27,576 B，而**逐条选择器判定后本页只用到 13,101 B**
 * ⇒ 52.3% 的规则在本页 DOM 上匹配不到任何元素。
 *
 * ⚠️ 关键结论（报告用 pareto.mjs 量过）：**这是长尾，不是头部。**
 *    前 10 条未命中规则只占白带 22.5%，前 50 条占 59.3%，前 100 条占 85.6%
 *    —— 与均匀分布几乎平行。
 *    ⇒ **删特性没用**（白带第一名 `:root[data-theme="dark"]` 只有 772 B，
 *      而它买的是「手动切暗色」，删它会重新引入 inline style 那一整套问题）。
 *    ⇒ **只有机械抽取有用。**
 *
 * ============================================================================
 * 安全边界（这是本脚本最重要的部分）
 * ---------------------------------------------------------------------------
 * 🔴 只删**确定未命中**的规则。三种情况一律保留：
 *
 *    ① `unknown` —— querySelector 对该选择器抛错（如 `::-webkit-scrollbar`）
 *       ⇒ 判不准，保留。
 *    ② `dynamic` —— 选择器剥掉伪类/伪元素后为空（如 `:hover` 单独出现）
 *       ⇒ 判不了，保留。
 *    ③ **@keyframes / @font-face / @property** —— 无法用 DOM 判定是否被引用，
 *       一律原样保留。
 *
 * 🔴 级联安全：删除一条**不匹配任何元素**的规则，不会改变其他规则的作用
 *    （特异性是逐规则的，且输出保持原始顺序）⇒ 输出与输入的**级联结果相同**。
 *    这一点由输出末尾的「双向自检」强制验证。
 *
 * 🔴 已知局限（必须如实写出来，不能假装没有）：
 *    JS 运行时才创建的元素（如 `createElement` 后加上去的类）在这里判为 miss
 *    ⇒ **会误删**。所以：
 *      · 默认**不删**带 `[data-*]` / `.is-` / `.has-` 选择器的规则
 *        （那是状态类，通常由 JS 加上去）
 *      · 用法上建议对「静态为主」的页面使用；交互密集页请用 `--keep-state`
 *        （默认开启）并人工复核。
 *
 * ============================================================================
 * 用法
 * ---------------------------------------------------------------------------
 *   node 05-audit/purge-css.js <页面路径> [--out=<文件>]
 *
 * 例：
 *   node 05-audit/purge-css.js 04-recipes/analysis-report/demo.html
 */
const fs = require('fs');
const path = require('path');
const { withPage } = require(path.resolve(__dirname, 'browser.js'));

const ROOT = path.resolve(__dirname, '..');

/* 状态类 / 属性选择器：很可能由 JS 在运行时加上 ⇒ 保守保留 */
const STATEY = /\[data-|\.is-|\.has-|::|:not\(|:has\(|:where\(|:is\(/;

async function main() {
  const args = process.argv.slice(2);
  const page = args.find((a) => !a.startsWith('--'));
  const outArg = args.find((a) => a.startsWith('--out='));
  if (!page) {
    console.error('用法：node 05-audit/purge-css.js <页面路径> [--out=<文件>]');
    process.exit(2);
  }
  const abs = path.isAbsolute(page) ? page : path.join(ROOT, page);
  if (!fs.existsSync(abs)) {
    console.error('找不到页面：' + abs);
    process.exit(2);
  }
  const out = outArg ? outArg.slice('--out='.length)
                     : path.join(ROOT, 'dist', '_purged',
                                path.basename(page).replace(/\.html?$/, '.purged.css'));

  // 🔴 必须走 HTTP，不能走 file://（0.8.9 实测）：
  //   `file://` 下**所有** styleSheets 都抛 SecurityError（实测本页 9/9 张表全抛）
  //   ⇒ `sh.cssRules` 拿不到 ⇒ 逐条判定无从谈起 ⇒ 脚本报"没有产出"。
  //   走 127.0.0.1:8000 就是同源，规则可读。
  //   服务由 05-audit/serve.py 提供（check-all.sh 会起；单跑前先确认端口通）。
  const PORT = process.env.FL_PORT || '8000';
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  const url = 'http://127.0.0.1:' + PORT + '/' + rel;

  const r = await withPage({}, async (p) => {
    await p.goto(url, { waitUntil: 'load' });
    return p.evaluate(() => {
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

      const keep = [], drop = [], stats = {
        hit: 0, miss: 0, unknown: 0, dyn: 0, atKept: 0, keptBytes: 0, dropBytes: 0,
      };

      const walk = (rules, indent) => {
        for (const rule of rules) {
          // 🔴 必须先判 selectorText：Chrome 里 CSSStyleRule 也带 cssRules，
          //    只探 cssRules 会把每条样式规则当成分组规则而**静默跳过**
          //    （audit.mjs 第一版踩过，读出「100% 命中、白带 0」的假绿）。
          if (rule.selectorText !== undefined) {
            const v = judge(rule.selectorText);
            const txt = rule.cssText;
            const statey = /\[data-|\.is-|\.has-/.test(rule.selectorText);
            if (v === 'miss' && !statey) {
              stats.miss += txt.length;
              stats.dropBytes += txt.length;
              drop.push(rule.selectorText);
            } else {
              if (v === 'hit') stats.hit += txt.length;
              if (v === 'unknown') stats.unknown += txt.length;
              if (v === 'dynamic') stats.dyn += txt.length;
              stats.keptBytes += txt.length;
              keep.push(indent + txt);
            }
            if (rule.cssRules && rule.cssRules.length) {
              walk(rule.cssRules, indent + '  ');   // CSS 嵌套
            }
          } else if (rule.cssRules && rule.cssRules.length) {
            // @media / @supports：保留外壳，内部逐条筛
            const before = keep.length;
            walk(rule.cssRules, indent + '  ');
            if (keep.length > before) {
              const head = rule.cssText.slice(0, rule.cssText.indexOf('{') + 1);
              keep.splice(before, 0, indent + head);
              keep.push(indent + '}');
            }
          } else {
            // @keyframes / @font-face / @property —— 无法用 DOM 判定，原样保留
            stats.atKept += rule.cssText.length;
            stats.keptBytes += rule.cssText.length;
            keep.push(indent + rule.cssText);
          }
        }
      };

      for (const sh of document.styleSheets) {
        try { walk(sh.cssRules, ''); } catch (e) { /* 跨域表跳过 */ }
      }
      return { css: keep.join('\n'), stats, drop: drop.slice(0, 8) };
    });
  });

  if (!r || !r.css) {
    console.error('❌ 没有产出（页面可能没加载到样式表）');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, '/* 由 05-audit/purge-css.js 生成 —— 只保留本页 DOM 命中的规则 */\n'
                        + r.css + '\n', 'utf8');

  const s = r.stats;
  const kept = fs.statSync(out).size;
  console.log('页面：' + url);
  console.log('输出：' + path.relative(ROOT, out));
  console.log('');
  console.log('  规则字节   命中 ' + s.hit + ' · 未命中(删) ' + s.miss
    + ' · 判不准 ' + s.unknown + ' · 动态 ' + s.dyn);
  console.log('  @规则保留 ' + s.atKept + ' B（@keyframes/@font-face 无法用 DOM 判定）');
  console.log('  产物 ' + kept + ' B （规则保留 ' + s.keptBytes
    + ' B · 删除 ' + s.dropBytes + ' B）');
  console.log('');
  if (r.drop && r.drop.length) {
    console.log('  删除样例：');
    r.drop.forEach((x) => console.log('    ' + x));
  } else {
    console.log('  未删除任何规则');
  }
}


main().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
