(function (global) {
'use strict';

var flRoving = function (opts) {
var opt = opts || {};
var container = opt.container;
var all = opt.items || function () { return []; };
var movable = opt.movable || all;
var nodeOf = opt.nodeOf || function (x) { return x; };
var axis = opt.axis || 'x';
var loop = opt.loop !== false;
var homeEnd = opt.homeEnd !== false;

var roveTab = opt.tabindex !== false;
var onMove = opt.onMove || function () {};

function rove(target) {
if (!roveTab) return target;
var l = all() || [];
for (var i = 0; i < l.length; i++) {
var n = nodeOf(l[i]);
if (!n || !n.setAttribute) continue;
n.setAttribute('tabindex', n === target ? '0' : '-1');
}
return target;
}

function step(i, d) {
var n = (movable() || []).length;
if (!n) return -1;
if (loop) return ((i + d) % n + n) % n;
var t = i + d;
return (t < 0 || t >= n) ? -1 : t;
}

function indexOfNode(node) {
var l = movable() || [];
for (var i = 0; i < l.length; i++) {
if (nodeOf(l[i]) === node) return i;
}
return -1;
}

function onKey(e) {
var l = movable() || [];
if (!l.length) return;
var i = indexOfNode(e.target);
if (i < 0) return;
var k = e.key;
var next = -1;
var reason = 'step';

if (axis === 'y') {
if (k === 'ArrowDown') next = step(i, 1);
else if (k === 'ArrowUp') next = step(i, -1);
} else {
if (k === 'ArrowRight') next = step(i, 1);
else if (k === 'ArrowLeft') next = step(i, -1);
}
if (homeEnd && k === 'Home') { next = 0; reason = 'home'; }
else if (homeEnd && k === 'End') { next = l.length - 1; reason = 'end'; }

if (next < 0 || next >= l.length) return;

if (e.preventDefault) e.preventDefault();
if (e.stopPropagation) e.stopPropagation();
onMove(next, l[next], reason);
}

if (container) container.addEventListener('keydown', onKey);

return {
rove: rove,
step: step,
indexOf: indexOfNode,
destroy: function () {
if (container) container.removeEventListener('keydown', onKey);
},
};
};

function closest(el, sel) {
if (!el) return null;
if (el.closest) return el.closest(sel);
while (el && el.nodeType === 1) {
if (elMatches(el, sel)) return el;
el = el.parentElement;
}
return null;
}
function elMatches(el, sel) {
var m = sel.match(/^([a-zA-Z][\w-]*)/);
if (m && el.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
var cls = sel.match(/\.([\w-]+)/g);
if (cls) {
for (var i = 0; i < cls.length; i++) {
var c = cls[i].slice(1);
if ((' ' + (el.className || '') + ' ').indexOf(' ' + c + ' ') < 0) return false;
}
}
var id = sel.match(/#([\w-]+)/);
if (id && el.id !== id[1]) return false;
var at = sel.match(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/);
if (at) {
var v = el.getAttribute(at[1]);
if (v === null) return false;
if (at[2] !== undefined && v !== at[2]) return false;
}
return true;
}

var uid = 0;

function create(root, opt) {
opt = opt || {};
root.classList.add('tree');
if (!root.getAttribute('role')) root.setAttribute('role', 'tree');
if (!root.getAttribute('aria-label') && !root.getAttribute('aria-labelledby')) {
root.setAttribute('aria-label', opt.label || '树形视图');
}

var items = [];
Array.prototype.forEach.call(root.querySelectorAll('li'), function (li) {
if (li.className.indexOf('tree__item') < 0) {
li.className = (li.className ? li.className + ' ' : '') + 'tree__item';
}
li.setAttribute('role', 'treeitem');
var kids = li.querySelector(':scope > ul');
if (kids) {
li.setAttribute('aria-expanded', kids.hidden ? 'false' : 'true');
}
var node = li.querySelector(':scope > .tree__node') || li.firstElementChild;
if (node) {
node.setAttribute('role', 'none');
node.setAttribute('tabindex', '-1');
if (!node.querySelector('.tree__marker')) {
var m = document.createElement('span');
m.className = 'tree__marker';
m.setAttribute('aria-hidden', 'true');
node.insertBefore(m, node.firstChild);
}
}
items.push({ li: li, node: node, ul: kids });
});

var cur = -1;
function visible() {
return items.filter(function (it) {
return it.node && it.node.offsetParent !== null;
});
}

function focusAt(i) {
var list = visible();
if (!list.length) return;
if (i < 0) i = list.length - 1;
if (i >= list.length) i = 0;
roving.rove(list[i].node);
list[i].node.focus();
cur = i;
}
function current() {
var list = visible();
return cur >= 0 && cur < list.length ? list[cur] : null;
}

var roving = flRoving({
container: root,
items: function () { return items; },
movable: function () { return visible(); },
nodeOf: function (it) { return it.node; },
axis: 'y',
onMove: function (i) { focusAt(i); },
});
function setExpanded(it, open) {
if (!it.ul) return;
it.li.setAttribute('aria-expanded', open ? 'true' : 'false');
it.ul.hidden = !open;
}

root.addEventListener('focusin', function (e) {
var node = e.target.closest ? closest(e.target, '.tree__node') : null;
if (!node) return;
var list = visible();
for (var i = 0; i < list.length; i++) {
if (list[i].node === node) { cur = i; break; }
}
});

root.addEventListener('keydown', function (e) {
var k = e.key;
var it = current();
if (!it) return;

if (k === 'ArrowRight') {
e.preventDefault();
if (it.ul && it.li.getAttribute('aria-expanded') === 'false') {
setExpanded(it, true);
} else if (it.ul) {
focusAt(cur + 1);
}
return;
}
if (k === 'ArrowLeft') {
e.preventDefault();
if (it.ul && it.li.getAttribute('aria-expanded') === 'true') {
setExpanded(it, false);
} else {

for (var i = cur; i > 0; i--) {
var cand = visible()[i];
if (it.li.contains(cand.li)) { focusAt(i); return; }
}
}
return;
}

if (k === '*') {
e.preventDefault();
var lvl = levelOf(it);
visible().forEach(function (x) {
if (x.ul && levelOf(x) === lvl) setExpanded(x, true);
});
return;
}

if (k === 'Enter') {
e.preventDefault();
if (it.ul) setExpanded(it, it.li.getAttribute('aria-expanded') !== 'true');
if (opt.onActivate) opt.onActivate(it);
return;
}
if (k === ' ' || k === 'Spacebar') {
e.preventDefault();
select(it);
return;
}

if (/^[a-zA-Z\u4e00-\u9fa5]$/.test(k)) {
e.preventDefault();
var list = visible();
var start = cur + 1;
for (var n = 0; n < list.length; n++) {
var idx = (start + n) % list.length;
var lbl = (list[idx].node.textContent || '').trim();
if (lbl.charAt(0).toLowerCase() === k.toLowerCase()) {
focusAt(idx);
return;
}
}
}
});

function select(it) {
items.forEach(function (x) { x.node.setAttribute('aria-selected', 'false'); });
it.node.setAttribute('aria-selected', 'true');
if (opt.onSelect) opt.onSelect(it);
}

root.addEventListener('click', function (e) {
var node = e.target.closest ? closest(e.target, '.tree__node') : null;
if (!node || !root.contains(node)) return;
var list = visible();
for (var i = 0; i < list.length; i++) {
if (list[i].node === node) { focusAt(i); break; }
}
var it = current();
if (it) {

if (e.target.closest && closest(e.target, '.tree__marker') && it.ul) {
setExpanded(it, it.li.getAttribute('aria-expanded') !== 'true');
} else {
select(it);
}
}
});

var firstVisible = visible()[0];
if (firstVisible) roving.rove(firstVisible.node);

return {
focusAt: focusAt,
get selected() { return current(); },
destroy: function () { roving.destroy(); root.innerHTML = ''; },
};
}

function levelOf(it) {
var n = 0, p = it.li.parentElement;
while (p && p !== document.body) {
if (p.getAttribute && p.getAttribute('role') === 'treeitem') n++;
p = p.parentElement;
}
return n;
}

global.Tree = { create: create };
})(window);
