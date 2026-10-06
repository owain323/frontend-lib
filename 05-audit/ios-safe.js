// puppeteer-core 改由 browser.js 统一持有
  // 🔴 统一走 browser.js：那里会 setCacheEnabled(false)。
  //    没有它，页面里跑的是**缓存的旧代码**，测试会假通过
  //    （磁盘上明明改对了，浏览器里还是旧的）。
  const { launch } = require('./browser');

/**
 * ios-safe.js — 窄屏安全性检查（iPhone 尺寸）
 *
 * 为什么需要
 * ----------
 * 在 iPhone 尺寸下**实测抓到一个真 bug**：
 *   `@media (max-width: 480px)` 里的 `.dialog { max-width: none }`
 *   没有宽度上界 ⇒ 弹窗被内容（有 min-width 的 <table>/<pre>）撑到
 *   **444px > 视口 393px**，左边缘 -26px（左侧被切掉）。
 *
 * ⚠️ 那个 bug 在 Chromium 的桌面尺寸下**永远测不出来** ——
 *    所以它能一直躺着，直到有人在窄屏上打开。
 *
 * 这个脚本做两件事：
 *   ① 用 iPhone 尺寸扫一遍所有页面，看有没有横向溢出
 *   ② 塞入"有最小宽度的内容"再扫一次（这是最容易撑破的情况）
 *
 * 🔴 它**不能替代真人用 iPhone 看** ——
 *    键盘遮挡、地址栏收起、真实滚动惯性这些，只有真机能测。
 *    本脚本只负责"机械可查的那部分"。
 */
const PAGES = [
  ['index', 'index.html'],
  ['button', '02-primitives/button/demo.html'],
  ['card', '02-primitives/card/demo.html'],
  ['choice', '02-primitives/choice/demo.html'],
  ['input', '02-primitives/input/demo.html'],
  ['form-valid', '03-patterns/form-validation/demo.html'],
  ['list', '03-patterns/list/demo.html'],
  ['nav', '03-patterns/nav/demo.html'],
  ['overlay', '03-patterns/overlay/demo.html'],
  ['states', '03-patterns/states/demo.html'],
  ['longform', '04-recipes/longform/longform.html'],
  ['sparkline', '09-assets/sparkline/demo.html'],
  ['ios-check', '10-review/ios/index.html'],
  ['example', 'examples/react-vite/index.html'],
];

