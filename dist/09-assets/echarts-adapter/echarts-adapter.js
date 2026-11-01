(function () {
'use strict';

function cssVar(name, fallback, ctx) {
if (typeof window.getComputedStyle !== 'function') return fallback;
var el = ctx || document.documentElement;
var v = getComputedStyle(el).getPropertyValue(name);
return (v && v.trim()) || fallback;
}

function scopeOf(el) {
try {
if (el && el.closest) return el.closest('[data-theme]') || document.documentElement;
} catch (e) {  }
return document.documentElement;
}

function palette(ctx) {
return {
text: cssVar('--text-primary', '#15181c', ctx),
textSub: cssVar('--text-secondary', '#5b6472', ctx),
textTertiary: cssVar('--text-tertiary', '#8a94a3', ctx),
surface: cssVar('--surface', '#ffffff', ctx),
paper: cssVar('--paper', '#f6f7f8', ctx),
border: cssVar('--border-decor', '#e2e5e9', ctx),
borderStrong: cssVar('--border-control', '#868b94', ctx),
danger: cssVar('--danger', '#c0392b', ctx),
success: cssVar('--success', '#2e7d52', ctx),
warn: cssVar('--warning', '#b8860b', ctx),
info: cssVar('--info', '#2b7a9e', ctx),
accent: cssVar('--accent', '#1b4d8f', ctx),
};
}

function seriesColors(n, p) {
var ramp = [p.accent, p.danger, p.success, p.warn, p.info];
if (n > ramp.length) return null;
return ramp.slice(0, n);
}

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

function isDarkScope(ctx) {
var c = parseColor(cssVar('--paper', '', ctx));
if (!c) return false;
var lin = c.map(function (v) {
v = v / 255;
return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
});

return (0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]) < 0.18;
}

function theme(name, p, ctx) {
p = p || palette(ctx);
var isDark = isDarkScope(ctx);

return {
color: [p.accent, p.danger, p.success, p.warn, p.info],
backgroundColor: 'transparent',
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

backgroundColor: cssVar('--surface', isDark ? '#1c2024' : '#ffffff', ctx),
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

function defaults(option, ctx) {
var p = palette(ctx);
var o = option || {};

o.textStyle = merge(o.textStyle, {
fontFamily: cssVar('--mono', 'ui-monospace, monospace', ctx),
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
' 超过 5 —— 请改图表类型或分屏。配色循环会让颜色撞车。');
}
}

return o;
}

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

if (typeof window.echarts.registerTheme === 'function') {
window.echarts.registerTheme(name, theme(name, null, ctx));
}
var inst = window.echarts.init(dom, name);
inst.__feDom = dom;
inst.__feOpts = opt || {};
inst.__feTheme = name;
inst.setOption(defaults(inst.__feOpts, ctx));
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

themeName: currentThemeName,
defaults: defaults,
create: create,

refresh: function (inst) {
if (!inst) return;
var ctx = scopeOf(inst.__feDom);
var name = currentThemeName(ctx);
if (typeof window.echarts !== 'undefined' && window.echarts.registerTheme) {
window.echarts.registerTheme(name, theme(name, null, ctx));
}

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
