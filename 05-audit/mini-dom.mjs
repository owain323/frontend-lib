/**
 * mini-dom.mjs — 行为核单测用的**最小 DOM 桩**
 * ============================================================================
 * 🔴 为什么自己造，不用 jsdom
 * ---------------------------------------------------------------------------
 *   本库的卖点之一是「**零运行时依赖**」。测试依赖不进产物，但——
 *   加进 devDependencies 仍然会被读者质疑"为什么一个 vanilla 库需要 jsdom"。
 *   而 5 个行为核真正用到的 DOM API 只有 11 个（见下），自己写 60 行就够。
 *
 *   用到的面（实测，不是猜的）：
 *     document.addEventListener / removeEventListener / createEvent
 *     document.activeElement / body / contains
 *     element.addEventListener / removeEventListener / contains / dispatchEvent / focus
 *     window.__flDismiss（核之间的共享栈）
 *
 * ⚠️ 桩与真浏览器的差异（**必须知道，否则测试会骗人**）：
 *   ① **不冒泡**。真浏览器的 dispatchEvent 会沿树向上冒泡；
 *      本桩只在**注册了监听的那个对象**上触发。
 *      ⇒ 能测「监听器被调用没」，**测不出**冒泡顺序与 stopPropagation 的效果。
 *      那部分由**浏览器里的契约门禁**负责（见 toast/overlay 的 Esc 栈测试）。
 *   ② contains 是按**显式登记的子节点**判的，不按 DOM 树。
 *   ③ 不支持捕获阶段（addEventListener 第三参数被忽略）。
 *   ④ focus() 不会自动滚动、不触发 blur/focus 事件。
 *
 *   ⇒ 职责划分：**桩测「核的逻辑分支」**，浏览器门禁测「真实事件流」。
 *      两者缺一不可，不要用桩的通过去宣称"事件流正确"。
 * ============================================================================
 */

/** 造一个最小元素
 *
 *  🔴 `ownerDocument` 必须由 makeDoc() **回填**：
 *     focus() 要写 `ownerDocument.activeElement`。
 *     早期版本让 focus() 直接引用模块级变量 `doc`，而 `doc` 只存在于
 *     makeDoc() 的作用域里 ⇒ `doc is not defined` ⇒ 抛错 ⇒
 *     focus-return.restore() 的 try/catch 把它吞掉、返回 false
 *     ⇒ 表现为「焦点明明回去了，restore() 却说没成功」。
 *     这类"桩自己坏了、被被测代码的容错吃掉"的失败最难查，
 *     所以 focus 改成**显式报出**而不是静默。
 */
export function el(tag = 'div', opts = {}) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parent: null,
    ownerDocument: opts.ownerDocument || null,
    textContent: opts.textContent || '',
    _listeners: {},
    _attrs: {},
    /** 显式登记的孩子 —— 桩里 contains 只认这个，不按DOM 树推导 */
    _kids: [],
    getAttribute: (k) => (k in (node._attrs || {}) ? node._attrs[k] : null),
    setAttribute: (k, v) => {
      node._attrs = node._attrs || {};
      node._attrs[k] = String(v);
    },
    removeAttribute: (k) => {
      if (node._attrs) delete node._attrs[k];
    },
    hasAttribute: (k) => !!(node._attrs && k in node._attrs),
    addEventListener(type, fn) {
      (node._listeners[type] = node._listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      const a = node._listeners[type];
      if (!a) return;
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    /** 只触发注册在**自己**身上的监听器（不冒泡，见头注释 ①） */
    dispatchEvent(ev) {
      const e = ev || {};
      e.target = e.target || node;
      /* 🔴 这两个标志必须**预先初始化为 false**：
         真浏览器里 `ev.defaultPrevented` 初始就是 false，
         而"没被 preventDefault"和"字段不存在"是两回事。
         不初始化 ⇒ 测试断言 `=== false` 会失败，并被误读成"核没生效"。 */
      if (typeof e.defaultPrevented === 'undefined') e.defaultPrevented = false;
      if (typeof e._stopped === 'undefined') e._stopped = false;
      e.preventDefault = e.preventDefault || function () { e.defaultPrevented = true; };
      e.stopPropagation = e.stopPropagation ||
        function () { e._stopped = true; };
      const a = node._listeners[e.type] || [];
      a.slice().forEach((fn) => fn.call(node, e));
      return !e.defaultPrevented;
    },
    /** 声明子节点，让 contains 能判 true */
    _adopt(child) {
      node._kids.push(child);
      child.parent = node;
      return child;
    },
    contains(other) {
      if (other === node) return true;
      return node._kids.some((c) => c.contains(other));
    },
    focus() {
      /* ⚠️ 没有 ownerDocument 就是桩坏了 —— 显式抛，别让被测代码的
         try/catch 把它吞掉后变成一个看不懂的 false。 */
      if (!node.ownerDocument) {
        throw new Error('mini-dom: 元素没有 ownerDocument（桩没接好）');
      }
      node.ownerDocument.activeElement = node;
      node.focused = true;
    },
    click() {
      node.dispatchEvent({ type: 'click' });
    },
  };
  return node;
}

