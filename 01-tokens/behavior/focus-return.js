/**
 * focus-return.js — 「焦点归位」微行为核
 *
 * ==========================================================================
 * 🔴 为什么要抽成核（14 个组件 JS 实测）
 * --------------------------------------------------------------------------
 *   "记住当前焦点，关闭时还回去"被手写了 **6 处**，分布在 5 个文件
 *   （drawer / overlay / popover / dropdown / pagination）。
 *
 *   它看起来只有两行（存 activeElement、再 focus 回去），
 *   但每一处手写副本都要各自回答三个问题，而实测**每处答得都不一样**：
 *
 *     ① 要记的元素已经**不在文档里**了怎么办？（列表项被删了）
 *     ② 焦点本来就在 body 上，要不要记？
 *     ③ 还原失败（元素不可聚焦）要不要抛错？
 *
 *   ⇒ 于是 5 个组件有 5 种降级行为，其中至少一种是**静默把焦点丢在 body 上**
 *     （键盘用户要从页面开头重新 Tab，而开发者完全看不出来）。
 *
 * ==========================================================================
 * 边界
 * --------------------------------------------------------------------------
 *   只管"记住 / 归还"这一件事。
 *   不管：焦点陷阱（那是 dialog 的事）、初始焦点该落在哪、滚动锁。
 *
 * ==========================================================================
 * 用法
 * --------------------------------------------------------------------------
 *   var fr = flFocusReturn({ fallback: trigger });  // 原元素没了时的退路
 *   fr.save();        // 打开浮层**之前**调
 *   ...
 *   fr.restore();     // 关闭时调；还回去了返回 true
 *
 * ==========================================================================
 * ⚠️ 三个必须知道的实现细节（都是实测定下来的）
 * --------------------------------------------------------------------------
 *   ① **body 不当作目标**。焦点默认就在 body 上，记它等于没记，
 *      还原时也不会比"不动"更好。⇒ save() 记 null，restore() 退到 fallback。
 *   ② **还原前必须 document.contains 判一次**。元素被移除后 focus() 不报错，
 *      但**焦点不会动** ⇒ 用户以为还回去了，其实焦点掉在 body 上（静默失效）。
 *   ③ **restore() 之后清空**。否则第二次 restore 会把焦点又拽回同一个元素，
 *      打断用户**已经主动移走**的焦点。
 *
 * ==========================================================================
 * 约束：ES5 · 零依赖 · 可被整块注入 · 不新增任何全局
 * ==========================================================================
 */
/* ==== BEHAVIOR CORE BEGIN: focus-return ==== */
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
/* ==== BEHAVIOR CORE END: focus-return ==== */
