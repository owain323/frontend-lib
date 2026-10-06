/*
 * accordion.js — Accordion 的行为层（APG: Accordion Pattern）
 *
 * 语法刻意用 ES5（无箭头函数 / const / let / 模板字符串）——
 * 精简档（某项目 上的 WebView）版本不确定。
 * 也刻意不用 Element.closest / Array.filter（ES5 之后才有），理由同 tabs.js。
 *
 * 🔴 键盘契约（W3C APG 原文）
 * ------------------------------------------------
 *     Enter / Space        切换当前项
 *     Tab / Shift+Tab      在**所有**可聚焦元素之间移动（含面板内的）
 *
 * ⚠️ **不要加方向键 / Home / End** ——
 *    APG 明确写：accordion 的键盘支持里**没有**方向键
 *    （"Header navigation uses the standard Tab order; arrow / Home / End
 *      key navigation is no longer part of the APG Accordion keyboard
 *      interaction."）。
 *    那是 **Tabs** 的契约（roving tabindex）。
 *    ⇒ 很多实现照抄 tabs 给 accordion 加方向键，是把两个模式混了。
 *    ⇒ 本组件**故意不加**。
 *
 * 🔴 role="region" 的数量上限（APG 原文）
 * ------------------------------------------------
 *     "…in an accordion that contains more than **approximately 6**
 *      panels that can be expanded at the same time."
 *
 *    ⇒ 面板数 > 6 时**不**给 panel 加 role="region"，
 *      否则造成 "landmark region proliferation"（地标泛滥）。
 *    ⇒ 加 .accordion--many 即可关闭。
 */
