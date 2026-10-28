#!/usr/bin/env node
/*
 * combobox-instance-check.js — Combobox **实例级**契约（回归门禁）
 *
 * ============================================================================
 * 🔴 为什么单独一个文件
 * ----------------------------------------------------------------------------
 *   `combobox-check.js` 查的是"组件在 demo 页面里正不正确"
 *   （语义、焦点常驻 input、Backspace/Enter/Esc、过滤高亮）。
 *
 *   这里要覆盖的是**另一类**问题：这些只有在**自己造实例**时才测得出来——
 *     · `max` 到底是不是真上限（公开 add() / 点击 / Enter 三条路各走一遍）
 *     · `disabled` 是不是全链路（`setActive` 在**读** aria-disabled，
 *       但渲染从来**不写** ⇒ 那段跳过逻辑是死代码）
 *     · 实例有没有 `destroy()`（`document` 级监听注册了却没人摘）
 *     · 两个实例的自动 id 会不会撞（调用方自己给了 list id 才会触发）
 *     · `closest()` 兼容兜底到底能不能跑到
 *   ⇒ 每一条都要**在页面里现造实例**，demo 页面上查不出来。
 *
 * ============================================================================
 * 判据
 * ----------------------------------------------------------------------------
 *   ① `max` 是**硬上限**：公开 `add()` / 点选项 / Enter 提交，三条路都不能超
 *   ② `disabled` 全链路：渲染写 aria-disabled；↓ 游标跳过；全禁用时游标无处可落；
 *      点击 / Enter / 公开 add() 都拒绝
 *   ③ `destroy()`：存在且幂等；调用后组件失效；**document 级监听真的被摘除**
 *      （按函数引用核对，不是数个数）
 *   ④ 调用方**自己给了 list id** 时，多个实例的 input id 不许撞
 *   ⑤ 删掉原生 `Element.prototype.closest` 后，标签删除**仍然生效**
 *      （现状 `e.target.closest ? closest(...) : null` ⇒ 兜底永远跑不到）
 *
 * ============================================================================
 * 🔴🔴 第一版有 4 条**假绿**（记下来，这是最容易犯的错）
 * ----------------------------------------------------------------------------
 *   · ① 点击路径：一次取 3 个选项再逐个 `.click()` —— 第一次点完 `paintList()`
 *     就重写 `innerHTML`，后两个节点**已经脱离文档**，事件根本不冒泡到 list
 *     ⇒ 实际只点了 1 个，"没超上限"是假的。
 *     ⇒ 改成**每次重新查** DOM，逐个点，并且用干净实例。
 *   · ② 全禁用：判据写成"落在禁用项上才算错"，而 `aria-disabled` 从不写入
 *     ⇒ 恒为 false ⇒ 平凡通过。⇒ 收紧成"必须**无处可落**（activedescendant=null）"。
 *   · ② 点禁用项：按 `aria-disabled="true"` 去找禁用项 —— 既然从不写入，
 *     根本**选不到**，`if (disOpt)` 整段被跳过 ⇒ 一次都没点。
 *     ⇒ 改成按**配置里声明的 disabled** 定位（data-value）。
 *   · ① Enter 路径：第一次提交后旧代码会把列表 `close()`，
 *     第二次 Enter 时列表已关、输入为空 ⇒ 什么都没加 ⇒ 偶然正确。
 *     ⇒ 改成"满了以后**再输一个有效词**并↓+Enter"，这才真的顶到上限。
 *
 *   ⇒ 教训：判据绿了不等于判据对。**必须先证明它会红。**
 * ============================================================================
 * ⚠️ 判据 ③ 怎么测"监听被摘除"
 *   数个数不够（别处也会注册 click）。这里在**造实例之前**劫持
 *   `document.addEventListener / removeEventListener`，记下同一个**函数引用**：
 *     destroy 后必须出现 removeEventListener(同引用) ⇒ 才算真的摘了。
 * ============================================================================
 * 用法：node 05-audit/combobox-instance-check.js   （需要 127.0.0.1:8000）
 * ============================================================================
 */
'use strict';

var browser = require('./browser.js');

var URL = 'http://127.0.0.1:8000/02-primitives/combobox/demo.html';

