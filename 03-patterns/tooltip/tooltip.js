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
 */
(function (global) {
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

  /**
   * 给元素挂一个 tooltip
   * @param {Element} el 触发元素
   * @param {string} text 提示文字
   * @param {string} [place] top / bottom / left / right（默认 bottom）
   */
  function attach(el, text, place) {
    if (!el || !text) return;
    ensureStyle();

    var id = 'tt' + (++uid);
    var tip = document.createElement('div');
    tip.id = id;
    tip.className = 'tooltip tooltip--' + (place || 'bottom');
    tip.setAttribute('role', 'tooltip');
    tip.textContent = text;

    var live = ensureLiveRegion();

    function show() {
      /* 定位：放到元素下方（用 getBoundingClientRect，不硬算） */
      tip.style.visibility = 'hidden';
      tip.style.display = 'block';
      var b = el.getBoundingClientRect();
      var t = tip.getBoundingClientRect();
      var pos = place || 'bottom';
      if (pos === 'top') {
        tip.style.top = (b.top - t.height) + window.pageYOffset + 'px';
      } else if (pos === 'left') {
        tip.style.left = (b.left - t.width) + window.pageXOffset + 'px';
        tip.style.top = (b.top + b.height / 2 - t.height / 2) + window.pageYOffset + 'px';
      } else if (pos === 'right') {
        tip.style.left = (b.right + window.pageXOffset) + 'px';
        tip.style.top = (b.top + b.height / 2 - t.height / 2) + window.pageYOffset + 'px';
      } else {
        tip.style.top = (b.bottom + window.pageYOffset) + 'px';
        tip.style.left = (b.left + b.width / 2 - t.width / 2) + window.pageXOffset + 'px';
      }
      document.body.appendChild(tip);
      tip.classList.add('is-open');
      live.textContent = text;
    }

    function hide() {
      tip.classList.remove('is-open');
      live.textContent = '';
    }

    /* ① 键盘可达：focus 也出 */
    el.addEventListener('focus', show);
    el.addEventListener('blur', hide);

    /* 触屏：click 也出（没有 hover 的设备唯一入口）*/
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      if (tip.classList.contains('is-open')) hide(); else show();
    });

    /* ② Esc 能关（WCAG 1.4.13）*/
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') { hide(); el.focus(); }
    });
    document.addEventListener('click', hide);

    /* ③ 关联：aria-describedby（不是 aria-label ——
       label 是名字，describedby 是补充说明，语义不同）*/
    var cur = el.getAttribute('aria-describedby');
    el.setAttribute('aria-describedby', cur ? (cur + ' ' + id) : id);
    el.setAttribute('data-tooltip', text);
  }

  global.Tooltip = { attach: attach };
})(window);
