const { launch } = require('./browser.js');

/**
 * typeahead-check.js — 「首字母跳转 / 连续打字定位」微行为核的行为契约
 *
 * ============================================================================
 * 🔴 为什么需要
 * ----------------------------------------------------------------------------
 *   迁移前只有两处实现，且**各做了一半**：select 会累积但不循环、
 *   tree 会循环但不累积。⇒ "完整"这件事此前没有任何地方定义过，
 *   也没有任何门禁在守。
 *
 *   ⇒ 这六条判据就是那份定义，并且每一条都要能被改坏的实现点红。
 *
 * ============================================================================
 * 判据（六条）
 * ----------------------------------------------------------------------------
 *   ① 打一个字符 ⇒ 跳到下一个以该字符开头的项
 *   ② 连打同一个字符 ⇒ 在匹配项之间循环（不是停住）
 *   ③ 快速连打多个字符 ⇒ 缓冲累积，按前缀匹配
 *   ④ 停顿超过 timeout ⇒ 缓冲清空
 *   ⑤ 禁用项不参与匹配
 *   ⑥ 不匹配 ⇒ 不动（也不报错）
 *
 * ============================================================================
 * 反向控制：node 05-audit/typeahead-check.js --selftest
 *   改坏四处（从当前项开始找 / 去掉连打特判 / 去掉超时清空 / usable 恒真），
 *   每一次都必须被抓到。
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

const CORE = path.resolve(__dirname, '..', '01-tokens', 'behavior', 'typeahead.js');

const PAGE_HTML = `<!doctype html><meta charset="utf-8"><body>
<ol id="l">
  <li id="i0">Apple</li>
  <li id="i1">Banana</li>
  <li id="i2">Blackberry</li>
  <li id="i3">Cherry</li>
  <li id="i4">date</li>
</ol>
</body>`;

function probe() {
  const out = {};
  const $ = (id) => document.getElementById(id);
  const ids = ['i0', 'i1', 'i2', 'i3', 'i4'];
  const els = ids.map($);
  /* ⚠️ 必须防 undefined：突变体会让索引算出 -1 ⇒ l[-1] 是 undefined。
     探针自己先崩了，就变成"崩溃也算抓到"——那是假信号，
     我们要的是**判据**抓到它（② 该红），不是进程崩掉。 */
  const textOf = (el) => (el && el.textContent) || '';
  let hit = [];
  let ta = flTypeahead({
    items: function () { return els; },
    textOf: textOf,
    onHit: function (i, el) { hit.push(ids[i]); },
  });

  /* ① 打一个字符 ⇒ 跳到下一个以该字符开头的项 */
  hit = [];
  ta.type('b');
  out.first = { ok: hit.length === 1 && hit[0] === 'i1', why: JSON.stringify(hit) };

  /* ② 连打同一个字符 ⇒ 循环到下一个匹配项（不是停在 i1） */
  hit = [];
  ta.type('b');
  out.cycle = { ok: hit.length === 1 && hit[0] === 'i2', why: JSON.stringify(hit) };

  /* ②b 再连打一次 ⇒ 绕回第一个匹配项 */
  hit = [];
  ta.type('b');
  out.cycleBack = { ok: hit.length === 1 && hit[0] === 'i1', why: JSON.stringify(hit) };

  /* ③ 快速连打多个字符 ⇒ 累积前缀（"bl" ⇒ Blackberry） */
  let ta2 = flTypeahead({
    items: function () { return els; },
    textOf: textOf,
    onHit: function (i) { hit.push(ids[i]); },
  });
  hit = [];
  ta2.type('b');
  ta2.type('l');
  out.accum = { ok: hit.length === 2 && hit[1] === 'i2', why: JSON.stringify(hit) };

  /* ⑥ 不匹配 ⇒ 不动 */
  hit = [];
  ta2.type('q');
  out.noMatch = { ok: hit.length === 0, why: JSON.stringify(hit) };

  /* ⑤ 禁用项不参与匹配 */
  let ta3 = flTypeahead({
    items: function () { return els; },
    textOf: textOf,
    usable: function (el) { return !!el && el.id !== 'i1'; },   /* Banana 禁用 */
    onHit: function (i) { hit.push(ids[i]); },
  });
  hit = [];
  ta3.type('b');
  out.skipDisabled = { ok: hit.length === 1 && hit[0] === 'i2', why: JSON.stringify(hit) };

  ta.destroy();
  ta2.destroy();
  ta3.destroy();
  return out;
}

