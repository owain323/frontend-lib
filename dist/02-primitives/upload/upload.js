(function (global) {
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

var SVG_NS = 'http://www.w3.org/2000/svg';

var ICON = {
pending: 'M8 1.7a6.3 6.3 0 1 0 0 12.6A6.3 6.3 0 0 0 8 1.7zM8 4.6V8l2.3 1.5',
done: 'M3.3 8.4l3.1 3.1 6.3-6.9',
error: 'M8 1.7a6.3 6.3 0 1 0 0 12.6A6.3 6.3 0 0 0 8 1.7zM8 4.9v3.4M8 11.1v.5',
remove: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6'
};

var STATE_TEXT = { pending: '待上传', done: '已完成', error: '失败' };

function humanSize(n) {
if (typeof n !== 'number' || n < 0) return '';
if (n < 1024) return n + ' B';
if (n < 1024 * 1024) {
return (n < 10240 ? oneDecimal(n / 1024) : Math.round(n / 1024)) + ' KB';
}
return (n < 10 * 1048576 ? oneDecimal(n / 1048576) : Math.round(n / 1048576)) + ' MB';
}

function oneDecimal(v) {
return v.toFixed(1).replace(/\.0$/, '');
}

function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

function matchesAccept(file, accept) {
if (!accept) return true;
var parts = String(accept).split(',');
var name = (file.name || '').toLowerCase();
var type = (file.type || '').toLowerCase();
for (var i = 0; i < parts.length; i++) {
var p = trim(parts[i]).toLowerCase();
if (!p) continue;
if (p.charAt(0) === '.') {

if (name.length > p.length && name.slice(-p.length) === p) return true;
} else if (p.indexOf('/*') > 0) {
if (type.indexOf(p.slice(0, p.indexOf('/')) + '/') === 0) return true;
} else if (type === p) {
return true;
}
}
return false;
}

function currentFiles(input) {
var out = [];
var fl = input && input.files;
if (!fl) return out;
for (var i = 0; i < fl.length; i++) out.push(fl[i]);
return out;
}

function writeFiles(input, files) {
if (typeof global.DataTransfer !== 'function') return false;
try {
var dt = new global.DataTransfer();
for (var i = 0; i < files.length; i++) {
if (dt.items && dt.items.add) dt.items.add(files[i]);
}
input.files = dt.files;
return true;
} catch (e) {
return false;
}
}

function iconEl(name) {
var svg = document.createElementNS(SVG_NS, 'svg');
svg.setAttribute('viewBox', '0 0 16 16');
svg.setAttribute('fill', 'none');
svg.setAttribute('stroke', 'currentColor');
svg.setAttribute('stroke-width', '1.6');
svg.setAttribute('stroke-linecap', 'round');
svg.setAttribute('stroke-linejoin', 'round');
svg.setAttribute('aria-hidden', 'true');
var path = document.createElementNS(SVG_NS, 'path');
path.setAttribute('d', ICON[name] || ICON.pending);
svg.appendChild(path);
return svg;
}

function Upload(root, opts) {
var opt = opts || {};

this.root = root;
this.input = root.querySelector('.upload__input');
this.list = root.querySelector('.upload__list');
this.status = root.querySelector('.upload__status');
this.dropzone = root.querySelector('.upload__dropzone');

if (!this.input) {
throw new Error('upload: 缺少 .upload__input —— 没有它就没有真值，组件无法工作');
}

this.maxSize = opt.maxSize || parseInt(root.getAttribute('data-max-size'), 10) || 0;
this.maxFiles = opt.maxFiles || parseInt(root.getAttribute('data-max-files'), 10) || 0;

this.progress = [];
this.rejected = [];
this._announceTimer = null;
this._dragDepth = 0;

var self = this;
this._onChange = function () { self._handleChange(); };
this.input.addEventListener('change', this._onChange);

if (this.dropzone) {
this._onDragOver = function (e) { self._handleDragOver(e); };
this._onDragEnter = function (e) { self._handleDragEnter(e); };
this._onDragLeave = function (e) { self._handleDragLeave(e); };
this._onDrop = function (e) { self._handleDrop(e); };
this.dropzone.addEventListener('dragover', this._onDragOver);
this.dropzone.addEventListener('dragenter', this._onDragEnter);
this.dropzone.addEventListener('dragleave', this._onDragLeave);
this.dropzone.addEventListener('drop', this._onDrop);
}

this.render();
}

Upload.prototype = {
constructor: Upload,

_handleDragOver: function (e) {

e.preventDefault();
if (e.dataTransfer) {

try { e.dataTransfer.dropEffect = 'copy'; } catch (err) {  }
}
},

_handleDragEnter: function (e) {
e.preventDefault();
this._dragDepth++;
this.setState('dragover');
},

_handleDragLeave: function (e) {
e.preventDefault();

this._dragDepth--;
if (this._dragDepth <= 0) {
this._dragDepth = 0;
this.setState('');
}
},

_handleDrop: function (e) {
e.preventDefault();
this._dragDepth = 0;
this.setState('');

var dt = e.dataTransfer;
if (!dt) return;

var dropped = [];
var dirCount = 0;
if (dt.items && dt.items.length) {
for (var i = 0; i < dt.items.length; i++) {
var it = dt.items[i];
if (it.kind !== 'file') continue;
var entry = it.webkitGetAsEntry && it.webkitGetAsEntry();
if (entry && entry.isDirectory) { dirCount++; continue; }
var f = it.getAsFile && it.getAsFile();
if (f) dropped.push(f);
}
} else if (dt.files) {
for (var j = 0; j < dt.files.length; j++) dropped.push(dt.files[j]);
}

if (!dropped.length && !dirCount) return;
this.add(dropped, dirCount);
},

_validate: function (incoming) {
var keep = [];
var rejected = [];
var maxFiles = this.maxFiles || (this.input.multiple ? 0 : 1);
var accept = this.input.getAttribute('accept');

for (var i = 0; i < incoming.length; i++) {
var f = incoming[i];
if (maxFiles && keep.length >= maxFiles) {
rejected.push({ file: f, reason: 'count', text: '最多 ' + maxFiles + ' 个文件' });
continue;
}
if (this.maxSize && f.size > this.maxSize) {
rejected.push({ file: f, reason: 'size', text: '超过 ' + humanSize(this.maxSize) });
continue;
}
if (!matchesAccept(f, accept)) {
rejected.push({ file: f, reason: 'type', text: '类型不支持' });
continue;
}
keep.push(f);
}
return { keep: keep, rejected: rejected };
},

add: function (incoming, dirCount) {
var r = this._validate(incoming);

if (dirCount) {
r.rejected.push({
file: { name: dirCount + ' 个文件夹', size: 0 },
reason: 'dir', text: '请拖入文件，不支持文件夹'
});
}

if (!r.keep.length) {

this.rejected = r.rejected;
this.render();
this.announce(r.rejected.length ? '未添加任何文件：' + r.rejected[0].text : '未添加任何文件');
flEmit(this.root, 'fl-upload', {
files: currentFiles(this.input), added: 0, rejected: r.rejected
});
return false;
}

if (!writeFiles(this.input, r.keep)) {

this.rejected = [{ file: r.keep[0], reason: 'unsupported',
text: '当前浏览器不支持拖放，请点「选择文件」' }];
this.render();
this.announce('当前浏览器不支持拖放，请点选择文件');
return false;
}

this.progress = [];
this.rejected = r.rejected;
this.render();
this.announce(this.summary(r.keep.length, r.rejected.length));
flEmit(this.root, 'fl-upload', {
files: currentFiles(this.input), added: r.keep.length, rejected: r.rejected
});

return true;
},

_handleChange: function () {
var files = currentFiles(this.input);
var r = this._validate(files);

if (r.rejected.length) writeFiles(this.input, r.keep);

this.progress = [];
this.rejected = r.rejected;
this.render();
this.announce(this.summary(r.keep.length, r.rejected.length));
flEmit(this.root, 'fl-upload', {
files: currentFiles(this.input), added: r.keep.length, rejected: r.rejected
});
},

render: function () {
var files = currentFiles(this.input);
var keep = [];

this.list.innerHTML = '';

for (var i = 0; i < files.length; i++) {
var pct = this.progress[i];
keep.push(pct === undefined ? null : pct);
this.list.appendChild(this.itemEl(files[i], i, null, pct));
}
this.progress = keep;

var rej = this.rejected || [];
for (var j = 0; j < rej.length; j++) {
this.list.appendChild(this.itemEl(rej[j].file, -1, rej[j].text, null));
}

this.syncCount();
},

itemEl: function (file, index, note, pct) {
var self = this;
var rejected = index < 0;
var state = rejected ? 'error' : (pct === -1 ? 'done' : 'pending');

var li = document.createElement('li');
li.className = 'upload__item';
li.setAttribute('data-state', state);

var mark = document.createElement('span');
mark.className = 'upload__mark';
mark.appendChild(iconEl(state === 'done' ? 'done' : state === 'error' ? 'error' : 'pending'));

var sr = document.createElement('span');
sr.className = 'upload__status';
sr.textContent = STATE_TEXT[state] || '';
mark.appendChild(sr);

var name = document.createElement('span');
name.className = 'upload__name';
name.textContent = file.name || '—';
name.title = file.name || '';

var meta = document.createElement('span');

meta.className = 'upload__meta num';
meta.textContent = note || humanSize(file.size);

li.appendChild(mark);
li.appendChild(name);
li.appendChild(meta);

if (!rejected) {

if (pct != null && pct >= 0) {
var bar0 = document.createElement('span');
bar0.className = 'upload__progress';
li.appendChild(bar0);
this.paintProgress(bar0, pct);
}

var rm = document.createElement('button');
rm.className = 'upload__remove';
rm.type = 'button';
rm.setAttribute('aria-label', '移除 ' + (file.name || ''));
rm.appendChild(iconEl('remove'));
rm.addEventListener('click', function () { self.removeAt(index); });
li.appendChild(rm);

if (pct != null && pct >= 0) meta.textContent = '上传中 ' + Math.round(pct) + '%';
}

return li;
},

paintProgress: function (bar, pct) {

if (!bar || pct == null || pct < 0) return;
bar.innerHTML = '';
var track = document.createElement('span');
track.className = 'progress';
var fill = document.createElement('span');
fill.className = 'progress__bar';
fill.style.setProperty('--progress', Math.max(0, Math.min(100, pct)) + '%');
track.appendChild(fill);
bar.appendChild(track);
},

syncCount: function () {

this.root.setAttribute('data-count', String(currentFiles(this.input).length));
},

setState: function (s) {
if (s) this.root.setAttribute('data-state', s);
else this.root.removeAttribute('data-state');
},

setProgress: function (i, pct) {
var li = this.list.querySelectorAll('.upload__item')[i];
if (!li || li.getAttribute('data-state') === 'error') return;
var files = currentFiles(this.input);
var f = files[i];
var meta = li.querySelector('.upload__meta');

if (pct < 0 || pct >= 100) {
this.progress[i] = -1;
li.setAttribute('data-state', 'done');
var mark = li.querySelector('.upload__mark');
if (mark) {
mark.innerHTML = '';
mark.appendChild(iconEl('done'));
var sr = document.createElement('span');
sr.className = 'upload__status';
sr.textContent = STATE_TEXT.done;
mark.appendChild(sr);
}
if (meta && f) meta.textContent = humanSize(f.size);
var bar = li.querySelector('.upload__progress');
if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
return;
}

this.progress[i] = pct;
li.setAttribute('data-state', 'pending');
var bar = li.querySelector('.upload__progress');
if (!bar) {

bar = document.createElement('span');
bar.className = 'upload__progress';
var rmBtn = li.querySelector('.upload__remove');
li.insertBefore(bar, rmBtn || null);
}
this.paintProgress(bar, pct);

if (meta) meta.textContent = '上传中 ' + Math.round(pct) + '%';
},

removeAt: function (i) {
var files = currentFiles(this.input);
if (i < 0 || i >= files.length) return false;

var removed = files[i];
var rest = files.slice(0, i).concat(files.slice(i + 1));
if (!writeFiles(this.input, rest)) return false;

this.progress.splice(i, 1);

var li = this.list.querySelectorAll('.upload__item')[i];
if (li && li.parentNode) li.parentNode.removeChild(li);

this.rebind();
this.syncCount();
this.announce('已移除 ' + (removed.name || '文件') + '，还剩 ' + rest.length + ' 个');
flEmit(this.root, 'fl-upload', {
files: rest, added: 0, removed: removed, rejected: []
});
return true;
},

rebind: function () {

var self = this;
var items = this.list.querySelectorAll('.upload__item');
for (var i = 0; i < items.length; i++) {
var btn = items[i].querySelector('.upload__remove');
if (!btn) continue;
var fresh = btn.cloneNode(true);
btn.parentNode.replaceChild(fresh, btn);
(function (idx) {
fresh.addEventListener('click', function () { self.removeAt(idx); });
})(i);
}
},

announce: function (msg) {
if (!this.status) return;
var el = this.status;
if (this._announceTimer) global.clearTimeout(this._announceTimer);
el.textContent = '';
this._announceTimer = global.setTimeout(function () { el.textContent = msg; }, 60);
},

summary: function (added, rejected) {
var total = currentFiles(this.input).length;
var s = '已添加 ' + added + ' 个文件，共 ' + total + ' 个';
if (rejected) s += '；' + rejected + ' 个未通过校验';
return s;
},

destroy: function () {
this.input.removeEventListener('change', this._onChange);
if (this.dropzone) {
this.dropzone.removeEventListener('dragover', this._onDragOver);
this.dropzone.removeEventListener('dragenter', this._onDragEnter);
this.dropzone.removeEventListener('dragleave', this._onDragLeave);
this.dropzone.removeEventListener('drop', this._onDrop);
}
if (this._announceTimer) global.clearTimeout(this._announceTimer);
if (this.list) this.list.innerHTML = '';
this.root.removeAttribute('data-count');
this.root.removeAttribute('data-state');
if (this.root.uploadInstance === this) this.root.uploadInstance = null;
}
};

global.Upload = Upload;

function init() {
var nodes = document.querySelectorAll('[data-upload]');
for (var i = 0; i < nodes.length; i++) {

if (nodes[i].uploadInstance) continue;
try {
nodes[i].uploadInstance = new Upload(nodes[i]);
} catch (e) {

if (global.console && global.console.warn) {
global.console.warn('upload: 初始化失败，已跳过该元素 —— ' + (e && e.message));
}
}
}
}

if (typeof document === 'undefined') return;
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', init);
} else {
init();
}
})(typeof window !== 'undefined' ? window : globalThis);
