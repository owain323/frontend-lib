/**
 * roving.js — 「方向键游走」微行为核（roving tabindex）
 *
 * ==========================================================================
 * 🔴 为什么要抽成核（14 个组件 JS 实测）
 * --------------------------------------------------------------------------
 *   `tabindex` 被手写了 **33 处**，分布在 9 个文件，是数量最多的一项。
 *
 *   其中真正危险的不是"写了很多次"，而是**每一处自己决定边界行为**：
 *
 *     · 走到最后一个再按一次 ⇒ 有的绕回第一个，有的**停住**（同一库两种手感）
 *     · 禁用项 ⇒ 有的跳过，有的**停在上面不动**（用户以为卡了）
 *     · Home / End ⇒ 有的实现，有的**没实现**
 *     · 纵向 / 横向 ⇒ 有的只认 ↑↓，有的只认 ←→，有的两种都认
 *
 *   ⇒ 同一个"按 ↓"在不同组件里有不同结果。这种不一致**没有门禁会报**，
 *     只有键盘用户会遇到。
 *
 * ==========================================================================
 * 边界
 * --------------------------------------------------------------------------
 *   只管"一组项里焦点怎么走"。
 *   不管：展开/收起（那是 tree 自己的语义）、选中与激活的差别
 *   （APG 里 automatic 与 manual 的差别由组件决定 —— 本核只告诉它"移到第几项"）。
 *
 * ==========================================================================
 * 用法
 * --------------------------------------------------------------------------
 *   var roving = flRoving({
 *     container: listEl,              // 在哪里听 keydown
 *     items:   function () { return allTabs; },      // tabindex 全集（含禁用项）
 *     movable: function () { return enabledTabs; },  // 可移动子集（省略则用 items）
 *     nodeOf:  function (x) { return x.node; },      // 项 → DOM 节点（省略则项就是节点）
 *     axis:    'y',                   // 'x' ←→（默认） / 'y' ↑↓
 *     loop:    true,                  // 默认绕回
 *     homeEnd: true,                  // 默认支持 Home / End
 *     tabindex: true,                 // 默认接管 tabindex；false = 只接管步进
 *     onMove:  function (i, item, reason) { ... }    // reason: step / home / end
 *   });
 *   roving.rove(targetNode);          // 把 tabindex="0" 给目标，其余 -1
 *   roving.destroy();                 // 摘掉 keydown
 *
 * ==========================================================================
 * ⚠️ 四个必须知道的实现细节
 * --------------------------------------------------------------------------
 *   ① **items 与 movable 必须分开**。tabindex 要落在**全集**上（禁用项也得是 -1，
 *      否则 Tab 会停到禁用项上），但移动只在**可用子集**里进行。
 *      早期写法只用一个列表 ⇒ 禁用项要么能被方向键走到、要么 Tab 能停上去。
 *   ② **循环用取模，不要用 if 夹逼**。`((i + d) % n + n) % n` 对负数也对，
 *      而 `if (i < 0) i = n - 1` 在 d 的绝对值大于 n 时会错。
 *   ③ **核只负责 preventDefault + stopPropagation**，不替组件决定"移动后做什么"
 *      （激活还是只移焦点）—— 那是 APG 里 automatic / manual 的分工。
 *   ④ **"步进"与"roving tabindex"是两件事**，用 `tabindex: false` 分开。
 *      APG 菜单的菜单项按规范**全部 tabindex=-1**（焦点由程序移动，
 *      菜单项永远不占 Tab 位）⇒ 它要的是同一套步进/绕回/Home·End，
 *      但**不能**让核把某一项改成 0（会破坏"Tab 用来关闭菜单"这条契约）。
 *
 * ==========================================================================
 * ⚠️ 注入块里的注释会**被复制进每个使用点**（真金白银，gzip 也要算）
 * --------------------------------------------------------------------------
 *   ⇒ 长解释一律写在**本文件头**（BEGIN 标记之外），注入块内只留一行提示。
 *   ⇒ 同理：只暴露**有人用**的 API。初版多暴露了一个 `wrap()`
 *     （"越界就夹回边界"），实测零个使用点调用 ⇒ 它是被注入进 3 个组件的
 *     死代码，每个组件白背几百字节 ⇒ 删掉。真需要时从版本历史里找回来，
 *     别让使用点为"可能会用到"买单。
 *
 * ==========================================================================
 * 约束：ES5 · 零依赖 · 可被整块注入 · 不新增任何全局
 * ==========================================================================
 */
/* ==== BEHAVIOR CORE BEGIN: roving ==== */
var flRoving = function (opts) {
  var opt = opts || {};
  var container = opt.container;
  var all = opt.items || function () { return []; };
  var movable = opt.movable || all;
  var nodeOf = opt.nodeOf || function (x) { return x; };
  var axis = opt.axis || 'x';
  var loop = opt.loop !== false;
  var homeEnd = opt.homeEnd !== false;
  /* ④ tabindex: false ⇒ 只要步进，不要 roving tabindex（理由见文件头）*/
  var roveTab = opt.tabindex !== false;
  var onMove = opt.onMove || function () {};

  /* ① tabindex 落在**全集**上：禁用项也必须是 -1，否则 Tab 会停上去 */
  function rove(target) {
    if (!roveTab) return target;
    var l = all() || [];
    for (var i = 0; i < l.length; i++) {
      var n = nodeOf(l[i]);
      if (!n || !n.setAttribute) continue;
      n.setAttribute('tabindex', n === target ? '0' : '-1');
    }
    return target;
  }

  /* ② 取模循环：对负数、对 |d| > n 都对 */
  function step(i, d) {
    var n = (movable() || []).length;
    if (!n) return -1;
    if (loop) return ((i + d) % n + n) % n;
    var t = i + d;
    return (t < 0 || t >= n) ? -1 : t;
  }

  function indexOfNode(node) {
    var l = movable() || [];
    for (var i = 0; i < l.length; i++) {
      if (nodeOf(l[i]) === node) return i;
    }
    return -1;
  }

  function onKey(e) {
    var l = movable() || [];
    if (!l.length) return;
    var i = indexOfNode(e.target);
    if (i < 0) return;
    var k = e.key;
    var next = -1;
    var reason = 'step';

    if (axis === 'y') {
      if (k === 'ArrowDown') next = step(i, 1);
      else if (k === 'ArrowUp') next = step(i, -1);
    } else {
      if (k === 'ArrowRight') next = step(i, 1);
      else if (k === 'ArrowLeft') next = step(i, -1);
    }
    if (homeEnd && k === 'Home') { next = 0; reason = 'home'; }
    else if (homeEnd && k === 'End') { next = l.length - 1; reason = 'end'; }

    if (next < 0 || next >= l.length) return;
    /* ③ 只拦事件，不替组件决定移动后做什么 */
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    onMove(next, l[next], reason);
  }

  if (container) container.addEventListener('keydown', onKey);

  /* ⚠️ 只暴露有人用的东西（理由见文件头）*/
  return {
    rove: rove,
    step: step,
    indexOf: indexOfNode,
    destroy: function () {
      if (container) container.removeEventListener('keydown', onKey);
    },
  };
};
/* ==== BEHAVIOR CORE END: roving ==== */
