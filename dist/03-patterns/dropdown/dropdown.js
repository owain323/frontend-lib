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

var flRoving = function (opts) {
var opt = opts || {};
var container = opt.container;
var all = opt.items || function () { return []; };
var movable = opt.movable || all;
var nodeOf = opt.nodeOf || function (x) { return x; };
var axis = opt.axis || 'x';
var loop = opt.loop !== false;
var homeEnd = opt.homeEnd !== false;

var roveTab = opt.tabindex !== false;
var onMove = opt.onMove || function () {};

function rove(target) {
if (!roveTab) return target;
var l = all() || [];
for (var i = 0; i < l.length; i++) {
var n = nodeOf(l[i]);
if (!n || !n.setAttribute) continue;
n.setAttribute('tabindex', n === target ? '0' : '-1');
}
return target;
}

function step(i, d) {
var n = (movable() || []).length;
if (!n) return -1;
if (loop) return ((i + d) % n + n) % n;
var t = i + d;
return (t < 0 || t >= n) ? -1 : t;
}

function indexOfNode(node) {
var l = movable() || [];
for (var i = 0; i < l.length; i++) {
if (nodeOf(l[i]) === node) return i;
}
return -1;
}

function onKey(e) {
var l = movable() || [];
if (!l.length) return;
var i = indexOfNode(e.target);
if (i < 0) return;
var k = e.key;
var next = -1;
var reason = 'step';

if (axis === 'y') {
if (k === 'ArrowDown') next = step(i, 1);
else if (k === 'ArrowUp') next = step(i, -1);
} else {
if (k === 'ArrowRight') next = step(i, 1);
else if (k === 'ArrowLeft') next = step(i, -1);
}
if (homeEnd && k === 'Home') { next = 0; reason = 'home'; }
else if (homeEnd && k === 'End') { next = l.length - 1; reason = 'end'; }

if (next < 0 || next >= l.length) return;

if (e.preventDefault) e.preventDefault();
if (e.stopPropagation) e.stopPropagation();
onMove(next, l[next], reason);
}

if (container) container.addEventListener('keydown', onKey);

return {
rove: rove,
step: step,
indexOf: indexOfNode,
destroy: function () {
if (container) container.removeEventListener('keydown', onKey);
},
};
};

var flDismissable = function (opts) {
var opt = opts || {};
var escOn = opt.escOn || [];
var inside = opt.inside || [];
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
if (e.preventDefault) e.preventDefault();
if (e.stopPropagation) e.stopPropagation();
onDismiss(e, 'esc');
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
shared.stack.push(rec);
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

var FOCUSABLE = 'li[role="menuitem"]:not([aria-disabled="true"])';

function itemsOf(menu) {
return Array.prototype.slice.call(menu.querySelectorAll(FOCUSABLE));
}

function create(root, opt) {
opt = opt || {};
var btn = root.querySelector('[data-dd-btn]') || root.querySelector('button');
var menu = root.querySelector('[data-dd-menu]');
if (!btn || !menu) throw new Error('dropdown: 缺少 [data-dd-btn] 或 [data-dd-menu]');
var active = -1;

menu.setAttribute('role', 'menu');
if (!menu.getAttribute('aria-label') && !menu.getAttribute('aria-labelledby')) {
menu.setAttribute('aria-label', opt.label || '菜单');
}
Array.prototype.forEach.call(menu.querySelectorAll('li'), function (li) {

if (!li.hasAttribute('data-dd-sep') &&
String(li.className).indexOf('dd__item') < 0) {
li.className = li.className ? (li.className + ' dd__item') : 'dd__item';
}
if (li.hasAttribute('data-dd-sep')) {
li.setAttribute('role', 'separator');
li.setAttribute('aria-hidden', 'true');
} else if (!li.hasAttribute('role')) {
li.setAttribute('role', 'menuitem');

li.setAttribute('tabindex', '-1');
}
});

function open() {
menu.hidden = false;
btn.setAttribute('aria-expanded', 'true');
active = -1;
flEmit(root, 'fl-open', null);
if (opt.onOpen) opt.onOpen();
}

function close(restoreFocus) {

menu.hidden = true;
btn.setAttribute('aria-expanded', 'false');
active = -1;
if (restoreFocus !== false && document.contains(btn)) btn.focus();
flEmit(root, 'fl-close', null);
if (opt.onClose) opt.onClose();
}

function focusAt(i) {
var list = itemsOf(menu);
if (!list.length) return;
if (i < 0) i = list.length - 1;
if (i >= list.length) i = 0;
list.forEach(function (x) { x.removeAttribute('data-state'); });
list[i].setAttribute('data-state', 'active');
list[i].focus();
active = i;
}

function current() {
var list = itemsOf(menu);
return active >= 0 ? list[active] : document.activeElement;
}

var roving = flRoving({
container: root,
items: function () { return itemsOf(menu); },
axis: 'y',
tabindex: false,
onMove: function (i) { focusAt(i); },
});

if (!menu.id) menu.id = 'dd-menu-' + (new Date()).getTime();
btn.setAttribute('aria-haspopup', 'true');
btn.setAttribute('aria-expanded', 'false');
btn.setAttribute('aria-controls', menu.id);

btn.addEventListener('click', function (e) {
e.stopPropagation();
if (menu.hidden) open(); else close();
});

menu.addEventListener('click', function (e) {
var li = e.target.closest ? closest(e.target, '[role="menuitem"]') : null;
if (!li) return;
e.stopPropagation();
if (li.getAttribute('aria-disabled') === 'true') return;
close();
flEmit(root, 'fl-select',
{ value: li.getAttribute('data-value') || li.textContent.trim(), item: li });
if (opt.onSelect) opt.onSelect(li.getAttribute('data-value') || li.textContent.trim(), li);
});

root.addEventListener('keydown', function (e) {
var k = e.key;

if (e.target === btn) {
if (k === 'ArrowDown' || k === 'Enter' || k === ' ' || k === 'Spacebar') {
e.preventDefault();
open();
focusAt(0);
}
return;
}

if (closest(e.target, '[data-dd-menu]') !== menu) return;

if (k === 'Tab') { close(false); return; }

if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
e.preventDefault();
var li = current();
if (li) li.click();
}
});

var dismiss = flDismissable({
escOn: [root],
inside: [root],
when: function () { return !menu.hidden; },
onDismiss: function (e, reason) { close(reason === 'esc'); },
});

return {
open: open,
close: close,
destroy: function () { roving.destroy(); dismiss.destroy(); menu.hidden = true; },
};
}

global.Dropdown = { create: create };
})(window);
