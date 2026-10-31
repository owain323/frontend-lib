/**
 * drawer.js — 抽屉（D2 /
 *
 * 依据：APG Dialog 模式
 *   ① **焦点陷阱**：Tab 在抽屉内循环
 *   ② **Esc 关闭**
 *   ③ ⭐ **关闭后焦点归位**（回到触发它的元素）
 *   ④ 背景 inert（避免读屏"双重朗读"）
 *   ⑤ 锁滚动（背景不该跟着滚）
 *
 * ⚠️ 与 dialog 的差别只是"从哪进来"，契约完全一样。
 *
 * 无依赖 · ES5
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

  var FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  var lockCount = 0, savedScroll = 0, inerts = [];

  function lockScroll() {
    if (lockCount === 0) {
      savedScroll = window.pageYOffset || 0;
      document.body.style.overflow = 'hidden';
    }
    lockCount++;
  }
  function unlockScroll() {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.body.style.overflow = '';
      window.scrollTo(0, savedScroll);
    }
  }

  function setBackgroundInert(on) {
    if (on) {
      if (inerts.length) return;
      /* ⚠️ 只把 body 的**直接子元素**（除抽屉容器）设 inert。
         抽屉本身也在 body 下 ⇒ 必须排除，否则刚打开就 inert 了。 */
      Array.prototype.forEach.call(document.body.children, function (n) {
        if (n.hasAttribute && n.hasAttribute('data-drawer-host')) return;
        if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return;
        n.inert = true;
        n.setAttribute('aria-hidden', 'true');
        inerts.push(n);
      });
    } else {
      inerts.forEach(function (n) {
        n.inert = false;
        n.removeAttribute('aria-hidden');
      });
      inerts = [];
    }
  }

  function open(opt) {
    opt = opt || {};
    var place = opt.place || 'right';

    /* ⭐ 记住"打开那一刻的焦点"—— 关闭时要还回去。
       （必须在插入 DOM **之前**记录，否则会记到新节点上。）
       走 focus-return 核（01-tokens/behavior/focus-return.js）：
       抽屉没有 fallback —— 打开它的元素若被删了，就维持现状不动，
       不假装"还回去了"。 */
    var fr = flFocusReturn({});
    fr.save();

    var host = document.createElement('div');
    host.className = 'drawer-backdrop';
    host.setAttribute('data-drawer-host', '');
    if (opt.label) host.setAttribute('aria-label', opt.label);

    var d = document.createElement('aside');
    d.className = 'drawer drawer--' + place;
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    if (!d.id) d.id = 'drawer-' + (new Date()).getTime();
    if (opt.title) d.setAttribute('aria-labelledby', d.id + '-title');
    else d.setAttribute('aria-label', opt.label || '抽屉');
    d.tabIndex = -1;              /* 焦点陷阱的兜底落点 */

    var head = document.createElement('div');
    head.className = 'drawer__head';
    var h = document.createElement('h2');
    h.className = 'drawer__title';
    h.id = d.id + '-title';
    h.textContent = opt.title || '';
    var closeBtn = document.createElement('button');   /* 🔴 不能叫 close：
     下方有 `function close()`，函数声明会**提升并覆盖**同名变量，
     导致上面所有 close.addEventListener 绑在函数上（静默失败）。 */
    closeBtn.className = 'drawer__close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.textContent = '\u00D7';
    head.appendChild(h);
    head.appendChild(closeBtn);

    var body = document.createElement('div');
    body.className = 'drawer__body';
    if (typeof opt.content === 'string') body.innerHTML = opt.content;
    else if (opt.content) body.appendChild(opt.content);

    d.appendChild(head);
    d.appendChild(body);

    if (opt.actions && opt.actions.length) {
      var foot = document.createElement('div');
      foot.className = 'drawer__foot';
      opt.actions.forEach(function (a) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn' + (a.variant ? ' btn--' + a.variant : '');
        b.textContent = a.label;
        b.addEventListener('click', function () {
          if (a.onClick) a.onClick(close);
          if (a.keepOpen !== true) close();
        });
        foot.appendChild(b);
      });
      d.appendChild(foot);
    }

    host.appendChild(d);
    document.body.appendChild(host);

    setBackgroundInert(true);
    lockScroll();

    /* 初始焦点：优先指定项，其次第一个**真的能聚焦**的元素，最后容器本身。
       ------------------------------------------------------------------
       🔴 0.19.0 修：原来写的是 `if (t) t.focus(); else (f[0] || d).focus();`
          —— "找到节点"被当成了"聚焦成功"。可这两件事不等价：

            · 节点存在但 `display: none`（本库真实踩到：app-shell 的侧栏克隆
              继承了窄屏的 `display: none`）⇒ `focus()` **静默无效**
            · 节点存在但 `disabled` / `inert` ⇒ 同样无效

          后果不是"焦点位置不理想"，是**模态框关不掉**：
          焦点留在 `<body>` 上，而 Esc 的监听挂在抽屉元素上，
          事件根本冒泡不过去。键盘用户 Tab 一下也出不去（背景已 inert）。
          鼠标用户点遮罩还能关，所以这个 bug 只在键盘下现形。

       ⇒ 判据改成"焦点**真的到了**"（比对 activeElement），没到就兜底；
         兜底时也跳过隐藏项，否则兜底同样落空。 */
    var f = d.querySelectorAll(FOCUSABLE);
    var landed = false;
    if (opt.initialFocus) {
      var t = d.querySelector(opt.initialFocus);
      if (t) {
        try { t.focus(); } catch (e) { /* 极端情况下 focus 会抛，按没落位处理 */ }
        landed = document.activeElement === t;
      }
    }
    if (!landed) {
      var first = null;
      for (var fi = 0; fi < f.length; fi++) {
        if (f[fi].offsetParent === null) continue;   /* 隐藏项不作为落点 */
        first = f[fi];
        break;
      }
      (first || d).focus();
    }

    /* ① Esc 与「点抽屉之外关闭」走 dismissable 核（0.14.0 收编）。
       0.8.6 曾**拒绝收编**，理由写得很实在：核当时只有"点外部一律关"，
       而 drawer 是模态。现在核有了 `outside` 开关（模态层不进栈），
       收编不再需要改组件的语义 —— 只改接线。
       ⚠️ inside 只放抽屉本体，**不能**把 host（遮罩）也放进去：
          放进去等于声明"点遮罩算内部"，"点遮罩关闭"立刻变成谎话
          （nav 那一格踩过这个坑，见 ai/behaviors.json）。 */
    var dm = flDismissable({
      escOn: [d],
      inside: [d],
      when: function () { return !closed; },
      onDismiss: function () { close(); },
    });

    function onKey(e) {
      if (e.key !== 'Tab') return;
      /* ② 焦点陷阱：Tab / Shift+Tab 在抽屉内循环（Esc 已交给核） */
      var list = [].slice.call(d.querySelectorAll(FOCUSABLE))
        .filter(function (x) { return x.offsetParent !== null; });
      if (!list.length) { e.preventDefault(); d.focus(); return; }
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === d)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }

    d.addEventListener('keydown', onKey);
    closeBtn.addEventListener('click', function () { close(); });

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      d.setAttribute('data-state', 'leaving');
      d.removeEventListener('keydown', onKey);
      /* 核的监听器与栈记录必须一起摘：只摘 Esc 不摘栈的话，
         点外部仍会关到一个已经没了的抽屉（dismissable 门禁 ⑥ 守这条）。 */
      dm.destroy();
      setBackgroundInert(false);
      unlockScroll();
      /* 动画结束再移除；reduced-motion 下没有 transition ⇒ 兜底定时器 */
      var done = false;
      function remove() {
        if (done) return; done = true;
        if (host.parentNode) host.parentNode.removeChild(host);
      }
      d.addEventListener('transitionend', remove, { once: true });
      setTimeout(remove, 320);
      /* ⭐ ③ 焦点归位：回到打开抽屉的那个元素（核里已处理
         "元素被移除 / 不可聚焦"两种降级，都不抛错）。 */
      fr.restore();
      /* 抽屉用完即毁 ⇒ 必须在 host 被移出 DOM **之前**派发，否则没人收得到 */
      flEmit(d, 'fl-close', null);
      if (opt.onClose) opt.onClose();
    }

    return { el: d, close: close };
  }

  global.Drawer = { open: open };
})(typeof window !== 'undefined' ? window : globalThis);
