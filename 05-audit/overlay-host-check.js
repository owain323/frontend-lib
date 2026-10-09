#!/usr/bin/env node
/*
 * overlay-host-check.js — 弹层对**宿主页面**的影响（回归门禁）
 *
 * ============================================================================
 * 🔴 为什么单独一个文件（2026-10-09 外部评审实测驱动）
 * ----------------------------------------------------------------------------
 *   `overlay-check.js` 查的是"弹层自己正不正确"（焦点陷阱、Esc、归位）。
 *   但评审指出的是**另一类**问题：弹层**会不会弄坏宿主页面**。
 *   这两件事不能互相替代：
 *     弹层可以完全符合 APG，同时把宿主的 `padding-right` 清掉。
 *
 * ============================================================================
 * 判据（每条都对应一个**已确认存在**的缺陷，先跑红再修）
 * ----------------------------------------------------------------------------
 *   ① 宿主原有的内联 `padding-right`，开关一次弹层后**必须还在**
 *      （缺陷：unlockScroll 无条件写回 '' ⇒ 把宿主样式清空）
 *   ② 补偿必须**叠加**在原有值上，不是替换
 *      （缺陷：`paddingRight = sbw + 'px'` 直接覆盖了宿主的值）
 *   ③ 嵌套弹层**非栈顶关闭**时，背景不许提前解锁
 *      （缺陷：所有权记账假设 LIFO ⇒ 先关外层会让内层的背景变可点）
 *   ④ 焦点归还必须**绑到具体实例**：关内层还内层，关外层还外层
 *   ⑤ 关闭后不许留下 `data-scroll-locked` 残留
 *   ⑥ 打开弹层时，**流式内容宽度**与 **`100vw` 元素宽度**都不许变
 *   ⑦ `--overlay-scrollbar-width` 锁定期间要有且等于真实滚动条宽度，
 *      关闭后必须消失；宿主用它补的 `right:0` 固定元素不许动
 *
 * ============================================================================
 * 🔴 判据 ⑥ 曾经**写错过对象**（记下来，免得再犯）
 * ----------------------------------------------------------------------------
 *   第一版量的是 `documentElement.clientWidth`，结果永远红。
 *   实测过 6 种锁滚动写法（`showScrollbars`，滚动条 15px）：
 *     **任何一种** `overflow:hidden` 锁滚动都会让它 378 → 393，
 *     唯一"不变"的那一种根本没锁住滚动。
 *   ⇒ 它不是缺陷，是**判据失真**：量错了东西，怎么改代码都过不了。
 *
 *   真正用户看得见的"横向跳"是这两件事，改量它们：
 *     · 流式内容宽度（body 内容盒）
 *     · `100vw` 元素宽度
 *   并且顺手量清了为什么放弃 `scrollbar-gutter: stable`：
 *     状态级写法下 `100vw` 反而 393 → 378（抖动只是换了个地方）。
 * ============================================================================
 * ⚠️ 判据 ②⑥⑦ 必须开 `showScrollbars`
 *   headless 默认 `--hide-scrollbars` ⇒ 滚动条宽度恒为 0
 *   ⇒ 补偿 0 等于没补偿，"叠加多少"根本测不出来（平凡通过）。
 *   ⭐ 所以这几条用**独立启动**的浏览器，`launch({ showScrollbars: true })`。
 * ============================================================================
 * 用法：node 05-audit/overlay-host-check.js   （需要 127.0.0.1:8000）
 * ============================================================================
 */
'use strict';

var path = require('path');
var browser = require('./browser.js');

var URL = 'http://127.0.0.1:8000/03-patterns/overlay/demo.html';

