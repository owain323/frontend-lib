(function (global) {
'use strict';

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

trigger.addEventListener('keydown', function (e) {
if (e.key === 'Escape' && box.getAttribute('data-open') === 'true') {
e.stopPropagation();
close();
}
});

box.addEventListener('keydown', function (e) {
if (e.key === 'Escape') {

e.stopPropagation();
close();
return;
}

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

var installed = false;
function installOutsideClick() {
if (installed) return;
installed = true;
document.addEventListener('click', function (e) {
if (!current) return;

if (current.el.contains(e.target) ||
current.el.parentNode.contains(e.target)) return;
current.close();
}, true);
}

var Popover = {
attach: function (trigger, opts) {
installOutsideClick();
return attach(trigger, opts);
},
closeAll: function () { if (current) current.close(); },
get current() { return current; },
};

global.Popover = Popover;
})(window);
