#!/usr/bin/env node
/**
 * motion-concurrency.js — 动效的三条硬判据（真浏览器）
 *
 * ============================================================================
 * 为什么要有它
 * ----------------------------------------------------------------------------
 * 库里与动效相关的门禁（motion-policy / motion.py / reveal-contract）**全是静态的**：
 * 查的是"有没有 prefers-reduced-motion 块""时长是不是走令牌"。
 * 没有一条量过**运行时的动画对象**。而 huxx.me 那份拆解的第四条经验是：
 *   「进场动画在跑的时候不要被打断 —— 快速滚动时这条决定了'顺滑'还是'闪'。」
 *
 * 但那条针对的是**它自己的 JS 动画**（Web Animations，重启动画）。
 * 我们用的是 CSS transition —— 被打断时是 **retarget**（从当前值继续插值）。
 * ⇒ 不能照搬，先量。
 *
 * 判据（三条，都不靠阈值调参）
 * ----------------------------------------------------------------------------
 *   ① 状态切换**必须产生动画对象**：切到显示态、切到隐藏态，`getAnimations()` 各 ≥ 1。
 *      没有动画 = 值瞬移。这条是确定性的，不需要"变化幅度阈值"。
 *   ② 快速重复触发时，**同一属性同时运行的动画 ≤ 1**。
 *      ⚠️ 按属性计，不按动画对象总数：`transition-property: transform, opacity`
 *         一次切换就产生 2 个 CSSTransition 对象，按总数计会误判。
 *   ③ prefers-reduced-motion: reduce 下，同一操作产生 **0 个动画**，且 opacity 恒为 1
 *      —— 不是"变快"，是"没有"（WCAG 2.3.3）。这条静态门禁证明不了。
 *
 * 反向控制（--selftest）
 * ----------------------------------------------------------------------------
 *   在真实页面上注入 `* { transition: none !important }` 再跑一遍：
 *   **判据 ① 必须变红**。这比喂合成数据硬 —— 它证明判据真的依赖运行时的动画对象。
 *
 * 用法：
 *   node 05-audit/motion-concurrency.js            # 需要 127.0.0.1:8000
 *   node 05-audit/motion-concurrency.js --selftest # 含一次反向控制（真浏览器）
 * ==========================================================================*/

'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..');
const URL_REVEAL = 'http://127.0.0.1:8000/03-patterns/reveal/demo.html';
const SEL = '[data-reveal]';

/* 快速触发：间隔 < 动画时长(180ms) ⇒ 一定发生"进行中被改"；
   但不用 40ms（那是 25Hz 的失真压力，真实滚动到不了） */
const TOGGLES = 10;
const GAP_MS = 120;
const SAMPLE_MS = 600;

/* 纯函数：从采样里算"同一属性最多叠了几个动画" */
function maxPerProp(frames) {
  let max = 0;
  for (let i = 0; i < frames.length; i++) {
    const seen = {};
    const props = frames[i] || [];
    for (let j = 0; j < props.length; j++) {
      seen[props[j]] = (seen[props[j]] || 0) + 1;
      if (seen[props[j]] > max) { max = seen[props[j]]; }
    }
  }
  return max;
}

/* 页面内：翻 done 属性并读动画对象 + 采样并发 */
async function probe(page) {
  return page.evaluate(async (sel, toggles, gap, sampleMs) => {
    const el = document.querySelector(sel);
    if (!el) { return { error: '找不到 ' + sel }; }

    const frame = function () {
      return new Promise(function (r) { requestAnimationFrame(function () { r(); }); });
    };
    const anims = function () {
      const a = el.getAnimations ? el.getAnimations() : [];
      const out = [];
      for (let i = 0; i < a.length; i++) {
        out.push(a[i].transitionProperty || a[i].animationName || ('#' + i));
      }
      return out;
    };

    /* 先确保处于隐藏态（没有 done），否则第一次切"显示"不会产生动画 */
    el.removeAttribute('data-reveal-done');
    await frame(); await frame();

    /* ---- ① 切到显示态 → 必须有动画 ---- */
    el.setAttribute('data-reveal-done', '');
    await frame(); await frame();
    const showProps = anims();

    /* ---- ① 切到隐藏态 → 必须有动画 ---- */
    el.removeAttribute('data-reveal-done');
    await frame(); await frame();
    const hideProps = anims();

    /* ---- ② 快速重复触发，采样同属性并发 ---- */
    const frames = [];
    let running = true;
    let minOpacity = 99;
    const tick = function () {
      const cs = parseFloat(getComputedStyle(el).opacity);
      if (cs < minOpacity) { minOpacity = cs; }
      frames.push(anims());
      if (running) { requestAnimationFrame(tick); }
    };
    requestAnimationFrame(tick);
    const deadline = Date.now() + sampleMs;
    let i = 0;
    while (Date.now() < deadline) {
      if (el.hasAttribute('data-reveal-done')) {
        el.removeAttribute('data-reveal-done');
      } else {
        el.setAttribute('data-reveal-done', '');
      }
      i++;
      await new Promise(function (r) { setTimeout(r, gap); });
    }
    running = false;
    el.setAttribute('data-reveal-done', '');

    return {
      error: null,
      showProps: showProps,
      hideProps: hideProps,
      frames: frames,
      minOpacity: minOpacity,
      togglesDone: i
    };
  }, SEL, TOGGLES, GAP_MS, SAMPLE_MS);
}

