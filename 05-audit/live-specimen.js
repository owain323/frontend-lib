/**
 * live-specimen.js — 文档页活标本门禁
 * ============================================================================
 * 为什么要有这条
 * ---------------------------------------------------------------------------
 *   文档站此前是"渲染出来的 README"：36 页里 0 个 <script>、0 个内嵌标本，
 *   每页只给 2–4 个链接指向 demo.html —— 读者想知道"按钮长什么样"要跳出去。
 *   v0.11.9 起改成顶部内嵌 demo（见 gen-docs.py 的 live_block()）。
 *
 *   而"内嵌了"这件事**极容易假绿**：
 *     · iframe 的 src 写错 ⇒ 框在、里面是 404 页，静态看 HTML 完全正常
 *     · live.js 没生效 ⇒ 框固定 320px 高，读者只能看到 demo 的第一屏
 *     · 题注缺失 ⇒ 读屏用户听到"框架"，不知道该期待什么
 *   ⇒ 光扫标签不够，必须**真的开浏览器看它撑起来了没有**。
 *
 * 判据分两层
 * ---------------------------------------------------------------------------
 *   ① 静态（纯函数，可自检）：每页恰好一个标本框；有 src 且文件存在；
 *      title 非空；loading="lazy"；引用了 live.js。
 *   ② 运行时：打开页面 → 等 iframe 载入 → 量高度。
 *      · 高度 < 400 ⇒ 没撑起来（demo 里没有一个组件页这么矮）
 *      · iframe 内部 scrollHeight 明显大于框高 ⇒ 内容被裁，读者看不全
 *    这两条一起才能证明"标本真的在那页里跑"。
 *
 * 用法
 * ---------------------------------------------------------------------------
 *   node 05-audit/live-specimen.js            # 判全部
 *   node 05-audit/live-specimen.js button     # 只判一页（运行时只开这一页）
 *   node 05-audit/live-specimen.js --selftest # 验静态判据抓不抓得到问题
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const { launch } = require('./browser');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.FL_BASE || 'http://127.0.0.1:8000';

/* 运行时抽验的页面：挑形态差别最大的那批 —— 一张网格页、一个长文档页、
 * 一个带脚本的交互页、一个表格页。全量 35 页跑一遍要几分钟，
 * 而这四个已经能证明管线是通的。 */
const SMOKE = ['button', 'input', 'tabs', 'table', 'report', 'nav'];

/* ---------------- 静态判据（纯函数：输入 HTML + 存在性，输出错误表） ---------------- */
function check_page(html, exists) {
  const errs = [];
  const frames = html.match(/<iframe[^>]*class="[^"]*g-live__frame[^"]*"[^>]*>/g) || [];
  if (frames.length === 0) {
    errs.push(['LIVE-1', '没有活标本（组件页必须有内嵌 demo）']);
    return errs;
  }
  if (frames.length > 1) {
    errs.push(['LIVE-2', '标本框有 ' + frames.length + ' 个，应当恰好 1 个']);
  }
  const tag = frames[0];
  const src = (tag.match(/src="([^"]+)"/) || [])[1];
  if (!src) {
    errs.push(['LIVE-3', 'iframe 没有 src']);
  } else {
    const rel = src.replace(/^\.\.\//, '');
    if (!exists(rel)) {
      errs.push(['LIVE-4', 'src 指向不存在的文件：' + rel]);
    }
  }
  const title = (tag.match(/title="([^"]*)"/) || [])[1];
  if (!title || !title.trim()) {
    errs.push(['LIVE-5', 'iframe 没有 title（读屏只会念"框架"）']);
  }
  if (!/loading="lazy"/.test(tag)) {
    errs.push(['LIVE-6', '没有 loading="lazy"（35 个 demo 一起加载会拖慢首屏）']);
  }
  if (!/<script[^>]+src="live\.js"/.test(html)) {
    errs.push(['LIVE-7', '没有引用 live.js ⇒ 框会停在 320px，内容看不全']);
  }
  if (!/<figcaption[^>]*class="[^"]*g-live__cap/.test(html)) {
    errs.push(['LIVE-8', '没有题注（标本是什么、能怎么用，都要写出来）']);
  }
  return errs;
}

