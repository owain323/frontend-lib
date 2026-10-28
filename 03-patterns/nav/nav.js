/*
 * nav.js — 导航的移动端抽屉行为层（可选增强）
 *
 * 语法刻意用 ES5（无箭头函数 / const / let / 模板字符串 / Element.closest）——
 * 精简档 WebView 的版本不确定，理由与 tabs.js / accordion.js 一致。
 *
 * ==========================================================================
 * 🔴 为什么导航需要行为层（而不是只给 CSS）
 * --------------------------------------------------------------------------
 *   `nav.css` 把抽屉的**样子**和状态约定都定义好了：
 *     .nav__list[data-state="open"]     ⇒ 抽屉推出来
 *     .nav__scrim[data-state="open"]    ⇒ 遮罩出现
 *     .nav__toggle[aria-expanded=true]  ⇒ 汉堡变成叉
 *   但它一个字都没说**谁来切这三个状态**。于是在这之前，每个使用者都要
 *   自己抄 60 行（demo 里抄了一份、示例页又抄了一份）——
 *   而抄出来的版本各有各的漏：demo 那份把 aria-hidden 打在了抽屉的**祖先**上，
 *   于是抽屉本身对读屏消失了（详见下方 ④）。
 *
 * ==========================================================================
 * 🔴 为什么不用 drawer.js（同样是抽屉，为什么不复用）
 * --------------------------------------------------------------------------
 *   `03-patterns/drawer/drawer.js` 的 `Drawer.open()` **自己建 DOM**：
 *   它 new 一个 aside、塞进 body、用完即毁。
 *   而导航的列表**在文档里本来就有一份**，桌面端还要用它（横排导航），
 *   不能"开一次建一个、关了就删掉"。
 *   ⇒ 两者的关闭契约一样（Esc / 焦点归位 / 锁滚动 / 背景 inert），
 *     但生命周期相反（即用即毁 vs 常驻），所以不共用实现，只共用**核**：
 *     emit / focus-return / dismissable 三块与 drawer.js 逐行同源。
 *
 * ==========================================================================
 * 契约（每条都能被测出来）
 * --------------------------------------------------------------------------
 *   ① 打开：list + scrim 加 data-state="open"，toggle 的 aria-expanded=true，
 *      aria-label 换成「关闭菜单」，焦点进入抽屉第一项
 *   ② 关闭：三个状态全部复位，**焦点必须回到打开它的那个元素**
 *      （元素被移除时退回到 toggle —— 不能让焦点掉在 body 上）
 *   ③ 关得掉：Esc、点遮罩、点抽屉里的链接、视口变宽到抽屉不适用
 *   ④ 背景 inert：抽屉打开时，正文对读屏和键盘都不可达
 *      🔴 只对**不含导航本身**的 body 子元素设 aria-hidden/inert。
 *         给祖先设 aria-hidden 会把抽屉一起隐掉 —— 这是 demo 旧版的真 bug，
 *         而且它"看起来完全正常"，只有用读屏才会发现抽屉读不到。
 *   ⑤ 焦点陷阱：打开期间 Tab / Shift+Tab 在抽屉内循环
 *      （视觉上是覆盖层，键盘上就必须是模态，两边不能不一致）
 *   ⑥ 断点无关：不写 48rem 这个数字。判据是**toggle 还在不在**
 *      —— 桌面端 `.nav__toggle{display:none}`，看不到就不该有抽屉。
 *      写死数字意味着 CSS 改一个值，JS 就静默错位。
 *
 * ==========================================================================
 * 用法
 * --------------------------------------------------------------------------
 *   <header class="nav" data-nav>
 *     <button class="nav__toggle" aria-expanded="false" aria-controls="nav-list">…</button>
 *     <ul class="nav__list" id="nav-list">…</ul>
 *     <div class="nav__scrim"></div>          <!-- 可省，缺了会自动建 -->
 *   </header>
 *
 *   <script src="nav.js"></script>            <!-- 有 data-nav 就自动初始化 -->
 *
 *   手动：new Nav(rootEl, { labels: { open: '打开菜单', close: '关闭菜单' } })
 *   事件：fl-nav-open / fl-nav-close（detail = { root: <nav> }）
 */
