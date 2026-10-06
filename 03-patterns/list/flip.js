/* ============================================================================
   frontend-lib / 03-patterns / list / flip.js
   列表增删的 FLIP 动画

   依赖：无
   适用：精简档 / B / C

   🔴 为什么自己写，不用 auto-animate（2026-10-02 的决策，替代方案已评估）：

        项目：        auto-animate      自己写 FLIP
        体积          ~8 KB             ~1.5 KB
        协议尽调      必需              零风险
        依赖风险      供应链/更新       无
        能力          增删改 + 颜色 + 尺寸 + 表单值  只做"增删时其余项平滑移动"

     列表 pattern 真正需要的只有最后一列那一项。
     为不需要的能力引入第三方依赖，不划算。

   FLIP 原理（四步，约 40 行）：
     First  记录变化前的位置
     Last   DOM 变化后记录新位置
     Invert 用 transform 反向偏移回去（视觉上没动）
     Play   过渡到 transform: 0（看起来平滑移动）

   🔴 语法刻意用 ES5（无箭头函数 / const / let / 模板字符串）：
      精简档 是 某项目 上的 WebView，版本不确定。
   ========================================================================= */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------ 工具 */
  function forceReflow(el) {
    /* 强制浏览器重算布局并记录当前样式值。
       FLIP 的第三步（Invert）靠它把"反向偏移"这个中间态真正记录下来；
       少了这一步，浏览器会认为 transform "没变"而跳过过渡。

       读 offsetHeight 会强制同步布局 —— 这正是我们要的"副作用"。
       requestAnimationFrame **不能**替代它（rAF 不保证重排）。 */
    return el.offsetHeight;
  }

  function idOf(el) {
    /* 不用 dataset —— 兼容性更差的那个 API */
    return el.getAttribute('data-flip-id');
  }

  function prefersReducedMotion() {
    return global.matchMedia
        && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ------------------------------------------------------------ 核心 */
  /**
   * @param container  列表容器（它的**直接子元素**就是可动画项）
   * @param mutate     修改 DOM 的函数
   * @param opts       { enter: 淡入/上滑, leave: 淡出, duration: ms }
   *
   * 用法：
   *   flip(listEl, function () { listEl.removeChild(row); });
   */
  function flip(container, mutate, opts) {
    opts = opts || {};

    var DURATION = opts.duration || 260;
    var reduce = prefersReducedMotion();

    /* --- First：记录每个项变化前的位置 --- */
    var first = {};
    var kids = container.children;
    var i, el, id, box;

    for (i = 0; i < kids.length; i++) {
      el = kids[i];
      id = idOf(el);
      if (id) { first[id] = el.getBoundingClientRect(); }
    }

    /* --- 让调用方改 DOM --- */
    mutate();

    if (reduce) {
      /* 🔴 reduced-motion：**减弱，不是归零**（2026-10-02 修正）

         之前这里直接 return，等于"完全跳过" —— 与本库 CSS 层的策略
         （spinner 保留、骨架屏停止 = 减弱）自相矛盾。

         正确的做法是按"是否构成前庭刺激"来分：
           位移 / 缩放 / 旋转  → 有刺激，去掉
           opacity 淡入淡出     → 无刺激，保留

         所以 reduced-motion 下：其余项**直接落到新位置**（不做 FLIP），
         新增项**仍然淡入**，只是不位移。
      */
      for (i = 0; i < container.children.length; i++) {
        el = container.children[i];
        id = idOf(el);
        if (!id || first[id] !== undefined) { continue; }
        el.style.opacity = '0';
        el.style.transition = 'none';
        /* 同样用强制重排而不是 rAF —— 与下面 FLIP 主流程保持一致 */
        forceReflow(el);
        el.style.transition = 'opacity ' + DURATION + 'ms linear';
        el.style.opacity = '1';
      }
      return;
    }

    /* --- Last + Invert + Play --- */
    kids = container.children;
    for (i = 0; i < kids.length; i++) {
      el = kids[i];
      id = idOf(el);
      if (!id) { continue; }

      box = el.getBoundingClientRect();

      if (first[id] === undefined) {
        /* ---- 新增项：**只淡入，不位移** ----
           🔴 2026-10-02 修正：原来这里还加了 translateY(6px)。
           Owner 点"添加一条"时看到**文字重合了一瞬** —— 根因是：
           新项一边向上位移一边淡入，而它下方的旧行正往下滑开，
           两者在某一帧**交叉**，视觉上就是两行文字叠在一起。

           位移是这里唯一制造交叉的要素，去掉它即可。
           旧行照常 FLIP 滑开，新项原地淡入 —— 观感更干净。 */
        el.style.opacity = '0';
        el.style.transition = 'none';
        forceReflow(el);
        el.style.transition = 'opacity ' + DURATION + 'ms linear';
        el.style.opacity = '1';
        continue;
      }

      /* ---- 已有项：算出位移，反向偏移再过渡回 0 ---- */
      var dx = first[id].left - box.left;
      var dy = first[id].top - box.top;

      if (dx === 0 && dy === 0) { continue; }   /* 没动就别白跑一趟动画 */

      el.style.transition = 'none';
      el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';

      /* 🔴🔴 2026-10-02 修正一个**让动画完全不动**的经典错误（Owner 报"完全不动"）：

         原写法是「下一帧把 transform 设成**同一个值**」——
             el.style.transform = translate(dx,dy);
             rAF(→ el.style.transform = translate(dx,dy));   ← 值没变！
         浏览器看到 transform 没变化，**不播放过渡**，于是元素直接跳到新位置。

         而且 rAF **不保证**触发布局重算，所以第一步的"反向偏移"可能根本没被记录。

         正确做法（FLIP 标准流程）：
             1. transition:none + 设反向偏移
             2. **强制重排**（显式读一次布局，让浏览器记录当前值）
             3. 设 transition
             4. **把 transform 设回 ''（即 0）** —— 不是设成同样的偏移值
      */
      forceReflow(el);
      el.style.transition = 'transform ' + DURATION + 'ms ease-out';
      el.style.transform = '';                 /* 回到原位 = 视觉上"平滑滑过去" */

      /* 过渡结束后清掉内联样式 —— 否则会污染 hover / 后续布局 */
      global.setTimeout(function (node) {
        return function () { node.style.transition = ''; };
      }(el), DURATION + 20);
    }
  }

  /* ------------------------------------------------------------ 退场动画
     删除项不能直接 remove —— 那样其余项会"瞬间跳过去"，没有补间。
     正确：先淡出并让它留在原位，等动画结束再真正移除。 */
  function removeWithAnimation(container, el, done) {
    var reduce = prefersReducedMotion();
    var DURATION = 260;

    if (reduce) {
      /* 减弱，不是归零：**淡出保留**（opacity 无前庭刺激），
         只去掉 scale 缩放。 */
      el.style.transition = 'opacity ' + DURATION + 'ms linear';
      el.style.opacity = '0';
      global.setTimeout(function () {
        if (el.parentNode) { el.parentNode.removeChild(el); }
        if (done) { done(); }
      }, DURATION);
      return;
    }

    el.style.transition = 'opacity ' + DURATION + 'ms ease-in';
    el.style.opacity = '0';
    /* 轻微缩一下，给出"被移除"的反馈；不缩会像元素凭空消失 */
    el.style.transform = 'scale(0.97)';

    global.setTimeout(function () {
      if (el.parentNode) { el.parentNode.removeChild(el); }
      if (done) { done(); }
    }, DURATION);
  }

  global.FLIP = { flip: flip, remove: removeWithAnimation };

})(window);
