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
    this.bind();
  }

  Tabs.prototype.enabled = function (tab) {
    return tab.getAttribute('aria-disabled') !== 'true';
  };

  Tabs.prototype.focusables = function () {
    return filter(this.tabs, this.enabled, this);
  };

  /* 🔴 roving 的核心：把 tabindex="0" 给 active，其余 -1 */
  Tabs.prototype.rove = function (target) {
    for (var i = 0; i < this.tabs.length; i++) {
      this.tabs[i].setAttribute('tabindex', this.tabs[i] === target ? '0' : '-1');
    }
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
    if (typeof this.opts.onChange === 'function') {
      this.opts.onChange(tab.getAttribute('data-value') || tab.id, tab);
    }
  };

  Tabs.prototype.step = function (from, delta) {
    var list = this.focusables();
    if (!list.length) return;
    var i = list.indexOf(from);
    if (i < 0) i = 0;
    // 循环：最后一个的下一个是第一个
    var n = (i + delta + list.length) % list.length;
    var next = list[n];
    if (this.manual) {
      // 手动模式：只移动焦点，**不切面板**
      this.rove(next);
      next.focus();
    } else {
      this.select(next, true);
    }
  };

  Tabs.prototype.edge = function (which) {
    var list = this.focusables();
    if (!list.length) return;
    var target = which === 'home' ? list[0] : list[list.length - 1];
    if (this.manual) { this.rove(target); target.focus(); }
    else this.select(target, true);
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
      var handled = true;

      if (k === 'ArrowRight' || (self.vertical && k === 'ArrowDown')) {
        self.step(tab, 1);
      } else if (k === 'ArrowLeft' || (self.vertical && k === 'ArrowUp')) {
        self.step(tab, -1);
      } else if (k === 'Home') {
        self.edge('home');
      } else if (k === 'End') {
        self.edge('end');
      } else if (k === 'Enter' || k === ' ') {
        // 手动模式下 Enter/Space 才激活
        if (self.manual) self.select(tab, false);
        else handled = false;      // automatic 模式交给 button 的默认行为
      } else {
        handled = false;
      }

      if (handled) {
        e.preventDefault();   // 阻止方向键滚动页面
        e.stopPropagation();
      }
    });
  };

  // 暴露
  window.Tabs = Tabs;

  // 自动初始化：<div class="tabs" data-tabs>
  function init() {
    var nodes = document.querySelectorAll('[data-tabs]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].tabsInstance = new Tabs(nodes[i], {
        onChange: nodes[i].getAttribute('data-on-change') || null
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
