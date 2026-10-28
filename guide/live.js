/**
 * live.js — 让文档页里的活标本撑到它自己的高度
 * ============================================================================
 * 为什么需要这个文件
 * ---------------------------------------------------------------------------
 *   组件页用 <iframe> 内嵌 demo（理由与取舍见 05-audit/gen-docs.py 的
 *   live_block()）。iframe 的默认高度是写死的，而 demo 页长短差很多：
 *   按钮七态约 2500px，report 页 5100px。写死高度只有两种结果 ——
 *   要么被裁、要么一大片空白。
 *
 * 为什么不能"量一次 scrollHeight 就设上去"（第一版就是这么写的）
 * ---------------------------------------------------------------------------
 *   实测：`table` 页在框高 100px 时 body.scrollHeight = 1924，
 *   在框高 1926px 时同一个值是 **3206** —— 同一页有两个"真实高度"。
 *   原因是它内部有随视口高度伸缩的滚动区（`height:100%` / flex 撑满那一类）。
 *   于是任何单一采样点都会得到自洽但错误的值，
 *   而 ResizeObserver 因为盒子尺寸没变**永远不触发**，错值就被固化下来。
 *
 *   还有第二层：demo 的 `body` 带 `min-height: 100vh`（页面骨架保证
 *   "内容不满一屏也铺满"）。嵌在标本框里这条规则是**反的** ——
 *   它让 scrollHeight 永远等于框高，于是"装得下"永远成立，
 *   多档采样会一路把框撑到上限（实测全部页面收敛到 7118px）。
 *
 *   ⇒ 两条一起改：
 *       ① 进 iframe 先把 body / html 的 `min-height` 内联清成 0
 *          （嵌在框里，"撑满视口"没有意义；标本的高度应当等于内容）；
 *       ② 再从 100px 起量一次 scrollHeight，那才是真实内容高度。
 *
 * 三条不可让步的约束
 * ---------------------------------------------------------------------------
 *   ① **不许抛错**：`file://` 直接打开时 iframe 是跨文档，contentDocument
 *      读不到。这时保持 CSS 的默认高度 + 内部滚动，页面照常可用 ——
 *      功能降级，而不是坏掉。
 *   ② **内容变了要跟着变**：tabs / 抽屉会改变高度。ResizeObserver 盯着
 *      body 与 documentElement，变化时重算。
 *   ③ **本文件不属于库的交付物**：npm 包里没有 `guide/`。
 * ========================================================================= */
