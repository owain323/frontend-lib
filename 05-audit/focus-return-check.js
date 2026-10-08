const { launch } = require('./browser.js');

/**
 * focus-return-check.js — 「焦点归位」微行为核的行为契约
 *
 * ============================================================================
 * 🔴 为什么需要
 * ----------------------------------------------------------------------------
 *   "记住焦点、关闭时还回去"只有两行，但**降级分支**有五个组件五种写法，
 *   其中至少一种是静默把焦点丢在 body 上 —— 键盘用户要从页面开头重新 Tab，
 *   而开发者完全看不出来（不报错、不告警）。
 *
 *   ⇒ 这些降级分支只有真实浏览器能判定，正则一条都判不出来。
 *
 * ============================================================================
 * 判据（六条）
 * ----------------------------------------------------------------------------
 *   ① save() 记住的是**当时**的焦点元素
 *   ② restore() 真的把焦点还回去（activeElement 变了，不是"调用了 focus"而已）
 *   ③ 原元素被移除 + 有 fallback ⇒ 退到 fallback
 *   ④ 原元素被移除 + 无 fallback ⇒ 返回 false 且**不抛错**
 *   ⑤ 焦点在 body 时 save() ⇒ 不把 body 当目标
 *   ⑥ restore() 之后清空 ⇒ 第二次 restore 不再把焦点拽回去
 *
 * ============================================================================
 * 反向控制
 * ----------------------------------------------------------------------------
 *   node 05-audit/focus-return-check.js --selftest
 *   把核改坏三处（去掉 contains 判断 / save 把 body 也记下来 /
 *   restore 不清空 saved），每一次都必须被判据抓到。
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

const CORE = path.resolve(__dirname, '..', '01-tokens', 'behavior', 'focus-return.js');

const PAGE_HTML = `<!doctype html><meta charset="utf-8">
<body>
  <button id="a">a</button>
  <button id="b">b</button>
  <button id="fb">fallback</button>
  <div id="victim"><button id="c">c</button></div>
</body>`;

function probe() {
  const out = {};
  const $ = (id) => document.getElementById(id);

  /* ① save() 记住的是当时焦点所在的元素 */
  $('a').focus();
  let fr = flFocusReturn({});
  const got = fr.save();
  out.save = { ok: got === $('a'), why: got && got.id };

  /* ② restore() 真的把焦点还回去 */
  $('b').focus();
  const ok2 = fr.restore();
  out.restore = { ok: ok2 === true && document.activeElement === $('a'),
                  why: 'active=' + (document.activeElement && document.activeElement.id) };

  /* ③ 原元素被移除 + 有 fallback ⇒ 退到 fallback */
  $('c').focus();
  let fr2 = flFocusReturn({ fallback: $('fb') });
  fr2.save();
  const victim = $('victim');
  victim.parentNode.removeChild(victim);
  const ok3 = fr2.restore();
  out.fallback = { ok: ok3 === true && document.activeElement === $('fb'),
                   why: 'active=' + (document.activeElement && document.activeElement.id) };

  /* ④ 原元素被移除 + 无 fallback ⇒ false，且不抛错 */
  const d = document.createElement('button');
  d.id = 'tmp';
  document.body.appendChild(d);
  d.focus();
  let fr3 = flFocusReturn({});
  fr3.save();
  d.parentNode.removeChild(d);
  let threw = false;
  let ok4 = null;
  try { ok4 = fr3.restore(); } catch (e) { threw = true; }
  out.gone = { ok: threw === false && ok4 === false, why: 'threw=' + threw + ' ret=' + ok4 };

  /* ⑤ 焦点在 body 上 ⇒ 不把 body 当目标 */
  if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
  document.body.focus();
  let fr4 = flFocusReturn({});
  const got5 = fr4.save();
  out.body = { ok: got5 === null, why: String(got5 && got5.tagName) };

  /* ⑥ restore() 之后清空 ⇒ 第二次不再拽回去 */
  $('a').focus();
  let fr5 = flFocusReturn({});
  fr5.save();
  $('b').focus();
  const first = fr5.restore();
  $('b').focus();                 /* 用户主动把焦点移走了 */
  const second = fr5.restore();   /* 不该又把焦点拽回 a */
  out.once = { ok: first === true && second === false
                   && document.activeElement === $('b'),
               why: 'first=' + first + ' second=' + second +
                    ' active=' + (document.activeElement && document.activeElement.id) };

  return out;
}

async function run(coreSrc) {
  const b = await launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  await p.setContent(PAGE_HTML);
  await p.addScriptTag({ content: coreSrc });
  await p.bringToFront();
  const out = await p.evaluate(probe);
  await b.close();
  return { out: out, errs: errs };
}

const NAMES = {
  save: '① save() 记住的是当时的焦点元素',
  restore: '② restore() 真的把焦点还回去',
  fallback: '③ 原元素没了 + 有 fallback ⇒ 退到 fallback',
  gone: '④ 原元素没了 + 无 fallback ⇒ 返回 false 且不抛错',
  body: '⑤ 焦点在 body 时不当作目标',
  once: '⑥ restore() 之后清空 ⇒ 第二次不再拽回去',
};

(async () => {
  const raw = fs.readFileSync(CORE, 'utf8');

  if (process.argv.includes('--selftest')) {
    const mutants = [
      ['去掉 contains 判断（⇒ 焦点掉在 body 上还以为还回去了）',
        /if \(!target \|\| !document\.contains\(target\)\)/, 'if (!target)'],
      ['save 把 body 也记下来（⇒ body 被当成目标）',
        /saved = \(a && a !== document\.body && a\.focus\) \? a : null;/,
        'saved = (a && a.focus) ? a : null;'],
      ['restore 不清空 saved（⇒ 第二次又把焦点拽回去）',
        /saved = null;   \/\* 见文档 ③ \*\//, '/* 篡改：不清空 */'],
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
    if (allGreen) console.log('  [OK]   原样六条全绿（判据没有误报）');
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
  console.log('  === focus-return 核契约 ===');
  if (r.errs.length) console.log('    X 页面报错：' + r.errs.join(' | '));
  let bad = 0;
  for (const k of Object.keys(NAMES)) {
    const v = r.out[k];
    if (!v.ok) bad++;
    console.log('    %s %s%s', v.ok ? 'OK  ' : 'X   ', NAMES[k],
      v.ok ? '' : '  ⇒ ' + v.why);
  }
  console.log('');
  if (bad || r.errs.length) {
    console.log('  ❌ ' + (bad || r.errs.length) + ' 项不满足');
    process.exit(1);
  }
  console.log('  ✅ focus-return 核契约全部满足');
})();
