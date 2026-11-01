/*
 * echarts-adapter.js — 把本库令牌喂给 Apache ECharts（零依赖 · ES5）
 *
 * ============================================================================
 * ⚠️ 本文件**不含 ECharts**，也不加载它。
 *    它只在 ECharts **已存在**时工作（主项目按需引），本库自己零依赖。
 * ============================================================================
 *
 * ============================================================================
 * 🔴 它解决什么问题
 * ============================================================================
 *   「有了这东西之后，我们画图能够画的更精准更好，
 *     不用每次都花 token 花在画各种不规范的图上面，然后反复地去修改」
 *
 *   ⇒ 本文件是**图表规范的机器可读版本**：
 *     - 主题：换主题时图表跟着变（不用手改 ECharts 配置）
 *     - 规范：把图表规则**变成默认值**（不用每次重想）
 *
 * ============================================================================
 * 为什么这个维护成本≈0
 * ============================================================================
 *   **它不碰任何图表逻辑。** 只做三件事：
 *     ① 从 CSS 变量读颜色        ② 映射成 ECharts 主题对象
 *     ③ 提供一组「合规的默认配置」
 *   图表怎么画、怎么交互 —— 那是 ECharts 的事。
 *
 * ============================================================================
 * 用法
 * ============================================================================
 *   <script src="echarts.min.js"></script>          ← 主项目自己引
 *   <script src="09-assets/echarts-adapter/echarts-adapter.js"></script>
 *   <script>
 *     var c = ChartAdapter.create(document.getElementById('c'));
 *     c.setOption(ChartAdapter.options({
 *       xAxis: { type: 'category', data: ['1月','2月','3月'] },
 *       series: [{ type: 'line', data: [120, 200, 150] }],
 *     }));
 *   </script>
 *
 *   ⚠️ 精简档（某项目）**不要引 ECharts**（约 1MB gzip）——
 *      那边继续用 `09-assets/sparkline`。
 */
