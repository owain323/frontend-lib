/**
 * shell-nav.js — app-shell 的窄屏导航（行为层）
 *
 * ⚠️ 它**不是**"可选增强"，虽然我第一版是这么写的。判据很简单：
 *    没有它时，`app-shell.css` 在 ≤47.99rem 把侧栏设成 `display: none`，
 *    页面上就**一个导航入口都没有**。"宽屏没有它一切照旧"这句话只对桌面成立，
 *    而"桌面看着能用、手机上走不出去"正是本库一直在治的那类缺陷。
 *    ⇒ START-HERE 里归「必需」，与 tabs / drawer / nav 同档。
 *
 * 语法刻意用 ES5（无箭头函数 / const / let / 模板字符串 / Element.closest）——
 * 与 nav.js / tabs.js / accordion.js 一致，精简档 WebView 的版本不确定。
 *
 * ==========================================================================
 * 🔴 为什么需要这一层
 * --------------------------------------------------------------------------
 *   `app-shell.css` 在 ≤47.99rem 把 `.shell__side` 直接设成 `display: none`。
 *   侧栏一收，用户**没有任何入口**去别的页面 —— 只读看板可以接受，
 *   管理型后台不可以。
 *
 *   在此之前文档只写了一句"要抽屉就把 `.shell__side` 里的内容搬进 drawer 实例"。
 *   但"搬"是六十行胶水：建按钮、克隆列表、断点判断、宽屏复位、
 *   缺依赖时别装死。每个使用者抄一遍，抄出来的版本各有各的漏 ——
 *   这正是 nav.js 当年被做出来的同一个理由。
 *
 * ==========================================================================
 * 🔴 为什么不复用 03-patterns/nav 的行为层
 * --------------------------------------------------------------------------
 *   `nav.js` 处理的是"横排导航 → 全屏抽屉"：它的列表**常驻在文档里**
 *   （桌面端就是那条横排导航），抽屉和列表是**同一个节点**，只是移动位置。
 *
 *   而 app-shell 的侧栏在窄屏是 `display: none` —— 它不需要"移动"，
 *   需要的是"另建一份显示出来"。生命周期正好相反（常驻 vs 即用即毁）。
 *
 *   ⇒ 用 `03-patterns/drawer`：它已经把 Esc、焦点陷阱、焦点归位、
 *     背景 inert、锁滚动五件事做完了。本层只做**接线**，一行行为逻辑都不重写。
 *     nav.js 拒绝复用 drawer.js 的理由（"不能开一次建一个"）在这里不成立，
 *     因为窄屏下那棵列表本来就看不见。
 *
 * ==========================================================================
 * 🔴 断点不写在 JS 里
 * --------------------------------------------------------------------------
 *   "什么时候该有抽屉"的唯一判据是**菜单按钮还在不在**
 *   （`btn.offsetParent === null`）。按钮的显隐由 CSS 决定，JS 只读结果。
 *
 *   写死 47.99rem 意味着 CSS 改一个数，JS 就静默错位 —— 而且错位的方式是
 *   "宽屏上抽屉还能打开、窄屏上反而打不开"，从截图上完全看不出来。
 *   这是 nav.js 契约 ⑥ 的同一个教训。
 *
 * ==========================================================================
 * 契约（每条都能被测出来）
 * --------------------------------------------------------------------------
 *   ① **opt-in**：只有 `.shell[data-shell-nav]` 才被接管（值 = 抽屉标题）。
 *      没写这个属性 = 一个按钮都不注入 —— 别人的顶栏布局不该被悄悄改。
 *   ② 依赖缺失时**不注入按钮**：`window.Drawer` 不在就 warn 后跳过。
 *      🔴 宁可没有按钮，也不要一个点了没反应的按钮：
 *         窄屏下用户会反复点，然后认为整个页面坏了（比"没有导航"更糟）。
 *   ③ 按钮插在 `.shell__topbar` 的**第一个**子节点（贴着左边/起始边），
 *      带 `aria-haspopup="dialog"`，名字是 `打开<标题>`。
 *   ④ 打开时**克隆**侧栏，不移动：桌面端还在用原节点；移动的话
 *      抽屉一关（即用即毁）侧栏就永远回不来了。
 *      克隆里所有 `id` 一律剥掉 —— 否则文档里出现两份同 id，
 *      `aria-labelledby` / `label[for]` 会指到克隆那份上。
 *   ⑤ 初始焦点落在 `[aria-current="page"]`（用户一眼看到自己在哪），
 *      没有当前项时由 drawer 兜底到第一个可聚焦元素。
 *   ⑥ 点抽屉里的链接**先关**再走：SPA 里不关会留下一个盖住页面的遮罩，
 *      而焦点还被锁在它里面 ⇒ 用户以为"点了没反应"。
 *   ⑦ 视口变宽到侧栏回来时**自动关掉**抽屉，否则两个导航同时存在。
 *   ⑧ 幂等：`root.shellNavInstance` 已存在就跳过（SPA 路由 / HMR / 重复引入）。
 *
 * ==========================================================================
 * 用法
 * --------------------------------------------------------------------------
 *   <div class="shell" data-shell-nav="主导航">
 *     <header class="shell__topbar">…</header>   <!-- 按钮插在这里 -->
 *     <nav class="shell__side">…</nav>
 *     <main class="shell__main">…</main>
 *   </div>
 *
 *   <link rel="stylesheet" href="drawer.css">   <!-- 抽屉的样子 -->
 *   <script src="drawer.js"></script>           <!-- 抽屉的行为（必需） -->
 *   <script src="shell-nav.js"></script>        <!-- 有 data-shell-nav 就自动初始化 -->
 *
 *   手动：new ShellNav(rootEl, { label: '打开菜单', place: 'left' })
 *   事件：fl-shell-nav（detail = { open: true|false }），派发在 `.shell` 上
 */
