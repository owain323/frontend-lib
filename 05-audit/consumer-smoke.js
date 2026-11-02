#!/usr/bin/env node
/* ============================================================================
   consumer-smoke — 「别人下载之后能不能用」的实装验证
   ----------------------------------------------------------------------------
   🔴 为什么需要它（2026-11-02）
     `pack-smoke.sh` 已经把**结构**判死了：tarball 里有哪些文件、exports 能不能
     解析、JS 语法对不对、文档里的路径落不落地。但它一次都没**渲染**过。

     结构正确 ≠ 能用。实测过的两类断层：
       · `<link href="node_modules/agentcss/01-tokens/tokens.css">` 这类路径
         只在**装完之后**才成立；源码目录里永远测不到它拼错。
       · 样式能加载、可 `--accent` 解析成空、`.btn` 背景是透明 —— 页面"打开了"
         但和没引一样。没有一条判据量「引用之后样式真的生效」。

   🔴 判据（每一条都对应一种「装完了却不能用」）
     C1 零 404      页面引的每个包内文件都真的在（含 JS）
     C2 令牌生效    --accent 解析出非空值；.btn 的背景不是 transparent
     C3 行为生效    tabs.js 自动初始化：点第二个 tab，aria-selected 真的换过去
     C4 打印生效    打印态未选中的面板 display !== none（折叠面板要被展开）
     C5 契约可查    npx agentcss ai components --json 解析出 40 个组件且带 printPolicy
     C6 复制路径    04-recipes/tierA-tokens.css（A 档）在包里，且能单独生效

   为什么 C5 也算「能用」：这个库的定位是「人可以直接复制 CSS，AI 读契约」。
   契约查不到 = AI 消费者那半边不可用，而 pack-smoke 只判它「在不在包里」。

   用法
     node 05-audit/consumer-smoke.js                  # 自己 pack + 装到临时目录
     node 05-audit/consumer-smoke.js --dir <consumer> # 用已经装好的目录（pack-smoke 第 8 步）
     node 05-audit/consumer-smoke.js --selftest       # 反向控制：每条判据都要能红
     环境：不需要静态服务（自己起一个临时端口）
   ========================================================================== */
'use strict';

const { launch } = require('./browser.js');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const has = (f) => argv.includes(f);

const NAME = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).name;
const VER = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version;

/* ---------------------------------------------------------------- 临时目录 */

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentcss-' + tag + '-'));
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
}

/* ---------------------------------------------------------------- 静态服务
   不用仓库里那个 with-server.sh：被测对象是**别处的**一个目录，
   而共用 8000 会让「服务起没起」与「装没装好」两件事混在一起。 */
