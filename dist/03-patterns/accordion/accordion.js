(function () {
'use strict';

var uid = 0;
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

function toArray(x) { return Array.prototype.slice.call(x); }

var raf = (typeof window.requestAnimationFrame === 'function')
? window.requestAnimationFrame.bind(window)
: function (fn) { return setTimeout(fn, 16); };

function once(el, ev, fn) {
function handler(e) {
if (e && e.target !== el) return;
el.removeEventListener(ev, handler, true);
fn(e);
}
el.addEventListener(ev, handler, true);
}

function closest(el, sel) {
while (el && el.nodeType === 1) {
var fn = el.matches || el.msMatchesSelector || el.webkitMatchesSelector;
if (fn && fn.call(el, sel)) return el;
el = el.parentNode;
}
return null;
}

function Accordion(root, opts) {
this.root = root;
this.opts = opts || {};
this.items = toArray(root.querySelectorAll('.accordion__item'));
if (!this.items.length) return;

this.single = !root.hasAttribute('data-accordion-multi')
&& !root.classList.contains('accordion--multi');

this.useRegion = !root.classList.contains('accordion--many') &&
this.items.length <= 6;

this.dur = this.reduced() ? 0 : 90;

this.init();
this.bind();
}

Accordion.prototype.triggers = function () {
return this.items.map(function (it) {
return it.querySelector('.accordion__trigger');
});
};

Accordion.prototype.panels = function () {
return this.items.map(function (it) {
return it.querySelector('.accordion__panel');
});
};

Accordion.prototype.init = function () {

var seq = ++uid;
for (var i = 0; i < this.items.length; i++) {
var it = this.items[i];
var btn = it.querySelector('.accordion__trigger');
var panel = it.querySelector('.accordion__panel');
if (!btn || !panel) continue;

if (!panel.id) panel.id = 'acc-panel-' + seq + '-' + (i + 1);
if (!btn.id) btn.id = 'acc-btn-' + seq + '-' + (i + 1);

btn.setAttribute('aria-controls', panel.id);

panel.setAttribute('aria-labelledby', btn.id);

if (this.useRegion) panel.setAttribute('role', 'region');

var isOpen = btn.getAttribute('aria-expanded') === 'true';
panel.setAttribute('data-state', isOpen ? 'open' : 'closed');
if (!isOpen) panel.setAttribute('hidden', '');
else panel.removeAttribute('hidden');
}
};

Accordion.prototype.reduced = function () {
return typeof window.matchMedia === 'function' &&
window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

Accordion.prototype.lock = function () {};

Accordion.prototype.unlock = function () {};

Accordion.prototype.set = function (item, open) {
var btn = item.querySelector('.accordion__trigger');
var panel = item.querySelector('.accordion__panel');
if (!btn || !panel) return;
if (btn.getAttribute('aria-disabled') === 'true') return;

var self = this;
btn.setAttribute('aria-expanded', open ? 'true' : 'false');

if (open) {

panel.removeAttribute('hidden');
panel.style.visibility = '';
panel.setAttribute('data-state', 'open');
} else {

if (self.reduced()) {
panel.setAttribute('data-state', 'closed');
panel.setAttribute('hidden', '');
panel.style.visibility = '';
} else {
var inner = panel.querySelector('.accordion__panel-inner');

var h = inner ? inner.getBoundingClientRect().height : 0;
panel.style.setProperty('--acc-h', h + 'px');

raf(function () {
panel.setAttribute('data-state', 'closed');

var settle = function () {
if (panel.getAttribute('data-state') === 'closed') {
panel.setAttribute('hidden', '');
panel.style.removeProperty('--acc-h');
}
};
once(panel, 'transitionend', settle);

setTimeout(settle, 400);
});
}
}

flEmit(this.root, 'fl-change', { value: btn.id, open: open, item: btn });
if (typeof this.opts.onChange === 'function') {
this.opts.onChange(btn, open);
}
};

Accordion.prototype.toggle = function (item) {
var opening = item.querySelector('.accordion__trigger')
.getAttribute('aria-expanded') !== 'true';
if (this.single && opening) {

var self = this;
toArray(this.items).forEach(function (it) {
if (it !== item) self.set(it, false);
});
}
this.set(item, opening);
};

Accordion.prototype.itemOf = function (btn) {
var el = btn;
while (el && el !== this.root) {
if (el.className &&
(' ' + el.className + ' ').indexOf(' accordion__item ') > -1) {
return el;
}
el = el.parentNode;
}
return null;
};

Accordion.prototype.bind = function () {
var self = this;

this.root.style.setProperty('--acc-dur', this.dur + 'ms');

this.root.addEventListener('click', function (e) {
var btn = closest(e.target, '.accordion__trigger');
if (!btn || !self.root.contains(btn)) return;
if (btn.getAttribute('aria-disabled') === 'true') return;
var item = self.itemOf(btn);
if (item) self.toggle(item);
});

};

window.Accordion = Accordion;

function init() {
var nodes = document.querySelectorAll('[data-accordion]');
for (var i = 0; i < nodes.length; i++) {
nodes[i].accordionInstance = new Accordion(nodes[i]);
}
}

if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', init);
} else {
init();
}
})();