(function (global) {
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

  var ICON =
    '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" ' +
    'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
    'aria-hidden="true" focusable="false"><path d="M2.5 4h11M2.5 8h11M2.5 12h11"/></svg>';

  function warn(msg) {
    if (global.console && global.console.warn) global.console.warn(msg);
  }

  /**
   * 剥掉克隆里所有 id。
   *
   * ⚠️ 不能只剥根节点的：侧栏里的链接、分组、`aria-labelledby` 的目标都可能有 id。
   *    两份同 id 的 DOM 里，`document.getElementById` 只会返回**文档里靠前的那份**，
   *    于是抽屉里那些指向 id 的引用全部指到桌面端那份上 —— 而桌面端那份
   *    在窄屏是 `display: none`，读屏读到的是一段不可见的文字。
   */
  function stripIds(node) {
    if (node.removeAttribute) node.removeAttribute('id');
    var all = node.querySelectorAll ? node.querySelectorAll('[id]') : [];
    for (var i = 0; i < all.length; i++) all[i].removeAttribute('id');
  }

  function ShellNav(root, opts) {
    if (!root) throw new Error('ShellNav: 缺少根元素');
    var o = this.opts = opts || {};
    var self = this;

    this.root = root;
    this.btn = null;
    this.handle = null;
    this.disabled = false;

    var side = root.querySelector('.shell__side');
    var topbar = root.querySelector('.shell__topbar');

    if (!side || !topbar) {
      this.disabled = true;
      warn('shell-nav: 缺少 ' + (!side ? '.shell__side' : '.shell__topbar') +
           '，已跳过该元素（不改别人的布局）。');
      return;
    }

    /* ② 依赖检查放在最前：缺 Drawer 就什么都不做。
       放在"建完按钮再检查"的位置，会留下一个点不动的按钮。 */
    if (!global.Drawer || typeof global.Drawer.open !== 'function') {
      this.disabled = true;
      warn('shell-nav: 需要先加载 03-patterns/drawer/drawer.js。' +
           '本层只做接线，抽屉的 Esc / 焦点陷阱 / 焦点归位 / 锁滚动都由它提供。' +
           '已跳过，不注入菜单按钮。');
      return;
    }

    this.side = side;
    this.topbar = topbar;

    /* ③ 按钮：插在顶栏第一个子节点（起始边）。
       `aria-haspopup="dialog"` 告诉读屏"点了会出来一个对话框"，
       "导航菜单"这类措辞留给真正的 menu/menubar，那需要方向键语义。 */
    var title = root.getAttribute('data-shell-nav') || '导航';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shell__menu';
    btn.setAttribute('aria-label', o.label || ('打开' + title));
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.innerHTML = ICON;
    btn.addEventListener('click', function () { self.open(); });
    topbar.insertBefore(btn, topbar.firstChild);
    this.btn = btn;

    /* ⑦ 宽屏复位。只在抽屉开着时才判断，避免无谓的 layout 读取。 */
    this.onResize = function () {
      if (!self.handle) return;
      /* 判据 = 菜单按钮还在不在（CSS 决定），不是数字 —— 见文件头。 */
      if (self.btn && self.btn.offsetParent === null) self.close();
    };
    global.addEventListener('resize', this.onResize);
  }

  ShellNav.prototype = {
    constructor: ShellNav,

    /** 打开抽屉。已开着就直接返回现有句柄（重复点不该叠两层遮罩）。 */
    open: function () {
      if (this.disabled || this.handle) return this.handle;
      var self = this;
      var title = this.root.getAttribute('data-shell-nav') || '导航';

      var content = this.side.cloneNode(true);
      stripIds(content);
      /* 🔴 克隆会**继承** `.shell__side` 的窄屏规则 `display: none` ——
         也就是说，抽屉里那份内容原样是看不见的（0.19.0 实测：抽屉能打开、
         但里面空无一物，焦点兜底到关闭按钮）。
         加一个修饰类，让 CSS 把"抽屉里那份"重新显示出来。
         ⚠️ 不要在 JS 里写 style.display —— 那是把布局塞进脚本，
            CSS 里的 display 一变（比如将来改成 grid），JS 就悄悄过时。 */
      content.className += ' shell__side--drawer';

      var handle = this.handle = global.Drawer.open({
        place: this.opts.place || 'left',
        title: title,
        content: content,
        /* ⑤ 焦点落在当前页：用户打开导航，第一个想看的就是"我在哪"。
           没有 aria-current 时 drawer 会退到第一个可聚焦元素（关闭按钮）。 */
        initialFocus: '[aria-current="page"]',
        onClose: function () {
          self.handle = null;
          flEmit(self.root, 'fl-shell-nav', { open: false });
        }
      });

      /* ⑥ 点链接先关。用事件委托而不是逐个绑：克隆里有多少链接是使用者决定的。
         ⚠️ 捕获 el 而不是每次读 self.handle —— 关闭后 handle 已是 null。 */
      var el = handle.el;
      el.addEventListener('click', function (e) {
        var n = e.target;
        while (n && n !== el) {
          if (n.tagName === 'A') { self.close(); return; }
          n = n.parentNode;
        }
      });

      flEmit(this.root, 'fl-shell-nav', { open: true });
      return handle;
    },

    close: function () {
      var h = this.handle;
      if (!h) return false;
      /* 先清空再调：drawer 的 onClose 里还会清一次，
         顺序反了的话回调会重入到一个"正在关闭"的句柄上。 */
      this.handle = null;
      h.close();
      return true;
    },

    /** 拆掉本层加的东西（按钮、监听、开着的抽屉）。侧栏原节点一根手指都没动过。 */
    destroy: function () {
      this.close();
      if (this.onResize) {
        global.removeEventListener('resize', this.onResize);
        this.onResize = null;
      }
      if (this.btn && this.btn.parentNode) this.btn.parentNode.removeChild(this.btn);
      this.btn = null;
      if (this.root && this.root.shellNavInstance === this) this.root.shellNavInstance = null;
      this.disabled = true;
    }
  };

  global.ShellNav = ShellNav;

  function init() {
    var nodes = document.querySelectorAll('[data-shell-nav]');
    for (var i = 0; i < nodes.length; i++) {
      /* ⑧ 幂等：SPA 路由切回、HMR、重复引入都会二次执行 init。
         不加守卫会插第二个按钮（视觉上是"两个汉堡叠在一起"）。 */
      if (nodes[i].shellNavInstance) continue;
      try {
        nodes[i].shellNavInstance = new ShellNav(nodes[i]);
      } catch (e) {
        /* 缺依赖是**作者错误**，但一个坏标记不该拖垮整页其余外壳 */
        warn('shell-nav: 初始化失败，已跳过该元素 —— ' + (e && e.message));
      }
    }
  }

  // @autoinit: [data-shell-nav] —— 自动初始化；与 API.md「自动初始化」表由 autoinit-gate 双向校验
  // ⚠️ 无 DOM 环境（SSR / 构建期 / Node 里 import）不自动初始化。
  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