/** 造一个 document（含 body 与 activeElement），返回 { document, window } */
export function makeDoc() {
  const doc = {
    body: el('body'),
    activeElement: null,
    _listeners: {},
  };
  doc.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };
  doc.removeEventListener = function (type, fn) {
    const a = this._listeners[type];
    if (!a) return;
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  };
  /* 🔴 事件的派发要走到**document** 上（核把外部点击判定挂在 document 捕获阶段）。
     之前漏了这个方法 ⇒ 6 条测试报 "dispatchEvent is not a function"。 */
  doc.dispatchEvent = function (ev) {
    const e = ev || {};
    e.target = e.target || doc.body;
    if (typeof e.defaultPrevented === 'undefined') e.defaultPrevented = false;
    if (typeof e._stopped === 'undefined') e._stopped = false;
    e.preventDefault = e.preventDefault || function () { e.defaultPrevented = true; };
    e.stopPropagation = e.stopPropagation ||
      function () { e._stopped = true; };
    const a = doc._listeners[e.type] || [];
    a.slice().forEach((fn) => fn.call(doc, e));
    return !e.defaultPrevented;
  };
  doc.contains = (n) => !!n;
  doc.createEvent = (type) => ({
    type,
    keyCode: 0,
    initEvent() {},
    initKeyboardEvent() {},
  });

  const win = { document: doc };
  doc.activeElement = doc.body;
  /* 🔴 回填 ownerDocument：body 与它之后创建的所有元素都要指向这份 doc */
  doc.body.ownerDocument = doc;
  return { document: doc, window: win };
}

/** 在已有 document 上造元素（自动接好 ownerDocument） */
export function bel(tag, doc) {
  const n = el(tag);
  n.ownerDocument = doc;
  return n;
}

/**
 * 在桩里跑一个 IIFE / 顶层 var 脚本，**返回它定义的所有顶层名字**。
 *
 * 🔴 为什么不能从 `window` 上取：
 *   行为核是**顶层 `var flXxx = ...`**，**故意不挂 window** ——
 *   约束写着「可被整块注入 · 不新增任何全局」（它们会被 gen-behavior.py
 *   整块注入进组件文件，成为那个文件的局部变量）。
 *   ⇒ 在 node 里跑完，只能从**执行上下文的全局对象**上取。
 *
 * @param {string} src   脚本文本
 * @param {object} win   造出来的 window（含 document）
 * @returns {object} 该脚本定义/挂上的名字集合
 */
export function loadScript(src, win) {
  const vm = req('node:vm');
  const ctx = {
    window: win,
    document: win.document,
  };
  ctx.globalThis = ctx;
  /* 🔴 vm 上下文默认**没有**定时器，而 typeahead 核用 setTimeout 做
     缓冲超时（timeout 默认 500ms）⇒ 8 条测试报 "setTimeout is not defined"。
     传入真实定时器：单测要的就是"超时逻辑真的能跑"。 */
  ctx.setTimeout = setTimeout;
  ctx.clearTimeout = clearTimeout;
  ctx.setInterval = setInterval;
  ctx.clearInterval = clearInterval;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'core.js' });
  return ctx;
}

/**
 * 造一个键盘事件。
 *
 * 🔴 `keyCode` 必须按字符推导，**不能一律给 27**：
 *   dismissable 核的 Esc 判定是
 *     if (k !== 'Escape' && k !== 'Esc' && e.keyCode !== 27) return;
 *   ⇒ 若桩把所有键都写成 keyCode=27，按 Enter / a 也会被判成 Esc。
 *   而真浏览器的 keyCode 是按**键**定的（Esc=27、Enter=13、字母=ASCII）。
 */
const KEY_CODES = {
  Escape: 27, Esc: 27, Enter: 13, Tab: 9, ' ': 32, Spacebar: 32,
  Backspace: 8, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39,
  Home: 36, End: 35,
};

export function key(k, extra) {
  const isChar = typeof k === 'string' && k.length === 1;
  const code = Object.prototype.hasOwnProperty.call(KEY_CODES, k)
    ? KEY_CODES[k]
    : (isChar ? k.toUpperCase().charCodeAt(0) : 0);
  return Object.assign(
    { type: 'keydown', key: k, keyCode: code, target: null },
    extra || {});
}

/* node: 内置模块在 ESM 里没有全局 require —— 用 createRequire 拿。
   只在测试环境使用，不进产物。 */
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);