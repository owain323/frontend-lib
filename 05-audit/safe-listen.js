'use strict';
/*
 * safe-listen.js —— 起本地服务时避开 Chrome 的禁用端口
 *
 * ============================================================================
 * 🔴 为什么要这个文件
 * ============================================================================
 * 5 道门禁（skeleton-lever / theme-css / theme-scope / token-parse /
 * token-resolved）都要起一个临时静态服务，写完各自的 handler 之后统一
 * `srv.listen(0, '127.0.0.1', ...)` —— 让系统随便给一个空闲端口。
 *
 * 问题是：**Chrome 有一张禁用端口表**（ERR_UNSAFE_PORT），
 * 3659（Apple SAS）、4045、6000、6665-6669、10080… 都在里面 ——
 * 那些端口对浏览器是"不安全"的，一律拒绝连接。
 *
 * 实测事故：`token-resolved` 在一次全量门禁里随机落到了 3659，
 * 报的不是"令牌没解析出来"，而是
 *     Error: net::ERR_UNSAFE_PORT at http://127.0.0.1:3659/index.html
 * 全量门禁因此从 196 全绿变成 195/196。
 * 这种红**和被测代码毫无关系**，最容易被当成"环境抖动"放过 ——
 * 而放过一次之后，"全绿"这个结论就不可信了。
 *
 * ⇒ 修法：绑到非法端口就重绑（端口是系统给的，重绑成本约 0）。
 * ========================================================================= */

/* Chrome 的受限端口表（net/base/port_util.cc 的 kRestrictedPorts）。
   这里只列可能被 listen(0) 随机撞上的那些，不是全表。 */
const UNSAFE = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77,
  79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123,
  135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 526, 530, 531,
  532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719,
  1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667,
  6668, 6669, 6697, 10080,
]);

/**
 * 在 127.0.0.1 上绑一个空闲端口，撞到禁用端口就换一个。
 * @param {import('http').Server} srv 已经挂好 handler、还没 listen 的服务
 * @param {number} tries 最多重绑几次
 * @returns {Promise<import('http').Server>} 已 listen 的同一个 srv
 */
function safeListen(srv, tries = 20) {
  return new Promise((resolve, reject) => {
    const once = (left) => {
      srv.listen(0, '127.0.0.1', () => {
        const port = srv.address().port;
        if (UNSAFE.has(port) && left > 0) {
          srv.close(() => once(left - 1));
          return;
        }
        resolve(srv);
      });
      srv.once('error', reject);
    };
    once(tries);
  });
}

module.exports = { safeListen, UNSAFE };

/* ---------------------------------------------------------------------------
 * 自检：重试分支只在 1/1000 的运行里被走到，不主动验一次等于没写
 * ------------------------------------------------------------------------ */
if (require.main === module && process.argv.includes('--selftest')) {
  /** 假服务：第一次给一个禁用端口，第二次给一个正常端口 */
  const fake = (ports) => {
    let n = 0;
    return {
      listen(port, host, cb) { this._p = ports[n++]; cb(); return this; },
      close(cb) { if (cb) cb(); },
      address() { return { port: this._p }; },
      once() {},
      get tries() { return n; },
    };
  };

  (async () => {
    let ok = true;
    const say = (pass, msg) => {
      if (!pass) ok = false;
      console.log('  %s %s', pass ? 'PASS' : 'FAIL', msg);
    };

    const a = fake([3659, 40213]);
    await safeListen(a);
    say(a.address().port === 40213 && a.tries === 2,
      '反向控制：撞到 3659（Chrome 禁用）→ 必须重绑，最终 40213');

    const b = fake([40213]);
    await safeListen(b);
    say(b.address().port === 40213 && b.tries === 1,
      '正例：端口本来就合法 → 只绑一次，不许白重试');

    const c = fake([3659, 6000, 6666, 40213]);
    await safeListen(c);
    say(c.address().port === 40213 && c.tries === 4,
      '连续撞 3 个禁用端口 → 仍要绑到合法端口');

    console.log(ok ? '\n  ✅ 自检通过：重试分支真的在工作，且不合法时才重试'
      : '\n  🔴 自检失败：端口重试逻辑不可信');
    process.exit(ok ? 0 : 1);
  })();
}