(function () {
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
      /* 🔴 为什么 onDismiss 在前、preventDefault/stopPropagation 在后
         （0.8.8 改）：**分级 Esc** 需要核让组件有机会说"这次我没关"。
         combobox 的 Esc 是三级的：
           ① 列表开着 → 关列表
           ② 列表关了、输入有字 → 清空输入
           ③ 都没了 → 什么都不做（此时**不该**阻止默认行为，
              让 Esc 能继续传给外层浮层）
         而原实现是「无条件 preventDefault + stopPropagation，再调 onDismiss」
         ⇒ 组件根本无法表达"这次我没关"。
         ⇒ 改成：先问onDismiss，它返回 false 就**不干预**默认行为。
         ⚠️ 顺序安全性：stopPropagation 只需在**本次监听器执行期间**被调用即可
            阻止冒泡到外层，放在 onDismiss 之后仍然有效。
      */
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

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]),' +
                  ' select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /* 元素是否**真的**可见。用 offsetParent 而不是 getComputedStyle：
     offsetParent 是 null 当且仅当元素或其祖先 display:none ——
     老 WebView 上 getComputedStyle 拿 display 也能用，但每次调用都触发样式计算，
     焦点陷阱里要循环调用，代价不划算。 */
  function isVisible(el) {
    return !!(el && el.offsetParent !== null);
  }

  function each(nodes, fn) {
    for (var i = 0; i < nodes.length; i++) fn(nodes[i], i);
  }

  function Nav(root, opts) {
    var self = this;
    this.root = root;
    this.opts = opts || {};
    this.labels = this.opts.labels || {};
    this.labelOpen = this.labels.open || '打开菜单';
    this.labelClose = this.labels.close || '关闭菜单';

    this.toggle = root.querySelector('[data-nav-toggle]') || root.querySelector('.nav__toggle');
    this.list = root.querySelector('[data-nav-list]') || root.querySelector('.nav__list');

    if (!this.toggle || !this.list) {
      /* 不抛异常：一个页面上可能同时有"只有静态导航"和"有抽屉"的实例，
         为一个缺按钮的实例把整页的 JS 打断，代价远大于收益。
         但也不能完全沉默 —— 沉默是这类缺陷最难查的原因。 */
      if (window.console && console.warn) {
        console.warn('nav.js: 缺少 .nav__toggle 或 .nav__list，已跳过', root);
      }
      return;
    }

    this.scrim = root.querySelector('.nav__scrim');
    if (!this.scrim) {
      this.scrim = document.createElement('div');
      this.scrim.className = 'nav__scrim';
      root.appendChild(this.scrim);
    }
    /* 遮罩是纯装饰：它只承载"点这里关闭"，语义上没有任何内容。
       不标 aria-hidden 的话，读屏会读到一个空的 div。 */
    this.scrim.setAttribute('aria-hidden', 'true');

    /* aria-controls 指向列表：这条关系必须由 JS 补，
       因为列表 id 是页面自己起的，CSS 无从知道。 */
    if (this.list.id && !this.toggle.getAttribute('aria-controls')) {
      this.toggle.setAttribute('aria-controls', this.list.id);
    }

    this.fr = flFocusReturn({ fallback: this.toggle });
    this.savedOverflow = null;
    this.inerted = [];

    this.onToggleClick = function () { self.isOpen() ? self.close() : self.open(); };
    this.onListClick = function (e) {
      var t = e.target;
      /* 点链接：让浏览器先跑完这次点击（导航/锚点），再关。
         顺序反了的话 close() 的焦点归位会把锚点跳转的焦点抢回来。 */
      if (t && (t.tagName === 'A' || (t.parentNode && t.parentNode.tagName === 'A'))) {
        setTimeout(function () { self.close(); }, 0);
      }
    };
    this.onKeydown = function (e) { self._trap(e); };
    this.onResize = function () {
      /* ⑥ 判据是"toggle 还看得见吗"，不是窗口宽度 < 48rem。 */
      if (self.isOpen() && !isVisible(self.toggle)) self.close();
    };

    this.toggle.addEventListener('click', this.onToggleClick);
    this.list.addEventListener('click', this.onListClick);
    window.addEventListener('resize', this.onResize);

    /* ③ 关得掉：Esc + 点遮罩 + 点抽屉外面。
       ⚠️ toggle 算"内部"—— 否则点汉堡会先被核判成"点外部"关掉，
          再被 toggle 的 click 打开，表现是"点了没反应"。
       ⚠️ 遮罩**不能**算内部 —— 遮罩的唯一职责就是"点它关闭"，
          把它写进 inside 会让这句注释变成谎话（实测：点遮罩后仍然开着）。 */
    this.dismiss = flDismissable({
      escOn: [document],
      inside: [this.list, this.toggle],
      when: function () { return self.isOpen(); },
      onDismiss: function () { self.close(); },
    });

    /* 初始状态对齐：CSS 靠 [data-state] + aria-expanded 两处判断，
       HTML 里只写 aria-expanded 的话，CSS 也是对的；
       但 aria-expanded 写错（比如模板里抄成 true）就会一进页面就是开着的抽屉。 */
    if (this.toggle.getAttribute('aria-expanded') === 'true') this.close();
    else this.toggle.setAttribute('aria-expanded', 'false');
  }

  Nav.prototype.isOpen = function () {
    return this.toggle.getAttribute('aria-expanded') === 'true';
  };

  /* ④ 背景 inert：跳过"包含导航自身"的节点。
     给祖先设 aria-hidden 会把抽屉一起隐藏掉，读屏用户打开菜单后读不到任何东西。 */
  Nav.prototype._inertBackground = function (on) {
    var self = this;
    if (on) {
      if (this.inerted.length) return;
      each(document.body.children, function (n) {
        if (n === self.root || (n.contains && n.contains(self.root))) return;
        if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.tagName === 'LINK') return;
        if (!n.setAttribute) return;
        var had = n.getAttribute('aria-hidden');
        n.setAttribute('data-nav-had-hidden', had === null ? '' : had);
        n.setAttribute('aria-hidden', 'true');
        n.inert = true;
        self.inerted.push(n);
      });
    } else {
      each(this.inerted, function (n) {
        var had = n.getAttribute('data-nav-had-hidden');
        if (had) n.setAttribute('aria-hidden', had);
        else n.removeAttribute('aria-hidden');
        n.removeAttribute('data-nav-had-hidden');
        n.inert = false;
      });
      this.inerted = [];
    }
  };

  Nav.prototype.open = function () {
    if (this.isOpen()) return;
    this.fr.save();
    this.scrim.setAttribute('data-state', 'open');
    this.list.setAttribute('data-state', 'open');
    this.toggle.setAttribute('aria-expanded', 'true');
    this.toggle.setAttribute('aria-label', this.labelClose);

    /* 锁滚动：记下原来的**内联**值再覆盖，还原时才不会把使用者自己的
       `body{overflow:hidden}`（比如另一个模态开着）清成空。 */
    if (this.savedOverflow === null) {
      this.savedOverflow = document.body.style.overflow || '';
    }
    document.body.style.overflow = 'hidden';

    this._inertBackground(true);
    document.addEventListener('keydown', this.onKeydown, true);

    /* ① 焦点进入抽屉第一项 —— 键盘用户不能留在抽屉外面。 */
    var f = this._focusables();
    (f[0] || this.list).focus();

    flEmit(this.root, 'fl-nav-open', { root: this.root });
    if (this.opts.onOpen) this.opts.onOpen();
  };

  Nav.prototype.close = function () {
    if (!this.isOpen()) return;
    this.list.removeAttribute('data-state');
    this.scrim.removeAttribute('data-state');
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.setAttribute('aria-label', this.labelOpen);

    if (this.savedOverflow !== null) {
      document.body.style.overflow = this.savedOverflow;
      this.savedOverflow = null;
    }
    this._inertBackground(false);
    document.removeEventListener('keydown', this.onKeydown, true);

    /* ② 焦点归位（核里已处理"元素被移除/不可聚焦"两种降级）。 */
    this.fr.restore();

    flEmit(this.root, 'fl-nav-close', { root: this.root });
    if (this.opts.onClose) this.opts.onClose();
  };

  Nav.prototype._focusables = function () {
    var out = [];
    each(this.list.querySelectorAll(FOCUSABLE), function (el) {
      /* 只算真的看得见的：抽屉里可能有 display:none 的二级菜单项 */
      if (isVisible(el)) out.push(el);
    });
    return out;
  };

  /* ⑤ 焦点陷阱：Tab 在抽屉内循环。只有开着才拦 ——
     关着的时候用户要能正常 Tab 过整页。 */
  Nav.prototype._trap = function (e) {
    if (!this.isOpen()) return;
    var k = e.key;
    if (k !== 'Tab' && e.keyCode !== 9) return;
    var list = this._focusables();
    if (!list.length) { e.preventDefault(); this.list.focus(); return; }
    var first = list[0];
    var last = list[list.length - 1];
    var active = document.activeElement;
    if (e.shiftKey && (active === first || active === this.list)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  Nav.prototype.destroy = function () {
    if (!this.toggle || !this.list) return;
    this.close();
    this.toggle.removeEventListener('click', this.onToggleClick);
    this.list.removeEventListener('click', this.onListClick);
    window.removeEventListener('resize', this.onResize);
    if (this.dismiss) this.dismiss.destroy();
  };

  /* 列表要能被脚本聚焦（陷阱的空列表兜底会 focus 它） */
  Nav.attach = function (root, opts) {
    root.navInstance = new Nav(root, opts);
    return root.navInstance;
  };

  window.Nav = Nav;

  function init() {
    each(document.querySelectorAll('[data-nav]'), function (el) {
      if (!el.navInstance) Nav.attach(el, {});
    });
  }

  // @autoinit: [data-nav] —— 扫属性自动建实例（详见 README「自动初始化」）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
