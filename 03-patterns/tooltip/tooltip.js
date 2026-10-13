/**
 * tooltip.js — 文字提示（B3 /
 *
 * ⭐ 三条硬要求：
 *   ① **键盘可达**：focus 时也要出（触屏没有 hover）
 *   ② **Esc 能关**（WCAG 1.4.13 Content on Hover or Focus）
 *   ③ ⛔ **不承载必要信息** —— 触屏没有 hover，只放 tooltip 等于不存在
 *
 * 无依赖 · ES5 · 用法：
 *   Tooltip.attach(el, '文字')            // 默认 bottom
 *   Tooltip.attach(el, '文字', 'top')     // 指定方位
 *   Tooltip.attach(el, '文字', 'start')   // 内联起点侧（RTL 下自动换到右边）
 *   Tooltip.attach(el, '文字', 'left')    // 物理左（RTL 下**仍是物理左**）
 *
 * 🔴 0.4.2 修了两个实测出来的既有缺陷（都不报错，只是"看着不对"）：
 *   ① `place='left'|'right'` 拼出的 `tooltip--left` / `--right` **CSS 里没有**
 *      （只有 --inset-inline-start / -end）⇒ 这两个方位**没有小三角**。
 *      ⇒ 现在按书写方向换算类名：物理左在 LTR 是内联起点、RTL 是内联终点。
 *   ② 定位前**先入 DOM 再量**：游离元素 getBoundingClientRect() 全是 0
 *      ⇒ top 方位与锚点完全重叠（实测 tip.top == anchor.top），左右上下偏半身。
 */
