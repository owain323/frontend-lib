/**
 * example-esm-gate.js — 接入样板必须真的能跑
 *
 * ============================================================================
 * 🔴 这条门禁防的是「样板是摆设」
 * ---------------------------------------------------------------------------
 *  `examples/react-vite/` 的 README 写着「这是 T-01 的交付物：证明这个库能被
 *  真实项目用上」，但它只有 `index.html` + `README.md` —— **没有 package.json、
 *  没有构建、也没有任何东西跑过它**。
 *
 *  一份"声称证明过"但从未执行过的样板，比没有样板更坏：它让人以为
 *  这条路走通了。所以这里补一个**真能被打开、被点击、被量**的样板：
 *  `examples/esm-native/`（原生 `<script type="module">`，零依赖零构建）。
 *
 * ============================================================================
 * 判据
 * ---------------------------------------------------------------------------
 *  ① 页面无 console error / pageerror（import 失败会在这里现形）
 *  ② 模块导出的 `Accordion` 是构造函数，且**与 window 上那份是同一个对象**
 *     （防「包装里复制了一份实现」——那种 esm/ 会跟源码漂移）
 *  ③ 重复构造返回同一实例（幂等，在**模块**场景下再验一次）
 *  ④ 点一次收起项，`aria-expanded` 真的变 true（行为生效，不是只有样式）
 *  ⑤ 按钮的 computed background-color 不是透明（CSS 真的加载了）
 *
 *  用法：node 05-audit/example-esm-gate.js [--selftest]
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..');
const PAGE = 'http://127.0.0.1:8000/examples/esm-native/index.html';

/* -------------------------------------------------------------------------
 * 纯判据（自检可以直接喂假数据）
 * ---------------------------------------------------------------------- */
function judgeReport(r) {
  const errs = [];
  if (!r || typeof r !== 'object') return ['页面没有产出 __esm 报告（脚本可能没执行）'];
  if (r.ok !== true) errs.push('__esm.ok 不是 true');
  if (r.isCtor !== true) errs.push('import 出来的 Accordion 不是函数（esm 入口没真正导出构造器）');
  if (r.hasToggle !== true) errs.push('实例上没有 toggle（拿到的不是真组件）');
  if (r.same !== true) errs.push('重复构造返回了不同实例（幂等被破坏）');
  if (r.fromGlobalSame !== true) {
    errs.push('esm 导出与 window.Accordion 不是同一个对象 —— '
      + '包装里复制了一份实现，两份会漂移');
  }
  return errs;
}

function judgeVisual(v) {
  const errs = [];
  if (!v) return ['没有量到样式'];
  if (!v.btnBg || v.btnBg === 'rgba(0, 0, 0, 0)' || v.btnBg === 'transparent') {
    errs.push(`按钮背景色是 ${v.btnBg || '(空)'} —— CSS 没生效`);
  }
  return errs;
}

/* -------------------------------------------------------------------------
 * 反向控制
 * ---------------------------------------------------------------------- */
function selftest() {
  const R = [];
  const add = (n, ok) => R.push([n, !!ok]);
  const ok = { ok: true, isCtor: true, hasToggle: true, same: true, fromGlobalSame: true };

  add('全好的报告不报错（否则判据可能恒红）', judgeReport(ok).length === 0);
  add('ok=false 被抓', judgeReport({ ...ok, ok: false }).length === 1);
  add('不是构造函数被抓', judgeReport({ ...ok, isCtor: false }).length === 1);
  add('没有 toggle 被抓', judgeReport({ ...ok, hasToggle: false }).length === 1);
  add('幂等破坏被抓', judgeReport({ ...ok, same: false }).length === 1);
  add('"复制了一份实现"被抓', judgeReport({ ...ok, fromGlobalSame: false }).length === 1);
  add('报告缺失被抓', judgeReport(null).length === 1);
  add('多处同时坏：报出 5 条而不是 1 条',
    judgeReport({ ok: false, isCtor: false, hasToggle: false, same: false, fromGlobalSame: false }).length === 5);

  add('背景透明被抓', judgeVisual({ btnBg: 'rgba(0, 0, 0, 0)' }).length === 1);
  add('有背景不报错', judgeVisual({ btnBg: 'rgb(27, 77, 143)' }).length === 0);
  add('量不到样式被抓', judgeVisual(null).length === 1);

  const red = R.filter(([, v]) => !v);
  for (const [n, v] of R) console.log(`  ${v ? '✓' : '✗'} ${n}`);
  if (red.length) {
    console.log(`\n🔴 自检失败 ${red.length} 条。`);
    return 1;
  }
  console.log(`\n✓ 自检 ${R.length} 条全部通过`);
  return 0;
}

/* -------------------------------------------------------------------------
 * 主流程
 * ---------------------------------------------------------------------- */
(async () => {
  if (process.argv.includes('--selftest')) process.exit(selftest());

  const { launch } = require('./browser');
  console.log('  === 接入样板（examples/esm-native）===');

  const errs = [];
  const b = await launch();
  try {
    const p = await b.newPage();
    await p.setViewport({ width: 1000, height: 900 });
    const consoleErrs = [];
    p.on('pageerror', (e) => consoleErrs.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') consoleErrs.push('console: ' + m.text()); });

    await p.goto(PAGE, { waitUntil: 'networkidle0' });

    const rep = await p.evaluate(() => window.__esm || null);
    errs.push(...judgeReport(rep));

    const visual = await p.evaluate(() => {
      const btn = document.querySelector('#btn');
      if (!btn) return null;
      return { btnBg: getComputedStyle(btn).backgroundColor };
    });
    errs.push(...judgeVisual(visual));

    /* ④ 点第二项（初始收起），看它是否真的展开 */
    const opened = await p.evaluate(() => {
      const root = document.querySelector('[data-accordion]');
      const btns = root.querySelectorAll('.accordion__trigger');
      const target = btns[1];
      const before = target.getAttribute('aria-expanded');
      target.scrollIntoView({ block: 'center' });
      target.click();
      return { before };
    });
    await new Promise((r) => setTimeout(r, 320));
    const after = await p.evaluate(() => {
      const root = document.querySelector('[data-accordion]');
      return root.querySelectorAll('.accordion__trigger')[1].getAttribute('aria-expanded');
    });
    if (opened.before !== 'false' || after !== 'true') {
      errs.push(`点击收起项后 aria-expanded：${opened.before} → ${after}（期望 false → true）`);
    }

    /* ① 控制台错误（放最后判，因为点完才可能冒出来） */
    for (const e of consoleErrs) errs.push(e);
  } catch (e) {
    errs.push('页面跑不起来：' + e.message);
  } finally {
    await b.close();
  }

  if (errs.length) {
    console.log(`  ✗ ${errs.length} 处失败`);
    for (const e of errs) console.log('      · ' + e);
    process.exit(1);
  }
  console.log('  ✓ 模块导入 / 幂等 / 行为 / 样式 四项全部成立');
  console.log('  OK    接入样板真的能跑');
})();
