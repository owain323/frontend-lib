/**
 * dropdown.js — 下拉菜单（B3 /
 *
 * 依据：APG Menu Button 模式
 *   ① ↑↓ 移动       ② Esc 关闭并**归位焦点**
 *   ③ Tab 关闭      ④ Enter/Space 激活
 *   ⑤ Home/End 跳首末
 *
 * 语义：role="menu" + role="menuitem"（APG 允许用 ul/li + role）
 * ⚠️ 只用 role=menu 时，读屏会进入"应用模式"（方向键导航）——
 *    这正是菜单想要的，但**必须**保证键盘契约完整，否则用户会被困住。
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

  /* ==== BEHAVIOR INJECT BEGIN: roving ==== */
  var flRoving = function (opts) {
    var opt = opts || {};
    var container = opt.container;
    var all = opt.items || function () { return []; };
    var movable = opt.movable || all;
    var nodeOf = opt.nodeOf || function (x) { return x; };
    var axis = opt.axis || 'x';
    var loop = opt.loop !== false;
    var homeEnd = opt.homeEnd !== false;
    /* ④ tabindex: false ⇒ 只要步进，不要 roving tabindex（理由见文件头）*/
    var roveTab = opt.tabindex !== false;
    var onMove = opt.onMove || function () {};

    /* ① tabindex 落在**全集**上：禁用项也必须是 -1，否则 Tab 会停上去 */
    function rove(target) {
      if (!roveTab) return target;
      var l = all() || [];
      for (var i = 0; i < l.length; i++) {
        var n = nodeOf(l[i]);
        if (!n || !n.setAttribute) continue;
        n.setAttribute('tabindex', n === target ? '0' : '-1');
      }
      return target;
    }

    /* ② 取模循环：对负数、对 |d| > n 都对 */
    function step(i, d) {
      var n = (movable() || []).length;
      if (!n) return -1;
      if (loop) return ((i + d) % n + n) % n;
      var t = i + d;
      return (t < 0 || t >= n) ? -1 : t;
    }

    function indexOfNode(node) {
      var l = movable() || [];
      for (var i = 0; i < l.length; i++) {
        if (nodeOf(l[i]) === node) return i;
      }
      return -1;
    }

    function onKey(e) {
      var l = movable() || [];
      if (!l.length) return;
      var i = indexOfNode(e.target);
      if (i < 0) return;
      var k = e.key;
      var next = -1;
      var reason = 'step';

      if (axis === 'y') {
        if (k === 'ArrowDown') next = step(i, 1);
        else if (k === 'ArrowUp') next = step(i, -1);
      } else {
        if (k === 'ArrowRight') next = step(i, 1);
        else if (k === 'ArrowLeft') next = step(i, -1);
      }
      if (homeEnd && k === 'Home') { next = 0; reason = 'home'; }
      else if (homeEnd && k === 'End') { next = l.length - 1; reason = 'end'; }

      if (next < 0 || next >= l.length) return;
      /* ③ 只拦事件，不替组件决定移动后做什么 */
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      onMove(next, l[next], reason);
    }

    if (container) container.addEventListener('keydown', onKey);

    /* ⚠️ 只暴露有人用的东西（理由见文件头）*/
    return {
      rove: rove,
      step: step,
      indexOf: indexOfNode,
      destroy: function () {
        if (container) container.removeEventListener('keydown', onKey);
      },
    };
  };
  /* ==== BEHAVIOR INJECT END: roving ==== */

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

  var FOCUSABLE = 'li[role="menuitem"]:not([aria-disabled="true"])';

  function itemsOf(menu) {
    return Array.prototype.slice.call(menu.querySelectorAll(FOCUSABLE));
  }

  function create(root, opt) {
    opt = opt || {};
    var btn = root.querySelector('[data-dd-btn]') || root.querySelector('button');
    var menu = root.querySelector('[data-dd-menu]');
    if (!btn || !menu) throw new Error('dropdown: 缺少 [data-dd-btn] 或 [data-dd-menu]');

    /* 焦点归位核：open() 时 save()、close() 时 restore()。
       原先是 `btn.focus()` + `document.contains(btn)` 手写判存活，
       核内部做的就是这件事（元素被移除 ⇒ 退到 fallback）。 */
    var fr = flFocusReturn({ fallback: btn });
    var active = -1;

    /* APG：菜单要么全 aria-hidden，要么全不设 —— 不能半吊子 */
    menu.setAttribute('role', 'menu');
    if (!menu.getAttribute('aria-label') && !menu.getAttribute('aria-labelledby')) {
      menu.setAttribute('aria-label', opt.label || '菜单');
    }
    Array.prototype.forEach.call(menu.querySelectorAll('li'), function (li) {
      /* 🔴 修一个**静默失效**（实测发现）：
         demo 的 <li> 上**根本没有 dd__item 类** ⇒ CSS 里的
         `height: 44px` / 内边距 / hover **全部没生效**
         ⇒ 实测每项只有 24px（浏览器默认行高）。
         ⚠️ 这类问题在页面上"看着还行"，只有量尺寸才发现。
         ⇒ 正解：JS 在初始化时**补上语义类**，不依赖作者手写。
            （组件级 class 由组件自己管，比要求每个使用者记得写更可靠。） */
      if (!li.hasAttribute('data-dd-sep') &&
          String(li.className).indexOf('dd__item') < 0) {
        li.className = li.className ? (li.className + ' dd__item') : 'dd__item';
      }
      if (li.hasAttribute('data-dd-sep')) {
        li.setAttribute('role', 'separator');
        li.setAttribute('aria-hidden', 'true');
      } else if (!li.hasAttribute('role')) {
        li.setAttribute('role', 'menuitem');
        /* tabindex="-1"：菜单项**不参与 Tab 序列**
           （APG：Tab 用来**关闭菜单**，方向键才在项间移动）*/
        li.setAttribute('tabindex', '-1');
      }
    });

    function open() {
      /* 打开这一刻先记焦点，close() 才能还回去。 */
      fr.save();
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      active = -1;
      /* ⭐ 聚焦首项必须放在 open() 里，不能只写在键盘分支。
         读屏用户在浏览模式下按 Enter，NVDA 会把它变成**一次点击**，
         走的是 click 分支 ⇒ 键盘分支里的 `focusAt(0)` 根本没机会执行，
         焦点留在按钮上，菜单项永远进不去（真机用 NVDA + Edge 实测过）。
         APG 的菜单按钮也是这样：打开即把焦点交给第一项。 */
      focusAt(0);
      /* 每次打开都从空缓冲开始：上次关菜单前打了一半的前缀不该留到这次 */
      typeahead.clear();
      flEmit(root, 'fl-open', null);
      if (opt.onOpen) opt.onOpen();
    }

    function close(restoreFocus) {
      /* ⭐ APG：Esc 关闭时**焦点必须还给按钮**，否则键盘用户迷路 */
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      active = -1;
      typeahead.clear();
      if (restoreFocus !== false) fr.restore();
      flEmit(root, 'fl-close', null);
      if (opt.onClose) opt.onClose();
    }

    function focusAt(i) {
      var list = itemsOf(menu);
      if (!list.length) return;
      if (i < 0) i = list.length - 1;
      if (i >= list.length) i = 0;
      list.forEach(function (x) { x.removeAttribute('data-state'); });
      list[i].setAttribute('data-state', 'active');
      list[i].focus();
      active = i;
    }

    function current() {
      var list = itemsOf(menu);
      return active >= 0 ? list[active] : document.activeElement;
    }

    /* ↑↓ 与 Home / End 走 roving 核（01-tokens/behavior/roving.js）。
       ⭐ tabindex: false —— 本组件按 APG **不用** roving tabindex：
         菜单项永远是 tabindex="-1"，焦点由程序移动，Tab 的作用是**关闭菜单**。
         若让核把某一项改成 "0"，菜单里就会多出一个 Tab 停靠点，
         「Tab 用来关闭菜单」这条契约当场失效（dropdown-check 第 41 行在守）。
       ⇒ 要的是同一套**步进 / 绕回 / Home·End**，不是同一套 tabindex。 */
    var roving = flRoving({
      container: root,
      items: function () { return itemsOf(menu); },
      axis: 'y',
      tabindex: false,
      onMove: function (i) { focusAt(i); },
    });

    /* ⑥ 打字跳项 —— APG Menu 的 `(Optional)` 项，走 typeahead 核。
       匹配**可见文本**，但先剥掉开头的装饰符号：带勾选的项文本是
       "✓ 按日期"，不剥的话打"按"永远匹配不到（同 table 列头 ↕ 那一类问题）。
       ⚠️ 中文标签实际上打不出来：IME 走 keydown 时 key 是 Process / Unidentified。
          这条是给拉丁字母标签的菜单用的 —— APG 的 typeahead 本来就是这个前提，
          所以判据用一张英文夹具页测（见 dropdown-check ⑥）。 */
    var typeahead = flTypeahead({
      items: function () { return itemsOf(menu); },
      textOf: function (el) {
        var s = String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
        return s.replace(/^[^0-9A-Za-z\u4e00-\u9fa5]+/, '');
      },
      usable: function (el) { return el.getAttribute('aria-disabled') !== 'true'; },
      onHit: function (i) { focusAt(i); },
    });

    /* ---------- 按钮 ---------- */
    /* 🔴 修：原来先 `setAttribute('aria-controls', menu.id || '')`
       **再**给 menu.id ⇒ aria-controls 永远拿到空串。
       ⇒ 顺序必须反过来：**先确保有 id，再引用**。 */
    if (!menu.id) menu.id = 'dd-menu-' + (new Date()).getTime();
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', menu.id);

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.hidden) open(); else close();
    });

    /* ---------- 菜单项 ---------- */
    menu.addEventListener('click', function (e) {
      var li = e.target.closest ? closest(e.target, '[role="menuitem"]') : null;
      if (!li) return;
      e.stopPropagation();
      if (li.getAttribute('aria-disabled') === 'true') return;
      close();                          /* 激活后关闭 + 归位 */
      flEmit(root, 'fl-select',
             { value: li.getAttribute('data-value') || li.textContent.trim(), item: li });
      if (opt.onSelect) opt.onSelect(li.getAttribute('data-value') || li.textContent.trim(), li);
    });

    /* ---------- 键盘（APG Menu Button 全部契约）---------- */
    root.addEventListener('keydown', function (e) {
      var k = e.key;

      /* 按钮上：↓ / Enter / Space 打开（聚焦首项已由 open() 负责） */
      if (e.target === btn) {
        if (k === 'ArrowDown' || k === 'Enter' || k === ' ' || k === 'Spacebar') {
          e.preventDefault();
          open();
        }
        return;
      }

      /* 🔴 修一个**静默失效的真 bug**：
         原来写的是 `e.target.closest !== menu`
         ⇒ `e.target.closest` 是**函数本身**（没加括号！），
           它永远不等于 menu ⇒ 这个 if **永远为真** ⇒ 每次都提前 return
         ⇒ **整个键盘导航（↑↓ Esc Home End）全部失效**，而且不报任何错。
         ⚠️ 这类 bug 最危险：功能看起来"有实现"，实际一行都没跑到。
         ⇒ 正解：`closest(e.target, '[data-dd-menu]')`（**加括号调用**）。 */
      if (closest(e.target, '[data-dd-menu]') !== menu) return;

      /* ① ↑↓ 移动（循环）· ⑤ Home / End 跳首末
         ⇒ 已移到 roving 核（见上面的 flRoving），这里不再重复实现。
            ⚠️ 不要在这里再写一遍：核与组件挂在**同一个 root** 上，
               两个监听器都会跑 ⇒ 一次按键走两步。 */

      /* ② Esc 关闭 + 归位 —— 已移到 dismissable 核（01-tokens/behavior/dismissable.js）。
         留在原地会**关两次**（同一元素上的两个监听器，stopPropagation 挡不住
         同级的另一个监听器，那是 stopImmediatePropagation 的活）⇒ onClose 被调两遍。 */

      /* ③b 可打印字符 ⇒ 跳到名字以它开头的项（APG 的 (Optional) 项）
         · 空格排除：它的语义是"激活当前项"（下面 ④）
         · 带 Ctrl / Meta / Alt 排除：那是浏览器快捷键
         · isComposing 时排除：中文输入法正在组字，不能抢 */
      if (k.length === 1 && k !== ' ' &&
          !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
        e.preventDefault();
        typeahead.type(k);
        return;
      }

      /* ③ Tab 关闭（不拦截，让焦点自然走到下一个）*/
      if (k === 'Tab') { close(false); return; }

      /* ④ Enter / Space 激活 */
      if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        var li = current();
        if (li) li.click();
      }
    });

    /* Esc / 点击外部关闭：走 dismissable 核（01-tokens/behavior/dismissable.js）。
       ⚠️ 外部点击必须归位焦点吗？不 —— APG 只在 **Esc** 时要求归还，
       点外面是用户主动去别处，抢回焦点反而打断他。⇒ onDismiss 按 reason 分。 */
    var dismiss = flDismissable({
      escOn: [root],
      inside: [root],
      when: function () { return !menu.hidden; },
      onDismiss: function (e, reason) { close(reason === 'esc'); },
    });

    return {
      open: open,
      close: close,
      destroy: function () {
        roving.destroy(); dismiss.destroy(); typeahead.destroy();
        menu.hidden = true;
      },
    };
  }

  global.Dropdown = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
