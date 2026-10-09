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

  /* 🔴 滚动锁定的**记账**
     以前只有一个 `savedPaddingRight`，问题是：
       · 支持 scrollbar-gutter 时它**从头到尾是 ''**，
         关闭时却无条件 `body.style.paddingRight = savedPaddingRight`
         ⇒ 把宿主页面原有的内联 padding-right **清空了**；
       · 降级路径里它是**替换**（`= sbw + 'px'`），把宿主原有的值覆盖掉。
     ⇒ 改成两件事分开记：**原值** + **这次到底改没改**。
       只恢复本组件**真的改过**的属性 —— 没碰过的东西不许写回。 */
  var scrollLock = { changed: false, saved: '', varSet: false };

  /* 🔴 背景 inert 的**引用计数**
     以前用「所有权记账」：`changedByMe = !n.inert` ——
     只有自己真正设过 true 的节点，关闭时才恢复 false。
     ⚠️ 它**假设弹层按打开的逆序关闭**（LIFO）。一旦不是：
        A 开 → 背景 locked（A 记 changedByMe=true）
        B 开 → 背景已 inert（B 记 changedByMe=false，不碰它）
        **先关 A** → A 解锁背景 ⇒ B 还开着，背景却能点了
        用户看到的是「弹窗明明还在，页面却能点」。
     ⇒ 改成引用计数：**只要还有弹层需要锁，背景就不许解锁**，
       与关闭顺序无关。这与"所有权"的区别就是引用计数解决不了的问题。 */
  var inertRefs = [];         /* [{node, count}] —— ES5 没有 Map，用数组 */

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
     🔴 实测反馈"弹窗打开时整页明显向右移动"。

     为什么不用 `scrollbar-gutter: stable`（两种写法都量过，都放弃）：
       · 无条件 `html{…}` ⇒ **导入即生效**：一个弹层没开过，宿主的
         `100vw` 也已被压窄 ⇒ 改宿主全局布局，与"组件只影响自己"冲突。
       · 状态级 `html[data-scroll-locked]{…}` ⇒ 锁定后才占位，
         `100vw` 元素反而从 393 跳到 378 ⇒ 抖动只是换了个地方发生。
     ⇒ 改回 JS **叠加**补偿：基准取 `getComputedStyle` 而不是内联样式
       （宿主的 padding 也可能来自样式表），替换会把宿主排版吃掉。

     ⭐ 补偿只能覆盖流式内容。`position: fixed` 相对**视口**定位，
       body 的 padding 管不到 ⇒ 把滚动条宽度公开成
       `--overlay-scrollbar-width`（仅锁定期间存在）让宿主自己补：
           .my-fixed { right: var(--overlay-scrollbar-width, 0px) }
  */
  function lockScroll() {
    if (lockCount++ > 0) return;

    /* ⭐ 先量，再锁 —— 锁上之后滚动条就没了，量出来是 0 */
    var sbw = window.innerWidth - document.documentElement.clientWidth;
    if (sbw > 0) {
      var cur = parseFloat(getComputedStyle(document.body).paddingRight) || 0;
      scrollLock.saved = document.body.style.paddingRight;
      document.body.style.paddingRight = (cur + sbw) + 'px';
      scrollLock.changed = true;
      document.documentElement.style.setProperty(
        '--overlay-scrollbar-width', sbw + 'px');
      scrollLock.varSet = true;
    }
    document.body.setAttribute('data-scroll-locked', 'true');
  }

  function unlockScroll() {
    if (--lockCount > 0) return;
    document.body.removeAttribute('data-scroll-locked');
    if (scrollLock.varSet) {
      document.documentElement.style.removeProperty('--overlay-scrollbar-width');
      scrollLock.varSet = false;
    }
    /* 🔴 只恢复**自己真的改过**的。没碰过就一个字节都不许写回 ——
       否则会把宿主原有的内联 padding-right 清成空字符串。 */
    if (scrollLock.changed) {
      document.body.style.paddingRight = scrollLock.saved;
      scrollLock.changed = false;
      scrollLock.saved = '';
    }
  }

  /** 取一个背景节点的引用计数条目（没有就建一个并置 inert）。 */
  function inertAcquire(node) {
    for (var i = 0; i < inertRefs.length; i++) {
      if (inertRefs[i].node === node) { inertRefs[i].count++; return; }
    }
    inertRefs.push({ node: node, count: 1 });
    node.inert = true;
  }

  /** 还一个引用；降到 0 才真正解锁。 */
  function inertRelease(node) {
    for (var i = 0; i < inertRefs.length; i++) {
      if (inertRefs[i].node !== node) continue;
      inertRefs[i].count--;
      if (inertRefs[i].count <= 0) {
        node.inert = false;
        inertRefs.splice(i, 1);
      }
      return;
    }
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
      el.setAttribute('data-state', 'leaving');
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

    /* ⭐ 焦点归还**绑到这个实例**，不进全局栈。
       全局栈 + pop() 在非 LIFO 关闭时会还错人
       （先关外层会把焦点从内层手里抢走）。 */
    var myTrigger = document.activeElement;

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
        /* 🔴 必须 stopPropagation：弹层可嵌套。
         * 不拦住的话，内层的 Esc 会**冒泡到外层**，
         * 一次按键把两层全关掉 —— 键盘用户会以为应用崩了。
         * （本库在 popover 上踩过同一个坑，这里一并修好。） */
        e.stopPropagation();
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
       支持就用（现代浏览器都有），不支持就靠上面的 focus trap 兜底。

       🔴🔴 计数用**引用计数**，不用「所有权」
       ---------------------------------------------------------------------------
       以前的写法是 `changedByMe = !n.inert`：只有自己真正设过 true 的，
       关闭时才恢复 false。**它假设弹层按打开的逆序关闭**。
       一旦调用方先关外层（公开的 close() 允许这么做）：
          A 开 → 背景 locked（A 记 changedByMe=true）
          B 开 → 背景已 inert（B 记 changedByMe=false，不碰它）
          **A.close()** → A 解锁背景 ⇒ B 还开着，背景却能点了
       ⇒ 改成引用计数：**只要还有弹层需要锁，背景就不许解锁**，
         与关闭顺序无关（见文件头 inertRefs 的注释）。
    */
    if ('inert' in HTMLElement.prototype) {
      var nodes = Array.prototype.slice.call(
        document.body.querySelectorAll('body > *')
      );
      nodes.forEach(function (n) {
        /* 任何已有的 backdrop（外层）都跳过 —— 它们自己管自己的 */
        if (n.classList.contains('dialog-backdrop')) return;
        inerted.push(n);
        inertAcquire(n);
      });
    }

    function close() {
      if (closed) return;
      closed = true;

      /* 🔴 焦点归还前先看清**焦点现在在谁手里**（必须在移除 backdrop 之前读，
         移除之后 activeElement 会变成 body）。
         ⚠️ 只有焦点还在这个弹层里（或已经掉到 body）时才归还 ——
            否则就是**从别人手里抢焦点**：
            先关外层时，内层正拿着焦点，外层不许把它抢走。 */
      var ae = document.activeElement;
      var focusIsMine = !ae || ae === document.body ||
        box.contains(ae) || backdrop.contains(ae);

      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      /* ⭐ 引用计数：还一个引用，降到 0 才真的解锁 ⇒ 与关闭顺序无关 */
      inerted.forEach(inertRelease);
      unlockScroll();

      /* 🔴 焦点必须回到**触发它的那个元素**。
         不还的话，键盘用户要重新 Tab 一遍才能回到原处。 */
      if (focusIsMine && myTrigger && document.contains(myTrigger)) {
        myTrigger.focus();
      }
      /* ⚠️ 不写 `document.body.focus()`：body 默认不可聚焦，
         那行从来没起过作用，只会让人以为"有兜底"。 */
    }

    return { el: box, close: close };
  }

  global.Overlay = { toast: toast, dialog: dialog };

})(window);
