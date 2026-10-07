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
if (opt.onOpen) opt.onOpen();
}

function close(restoreFocus) {

menu.hidden = true;
btn.setAttribute('aria-expanded', 'false');
active = -1;
if (restoreFocus !== false && document.contains(btn)) btn.focus();
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

if (k === 'ArrowDown') { e.preventDefault(); focusAt(active + 1); return; }
if (k === 'ArrowUp')   { e.preventDefault(); focusAt(active - 1); return; }

if (k === 'Home')      { e.preventDefault(); focusAt(0); return; }
if (k === 'End')       { e.preventDefault(); focusAt(itemsOf(menu).length - 1); return; }

if (k === 'Escape' || k === 'Esc') { e.preventDefault(); e.stopPropagation(); close(true); return; }

if (k === 'Tab') { close(false); return; }

if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
e.preventDefault();
var li = current();
if (li) li.click();
}
});

document.addEventListener('click', function (e) {
if (!root.contains(e.target) && !menu.hidden) close(false);
});

return { open: open, close: close, destroy: function () { menu.hidden = true; } };
}

global.Dropdown = { create: create };
})(window);
