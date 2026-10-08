const { launch } = require('./browser.js');

/**
 * dismissable-check.js — 「关得掉」微行为核的行为契约
 *
 * ============================================================================
 * 🔴 为什么要给一个"核"单独写浏览器门禁
 * ----------------------------------------------------------------------------
 *   组件自己的契约（popover-check / dropdown-check）只证明**组件没坏**，
 *   证明不了**核是对的** —— 它们跑的是注入后的组件，
 *   一旦核被改坏而组件恰好不依赖那条分支，全绿依旧。
 *
 *   ⇒ 核要有**自己的**判据，用真实浏览器、真实事件流跑。
 *
 * ============================================================================
 * 判据（六条）
 * ----------------------------------------------------------------------------
 *   ① 嵌套时一次 Esc **只关最内层**（这是本核存在的理由，也是最易回归的一条）
 *   ② 再按一次 Esc ⇒ 关外层（不能一次全关，也不能永远关不掉）
 *   ③ 点外部 ⇒ 只关最内层
 *   ④ 点内部 ⇒ 不关
 *   ⑤ destroy 之后 Esc 不再触发（监听器与栈都要清干净）
 *   ⑥ when() 为 false 时不响应（关闭的浮层不该被误关第二次）
 *
 * ============================================================================
 * 反向控制
 * ----------------------------------------------------------------------------
 *   node 05-audit/dismissable-check.js --selftest
 *   在内存里把核改坏三处（去掉 stopPropagation / 栈顶判定改成栈底 /
 *   destroy 不摘栈），要求**每一次都必须被判据抓到**。
 *   抓不到 ⇒ 这份门禁是瞎的。
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

const CORE = path.resolve(__dirname, '..', '01-tokens', 'behavior', 'dismissable.js');

/* 页面骨架：外层容器里套内层容器，两个都是"浮层" */
const PAGE_HTML = `<!doctype html><meta charset="utf-8">
<body>
  <div id="outer"><button id="outer-btn">outer</button>
    <div id="inner"><button id="inner-btn">inner</button></div>
  </div>
  <div id="elsewhere">elsewhere</div>
</body>`;

/* 在页面里跑一遍完整的六条场景，返回每条的 ok / why */
function probe() {
  const log = [];
  window.__flDismiss = undefined;
  const outer = document.getElementById('outer');
  const inner = document.getElementById('inner');
  const elsewhere = document.getElementById('elsewhere');

  let innerOpen = true;
  let outerOpen = true;

  const dOuter = flDismissable({
    escOn: [outer],
    inside: [outer],
    when: function () { return outerOpen; },
    onDismiss: function (e, reason) { outerOpen = false; log.push('outer:' + reason); },
  });
  const dInner = flDismissable({
    escOn: [inner],
    inside: [inner],
    when: function () { return innerOpen; },
    onDismiss: function (e, reason) { innerOpen = false; log.push('inner:' + reason); },
  });

  const key = function (el) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  };
  const click = function (el) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  };

  const out = {};

  /* ① 嵌套：一次 Esc 只关最内层 */
  log.length = 0;
  key(document.getElementById('inner-btn'));
  out.escInner = { log: log.slice(), ok: log.length === 1 && log[0] === 'inner:esc' };

  /* ② 再按一次 ⇒ 关外层（此时内层已关，最内层变成外层） */
  log.length = 0;
  key(document.getElementById('inner-btn'));
  out.escOuter = { log: log.slice(), ok: log.length === 1 && log[0] === 'outer:esc' };

  /* ③ 点外部：只关最内层 */
  innerOpen = true; outerOpen = true;
  log.length = 0;
  click(elsewhere);
  out.outside = { log: log.slice(), ok: log.length === 1 && log[0] === 'inner:outside' };

  /* ④ 点内部：不关 */
  innerOpen = true; outerOpen = true;
  log.length = 0;
  click(document.getElementById('inner-btn'));
  out.inside = { log: log.slice(), ok: log.length === 0 };

  /* ⑤ destroy 之后不再响应 */
  innerOpen = true; outerOpen = true;
  dInner.destroy();
  dOuter.destroy();
  log.length = 0;
  key(document.getElementById('inner-btn'));
  out.destroy = { log: log.slice(), ok: log.length === 0 };

  /* ⑦ destroy 之后，**点外部也不该再关到它**
     ⚠️ 这条是专门补的：Esc 监听器摘掉之后，若 destroy **忘了摘栈**，
        外部点击走的是共享的 document 监听器、只查栈 ⇒ 仍然会关到已销毁的层。
        只测 Esc（⑤）抓不到这个缺陷 —— 因为 Esc 的监听器确实被摘了。 */
  log.length = 0;
  click(elsewhere);
  out.destroyOutside = { log: log.slice(), ok: log.length === 0 };

  /* ⑥ when() 为 false ⇒ 不响应 */
  innerOpen = true; outerOpen = true;
  const d3 = flDismissable({
    escOn: [outer], inside: [outer],
    when: function () { return false; },
    onDismiss: function (e, reason) { log.push('never:' + reason); },
  });
  log.length = 0;
  key(document.getElementById('outer-btn'));
  out.whenFalse = { log: log.slice(), ok: log.length === 0 };
  d3.destroy();

  return out;
}

