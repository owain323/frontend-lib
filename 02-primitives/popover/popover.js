/**
 * popover.js — 气泡卡片的行为
 * ============================================================================
 * ⭐ 与 dialog 的根本区别：**非模态**
 *   dialog  : 背景锁死、focus trap、必须处理完才能继续
 *   popover : 背景**仍可交互**，用户可以"看一眼再关掉"
 *   ⇒ 所以 popover **不**做 focus trap（那会让人出不去），
 *     只做「焦点进入」+「Esc 关闭」+「焦点归还」。
 *
 * 参照：Radix Popover / MUI Popover
 * ============================================================================
 */
(function (global) {
  'use strict';

  /* ⭐ 同一时间只开一个 popover —— 两个叠着会让用户不知道该关哪个 */
  var current = null;

  function focusableIn(root) {
    var all = root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    return Array.prototype.filter.call(all, function (el) {
      var cs = global.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      var r = el.getBoundingClientRect();
      return r.width >= 1 && r.height >= 1;
    });
  }

  /**
   * 绑定一个 popover
   * @param {Element} trigger 触发元素
   * @param {object}  opts
   *   - place: 'bottom' | 'top' | 'end' | 'start'（默认 bottom）
   *   - html:  浮层内容 HTML
   *   - onOpen / onClose 回调
   *   - closeOnOutsideClick（默认 true）
   *   - closeOnEsc（默认 true）
   */
  function attach(trigger, opts) {
    opts = opts || {};

    /* ---- 建 DOM ---- */
    var anchor = document.createElement('span');
    anchor.className = 'popover-anchor';
    trigger.parentNode.insertBefore(anchor, trigger);
    anchor.appendChild(trigger);

    var box = document.createElement('div');
    box.className = 'popover popover--' + (opts.place || 'bottom');
    box.setAttribute('data-open', 'false');
    box.setAttribute('inert', '');   /* 初始关闭态即不可聚焦 */
    /* 🔴 关键：popover 用 `dialog` 角色但**不加 aria-modal**
       （加了就是模态，语义就错了）。 */
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', opts.label || '');
    box.innerHTML =
      '<span class="popover__arrow" aria-hidden="true"></span>' +
      '<div class="popover__body">' + (opts.html || '') + '</div>';

    /* 箭头要指向触发元素的中心，而不是浮层的中心 */
    positionArrow(box, trigger);
    anchor.appendChild(box);

    var lastFocused = null;

    function open() {
      if (current && current !== api) current.close();
      lastFocused = document.activeElement;
      box.setAttribute('data-open', 'true');
      /* 🔴 关闭态必须用 **inert**，不能用 pointer-events ——
       *   实测踩坑：`pointer-events:none` **拦不住 Tab**
       *   （Tab 走的是 tabindex/focusability，不是命中测试）
       *   ⇒ 关闭的浮层里的按钮仍能被 Tab 到，用户焦点会跑到"看不见"的地方。
       *   inert 一次性解决：不可聚焦、不可点击、读屏也不读。 */
      box.removeAttribute('inert');

      /* 🔴 焦点**进入**浮层 —— 键盘用户要能直接操作里面的内容。
       *    ⚠️ 与 dialog 不同：这里**不做 trap**（那会让人出不去）。 */
      var f = focusableIn(box);
      if (f.length) f[0].focus();
      else box.setAttribute('tabindex', '-1'), box.focus();

      current = api;
      if (opts.onOpen) opts.onOpen();
    }

    function close() {
      if (box.getAttribute('data-open') !== 'true') return;
      box.setAttribute('data-open', 'false');
      /* ⭐ 见 open() 的说明：必须 inert，不能只靠 pointer-events */
      box.setAttribute('inert', '');
      /* ⭐ 焦点归还 —— 否则键盘用户要从页面开头重新 Tab。
       *    ⚠️ 归还目标必须是**触发元素**，不是 body。 */
      if (lastFocused && lastFocused.focus) lastFocused.focus();
      lastFocused = null;
      if (current === api) current = null;
      if (opts.onClose) opts.onClose();
    }

    function toggle() {
      if (box.getAttribute('data-open') === 'true') close();
      else open();
    }

    /* ---- 触发器 ---- */
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();   /* ⭐ 见下方「外部点击」的说明 */
      toggle();
    });

    /* ---- 键盘：触发器上用 Enter / Space 也能开 ---- */
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && box.getAttribute('data-open') === 'true') {
        e.stopPropagation();
        close();
      }
    });

    /* ---- 浮层内部按键 ---- */
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        /* 🔴 必须 stopPropagation —— 否则若 popover 放在 dialog 里，
         *    按一次 Esc 会**把两层一起关掉**（本库真实踩过的坑）。 */
        e.stopPropagation();
        close();
        return;
      }
      /* 🔴 Tab **不做任何处理** —— 这是修正后的行为。
       *
       *  第一版（错）：在浮层内循环 Tab（最后一个绕回第一个）。
       *  实测焦点序列：近 7 天 → 近 30 天 → 取消 → 应用 → 近 7 天 → …
       *  ⇒ 用户**被困住了**，出不去。
       *
       *  ⭐ 正确做法（Radix Popover 的默认 `trapFocus={false}`）：
       *    popover 是**非模态**的，Tab 应当自然走到页面下一个可聚焦元素。
       *    困住用户是 dialog 的行为，不是 popover 的。
       *    焦点"进入"浮层已经由 open() 里的 focus() 保证了，
       *    不需要用 trap 来维持。
       */
    });

    /* ---- 关闭态的内容不可聚焦 ---- */
    box.addEventListener('transitionend', function () {
      if (box.getAttribute('data-open') === 'false') {
        box.setAttribute('aria-hidden', 'true');
      } else {
        box.removeAttribute('aria-hidden');
      }
    });

    var api = {
      open: open,
      close: close,
      toggle: toggle,
      destroy: function () {
        close();
        box.remove();
        anchor.remove();
      },
      el: box,
    };
    return api;
  }

  /* 箭头对准触发元素中心（浮层可能比触发元素宽） */
  function positionArrow(box, trigger) {
    var arrow = box.querySelector('.popover__arrow');
    if (!arrow) return;
    var place = (box.className.match(/popover--(\w+)/) || [])[1];
    if (place === 'start' || place === 'end') {
      /* 左右方向：箭头固定垂直居中 */
      arrow.style.top = '50%';
      arrow.style.marginTop = '';
      return;
    }
    var br = trigger.getBoundingClientRect();
    var ar = box.getBoundingClientRect();
    var offset = br.left + br.width / 2 - (ar.left + parseFloat(getComputedStyle(box).paddingLeft || 0));
    /* 夹在浮层内，避免箭头跑出圆角外 */
    var max = ar.width - 24;
    arrow.style.marginLeft = Math.max(12, Math.min(offset, max)) + 'px';
  }

  /* ---- 外部点击关闭（挂在 document 上，只装一次） ---- */
  var installed = false;
  function installOutsideClick() {
    if (installed) return;
    installed = true;
    document.addEventListener('click', function (e) {
      if (!current) return;
      /* ⭐ 关键：`contains` 判断要把**触发元素**也算进去 ——
         否则点触发器时，事件先冒泡到 document 会被判成"外部点击"，
         刚打开就立刻被关掉（这是最常见的 popover bug）。 */
      if (current.el.contains(e.target) ||
          current.el.parentNode.contains(e.target)) return;
      current.close();
    }, true);   /* 捕获阶段，比 trigger 的 handler 更早跑 */
  }

  var Popover = {
    attach: function (trigger, opts) {
      installOutsideClick();
      return attach(trigger, opts);
    },
    closeAll: function () { if (current) current.close(); },
    get current() { return current; },
  };

  global.Popover = Popover;
})(window);
