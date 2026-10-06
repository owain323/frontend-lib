/**
 * bar.js — 柱状图（charter 13 图表规范 · 四条铁律全部落地）
 * ============================================================================
 * 设计依据：charter 13（00-charter/13-图表规范.md）
 *   铁律一 · 超量程必须被**容器裁剪**      → CSS 侧 overflow:hidden（本文件不参与）
 *   铁律二 · **标注不得覆盖数据**（≤4 个） → markLabel() 只标关键点
 *   铁律三 · **量程必须显式声明**          → max 是必填参数，无默认值
 *   铁律四 · **门禁要能证伪**              → 05-audit/chart-check.js 已覆盖本组件
 *
 * ⭐ 为什么量程不自动适配（charter 13 铁律三）：
 *   一个 400 的异常值 + 30 个 0.35 的常态值，若 Y 轴自适应到 400
 *   ⇒ 所有常态值被压成**一条贴底的直线**
 *   ⇒ 读者会得出「这些天完全没有变化」的**错误结论**。
 *   ⇒ **自动适配是最隐蔽的谎报。**
 *
 * 依赖：01-tokens/tokens.css（颜色全走令牌，不写死）
 * 用法：ES5，无依赖，纯 SVG
 * ============================================================================
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var uid = 0;

  /* ==================================================================== *
   * 铁律二的核心：哪些点值得标数字
   * ==================================================================== *
   * ⭐ 只标 3 类点，**永远 ≤ 4 个**：
   *   1) 最高点（峰值在哪）
   *   2) 末位（现在到多少）
   *   3) 越界点（如果有，告诉读者"这里被截断了"）
   * 30 根柱子配 30 个数字 ⇒ 必然重叠，且读者也读不完。
   */
  function pickKeyPoints(values) {
    var keys = {}, i, v, maxI = 0;
    for (i = 0; i < values.length; i++) {
      v = values[i];
      if (v > values[maxI]) maxI = i;
    }
    keys[maxI] = 'max';
    if (values.length) keys[values.length - 1] = 'last';
    return keys;
  }

  function el(tag, attrs) {
    var e = document.createElementNS(NS, tag), k;
    for (k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] != null) {
        e.setAttribute(k, String(attrs[k]));
      }
    }
    return e;
  }

  /* ==================================================================== *
   * Bar.draw
   * ==================================================================== *
   * @param {Object} opt
   * @param {Element} opt.host      挂载点（会自动清空）
   * @param {Array}  opt.series     [{ name, values:[Number] }]
   * @param {string} [opt.max]      🔴 **必填** —— Y 轴上限（铁律三）
   * @param {string[]} [opt.labels]  X 轴标签（可少于 values.length）
   * @param {Number} [opt.threshold] 阈值线（画一条虚线）
   * @param {Number} [opt.height]   画布高，默认 180
   * @param {string} [opt.note]     脚注（例如"09-01 已按 400 截断"）
   * @returns {Object} { el, clipped: [索引…], destroy() }
   */
  function draw(opt) {
    opt = opt || {};
    var host = opt.host;
    if (!host) throw new Error('bar.draw: 缺少 host');
    if (opt.max === undefined || opt.max === null) {
      /* 🔴 铁律三：不替调用方决定量程。
         宁可报错，也不要悄悄自适应（那会让 400 的异常值把常态值压成直线）。 */
      throw new Error('bar.draw: max 是必填项（charter 13 铁律三：量程不得自动适配）');
    }

    var series = opt.series || [];
    var max = +opt.max;
    var H = opt.height || 180;
    var W = 640;                 /* viewBox 宽；靠 CSS width:100% 自适应 */
    var padT = 14, padB = 22, padL = 34, padR = 8;
    var plotH = H - padT - padB;
    var plotW = W - padL - padR;
    var n = series.length ? series[0].values.length : 0;
    if (!n) throw new Error('bar.draw: series 为空');

    var id = 'bar' + (++uid);
    var svg = el('svg', {
      'viewBox': '0 0 ' + W + ' ' + H,
      'class': 'bar__svg',
      role: 'img',
      'aria-label': (opt.ariaLabel || '柱状图'),
    });

    /* ---------- 网格 + Y 轴刻度 ---------- */
    var ticks = 4, i, t, y;
    for (i = 0; i <= ticks; i++) {
      t = (max / ticks) * i;
      y = padT + plotH - (t / max) * plotH;
      svg.appendChild(el('line', {
        'class': 'bar__grid', x1: padL, x2: W - padR, y1: y, y2: y,
      }));
      var tl = el('text', { 'class': 'bar__ytick', x: padL - 6, y: y + 3,
                            'text-anchor': 'end' });
      tl.textContent = String(Math.round(t * 100) / 100);
      svg.appendChild(tl);
    }

    /* ---------- 柱子 ---------- */
    var groupW = plotW / n;
    var barW = Math.max(2, groupW * 0.62);
    var clipped = [];

    /* 逐系列堆叠（同一 x 位置） */
    var x, h, yy, s, vi, v, top;
    for (s = 0; s < series.length; s++) {
      var base = new Array(n);
      for (i = 0; i < n; i++) base[i] = 0;

      for (i = 0; i < n; i++) {
        v = +series[s].values[i] || 0;
        h = (v / max) * plotH;
        /* 🔴 铁律一：**超量程必须被裁掉**，不能画到坐标系统外。
           画到 viewBox 之外 ⇒ 会穿透到页面其他内容上（Owner 实机遇到过）。 */
        if (h > plotH) { h = plotH; if (clipped.indexOf(i) < 0) clipped.push(i); }
        x = padL + groupW * i + (groupW - barW) / 2;
        yy = padT + plotH - (base[i] + h);

        svg.appendChild(el('rect', {
          'class': 'bar__bar' + (s > 0 ? ' bar__bar--stack-' + s : ''),
          x: x, y: yy, width: barW, height: h,
          rx: 1.5,
        }));
        /* 越界的那一根额外标记（配合 .bar__bar--clipped 的样式） */
        if (h >= plotH && (+series[s].values[i] || 0) >= max) {
          svg.lastChild.setAttribute('data-clipped', '1');
        }
        base[i] += h;
      }
    }

    /* ---------- 阈值线 ---------- */
    if (opt.threshold != null) {
      var th = (+opt.threshold / max) * plotH;
      y = padT + plotH - th;
      svg.appendChild(el('line', {
        'class': 'bar__threshold', x1: padL, x2: W - padR, y1: y, y2: y,
      }));
    }

    /* ---------- X 轴标签（抽稀，避免挤成一团） ---------- */
    var labels = opt.labels || [];
    var every = Math.max(1, Math.ceil(n / 7));
    for (i = 0; i < labels.length; i++) {
      if (i % every !== 0 && i !== labels.length - 1) continue;
      var xt = el('text', {
        'class': 'bar__xlabel',
        x: padL + groupW * i + groupW / 2,
        y: H - 6, 'text-anchor': 'middle',
      });
      xt.textContent = labels[i];
      svg.appendChild(xt);
    }

    /* ---------- 🔴 铁律二：只标关键点（≤4 个），且不压数据 ---------- */
    var keys = pickKeyPoints(series[0].values);
    /* 越界点也标一个（告诉读者"这里被截断了"）*/
    clipped.forEach(function (ci) { keys[ci] = keys[ci] || 'clip'; });

    var count = 0;
    for (var k in keys) {
      if (!Object.prototype.hasOwnProperty.call(keys, k)) continue;
      if (count >= 4) break;               /* ⭐ 硬上限 4 个 */
      var i2 = +k;
      var v2 = +series[0].values[i2] || 0;
      var h2 = Math.min((v2 / max) * plotH, plotH);
      var yy2 = padT + plotH - h2;
      var lb = el('text', {
        /* 🔴 charter 13 铁律二：标注画在柱顶**外侧**（yy - 5），
           不画在柱子上；且顶外侧不够高时改画内侧底部（见下方 clamp）。
           描边用 paint-order（在字下面），保证深色柱子上也看得清。 */
        'class': 'bar__label bar__label--' + keys[k],
        x: padL + groupW * i2 + groupW / 2,
        y: yy2 - 5 < padT + 8 ? yy2 + 12 : yy2 - 5,
        'text-anchor': 'middle',
      });
      lb.textContent = (keys[k] === 'clip' ? '▲ ' : '') +
                        (Math.round(v2 * 100) / 100);
      svg.appendChild(lb);
      count++;
    }

    host.innerHTML = '';
    host.appendChild(svg);

    /* ---------- 越界说明（必须有，否则读者会误读被裁掉的数据） ---------- */
    if (clipped.length && opt.note) {
      var p = document.createElement('p');
      p.className = 'bar__note';
      p.textContent = opt.note;
      host.appendChild(p);
    } else if (clipped.length) {
      var p2 = document.createElement('p');
      p2.className = 'bar__note';
      p2.textContent = '有 ' + clipped.length + ' 个数据超出量程（上限 ' + max +
                       '），已按上限截断显示。';
      host.appendChild(p2);
    }

    return {
      el: svg,
      clipped: clipped,
      destroy: function () { host.innerHTML = ''; },
    };
  }

  global.Bar = { draw: draw };
})(window);
