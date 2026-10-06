/**
 * polyfill.js — 旧环境所需的两处补丁
 * ============================================================================
 * 为什么需要这个文件
 * ---------------------------------------------------------------------------
 * 本库的**语法**目标是 ES5，但「ES5 语法」不等于「ES5 运行时 API」。
 * 下面两个方法是 DOM/JS 标准里的后期新增项，在老 WebView 上**不存在**：
 *
 *   Element.closest()   —— 2015 年起 widely available
 *   Array.from()        —— ES2015
 *
 * 混用「ES5 语法 + 现代 API」是很常见的误解：代码能通过 ES5 语法检查，
 * 却在老环境里运行时抛 `is not a function`。
 *
 * 用法：放在行为脚本**之前**引入一次。
 *   <script src="polyfill.js"></script>
 *   <script src="patterns/overlay/overlay.js"></script>
 *
 * 代价：约 0.4 KB，不引入任何依赖。
 * ============================================================================
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------------
   * Element.closest
   * ---------------------------------------------------------------------
   * 逐级向上比对选择器，用 getAttribute 代替 matches（后者同样是后期新增）。
   * 只支持标签、类、属性与 #id —— 覆盖本库用到的全部场景。
   * --------------------------------------------------------------------- */
  if (!Element.prototype.closest) {
    Element.prototype.closest = function (selector) {
      var el = this;
      while (el && el.nodeType === 1) {
        if (matchesSimple(el, selector)) return el;
        el = el.parentElement;
      }
      return null;
    };
  }

  /**
   * 极简选择器匹配：支持 `tag`、`.class`、`#id`、`[attr]`、`[attr="v"]`。
   * 逗号分隔的多个选择器取"任一命中"。
   */
  function matchesSimple(el, selector) {
    var parts = String(selector).split(',');
    for (var i = 0; i < parts.length; i++) {
      if (matchOne(el, parts[i].trim())) return true;
    }
    return false;
  }

  function matchOne(el, sel) {
    if (!sel) return false;
    var rest = sel;

    /* 标签名 */
    var m = rest.match(/^([a-zA-Z][\w-]*)/);
    if (m) {
      if (el.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
      rest = rest.slice(m[1].length);
    }
    /* 类 */
    var cls = rest.match(/\.([\w-]+)/g);
    if (cls) {
      for (var i = 0; i < cls.length; i++) {
        var name = cls[i].slice(1);
        if (!(' ' + el.className + ' ').indexOf(' ' + name + ' ') > -1) return false;
      }
    }
    /* id */
    var id = rest.match(/#([\w-]+)/);
    if (id && el.id !== id[1]) return false;
    /* 属性 */
    var attr = rest.match(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/);
    if (attr) {
      var v = el.getAttribute(attr[1]);
      if (v === null) return false;
      if (attr[2] !== undefined && v !== attr[2]) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------------------
   * Array.from
   * --------------------------------------------------------------------- */
  if (!Array.from) {
    Array.from = function (obj) {
      var out = [];
      if (obj === null || obj === undefined) return out;
      if (typeof obj.length === 'number') {
        for (var i = 0; i < obj.length; i++) out.push(obj[i]);
      } else {
        for (var k in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, k)) out.push(obj[k]);
        }
      }
      return out;
    };
  }

  /* ------------------------------------------------------------------------
   * requestAnimationFrame（IE9 与极老 WebView 可能没有）
   * --------------------------------------------------------------------- */
  if (!global.requestAnimationFrame) {
    global.requestAnimationFrame = function (cb) {
      return global.setTimeout(function () {
        cb(Date.now ? Date.now() : new Date().getTime());
      }, 16);
    };
    global.cancelAnimationFrame = function (id) {
      global.clearTimeout(id);
    };
  }
})(window);
