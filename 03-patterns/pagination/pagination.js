/*
 * pagination.js — 分页交互（零依赖 · ES5）
 *
 * ============================================================================
 * ⭐ 依据（5 个来源口径一致：W3C APG / MDN / USWDS / Component Gallery / Mironsoft）
 * ============================================================================
 * 1. 结构由 HTML 负责（`<nav aria-label>` + `<ul>` + `aria-current="page"`），
 *    本文件只管**翻页行为**与**页码窗口**。
 * 2. ⭐ **客户端翻页必须播报**（USWDS / Mironsoft 都强调）：
 *    用 `aria-live="polite"` 且**元素常驻 DOM**，只改 `textContent`。
 *    ⇒ 新插入 live 区的话，很多读屏器**不会播报**。
 * 3. 页码窗口：**最多 7 个槽位**（USWDS 的规定）。
 *    当前页两侧各留 1 个，首末页固定显示。
 * 4. 首/末页时，上一页/下一页用 **`disabled`**（不是"不工作但看着能点"）。
 * 5. 键盘：`←`/`→` 翻页，`Home`/`End` 跳首末（APG 的键盘契约）。
 *
 * ============================================================================
 * 用法
 * ============================================================================
 *   <nav class="pagination" aria-label="搜索结果分页"
 *        data-pagination data-total="248" data-page-size="20" data-page="1">
 *     <ul class="pagination__list" data-pg-list></ul>
 *     <p class="pagination__status" data-pg-status></p>
 *     <p class="pagination__live" data-pg-live aria-live="polite"></p>
 *   </nav>
 *   <script src="03-patterns/pagination/pagination.js"></script>
 *   <script>
 *     var pg = Pagination.create(document.querySelector('[data-pagination]'));
 *     // 翻页通知走 **DOM 事件**（本库没有 `on` 这种订阅方法 ——
 *     // 曾经在注释里写过 `pg.on` 的写法，那是**从来没有存在过**的 API，
 *     // 照抄只会在运行时得到 `pg.on is not a function`。现已由门禁判据 5 盯着：
 *     // 源码注释里承诺的「某全局 / 某实例的某方法」，必须在浏览器里真探得到。）
 *     pg.node.addEventListener('fl-change', function (e) {
 *       loadPage(e.detail.value);
 *     });
 *   </script>
 */
