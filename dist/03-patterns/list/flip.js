(function (global) {
'use strict';

function forceReflow(el) {

return el.offsetHeight;
}

function idOf(el) {

return el.getAttribute('data-flip-id');
}

function prefersReducedMotion() {
return global.matchMedia
&& global.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function flip(container, mutate, opts) {
opts = opts || {};

var DURATION = opts.duration || 260;
var reduce = prefersReducedMotion();

var first = {};
var kids = container.children;
var i, el, id, box;

for (i = 0; i < kids.length; i++) {
el = kids[i];
id = idOf(el);
if (id) { first[id] = el.getBoundingClientRect(); }
}

mutate();

if (reduce) {

for (i = 0; i < container.children.length; i++) {
el = container.children[i];
id = idOf(el);
if (!id || first[id] !== undefined) { continue; }
el.style.opacity = '0';
el.style.transition = 'none';

forceReflow(el);
el.style.transition = 'opacity ' + DURATION + 'ms linear';
el.style.opacity = '1';
}
return;
}

kids = container.children;
for (i = 0; i < kids.length; i++) {
el = kids[i];
id = idOf(el);
if (!id) { continue; }

box = el.getBoundingClientRect();

if (first[id] === undefined) {

el.style.opacity = '0';
el.style.transition = 'none';
forceReflow(el);
el.style.transition = 'opacity ' + DURATION + 'ms linear';
el.style.opacity = '1';
continue;
}

var dx = first[id].left - box.left;
var dy = first[id].top - box.top;

if (dx === 0 && dy === 0) { continue; }

el.style.transition = 'none';
el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';

forceReflow(el);
el.style.transition = 'transform ' + DURATION + 'ms ease-out';
el.style.transform = '';

global.setTimeout(function (node) {
return function () { node.style.transition = ''; };
}(el), DURATION + 20);
}
}

function removeWithAnimation(container, el, done) {
var reduce = prefersReducedMotion();
var DURATION = 260;

if (reduce) {

el.style.transition = 'opacity ' + DURATION + 'ms linear';
el.style.opacity = '0';
global.setTimeout(function () {
if (el.parentNode) { el.parentNode.removeChild(el); }
if (done) { done(); }
}, DURATION);
return;
}

el.style.transition = 'opacity ' + DURATION + 'ms ease-in';
el.style.opacity = '0';

el.style.transform = 'scale(0.97)';

global.setTimeout(function () {
if (el.parentNode) { el.parentNode.removeChild(el); }
if (done) { done(); }
}, DURATION);
}

global.FLIP = { flip: flip, remove: removeWithAnimation };

})(window);