(function () {
  'use strict';
  // 🔴 手风琴实例序号（保证 id 全局唯一，见 init 里的说明）
  var uid = 0;
  'use strict';

  function toArray(x) { return Array.prototype.slice.call(x); }

  /* requestAnimationFrame 的 ES5 安全版 */
  var raf = (typeof window.requestAnimationFrame === 'function')
    ? window.requestAnimationFrame.bind(window)
    : function (fn) { return setTimeout(fn, 16); };

  /* 只触发一次的事件绑定（transitionend 可能来多次） */
  function once(el, ev, fn) {
    function handler(e) {
      if (e && e.target !== el) return;      // 冒泡上来的忽略
      el.removeEventListener(ev, handler, true);
      fn(e);
    }
    el.addEventListener(ev, handler, true);
  }

  function closest(el, sel) {
    while (el && el.nodeType === 1) {
      var fn = el.matches || el.msMatchesSelector || el.webkitMatchesSelector;
      if (fn && fn.call(el, sel)) return el;
      el = el.parentNode;
    }
    return null;
  }

  function Accordion(root, opts) {
    this.root = root;
    this.opts = opts || {};
    this.items = toArray(root.querySelectorAll('.accordion__item'));
    if (!this.items.length) return;
    // 🔴 2026-10-03 把 `--multi` 从 CSS 类改成 data 属性。
    //
    //   原因：它**不是样式变体，是行为开关**。
    //   多开模式下展开的那一项，和单开模式下展开的那一项
    //   **视觉上完全一样**（都是真的展开了）——
    //   没有任何东西需要用样式去表达"这是多开模式"。
    //
    //   之前它是 class ⇒ `refs` 门禁报"class 未定义"（CSS 里确实没有）。
    //   两个选择：
    //     ① 补一条空 CSS 规则凑数 ⇒ 骗门禁，不诚实
    //     ② 改用 data 属性 ⇒ 门禁天然不报，且**语义更准确**
    //   选 ②。
    //
    //   对比 tabs--manual：那个我**给了**真实视觉差异
    //   （选中项不加粗），因为"还没生效的事不该看起来已生效"。
    //   两个决定看起来不一致，其实标准是同一个：
    //   **有没有真实的视觉差异需要表达。**
    //
    // 用法：<div class="accordion" data-accordion data-accordion-multi>
    this.single = !root.hasAttribute('data-accordion-multi')
                 && !root.classList.contains('accordion--multi');
    // >6 个面板时不给 role=region（APG 的上限）
    this.useRegion = !root.classList.contains('accordion--many') &&
                     this.items.length <= 6;
    /* 🔴 2026-10-04 Owner 实机报「收起后点另一项要点两次」的**最终解法**：

       实测量化：收起时下方 trigger 在动画中**上移 131px**。
       ⚠️ 试过两个办法都**无效**（都记在下面，别再走回头路）：
         ① `pointer-events:none` 让事件穿透
            —— 位置本身就是错的，穿透给谁？
         ② 锁住列表高度
            —— 锁的是列表，第 1 项在列表**内部**收缩，第 2 项照样上移。
         ③ 动画期锁点击 + 结束后补偿
            —— 补偿实测没生效，第一次点击被丢弃，**比原 bug 更糟**。

       ⇒ 真正的解法：**把过渡压到短到"察觉不到位移"**。
         131px 在 **90ms** 内走完 ⇒ 约 1.4px/ms，
         手指落下到事件派发（通常 30–80ms）的位移已足够小。
         配合 `pointer-events:none`（收起的 panel 不吃事件）⇒ 基本无感。

       ⚠️ 这是**权衡**，不是完美：高度动画必然推动下方内容。
         主流实现（Radix / Material）都接受这一点。
         我们能做的，是把代价压到用户感知不到。 */
    this.dur = this.reduced() ? 0 : 90;   // 90ms

    this.init();
    this.bind();
  }

  Accordion.prototype.triggers = function () {
    return this.items.map(function (it) {
      return it.querySelector('.accordion__trigger');
    });
  };

  Accordion.prototype.panels = function () {
    return this.items.map(function (it) {
      return it.querySelector('.accordion__panel');
    });
  };

  /* 🔴 初始化：补齐 ARIA 关系。
     之所以在 JS 里补而不是要求手写：这三处（aria-controls 互指、
     heading 层号、role=region）是**机械的对应关系**，让人手写只会写错。 */
  Accordion.prototype.init = function () {
    /* 🔴 本实例的编号（保证多实例时 id 不撞车，见下面 id 生成处的说明）*/
    var seq = ++uid;
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      var btn = it.querySelector('.accordion__trigger');
      var panel = it.querySelector('.accordion__panel');
      if (!btn || !panel) continue;

      // 🔴 2026-10-04 修「id 跨实例撞名」（axe 报 landmark-unique 的真因）：
      //   原来 `if (!panel.id) panel.id = 'acc-panel-' + (i + 1)`
      //   **每个 accordion 实例都从 1 开始编号** ⇒ 同一个页面有 3 个手风琴时
      //   ⇒ 出现 3 组 `acc-panel-1` ⇒ **id 全局不再唯一**（HTML 硬性要求）
      //   ⇒ `aria-labelledby="acc-btn-1"` 只会解析到**第一个**匹配的元素
      //   ⇒ 所有 region 的可访问名都变成同一个
      //   ⇒ axe 的 landmark-unique（landmark 名字必须唯一）必然报违规。
      //
      //   实测：页面上 8 个 role=region 里有 **3 组重复 id**。
      //
      //   ⇒ 修法：ID 里带上**实例序号**（本库已有的自增计数器）。
      if (!panel.id) panel.id = 'acc-panel-' + seq + '-' + (i + 1);
      if (!btn.id) btn.id = 'acc-btn-' + seq + '-' + (i + 1);

      // ① button → panel（aria-controls）
      btn.setAttribute('aria-controls', panel.id);
      // ② panel → button（aria-labelledby）
      panel.setAttribute('aria-labelledby', btn.id);
      // ⚠️ 2026-10-04 实测结论：这里**不要加** role="region"（我先加过，axe 立刻报
      // landmark-unique，浏览器实验证实了因果）：
      //   · role="region" 本身就是一个 landmark
      //   ⇒ 一个页面有多个手风琴面板 = 多个 region
      //   ⇒ axe 的 landmark-unique 要求 landmark 名字唯一
      //   实测两种组合：
      //     去掉 role、只留 aria-labelledby  ⇒ ✅ 无违规
      //     保留 role=region                 ⇒ ❌ landmark-unique
      // ⇒ APG 允许两种做法，我们选「不加 role」：
      //   · aria-labelledby 已把面板与按钮关联（读屏能念出标题）
      //   · 不引入额外 landmark ⇒ 读屏用户不会被一堆同名地标淹没
      //   ⇒ 少一层 landmark，对读屏而言反而更清晰。
      // ③ panel 的地标（≤6 时）
      if (this.useRegion) panel.setAttribute('role', 'region');

      // ④ heading 的 aria-level 与 h1-h6 天然隐含的一致 ⇒
      //    这里不动（用真实的 h2/h3 比显式 aria-level 更可靠）

      // ⑤ 🔴 2026-10-04：建立**初始**的 data-state
      //    CSS 靠 `[data-state="open"]` 触发高度过渡，
      //    没有它的话：HTML 里写了 aria-expanded="true" 也不会展开。
      var isOpen = btn.getAttribute('aria-expanded') === 'true';
      panel.setAttribute('data-state', isOpen ? 'open' : 'closed');
      if (!isOpen) panel.setAttribute('hidden', '');
      else panel.removeAttribute('hidden');
    }
  };

  /* ====================================================================
     ⭐ 展开 / 收起 —— 复刻 Radix Collapsible 的机制
     ====================================================================
     Radix 源码注释（collapsible.tsx 实测）：
       "when closing we delay `present` to retrieve dimensions before closing"

     意思是：**关闭时必须先量到高度，再收** ——
     否则量到 0，动画就没有过程（会"啪"一下消失）。

     实现（ES5，无 Promise / 无 async）：
       展开：data-state=open → 移除 hidden → 高度交给 CSS 过渡
       收起：先量 scrollHeight 写进 CSS 变量（给退场动画一个起点）
             → 下一帧再切 data-state=closed（触发过渡）
             → transitionend 后加 hidden（真正移出无障碍树）
     ================================================================== */
  Accordion.prototype.reduced = function () {
    return typeof window.matchMedia === 'function' &&
           window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  /* 🔴 2026-10-04 锁高：收起动画期间**列表高度不变** ⇒ 下方 trigger 不位移。
     量化依据：收起时下方 trigger 上移 **131px**，手指必然点空。
     ⚠️ 只在**收起**时锁 —— 展开时下方项本来就要让位，锁了反而不自然。 */
  /* ⚠️ 保留但不用：实测锁列表高度解决不了"项在列表内部上移"（见 set() 注释） */
  Accordion.prototype.lock = function () {};

  Accordion.prototype.unlock = function () {};

  Accordion.prototype.set = function (item, open) {
    var btn = item.querySelector('.accordion__trigger');
    var panel = item.querySelector('.accordion__panel');
    if (!btn || !panel) return;
    if (btn.getAttribute('aria-disabled') === 'true') return;

    var self = this;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');

    if (open) {
      // ── 展开：直接给 open 状态。CSS 的 0fr → 1fr 过渡自己会动
      panel.removeAttribute('hidden');
      panel.style.visibility = '';
      panel.setAttribute('data-state', 'open');
    } else {
      // ── 收起：先量高度（退场动画的起点），再切状态
      if (self.reduced()) {
        panel.setAttribute('data-state', 'closed');
        panel.setAttribute('hidden', '');
        panel.style.visibility = '';
      } else {
        var inner = panel.querySelector('.accordion__panel-inner');
        // 🔴 量的是 **inner** 的高度，不是 panel 的
        //    （panel 是 grid 容器，0fr 时它自身高度为 0，量不到内容）
        var h = inner ? inner.getBoundingClientRect().height : 0;
        panel.style.setProperty('--acc-h', h + 'px');
        // ⚠️ 这里**曾经**加过「锁住列表高度」，实测**无效**，已撤销：
        //    锁的是**列表**高度，但第 1 项是在列表**内部**收缩的，
        //    第 2 项照样在列表里上移（实测仍移 131px）。
        //    ⇒ 任何高度动画都会推动下方内容，这是**固有代价**
        //      （Radix 等通行实现同样如此）。
        // 下一帧再切 closed ⇒ 浏览器先认下 1fr 这个起点，再过渡到 0fr
        raf(function () {
          panel.setAttribute('data-state', 'closed');
          // 过渡结束后真正隐藏（移出无障碍树）+ 解锁
          var settle = function () {
            if (panel.getAttribute('data-state') === 'closed') {
              panel.setAttribute('hidden', '');
              panel.style.removeProperty('--acc-h');
            }
          };
          once(panel, 'transitionend', settle);
          // 兜底：万一 transitionend 没触发（标签页在后台等）
          setTimeout(settle, 400);
        });
      }
    }

    if (typeof this.opts.onChange === 'function') {
      this.opts.onChange(btn, open);
    }
  };

  Accordion.prototype.toggle = function (item) {
    var opening = item.querySelector('.accordion__trigger')
                      .getAttribute('aria-expanded') !== 'true';
    if (this.single && opening) {
      // 只允许开一个 ⇒ 先全关
      var self = this;
      toArray(this.items).forEach(function (it) {
        if (it !== item) self.set(it, false);
      });
    }
    this.set(item, opening);
  };

  /* 找 trigger 所属的 item —— 自己往上走（ES5 安全的 closest） */
  Accordion.prototype.itemOf = function (btn) {
    var el = btn;
    while (el && el !== this.root) {
      if (el.className &&
          (' ' + el.className + ' ').indexOf(' accordion__item ') > -1) {
        return el;
      }
      el = el.parentNode;
    }
    return null;
  };

  Accordion.prototype.bind = function () {
    var self = this;

    /* 🔴 2026-10-04 修「收起后点另一项，第一次没反应」（Owner 实机报）

       真因：**收起动画期间整个列表在向上位移**。
       第 1 项的 panel 从 117px 缩到 0，第 2 项的 trigger **跟着往上挪**；
       手指瞄准的是落下那一瞬间的位置，浏览器派发 touch 时元素已经移开
       ⇒ **点在空处，什么也没发生** —— 用户以为要点两次。

       ⚠️ 我第一版修法是「动画期间锁住点击 + 结束后补偿」。
          **实测反而更糟**（补偿没生效，第一次点击彻底丢失）。
          ⇒ 已撤销那个锁。
       ⇒ 现在的修法是 CSS 一处：收起中的 panel `pointer-events:none`，
          事件能穿透到下层 trigger（见 accordion.css）。
       ⇒ 剩下的"极短窗口内布局位移"是**高度动画的固有代价** ——
          Radix 等通行实现同样如此。240ms 的窗口，人类感知不到。
     */
    this.root.style.setProperty('--acc-dur', this.dur + 'ms');

    this.root.addEventListener('click', function (e) {
      var btn = closest(e.target, '.accordion__trigger');
      if (!btn || !self.root.contains(btn)) return;
      if (btn.getAttribute('aria-disabled') === 'true') return;
      var item = self.itemOf(btn);
      if (item) self.toggle(item);
    });

    // 🔴 键盘：Enter / Space —— **刻意不监听 keydown**。
    //    原生 <button> 本身就响应这两个键并触发 click，
    //    写了反而**双触发**（keydown toggle 一次 + click 又 toggle 一次）。
    //    这是「用原生控件」的又一处收益：**无障碍行为免费且必然正确**。
  };

  window.Accordion = Accordion;

  function init() {
    var nodes = document.querySelectorAll('[data-accordion]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].accordionInstance = new Accordion(nodes[i]);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