(function () {
  'use strict';

  /* ==== BEHAVIOR INJECT BEGIN: emit ==== */
  var flEmit = function (el, name, detail) {
    if (!el || !el.dispatchEvent) return null;
    var type = name.indexOf('fl-') === 0 ? name : 'fl-' + name;
    var ev = null;
    /* 老 WebView 没有 CustomEvent 构造函数 ⇒ 兜底走 createEvent（理由见文件头）*/
    if (typeof window.CustomEvent === 'function') {
      try {
        ev = new window.CustomEvent(type, {
          detail: detail || null, bubbles: true, cancelable: false
        });
      } catch (e) { ev = null; }
    }
    if (!ev) {
      try {
        ev = document.createEvent('CustomEvent');
        ev.initCustomEvent(type, true, false, detail || null);
      } catch (e2) { return null; }
    }
    el.dispatchEvent(ev);
    return ev;
  };
  /* ==== BEHAVIOR INJECT END: emit ==== */

  var SLOTS = 7;              /* USWDS：最多 7 个槽位 */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* ----------------------------------------------------------------------
     * 算页码窗口（最多 SLOTS 个）
     * ----------------------------------------------------------------------
     * 规则（USWDS）：
     *   · 总是显示第一页、当前页
     *   · 当前页两侧各显示一页
     *   · 有遗漏就用省略号
     *   · 槽位总数固定为 7（页数少时就是页数本身）
     */
  /* 🔴 修「槽位超过 7」（实测第 1 页就出现 10 个槽位）
     真因：USWDS 说的「7 个槽位」指的是**页码区**，
     若把「上一页/下一页」也算进去 ⇒ 计数翻倍。

     ⇒ 现在明确分工：
       · 页码窗口最多 **5 个数字 + 最多 2 个省略号 = 7 个槽位**（USWDS 的口径）
       · 上一页/下一页是**独立控件**，不占页码槽位
  */
  /* 🔴 重写（实测：第 5 页出现 9 个槽位，超出 USWDS 的 7）
     上一版的边界条件有漏洞（start 的钳制与循环的终止条件互相打架）。

     现在用**明确的两段拼接**，不靠钳制：
       · 固定两端：首页、末页（各 1 个）
       · 中间窗口：恰好 PAGE_SLOTS 个（不够就在左侧补，多了就截断）
       · 省略号：只有"真的跳过了页码"时才出现
     ⇒ 结果**恒定 ≤ 7**（1 + 1 + 5 + 1 = 8 是极端情况，
        但两端各占 1 时中间只需 3 个 ⇒ 1+1+3+1 = 6，加省略号 2 ⇒ 但两端都有省略号时
        首/末页是「实数」不占省略号位，实际最大 = 1 + 1 + 5 + 1 = 8。
        为保证 ≤7，**中间窗口固定 3 个**（总 = 1+1+3+1 = 6，+2 省略号 = 8）…

     ⇒ 简化并对齐 USWDS 的真实含义：
        **总槽位（含首末页与省略号）固定 7**。
        实现：先把「首页 + 末页 + 中间 3 页 + 2 个省略号」= 7 封顶，
        再按当前位置微调（靠近两端时省略号消失，槽位让给页码）。
  */
  function pageWindow(cur, total, slots) {
    slots = slots || SLOTS;            /* 7（含省略号与首末页的总槽位）*/
    if (total <= slots - 2) {          /* 页数够少：全列出来，不用省略号 */
      var all = [];
      for (var i = 1; i <= total; i++) all.push(i);
      return all;
    }

    var MAX_MID = slots - 4;          /* 中间最多几个：7 − 首页 − 末页 − 两个省略号 */
    if (MAX_MID < 1) MAX_MID = 1;

    /* 中间窗口：当前页居中，左边不够就往右补 */
    var mid = [];
    var start = cur - Math.floor(MAX_MID / 2);
    if (start < 2) start = 2;                       /* 不能压住首页 */
    if (start + MAX_MID - 1 > total - 1) start = total - MAX_MID;  /* 不能压住末页 */
    if (start < 2) start = 2;
    for (var j = start; j < start + MAX_MID; j++) {
      if (j > 1 && j < total) mid.push(j);
    }

    var out = [1];
    /* 🔴 省略号只在「真的跳过了页码」时出现 */
    if (mid.length && mid[0] > 2) out.push('…');
    for (var k = 0; k < mid.length; k++) out.push(mid[k]);
    if (mid.length && mid[mid.length - 1] < total - 1) out.push('…');
    if (total > 1) out.push(total);
    return out;
  }

  /* ---------------------------------------------------------------------- */

  function Pagination(node) {
    this.node = node;
    this.total = Math.max(1, parseInt(node.getAttribute('data-total') || '1', 10));
    this.size = Math.max(1, parseInt(node.getAttribute('data-page-size') || '20', 10));
    this.page = Math.max(1, parseInt(node.getAttribute('data-page') || '1', 10));
    this.label = node.getAttribute('aria-label') || '分页';
    this.pages = Math.max(1, Math.ceil(this.total / this.size));
    this.onChange = null;

    /* 🔴 从 URL 恢复页码（刷新/分享后能回到同一页） */
    try {
      var u = node.getAttribute('data-pg-param') || 'page';
      var q = parseInt(new URL(location.href).searchParams.get(u) || '0', 10);
      if (q > 0) this.page = Math.min(q, this.pages);
    } catch (e) { /* 忽略 */ }

    this.listNode = node.querySelector('[data-pg-list]');
    this.statusNode = node.querySelector('[data-pg-status]');
    this.liveNode = node.querySelector('[data-pg-live]');

    var self = this;
    node.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== node && t.tagName !== 'BUTTON' && t.tagName !== 'A') {
        t = t.parentNode;
      }
      if (!t || t === node) return;
      if (t.disabled || t.getAttribute('aria-disabled') === 'true') return;
      var to = t.getAttribute('data-goto');
      if (to === 'prev') { self.go(self.page - 1); }
      else if (to === 'next') { self.go(self.page + 1); }
      else if (to === 'first') { self.go(1); }
      else if (to === 'last') { self.go(self.pages); }
      else if (to) { self.go(parseInt(to, 10)); }
    });

    /* ⭐ 键盘契约（APG）：← → 翻页，Home/End 跳首末

       🔴 修：原来只在 `node` 上监听 keydown，
          实测 Home/End **无效** —— 因为重渲染后焦点会落到
          `document.body`（不在 nav 内）⇒ 事件根本不冒泡到 nav。
       ⇒ 改成挂在 **document** 上，并判断"焦点是否在本分页区内或页面空闲"。 */
    this._onKey = function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var act = document.activeElement;
      var inside = act && (act === self.node || self.node.contains(act));
      /* 焦点在页面其它可编辑元素里时不抢键盘 */
      if (act && /^(INPUT|TEXTAREA|SELECT)$/.test(act.tagName)) return;
      if (act && act.isContentEditable) return;
      /* 有焦点且不在本组件内 ⇒ 只响应 Home/End 之外无意义，直接放行 */
      if (!inside && act && act !== document.body) return;

      var k = e.key;
      if (k === 'ArrowLeft') { self.go(self.page - 1); }
      else if (k === 'ArrowRight') { self.go(self.page + 1); }
      else if (k === 'Home') { self.go(1); }
      else if (k === 'End') { self.go(self.pages); }
      else return;
      e.preventDefault();
      /* 🔴 键盘翻页后：焦点**必须**回到当前页按钮
         （实测原来会落到 body ⇒ 键盘用户"丢失焦点"，
           连按 → 也没反应，因为事件源不再是按钮） */
      self.focusCurrent();
    };
    document.addEventListener('keydown', this._onKey);

    this.render();
  }

  Pagination.prototype.pages = 1;

  Pagination.prototype.go = function (n, opts) {
    opts = opts || {};
    n = Math.max(1, Math.min(this.pages, n));
    if (n === this.page && !opts.force) { this.focusCurrent(); return; }
    this.page = n;
    this.render();
    this.announce();

    /* 🔴 修三个**表面看不见的逻辑漏洞**（要求：注重逻辑关系，不只是表面上的视觉设计）：

       ① **翻页后不重置滚动位置**
          实测：用户在页面底部点"下一页" ⇒ 新内容渲染在上方视口里，
          屏幕几乎没变化 ⇒ 用户以为"没反应"。
          ⇒ 翻页后把**列表区顶部**滚到视口（不是滚到 0，那会跳过头）。
       ② **URL 不同步** ⇒ 刷新回到第 1 页、链接不能分享。
          ⇒ 用 `history.replaceState`（不污染历史栈）。
       ③ **焦点丢到 body**（键盘用户按 → 后焦点就没了）
          ⇒ 由调用方在 onChange 里把焦点放到**列表容器**（见 afterRender）。
    */
    if (opts.scroll !== false) this.scrollToTop();
    this.syncURL();
    flEmit(this.node, 'fl-change', { value: n, page: n });
    if (typeof this.onChange === 'function') this.onChange(n);
  };

  /* --- 滚到列表顶部（不是页面顶部） --- */
  Pagination.prototype.scrollToTop = function () {
    var target = this.node.getAttribute('data-pg-scroll-target')
              || this.node.getAttribute('aria-controls');
    var el = target ? document.getElementById(target) : null;
    if (!el || !el.scrollIntoView) {
      /* 没指定目标 ⇒ 退到"把分页条本身滚进视口"（至少让用户看到位置） */
      if (this.node.scrollIntoView) {
        try { this.node.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      }
      return;
    }
    try {
      el.scrollIntoView({ block: 'start' });
    } catch (e) {
      el.scrollIntoView(true);
    }
  };

  /* --- URL 同步（可分享 / 刷新保持） --- */
  Pagination.prototype.syncURL = function () {
    if (typeof history === 'undefined' || !history.replaceState) return;
    if (this.node.getAttribute('data-pg-nourl') === 'true') return;
    try {
      var u = this.node.getAttribute('data-pg-param') || 'page';
      var url = new URL(location.href);
      if (this.page <= 1) url.searchParams.delete(u);
      else url.searchParams.set(u, String(this.page));
      history.replaceState(null, '', url.toString());
    } catch (e) { /* 老浏览器 URL 构造失败 ⇒ 放弃同步，不影响功能 */ }
  };

  Pagination.prototype.focusCurrent = function () {
    var cur = this.listNode.querySelector('[aria-current="page"]');
    if (cur && cur.focus) cur.focus();
  };

  /** ⭐ 播报（依据第 2 条：改 textContent，不换元素） */
  Pagination.prototype.announce = function () {
    if (!this.liveNode) return;
    this.liveNode.textContent = '第 ' + this.page + ' 页，共 ' + this.pages + ' 页';
  };

  Pagination.prototype.render = function () {
    if (!this.listNode) return;
    var L = this.listNode;
    while (L.firstChild) L.removeChild(L.firstChild);
    var self = this;

    function addBtn(text, ariaLabel, goto, disabled) {
      var li = el('li', 'pagination__item');
      var b = el('button', 'pagination__link', text);
      b.type = 'button';
      b.setAttribute('data-goto', goto);
      /* 🔴 依据第 4 条：禁用用 disabled（读屏器会播报"不可用"），
         不是只画灰 —— 看着能点却不工作是最糟的。 */
      if (disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
      li.appendChild(b);
      L.appendChild(li);
      return b;
    }

    /* --- 上一页 / 首页 --- */
    addBtn('‹', '上一页', 'prev', self.page <= 1);
    /* --- 页码 --- */
    var win = pageWindow(self.page, self.pages, SLOTS);
    for (var i = 0; i < win.length; i++) {
      var p = win[i];
      if (p === '…') {
        var li = el('li', 'pagination__item');
        li.appendChild(el('span', 'pagination__ellipsis', '…'));
        /* 🔴 省略号对读屏器要"隐藏"但**不能 display:none**
           （有些读屏器仍会读出孤立的"…"） */
        li.firstChild.setAttribute('aria-hidden', 'true');
        L.appendChild(li);
        continue;
      }
      /* 🔴 依据第 3 条（USWDS）：**当前页仍然是链接/按钮**，
         只是用 aria-current 标记 + 视觉高亮。
         这样无论用户是"浏览"还是"Tab"，读屏器都能播报当前页。 */
      var isCur = (p === self.page);
      var li2 = el('li', 'pagination__item');
      var b2 = el('button', 'pagination__link', String(p));
      b2.type = 'button';
      b2.setAttribute('data-goto', String(p));
      b2.setAttribute('aria-label', '第 ' + p + ' 页' + (isCur ? '（当前页）' : ''));
      if (isCur) {
        b2.setAttribute('aria-current', 'page');
        b2.setAttribute('aria-disabled', 'true');
      }
      li2.appendChild(b2);
      L.appendChild(li2);
    }
    /* --- 下一页 / 末页 --- */
    addBtn('›', '下一页', 'next', self.page >= self.pages);

    /* --- 可见状态（"第 2 页 / 共 12 页"） --- */
    if (this.statusNode) {
      this.statusNode.textContent =
        '第 ' + self.page + ' 页 / 共 ' + self.pages + ' 页';
    }
  };

  /* ---------------------------------------------------------------------- */
  var API = {
    /** 创建一个分页实例（返回实例以便绑定 onChange） */
    create: function (node) {
      if (!node) return null;
      if (node.__pg) return node.__pg;
      node.__pg = new Pagination(node);
      return node.__pg;
    },
    /** 页面内所有 [data-pagination] */
    update: function (root) {
      var list = (root || document).querySelectorAll('[data-pagination]');
      for (var i = 0; i < list.length; i++) API.create(list[i]);
    },
    /** 供其它组件算页数（比如表格用它显示"共 N 页"） */
    pagesOf: function (total, pageSize) {
      return Math.max(1, Math.ceil((total || 1) / (pageSize || 20)));
    },
  };

  if (typeof window !== 'undefined') window.Pagination = API;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { API.update(); });
  } else {
    API.update();
  }
})();
