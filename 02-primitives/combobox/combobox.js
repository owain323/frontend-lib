/**
 * combobox.js — 组合框 / 标签输入（E2 /
 *
 * 依据：APG Combobox with List Autocomplete
 * ============================================================================
 * ⭐ 三条最容易漏的：
 *
 * ① **焦点管理**：焦点**始终在 input 上**（不是选项上），
 *    靠 aria-activedescendant 告知读屏"当前在第几项"。
 *    ⇒ 这与「roving tabindex」（树）的做法**正好相反**。
 *    ⇒ 用错会出现"点选项后输入框失焦，打字没反应"。
 *
 * ② **Backspace 删标签**：光标在空输入框时按 Backspace ⇒ 删最后一个标签。
 *    ⇒ 这是标签输入的事实标准交互，缺了很别扭。
 *
 * ③ **Enter 加标签**：输入框有文字时按 Enter ⇒ 把当前高亮项加为标签并清空输入。
 *
 * 无依赖 · ES5
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
    var input = root.querySelector('[data-combo-input]');
    var list = root.querySelector('[data-combo-list]');
    var tagBox = root.querySelector('[data-combo-tags]');
    if (!input || !list) throw new Error('Combobox: 缺少 [data-combo-input] 或 [data-combo-list]');
    if (!list.id) list.id = 'combo-list-' + (++uid);

    /* 🔴 每个实例进来就领一个序号：
       以前只在 `!list.id` 时递增 ⇒ 调用方给了 list id 时多个实例共用一个号。 */
    var seq = ++uid;

    var ALL = opt.options || [];              /* [{value, label}] */
    var tags = [];                            /* 已选 */
    var activeIdx = -1;
    var shown = [];                           /* 当前过滤后的选项 */

    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', opt.label || '建议');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', list.id);
    if (!input.id) input.id = 'combo-input-' + seq;
    if (!input.getAttribute('aria-label') && !root.querySelector('label[for="' + input.id + '"]')) {
      input.setAttribute('aria-label', opt.label || '输入');
    }

    /* ---------- 过滤（含高亮命中片段）---------- */
    function esc(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    /**
     * 候选项过滤。
     *
     * 若调用方提供了 `filter`，就用它（自定义匹配逻辑：拼音、模糊、分组…）。
     * 否则退回默认的标签/值子串匹配。
     *
     * ⚠️ 自定义函数必须**同步返回布尔值**。它会被逐项调用，
     *    所以不要在里面做异步过滤。
     */
    function filter(q) {
      q = (q || '').trim().toLowerCase();
      if (!q) return ALL.slice();
      if (typeof opt.filter === 'function') {
        return ALL.filter(function (o) {
          return !!opt.filter(q, o);
        });
      }
      return ALL.filter(function (o) {
        return (o.label || '').toLowerCase().indexOf(q) >= 0 ||
               (o.value || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    function paintList() {
      var q = input.value.trim();
      shown = filter(q).slice(0, 50);
      if (!shown.length) {
        list.innerHTML = '<li class="combo__empty" role="presentation">' +
          (q ? '没有匹配「' + esc(q) + '」的选项' : '暂无可选') + '</li>';
        return;
      }
      var ql = q.toLowerCase();
      list.innerHTML = shown.map(function (o, i) {
        var picked = tags.indexOf(o.value) >= 0;
        var label = esc(o.label);
        /* ⭐ 高亮命中片段：让用户知道**为什么**这条匹配 */
        if (ql) {
          var raw = o.label, k = raw.toLowerCase().indexOf(ql);
          if (k >= 0) {
            label = esc(raw.slice(0, k)) + '<mark>' + esc(raw.slice(k, k + q.length)) +
                    '</mark>' + esc(raw.slice(k + q.length));
          }
        }
        /* ⭐ 必须真写出来：`setActive()` 在读它，读屏也需要它*/
        return '<li class="combo__opt" role="option" id="' + list.id + '-o' + i + '"' +
               ' data-value="' + esc(o.value) + '"' +
               ' aria-selected="' + (picked ? 'true' : 'false') + '"' +
               (o.disabled ? ' aria-disabled="true"' : '') + '>' +
               '<span class="combo__opt-text">' + label + '</span></li>';
      }).join('');
      activeIdx = -1;
    }

    /* ---------- 标签 ---------- */
    function paintTags() {
      if (!tagBox) return;
      tagBox.innerHTML = tags.map(function (v) {
        var o = ALL.filter(function (x) { return x.value === v; })[0] || { label: v };
        /* ⭐ 删除按钮有 aria-label（否则读屏只念"×"）*/
        return '<span class="combo__tag">' +
               '<span class="combo__tag-text">' + esc(o.label) + '</span>' +
               '<button class="combo__tag-del" type="button" data-del="' + esc(v) + '"' +
               ' aria-label="移除 ' + esc(o.label) + '">×</button></span>';
      }).join('');
      var hidden = root.querySelector('input[type="hidden"]');
      if (hidden) hidden.value = tags.join(',');
      flEmit(root, 'fl-change', { value: tags.slice() });
      if (opt.onChange) opt.onChange(tags.slice());
    }
    function isDisabled(v) {
      for (var i = 0; i < ALL.length; i++) {
        if (ALL[i].value === v) return !!ALL[i].disabled;
      }
      return false;
    }

    /* ⭐ max 的**唯一入口**：点击 / Enter / 公开 add 全走这里。
       以前只在 commitActive 里"加完发现满了才关列表" ⇒ 另外两条路能绕过。 */
    function addTag(v) {
      if (v == null || v === '') return false;
      if (isDisabled(v)) return false;                       /* 禁用项 */
      if (tags.indexOf(v) >= 0) return false;                /* 不重复 */
      if (opt.max && tags.length >= opt.max) return false;    /* 🔴 上限 */
      tags.push(v);
      paintTags();
      return true;
    }
    function removeTag(v) {
      var i = tags.indexOf(v);
      if (i < 0) return false;
      tags.splice(i, 1);
      paintTags();
      return true;
    }

    /* ---------- 游标 ---------- */
    function opts() {
      return [].slice.call(list.querySelectorAll('[role="option"]'));
    }
    function setActive(i, dir) {
      var os = opts();
      if (!os.length) { activeIdx = -1; input.removeAttribute('aria-activedescendant'); return; }
      dir = dir || 1;
      var n = os.length;
      var idx = ((i % n) + n) % n;
      /* 🔴 全禁用时不许落在禁用项上：
         以前跑满 n 次无条件 break，停哪算哪。APG：没有可选项 ⇒ 没有"当前项"。 */
      var found = false;
      for (var k = 0; k < n; k++) {
        if (os[idx].getAttribute('aria-disabled') !== 'true') { found = true; break; }
        idx = ((idx + dir) % n + n) % n;
      }
      if (!found) {
        activeIdx = -1;
        os.forEach(function (o) { o.removeAttribute('data-state'); });
        input.removeAttribute('aria-activedescendant');
        return;
      }
      activeIdx = idx;
      os.forEach(function (o) { o.removeAttribute('data-state'); });
      os[idx].setAttribute('data-state', 'active');
      /* ⭐ 焦点留在 input 上，靠 aria-activedescendant 告知读屏 */
      input.setAttribute('aria-activedescendant', os[idx].id);
      if (os[idx].scrollIntoView) os[idx].scrollIntoView({ block: 'nearest' });
    }
    function open() {
      paintList();
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      activeIdx = -1;
      input.removeAttribute('aria-activedescendant');
    }
    function commitActive() {
      if (activeIdx < 0) return false;
      var o = opts()[activeIdx];
      if (!o) return false;
      var v = o.getAttribute('data-value');
      var ok = addTag(v);
      input.value = '';
      paintList();
      /* 标签满时保持列表开着（还能继续加），否则关掉 */
      if (opt.max && tags.length >= opt.max) close();
      return ok;
    }

    /* ---------- 键盘（焦点常驻 input）----------
       ⭐ 具名函数：`destroy()` 要按同一个引用摘除，匿名的摘不掉。 */
    function onKeydown(e) {
      var k = e.key;

      /* ↑↓ 在建议间移动 */
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        if (list.hidden) { open(); return; }
        var dir = k === 'ArrowDown' ? 1 : -1;
        var base = activeIdx >= 0 ? activeIdx : (dir > 0 ? -1 : opts().length);
        setActive(base + dir, dir);
        return;
      }
      /* Enter：加当前高亮项；没有高亮则加"输入的文字" */
      if (k === 'Enter') {
        if (list.hidden) return;
        e.preventDefault();
        if (activeIdx >= 0) { commitActive(); return; }
        /* 没有高亮 ⇒ 精确匹配一个 */
        var q = input.value.trim();
        var hit = shown.filter(function (o) {
          return (o.label || '').toLowerCase() === q.toLowerCase() ||
                 (o.value || '').toLowerCase() === q.toLowerCase();
        })[0];
        if (hit) { addTag(hit.value); input.value = ''; paintList(); }
        return;
      }
      /* Esc：先关列表；列表已关则清空输入 */
      if (k === 'Escape' || k === 'Esc') {
        if (!list.hidden) { e.preventDefault(); e.stopPropagation(); close(); return; }
        if (input.value) { e.preventDefault(); input.value = ''; paintList(); }
        return;
      }
      /* ② Backspace：空输入时删最后一个标签 */
      if (k === 'Backspace' && !input.value && tags.length) {
        e.preventDefault();
        removeTag(tags[tags.length - 1]);
        return;
      }
      /* 逗号/顿号也算"确认"（中文用户习惯）*/
      if ((k === ',' || k === '，') && input.value.trim()) {
        e.preventDefault();
        var q2 = input.value.trim();
        var h2 = shown.filter(function (o) {
          return (o.label || '').indexOf(q2) >= 0 || (o.value || '').indexOf(q2) >= 0;
        })[0];
        if (h2) { addTag(h2.value); input.value = ''; paintList(); }
        return;
      }
      if (k === 'Home' && !list.hidden) { e.preventDefault(); setActive(0, 1); return; }
      if (k === 'End' && !list.hidden) { e.preventDefault(); setActive(opts().length - 1, -1); return; }
    }

    function onInput() { open(); }
    function onFocus() { open(); }
    function onClick() { open(); }

    /* ---------- 标签删除 ---------- */
    function onTagClick(e) {
      /* 🔴 原来是 `e.target.closest ? closest(...) : null` ⇒ 没有原生 closest
         时直接返回 null，兜底永远跑不到。直接调，它内部自己判。 */
      var b = closest(e.target, '[data-del]');
      if (!b) return;
      removeTag(b.getAttribute('data-del'));
      input.focus();                      /* 删除后焦点回输入框 */
    }

    /* ---------- 点选项 ---------- */
    function onListClick(e) {
      var o = closest(e.target, '[role="option"]');
      if (!o) return;
      addTag(o.getAttribute('data-value'));
      input.value = '';
      paintList();
      input.focus();
    }
    /* 🔴 document 级监听：实例销毁后必须摘掉，否则每个死实例都握着 DOM 引用。 */
    function onDocClick(e) {
      if (!root.contains(e.target)) close();
    }

    input.addEventListener('keydown', onKeydown);
    input.addEventListener('input', onInput);
    input.addEventListener('focus', onFocus);
    input.addEventListener('click', onClick);
    if (tagBox) tagBox.addEventListener('click', onTagClick);
    list.addEventListener('click', onListClick);
    document.addEventListener('click', onDocClick);

    /* 🔴 禁用态同步：CSS 不用 :has()（ES6+ 兼容问题，见 combobox.css 注释）
       ⇒ 由这里根据 input.disabled 给容器加 class。 */
    function syncDisabled() {
      var field = root.querySelector('.combo__field') ||
                  input.parentElement;
      if (!field) return;
      if (input.disabled) field.setAttribute('data-state', 'disabled');
      else field.removeAttribute('data-state');
    }
    input.addEventListener('change', syncDisabled);
    syncDisabled();

    /* ---------- 销毁----------
       以前没有 destroy，而上面注册了 document 级监听 ⇒ 实例没了监听还在。
       ⇒ 具名注册（见上）+ 这里逐个摘除；**幂等**（重复调用不抛）。 */
    var destroyed = false;
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      input.removeEventListener('keydown', onKeydown);
      input.removeEventListener('input', onInput);
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('click', onClick);
      input.removeEventListener('change', syncDisabled);
      if (tagBox) tagBox.removeEventListener('click', onTagClick);
      list.removeEventListener('click', onListClick);
      document.removeEventListener('click', onDocClick);
      close();
    }

    paintTags();
    return {
      get tags() { return tags.slice(); },
      add: addTag, remove: removeTag,
      setOptions: function (o) { ALL = o || []; paintList(); },
      destroy: destroy,
    };
  }

  global.Combobox = { create: create };
})(window);
