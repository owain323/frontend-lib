/*
 * scientific-plot.js — 二维科学绘图（零依赖 · 原生 SVG · ES5）
 *
 * ============================================================================
 * 🔴 它**不是**什么
 * ============================================================================
 *   不是"再做一个 BI 图表"。营运图表回答"这个月比上个月好还是差"，
 *   科学绘图回答"这些测量值落在哪、误差多大、有没有超出模型预测"。
 *   两者共享视觉基础（令牌、字体、容器），但**坐标语义和数据格式不是一回事**。
 *   ⇒ 所以本模块**不依赖** BI 图表的内部实现，也不复用它。
 *
 *   也不是 Plotly 级的完整引擎。第一版只做一组范围明确的能力，
 *   更复杂的插值 / 等高线 / 大规模交互，由调用方按需接入成熟库
 *   （ECharts / Observable Plot / Vega-Lite），**不打包进本库的必选运行时**。
 *
 * ============================================================================
 * 🔴 五条不能忽视的原则（每一条都在代码里有对应实现）
 * ============================================================================
 *   ① 坐标与单位必须显式声明 —— 轴名 / 单位 / 线性或对数都由 spec 给，
 *      本模块**不猜**。给了对数轴却不给正域 ⇒ 直接报错，不静默退化。
 *   ② 缺失值 ≠ 零 —— `null` 是"这里没有测量"，不是 0。
 *      画线时**断开**，不跨过缺失区连成一条假曲线。
 *      （这条工程经验来自 09-assets/sparkline，那里踩过同一个坑。）
 *   ③ 不为美观扭曲数据 —— 轴范围按给定 domain 走；真需要截断时，
 *      调用方要显式传 `truncated: true`，本模块会在图上打出提示。
 *   ④ 不确定性真实表达 —— 误差棒 / 区间带**只画调用方给的数**。
 *      均值、标准误、标准差、置信区间是四个不同概念，
 *      本模块**不计算、也不宣称**任何统计量或显著性。
 *   ⑤ 可读的文本等价信息 —— SVG 带 role="img" 与自动生成的 aria-label；
 *      重要结论不允许只存在于颜色或曲线形状里。
 *
 * ============================================================================
 * 安全
 * ============================================================================
 *   函数曲线用 `sampling`：调用方传**函数**，本模块在指定区间上采样成数据点。
 *   **绝不**用 eval() 执行任何字符串表达式 —— 那等于把整页交给输入。
 *
 * 用法：见 README.md 与 demo.html
 */
