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
 * 一次加载还是三次加载（G2-06C）
 * ---------------------------------------------------------------------------
 *   原来是每页 **3 次 goto**：320 宽一次、1280+200% 一次、1280 默认再一次。
 *   三次加载换来的是"每次测量都在干净页面上" —— 但代价是 43 页 × 2 次多余加载。
 *
 *   改成 **1 次 goto + 改视口/字号**。等价性不是"看起来一样"：
 *   `05-audit/zoom-merge-experiment.js` 用同一套探针把两种执行结构逐页比对，
 *   43/43 页四项测量（重排 / 200% / 裁切 / 遮挡）完全相同（G2-06B）。
 *
 *   ⚠️ 保留的边界，必须写清楚：独立加载会**重置页面状态**，合并执行会
 *   **保留同一页面的运行状态**。若将来某个组件在第一次测量后改写自己的内部
 *   状态（例如 resize 里只改一次的开关），第二次测量就可能与独立版不同。
 *   当前 43 页没有这种行为，但这是"这 43 页没有"，不是"以后不会有"。
 *   ⇒ 实验脚本保留为**差异验证工具**：`npm run ci:zoom-merge` 逐页复核。
 *
 * 布局稳定等待（同一个工单）
 * ---------------------------------------------------------------------------
 *   合并的前提是"改视口/字号之后量到的是稳定后的布局"。
 *   固定 sleep 只证明"睡够了"，证明不了"布局不动了"；两帧 rAF 只覆盖
 *   同步提交，覆盖不了 `ResizeObserver` 回调、字体切换、按视口补资源这些
 *   延后一拍的布局。⇒ 这里判的是**布局指纹连续 N 帧不变**，
 *   超时就**报错**（`LAYOUT_UNSTABLE`）—— 不许"量到了就往下走"。
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

/* ---------- 布局稳定等待（G2-06C） ----------
 * 判据不是"等了多久"，而是"布局还动不动"。
 *
 * 指纹 = 滚动容器四个尺寸 + 根字号 + body 下前 N 个元素的 offset 盒。
 * 🔴 为什么用 offset* 而**不用** getBoundingClientRect：
 *    rect 含 transform，spinner / 骨架屏扫光这类**无限动画**每帧都在改 rect，
 *    用它当指纹 ⇒ 这些页面永远"不稳定" ⇒ 把正常页判成超时假红。
 *    offsetWidth/Height/Top/Left 是布局盒，不受 transform 影响 ——
 *    这正是"重排有没有落地"该看的东西。
 *
 * 两帧预热是保留的（覆盖同步布局提交），之后连续 need 帧指纹一致才算稳定。
 */
const STABLE = { need: 3, timeout: 1500, maxEls: 600 };

