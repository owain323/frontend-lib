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
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      active = -1;
      if (opt.onOpen) opt.onOpen();
    }

    function close(restoreFocus) {
      /* ⭐ APG：Esc 关闭时**焦点必须还给按钮**，否则键盘用户迷路 */
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      active = -1;
      if (restoreFocus !== false && document.contains(btn)) btn.focus();
      if (opt.onClose) opt.onClose();
    }

    function focusAt(i) {
      var list = itemsOf(menu);
      if (!list.length) return;
      if (i < 0) i = list.length - 1;
      if (i >= list.length) i = 0;
      list.forEach(function (x) { x.classList.remove('is-active'); });
      list[i].classList.add('is-active');
      list[i].focus();
      active = i;
    }

    function current() {
      var list = itemsOf(menu);
      return active >= 0 ? list[active] : document.activeElement;
    }

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
      if (opt.onSelect) opt.onSelect(li.getAttribute('data-value') || li.textContent.trim(), li);
    });

    /* ---------- 键盘（APG Menu Button 全部契约）---------- */
    root.addEventListener('keydown', function (e) {
      var k = e.key;

      /* 按钮上：↓ / Enter / Space 打开并聚焦首项 */
      if (e.target === btn) {
        if (k === 'ArrowDown' || k === 'Enter' || k === ' ' || k === 'Spacebar') {
          e.preventDefault();
          open();
          focusAt(0);
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

      /* ① ↑↓ 移动（循环）*/
      if (k === 'ArrowDown') { e.preventDefault(); focusAt(active + 1); return; }
      if (k === 'ArrowUp')   { e.preventDefault(); focusAt(active - 1); return; }
      /* ⑤ Home / End 跳首末 */
      if (k === 'Home')      { e.preventDefault(); focusAt(0); return; }
      if (k === 'End')       { e.preventDefault(); focusAt(itemsOf(menu).length - 1); return; }

      /* ② Esc 关闭 + 归位 */
      if (k === 'Escape' || k === 'Esc') { e.preventDefault(); e.stopPropagation(); close(true); return; }

      /* ③ Tab 关闭（不拦截，让焦点自然走到下一个）*/
      if (k === 'Tab') { close(false); return; }

      /* ④ Enter / Space 激活 */
      if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        var li = current();
        if (li) li.click();
      }
    });

    document.addEventListener('click', function (e) {
      if (!root.contains(e.target) && !menu.hidden) close(false);
    });

    return { open: open, close: close, destroy: function () { menu.hidden = true; } };
  }

  global.Dropdown = { create: create };
})(window);
