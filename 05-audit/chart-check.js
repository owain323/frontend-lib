const fs = require('fs');
const path = require('path');

/**
 * chart-check.js — 图表契约门禁（charter 13 · 图表规范）
 *
 * ============================================================================
 * ⭐ 存在的理由
 * ============================================================================
 *   ① 异常值冲出图表范围，柱子**穿透了三张图**；
 *   ② 数值标注**压在柱子上**，右下角叠成一团。
 *
 * ⭐ 两条都不是"渲染 bug"，是**契约缺失**：
 *   ① SVG 的 `overflow` 默认是 `visible`（不是 hidden！）⇒ 超量程就穿透；
 *   ② 没有"标注不得覆盖数据"这条契约 ⇒ 逐柱标注必然重叠。
 *
 * ============================================================================
 * 🔴 本门禁的判据纪律（照 contract-kit 的 7 个坑，不重犯）
 * ============================================================================
 *   · **剥注释后再查**（Node 侧逐字符剥，不用正则）——否则注释里写
 *     `overflow: hidden` 就算"通过"，是假通过。
 *   · **不许只看"文本里有没有这个词"**——那是今晚踩过的坑。
 *   · 每条判据都要有**判别力验证**（注入缺陷 ⇒ 必须被抓到）。
 */

const ROOT = '${REPO}';
let bad = 0;
const out = [];
const pass = (ok, what) => { out.push({ ok: !!ok, what }); if (!ok) bad++; };

/**
 * 逐字符剥 CSS/JS 注释
 *
 * 🔴 **修一个假通过漏洞**（判别力验证② 抓到的）：
 *   原来用 `for` + `i++` + `continue` 的写法，
 *   在命中 `/*` 时 `i++` 已经多走一格，
 *   ⇒ 注释起始符的**第二个字符（`*`）被当普通字符输出了**，
 *   ⇒ 整段注释的边界判断错乱，**注释内容漏进结果**。
 *
 *   症状：把 `overflow: hidden` 只写进注释里，门禁竟然通过 ⇒ 假绿。
 *
 *   ⇒ 改成**下标 while + 显式 i += 2**，不依赖循环自增。
 */
function stripComments(t) {
  const r = [];
  let d = 0;           // 0=不在注释 1=在注释
  let i = 0;
  while (i < t.length) {
    if (d === 0) {
      if (t[i] === '/' && t[i + 1] === '*') { d = 1; i += 2; continue; }
      r.push(t[i]); i += 1;
    } else {
      if (t[i] === '*' && t[i + 1] === '/') { d = 0; i += 2; continue; }
      i += 1;
    }
  }
  return r.join('');
}

