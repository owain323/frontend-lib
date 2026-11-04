/**
 * select.js — 自建下拉选择（E1 /
 *
 * 依据：APG Select-Only Combobox 模式
 * ============================================================================
 * ⭐ 四条最容易漏的键盘契约（逐条实现并在注释里标出）：
 *
 * ① **打开后焦点落在"选中项"**（不是第一项，也不是按钮）
 *    ⇒ 用户按 Alt+↓ 打开后，直接 Enter 就能确认当前值。
 *    ⇒ 若落在第一项，一开就选错了 —— 这是自建 select 最常见的错。
 *
 * ② **↑↓ 循环 · Home/End 首末 · Enter/Space 选中并关闭**
 *
 * ③ **Esc 关闭并把焦点还给按钮**（不是"选中项"）
 *
 * ④ **类型搜索**：连续打字跳到匹配项（原生 select 有，必须做）
 *    ⇒ 缓冲 500ms，超时清空（否则 "abc" 永远搜不到）。
 *
 * 无依赖 · ES5
 */
(function (global) {
  'use strict';

  /* ==== BEHAVIOR INJECT BEGIN: dismissable ==== */
  var flDismissable = function (opts) {
    var opt = opts || {};
    var escOn = opt.escOn || [];
    var inside = opt.inside || [];
    var outside = opt.outside !== false;
    var when = opt.when || function () { return true; };
    var onDismiss = opt.onDismiss || function () {};

    var shared = window.__flDismiss || (window.__flDismiss = { stack: [], bound: false });

    function isInside(node) {
      if (!node) return false;
      for (var i = 0; i < inside.length; i++) {
        var el = inside[i];
        if (!el || !el.contains) continue;
        if (el === node || el.contains(node)) return true;
      }
      return false;
    }

    function onKey(e) {
      if (!when()) return;
      var k = e.key;
      if (k !== 'Escape' && k !== 'Esc' && e.keyCode !== 27) return;
      /* 先问 onDismiss，它返回 false 就不干预（分级 Esc，见文件头 ⑤） */
      var closed = onDismiss(e, 'esc');
      if (closed === false) return;
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
    }

    function onDocClick(e) {
      var top = null;
      for (var i = shared.stack.length - 1; i >= 0; i--) {
        if (shared.stack[i].when()) { top = shared.stack[i]; break; }
      }
      if (!top || top.isInside(e.target)) return;
      top.onDismiss(e, 'outside');
    }

    var rec = { when: when, isInside: isInside, onDismiss: onDismiss };

    for (var j = 0; j < escOn.length; j++) {
      if (escOn[j]) escOn[j].addEventListener('keydown', onKey);
    }
    /* 只有"点外部要关"的层才进栈：栈是给 onDocClick 挑最内层用的，
       模态层不该被这条规则选中（见文件头 ④）。
       ⚠️ Esc 不依赖栈（它挂在元素上），所以不进栈不影响 Esc。 */
    if (outside) shared.stack.push(rec);
    if (!shared.bound) {
      shared.bound = true;
      document.addEventListener('click', onDocClick, true);
    }

    return {
      destroy: function () {
        for (var j = 0; j < escOn.length; j++) {
          if (escOn[j]) escOn[j].removeEventListener('keydown', onKey);
        }
        var k = shared.stack.indexOf(rec);
        if (k >= 0) shared.stack.splice(k, 1);
      },
    };
  };
  /* ==== BEHAVIOR INJECT END: dismissable ==== */
  /* ==== BEHAVIOR INJECT BEGIN: focus-return ==== */
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
        /* ⚠️ 见文档 ②：不判 contains 的话，元素被移除后 focus() 不报错
           但焦点不动 ⇒ 用户以为还回去了，其实掉在 body 上。 */
        if (!target || !document.contains(target)) target = opt.fallback || null;
        if (!target) { saved = null; return false; }
        try {
          target.focus();
        } catch (e) {
          saved = null;
          return false;
        }
        var ok = document.activeElement === target;
        saved = null;   /* 见文档 ③ */
        return ok;
      },

      target: function () { return saved; },
      clear: function () { saved = null; },
    };
  };
  /* ==== BEHAVIOR INJECT END: focus-return ==== */
  /* ==== BEHAVIOR INJECT BEGIN: typeahead ==== */
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

    /* 连打同一字符 ⇒ 只按首字符匹配（理由见文件头 ③④）*/
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
        var i = (last + 1 + k) % n;      /* ① 从当前项之后开始 ⇒ 会绕回 */
        if (!usable(l[i])) continue;     /* ⑤ */
        if (textOf(l[i]).toLowerCase().indexOf(needle) === 0) return i;
      }
      return -1;                          /* ⑥ */
    }

    function type(ch) {
      if (!ch) return -1;
      buf += String(ch).toLowerCase();    /* ② */
      stop();
      timer = setTimeout(clear, timeout); /* ④ */
      var needle = repeated(buf) ? buf.charAt(0) : buf;   /* ③ */
      var i = find(needle);
      if (i >= 0) {
        last = i;
        onHit(i, (items() || [])[i], buf);
      }
      return i;
    }

    /* 只清缓冲，不清 last（理由见文件头）*/
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
  /* ==== BEHAVIOR INJECT END: typeahead ==== */
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
  /* ---- 旧环境兼容：Element.closest 在老 WebView 上不存在 ----
     直接调用会在真机上抛 `is not a function`（本地完全正常，
     只在老环境炸 —— 属静默失效）。这里做模块内兜底，
     不污染全局，也不需要使用者额外引入 polyfill。 */
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
    /* 读屏文案默认值（F2 / 0.26.0）。不传 `labels` 时输出逐字不变。 */
    var DEFAULT_LABELS = {
      option: '选项',
      placeholder: '请选择'
    };

    /* ==== BEHAVIOR INJECT BEGIN: labels ==== */
    var flLabels = function (defaults, src) {
      src = src || {};
      var out = {};
      var k;
      for (k in defaults) {
        if (Object.prototype.hasOwnProperty.call(defaults, k)) {
          out[k] = (src[k] === undefined || src[k] === null) ? defaults[k] : src[k];
        }
      }
      return out;
    };
    /* ==== BEHAVIOR INJECT END: labels ==== */
  var L = flLabels(DEFAULT_LABELS, opt && opt.labels);

    opt = opt || {};
    var btn = root.querySelector('[data-select-btn]');
    var list = root.querySelector('[data-select-list]');
    if (!btn || !list) throw new Error('Select: 缺少 [data-select-btn] 或 [data-select-list]');

    /* 焦点归位核：open() 时save() 记住焦点、close() 时按参数 restore()。
       原先是 close() 里直接 btn.focus() —— 那是**无条件**归位，
       而 close(false) 的调用场景（选完就走的场景）本意就是不夺焦点。
       核的语义是「记了才还」，正好把「打开时记、关闭时还」讲清楚。 */
    var fr = flFocusReturn({ fallback: btn });

    /* 「关得掉」核：Esc + 点外部。收编解决两个实际问题：
       ① 原来的 document click 是**冒泡阶段**判定 ⇒ 点在按钮上但事件仍会
          继续冒泡，容易出现「刚打开就被自己那一下点关掉」；
       ② Esc 的 stopPropagation（只关本层、不带崩外层）由核统一承担，
          组件里不再各写一份。
       ⚠️ close(false) 的场景（Tab 走开）**不夺焦点**，
          所以 onDismiss 用 close(false)、Esc 那条单独 close(true)。 */
    var dismiss = flDismissable({
      escOn: [btn],
      inside: [root],
      when: function () { return !list.hidden; },
      onDismiss: function (ev, reason) {
        close(reason === 'esc');
      }
    });
    if (!list.id) list.id = 'select-list-' + (++uid);

    var options = [].slice.call(list.querySelectorAll('[role="option"]'));
    var isMulti = !!opt.multiple;
    /* 🔴 真多值：以前多选也只有一个 `selected` 字符串，而 aria-multiselectable
       照样写 "true" —— ARIA 在**谎报**能力。现在统一用数组存值，
       单选只是"长度 0 或 1"的特例，两条路径共用同一份状态。 */
    var values = [];
    var activeIdx = -1;
    var destroyed = false;

    function valueOfOpt(o) { return o ? o.getAttribute('data-value') : null; }
    function hasValue(v) { return v != null && values.indexOf(String(v)) >= 0; }
    function seed(v) {
      if (v == null) return;
      var arr = Object.prototype.toString.call(v) === '[object Array]' ? v : [v];
      var next = [];
      for (var i = 0; i < arr.length; i++) {
        var s = arr[i] == null ? '' : String(arr[i]);
        if (s && next.indexOf(s) < 0) next.push(s);
      }
      values = isMulti ? next : next.slice(0, 1);
    }
    seed(opt.value);

    list.setAttribute('role', 'listbox');
    if (isMulti) list.setAttribute('aria-multiselectable', 'true');
    list.setAttribute('aria-label', opt.label || L.option);
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', list.id);

    /* 保证每个 option 都有 id（aria-activedescendant 需要） */
    options.forEach(function (o, i) {
      o.setAttribute('role', 'option');
      if (!o.id) o.id = list.id + '-o' + i;
      o.setAttribute('aria-selected', 'false');
      if (o.hasAttribute('disabled') || o.getAttribute('aria-disabled') === 'true') {
        o.setAttribute('aria-disabled', 'true');
      }
      o.setAttribute('tabindex', '-1');   /* 焦点在按钮上，选项不占 Tab */
      if (o.className.indexOf('select__opt') < 0) {
        o.className = (o.className ? o.className + ' ' : '') + 'select__opt';
      }
    });

    function enabled() {
      return options.filter(function (o) { return o.getAttribute('aria-disabled') !== 'true'; });
    }
    /* 类型搜索（连续打字定位）走 typeahead 核（01-tokens/behavior/typeahead.js）。
       ⭐ 之前这里只实现了"累积前缀"，**没有连打同一字符时循环** ⇒
         连按两次同一个字母，游标不动（用户以为卡了）。
       ⭐ 而 tree 里那一份只实现了循环、没有累积 —— 两份各缺一半。
       ⇒ 核一次把两半都补齐（APG 的 typeahead 约定），两处共用一份规则。 */
    var typeahead = flTypeahead({
      items: function () { return options; },
      textOf: optText,
      usable: function (o) { return o.getAttribute('aria-disabled') !== 'true'; },
      onHit: function (i) { setActive(i, 1); },
    });

    function selectedIdx() {
      for (var i = 0; i < options.length; i++) {
        if (hasValue(valueOfOpt(options[i]))) return i;
      }
      return -1;
    }
    function valueText() {
      var texts = [];
      for (var i = 0; i < options.length; i++) {
        if (hasValue(valueOfOpt(options[i]))) texts.push(optText(options[i]));
      }
      return texts.length ? texts.join('、') : (opt.placeholder || L.placeholder);
    }
    /* ⚠️ 空列表也会被调用（初始化 / 清空后重绘）：必须能接住 undefined，
       老实现直接 o.querySelector 会抛 "Cannot read properties of undefined"。 */
    function optText(o) {
      if (!o) return '';
      var t = o.querySelector('.select__opt-text');
      return ((t || o).textContent || '').replace(/[✓\s]/g, '').trim();
    }

    /** 对外值：单选给字符串（无值 null），多选给数组副本 */
    function value() {
      return isMulti ? values.slice() : (values.length ? values[0] : null);
    }

    /* 表单承接：作者写了几个 hidden 就复用几个，不够的自动补同 name 的兄弟节点。
       多选必须"一个值一个 input"，否则提交出去只有最后一个 —— 那是假多选。 */
    function syncHidden() {
      var all = [].slice.call(root.querySelectorAll('input[type="hidden"]'));
      var mine = [];
      var author = [];
      all.forEach(function (i) {
        if (i.getAttribute('data-select-value') === '1') mine.push(i);
        else author.push(i);
      });
      var name = opt.name || root.getAttribute('data-name') ||
                 (author[0] && author[0].name) || (mine[0] && mine[0].name) ||
                 root.id || '';   /* 兜底用根元素 id：没有 name 的话多选压根提交不出去 */
      var slots = author.concat(mine);
      var want = values.slice();
      for (var i = 0; i < want.length; i++) {
        var inp = slots[i];
        if (!inp) {
          inp = document.createElement('input');
          inp.type = 'hidden';
          inp.setAttribute('data-select-value', '1');
          root.appendChild(inp);
          slots.push(inp);
        }
        if (name) inp.name = name;
        else inp.removeAttribute('name');
        inp.value = want[i];
      }
      for (var j = want.length; j < slots.length; j++) {
        var extra = slots[j];
        if (extra.getAttribute('data-select-value') === '1') {
          if (extra.parentNode) extra.parentNode.removeChild(extra);
        } else {
          extra.value = '';        /* 作者自己的 input 留着，只是清空 */
        }
      }
    }

    function paint(silent) {
      var label = valueText();
      var empty = selectedIdx() < 0;
      var vEl = btn.querySelector('.select__value');
      if (vEl) {
        vEl.textContent = label;
        vEl.classList.toggle('select__value--placeholder', empty);
      }
      /* 多选标签会被 CSS 截断：title 里留全量，鼠标悬停能看全 */
      if (empty) btn.removeAttribute('title');
      else btn.setAttribute('title', label);
      options.forEach(function (o) {
        var on = hasValue(valueOfOpt(o));
        o.setAttribute('aria-selected', on ? 'true' : 'false');
        var ck = o.querySelector('.select__check');
        if (ck) ck.textContent = on ? '✓' : '';
      });
      syncHidden();
      if (silent) return;
      flEmit(root, 'fl-change', { value: value(), values: values.slice(), text: label });
      if (opt.onChange) opt.onChange(value(), label);
      /* 🔴 原生 change：宿主表单 / 框架（React 受控、form.reset 监听）认的是这个，
         只发 fl-change 等于"只有本库自己知道值变了"。 */
      var ev = null;
      if (typeof window.Event === 'function') {
        try { ev = new window.Event('change', { bubbles: true }); } catch (e) { ev = null; }
      }
      if (!ev) {
        try {
          ev = document.createEvent('Event');
          ev.initEvent('change', true, false);
        } catch (e2) { ev = null; }
      }
      if (ev) root.dispatchEvent(ev);
    }

    /**
     * 🔴 修一个**索引错位导致 ↑↓ 卡死**的 bug。
     *
     * 原来：`setActive(i)` 里的 i 被调用方按 **enabled() 过滤后数组**的索引传，
     *      而函数内部又当成 **options 原数组**的索引用
     *      ⇒ 两者含义不同；末项之后算出越界，被 Math.min 夹回末项
     *      ⇒ **连按 ↓ 永远停在最后一项**。
     * ⚠️ 症状极具欺骗性：前几项能正常走，最后一项之后就"卡住"了。
     *
     * ⭐ 正解：**对外统一用 options 的索引**，
     *      跳过 disabled 的逻辑放在函数内部做（步进 + 环绕）。
     *
     * @param {number} i  options 数组里的索引（可越界，会自动环绕）
     * @param {number} [dir=1] 步进方向（-1 用于 ↑）
     */
    function setActive(i, dir) {
      if (!options.length) return;
      dir = dir || 1;
      /* 从 i 开始按 dir 找第一个未禁用的（最多转一圈）*/
      var n = options.length;
      var idx = ((i % n) + n) % n;
      for (var k = 0; k < n; k++) {
        if (options[idx].getAttribute('aria-disabled') !== 'true') break;
        idx = ((idx + dir) % n + n) % n;
      }
      activeIdx = idx;
      options.forEach(function (o) { o.removeAttribute('data-state'); });
      options[idx].setAttribute('data-state', 'active');
      /* ⭐ aria-activedescendant：焦点始终在按钮上，靠它告诉读屏"当前在第几项" */
      btn.setAttribute('aria-activedescendant', options[idx].id);
      if (options[idx].scrollIntoView) {
        options[idx].scrollIntoView({ block: 'nearest' });
      }
    }

    /** 当前游标所在项在 options 里的索引（没打开时用选中项）*/
    function activeIndex() {
      if (activeIdx >= 0) return activeIdx;
      var i = selectedIdx();
      if (i >= 0) return i;
      var e2 = enabled();
      return e2.length ? options.indexOf(e2[0]) : 0;
    }

    function open() {
      /* 打开这一刻先记焦点，close() 才能还回去（要在改焦点之前做）。 */
      fr.save();
      list.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      /* 🔴 修：必须**先把焦点放到按钮上**。
         本组件用 aria-activedescendant 模式（焦点常驻按钮，靠它告知读屏
         "当前在第几项"）⇒ 焦点必须始终在按钮，事件也必须由按钮处理。
         原来只设了 aria-activedescendant 就 open()
         ⇒ 用鼠标点开时焦点可能停在 body
         ⇒ 挂在 list 上的 keydown（Esc / 类型搜索）**收不到事件**。
         ⚠️ 症状：鼠标能选、↑↓ 能走、Esc 与字母键完全无效。 */
      btn.focus();
      /* ① 焦点落在**选中项**（没有选中则落在第一个未禁用的项）*/
      setActive(activeIndex());
      flEmit(root, 'fl-open', null);
      if (opt.onOpen) opt.onOpen();
    }
    function close(restoreFocus) {
      list.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      btn.removeAttribute('aria-activedescendant');
      options.forEach(function (o) { o.removeAttribute('data-state'); });
      activeIdx = -1;
      typeahead.clear();   /* 关闭即清空缓冲：下次打开不该接着上次的半个词 */
      /* ③ Esc 关闭时焦点**还给按钮**（不是选中项）*/
      if (restoreFocus !== false) fr.restore();
      flEmit(root, 'fl-close', null);
      if (opt.onClose) opt.onClose();
    }
    function commit(i) {
      var o = options[i];
      if (!o || o.getAttribute('aria-disabled') === 'true') return;
      var v = valueOfOpt(o);
      if (isMulti) {
        /* 多选：再点一次取消；不关闭列表（APG 多选 listbox 语义） */
        var k = values.indexOf(v);
        if (k >= 0) values.splice(k, 1);
        else values.push(v);
        paint();
        return;
      }
      values = [v];
      paint();
      close(true);                                /* 选中并关闭 + 归位 */
    }

    /* ---------- 键盘（APG Select）----------
       🔴 只允许**一个** keydown 处理器。
       以前这里挂了两个：一个是 ↑↓/Enter，一个是 onListKey（↑↓/Home/End/Enter/字符）。
       同一事件两个监听器都跑 ⇒ 按一次 ↓ 走两格、多选 Enter 选上又取消、
       关闭态 Enter 打开后立刻被第二个处理器提交关闭。
       ⚠️ 而旧契约只断言"序列变了"，所以这个 bug 从门禁底下过去了。 */
    function onBtnKey(e) {
      if (destroyed) return;
      var k = e.key;
      var opened = !list.hidden;

      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        if (!opened) {
          open();
          /* APG：↑ 打开时游标落**末项**，↓ 打开落选中项 */
          if (k === 'ArrowUp' && options.length) setActive(options.length - 1, -1);
          return;
        }
        if (k === 'ArrowDown') { setActive(activeIndex() + 1, 1); return; }
        if (k === 'ArrowUp') { setActive(activeIndex() - 1, -1); return; }
        if (activeIdx >= 0) commit(activeIdx);     /* 多选：切一次、不关闭 */
        return;
      }
      if (k === 'Home' || k === 'End') {
        e.preventDefault();
        if (!opened) open();
        if (options.length) setActive(k === 'Home' ? 0 : options.length - 1, k === 'Home' ? 1 : -1);
        return;
      }
      if (k === 'Tab') { if (opened) close(false); return; }

      /* 单个可打印字符 = 类型搜索（Enter/Space/Tab 各有语义，不能算打字） */
      if (k && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!opened) open();                       /* 关闭态打字：先开再定位 */
        e.preventDefault();
        typeahead.type(k);
      }
      /* Esc 由 dismissable 核接管（挂在 btn 上、且 stopPropagation）：
         只关最内层，组件里不再写第二份。 */
    }
    btn.addEventListener('keydown', onBtnKey);

    /* ---------- 点击 ---------- */
    function onBtnClick() {
      if (destroyed) return;
      if (list.hidden) open(); else close();
    }
    function onListClick(e) {
      if (destroyed) return;
      var o = e.target.closest ? closest(e.target, '[role="option"]') : null;
      if (!o) return;
      commit(options.indexOf(o));
    }
    btn.addEventListener('click', onBtnClick);
    list.addEventListener('click', onListClick);

    /* 🔴 表单 reset：hidden input 会被浏览器清空，而组件内部状态不会跟着变
       ⇒ 重置后 UI 还显示旧值，提交却是空的。监听 form 的 reset，
       等浏览器把 DOM 重置完（下一个宏任务）再把状态改回初始值。 */
    var initialValues = values.slice();
    var form = closest(root, 'form');   /* 用模块内兜底，别直接调 Element.closest（老 WebView 没有） */
    function onFormReset() {
      setTimeout(function () {
        if (destroyed) return;
        values = initialValues.slice();
        paint();
      }, 0);
    }
    if (form) form.addEventListener('reset', onFormReset);
    /* 点外部关闭已由 dismissable 核接管（document 捕获阶段判定）。 */

    /* 初始化重绘不派发 change：原生 select 也不会在挂载时发一次 */
    paint(true);

    return {
      open: open, close: close,
      get value() { return value(); },
      set value(v) { seed(v); paint(); },
      get values() { return values.slice(); },
      set values(v) { seed(v); paint(); },
      /* 🔴 对外必须能销毁：动态移除组件时，document 上的 dismissable 监听、
         typeahead 缓冲、btn 上的 keydown 都要摘掉，否则越挂越多。 */
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        btn.removeEventListener('keydown', onBtnKey);
        btn.removeEventListener('click', onBtnClick);
        list.removeEventListener('click', onListClick);
        if (form) form.removeEventListener('reset', onFormReset);
        dismiss.destroy();
        typeahead.destroy();
        fr.clear();
        list.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        btn.removeAttribute('aria-activedescendant');
        /* 只删我们自己补出来的 hidden（作者写的那几个不动） */
        [].slice.call(root.querySelectorAll('input[type="hidden"][data-select-value="1"]'))
          .forEach(function (i) { if (i.parentNode) i.parentNode.removeChild(i); });
      },
    };
  }

  global.Select = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
