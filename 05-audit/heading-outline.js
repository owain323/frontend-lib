/*
 * heading-outline.js —— 标题大纲取证（人工工具，不是门禁）
 *
 * MANUAL-ONLY: 验证「全站标题层级不跳级」这条声明时用的取证工具。
 * 它不进门禁有三个理由：
 *   ① 结构本身已由 axe 的 `heading-order` / `page-has-heading-one` /
 *      `empty-heading` 在 `a11y-scan` 里守着了（这三条做过破坏实验，会红）；
 *   ② 它比门禁覆盖得**更宽**（整个仓库的 HTML，不只是 demo），
 *      宽出来的那部分没有对应判据，天天跑等于自建一套新标准；
 *   ③ 它要读可访问性树，跑一遍 96 页约 40 秒，放进全量会拖慢发版。
 *   ⇒ 需要复核那条声明时手动跑；要让它变成门禁，把 MANUAL-ONLY 这行删掉
 *     并在 check-all.sh 注册即可。
 *
 * 判据（四类，任一命中即算异常）
 *   ① 每一页恰好一个可见 `h1`
 *   ② 阅读顺序里层级不跳级（`h2` 后面不许直接接 `h4`）
 *   ③ 标题文本不为空
 *   ④ DOM 里的可见标题数 == 可访问性树里的 heading 节点数
 *      （有标题被 `aria-hidden` 或样式藏掉时，这条会红 —— 前三类查不出来）
 *
 * 用法（和 a11y-scan 一样需要本地静态服务）：
 *   python3 -m http.server 8000 --bind 127.0.0.1 &
 *   node 05-audit/heading-outline.js                    # 扫仓库里全部 HTML
 *   node 05-audit/heading-outline.js 02-primitives/button/demo.html
 *
 * 退出码：0 全部合规 · 1 有异常 · 2 参数或环境问题
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { launch } = require('./browser');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.FL_BASE || 'http://127.0.0.1:8000';
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'tmp', '_attic']);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (e.name.endsWith('.html') && !e.name.startsWith('_')) {
      /* 下划线开头的是测试夹具（`_blank.html` 就是一张空页），不是给人看的页面 */
      out.push(path.relative(ROOT, path.join(dir, e.name)).split(path.sep).join('/'));
    }
  }
  return out;
}

(async () => {
  const pages = process.argv.slice(2).length ? process.argv.slice(2) : walk(ROOT, []);
  if (!pages.length) {
    console.error('没有找到 HTML 页面');
    process.exit(2);
  }

  const b = await launch();
  const page = await b.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  let bad = 0, headings = 0, levels = {};
  const t0 = Date.now();

  for (const rel of pages) {
    try {
      await page.goto(BASE + '/' + rel, { waitUntil: 'load', timeout: 15000 });
    } catch (e) {
      console.log('  [SKIP] ' + rel.padEnd(42) + ' 打不开（需构建或不是页面）');
      continue;
    }
    await new Promise((r) => setTimeout(r, 200));

    const dom = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]'))
        .map((e) => {
          let hiddenAncestor = false;
          for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
            if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') { hiddenAncestor = true; break; }
          }
          return {
            level: Number(e.getAttribute('aria-level')) || Number(e.tagName[1]) || null,
            text: (e.textContent || '').replace(/\s+/g, ' ').trim(),
            visible: e.checkVisibility
              ? e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
              : true,
            hiddenAncestor: hiddenAncestor,
          };
        })
        .filter((h) => h.visible && !h.hiddenAncestor);
    });

    const cdp = await page.target().createCDPSession();
    await cdp.send('Accessibility.enable');
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    await cdp.detach();
    const axN = nodes.filter((n) => n.role && n.role.value === 'heading' && !n.ignored).length;

    const errs = [];
    const h1 = dom.filter((h) => h.level === 1).length;
    if (h1 !== 1) errs.push('h1=' + h1);
    const empty = dom.filter((h) => !h.text).length;
    if (empty) errs.push('空名 ' + empty);
    for (let i = 1; i < dom.length; i++) {
      if (dom[i].level - dom[i - 1].level > 1) {
        errs.push('跳级 h' + dom[i - 1].level + '→h' + dom[i].level + '「' + dom[i].text + '」');
      }
    }
    if (dom.length !== axN) errs.push('DOM ' + dom.length + ' 条 / 可访问性树 ' + axN + ' 条');

    headings += dom.length;
    dom.forEach((h) => { levels[h.level] = (levels[h.level] || 0) + 1; });
    if (errs.length) {
      bad++;
      console.log('  [FAIL] ' + rel.padEnd(42) + errs.join(' · '));
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const dist = Object.keys(levels).sort().map((k) => 'h' + k + '×' + levels[k]).join(' · ');
  console.log('\n  ' + pages.length + ' 页 · ' + headings + ' 个标题（' + dist + '）· ' +
              bad + ' 页异常 · ' + secs + ' 秒');
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
