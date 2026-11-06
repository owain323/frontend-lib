#!/usr/bin/env node
/*
 * pdf-renderer.js — exportPdf 的异步子进程；不是公共 CLI。
 * 从 stdin 接收一份 JSON 配置，从 stdout 返回一份 JSON 结论。
 * 浏览器只写工作目录里的暂存 PDF，绝不接触调用方的最终输出路径。
 */
'use strict';

var fs = require('fs');
var cdp = require('./cdp.js');

var DEFAULT_WAIT = 800;
var READY_INTERVAL = 50;

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function timeoutError(message) {
  var e = new Error(message);
  e.code = 'timeout';
  return e;
}

/* 在 print 媒体下等待一个可见元素。元素只是存在但 display:none 不算就绪。 */
function readyExpression(selector) {
  return '(function(){try{var e=document.querySelector(' + JSON.stringify(selector) + ');'
    + 'if(!e)return {ok:true,ready:false};var s=getComputedStyle(e);'
    + 'return {ok:true,ready:s.display!=="none"&&s.visibility!=="hidden"&&e.getClientRects().length>0};'
    + '}catch(e){return {ok:false,error:String(e)}}})()';
}

async function render(o) {
  var started = Date.now();
  var budget = o.timeoutMs || 60000;
  var deadline = started + budget;
  function left() { return Math.max(1, deadline - Date.now()); }
  function checkTime(what) {
    if (Date.now() >= deadline) throw timeoutError(what + '超出时间预算 ' + budget + 'ms');
  }

  var browser = cdp.connect(o.chrome, o.profile);
  var jsErrors = [];
  var timedOut = false;
  var timer = setTimeout(function () {
    timedOut = true;
    browser.close();
  }, budget);

  try {
    var target = await browser.send('Target.createTarget', { url: 'about:blank' }, null, left());
    var attached = await browser.send('Target.attachToTarget', {
      targetId: target.targetId, flatten: true
    }, null, left());
    var sid = attached.sessionId;
    await browser.send('Page.enable', {}, sid, left());
    await browser.send('Runtime.enable', {}, sid, left());
    browser.on('Runtime.exceptionThrown', function (p) {
      if (jsErrors.length >= 20) return;
      var d = (p && p.exceptionDetails) || {};
      jsErrors.push(String((d.exception && d.exception.description) || d.text || '未捕获异常').split('\n')[0]);
    });

    var loaded = browser.waitEvent('Page.loadEventFired', sid, left());
    var nav = await browser.send('Page.navigate', { url: o.target }, sid, left());
    if (nav && nav.errorText) {
      var loadError = new Error('页面加载失败（' + nav.errorText + '）：' + o.src);
      loadError.code = 'render';
      throw loadError;
    }
    await loaded;
    checkTime('页面加载');

    /* 先固定打印环境，再判断 ready：print-only 元素也能作为就绪标志。 */
    await browser.send('Emulation.setEmulatedMedia', {
      media: 'print',
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    }, sid, left());
    var fonts = await browser.send('Runtime.evaluate', {
      expression: 'document.fonts&&document.fonts.ready?document.fonts.ready.then(function(){return true}):true',
      awaitPromise: true, returnByValue: true
    }, sid, left());
    if (fonts.exceptionDetails) {
      throw new Error('等待字体失败：' + (fonts.exceptionDetails.text || 'document.fonts.ready rejected'));
    }
    checkTime('字体加载');

    if (o.readySelector !== null && o.readySelector !== undefined) {
      for (;;) {
        checkTime('等待 ready-selector ' + JSON.stringify(o.readySelector));
        var ready = await browser.send('Runtime.evaluate', {
          expression: readyExpression(o.readySelector), returnByValue: true
        }, sid, left());
        if (!ready.result || !ready.result.value || !ready.result.value.ok) {
          var invalid = new Error('--ready-selector 不是合法 CSS 选择器：' + o.readySelector);
          invalid.code = 'usage';
          throw invalid;
        }
        if (ready.result.value.ready) break;
        await sleep(Math.min(READY_INTERVAL, left()));
      }
    }

    var waitMs = o.waitMs === undefined ? DEFAULT_WAIT : o.waitMs;
    if (waitMs) {
      var room = left();
      /* 剩余预算装不下这次等待时，先耗尽它再报 timeout —— 这样报错里的
         "等的是什么 / 还剩多少"和实际发生的事一致，而不是只睡一半就下结论。 */
      if (waitMs > room) {
        await sleep(room);
        throw timeoutError('额外等待 ' + waitMs + 'ms 超出剩余预算 ' + room + 'ms');
      }
      await sleep(waitMs);
    }

    /* 有限动画落到终态，无限动画取消；同时关掉打印过渡，避免首帧 opacity:0。 */
    var animations = await browser.send('Runtime.evaluate', {
      expression: '(function(){var n=0;document.getAnimations().forEach(function(a){try{'
        + 'var t=a.effect&&a.effect.getComputedTiming?a.effect.getComputedTiming():null;'
        + 'if(t&&isFinite(t.iterations)){a.finish()}else{a.cancel()}n++}catch(e){try{a.cancel()}catch(_){}}});'
        + 'var s=document.createElement("style");s.setAttribute("data-agentcss-print-motion","");'
        + 's.textContent="@media print{*,*::before,*::after{transition:none!important}}";'
        + 'document.head.appendChild(s);return n})()',
      returnByValue: true
    }, sid, left());
    if (animations.exceptionDetails) throw new Error('固定打印动画失败');

    /* 🔴 printBackground 必须是 false（2026-11-06 改）
       ------------------------------------------------------------------
       它原来是 true，理由是 `print-gate` 的一条实测注释：「Chromium 在
       printBackground:false 时会改写文字颜色」。怕设计色被改掉，所以选 true。

       但那条观察来自 Puppeteer 的 `page.pdf()`，**不适用于本文件的 CDP 直调**：
       实测 #15181c / #4f555e / #606770 三个颜色原样保留，一个都没被改写
       （Chromium 的"改写"只救快要看不见的颜色：实测 #808080 → #2C2C2C，
       #606770 是 5.33:1，它判定"看得见"，不动）。用不成立的观测支撑了一个
       代价很大的决策。

       代价是：`.page { background: var(--paper) }` 的 #f6f7f8 跟着上纸，
       整个正文区铺一层 7.4% 的网点（600dpi 下每 64 点 4.8 个黑点）。
       纸的白被用掉了 —— 白的地方不白，黑的地方就不显黑。
       实测：改前纯白像素只占 24.7%（众数 246 = #f6f7f8），改后 95.7%（众数 255）。

       ⚠️ 关掉背景之后，靠底纹表达的东西会一起消失（代码块、表头底纹、
          提示框）。这是有意的：纸上不该用底色表达信息，改用线。
          对应规则在 tokens.css 的「纸面墨阶」与各组件的 @media print 里。
       ⚠️ 不要为了"保住某个背景"改回 true —— 那会把整页一起赔进去。
          单个元素确实需要实心态时，用边框或描边，不用 background。 */
    var printed = await browser.send('Page.printToPDF', {
      printBackground: false,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0
    }, sid, left());
    checkTime('PDF 生成');
    var buf = Buffer.from(printed.data || '', 'base64');
    if (buf.length < 5 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new Error('浏览器返回的不是 PDF（' + buf.length + ' 字节）');
    }
    fs.writeFileSync(o.stagedPdf, buf);
    return {
      ok: true, stagedPdf: o.stagedPdf, bytes: buf.length, jsErrors: jsErrors,
      waitMs: waitMs, readySelector: o.readySelector || null,
      animations: animations.result ? animations.result.value : null,
      ms: Date.now() - started
    };
  } catch (e) {
    return {
      ok: false, code: timedOut ? 'timeout' : (e.code === 'usage' || e.code === 'timeout' ? e.code : 'render'),
      message: timedOut ? 'PDF 导出超出时间预算 ' + budget + 'ms（页面加载、字体或 ready-selector 未完成）'
        : String(e && e.message || e),
      jsErrors: jsErrors, ms: Date.now() - started,
      stderr: browser.stderr().slice(-800)
    };
  } finally {
    clearTimeout(timer);
    browser.close();
    /* Windows 上 Chrome 刚退出时仍可能持有 profile 文件句柄。 */
    await sleep(150);
    try { fs.rmSync(o.profile, { recursive: true, force: true, maxRetries: 3 }); }
    catch (e) { /* 父进程还会清理整个暂存目录 */ }
  }
}

var input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (s) { input += s; });
process.stdin.on('end', function () {
  var config;
  try { config = JSON.parse(input); }
  catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, code: 'render', message: '导出子进程收到非法配置' }));
    return;
  }
  render(config).then(function (result) {
    process.stdout.write(JSON.stringify(result));
  }).catch(function (e) {
    process.stdout.write(JSON.stringify({ ok: false, code: 'render',
      message: String(e && e.message || e) }));
  });
});
