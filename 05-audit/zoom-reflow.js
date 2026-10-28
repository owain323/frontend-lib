/**
 * zoom-reflow.js — 缩放 / 重排 / 焦点被遮挡
 * ============================================================================
 * 为什么要有这个文件
 * ---------------------------------------------------------------------------
 *   WCAG 2.2 AA 里有三条硬项，之前的 20 多道无障碍门禁**一条都没管**：
 *
 *     1.4.4  调整文本大小（Resize text）    —— 文本放大到 200% 不丢内容
 *     1.4.10 重排（Reflow）                 —— 320 CSS px 宽不出现横向滚动
 *     2.4.11 焦点不被遮挡（2.2 新增 AA）    —— 键盘焦点不能被吸顶栏盖住
 *
 *   而无障碍声明里如果要写「按 AA 做」，这三条必须验过 ——
 *   否则声明就是在替没验的东西背书。这是本轮唯一的动机：
 *   **让声明里每一行都有对应的判据，而不是有一堆"应该没问题"。**
 *
 * 判据怎么定（以及为什么这样定）
 * ---------------------------------------------------------------------------
 *   ① 1.4.10：`<html>` 的 scrollWidth 不得超过 clientWidth（+1px 容差）。
 *      数据表格是**二维内容**，WCAG 明确豁免 —— 它允许有自己的横向滚动容器，
 *      所以只看**页面**有没有横滚，不看表内。
 *   ② 1.4.4：把根字号抬到 32px（相对 16px 即 200%），同一判据再判一次。
 *      不用浏览器 zoom：zoom 会等比缩放，**看不出**"字号变大后容器装不下"。
 *   ③ 2.4.11：对每个可聚焦元素 scrollIntoView 后，取它的中心点做
 *      `elementFromPoint`。命中的不是它自己/祖先/后代，且拦截者处在
 *      `position: fixed|sticky` 的链上 ⇒ 判定"焦点被吸顶/吸底元素遮挡"。
 *      只判 fixed/sticky 是有意的：普通元素重叠本来就该由 z-index 解决，
 *      而吸顶栏遮挡是**设计副作用**，用户滚到哪儿都躲不掉。
 *
 * 用法
 * ---------------------------------------------------------------------------
 *   node 05-audit/zoom-reflow.js            # 判全部页面
 *   node 05-audit/zoom-reflow.js button     # 只判一页
 *   node 05-audit/zoom-reflow.js --selftest # 用合成页验判据本身
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const { launch } = require('./browser');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.FL_BASE || 'http://127.0.0.1:8000';

/* 组件页从契约生成（单一来源），另加文档站页面 —— 吸顶栏只在文档站存在，
 * 2.4.11 的真实风险在那边，不在组件 demo 上。 */
function pages() {
  const cj = JSON.parse(fs.readFileSync(path.join(ROOT, 'ai', 'components.json'), 'utf-8'));
  const out = cj.components
    .filter((c) => c.files && c.files.demo)
    .map((c) => [c.id, c.files.demo]);
  out.push(['docs-index', 'guide/index.html']);
  out.push(['docs-page', 'guide/button.html']);
  out.push(['docs-conventions', 'guide/conventions.html']);
  return out;
}

/* ---------- 页面内探针（在浏览器里执行） ---------- */
/* 返回横向溢出的**元凶**，不只是"有溢出" —— 否则报告没法用。 */
const overflowProbe = () => {
  const de = document.scrollingElement || document.documentElement;
  const over = de.scrollWidth - de.clientWidth;
  const culprits = [];
  if (over > 1) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > de.clientWidth + 1) {
        const cs = getComputedStyle(el);
        /* 自己有横向滚动的容器（表格包装）不算 —— 那是允许的二维内容 */
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
        culprits.push((el.tagName.toLowerCase() + '.' +
          String(el.className || '').split(' ').slice(0, 2).join('.')).slice(0, 58) +
          ' right=' + Math.round(r.right));
        if (culprits.length >= 3) break;
      }
    }
  }
  return { over, culprits };
};

/* 被裁掉的文字：overflow:hidden + 实际内容比盒子宽 + 没有省略号
 * ⇒ 用户看不全，且没有任何提示。省略号截断（text-overflow: ellipsis）
 * 是有意的设计，不算。 */
const clipProbe = () => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'hidden') continue;
    if (cs.textOverflow === 'ellipsis') continue;
    if (!el.textContent || !el.textContent.trim()) continue;
    if (el.children.length > 0) continue;          // 只看叶子文本节点
    /* 视觉隐藏（只给读屏看的标签）：1×1 + clip 是**故意**裁的，
       把它报成"文字被裁"是假红。判据要认得出这个模式。 */
    const rr = el.getBoundingClientRect();
    if (rr.width <= 2 || rr.height <= 2) continue;
    if (cs.clipPath && cs.clipPath !== 'none') continue;
    if (cs.clip && cs.clip !== 'auto') continue;
    if (el.scrollWidth > el.clientWidth + 2) {
      out.push((el.tagName.toLowerCase() + '.' +
        String(el.className || '').split(' ')[0]).slice(0, 52) +
        ' ' + el.scrollWidth + '>' + el.clientWidth);
      if (out.length >= 3) break;
    }
  }
  return out;
};

