(function () {
'use strict';

function el(tag, cls, text) {
var n = document.createElement(tag);
if (cls) n.className = cls;
if (text !== undefined && text !== null) n.textContent = text;
return n;
}

function hasWebGL() {
try {
var c = document.createElement('canvas');
return !!(c.getContext('webgl2') || c.getContext('webgl') ||
c.getContext('experimental-webgl'));
} catch (e) { return false; }
}

function loadScript(src) {
return new Promise(function (resolve, reject) {
if (!src) { resolve(); return; }
var s = document.createElement('script');
s.src = src;
s.async = false;
s.onload = function () { resolve(); };
s.onerror = function () {
reject(new Error('脚本加载失败：' + src));
};
document.head.appendChild(s);
});
}

function fmtKB(bytes) {
return Math.round(bytes / 1024) + ' KB';
}

function Viewer(node) {
this.node = node;

var q = (location.search || '').replace(/^\?/, '');
function qp(k, dflt) {
var m = new RegExp('(?:^|&)' + k + '=([^&]*)').exec(q);
return m ? decodeURIComponent(m[1]) : dflt;
}
this.qOverride = !!q;
this.src = qp('mv', node.getAttribute('data-mv') || '');
this.h = parseInt(node.getAttribute('data-mv-height') || '320', 10);
this.threeSrc = qp('three', node.getAttribute('data-mv-three') || '');
this.gltfSrc = qp('gltf', node.getAttribute('data-mv-gltf') || '');
this.orbitSrc = qp('orbit', node.getAttribute('data-mv-orbit') || '');
this.instances = {};
this.state = 'idle';
this.build();
}

Viewer.prototype.build = function () {
var self = this;
var n = this.node;
n.classList.add('mv');

this.ui = el('div', 'mv__ui');
this.ui.appendChild(this.makeIdle());
n.appendChild(this.ui);

this.btn = el('button', 'mv__btn', '加载 3D 模型');
this.btn.type = 'button';
this.btn.addEventListener('click', function () { self.load(); });
this.ui.appendChild(this.btn);

this.hint = el('p', 'mv__hint');
this.hint.innerHTML = '模型 <code>' + (this.src.split('/').pop() || '—') +
'</code> 会<b>点击后才下载</b>，首屏不占流量。';
this.ui.appendChild(this.hint);

if (!hasWebGL()) {
this.fail('这台设备的浏览器不支持 WebGL，无法显示 3D 模型。');
this.btn.disabled = true;
}
};

Viewer.prototype.makeIdle = function () {
var box = el('div', 'mv__stage');
box.appendChild(el('div', 'mv__ph', '3D 模型'));
return box;
};

Viewer.prototype.fail = function (msg) {
if (this.timer) { clearTimeout(this.timer); this.timer = null; }
this.state = 'error';
this.ui.innerHTML = '';
var s = el('div', 'mv__stage mv__stage--err');
s.appendChild(el('div', 'mv__ph', '3D 模型'));
var p = el('p', 'mv__err', msg);
s.appendChild(p);
this.ui.appendChild(s);
if (this.btn) this.ui.appendChild(this.btn);
if (this.btn) {
this.btn.disabled = false;
this.btn.textContent = '重试';
}
};

Viewer.prototype.status = function (msg) {
if (this.statusNode) { this.statusNode.textContent = msg; }
};

Viewer.prototype.load = function () {
var self = this;
if (this.state === 'loading' || this.state === 'ok') return;
this.state = 'loading';

this.ui.innerHTML = '';
var stage = el('div', 'mv__stage');
this.statusNode = el('p', 'mv__status', '正在准备…');
stage.appendChild(this.statusNode);
this.ui.appendChild(stage);

var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
this.status('正在准备 3D 引擎…');
this.boot(null, t0, 0);

var self0 = this;
this.timer = setTimeout(function () {
if (self0.state === 'loading') {
self0.fail('加载超时（20 秒）。请检查：' +
'① 模型路径是否正确：'+ self0.src +
'② 服务器是否能返回该文件（404 时也应给明确提示）');
}
}, 20000);
};

Viewer.prototype.boot = function (buf, t0, bytes) {
var self = this;

loadScript(this.threeSrc)
.then(function () { return loadScript(self.gltfSrc); })
.then(function () { return loadScript(self.orbitSrc); })
.then(function () { self.initScene(buf, t0, bytes); })
.catch(function (err) {
self.fail('3D 引擎加载失败：' + (err && err.message ? err.message : err) +
'。请检查 three.js / GLTFLoader.js / OrbitControls.js 的路径。');
});
};

Viewer.prototype.initScene = function (buf, t0, bytes) {
var self = this;
if (typeof window.THREE === 'undefined') {
this.fail('three.js 没有正确加载（THREE 未定义）。请检查 data-mv-three 的路径。');
return;
}

var W = this.node.clientWidth || 320;
var H = this.h;

var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
camera.position.set(0, 0.6, 2.4);

var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(W, H);
renderer.setClearColor(0x000000, 0);
this.ui.innerHTML = '';
this.node.appendChild(renderer.domElement);
this.statusNode = null;

scene.add(new THREE.AmbientLight(0xffffff, 0.45));
var key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(1, 1.6, 1.4);
scene.add(key);
var rim = new THREE.DirectionalLight(0xffffff, 0.35);
rim.position.set(-1.2, 0.4, -1);
scene.add(rim);

var OrbitCtor = (window.THREE && window.THREE.OrbitControls) || window.OrbitControls;
var controls = null;
if (OrbitCtor) {
controls = new OrbitCtor(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 1.1;
controls.maxDistance = 4.5;
controls.target.set(0, 0.35, 0);
}

var GLCtor = (window.THREE && window.THREE.GLTFLoader) || window.GLTFLoader;
if (!GLCtor) {
this.fail('GLTFLoader 没有正确加载（THREE.GLTFLoader 未定义）。请检查 data-mv-gltf 的路径。');
return;
}

var loader = new GLCtor();

var self1 = this;
var xhr = new XMLHttpRequest();
xhr.responseType = 'arraybuffer';
xhr.open('GET', this.src, true);
xhr.onprogress = function (e) {
if (e.lengthComputable && e.total) {
self1.lastBytes = e.total;
self1.status('正在下载模型 ' + Math.round(e.loaded / e.total * 100) + '%');
}
};
xhr.onload = function () {
if (xhr.status >= 400) {
self1.fail('模型不存在（HTTP ' + xhr.status + '）：' + self1.src);
return;
}
var buf = xhr.response;

if (!buf || buf.byteLength < 12) {
self1.fail('模型文件是空的或损坏了：' + self1.src);
return;
}

var b0 = new Uint8Array(buf, 0, 4);
var head = String.fromCharCode(b0[0], b0[1], b0[2], b0[3]);
if (head !== 'glTF') {
self1.fail('这不是 glb 文件（缺少 glTF 标识，收到的是「' + head + '」）。' +
'服务器可能返回了 HTML 错误页。');
return;
}
doLoad(buf);
};
xhr.onerror = function () { self1.fail('无法访问模型：' + self1.src); };
xhr.send();

function doLoad(buf) {
loader.parse(buf, '', function (gltf) {
var model = gltf.scene;

var box = new THREE.Box3().setFromObject(model);
var size = box.getSize(new THREE.Vector3());
var center = box.getCenter(new THREE.Vector3());
model.position.sub(center);
var maxDim = Math.max(size.x, size.y, size.z) || 1;
model.scale.setScalar(1.6 / maxDim);
box.setFromObject(model);
var c2 = box.getCenter(new THREE.Vector3());
model.position.sub(new THREE.Vector3(c2.x, box.min.y + (box.max.y - box.min.y) * 0.45, c2.z));
scene.add(model);

if (self.timer) { clearTimeout(self.timer); self.timer = null; }
self.state = 'ok';
self.instances = { scene: scene, camera: camera, renderer: renderer,
model: model, controls: controls };

var last = 0;
function loop(t) {
self.raf = requestAnimationFrame(loop);

if (document.hidden) return;
if (controls) controls.update();
renderer.render(scene, camera);
last = t;
}
self.raf = requestAnimationFrame(loop);

self.ui.innerHTML = '';
var cap = el('p', 'mv__cap');
var dt = Math.round(((window.performance && performance.now) ? performance.now() : Date.now()) - t0);
cap.innerHTML = '模型 <b>' + fmtKB(bytes || self.lastBytes || 0) + '</b> · 引擎就绪耗时 <b>' + dt + 'ms</b>' +
(controls ? ' · 拖动可旋转，滚轮/双指可缩放' : ' · 未加载控制器，无法拖动');
self.node.appendChild(cap);
},

function (evt) {
if (evt && evt.lengthComputable && evt.total) {
self.lastBytes = evt.total;
self.status('正在下载模型 ' + Math.round(evt.loaded / evt.total * 100) + '%');
}
},

function (err) {
var msg = (err && err.message) ? err.message : (err || '未知错误');

if (msg.indexOf('fetch') > -1 || msg.indexOf('Failed') > -1) {
self.fail('模型加载失败：服务器的 Content-Security-Policy 缺少 blob:，' +
'内嵌贴图被浏览器拦下了。需要在 CSP 的 img-src 与 connect-src 里加上 blob:。');
} else {
self.fail('模型加载失败：' + msg + '。请确认 ' + self.src + ' 已部署且可访问。');
}
});
}
};

var ModelViewer = {

update: function (root) {
var list = (root || document).querySelectorAll('[data-mv]');
for (var i = 0; i < list.length; i++) {
if (list[i].__mv) continue;
list[i].__mv = new Viewer(list[i]);
}
},

refresh: function (root) {
var list = (root || document).querySelectorAll('[data-mv]');
for (var i = 0; i < list.length; i++) {
var v = list[i].__mv;
if (!v || v.state !== 'ok') continue;
if (v.raf) cancelAnimationFrame(v.raf);
if (v.instances && v.instances.renderer) {
try { v.instances.renderer.dispose(); } catch (e) {}
}
list[i].innerHTML = '';
list[i].__mv = new Viewer(list[i]);
}
},
};

if (typeof window !== 'undefined') window.ModelViewer = ModelViewer;

if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', function () { ModelViewer.update(); });
} else {
ModelViewer.update();
}
})();