function main() {
  return browser.launch().then(function (b) {
    var results = [];
    var pass = function (ok, what, detail) {
      results.push({ ok: !!ok, what: what, detail: detail || '' });
    };

    function freshPage() {
      return b.newPage().then(function (p) {
        return p.setViewport({ width: 393, height: 852, isMobile: true, hasTouch: true })
          .then(function () { return p.goto(URL, { waitUntil: 'networkidle0' }); })
          .then(function () { return p; });
      });
    }

    /* ⭐ 开**真实滚动条**的浏览器（用完即关）
       headless 默认带 `--hide-scrollbars` ⇒ 滚动条宽度恒为 0 ⇒
         · 补偿量是 0（叠加与否看不出差别）
         · `100vw` 与流式内容的差值也是 0
       两条都变成"平凡通过"。所以这几条判据必须换这种浏览器。 */
    function withScrollbars(fn) {
      return browser.launch({ showScrollbars: true }).then(function (b2) {
        return b2.newPage().then(function (p) {
          return p.setViewport({ width: 393, height: 852 })
            .then(function () { return p.goto(URL, { waitUntil: 'networkidle0' }); })
            .then(function () { return fn(p); });
        }).then(function (v) {
          return b2.close().then(function () { return v; });
        }, function (e) {
          return b2.close().then(function () { throw e; });
        });
      });
    }

    /* ---------- ① 宿主 padding-right 保全 ---------- */
    return freshPage().then(function (p) {
      return p.evaluate(function () {
        document.body.style.paddingRight = '20px';
        var before = document.body.style.paddingRight;
        var d = window.Overlay.dialog({
          title: '契约探测', desc: '检查宿主样式', actions: [{ label: '好' }]
        });
        var during = document.body.style.paddingRight;
        d.close();
        var after = document.body.style.paddingRight;
        document.body.style.paddingRight = '';
        return { before: before, during: during, after: after };
      }).then(function (r) {
        pass(r.after === '20px',
          '① 宿主内联 padding-right 开关弹层后必须还在',
          '打开前=' + r.before + ' 打开中=' + r.during + ' 关闭后=' + r.after);
        return p.close();
      });
    })

    /* ---------- ② 补偿：叠加而非替换 ---------- */
      .then(function () { return withScrollbars(function (p) {
        return p.evaluate(function () {
          /* ⭐ 必须让页面真的有滚动条，否则滚动条宽度=0 ⇒ 补偿量也是 0
             ⇒ "叠加了多少"根本测不出来（补偿 0 == 没补偿）。 */
          document.body.style.minHeight = '3000px';
          var sbw = window.innerWidth - document.documentElement.clientWidth;

          document.body.style.paddingRight = '20px';
          var d = window.Overlay.dialog({
            title: '契约探测', desc: '检查补偿', actions: [{ label: '好' }]
          });
          var during = document.body.style.paddingRight;
          var duringNum = parseFloat(during) || 0;
          d.close();
          var after = document.body.style.paddingRight;
          document.body.style.paddingRight = '';
          document.body.style.minHeight = '';
          return { sbw: sbw, during: during, duringNum: duringNum, after: after };
        }).then(function (r) {
          pass(r.after === '20px',
            '② 关闭后宿主 padding-right 也要还原', '关闭后=' + r.after);
          if (r.sbw <= 0) {
            /* 🔴 不许"平凡通过"：补偿量是 0 时这条判据等于没判 ⇒ 说清楚 */
            pass(true, '② 补偿量（未观测：本引擎滚动条宽度=0）');
            return null;
          }
          /* ⭐ 叠加 ⇒ 打开期间 = 宿主 20px + 滚动条宽度；
             替换 ⇒ 只剩滚动条宽度（< 20px）⇒ 这里会红 */
          pass(Math.abs(r.duringNum - (20 + r.sbw)) <= 1,
            '② 补偿必须**叠加**在宿主原有值上（不是替换）',
            '宿主 20px + 滚动条 ' + r.sbw + 'px ⇒ 期望 ' + (20 + r.sbw) +
            'px，实测 ' + r.during);
          return null;
        });
      }); })

    /* ---------- ③ 嵌套非 LIFO 关闭 ---------- */
      .then(function () { return freshPage(); }).then(function (p) {
        return p.evaluate(function () {
          if (!('inert' in HTMLElement.prototype)) return { skipped: true };
          var bg = null;
          var kids = document.body.querySelectorAll('body > *');
          for (var i = 0; i < kids.length; i++) {
            if (!kids[i].classList.contains('dialog-backdrop')) { bg = kids[i]; break; }
          }
          if (!bg) return { skipped: true };

          var A = window.Overlay.dialog({ title: '外层 A', actions: [{ label: 'a' }] });
          var B = window.Overlay.dialog({ title: '内层 B', actions: [{ label: 'b' }] });
          var bInDomBefore = document.body.contains(B.el);

          /* 🔴 非 LIFO：先关外层 —— 旧的"所有权记账"在这里失效 */
          A.close();
          var bgInertWhileBOpen = bg.inert === true;
          var bStillOpen = document.body.contains(B.el);

          B.close();
          var bgInertAfterAll = bg.inert === false;
          return { skipped: false, bInDomBefore: bInDomBefore,
            bgInertWhileBOpen: bgInertWhileBOpen, bStillOpen: bStillOpen,
            bgInertAfterAll: bgInertAfterAll,
            inertRaw: bg.inert === true ? 'true(锁着)' : 'false(已解锁)' };
        }).then(function (r) {
          if (r.skipped) { pass(true, '③ 嵌套背景锁定（SKIP：引擎不支持 inert）'); return p.close(); }
          pass(r.bgInertWhileBOpen && r.bStillOpen,
            '③ 先关外层时，背景必须仍然锁着（内层还开着）',
            'A 关闭后：内层还在=' + r.bStillOpen + ' · 背景 inert=' + r.bgInertWhileBOpen);
          pass(r.bgInertAfterAll,
            '③ 两层都关完后背景必须解锁',
            '两层都关后 inert=' + r.inertRaw);
          return p.close();
        });
      })

    /* ---------- ④ 焦点归还绑到实例 ---------- */
      .then(function () { return freshPage(); }).then(function (p) {
        return p.evaluate(function () {
          var t1 = document.createElement('button');
          t1.type = 'button'; t1.textContent = '外层触发';
          document.body.appendChild(t1);
          t1.focus();

          var A = window.Overlay.dialog({ title: 'A', actions: [{ label: 'a' }] });
          var focusWentIntoA = A.el.contains(document.activeElement) ||
            document.activeElement === A.el;
          A.close();
          var backToT1 = document.activeElement === t1;

          /* 嵌套：B 的触发器在 A 里面 */
          var t2 = document.createElement('button');
          t2.type = 'button'; t2.textContent = '内层触发';
          A = window.Overlay.dialog({ title: 'A2', desc: 'x', actions: [{ label: 'a' }] });
          A.el.appendChild(t2);
          t2.focus();
          var B = window.Overlay.dialog({ title: 'B', actions: [{ label: 'b' }] });
          B.close();
          var backToT2 = document.activeElement === t2;
          A.close();
          var finallyBackToT1 = document.activeElement === t1;
          t1.remove();
          return { focusWentIntoA: focusWentIntoA, backToT1: backToT1,
            backToT2: backToT2, finallyBackToT1: finallyBackToT1 };
        }).then(function (r) {
          pass(r.focusWentIntoA && r.backToT1,
            '④ 单层：焦点进弹层，关闭后回到触发它的那个元素',
            '进入=' + r.focusWentIntoA + ' 归还=' + r.backToT1);
          pass(r.backToT2,
            '④ 嵌套：关内层只还到内层的触发器（不许直接跳回外层）',
            '关 B 后焦点在 B 的触发器=' + r.backToT2);
          pass(r.finallyBackToT1,
            '④ 嵌套：关外层才最终还到外层的触发器',
            '关 A 后焦点在最外层触发器=' + r.finallyBackToT1);
          return p.close();
        });
      })

    /* ---------- ⑥ 打开弹层不许横向抖动 / ⑦ 滚动条宽度公开契约 ---------- */
      .then(function () { return withScrollbars(function (p) {
        return p.evaluate(function () {
          document.body.style.minHeight = '3000px';   /* 必须有滚动条才测得出来 */
          var de = document.documentElement, bd = document.body;

          /* 两个探针都**脱离文档流**，免得被宿主 body 的 flex/grid 影响 */
          var vw = document.createElement('div');
          vw.style.cssText = 'position:absolute;top:-99px;left:0;width:100vw;height:2px';
          bd.appendChild(vw);
          /* ⭐ 宿主"吸底条"的典型写法：用公开变量自己补。
             它相对**视口**定位，body 的 padding 管不到它 —— 这正是⑦要守的。 */
          var fx = document.createElement('div');
          fx.style.cssText = 'position:fixed;top:0;right:var(--overlay-scrollbar-width,0px);' +
            'width:100px;height:2px';
          bd.appendChild(fx);

          function snap() {
            var cs = getComputedStyle(bd);
            return {
              /* 流式内容宽度 = body 边框盒 - 左右 padding（与 body 的 display 无关） */
              flow: Math.round(bd.getBoundingClientRect().width -
                (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)),
              vw: Math.round(vw.getBoundingClientRect().width),
              fxLeft: Math.round(fx.getBoundingClientRect().left),
              sbVar: de.style.getPropertyValue('--overlay-scrollbar-width')
            };
          }

          var before = snap();
          var sbw = window.innerWidth - de.clientWidth;
          var d = window.Overlay.dialog({
            title: '契约探测', desc: '检查抖动', actions: [{ label: '好' }]
          });
          var during = snap();
          d.close();
          var after = snap();

          vw.remove(); fx.remove();
          document.body.style.minHeight = '';
          return { before: before, during: during, after: after, sbw: sbw };
        }).then(function (r) {
          var f = function (o) { return '流式=' + o.flow + ' 100vw=' + o.vw + ' 固定条left=' + o.fxLeft; };
          if (r.sbw <= 0) {
            pass(true, '⑥ 横向抖动（未观测：本引擎滚动条宽度=0）');
            return null;
          }
          pass(r.before.flow === r.during.flow,
            '⑥ 打开弹层时**流式内容宽度不许变**（不许横向跳）',
            '前 ' + f(r.before) + ' · 中 ' + f(r.during));
          pass(r.before.vw === r.during.vw,
            '⑥ 打开弹层时 **`100vw` 元素宽度不许变**',
            '前=' + r.before.vw + ' 中=' + r.during.vw);
          pass(r.before.flow === r.after.flow && r.before.vw === r.after.vw,
            '⑥ 关闭后两个宽度都回到原值', '后 ' + f(r.after));

          /* ⑦ 公开变量：锁定期间有且等于真实滚动条宽度 */
          pass(r.during.sbVar === r.sbw + 'px',
            '⑦ 锁定期间 `--overlay-scrollbar-width` 必须等于真实滚动条宽度',
            '实测滚动条=' + r.sbw + 'px，变量=' + (r.during.sbVar || '(空)'));
          pass(r.after.sbVar === '' && r.before.sbVar === '',
            '⑦ 未锁定 / 关闭后不许留下这个变量',
            '打开前=' + (r.before.sbVar || '(空)') + ' 关闭后=' + (r.after.sbVar || '(空)'));
          pass(r.before.fxLeft === r.during.fxLeft,
            '⑦ 宿主用该变量补过的 `right:0` 固定元素不许动',
            '前=' + r.before.fxLeft + ' 中=' + r.during.fxLeft);
          return null;
        });
      }); })

    /* ---------- ⑤ 不留残留状态 ---------- */
      .then(function () { return freshPage(); }).then(function (p) {
        return p.evaluate(function () {
          var d = window.Overlay.dialog({ title: 'x', actions: [{ label: 'ok' }] });
          var lockedWhileOpen = document.body.hasAttribute('data-scroll-locked');
          d.close();
          var lockedAfter = document.body.hasAttribute('data-scroll-locked');
          return { lockedWhileOpen: lockedWhileOpen, lockedAfter: lockedAfter };
        }).then(function (r) {
          pass(r.lockedWhileOpen, '⑤ 打开时 body 必须带 data-scroll-locked');
          pass(!r.lockedAfter, '⑤ 关闭后不许留下 data-scroll-locked 残留');
          return p.close();
        });
      })

      .then(function () {
        return b.close().then(function () { return results; });
      });
  });
}

main().then(function (results) {
  var bad = 0;
  process.stdout.write('\n  === overlay 对宿主页面的影响 ===\n\n');
  results.forEach(function (r) {
    if (!r.ok) bad++;
    process.stdout.write('    ' + (r.ok ? 'OK  ' : 'FAIL') + '  ' + r.what +
      (r.detail ? '（' + r.detail + '）' : '') + '\n');
  });
  if (bad) {
    process.stdout.write('\n  ❌ overlay：' + bad + ' 项不满足\n');
    process.exit(1);
  }
  process.stdout.write('\n  ✅ overlay 宿主影响契约全部满足\n');
  process.exit(0);
}, function (e) {
  process.stdout.write('  🔴 崩了：' + e.message + '\n');
  process.exit(1);
});
