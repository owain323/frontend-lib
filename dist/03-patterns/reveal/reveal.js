(function (global) {
'use strict';

var SELECTOR = '[data-reveal]';
var GROUP_SELECTOR = '[data-reveal-children]';
var STAGGER_MS = 40;
var STAGGER_CAP = 6;
var THRESHOLD = 0.15;
var WATCHDOG_MS = 2000;
var observer = null;
var watchdog = null;

function each(list, fn) {
for (var i = 0; i < list.length; i++) { fn(list[i], i); }
}

function reduced() {
return !!(global.matchMedia &&
global.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function markDone(el) { el.setAttribute('data-reveal-done', ''); }
function clearDone(el) { el.removeAttribute('data-reveal-done'); }

function prepareGroups() {
var groups = document.querySelectorAll(GROUP_SELECTOR);
each(groups, function (group) {
var dir = group.getAttribute('data-reveal-children') || 'up';
var kids = group.children;
for (var i = 0; i < kids.length; i++) {
var k = kids[i];
if (!k.hasAttribute('data-reveal')) {
k.setAttribute('data-reveal', dir);
}
if (!k.hasAttribute('data-reveal-delay')) {
var step = i < STAGGER_CAP ? i : STAGGER_CAP;
k.style.setProperty('--reveal-delay', (step * STAGGER_MS) + 'ms');
}
}
});
}

function revealAll() {
each(document.querySelectorAll(SELECTOR), markDone);
}

function inViewport(el) {
var vh = global.innerHeight || document.documentElement.clientHeight || 0;
var r = el.getBoundingClientRect();
return r.bottom > 0 && r.top < vh;
}

function watchdogSweep() {
watchdog = null;
each(document.querySelectorAll(SELECTOR), function (el) {
if (el.hasAttribute('data-reveal-done')) { return; }
if (inViewport(el)) { markDone(el); }
});
}

function teardown() {
if (watchdog) { global.clearTimeout(watchdog); watchdog = null; }
if (observer) { observer.disconnect(); observer = null; }
each(document.querySelectorAll(SELECTOR), function (el) {
clearDone(el);
});
document.documentElement.removeAttribute('data-reveal-ready');
}

function enable() {
var root = document.documentElement;
if (observer) { return true; }

prepareGroups();
root.setAttribute('data-reveal-ready', '');

if (!('IntersectionObserver' in global) || reduced()) {
revealAll();
return true;
}

try {
observer = new global.IntersectionObserver(function (entries) {
for (var i = 0; i < entries.length; i++) {
var en = entries[i];
if (en.isIntersecting) {
markDone(en.target);
if (!en.target.hasAttribute('data-reveal-repeat')) {
observer.unobserve(en.target);
}
} else if (en.target.hasAttribute('data-reveal-repeat')) {
clearDone(en.target);
}
}
}, { threshold: THRESHOLD, rootMargin: '0px 0px -8% 0px' });

each(document.querySelectorAll(SELECTOR), function (el) {
observer.observe(el);
});
} catch (e) {
if (observer) {
try { observer.disconnect(); } catch (e2) { observer = null; }
observer = null;
}
revealAll();
return true;
}

if (!watchdog) {
watchdog = global.setTimeout(watchdogSweep, WATCHDOG_MS);
}
return true;
}

function disable() {
teardown();
revealAll();
}

function replay() {
teardown();
return enable();
}

global.Reveal = { enable: enable, disable: disable, replay: replay };

function auto() {
if (document.documentElement.hasAttribute('data-reveal-auto')) {
enable();
}
}

if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', auto, false);
} else {
auto();
}
}(this));
