const { launch } = require('./browser.js');

/**
 * deco-clip-check.js — 图表「末端绘制物被裁」全局检查
 *
 * ============================================================================
 * 🔴 为什么需要（真机实测反馈：「所有地方都会有这个问题，
 *    最右边的圆点永远被吃掉了一部分」）
 * ============================================================================
 * 那个 bug 的**真正根因**不是"末点圆点半径大于留白"，而是：
 *
 *     **viewBox 的宽度与容器实际宽度不一致。**
 *     实测：viewBox = 699，容器 = 300px ⇒ SVG 被横向压缩到 43%
 *          ⇒ 末点圆点被压扁、被 `overflow:hidden` 裁掉。
 *
 * ⭐ 为什么值得做成"全局门禁"：
 *   反馈「所有地方都有」—— **实测确认 8/8 张图全中**。
 *   这类 bug 的特点是：**单张看着还行，全库系统性错位**，
 *   而逐页肉眼检查**必然漏**。
 *
 * ============================================================================
 * 查什么（三条，都是机械可判的）
 * ============================================================================
 *   ① **viewBox 宽度 == 容器实际宽度**
 *      不一致 ⇒ SVG 会被拉伸/压缩 ⇒ 圆点变形、线宽失真
 *   ② **末端绘制物在容器内**
 *      折线末点 / 末柱 / 端点圆点 的右边缘 ≤ 容器右边缘
 *      （差值应 ≥ 该物的半径，否则被裁）
 *   ③ **viewBox 高度 == 容器高度**
 *      同 ①，y 方向同理
 */
const PAGES = [
  ['sparkline demo', '/09-assets/sparkline/demo.html'],
  ['iOS 验证页', '/10-review/ios/index.html'],
  ['图表规范', '/09-assets/echarts-adapter/demo.html'],
];

// 末端绘制物的半径（与 sparkline.js 里的 LAST_R / LAST_BAR 对应）
const MARGIN = 3;   // 末点圆点 r=2.5 ⇒ 余量 <3 必被裁一半

(async () => {
  const b = await launch();
  let bad = 0;
  const pad = (s, n) => { s = String(s); let w = 0;
    for (const ch of s) w += ch.charCodeAt(0) > 255 ? 2 : 1;
    return s + ' '.repeat(Math.max(0, n - w)); };

  console.log('  ' + pad('页面', 16) + pad('#', 4) + pad('容器', 12) +
              pad('viewBox', 12) + '判定');
  console.log('  ' + '-'.repeat(60));

  for (const [name, rel] of PAGES) {
    const p = await b.newPage();
    // 🔴 必须设移动视口：这张门禁查的就是「iOS 上出问题」，
    //   不设视口量到的是桌面宽度 ⇒ 等于没查。
    await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 2,
                          isMobile: true, hasTouch: true });
    try {
      await p.goto('http://127.0.0.1:8000' + rel,
                   { waitUntil: 'networkidle0', timeout: 12000 });
    } catch (e) { await p.close(); continue; }

    // 🔴 等 ResizeObserver 跑完 —— 它是异步的
    await new Promise((r) => setTimeout(r, 500));

    const rows = await p.evaluate((margin) => {
      const out = [];
      document.querySelectorAll('.sparkline[data-spark]').forEach((s, i) => {
        const svg = s.querySelector('svg');
        if (!svg) return;
        const sr = s.getBoundingClientRect();
        if (sr.width < 1) return;                 // 隐藏的
        const vb = (svg.getAttribute('viewBox') || '').split(' ');
        const vbW = parseFloat(vb[2]);
        const vbH = parseFloat(vb[3]);

        /* 🔴 判据修正：末点位置必须从 **SVG 的 viewBox 坐标**算。
           上一版用 getBoundingClientRect 量圆点 —— 但元素被 overflow:hidden 裁掉后，
           getBoundingClientRect 仍返回**未裁剪的几何位置**，
           于是每次都量到"余 0px"，**是假象**（我被它带着绕了一圈）。

           SVG 内部坐标系（viewBox）与容器像素 1:1（我们已修掉拉伸），
           所以：viewBox 内 x + 半径 ≤ viewBox 宽 ⇒ 未被裁。 */
        let gap = null, kind = '', endX = null, radius = 0;
        const dot = svg.querySelector('circle.spark-dot');
        const bar = svg.querySelector('rect.spark-bar');
        if (bar) {
          const b = bar.getBBox();
          endX = b.x + b.width; radius = 0; kind = '末柱';
        } else if (dot) {
          endX = parseFloat(dot.getAttribute('cx')); radius = parseFloat(dot.getAttribute('r'));
          kind = '端点';
        } else {
          const path = svg.querySelector('path[stroke-width]');
          if (path) {
            const nums = (path.getAttribute('d').match(/-?\d+(\.\d+)?/g) || []);
            endX = parseFloat(nums[nums.length - 2]); radius = 0.75; kind = '折线';
          }
        }
        /* 🔴 阈值按**物体类型**定，不能一刀切：
             端点圆点 r=2.5 ⇒ 贴边就会被切一半 ⇒ 需 ≥1.5px 呼吸
             折线 stroke-width=1.5 ⇒ 半根线（0.75px）就够，不算被裁
             末柱是矩形，边缘齐平即可（0 也算完整）
           统一用 3px 会把**正常的折线**误报 —— 那是假警。 */
        // 🔴 无 data-spark-last 的折线 pad 本来就是 1 ⇒ 余 ~0.25px，**不是缺陷**
        //    （不画末点圆点，就不需要为它留位置）
        const NEED = (kind === '端点') ? 1.5 : 0;
        if (endX !== null) {
          gap = Math.round((vbW - endX - radius) * 10) / 10;
          if (gap >= NEED) gap = null;      // 合格就不报
        }

        out.push({
          i, kind,
          boxW: Math.round(sr.width), boxH: Math.round(sr.height),
          vbW: Math.round(vbW), vbH: Math.round(vbH), gap,
        });
      });
      return out;
    }, MARGIN);

    rows.forEach((r) => {
      const wOk = Math.abs(r.boxW - r.vbW) <= 2;
      const hOk = Math.abs(r.boxH - r.vbH) <= 2;
      const gOk = r.gap === null || r.gap >= MARGIN;
      const ok = wOk && hOk && gOk;
      if (!ok) bad++;
      const why = !wOk ? '宽度不符' : !hOk ? '高度不符'
                : !gOk ? r.kind + '被裁(余' + r.gap + 'px)' : '';
      console.log('  ' + pad(name, 16) + pad('#' + r.i, 4) +
        pad(r.boxW + '×' + r.boxH, 12) + pad(r.vbW + '×' + r.vbH, 12) +
        (ok ? 'OK' : '❌ ' + why));
    });
    await p.close();
  }
  await b.close();

  console.log('');
  if (bad) {
    console.log('  ❌ ' + bad + ' 处「末端绘制物被裁」或 viewBox 不匹配。');
    console.log('');
    console.log('  🔴 典型根因：');
    console.log('     viewBox 宽度 = 量到的旧宽度（flex 收缩前），容器已被压窄');
    console.log('     ⇒ SVG 被压缩 ⇒ 端点圆点压扁 + overflow:hidden 裁掉。');
    console.log('     修法：① 用 getBoundingClientRect().width（不是 clientWidth）');
    console.log('           ② 加 ResizeObserver 在布局稳定后重绘（老 WebView 退到 window.resize）');
    process.exit(1);
  }
  console.log('  ✅ 全部图表：viewBox 与容器一致、末端绘制物未被裁');
})();
