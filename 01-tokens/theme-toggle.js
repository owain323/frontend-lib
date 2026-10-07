/*
 * theme-toggle.js — 明暗切换（零依赖 · ES5）
 *
 * ============================================================================
 * 🔴 这个文件里**没有任何色值** —— 一条都没有
 * ============================================================================
 * 以前它往 `:root` 上写 30 条 inline 属性来强制暗色。
 * 代价见 `docs/INVARIANT.md` I-4：inline style 压过**一切**样式表，
 * 使用者想覆盖 `--surface` 只能再加 `!important` 反击。
 *
 * ⇒ 为了让「手动开关」能用，我们把整个配色层抬到了样式表之上。
 *   这是为了一个按钮付出的代价，不值。
 *
 * 现在：**CSS 自己表达暗色，本文件只翻一个属性。**
 *
 *   @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }
 *   :root[data-theme="dark"] { … }            ← 由 05-audit/theme-sync.py 生成
 *
 * ⇒ 色值的真值仍然**只有一份**（tokens.css）；
 *   `[data-theme]` 段是生成的，漂移会被 `theme-sync.py --check` 抓到。
 *
 * ============================================================================
 * 三态而非两态：跟随系统 / 亮 / 暗
 * ============================================================================
 * 「强制亮」也有意义（投影、外强光、OLED 省电）。
 * 这也是 **WCAG 1.4.3 的意图**：跟随系统是默认，但用户应当**能覆盖它**。
 *
 * ============================================================================
 * 两个属性的分工（容易混，写清楚）
 * ============================================================================
 *   data-theme         = **使用者显式选的**（'light' | 'dark'）
 *                        auto 模式下**不设这个属性**，保持"真跟随系统"
 *   data-theme-current = **最终生效的**（'dark' | 'light'）
 *                        CSS 无法把"系统当前是暗色"表达成属性，
 *                        所以这个解析结果必须由 JS 落在 DOM 上。
 */
(function () {
  'use strict';

  var KEY = 'fe-theme';            // 'light' | 'dark' | 'auto'
  var root = document.documentElement;

  function read() {
    try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; }
  }
  function save(v) {
    try { localStorage.setItem(KEY, v); } catch (e) { /* 隐私模式会失败 */ }
  }

  function systemDark() {
    return typeof window.matchMedia === 'function' &&
           window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function apply(mode) {
    var dark = mode === 'dark' || (mode === 'auto' && systemDark());

    // ① 只翻属性。色值一律由 CSS 决定，本文件不持有任何一个。
    if (mode === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);

    // ② 解析结果落到 DOM（供 focus-ring.css 与图表适配层读）
    root.setAttribute('data-theme-current', dark ? 'dark' : 'light');

    // ③ 主题色（iOS Safari 地址栏会跟着变）
    //    ⚠️ 从 CSS 里**读**出来，不写死 —— 写死就是第二份真值（见 I-7）
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && typeof window.getComputedStyle === 'function') {
      var v = window.getComputedStyle(root).getPropertyValue('--paper');
      v = (v || '').trim();
      if (v) meta.setAttribute('content', v);
    }
  }

  var Theme = {
    get: function () { return read(); },
    isDark: function () {
      return document.documentElement.getAttribute('data-theme-current') === 'dark';
    },
    set: function (m) { save(m); apply(m); },
    toggle: function () { Theme.set(Theme.isDark() ? 'light' : 'dark'); },
    /** 三态循环：auto → light → dark → auto */
    cycle: function () {
      var cur = read();
      Theme.set(cur === 'auto' ? 'light' : (cur === 'light' ? 'dark' : 'auto'));
    },
  };
  window.Theme = Theme;

  // 系统主题变化时（仅 auto 模式要跟着变）
  if (typeof window.matchMedia === 'function') {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () { if (read() === 'auto') apply('auto'); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  function init() { apply(read()); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
