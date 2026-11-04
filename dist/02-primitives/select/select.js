(function (global) {
'use strict';

var flDismissable = function (opts) {
var opt = opts || {};
var escOn = opt.escOn || [];
var inside = opt.inside || [];
var outside = opt.outside !== false;
var when = opt.when || function () { return true; };
var onDismiss = opt.onDismiss || function () {};

var shared = window.__flDismiss || (window.__flDismiss = { stack: [], bound: false });

function isInside(node) {
if (!node) return false;
for (var i = 0; i < inside.length; i++) {
var el = inside[i];
if (!el || !el.contains) continue;
if (el === node || el.contains(node)) return true;
}
return false;
}

function onKey(e) {
if (!when()) return;
var k = e.key;
if (k !== 'Escape' && k !== 'Esc' && e.keyCode !== 27) return;

var closed = onDismiss(e, 'esc');
if (closed === false) return;
if (e.preventDefault) e.preventDefault();
if (e.stopPropagation) e.stopPropagation();
}

function onDocClick(e) {
var top = null;
for (var i = shared.stack.length - 1; i >= 0; i--) {
if (shared.stack[i].when()) { top = shared.stack[i]; break; }
}
if (!top || top.isInside(e.target)) return;
top.onDismiss(e, 'outside');
}

var rec = { when: when, isInside: isInside, onDismiss: onDismiss };

for (var j = 0; j < escOn.length; j++) {
if (escOn[j]) escOn[j].addEventListener('keydown', onKey);
}

if (outside) shared.stack.push(rec);
if (!shared.bound) {
shared.bound = true;
document.addEventListener('click', onDocClick, true);
}

return {
destroy: function () {
for (var j = 0; j < escOn.length; j++) {
if (escOn[j]) escOn[j].removeEventListener('keydown', onKey);
}
var k = shared.stack.indexOf(rec);
if (k >= 0) shared.stack.splice(k, 1);
},
};
};

var flFocusReturn = function (opts) {
var opt = opts || {};
var saved = null;

return {
save: function () {
var a = document.activeElement;
saved = (a && a !== document.body && a.focus) ? a : null;
return saved;
},

restore: function () {
var target = saved;

if (!target || !document.contains(target)) target = opt.fallback || null;
if (!target) { saved = null; return false; }
try {
target.focus();
} catch (e) {
saved = null;
return false;
}
var ok = document.activeElement === target;
saved = null;
return ok;
},

target: function () { return saved; },
clear: function () { saved = null; },
};
};

var flTypeahead = function (opts) {
var opt = opts || {};
var items = opt.items || function () { return []; };
var textOf = opt.textOf || function (x) { return String((x && x.textContent) || ''); };
var usable = opt.usable || function () { return true; };
var timeout = opt.timeout || 500;
var onHit = opt.onHit || function () {};
var buf = '';
var timer = null;
var last = -1;

function stop() {
if (timer) { clearTimeout(timer); timer = null; }
}

function repeated(s) {
if (s.length < 2) return false;
for (var i = 1; i < s.length; i++) {
if (s.charAt(i) !== s.charAt(0)) return false;
}
return true;
}

function find(needle) {
var l = items() || [];
var n = l.length;
if (!n) return -1;
for (var k = 0; k < n; k++) {
var i = (last + 1 + k) % n;
if (!usable(l[i])) continue;
if (textOf(l[i]).toLowerCase().indexOf(needle) === 0) return i;
}
return -1;
}

function type(ch) {
if (!ch) return -1;
buf += String(ch).toLowerCase();
stop();
timer = setTimeout(clear, timeout);
var needle = repeated(buf) ? buf.charAt(0) : buf;
var i = find(needle);
if (i >= 0) {
last = i;
onHit(i, (items() || [])[i], buf);
}
return i;
}

function clear() {
buf = '';
stop();
}

return {
type: type,
clear: clear,
buffer: function () { return buf; },
destroy: function () { stop(); },
};
};

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

function create(root, opt) {

var DEFAULT_LABELS = {
option: '选项',
placeholder: '请选择'
};

var flLabels = function (defaults, src) {
src = src || {};
var out = {};
var k;
for (k in defaults) {
if (Object.prototype.hasOwnProperty.call(defaults, k)) {
out[k] = (src[k] === undefined || src[k] === null) ? defaults[k] : src[k];
}
}
return out;
};

var L = flLabels(DEFAULT_LABELS, opt && opt.labels);

opt = opt || {};
var btn = root.querySelector('[data-select-btn]');
var list = root.querySelector('[data-select-list]');
if (!btn || !list) throw new Error('Select: 缺少 [data-select-btn] 或 [data-select-list]');

var fr = flFocusReturn({ fallback: btn });

var dismiss = flDismissable({
escOn: [btn],
inside: [root],
when: function () { return !list.hidden; },
onDismiss: function (ev, reason) {
close(reason === 'esc');
}
});
if (!list.id) list.id = 'select-list-' + (++uid);

var options = [].slice.call(list.querySelectorAll('[role="option"]'));
var isMulti = !!opt.multiple;

var values = [];
var activeIdx = -1;
var destroyed = false;

function valueOfOpt(o) { return o ? o.getAttribute('data-value') : null; }
function hasValue(v) { return v != null && values.indexOf(String(v)) >= 0; }
function seed(v) {
if (v == null) return;
var arr = Object.prototype.toString.call(v) === '[object Array]' ? v : [v];
var next = [];
for (var i = 0; i < arr.length; i++) {
var s = arr[i] == null ? '' : String(arr[i]);
if (s && next.indexOf(s) < 0) next.push(s);
}
values = isMulti ? next : next.slice(0, 1);
}
seed(opt.value);

list.setAttribute('role', 'listbox');
if (isMulti) list.setAttribute('aria-multiselectable', 'true');
list.setAttribute('aria-label', opt.label || L.option);
btn.setAttribute('aria-haspopup', 'listbox');
btn.setAttribute('aria-expanded', 'false');
btn.setAttribute('aria-controls', list.id);

options.forEach(function (o, i) {
o.setAttribute('role', 'option');
if (!o.id) o.id = list.id + '-o' + i;
o.setAttribute('aria-selected', 'false');
if (o.hasAttribute('disabled') || o.getAttribute('aria-disabled') === 'true') {
o.setAttribute('aria-disabled', 'true');
}
o.setAttribute('tabindex', '-1');
if (o.className.indexOf('select__opt') < 0) {
o.className = (o.className ? o.className + ' ' : '') + 'select__opt';
}
});

function enabled() {
return options.filter(function (o) { return o.getAttribute('aria-disabled') !== 'true'; });
}

var typeahead = flTypeahead({
items: function () { return options; },
textOf: optText,
usable: function (o) { return o.getAttribute('aria-disabled') !== 'true'; },
onHit: function (i) { setActive(i, 1); },
});

function selectedIdx() {
for (var i = 0; i < options.length; i++) {
if (hasValue(valueOfOpt(options[i]))) return i;
}
return -1;
}
function valueText() {
var texts = [];
for (var i = 0; i < options.length; i++) {
if (hasValue(valueOfOpt(options[i]))) texts.push(optText(options[i]));
}
return texts.length ? texts.join('、') : (opt.placeholder || L.placeholder);
}

function optText(o) {
if (!o) return '';
var t = o.querySelector('.select__opt-text');
return ((t || o).textContent || '').replace(/[✓\s]/g, '').trim();
}

function value() {
return isMulti ? values.slice() : (values.length ? values[0] : null);
}

function syncHidden() {
var all = [].slice.call(root.querySelectorAll('input[type="hidden"]'));
var mine = [];
var author = [];
all.forEach(function (i) {
if (i.getAttribute('data-select-value') === '1') mine.push(i);
else author.push(i);
});
var name = opt.name || root.getAttribute('data-name') ||
(author[0] && author[0].name) || (mine[0] && mine[0].name) ||
root.id || '';
var slots = author.concat(mine);
var want = values.slice();
for (var i = 0; i < want.length; i++) {
var inp = slots[i];
if (!inp) {
inp = document.createElement('input');
inp.type = 'hidden';
inp.setAttribute('data-select-value', '1');
root.appendChild(inp);
slots.push(inp);
}
if (name) inp.name = name;
else inp.removeAttribute('name');
inp.value = want[i];
}
for (var j = want.length; j < slots.length; j++) {
var extra = slots[j];
if (extra.getAttribute('data-select-value') === '1') {
if (extra.parentNode) extra.parentNode.removeChild(extra);
} else {
extra.value = '';
}
}
}

function paint(silent) {
var label = valueText();
var empty = selectedIdx() < 0;
var vEl = btn.querySelector('.select__value');
if (vEl) {
vEl.textContent = label;
vEl.classList.toggle('select__value--placeholder', empty);
}

if (empty) btn.removeAttribute('title');
else btn.setAttribute('title', label);
options.forEach(function (o) {
var on = hasValue(valueOfOpt(o));
o.setAttribute('aria-selected', on ? 'true' : 'false');
var ck = o.querySelector('.select__check');
if (ck) ck.textContent = on ? '✓' : '';
});
syncHidden();
if (silent) return;
flEmit(root, 'fl-change', { value: value(), values: values.slice(), text: label });
if (opt.onChange) opt.onChange(value(), label);

var ev = null;
if (typeof window.Event === 'function') {
try { ev = new window.Event('change', { bubbles: true }); } catch (e) { ev = null; }
}
if (!ev) {
try {
ev = document.createEvent('Event');
ev.initEvent('change', true, false);
} catch (e2) { ev = null; }
}
if (ev) root.dispatchEvent(ev);
}

function setActive(i, dir) {
if (!options.length) return;
dir = dir || 1;

var n = options.length;
var idx = ((i % n) + n) % n;
for (var k = 0; k < n; k++) {
if (options[idx].getAttribute('aria-disabled') !== 'true') break;
idx = ((idx + dir) % n + n) % n;
}
activeIdx = idx;
options.forEach(function (o) { o.removeAttribute('data-state'); });
options[idx].setAttribute('data-state', 'active');

btn.setAttribute('aria-activedescendant', options[idx].id);
if (options[idx].scrollIntoView) {
options[idx].scrollIntoView({ block: 'nearest' });
}
}

function activeIndex() {
if (activeIdx >= 0) return activeIdx;
var i = selectedIdx();
if (i >= 0) return i;
var e2 = enabled();
return e2.length ? options.indexOf(e2[0]) : 0;
}

function open() {

fr.save();
list.hidden = false;
btn.setAttribute('aria-expanded', 'true');

btn.focus();

setActive(activeIndex());
flEmit(root, 'fl-open', null);
if (opt.onOpen) opt.onOpen();
}
function close(restoreFocus) {
list.hidden = true;
btn.setAttribute('aria-expanded', 'false');
btn.removeAttribute('aria-activedescendant');
options.forEach(function (o) { o.removeAttribute('data-state'); });
activeIdx = -1;
typeahead.clear();

if (restoreFocus !== false) fr.restore();
flEmit(root, 'fl-close', null);
if (opt.onClose) opt.onClose();
}
function commit(i) {
var o = options[i];
if (!o || o.getAttribute('aria-disabled') === 'true') return;
var v = valueOfOpt(o);
if (isMulti) {

var k = values.indexOf(v);
if (k >= 0) values.splice(k, 1);
else values.push(v);
paint();
return;
}
values = [v];
paint();
close(true);
}

function onBtnKey(e) {
if (destroyed) return;
var k = e.key;
var opened = !list.hidden;

if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ' || k === 'Spacebar') {
e.preventDefault();
if (!opened) {
open();

if (k === 'ArrowUp' && options.length) setActive(options.length - 1, -1);
return;
}
if (k === 'ArrowDown') { setActive(activeIndex() + 1, 1); return; }
if (k === 'ArrowUp') { setActive(activeIndex() - 1, -1); return; }
if (activeIdx >= 0) commit(activeIdx);
return;
}
if (k === 'Home' || k === 'End') {
e.preventDefault();
if (!opened) open();
if (options.length) setActive(k === 'Home' ? 0 : options.length - 1, k === 'Home' ? 1 : -1);
return;
}
if (k === 'Tab') { if (opened) close(false); return; }

if (k && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
if (!opened) open();
e.preventDefault();
typeahead.type(k);
}

}
btn.addEventListener('keydown', onBtnKey);

function onBtnClick() {
if (destroyed) return;
if (list.hidden) open(); else close();
}
function onListClick(e) {
if (destroyed) return;
var o = e.target.closest ? closest(e.target, '[role="option"]') : null;
if (!o) return;
commit(options.indexOf(o));
}
btn.addEventListener('click', onBtnClick);
list.addEventListener('click', onListClick);

var initialValues = values.slice();
var form = closest(root, 'form');
function onFormReset() {
setTimeout(function () {
if (destroyed) return;
values = initialValues.slice();
paint();
}, 0);
}
if (form) form.addEventListener('reset', onFormReset);

paint(true);

return {
open: open, close: close,
get value() { return value(); },
set value(v) { seed(v); paint(); },
get values() { return values.slice(); },
set values(v) { seed(v); paint(); },

destroy: function () {
if (destroyed) return;
destroyed = true;
btn.removeEventListener('keydown', onBtnKey);
btn.removeEventListener('click', onBtnClick);
list.removeEventListener('click', onListClick);
if (form) form.removeEventListener('reset', onFormReset);
dismiss.destroy();
typeahead.destroy();
fr.clear();
list.hidden = true;
btn.setAttribute('aria-expanded', 'false');
btn.removeAttribute('aria-activedescendant');

[].slice.call(root.querySelectorAll('input[type="hidden"][data-select-value="1"]'))
.forEach(function (i) { if (i.parentNode) i.parentNode.removeChild(i); });
},
};
}

global.Select = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
