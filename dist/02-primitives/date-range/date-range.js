(function (global) {
'use strict';

var flEmit = function (el, name, detail) {
if (!el || !el.dispatchEvent) return null;
var type = name.indexOf('fl-') === 0 ? name : 'fl-' + name;
var ev = null;

if (typeof window.CustomEvent === 'function') {
try {
ev = new window.CustomEvent(type, {
detail: detail || null, bubbles: true, cancelable: false
});
} catch (e) { ev = null; }
}
if (!ev) {
try {
ev = document.createEvent('CustomEvent');
ev.initCustomEvent(type, true, false, detail || null);
} catch (e2) { return null; }
}
el.dispatchEvent(ev);
return ev;
};

function closest(el, sel) {
if (!el) return null;
if (el.closest) return el.closest(sel);
while (el && el.nodeType === 1) {
if (elMatches(el, sel)) return el;
el = el.parentElement;
}
return null;
}
function elMatches(el, sel) {
var m = sel.match(/^([a-zA-Z][\w-]*)/);
if (m && el.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
var cls = sel.match(/\.([\w-]+)/g);
if (cls) {
for (var i = 0; i < cls.length; i++) {
var c = cls[i].slice(1);
if ((' ' + (el.className || '') + ' ').indexOf(' ' + c + ' ') < 0) return false;
}
}
var id = sel.match(/#([\w-]+)/);
if (id && el.id !== id[1]) return false;
var at = sel.match(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/);
if (at) {
var v = el.getAttribute(at[1]);
if (v === null) return false;
if (at[2] !== undefined && v !== at[2]) return false;
}
return true;
}

var uid = 0;

function iso(d) {
if (!d) return '';
var m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
if (m) return m[1] + '-' + m[2] + '-' + m[3];
var dt = new Date(d);
if (isNaN(dt)) return '';
function p(n) { return (n < 10 ? '0' : '') + n; }
return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
}
function addDays(isoStr, n) {
var d = new Date(isoStr + 'T00:00:00');
d.setDate(d.getDate() + n);
return iso(d);
}
function addMonths(isoStr, n) {
var d = new Date(isoStr + 'T00:00:00');
var day = d.getDate();
d.setDate(1);
d.setMonth(d.getMonth() + n);

var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
d.setDate(Math.min(day, last));
return iso(d);
}
function quarterOf(date) {
var q = Math.floor(date.getMonth() / 3);
return { y: date.getFullYear(), q: q };
}
function quarterRange(y, q) {

if (q !== 0 && q !== 1 && q !== 2 && q !== 3) {
throw new Error('DateRange.quarterRange: 季度必须是 0-3（0=Q1），收到 ' + q);
}
var start = new Date(y, q * 3, 1);
var end = new Date(y, q * 3 + 3, 0);
return { from: iso(start), to: iso(end) };
}

function create(root, opt) {
opt = opt || {};
var from = root.querySelector('[data-dr-from]');
var to = root.querySelector('[data-dr-to]');
var errBox = root.querySelector('[data-dr-error]');
var summary = root.querySelector('[data-dr-summary]');
var clearBtn = root.querySelector('[data-dr-clear]');
if (!from || !to) throw new Error('DateRange: 缺少 [data-dr-from] / [data-dr-to]');

if (opt.min) { from.min = opt.min; to.min = opt.min; }
if (opt.max) { from.max = opt.max; to.max = opt.max; }

function setError(msg) {
if (errBox) {
errBox.textContent = msg || '';
errBox.hidden = !msg;
}

from.setAttribute('aria-invalid', msg ? 'true' : 'false');
to.setAttribute('aria-invalid', msg ? 'true' : 'false');
if (msg) {
var id = 'dr-err-' + (++uid);
errBox.id = id;
from.setAttribute('aria-describedby', id);
to.setAttribute('aria-describedby', id);
} else {
from.removeAttribute('aria-describedby');
to.removeAttribute('aria-describedby');
}
}

function days(fromS, toS) {
var a = new Date(fromS + 'T00:00:00'), b = new Date(toS + 'T00:00:00');
return Math.round((b - a) / 86400000) + 1;
}

function validate() {
var f = from.value, t = to.value;
if (!f && !t) { setError(''); paintSummary(''); return true; }
if (f && !t) { setError('请填写结束日期。'); return false; }
if (!f && t) { setError('请填写开始日期。'); return false; }
if (f > t) {
setError('开始日期不能晚于结束日期（当前：' + f + ' → ' + t + '）。');
return false;
}
if (opt.min && f < opt.min) { setError('开始日期不能早于 ' + opt.min + '。'); return false; }
if (opt.max && t > opt.max) { setError('结束日期不能晚于 ' + opt.max + '。'); return false; }
setError('');
paintSummary(f + ' → ' + t + '（' + days(f, t) + ' 天）');
return true;
}

function paintSummary(s) {
if (summary) summary.innerHTML = s ? ('区间 <b>' + s + '</b>') : '';
}

function emit() {
var ok = validate();
flEmit(root, 'fl-change',
{ value: { from: from.value, to: to.value }, valid: ok });
if (opt.onChange) {
opt.onChange({ from: from.value, to: to.value, valid: ok }, ok);
}
}

function bindPresets() {
var now = new Date();
var q = quarterOf(now);
var presets = [
{ key: 'thisQ',  label: '本季度', range: function () { return quarterRange(q.y, q.q); } },
{ key: 'lastQ',  label: '上季度',
range: function () { return q.q === 0 ? quarterRange(q.y - 1, 3) : quarterRange(q.y, q.q - 1); } },
{ key: 'lastM',  label: '上月',
range: function () {
var m = new Date(now.getFullYear(), now.getMonth() - 1, 1);
return { from: iso(m), to: iso(new Date(m.getFullYear(), m.getMonth() + 1, 0)) };
} },
{ key: 'thisY',  label: '今年',
range: function () {
return { from: iso(new Date(now.getFullYear(), 0, 1)),
to: iso(new Date(now.getFullYear(), 11, 31)) };
} },
{ key: 'yoy',    label: '去年同期',
range: function () {
var y = now.getFullYear() - 1;
return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
} },
];
if (opt.presets) {
presets = presets.filter(function (x) { return opt.presets.indexOf(x.key) >= 0; });
}
var box = root.querySelector('[data-dr-presets]');
if (!box) return;
box.innerHTML = presets.map(function (p) {
return '<button class="drange__preset" type="button" aria-pressed="false" ' +
'data-dr-preset="'+ p.key + '">' + p.label + '</button>';
}).join('');
box.addEventListener('click', function (e) {

var b = closest(e.target, '[data-dr-preset]');
if (!b) return;
var p = presets.filter(function (x) { return x.key === b.getAttribute('data-dr-preset'); })[0];
if (!p) return;
var r = p.range();
from.value = r.from;
to.value = r.to;

box.querySelectorAll('[data-dr-preset]').forEach(function (x) {
x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
});
emit();
});
}
bindPresets();

if (clearBtn) {
clearBtn.addEventListener('click', function () {
from.value = '';
to.value = '';
var box = root.querySelector('[data-dr-presets]');
if (box) {
box.querySelectorAll('[data-dr-preset]').forEach(function (x) {
x.setAttribute('aria-pressed', 'false');
});
}
setError('');
paintSummary('');
emit();
from.focus();
});
}

[from, to].forEach(function (el) {
el.addEventListener('change', function () {
var box = root.querySelector('[data-dr-presets]');
if (box) {
box.querySelectorAll('[data-dr-preset]').forEach(function (x) {
x.setAttribute('aria-pressed', 'false');
});
}
emit();
});
el.addEventListener('input', emit);
});

function setRange(a, b2) {
from.value = iso(a);
to.value = iso(b2);
emit();
}

validate();
return {
get from() { return from.value; },
get to() { return to.value; },
get valid() { return !errBox || errBox.hidden; },
set: setRange,
setPreset: function (key) {
var b = root.querySelector('[data-dr-preset="' + key + '"]');
if (b) b.click();
},
clear: function () { if (clearBtn) clearBtn.click(); },
};
}

global.DateRange = {
create: create,

iso: iso, addDays: addDays, addMonths: addMonths,
quarterOf: quarterOf, quarterRange: quarterRange,
};
})(window);