(function (global) {
  'use strict';

  var DEFAULT_MARGIN = { top: 18, right: 22, bottom: 56, left: 68 };
  var SERIES_CLASSES = 5;          /* 分类色 5 个，与 echarts-adapter 的 ramp 对齐 */
  var DASHES = [[], [7, 4], [2, 3], [10, 4, 2, 4], [1, 3]];  /* 超出 5 条用线型区分 */

  /* ------------------------------------------------------------------ 工具 */

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 数字格式化：科学图里小数位是**信息**，不能顺手 toLocaleString 了事 */
  function fmt(v, p) {
    if (!isNum(v)) return '';
    if (p === undefined || p === null) {
      /* 默认：够用就行，但不要出现 1.0000000000000002 */
      return String(+v.toPrecision(12));
    }
    return v.toFixed(p);
  }

  function cssVar(name, fallback) {
    if (typeof getComputedStyle !== 'function' || !document.documentElement) return fallback;
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    v = v ? v.trim() : '';
    return v || fallback;
  }

  /* --------------------------------------------------------------- 比例尺 */

  /**
   * 造一个比例尺。
   * @param {{scale?:string, domain:number[]}} axis
   * @param {number[]} range 像素范围 [起, 止]
   * @returns {{to:function(number):?number, type:string, domain:number[]}}
   *
   * 🔴 对数轴：domain 必须 > 0。给 0 或负数直接抛错 ——
   *    "悄悄把 0 当 1e-9" 会画出一条看起来正常、实际错误的曲线。
   */
  function makeScale(axis, range) {
    var type = (axis && axis.scale) || 'linear';
    var d = (axis && axis.domain) || [];
    var d0 = d[0], d1 = d[1];
    var r0 = range[0], r1 = range[1];

    if (type !== 'linear' && type !== 'log') {
      throw new Error('scientific-plot: 未知的 scale「' + type + '」（只支持 linear / log）');
    }
    if (!isNum(d0) || !isNum(d1)) {
      throw new Error('scientific-plot: ' + type + ' 轴必须给 domain:[min,max]');
    }
    if (type === 'log' && (d0 <= 0 || d1 <= 0)) {
      throw new Error('scientific-plot: 对数轴的 domain 必须 > 0（收到 [' + d0 + ', ' + d1 + ']）');
    }
    if (d0 === d1) {
      throw new Error('scientific-plot: domain 的上下限相同（' + d0 + '），无法定标');
    }

    var to;
    if (type === 'linear') {
      to = function (v) { return r0 + (v - d0) / (d1 - d0) * (r1 - r0); };
    } else {
      var l0 = Math.log(d0), l1 = Math.log(d1);
      to = function (v) {
        if (!isNum(v) || v <= 0) return null;      /* 非正数在对数轴上**没有位置** */
        return r0 + (Math.log(v) - l0) / (l1 - l0) * (r1 - r0);
      };
    }

    return {
      to: to, type: type, domain: [d0, d1],
      /* 反向：像素 → 值（给十字线一类的交互留口子，目前 demo 用不到） */
      invert: function (px) {
        var t = (px - r0) / (r1 - r0);
        return type === 'linear' ? d0 + t * (d1 - d0) : Math.exp(l0 + t * (l1 - l0));
      }
    };
  }

  /* ----------------------------------------------------------------- 刻度 */

  /** 线性轴的"好看"刻度：1 / 2 / 5 × 10^n */
  function linearTicks(d0, d1, target) {
    target = target || 6;
    var span = d1 - d0;
    if (!isNum(span) || span <= 0) return [d0];
    var step = Math.pow(10, Math.floor(Math.log(span / target) / Math.LN10));
    var err = (span / target) / step;
    if (err >= 7.5) step *= 10;
    else if (err >= 3.5) step *= 5;
    else if (err >= 1.5) step *= 2;

    var out = [];
    var t = Math.ceil(d0 / step) * step;
    /* 用乘法推进而不是累加，避免浮点误差把刻度漂到 0.30000000000000004 */
    var i = 0;
    while (t <= d1 + step * 1e-9 && i < 200) {
      out.push(+t.toPrecision(12));
      i++;
      t = Math.ceil(d0 / step) * step + i * step;
    }
    return out;
  }

  /** 对数轴刻度：主刻度是 10 的幂；跨度小时补 2× / 5× 次刻度 */
  function logTicks(d0, d1) {
    var e0 = Math.floor(Math.log(d0) / Math.LN10);
    var e1 = Math.ceil(Math.log(d1) / Math.LN10);
    var decades = e1 - e0;
    /* 跨度 ≥ 6 个数量级时只保留 10 的幂 —— 否则标签会挤成一团 */
    var mantissas = decades >= 6 ? [1] : [1, 2, 5];

    var out = [];
    for (var e = e0; e <= e1; e++) {
      var base = Math.pow(10, e);
      for (var i = 0; i < mantissas.length; i++) {
        var v = base * mantissas[i];
        if (v >= d0 * (1 - 1e-9) && v <= d1 * (1 + 1e-9)) out.push(v);
      }
    }
    /* 排序 + 按精度去重：浮点会把同一个刻度算出两份（1000 与 1000.0000000000001） */
    out.sort(function (a, b) { return a - b; });
    var seen = {}, uniq = [];
    out.forEach(function (v) {
      var k = v.toPrecision(12);
      if (!seen[k]) { seen[k] = 1; uniq.push(v); }
    });
    return uniq;
  }

  /* ------------------------------------------------------------ 序列分组 */

  /**
   * 把数据按"缺失"切成若干连续段。
   * 🔴 这是"缺失值 ≠ 零"的落地点：跨过 null 连线 = 编造了一段不存在的趋势。
   */
  function splitByGaps(data, xAccessor, yAccessor) {
    var segs = [], cur = [];
    (data || []).forEach(function (p) {
      var x = xAccessor(p), y = yAccessor(p);
      if (!isNum(x) || !isNum(y)) {
        if (cur.length) { segs.push(cur); cur = []; }
      } else {
        cur.push([x, y, p]);
      }
    });
    if (cur.length) segs.push(cur);
    return segs;
  }

  /* ------------------------------------------------------------- 采样函数 */

  /** 把函数采样成数据点。**不做表达式求值** —— 只调用调用方给的真函数。 */
  function sampleFunction(fn, a, b, n) {
    n = n || 200;
    var out = [];
    if (typeof fn !== 'function') return out;
    for (var i = 0; i <= n; i++) {
      var x = a + (b - a) * (i / n);
      var y;
      try { y = fn(x); } catch (e) { y = null; }
      out.push([x, isNum(y) ? y : null]);
    }
    return out;
  }

  /* ------------------------------------------------------------- 主渲染 */

  function render(el, spec) {
    if (!el) throw new Error('scientific-plot: 缺少挂载元素');
    spec = spec || {};

    var W = spec.width || 640;
    var H = spec.height || 400;
    var m = {};
    var mk = spec.margin || {};
    m.top = mk.top === undefined ? DEFAULT_MARGIN.top : mk.top;
    m.right = mk.right === undefined ? DEFAULT_MARGIN.right : mk.right;
    m.bottom = mk.bottom === undefined ? DEFAULT_MARGIN.bottom : mk.bottom;
    m.left = mk.left === undefined ? DEFAULT_MARGIN.left : mk.left;

    var x0 = m.left, x1 = W - m.right;
    var yTop = m.top, yBot = H - m.bottom;

    var xs = makeScale(spec.x, [x0, x1]);
    /* y 轴像素方向朝上 ⇒ range 反过来给 */
    var ys = makeScale(spec.y, [yBot, yTop]);

    var parts = [];
    var label = [];

    /* ---------- 网格 ---------- */
    var xt = xs.type === 'log' ? logTicks(xs.domain[0], xs.domain[1])
                               : linearTicks(xs.domain[0], xs.domain[1]);
    var yt = ys.type === 'log' ? logTicks(ys.domain[0], ys.domain[1])
                               : linearTicks(ys.domain[0], ys.domain[1]);

    if (spec.grid !== false) {
      xt.forEach(function (v) {
        var px = xs.to(v); if (px == null) return;
        parts.push('<line class="splot__grid" x1="' + px + '" y1="' + yTop +
                   '" x2="' + px + '" y2="' + yBot + '"/>');
      });
      yt.forEach(function (v) {
        var py = ys.to(v); if (py == null) return;
        parts.push('<line class="splot__grid" x1="' + x0 + '" y1="' + py +
                   '" x2="' + x1 + '" y2="' + py + '"/>');
      });
    }

    /* ---------- 轴 ---------- */
    parts.push('<line class="splot__axis" x1="' + x0 + '" y1="' + yBot +
               '" x2="' + x1 + '" y2="' + yBot + '"/>');
    parts.push('<line class="splot__axis" x1="' + x0 + '" y1="' + yTop +
               '" x2="' + x0 + '" y2="' + yBot + '"/>');

    /* ---------- 刻度与标签 ---------- */
    xt.forEach(function (v) {
      var px = xs.to(v); if (px == null) return;
      parts.push('<line class="splot__tick" x1="' + px + '" y1="' + yBot +
                 '" x2="' + px + '" y2="' + (yBot + 5) + '"/>');
      parts.push('<text class="splot__tick-label" x="' + px + '" y="' + (yBot + 20) +
                 '" text-anchor="middle">' + esc(fmtTick(v, xs.type)) + '</text>');
    });
    yt.forEach(function (v) {
      var py = ys.to(v); if (py == null) return;
      parts.push('<line class="splot__tick" x1="' + (x0 - 5) + '" y1="' + py +
                 '" x2="' + x0 + '" y2="' + py + '"/>');
      parts.push('<text class="splot__tick-label" x="' + (x0 - 9) + '" y="' + (py + 4) +
                 '" text-anchor="end">' + esc(fmtTick(v, ys.type)) + '</text>');
    });

    /* ---------- 轴名与单位（原则①） ---------- */
    var xl = axisTitle(spec.x, 'x');
    if (xl) {
      parts.push('<text class="splot__axis-label" x="' + ((x0 + x1) / 2) + '" y="' +
                 (H - 12) + '" text-anchor="middle">' + esc(xl) + '</text>');
    }
    var yl = axisTitle(spec.y, 'y');
    if (yl) {
      parts.push('<text class="splot__axis-label" transform="translate(16,' +
                 ((yTop + yBot) / 2) + ') rotate(-90)" text-anchor="middle">' +
                 esc(yl) + '</text>');
    }

    /* ---------- 数据序列 ---------- */
    var series = spec.series || [];
    var colorIdx = 0;
    var drawn = 0;

    series.forEach(function (s) {
      var cls = 'splot__s' + (colorIdx % SERIES_CLASSES);
      var dMin = s.samples || 200;
      var data = s.type === 'function'
        ? sampleFunction(s.fn, (s.domain || xs.domain)[0], (s.domain || xs.domain)[1], dMin)
        : (s.data || []);

      if (s.type === 'band') {
        /* 置信区间带：上下两条边 + 中间填充 */
        var up = [], dn = [];
        data.forEach(function (p) {
          var px = xs.to(p[0]);
          if (px == null) return;
          var hi = ys.to(p[2]), lo = ys.to(p[1]);
          if (hi == null || lo == null) return;
          up.push(px + ',' + hi);
          dn.push(px + ',' + lo);
        });
        if (up.length >= 2) {
          parts.push('<polygon class="splot__band ' + cls + '" points="' +
                     up.join(' ') + ' ' + dn.reverse().join(' ') + '"/>');
          drawn++;
        }
        return;
      }

      if (s.type === 'errorbar') {
        /* 误差棒：只画调用方给的误差，**不计算** */
        data.forEach(function (p) {
          var px = xs.to(p[0]);
          if (px == null || !isNum(p[1])) return;
          var py = ys.to(p[1]); if (py == null) return;
          /* 两种写法都支持：
               [x, y, yerr]      —— 对称误差，上下各延 yerr
               [x, y, lo, hi]    —— 非对称区间（调用方自己算好的边界）
             🔴 本模块只画给定的边界，**不替调用方计算**标准误或置信区间。 */
          var yLo = p.length > 3 ? p[2] : p[1] - (p[2] || 0);
          var yHi = p.length > 3 ? p[3] : p[1] + (p[2] || 0);
          var pa = ys.to(yLo), pb = ys.to(yHi);
          if (pa == null || pb == null) return;
          parts.push('<line class="splot__err ' + cls + '" x1="' + px + '" y1="' + pa +
                     '" x2="' + px + '" y2="' + pb + '"/>');
          parts.push('<line class="splot__err ' + cls + '" x1="' + (px - 4) + '" y1="' + pa +
                     '" x2="' + (px + 4) + '" y2="' + pa + '"/>');
          parts.push('<line class="splot__err ' + cls + '" x1="' + (px - 4) + '" y1="' + pb +
                     '" x2="' + (px + 4) + '" y2="' + pb + '"/>');
          drawn++;
        });
        return;
      }

      if (s.type === 'line' || s.type === 'function') {
        /* 🔴 按缺失分段，**不跨 null 连线**（原则②） */
        var segs = splitByGaps(data, function (p) { return p[0]; }, function (p) { return p[1]; });
        segs.forEach(function (seg) {
          if (seg.length < 2) {
            /* 单个孤立点也要能看见，否则它就从图上消失了 */
            var q = seg[0];
            var qx = xs.to(q[0]), qy = ys.to(q[1]);
            if (qx != null && qy != null) {
              parts.push('<circle class="splot__pt ' + cls + '" cx="' + qx +
                         '" cy="' + qy + '" r="2.5"/>');
            }
            return;
          }
          var pts = seg.map(function (q) {
            return xs.to(q[0]) + ',' + ys.to(q[1]);
          }).join(' ');
          parts.push('<polyline class="splot__line ' + cls + '" points="' + pts +
                     '"' + dashAttr(colorIdx) + '/>');
        });
        drawn++;
        return;
      }

      if (s.type === 'scatter') {
        data.forEach(function (p) {
          var px = xs.to(p[0]); if (px == null || !isNum(p[1])) return;
          var py = ys.to(p[1]); if (py == null) return;
          parts.push('<circle class="splot__pt ' + cls + '" cx="' + px + '" cy="' + py +
                     '" r="3"/>');
        });
        drawn++;
        return;
      }
    });

    /* ---------- 参考线 ---------- */
    (spec.refs || []).forEach(function (r) {
      var isY = r.axis === 'y';
      var p = isY ? ys.to(r.value) : xs.to(r.value);
      if (p == null) return;
      if (isY) {
        parts.push('<line class="splot__ref" x1="' + x0 + '" y1="' + p +
                   '" x2="' + x1 + '" y2="' + p + '"/>');
        if (r.label) {
          parts.push('<text class="splot__ref-label" x="' + (x1 - 4) + '" y="' + (p - 5) +
                     '" text-anchor="end">' + esc(r.label) + '</text>');
        }
      } else {
        parts.push('<line class="splot__ref" x1="' + p + '" y1="' + yTop +
                   '" x2="' + p + '" y2="' + yBot + '"/>');
        if (r.label) {
          parts.push('<text class="splot__ref-label" x="' + (p + 5) + '" y="' + (yTop + 12) +
                     '">' + esc(r.label) + '</text>');
        }
      }
    });

    /* ---------- 点标注 ---------- */
    (spec.annotations || []).forEach(function (a) {
      var px = xs.to(a.x), py = ys.to(a.y);
      if (px == null || py == null) return;
      parts.push('<circle class="splot__anno-dot" cx="' + px + '" cy="' + py + '" r="3.5"/>');
      parts.push('<text class="splot__anno" x="' + (px + 7) + '" y="' + (py - 6) + '">' +
                 esc(a.text) + '</text>');
    });

    /* ---------- 截断提示（原则③） ---------- */
    if (spec.truncated) {
      parts.push('<text class="splot__note" x="' + x1 + '" y="' + (yTop - 4) +
                 '" text-anchor="end">⚠ 轴已截断，非从零起</text>');
    }

    /* ---------- 文本等价信息（原则⑤） ---------- */
    label.push(spec.title || '科学绘图');
    if (xl) label.push('横轴：' + xl);
    if (yl) label.push('纵轴：' + yl);
    label.push('共 ' + drawn + ' 个数据系列');
    if (spec.desc) label.push(spec.desc);

    var svg = '<svg class="splot ' + esc(spec.className || '') + '" viewBox="0 0 ' + W + ' ' + H +
      '" width="' + W + '" height="' + H + '" role="img" aria-label="' +
      esc(label.join('。')) + '">' + parts.join('') + '</svg>';

    el.innerHTML = svg;
    return { svg: el.firstChild, x: xs, y: ys, ticks: { x: xt, y: yt }, series: drawn };
  }

  /* ------------------------------------------------------------- 小助手 */

  function axisTitle(axis, fallback) {
    if (!axis) return '';
    var t = axis.label || axis.title || fallback;
    if (axis.unit) t += ' / ' + axis.unit;
    return t;
  }

  function fmtTick(v, type) {
    if (type === 'log') {
      if (v >= 1e4 || v < 1e-3) {
        var e = Math.round(Math.log(v) / Math.LN10);
        return '1e' + e;
      }
      return String(+v.toPrecision(4));
    }
    if (Math.abs(v) >= 1e5 || (v !== 0 && Math.abs(v) < 1e-3)) {
      return (+v.toExponential(1)).toString();
    }
    return String(+v.toPrecision(6));
  }

  function dashAttr(idx) {
    var d = DASHES[idx % DASHES.length];
    if (!d || !d.length) return '';
    return ' stroke-dasharray="' + d.join(' ') + '"';
  }

  /* --------------------------------------------------------------- 导出 */

  global.ScientificPlot = {
    render: render,
    /* 给门禁/单测用的真值入口 —— 判据要能直接调它，而不是靠读 DOM 反推 */
    __internals: {
      makeScale: makeScale,
      linearTicks: linearTicks,
      logTicks: logTicks,
      splitByGaps: splitByGaps,
      sampleFunction: sampleFunction,
      SERIES_CLASSES: SERIES_CLASSES
    }
  };

})(typeof window !== 'undefined' ? window : this);
