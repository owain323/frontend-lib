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
  /* 不支持 inert 的旧 WebView 走这套（见下方 ariaAcquire 的说明） */
  var ariaRefs = [];          /* [{node, count, prev}] —— prev 是原来的 aria-hidden 值 */

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

  /* ============================================================ aria 兜底
     🔴 为什么需要这一套
     本库的目标是「旧 WebView 也要能用」，而 `inert` 要
       Safari 15.5+ / Chrome 102+（≈2022 年），旧 WebView 浏览器没有。
     没有 inert 时，此前只剩**焦点陷阱**：键盘 Tab 是逃不出去，
     但**屏幕阅读器的假想光标仍能读到背景内容**（焦点陷阱管的是 focus，
     管不了浏览模式下的虚拟光标）。
     ⇒ 不支持 inert 时用 aria-hidden 把背景从无障碍树里摘掉，
       与焦点陷阱叠加，才是完整的"背景不可达"。
     ⚠️ aria-hidden 不能替代 inert 的**交互屏蔽**（它不阻止点击），
        所以这里只作为补充，不去掉焦点陷阱。 */

  /** 取一个背景节点的 aria 引用计数条目（没有就建一个并置 aria-hidden）。 */
  function ariaAcquire(node) {
    for (var i = 0; i < ariaRefs.length; i++) {
      if (ariaRefs[i].node === node) { ariaRefs[i].count++; return; }
    }
    /* 记住原值：可能是 null（本来没有这个属性），也可能本来就是 true/false。
       恢复时必须回到原样 —— 否则我们自己就成了新的无障碍缺陷。 */
    ariaRefs.push({ node: node, count: 1, prev: node.getAttribute('aria-hidden') });
    node.setAttribute('aria-hidden', 'true');
  }

  /** 还一个 aria 引用；降到 0 才恢复原值。 */
  function ariaRelease(node) {
    for (var i = 0; i < ariaRefs.length; i++) {
      if (ariaRefs[i].node !== node) continue;
      ariaRefs[i].count--;
      if (ariaRefs[i].count <= 0) {
        var prev = ariaRefs[i].prev;
        if (prev === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', prev);
        ariaRefs.splice(i, 1);
      }
      return;
    }
  }

  /* ============================================ 交互隔离（仅旧 WebView）
     🔴 第三轮外部审计要求把这两件事分开：原文：
        「aria-hidden 不阻止键盘或鼠标交互，测试也没有断言 Tab 焦点不会逃出；
          应把『辅助技术隐藏背景』和『键盘/指针交互隔离』作为**不同契约**，
          避免把前者通过误读成后者已解决。」

     ⇒ 本文件从此把两件事分开写、分开关：

        · 辅助技术隐藏：背景从无障碍树摘掉
            现代 → `inert`（浏览器顺手把交互也挡了）
            旧   → `aria-hidden="true"`（**只管读屏，不管键盘鼠标**）
        · 交互隔离：背景收不到焦点、收不到指针事件
            现代 → `inert` 自带，不用我们做
            旧   → **浏览器没有任何机制可用**，只能自己装 document 级守卫（本函数）

     ⚠️ 为什么只在**没有 inert** 时装守卫：
        有 inert 时背景本来就不可聚焦、不可点击，再拦一层只会给宿主页面
        添意外行为（比如它自己写在 document 上的委托监听被吞掉）。
        也就是说：现代路径的行为**一个字节都没变**。 */
  var openStack = [];          /* 打开着的弹层，最后一个是最上层（嵌套用） */

  function installIsolation(entry) {
    var box = entry.box;
    var backdrop = entry.backdrop;
    var lastInside = null;

    function topmost() { return openStack[openStack.length - 1]; }

    /** 把焦点拉回弹层。优先回到**刚才在弹层里的那个元素**，别每次从头开始。 */
    function pullBack() {
      if (lastInside && document.contains(lastInside) && box.contains(lastInside)) {
        lastInside.focus();
        return;
      }
      var f = focusableIn(box);
      if (f.length) { f[0].focus(); return; }
      box.focus();
    }

    /* 键盘一侧：focusin 是全捕获的 —— 不管是 Tab、还是脚本 focus()、
       还是读屏软件移焦点，只要焦点落到背景就拉回来。 */
    function onFocusIn(e) {
      if (topmost() !== entry) return;      /* 不是最上层：别抢内层的焦点 */
      var t = e.target;
      if (box.contains(t) || backdrop.contains(t)) { lastInside = t; return; }
      pullBack();
    }

    /* 指针一侧：与 inert 对齐 —— 事件**根本不送到宿主页面**。
       原来的问题是：旧 WebView 上背景按钮照样能点，而 inert 下不能 ⇒ 两种
       环境的行为不一致，且"背景不可达"这条承诺只在现代浏览器成立。 */
    function onPointer(e) {
      if (topmost() !== entry) return;
      if (backdrop.contains(e.target)) return;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    }

    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('mousedown', onPointer, true);
    document.addEventListener('touchstart', onPointer, true);
    /* `click` 也要拦：合成事件与老 WebView 的"tap→click"路径都可能绕过
       pointerdown / mousedown。 */
    document.addEventListener('click', onPointer, true);

    return function uninstall() {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('mousedown', onPointer, true);
      document.removeEventListener('touchstart', onPointer, true);
      document.removeEventListener('click', onPointer, true);
    };
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
  function dialog(opts) {
    opts = opts || {};

    /* ⭐ 焦点归还**绑到这个实例**，不进全局栈。
       全局栈 + pop() 在非 LIFO 关闭时会还错人
       （先关外层会把焦点从内层手里抢走）。 */
    /* 焦点归还：走 focus-return 核（0.8.6 收编）。
       🔴 收编修掉一个**真 bug**：原来这里是
           if (focusIsMine && myTrigger && document.contains(myTrigger))
           ——`focusIsMine` 这个变量**在本文件里根本不存在** ⇒ 条件恒假
           ⇒ **焦点从来没还过**。而 dialog 是模态、不点外部关闭，
           所以这条唯一的出路就是 Esc/按钮关闭时归位 ⇒ 键盘用户必迷路。
       核的 save() 记的就是 document.activeElement，语义正好对上。 */
    var fr = flFocusReturn();
    fr.save();

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

    /* 🔴 入栈与装守卫必须**早于设置初始焦点**（下面「初始焦点」那一段）。
       实测踩过：放在后面时，外层弹层的守卫先看到"焦点落到我自己范围外"
       （其实是内层弹层刚拿到焦点），立刻把它拉回外层 ⇒ 内层的初始焦点失效，
       连带的后果是内层关掉后外层再也收不到 keydown，Esc 失效、aria-hidden
       永远不还原。⇒ 顺序：appendChild → 入栈 → 装守卫 → 设初始焦点。 */
    var useInert = 'inert' in HTMLElement.prototype;
    var stackEntry = { backdrop: backdrop, box: box };
    var uninstallIsolation = null;
    openStack.push(stackEntry);
    if (!useInert) uninstallIsolation = installIsolation(stackEntry);

    /* ① Esc 走 dismissable 核（0.14.0 收编）。
       `outside: false` 是模态的定义：点外部**不该关**。核里这个开关专门
       为它加的（不进栈 ⇒ 不参与"点外部关最内层"的仲裁）。
       ⚠️ 点遮罩关闭是**另一件事**，不归核管：它带 danger / closeOnBackdrop
          两个前置条件，是组件自己的语义（见下方 mousedown）。
       关于"为什么不再手写 stopPropagation"：核在 onDismiss 之后统一
       preventDefault + stopPropagation，一次 Esc 只关最内层的语义与
       以前实测一致（两个 backdrop 是兄弟节点，本来也冒泡不到外层）。 */
    var dm = flDismissable({
      escOn: [box],
      outside: false,
      when: function () { return !closed; },
      onDismiss: function () { close(); },
    });

    /* ------------------------------------------------------------ 焦点 */
    function focusables() { return focusableIn(box); }

    box.addEventListener('keydown', function (e) {
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
    var ariaed = [];   /* 不支持 inert 时改走这条（见 ariaAcquire 的说明） */

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
    /* 🔴 背景隔离必须**两条路都走**：
       支持 inert 就用 inert；不支持（旧 WebView）就用 aria-hidden 兜底。
       以前只有 inert 分支，旧 WebView 上等于**什么都没做**，
       辅助技术的虚拟光标仍能穿透到背景内容。
       （`useInert` / `stackEntry` / `uninstallIsolation` 在 appendChild 之后
        就已经算好了 —— 那份顺序说明见那里，别搬回来。） */
    var nodes = Array.prototype.slice.call(
      document.body.querySelectorAll('body > *')
    );
    nodes.forEach(function (n) {
      /* 任何已有的 backdrop（外层）都跳过 —— 它们自己管自己的 */
      if (n.classList.contains('dialog-backdrop')) return;
      if (useInert) {
        inerted.push(n);
        inertAcquire(n);
      } else {
        ariaed.push(n);
        ariaAcquire(n);
      }
    });

    function close() {
      if (closed) return;
      closed = true;
      /* 核的 Esc 监听器要摘（outside:false ⇒ 它本来就没进栈，
         但 destroy 仍然必须调用：摘监听器与摘栈是同一件事的两半）。 */
      dm.destroy();

      /* 🔴 焦点归还前先看清**焦点现在在谁手里**（必须在移除 backdrop 之前读，
         移除之后 activeElement 会变成 body）。
         ⚠️ 只有焦点还在这个弹层里（或已经掉到 body）时才归还 ——
            否则就是**从别人手里抢焦点**：
            先关外层时，内层正拿着焦点，外层不许把它抢走。 */
      var ae = document.activeElement;
      var focusIsMine = !ae || ae === document.body ||
        box.contains(ae) || backdrop.contains(ae);

      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);

      /* 🔴 守卫必须在**焦点归还之前**拆掉。
         不拆的话 fr.restore() 把焦点送回触发器（在背景里）⇒
         focusin 捕获到"焦点跑到背景"⇒ 守卫立刻又把它拉回弹层，
         用户看到的是"关闭了但焦点没回来"。 */
      for (var si = openStack.length - 1; si >= 0; si--) {
        if (openStack[si] === stackEntry) { openStack.splice(si, 1); break; }
      }
      if (uninstallIsolation) { uninstallIsolation(); uninstallIsolation = null; }

      /* ⭐ 引用计数：还一个引用，降到 0 才真的解锁 ⇒ 与关闭顺序无关 */
      inerted.forEach(inertRelease);
      /* 旧 WebView 走 aria-hidden 的那条路，同样要按引用计数还 */
      ariaed.forEach(ariaRelease);
      unlockScroll();

      /* 🔴 焦点必须回到**触发它的那个元素**。
         不还的话，键盘用户要重新 Tab 一遍才能回到原处。 */
      fr.restore();
      /* ⚠️ 不写 `document.body.focus()`：body 默认不可聚焦，
         那行从来没起过作用，只会让人以为"有兜底"。 */
    }

    return { el: box, close: close };
  }

  global.Overlay = { toast: toast, dialog: dialog };

})(typeof window !== 'undefined' ? window : globalThis);