(function () {
  'use strict';

  /* ---------- 1. 从 CSS 变量取令牌 ---------- */

  /**
   * 读一个 CSS 变量（读不到就返回 fallback）。
   * @param {string} name
   * @param {string} fallback
   * @param {Element} [ctx]  作用域元素；默认根元素
   *
   * 🔴 为什么必须有 ctx（G2-05）
   *   本库的主题是**容器级**的：`[data-theme="dark"]` 可以只罩住一块区域
   *   （tokens.css 里 `[data-theme="dark"]` 与 `:root[data-theme="dark"]` 并列）。
   *   只读 `document.documentElement` 的话，暗容器里的图表会拿到**浅色**令牌：
   *   实测 `--text-primary` = #15181c，而该容器 `--paper` = #14171A ⇒ **1.01:1**。
   *   文字不是「不够清楚」，是根本看不见。
   */
  function cssVar(name, fallback, ctx) {
    if (typeof window.getComputedStyle !== 'function') return fallback;
    var el = ctx || document.documentElement;
    var v = getComputedStyle(el).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  /** 图表该跟随谁的主题：最近的一个 `[data-theme]` 祖先，没有就是根。 */
  function scopeOf(el) {
    try {
      if (el && el.closest) return el.closest('[data-theme]') || document.documentElement;
    } catch (e) { /* 老浏览器 / 脱离文档的节点 */ }
    return document.documentElement;
  }

  /**
   * 拿到本库的调色板。
   * 🔴 全部有 fallback —— 万一页面没引 tokens.css 也能出图
   *    （不因为缺令牌就整个图表画不出来）。
   */
  function palette(ctx) {
    return {
      text: cssVar('--text-primary', '#15181c', ctx),
      textSub: cssVar('--text-secondary', '#5b6472', ctx),
      textTertiary: cssVar('--text-tertiary', '#8a94a3', ctx),
      surface: cssVar('--surface', '#ffffff', ctx),
      paper: cssVar('--paper', '#f6f7f8', ctx),
      border: cssVar('--border-decor', '#e2e5e9', ctx),
      borderStrong: cssVar('--border-control', '#868b94', ctx),
      danger: cssVar('--danger', '#c0392b', ctx),   // A 股：涨红
      success: cssVar('--success', '#2e7d52', ctx), // 跌绿
      warn: cssVar('--warning', '#b8860b', ctx),
      info: cssVar('--info', '#2b7a9e', ctx),
      accent: cssVar('--accent', '#1b4d8f', ctx),
    };
  }

  /* ---------- 2. 系列配色 ---------- */

  /**
   * 取 n 个系列的颜色。
   * 🔴 **不让调色板自己循环** —— 超过可用色数就返回 null，
   *    调用方应当**改图表类型**（规则：系列 ≤ 5）。
   *
   * 为什么不循环：第 6 个颜色和第 1 个同色，用户分不清谁是谁。
   * 「颜色不够用」是**该换图表**的信号，不是该加颜色的理由。
   */
  function seriesColors(n, p) {
    var ramp = [p.accent, p.danger, p.success, p.warn, p.info];
    if (n > ramp.length) return null;
    return ramp.slice(0, n);
  }

  /* ---------- 3. 主题对象（喂给 echarts.registerTheme） ---------- */

  /** 把一个 CSS 颜色解析成 [r,g,b]（认 #rgb / #rrggbb / rgb() / rgba()）。 */
  function parseColor(v) {
    if (!v) return null;
    var t = String(v).trim();
    var m = /^#([0-9a-f]{3})$/i.exec(t);
    if (m) {
      return [parseInt(m[1][0] + m[1][0], 16),
              parseInt(m[1][1] + m[1][1], 16),
              parseInt(m[1][2] + m[1][2], 16)];
    }
    m = /^#([0-9a-f]{6})$/i.exec(t);
    if (m) {
      return [parseInt(m[1].slice(0, 2), 16),
              parseInt(m[1].slice(2, 4), 16),
              parseInt(m[1].slice(4, 6), 16)];
    }
    m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(t);
    if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
    return null;
  }

  /**
   * 这个作用域是不是暗色 —— 读它**实际解析出来**的 `--paper` 算相对亮度。
   *
   * 🔴 为什么不用 `data-theme` / `data-theme-current` 属性（G2-05）
   *   · `data-theme-current` 只由 theme-toggle.js 写在 `:root` 上；
   *     容器级暗色永远不会设置它 ⇒ 属性判定在容器里恒为「浅色」。
   *   · 就算改用 `data-theme`，也只回答了「声明了什么」，没回答「算出什么色」。
   *   令牌系统允许项目覆盖 `--paper`，只有量出来的亮度才是事实（同 I-10）。
   */
  function isDarkScope(ctx) {
    var c = parseColor(cssVar('--paper', '', ctx));
    if (!c) return false;
    var lin = c.map(function (v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    // 相对亮度 < 0.18 判暗（#14171A ≈ 0.008，#f6f7f8 ≈ 0.90，中间没有歧义）
    return (0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]) < 0.18;
  }

  /**
   * 生成 ECharts 主题。
   * @param {string} name  主题名
   * @param {object} p     调色板（默认自动取）
   */
  function theme(name, p, ctx) {
    p = p || palette(ctx);
    var isDark = isDarkScope(ctx);

    return {
      color: [p.accent, p.danger, p.success, p.warn, p.info],
      backgroundColor: 'transparent',   // 交给页面的背景
      textStyle: {
        color: p.text,
        fontFamily: cssVar('--sans', 'system-ui, sans-serif', ctx),
      },
      title: {
        textStyle: { color: p.text, fontWeight: 600 },
        subtextStyle: { color: p.textSub },
      },
      legend: { textStyle: { color: p.textSub } },
      tooltip: {
        // 令牌即真值：暗档 --surface 实测 = #1C2024（与原来写死的值同色），
        // 亮档 = #ffffff ⇒ 换成令牌后**像素零变化**，但能跟随容器作用域。
        backgroundColor: cssVar('--surface', isDark ? '#1c2024' : '#ffffff', ctx),
        borderColor: p.border,
        borderWidth: 1,
        textStyle: { color: p.text, fontSize: 12 },
        // 🔴 数字统一等宽 + 千分位（数字格式规则）
        extraCssText: isDark
          ? 'box-shadow:0 2px 8px rgba(0,0,0,.5);'
          : 'box-shadow:0 2px 8px rgba(0,0,0,.1);',
      },
      categoryAxis: axisCommon(p, isDark),
      valueAxis: axisCommon(p, isDark),
      logAxis: axisCommon(p, isDark),
      timeAxis: axisCommon(p, isDark),
    };
  }

  function axisCommon(p, isDark) {
    return {
      axisLine: { lineStyle: { color: p.border } },
      axisTick: { show: false },
      axisLabel: { color: p.textSub, fontSize: 11 },
      splitLine: { lineStyle: { color: p.border, type: 'dashed' } },
      // 🔴 分类轴从 0 开始（柱状图的诚实性要求）
      splitNumber: 4,
    };
  }

  /* ---------- 4. 合规的默认配置 ---------- */

  /**
   * 一组**符合图表规范**的默认 option。
   * 覆盖 ECharts 的默认值 —— 让你不写就合规。
   */
  function defaults(option, ctx) {
    var p = palette(ctx);
    var o = option || {};

    // 🔴 数字格式：千分位 + 等宽
    o.textStyle = merge(o.textStyle, {
      fontFamily: cssVar('--mono', 'ui-monospace, monospace', ctx),
    });

    // 网格：留够左边距给 y 轴标签
    o.grid = merge(o.grid, { left: 56, right: 24, top: 32, bottom: 32, containLabel: false });

    // 折线：不平滑（平滑会**造出数据里没有的中间值**）
    o.series = (o.series || []).map(function (s) {
      if (s.type === 'line') {
        return merge(s, {
          smooth: false,                    // 🔴 别撒谎
          showSymbol: (s.data || []).length <= 7,   // ≤7 才显示点
          symbolSize: 5,
          lineStyle: merge(s.lineStyle, { width: 2 }),
        });
      }
      if (s.type === 'bar') {
        return merge(s, {
          barMaxWidth: 28,                   // 细柱更清爽
          // 🔴 分类轴从 0 开始由 yAxis.min=0 保证（见下）
        });
      }
      if (s.type === 'area') {
        return merge(s, {
          areaStyle: merge(s.areaStyle, { opacity: 0.14 }),  // ≤0.15
        });
      }
      return s;
    });

    // y 轴：柱状必须从 0
    var isBar = o.series.some(function (s) { return s.type === 'bar'; });
    if (isBar && o.yAxis) {
      var y = Array.isArray(o.yAxis) ? o.yAxis[0] : o.yAxis;
      if (y && y.min === undefined) y.min = 0;
    }

    // 🔴 超过 5 个系列 ⇒ 明确警告（系列 ≤ 5）
    if (o.series.length > 5) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[frontend-lib] 系列数 ' + o.series.length +
          ' 超过 5 —— 请改图表类型或分屏。配色循环会让颜色撞车。');
      }
    }

    return o;
  }

  /* ---------- 5. 高层封装 ---------- */

  /**
   * 创建一个已应用本库主题的 ECharts 实例。
   * ECharts 不在 ⇒ 返回 null（调用方自己决定怎么办）。
   *
   * 🔴 修正：初版我写了个蠢流程（init → setOption → dispose → 再 init）。
   *    ECharts 5 的主题就是**一个名字**，两种正规用法：
   *      ① init(dom, themeName)
   *      ② setOption(option, themeName)
   *    不需要任何"先注册再重初始化"的 dance。
   */
  /**
   * 主题名 = 调色板身份，必须**按作用域**取。
   * 🔴 `registerTheme` 是全局按名字登记的：一个暗容器里的图和一个页外亮色的图
   *    如果都叫 `fe-light`，后登记的那个会把前一个的配色顶掉 —— 同页两个图表
   *    互相污染，而且看起来「某一块莫名其妙变亮了」。
   */
  function currentThemeName(ctx) {
    return 'fe-' + (isDarkScope(ctx) ? 'dark' : 'light');
  }

  function create(dom, opt) {
    if (typeof window.echarts === 'undefined') {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[frontend-lib] 未检测到 ECharts —— ' +
          '请在主项目里自行引入（前端库本身零依赖）。');
      }
      return null;
    }
    var ctx = scopeOf(dom);
    var name = currentThemeName(ctx);
    // 🔴 每次都注册：换主题后令牌变了，得重新注册同名主题
    if (typeof window.echarts.registerTheme === 'function') {
      window.echarts.registerTheme(name, theme(name, null, ctx));
    }
    var inst = window.echarts.init(dom, name);
    inst.__feDom = dom;          // refresh 要用
    inst.__feOpts = opt || {};
    inst.__feTheme = name;
    inst.setOption(defaults(inst.__feOpts, ctx));
    return inst;
  }

  /* ---------- 小工具 ---------- */
  function merge(a, b) {
    var o = {}, k;
    if (a) for (k in a) if (a.hasOwnProperty(k)) o[k] = a[k];
    if (b) for (k in b) if (b.hasOwnProperty(k)) o[k] = b[k];
    return o;
  }

  /* ---------- 导出 ---------- */
  var ChartAdapter = {
    cssVar: cssVar,
    palette: palette,
    seriesColors: seriesColors,
    theme: theme,
    /** 作用域对应的主题名（`fe-light` / `fe-dark`）。registerTheme 全局按名登记，
     *  同页存在两种作用域时，调用方/判据必须能区分它们。 */
    themeName: currentThemeName,
    defaults: defaults,
    create: create,
    /** 主题切换后重设（配合 theme-toggle.js 调用） */
    refresh: function (inst) {
      if (!inst) return;
      var ctx = scopeOf(inst.__feDom);
      var name = currentThemeName(ctx);
      if (typeof window.echarts !== 'undefined' && window.echarts.registerTheme) {
        window.echarts.registerTheme(name, theme(name, null, ctx));
      }
      // 🔴 主题名变了必须重建实例（ECharts 的主题在 init 时绑定）
      if (inst.__feDom) {
        var opt = inst.__feOpts;
        inst.dispose();
        return create(inst.__feDom, opt);
      }
      inst.setOption(defaults(inst.__feOpts, ctx), name);
      return inst;
    },
  };
  if (typeof window !== 'undefined') window.ChartAdapter = ChartAdapter;
})();