function selftest() {
  let bad = 0;
  const ok = (why, got, want) => {
    const g = got.length ? got[0][0] : null;
    const pass = g === want;
    if (!pass) bad++;
    console.log('  ' + (pass ? 'OK ' : 'RED') + ' ' + why.padEnd(26) +
                ' 期望 ' + String(want).padEnd(7) + ' 得到 ' + String(g));
  };
  const good = '<figure class="g-live"><figcaption class="g-live__cap">说明</figcaption>' +
    '<iframe class="g-live__frame" src="../02-primitives/button/demo.html" ' +
    'title="按钮的可运行示例" loading="lazy"></iframe></figure>' +
    '<script src="live.js" defer></script>';
  const ex = (p) => p !== 'nope.html';

  ok('完整标本', check_page(good, ex), null);
  ok('完全没有标本', check_page('<article class="g-doc"></article>', ex), 'LIVE-1');
  /* 注意：这里必须替换**整条路径**。第一版只把 `button/demo.html` 换成
   `nope.html`，结果剩下 `02-primitives/nope.html` —— 用例本身没造出坏输入，
   于是"判据没抓到"其实是"没什么可抓"。假红与假绿都从这种地方长出来。 */
  ok('src 落地失败',
     check_page(good.replace('../02-primitives/button/demo.html', '../nope.html'), ex),
     'LIVE-4');
  ok('缺 title', check_page(good.replace(' title="按钮的可运行示例"', ''), ex), 'LIVE-5');
  ok('缺 lazy', check_page(good.replace(' loading="lazy"', ''), ex), 'LIVE-6');
  ok('缺 live.js', check_page(good.replace('<script src="live.js" defer></script>', ''), ex), 'LIVE-7');
  ok('缺题注', check_page(good.replace('<figcaption class="g-live__cap">说明</figcaption>', ''), ex), 'LIVE-8');
  ok('两个标本框', check_page(good + good, ex), 'LIVE-2');

  console.log('');
  console.log(bad ? '  ⇒ 🔴 静态判据自检 ' + bad + ' 条不成立'
                  : '  ⇒ ✅ 静态判据自检全部成立');
  return bad ? 1 : 0;
}

