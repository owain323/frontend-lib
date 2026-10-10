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
  /* 每张图的 clipPath 需要**全局唯一**的 id：
     同一页两张图共用一个 id ⇒ 后渲染的那张会被前一张的裁剪矩形裁掉 */
  var plotUid = 0;

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

  /**
   * 把一段数据切成"坐标都有效"的连续子段。
   *
   * 🔴 为什么不能直接 `xs.to(x) + ',' + ys.to(y)` 拼字符串：
   *     `makeScale.to()` 对**对数轴上的非正数返回 null**（它在那条轴上没有位置），
   *     直接拼 ⇒ 产出 `128,null` ⇒ 浏览器把**整条** polyline 判为非法而丢弃，
   *     读者看到的是"这条曲线不存在"，而不是"这里有几个点画不出来"。
   *     ⇒ 必须**在点级别**断，而且要把断掉的点**计数**告诉调用方。
   *
   * @param {Array} seg  [[x,y],…]，不含缺失值
   * @param {Object} tally  { n: number } —— 被跳过的点数累加器（可为 null）
   * @returns {Array} 若干段 [[[px,py],…],…]，每段 ≥1 个点
   */
  function toRuns(seg, xs, ys, tally) {
    var runs = [], cur = [];
    (seg || []).forEach(function (q) {
      var px = xs.to(q[0]), py = ys.to(q[1]);
      /* 对数轴 ≤0 ⇒ null；非有限值 ⇒ NaN/Infinity。**两者都不能进 graphics */
      if (px == null || py == null || !isFinite(px) || !isFinite(py)) {
        if (tally) tally.n++;
        if (cur.length) runs.push(cur);
        cur = [];
        return;
      }
      cur.push([px, py]);
    });
    if (cur.length) runs.push(cur);
    return runs;
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
    var dparts = [];            /* 数据层单独收集 ⇒ 统一挂裁剪。见下方 clipId */
    var tally = { n: 0 };       /* 画不出来的点数（对数轴非正 / 非有限值） */

    /* 🔴🔴 系列样式身份（外部评审 VIZ-REPORT-01 · P0-2）
       ------------------------------------------------------------------
       修复前每个系列都拿 `'splot__s' + (colorIdx % 5)`，而 `colorIdx` 从头到尾
       是 0 ⇒ 六条 series 全是 s0，同色同线型，读者分不出哪条是哪条材料。

       ⚠️ 修法**不能**是"在循环末尾加一行 colorIdx++"：
          那样每条 *记录* 都会吃掉一个色号，同一材料的「区间带」和「曲线」
          会变成两个颜色 —— 错得更隐蔽（读者会以为是两种材料）。

       ⇒ 正确做法是给**逻辑系列**发身份：
           · 有 `id`（或 `name`）⇒ 身份就是它，**带和线共用同一个色号**
           · 没有 ⇒ 这条记录自成一个系列（至少彼此能分辨）
        这条规则同时也决定了图例怎么排（同一身份只出现一次）。 */
    var styleIds = {};          /* 身份 → 色号 */
    var styleSeq = 0;           /* 已发出的最大色号 +1 */
    function styleIndexOf(s) {
      var key = (s.id != null && s.id !== '') ? s.id : s.name;
      if (key == null || key === '') return styleSeq++;
      var k = String(key);
      if (!Object.prototype.hasOwnProperty.call(styleIds, k)) styleIds[k] = styleSeq++;
      return styleIds[k];
    }
    var legendOrder = [];       /* [{ key, index }] 按首次出现顺序 */
    var drawn = 0;              /* 画出来的系列条数（给 aria-label 与门禁用） */
    /* 像素坐标是否可用：null（对数轴非正）与 NaN/Infinity 都不许进图形 */
    function okPx(v) { return v != null && isFinite(v); }

    series.forEach(function (s) {
      var st = styleIndexOf(s);
      var cls = 'splot__s' + (st % SERIES_CLASSES);
      if (s.name != null && s.name !== '') {
        var key = String(s.id != null && s.id !== '' ? s.id : s.name);
        var seen = legendOrder.some(function (o) { return o.key === key; });
        if (!seen) legendOrder.push({ key: key, name: String(s.name), index: st });
      }
      var dMin = s.samples || 200;
      var data = s.type === 'function'
        ? sampleFunction(s.fn, (s.domain || xs.domain)[0], (s.domain || xs.domain)[1], dMin)
        : (s.data || []);

      if (s.type === 'band') {
        /* 置信区间带：上下两条边 + 中间填充
           🔴 与折线同一条纪律：**不能跨过画不出来的点**。
              一路 push 到同一个 polygon ⇒ 遇到对数轴上 ≤0 的边界时，
              这段"根本没有数据"的区间会被**连成一块完整的色带**，
              等于向读者宣称那里有观测支撑。 ⇒ 按连续可用段切开。 */
        var bRuns = [], bCur = [];
        data.forEach(function (p) {
          var px = xs.to(p[0]), hi = ys.to(p[2]), lo = ys.to(p[1]);
          if (!okPx(px) || !okPx(hi) || !okPx(lo)) {
            tally.n++;
            if (bCur.length >= 2) bRuns.push(bCur);
            bCur = [];
            return;
          }
          bCur.push([px, hi, lo]);
        });
        if (bCur.length >= 2) bRuns.push(bCur);

        bRuns.forEach(function (run) {
          var up = [], dn = [];
          run.forEach(function (c) { up.push(c[0] + ',' + c[1]); });
          for (var j = run.length - 1; j >= 0; j--) dn.push(run[j][0] + ',' + run[j][2]);
          dparts.push('<polygon class="splot__band ' + cls + '" points="' +
                      up.join(' ') + ' ' + dn.join(' ') + '"/>');
        });
        if (bRuns.length) drawn++;
        return;
      }

      if (s.type === 'errorbar') {
        /* 误差棒：只画调用方给的误差，**不计算** */
        data.forEach(function (p) {
          var px = xs.to(p[0]);
          if (!okPx(px) || !isNum(p[1])) { tally.n++; return; }
          var py = ys.to(p[1]); if (!okPx(py)) { tally.n++; return; }
          /* 两种写法都支持：
               [x, y, yerr]      —— 对称误差，上下各延 yerr
               [x, y, lo, hi]    —— 非对称区间（调用方自己算好的边界）
             🔴 本模块只画给定的边界，**不替调用方计算**标准误或置信区间。 */
          var yLo = p.length > 3 ? p[2] : p[1] - (p[2] || 0);
          var yHi = p.length > 3 ? p[3] : p[1] + (p[2] || 0);
          var pa = ys.to(yLo), pb = ys.to(yHi);
          if (!okPx(pa) || !okPx(pb)) { tally.n++; return; }
          dparts.push('<line class="splot__err ' + cls + '" x1="' + px + '" y1="' + pa +
                     '" x2="' + px + '" y2="' + pb + '"/>');
          dparts.push('<line class="splot__err ' + cls + '" x1="' + (px - 4) + '" y1="' + pa +
                     '" x2="' + (px + 4) + '" y2="' + pa + '"/>');
          dparts.push('<line class="splot__err ' + cls + '" x1="' + (px - 4) + '" y1="' + pb +
                     '" x2="' + (px + 4) + '" y2="' + pb + '"/>');
        });
        drawn++;
        return;
      }

      if (s.type === 'line' || s.type === 'function') {
        /* 🔴 ① 按缺失分段，**不跨 null 连线**（原则②）
               ② 段内再按"坐标算不算得出来"切开（对数轴 ≤0 / 非有限值） */
        var segs = splitByGaps(data, function (p) { return p[0]; }, function (p) { return p[1]; });
        segs.forEach(function (seg) {
          toRuns(seg, xs, ys, tally).forEach(function (run) {
            if (run.length < 2) {
              /* 单个孤立点也要能看见，否则它就从图上消失了 */
              dparts.push('<circle class="splot__pt ' + cls + '" cx="' + run[0][0] +
                          '" cy="' + run[0][1] + '" r="2.5"/>');
              return;
            }
            var pts = run.map(function (c) { return c[0] + ',' + c[1]; }).join(' ');
            dparts.push('<polyline class="splot__line ' + cls + '" points="' + pts +
                        '"' + dashAttr(st) + '/>');
          });
        });
        drawn++;
        return;
      }

      if (s.type === 'scatter') {
        data.forEach(function (p) {
          var px = xs.to(p[0]);
          if (!okPx(px) || !isNum(p[1])) { tally.n++; return; }
          var py = ys.to(p[1]); if (!okPx(py)) { tally.n++; return; }
          dparts.push('<circle class="splot__pt ' + cls + '" cx="' + px + '" cy="' + py +
                     '" r="3"/>');
        });
        drawn++;
        return;
      }
    });

    /* ---------- 🔴 裁剪：数据不许画到坐标域之外 ----------
       SVG 的 `overflow` 默认是 visible：一个超出 domain 的散点会直接落到
       轴外侧、甚至压到相邻的卡片上（09-assets/bar 真机踩过同一个坑）。
       ⇒ 用 clipPath 把**数据层**锁在坐标矩形内；网格与轴不参与（它们本来就在边上）。
       ⚠️ id 必须每次渲染都换新的：同一页多张图共用 id ⇒ 后面的图会被前面的裁掉。 */
    var clipId = 'splot-clip-' + (++plotUid);
    parts.push('<defs><clipPath id="' + clipId + '"><rect x="' + x0 + '" y="' + yTop +
               '" width="' + (x1 - x0) + '" height="' + (yBot - yTop) +
               '"/></clipPath></defs>');
    parts.push('<g clip-path="url(#' + clipId + ')">' + dparts.join('') + '</g>');

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

    /* 🔴 有画不出来的点就**明说**（对数轴 ≤0 / 非有限值）
       —— 静默丢弃会让读者以为"这条曲线整个就是这个形状" */
    if (tally.n > 0) {
      parts.push('<text class="splot__note" x="' + x0 + '" y="' + (yTop - 4) + '">⚠ ' +
                 tally.n + ' 个点不在数轴范围内，未绘制</text>');
    }

    /* ---------- 文本等价信息（原则⑤） ---------- */
    label.push(spec.title || '科学绘图');
    if (xl) label.push('横轴：' + xl);
    if (yl) label.push('纵轴：' + yl);
    label.push('共 ' + drawn + ' 个数据系列');
    /* 系列名要进 aria-label：只用颜色区分 ⇔ 读屏用户完全无从分辨 */
    if (legendOrder.length) {
      label.push('系列：' + legendOrder.map(function (o) { return o.name; }).join('、'));
    }
    if (tally.n > 0) label.push('有 ' + tally.n + ' 个点不在轴范围内未绘制');
    if (spec.desc) label.push(spec.desc);

    var svg = '<svg class="splot ' + esc(spec.className || '') + '" viewBox="0 0 ' + W + ' ' + H +
      '" width="' + W + '" height="' + H + '" role="img" aria-label="' +
      esc(label.join('。')) + '">' + parts.join('') + '</svg>';

    /* ---------- 图例（B7：颜色之外必须有名字） ---------- *
     * 🔴 什么时候出：**有两个以上有名字的系列**时自动出。
     *   三条曲线的颜色不同、但没有任何文字告诉你谁是谁 ⇒ 这张图回答不了问题。
     *   ⇒ 想关就显式传 `legend: false`。
     * ⚠️ 同一身份（带 + 线）只出现**一次**，并且色块取的就是它自己那条线的色号。 */
    var legendHtml = '';
    var wantLegend = spec.legend === undefined
      ? legendOrder.length >= 2
      : !!spec.legend;
    if (wantLegend && legendOrder.length) {
      var items = legendOrder.map(function (o) {
        var c = 'splot__s' + (o.index % SERIES_CLASSES);
        /* 用一小段**真的线**做色标，`--splot-c` 由上面的系列类给
           ⇒ 图例的色和曲线/色带的色来自同一份声明，不可能对不上 */
        return '<li class="splot__legend-item">' +
               '<svg class="splot__legend-mark ' + c + '" width="20" height="10" ' +
               'viewBox="0 0 20 10" aria-hidden="true" focusable="false">' +
               '<line x1="1" y1="5" x2="19" y2="5" stroke-width="2" stroke-linecap="round"' +
               dashAttr(o.index) + '/></svg>' +
               '<span>' + esc(o.name) + '</span></li>';
      });
      legendHtml = '<ul class="splot__legend">' + items.join('') + '</ul>';
    }

    el.innerHTML = svg + legendHtml;
    return {
      svg: el.firstChild,
      x: xs, y: ys,
      ticks: { x: xt, y: yt },
      series: drawn,
      dropped: tally.n,
      legend: el.querySelector('.splot__legend'),
      styles: legendOrder.map(function (o) { return o.index; }),
    };
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
      toRuns: toRuns,
      sampleFunction: sampleFunction,
      SERIES_CLASSES: SERIES_CLASSES
    }
  };

})(typeof window !== 'undefined' ? window : this);