async function run(opts) {
  const browser = require(path.join(REPO, '05-audit', 'browser.js'));
  const killTransition = !!(opts && opts.killTransition);
  let bad = 0;

  /* ---------- ① + ② 正常动效 ---------- */
  {
    const page = await browser.newPage();
    await page.goto(URL_REVEAL, { waitUntil: 'load' });
    if (killTransition) {
      await page.addStyleTag({ content: '*{transition:none!important}' });
    }
    await page.evaluate(function () { if (window.Reveal) { window.Reveal.enable(); } });
    const r = await probe(page);
    await page.close();
    if (r.error) { console.log('  [FAIL] ' + r.error); return 1; }

    const okShow = r.showProps.length >= 1;
    const okHide = r.hideProps.length >= 1;
    console.log('  ' + (okShow && okHide ? 'OK  ' : 'FAIL') +
      ' ① 切换必须产生动画：显示态 ' + r.showProps.length + ' 个 [' +
      r.showProps.join(',') + '] / 隐藏态 ' + r.hideProps.length + ' 个 [' +
      r.hideProps.join(',') + ']');
    if (!(okShow && okHide)) {
      console.log('       ⇒ 没有动画对象 = opacity 是"瞬移"上去的，不是过渡');
      bad++;
    }

    if (!killTransition) {
      const mp = maxPerProp(r.frames);
      const okConc = mp <= 1;
      console.log('  ' + (okConc ? 'OK  ' : 'FAIL') +
        ' ② 同属性并发：最多 ' + mp + ' 个 / 触发 ' + r.togglesDone + ' 次 / 采样 ' +
        r.frames.length + ' 帧');
      if (!okConc) {
        console.log('       ⇒ 同一属性上叠了多个动画 = 重复触发会打架');
        bad++;
      }
    }
  }

  /* ---------- ③ reduced-motion ---------- */
  if (!killTransition) {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(URL_REVEAL, { waitUntil: 'load' });
    await page.evaluate(function () { if (window.Reveal) { window.Reveal.enable(); } });
    const r = await probe(page);
    await page.close();
    if (r.error) { console.log('  [FAIL] ' + r.error); return 1; }
    const ok = r.showProps.length === 0 && r.hideProps.length === 0 && r.minOpacity === 1;
    console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' ③ reduced-motion：显示 ' +
      r.showProps.length + ' 个 / 隐藏 ' + r.hideProps.length + ' 个 / 最低 opacity ' +
      r.minOpacity);
    if (!ok) {
      console.log('       ⇒ reduced 下必须"没有动画"，不是"动画更快"（WCAG 2.3.3）');
      bad++;
    }
  }

  if (bad) { console.log('  ⇒ ' + bad + ' 条不过'); return 1; }
  if (!killTransition) { console.log('  OK   动效三条判据通过（真浏览器实测）'); }
  return 0;
}

/* 反向控制：注入 transition:none ⇒ 判据① 必须红 */
async function selftest() {
  console.log('  基准（未注入）：');
  const base = await run({});
  console.log('  反向控制（注入 *{transition:none}）：');
  const mutated = await run({ killTransition: true });

  let bad = 0;
  if (base !== 0) { console.log('  [FAIL] 基准不通过，自检无意义'); bad++; }
  if (mutated === 0) {
    console.log('  [FAIL] 去掉 transition 之后仍然通过 ⇒ 判据① 没有牙');
    bad++;
  } else {
    console.log('  OK   去掉 transition 后判据① 变红（证明它依赖运行时的动画对象）');
  }
  console.log('  ---- selftest ' + (bad ? '失败' : '通过') + ' ----');
  return bad ? 1 : 0;
}

const isSelftest = process.argv.indexOf('--selftest') !== -1;
const p = isSelftest ? selftest() : run({});
p.then(function (rc) {
  process.exit(rc);
}).catch(function (e) {
  console.log('  [FAIL] 跑不起来：' + e.message);
  console.log('        多半是 8000 端口没有静态服务（cd 仓库根 && python -m http.server 8000）');
  process.exit(1);
});