function serve(dir) {
  const py = process.env.PY || 'python';
  return new Promise((resolve, reject) => {
    /* ⚠️ 必须加 `-u`：python 的 stdout 不是 tty 时会**块缓冲**，
       端口那行要等缓冲区满才出来 —— 实测表现为「8s 内没报端口」，
       而服务其实早就起来了（用一个不存在的端口去连会得到更好的报错）。 */
    const srv = spawn(py, ['-u', '-m', 'http.server', '0', '--bind', '127.0.0.1',
      '--directory', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const onData = (d) => {
      buf += String(d);
      const m = buf.match(/port (\d+)/i) || buf.match(/127\.0\.0\.1:(\d+)/);
      if (m) { srv.stdout.removeListener('data', onData); resolve({ srv, port: Number(m[1]) }); }
    };
    srv.stdout.on('data', onData);
    srv.stderr.on('data', onData);
    srv.on('exit', (c) => reject(new Error('静态服务退出了：' + c + ' ' + buf.slice(0, 200))));
    setTimeout(() => reject(new Error('静态服务没在 8s 内报端口：' + buf.slice(0, 200))), 8000);
  });
}

/* ---------------------------------------------------------------- 消费者页面
   B 档（START-HERE 第 2 步）：两个 <link> 引令牌，再引你要的组件。
   路径就是**装完之后**的样子 —— 这一层只有真装才测得到。 */
function consumerPage(pkgRel) {
  const p = pkgRel.replace(/\\/g, '/');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>消费者冒烟</title>
<link rel="icon" href="data:,"><!-- 不然浏览器会去要 /favicon.ico，C1 会把它算成 404 -->
<link rel="stylesheet" href="${p}/01-tokens/tokens.css">
<link rel="stylesheet" href="${p}/01-tokens/typography.css">
<link rel="stylesheet" href="${p}/02-primitives/button/button.css">
<link rel="stylesheet" href="${p}/03-patterns/tabs/tabs.css">
</head>
<body class="page"><main class="wrap">
  <h1>消费者冒烟</h1>
  <p><button class="btn btn--primary" id="b1">主要按钮</button></p>
  <div class="tabs" data-tabs>
    <div class="tabs__list" role="tablist" aria-label="分组">
      <button class="tabs__tab" role="tab" id="t1" aria-controls="p1" aria-selected="true">第一页</button>
      <button class="tabs__tab" role="tab" id="t2" aria-controls="p2" aria-selected="false">第二页</button>
    </div>
    <div class="tabs__panel" role="tabpanel" id="p1" aria-labelledby="t1">
      <p>第一页的内容。</p>
    </div>
    <div class="tabs__panel" role="tabpanel" id="p2" aria-labelledby="t2" hidden>
      <p>第二页的内容，打印时必须印出来。</p>
    </div>
  </div>
</main>
<script src="${p}/03-patterns/tabs/tabs.js"></script>
</body></html>`;
}

/* ---------------------------------------------------------------- 判据 */

function inPage() {
  const acc = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim();
  const btn = document.querySelector('.btn');
  const cs = btn ? getComputedStyle(btn) : null;
  return {
    accent: acc,
    btnBg: cs ? cs.backgroundColor : '',
    btnRadius: cs ? cs.borderTopLeftRadius : '',
    tabsReady: !!document.querySelector('.tabs[data-tabs]'),
    sel: Array.prototype.map.call(
      document.querySelectorAll('.tabs__tab'), (t) => t.getAttribute('aria-selected')),
  };
}

function panelState(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { display: cs.display, visibility: cs.visibility,
    h: Math.round(el.getBoundingClientRect().height) };
}

/* 跑一遍全部判据。`opts.breakPage` 供反向控制注入坏页面。 */
async function runChecks(dir, pkgRel, opts) {
  const out = [];
  const add = (id, ok, msg) => out.push({ id, ok, msg });
  opts = opts || {};

  const { srv, port } = await serve(dir);
  const browser = await launch();
  let page;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    const misses = [];
    page.on('requestfailed', (r) => misses.push(r.url()));
    page.on('response', (r) => { if (r.status() >= 400) misses.push(r.url() + ' → ' + r.status()); });

    await page.goto('http://127.0.0.1:' + port + '/' + (opts.file || 'index.html'),
      { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 200));

    // C1 零 404
    add('C1', misses.length === 0,
      misses.length ? '有 ' + misses.length + ' 个资源没加载到：'
        + misses.slice(0, 3).join(' , ') : '页面引的每个文件都在包里');

    const st = await page.evaluate(inPage);
    // C2 令牌与组件样式生效
    add('C2', !!st.accent && st.btnBg !== 'rgba(0, 0, 0, 0)' && st.btnBg !== 'transparent',
      '--accent=' + (st.accent || '(空)') + '  .btn 背景=' + st.btnBg
      + '  圆角=' + st.btnRadius);

    // C3 行为生效：点第二个 tab
    let switched = null;
    if (st.tabsReady) {
      await page.click('#t2');
      await new Promise((r) => setTimeout(r, 150));
      switched = await page.evaluate(() => {
        const t2 = document.getElementById('t2');
        const p2 = document.getElementById('p2');
        return { sel: t2 ? t2.getAttribute('aria-selected') : null,
          hidden: p2 ? p2.hasAttribute('hidden') : null };
      });
    }
    add('C3', !!switched && switched.sel === 'true' && switched.hidden === false,
      switched ? '点第二个 tab 后 aria-selected=' + switched.sel
        + ' 面板 hidden=' + switched.hidden : '页面里没有 [data-tabs]');

    // C4 打印态：未选中面板展开（这条只有引了 tokens.css 才成立）
    // 先把 tab 切回第一个，让 p2 处于 hidden —— 那才是真实打印场景
    if (switched) {
      await page.click('#t1');
      await new Promise((r) => setTimeout(r, 120));
    }
    await page.emulateMediaType('print');
    await new Promise((r) => setTimeout(r, 150));
    const p2 = await page.evaluate(panelState, 'p2');
    await page.emulateMediaType('screen');
    add('C4', !!p2 && p2.display !== 'none' && p2.visibility !== 'hidden' && p2.h >= 0,
      p2 ? '打印态 #p2 display=' + p2.display + ' visibility=' + p2.visibility
        + ' 高=' + p2.h : '找不到 #p2');
  } finally {
    if (page) await page.close();
    await browser.close();
    srv.kill();
  }

  // C5 CLI 契约（用消费者身份跑，不看源码）
  /* 必须用**文档教的那个写法**（带 ai 前缀）：文档最靠前的一条命令如果不能用，
     后面写得再准也读不到。反过来也验一次，两种写法都要通。 */
  const cli = spawnSync('npx', ['--no-install', 'agentcss', 'ai', 'components', '--json'],
    { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32', timeout: 60000 });
  let parsed = null;
  let parseErr = '';
  try { parsed = JSON.parse(cli.stdout); } catch (e) {
    parseErr = ' | parse: ' + e.message.slice(0, 60) + ' | head='
      + JSON.stringify(String(cli.stdout || '').slice(0, 40));
  }
  /* CLI 输出的是**裸数组**（不是 {components:[...]}）—— 第一版按后者写，
     于是 40 个组件被读成 0 个，报「解析失败」而其实解析成功了。 */
  const comps = Array.isArray(parsed) ? parsed
    : ((parsed && parsed.components) || []);
  const withPolicy = comps.filter((c) => Array.isArray(c.printPolicy)).length;
  // 反过来的写法（不带 ai）也必须是通的
  const cli2 = spawnSync('npx', ['--no-install', 'agentcss', 'components', '--json'],
    { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32', timeout: 60000 });
  const ok2 = cli2.status === 0 && /^\s*\[/.test(String(cli2.stdout || ''));
  add('C5', !!parsed && comps.length === 40 && withPolicy === comps.length && ok2,
    'ai 前缀写法退出码=' + (cli.status === null ? 'null' : cli.status)
    + ' 组件=' + (comps.length || '解析失败')
    + ' 带 printPolicy=' + withPolicy
    + ' ｜无前缀写法=' + (ok2 ? '通' : '不通') + parseErr);

  return out;
}

/* ---------------------------------------------------------------- 装一次 */

function packAndInstall() {
  const work = tmpDir('smoke');
  const consumer = path.join(work, 'consumer');
  fs.mkdirSync(consumer, { recursive: true });
  const tarball = path.join(work, NAME + '-' + VER + '.tgz');

  const env = Object.assign({}, process.env);
  delete env.npm_config_dry_run;              // 理由见 pack-smoke.sh 的同名注释

  const pack = spawnSync('npm', ['pack', '--pack-destination', work],
    { cwd: ROOT, encoding: 'utf8', env, shell: process.platform === 'win32', timeout: 120000 });
  if (pack.status !== 0 || !fs.existsSync(tarball)) {
    throw new Error('npm pack 失败：' + String(pack.stderr || '').slice(0, 300));
  }
  fs.writeFileSync(path.join(consumer, 'package.json'),
    JSON.stringify({ name: 'consumer-smoke', private: true, version: '1.0.0' }, null, 2));
  const ins = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--silent', tarball],
    { cwd: consumer, encoding: 'utf8', env, shell: process.platform === 'win32', timeout: 180000 });
  if (ins.status !== 0) {
    throw new Error('npm install 失败：' + String(ins.stderr || '').slice(0, 300));
  }
  return { work, consumer, tarball };
}

/* ---------------------------------------------------------------- 主流程 */

async function main() {
  if (argv.indexOf('--selftest') >= 0) return selftest();

  let dir = val('--dir');
  let own = null;
  if (!dir) {
    own = packAndInstall();
    dir = own.consumer;
    console.log('  已 pack + 装到临时目录：' + dir);
  }
  console.log('');
  console.log('  消费者实装冒烟（' + NAME + '@' + VER + '）');
  console.log('  ' + '-'.repeat(74));

  const pkgRel = 'node_modules/' + NAME;
  const pkgDir = path.join(dir, pkgRel);
  if (!fs.existsSync(pkgDir)) {
    console.log('  FAIL 找不到 ' + pkgDir);
    if (own) rmrf(own.work);
    return 1;
  }
  // C6 是纯文件判据，先判（它不需要浏览器）
  const tierA = path.join(pkgDir, '04-recipes', 'tierA-tokens.css');
  const c6 = fs.existsSync(tierA) && fs.statSync(tierA).size > 4000;
  const res = [];
  res.push({ id: 'C6', ok: c6, msg: c6
    ? 'A 档单文件令牌在包里（' + Math.round(fs.statSync(tierA).size / 1024) + ' KB）'
    : '04-recipes/tierA-tokens.css 缺失或过小 —— A 档使用者没有可粘的那份' });

  fs.writeFileSync(path.join(dir, 'index.html'), consumerPage(pkgRel));
  let checks = [];
  try {
    checks = await runChecks(dir, pkgRel);
  } catch (e) {
    console.log('  FAIL 渲染阶段崩了：' + String(e.message).slice(0, 200));
    if (own) rmrf(own.work);
    return 1;
  }
  const all = res.concat(checks);
  all.forEach((c) => {
    console.log('  ' + (c.ok ? 'OK  ' : 'FAIL') + '  ' + c.id + '  ' + c.msg);
  });
  console.log('  ' + '-'.repeat(74));
  const bad = all.filter((c) => !c.ok);
  console.log('  ' + (bad.length ? '🔴 ' + bad.length + ' 条不通过'
    : '✅ 6 条全过：装完之后页面能用、能打印、契约可查'));
  console.log('');
  if (own) rmrf(own.work);
  return bad.length ? 1 : 0;
}

/* ---------------------------------------------------------------- 反向控制
   每条判据都要能被证明会红。做法不是"改代码"，而是**喂它一个真坏掉的消费者**：
     · C1 用一份指向不存在文件的页面（模拟包内路径写错 / files 白名单漏文件）
     · C4 用一份没引 tokens.css 的页面（模拟"样式引了但打印规则没生效"）
   这样控制本身不依赖门禁内部实现 —— 它验的是判据有没有牙。 */
async function selftest() {
  let pass = 0;
  let fail = 0;
  const check = (name, ok, msg) => {
    if (ok) pass++; else fail++;
    console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' ' + name + (msg ? '    ' + msg : ''));
  };
  const work = tmpDir('selftest');

  /* 造一个"看起来像包、但文件不全"的假包，用同一个目录结构 */
  const pkg = path.join(work, 'node_modules', NAME);
  for (const f of ['01-tokens/tokens.css', '01-tokens/typography.css',
    '02-primitives/button/button.css', '03-patterns/tabs/tabs.css',
    '03-patterns/tabs/tabs.js']) {
    const src = path.join(ROOT, f);
    const dst = path.join(pkg, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  fs.mkdirSync(path.join(pkg, '04-recipes'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '04-recipes/tierA-tokens.css'),
    path.join(pkg, '04-recipes/tierA-tokens.css'));
  fs.writeFileSync(path.join(work, 'package.json'),
    JSON.stringify({ name: 'st', private: true, version: '1.0.0' }));

  const pkgRel = 'node_modules/' + NAME;
  fs.writeFileSync(path.join(work, 'good.html'), consumerPage(pkgRel));
  let rows = await runChecks(work, pkgRel, { file: 'good.html' });
  /* 基线只看 C1–C4：假包里没有 ai/ 与 node_modules/.bin，C5 必然红，
     那不是判据没牙，是这份夹具本来就没有 CLI。 */
  const base4 = rows.filter((r) => ['C1', 'C2', 'C3', 'C4'].indexOf(r.id) >= 0);
  check('基线（假包但文件齐）· C1/C2/C3/C4 应全过',
    base4.length === 4 && base4.filter((r) => !r.ok).length === 0,
    base4.filter((r) => !r.ok).map((r) => r.id).join(',') || '全过');

  /* ① C1：把 tabs.js 删掉 ⇒ 必须 404 且 C3 挂 */
  fs.unlinkSync(path.join(pkg, '03-patterns/tabs/tabs.js'));
  rows = await runChecks(work, pkgRel, { file: 'good.html' });
  const c1 = rows.filter((r) => r.id === 'C1')[0];
  const c3 = rows.filter((r) => r.id === 'C3')[0];
  check('C1 · 包内少一个文件 ⇒ 零 404 判据报红', c1 && !c1.ok,
    c1 ? c1.msg.slice(0, 60) : '没跑');
  check('C3 · JS 不在 ⇒ 行为判据报红', c3 && !c3.ok, c3 ? c3.msg.slice(0, 50) : '没跑');
  fs.copyFileSync(path.join(ROOT, '03-patterns/tabs/tabs.js'),
    path.join(pkg, '03-patterns/tabs/tabs.js'));

  /* ② C4：页面不引 tokens.css ⇒ 打印规则不生效，面板必须仍隐藏 */
  const noTokens = consumerPage(pkgRel)
    .replace(/<link[^>]*01-tokens\/tokens\.css">/, '');
  fs.writeFileSync(path.join(work, 'notokens.html'), noTokens);
  rows = await runChecks(work, pkgRel, { file: 'notokens.html' });
  const c4 = rows.filter((r) => r.id === 'C4')[0];
  check('C4 · 不引 tokens ⇒ 打印展开判据报红', c4 && !c4.ok,
    c4 ? c4.msg.slice(0, 60) : '没跑');

  rmrf(work);
  console.log('');
  console.log('  反向控制 ' + pass + '/' + (pass + fail) + ' 条');
  return fail ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error('ERR ' + String((e && e.message) || e).slice(0, 400));
  process.exit(1);
});
