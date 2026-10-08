const { launch } = require('./browser.js');

/**
 * roving-check.js — 「方向键游走」微行为核的行为契约
 *
 * ============================================================================
 * 🔴 为什么需要
 * ----------------------------------------------------------------------------
 *   tabindex 被手写了 33 处 / 9 个文件，危险的不是"写了很多次"，
 *   而是**每处自己决定边界行为**：要不要绕回、禁用的跳不跳、Home/End 有没有。
 *
 *   ⇒ 这些边界只有跑起来才看得出，静态正则一条都判不出来。
 *
 * ============================================================================
 * 判据（八条）
 * ----------------------------------------------------------------------------
 *   ① 横向：→ 移到下一项，← 移到上一项
 *   ② 绕回：最后一项再按一次 ⇒ 回到第一项
 *   ③ loop=false：走到边界 ⇒ 不动（不是绕回，也不是卡死）
 *   ④ Home / End 跳首末
 *   ⑤ 移动只在**可用子集**里（禁用的那一项被跳过）
 *   ⑥ rove() 让**全集**里只有一个 tabindex="0"（禁用项也必须是 -1）
 *   ⑦ 取模循环对"步长大于列表长度"也对（这是最容易写错的一处）
 *   ⑧ destroy 之后不再响应
 *
 * ============================================================================
 * 反向控制：node 05-audit/roving-check.js --selftest
 *   改坏三处（取模改成 if 夹逼 / rove 只管可移动项 / 去掉 Home·End），
 *   每一次都必须被抓到。
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

const CORE = path.resolve(__dirname, '..', '01-tokens', 'behavior', 'roving.js');

const PAGE_HTML = `<!doctype html><meta charset="utf-8"><body>
<div id="h">
  <button id="h1">1</button>
  <button id="h2" disabled>2</button>
  <button id="h3">3</button>
</div>
<div id="v">
  <button id="v1">1</button>
  <button id="v2">2</button>
  <button id="v3">3</button>
</div>
</body>`;

function probe() {
  const out = {};
  const $ = (id) => document.getElementById(id);
  const key = (el, k) => el.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  const allH = [$('h1'), $('h2'), $('h3')];
  const movableH = [$('h1'), $('h3')];       // h2 禁用

  /* ---- 横向 + 跳过禁用项 ---- */
  let moves = [];
  let roving = flRoving({
    container: $('h'),
    items: function () { return allH; },
    movable: function () { return movableH; },
    axis: 'x',
    onMove: function (i, item, reason) { moves.push([i, item.id, reason]); },
  });

  /* ① → 移到下一项（且跳过禁用的 h2） */
  moves = [];
  key($('h1'), 'ArrowRight');
  out.next = { ok: moves.length === 1 && moves[0][0] === 1 && moves[0][1] === 'h3',
               why: JSON.stringify(moves) };

  /* ② 绕回：最后一项再按一次 ⇒ 回到第一项 */
  moves = [];
  key($('h3'), 'ArrowRight');
  out.loop = { ok: moves.length === 1 && moves[0][1] === 'h1', why: JSON.stringify(moves) };

  /* ④ Home / End */
  moves = [];
  key($('h3'), 'Home');
  key($('h3'), 'End');
  out.homeEnd = { ok: moves.length === 2 && moves[0][1] === 'h1' && moves[1][1] === 'h3',
                  why: JSON.stringify(moves) };

  /* ⑤ 禁用项不在可移动集合里：从 h1 按 ← 应绕到 h3（不是停住） */
  moves = [];
  key($('h1'), 'ArrowLeft');
  out.skipDisabled = { ok: moves.length === 1 && moves[0][1] === 'h3',
                       why: JSON.stringify(moves) };

  /* ⑥ rove()：全集里只有一个 0，禁用项也必须是 -1 */
  roving.rove($('h3'));
  const t = allH.map((el) => el.getAttribute('tabindex'));
  out.rove = { ok: t[0] === '-1' && t[1] === '-1' && t[2] === '0', why: t.join(',') };

  /* ⑦ 取模对大步长也对：n=2 时 step(0, -3) 应为 1（夹逼写法会返回 -1 不动） */
  out.bigStep = { ok: roving.step(0, -3) === 1, why: String(roving.step(0, -3)) };

  /* ⑧ destroy 之后不再响应 */
  roving.destroy();
  moves = [];
  key($('h1'), 'ArrowRight');
  out.destroy = { ok: moves.length === 0, why: JSON.stringify(moves) };

  /* ⑨ tabindex:false ⇒ 核只管步进，一个 tabindex 都不许写。
     ⭐ 为什么必须有这一条：APG 菜单的菜单项按规范**全部 -1**
        （dropdown-check 里就有一条在守）。若核悄悄把某项改成 0，
        菜单就多出一个 Tab 停靠点，"Tab 用来关闭菜单"这条契约当场失效。
        ⇒ 这不是可选项，是**有没有被遵守**的问题。 */
  let cm = [];
  const rc = flRoving({
    container: $('v'),
    items: function () { return [$('v1'), $('v2'), $('v3')]; },
    axis: 'y',
    tabindex: false,
    onMove: function (i, item) { cm.push(item.id); },
  });
  cm = [];
  key($('v1'), 'ArrowDown');
  const movedNoTab = cm.length === 1 && cm[0] === 'v2';
  rc.rove($('v2'));
  const tabsUntouched = [$('v1'), $('v2'), $('v3')]
    .every((el) => !el.hasAttribute('tabindex'));
  out.noTab = { ok: movedNoTab && tabsUntouched,
                why: 'moved=' + JSON.stringify(cm) + ' 有tabindex=' +
                     [$('v1'), $('v2'), $('v3')].filter((el) => el.hasAttribute('tabindex')).length };
  rc.destroy();

  /* ---- 纵向：↑↓ 生效，←→ 不生效 ---- */
  const allV = [$('v1'), $('v2'), $('v3')];
  let vm = [];
  const rv = flRoving({
    container: $('v'),
    items: function () { return allV; },
    axis: 'y',
    onMove: function (i, item) { vm.push(item.id); },
  });
  vm = [];
  key($('v1'), 'ArrowDown');
  const downOk = vm.length === 1 && vm[0] === 'v2';
  vm = [];
  key($('v1'), 'ArrowRight');
  const rightIgnored = vm.length === 0;
  out.axis = { ok: downOk && rightIgnored,
               why: 'down=' + JSON.stringify(vm) + ' rightIgnored=' + rightIgnored };

  /* ---- ③ loop=false：走到边界不动 ---- */
  let nm = [];
  const rn = flRoving({
    container: $('v'),
    items: function () { return allV; },
    axis: 'y',
    loop: false,
    onMove: function (i, item) { nm.push(item.id); },
  });
  key($('v3'), 'ArrowDown');
  out.noLoop = { ok: nm.length === 0, why: JSON.stringify(nm) };
  rn.destroy();
  rv.destroy();

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
  next: '① 横向：→ 移到下一项',
  loop: '② 绕回：最后一项再按一次回到第一项',
  homeEnd: '④ Home / End 跳首末',
  skipDisabled: '⑤ 移动只在可用子集里（跳过禁用项）',
  rove: '⑥ rove() 让全集里只有一个 tabindex="0"',
  bigStep: '⑦ 取模循环对大步长也对',
  destroy: '⑧ destroy 之后不再响应',
  noTab: '⑨ tabindex:false ⇒ 只步进，一个 tabindex 都不写',
  axis: '①b 纵向：↑↓ 生效，←→ 不生效',
  noLoop: '③ loop=false：走到边界不动',
};

