/*
 * theme-toggle.js — 明暗切换（零依赖 · ES5）
 *
 * ============================================================================
 * 🔴 这个文件是**生成的**，不要手改
 * ============================================================================
 * 由 `05-audit/gen-theme-js.py` 从 `01-tokens/tokens.css` 的
 * `@media (prefers-color-scheme: dark)` 段提取生成。
 *
 * ⚠️ 为什么要生成：
 *   我第一版**手写**了 20 个暗色令牌值，结果 **17 个与 tokens.css 不一致**，
 *   连名字都编错了（我写 `--warn` / `--danger-soft`，
 *   真名是 `--warning` / `--danger-bg`）。
 *
 *   ⇒ **令牌只有一个权威来源**。手写第二份 = 必然漂移，
 *     而且**两边都能自洽、测不出来**。
 *
 *   ⇒ 改 tokens.css 的暗色段之后，跑：
 *         python 05-audit/gen-theme-js.py
 *     `--check` 已接进门禁 ⇒ 漂移会变红。
 *
 * ============================================================================
 * 为什么需要它（真机实测提出的）
 * ============================================================================
 * 本库的令牌**只靠 `@media (prefers-color-scheme: dark)` 生效**
 * ⇒ 在手机上**只能靠改系统设置**看到暗色效果。
 * 反馈：「暗色的模式，这个是需要你这边提供开关，
 * 也就是网页的整个的开关，我才能看到的。」—— 合理。
 *
 * 这同时也是 **WCAG 1.4.3 的意图**：跟随系统是默认，
 * 但用户应当**能覆盖它**。
 *
 * 三态而非两态：跟随系统 / 亮 / 暗。
 * 「强制亮」也有意义（投影、外强光、OLED 省电）。
 */
(function () {
  'use strict';

  var KEY = 'fe-theme';            // 'light' | 'dark' | 'auto'
  var root = document.documentElement;

  /* 暗色令牌 —— **自动生成，共 27 个**。
     值与 tokens.css 的 dark 段严格一致。 */
  var DARK = {
    '--accent': '#7AA9DE',
    '--accent-hover': '#8FB8E6',
    '--accent-soft': '#1C2C3D',
    '--border-control': '#8A9099',
    '--border-decor': '#2A3038',
    '--border-decor-str': '#3A424C',
    '--danger': '#E07A6E',
    '--danger-bg': '#341D1A',
    '--danger-hover': '#F09A90',
    '--info': '#5B9BC4',
    '--info-bg': '#13242F',
    '--paper': '#14171A',
    '--scrim': 'rgba(0, 0, 0, 0.62)',
    '--scrollbar-thumb': '#6E747E',
    '--scrollbar-thumb-hov': '#7D828A',
    '--success': '#6FAA7A',
    '--success-bg': '#16241A',
    '--surface': '#1C2024',
    '--surface-raised': '#232830',
    '--surface-sunken': '#1A1D21',
    '--switch-on': '#3E6EA8',
    '--text-on-accent': '#0D1114',
    '--text-primary': '#E4E7EA',
    '--text-secondary': '#AEB6C0',
    '--text-tertiary': '#9BA3AD',
    '--warning': '#C99A3F',
    '--warning-bg': '#242A31',
  };

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

    // ① 令牌：显式写一遍（inline style，优先级最高，稳）
    //    🔴 用 removeProperty/setProperty 而不是 cssText，
    //    否则会把元素上其它内联样式一起清掉。
    for (var k in DARK) {
      if (!DARK.hasOwnProperty(k)) continue;
      if (dark) root.style.setProperty(k, DARK[k]);
      else root.style.removeProperty(k);
    }

    // ② 让 CSS 知道当前是暗色（供 :not([data-theme-current]) 之类的选择器用）
    root.setAttribute('data-theme-current', dark ? 'dark' : 'light');
    // mode=auto 时**不设** data-theme，保持"真跟随系统"
    if (mode === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);

    // ③ 主题色（iOS Safari 地址栏会跟着变）
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#14171a' : '#f6f7f8');
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
