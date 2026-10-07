/*
 * skeleton-lever-check.js — 「一根全局杠杆，真能牵动所有页面」的可证伪检查
 *
 * ============================================================================
 * 🔴 为什么需要这道门禁（0.4.2）
 * ----------------------------------------------------------------------------
 * 事故原话：「只要稍微去修改一下全局的，比方说有 14 个页面要改，那么立刻崩。」
 *
 * 0.4.2 把页面骨架收编进 01-tokens/page.css 一处，并加了 shell-gate 拦住
 * 「页面重抄骨架」。但那两件事都只证明**没有第二份定义**，
 * 证明不了用户真正要的那个结果：
 *
 *     「我现在改一处，所有页面**真的**跟着变了吗？」
 *
 * 这正是本库已经栽过的坑型：**改了输入，输出没动**（当时是截图门禁在量另一棵树）。
 * 所以这里不读源码、不做静态推断，只在**真浏览器**里量：
 *
 *     L1  改 --measure-page          ⇒ 每页 .wrap 的计算宽度都变
 *     L2  改 --fs-2xl                ⇒ 每页 h1 的计算字号都变
 *     L3  改 --sp-6                  ⇒ 每页 body 的计算内边距都变
 *
 * ============================================================================
 * 反向控制（不许只证"能变"，还要证"不该变的没变"）
 * ----------------------------------------------------------------------------
 *   R1  **不选配骨架的宿主页面**（examples/react-vite，自带令牌、不引 page.css）
 *       在我们的杠杆下**必须纹丝不动** ——
 *       否则说明骨架在污染宿主，而这个库的卖点正是"组件只影响自己"。
 *   R2  **页面自己的东西**（.demo-grid 之类）不该被骨架令牌牵动。
 *
 *   没做反向控制的门禁不算门禁：判据写宽了，它会永远绿。
 *
 * ============================================================================
 * 附带判据：横向溢出（"改全局就崩"最直观的形态）
 * ----------------------------------------------------------------------------
 *   每一页在 320 / 393 两个宽度下 `scrollWidth <= clientWidth + 1`。
 *   收窄列宽、放大字号最容易撞的就是这条。
 *
 * 用法
 * ----------------------------------------------------------------------------
 *   node 05-audit/skeleton-lever-check.js
 * ============================================================================
 */
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.dirname(__dirname);
const { launch } = require(process.env.FL_BROWSER || path.join(__dirname, 'browser.js'));

const SKIP = ['node_modules', '.git', 'benchmark', '05-audit', 'prefixed',
              'examples', '04-recipes/longform'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

// 三个杠杆：(令牌[, 第二个令牌], 值, 量哪个元素, 取哪个计算属性, 名字)
// 🔴 L1 一次改两个令牌（--measure-page + --measure-prose）：
//    `.wrap` 的宽度由其中一个决定（列表页用 --measure-page，长文页用
//    --measure-prose 的 `.wrap--prose`）。只改一个会把"用的是另一个令牌"
//    误判成"页面没吃骨架"—— 我第一次跑就被自己这个判据坑了一次。
const LEVERS = [
  [['--measure-page', '--measure-prose'], '20rem', '.wrap', 'maxWidth', 'L1 列宽'],
  [['--fs-2xl'], '40px', 'h1', 'fontSize', 'L2 一级标题字号'],
  [['--sp-6'], '7px', 'body.page', 'paddingTop', 'L3 页面框内边距'],
];

// ============================================================================
// 已知例外：**打印出来**，不静默放过
// ----------------------------------------------------------------------------
// ⚠️ 这张表不是"免检名单"，是"还没修完的账"。每次跑都会打出来提醒。
// ============================================================================
const KNOWN_OVERFLOW = [
  {
    file: '02-primitives/popover/demo.html',
    why: '.popover--end / --bottom 是**绝对定位、按锚点外侧**弹出的浮层（最小 200px）。' +
         '窄屏上锚点右侧根本没有 200px 空间，而本库**不做 JS 落点检测**（这是刻意的：' +
         '定位靠 CSS、不靠测量）⇒ 关闭状态的浮层仍然占着滚动溢出区，把整页撑出横向滚动。' +
         '修法二选一：① popover.js 加落点检测（碰撞时翻到 --start）；' +
         '② 演示页给浮层演示区一个 overflow-x 容器。**未修**。',
  },
];

function walk(dir, out) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? dir + '/' + e.name : e.name;
    if (SKIP.some((s) => rel.startsWith(s) || e.name === s)) continue;
    if (e.isDirectory()) {
      if (e.name.startsWith('.')) continue;
      walk(rel, out);
    } else if (e.name.endsWith('.html') && !e.name.includes('_baseline')) {
      out.push(rel);
    }
  }
  return out;
}

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) ||
          fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end(''); return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      });
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const MEASURE = (sel, prop) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  return getComputedStyle(el)[prop];
};

