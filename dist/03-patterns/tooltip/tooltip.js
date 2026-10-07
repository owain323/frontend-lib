(function (global) {
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

el.addEventListener('keydown', function (e) {
if (e.key === 'Escape' || e.key === 'Esc') { hide(); el.focus(); }
});
document.addEventListener('click', hide);

var cur = el.getAttribute('aria-describedby');
el.setAttribute('aria-describedby', cur ? (cur + ' ' + id) : id);
el.setAttribute('data-tooltip', text);
}

global.Tooltip = { attach: attach };
})(window);
