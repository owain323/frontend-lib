(function () {
'use strict';

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
this.bind();
}

Tabs.prototype.enabled = function (tab) {
return tab.getAttribute('aria-disabled') !== 'true';
};

Tabs.prototype.focusables = function () {
return filter(this.tabs, this.enabled, this);
};

Tabs.prototype.rove = function (target) {
for (var i = 0; i < this.tabs.length; i++) {
this.tabs[i].setAttribute('tabindex', this.tabs[i] === target ? '0' : '-1');
}
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
if (typeof this.opts.onChange === 'function') {
this.opts.onChange(tab.getAttribute('data-value') || tab.id, tab);
}
};

Tabs.prototype.step = function (from, delta) {
var list = this.focusables();
if (!list.length) return;
var i = list.indexOf(from);
if (i < 0) i = 0;

var n = (i + delta + list.length) % list.length;
var next = list[n];
if (this.manual) {

this.rove(next);
next.focus();
} else {
this.select(next, true);
}
};

Tabs.prototype.edge = function (which) {
var list = this.focusables();
if (!list.length) return;
var target = which === 'home' ? list[0] : list[list.length - 1];
if (this.manual) { this.rove(target); target.focus(); }
else this.select(target, true);
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
var handled = true;

if (k === 'ArrowRight' || (self.vertical && k === 'ArrowDown')) {
self.step(tab, 1);
} else if (k === 'ArrowLeft' || (self.vertical && k === 'ArrowUp')) {
self.step(tab, -1);
} else if (k === 'Home') {
self.edge('home');
} else if (k === 'End') {
self.edge('end');
} else if (k === 'Enter' || k === ' ') {

if (self.manual) self.select(tab, false);
else handled = false;
} else {
handled = false;
}

if (handled) {
e.preventDefault();
e.stopPropagation();
}
});
};

window.Tabs = Tabs;

function init() {
var nodes = document.querySelectorAll('[data-tabs]');
for (var i = 0; i < nodes.length; i++) {
nodes[i].tabsInstance = new Tabs(nodes[i], {
onChange: nodes[i].getAttribute('data-on-change') || null
});
}
}

if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', init);
} else {
init();
}
})();