(async () => {
  const files = walk('', []);
  const srv = await serve();
  const port = srv.address().port;
  const base = 'http://127.0.0.1:' + port + '/';

  let browser;
  const problems = [];
  const notes = [];
  const seenKnown = new Set();
  let pages = 0, leverHits = 0, leverMiss = 0;

  try {
    browser = await launch();

    // ---------------------------------------------------------- 主循环
    for (const rel of files) {
      const page = await browser.newPage();
      await page.setViewport({ width: 393, height: 800 });
      await page.goto(base + rel, { waitUntil: 'load', timeout: 20000 });
      pages += 1;

      // 横向溢出
      for (const w of [320, 393]) {
        await page.setViewport({ width: w, height: 800 });
        const ov = await page.evaluate(() => {
          const de = document.documentElement;
          return { sw: de.scrollWidth, cw: de.clientWidth };
        });
        if (ov.sw > ov.cw + 1) {
          const known = KNOWN_OVERFLOW.find((k) => k.file === rel);
          if (known) {
            seenKnown.add(rel);
          } else {
            problems.push(rel + ' @' + w + 'px 横向溢出：scrollWidth ' + ov.sw +
                          ' > clientWidth ' + ov.cw);
          }
        }
      }
      await page.setViewport({ width: 393, height: 800 });

      // 三个杠杆
      for (const [toks, val, sel, prop, label] of LEVERS) {
        const before = await page.evaluate(MEASURE, sel, prop);
        if (before === null) {
          notes.push(rel + ' 没有 ' + sel + '（跳过 ' + label + '）');
          continue;
        }
        await page.evaluate((ts, v) => {
          ts.forEach((t) => document.documentElement.style.setProperty(t, v));
        }, toks, val);
        const after = await page.evaluate(MEASURE, sel, prop);
        if (after === before) {
          problems.push(rel + ' ' + label + '：改了 ' + toks.join(' + ') + '（' + val +
                        '），' + sel + ' 的 ' + prop + ' 仍是 ' + before +
                        ' —— 页面没吃骨架');
          leverMiss += 1;
        } else {
          leverHits += 1;
        }
      }
      await page.close();
    }

    // ------------------------------------------------- 反向控制 R1
    // 宿主样板：自带令牌、**不引** page.css，骨架杠杆对它必须无效
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 393, height: 800 });
      await page.goto(base + 'examples/react-vite/index.html', { waitUntil: 'load' });
      const before = await page.evaluate(() => {
        const app = document.querySelector('.app');
        const cs = getComputedStyle(app);
        return { w: cs.maxWidth, fs: getComputedStyle(document.body).fontSize };
      });
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--measure-page', '20rem');
        document.documentElement.style.setProperty('--fs-2xl', '40px');
        document.documentElement.style.setProperty('--sp-6', '7px');
      });
      const after = await page.evaluate(() => {
        const app = document.querySelector('.app');
        const cs = getComputedStyle(app);
        return { w: cs.maxWidth, fs: getComputedStyle(document.body).fontSize };
      });
      await page.close();
      if (before.w !== after.w || before.fs !== after.fs) {
        problems.push('反向控制失败：宿主样板（不引 page.css、不写 class="page"）' +
                      '被骨架令牌改动了 —— maxWidth ' + before.w + '→' + after.w +
                      '，body 字号 ' + before.fs + '→' + after.fs);
      } else {
        console.log('  [OK] 反向控制：不选配骨架的宿主页面不受骨架令牌影响' +
                    '（.app max-width 始终 ' + before.w + '）');
      }
    }

    // ------------------------------------------------- 反向控制 R2
    // 页面自己的 class 不该被骨架令牌牵动
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 393, height: 800 });
      await page.goto(base + '03-patterns/list/demo.html', { waitUntil: 'load' });
      const probe = await page.evaluate(() => {
        const el = document.querySelector('.row, .demo-grid, .scroll-list');
        return el ? el.className : null;
      });
      if (probe) {
        const before = await page.evaluate(() => {
          const el = document.querySelector('.row, .demo-grid, .scroll-list');
          return getComputedStyle(el).gap + '|' + getComputedStyle(el).display;
        });
        await page.evaluate(() => {
          document.documentElement.style.setProperty('--measure-page', '20rem');
          document.documentElement.style.setProperty('--fs-2xl', '40px');
        });
        const after = await page.evaluate(() => {
          const el = document.querySelector('.row, .demo-grid, .scroll-list');
          return getComputedStyle(el).gap + '|' + getComputedStyle(el).display;
        });
        if (before !== after) {
          problems.push('反向控制失败：页面局部元素（' + probe +
                        '）被骨架令牌牵动了（' + before + ' → ' + after + '）');
        } else {
          console.log('  [OK] 反向控制：页面局部元素（' + probe +
                      '）不受骨架令牌影响');
        }
      }
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    srv.close();
  }

  console.log('');
  console.log('  扫了 ' + pages + ' 个页面');
  console.log('  杠杆命中 ' + leverHits + ' 次 / 未命中 ' + leverMiss + ' 次');

  if (notes.length && notes.length <= 12) {
    notes.forEach((n) => console.log('  [注] ' + n));
  } else if (notes.length) {
    console.log('  [注] 另有 ' + notes.length + ' 条"页面没有这个元素"');
  }

  // 已知例外：每次都打出来（不静默）
  KNOWN_OVERFLOW.forEach((k) => {
    const hit = seenKnown.has(k.file) ? '本次确实溢出' : '本次没溢出（可能已修）';
    console.log('  [已知例外] ' + k.file + '（' + hit + '）');
    console.log('      ' + k.why);
  });

  if (problems.length) {
    problems.forEach((p) => console.log('  [FAIL] ' + p));
    console.log('\n  ⇒ 「改一处全局，所有页面跟着变」**不成立**。');
    console.log('    修法：把页面里那份骨架定义删掉，改成吃 01-tokens/page.css。');
    process.exit(1);
  }
  console.log('\n  [OK] 三个全局杠杆在每一页都真的生效；横向无溢出；宿主页面不受影响');
})();
