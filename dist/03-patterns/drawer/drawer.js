(function (global) {
'use strict';

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

var lastFocused = document.activeElement;

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

function onKey(e) {
var k = e.key;

if (k === 'Escape' || k === 'Esc') { e.preventDefault(); close(); return; }
if (k !== 'Tab') return;

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
function onBackdropClick(e) { if (e.target === host) close(); }

d.addEventListener('keydown', onKey);
host.addEventListener('click', onBackdropClick);
closeBtn.addEventListener('click', function () { close(); });

var closed = false;
function close() {
if (closed) return;
closed = true;
d.setAttribute('data-state', 'leaving');
d.removeEventListener('keydown', onKey);
host.removeEventListener('click', onBackdropClick);
setBackgroundInert(false);
unlockScroll();

var done = false;
function remove() {
if (done) return; done = true;
if (host.parentNode) host.parentNode.removeChild(host);
}
d.addEventListener('transitionend', remove, { once: true });
setTimeout(remove, 320);

if (lastFocused && document.contains(lastFocused)) {
try { lastFocused.focus(); } catch (e) {  }
}
if (opt.onClose) opt.onClose();
}

return { el: d, close: close };
}

global.Drawer = { open: open };
})(window);
