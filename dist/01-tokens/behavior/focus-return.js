var flFocusReturn = function (opts) {
var opt = opts || {};
var saved = null;

return {
save: function () {
var a = document.activeElement;
saved = (a && a !== document.body && a.focus) ? a : null;
return saved;
},

restore: function () {
var target = saved;

if (!target || !document.contains(target)) target = opt.fallback || null;
if (!target) { saved = null; return false; }
try {
target.focus();
} catch (e) {
saved = null;
return false;
}
var ok = document.activeElement === target;
saved = null;
return ok;
},

target: function () { return saved; },
clear: function () { saved = null; },
};
};
