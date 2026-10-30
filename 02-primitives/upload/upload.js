/**
 * upload.js — 文件上传的增强层（拖放 / 多文件 / 校验 / 移除）
 *
 * ==========================================================================
 * 🔴 真值方向：`<input>.files` 是唯一真值，文件列表是它的**镜像**
 * --------------------------------------------------------------------------
 *   拖放不是"第二条上传通道"。它做三件事：
 *     ① 把拖入的 File 塞进 `input.files`（经 `DataTransfer`）
 *     ② 重渲染列表
 *     ③ 派发 `fl-upload`
 *   于是 `<form>` 序列化、`FormData`、原生 `accept` 语义全部不用重写。
 *
 *   ⚠️ 反过来做（自己维护一个 files 数组，提交时再拼）是这类组件最常见的错：
 *     两条通道的校验规则迟早不一致，而且**表单提交时文件会丢** ——
 *     因为浏览器只认 `input.files`。
 *
 *   ⇒ 由此推出一条必须接受的语义：**再次选择/拖入会替换整个列表**，
 *     与原生 `<input type=file multiple>` 完全一致。不做"追加"，
 *     否则同一个控件里存在两种累加规则。
 *
 * ==========================================================================
 * 🔴 校验只有一份实现（`_validate`），两条入口都调它
 * --------------------------------------------------------------------------
 *   "拖放"和"原生选择"是两个入口，但校验必须是**同一段代码**。
 *   写成两遍的后果不是"难看"，是它们会**漂移**：某天给拖放加了大小限制，
 *   忘了给原生选择加 —— 于是同一页面上，拖进去的文件被拒、点选进去的通过。
 *   这种 bug 只有用户会碰到，测试永远碰不到（两条路各自都是对的）。
 *
 * ==========================================================================
 * 🔴 `DataTransfer` 不存在时，拖放必须**明确拒绝**，不能装作成功
 * --------------------------------------------------------------------------
 *   老 Safari（< 14.1）没有 `new DataTransfer()`，于是 `input.files` **不可写**。
 *   此时如果照样渲染列表、照样派发事件，用户会看到"文件进去了"，
 *   点提交却什么都没有 —— 而且没有任何报错。
 *   ⇒ 本实现直接提示"当前浏览器不支持拖放，请点选择文件"并**不接收**。
 *     少一个功能，但不存在假成功。
 *
 * ==========================================================================
 * 无依赖 · ES5（不用 let/const/箭头函数/模板串）
 * ==========================================================================
 */