(async () => {
  const raw = fs.readFileSync(CORE, 'utf8');

  if (process.argv.includes('--selftest')) {
    const mutants = [
      ['取模改成 if 夹逼（⇒ 大步长时不动）',
        /if \(loop\) return \(\(i \+ d\) % n \+ n\) % n;/,
        'if (loop) { var t2 = i + d; return (t2 < 0) ? -1 : (t2 >= n ? -1 : t2); }'],
      ['rove 只管可移动项（⇒ 禁用项的 tabindex 漏掉）',
        /var l = all\(\) \|\| \[\];/, 'var l = movable() || [];'],
      ['去掉 Home / End',
        /if \(homeEnd && k === 'Home'\)/, "if (false && k === 'Home')"],
      ['忽略 tabindex:false（⇒ APG 菜单会多出 Tab 停靠点）',
        /if \(!roveTab\) return target;/, 'if (false) return target;'],
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
      if (caught) console.log('  [OK]   判据抓到突变：' + why);
      else { console.log('  [FAIL] 突变没被抓到 ⇒ 门禁是瞎的：' + why); bad++; }
    }
    const ok = await run(raw);
    const allGreen = Object.keys(NAMES).every((k) => ok.out[k].ok) && !ok.errs.length;
    if (allGreen) console.log('  [OK]   原样九条全绿（判据没有误报）');
    else {
      console.log('  [FAIL] 原样就有不通过的项 ⇒ 判据过严');
      Object.keys(NAMES).forEach((k) => {
        if (!ok.out[k].ok) console.log('        %s ⇒ %s', NAMES[k], ok.out[k].why);
      });
      bad++;
    }
    process.exit(bad ? 1 : 0);
  }

  const r = await run(raw);
  console.log('');
  console.log('  === roving 核契约 ===');
  if (r.errs.length) console.log('    X 页面报错：' + r.errs.join(' | '));
  let bad = 0;
  for (const k of Object.keys(NAMES)) {
    const v = r.out[k];
    if (!v.ok) bad++;
    console.log('    %s %s%s', v.ok ? 'OK  ' : 'X   ', NAMES[k], v.ok ? '' : '  ⇒ ' + v.why);
  }
  console.log('');
  if (bad || r.errs.length) {
    console.log('  ❌ ' + (bad || r.errs.length) + ' 项不满足');
    process.exit(1);
  }
  console.log('  ✅ roving 核契约全部满足');
})();