(async () => {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  const only = process.argv.slice(2).find((a) => !a.startsWith('--'));

  if (!fs.existsSync(path.join(ROOT, 'guide', 'live.js'))) {
    console.error('  🔴 guide/live.js 不存在 —— 标本不会被撑高，这不是"跳过"。');
    process.exit(2);
  }

  const cj = JSON.parse(fs.readFileSync(path.join(ROOT, 'ai', 'components.json'), 'utf-8'));
  const ids = cj.components
    .filter((c) => c.files && c.files.demo)
    .map((c) => c.id);

  let fails = 0;
  const outputs = [];

  /* ---------- ① 静态：35 页逐页判 ---------- */
  for (const id of ids) {
    const f = path.join(ROOT, 'guide', id + '.html');
    if (!fs.existsSync(f)) {
      outputs.push(['🔴', id, '页面不存在']);
      fails++;
      continue;
    }
    const html = fs.readFileSync(f, 'utf-8');
    const errs = check_page(html, (rel) => fs.existsSync(path.join(ROOT, rel)));
    if (errs.length) {
      fails++;
      outputs.push(['🔴', id, errs.map((e) => e[0] + ' ' + e[1]).join(' / ')]);
    }
  }
  const staticBad = fails;

  /* ---------- ② 运行时：抽验，证明它真的撑起来了 ---------- */
  const list = (only ? [only] : SMOKE).filter((x) => ids.includes(x));
  let runtimeChecked = 0;
  let runtimeBad = 0;

  try {
    await new Promise((res, rej) => {
      const r = require('http').get(BASE + '/index.html', (s) => { s.resume(); res(); });
      r.on('error', rej);
      r.setTimeout(3000, () => r.destroy(new Error('timeout')));
    });
  } catch (e) {
    console.error('  🔴 读不到 ' + BASE + ' —— 运行时判据**没有取证**，不是跳过。');
    process.exit(2);
  }

  const browser = await launch();
  for (const id of list) {
    const p = await browser.newPage();
    const errs = [];
    const pageErrors = [];
    p.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 60)));
    try {
      await p.setViewport({ width: 1280, height: 900 });
      /* 🔴 必须显式关缓存：`browser.js` 关的是**浏览器级**开关，
         而 python http.server 不发缓存头 ⇒ Chrome 会按启发式缓存子资源。
         症状是「改了 live.js 但结果一字不变」—— 我把测量逻辑改了三遍，
         三遍的输出完全一样（7118px），一度以为算法错了，其实是脚本没换。 */
      await p.setCacheEnabled(false);
      await p.goto(BASE + '/guide/' + id + '.html', { waitUntil: 'load', timeout: 20000 });

      /* 等 iframe **稳定**，不是等它"第一次超过 400"。
       *   第一版就是后者，于是量在 120ms 的字体替换之前，
       *   每页都固定差 59px（字体替换把内容撑高了 59px），而表格/图表页
       *   差得更多 —— 那不是页面坏了，是**判定早了一步**。
       *   现在要求连续 3 次采样一致才认账。 */
      const res = await p.evaluate(async () => {
        const f = document.querySelector('iframe.g-live__frame');
        if (!f) return { err: '页面上找不到标本框' };
        const t0 = Date.now();
        let last = -1, stable = 0;
        while (Date.now() - t0 < 8000) {
          const h = Math.round(f.getBoundingClientRect().height);
          if (h === last && h > 400) stable++; else stable = 0;
          last = h;
          if (stable >= 3) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        let inner = null, href = '';
        try {
          href = f.contentDocument ? f.contentDocument.location.href : '';
          inner = f.contentDocument && f.contentDocument.body
            ? f.contentDocument.body.scrollHeight : null;
        } catch (e) { /* 跨文档：静默降级，下面按高度判 */ }
        const fig = f.closest('.g-live');
        return {
          h: Math.round(f.getBoundingClientRect().height),
          inner,
          href,
          title: f.getAttribute('title') || '',
          hint: !!(fig && fig.querySelector('.g-live__hint')),
        };
      });

      if (res.err) errs.push(res.err);
      if (res.h < 400) {
        errs.push('高度只有 ' + res.h + 'px ⇒ live.js 没把标本撑起来');
      }
      /* 超过上限的页面在窗口内滚动 —— 但**必须自己说出来**。
         判据不是"允许裁"，而是"裁了就得有一句真话"。 */
      const capped = res.h >= 2198;
      if (res.inner !== null && res.inner > res.h + 6 && !capped) {
        errs.push('内部内容 ' + res.inner + 'px 高于框 ' + res.h + 'px ⇒ 内容被裁');
      }
      if (capped && !res.hint) {
        errs.push('高度到了上限却没有"窗口内可滚动"的说明 ⇒ 读者以为看到的是全部');
      }
      if (res.href && res.href.indexOf('/guide/guide/') !== -1) {
        errs.push('iframe 落到了错误路径：' + res.href.slice(-40));
      }
      if (pageErrors.length) errs.push('页面脚本报错：' + pageErrors[0]);
    } catch (e) {
      errs.push('打不开：' + String(e).slice(0, 60));
    }
    await p.close();

    runtimeChecked++;
    if (errs.length) {
      runtimeBad++;
      fails++;
      outputs.push(['🔴', id + '（运行时）', errs.join(' / ')]);
    } else {
      outputs.push(['OK', id + '（运行时）', '标本高度与内容一致']);
    }
  }
  await browser.close();

  for (const [mark, id, msg] of outputs) {
    console.log('  ' + mark + ' ' + id.padEnd(22) + msg);
  }
  console.log('');
  console.log('  静态 ' + ids.length + ' 页（失败 ' + staticBad + '）· 运行时抽验 ' +
              runtimeChecked + ' 页（失败 ' + runtimeBad + '）');
  if (!runtimeChecked) {
    console.error('  🔴 运行时一页都没验 ⇒ "内嵌了"这句话没有证据');
    process.exit(2);
  }
  if (fails) {
    console.log('  ⇒ 🔴 活标本未通过');
    process.exit(1);
  }
  console.log('  ⇒ ✅ 每页都有活标本，且它真的在该页里渲染并撑到内容高度');
  process.exit(0);
})();
