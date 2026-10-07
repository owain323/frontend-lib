/**
 * select.js — 自建下拉选择（E1 /
 *
 * 依据：APG Select-Only Combobox 模式
 * ============================================================================
 * ⭐ 四条最容易漏的键盘契约（逐条实现并在注释里标出）：
 *
 * ① **打开后焦点落在"选中项"**（不是第一项，也不是按钮）
 *    ⇒ 用户按 Alt+↓ 打开后，直接 Enter 就能确认当前值。
 *    ⇒ 若落在第一项，一开就选错了 —— 这是自建 select 最常见的错。
 *
 * ② **↑↓ 循环 · Home/End 首末 · Enter/Space 选中并关闭**
 *
 * ③ **Esc 关闭并把焦点还给按钮**（不是"选中项"）
 *
 * ④ **类型搜索**：连续打字跳到匹配项（原生 select 有，必须做）
 *    ⇒ 缓冲 500ms，超时清空（否则 "abc" 永远搜不到）。
 *
 * 无依赖 · ES5
 */
(function (global) {
  'use strict';
  /* ---- 旧环境兼容：Element.closest 在老 WebView 上不存在 ----
     直接调用会在真机上抛 `is not a function`（本地完全正常，
     只在老环境炸 —— 属静默失效）。这里做模块内兜底，
     不污染全局，也不需要使用者额外引入 polyfill。 */
  function closest(el, sel) {
    if (!el) return null;
    if (el.closest) return el.closest(sel);
    while (el && el.nodeType === 1) {
      if (elMatches(el, sel)) return el;
      el = el.parentElement;
    }
    return null;
  }
  function elMatches(el, sel) {
    var m = sel.match(/^([a-zA-Z][\w-]*)/);
    if (m && el.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
    var cls = sel.match(/\.([\w-]+)/g);
    if (cls) {
      for (var i = 0; i < cls.length; i++) {
        var c = cls[i].slice(1);
        if ((' ' + (el.className || '') + ' ').indexOf(' ' + c + ' ') < 0) return false;
      }
    }
    var id = sel.match(/#([\w-]+)/);
    if (id && el.id !== id[1]) return false;
    var at = sel.match(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/);
    if (at) {
      var v = el.getAttribute(at[1]);
      if (v === null) return false;
      if (at[2] !== undefined && v !== at[2]) return false;
    }
    return true;
  }

  var uid = 0;

  function create(root, opt) {
    opt = opt || {};
    var btn = root.querySelector('[data-select-btn]');
    var list = root.querySelector('[data-select-list]');
    if (!btn || !list) throw new Error('Select: 缺少 [data-select-btn] 或 [data-select-list]');
    if (!list.id) list.id = 'select-list-' + (++uid);

    var options = [].slice.call(list.querySelectorAll('[role="option"]'));
    var isMulti = !!opt.multiple;
    var selected = opt.value != null ? String(opt.value) : null;
    var activeIdx = -1;
    var typeBuf = '';
    var typeTimer = null;

    list.setAttribute('role', 'listbox');
    if (isMulti) list.setAttribute('aria-multiselectable', 'true');
    list.setAttribute('aria-label', opt.label || '选项');
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', list.id);

    /* 保证每个 option 都有 id（aria-activedescendant 需要） */
    options.forEach(function (o, i) {
      o.setAttribute('role', 'option');
      if (!o.id) o.id = list.id + '-o' + i;
      o.setAttribute('aria-selected', 'false');
      if (o.hasAttribute('disabled') || o.getAttribute('aria-disabled') === 'true') {
        o.setAttribute('aria-disabled', 'true');
      }
      o.setAttribute('tabindex', '-1');   /* 焦点在按钮上，选项不占 Tab */
      if (o.className.indexOf('select__opt') < 0) {
        o.className = (o.className ? o.className + ' ' : '') + 'select__opt';
      }
    });

    function enabled() {
      return options.filter(function (o) { return o.getAttribute('aria-disabled') !== 'true'; });
    }
    function selectedIdx() {
      for (var i = 0; i < options.length; i++) {
        if (options[i].getAttribute('data-value') === selected) return i;
      }
      return -1;
    }
    function valueText() {
      var i = selectedIdx();
      return i < 0 ? (opt.placeholder || '请选择') : optText(options[i]);
    }
    function optText(o) {
      var t = o.querySelector('.select__opt-text');
      return ((t || o).textContent || '').replace(/[✓\s]/g, '').trim();
    }

    function paint() {
      var v = valueText();
      var vEl = btn.querySelector('.select__value');
      if (vEl) {
        vEl.textContent = v;
        vEl.classList.toggle('select__value--placeholder', selectedIdx() < 0);
      }
      options.forEach(function (o) {
        var on = o.getAttribute('data-value') === selected;
        o.setAttribute('aria-selected', on ? 'true' : 'false');
        var ck = o.querySelector('.select__check');
        if (ck) ck.textContent = on ? '✓' : '';
      });
      /* hidden input 承接表单值（自建组件最容易漏的）*/
      var hidden = root.querySelector('input[type="hidden"]');
      if (hidden) hidden.value = selected == null ? '' : selected;
      if (opt.onChange) opt.onChange(selected, optText(options[selectedIdx()] || options[0]));
    }

    /**
     * 🔴 修一个**索引错位导致 ↑↓ 卡死**的 bug。
     *
     * 原来：`setActive(i)` 里的 i 被调用方按 **enabled() 过滤后数组**的索引传，
     *      而函数内部又当成 **options 原数组**的索引用
     *      ⇒ 两者含义不同；末项之后算出越界，被 Math.min 夹回末项
     *      ⇒ **连按 ↓ 永远停在最后一项**。
     * ⚠️ 症状极具欺骗性：前几项能正常走，最后一项之后就"卡住"了。
     *
     * ⭐ 正解：**对外统一用 options 的索引**，
     *      跳过 disabled 的逻辑放在函数内部做（步进 + 环绕）。
     *
     * @param {number} i  options 数组里的索引（可越界，会自动环绕）
     * @param {number} [dir=1] 步进方向（-1 用于 ↑）
     */
    function setActive(i, dir) {
      if (!options.length) return;
      dir = dir || 1;
      /* 从 i 开始按 dir 找第一个未禁用的（最多转一圈）*/
      var n = options.length;
      var idx = ((i % n) + n) % n;
      for (var k = 0; k < n; k++) {
        if (options[idx].getAttribute('aria-disabled') !== 'true') break;
        idx = ((idx + dir) % n + n) % n;
      }
      activeIdx = idx;
      options.forEach(function (o) { o.removeAttribute('data-state'); });
      options[idx].setAttribute('data-state', 'active');
      /* ⭐ aria-activedescendant：焦点始终在按钮上，靠它告诉读屏"当前在第几项" */
      btn.setAttribute('aria-activedescendant', options[idx].id);
      if (options[idx].scrollIntoView) {
        options[idx].scrollIntoView({ block: 'nearest' });
      }
    }

    /** 当前游标所在项在 options 里的索引（没打开时用选中项）*/
    function activeIndex() {
      if (activeIdx >= 0) return activeIdx;
      var i = selectedIdx();
      if (i >= 0) return i;
      var e2 = enabled();
      return e2.length ? options.indexOf(e2[0]) : 0;
    }

    function open() {
      list.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      /* 🔴 修：必须**先把焦点放到按钮上**。
         本组件用 aria-activedescendant 模式（焦点常驻按钮，靠它告知读屏
         "当前在第几项"）⇒ 焦点必须始终在按钮，事件也必须由按钮处理。
         原来只设了 aria-activedescendant 就 open()
         ⇒ 用鼠标点开时焦点可能停在 body
         ⇒ 挂在 list 上的 keydown（Esc / 类型搜索）**收不到事件**。
         ⚠️ 症状：鼠标能选、↑↓ 能走、Esc 与字母键完全无效。 */
      btn.focus();
      /* ① 焦点落在**选中项**（没有选中则落在第一个未禁用的项）*/
      setActive(activeIndex());
      if (opt.onOpen) opt.onOpen();
    }
    function close(restoreFocus) {
      list.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      btn.removeAttribute('aria-activedescendant');
      options.forEach(function (o) { o.removeAttribute('data-state'); });
      activeIdx = -1;
      /* ③ Esc 关闭时焦点**还给按钮**（不是选中项）*/
      if (restoreFocus !== false) btn.focus();
      if (opt.onClose) opt.onClose();
    }
    function commit(i) {
      var o = options[i];
      if (!o || o.getAttribute('aria-disabled') === 'true') return;
      if (isMulti) {
        /* 多选：再点一次取消 */
        selected = o.getAttribute('data-value') === selected ? null : o.getAttribute('data-value');
      } else {
        selected = o.getAttribute('data-value');
        close(true);                              /* 选中并关闭 + 归位 */
      }
      paint();
    }

    /* ---------- 键盘（APG Select）---------- */
    btn.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ' ||
          k === 'Spacebar' || (k === 'Alt' && false)) {
        if (k === 'ArrowDown' || k === 'ArrowUp') {
          e.preventDefault();
          if (list.hidden) { open(); return; }
          var dir = k === 'ArrowDown' ? 1 : -1;
          setActive(activeIndex() + dir, dir);
          return;
        }
        e.preventDefault();
        if (list.hidden) open();
        else if (activeIdx >= 0) commit(activeIdx);
        return;
      }
      /* Alt+↓ 直接打开（不改值）*/
      if (k === 'ArrowDown' && e.altKey) { e.preventDefault(); open(); return; }
      /* Home/End */
      if (list.hidden && (k === 'Home' || k === 'End')) {
        e.preventDefault(); open();
        if (k === 'Home') setActive(0);
        else setActive(options.length - 1);
        return;
      }
    });

    /* 🔴 焦点常驻按钮 ⇒ 键盘事件主要落在 btn 上。
       这里把 btn 的 handler 也挂一份完整逻辑（Esc/类型搜索/Home/End），
       否则它们永远收不到事件。 */
    function onListKey(e) {
      var k = e.key;
      if (k === 'ArrowDown') { e.preventDefault(); setActive(activeIndex() + 1, 1); return; }
      if (k === 'ArrowUp')   { e.preventDefault(); setActive(activeIndex() - 1, -1); return; }
      if (k === 'Home')      { e.preventDefault(); setActive(0, 1); return; }
      if (k === 'End')       { e.preventDefault(); setActive(options.length - 1, -1); return; }
      /* ③ Esc 关闭 + 焦点还按钮
         🔴 加 stopPropagation（**组合契约**抓到的真问题）：
         本组件常被放进 drawer / dialog 里。
         原来只 preventDefault ⇒ 事件**继续冒泡**到外层弹层
         ⇒ **按一次 Esc 把内外两层一起关掉**。
         ⚠️ 单组件契约**测不到这个**（它没有外层）——
            所以必须有"组合契约"这种真嵌套的测试。
         ⇒ 正解：内层弹层"吃掉"这个键时必须 stopPropagation。
         层级弹层的 Esc 语义本来就是"只关最上面那层"。 */
      if (k === 'Escape' || k === 'Esc') {
        e.preventDefault();
        e.stopPropagation();   /* 🔴 只关本层，不让外层跟着关 */
        close(true);
        return;
      }
      if (k === 'Tab') { close(false); return; }
      if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        if (activeIdx >= 0) commit(activeIdx);
        return;
      }
      /* ④ 类型搜索 */
      if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        typeBuf += k.toLowerCase();
        clearTimeout(typeTimer);
        typeTimer = setTimeout(function () { typeBuf = ''; }, 500);
        for (var i = 0; i < options.length; i++) {
          if (optText(options[i]).toLowerCase().indexOf(typeBuf) === 0) {
            if (options[i].getAttribute('aria-disabled') !== 'true') setActive(i, 1);
            break;
          }
        }
      }
    }
    /* 挂在按钮上（焦点常驻处）*/
    btn.addEventListener('keydown', function (e) {
      /* 列表没开时，btn 自己的 handler 已经处理了开合；开了之后交给 onListKey */
      if (list.hidden) return;
      var k = e.key;
      /* 这些键在"已打开"状态下由 onListKey 统一处理 */
      if (k === 'Escape' || k === 'Esc' || k === 'ArrowDown' || k === 'ArrowUp' ||
          k === 'Home' || k === 'End' || k === 'Enter' || k === ' ' ||
          k === 'Spacebar' || k === 'Tab') {
        /* Enter/Space 在关闭态要"打开"，交给 btn 原 handler */
        if (list.hidden) return;
        onListKey(e);
        return;
      }
      if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) onListKey(e);
    });

    /* ---------- 点击 ---------- */
    btn.addEventListener('click', function () {
      if (list.hidden) open(); else close();
    });
    list.addEventListener('click', function (e) {
      var o = e.target.closest ? closest(e.target, '[role="option"]') : null;
      if (!o) return;
      commit(options.indexOf(o));
    });
    document.addEventListener('click', function (e) {
      if (!root.contains(e.target) && !list.hidden) close(false);
    });

    paint();
    return {
      open: open, close: close,
      get value() { return selected; },
      set value(v) { selected = v == null ? null : String(v); paint(); },
    };
  }

  global.Select = { create: create };
})(window);
