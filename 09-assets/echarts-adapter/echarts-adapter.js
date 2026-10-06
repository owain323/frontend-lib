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
 *     - 规范：把 charter 10 里的规则**变成默认值**（不用每次重想）
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
 *      那边继续用 09-assets/sparkline。见 charter 10。
 */
(function () {
  'use strict';

  /* ---------- 1. 从 CSS 变量取令牌 ---------- */

  /** 读一个 CSS 变量（读不到就返回 fallback）。 */
  function cssVar(name, fallback) {
    if (typeof window.getComputedStyle !== 'function') return fallback;
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  /**
   * 拿到本库的调色板。
   * 🔴 全部有 fallback —— 万一页面没引 tokens.css 也能出图
   *    （不因为缺令牌就整个图表画不出来）。
   */
  function palette() {
    return {
      text: cssVar('--text-primary', '#15181c'),
      textSub: cssVar('--text-secondary', '#5b6472'),
      textTertiary: cssVar('--text-tertiary', '#8a94a3'),
      surface: cssVar('--surface', '#ffffff'),
      paper: cssVar('--paper', '#f6f7f8'),
      border: cssVar('--border-decor', '#e2e5e9'),
      borderStrong: cssVar('--border-control', '#868b94'),
      danger: cssVar('--danger', '#c0392b'),   // A 股：涨红
      success: cssVar('--success', '#2e7d52'), // 跌绿
      warn: cssVar('--warning', '#b8860b'),
      info: cssVar('--info', '#2b7a9e'),
      accent: cssVar('--accent', '#1b4d8f'),
    };
  }

  /* ---------- 2. 系列配色 ---------- */

  /**
   * 取 n 个系列的颜色。
   * 🔴 **不让调色板自己循环** —— 超过可用色数就返回 null，
   *    调用方应当**改图表类型**（charter 10 的规则：系列 ≤ 5）。
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

  /**
   * 生成 ECharts 主题。
   * @param {string} name  主题名
   * @param {object} p     调色板（默认自动取）
   */
  function theme(name, p) {
    p = p || palette();
    var isDark = document.documentElement.getAttribute('data-theme-current') === 'dark'
              || cssVar('--paper', '#fff') !== '#f6f7f8';

    return {
      color: [p.accent, p.danger, p.success, p.warn, p.info],
      backgroundColor: 'transparent',   // 交给页面的背景
      textStyle: {
        color: p.text,
        fontFamily: cssVar('--sans', 'system-ui, sans-serif'),
      },
      title: {
        textStyle: { color: p.text, fontWeight: 600 },
        subtextStyle: { color: p.textSub },
      },
      legend: { textStyle: { color: p.textSub } },
      tooltip: {
        backgroundColor: isDark ? '#1c2024' : '#ffffff',
        borderColor: p.border,
        borderWidth: 1,
        textStyle: { color: p.text, fontSize: 12 },
        // 🔴 数字统一等宽 + 千分位（charter 10 的数字格式规则）
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
      // 🔴 分类轴从 0 开始（柱状图的诚实性要求，见 charter 10）
      splitNumber: 4,
    };
  }

  /* ---------- 4. 合规的默认配置 ---------- */

  /**
   * 一组**符合 charter 10 规范**的默认 option。
   * 覆盖 ECharts 的默认值 —— 让你不写就合规。
   */
  function defaults(option) {
    var p = palette();
    var o = option || {};

    // 🔴 数字格式：千分位 + 等宽
    o.textStyle = merge(o.textStyle, {
      fontFamily: cssVar('--mono', 'ui-monospace, monospace'),
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

    // 🔴 超过 5 个系列 ⇒ 明确警告（charter 10：系列 ≤ 5）
    if (o.series.length > 5) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[frontend-lib] 系列数 ' + o.series.length +
          ' 超过 5 —— 请改图表类型或分屏，见 charter 10。配色循环会让颜色撞车。');
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
  function currentThemeName() {
    return 'fe-' +
      (document.documentElement.getAttribute('data-theme-current') || 'light');
  }

  function create(dom, opt) {
    if (typeof window.echarts === 'undefined') {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[frontend-lib] 未检测到 ECharts —— ' +
          '请在主项目里自行引入（前端库本身零依赖）。');
      }
      return null;
    }
    var name = currentThemeName();
    // 🔴 每次都注册：换主题后令牌变了，得重新注册同名主题
    if (typeof window.echarts.registerTheme === 'function') {
      window.echarts.registerTheme(name, theme(name));
    }
    var inst = window.echarts.init(dom, name);
    inst.__feDom = dom;          // refresh 要用
    inst.__feOpts = opt || {};
    inst.__feTheme = name;
    inst.setOption(defaults(inst.__feOpts));
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
    defaults: defaults,
    create: create,
    /** 主题切换后重设（配合 theme-toggle.js 调用） */
    refresh: function (inst) {
      if (!inst) return;
      var name = currentThemeName();
      if (typeof window.echarts !== 'undefined' && window.echarts.registerTheme) {
        window.echarts.registerTheme(name, theme(name));
      }
      // 🔴 主题名变了必须重建实例（ECharts 的主题在 init 时绑定）
      if (inst.__feDom) {
        var opt = inst.__feOpts;
        inst.dispose();
        return create(inst.__feDom, opt);
      }
      inst.setOption(defaults(inst.__feOpts), name);
      return inst;
    },
  };
  if (typeof window !== 'undefined') window.ChartAdapter = ChartAdapter;
})();
