/**
 * bar.js — 柱状图（charter 13 图表规范 · 四条铁律全部落地）
 * ============================================================================
 * 设计依据：见 API.md「资产类组件」一节
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
  /* 分类色 5 个（bar.css 里的 .bar__s0..s4），与 scientific-plot 的 ramp 对齐。
     超过 5 个系列请由调用方给 `series[i].cls` 自定义 —— 颜色循环会造成误读。 */
  var SERIES_STYLES = 5;

  /* ==================================================================== *
   * 铁律二的核心：哪些点值得标数字
   * ==================================================================== *
   * ⭐ 只标 3 类点，**永远 ≤ 4 个**：
   *   1) 最高点（峰值在哪）
   *   2) 末位（现在到多少）
   *   3) 越界点（如果有，告诉读者"这里被截断了"）
   * 30 根柱子配 30 个数字 ⇒ 必然重叠，且读者也读不完。
   *
   * 🔴 传入的是「每个 category 顶端代表的值」，不是某个系列的值：
   *    堆叠模式下这一列顶端 = 该列合计；分组模式下 = 该列最高的那一根。
   *    标的是一个系列的值、而读者看到的是另一根柱子的顶 ⇒ 那是谎报。
   */
  function pickKeyPoints(values) {
    var keys = {}, i, maxI = 0;
    for (i = 0; i < values.length; i++) {
      if (values[i] > values[maxI]) maxI = i;
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
   * @param {Array}  opt.series     [{ name, values:[Number], cls }]
   * @param {string} [opt.mode]     'stack'（默认 · 堆叠）| 'group'（并列分组）
   * @param {string} [opt.max]      🔴 **必填** —— Y 轴上限（铁律三）
   * @param {string[]} [opt.labels]  X 轴标签（可少于 values.length）
   * @param {Number} [opt.threshold] 阈值线（画一条虚线）
   * @param {Number} [opt.height]   画布高，默认 180
   * @param {string} [opt.note]     脚注（例如"09-01 已按 400 截断"）
   * @param {boolean}[opt.legend]   是否画图例（默认：系列数 ≥ 2 且都有名字时自动出）
   * @returns {Object} { el, clipped, mode, tops, legend, destroy() }
   *
   * 🔴🔴 **堆叠 vs 分组，语义必须显式选择**（外部评审 VIZ-REPORT-01 · P0-1）
   * --------------------------------------------------------------------
   *   修复前的实现声称"堆叠"，实际把 `base` 数组**在每个系列开头清零**，
   *   ⇒ 两个系列都从同一基线起算、**同横坐标同柱宽** ⇒ 后画的系列
   *      直接覆盖前一个系列的底部视图上看就是一根柱子换了个色块，
   *      读者会当成"总数"，实际他看到的只是**最后一个系列**的值。
   *   ⇒ 这属于数据表达错误，而且**不会报错**（CI 全绿、截图也看不出来）。
   *
   *   修法不是把 `base` 挪出循环就完事，堆叠还剩三件事要交代清楚：
   *     ① **累计位置**：第 s 个系列的底部 = 前 s−1 个系列的高度和（现在真的算了）
   *     ② **合计超量程**：单独每一段都不超、加起来超了 —— 也要算"被截断"，
   *        并且只画（画布内的那一部分），不能画到坐标系外面去
   *     ③ **标注跟着堆叠顶端走**：标签写的是**该列合计**，不是第一个系列的值
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
    var nS = series.length;
    var mode = opt.mode === 'group' ? 'group' : 'stack';
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
    /* 单系列 / 堆叠：沿用历史的 0.62 宽度（不制造无关的外观漂移）；
       分组：把可用的 0.82 均分给 nS 个系列 */
    var barW = mode === 'group'
      ? Math.max(2, (groupW * 0.82) / nS)
      : Math.max(2, groupW * 0.62);
    var clipped = [];
    var x, h, yy, s, vv, bottom, top, vb, vt, rect, k0, k1;

    /* 🔴🔴 累计高度的载体 —— **必须在系列循环之外**。
       修复前它在每个系列开头被清零 ⇒ 每个系列都从基线起算 ⇒ 互相覆盖 */
    var base = new Array(n);
    for (k0 = 0; k0 < n; k0++) base[k0] = 0;

    /* 每个类目「顶端代表的值」：堆叠 = 该列合计，分组 = 该列最高的那根。
       ⇒ 标注必须跟着它走，否则读者看到的高度和读到的数字不是一回事 */
    var topVal = new Array(n);
    for (k0 = 0; k0 < n; k0++) {
      var sum = 0, mx = -Infinity;
      for (k1 = 0; k1 < nS; k1++) {
        vv = +series[k1].values[k0] || 0;
        sum += vv;
        if (vv > mx) mx = vv;
      }
      topVal[k0] = mode === 'stack' ? sum : mx;
    }

    for (s = 0; s < nS; s++) {
      for (i = 0; i < n; i++) {
        vv = +series[s].values[i] || 0;
        h = (vv / max) * plotH;
        bottom = base[i];
        top = bottom + h;
        if (mode === 'stack') base[i] = top;   /* ⭐ 累计：下一个系列的起点 */

        /* 🔴 铁律一：**超量程必须被裁掉**，不能画到坐标系外。
           画到 viewBox 之外 ⇒ 会穿透到页面其他内容上（真机遇到过）。
           ⇒ 堆叠时"单段都不超、合计超了"同样成立 ⇒ 一起进 clipped */
        if (top > plotH && clipped.indexOf(i) < 0) clipped.push(i);
        vb = Math.min(bottom, plotH);          /* 可见段的底 */
        vt = Math.min(top, plotH);             /* 可见段的顶 */
        if (vt - vb < 0.01) continue;          /* 整段都在量程之上 ⇒ 不画 */

        x = mode === 'group'
          ? padL + groupW * i + (groupW - barW * nS) / 2 + barW * s
          : padL + groupW * i + (groupW - barW) / 2;
        yy = padT + plotH - vt;

        rect = el('rect', {
          'class': 'bar__bar bar__s' + (s % SERIES_STYLES) +
                   (series[s].cls ? ' ' + series[s].cls : ''),
          x: x, y: yy, width: barW, height: vt - vb,
        });
        /* 只有露在最顶端、且没被裁的那一段才倒圆角 ——
           堆叠**中间**段倒角会露出接缝，看着像柱子断掉了 */
        if (top <= plotH && vt === top) rect.setAttribute('rx', 1.5);
        /* 被裁掉的那一段：明确标记，配合 bar.css 的样式告诉读者"这是截断的" */
        if (vt < top) rect.setAttribute('data-clipped', '1');
        svg.appendChild(rect);
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
    /* 注意：keys 来自 topVal（看到的那个顶端），不是 series[0] */
    var keys = pickKeyPoints(topVal);
    /* 越界点也标一个（告诉读者"这里被截断了"）*/
    clipped.forEach(function (ci) { keys[ci] = keys[ci] || 'clip'; });

    var count = 0;
    for (var k in keys) {
      if (!Object.prototype.hasOwnProperty.call(keys, k)) continue;
      if (count >= 4) break;               /* ⭐ 硬上限 4 个 */
      var i2 = +k;
      var v2 = +topVal[i2] || 0;
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

    /* ---------- 图例：两个以上系列时，颜色必须能被"翻译"成名字 ---------- *
     * 🔴 为什么默认就出（不再由调用方记得开）：
     *    两种颜色 + 没有图例 ⇒ 读者只能猜哪块是哪个系列；
     *    在黑白打印 / 色觉障碍下这块就直接失读了。
     *    这与 charter 13「重要结论不允许只存在于颜色里」是同一条。
     * ⇒ 要关就显式传 `legend: false`，别指望"忘了传也没事"。 */
    var hasNames = series.every(function (se) { return !!se.name; });
    var wantLegend = opt.legend === undefined ? (nS >= 2 && hasNames) : !!opt.legend;
    var legendEl = null;
    if (wantLegend) {
      legendEl = document.createElement('ul');
      legendEl.className = 'bar__legend';
      series.forEach(function (se, si) {
        var li = document.createElement('li');
        li.className = 'bar__legend-item';
        var sw = document.createElement('span');
        sw.className = 'bar__legend-swatch bar__s' + (si % SERIES_STYLES) +
                       (se.cls ? ' ' + se.cls : '');
        /* 🔴 用 textContent，不用 innerHTML —— 系列名来自调用方的数据 */
        li.appendChild(sw);
        var tx = document.createElement('span');
        tx.textContent = se.name || ('系列 ' + (si + 1));
        li.appendChild(tx);
        legendEl.appendChild(li);
      });
      host.appendChild(legendEl);
    }

    /* ---------- 越界说明（必须有，否则读者会误读被裁掉的数据） ---------- */
    if (clipped.length && opt.note) {
      var p = document.createElement('p');
      p.className = 'bar__note';
      p.textContent = opt.note;
      host.appendChild(p);
    } else if (clipped.length) {
      var p2 = document.createElement('p');
      p2.className = 'bar__note';
      p2.textContent = '有 ' + clipped.length + ' 个' +
                       (mode === 'stack' ? '类目的合计' : '数据') +
                       '超出量程（上限 ' + max + '），已按上限截断显示。';
      host.appendChild(p2);
    }

    return {
      el: svg,
      clipped: clipped,
      mode: mode,
      /* 每个类目顶端的真实数值（堆叠=合计 / 分组=最高），
         给门禁做几何断言用 —— 判据不该靠读 DOM 反推 */
      tops: topVal,
      legend: legendEl,
      destroy: function () { host.innerHTML = ''; },
    };
  }

  global.Bar = { draw: draw };
})(window);
