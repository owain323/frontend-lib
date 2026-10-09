(function (global) {
'use strict';

var FOCUSABLE = [
'a[href]',
'button:not([disabled])',
'input:not([disabled]):not([type="hidden"])',
'select:not([disabled])',
'textarea:not([disabled])',
'[tabindex]:not([tabindex="-1"])'
].join(',');

var lockCount = 0;

var scrollLock = { changed: false, saved: '', varSet: false };

var inertRefs = [];

function focusableIn(root) {
var all = Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE));

return all.filter(function (el) {
return el.offsetParent !== null || el === document.activeElement;
});
}

function lockScroll() {
if (lockCount++ > 0) return;

var sbw = window.innerWidth - document.documentElement.clientWidth;
if (sbw > 0) {
var cur = parseFloat(getComputedStyle(document.body).paddingRight) || 0;
scrollLock.saved = document.body.style.paddingRight;
document.body.style.paddingRight = (cur + sbw) + 'px';
scrollLock.changed = true;
document.documentElement.style.setProperty(
'--overlay-scrollbar-width', sbw + 'px');
scrollLock.varSet = true;
}
document.body.setAttribute('data-scroll-locked', 'true');
}

function unlockScroll() {
if (--lockCount > 0) return;
document.body.removeAttribute('data-scroll-locked');
if (scrollLock.varSet) {
document.documentElement.style.removeProperty('--overlay-scrollbar-width');
scrollLock.varSet = false;
}

if (scrollLock.changed) {
document.body.style.paddingRight = scrollLock.saved;
scrollLock.changed = false;
scrollLock.saved = '';
}
}

function inertAcquire(node) {
for (var i = 0; i < inertRefs.length; i++) {
if (inertRefs[i].node === node) { inertRefs[i].count++; return; }
}
inertRefs.push({ node: node, count: 1 });
node.inert = true;
}

function inertRelease(node) {
for (var i = 0; i < inertRefs.length; i++) {
if (inertRefs[i].node !== node) continue;
inertRefs[i].count--;
if (inertRefs[i].count <= 0) {
node.inert = false;
inertRefs.splice(i, 1);
}
return;
}
}

function toast(opts) {
opts = opts || {};

var region = document.querySelector('.toast-region');
if (!region) {
region = document.createElement('div');
region.className = 'toast-region';

region.setAttribute('role', 'status');
region.setAttribute('aria-live', 'polite');
document.body.appendChild(region);
}

var el = document.createElement('div');
el.className = 'toast' + (opts.variant ? ' toast--' + opts.variant : '');

var body = document.createElement('div');
body.className = 'toast__body';
if (opts.title) {
var t = document.createElement('p');
t.className = 'toast__title';
t.textContent = opts.title;
body.appendChild(t);
}
if (opts.desc) {
var d = document.createElement('p');
d.className = 'toast__desc';
d.textContent = opts.desc;
body.appendChild(d);
}
el.appendChild(body);

var auto = opts.duration;
if (auto === undefined) {
auto = (opts.variant === 'error') ? 0 : 4000;
}

if (auto > 0) {
var timer = document.createElement('div');
timer.className = 'toast__timer';
timer.style.animationDuration = auto + 'ms';
el.appendChild(timer);
}

var closeBtn = document.createElement('button');
closeBtn.className = 'toast__close';
closeBtn.type = 'button';
closeBtn.setAttribute('aria-label', '关闭提示');
closeBtn.textContent = '×';
el.appendChild(closeBtn);

var closed = false;
function close() {
if (closed) return;
closed = true;
if (auto) clearTimeout(timerId);
el.setAttribute('data-state', 'leaving');

setTimeout(function () {
if (el.parentNode) el.parentNode.removeChild(el);
}, 220);
}

closeBtn.addEventListener('click', close);
region.appendChild(el);

var timerId = auto > 0 ? setTimeout(close, auto) : null;
return { el: el, close: close };
}

function dialog(opts) {
opts = opts || {};

var myTrigger = document.activeElement;

var backdrop = document.createElement('div');
backdrop.className = 'dialog-backdrop';

var box = document.createElement('div');
box.className = 'dialog' + (opts.danger ? ' dialog--danger' : '');
box.setAttribute('role', 'dialog');
box.setAttribute('aria-modal', 'true');

box.setAttribute('tabindex', '-1');

if (opts.title) {
var h = document.createElement('h2');
h.className = 'dialog__title';
h.id = 'dlg-title-' + Date.now();
h.textContent = opts.title;
box.appendChild(h);
box.setAttribute('aria-labelledby', h.id);
}
if (opts.desc) {
var p = document.createElement('p');
p.className = 'dialog__desc';
p.id = 'dlg-desc-' + Date.now();
p.textContent = opts.desc;
box.appendChild(p);
box.setAttribute('aria-describedby', p.id);
}

var act = document.createElement('div');
act.className = 'dialog__actions';
(opts.actions || []).forEach(function (a) {
var b = document.createElement('button');
b.type = 'button';
b.className = 'btn ' + (a.variant === 'danger' ? 'btn--danger'
: a.variant === 'primary' ? 'btn--primary' : 'btn--secondary');
b.textContent = a.label;
b.addEventListener('click', function () {
if (a.onClick) a.onClick(close);
if (a.keepOpen !== true) close();
});
act.appendChild(b);
});
box.appendChild(act);

backdrop.appendChild(box);
document.body.appendChild(backdrop);
lockScroll();

function focusables() { return focusableIn(box); }

box.addEventListener('keydown', function (e) {
if (e.key === 'Escape') {
e.preventDefault();

e.stopPropagation();
close();
return;
}
if (e.key !== 'Tab') return;

var f = focusables();
if (!f.length) { e.preventDefault(); box.focus(); return; }
var first = f[0], last = f[f.length - 1];

if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) {
e.preventDefault(); last.focus();
} else if (!e.shiftKey && document.activeElement === last) {
e.preventDefault(); first.focus();
}
});

if (opts.initialFocus === 'cancel') {
var cancel = box.querySelector('.btn:not(.btn--danger)');
if (cancel) cancel.focus();
else box.focus();
} else {
box.focus();
}

if (opts.closeOnBackdrop !== false && !opts.danger) {
backdrop.addEventListener('mousedown', function (e) {
if (e.target === backdrop) close();
});
}

var closed = false;
var inerted = [];

if ('inert' in HTMLElement.prototype) {
var nodes = Array.prototype.slice.call(
document.body.querySelectorAll('body > *')
);
nodes.forEach(function (n) {

if (n.classList.contains('dialog-backdrop')) return;
inerted.push(n);
inertAcquire(n);
});
}

function close() {
if (closed) return;
closed = true;

var ae = document.activeElement;
var focusIsMine = !ae || ae === document.body ||
box.contains(ae) || backdrop.contains(ae);

if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);

inerted.forEach(inertRelease);
unlockScroll();

if (focusIsMine && myTrigger && document.contains(myTrigger)) {
myTrigger.focus();
}

}

return { el: box, close: close };
}

global.Overlay = { toast: toast, dialog: dialog };

})(window);