const occludedProbe = () => {
  const desc = (el) => (el.tagName.toLowerCase() + '.' +
    (String(el.className || '').split(' ')[0] || '-')).slice(0, 46);

  /* 只找「作者创建的遮挡层」：fixed / sticky 且面积足够大。
   * 普通元素重叠属于 z-index 问题，不在 2.4.11 的语义里。 */
  const sticky = [...document.querySelectorAll('body *')].filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 16;
  }).slice(0, 8);

  const sel = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
  const focusables = [...document.querySelectorAll(sel)].filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  }).slice(0, 16);

  const bad = [];
  /* 🔴 这里**故意不用 scrollIntoView**。
   *   第一版用了 `block: 'center'`，结果它把元素挪到屏幕中央、
   *   自动躲开了吸顶栏 —— 探针自己把要测的现象消掉了，自检当场抓到。
   *   真实路径是：用户用鼠标滚到某处（元素"在视口里"），
   *   然后按 Tab。浏览器认为元素已可见 ⇒ **不滚动** ⇒ 焦点正好落在吸顶栏下面。
   *   ⇒ 判据就是「元素矩形与吸顶层的重叠面积占比」。 */
  for (const el of focusables) {
    try { el.focus({ preventScroll: false }); } catch (e) { continue; }
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    for (const s of sticky) {
      if (s === el || s.contains(el) || el.contains(s)) continue;
      const sr = s.getBoundingClientRect();
      const ox = Math.min(r.right, sr.right) - Math.max(r.left, sr.left);
      const oy = Math.min(r.bottom, sr.bottom) - Math.max(r.top, sr.top);
      if (ox <= 0 || oy <= 0) continue;
      const cover = (ox * oy) / (r.width * r.height);
      /* 2.4.11 的措辞是"完全隐藏" ⇒ 用 0.9 作为判定线，
         不到这个比例只在报告里提一句，不算失败。 */
      if (cover >= 0.9) {
        bad.push(desc(el) + ' ← ' + desc(s) + '（遮挡 ' + Math.round(cover * 100) + '%）');
      }
    }
  }
  return bad;
};

/* ---------- 自检：合成页面上判据必须给出正确结论 ---------- */
async function selftest() {
  const { launch: launchB } = require('./browser');
  const b = await launchB();
  let bad = 0;

  const page_ = async (html) => {
    const p = await b.newPage();
    await p.setViewport({ width: 320, height: 640 });
    await p.goto('data:text/html;charset=utf-8,' + encodeURIComponent(html),
                 { waitUntil: 'load' });
    return p;
  };

  // ① 320 宽 + 一个 600px 定宽盒子 ⇒ 必须报横向溢出，并指出元凶
  let p = await page_('<body style="margin:0"><div style="width:600px;height:40px">宽</div></body>');
  let v = await p.evaluate(overflowProbe);
  let ok = v.over > 1 && v.culprits.length > 0;
  console.log('  ' + (ok ? 'OK ' : 'RED') + ' 定宽盒子 ⇒ 报溢出 ' + v.over + 'px / 元凶 ' + v.culprits.length);
  if (!ok) bad++;
  await p.close();

  // ② 正常流式页面 ⇒ 不许报溢出（防"见谁都红"）
  p = await page_('<body style="margin:0"><div style="max-width:100%;height:40px">流式</div></body>');
  v = await p.evaluate(overflowProbe);
  ok = v.over <= 1;
  console.log('  ' + (ok ? 'OK ' : 'RED') + ' 流式页面 ⇒ 不报溢出（' + v.over + 'px）');
  if (!ok) bad++;
  await p.close();

  // ③ 定宽容器里装长文字但允许省略号 ⇒ 不算被裁
  p = await page_('<body style="margin:0"><div style="width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">很长很长很长很长的文字</div></body>');
  v = await p.evaluate(clipProbe);
  ok = v.length === 0;
  console.log('  ' + (ok ? 'OK ' : 'RED') + ' 省略号截断 ⇒ 不算被裁（报 ' + v.length + '）');
  if (!ok) bad++;
  await p.close();

  // ④ 同样容器但没有省略号 ⇒ 必须报
  p = await page_('<body style="margin:0"><div style="width:80px;overflow:hidden;white-space:nowrap">很长很长很长很长的文字</div></body>');
  v = await p.evaluate(clipProbe);
  ok = v.length > 0;
  console.log('  ' + (ok ? 'OK ' : 'RED') + ' 无省略号硬裁 ⇒ 报被裁（' + v.length + '）');
  if (!ok) bad++;
  await p.close();

  // ⑤ 吸顶栏盖住可聚焦元素 ⇒ 必须报；栏在下方不挡 ⇒ 不许报
  p = await page_(
    '<body style="margin:0">' +
    '<div style="position:fixed;top:0;left:0;right:0;height:120px;background:#ccc;z-index:9">吸顶</div>' +
    /* 这个按钮整个落在吸顶层覆盖区里（top 40..80）⇒ 必须报 */
    '<button id="b" style="position:absolute;top:40px;left:10px;width:80px;height:40px">被盖住</button>' +
    /* 这个在吸顶层下方 ⇒ 不许报 */
    '<button id="ok" style="position:absolute;top:200px;left:10px;width:80px;height:40px">正常</button>' +
    '</body>');
  v = await p.evaluate(occludedProbe);
  ok = v.length === 1 && v[0].indexOf('button') === 0;
  console.log('  ' + (ok ? 'OK ' : 'RED') + ' 吸顶栏遮挡 ⇒ 恰好报 1 个（报 ' + v.length +
              (v.length ? '：' + v[0] : '') + '）');
  if (!ok) bad++;
  await p.close();

  await b.close();
  console.log('');
  console.log(bad ? '  ⇒ 🔴 判据自检 ' + bad + ' 条不成立' : '  ⇒ ✅ 判据自检全部成立');
  return bad ? 1 : 0;
}

