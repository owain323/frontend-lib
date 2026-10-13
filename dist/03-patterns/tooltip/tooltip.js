(function (global) {

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

'use strict';

var uid = 0;

function ensureStyle() {
if (document.getElementById('tooltip-css')) return;

}

function ensureLiveRegion() {
var id = 'tooltip-live';
var r = document.getElementById(id);
if (r) return r;
r = document.createElement('div');
r.id = id;
r.setAttribute('role', 'tooltip');

r.setAttribute('aria-live', 'polite');
r.setAttribute('aria-atomic', 'true');
r.style.cssText =
'position:absolute;width:1px;height:1px;padding:0;margin:-1px;'+
'overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';
document.body.appendChild(r);
return r;
}

var CLS = {
top: 'top', bottom: 'bottom',
start: 'inset-inline-start', end: 'inset-inline-end',
};

function resolve(el, place) {
var p = place || 'bottom';
if (p === 'top' || p === 'bottom' || p === 'start' || p === 'end') return p;
if (p !== 'left' && p !== 'right') return 'bottom';
var rtl = getComputedStyle(el).direction === 'rtl';
if (p === 'left') return rtl ? 'end' : 'start';
return rtl ? 'start' : 'end';
}

function attach(el, text, place) {

var fr = flFocusReturn({ fallback: el });
if (!el || !text) return;
ensureStyle();

var pos = resolve(el, place);
var id = 'tt' + (++uid);
var tip = document.createElement('div');
tip.id = id;
tip.className = 'tooltip tooltip--' + CLS[pos];
tip.setAttribute('role', 'tooltip');
tip.textContent = text;

var live = ensureLiveRegion();

function show() {

fr.save();

tip.style.visibility = 'hidden';
tip.style.display = 'block';
if (!tip.parentNode) document.body.appendChild(tip);

var b = el.getBoundingClientRect();
var t = tip.getBoundingClientRect();
if (pos === 'top') {
tip.style.top = (b.top - t.height) + window.pageYOffset + 'px';
tip.style.left = (b.left + b.width / 2 - t.width / 2) + window.pageXOffset + 'px';
} else if (pos === 'start' || pos === 'end') {
var rtl = getComputedStyle(el).direction === 'rtl';

var x = (pos === 'start')
? (rtl ? b.right : b.left - t.width)
: (rtl ? b.left - t.width : b.right);
tip.style.left = x + window.pageXOffset + 'px';
tip.style.top = (b.top + b.height / 2 - t.height / 2) + window.pageYOffset + 'px';
} else {
tip.style.top = (b.bottom + window.pageYOffset) + 'px';
tip.style.left = (b.left + b.width / 2 - t.width / 2) + window.pageXOffset + 'px';
}
tip.style.visibility = '';
tip.setAttribute('data-state', 'open');
live.textContent = text;
}

function hide() {
tip.removeAttribute('data-state');
live.textContent = '';
}

el.addEventListener('focus', show);
el.addEventListener('blur', hide);

el.addEventListener('click', function (e) {
e.stopPropagation();
if (tip.getAttribute('data-state') === 'open') hide(); else show();
});

var dismiss = flDismissable({
escOn: [el],
inside: [el, tip],
when: function () { return tip.getAttribute('data-state') === 'open'; },
onDismiss: function (ev, reason) {
hide();
if (reason === 'esc') fr.restore();
}
});

var cur = el.getAttribute('aria-describedby');
el.setAttribute('aria-describedby', cur ? (cur + ' ' + id) : id);
el.setAttribute('data-tooltip', text);
}

global.Tooltip = { attach: attach };
})(window);
