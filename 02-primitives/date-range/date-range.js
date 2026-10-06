/**
 * date-range.js — 日期区间（E3 /
 *
 * 财务/成本场景刚需：看上季度、对比去年同期。
 *
 * ⭐ 三个关键点（最容易漏）：
 *   ① **必须有「清除」**：日期填错了要能一键清空
 *      ⇒ 没有它 = 用户只能一个个退格删
 *   ② **约束校验**：开始晚于结束、超出 min/max ⇒ **明确报错**（不静默）
 *   ③ **无障碍**：每个 input 有 label；错误用 role=alert 播报
 *
 * ⭐ 为什么**基于原生 `<input type="date">`** 而不是自建日历：
 *   原生自带：触屏日历面板、本地化、键盘输入、无障碍语义。
 *   自建日历要重做这一切，且在移动端体验更差。
 *   （与 combobox 的取舍相反 —— 那里原生 select 无法定制样式。）
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

  function iso(d) {
    if (!d) return '';
    var m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    var dt = new Date(d);
    if (isNaN(dt)) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
  }
  function addDays(isoStr, n) {
    var d = new Date(isoStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return iso(d);
  }
  function addMonths(isoStr, n) {
    var d = new Date(isoStr + 'T00:00:00');
    var day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    /* ⚠️ 月末溢出防护：1/31 加一个月不该变成 3/3 */
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return iso(d);
  }
  function quarterOf(date) {
    var q = Math.floor(date.getMonth() / 3);
    return { y: date.getFullYear(), q: q };
  }
  function quarterRange(y, q) {
    /* 🔴 2026-10-06 加防呆（ H5 的单测逼出来的）：
       `q` 是 **0-based**（0=Q1），这是内部约定，但很容易被当成 1-based 用。
       原来传 1 会**静默返回 Q2**（不报错）—— 正是本库最厌恶的那类失效。
       ⇒ 越界直接抛错，让误用在第一次就暴露。 */
    if (q !== 0 && q !== 1 && q !== 2 && q !== 3) {
      throw new Error('DateRange.quarterRange: 季度必须是 0-3（0=Q1），收到 ' + q);
    }
    var start = new Date(y, q * 3, 1);
    var end = new Date(y, q * 3 + 3, 0);      /* 该季度最后一天 */
    return { from: iso(start), to: iso(end) };
  }

  function create(root, opt) {
    opt = opt || {};
    var from = root.querySelector('[data-dr-from]');
    var to = root.querySelector('[data-dr-to]');
    var errBox = root.querySelector('[data-dr-error]');
    var summary = root.querySelector('[data-dr-summary]');
    var clearBtn = root.querySelector('[data-dr-clear]');
    if (!from || !to) throw new Error('DateRange: 缺少 [data-dr-from] / [data-dr-to]');

    /* 约束：min/max 由调用方给（或默认放开）*/
    if (opt.min) { from.min = opt.min; to.min = opt.min; }
    if (opt.max) { from.max = opt.max; to.max = opt.max; }

    function setError(msg) {
      if (errBox) {
        errBox.textContent = msg || '';
        errBox.hidden = !msg;
      }
      /* ⭐ 错误要同时标记到具体字段 + 关联描述（读屏才知道哪个错了）*/
      from.setAttribute('aria-invalid', msg ? 'true' : 'false');
      to.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msg) {
        var id = 'dr-err-' + (++uid);
        errBox.id = id;
        from.setAttribute('aria-describedby', id);
        to.setAttribute('aria-describedby', id);
      } else {
        from.removeAttribute('aria-describedby');
        to.removeAttribute('aria-describedby');
      }
    }

    function days(fromS, toS) {
      var a = new Date(fromS + 'T00:00:00'), b = new Date(toS + 'T00:00:00');
      return Math.round((b - a) / 86400000) + 1;
    }

    function validate() {
      var f = from.value, t = to.value;
      if (!f && !t) { setError(''); paintSummary(''); return true; }
      if (f && !t) { setError('请填写结束日期。'); return false; }
      if (!f && t) { setError('请填写开始日期。'); return false; }
      if (f > t) {
        setError('开始日期不能晚于结束日期（当前：' + f + ' → ' + t + '）。');
        return false;
      }
      if (opt.min && f < opt.min) { setError('开始日期不能早于 ' + opt.min + '。'); return false; }
      if (opt.max && t > opt.max) { setError('结束日期不能晚于 ' + opt.max + '。'); return false; }
      setError('');
      paintSummary(f + ' → ' + t + '（' + days(f, t) + ' 天）');
      return true;
    }

    function paintSummary(s) {
      if (summary) summary.innerHTML = s ? ('区间 <b>' + s + '</b>') : '';
    }

    function emit() {
      var ok = validate();
      if (opt.onChange) {
        opt.onChange({ from: from.value, to: to.value, valid: ok }, ok);
      }
    }

    /* ---------- 快捷区间 ---------- */
    function bindPresets() {
      var now = new Date();
      var q = quarterOf(now);
      var presets = [
        { key: 'thisQ',  label: '本季度', range: function () { return quarterRange(q.y, q.q); } },
        { key: 'lastQ',  label: '上季度',
          range: function () { return q.q === 0 ? quarterRange(q.y - 1, 3) : quarterRange(q.y, q.q - 1); } },
        { key: 'lastM',  label: '上月',
          range: function () {
            var m = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            return { from: iso(m), to: iso(new Date(m.getFullYear(), m.getMonth() + 1, 0)) };
          } },
        { key: 'thisY',  label: '今年',
          range: function () {
            return { from: iso(new Date(now.getFullYear(), 0, 1)),
                     to: iso(new Date(now.getFullYear(), 11, 31)) };
          } },
        { key: 'yoy',    label: '去年同期',
          range: function () {
            var y = now.getFullYear() - 1;
            return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
          } },
      ];
      if (opt.presets) {
        presets = presets.filter(function (x) { return opt.presets.indexOf(x.key) >= 0; });
      }
      var box = root.querySelector('[data-dr-presets]');
      if (!box) return;
      box.innerHTML = presets.map(function (p) {
        return '<button class="drange__preset" type="button" aria-pressed="false" ' +
               'data-dr-preset="' + p.key + '">' + p.label + '</button>';
      }).join('');
      box.addEventListener('click', function (e) {
        var b = e.target.closest ? closest(e.target, '[data-dr-preset]') : null;
        if (!b) return;
        var p = presets.filter(function (x) { return x.key === b.getAttribute('data-dr-preset'); })[0];
        if (!p) return;
        var r = p.range();
        from.value = r.from;
        to.value = r.to;
        /* ⭐ 标记哪个快捷项是"当前"的（aria-pressed，非仅颜色）*/
        box.querySelectorAll('[data-dr-preset]').forEach(function (x) {
          x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
        });
        emit();
      });
    }
    bindPresets();

    /* ---------- 清除（① 最容易漏的）---------- */
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        from.value = '';
        to.value = '';
        var box = root.querySelector('[data-dr-presets]');
        if (box) {
          box.querySelectorAll('[data-dr-preset]').forEach(function (x) {
            x.setAttribute('aria-pressed', 'false');
          });
        }
        setError('');
        paintSummary('');
        emit();
        from.focus();                     /* 清完把焦点放回开始日期 */
      });
    }

    /* ---------- 手动改日期 ---------- */
    [from, to].forEach(function (el) {
      el.addEventListener('change', function () {
        var box = root.querySelector('[data-dr-presets]');
        if (box) {
          box.querySelectorAll('[data-dr-preset]').forEach(function (x) {
            x.setAttribute('aria-pressed', 'false');
          });
        }
        emit();
      });
      el.addEventListener('input', emit);
    });

    /* ---------- 便捷 API ---------- */
    function setRange(a, b2) {
      from.value = iso(a);
      to.value = iso(b2);
      emit();
    }

    validate();
    return {
      get from() { return from.value; },
      get to() { return to.value; },
      get valid() { return !errBox || errBox.hidden; },
      set: setRange,
      setPreset: function (key) {
        var b = root.querySelector('[data-dr-preset="' + key + '"]');
        if (b) b.click();
      },
      clear: function () { if (clearBtn) clearBtn.click(); },
    };
  }

  global.DateRange = {
    create: create,
    /* 🔴 2026-10-06 补上 quarterOf（ H5 的单测抓出来的）：
       它一直是**内部函数但没导出** ⇒ 使用者拿到 quarterRange 也无法
       从任意日期反推季度号。纯函数，导出无害且有用。 */
    iso: iso, addDays: addDays, addMonths: addMonths,
    quarterOf: quarterOf, quarterRange: quarterRange,
  };
})(window);
