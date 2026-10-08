/**
 * typeahead.js — 「首字母跳转 / 连续打字定位」微行为核
 *
 * ==========================================================================
 * 🔴 为什么要抽成核（实测，不是推测）
 * --------------------------------------------------------------------------
 *   迁移前只有两处实现，而它们**各做了一半**：
 *
 *     · select：累积多字符前缀（"co" ⇒ components），但**不循环** ——
 *       连按两次同一个字母，游标**不动**（用户以为卡了）
 *     · tree：  单字符跳转且会往后找，但**不累积** ——
 *       打 "co" 只会先跳到 c 项再跳到 o 项，永远到不了 "components"
 *
 *   ⇒ 两处都缺另一半，而且缺的**不是同一半**。
 *     这正是"同一件事写 N 份"的典型代价：没有一处是完整的，
 *     而"完整"这件事没有任何地方定义过。
 *
 * ==========================================================================
 * 边界（照 APG 的 typeahead 约定，不是我的设计）
 * --------------------------------------------------------------------------
 *   ① 打一个可打印字符 ⇒ 跳到**下一个**名称以该字符开头的项（会绕回）
 *   ② 快速连打多个字符 ⇒ 缓冲**累积**，按前缀匹配
 *   ③ 连打**同一个**字符 ⇒ 在匹配项之间**循环**（不是停在原地）
 *   ④ 停顿超过 `timeout`（默认 500ms）⇒ 缓冲清空，重新累积
 *   ⑤ 禁用项不参与匹配
 *   ⑥ 不匹配 ⇒ 不动焦点，也不报错（APG 不要求"没找到"有任何反馈）
 *
 * ==========================================================================
 * 用法
 * --------------------------------------------------------------------------
 *   var ta = flTypeahead({
 *     items:  function () { return options; },        // 候选集（按视觉顺序）
 *     textOf: function (x) { return x.textContent; }, // 项 → 用于匹配的文本
 *     usable: function (x) { return !x.disabled; },   // 可选：跳过禁用项
 *     timeout: 500,                                   // 缓冲保留时长（ms）
 *     onHit: function (i, item, buf) { setActive(i); }
 *   });
 *   ta.type(ch);        // 喂一个字符，返回命中索引（没命中 -1）
 *   ta.clear();         // 主动清空缓冲（关闭/重开时调）
 *   ta.destroy();       // 清掉定时器
 *
 * ⚠️ 核**不监听键盘**：什么时候算"打字"由组件决定
 *    （本组件的 Enter/Space/Tab 各有语义，核不该抢）。
 *
 * ==========================================================================
 * ⚠️ 注入块里的注释会**被复制进每个使用点**（gzip 也要算）
 * --------------------------------------------------------------------------
 *   ⇒ 长解释一律写在**本文件头**（BEGIN 标记之外），注入块内只留一行提示。
 *
 * ④ 为什么"连打同一个字符"要特判：不特判的话 buf 会变成 "bb"，
 *    而没有任何项以 "bb" 开头 ⇒ 连按两次同一个字母就再也匹配不上，
 *    用户眼里就是"按第二次没反应"。按首字符匹配 + 从当前项之后找 ⇒ 变成循环。
 * ④b 超时清空**只清缓冲、不清 last**：清空后重新打字仍应"从当前项往后找"，
 *    否则会突然跳回第一个匹配项（用户眼里就是"乱跳"）。
 *
 * ==========================================================================
 * 约束：ES5 · 零依赖 · 可被整块注入 · 不新增任何全局
 * ==========================================================================
 */
/* ==== BEHAVIOR CORE BEGIN: typeahead ==== */
var flTypeahead = function (opts) {
  var opt = opts || {};
  var items = opt.items || function () { return []; };
  var textOf = opt.textOf || function (x) { return String((x && x.textContent) || ''); };
  var usable = opt.usable || function () { return true; };
  var timeout = opt.timeout || 500;
  var onHit = opt.onHit || function () {};
  var buf = '';
  var timer = null;
  var last = -1;

  function stop() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  /* 连打同一字符 ⇒ 只按首字符匹配（理由见文件头 ③④）*/
  function repeated(s) {
    if (s.length < 2) return false;
    for (var i = 1; i < s.length; i++) {
      if (s.charAt(i) !== s.charAt(0)) return false;
    }
    return true;
  }

  function find(needle) {
    var l = items() || [];
    var n = l.length;
    if (!n) return -1;
    for (var k = 0; k < n; k++) {
      var i = (last + 1 + k) % n;      /* ① 从当前项之后开始 ⇒ 会绕回 */
      if (!usable(l[i])) continue;     /* ⑤ */
      if (textOf(l[i]).toLowerCase().indexOf(needle) === 0) return i;
    }
    return -1;                          /* ⑥ */
  }

  function type(ch) {
    if (!ch) return -1;
    buf += String(ch).toLowerCase();    /* ② */
    stop();
    timer = setTimeout(clear, timeout); /* ④ */
    var needle = repeated(buf) ? buf.charAt(0) : buf;   /* ③ */
    var i = find(needle);
    if (i >= 0) {
      last = i;
      onHit(i, (items() || [])[i], buf);
    }
    return i;
  }

  /* 只清缓冲，不清 last（理由见文件头）*/
  function clear() {
    buf = '';
    stop();
  }

  return {
    type: type,
    clear: clear,
    buffer: function () { return buf; },
    destroy: function () { stop(); },
  };
};
/* ==== BEHAVIOR CORE END: typeahead ==== */