(function (global) {

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
  'use strict';

  var uid = 0;

  function ensureStyle() {
    if (document.getElementById('tooltip-css')) return;
    /* 说明：样式由页面通过 <link> 引入；这里只做"有没有"的提示，
       避免"以为引了其实没引"的静默失效。 */
  }

  function ensureLiveRegion() {
    var id = 'tooltip-live';
    var r = document.getElementById(id);
    if (r) return r;
    r = document.createElement('div');
    r.id = id;
    r.setAttribute('role', 'tooltip');
    /* ⭐ aria-live：内容变化时读屏会念出来
       （否则键盘用户看到的提示，盲用户听不到） */
    r.setAttribute('aria-live', 'polite');
    r.setAttribute('aria-atomic', 'true');
    r.style.cssText =
      'position:absolute;width:1px;height:1px;padding:0;margin:-1px;' +
      'overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';
    document.body.appendChild(r);
    return r;
  }

  /* 逻辑方位 ⇒ 类名后缀。CSS 里只有 --inset-inline-start / --inset-inline-end */
  var CLS = {
    top: 'top', bottom: 'bottom',
    start: 'inset-inline-start', end: 'inset-inline-end',
  };

  /**
   * 物理方位换算成逻辑方位。
   * 物理「左」在 LTR 里是内联起点，在 RTL 里是内联终点 ——
   * 不换算的话，RTL 下小三角会指向气泡外侧（见 tooltip.css 的注释）。
   */
  function resolve(el, place) {
    var p = place || 'bottom';
    if (p === 'top' || p === 'bottom' || p === 'start' || p === 'end') return p;
    if (p !== 'left' && p !== 'right') return 'bottom';
    var rtl = getComputedStyle(el).direction === 'rtl';
    if (p === 'left') return rtl ? 'end' : 'start';
    return rtl ? 'start' : 'end';
  }

  /**
   * 给元素挂一个 tooltip
   * @param {Element} el 触发元素
   * @param {string} text 提示文字
   * @param {string} [place] top / bottom / start / end（默认 bottom）；
   *                 left / right 也接受（物理方位，RTL 下按方向换算类名）
   */
  function attach(el, text, place) {
    /* 焦点归位核：在 show() 之前声明，避免读代码时误以为fr 还没定义。
       声明写在 attach 开头 ⇒ show()/hide() 用到时它一定已赋值。 */
    var fr = flFocusReturn({ fallback: el });
    if (!el || !text) return;
    ensureStyle();

    var pos = resolve(el, place);
    var id = 'tt' + (++uid);
    var tip = document.createElement('div');
    tip.id = id;
    tip.className = 'tooltip tooltip--' + CLS[pos];
    tip.setAttribute('role', 'tooltip');
    tip.textContent = text;

    var live = ensureLiveRegion();

    function show() {
      /* 🔴 打开的**这一刻**先记住焦点，关闭时才能还回去。
         必须在任何可能改变焦点的操作**之前**做（否则记到的是新元素）。 */
      fr.save();
      /* 🔴 定位前**必须先入 DOM**：游离元素的 getBoundingClientRect() 全是 0
         （实测：top 方位的气泡与锚点完全重叠，就是这么来的）。
         先挂上去、藏起来量，量完再显示。 */
      tip.style.visibility = 'hidden';
      tip.style.display = 'block';
      if (!tip.parentNode) document.body.appendChild(tip);

      var b = el.getBoundingClientRect();
      var t = tip.getBoundingClientRect();
      if (pos === 'top') {
        tip.style.top = (b.top - t.height) + window.pageYOffset + 'px';
        tip.style.left = (b.left + b.width / 2 - t.width / 2) + window.pageXOffset + 'px';
      } else if (pos === 'start' || pos === 'end') {
        var rtl = getComputedStyle(el).direction === 'rtl';
        /* start = 气泡在锚点的内联起点侧：LTR 靠左（右缘贴锚点左缘），
           RTL 靠右（左缘贴锚点右缘） */
        var x = (pos === 'start')
          ? (rtl ? b.right : b.left - t.width)
          : (rtl ? b.left - t.width : b.right);
        tip.style.left = x + window.pageXOffset + 'px';
        tip.style.top = (b.top + b.height / 2 - t.height / 2) + window.pageYOffset + 'px';
      } else {
        tip.style.top = (b.bottom + window.pageYOffset) + 'px';
        tip.style.left = (b.left + b.width / 2 - t.width / 2) + window.pageXOffset + 'px';
      }
      tip.style.visibility = '';       /* 交还给 CSS（data-state 控制显隐） */
      tip.setAttribute('data-state', 'open');
      live.textContent = text;
    }

    function hide() {
      tip.removeAttribute('data-state');
      live.textContent = '';
    }

    /* ① 键盘可达：focus 也出 */
    el.addEventListener('focus', show);
    el.addEventListener('blur', hide);

    /* 触屏：click 也出（没有 hover 的设备唯一入口）*/
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      if (tip.getAttribute('data-state') === 'open') hide(); else show();
    });

    /* ② Esc 能关（WCAG 1.4.13）+ 点击外部关闭
      🔴 0.8.6 收编到 dismissable 核（原先是手写的）：
      手写版是 `document.addEventListener('click', hide)` ——
      **冒泡阶段**判定"是不是外部"，于是点在浮层**内部**也会关掉气泡
      （点击应该能选中提示里的文字）。核把判定挂在 **document 捕获阶段**，
      并且把触发元素算进 `inside`，解决"点触发器刚打开就被关"的老坑。
      核同时负责"一次 Esc 只关最内层"（Esc 挂在元素上冒泡，不挂 document 捕获）。
      ⚠️ Esc 关闭后的焦点归位走 focus-return 核，不再手写 `el.focus()`：
         手写版在触发元素已被移除时会focus 一个不存在的元素。 */
    var dismiss = flDismissable({
      escOn: [el],
      inside: [el, tip],
      when: function () { return tip.getAttribute('data-state') === 'open'; },
      onDismiss: function (ev, reason) {
        hide();
        if (reason === 'esc') fr.restore();
      }
    });

    /* ③ 关联：aria-describedby（不是 aria-label ——
       label 是名字，describedby 是补充说明，语义不同）*/
    var cur = el.getAttribute('aria-describedby');
    el.setAttribute('aria-describedby', cur ? (cur + ' ' + id) : id);
    el.setAttribute('data-tooltip', text);
  }

  global.Tooltip = { attach: attach };
})(window);
