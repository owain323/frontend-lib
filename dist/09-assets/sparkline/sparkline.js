(function () {
'use strict';

var NS = 'http://www.w3.org/2000/svg';
var instances = [];

function toArray(x) { return Array.prototype.slice.call(x); }
function el(name, attrs) {
var n = document.createElementNS(NS, name);
if (attrs) for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
return n;
}
function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }

function parsePoints(spark) {
var raw = spark.getAttribute('data-spark') || '';
if (!raw.trim()) return [];
var parts = raw.split(',');
var out = [];
for (var i = 0; i < parts.length; i++) {
var t = parts[i].trim();

if (t === '' || t === '-' || t === 'null' || t === 'NaN') {
out.push(null);
continue;
}
var v = parseFloat(t);
out.push(isNaN(v) ? null : v);
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

function scale(points, w, h, pad) {

var vals = [];
for (var k = 0; k < points.length; k++) {
if (points[k] !== null) vals.push(points[k]);
}
if (!vals.length) return null;
var min = Math.min.apply(null, vals);
var max = Math.max.apply(null, vals);

if (max === min) { max = min + 1; min = min - 1; }
var span = max - min;
var n = points.length;
var xs = [], ys = [];
for (var i = 0; i < n; i++) {
xs.push(n === 1 ? w / 2 : pad + (w - pad * 2) * (i / (n - 1)));

ys.push(points[i] === null ? null
: h - pad - (h - pad * 2) * ((points[i] - min) / span));
}
return { xs: xs, ys: ys, min: min, max: max };
}

function supportsReducedMotion() {
return typeof window.matchMedia === 'function' &&
window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function draw(spark) {
var pts = parsePoints(spark);

var wQuick = Math.round(spark.getBoundingClientRect().width);
var sigQuick = wQuick + '|' + (spark.getAttribute('data-spark') || '');
var isFirstQuick = spark.__sparkSig === undefined;
if (!isFirstQuick && spark.__sparkSig === sigQuick && spark.firstChild) {
return;
}

var old = spark.firstChild;
while (old) { var n = old.nextSibling; spark.removeChild(old); old = n; }
if (pts.length < 2) return;

var o = readOpts(spark);

var w = Math.round(spark.getBoundingClientRect().width)
|| spark.clientWidth
|| num(spark.getAttribute('data-spark-width'), 120);
var h = o.height;

spark.__sparkSig = sigQuick;

spark.style.setProperty('--spark-h', h + 'px');

var LAST_R = 2.5;
var LAST_BAR = 3;

var pad = o.last ? (LAST_R + 1.5) : 1;
var s = scale(pts, w, h, pad);

if (!s) return;
if (s.xs.length < 2) return;

var svg = el('svg', {
width: '100%', height: h,
viewBox: '0 0 ' + w + ' ' + h,

'aria-hidden': 'true',
focusable: 'false',
});

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

if (o.type === 'area' && o.fill) {
var base = h - pad;
for (var g = 0; g < segs.length; g++) {
var sg = segs[g];
if (sg.length < 2) continue;
var ad = pathOf(sg) +
'L'+ s.xs[sg[sg.length - 1]].toFixed(1) + ' ' + base +
'L'+ s.xs[sg[0]].toFixed(1) + ' ' + base + 'Z';
var ap = el('path', { d: ad, 'class': 'spark-area', 'fill-opacity': '0.14' });
ap.style.setProperty('--spark-c', o.color);
svg.appendChild(ap);
}
}

if (o.type === 'bar') {
var bw = Math.max(1, (w - pad * 2) / pts.length - 1);
for (var j = 0; j < s.xs.length; j++) {

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

var dc = el('circle', {
cx: s.xs[seg[0]].toFixed(1), cy: s.ys[seg[0]].toFixed(1), r: '1.5',
'class': 'spark-dot',
});
dc.style.setProperty('--spark-c', o.color);
svg.appendChild(dc);
continue;
}

var path = el('path', {
d: pathOf(seg),
'class': 'spark-line',
'stroke-width': '1.5',
'stroke-linecap': 'round', 'stroke-linejoin': 'round',
'vector-effect': 'non-scaling-stroke',
});
path.style.setProperty('--spark-c', o.color);

if (o.animate && !supportsReducedMotion() && isFirstQuick) {

path.classList.add('spark-anim');
}
svg.appendChild(path);
}
}

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

var Chart = {
draw: draw,
emit: function (spark) { draw(spark); },

update: function (root) {
var list = (root || document).querySelectorAll('.sparkline[data-spark]');
for (var i = 0; i < list.length; i++) draw(list[i]);
},
};
window.Chart = Chart;

function init() { Chart.update(); }

if (typeof window.ResizeObserver === 'function') {
var ro = new window.ResizeObserver(function (entries) {
for (var i = 0; i < entries.length; i++) {
var el = entries[i].target;
if (el && el.className && el.className.indexOf('sparkline') > -1) {
draw(el);
}
}
});

function observeAll() {
var list = document.querySelectorAll('.sparkline[data-spark]');
for (var i = 0; i < list.length; i++) {
try { ro.observe(list[i]); } catch (e) {  }
}
}
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', observeAll);
} else {
observeAll();
}

Chart.observe = function (el) {
if (el) { try { ro.observe(el); } catch (e) {  } }
else observeAll();
};
} else {

window.addEventListener('resize', function () { Chart.update(); });
}

if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', init);
} else {
init();
}

var t = null;
window.addEventListener('resize', function () {
if (t) clearTimeout(t);
t = setTimeout(function () { Chart.update(); }, 150);
});
})();