/* 页面里造一个**自足**的 Combobox 实例（不依赖 demo 的具体结构）。
   ⭐ `listId` 用来复现"调用方自己给了 list id"这个触发条件（判据 ④）。
   ⭐ 各判据都用干净实例，用完必须 destroy，否则互相污染。 */
var HARNESS = [
  'window.__mk = function (opt, listId) {',
  '  var d = document.createElement("div");',
  '  d.className = "combo";',
  '  d.innerHTML = \'<div class="combo__field">\' +',
  '                \'<input class="combo__input" data-combo-input>\\n\' +',
  '                \'</div>\' +',
  '                \'<div data-combo-tags></div>\' +',
  '                \'<ul data-combo-list></ul>\';',
  '  if (listId) d.querySelector("[data-combo-list]").id = listId;',
  '  document.body.appendChild(d);',
  '  return { root: d, cb: window.Combobox.create(d, opt || {}) };',
  '};',
  '/* 每点一次就**重新查** DOM：点完会重绘，旧节点已经不在文档里 */',
  'window.__clickNth = function (root, n) {',
  '  var os = [].slice.call(root.querySelectorAll(\'[role="option"]\'));',
  '  if (os.length <= n) return false;',
  '  os[n].click();',
  '  return true;',
  '};',
  'window.__key = function (el, k) {',
  '  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));',
  '};',
  'window.__type = function (el, v) {',
  '  el.value = v;',
  '  el.dispatchEvent(new Event("input", { bubbles: true }));',
  '};'
].join('\n');

