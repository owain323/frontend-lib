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

var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]),' +
' select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isVisible(el) {
return !!(el && el.offsetParent !== null);
}

function each(nodes, fn) {
for (var i = 0; i < nodes.length; i++) fn(nodes[i], i);
}

function Nav(root, opts) {
var self = this;
this.root = root;
this.opts = opts || {};
this.labels = this.opts.labels || {};
this.labelOpen = this.labels.open || '打开菜单';
this.labelClose = this.labels.close || '关闭菜单';

this.toggle = root.querySelector('[data-nav-toggle]') || root.querySelector('.nav__toggle');
this.list = root.querySelector('[data-nav-list]') || root.querySelector('.nav__list');

if (!this.toggle || !this.list) {

if (window.console && console.warn) {
console.warn('nav.js: 缺少 .nav__toggle 或 .nav__list，已跳过', root);
}
return;
}

this.scrim = root.querySelector('.nav__scrim');
if (!this.scrim) {
this.scrim = document.createElement('div');
this.scrim.className = 'nav__scrim';
root.appendChild(this.scrim);
}

this.scrim.setAttribute('aria-hidden', 'true');

if (this.list.id && !this.toggle.getAttribute('aria-controls')) {
this.toggle.setAttribute('aria-controls', this.list.id);
}

this.fr = flFocusReturn({ fallback: this.toggle });
this.savedOverflow = null;
this.inerted = [];

this.onToggleClick = function () { self.isOpen() ? self.close() : self.open(); };
this.onListClick = function (e) {
var t = e.target;

if (t && (t.tagName === 'A' || (t.parentNode && t.parentNode.tagName === 'A'))) {
setTimeout(function () { self.close(); }, 0);
}
};
this.onKeydown = function (e) { self._trap(e); };
this.onResize = function () {

if (self.isOpen() && !isVisible(self.toggle)) self.close();
};

this.toggle.addEventListener('click', this.onToggleClick);
this.list.addEventListener('click', this.onListClick);
window.addEventListener('resize', this.onResize);

this.dismiss = flDismissable({
escOn: [document],
inside: [this.list, this.toggle],
when: function () { return self.isOpen(); },
onDismiss: function () { self.close(); },
});

if (this.toggle.getAttribute('aria-expanded') === 'true') this.close();
else this.toggle.setAttribute('aria-expanded', 'false');
}

Nav.prototype.isOpen = function () {
return this.toggle.getAttribute('aria-expanded') === 'true';
};

Nav.prototype._inertBackground = function (on) {
var self = this;
if (on) {
if (this.inerted.length) return;
each(document.body.children, function (n) {
if (n === self.root || (n.contains && n.contains(self.root))) return;
if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.tagName === 'LINK') return;
if (!n.setAttribute) return;
var had = n.getAttribute('aria-hidden');
n.setAttribute('data-nav-had-hidden', had === null ? '' : had);
n.setAttribute('aria-hidden', 'true');
n.inert = true;
self.inerted.push(n);
});
} else {
each(this.inerted, function (n) {
var had = n.getAttribute('data-nav-had-hidden');
if (had) n.setAttribute('aria-hidden', had);
else n.removeAttribute('aria-hidden');
n.removeAttribute('data-nav-had-hidden');
n.inert = false;
});
this.inerted = [];
}
};

Nav.prototype.open = function () {
if (this.isOpen()) return;
this.fr.save();
this.scrim.setAttribute('data-state', 'open');
this.list.setAttribute('data-state', 'open');
this.toggle.setAttribute('aria-expanded', 'true');
this.toggle.setAttribute('aria-label', this.labelClose);

if (this.savedOverflow === null) {
this.savedOverflow = document.body.style.overflow || '';
}
document.body.style.overflow = 'hidden';

this._inertBackground(true);
document.addEventListener('keydown', this.onKeydown, true);

var f = this._focusables();
(f[0] || this.list).focus();

flEmit(this.root, 'fl-nav-open', { root: this.root });
if (this.opts.onOpen) this.opts.onOpen();
};

Nav.prototype.close = function () {
if (!this.isOpen()) return;
this.list.removeAttribute('data-state');
this.scrim.removeAttribute('data-state');
this.toggle.setAttribute('aria-expanded', 'false');
this.toggle.setAttribute('aria-label', this.labelOpen);

if (this.savedOverflow !== null) {
document.body.style.overflow = this.savedOverflow;
this.savedOverflow = null;
}
this._inertBackground(false);
document.removeEventListener('keydown', this.onKeydown, true);

this.fr.restore();

flEmit(this.root, 'fl-nav-close', { root: this.root });
if (this.opts.onClose) this.opts.onClose();
};

Nav.prototype._focusables = function () {
var out = [];
each(this.list.querySelectorAll(FOCUSABLE), function (el) {

if (isVisible(el)) out.push(el);
});
return out;
};

Nav.prototype._trap = function (e) {
if (!this.isOpen()) return;
var k = e.key;
if (k !== 'Tab' && e.keyCode !== 9) return;
var list = this._focusables();
if (!list.length) { e.preventDefault(); this.list.focus(); return; }
var first = list[0];
var last = list[list.length - 1];
var active = document.activeElement;
if (e.shiftKey && (active === first || active === this.list)) {
e.preventDefault();
last.focus();
} else if (!e.shiftKey && active === last) {
e.preventDefault();
first.focus();
}
};

Nav.prototype.destroy = function () {
if (!this.toggle || !this.list) return;
this.close();
this.toggle.removeEventListener('click', this.onToggleClick);
this.list.removeEventListener('click', this.onListClick);
window.removeEventListener('resize', this.onResize);
if (this.dismiss) this.dismiss.destroy();
};

Nav.attach = function (root, opts) {
root.navInstance = new Nav(root, opts);
return root.navInstance;
};

global.Nav = Nav;

function init() {
each(document.querySelectorAll('[data-nav]'), function (el) {
if (!el.navInstance) Nav.attach(el, {});
});
}

if (typeof document === 'undefined') return;
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', init);
} else {
init();
}
})(typeof window !== 'undefined' ? window : globalThis);
