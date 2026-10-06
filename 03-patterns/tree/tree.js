/**
 * tree.js — 树形视图（D1 /
 *
 * 依据：APG Tree View 模式
 * ============================================================================
 * ⭐ 两条设计要点（都不显然，但缺了就"用起来别扭"）
 *
 * ① **Roving tabindex**（游标式 tabindex）
 *    整棵树**只占一个 Tab 位**：当前节点 tabindex=0，其余全是 -1。
 *    ⇒ 若每个节点都 tabindex=0，Tab 30 次才能穿过一棵树。
 *    ⇒ 这也是 APG 的明确要求。
 *
 * ② **↑↓ 只移动焦点，←→ 才展开/收起**（且会带着焦点走）
 *    APG 规定：
 *      → 收起时：若已展开，先收起；已收起则**移到父节点**
 *      ← 展开时：若已收起，先展开；已展开则**移到第一个子节点**
 *    ⇒ 这条最容易做成"只展开不移动焦点"，键盘用户会觉得"按了没反应"。
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
    root.classList.add('tree');
    if (!root.getAttribute('role')) root.setAttribute('role', 'tree');
    if (!root.getAttribute('aria-label') && !root.getAttribute('aria-labelledby')) {
      root.setAttribute('aria-label', opt.label || '树形视图');
    }

    /* ---------- 初始化结构 ---------- */
    var items = [];
    Array.prototype.forEach.call(root.querySelectorAll('li'), function (li) {
      if (li.className.indexOf('tree__item') < 0) {
        li.className = (li.className ? li.className + ' ' : '') + 'tree__item';
      }
      li.setAttribute('role', 'treeitem');
      var kids = li.querySelector(':scope > ul');
      if (kids) {
        li.setAttribute('aria-expanded', kids.hidden ? 'false' : 'true');
      }
      var node = li.querySelector(':scope > .tree__node') || li.firstElementChild;
      if (node) {
        node.setAttribute('role', 'none');   /* 节点本身不是 treeitem */
        node.setAttribute('tabindex', '-1');
        if (!node.querySelector('.tree__marker')) {
          var m = document.createElement('span');
          m.className = 'tree__marker';
          m.setAttribute('aria-hidden', 'true');
          node.insertBefore(m, node.firstChild);
        }
      }
      items.push({ li: li, node: node, ul: kids });
    });

    /* ---------- 焦点管理（roving tabindex） ---------- */
    var cur = -1;
    function visible() {
      return items.filter(function (it) {
        return it.node && it.node.offsetParent !== null;
      });
    }
    function focusAt(i) {
      var list = visible();
      if (!list.length) return;
      if (i < 0) i = list.length - 1;
      if (i >= list.length) i = 0;
      list.forEach(function (x) { x.node.setAttribute('tabindex', '-1'); });
      list[i].node.setAttribute('tabindex', '0');
      list[i].node.focus();
      cur = i;
    }
    function current() {
      var list = visible();
      return cur >= 0 && cur < list.length ? list[cur] : null;
    }
    function setExpanded(it, open) {
      if (!it.ul) return;
      it.li.setAttribute('aria-expanded', open ? 'true' : 'false');
      it.ul.hidden = !open;
    }

    /* 🔴 修：外部聚焦时**同步游标**。
       `cur` 只在 `focusAt()` 里更新；但焦点也可能是**从别处**来的
       （Tab 进树、编程式 el.focus()、点击）
       ⇒ 那些路径下 `cur` 仍是 -1 ⇒ 按 ↑↓ 会跳到第 0 项（= 没动）。
       ⚠️ 症状：鼠标点击正常，键盘 ↑↓ "没反应" —— 两者矛盾正是线索。
       ⇒ 正解：监听 focusin，实时把 cur 对齐到当前聚焦的节点。 */
    root.addEventListener('focusin', function (e) {
      var node = e.target.closest ? closest(e.target, '.tree__node') : null;
      if (!node) return;
      var list = visible();
      for (var i = 0; i < list.length; i++) {
        if (list[i].node === node) { cur = i; break; }
      }
    });

    /* ---------- 键盘（APG Tree View 12 条里最常用的 6 条）---------- */
    root.addEventListener('keydown', function (e) {
      var k = e.key;
      var it = current();
      if (!it) return;

      /* ① ↑↓ 移动（只移动焦点，不改展开状态）*/
      if (k === 'ArrowDown') { e.preventDefault(); focusAt(cur + 1); return; }
      if (k === 'ArrowUp')   { e.preventDefault(); focusAt(cur - 1); return; }

      /* ⑤ Home / End 跳首末 */
      if (k === 'Home') { e.preventDefault(); focusAt(0); return; }
      if (k === 'End')  { e.preventDefault(); focusAt(visible().length - 1); return; }

      /* ② → / ← 展开收起（⭐ 且带着焦点走，这是最易漏的一半）*/
      if (k === 'ArrowRight') {
        e.preventDefault();
        if (it.ul && it.li.getAttribute('aria-expanded') === 'false') {
          setExpanded(it, true);                 /* 先展开，不动焦点 */
        } else if (it.ul) {
          focusAt(cur + 1);                      /* 已展开 ⇒ 进第一个子节点 */
        }
        return;
      }
      if (k === 'ArrowLeft') {
        e.preventDefault();
        if (it.ul && it.li.getAttribute('aria-expanded') === 'true') {
          setExpanded(it, false);                /* 先收起，不动焦点 */
        } else {
          /* 找到父节点并聚焦它（← 在收起状态下要"往回走"）*/
          for (var i = cur; i > 0; i--) {
            var cand = visible()[i];
            if (it.li.contains(cand.li)) { focusAt(i); return; }
          }
        }
        return;
      }

      /* ③ `*` 展开当前层全部同级（APG 特有）*/
      if (k === '*') {
        e.preventDefault();
        var lvl = levelOf(it);
        visible().forEach(function (x) {
          if (x.ul && levelOf(x) === lvl) setExpanded(x, true);
        });
        return;
      }

      /* ④ Enter 切换展开 / Space 选中 */
      if (k === 'Enter') {
        e.preventDefault();
        if (it.ul) setExpanded(it, it.li.getAttribute('aria-expanded') !== 'true');
        if (opt.onActivate) opt.onActivate(it);
        return;
      }
      if (k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        select(it);
        return;
      }

      /* ⑥ 首字母跳转（a-z）*/
      if (/^[a-zA-Z\u4e00-\u9fa5]$/.test(k)) {
        e.preventDefault();
        var list = visible();
        var start = cur + 1;
        for (var n = 0; n < list.length; n++) {
          var idx = (start + n) % list.length;
          var lbl = (list[idx].node.textContent || '').trim();
          if (lbl.charAt(0).toLowerCase() === k.toLowerCase()) {
            focusAt(idx);
            return;
          }
        }
      }
    });

    function select(it) {
      items.forEach(function (x) { x.node.setAttribute('aria-selected', 'false'); });
      it.node.setAttribute('aria-selected', 'true');
      if (opt.onSelect) opt.onSelect(it);
    }

    /* ---------- 点击 ---------- */
    root.addEventListener('click', function (e) {
      var node = e.target.closest ? closest(e.target, '.tree__node') : null;
      if (!node || !root.contains(node)) return;
      var list = visible();
      for (var i = 0; i < list.length; i++) {
        if (list[i].node === node) { focusAt(i); break; }
      }
      var it = current();
      if (it) {
        /* 点箭头只展开/收起，点文字则选中 */
        if (e.target.closest && closest(e.target, '.tree__marker') && it.ul) {
          setExpanded(it, it.li.getAttribute('aria-expanded') !== 'true');
        } else {
          select(it);
        }
      }
    });

    /* 🔴 修一个**整棵树进不去**的 bug：
       JS 只在 `focusAt()` 里把当前节点设成 tabindex="0"，
       但**初始化时从来没调用过它** ⇒ 所有节点都是 tabindex="-1"
       ⇒ **整棵树占不到任何 Tab 位** ⇒ 纯键盘用户 Tab 根本进不来。
       ⚠️ 症状：鼠标点击一切正常，键盘完全不可达 —— 肉眼与鼠标都测不出来。
       ⇒ 修：初始化结束时把焦点落在**第一个可见节点**上（只设 tabindex，不抢焦点）。 */
    var firstVisible = visible()[0];
    if (firstVisible) firstVisible.node.setAttribute('tabindex', '0');

    return {
      focusAt: focusAt,
      get selected() { return current(); },
      destroy: function () { root.innerHTML = ''; },
    };
  }

  function levelOf(it) {
    var n = 0, p = it.li.parentElement;
    while (p && p !== document.body) {
      if (p.getAttribute && p.getAttribute('role') === 'treeitem') n++;
      p = p.parentElement;
    }
    return n;
  }

  global.Tree = { create: create };
})(window);
