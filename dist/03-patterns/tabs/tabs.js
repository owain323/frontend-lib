(function () {
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

function toArray(x) { return Array.prototype.slice.call(x); }

function closest(el, sel) {
while (el && el.nodeType === 1) {
if (matches(el, sel)) return el;
el = el.parentNode;
}
return null;
}

function matches(el, sel) {
var fn = el.matches || el.msMatchesSelector || el.webkitMatchesSelector;
return fn ? fn.call(el, sel) : false;
}

function filter(list, fn, self) {
var out = [];
for (var i = 0; i < list.length; i++) {
if (fn.call(self, list[i], i, list)) out.push(list[i]);
}
return out;
}

function Tabs(root, opts) {
this.root = root;
this.opts = opts || {};
this.list = root.querySelector('[role="tablist"]');
if (!this.list) return;
this.tabs = toArray(this.list.querySelectorAll('[role="tab"]'));
this.panels = toArray(root.querySelectorAll('[role="tabpanel"]'));
this.vertical = this.list.getAttribute('aria-orientation') === 'vertical';

this.manual = root.classList.contains('tabs--manual');

var self = this;
this.roving = flRoving({
container: this.list,
items: function () { return self.tabs; },
movable: function () { return self.focusables(); },
axis: this.vertical ? 'y' : 'x',
onMove: function (i, tab) {
if (self.manual) { self.rove(tab); tab.focus(); }
else self.select(tab, true);
},
});
this.bind();
}

Tabs.prototype.enabled = function (tab) {
return tab.getAttribute('aria-disabled') !== 'true';
};

Tabs.prototype.focusables = function () {
return filter(this.tabs, this.enabled, this);
};

Tabs.prototype.rove = function (target) {
if (!this.roving) return;
this.roving.rove(target);
};
Tabs.prototype.select = function (tab, focusIt) {
if (!this.enabled(tab)) return;
for (var i = 0; i < this.tabs.length; i++) {
var on = this.tabs[i] === tab;
this.tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');

var pid = this.tabs[i].getAttribute('aria-controls');
var panel = pid ? document.getElementById(pid) : null;
if (!panel) {

panel = this.panels[i] || null;
}
if (panel) {
if (on) {
panel.removeAttribute('hidden');
panel.classList.add('tabs__panel--enter');
} else {
panel.setAttribute('hidden', '');
panel.classList.remove('tabs__panel--enter');
}
}
}
this.active = tab;
this.rove(tab);
if (focusIt) tab.focus();
flEmit(this.root, 'fl-change',
{ value: tab.getAttribute('data-value') || tab.id, tab: tab });
if (typeof this.opts.onChange === 'function') {
this.opts.onChange(tab.getAttribute('data-value') || tab.id, tab);
}
};

Tabs.prototype.bind = function () {
var self = this;

var initial = null;
for (var i = 0; i < this.tabs.length; i++) {
if (this.tabs[i].getAttribute('aria-selected') === 'true') {
initial = this.tabs[i];
break;
}
}
this.select(initial || this.tabs[0], false);

this.list.addEventListener('click', function (e) {
var tab = closest(e.target, '[role="tab"]');
if (!tab || !self.list.contains(tab)) return;
if (!self.enabled(tab)) return;
self.select(tab, false);
});

this.list.addEventListener('keydown', function (e) {
var tab = closest(e.target, '[role="tab"]');
if (!tab) return;
var k = e.key;

if (k !== 'Enter' && k !== ' ' && k !== 'Spacebar') return;
if (self.manual) {
e.preventDefault();
self.select(tab, false);
}
});
};

window.Tabs = Tabs;

function init() {
var nodes = document.querySelectorAll('[data-tabs]');
for (var i = 0; i < nodes.length; i++) {
nodes[i].tabsInstance = new Tabs(nodes[i], {});
}
}

if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', init);
} else {
init();
}
})();