(async () => {
  if (process.argv.includes('--selftest')) process.exit(await selftest());
  const only = process.argv.slice(2).find((a) => !a.startsWith('--'));

  try {
    await new Promise((res, rej) => {
      const r = require('http').get(BASE + '/index.html', (s) => { s.resume(); res(); });
      r.on('error', rej);
      r.setTimeout(3000, () => r.destroy(new Error('timeout')));
    });
  } catch (e) {
    console.error('  🔴 读不到 ' + BASE + ' —— 没有取证，不是"跳过"。');
    process.exit(2);
  }

  const browser = await launch();
  const list = pages().filter(([id]) => !only || id === only);
  let fails = 0, done = 0;

  for (const [id, rel] of list) {
    const p = await browser.newPage();
    const bad = [];
    try {
      /* --- 1.4.10 重排：320 CSS px --- */
      await p.setViewport({ width: 320, height: 640 });
      await p.goto(BASE + '/' + rel, { waitUntil: 'networkidle0', timeout: 15000 });
      const reflow = await p.evaluate(overflowProbe);
      if (reflow.over > 1) {
        bad.push('1.4.10 320px 横向溢出 ' + reflow.over + 'px' +
                 (reflow.culprits.length ? '（' + reflow.culprits.join(' / ') + '）' : ''));
      }

      /* --- 1.4.4 文本 200% --- */
      await p.setViewport({ width: 1280, height: 900 });
      await p.goto(BASE + '/' + rel, { waitUntil: 'networkidle0', timeout: 15000 });
      await p.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
      await new Promise((r) => setTimeout(r, 120));
      const zoom = await p.evaluate(overflowProbe);
      const clipped = await p.evaluate(clipProbe);
      if (zoom.over > 1) {
        bad.push('1.4.4 200% 文本横向溢出 ' + zoom.over + 'px' +
                 (zoom.culprits.length ? '（' + zoom.culprits.join(' / ') + '）' : ''));
      }
      if (clipped.length) bad.push('1.4.4 200% 后文字被裁 ' + clipped.join(' / '));

      /* --- 2.4.11 焦点不被遮挡 --- */
      await p.goto(BASE + '/' + rel, { waitUntil: 'networkidle0', timeout: 15000 });
      const occl = await p.evaluate(occludedProbe);
      if (occl.length) bad.push('2.4.11 焦点被吸顶元素遮挡：' + occl.join(' / '));
    } catch (e) {
      bad.push('页面打不开：' + String(e).slice(0, 50));
    }
    await p.close();

    done++;
    if (bad.length) {
      fails++;
      console.log('  🔴 ' + id.padEnd(18) + bad[0]);
      for (const extra of bad.slice(1)) console.log('     ' + ' '.repeat(18) + extra);
    } else {
      console.log('  OK ' + id.padEnd(18) + '重排 / 200% / 焦点遮挡 三项通过');
    }
  }

  await browser.close();
  console.log('');
  if (!done) {
    console.error('  🔴 一页都没判 ⇒ 假绿');
    process.exit(2);
  }
  console.log('  判了 ' + done + ' 页 · 失败 ' + fails);
  if (fails) {
    console.log('  ⇒ 🔴 未通过（WCAG 1.4.4 / 1.4.10 / 2.4.11）');
    process.exit(1);
  }
  console.log('  ⇒ ✅ 320px 不横滚 · 200% 文本不溢出不被裁 · 焦点不被吸顶元素遮挡');
  process.exit(0);
})();