async function run(coreSrc) {
  const b = await launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  await p.setContent(PAGE_HTML);
  await p.addScriptTag({ content: coreSrc });
  const out = await p.evaluate(probe);
  await b.close();
  return { out: out, errs: errs };
}

const NAMES = {
  escInner: '① 嵌套时一次 Esc 只关最内层',
  escOuter: '② 再按一次 Esc 关外层',
  outside: '③ 点外部只关最内层',
  inside: '④ 点内部不关闭',
  destroy: '⑤ destroy 之后 Esc 不再触发',
  destroyOutside: '⑥ destroy 之后点外部也不再关到它（栈必须摘干净）',
  whenFalse: '⑦ when() 为 false 时不响应',
};

(async () => {
  if (process.argv.includes('--selftest')) {
    const raw = fs.readFileSync(CORE, 'utf8');
    const mutants = [
      ['去掉 stopPropagation（⇒ 一次 Esc 两层全关）',
        /if \(e\.stopPropagation\) e\.stopPropagation\(\);/, ''],
      ['栈顶改成栈底（⇒ 关错了层）',
        /for \(var i = shared\.stack\.length - 1; i >= 0; i--\)/,
        'for (var i = 0; i < shared.stack.length; i++)'],
      ['destroy 不摘栈（⇒ 监听器泄漏）',
        /var k = shared\.stack\.indexOf\(rec\);/, 'var k = -1;'],
    ];
    let bad = 0;
    for (const [why, from, to] of mutants) {
      const src = raw.replace(from, to);
      if (src === raw) {
        console.log('  [FAIL] 突变没生效（正则没匹配上）：' + why);
        bad++;
        continue;
      }
      const r = await run(src);
      const caught = Object.keys(NAMES).some((k) => !r.out[k].ok) || r.errs.length > 0;
      if (caught) {
        console.log('  [OK]   判据抓到突变：' + why);
      } else {
        console.log('  [FAIL] 突变没被抓到 ⇒ 门禁是瞎的：' + why);
        bad++;
      }
    }
    /* 正向：原样必须全绿 */
    const ok = await run(raw);
    const allGreen = Object.keys(NAMES).every((k) => ok.out[k].ok) && !ok.errs.length;
    if (allGreen) {
      console.log('  [OK]   原样六条全绿（判据没有误报）');
    } else {
      console.log('  [FAIL] 原样就有不通过的项 ⇒ 判据过严');
      bad++;
    }
    process.exit(bad ? 1 : 0);
  }

  const r = await run(fs.readFileSync(CORE, 'utf8'));
  console.log('');
  console.log('  === dismissable 核契约 ===');
  if (r.errs.length) {
    console.log('    X 页面报错：' + r.errs.join(' | '));
  }
  let bad = 0;
  for (const k of Object.keys(NAMES)) {
    const v = r.out[k];
    if (!v.ok) bad++;
    console.log('    %s %s%s', v.ok ? 'OK  ' : 'X   ', NAMES[k],
      v.ok ? '' : '  ⇒ 实际：[' + v.log.join(', ') + ']');
  }
  console.log('');
  if (bad || r.errs.length) {
    console.log('  ❌ ' + (bad || r.errs.length) + ' 项不满足');
    process.exit(1);
  }
  console.log('  ✅ dismissable 核契约全部满足');
})();
