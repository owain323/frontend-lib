var flTypeahead = function (opts) {
var opt = opts || {};
var items = opt.items || function () { return []; };
var textOf = opt.textOf || function (x) { return String((x && x.textContent) || ''); };
var usable = opt.usable || function () { return true; };
var timeout = opt.timeout || 500;
var onHit = opt.onHit || function () {};
var buf = '';
var timer = null;
var last = -1;

function stop() {
if (timer) { clearTimeout(timer); timer = null; }
}

function repeated(s) {
if (s.length < 2) return false;
for (var i = 1; i < s.length; i++) {
if (s.charAt(i) !== s.charAt(0)) return false;
}
return true;
}

function find(needle) {
var l = items() || [];
var n = l.length;
if (!n) return -1;
for (var k = 0; k < n; k++) {
var i = (last + 1 + k) % n;
if (!usable(l[i])) continue;
if (textOf(l[i]).toLowerCase().indexOf(needle) === 0) return i;
}
return -1;
}

function type(ch) {
if (!ch) return -1;
buf += String(ch).toLowerCase();
stop();
timer = setTimeout(clear, timeout);
var needle = repeated(buf) ? buf.charAt(0) : buf;
var i = find(needle);
if (i >= 0) {
last = i;
onHit(i, (items() || [])[i], buf);
}
return i;
}

function clear() {
buf = '';
stop();
}

return {
type: type,
clear: clear,
buffer: function () { return buf; },
destroy: function () { stop(); },
};
};
