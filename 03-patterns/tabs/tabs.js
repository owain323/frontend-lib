/*
 * tabs.js — Tabs 的行为层（APG: Tabs Pattern）
 *
 * 语法刻意用 ES5（无箭头函数 / const / let / 模板字符串）——
 * 精简档（某项目 上的 WebView）版本不确定。
 *
 * 🔴 键盘契约（照抄 Radix / APG，不是我的设计）
 * ------------------------------------------------
 *     Tab        进入组时落在**当前选中**的 tab；再按 Tab 走到面板
 *     ArrowRight 下一个 tab（并激活）
 *     ArrowLeft  上一个 tab（并激活）
 *     ArrowDown  下一个（纵向）
 *     ArrowUp    上一个（纵向）
 *     Home       第一个 tab（并激活）
 *     End        最后一个 tab（并激活）
 *
 * 🔴 roving tabindex（本文件最容易写错的地方）
 * ------------------------------------------------
 * 一组 tab 里**只有一个** tabindex="0"，其余全是 -1。
 * 为什么要这样：否则 Tab 键会**逐个穿过所有 tab** ——
 * 一排 5 个 tab 要按 5 次 Tab 才能进内容。
 * roving 让整组只占**一个** Tab 停靠点，组内用方向键移动。
 *
 *   ⚠️ 而且这个唯一的 "0" 必须**跟着选中项走** ——
 *      激活某个 tab 时要把它的 tabindex 设为 0、把上一个设为 -1。
 *      只在初始化时设一次是最常见的 bug：用户激活第 3 个 tab 后，
 *      Tab 键还是会回到第 1 个。
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

  function toArray(x) { return Array.prototype.slice.call(x); }

  /* 🔴 刻意不用 Element.closest / Array.filter ——
     它们是 ES5 之后才有的（closest 还要 ES6 风格的 DOM 扩展），
     而本库要跑在**精简档（某项目 上的 WebView）**上，版本不确定。
     同目录的 list.js / overlay.js 也都避开这两个 ——
     一致比方便重要。 */
  function closest(el, sel) {
    while (el && el.nodeType === 1) {
      if (matches(el, sel)) return el;
      el = el.parentNode;
    }
    return null;
  }

  function matches(el, sel) {
    var fn = el.matches || el.msMatchesSelector || el.webkitMatchesSelector;
    return fn ? fn.call(el, sel) : false;
  }

  function filter(list, fn, self) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (fn.call(self, list[i], i, list)) out.push(list[i]);
    }
    return out;
  }

  function Tabs(root, opts) {
    this.root = root;
    this.opts = opts || {};
    this.list = root.querySelector('[role="tablist"]');
    if (!this.list) return;
    this.tabs = toArray(this.list.querySelectorAll('[role="tab"]'));
    this.panels = toArray(root.querySelectorAll('[role="tabpanel"]'));
    this.vertical = this.list.getAttribute('aria-orientation') === 'vertical';
    // automatic（默认）：方向键移动即激活；manual：只移动焦点
    this.manual = root.classList.contains('tabs--manual');

    /* 方向键游走走 roving 核（01-tokens/behavior/roving.js）。
       ⭐ 两个列表必须分开：
         items   = 全部 tab（含禁用）⇒ tabindex 也要给禁用项设成 -1，
                   否则 Tab 会停在禁用项上
         movable = 可用 tab ⇒ 方向键只在这里面移动，跳过禁用项 */
    var self = this;
    this.roving = flRoving({
      container: this.list,
      items: function () { return self.tabs; },
      movable: function () { return self.focusables(); },
      axis: this.vertical ? 'y' : 'x',
      onMove: function (i, tab) {
        if (self.manual) { self.rove(tab); tab.focus(); }   // manual：只移焦点
        else self.select(tab, true);                        // automatic：移动即激活
      },
    });
    this.bind();
  }

  Tabs.prototype.enabled = function (tab) {
    return tab.getAttribute('aria-disabled') !== 'true';
  };

  Tabs.prototype.focusables = function () {
    return filter(this.tabs, this.enabled, this);
  };

  /* 🔴 roving 的核心：把 tabindex="0" 给 active，其余 -1
     —— 实现已移到 roving 核，这里只做转发（规则只有一份）。 */
  Tabs.prototype.rove = function (target) {
    if (!this.roving) return;
    this.roving.rove(target);
  };
  Tabs.prototype.select = function (tab, focusIt) {
    if (!this.enabled(tab)) return;
    for (var i = 0; i < this.tabs.length; i++) {
      var on = this.tabs[i] === tab;
      this.tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      // APG：tab 的 id 与 panel 的 aria-labelledby / aria-controls 互指
      var pid = this.tabs[i].getAttribute('aria-controls');
      var panel = pid ? document.getElementById(pid) : null;
      if (!panel) {
        // 没有 aria-controls 时按顺序对应
        panel = this.panels[i] || null;
      }
      if (panel) {
        if (on) {
          panel.removeAttribute('hidden');
          panel.classList.add('tabs__panel--enter');
        } else {
          panel.setAttribute('hidden', '');
          panel.classList.remove('tabs__panel--enter');
        }
      }
    }
    this.active = tab;
    this.rove(tab);
    if (focusIt) tab.focus();
    flEmit(this.root, 'fl-change',
           { value: tab.getAttribute('data-value') || tab.id, tab: tab });
    if (typeof this.opts.onChange === 'function') {
      this.opts.onChange(tab.getAttribute('data-value') || tab.id, tab);
    }
  };

  Tabs.prototype.bind = function () {
    var self = this;

    // 初始化：激活 aria-selected="true" 的那个；没有就选第一个
    var initial = null;
    for (var i = 0; i < this.tabs.length; i++) {
      if (this.tabs[i].getAttribute('aria-selected') === 'true') {
        initial = this.tabs[i];
        break;
      }
    }
    this.select(initial || this.tabs[0], false);

    // 点击
    this.list.addEventListener('click', function (e) {
      var tab = closest(e.target, '[role="tab"]');
      if (!tab || !self.list.contains(tab)) return;
      if (!self.enabled(tab)) return;
      self.select(tab, false);
    });

    // 键盘
    this.list.addEventListener('keydown', function (e) {
      var tab = closest(e.target, '[role="tab"]');
      if (!tab) return;
      var k = e.key;

      /* ↑↓←→ 与 Home / End 已由 roving 核接管（见构造函数里的 flRoving），
         这里只剩 Enter / Space。
         ⚠️ automatic 模式下**不要** preventDefault —— 交给 button 的默认行为
         （它会触发 click ⇒ select）。只有 manual 模式才需要显式激活：
         那种模式下方向键只移了焦点，面板还没切。 */
      if (k !== 'Enter' && k !== ' ' && k !== 'Spacebar') return;
      if (self.manual) {
        e.preventDefault();
        self.select(tab, false);
      }
    });
  };

  // 暴露
  window.Tabs = Tabs;

  // 自动初始化：<div class="tabs" data-tabs>
  //
  // ⚠️ 这里**曾经**写过 `onChange: el.getAttribute('data-on-change')` ——
  //    它把一个**字符串**塞进了要求函数的位置，`select()` 里
  //    `typeof this.opts.onChange === 'function'` 永远不成立
  //    ⇒ 这个属性从第一天起就**从来没有生效过**，而且没有任何报错。
  //    现已删除：自动初始化不接回调，要收通知请用 `fl-change` 事件
  //    （见 API.md「事件」一节）。
  function init() {
    var nodes = document.querySelectorAll('[data-tabs]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].tabsInstance = new Tabs(nodes[i], {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
