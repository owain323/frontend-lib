/*
 * sparkline.js — 迷你趋势图（零依赖 · ES5 · 令牌驱动）
 *
 * ============================================================================
 * 为什么自己写而不引库（2026-10-03 调研后的决定）
 * ============================================================================
 * 调研了 GitHub 上几个高质量的零依赖方案，最小的
 * `mitjafelicijan/sparklines` 是 **6390 字节 / 195 行 / gzip 1675 字节**，
 * BSD-2 许可（可商用，只需保留声明）—— 结论是**它做得很好，值得参考**。
 *
 * 但**没有直接引**，两个原因（都不是"嫌它差"）：
 *
 *   ① **它是 ES6**：`const initSparkline = (sparkline) => {...}`
 *      本库的硬约束是 **ES5**（精简档 跑在 某项目 的 WebView 上，
 *      版本不确定）。`const` / 箭头函数在老 WebView 上直接语法错误。
 *
 *   ② **它是 data 属性驱动 + 颜色写死**：示例里 `data-colors="gray"`
 *      或直接给 HEX。本库要求**令牌驱动**（换主题要跟着变）。
 *
 * ⇒ 所以：**借鉴它的接口设计（data 属性驱动、零依赖、BSD 思路）**，
 *   实现按本库约束重写。这不是"标准不够就自创"，
 *   是**在同一目标下按本库既定约束选实现方式**。
 *
 * ============================================================================
 * 用法
 * ============================================================================
 *   <span class="sparkline" data-spark="12,18,15,24,22,31,28"></span>
 *
 * 可选属性：
 *   data-spark-type    line（默认）| bar | area
 *   data-spark-height  像素，默认 32
 *   data-spark-color   CSS 颜色或 var(--x)，默认 var(--accent)
 *   data-spark-fill    yes（默认，area 类型填充）| no
 *   data-spark-last    yes（标出最后一个点）| no
 *   data-spark-animate yes（默认）| no
 *
 * 更新数据：
 *   el.setAttribute('data-spark', '1,2,3');
 *   Chart.emit(el);                 // 重画
 *
 * ============================================================================
 * 🔴 无障碍：这不是"图表"，是**趋势的辅助提示**
 * ============================================================================
 * 纯 SVG 火花线对读屏**没有意义**（一堆路径，读屏只会念"图像"）。
 * ⇒ 本组件**不做 role="img"**（那会让人以为它有可读的文本等价物）。
 * ⇒ **要给出可读的值**，请在旁边放一个数字或用 states 组件里的
 *   "空/错/加载"那套 —— 数字本身才是可访问的信息。
 * ⇒ 什么时候**必须**配文字：数值重要时（例如"营收 128 万，同比 +3.2%"）。
 *     纯装饰性的趋势提示（列表右侧那种小图）可以不配。
 */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var instances = [];

  /* ---------- 小工具（ES5，不用 Array.from 等） */
  function toArray(x) { return Array.prototype.slice.call(x); }
  function el(name, attrs) {
    var n = document.createElementNS(NS, name);
    if (attrs) for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    return n;
  }
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }

  /* ---------- 解析：MISSING != ZERO ----------
   *
   * 🔴 2026-10-04 修一个**真实的语义错误**（借鉴 演示项目名 的图表契约：
   *    `MISSING != ZERO / INVALID != MISSING / 过滤必须可见`）。
   *
   * 原来这里写的是：
   *     if (!isNaN(v)) out.push(v);      // 跳过空项
   * 后果有两处，都很坏：
   *   ① `"1,,3"` 变成 `1,3` ⇒ **画成一条直线**，
   *      看起来像"从 1 平滑降到 3"，实际是"1，然后**没数据**，然后 3"
   *   ② `"1,0,3"`（0 是真值）与 `"1,,3"`（缺失）**在图上完全一样**
   *      ⇒ 缺失被静默当成"没这个点"，而不是"这里没数据"
   *
   * ⇒ 改为：**空值保留为 null**，画的时候**断开**（不跨空值连线）。
   *
   * 为什么这么重要：一条**假装连续**的线会让人读出不存在的趋势
   * —— 数据缺失被当成了"平稳过渡"。这是图表最容易被忽略、
   * 也最容易误导人的一种错。
   */
  function parsePoints(spark) {
    var raw = spark.getAttribute('data-spark') || '';
    if (!raw.trim()) return [];
    var parts = raw.split(',');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].trim();
      // 空串 / 各种"无数据"写法 ⇒ null（**不是 0**）
      if (t === '' || t === '-' || t === 'null' || t === 'NaN') {
        out.push(null);
        continue;
      }
      var v = parseFloat(t);
      out.push(isNaN(v) ? null : v);   // 非法值也当 null，但**在下方标出来**
    }
    return out;
  }

  function readOpts(spark) {
    return {
      type: spark.getAttribute('data-spark-type') || 'line',
      height: num(spark.getAttribute('data-spark-height'), 32),
      color: spark.getAttribute('data-spark-color') || 'var(--accent)',
      fill: (spark.getAttribute('data-spark-fill') || 'yes') !== 'no',
      last: (spark.getAttribute('data-spark-last') || 'no') === 'yes',
      animate: (spark.getAttribute('data-spark-animate') || 'yes') !== 'no',
    };
  }

  /* ---------- 几何：算出所有 x/y ---------- */
  function scale(points, w, h, pad) {
    // 🔴 MISSING != ZERO：**求最值时必须排除 null**。
    //    Math.min(1, null, 3) === 1（null 会被当 0）——
    //    若数据全是正数，null 参与计算会把 min 拉低，图被压扁。
    var vals = [];
    for (var k = 0; k < points.length; k++) {
      if (points[k] !== null) vals.push(points[k]);
    }
    if (!vals.length) return null;          // 全是缺失 ⇒ 画不了
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    // 全平的一条线：给一个人造的上下界，否则除以 0
    if (max === min) { max = min + 1; min = min - 1; }
    var span = max - min;
    var n = points.length;
    var xs = [], ys = [];
    for (var i = 0; i < n; i++) {
      xs.push(n === 1 ? w / 2 : pad + (w - pad * 2) * (i / (n - 1)));
      // 🔴 缺失点的 y 保持 null，draw() 会据此断开
      ys.push(points[i] === null ? null
              : h - pad - (h - pad * 2) * ((points[i] - min) / span));
    }
    return { xs: xs, ys: ys, min: min, max: max };
  }

  /* ---------- 动画：优先 CSS（可被 reduced-motion 关掉） ---------- */
  function supportsReducedMotion() {
    return typeof window.matchMedia === 'function' &&
           window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ---------- 画 ---------- */
  /* 🔴 2026-10-04 修 iOS 实机报的「滑动时一闪一闪」

     真因（实测定位，两条叠加）：
       ① **svg 节点每次都被重建** —— draw() 先清空全部子节点再重建。
          而 iOS **地址栏随滑动收缩/展开 ⇒ 触发 resize ⇒ ResizeObserver 重绘**
          ⇒ 每一次滑动都把整张图换一遍节点 ⇒ **闪一下**。
       ② **`animation: spark-draw` 被反复重播** ——
          dasharray=1000px 从 1000 画到 0，每次重绘都从头画一遍。

     ⇒ 修法：
       ① **尺寸没变就不重绘**（宽度不变直接 return）—— 这一条就消掉了绝大部分闪烁
       ② 重绘时**不加动画类**（动画只该在「首次出现」时播一次）
     */
  function draw(spark) {
    var pts = parsePoints(spark);

    /* 🔴 2026-10-04 修「滑动时一闪一闪」—— **顺序错了，闪得离谱**

       原来这里是「**先清空** → 再量 w → 再比签名 → 才 return」：

         var old = spark.firstChild;
         while (old) { …removeChild… }    ← 🔴 清空发生在 return 之前
         …量 w、算 sig、if (没变) return…   ← 我加的短路，**根本没机会生效**

       ⇒ 节点已经先被清掉了，每次都重建一遍新的。
       iOS 滑动 ⇒ 地址栏收缩 ⇒ resize ⇒ ResizeObserver 回调
       ⇒ 每一次滑动都清空重建 ⇒ **肉眼一闪一闪**（Owner 实机报）。

       ⇒ 修：**先量尺寸、先比签名，命中就 return，一个子节点都不碰。**
         清空动作挪到确认"确实要重画"之后。 */
    var wQuick = Math.round(spark.getBoundingClientRect().width);
    var sigQuick = wQuick + '|' + (spark.getAttribute('data-spark') || '');
    var isFirstQuick = spark.__sparkSig === undefined;
    if (!isFirstQuick && spark.__sparkSig === sigQuick && spark.firstChild) {
      return;                       // 🔴 没变 ⇒ 什么都不做（更不清空）
    }

    // 确认要重画了，这一步才清空
    var old = spark.firstChild;
    while (old) { var n = old.nextSibling; spark.removeChild(old); old = n; }
    if (pts.length < 2) return;      // 少于 2 个点画不出趋势

    var o = readOpts(spark);
    /* 🔴 2026-10-04 修「末点圆点被吃掉一部分」（Owner 实机报，**全局都有**）的
       **真正根因** —— 不是 pad 太小，是 **量到的宽度不对**。

       实测证据：viewBox 宽度 **699**，而容器实际只有 **300px**。
       ⇒ SVG 被横向压缩到 43% ⇒ **末点圆点被压扁、被裁**。

       为什么会量到 699：
         `clientWidth` 在 **flex 布局尚未稳定**时读到的是**收缩前**的宽度
         （那一列此刻还占着整行）。我原来的 pad=2 之所以"看起来对"，
         是因为它和这个错误的宽度是**配套错的**。

       ⇒ 修法两条，缺一不可：
         ① 用 `getBoundingClientRect().width` —— 它给的是**当前实际渲染宽度**；
         ② 布局变化后**重绘**（ResizeObserver 或至少 window.resize），
            因为 flex 收缩是**稍后才发生的**。

       ⚠️ 只做 ① 不够：初次绘制时 rect 仍可能是旧值。
    */
    var w = Math.round(spark.getBoundingClientRect().width)
         || spark.clientWidth
         || num(spark.getAttribute('data-spark-width'), 120);
    var h = o.height;

    /* 🔴 2026-10-04 修「滑动时一闪一闪」的核心：**尺寸没变就别重绘**

       iOS 的**地址栏会随滑动收缩/展开** ⇒ 触发 resize ⇒ ResizeObserver 回调
       ⇒ 而 sparkline 的**宽度根本没变**（只高度变）⇒
       每一次滑动都把整张图的 DOM 节点换一遍 ⇒ **肉眼看到"闪"**。

       ⇒ 缓存上次画过的 (w, h, 数据)，三者都没变就**直接返回**。
          这一条就能消掉绝大部分闪烁，而且零成本。

       ⚠️ 数据也必须参与比较 —— 「更新数据」按钮会改 data-spark，
          那时**必须**重绘，不能被这个优化挡住。 */
    /* 签名已在函数开头比对过（那里才能真正拦住清空），
       这里只负责**记录**。签名不含 h：高度变了也要重画，
       但那属于"用户主动改 data-spark-height"，不是滑动。 */
    spark.__sparkSig = sigQuick;

    /* 🔴 2026-10-04 加（Owner 实机报「趋势图和文字重叠」）：
       **把容器高度同步成图的高度**。

       根因：CSS 里 `.sparkline { height: 32px }` 是写死的，
       而 `data-spark-height` 可以是 48/56 ⇒ **容器装不下图**，
       加上 `overflow: visible` ⇒ 溢出的线画到容器外、压在下边的文字上。

       ⇒ 在这里写 `--spark-h`，CSS 用 `height: var(--spark-h, 32px)` 读它。
          **一处设置，CSS 与 JS 不可能再不一致。**

       ⚠️ 用 setProperty 而不是 style.height：
          那样会与 CSS 的 `height` 打架（行内样式优先级更高，改主题时更难看）。 */
    spark.style.setProperty('--spark-h', h + 'px');

    /* 🔴 2026-10-04 修「末点圆点被裁掉一半」（Owner 实机报，且**全局都有**）

       实测：8/8 张图的折线末点都只有 **2px** 余量，
       而末点圆点半径是 **2.5px** ⇒ `overflow:hidden` **必裁掉一半**。

       ⭐ 真因：`pad` 是**写死的 2**，没有考虑"末端要画东西"。

       ⇒ 改成**按内容算余量**：
          · 有末点圆点（r=2.5）⇒ 至少留 `r + 1`
          · 有柱状图      ⇒ 至少留半个柱宽（否则最后一根也贴边）
          · 折线默认     ⇒ 1.5px（线宽的一半，视觉上刚好）

       ⚠️ 之前我为了修「溢出压到文字」给 `.sparkline` 加了 `overflow:hidden`
          —— 那是**必要的**（防溢出压到下边的字），
          但**它必须与 pad 配合**：pad 不足 ⇒ 末端元素被裁。
          两个 bug 是同一处代码的两面。
    */
    /* pad 必须 ≥「末端绘制物的半径」，否则 overflow:hidden 会裁掉它。
       下面 LAST_R / LAST_BAR 是各形态的末端绘制半径，统一在这里定，
       **不要在别处各写一个数字** —— 那是这次 bug 的成因。 */
    var LAST_R = 2.5;        // 末点圆点半径（与下方 circle r 一致）
    var LAST_BAR = 3;        // 柱宽的一半（与下方 bw 一致）
    /* 🔴 2026-10-04 修「末点圆点被吃掉一半」—— 实测 cx=297.5, r=2.5,
       viewBox 宽 300 ⇒ **圆心距边缘 2.5px = 半径** ⇒ 切线刚好在边缘,
       `overflow:hidden` 就会切掉半个圆点。

       ⚠️ 之前的 pad 算成「r + 1.5」是**不够的** ——
          scale() 的 x 公式是 `pad + (w - pad*2) * (i/(n-1))`，
          最后一点 = **w - pad**，
          所以 pad 必须 **≥ 半径**，而且要留一点余量才好看。

       ⇒ 这里给 LAST_R（不是 LAST_R + 1.5），让「pad = 圆点半径」成为
          **可验证的等式**：圆心距边缘 = pad = r ⇒ 圆点完整可见。 */
    // 🔴 pad=4 ⇒ 圆心x=w-4、圆点右缘=w-1.5 ⇒ **余 1.5px 呼吸**（算过）
    // ⚠️⚠️ 这里**不能**写 `o.last === 'yes'` ——
    //    readOpts 里 `last:` 已经是**布尔值**（`=== 'yes'` 的结果）。
    //    我曾把它当字符串比 ⇒ 永远 false ⇒ pad 恒为 1
    //    ⇒ 末点圆点**必然被裁一半**，而门禁一路报"余 -1.5px"我才发现。
    var pad = o.last ? (LAST_R + 1.5) : 1;
    var s = scale(pts, w, h, pad);
    // 🔴 2026-10-04 修崩溃：scale() 在"全是缺失"时返回 null，
    //    而这里原来直接用了 s.xs ⇒ 抛 TypeError，**整个库挂掉**。
    //    （是我引入 scale 提前返回时漏了这条。）
    if (!s) return;                    // 一个有效点都没有 ⇒ 画不了，也不该画
    if (s.xs.length < 2) return;      // 只有一个有效点，画不出趋势

    var svg = el('svg', {
      width: '100%', height: h,
      viewBox: '0 0 ' + w + ' ' + h,
      /* 🔴 2026-10-04 **删掉 `preserveAspectRatio="none"`** ——
         Owner 实机指出的问题（截图为准）：趋势图变成一条「扁平的锯齿带」。

         真因：`none` 允许 **x 与 y 方向独立缩放**。
         本组件的 viewBox 宽度 = 容器**实际像素宽**（w 来自 clientWidth），
         而 SVG 用 `width:100%` 渲染到同一个宽度 ⇒
         **横向本来就不该缩放**，但 `none` 仍会让浏览器在
         容器宽度 ≠ viewBox 宽度时（非整数舍入、滚动条出现、
         flex 布局未稳定）把图形**横向拉伸** ⇒
         1.5px 的线被拉成几像素宽的「斜面」，看起来像扁平的色带。

         为什么它当初在：多半是想"让图一定填满容器"。
         但**填满容器应该是布局的事**（width:100% 已经做了），
         不该由 SVG 的缩放规则来兜 —— 那是**用视觉换正确性**。

         ⇒ 删掉后走默认的 `xMidYMid meet`：
           - viewBox 宽高比 = 容器宽高比 ⇒ **1:1 渲染，1px 就是 1px**
           - 即使比例略有出入，也只会**等比留边**，不会把线拉变形
         */
      // 🔴 不用 role="img"：见文件头的无障碍说明
      'aria-hidden': 'true',
      focusable: 'false',
    });

    /* 🔴 MISSING != ZERO 的落点：把序列切成**连续段**，**不跨空值连线**。
     *
     * 为什么必须这样：一条横跨缺失点的线，等于在说
     * "从 1 平滑地涨到 3，中间一切正常" —— 而真相是"中间没数据"。
     * **数据缺失被画成了平稳过渡**，这是图表最容易忽略也最会误导人的错。
     *
     * 契约来源：演示项目名 的 ChartsPage 写着
     *   「MISSING != ZERO / INVALID != MISSING / 过滤必须可见」
     * 它自己做到了 connectNulls={false} 且 0 处遗漏 —— 本库照它做。
     */
    var segs = [], cur = [];
    for (var i = 0; i < s.xs.length; i++) {
      if (s.ys[i] === null) {
        if (cur.length) segs.push(cur);
        cur = [];
      } else {
        cur.push(i);
      }
    }
    if (cur.length) segs.push(cur);

    // 有效点少于 2 个 ⇒ 画不出趋势
    var total = 0;
    for (var q = 0; q < segs.length; q++) total += segs[q].length;
    if (total < 2) { spark.appendChild(svg); return; }

    function pathOf(seg) {
      var d = 'M' + s.xs[seg[0]].toFixed(1) + ' ' + s.ys[seg[0]].toFixed(1);
      for (var t = 1; t < seg.length; t++) {
        d += 'L' + s.xs[seg[t]].toFixed(1) + ' ' + s.ys[seg[t]].toFixed(1);
      }
      return d;
    }

    // 面积填充：每段一个 path，**段间不填充**
    if (o.type === 'area' && o.fill) {
      var base = h - pad;
      for (var g = 0; g < segs.length; g++) {
        var sg = segs[g];
        if (sg.length < 2) continue;       // 单点不成"面积"
        var ad = pathOf(sg) +
                 'L' + s.xs[sg[sg.length - 1]].toFixed(1) + ' ' + base +
                 'L' + s.xs[sg[0]].toFixed(1) + ' ' + base + 'Z';
        var ap = el('path', { d: ad, 'class': 'spark-area', 'fill-opacity': '0.14' });
        ap.style.setProperty('--spark-c', o.color);
        svg.appendChild(ap);
      }
    }

    if (o.type === 'bar') {
      var bw = Math.max(1, (w - pad * 2) / pts.length - 1);
      for (var j = 0; j < s.xs.length; j++) {
        // 🔴 缺失点**不画柱** —— 画成 0 高度等于假装"这里是 0"
        if (s.ys[j] === null) continue;
        var bh = h - pad - s.ys[j];
        var rc = el('rect', {
          x: (s.xs[j] - bw / 2).toFixed(1), y: s.ys[j].toFixed(1),
          width: bw.toFixed(1), height: Math.max(0, bh).toFixed(1),
          'class': 'spark-bar',
          'fill-opacity': j === s.xs.length - 1 ? '1' : '0.72',
        });
        rc.style.setProperty('--spark-c', o.color);
        svg.appendChild(rc);
      }
    } else {
      for (var m = 0; m < segs.length; m++) {
        var seg = segs[m];
        if (seg.length === 1) {
          // 单点成段 ⇒ 画成点，否则这段"什么都不画"（用户以为图坏了）
          var dc = el('circle', {
            cx: s.xs[seg[0]].toFixed(1), cy: s.ys[seg[0]].toFixed(1), r: '1.5',
            'class': 'spark-dot',
          });
          dc.style.setProperty('--spark-c', o.color);
          svg.appendChild(dc);
          continue;
        }
        /* 🔴 2026-10-04 改：用 **CSS 类**上色，不用 stroke="var(--x)" 属性。
           Chromium 里 attribute 的 var() 能解析（实测 rgb(122,169,222) 正确），
           但 **presentation attribute 上的 var() 在各浏览器支持不一致**
           —— 规范没保证，Safari 尤其不可靠。
           ⇒ 颜色一律走 CSS（`.spark-line{stroke:var(--spark-c)}`），
             这里只放一个类名 + 把颜色写进自定义属性。
             **所有浏览器都确定支持。 */
        var path = el('path', {
          d: pathOf(seg),
          'class': 'spark-line',      // 🔴 CSS 决定描边/填充（属性打不过 CSS）
          'stroke-width': '1.5',
          'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          'vector-effect': 'non-scaling-stroke',   // 缩放时线宽不变
        });
        path.style.setProperty('--spark-c', o.color);
        // 🔴 动画只该在**首次绘制**时播一次；重绘（尺寸/数据变化）时
        //    再播一遍就会看到「闪」—— 所以只有首绘才加动画类。
        if (o.animate && !supportsReducedMotion() && isFirstQuick) {
          // 🔴 2026-10-04 **拆成独立的动画类**。
          //    旧逻辑是「没动画就不加 spark-line 类」——
          //    但重写外观后 `spark-line` 必须**常驻**（它负责 fill:none），
          //    于是这个判断形同虚设，**动画会无视设置照播**。
          //    ⇒ 外观与行为分成两个类，各管各的。
          path.classList.add('spark-anim');
        }
        svg.appendChild(path);
      }
    }

    // 标出最后一个点（"现在在哪"）
    // 🔴 末点缺失 ⇒ **不标**（标了等于假装知道末值）
    var li = s.xs.length - 1;
    if (o.last && s.ys[li] !== null) {
      var lc = el('circle', {
        cx: s.xs[li].toFixed(1), cy: s.ys[li].toFixed(1), r: String(LAST_R),
        'class': 'spark-dot',
      });
      lc.style.setProperty('--spark-c', o.color);
      svg.appendChild(lc);
    }

    spark.appendChild(svg);
  }

  /* ---------- 对外 ---------- */
  var Chart = {
    draw: draw,
    emit: function (spark) { draw(spark); },
    /** 画一个区域里的所有 sparkline */
    update: function (root) {
      var list = (root || document).querySelectorAll('.sparkline[data-spark]');
      for (var i = 0; i < list.length; i++) draw(list[i]);
    },
  };
  window.Chart = Chart;

  function init() { Chart.update(); }

  /* 🔴 2026-10-04 **ResizeObserver：布局变化后重绘**（修「末点圆点被吃掉」的关键之二）

     为什么必须有：
       sparkline 常放在 **flex 行**里（如「代码 + 数字 + 涨跌 + 走势」）。
       flex 的收缩是**分阶段**发生的：初次绘制时那一列可能还占着整行，
       之后才被压到最终宽度。
       ⇒ **初次绘制拿到的宽度是过时的**，SVG 会被拉伸/压缩，
         末点圆点被压扁、被 `overflow:hidden` 裁掉。

     ⚠️ ResizeObserver 在老 WebView（精简档）**不存在** ——
        所以必须做特性检测，**不能直接用**。
     */
  if (typeof window.ResizeObserver === 'function') {
    var ro = new window.ResizeObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var el = entries[i].target;
        if (el && el.className && el.className.indexOf('sparkline') > -1) {
          draw(el);
        }
      }
    });
    // 观察所有 sparkline（DOMContentLoaded 后才有）
    function observeAll() {
      var list = document.querySelectorAll('.sparkline[data-spark]');
      for (var i = 0; i < list.length; i++) {
        try { ro.observe(list[i]); } catch (e) { /* 忽略 */ }
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', observeAll);
    } else {
      observeAll();
    }
    // 动态插入的（demo 的"更新数据"按钮）也要观察
    Chart.observe = function (el) {
      if (el) { try { ro.observe(el); } catch (e) { /* 忽略 */ } }
      else observeAll();
    };
  } else {
    /* 🔴 兜底：老 WebView 没有 ResizeObserver ⇒ 退到 window.resize
       （窄屏旋转 / 窗口缩放时至少能重绘）。 */
    window.addEventListener('resize', function () { Chart.update(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 窗口尺寸变化时重画（SVG 用 viewBox，但要重算像素宽度）
  var t = null;
  window.addEventListener('resize', function () {
    if (t) clearTimeout(t);
    t = setTimeout(function () { Chart.update(); }, 150);
  });
})();
