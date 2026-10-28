(function (global) {
'use strict';

var NS = 'http://www.w3.org/2000/svg';
var uid = 0;

var SERIES_STYLES = 5;

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

function draw(opt) {
opt = opt || {};
var host = opt.host;
if (!host) throw new Error('bar.draw: 缺少 host');
if (opt.max === undefined || opt.max === null) {

throw new Error('bar.draw: max 是必填项（铁律三：量程不得自动适配）');
}

var series = opt.series || [];
var max = +opt.max;
var H = opt.height || 180;
var nS = series.length;
var mode = opt.mode === 'group' ? 'group' : 'stack';

var W = Math.max(240, Math.round(+opt.width || 640));
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

var groupW = plotW / n;

var barW = mode === 'group'
? Math.max(2, (groupW * 0.82) / nS)
: Math.max(2, groupW * 0.62);
var clipped = [];
var x, h, yy, s, vv, bottom, top, vb, vt, rect, k0, k1;

var base = new Array(n);
for (k0 = 0; k0 < n; k0++) base[k0] = 0;

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
if (mode === 'stack') base[i] = top;

if (top > plotH && clipped.indexOf(i) < 0) clipped.push(i);
vb = Math.min(bottom, plotH);
vt = Math.min(top, plotH);
if (vt - vb < 0.01) continue;

x = mode === 'group'
? padL + groupW * i + (groupW - barW * nS) / 2 + barW * s
: padL + groupW * i + (groupW - barW) / 2;
yy = padT + plotH - vt;

rect = el('rect', {
'class': 'bar__bar bar__s' + (s % SERIES_STYLES) +
(series[s].cls ? ' ' + series[s].cls : ''),
x: x, y: yy, width: barW, height: vt - vb,
});

if (top <= plotH && vt === top) rect.setAttribute('rx', 1.5);

if (vt < top) rect.setAttribute('data-clipped', '1');
svg.appendChild(rect);
}
}

if (opt.threshold != null) {
var th = (+opt.threshold / max) * plotH;
y = padT + plotH - th;
svg.appendChild(el('line', {
'class': 'bar__threshold', x1: padL, x2: W - padR, y1: y, y2: y,
}));
}

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

var keys = pickKeyPoints(topVal);

clipped.forEach(function (ci) { keys[ci] = keys[ci] || 'clip'; });

var count = 0;
for (var k in keys) {
if (!Object.prototype.hasOwnProperty.call(keys, k)) continue;
if (count >= 4) break;
var i2 = +k;
var v2 = +topVal[i2] || 0;
var h2 = Math.min((v2 / max) * plotH, plotH);
var yy2 = padT + plotH - h2;
var lb = el('text', {

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

li.appendChild(sw);
var tx = document.createElement('span');
tx.textContent = se.name || ('系列 ' + (si + 1));
li.appendChild(tx);
legendEl.appendChild(li);
});
host.appendChild(legendEl);
}

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
'超出量程（上限 '+ max + '），已按上限截断显示。';
host.appendChild(p2);
}

return {
el: svg,
clipped: clipped,
mode: mode,

tops: topVal,
legend: legendEl,
destroy: function () { host.innerHTML = ''; },
};
}

global.Bar = { draw: draw };
})(window);
