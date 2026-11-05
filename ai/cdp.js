/*
 * cdp.js — 零依赖 Chrome DevTools Protocol 管道客户端。
 *
 * shot 与 pdf 共用这一份实现。调试走 fd 3/4，以 NUL 分隔 JSON；不开放端口，
 * 不连接使用者的浏览器，也不引入 Puppeteer 运行时依赖。
 */
'use strict';

var { spawn } = require('child_process');

/** 启动一个隔离的 headless Chrome，并返回有界的 CDP 请求接口。 */
function connect(chromePath, profile) {
  var args = [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--remote-debugging-pipe',
    '--user-data-dir=' + profile,
    'about:blank'
  ];
  /* 只有明确以 root 在容器中运行时才允许调用方关闭沙箱。 */
  if (process.env.AGENTCSS_NO_SANDBOX === '1') args.unshift('--no-sandbox');
  var child = spawn(chromePath, args, {
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  var buf = Buffer.alloc(0);
  var pending = Object.create(null);
  var waiters = [];
  var listeners = [];
  var nextId = 0;
  var dead = null;
  var stderr = '';

  function failAll(err) {
    dead = dead || err;
    Object.keys(pending).forEach(function (k) {
      clearTimeout(pending[k].timer);
      pending[k].reject(dead);
    });
    pending = Object.create(null);
    waiters.splice(0).forEach(function (w) {
      clearTimeout(w.timer);
      w.reject(dead);
    });
  }

  var commandPipe = child.stdio[3];
  var eventPipe = child.stdio[4];
  if (!commandPipe || !eventPipe) {
    failAll(new Error('无法建立 CDP 管道（Chrome 没能启动）'));
  }
  /* 🔴 必须有 error 监听。浏览器起不来时管道会以 EPIPE/ECONNRESET 结束，
     而 Node 的流在没有 error 监听时**直接抛出** —— 那就成了"本工具崩了"，
     和"这份 PDF 没导出来"是两件事，也让调用方看不到结构化结论。 */
  if (commandPipe) commandPipe.on('error', function (e) { failAll(e); });
  if (eventPipe) eventPipe.on('error', function (e) { failAll(e); });

  function dispatch(msg) {
    if (msg.id !== undefined && pending[msg.id]) {
      var p = pending[msg.id];
      delete pending[msg.id];
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(p.method + '：' + (msg.error.message || JSON.stringify(msg.error))));
      else p.resolve(msg.result);
      return;
    }
    if (!msg.method) return;
    for (var L = 0; L < listeners.length; L++) {
      if (listeners[L].method === msg.method) listeners[L].fn(msg.params, msg.sessionId);
    }
    for (var i = waiters.length - 1; i >= 0; i--) {
      var w = waiters[i];
      if (w.method === msg.method && (!w.sessionId || w.sessionId === msg.sessionId)) {
        waiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(msg.params);
      }
    }
  }

  if (eventPipe) eventPipe.on('data', function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    var i;
    while ((i = buf.indexOf(0)) >= 0) {
      var raw = buf.subarray(0, i).toString('utf8');
      buf = buf.subarray(i + 1);
      try { dispatch(JSON.parse(raw)); } catch (e) { /* 忽略不完整的非 JSON 浏览器输出 */ }
    }
  });
  child.stdio[1].on('data', function () { /* Chrome 常规 stdout 不属于协议 */ });
  child.stdio[2].on('data', function (chunk) {
    stderr = (stderr + chunk.toString('utf8')).slice(-4000);
  });
  child.on('error', function (e) { failAll(e); });
  child.on('exit', function (code) {
    failAll(new Error('Chrome 提前退出（退出码 ' + code + '）'));
  });

  function send(method, params, sessionId, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (dead) return reject(dead);
      var id = ++nextId;
      var limit = timeoutMs || 15000;
      var timer = setTimeout(function () {
        delete pending[id];
        reject(new Error(method + ' 超时（' + limit + 'ms 没有回应）'));
      }, limit);
      pending[id] = { resolve: resolve, reject: reject, timer: timer, method: method };
      try {
        var message = { id: id, method: method, params: params || {} };
        /* 顶层命令不能带 sessionId:null；Chrome 只接受“字段不存在”或字符串。 */
        if (sessionId !== undefined && sessionId !== null) message.sessionId = sessionId;
        commandPipe.write(JSON.stringify(message) + '\0');
      } catch (e) {
        clearTimeout(timer);
        delete pending[id];
        reject(e);
      }
    });
  }

  function waitEvent(method, sessionId, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var limit = timeoutMs || 15000;
      var timer = setTimeout(function () {
        var at = waiters.findIndex(function (w) {
          return w.method === method && w.sessionId === sessionId;
        });
        if (at >= 0) waiters.splice(at, 1);
        reject(new Error('等 ' + method + ' 超时（' + limit + 'ms）'));
      }, limit);
      waiters.push({ method: method, sessionId: sessionId,
        resolve: resolve, reject: reject, timer: timer });
    });
  }

  return {
    send: send,
    waitEvent: waitEvent,
    on: function (method, fn) { listeners.push({ method: method, fn: fn }); },
    close: function () { try { child.kill(); } catch (e) { /* 已退出 */ } },
    stderr: function () { return stderr; },
    child: child
  };
}

module.exports = { connect: connect };
