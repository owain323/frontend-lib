/* ============================================================================
   Reveal 引擎 — 无框架依赖，语法刻意用 ES5
   ============================================================================
   🔴 为什么是 ES5：本库的 JS 会被 精简档 WebView（Chromium 97 级）加载，
      `const` / 箭头函数在那里是**语法错误**（整段不执行，不是降级）。
      `05-audit/es5-gate.py` 会守这条。

   🔴 为什么不自动接管（默认不 enable）
   ------------------------------------------------
      enable() 会把目标藏起来（opacity:0）。这是**有代价的决定**，
      必须由页面显式做出，不能由"引了脚本"隐式产生：
        ① 页面写 `<html data-reveal-auto>` ⇒ DOMContentLoaded 时自动 enable
        ② 或手动 `Reveal.enable()`
      不写就完全不动 —— 内容可见、位置不偏、零 JS 报错风险。

   🔴 兜底顺序（任何一步失败都不许留下"看不见的内容"）
   ------------------------------------------------
      ① 没有 IntersectionObserver ⇒ 全部直接显示
      ② prefers-reduced-motion   ⇒ 全部直接显示（不做淡入，见 CSS 注释）
      ③ 单个元素已 done           ⇒ unobserve，不再参与
      ④ 🆕 构造函数抛错           ⇒ try/catch 后全部直接显示
      ⑤ 🆕 2 秒看门狗             ⇒ 视口内仍未显示的强制显示

      ④⑤ 是 0.9.1 补的。此前 `data-reveal-ready` 先打上、再 new IntersectionObserver：
      构造函数一旦抛错（部分 WebView 有此问题），隐藏态已经生效而 revealAll()
      永远跑不到 ⇒ **整页空白**。这正是"隐藏态必须配兜底"那条的落点。
   ========================================================================= */
(function (global) {
  'use strict';

  var SELECTOR = '[data-reveal]';
  var GROUP_SELECTOR = '[data-reveal-children]';
  var STAGGER_MS = 40;      /* 40 × 6 = 240ms 播完一批，超过 300ms 会觉得慢 */
  var STAGGER_CAP = 6;      /* 封顶：不封顶时第 20 个元素要等 800ms 才动 */
  var THRESHOLD = 0.15;
  var WATCHDOG_MS = 2000;   /* 兜底看门狗：接管后 2s，视口内还没显示的强制显示 */
  var observer = null;
  var watchdog = null;

  function each(list, fn) {
    for (var i = 0; i < list.length; i++) { fn(list[i], i); }
  }

  function reduced() {
    return !!(global.matchMedia &&
              global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function markDone(el) { el.setAttribute('data-reveal-done', ''); }
  function clearDone(el) { el.removeAttribute('data-reveal-done'); }

  /* 把 data-reveal-children 的每个子元素变成独立目标，并写入错峰延迟 */
  function prepareGroups() {
    var groups = document.querySelectorAll(GROUP_SELECTOR);
    each(groups, function (group) {
      var dir = group.getAttribute('data-reveal-children') || 'up';
      var kids = group.children;
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (!k.hasAttribute('data-reveal')) {
          k.setAttribute('data-reveal', dir);
        }
        if (!k.hasAttribute('data-reveal-delay')) {
          var step = i < STAGGER_CAP ? i : STAGGER_CAP;
          k.style.setProperty('--reveal-delay', (step * STAGGER_MS) + 'ms');
        }
      }
    });
  }

  function revealAll() {
    each(document.querySelectorAll(SELECTOR), markDone);
  }

  function inViewport(el) {
    var vh = global.innerHeight || document.documentElement.clientHeight || 0;
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < vh;
  }

  /* 兜底一轮：只补「已经在视口里、却还没显示」的元素。
     🔴 为什么不直接 revealAll()：折叠线以下的元素本来就该等滚动，
        全显会让 reveal 退化成"进页面一次性淡入"，与协议不符。 */
  function watchdogSweep() {
    watchdog = null;
    each(document.querySelectorAll(SELECTOR), function (el) {
      if (el.hasAttribute('data-reveal-done')) { return; }
      if (inViewport(el)) { markDone(el); }
    });
  }

  function teardown() {
    if (watchdog) { global.clearTimeout(watchdog); watchdog = null; }
    if (observer) { observer.disconnect(); observer = null; }
    each(document.querySelectorAll(SELECTOR), function (el) {
      clearDone(el);
    });
    document.documentElement.removeAttribute('data-reveal-ready');
  }

  function enable() {
    var root = document.documentElement;
    if (observer) { return true; }           /* 幂等：重复调用不叠加观察 */

    prepareGroups();
    root.setAttribute('data-reveal-ready', '');

    if (!('IntersectionObserver' in global) || reduced()) {
      revealAll();
      return true;
    }

    /* 🔴 构造 + 注册都放进 try：这两步任何一步抛错，隐藏态已经生效，
       不兜底就是白屏。宁可全显，也不留看不见的内容。 */
    try {
      observer = new global.IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var en = entries[i];
          if (en.isIntersecting) {
            markDone(en.target);
            if (!en.target.hasAttribute('data-reveal-repeat')) {
              observer.unobserve(en.target);
            }
          } else if (en.target.hasAttribute('data-reveal-repeat')) {
            clearDone(en.target);
          }
        }
      }, { threshold: THRESHOLD, rootMargin: '0px 0px -8% 0px' });

      each(document.querySelectorAll(SELECTOR), function (el) {
        observer.observe(el);
      });
    } catch (e) {
      if (observer) {
        try { observer.disconnect(); } catch (e2) { observer = null; }
        observer = null;
      }
      revealAll();
      return true;
    }

    if (!watchdog) {
      watchdog = global.setTimeout(watchdogSweep, WATCHDOG_MS);
    }
    return true;
  }

  function disable() {
    teardown();
    revealAll();
  }

  function replay() {
    teardown();
    return enable();
  }

  global.Reveal = { enable: enable, disable: disable, replay: replay };

  function auto() {
    if (document.documentElement.hasAttribute('data-reveal-auto')) {
      enable();
    }
  }

  // @autoinit: conditional[data-reveal-auto] —— 只有 <html data-reveal-auto> 才 enable()；不写则完全不动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', auto, false);
  } else {
    auto();
  }
}(this));