(function () {
  'use strict';

  var MIN = 240;
  /* 兜底上限只防天文数字。别把它设成"常见页面高度"：
     实测 report 页 5115px，第一版设 3000 把三页全部截断。 */
  var MAX = 9000;
  /* 内嵌窗口的**产品上限**：超过它的内容在窗口内滚动，而不是把文档页撑到两万像素。
     实测 nav 页真实高度 11384px —— 原样内嵌等于让读者滚过十几个屏幕才看到正文。
     裁了就必须说：设 data-capped 并补一句"窗口内可滚动"（门禁会查这句在不在），
     否则"看起来完整、其实只有前 1/5"就是另一种骗人。 */
  /* ⚠️ 这个值**不能和 STEPS 里任何一档相等**：相等时"刚好装下"与"被上限截断"
     会落在同一个数字上，于是 capped 判断永远为假、提示不出现 ——
     而门禁那边按高度判"已截断"，两边打架（实测 input / tabs 卡在这里）。
     ⇒ CAP 取 2200，STEPS 里没有它。 */
  var CAP = 2200;
  var STEPS = [100, 700, 1400, 2400, 3600, 5200, 7000];

  function fit(frame) {
    var doc = null;
    try {
      doc = frame.contentDocument;
    } catch (e) {
      return false;                    // 跨文档：保持 CSS 里的默认高度
    }
    if (!doc || !doc.documentElement || !doc.body) return false;

    var body = doc.body;

    /* 每次都清（幂等、一行开销）。
       🔴 不能"只清一次"：`init()` 在 iframe 还是 about:blank 时就会跑一次 fit，
       那时打个标记，等真实文档 load 进来后**标记还在、规则却回来了** ——
       于是 100vh 重新生效，测量一路虚高到上限。
       实测症状：六页全部收敛到同一个 7118px，而每页真实高度差着 2000px。 */
    body.style.minHeight = '0';
    doc.documentElement.style.minHeight = '0';

    var measure = function () {
      return Math.max(body.scrollHeight, doc.documentElement.scrollHeight);
    };

    var apply = function () {
      var ro = frame.__ro;
      if (ro) ro.disconnect();          // 自己动尺寸时不要吵醒自己
      /* 从 100px 起量：min-height 已经清零，此时 scrollHeight 就是内容高度。
         再往上兜一档，覆盖"内容按框高伸缩"那类布局（多档取最大）。 */
      var answer = 0;
      for (var i = 0; i < STEPS.length; i++) {
        frame.style.height = STEPS[i] + 'px';
        var need = measure();
        if (!need) continue;
        if (need > answer) answer = need;
        if (need <= STEPS[i] + 2) break;   // 装得下就够，不必再往上试
      }
      answer = Math.min(Math.max(answer, MIN), MAX);

      var capped = answer > CAP;
      if (capped) answer = CAP;
      frame.style.height = answer + 'px';

      /* 被上限截断时，把这件事写在页面上（不是只写在代码里） */
      if (capped) {
        frame.dataset.capped = '1';
        /* ⚠️ 不用 Element.closest：它在老 WebView 上直接抛异常，
           而 live.js 是文档站脚本 —— 用 ES5 的循环向上找，成本一样。
           （legacy-api 门禁按"组件与文档脚本同一把尺"判，这里照规矩来。） */
        var fig = null;
        for (var up = frame; up; up = up.parentElement) {
          if (up.className && (' ' + up.className + ' ').indexOf(' g-live ') >= 0) {
            fig = up;
            break;
          }
        }
        var cap = fig ? fig.querySelector('.g-live__cap') : null;
        if (cap && !cap.querySelector('.g-live__hint')) {
          var hint = document.createElement('span');
          hint.className = 'g-live__hint';
          hint.textContent = '这页比较长：窗口内可滚动。';
          cap.appendChild(hint);
        }
      }

      /* 设完之后再确认一次：有的布局在"刚好装下"时又长了一点。
         差得多就再补一次（不做循环 —— 在视口依赖型布局上会抖个没完）。 */
      var after = measure();
      if (after > answer + 6) {
        frame.style.height = Math.min(after, MAX) + 'px';
      }
      if (ro) ro.observe(body);         // 改完再挂回去
    };

    apply();
    /* 字体在首次布局之后才应用，图片也可能后到 ⇒ 再收尾两次。
       不做轮询：那是拿 CPU 换确定性，这里只覆盖首屏那一次。 */
    setTimeout(apply, 150);
    setTimeout(apply, 700);

    /* 🔴🔴 这里是一个**反馈环**，必须断开才能观察：
     *   apply() 改的是 frame 的高度 ⇒ documentElement 的高度跟着变
     *   ⇒ 如果观察 documentElement，回调立刻再进 apply() ⇒ 死循环。
     *   实测症状：跑 GoTo/截图直接卡死（不是慢，是主线程被布局占满）。
     *   ⇒ ① 只观察 body（min-height 已清零，body 高度 = 内容高度）；
     *     ② apply 期间先断开、改完再挂上 —— 自己造成的尺寸变化不该再触发自己。 */
    if (frame.__ro) { frame.__ro.disconnect(); frame.__ro = null; }
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        if (frame.__busy) return;
        frame.__busy = true;
        /* 让出一次任务：内容连续变化时只算最后一帧 */
        setTimeout(function () {
          apply();
          frame.__busy = false;
        }, 60);
      });
      ro.observe(body);
      frame.__ro = ro;
    }
    return true;
  }

  function init() {
    var frames = document.querySelectorAll('iframe.g-live__frame');
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      if (f.dataset.fit === '1') continue;
      f.dataset.fit = '1';
      /* lazy 加载时 load 可能已经过去了 ⇒ 先试一次，load 再兜一次 */
      fit(f);
      f.addEventListener('load', function () { fit(this); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
