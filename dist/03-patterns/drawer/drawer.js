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

var FOCUSABLE = [
'a[href]',
'button:not([disabled])',
'input:not([disabled]):not([type="hidden"])',
'select:not([disabled])',
'textarea:not([disabled])',
'[tabindex]:not([tabindex="-1"])',
].join(',');

var lockCount = 0, savedScroll = 0, inerts = [];

function lockScroll() {
if (lockCount === 0) {
savedScroll = window.pageYOffset || 0;
document.body.style.overflow = 'hidden';
}
lockCount++;
}
function unlockScroll() {
lockCount = Math.max(0, lockCount - 1);
if (lockCount === 0) {
document.body.style.overflow = '';
window.scrollTo(0, savedScroll);
}
}

function setBackgroundInert(on) {
if (on) {
if (inerts.length) return;

Array.prototype.forEach.call(document.body.children, function (n) {
if (n.hasAttribute && n.hasAttribute('data-drawer-host')) return;
if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return;
n.inert = true;
n.setAttribute('aria-hidden', 'true');
inerts.push(n);
});
} else {
inerts.forEach(function (n) {
n.inert = false;
n.removeAttribute('aria-hidden');
});
inerts = [];
}
}

function open(opt) {
opt = opt || {};
var place = opt.place || 'right';

var fr = flFocusReturn({});
fr.save();

var host = document.createElement('div');
host.className = 'drawer-backdrop';
host.setAttribute('data-drawer-host', '');
if (opt.label) host.setAttribute('aria-label', opt.label);

var d = document.createElement('aside');
d.className = 'drawer drawer--' + place;
d.setAttribute('role', 'dialog');
d.setAttribute('aria-modal', 'true');
if (!d.id) d.id = 'drawer-' + (new Date()).getTime();
if (opt.title) d.setAttribute('aria-labelledby', d.id + '-title');
else d.setAttribute('aria-label', opt.label || '抽屉');
d.tabIndex = -1;

var head = document.createElement('div');
head.className = 'drawer__head';
var h = document.createElement('h2');
h.className = 'drawer__title';
h.id = d.id + '-title';
h.textContent = opt.title || '';
var closeBtn = document.createElement('button');
closeBtn.className = 'drawer__close';
closeBtn.type = 'button';
closeBtn.setAttribute('aria-label', '关闭');
closeBtn.textContent = '\u00D7';
head.appendChild(h);
head.appendChild(closeBtn);

var body = document.createElement('div');
body.className = 'drawer__body';
if (typeof opt.content === 'string') body.innerHTML = opt.content;
else if (opt.content) body.appendChild(opt.content);

d.appendChild(head);
d.appendChild(body);

if (opt.actions && opt.actions.length) {
var foot = document.createElement('div');
foot.className = 'drawer__foot';
opt.actions.forEach(function (a) {
var b = document.createElement('button');
b.type = 'button';
b.className = 'btn' + (a.variant ? ' btn--' + a.variant : '');
b.textContent = a.label;
b.addEventListener('click', function () {
if (a.onClick) a.onClick(close);
if (a.keepOpen !== true) close();
});
foot.appendChild(b);
});
d.appendChild(foot);
}

host.appendChild(d);
document.body.appendChild(host);

setBackgroundInert(true);
lockScroll();

var f = d.querySelectorAll(FOCUSABLE);
if (opt.initialFocus) {
var t = d.querySelector(opt.initialFocus);
if (t) t.focus();
else (f[0] || d).focus();
} else {
(f[0] || d).focus();
}

var dm = flDismissable({
escOn: [d],
inside: [d],
when: function () { return !closed; },
onDismiss: function () { close(); },
});

function onKey(e) {
if (e.key !== 'Tab') return;

var list = [].slice.call(d.querySelectorAll(FOCUSABLE))
.filter(function (x) { return x.offsetParent !== null; });
if (!list.length) { e.preventDefault(); d.focus(); return; }
var first = list[0], last = list[list.length - 1];
if (e.shiftKey && (document.activeElement === first || document.activeElement === d)) {
e.preventDefault(); last.focus();
} else if (!e.shiftKey && document.activeElement === last) {
e.preventDefault(); first.focus();
}
}

d.addEventListener('keydown', onKey);
closeBtn.addEventListener('click', function () { close(); });

var closed = false;
function close() {
if (closed) return;
closed = true;
d.setAttribute('data-state', 'leaving');
d.removeEventListener('keydown', onKey);

dm.destroy();
setBackgroundInert(false);
unlockScroll();

var done = false;
function remove() {
if (done) return; done = true;
if (host.parentNode) host.parentNode.removeChild(host);
}
d.addEventListener('transitionend', remove, { once: true });
setTimeout(remove, 320);

fr.restore();

flEmit(d, 'fl-close', null);
if (opt.onClose) opt.onClose();
}

return { el: d, close: close };
}

global.Drawer = { open: open };
})(typeof window !== 'undefined' ? window : globalThis);