function main() {
  return browser.launch().then(function (b) {
    var results = [];
    var pass = function (ok, what, detail) {
      results.push({ ok: !!ok, what: what, detail: detail || '' });
    };

    return b.newPage().then(function (p) {
      return p.setViewport({ width: 393, height: 852, isMobile: true, hasTouch: true })
        .then(function () { return p.goto(URL, { waitUntil: 'networkidle0' }); })
        .then(function () { return p.evaluate(HARNESS); })

        /* ---------- ① max 是硬上限 ---------- */
        .then(function () {
          return p.evaluate(function () {
            var out = {};

            /* (a) 公开 add()：干净实例，max=2，连加三个不同的值 */
            var ha = window.__mk({
              max: 2,
              options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' },
                        { value: 'c', label: '丙' }]
            });
            out.r1 = ha.cb.add('a');
            out.r2 = ha.cb.add('b');
            out.r3 = ha.cb.add('c');        /* 超上限：必须被拒绝 */
            out.tagsAfterAdd = ha.cb.tags.slice();

            /* (b) 点击路径：干净实例，max=2，点第 0、1、2 个选项
               ⭐ 每次点之前重新查 DOM（点完会重绘）*/
            var hb = window.__mk({
              max: 2,
              options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' },
                        { value: 'c', label: '丙' }]
            });
            var ib = hb.root.querySelector('[data-combo-input]');
            ib.focus();
            window.__type(ib, '');
            var clicked = 0;
            for (var k = 0; k < 3; k++) {
              if (window.__clickNth(hb.root, k)) clicked++;
            }
            out.clicked = clicked;
            out.tagsAfterClick = hb.cb.tags.slice();

            /* (c) Enter 路径：干净实例，max=1。
               先正常加一个；**满了以后再输一个有效词**并 ↓+Enter ⇒ 必须加不进去 */
            var hc = window.__mk({
              max: 1,
              options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }]
            });
            var ic = hc.root.querySelector('[data-combo-input]');
            ic.focus();
            window.__type(ic, '');
            window.__key(ic, 'ArrowDown');
            window.__key(ic, 'Enter');                 /* ⇒ 应该加进 x */
            out.tagsAfterFirst = hc.cb.tags.slice();
            window.__type(ic, 'y');                    /* 满了还继续输 */
            window.__key(ic, 'ArrowDown');
            window.__key(ic, 'Enter');                 /* ⇒ 必须加不进去 */
            out.tagsAfterEnter = hc.cb.tags.slice();

            [ha, hb, hc].forEach(function (h) {
              if (h.cb.destroy) h.cb.destroy();
              h.root.parentNode.removeChild(h.root);
            });
            return out;
          });
        })
        .then(function (r) {
          pass(r.r3 === false && r.tagsAfterAdd.length === 2,
            '① max：公开 add() 不许超上限',
            'max=2，连加三个 ⇒ 第三个返回 ' + r.r3 + '，实际 ' +
            r.tagsAfterAdd.length + ' 个（' + r.tagsAfterAdd.join(',') + '）');
          pass(r.tagsAfterClick.length <= 2,
            '① max：点选项路径不许超上限',
            '逐个点了 ' + r.clicked + ' 个不同选项 ⇒ ' + r.tagsAfterClick.length +
            ' 个（' + r.tagsAfterClick.join(',') + '）');
          pass(r.tagsAfterEnter.length <= 1,
            '① max：Enter 提交路径不许超上限',
            'max=1，第一次提交后 ' + r.tagsAfterFirst.length + ' 个；满了再提交一次 ⇒ ' +
            r.tagsAfterEnter.length + ' 个（' + r.tagsAfterEnter.join(',') + '）');
          return null;
        })

        /* ---------- ② disabled 全链路 ---------- */
        .then(function () {
          return p.evaluate(function () {
            var out = {};
            var h = window.__mk({
              options: [{ value: 'a', label: '甲', disabled: true },
                        { value: 'b', label: '乙' },
                        { value: 'c', label: '丙', disabled: true }]
            });
            var inp = h.root.querySelector('[data-combo-input]');
            inp.focus();
            window.__type(inp, '');
            var os = [].slice.call(h.root.querySelectorAll('[role="option"]'));
            out.rendered = os.map(function (o) {
              return o.getAttribute('aria-disabled');
            });
            out.vals = os.map(function (o) { return o.getAttribute('data-value'); });

            /* ↓ 一次：应落在 'b' 上（跳过 a） */
            window.__key(inp, 'ArrowDown');
            var ad = inp.getAttribute('aria-activedescendant');
            out.activeVal = null;
            if (ad) {
              var el = document.getElementById(ad);
              if (el) out.activeVal = el.getAttribute('data-value');
            }

            /* 全禁用：游标**无处可落** ⇒ 不许设 activedescendant */
            var h2 = window.__mk({
              options: [{ value: 'p', label: 'P', disabled: true },
                        { value: 'q', label: 'Q', disabled: true }]
            });
            var i2 = h2.root.querySelector('[data-combo-input]');
            i2.focus();
            window.__type(i2, '');
            window.__key(i2, 'ArrowDown');
            var ad2 = i2.getAttribute('aria-activedescendant');
            out.allDisabledActive = ad2;
            out.allDisabledOnDisabled = null;
            if (ad2) {
              var el2 = document.getElementById(ad2);
              if (el2) out.allDisabledOnDisabled =
                el2.getAttribute('aria-disabled') === 'true';
            }

            /* 点禁用项 ⇒ 不许加（按**配置**定位 'a'，不靠渲染出来的属性）*/
            var before = h.cb.tags.length;
            window.__clickNth(h.root, 0);        /* 第 0 项就是配置里 disabled 的 a */
            out.afterClick = h.cb.tags.slice();
            out.before = before;

            /* Enter 提交落在禁用项上 ⇒ 不许加 */
            var h3 = window.__mk({
              options: [{ value: 'a', label: '甲', disabled: true }]
            });
            var i3 = h3.root.querySelector('[data-combo-input]');
            i3.focus();
            window.__type(i3, '');
            window.__key(i3, 'ArrowDown');
            window.__key(i3, 'Enter');
            out.afterEnterDisabled = h3.cb.tags.slice();

            /* 公开 add() 拒绝禁用项
               🔴 必须用**干净实例**：在 h 上 'a' 刚才已经被点进去了，
                  那儿 add('a') 返回 false 只是"去重"在起作用，
                  ⇒ 判据会**平凡通过**（第一版就踩了这个）。 */
            var h4 = window.__mk({
              options: [{ value: 'a', label: '甲', disabled: true }]
            });
            out.addDisabled = h4.cb.add('a');
            out.addDisabledTags = h4.cb.tags.slice();

            [h, h2, h3, h4].forEach(function (x) {
              if (x.cb.destroy) x.cb.destroy();
              x.root.parentNode.removeChild(x.root);
            });
            return out;
          });
        })
        .then(function (r) {
          var want = ['true', null, 'true'];
          pass(JSON.stringify(r.rendered) === JSON.stringify(want),
            '② disabled：渲染必须写出 aria-disabled',
            '三个选项（禁/普通/禁）⇒ 实际 ' + JSON.stringify(r.rendered) +
            '，期望 ' + JSON.stringify(want));
          pass(r.activeVal === 'b',
            '② disabled：↓ 游标必须跳过禁用项',
            '第一项禁用 ⇒ ↓ 后落在 data-value=' + r.activeVal + '（期望 b）');
          pass(r.allDisabledActive === null,
            '② disabled：全禁用时游标**无处可落**（不许设 activedescendant）',
            '两个都禁用 ⇒ activedescendant=' + r.allDisabledActive);
          pass(r.afterClick.indexOf('a') < 0,
            '② disabled：点禁用项不许加为标签',
            '点第 0 项（配置里 disabled 的 a）后 ⇒ [' + r.afterClick.join(',') + ']');
          pass(r.afterEnterDisabled.length === 0,
            '② disabled：Enter 提交落在禁用项上不许加',
            '只有一项且禁用 ⇒ ↓+Enter 后 ' + r.afterEnterDisabled.length + ' 个');
          pass(r.addDisabled === false && r.addDisabledTags.length === 0,
            '② disabled：公开 add() 拒绝禁用项（干净实例，排除"去重"的干扰）',
            'add("a") 返回 ' + r.addDisabled + '，标签 ' +
            r.addDisabledTags.length + ' 个');
          return null;
        })

        /* ---------- ③ destroy() ---------- */
        .then(function () {
          return p.evaluate(function () {
            var added = [], removed = [];
            var origAdd = document.addEventListener;
            var origRem = document.removeEventListener;
            /* ⭐ 劫持：只统计 document 上的 click 监听，并记**函数引用** */
            document.addEventListener = function (t, f, o) {
              if (t === 'click' && typeof f === 'function') added.push(f);
              return origAdd.call(document, t, f, o);
            };
            document.removeEventListener = function (t, f, o) {
              if (t === 'click' && typeof f === 'function') removed.push(f);
              return origRem.call(document, t, f, o);
            };
            /* 🔴 记下造实例**之前** document 上已有哪些 click 监听。
               核的 shared.bound 守卫会让「第一个实例之后的实例」一个都不注册
               ⇒「本次注册了几个」不是判据关心的事；
               真正要保证的是：**destroy 之后回到基线状态**。 */
            var baseline = added.length;
            /* 核的共享栈深度（组件层泄漏的探针） */
            var stackBaseline = (window.__flDismiss &&
              window.__flDismiss.stack.length) || 0;
            var h;
            try {
              h = window.__mk({ options: [{ value: 'a', label: '甲' }] });
            } finally {
              /* ⭐ 只还原 add —— remove 的劫持必须**留到 destroy 之后**，
                 否则 destroy 里那次 removeEventListener 根本记录不到
                 （第一版就踩了这个：判据自己漏记，却报成产品没摘）。 */
              document.addEventListener = origAdd;
            }
            var hasDestroy = typeof h.cb.destroy === 'function';
            var registeredDuringCreate = added.slice();

            var inp = h.root.querySelector('[data-combo-input]');
            var list = h.root.querySelector('[data-combo-list]');
            h.cb.add('a');

            /* 🔴 没有 destroy 时**不许崩**：崩了就报不出"哪一项不满足"，
               那比判红更糟（看日志的人只看到 stack trace）。
               ⇒ 防御式调用，把"没有 destroy"当作一条正常的判红报出去。 */
            var destroyed = false;
            if (hasDestroy) {
              try { h.cb.destroy(); destroyed = true; } catch (e) { destroyed = false; }
            }

            var openedAfterDestroy = null;
            if (destroyed) {
              list.hidden = true;
              window.__type(inp, 'x');
              openedAfterDestroy = !list.hidden;
            }

            /* 幂等：再 destroy 一次不许抛，**也不许重复调核的 destroy**。
               🔴 0.8.8 两次修正的教训（都实测过）：
                  ① 只测「不抛」⇒ 没牙 —— 核的 destroy 自身幂等，不抛
                  ② 改成测「不重复摘 document 监听」⇒ 也没牙 ——
                     二次 removeEventListener 走的是**元素监听**，
                     而我的劫持只记 document 上的 click ⇒ 记不到
               ⇒ 真正能测的是：**二次 destroy 时核的 destroy 被调了几次**。
                  给核的 destroy 打一个计数哨兵（不改产品代码，
                  靠 shared 栈的长度变化 + 显式计数函数）。 */
            var idempotent = false, secondDestroyRemoved = null;
            if (hasDestroy) {
              var removedBefore2nd = removed.length;
              var stackBefore2nd = (window.__flDismiss &&
                window.__flDismiss.stack.length) || 0;
              idempotent = true;
              try { h.cb.destroy(); } catch (e) { idempotent = false; }
              secondDestroyRemoved = removed.length - removedBefore2nd;
              /* 栈长度变化才是"二次 destroy 真的又动了一次"的信号：
                 若守卫生效，栈已回到基线，二次调用不该再变。 */
              secondDestroyRemoved += Math.abs(
                ((window.__flDismiss && window.__flDismiss.stack.length) || 0)
                - stackBefore2nd);
            }

            /* ⭐ 关键：destroy 里摘掉的必须是**造实例时注册的那个函数** */
            var removedMine = removed.filter(function (f) {
              return registeredDuringCreate.indexOf(f) >= 0;
            });

            /* 现在才还原 remove */
            document.removeEventListener = origRem;

            /* ⭐ 核心口径：destroy 之后，document 上还剩几个**没被摘掉的**监听
               （相对造实例之前的基线 baseline）。
               与「共享一个还是每实例一个」无关 ⇒ 换架构也不会失效。 */
            var live = added.filter(function (f) {
              return removed.indexOf(f) < 0;
            });

            /* 🔴 功能性探针：destroy 之后组件对外部事件还有没有反应。
               用「focus 后输入 → 列表是否被打开」当信号：
               destroy 之前 focus 会触发 onFocus 开列表，destroy 之后不该。 */
            var respondsAfterDestroy = false;
            try {
              list.hidden = true;
              inp.dispatchEvent(new Event('focus', { bubbles: true }));
              inp.value = 'probe';
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              respondsAfterDestroy = !list.hidden;
              list.hidden = true;
            } catch (e) { respondsAfterDestroy = false; }

            h.root.parentNode.removeChild(h.root);
            return {
              hasDestroy: hasDestroy, destroyed: destroyed,
              /* 🔴 「有没有接上核」必须**独立验证**，不能靠本次劫持的 added.length：
                 核是「全库共享一个 + 只注册一次」（shared.bound 守卫），
                 而 demo 页在脚本跑之前就创建过实例 ⇒ 核早已注册完
                 ⇒ added.length === 0 是**正常**的，不是"没接上"。

                 ⇒ 判据改成**功能性的**：destroy 之后，
                 在 document 上点一下，**组件不许再响应**。
                 这与"核有没有接上"无关（destroy 本来就该让它失效），
                 但能抓住「destroy 忘了摘、监听还在」这个真问题。
                 ⚠️ 我一度想写 everRegistered: true 来"让它过"——
                    那是**自己制造门禁假绿**，比判红更糟，已去掉。
                    现在这条只断言「回到基线」与「destroy 后无反应」两件事，
                    两者都能真抓住泄漏。 */
              everRegistered: null,   /* 不可测：核只注册一次且早于本次劫持 */
              stackBaseline: stackBaseline,
              stackAfter: (window.__flDismiss &&
                window.__flDismiss.stack.length) || 0,
              coreStackLeak: ((window.__flDismiss &&
                window.__flDismiss.stack.length) || 0) - stackBaseline,
              respondsAfterDestroy: respondsAfterDestroy,
              leftoverAfterDestroy: live.length - baseline,
              registered: registeredDuringCreate.length,
              removedMine: removedMine.length,
              openedAfterDestroy: openedAfterDestroy,
              idempotent: idempotent,
              secondDestroyRemoved: secondDestroyRemoved
            };
          });
        })
        .then(function (r) {
          pass(r.hasDestroy,
            '③ destroy() 必须存在',
            r.hasDestroy ? '返回对象上有 destroy' : '🔴 返回对象上没有 destroy');
          if (!r.hasDestroy) {
            /* 没有 destroy ⇒ 后面三条无从谈起，逐条报红而不是静默跳过 */
            pass(false, '③ destroy() 必须摘除 document 级 click 监听',
              '🔴 没有 destroy ⇒ 监听无人摘（造实例时注册了 ' + r.registered + ' 个）');
            pass(false, '③ destroy() 后组件必须失效（输入不再开列表）',
              '🔴 没有 destroy ⇒ 无从验证');
            pass(false, '③ destroy() 必须幂等', '🔴 没有 destroy ⇒ 无从验证');
            return null;
          }
          /* 🔴 0.8.8 改判据（收编 dismissable 核之后，原判据不再成立）：
             document click 监听现在是**全库共享一个**（核里有 shared.bound
             守卫，只注册一次）⇒ 原判据「造实例时注册 > 0」从第二个实例起
             必然失败（本轮实测 registered=0），但**监听确实被摘掉了**
             ⇒ 那是判据过时，不是产品漏摘。

             ⇒ 改为核对真正要保证的事，且**与「共享一个还是每实例一个」无关**：
               造实例时有人注册过 document click（否则核根本没接上）
               && destroy 之后**一个都没留下**。 */
          pass(r.leftoverAfterDestroy === 0,
            '③ destroy() 后 document 上不残留 click 监听（共享/独享都要成立）',
            '相对造实例前的基线，destroy 后残留 ' +
            r.leftoverAfterDestroy + ' 个未摘监听');
          /* ⭐ 真正能抓住「监听没摘」的一条：destroy 之后在 document 上
             派发 click + focus，看组件**还有没有反应**。
             —— 这比数监听器可靠：不依赖劫持时机、不依赖共享还是独享。 */
          pass(r.respondsAfterDestroy === false,
            '③ destroy() 之后组件对外部事件不再有反应（含残留监听）',
            'destroy 后派发 focus/click ⇒ 组件' +
            (r.respondsAfterDestroy ? '还有反应（可能残留监听）' : '已无反应'));

          /* 🔴 0.8.8 加：组件层的栈泄漏判据。
             起因：收编时漏了 dismiss.destroy() ⇒ 核的共享栈里那条记录
             （连着组件的 root）永远不释放。
             而上面几条都抓不到：
               · 「不残留 document click」—— 组件其它监听也摘了，监听确实干净
               · 「destroy 后无反应」   —— 组件真的不响应了
               · 核自己的单测         —— 它只测核，不测组件接线
             ⇒ 只能在**组件层**核对「核的栈回到基线」。 */
          pass(r.coreStackLeak === 0,
            '③ destroy() 后微行为核的共享栈必须回到基线（组件层泄漏）',
            '造实例前栈深' + r.stackBaseline + '，destroy 后栈深' +
            r.stackAfter + ' ⇒ 泄漏 ' + r.coreStackLeak + ' 条记录');

          pass(r.openedAfterDestroy === false,
            '③ destroy() 后组件必须失效（输入不再开列表）',
            'destroy 后派发 input ⇒ 列表被打开=' + r.openedAfterDestroy);
          pass(r.idempotent && r.secondDestroyRemoved === 0,
            '③ destroy() 必须幂等（重复调用不抛、也不重复摘监听）',
            r.idempotent
              ? ('未抛' + (r.secondDestroyRemoved === 0
                  ? '，且没有重复摘监听'
                  : '，但重复摘了 ' + r.secondDestroyRemoved + ' 个监听（幂等守卫失效）'))
              : '🔴 第二次调用抛了');
          return null;
        })

        /* ---------- ④ 调用方自己给了 list id 时，input id 不许撞 ---------- */
        .then(function () {
          return p.evaluate(function () {
            /* ⭐ 这正是该缺陷的触发条件：`uid` 只在 `!list.id` 时递增，
               而 `input.id = 'combo-input-' + uid` 用的是**不递增的那个** uid
               ⇒ 调用方给了 list id ⇒ 后面所有实例都拿同一个 uid。 */
            var a = window.__mk({ options: [{ value: 'a', label: '甲' }] }, 'my-list-1');
            var b = window.__mk({ options: [{ value: 'b', label: '乙' }] }, 'my-list-2');
            var c = window.__mk({ options: [{ value: 'c', label: '丙' }] }, 'my-list-3');
            var out = {
              ia: a.root.querySelector('[data-combo-input]').id,
              ib: b.root.querySelector('[data-combo-input]').id,
              ic: c.root.querySelector('[data-combo-input]').id
            };
            [a, b, c].forEach(function (h) {
              if (h.cb.destroy) h.cb.destroy();
              h.root.parentNode.removeChild(h.root);
            });
            return out;
          });
        })
        .then(function (r) {
          var uniq = {};
          [r.ia, r.ib, r.ic].forEach(function (x) { uniq[x] = 1; });
          pass(Object.keys(uniq).length === 3,
            '④ 调用方给了 list id 时，多个实例的 input id 不许撞',
            '三个实例 ⇒ ' + r.ia + ' / ' + r.ib + ' / ' + r.ic +
            '（去重后 ' + Object.keys(uniq).length + ' 个）');
          return null;
        })

        /* ---------- ⑤ closest 兜底真的跑得到 ---------- */
        .then(function () {
          return p.evaluate(function () {
            var h = window.__mk({ options: [{ value: 'a', label: '甲' }] });
            h.cb.add('a');
            var before = h.root.querySelectorAll('.combo__tag').length;
            if (!before) return { skipped: true, why: '标签没渲染出来' };
            var native = Element.prototype.closest;
            var deleted = false;
            try {
              /* ⭐ 把原生 closest 摘掉，逼兜底分支真正执行 */
              delete Element.prototype.closest;
              deleted = (typeof document.body.closest === 'undefined');
            } catch (e) { deleted = false; }
            var after = null;
            if (deleted) {
              var btn = h.root.querySelector('[data-del]');
              if (btn) btn.click();
              after = h.root.querySelectorAll('.combo__tag').length;
            }
            /* 一定要还原，否则后面的判据全被污染 */
            if (native) Element.prototype.closest = native;
            if (h.cb.destroy) h.cb.destroy();
            h.root.parentNode.removeChild(h.root);
            return { skipped: false, deleted: deleted, before: before, after: after };
          });
        })
        .then(function (r) {
          if (r.skipped) {
            pass(false, '⑤ 删掉原生 closest 后标签删除仍要生效',
              '判据没跑到：' + r.why);
            return null;
          }
          if (!r.deleted) {
            pass(false, '⑤ 删掉原生 closest 后标签删除仍要生效',
              '判据没跑到：删不掉 Element.prototype.closest');
            return null;
          }
          pass(r.after === r.before - 1,
            '⑤ 删掉原生 closest 后，标签删除**仍然生效**（兜底真跑得到）',
            '无原生 closest 时点删除按钮：' + r.before + ' → ' + r.after);
          return null;
        })

        .then(function () { return p.close(); })
        .then(function () { return results; });
    }).then(function (results) {
      return b.close().then(function () { return results; });
    }, function (e) {
      return b.close().then(function () { throw e; });
    });
  });
}

main().then(function (results) {
  var bad = 0;
  process.stdout.write('\n  === Combobox 实例级契约 ===\n\n');
  results.forEach(function (r) {
    if (!r.ok) bad++;
    process.stdout.write('    ' + (r.ok ? 'OK  ' : 'FAIL') + '  ' + r.what +
      (r.detail ? '（' + r.detail + '）' : '') + '\n');
  });
  if (bad) {
    process.stdout.write('\n  ❌ Combobox 实例契约：' + bad + ' 项不满足\n');
    process.exit(1);
  }
  process.stdout.write('\n  ✅ Combobox 实例契约全部满足\n');
  process.exit(0);
}, function (e) {
  process.stdout.write('  🔴 崩了：' + e.message + '\n');
  process.exit(1);
});
