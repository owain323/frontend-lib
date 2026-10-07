(function (global) {
'use strict';

function raf(fn) {
return (global.requestAnimationFrame || function (f) {
return global.setTimeout(f, 16);
})(fn);
}

function init(opts) {
opts = opts || {};
var linkSel = opts.links || '.toc a';
var secSel = opts.sections || 'h2[id]';

var linkEls = document.querySelectorAll(linkSel);
var sections = document.querySelectorAll(secSel);
if (!linkEls.length || !sections.length) { return function () {}; }

var map = {};
for (var i = 0; i < linkEls.length; i++) {
var href = linkEls[i].getAttribute('href') || '';
if (href.charAt(0) === '#') { map[href.slice(1)] = linkEls[i]; }
}

function mark(id) {
for (var k in map) {
if (Object.prototype.hasOwnProperty.call(map, k)) {
map[k].removeAttribute('aria-current');
}
}
if (map[id]) { map[id].setAttribute('aria-current', 'true'); }
}

function currentId() {
var y = global.pageYOffset || document.documentElement.scrollTop || 0;

var line = y + 100;
var found = sections[0];
for (var n = 0; n < sections.length; n++) {
if (sections[n].offsetTop <= line) { found = sections[n]; } else { break; }
}

var doc = document.documentElement;
if (global.innerHeight + y >= doc.scrollHeight - 2 && sections.length) {
found = sections[sections.length - 1];
}
return found ? found.id : null;
}

var ticking = false;
function update() {
if (ticking) { return; }
ticking = true;
raf(function () {
ticking = false;
var id = currentId();
if (id) { mark(id); }
});
}

global.addEventListener('scroll', update, { passive: true });
global.addEventListener('resize', update);

global.addEventListener('hashchange', update);
update();

return function () {
global.removeEventListener('scroll', update);
global.removeEventListener('resize', update);
global.removeEventListener('hashchange', update);
};
}

global.Toc = { init: init };

})(window);
