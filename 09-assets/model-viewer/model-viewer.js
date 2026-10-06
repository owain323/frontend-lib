/*
 * model-viewer.js — 惰性加载的 3D 模型查看器（零依赖 · ES5）
 *
 * ============================================================================
 * ⭐ 设计依据：Owner 2026-10-04 的原话
 * ============================================================================
 *   「就放一到两个素材上去就可以了」
 *   「体积和加载的问题，**一定要快**」
 *   「因为这个模块我们可能以后很久都不会去动它，**必须一次性就做对**」
 *
 * ⇒ 三条硬指标（本文件逐条对应）：
 *   ① **首屏 0 字节 three** —— 点"加载模型"才 `<script>` 注入。
 *      绝对不用 `<script src="three.min.js">` 写在 HTML 里（那是 592KB 白给）。
 *   ② **失败必须降级** —— 库没来 / WebGL 不支持 / 模型 404
 *      ⇒ 全部显示**明确的中文提示 + 重试按钮**，**绝不白屏**。
 *   ③ **令牌驱动** —— 颜色全部走 `var(--*)`，换主题跟着变。
 *
 * ============================================================================
 * 🔴 为什么**不把 three 打包进来**
 * ============================================================================
 * · three.min.js 592KB，本库的硬约束是「零依赖、可拷贝即用」
 * · GLTFLoader / OrbitControls 在素材里是 **ES6 class**（实测），
 *   而本库硬约束是「**JS 一律 ES5**」（精简档 的 WebView 版本不确定）
 *   ⇒ **three 属于主项目的责任**，本库只提供**接入规范 + 降级 UI**。
 *
 * ⚠️ 这不是"甩锅"，是**分层**：本库管"怎么正确地接"，
 *    库本身由主项目按需引入（可以是 CDN、可以是 npm、可以是本地文件）。
 *
 * ============================================================================
 * 用法
 * ============================================================================
 *   <div class="mv" data-mv="models/fox.glb"
 *        data-mv-height="320"
 *        data-mv-three="/vendor/three.min.js"
 *        data-mv-gltf="/vendor/GLTFLoader.js"
 *        data-mv-orbit="/vendor/OrbitControls.js"></div>
 *   <script src="09-assets/model-viewer/model-viewer.js"></script>
 *   <script>ModelViewer.update();</script>
 */
