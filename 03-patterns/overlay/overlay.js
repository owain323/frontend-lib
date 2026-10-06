/* ============================================================================
   frontend-lib / 03-patterns / overlay / overlay.js
   Toast 与模态框的行为层

   依赖：overlay.css
   为什么必须有 JS：focus trap、滚动锁定、焦点归还 —— 三件都是纯 CSS 做不到的。

   🔴 语法刻意用 ES5（无箭头函数 / const / 模板字符串）：
      精简档 是 某项目 上的 WebView，版本不确定。
      demo 可以用现代语法（跑在用户浏览器上），库代码不行。

   API：
     Overlay.toast({ title, desc, variant, duration })
     Overlay.dialog({ title, desc, actions, danger, initialFocus })
       → 返回 { el, close }
   ========================================================================= */
(function (global) {
  'use strict';

  var FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  var lockCount = 0;          /* 防止多个弹层重复加 padding */
  var lastFocused = null;
  var savedPaddingRight = '';

  /* ---------------------------------------------------------------- 工具 */
  function focusableIn(root) {
    var all = Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE));
    /* offsetParent 为 null 表示元素不可见（display:none / hidden）——
       不可见的元素不能被聚焦，否则 trap 会把焦点送给空气 */
    return all.filter(function (el) {
      return el.offsetParent !== null || el === document.activeElement;
    });
  }

  /* ---------------------------------------------------------------- 滚动锁定
     🔴 Owner 报"弹窗打开时整页明显向右移动"。

     根因不是"忘了补偿"，而是**补偿本身不可靠**：
     demo 的 body 已有左右 padding，JS 只改 paddingRight，
     两者的叠加关系在不同浏览器 / 不同 body 设定下并不一致 —— 实测就是没生效。

     **根治在 CSS**：overlay.css 里的 `html { scrollbar-gutter: stable }`
     让浏览器**始终为滚动条预留位置**，滚动条消失时内容区宽度不变。

     下面这段 JS 是**降级路径**，只在浏览器不支持 scrollbar-gutter 时才介入。
  */
  function supportsScrollbarGutter() {
    return ('scrollbarGutter' in document.documentElement.style);
  }

  function lockScroll() {
    if (lockCount++ > 0) return;

    /* 只在浏览器**不支持** scrollbar-gutter 时才做 JS 补偿。
       支持的浏览器已经由 CSS 从根上解决了，这里再补一次就是重复补偿，
       反而会把内容推窄。 */
    if (!supportsScrollbarGutter()) {
      var sbw = window.innerWidth - document.documentElement.clientWidth;
      savedPaddingRight = document.body.style.paddingRight;
      if (sbw > 0) document.body.style.paddingRight = sbw + 'px';
    }
    document.body.classList.add('is-locked');
  }

  function unlockScroll() {
    if (--lockCount > 0) return;
    document.body.classList.remove('is-locked');
    document.body.style.paddingRight = savedPaddingRight;
  }

  /* ================================================================ Toast
     🔴 绝不抢焦点。role="status" 会被屏幕阅读器自动播报，
        focus() 会打断用户当前正在做的事。
  */
  function toast(opts) {
    opts = opts || {};

    var region = document.querySelector('.toast-region');
    if (!region) {
      region = document.createElement('div');
      region.className = 'toast-region';
      /* role=status 让整个区域成为 live region，不用每个 toast 都标 */
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }

    var el = document.createElement('div');
    el.className = 'toast' + (opts.variant ? ' toast--' + opts.variant : '');

    var body = document.createElement('div');
    body.className = 'toast__body';
    if (opts.title) {
      var t = document.createElement('p');
      t.className = 'toast__title';
      t.textContent = opts.title;
      body.appendChild(t);
    }
    if (opts.desc) {
      var d = document.createElement('p');
      d.className = 'toast__desc';
      d.textContent = opts.desc;
      body.appendChild(d);
    }
    el.appendChild(body);

    /* 错误必须能手动关，而且默认不自动消失 ——
       3 秒后悄悄消失，用户还没读完就等于没说。 */
    var auto = opts.duration;
    if (auto === undefined) {
      auto = (opts.variant === 'error') ? 0 : 4000;
    }

    if (auto > 0) {
      var timer = document.createElement('div');
      timer.className = 'toast__timer';
      timer.style.animationDuration = auto + 'ms';
      el.appendChild(timer);
    }

    var closeBtn = document.createElement('button');
    closeBtn.className = 'toast__close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', '关闭提示');
    closeBtn.textContent = '×';
    el.appendChild(closeBtn);

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      if (auto) clearTimeout(timerId);
      el.classList.add('is-leaving');
      /* 动画结束再移除；reduced-motion 下 animation:none，220ms 后直接删 */
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 220);
    }

    closeBtn.addEventListener('click', close);
    region.appendChild(el);

    var timerId = auto > 0 ? setTimeout(close, auto) : null;
    return { el: el, close: close };
  }

  /* ================================================================ Dialog */
  function dialog(opts) {
    opts = opts || {};

    lastFocused = document.activeElement;

    var backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';

    var box = document.createElement('div');
    box.className = 'dialog' + (opts.danger ? ' dialog--danger' : '');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    /* tabindex=-1 让容器本身可聚焦 —— 打开时焦点落在这里，
       屏幕阅读器会读出标题和描述，比直接扔到"确定"按钮上更有用 */
    box.setAttribute('tabindex', '-1');

    if (opts.title) {
      var h = document.createElement('h2');
      h.className = 'dialog__title';
      h.id = 'dlg-title-' + Date.now();
      h.textContent = opts.title;
      box.appendChild(h);
      box.setAttribute('aria-labelledby', h.id);
    }
    if (opts.desc) {
      var p = document.createElement('p');
      p.className = 'dialog__desc';
      p.id = 'dlg-desc-' + Date.now();
      p.textContent = opts.desc;
      box.appendChild(p);
      box.setAttribute('aria-describedby', p.id);
    }

    var act = document.createElement('div');
    act.className = 'dialog__actions';
    (opts.actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.variant === 'danger' ? 'btn--danger'
                    : a.variant === 'primary' ? 'btn--primary' : 'btn--secondary');
      b.textContent = a.label;
      b.addEventListener('click', function () {
        if (a.onClick) a.onClick(close);
        if (a.keepOpen !== true) close();
      });
      act.appendChild(b);
    });
    box.appendChild(act);

    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    lockScroll();

    /* ------------------------------------------------------------ 焦点 */
    function focusables() { return focusableIn(box); }

    box.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab') return;

      /* focus trap：Tab 在弹层内循环，绝不跑到背后的页面去 */
      var f = focusables();
      if (!f.length) { e.preventDefault(); box.focus(); return; }
      var first = f[0], last = f[f.length - 1];

      if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });

    /* 初始焦点：
       默认给容器（读标题+描述）；
       initialFocus:'cancel' 给取消按钮 —— 破坏性操作用这个，
       避免用户条件反射按 Enter 把文件删了。 */
    if (opts.initialFocus === 'cancel') {
      var cancel = box.querySelector('.btn:not(.btn--danger)');
      if (cancel) cancel.focus();
      else box.focus();
    } else {
      box.focus();
    }

    /* 点击遮罩关闭。破坏性操作不要给这个 —— 误点就麻烦了 */
    if (opts.closeOnBackdrop !== false && !opts.danger) {
      backdrop.addEventListener('mousedown', function (e) {
        if (e.target === backdrop) close();
      });
    }

    var closed = false;
    var inerted = [];

    /* 背景 inert：把背后页面整个变不可交互 —— 比 focus trap 更彻底。
       支持就用（现代浏览器都有），不支持就靠上面的 focus trap 兜底。 */
    if ('inert' in HTMLElement.prototype) {
      var nodes = Array.prototype.slice.call(
        document.body.querySelectorAll('body > *')
      );
      nodes.forEach(function (n) {
        if (!n.classList.contains('dialog-backdrop')) {
          n.inert = true;
          inerted.push(n);
        }
      });
    }

    function close() {
      if (closed) return;
      closed = true;
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      inerted.forEach(function (n) { n.inert = false; });
      unlockScroll();
      /* 🔴 焦点必须回到触发它的那个元素。
         不还的话，键盘用户要重新 Tab 一遍才能回到原处。 */
      if (lastFocused && document.contains(lastFocused)) {
        lastFocused.focus();
      } else {
        document.body.focus();
      }
    }

    return { el: box, close: close };
  }

  global.Overlay = { toast: toast, dialog: dialog };

})(window);
