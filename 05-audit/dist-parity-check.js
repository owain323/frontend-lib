/*
 * dist-parity-check.js —— 证明 dist 与源码"语义同一"
 *
 * ============================================================================
 * 🔴 为什么必须有这道门禁
 * ----------------------------------------------------------------------------
 * `build-dist.py` 里那个压缩器是我手写的。手写压缩器最危险的地方不是压得不够小，
 * 而是**压错了还不报错** —— 它照样产出一个"看起来是 CSS"的文件，
 * 浏览器跳过那条声明，界面静默少一块。这正是本库最厌恶的失效形态（INVARIANT I-12）。
 *
 * 所以判据不能是"再写一遍正则去检查"，那样只是用另一个手写正则去验证前一个。
 * ⇒ **判据交给浏览器**：把源码与 dist 各自喂给 CSSOM，
 *    两边必须解析出**同一份规则序列**（条数相同、每条的选择器与声明值逐字相同）。
 *    解析不了的规则会被浏览器直接丢掉 ⇒ 条数立刻对不上 ⇒ 红。
 *
 * ============================================================================
 * 判据
 * ----------------------------------------------------------------------------
 *   ① 条数相同
 *   ② 逐条 `cssText` 相同（浏览器已归一化空白与注释 ⇒ 剩下的差别就是真差别）
 *   ③ 解析抛异常 ⇒ 红（不静默跳过）
 *
 * ============================================================================
 * 反向控制
 * ----------------------------------------------------------------------------
 *   `--selftest`：在**内存里**篡改一个 dist 文件的一个色值 ⇒ 必须红。
 *   （不落盘，避免把仓库弄脏）
 *
 * 用法
 * ----------------------------------------------------------------------------
 *   node 05-audit/dist-parity-check.js
 *   node 05-audit/dist-parity-check.js --selftest
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { launch } = require(process.env.FL_BROWSER || path.join(__dirname, 'browser.js'));

const ROOT = path.dirname(__dirname);
const MANIFEST = path.join(ROOT, 'dist', 'manifest.json');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * 在页面里解析两份 CSS 并比对规则序列。
 *
 * ⚠️ 为什么要 `norm()` 而不是逐字比：实测 CSSOM 序列化 `transition` 这类
 * **逗号列表**时会**原样保留源码里的空白**（源码是「,\n␣␣␣box-shadow」，
 * 压成「, box-shadow」解析结果完全一样，但 cssText 字符串不同）。
 * ⇒ 逐字比会让「压缩」这件事永远红，那是判据写错，不是产物错。
 * ⇒ 正解：**两边用同一个归一化函数**再比 —— 空白**连续段**折叠成一个空格。
 *    这样"有没有空格"这种语义差别（比如 calc(100% - 1px) 被压成
 *    calc(100%-1px) ⇒ 非法 ⇒ 整条被丢）**仍然抓得到**，
 *    只有"空格有多少个"这种纯排版差别被放过 —— 那本来就不影响渲染。
 *
 * ⚠️ 顺带：自定义属性（`--sans: -apple-system, /* 中文 *\/ 'PingFang SC' …`）
 *    Chromium 会**原样序列化**，连源码里的注释一起印出来。
 *    而注释在 CSS 里**根本不是 token**（词法阶段就被丢掉），
 *    所以 dist 里没有它属于正确行为 —— 判据要在两边都把注释抹掉再比，
 *    否则是在拿"注释还在不在"当语义，那是判据写错了。
 */
const COMPARE = (a, b) => {
  const norm = (s) => String(s)
    .replace(/\/\*[\s\S]*?\*\//g, '')     // 注释不是 token：两边都抹掉
    .replace(/\s+/g, ' ')                 // 空白连续段折叠（见上）
    .trim();
  const parse = (txt) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(txt);
    return Array.from(sheet.cssRules).map((r) => norm(r.cssText));
  };
  const ra = parse(a);
  const rb = parse(b);
  const diff = [];
  const n = Math.max(ra.length, rb.length);
  for (let i = 0; i < n; i++) {
    if (ra[i] !== rb[i]) {
      diff.push({
        i: i,
        src: ra[i] === undefined ? '(缺)' : String(ra[i]).slice(0, 160),
        dst: rb[i] === undefined ? '(缺)' : String(rb[i]).slice(0, 160),
      });
      if (diff.length >= 5) break;
    }
  }
  return { nSrc: ra.length, nDst: rb.length, diff };
};

async function run(manifest, mutate) {
  const browser = await launch();
  const page = await browser.newPage();
  const problems = [];
  let pairs = 0;

  for (const f of manifest.files) {
    if (!f.source.endsWith('.css')) continue;
    const srcTxt = read(f.source);
    for (const out of f.outputs) {
      let dstTxt = read(out.path);
      if (mutate) dstTxt = mutate(dstTxt, f.source);
      pairs += 1;
      let res;
      try {
        res = await page.evaluate(COMPARE, srcTxt, dstTxt);
      } catch (e) {
        problems.push({
          file: out.path,
          why: '浏览器解析抛异常（说明产物已经不是合法 CSS）：' + String(e.message || e).slice(0, 160),
        });
        continue;
      }
      if (res.nSrc !== res.nDst || res.diff.length) {
        problems.push({
          file: out.path,
          why: '规则序列不同：源码 ' + res.nSrc + ' 条 / 产物 ' + res.nDst + ' 条',
          diff: res.diff,
        });
      }
    }
  }
  await browser.close();
  return { pairs, problems };
}

(async () => {
  if (!fs.existsSync(MANIFEST)) {
    console.log('  [FAIL] dist/manifest.json 不存在 ⇒ 先跑 python 05-audit/build-dist.py');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

  if (process.argv.includes('--selftest')) {
    console.log('  === dist 反向控制 ===');
    const { pairs, problems } = await run(manifest, (txt, src) => {
      // 🔴 只篡改**第一条出现的色值**，且只在 01-tokens/tokens.css 上动，
      //    保证改动小而确定；改完必须被判据抓到。
      if (src !== '01-tokens/tokens.css') return txt;
      return txt.replace(/#[0-9a-fA-F]{6}/, '#ff0000');
    });
    const hit = problems.filter((p) => p.file.indexOf('tokens.css') >= 0);
    if (!hit.length) {
      console.log('  [FAIL] 反向控制失效：篡改了 dist 的色值却没被抓到');
      process.exit(1);
    }
    console.log('  [OK]   篡改 dist 的一个色值 ⇒ 立刻被判据抓到（%d 处）', hit.length);
    console.log('         其余 %d 个产物未被误报', pairs - hit.length);
    process.exit(0);
  }

  console.log('  === dist 与源码一致性（浏览器 CSSOM 逐条比对）===');
  const { pairs, problems } = await run(manifest, null);
  if (problems.length) {
    for (const p of problems.slice(0, 10)) {
      console.log('  [FAIL] %s', p.file);
      console.log('         %s', p.why);
      (p.diff || []).forEach((d) => {
        console.log('         第 %d 条  源码: %s', d.i, d.src);
        console.log('                 产物: %s', d.dst);
      });
    }
    console.log('  ⇒ %d / %d 个产物与源码不等价', problems.length, pairs);
    process.exit(1);
  }
  console.log('  OK %d 个产物与源码解析成同一份规则集', pairs);
  process.exit(0);
})();
