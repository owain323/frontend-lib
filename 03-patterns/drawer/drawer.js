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
       （必须在插入 DOM **之前**记录，否则会记到新节点上。） */
    var lastFocused = document.activeElement;

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

    /* 初始焦点：优先指定项，其次第一个可聚焦元素，最后容器本身 */
    var f = d.querySelectorAll(FOCUSABLE);
    if (opt.initialFocus) {
      var t = d.querySelector(opt.initialFocus);
      if (t) t.focus();
      else (f[0] || d).focus();
    } else {
      (f[0] || d).focus();
    }

    function onKey(e) {
      var k = e.key;
      /* ② Esc 关闭 */
      if (k === 'Escape' || k === 'Esc') { e.preventDefault(); close(); return; }
      if (k !== 'Tab') return;
      /* ① 焦点陷阱：Tab / Shift+Tab 在抽屉内循环 */
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
    function onBackdropClick(e) { if (e.target === host) close(); }

    d.addEventListener('keydown', onKey);
    host.addEventListener('click', onBackdropClick);
    closeBtn.addEventListener('click', function () { close(); });

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      d.classList.add('is-leaving');
      d.removeEventListener('keydown', onKey);
      host.removeEventListener('click', onBackdropClick);
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
      /* ⭐ ③ 焦点归位：回到打开抽屉的那个元素。
         若它已被移除（例如列表项被删了）⇒ 退到 body，不抛错。 */
      if (lastFocused && document.contains(lastFocused)) {
        try { lastFocused.focus(); } catch (e) { /* 元素不可聚焦则忽略 */ }
      }
      if (opt.onClose) opt.onClose();
    }

    return { el: d, close: close };
  }

  global.Drawer = { open: open };
})(window);