/* ④ 的真体验证要在 async 侧做（setTimeout 需要让出事件循环）*/
async function probeTimeout(coreSrc) {
  const b = await launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String((e && e.message) || e)));
  await p.setContent(PAGE_HTML);
  await p.addScriptTag({ content: coreSrc });
  const r = await p.evaluate(async () => {
    const els = ['i0', 'i1', 'i2', 'i3', 'i4'].map((id) => document.getElementById(id));
    const ta = flTypeahead({
      items: function () { return els; },
      textOf: (el) => (el && el.textContent) || '',
      timeout: 120,
      onHit: function () {},
    });
    ta.type('b');
    const before = ta.buffer();
    await new Promise((r) => setTimeout(r, 320));
    const after = ta.buffer();
    ta.destroy();
    return { before, after };
  });
  await b.close();
  return { r, errs };
}

const NAMES = {
  first: '① 打一个字符 ⇒ 跳到下一个匹配项',
  cycle: '② 连打同一字符 ⇒ 循环到下一个匹配项',
  cycleBack: '②b 再连打一次 ⇒ 绕回第一个匹配项',
  accum: '③ 快速连打多字符 ⇒ 按前缀累积匹配',
  noMatch: '⑥ 不匹配 ⇒ 不动（也不报错）',
  skipDisabled: '⑤ 禁用项不参与匹配',
  timeout: '④ 停顿超过 timeout ⇒ 缓冲清空',
};

async function run(coreSrc) {
  const b = await launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String((e && e.message) || e)));
  await p.setContent(PAGE_HTML);
  await p.addScriptTag({ content: coreSrc });
  const out = await p.evaluate(probe);
  await b.close();
  const t = await probeTimeout(coreSrc);
  out.timeout = {
    ok: t.r.before === 'b' && t.r.after === '',
    why: '输入后 buffer=' + JSON.stringify(t.r.before) + '，320ms 后=' + JSON.stringify(t.r.after),
  };
  errs.push(...t.errs);
  return { out, errs };
}

(async () => {
  const raw = fs.readFileSync(CORE, 'utf8');

  if (process.argv.includes('--selftest')) {
    const mutants = [
      ['从当前项开始找（含自身）⇒ 连打同一字符停住',
        /var i = \(last \+ 1 \+ k\) % n;/, 'var i = (last + k) % n;'],
      ['去掉连打同一字符的特判（"bb" 永远匹配不上）',
        /var needle = repeated\(buf\) \? buf\.charAt\(0\) : buf;/,
        'var needle = buf;'],
      ['去掉超时清空（缓冲永远不清）',
        /timer = setTimeout\(clear, timeout\);/, 'timer = null;'],
      ['usable 恒真（禁用项也参与匹配）',
        /if \(!usable\(l\[i\]\)\) continue;/, 'if (false) continue;'],
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
    const allGreen = Object.keys(ok.out).every((k) => ok.out[k].ok) && !ok.errs.length;
    if (allGreen) console.log('  [OK]   原样七条全绿（判据没有误报）');
    else {
      console.log('  [FAIL] 原样就有不通过的项 ⇒ 判据过严');
      Object.keys(ok.out).forEach((k) => {
        if (!ok.out[k].ok) console.log('        %s ⇒ %s', k, ok.out[k].why);
      });
      bad++;
    }
    process.exit(bad ? 1 : 0);
  }

  const r = await run(raw);
  console.log('');
  console.log('  === typeahead 核契约 ===');
  if (r.errs.length) console.log('    X 页面报错：' + r.errs.join(' | '));
  let bad = 0;
  for (const k of Object.keys(r.out)) {
    const v = r.out[k];
    if (!v.ok) bad++;
    console.log('    %s %s%s', v.ok ? 'OK  ' : 'X   ', NAMES[k] || k, v.ok ? '' : '  ⇒ ' + v.why);
  }
  console.log('');
  if (bad || r.errs.length) {
    console.log('  ❌ ' + (bad || r.errs.length) + ' 项不满足');
    process.exit(1);
  }
  console.log('  ✅ typeahead 核契约全部满足');
})();
