(function () {
'use strict';

var KEY = 'fe-theme';
var root = document.documentElement;

function read() {
try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; }
}
function save(v) {
try { localStorage.setItem(KEY, v); } catch (e) {  }
}

function systemDark() {
return typeof window.matchMedia === 'function' &&
window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(mode) {
var dark = mode === 'dark' || (mode === 'auto' && systemDark());

if (mode === 'auto') root.removeAttribute('data-theme');
else root.setAttribute('data-theme', mode);

root.setAttribute('data-theme-current', dark ? 'dark' : 'light');

var meta = document.querySelector('meta[name="theme-color"]');
if (meta && typeof window.getComputedStyle === 'function') {
var v = window.getComputedStyle(root).getPropertyValue('--paper');
v = (v || '').trim();
if (v) meta.setAttribute('content', v);
}
}

var Theme = {
get: function () { return read(); },
isDark: function () {
return document.documentElement.getAttribute('data-theme-current') === 'dark';
},
set: function (m) { save(m); apply(m); },
toggle: function () { Theme.set(Theme.isDark() ? 'light' : 'dark'); },

cycle: function () {
var cur = read();
Theme.set(cur === 'auto' ? 'light' : (cur === 'light' ? 'dark' : 'auto'));
},
};
window.Theme = Theme;

if (typeof window.matchMedia === 'function') {
var mq = window.matchMedia('(prefers-color-scheme: dark)');
var onChange = function () { if (read() === 'auto') apply('auto'); };
if (mq.addEventListener) mq.addEventListener('change', onChange);
else if (mq.addListener) mq.addListener(onChange);
}

function init() { apply(read()); }
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', init);
} else { init(); }
})();
