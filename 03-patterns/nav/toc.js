/* ============================================================================
   frontend-lib / 03-patterns / nav / toc.js
   长文目录：滚动时高亮当前节

   🔴 这是**从 04-recipes/longform 内联脚本提取并加固**的模块 ——
      那份是精简档 自包含产物，不能反过来引本文件（会造成循环依赖）。
      提取的目的：让 recipe 里的实现与库里的实现是同一套逻辑。

   依赖：无
   适用：精简档 / B / C（ES5）

   API：
     Toc.init({ links: '.toc a', sections: 'h2[id]' });   // 返回一个可调用的取消函数
   ========================================================================= */
(function (global) {
  'use strict';

  function raf(fn) {
    return (global.requestAnimationFrame || function (f) {
      return global.setTimeout(f, 16);
    })(fn);
  }

  function init(opts) {
    opts = opts || {};
    var linkSel = opts.links || '.toc a';
    var secSel = opts.sections || 'h2[id]';

    var linkEls = document.querySelectorAll(linkSel);
    var sections = document.querySelectorAll(secSel);
    if (!linkEls.length || !sections.length) { return function () {}; }

    var map = {};
    for (var i = 0; i < linkEls.length; i++) {
      var href = linkEls[i].getAttribute('href') || '';
      if (href.charAt(0) === '#') { map[href.slice(1)] = linkEls[i]; }
    }

    function mark(id) {
      for (var k in map) {
        if (Object.prototype.hasOwnProperty.call(map, k)) {
          map[k].removeAttribute('aria-current');
        }
      }
      if (map[id]) { map[id].setAttribute('aria-current', 'true'); }
    }

    /* ----------------------------------------------------------------
       判断"当前在第几节" —— **统一用计算，不用 IntersectionObserver**

       🔴 2026-10-02 修正一个真 bug（Owner 报"导航不跟随文章移动"）：

       旧实现用 IntersectionObserver + rootMargin:'-10% 0px -70% 0px'，
       靠 `seen[id] = isIntersecting` 增量维护。问题在于：

         **滚到两个 section 之间时，观察区里一个 section 都没有**
         ⇒ seen 全为 false ⇒ 不调 mark() ⇒ 高亮停在上一个不动。

       这不是边界情况，是**常态**——用户大部分时间就滚在两节之间。

       改成"取最后一个已滚过的 section"：任何滚动位置都有确定答案，
       不会出现"两个都不在观察区"的状态。

       为什么不用 IntersectionObserver 省 CPU：
         两者成本其实一样 —— scroll 监听也只在**滚动时**执行（已用 rAF 节流），
         不滚动时都不跑。为了一个"看起来更优"的方案换来正确性风险，不划算。
       ---------------------------------------------------------------- */
    function currentId() {
      var y = global.pageYOffset || document.documentElement.scrollTop || 0;
      /* 偏移 100px：标题滚到视口顶之前就认为进入该节，
         否则用户看标题时高亮还停在上一个 */
      var line = y + 100;
      var found = sections[0];
      for (var n = 0; n < sections.length; n++) {
        if (sections[n].offsetTop <= line) { found = sections[n]; } else { break; }
      }
      /* 滚到底部时高亮最后一节，否则最后一段永远不亮 */
      var doc = document.documentElement;
      if (global.innerHeight + y >= doc.scrollHeight - 2 && sections.length) {
        found = sections[sections.length - 1];
      }
      return found ? found.id : null;
    }

    var ticking = false;
    function update() {
      if (ticking) { return; }
      ticking = true;
      raf(function () {
        ticking = false;
        var id = currentId();
        if (id) { mark(id); }
      });
    }

    global.addEventListener('scroll', update, { passive: true });
    global.addEventListener('resize', update);
    /* 锚点跳转后浏览器不一定会触发 scroll，所以补一帧主动算一次 */
    global.addEventListener('hashchange', update);
    update();

    return function () {
      global.removeEventListener('scroll', update);
      global.removeEventListener('resize', update);
      global.removeEventListener('hashchange', update);
    };
  }

  global.Toc = { init: init };

})(window);
