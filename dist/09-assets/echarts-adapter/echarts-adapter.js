(function () {
'use strict';

function cssVar(name, fallback) {
if (typeof window.getComputedStyle !== 'function') return fallback;
var v = getComputedStyle(document.documentElement).getPropertyValue(name);
return (v && v.trim()) || fallback;
}

function palette() {
return {
text: cssVar('--text-primary', '#15181c'),
textSub: cssVar('--text-secondary', '#5b6472'),
textTertiary: cssVar('--text-tertiary', '#8a94a3'),
surface: cssVar('--surface', '#ffffff'),
paper: cssVar('--paper', '#f6f7f8'),
border: cssVar('--border-decor', '#e2e5e9'),
borderStrong: cssVar('--border-control', '#868b94'),
danger: cssVar('--danger', '#c0392b'),
success: cssVar('--success', '#2e7d52'),
warn: cssVar('--warning', '#b8860b'),
info: cssVar('--info', '#2b7a9e'),
accent: cssVar('--accent', '#1b4d8f'),
};
}

function seriesColors(n, p) {
var ramp = [p.accent, p.danger, p.success, p.warn, p.info];
if (n > ramp.length) return null;
return ramp.slice(0, n);
}

function theme(name, p) {
p = p || palette();
var isDark = document.documentElement.getAttribute('data-theme-current') === 'dark'
|| cssVar('--paper', '#fff') !== '#f6f7f8';

return {
color: [p.accent, p.danger, p.success, p.warn, p.info],
backgroundColor: 'transparent',
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

splitNumber: 4,
};
}

function defaults(option) {
var p = palette();
var o = option || {};

o.textStyle = merge(o.textStyle, {
fontFamily: cssVar('--mono', 'ui-monospace, monospace'),
});

o.grid = merge(o.grid, { left: 56, right: 24, top: 32, bottom: 32, containLabel: false });

o.series = (o.series || []).map(function (s) {
if (s.type === 'line') {
return merge(s, {
smooth: false,
showSymbol: (s.data || []).length <= 7,
symbolSize: 5,
lineStyle: merge(s.lineStyle, { width: 2 }),
});
}
if (s.type === 'bar') {
return merge(s, {
barMaxWidth: 28,

});
}
if (s.type === 'area') {
return merge(s, {
areaStyle: merge(s.areaStyle, { opacity: 0.14 }),
});
}
return s;
});

var isBar = o.series.some(function (s) { return s.type === 'bar'; });
if (isBar && o.yAxis) {
var y = Array.isArray(o.yAxis) ? o.yAxis[0] : o.yAxis;
if (y && y.min === undefined) y.min = 0;
}

if (o.series.length > 5) {
if (typeof console !== 'undefined' && console.warn) {
console.warn('[frontend-lib] 系列数 ' + o.series.length +
' 超过 5 —— 请改图表类型或分屏，见 charter 10。配色循环会让颜色撞车。');
}
}

return o;
}

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

if (typeof window.echarts.registerTheme === 'function') {
window.echarts.registerTheme(name, theme(name));
}
var inst = window.echarts.init(dom, name);
inst.__feDom = dom;
inst.__feOpts = opt || {};
inst.__feTheme = name;
inst.setOption(defaults(inst.__feOpts));
return inst;
}

function merge(a, b) {
var o = {}, k;
if (a) for (k in a) if (a.hasOwnProperty(k)) o[k] = a[k];
if (b) for (k in b) if (b.hasOwnProperty(k)) o[k] = b[k];
return o;
}

var ChartAdapter = {
cssVar: cssVar,
palette: palette,
seriesColors: seriesColors,
theme: theme,
defaults: defaults,
create: create,

refresh: function (inst) {
if (!inst) return;
var name = currentThemeName();
if (typeof window.echarts !== 'undefined' && window.echarts.registerTheme) {
window.echarts.registerTheme(name, theme(name));
}

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
