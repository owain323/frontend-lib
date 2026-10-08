/**
 * dismissable.js — 「关得掉」微行为核
 *
 * ==========================================================================
 * 🔴 为什么要抽成核（数字是实测的，复算命令见本项目更新日志）
 * --------------------------------------------------------------------------
 *   抽之前，14 个组件 JS 里：
 *     · Esc 关闭      手写了 10 处，分布在 7 个文件
 *     · 点击外部关闭   手写了 7 处，分布在 7 个文件
 *
 *   同一件事写 7 份 ⇒ 改一处要改 7 处 ⇒ 必然漏（见 I-14）。
 *   更难看的是**漏了没人知道**：popover 曾因为 `contains` 没把触发元素算进去，
 *   导致"点触发器刚打开就被关掉" —— 这种 bug 会在每个手写副本里各犯一遍。
 *
 * ==========================================================================
 * 边界：只管"关得掉"，不管别的
 * --------------------------------------------------------------------------
 *   ① Esc 关闭
 *   ② 点击浮层之外关闭
 *   不管：焦点归位（focus-return 核）、滚动锁、动画。
 *   一个核只做一件事 —— 否则它就变成另一个"什么都管"的大文件。
 *
 * ==========================================================================
 * 用法
 * --------------------------------------------------------------------------
 *   var d = flDismissable({
 *     escOn:  [box, trigger],                       // 在这些元素上听 Esc
 *     inside: [box, anchor],                        // 点在这些里面 ⇒ 不算"外部"
 *     when:   function () { return opened; },       // 只有开着才响应
 *     onDismiss: function (ev, reason) { close(); } // reason: 'esc' | 'outside'
 *   });
 *   d.destroy();     // 必须成对调用，否则监听器与栈都会泄漏
 *
 * ==========================================================================
 * ⚠️ 三个必须知道的实现细节（都是实测踩出来的，改之前先读）
 * --------------------------------------------------------------------------
 *   ① **Esc 挂在元素上（冒泡阶段），不是挂在 document 上**：
 *      冒泡从最内层往外走 ⇒ 最内层先收到 ⇒ 它 stopPropagation 之后
 *      外层的 dialog 就收不到 ⇒ 一次 Esc 只关最内层。
 *      （挂在 document 捕获阶段会**先**触发 ⇒ 分不清内外层 ⇒ 两层一起关）
 *
 *   ② **外部点击必须挂在 document 捕获阶段**：
 *      组件自己的 click 先跑、再轮到"是不是外部"的判定，
 *      否则点触发器会被判成外部点击 ⇒ 刚打开就关掉（popover 踩过）。
 *
 *   ③ **栈必须挂在 window 上，不能写在闭包里**：
 *      本核会被 05-audit/gen-behavior.py 整块注入进多个组件文件，
 *      每个组件拿到的是**各自的副本**（各自闭包）。
 *      栈若写在闭包里 ⇒ 两个组件各维护一个栈 ⇒ 嵌套时 ① 的语义失效。
 *
 *   栈的取舍（如实写明）：同一时刻**只允许一个非模态浮层打开**
 *   （本库既有约定，popover 的 open() 会先关掉别的），
 *   在此前提下"取最后一个活跃的记录"与"取最后打开的那个"等价。
 *
 * ==========================================================================
 * 约束：ES5 · 零依赖 · 可被整块注入 · 不污染除 __flDismiss 外的任何全局
 * ==========================================================================
 */
/* ==== BEHAVIOR CORE BEGIN: dismissable ==== */
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
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    onDismiss(e, 'esc');
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
/* ==== BEHAVIOR CORE END: dismissable ==== */
