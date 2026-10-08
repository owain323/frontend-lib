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
