(function () {
'use strict';

var flEmit = function (el, name, detail) {
if (!el || !el.dispatchEvent) return null;
var type = name.indexOf('fl-') === 0 ? name : 'fl-' + name;
var ev = null;

if (typeof window.CustomEvent === 'function') {
try {
ev = new window.CustomEvent(type, {
detail: detail || null, bubbles: true, cancelable: false
});
} catch (e) { ev = null; }
}
if (!ev) {
try {
ev = document.createEvent('CustomEvent');
ev.initCustomEvent(type, true, false, detail || null);
} catch (e2) { return null; }
}
el.dispatchEvent(ev);
return ev;
};

var SLOTS = 7;

function el(tag, cls, text) {
var n = document.createElement(tag);
if (cls) n.className = cls;
if (text !== undefined && text !== null) n.textContent = text;
return n;
}

function pageWindow(cur, total, slots) {
slots = slots || SLOTS;
if (total <= slots - 2) {
var all = [];
for (var i = 1; i <= total; i++) all.push(i);
return all;
}

var MAX_MID = slots - 4;
if (MAX_MID < 1) MAX_MID = 1;

var mid = [];
var start = cur - Math.floor(MAX_MID / 2);
if (start < 2) start = 2;
if (start + MAX_MID - 1 > total - 1) start = total - MAX_MID;
if (start < 2) start = 2;
for (var j = start; j < start + MAX_MID; j++) {
if (j > 1 && j < total) mid.push(j);
}

var out = [1];

if (mid.length && mid[0] > 2) out.push('…');
for (var k = 0; k < mid.length; k++) out.push(mid[k]);
if (mid.length && mid[mid.length - 1] < total - 1) out.push('…');
if (total > 1) out.push(total);
return out;
}

function Pagination(node) {
this.node = node;
this.total = Math.max(1, parseInt(node.getAttribute('data-total') || '1', 10));
this.size = Math.max(1, parseInt(node.getAttribute('data-page-size') || '20', 10));
this.page = Math.max(1, parseInt(node.getAttribute('data-page') || '1', 10));
this.label = node.getAttribute('aria-label') || '分页';
this.pages = Math.max(1, Math.ceil(this.total / this.size));
this.onChange = null;

try {
var u = node.getAttribute('data-pg-param') || 'page';
var q = parseInt(new URL(location.href).searchParams.get(u) || '0', 10);
if (q > 0) this.page = Math.min(q, this.pages);
} catch (e) {  }

this.listNode = node.querySelector('[data-pg-list]');
this.statusNode = node.querySelector('[data-pg-status]');
this.liveNode = node.querySelector('[data-pg-live]');

var self = this;
node.addEventListener('click', function (e) {
var t = e.target;
while (t && t !== node && t.tagName !== 'BUTTON' && t.tagName !== 'A') {
t = t.parentNode;
}
if (!t || t === node) return;
if (t.disabled || t.getAttribute('aria-disabled') === 'true') return;
var to = t.getAttribute('data-goto');
if (to === 'prev') { self.go(self.page - 1); }
else if (to === 'next') { self.go(self.page + 1); }
else if (to === 'first') { self.go(1); }
else if (to === 'last') { self.go(self.pages); }
else if (to) { self.go(parseInt(to, 10)); }
});

this._onKey = function (e) {
if (e.metaKey || e.ctrlKey || e.altKey) return;
var act = document.activeElement;
var inside = act && (act === self.node || self.node.contains(act));

if (act && /^(INPUT|TEXTAREA|SELECT)$/.test(act.tagName)) return;
if (act && act.isContentEditable) return;

if (!inside && act && act !== document.body) return;

var k = e.key;
if (k === 'ArrowLeft') { self.go(self.page - 1); }
else if (k === 'ArrowRight') { self.go(self.page + 1); }
else if (k === 'Home') { self.go(1); }
else if (k === 'End') { self.go(self.pages); }
else return;
e.preventDefault();

self.focusCurrent();
};
document.addEventListener('keydown', this._onKey);

this.render();
}

Pagination.prototype.pages = 1;

Pagination.prototype.go = function (n, opts) {
opts = opts || {};
n = Math.max(1, Math.min(this.pages, n));
if (n === this.page && !opts.force) { this.focusCurrent(); return; }
this.page = n;
this.render();
this.announce();

if (opts.scroll !== false) this.scrollToTop();
this.syncURL();
flEmit(this.node, 'fl-change', { value: n, page: n });
if (typeof this.onChange === 'function') this.onChange(n);
};

Pagination.prototype.scrollToTop = function () {
var target = this.node.getAttribute('data-pg-scroll-target')
|| this.node.getAttribute('aria-controls');
var el = target ? document.getElementById(target) : null;
if (!el || !el.scrollIntoView) {

if (this.node.scrollIntoView) {
try { this.node.scrollIntoView({ block: 'nearest' }); } catch (e) {}
}
return;
}
try {
el.scrollIntoView({ block: 'start' });
} catch (e) {
el.scrollIntoView(true);
}
};

Pagination.prototype.syncURL = function () {
if (typeof history === 'undefined' || !history.replaceState) return;
if (this.node.getAttribute('data-pg-nourl') === 'true') return;
try {
var u = this.node.getAttribute('data-pg-param') || 'page';
var url = new URL(location.href);
if (this.page <= 1) url.searchParams.delete(u);
else url.searchParams.set(u, String(this.page));
history.replaceState(null, '', url.toString());
} catch (e) {  }
};

Pagination.prototype.focusCurrent = function () {
var cur = this.listNode.querySelector('[aria-current="page"]');
if (cur && cur.focus) cur.focus();
};

Pagination.prototype.announce = function () {
if (!this.liveNode) return;
this.liveNode.textContent = '第 ' + this.page + ' 页，共 ' + this.pages + ' 页';
};

Pagination.prototype.render = function () {
if (!this.listNode) return;
var L = this.listNode;
while (L.firstChild) L.removeChild(L.firstChild);
var self = this;

function addBtn(text, ariaLabel, goto, disabled) {
var li = el('li', 'pagination__item');
var b = el('button', 'pagination__link', text);
b.type = 'button';
b.setAttribute('data-goto', goto);

if (disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
li.appendChild(b);
L.appendChild(li);
return b;
}

addBtn('‹', '上一页', 'prev', self.page <= 1);

var win = pageWindow(self.page, self.pages, SLOTS);
for (var i = 0; i < win.length; i++) {
var p = win[i];
if (p === '…') {
var li = el('li', 'pagination__item');
li.appendChild(el('span', 'pagination__ellipsis', '…'));

li.firstChild.setAttribute('aria-hidden', 'true');
L.appendChild(li);
continue;
}

var isCur = (p === self.page);
var li2 = el('li', 'pagination__item');
var b2 = el('button', 'pagination__link', String(p));
b2.type = 'button';
b2.setAttribute('data-goto', String(p));
b2.setAttribute('aria-label', '第 ' + p + ' 页' + (isCur ? '（当前页）' : ''));
if (isCur) {
b2.setAttribute('aria-current', 'page');
b2.setAttribute('aria-disabled', 'true');
}
li2.appendChild(b2);
L.appendChild(li2);
}

addBtn('›', '下一页', 'next', self.page >= self.pages);

if (this.statusNode) {
this.statusNode.textContent =
'第 '+ self.page + ' 页 / 共 ' + self.pages + ' 页';
}
};

var API = {

create: function (node) {
if (!node) return null;
if (node.__pg) return node.__pg;
node.__pg = new Pagination(node);
return node.__pg;
},

update: function (root) {
var list = (root || document).querySelectorAll('[data-pagination]');
for (var i = 0; i < list.length; i++) API.create(list[i]);
},

pagesOf: function (total, pageSize) {
return Math.max(1, Math.ceil((total || 1) / (pageSize || 20)));
},
};

if (typeof window !== 'undefined') window.Pagination = API;
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', function () { API.update(); });
} else {
API.update();
}
})();
