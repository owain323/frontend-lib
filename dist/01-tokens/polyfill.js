(function (global) {
'use strict';

if (!Element.prototype.closest) {
Element.prototype.closest = function (selector) {
var el = this;
while (el && el.nodeType === 1) {
if (matchesSimple(el, selector)) return el;
el = el.parentElement;
}
return null;
};
}

function matchesSimple(el, selector) {
var parts = String(selector).split(',');
for (var i = 0; i < parts.length; i++) {
if (matchOne(el, parts[i].trim())) return true;
}
return false;
}

function matchOne(el, sel) {
if (!sel) return false;
var rest = sel;

var m = rest.match(/^([a-zA-Z][\w-]*)/);
if (m) {
if (el.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
rest = rest.slice(m[1].length);
}

var cls = rest.match(/\.([\w-]+)/g);
if (cls) {
for (var i = 0; i < cls.length; i++) {
var name = cls[i].slice(1);
if (!(' ' + el.className + ' ').indexOf(' ' + name + ' ') > -1) return false;
}
}

var id = rest.match(/#([\w-]+)/);
if (id && el.id !== id[1]) return false;

var attr = rest.match(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/);
if (attr) {
var v = el.getAttribute(attr[1]);
if (v === null) return false;
if (attr[2] !== undefined && v !== attr[2]) return false;
}
return true;
}

if (!Array.from) {
Array.from = function (obj) {
var out = [];
if (obj === null || obj === undefined) return out;
if (typeof obj.length === 'number') {
for (var i = 0; i < obj.length; i++) out.push(obj[i]);
} else {
for (var k in obj) {
if (Object.prototype.hasOwnProperty.call(obj, k)) out.push(obj[k]);
}
}
return out;
};
}

if (!global.requestAnimationFrame) {
global.requestAnimationFrame = function (cb) {
return global.setTimeout(function () {
cb(Date.now ? Date.now() : new Date().getTime());
}, 16);
};
global.cancelAnimationFrame = function (id) {
global.clearTimeout(id);
};
}
})(window);
