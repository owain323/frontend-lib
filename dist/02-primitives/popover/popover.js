(function (global) {
'use strict';

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
if (e.preventDefault) e.preventDefault();
if (e.stopPropagation) e.stopPropagation();
onDismiss(e, 'esc');
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

var current = null;

function focusableIn(root) {
var all = root.querySelectorAll(
'a[href], button:not([disabled]), input:not([disabled]), '+
'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
);
return Array.prototype.filter.call(all, function (el) {
var cs = global.getComputedStyle(el);
if (cs.display === 'none' || cs.visibility === 'hidden') return false;
var r = el.getBoundingClientRect();
return r.width >= 1 && r.height >= 1;
});
}

function attach(trigger, opts) {
opts = opts || {};

var anchor = document.createElement('span');
anchor.className = 'popover-anchor';
trigger.parentNode.insertBefore(anchor, trigger);
anchor.appendChild(trigger);

var box = document.createElement('div');
box.className = 'popover popover--' + (opts.place || 'bottom');
box.setAttribute('data-open', 'false');
box.setAttribute('inert', '');

box.setAttribute('role', 'dialog');
box.setAttribute('aria-label', opts.label || '');
box.innerHTML =
'<span class="popover__arrow" aria-hidden="true"></span>'+
'<div class="popover__body">'+ (opts.html || '') + '</div>';

positionArrow(box, trigger);
anchor.appendChild(box);

var lastFocused = null;

function open() {
if (current && current !== api) current.close();
lastFocused = document.activeElement;
box.setAttribute('data-open', 'true');

box.removeAttribute('inert');

var f = focusableIn(box);
if (f.length) f[0].focus();
else box.setAttribute('tabindex', '-1'), box.focus();

current = api;
if (opts.onOpen) opts.onOpen();
}

function close() {
if (box.getAttribute('data-open') !== 'true') return;
box.setAttribute('data-open', 'false');

box.setAttribute('inert', '');

if (lastFocused && lastFocused.focus) lastFocused.focus();
lastFocused = null;
if (current === api) current = null;
if (opts.onClose) opts.onClose();
}

function toggle() {
if (box.getAttribute('data-open') === 'true') close();
else open();
}

trigger.setAttribute('aria-haspopup', 'dialog');
trigger.setAttribute('aria-expanded', 'false');
trigger.addEventListener('click', function (e) {

e.stopPropagation();
toggle();
});

var dismiss = flDismissable({
escOn: [trigger, box],
inside: [box, anchor],
when: function () { return box.getAttribute('data-open') === 'true'; },
onDismiss: function (e, reason) { close(); },
});

box.addEventListener('transitionend', function () {
if (box.getAttribute('data-open') === 'false') {
box.setAttribute('aria-hidden', 'true');
} else {
box.removeAttribute('aria-hidden');
}
});

var api = {
open: open,
close: close,
toggle: toggle,
destroy: function () {
dismiss.destroy();
close();
box.remove();
anchor.remove();
},
el: box,
};
return api;
}

function positionArrow(box, trigger) {
var arrow = box.querySelector('.popover__arrow');
if (!arrow) return;
var place = (box.className.match(/popover--(\w+)/) || [])[1];
if (place === 'start' || place === 'end') {

arrow.style.top = '50%';
arrow.style.marginTop = '';
return;
}
var br = trigger.getBoundingClientRect();
var ar = box.getBoundingClientRect();
var offset = br.left + br.width / 2 - (ar.left + parseFloat(getComputedStyle(box).paddingLeft || 0));

var max = ar.width - 24;
arrow.style.marginLeft = Math.max(12, Math.min(offset, max)) + 'px';
}

var Popover = {
attach: function (trigger, opts) {
return attach(trigger, opts);
},
closeAll: function () { if (current) current.close(); },
get current() { return current; },
};

global.Popover = Popover;
})(window);