(function (global) {
  'use strict';

  /* ==== BEHAVIOR INJECT BEGIN: emit ==== */
  var flEmit = function (el, name, detail) {
    if (!el || !el.dispatchEvent) return null;
    var type = name.indexOf('fl-') === 0 ? name : 'fl-' + name;
    var ev = null;
    /* 老 WebView 没有 CustomEvent 构造函数 ⇒ 兜底走 createEvent（理由见文件头）*/
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
  /* ==== BEHAVIOR INJECT END: emit ==== */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* 图标路径（viewBox 0 0 16 16，纯 stroke，无 fill）
     ⭐ 为什么用内联 SVG 而不是 CSS `mask` + `background-color`：
        强制色模式下 background 被抹成 Canvas ⇒ 白底白图形，图标整个消失。
        `stroke="currentColor"` 跟着文字色走，而文字色必然与背景不同 ⇒ 一定可见。
        （0.17.0 的六类缺陷里有两类正是这个模式：table 排序箭头、input 错误图标。） */
  var ICON = {
    pending: 'M8 1.7a6.3 6.3 0 1 0 0 12.6A6.3 6.3 0 0 0 8 1.7zM8 4.6V8l2.3 1.5',
    done: 'M3.3 8.4l3.1 3.1 6.3-6.9',
    error: 'M8 1.7a6.3 6.3 0 1 0 0 12.6A6.3 6.3 0 0 0 8 1.7zM8 4.9v3.4M8 11.1v.5',
    remove: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6'
  };

  var STATE_TEXT = { pending: '待上传', done: '已完成', error: '失败' };

  /* ---------------------------------------------------------------- 工具 */

  /**
   * 人类可读的文件大小。
   * 10KB / 10MB 以下给一位小数（"3.4 KB"），以上取整；
   * 整数结果去掉多余的 ".0"（"1 KB" 而不是 "1.0 KB" —— 后者看起来像精度丢了）。
   */
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

  /**
   * `accept` 的第二道校验。
   * 🔴 为什么必须有：`accept` 只约束**文件选择器**，拖放完全绕过它。
   *    只写 `accept=".pdf"` 而拖入一个 .exe 时，浏览器不会拦 —— 这是规范行为。
   */
  function matchesAccept(file, accept) {
    if (!accept) return true;
    var parts = String(accept).split(',');
    var name = (file.name || '').toLowerCase();
    var type = (file.type || '').toLowerCase();
    for (var i = 0; i < parts.length; i++) {
      var p = trim(parts[i]).toLowerCase();
      if (!p) continue;
      if (p.charAt(0) === '.') {
        /* 扩展名必须比到末尾，否则 ".pdf" 会匹配上 "report.pdf.exe" */
        if (name.length > p.length && name.slice(-p.length) === p) return true;
      } else if (p.indexOf('/*') > 0) {
        if (type.indexOf(p.slice(0, p.indexOf('/')) + '/') === 0) return true;
      } else if (type === p) {
        return true;
      }
    }
    return false;
  }

  /** 读当前 `input.files` 为普通数组（`FileList` 不能被 splice）。 */
  function currentFiles(input) {
    var out = [];
    var fl = input && input.files;
    if (!fl) return out;
    for (var i = 0; i < fl.length; i++) out.push(fl[i]);
    return out;
  }

  /**
   * 把数组写回 `input.files`。
   * @returns {boolean} 是否真的写进去了 —— 调用方必须检查，不能假设成功。
   */
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

  /* ---------------------------------------------------------------- 主体 */

  /**
   * @param {Element} root  `.upload` 元素
   * @param {Object} [opts]
   * @param {number} [opts.maxSize]   单文件上限（字节），0 = 不限
   * @param {number} [opts.maxFiles]  文件数上限，0 = 不限
   */
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

    /* 进度是**唯一的非镜像状态**：它不在 `input.files` 里（文件本身没有进度）。
       单独存，重建列表时按索引恢复，否则拖一次文件进度就全丢了。
       语义：null = 待上传（无进度条）/ 0–99 = 上传中 / -1 = 已完成 */
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

    /* 初始渲染：HTML 里预置了已选文件（服务端回显场景）时把它画出来 */
    this.render();
  }

  Upload.prototype = {
    constructor: Upload,

    /* ================================================================ 拖放 */

    _handleDragOver: function (e) {
      /* 不 preventDefault ⇒ 浏览器认为"这个区域不接受拖放" ⇒ 光标变成禁放，
         且 drop 永远不会触发。这是「拖放没反应」的第一大原因，而且完全不报错。 */
      e.preventDefault();
      if (e.dataTransfer) {
        /* 只要"复制"语义：默认在部分系统上显示"移动"，暗示原文件会被拿走 */
        try { e.dataTransfer.dropEffect = 'copy'; } catch (err) { /* 只读环境 */ }
      }
    },

    _handleDragEnter: function (e) {
      e.preventDefault();
      this._dragDepth++;
      this.setState('dragover');
    },

    _handleDragLeave: function (e) {
      e.preventDefault();
      /* dragenter/dragleave 必须**配对计数**：指针移到子元素（svg / span）上时，
         浏览器先发 dragleave(父) 再发 dragenter(子)。直接按事件切状态会闪。 */
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

      /* 🔴 目录：拖一个文件夹进来时 `files` 里会有一个 size=0 的条目，
         直接收下就得到"名字对但内容为空"的文件，上传后才发现。
         ⇒ 用 `webkitGetAsEntry` 判目录并明确拒绝。 */
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

    /* ================================================================ 校验 */

    /**
     * **唯一的校验实现**。拖放与原生选择都调它。
     * @returns {{keep: File[], rejected: Array}}
     */
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

    /* ================================================================ 接收 */

    /**
     * 收下一批文件（= 拖放入口，也是公开 API）。
     *
     * 原生选择走 `_handleChange`，两者最终都落到 `_validate` + `render`。
     * 公开它是为了让"服务端回显 / 从别的控件导入"这类程序性设置
     * 复用**同一条**校验路径，而不是在外面自己拼 `input.files`。
     *
     * @param {File[]} incoming
     * @param {number} [dirCount] 被跳过的目录数（仅拖放路径会传）
     * @returns {boolean} 是否至少收下了一个文件
     */
    add: function (incoming, dirCount) {
      var r = this._validate(incoming);

      /* 目录不是"错误文件"，是"不支持拖文件夹" —— 单独一句话，
         否则用户会以为是自己文件夹里的内容有问题 */
      if (dirCount) {
        r.rejected.push({
          file: { name: dirCount + ' 个文件夹', size: 0 },
          reason: 'dir', text: '请拖入文件，不支持文件夹'
        });
      }

      if (!r.keep.length) {
        /* 一个都没收：仍要把拒收项画出来，否则用户"拖了没反应" */
        this.rejected = r.rejected;
        this.render();
        this.announce(r.rejected.length ? '未添加任何文件：' + r.rejected[0].text : '未添加任何文件');
        flEmit(this.root, 'fl-upload', {
          files: currentFiles(this.input), added: 0, rejected: r.rejected
        });
        return false;
      }

      if (!writeFiles(this.input, r.keep)) {
        /* 见文件头：宁可明说不可用，也不能装作收下了 */
        this.rejected = [{ file: r.keep[0], reason: 'unsupported',
          text: '当前浏览器不支持拖放，请点「选择文件」' }];
        this.render();
        this.announce('当前浏览器不支持拖放，请点选择文件');
        return false;
      }

      /* 换了文件集合 ⇒ 旧进度全部作废。不清会让新文件直接显示上一批的 42%。 */
      this.progress = [];
      this.rejected = r.rejected;
      this.render();
      this.announce(this.summary(r.keep.length, r.rejected.length));
      flEmit(this.root, 'fl-upload', {
        files: currentFiles(this.input), added: r.keep.length, rejected: r.rejected
      });

      /* 🔴 程序改 `input.files` **不会**触发原生 `change`（规范如此）。
         这里**不**手动补发一个假 change —— 那会让本组件的 change 监听再次触发，
         形成"拖一次渲染两遍"的循环。契约：程序性变更只派发 `fl-upload`。 */
      return true;
    },

    /** 原生选择器的 change。 */
    _handleChange: function () {
      var files = currentFiles(this.input);
      var r = this._validate(files);

      /* 超限/类型不符的文件不能留在 input 里（会真的被提交）⇒ 剔除后写回 */
      if (r.rejected.length) writeFiles(this.input, r.keep);

      this.progress = [];
      this.rejected = r.rejected;
      this.render();
      this.announce(this.summary(r.keep.length, r.rejected.length));
      flEmit(this.root, 'fl-upload', {
        files: currentFiles(this.input), added: r.keep.length, rejected: r.rejected
      });
    },

    /* ================================================================ 渲染 */

    /** 全量重渲染。只在"文件集合变了"时调用；单个移除走局部删除（见 removeAt）。 */
    render: function () {
      var files = currentFiles(this.input);
      var keep = [];

      /* `innerHTML=''` 在这里安全：列表内容随后全部由 createElement + textContent
         重建，任何用户提供的字符串（文件名）都不会被当作 HTML 解析。 */
      this.list.innerHTML = '';

      for (var i = 0; i < files.length; i++) {
        var pct = this.progress[i];
        keep.push(pct === undefined ? null : pct);
        this.list.appendChild(this.itemEl(files[i], i, null, pct));
      }
      this.progress = keep;

      /* 拒收项追加在同一张表里（视觉同构，靠 data-state="error" 区分）。
         ⚠️ 不能在 render 开头清空 `this.rejected` —— 它是**本次渲染的输入**。 */
      var rej = this.rejected || [];
      for (var j = 0; j < rej.length; j++) {
        this.list.appendChild(this.itemEl(rej[j].file, -1, rej[j].text, null));
      }

      this.syncCount();
    },

    /**
     * @param {File} file
     * @param {number} index  -1 表示拒收项（不可移除、无进度）
     * @param {string|null} note 覆盖 meta 文本（拒收原因）
     * @param {number|null} pct   进度；null = 无进度条
     */
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
      /* 状态词给读屏（图标是 aria-hidden）—— 也是色盲用户的第二条线索 */
      var sr = document.createElement('span');
      sr.className = 'upload__status';
      sr.textContent = STATE_TEXT[state] || '';
      mark.appendChild(sr);

      var name = document.createElement('span');
      name.className = 'upload__name';
      name.textContent = file.name || '—';
      name.title = file.name || '';           /* 被截断时悬停看全名 */

      var meta = document.createElement('span');
      /* `num` 是本库统一的数字排印类（typography.css 的 .num：tabular-nums + tnum）。
         🔴 用类而不是在 upload.css 里写 font-variant-numeric：
            那会让"数字要等宽"出现第二份定义，numeric-gate 判这一条。
            没引 typography.css 时 `num` 无效果 —— 退化成普通数字，不是错。 */
      meta.className = 'upload__meta num';
      meta.textContent = note || humanSize(file.size);

      li.appendChild(mark);
      li.appendChild(name);
      li.appendChild(meta);

      if (!rejected) {
        /* 进度槽与移除按钮只属于"真的在 input 里"的文件。
           🔴 进度槽**按需插入**，不是常驻空盒子：
              `.upload__progress` 显式跨满整行 ⇒ 它一存在，grid 就多出一条隐式行。
              常驻的话"待上传"的项会比"被拒"的项高 12px，列表看起来像有的行空着。
              （0.17.0 实拍：54px vs 42px，一眼能看出不齐。） */
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
      /* 复用 progress 组件（demo 会同时引入 progress.css）。
         没引入时这里退化成一条空 span —— 不报错，也不会把布局弄崩。 */
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
      /* 同步根上的 data-count：调用方用它做"没选文件就不让提交"这类判断。
         空列表本身由 CSS `:empty` 收起，不需要额外类。 */
      this.root.setAttribute('data-count', String(currentFiles(this.input).length));
    },

    setState: function (s) {
      if (s) this.root.setAttribute('data-state', s);
      else this.root.removeAttribute('data-state');
    },

    /* ================================================================ 进度 */

    /**
     * 设置第 i 个文件的上传进度。
     * @param {number} i   索引
     * @param {number} pct 0–100；`-1` 或 `>=100` 表示完成（去掉进度条）
     */
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
        /* 第一次出现进度时才建槽（无进度时不留空行，见 itemEl 里的说明） */
        bar = document.createElement('span');
        bar.className = 'upload__progress';
        var rmBtn = li.querySelector('.upload__remove');
        li.insertBefore(bar, rmBtn || null);
      }
      this.paintProgress(bar, pct);
      /* 进度也写成文本：**信息不能只在图形里**，否则强制色/色盲下丢失 */
      if (meta) meta.textContent = '上传中 ' + Math.round(pct) + '%';
    },

    /* ================================================================ 移除 */

    removeAt: function (i) {
      var files = currentFiles(this.input);
      if (i < 0 || i >= files.length) return false;

      var removed = files[i];
      var rest = files.slice(0, i).concat(files.slice(i + 1));
      if (!writeFiles(this.input, rest)) return false;   /* 不可写 ⇒ 不假成功 */

      this.progress.splice(i, 1);

      /* 🔴 只删这一个节点、不整表重建：重建会把焦点从"移除"按钮上打掉，
         键盘用户连按删除时每删一个就丢一次焦点，得重新 Tab 回来。 */
      var li = this.list.querySelectorAll('.upload__item')[i];
      if (li && li.parentNode) li.parentNode.removeChild(li);

      this.rebind();      /* 索引整体前移，旧闭包里的 i 已过期 */
      this.syncCount();
      this.announce('已移除 ' + (removed.name || '文件') + '，还剩 ' + rest.length + ' 个');
      flEmit(this.root, 'fl-upload', {
        files: rest, added: 0, removed: removed, rejected: []
      });
      return true;
    },

    rebind: function () {
      /* 移除后索引整体前移 ⇒ 必须重绑，否则"删掉第 1 个之后再点第 2 个"
         会去删原来第 3 个。这是列表组件最经典的 off-by-one。
         用 cloneNode 换掉旧节点：addEventListener 无法移除匿名监听。 */
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

    /* ================================================================ 播报 */

    /**
     * `role="status"` 播报。
     * ⚠️ 同一句话连续播两次时读屏**不会**再读（内容没变）⇒ 先清空、隔一个 tick 再写。
     *    否则"移除最后一个文件"这类重复操作第二次是静默的。
     */
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

    /* ================================================================ 销毁 */

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

  /* ---------------------------------------------------------------- 导出 */

  global.Upload = Upload;          /* construct 形态：new Upload(root, opts) */

  function init() {
    var nodes = document.querySelectorAll('[data-upload]');
    for (var i = 0; i < nodes.length; i++) {
      /* 🔴 幂等：SPA 路由切回、HMR、重复引入都会二次执行 init。
         不加守卫的后果是静默的 —— 两个实例各挂一个 change 监听，
         一次选择把列表渲染两遍（第二遍把第一遍的进度覆盖成空）。 */
      if (nodes[i].uploadInstance) continue;
      try {
        nodes[i].uploadInstance = new Upload(nodes[i]);
      } catch (e) {
        /* 缺 .upload__input 是**作者错误**，但一个坏标记不该拖垮整页其余控件 */
        if (global.console && global.console.warn) {
          global.console.warn('upload: 初始化失败，已跳过该元素 —— ' + (e && e.message));
        }
      }
    }
  }

  // @autoinit: [data-upload] —— 自动初始化；与 API.md「自动初始化」表由 autoinit-gate 双向校验
  // ⚠️ 无 DOM 环境（SSR / 构建期 / Node 里 import）不自动初始化。
  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