function read(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

/* ================================================================== *
 * 铁律一 · 超量程必须被容器裁剪
 * ================================================================== */

// 库里所有**自己画的** SVG 图表组件（排除 vendor 第三方）
const CHART_DIRS = ['09-assets/sparkline', '09-assets/bar', '09-assets/model-viewer'];

(function rule1() {
  for (const dir of CHART_DIRS) {
    const name = dir.split('/').pop();
    const css = read(dir + '/' + name + '.css');
    if (!css) continue;                 // 组件还不存在（bar 还没做）⇒ 跳过
    const body = stripComments(css);
    const js = stripComments(read(dir + '/' + name + '.js') || '');

    // 🔴 判据修正：**先看组件用什么渲染**
    //   · SVG  ⇒ `overflow` 默认 `visible` ⇒ **必须显式 hidden**（根因在这）
    //   · canvas ⇒ 位图**天然裁剪**在自身尺寸内 ⇒ 不需要这条规则
    //   （实测 model-viewer 用 canvas，之前门禁对它报"缺 overflow"是**假失败**。）
    const usesCanvas = /getContext\s*\(/.test(js) && !/createElementNS/.test(js);
    const usesSvg = /createElementNS/.test(js) || /\.sparkline\s+svg/.test(css);

    if (usesSvg) {
      // 判据 1：svg 元素上必须有 overflow: hidden
      // ⚠️ 不能只查"文件里有没有 overflow"—— 那个可能在别的规则上。
      const svgRules = body.match(/[^{}]*svg[^{}]*\{[^}]*\}/g) || [];
      const hasSvgClip = svgRules.some((r) => /overflow\s*:\s*hidden/.test(r));
      pass(hasSvgClip,
           '① ' + name + '.css：svg 上有 overflow:hidden' +
           (hasSvgClip ? '' : '  🔴 缺这条柱子会穿透到别的内容上（SVG 默认 overflow:visible）'));
    } else if (usesCanvas) {
      pass(true, '① ' + name + '：用 canvas 渲染（位图天然裁剪，无需 overflow）');
    } else {
      pass(true, '① ' + name + '：未检出渲染方式（跳过，见 ' + dir + '）');
    }

    // 判据 2：外层容器要裁（防"穿透到别的卡片"）—— 对两种渲染方式都适用
    const hasBoxClip = /overflow\s*:\s*hidden/.test(body);
    pass(hasBoxClip, '① ' + name + '.css：容器有 overflow:hidden');
  }
})();

/* ================================================================== *
 * 铁律二 · 标注不得覆盖数据
 * ================================================================== */
(function rule2() {
  for (const dir of CHART_DIRS) {
    const js = read(dir + '/' + dir.split('/').pop() + '.js');
    if (!js) continue;
    const body = stripComments(js);

    // 判据 1：如果有"标最大值"这类逻辑，必须能限制标注数量
    // 🔴 逐柱标注（对每个数据点都画文字）必然重叠 ⇒ 禁止
    const perBarLabel = /forEach\s*\([^)]*\)[\s\S]{0,400}?(textContent|innerHTML)\s*=/.test(body)
                     && /label|value|text/i.test(body);
    // 更直接的判据：数一下有几个"无条件给每根柱子写文字"的模式
    const writesLabel = (body.match(/(label|value|标注|数值)[^\n]{0,40}=\s*/gi) || []).length;
    pass(!perBarLabel || writesLabel <= 8,
         '② ' + dir.split('/').pop() + '.js：不是逐柱无条件标注（' +
         writesLabel + ' 处文字赋值，阈值 8）');

    // 判据 2：标注颜色不得用 presentation attribute 里的 var()
    // ⚠️ 规范没保证 Safari 支持，且 sparkline.css 里已经踩过这个坑
    const attrVar = /setAttribute\s*\(\s*['"](fill|stroke)['"]\s*,\s*['"]var\(/.test(body);
    pass(!attrVar,
         '② 标注颜色不走 setAttribute("fill","var(...)")（Safari 不可靠）');
  }
})();

/* ================================================================== *
 * 铁律三 · 量程必须显式声明
 * ================================================================== */
(function rule3() {
  for (const dir of CHART_DIRS) {
    const js = read(dir + '/' + dir.split('/').pop() + '.js');
    if (!js) continue;
    const body = stripComments(js);
    // 判据：不能"读数据里的最大值当量程"（那会让异常值压缩所有常态值）
    const autoMax = /Math\.max\s*\(\s*\.\.\./.test(body) && !/\bmax\b\s*[:=]/.test(body);
    pass(!autoMax,
         '③ ' + dir.split('/').pop() + '.js：量程不由数据自动决定（必须有显式 max）');
  }
})();

/* ================================================================== *
 * 报告
 * ================================================================== */
function report() {
  console.log('');
  console.log('  === 图表契约（charter 13）===');
  out.forEach((x) => console.log('    ' + (x.ok ? 'OK  ' : 'FAIL') + '  ' + x.what));
  console.log('');
  if (bad) {
    console.log('  ❌ 图表契约：' + bad + ' 项不满足');
    process.exit(1);
  }
  console.log('  ✅ 图表契约全部满足');
  process.exit(0);
}

/* ================================================================== *
 * 🔴🔴 结果级判据：堆叠必须**量**出来（外部评审 VIZ-REPORT-01 · P0-1）
 * ------------------------------------------------------------------ *
 *   上面四条查的都是"CSS / 源码里有没有某个写法" —— 那是**结构**。
 *   而"两个系列到底有没有叠起来"是**渲染结果**，结构对了结果照样能错：
 *
 *     实测事故：`Bar.draw()` 把累计数组成了每个系列的**局部变量**，
 *     ⇒ 系列二也从基线起算、还同宽同位 ⇒ 把系列一的底部整块盖住，
 *     ⇒ 图上看着像一根双色柱，读者读到的"总高"其实是**最后一个系列**。
 *     而这个版本的全部静态判据（含本文件）都是绿的。
 *
 *   ⇒ 判据必须从 SVG 里读真实坐标：
 *       · 堆叠：同一 x 上，上一段的**底边** == 下一段的**顶边**
 *       · 重叠（缺陷形态）：两段**底边**都落在基线上
 * ================================================================== */
const BAR_URL = 'http://127.0.0.1:8000/09-assets/bar/demo.html';

(async () => {
  let browser = null;
  try {
    const { launch } = require('./browser.js');
    browser = await launch();
    const page = await browser.newPage();
    await page.goto(BAR_URL, { waitUntil: 'networkidle0' });

    /* ⑤ 堆叠几何：同一类目上，各段首尾相接 */
    const geo = await page.evaluate(() => {
      const host = document.getElementById('b1');
      const rects = [...host.querySelectorAll('rect.bar__bar')].map((r) => ({
        x: +r.getAttribute('x'), y: +r.getAttribute('y'),
        h: +r.getAttribute('height'), w: +r.getAttribute('width'),
        clipped: r.getAttribute('data-clipped'),
      }));
      return { rects: rects, tops: window.__b1tops || null };
    });

    if (!geo.rects.length) {
      pass(false, '⑤ 堆叠几何：demo 里一根柱子都没有 ⇒ 判据无从生效（疑 JS 报错）');
    } else {
      const byX = {};
      geo.rects.forEach((r) => { (byX[r.x] = byX[r.x] || []).push(r); });
      const groups = Object.keys(byX);
      const baseline = Math.max(...geo.rects.map((r) => r.y + r.h));
      let joined = 0, overlapped = 0, groupsWith2 = 0;
      let worst = '';
      groups.forEach((x) => {
        const seg = byX[x].slice().sort((a, b) => a.y - b.y);   // y 小者在上
        if (seg.length < 2) return;
        groupsWith2++;
        /* 堆叠：每相邻两段，上段的底边 == 下段的顶边 */
        let ok = true;
        for (let i = 0; i < seg.length - 1; i++) {
          const gap = (seg[i].y + seg[i].h) - seg[i + 1].y;
          if (Math.abs(gap) > 0.02) ok = false;
          if (!worst) worst = 'gap=' + gap.toFixed(2);
        }
        if (ok) joined++;
        /* 重叠（修复前的形态）：两段的**底边**都落在基线上 */
        if (seg.every((s) => Math.abs((s.y + s.h) - baseline) < 0.02)) overlapped++;
      });
      pass(groupsWith2 > 0 && joined === groupsWith2 && overlapped === 0,
           '⑤ 堆叠几何：多系列首尾相接（不是同起点重叠）· ' +
           groupsWith2 + ' 组多段 · 相接 ' + joined + ' · 重叠 ' + overlapped +
           ' · 基线 y=' + baseline.toFixed(1) + ' ' + worst);
    }

    /* ⑥ 累计高度必须与数据相符 —— 不该只是"看起来叠起来了" */
    const cum = await page.evaluate(() => {
      const box = document.createElement('div');
      box.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(box);
      const r = window.Bar.draw({
        host: box,
        max: 100, height: 200,            /* ⇒ plotH = 200 - 14 - 22 = 164 */
        series: [
          { name: 'A', values: [10, 20] },
          { name: 'B', values: [30, 40] },
          { name: 'C', values: [60, 15] },
        ],
      });
      const rects = [...box.querySelectorAll('rect.bar__bar')].map((x) => ({
        x: +x.getAttribute('x'), y: +x.getAttribute('y'), h: +x.getAttribute('height'),
      }));
      const out = { tops: r.tops, mode: r.mode, rects: rects };
      box.remove();
      return out;
    });
    /* 两列的合计分别应为 100（10+30+60，顶到量程）与 75（20+40+15） */
    const tops = cum.tops || [];
    pass(tops.length === 2 && Math.abs(tops[0] - 100) < 1e-6 && Math.abs(tops[1] - 75) < 1e-6,
         '⑥ 累计高度 = 各系列之和【tops=' + JSON.stringify(tops) + '，应 [100, 75]】');

    /* 且必须真的画到那么高：整列的总像素高度 == 合计/量程 × plotH
       plotH = height(200) − padT(14) − padB(22) = 164 */
    const byCol = {};
    cum.rects.forEach((r) => { (byCol[r.x] = byCol[r.x] || []).push(r); });
    const cols = Object.keys(byCol).sort((a, b) => a - b);
    const heights = cols.map((x) => {
      const seg = byCol[x];
      const top = Math.min(...seg.map((s) => s.y));
      const bottom = Math.max(...seg.map((s) => s.y + s.h));
      return +(bottom - top).toFixed(2);
    });
    const expH = [164, (75 / 100) * 164];
    pass(heights.length === 2 &&
         Math.abs(heights[0] - expH[0]) < 0.5 &&
         Math.abs(heights[1] - expH[1]) < 0.5,
         '⑥ 画出来的柱高与合计相符【实测 ' + JSON.stringify(heights) +
         '，应 ' + JSON.stringify(expH.map((h) => +h.toFixed(2))) + '】');

    /* ⑦ 堆叠**合计**超出量程：单段都没超、加起来超了，也必须被裁掉并说明
       （这是堆叠独有的失败形态 —— 只查单段超没超抓不到） */
    const clip = await page.evaluate(() => {
      const host = document.getElementById('b1c');
      if (!host) return null;
      const rects = [...host.querySelectorAll('rect.bar__bar')].map((r) => ({
        y: +r.getAttribute('y'), h: +r.getAttribute('height'),
        c: r.getAttribute('data-clipped'),
      }));
      const noteEl = host.querySelector('.bar__note');
      return {
        n: rects.length,
        clipped: rects.filter((r) => r.c === '1').length,
        minTop: rects.length ? Math.min(...rects.map((r) => r.y)) : null,
        note: noteEl ? noteEl.textContent : '',
      };
    });
    if (!clip || !clip.n) {
      pass(false, '⑦ 合计超量程：找不到 #b1c 的柱子 ⇒ 判据无从生效');
    } else {
      /* demo 里 max=12，有 3 个类目合计 13 > 12 ⇒ 顶端应被压到绘图区顶(padT=14) */
      pass(clip.clipped > 0 && Math.abs(clip.minTop - 14) < 0.5 && /合计/.test(clip.note),
           '⑦ 合计超出量程会被裁且写明【被标记 ' + clip.clipped + ' 段 · 顶端 y=' +
           clip.minTop.toFixed(1) + '（应 14）· 脚注「' +
           clip.note.slice(0, 24) + '」】');
    }

    /* ⑧ 图例的色必须就是柱子的色 —— 否则图例在骗人 */
    const leg = await page.evaluate(() => {
      const host = document.getElementById('b1');
      const byClass = {};
      host.querySelectorAll('rect.bar__bar').forEach((r) => {
        const m = (r.getAttribute('class') || '').match(/bar__s(\d)/);
        if (m) byClass[m[1]] = getComputedStyle(r).fill;
      });
      return [...host.querySelectorAll('.bar__legend-swatch')].map((s) => {
        const m = (s.getAttribute('class') || '').match(/bar__s(\d)/);
        return { swatch: getComputedStyle(s).backgroundColor,
                 bar: m ? byClass[m[1]] : null,
                 name: (s.parentElement.textContent || '').trim() };
      });
    });
    const legendOk = leg.length >= 2 &&
      leg.every((x) => x.bar && x.swatch === x.bar) &&
      leg.every((x) => x.name && x.name.length > 0);
    pass(legendOk, '⑧ 图例色块与柱填充同色且有名字【' +
      leg.map((x) => x.name + ':' + x.swatch + ' vs ' + x.bar).join(' · ') + '】');
  } catch (e) {
    /* 🔴 浏览器起不来就**判失败**，不写"跳过"：
       P0-1 事故里上面四条静态判据全是绿的，正因为它们压根没看渲染结果。 */
    pass(false, '⑤⑥⑦⑧ 结果级判据：浏览器不可用 ⇒ ' +
                String((e && e.message) || e).slice(0, 80));
  } finally {
    if (browser) { try { await browser.close(); } catch (e2) { /* 收尾异常不影响判据 */ } }
    report();
  }
})();