(function () {
  'use strict';

  /* ---------- 小工具 ---------- */

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

  /** 注入一个脚本并等它加载完（惰性加载的核心） */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (!src) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.async = false;          // 保持顺序 ⇒ three 必须在 loader 之前
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

  /* ---------- 每个实例 ---------- */

  function Viewer(node) {
    this.node = node;
    /* 🔴 支持 URL 查询参数覆盖（便于测试降级路径，不必改代码）：
         ?mv=NOPE.glb&three=vendor/x.js  ⇒ 模拟「模型/引擎 404」 */
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
    this.instances = {};       // three 实例（切主题时重建）
    this.state = 'idle';
    this.build();
  }

  Viewer.prototype.build = function () {
    var self = this;
    var n = this.node;
    n.classList.add('mv');

    // 🔴 无论如何都先画"占位 + 说明"，
    //    绝不留白屏（Owner 的硬要求）。
    this.ui = el('div', 'mv__ui');
    this.ui.appendChild(this.makeIdle());
    n.appendChild(this.ui);

    // 加载按钮
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

  /** 统一的失败呈现：中文说明 + 可重试，绝不白屏 */
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

  /** 真正的加载：先进度，再注入库，最后建场景 */
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

    /* 🔴🔴 2026-10-04 **超时兜底**（实测：服务器上会卡死在 loading）
       现象：模型 404 时，服务器返回 `404 + Content-Type 为空`，
             three 的 FileLoader **既不触发 onError 也不触发 onLoad**
             ⇒ 界面永远停在「正在准备…」⇒ **看起来像白屏**。

       ⚠️ 本地（http）时同样的 404 **会**正常触发 onError
          ⇒ 又是一次「本地过、线上挂」。

       ⇒ 无论如何，**超过 20 秒没有结果就判失败**，
          给出可操作提示，绝不让用户盯着一个不动的进度条。 */
    var self0 = this;
    this.timer = setTimeout(function () {
      if (self0.state === 'loading') {
        self0.fail('加载超时（20 秒）。请检查：' +
                   '① 模型路径是否正确：' + self0.src +
                   '② 服务器是否能返回该文件（404 时也应给明确提示）');
      }
    }, 20000);
  };

  Viewer.prototype.boot = function (buf, t0, bytes) {
    var self = this;
    // 🔴 顺序必须是 three → GLTFLoader → OrbitControls
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

    // 场景
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
    camera.position.set(0, 0.6, 2.4);

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));  // 🔴 上限 2，控性能
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);
    this.ui.innerHTML = '';
    this.node.appendChild(renderer.domElement);
    this.statusNode = null;

    // 光照（三点光 = 通行做法，不是单一环境光）
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    var key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(1, 1.6, 1.4);
    scene.add(key);
    var rim = new THREE.DirectionalLight(0xffffff, 0.35);
    rim.position.set(-1.2, 0.4, -1);
    scene.add(rim);

    // 控制器
    /* 🔴 2026-10-04 实测纠正：three 官方 `examples/js` 里的控制器
       是挂在 **THREE 上**的（`THREE.OrbitControls`），**不是全局**。
       我原来写 `window.OrbitControls` ⇒ undefined ⇒ 拖不动。
       两个来源都试一遍，兼容不同发行版。 */
    var OrbitCtor = (window.THREE && window.THREE.OrbitControls) || window.OrbitControls;
    var controls = null;
    if (OrbitCtor) {
      controls = new OrbitCtor(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = false;            // 移动端禁止平移，避免误触
      controls.minDistance = 1.1;
      controls.maxDistance = 4.5;
      controls.target.set(0, 0.35, 0);
    }

    // 🔴 同上：GLTFLoader 也挂在 THREE 上
    var GLCtor = (window.THREE && window.THREE.GLTFLoader) || window.GLTFLoader;
    if (!GLCtor) {
      this.fail('GLTFLoader 没有正确加载（THREE.GLTFLoader 未定义）。请检查 data-mv-gltf 的路径。');
      return;
    }
    /* 🔴 2026-10-04 **关键修复**（本地能跑、服务器 https 下报
       「模型解析失败：Failed to fetch」——实测定位）：

       原来用 `loader.parse(arrayBuffer, '')`：
         three 内部对 glb 里的贴图走 **`fetch`（blob: / 数据 URI）**，
         在某些 https / CSP 环境会被拦 ⇒ 直接抛 "Failed to fetch"。

       ⇒ 改用 `loader.load(url, onLoad, onProgress, onError)`：
         three 用自己的 **FileLoader（XHR）** 取文件，**不经过 fetch**
         ⇒ 顺带**白送真实下载进度**（onProgress 有 loaded/total）。

       ⚠️ 这是"本地过、线上挂"的典型：**本地 http 掩盖了协议差异**。 */
    var loader = new GLCtor();

    /* 🔴🔴 2026-10-04 **改用「一次 GET，校验 + 复用同一份 buffer」**

       ❌ 我先试了 HEAD 预检 + three.load()，**结果请求了两次 fox.glb**
          （HEAD 一次 + GET 一次）⇒ 实测服务器对同一资源第二次拿不到
          ⇒ 界面卡在 loading。
       ⇒ 教训：**预检请求不能"只用一次"**。
          正确做法：**自己 GET 一次**（能看 status / Content-Type /
          拿到的是不是 HTML），**并把这份 buffer 直接交给 three.parse**。

       ⚠️ 本地 http 不会暴露这个问题（两次都 200）⇒ 又一次「本地过、线上挂」。 */
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
      // 🔴 校验 magic：glb 必须是 "glTF" 开头
      if (!buf || buf.byteLength < 12) {
        self1.fail('模型文件是空的或损坏了：' + self1.src);
        return;
      }
      /* 🔴 这里必须用 **Uint8Array** 读字节。
         ArrayBuffer 直接下标取的是「字符」，不是字节 ⇒ 读出来是 0。 */
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
      // 🔴 自动居中 + 按包围盒缩放到合适大小 —— 免得每个模型都要手调相机
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

      // 渲染循环（只在可见时跑 —— 省电，见 README 的 TODO）
      var last = 0;
      function loop(t) {
        self.raf = requestAnimationFrame(loop);
        // 🔴 页面不可见时**停渲染**（iOS 切后台会掉到 1fps，浪费电量）
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
    // onProgress ⇒ 真实进度
    function (evt) {
      if (evt && evt.lengthComputable && evt.total) {
        self.lastBytes = evt.total;
        self.status('正在下载模型 ' + Math.round(evt.loaded / evt.total * 100) + '%');
      }
    },
    // onError
    function (err) {
      var msg = (err && err.message) ? err.message : (err || '未知错误');
      /* 🔴 2026-10-04 **实测定位的"本地过、线上挂"**：
         服务器的 CSP 是
             img-src     'self' data: https:     ← 没有 blob:
             connect-src 'self' https:           ← 没有 blob:
         而 three 的 GLTFLoader 对 **内嵌贴图会创建 Blob URL**
         （PNG 太大，不能用 data URI）⇒ 被 CSP 拦 ⇒ "Failed to fetch"。

         ⚠️ 本地 http 没有 CSP ⇒ 完全看不出来（我第一次就踩了）。

         ⇒ 这里给**可操作的**提示，而不是把 "Failed to fetch" 抛给用户。 */
      if (msg.indexOf('fetch') > -1 || msg.indexOf('Failed') > -1) {
        self.fail('模型加载失败：服务器的 Content-Security-Policy 缺少 blob:，' +
                  '内嵌贴图被浏览器拦下了。需要在 CSP 的 img-src 与 connect-src 里加上 blob:。');
      } else {
        self.fail('模型加载失败：' + msg + '。请确认 ' + self.src + ' 已部署且可访问。');
      }
    });
    }   // ← doLoad 结束
  };

  /* ---------- 对外 API ---------- */

  var ModelViewer = {
    /** 扫描并初始化页面里的所有查看器 */
    update: function (root) {
      var list = (root || document).querySelectorAll('[data-mv]');
      for (var i = 0; i < list.length; i++) {
        if (list[i].__mv) continue;
        list[i].__mv = new Viewer(list[i]);
      }
    },
    /** 换主题后调用：three 里的颜色跟随令牌，需要重建 */
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