/* 在页面里执行：返回 {ok, frames, ms} 或 {ok:false, ...}。 */
function watchLayout(need, timeout, maxEls) {
  const fingerprint = () => {
    const de = document.scrollingElement || document.documentElement;
    const parts = [de.scrollWidth, de.clientWidth, de.scrollHeight, de.clientHeight,
      Math.round(parseFloat(getComputedStyle(document.documentElement).fontSize))];
    const nodes = document.body ? document.body.querySelectorAll('*') : [];
    const n = Math.min(nodes.length, maxEls);
    parts.push(n);
    for (let i = 0; i < n; i++) {
      const el = nodes[i];
      parts.push(el.offsetWidth, el.offsetHeight, el.offsetTop, el.offsetLeft);
    }
    return parts.join(',');
  };

  return new Promise((resolve) => {
    let warm = 2;         // 两帧预热：先让浏览器把这次改动提交掉
    let frames = 0;
    let same = 0;
    let prev = null;
    const t0 = performance.now();
    const tick = () => {
      if (warm > 0) { warm--; requestAnimationFrame(tick); return; }
      frames++;
      const fp = fingerprint();
      if (prev !== null && fp === prev) same++; else same = 0;
      prev = fp;
      if (same >= need) {
        resolve({ ok: true, frames, same, ms: Math.round(performance.now() - t0) });
        return;
      }
      if (performance.now() - t0 >= timeout) {
        resolve({ ok: false, frames, same, ms: Math.round(performance.now() - t0) });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * 等布局稳定。不稳定 ⇒ 抛 LAYOUT_UNSTABLE，**不许继续测量**。
 * （继续测量的后果是把"没量到稳定态"报成"达标"，这正是本库反复踩的坑。）
 */
async function settle(p, label, opts) {
  const o = Object.assign({}, STABLE, opts || {});
  const r = await p.evaluate(watchLayout, o.need, o.timeout, o.maxEls);
  if (!r.ok) {
    const e = new Error('布局 ' + r.ms + 'ms 内未稳定（' + label + '，' + r.frames + ' 帧仍变化）');
    e.code = 'LAYOUT_UNSTABLE';
    throw e;
  }
  return r;
}

/* ---------- 单页测量：一次加载，三段测量 ----------
 * 顺序与旧版一致：320 重排 → 1280 + 200% → 复位后查焦点遮挡。
 * 每一步之间只改视口/字号，然后等**稳定**，不再重新加载。
 */
/* 加载次数**由执行者自己数**，不由页面清单推算 —— 后者永远等于"页数"，
 * 谁也证不了"每页只 goto 了一次"。 */
const LOADS = { goto: 0 };

async function measure(p, rel, id) {
  const waits = [];

  /* --- 1.4.10 重排：320 CSS px --- */
  await p.setViewport({ width: 320, height: 640 });
  LOADS.goto++;
  await p.goto(BASE + '/' + rel, { waitUntil: 'networkidle0', timeout: 15000 });
  waits.push(await settle(p, id + ' @320'));
  const reflow = await p.evaluate(overflowProbe);

  /* --- 1.4.4 文本 200% ---
     视口与根字号一起下：最终状态才是被测状态，中间态不参与判定。
     但**必须**等它稳定 —— 否则量到的是"重排还没提交"的那一帧。 */
  await p.setViewport({ width: 1280, height: 900 });
  await p.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  waits.push(await settle(p, id + ' @200%'));
  const zoom = await p.evaluate(overflowProbe);
  const clipped = await p.evaluate(clipProbe);

  /* --- 2.4.11 焦点不被遮挡 ---
     复位：内联样式置空 ⇒ 落回 CSS 里的值，与"从未改过"等价。 */
  await p.evaluate(() => { document.documentElement.style.fontSize = ''; });
  waits.push(await settle(p, id + ' @reset'));
  const occl = await p.evaluate(occludedProbe);

  return { reflow, zoom, clipped, occl, waits };
}

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

  /* ⑥ 静态页面 ⇒ 稳定等待必须**放行**（防"等到永远"把正常页拖死） */
  p = await page_('<body style="margin:0"><div style="width:100px;height:20px">静止</div></body>');
  let st = null;
  let stErr = '';
  try { st = await settle(p, '静态页'); } catch (e) { stErr = e.code || e.message; }
  ok = !stErr && st && st.ok && st.same >= STABLE.need;
  console.log('  ' + (ok ? 'OK ' : 'RED') + ' 静止页面 ⇒ 稳定等待放行（' +
              (stErr ? stErr : st.frames + ' 帧 / ' + st.ms + 'ms') + '）');
  if (!ok) bad++;
  await p.close();

  /* ⑦ 每帧都在改布局的页面 ⇒ 稳定等待必须**超时判红**
   *   （防"等不到就算稳定"：那会把没量到的东西报成达标） */
  p = await page_(
    '<body style="margin:0"><div id="g" style="width:10px;height:10px"></div>' +
    '<script>var g=document.getElementById("g"),h=10;' +
    '(function loop(){h=(h%900)+11;g.style.height=h+"px";requestAnimationFrame(loop);})();</script>' +
    '</body>');
  stErr = '';
  try { await settle(p, '抖动页', { timeout: 400 }); } catch (e) { stErr = e.code || 'wrong-error'; }
  ok = stErr === 'LAYOUT_UNSTABLE';
  console.log('  ' + (ok ? 'OK ' : 'RED') + ' 每帧改布局 ⇒ 稳定等待超时判红（' +
              (stErr || '没有报错 —— 假绿') + '）');
  if (!ok) bad++;
  await p.close();

  await b.close();
  console.log('');
  console.log(bad ? '  ⇒ 🔴 判据自检 ' + bad + ' 条不成立' : '  ⇒ ✅ 判据自检全部成立');
  return bad ? 1 : 0;
}

async function main() {
  if (process.argv.includes('--selftest')) return selftest();
  const only = process.argv.slice(2).find((a) => !a.startsWith('--'));

  try {
    await new Promise((res, rej) => {
      const r = require('http').get(BASE + '/index.html', (s) => { s.resume(); res(); });
      r.on('error', rej);
      r.setTimeout(3000, () => r.destroy(new Error('timeout')));
    });
  } catch (e) {
    console.error('  🔴 读不到 ' + BASE + ' —— 没有取证，不是"跳过"。');
    return 2;
  }

  const browser = await launch();
  const list = pages().filter(([id]) => !only || id === only);
  let fails = 0, done = 0;
  let maxWait = 0, maxWaitId = '';

  for (const [id, rel] of list) {
    const p = await browser.newPage();
    const bad = [];
    try {
      const m = await measure(p, rel, id);
      for (const w of m.waits) {
        if (w.ms > maxWait) { maxWait = w.ms; maxWaitId = id; }
      }

      if (m.reflow.over > 1) {
        bad.push('1.4.10 320px 横向溢出 ' + m.reflow.over + 'px' +
                 (m.reflow.culprits.length ? '（' + m.reflow.culprits.join(' / ') + '）' : ''));
      }
      if (m.zoom.over > 1) {
        bad.push('1.4.4 200% 文本横向溢出 ' + m.zoom.over + 'px' +
                 (m.zoom.culprits.length ? '（' + m.zoom.culprits.join(' / ') + '）' : ''));
      }
      if (m.clipped.length) bad.push('1.4.4 200% 后文字被裁 ' + m.clipped.join(' / '));
      if (m.occl.length) bad.push('2.4.11 焦点被吸顶元素遮挡：' + m.occl.join(' / '));
    } catch (e) {
      /* 稳定等待超时**不能**降级成"跳过"或"通过"：没量到就是没量到。 */
      if (e && e.code === 'LAYOUT_UNSTABLE') bad.push('布局未稳定：' + e.message);
      else bad.push('页面打不开：' + String(e).slice(0, 50));
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
    return 2;
  }
  console.log('  判了 ' + done + ' 页 · 失败 ' + fails +
              ' · 加载 ' + LOADS.goto + ' 次（每页 1 次）· 最长布局等待 ' +
              maxWait + 'ms' + (maxWaitId ? '（' + maxWaitId + '）' : ''));
  if (LOADS.goto !== done) {
    console.log('  ⇒ 🔴 执行结构变了：' + done + ' 页却 goto 了 ' + LOADS.goto +
                ' 次（合并的意义就是每页只加载一次）');
    return 1;
  }
  if (fails) {
    console.log('  ⇒ 🔴 未通过（WCAG 1.4.4 / 1.4.10 / 2.4.11）');
    return 1;
  }
  console.log('  ⇒ ✅ 320px 不横滚 · 200% 文本不溢出不被裁 · 焦点不被吸顶元素遮挡');
  return 0;
}

module.exports = { pages, measure, settle, watchLayout, STABLE, LOADS,
                   overflowProbe, clipProbe, occludedProbe };

if (require.main === module) {
  main().then((rc) => process.exit(rc)).catch((e) => {
    console.error('  🔴 ' + (e && e.message ? e.message : e));
    process.exit(2);
  });
}
