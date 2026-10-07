(function (global) {
'use strict';

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
opt = opt || {};
var btn = root.querySelector('[data-select-btn]');
var list = root.querySelector('[data-select-list]');
if (!btn || !list) throw new Error('Select: 缺少 [data-select-btn] 或 [data-select-list]');
if (!list.id) list.id = 'select-list-' + (++uid);

var options = [].slice.call(list.querySelectorAll('[role="option"]'));
var isMulti = !!opt.multiple;
var selected = opt.value != null ? String(opt.value) : null;
var activeIdx = -1;
var typeBuf = '';
var typeTimer = null;

list.setAttribute('role', 'listbox');
if (isMulti) list.setAttribute('aria-multiselectable', 'true');
list.setAttribute('aria-label', opt.label || '选项');
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
function selectedIdx() {
for (var i = 0; i < options.length; i++) {
if (options[i].getAttribute('data-value') === selected) return i;
}
return -1;
}
function valueText() {
var i = selectedIdx();
return i < 0 ? (opt.placeholder || '请选择') : optText(options[i]);
}
function optText(o) {
var t = o.querySelector('.select__opt-text');
return ((t || o).textContent || '').replace(/[✓\s]/g, '').trim();
}

function paint() {
var v = valueText();
var vEl = btn.querySelector('.select__value');
if (vEl) {
vEl.textContent = v;
vEl.classList.toggle('select__value--placeholder', selectedIdx() < 0);
}
options.forEach(function (o) {
var on = o.getAttribute('data-value') === selected;
o.setAttribute('aria-selected', on ? 'true' : 'false');
var ck = o.querySelector('.select__check');
if (ck) ck.textContent = on ? '✓' : '';
});

var hidden = root.querySelector('input[type="hidden"]');
if (hidden) hidden.value = selected == null ? '' : selected;
if (opt.onChange) opt.onChange(selected, optText(options[selectedIdx()] || options[0]));
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
list.hidden = false;
btn.setAttribute('aria-expanded', 'true');

btn.focus();

setActive(activeIndex());
if (opt.onOpen) opt.onOpen();
}
function close(restoreFocus) {
list.hidden = true;
btn.setAttribute('aria-expanded', 'false');
btn.removeAttribute('aria-activedescendant');
options.forEach(function (o) { o.removeAttribute('data-state'); });
activeIdx = -1;

if (restoreFocus !== false) btn.focus();
if (opt.onClose) opt.onClose();
}
function commit(i) {
var o = options[i];
if (!o || o.getAttribute('aria-disabled') === 'true') return;
if (isMulti) {

selected = o.getAttribute('data-value') === selected ? null : o.getAttribute('data-value');
} else {
selected = o.getAttribute('data-value');
close(true);
}
paint();
}

btn.addEventListener('keydown', function (e) {
var k = e.key;
if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ' ||
k === 'Spacebar' || (k === 'Alt' && false)) {
if (k === 'ArrowDown' || k === 'ArrowUp') {
e.preventDefault();
if (list.hidden) { open(); return; }
var dir = k === 'ArrowDown' ? 1 : -1;
setActive(activeIndex() + dir, dir);
return;
}
e.preventDefault();
if (list.hidden) open();
else if (activeIdx >= 0) commit(activeIdx);
return;
}

if (k === 'ArrowDown' && e.altKey) { e.preventDefault(); open(); return; }

if (list.hidden && (k === 'Home' || k === 'End')) {
e.preventDefault(); open();
if (k === 'Home') setActive(0);
else setActive(options.length - 1);
return;
}
});

function onListKey(e) {
var k = e.key;
if (k === 'ArrowDown') { e.preventDefault(); setActive(activeIndex() + 1, 1); return; }
if (k === 'ArrowUp')   { e.preventDefault(); setActive(activeIndex() - 1, -1); return; }
if (k === 'Home')      { e.preventDefault(); setActive(0, 1); return; }
if (k === 'End')       { e.preventDefault(); setActive(options.length - 1, -1); return; }

if (k === 'Escape' || k === 'Esc') {
e.preventDefault();
e.stopPropagation();
close(true);
return;
}
if (k === 'Tab') { close(false); return; }
if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
e.preventDefault();
if (activeIdx >= 0) commit(activeIdx);
return;
}

if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
e.preventDefault();
typeBuf += k.toLowerCase();
clearTimeout(typeTimer);
typeTimer = setTimeout(function () { typeBuf = ''; }, 500);
for (var i = 0; i < options.length; i++) {
if (optText(options[i]).toLowerCase().indexOf(typeBuf) === 0) {
if (options[i].getAttribute('aria-disabled') !== 'true') setActive(i, 1);
break;
}
}
}
}

btn.addEventListener('keydown', function (e) {

if (list.hidden) return;
var k = e.key;

if (k === 'Escape' || k === 'Esc' || k === 'ArrowDown' || k === 'ArrowUp' ||
k === 'Home' || k === 'End' || k === 'Enter' || k === ' ' ||
k === 'Spacebar' || k === 'Tab') {

if (list.hidden) return;
onListKey(e);
return;
}
if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) onListKey(e);
});

btn.addEventListener('click', function () {
if (list.hidden) open(); else close();
});
list.addEventListener('click', function (e) {
var o = e.target.closest ? closest(e.target, '[role="option"]') : null;
if (!o) return;
commit(options.indexOf(o));
});
document.addEventListener('click', function (e) {
if (!root.contains(e.target) && !list.hidden) close(false);
});

paint();
return {
open: open, close: close,
get value() { return selected; },
set value(v) { selected = v == null ? null : String(v); paint(); },
};
}

global.Select = { create: create };
})(window);
