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

  /* ==== BEHAVIOR INJECT BEGIN: dismissable ==== */
  var flDismissable = function (opts) {
    var opt = opts || {};
    var escOn = opt.escOn || [];
    var inside = opt.inside || [];
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
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      onDismiss(e, 'esc');
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
    shared.stack.push(rec);
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

    /* 焦点归位走 focus-return 核（01-tokens/behavior/focus-return.js）。
       fallback 给 trigger：万一打开它的那个元素被删了，焦点至少回到触发器，
       而不是掉到 body 上（键盘用户要从页面开头重新 Tab）。 */
    var fr = flFocusReturn({ fallback: trigger });

    function open() {
      if (current && current !== api) current.close();
      fr.save();
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
      /* ⭐ 焦点归还 —— 否则键盘用户要从页面开头重新 Tab。 */
      fr.restore();
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
      /* ⭐ 不要把它交给"外部点击"判定：触发器在浮层**外面**，
         但点它是"切换"不是"关闭"。dismissable 核的 `inside` 含 anchor，
         anchor 又含 trigger ⇒ 已经算作内部；这里 stopPropagation 只是
         顺手阻止更外层的组件（如 dropdown）也收到这次点击。 */
      e.stopPropagation();
      toggle();
    });

    /* ---- Esc / 点击外部关闭：走 dismissable 核（01-tokens/behavior/dismissable.js）
       —— 手写的两个 Esc 分支与外部点击监听已删除，全库统一到一处。 ---- */
    var dismiss = flDismissable({
      escOn: [trigger, box],
      inside: [box, anchor],   /* anchor 含 trigger ⇒ 点触发器不算"外部" */
      when: function () { return box.getAttribute('data-open') === 'true'; },
      onDismiss: function (e, reason) { close(); },
    });

    /* 🔴 Tab **不做任何处理** —— 这是修正后的行为，别"顺手"加回来。
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
        dismiss.destroy();
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

  var Popover = {
    attach: function (trigger, opts) {
      return attach(trigger, opts);
    },
    closeAll: function () { if (current) current.close(); },
    get current() { return current; },
  };

  global.Popover = Popover;
})(window);