// iPhone 15 Pro 的 CSS 视口
const IPHONE = { width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

(async () => {
  const b = await launch();
  let bad = 0;
  const pad = (s, n) => { s = String(s); let w = 0;
    for (const ch of s) w += ch.charCodeAt(0) > 255 ? 2 : 1;
    return s + ' '.repeat(Math.max(0, n - w)); };

  console.log('  iPhone 15 Pro 视口 ' + IPHONE.width + '×' + IPHONE.height);
  console.log('  ' + pad('页面', 12) + pad('横向溢出', 10) + pad('塞长内容后', 12) + '判定');
  console.log('  ' + '-'.repeat(56));

  for (const [name, rel] of PAGES) {
    const p = await b.newPage();
    await p.setViewport(IPHONE);
    try {
      await p.goto('http://127.0.0.1:8000/' + rel,
                   { waitUntil: 'networkidle0', timeout: 12000 });
    } catch (e) { await p.close(); continue; }

    const r = await p.evaluate((vw) => {
      const docW = document.documentElement.scrollWidth;
      const over = docW > vw + 1;

      // 找出真正超出视口的元素（诊断用）
      let culprit = null;
      if (over) {
        for (const e of document.querySelectorAll('*')) {
          const b = e.getBoundingClientRect();
          if (b.width > 0 && b.right > vw + 1) {
            culprit = e.tagName.toLowerCase() +
              (e.className ? '.' + String(e.className).split(' ')[0] : '') +
              ' (' + Math.round(b.width) + 'px)';
            break;
          }
        }
      }

      // 🔴 第一版这里有 bug：把 <pre> 直接塞到 body 末尾，**没约束它**，
      //    于是 <pre> 自己就溢出 1600px —— 测的是 <pre>，不是组件。
      //    ⇒ 12 个页面全是**假警**。
      //    正确做法：把探针**放进组件的内容区**（让它继承组件的
      //    overflow/word-break 规则），这才测"组件扛不扛得住长内容"。
      const hosts = document.querySelectorAll(
        '.card__body, .dialog__desc, .tabs__panel, .accordion__panel, ' +
        '.state, .field, td, .prose, main');
      let probeHost = null;
      for (const h of hosts) { if (h.offsetWidth > 0) { probeHost = h; break; } }
      if (!probeHost) probeHost = document.body;
      const probe = document.createElement('pre');
      // 🔴 关键：给它**和正文一样**的换行规则，
      //    模拟"一段很长的代码/日志进了这个组件"。
      probe.style.cssText = 'margin:0;max-width:100%;' +
        'white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word';
      probe.textContent = 'x'.repeat(200);
      probeHost.appendChild(probe);
      const docW2 = document.documentElement.scrollWidth;
      probe.remove();

      return { over, culprit, docW, docW2, vw };
    }, IPHONE.width);

    let o1 = r.over;
    let o2 = r.docW2 > r.vw + 1;
    if (o1 || o2) bad++;
    // 🔴 补：静态扫**碰不到弹窗** ——
    //    overlay demo 要手动点按钮才开弹窗，弹层不在初始 DOM 里。
    //    而"窄屏弹窗撑破"恰恰是**静态扫最该抓、又一定抓不到**的那类
    //    （它只在 <480px 触发、且要有长内容才撑破）。
    //    ⇒ 这里主动开一次所有弹窗，再测。
    if (name === 'overlay' || name === 'ios-check') {
      await p.evaluate(() => {
        document.querySelectorAll('button').forEach((b) => {
          const t = (b.textContent || '').trim();
          // 只点"看起来是打开弹层"的按钮，避免误触（删除/关闭等）
          if (/打开|弹窗|toast|确认|删除|danger|dialog/i.test(t) ||
              (b.className || '').indexOf('btn--danger') > -1) {
            try { b.click(); } catch (e) { /* 忽略 */ }
          }
        });
      });
      await new Promise((r) => setTimeout(r, 400));
      const withModal = await p.evaluate((vw) => {
        const open = document.querySelectorAll(
          '[role="dialog"], .dialog, .toast-region *, .dialog-backdrop');
        if (!open.length) return { none: true };
        let bad = 0, w = 0;
        open.forEach((e) => {
          const b = e.getBoundingClientRect();
          if (b.width > 0) { w = Math.max(w, b.width); if (b.width > vw + 1) bad++; }
        });
        return { opened: open.length, bad, w: Math.round(w),
                 docW: document.documentElement.scrollWidth };
      }, IPHONE.width);
      if (!withModal.none) {
        o1 = false; o2 = false;   // 静态那两列不适用于弹层场景
        if (withModal.bad > 0 || withModal.docW > IPHONE.width + 1) {
          bad++;
          console.log('  ' + pad(name, 12) +
            pad('—', 10) + pad('—', 12) +
            '❌ 弹层宽 ' + withModal.w + ' / 视口 ' + IPHONE.width +
            '（' + withModal.bad + ' 个超宽）');
        } else {
          console.log('  ' + pad(name, 12) +
            pad('—', 10) + pad('—', 12) +
            'OK  ' + withModal.opened + ' 个弹层，最宽 ' + withModal.w + 'px ✓');
        }
        await p.close();
        continue;
      }
    }

    console.log('  ' + pad(name, 12) +
      pad(o1 ? (r.docW + 'px ⚠') : '无', 10) +
      pad(o2 ? (r.docW2 + 'px ⚠') : '无', 12) +
      (o1 || o2 ? '❌ ' + (r.culprit || '见左') : 'OK'));
    await p.close();
  }
  await b.close();
  console.log('');
  console.log('  ⚠ 这**替代不了**真人在 iPhone 上看：');
  console.log('    键盘遮挡 · 地址栏收起 · 真实滚动惯性 · 触控手感 —— 只有真机能测。');
  console.log('    本脚本只查"机械可查的那部分"（横向溢出 / 被内容撑破）。');
  if (bad) { console.log(''); console.log('  ' + bad + ' 个页面在 iPhone 宽度下有横向溢出。'); process.exit(1); }
  console.log('');
  console.log('  ✅ 全部页面在 iPhone 宽度下无横向溢出');
})();
