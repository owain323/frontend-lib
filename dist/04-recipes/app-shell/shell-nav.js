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

var ICON =
'<svg viewBox="0 0 16 16" width="18" height="18" fill="none" '+
'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" '+
'aria-hidden="true" focusable="false"><path d="M2.5 4h11M2.5 8h11M2.5 12h11"/></svg>';

function warn(msg) {
if (global.console && global.console.warn) global.console.warn(msg);
}

function stripIds(node) {
if (node.removeAttribute) node.removeAttribute('id');
var all = node.querySelectorAll ? node.querySelectorAll('[id]') : [];
for (var i = 0; i < all.length; i++) all[i].removeAttribute('id');
}

function ShellNav(root, opts) {
if (!root) throw new Error('ShellNav: 缺少根元素');
var o = this.opts = opts || {};
var self = this;

this.root = root;
this.btn = null;
this.handle = null;
this.disabled = false;

var side = root.querySelector('.shell__side');
var topbar = root.querySelector('.shell__topbar');

if (!side || !topbar) {
this.disabled = true;
warn('shell-nav: 缺少 ' + (!side ? '.shell__side' : '.shell__topbar') +
'，已跳过该元素（不改别人的布局）。');
return;
}

if (!global.Drawer || typeof global.Drawer.open !== 'function') {
this.disabled = true;
warn('shell-nav: 需要先加载 03-patterns/drawer/drawer.js。' +
'本层只做接线，抽屉的 Esc / 焦点陷阱 / 焦点归位 / 锁滚动都由它提供。'+
'已跳过，不注入菜单按钮。');
return;
}

this.side = side;
this.topbar = topbar;

var title = root.getAttribute('data-shell-nav') || '导航';
var btn = document.createElement('button');
btn.type = 'button';
btn.className = 'shell__menu';
btn.setAttribute('aria-label', o.label || ('打开' + title));
btn.setAttribute('aria-haspopup', 'dialog');
btn.innerHTML = ICON;
btn.addEventListener('click', function () { self.open(); });
topbar.insertBefore(btn, topbar.firstChild);
this.btn = btn;

this.onResize = function () {
if (!self.handle) return;

if (self.btn && self.btn.offsetParent === null) self.close();
};
global.addEventListener('resize', this.onResize);
}

ShellNav.prototype = {
constructor: ShellNav,

open: function () {
if (this.disabled || this.handle) return this.handle;
var self = this;
var title = this.root.getAttribute('data-shell-nav') || '导航';

var content = this.side.cloneNode(true);
stripIds(content);

content.className += ' shell__side--drawer';

var handle = this.handle = global.Drawer.open({
place: this.opts.place || 'left',
title: title,
content: content,

initialFocus: '[aria-current="page"]',
onClose: function () {
self.handle = null;
flEmit(self.root, 'fl-shell-nav', { open: false });
}
});

var el = handle.el;
el.addEventListener('click', function (e) {
var n = e.target;
while (n && n !== el) {
if (n.tagName === 'A') { self.close(); return; }
n = n.parentNode;
}
});

flEmit(this.root, 'fl-shell-nav', { open: true });
return handle;
},

close: function () {
var h = this.handle;
if (!h) return false;

this.handle = null;
h.close();
return true;
},

destroy: function () {
this.close();
if (this.onResize) {
global.removeEventListener('resize', this.onResize);
this.onResize = null;
}
if (this.btn && this.btn.parentNode) this.btn.parentNode.removeChild(this.btn);
this.btn = null;
if (this.root && this.root.shellNavInstance === this) this.root.shellNavInstance = null;
this.disabled = true;
}
};

global.ShellNav = ShellNav;

function init() {
var nodes = document.querySelectorAll('[data-shell-nav]');
for (var i = 0; i < nodes.length; i++) {

if (nodes[i].shellNavInstance) continue;
try {
nodes[i].shellNavInstance = new ShellNav(nodes[i]);
} catch (e) {

warn('shell-nav: 初始化失败，已跳过该元素 —— ' + (e && e.message));
}
}
}

if (typeof document === 'undefined') return;
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', init);
} else {
init();
}
})(typeof window !== 'undefined' ? window : globalThis);
