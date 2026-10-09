/*
 * browser.js — 全库测试脚本的**唯一**浏览器启动入口
 *
 * ============================================================================
 * 🔴 为什么必须有这个文件
 * ============================================================================
 * 当天做判别力验证时出现一个诡异现象：
 *   · 磁盘上的 JS 明明改对了（grep 确认）
 *   · 浏览器里跑出来的**还是旧代码**（`path[stroke]="var(--accent)"`）
 *
 * 根因：**Chrome 的磁盘缓存**。测试脚本全都直接 `puppeteer.launch()`，
 * **11 个脚本一个都没关缓存**（实测 grep：11/11）。
 *
 * ⚠️ 这个危险在什么地方：
 *   **页面里跑的是旧代码，测试却"通过"了。**
 *   ⇒ "判别力验证成立"这句话在关缓存之前**是不可信的**。
 *   ⇒ 而判别力验证是判断一个门禁有没有鉴别力的**唯一手段** ——
 *      门禁没鉴别力 ⇒ 它抓不抓得到问题都不可信。
 *
 * ⇒ 改法不是"给 11 个脚本各加一行"（下次新写还会忘），
 *   而是**收敛成一个入口**：谁开浏览器都必须从这里开。
 *   这是本文件存在的全部理由。
 *
 * ============================================================================
 * 🔴🔴 引擎选择（2026-10-09 外部评审实测驱动）
 * ============================================================================
 *   CI 的 `browsers` 矩阵声明了 chromium / webkit / firefox 三种引擎，
 *   但**没有一个地方把引擎名传给启动器** ——
 *   `matrix.engine` 只用在 `npx playwright install` 那一步。
 *   ⇒ 三个作业跑的都是 Chromium，"跨浏览器矩阵"是**假的**。
 *
 *   ⚠️ 这比"没做跨浏览器"更糟：它给出了一份**看起来存在**的证据。
 *      评审拿它当覆盖证明，使用者拿它当兼容承诺，而它什么都没测。
 *
 *   ⇒ 修法是让引擎成为**启动参数**，并且让测试报告里出现真实引擎名：
 *       const b = await launch({ engine: 'webkit' });
 *     或环境变量：FL_ENGINE=webkit node 05-audit/xxx-check.js
 * ============================================================================
 * 用法
 * ============================================================================
 *   const { launch } = require('./browser');
 *   const b = await launch();                       // 默认 chromium
 *   const b = await launch({ engine: 'webkit' });   // 显式选引擎
 *
 *   // 或者只拿一个已关缓存的 page：
 *   const { newPage } = require('./browser');
 *   const p = await newPage();          // 已 setCacheEnabled(false)
 *
 *   // 自定义 viewport（iPhone 尺寸那些）：
 *   const p = await newPage({ width: 393, height: 852, isMobile: true });
 */
'use strict';

const puppeteer = require('puppeteer-core');

/**
 * Chrome 可执行文件位置。
 * ⭐ 解析顺序：环境变量 → 常见安装位置。
 * ⚠️ 原来只有环境变量，一清理"硬编码绝对路径"就彻底跑不了
 *    （报 "An executablePath or channel must be specified"）。
 *    ⇒ 必须有**候选路径兜底**，否则这份代码只在"恰好设了环境变量"的机器上能跑。
 * ⚠️ 这里用 `require('path')` 拼、不写死任何人的用户名或盘符。
 */
const fsx = require('fs');
const path = require('path');

/**
 * 🔴 找不到浏览器时的**明确报错** —— 不要静默退化成"假通过"。
 *
 * CI 上的实际教训：
 *   GitHub runner 上没有系统 Chrome，`npx playwright install` 装的是
 *   ~/.cache/ms-playwright/chromium-<版本>/chrome-linux/chrome——
 *   不在常见路径表里 ⇒ 以前 CI 只能跑纯静态门禁，
 *   契约类门禁在 CI 上**根本没被执行过**。
 *   ⇒ 补上 Playwright 的路径（见下面 findPlaywrightChrome）。
 *
 * ⚠️ 下面的 glob 里含通配符，**写成字符串拼接**：
 *   直接把「星号 +斜杠」写进注释，会提前闭合块注释，
 *   把后面的代码全变成注释 ⇒ SyntaxError。实测踩过。
 */
const PW_VER = 'chromium-' + '*';
const PLAYWRIGHT_GLOBS = [
  // Linux（CI）
  path.join(process.env.HOME || '/root', '.cache/ms-playwright',
    PW_VER, 'chrome-linux/chrome'),
  // Linux（新版命名）
  path.join(process.env.HOME || '/root', '.cache/ms-playwright',
    'chromium_headless_shell-' + '*', 'chrome-linux/headless_shell'),
  // macOS
  path.join(process.env.HOME || '', 'Library/Caches/ms-playwright',
    PW_VER, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
];

/** 在 PLAYWRIGHT_GLOBS 里找真实存在的那个（'*' 需要展开） */
function findPlaywrightChrome() {
  const dir = require('os').homedir();
  const roots = [
    path.join(dir, '.cache/ms-playwright'),
    path.join(dir, 'Library/Caches/ms-playwright'),
  ];
  for (const root of roots) {
    let entries;
    try { entries = fsx.readdirSync(root); } catch (e) { continue; }
    for (const name of entries) {
      if (!/^chromium/.test(name)) continue;
      for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        'chrome-linux/headless_shell', 'chrome-win/chrome.exe']) {
        const p = path.join(root, name, ...rel.split('/'));
        try { if (fsx.existsSync(p)) return p; } catch (e) { /* 继续找 */ }
      }
    }
  }
  return null;
}

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.CHROME_BIN,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  // CI 上 Playwright 装的 Chromium（含版本号目录）
  PLAYWRIGHT_GLOBS.map((g) => g)[0],
];
const CHROME = CANDIDATES.find((p) => {
  if (!p) return false;
  try { return fsx.existsSync(p); } catch (e) { return false; }
}) || findPlaywrightChrome();

/**
 * 引擎名归一。
 * ⚠️ 只认这三个名字 —— 写错（`chrome` / `Webkit`）要**立刻报错**，
 *    否则"选了引擎"这个动作本身就可能是假的。
 */
const KNOWN = { chromium: 'chromium', chrome: 'chromium', webkit: 'webkit', firefox: 'firefox' };
function engineOf(opts) {
  var raw = (opts && opts.engine) || process.env.FL_ENGINE || 'chromium';
  var e = KNOWN[String(raw).toLowerCase()];
  if (!e) {
    throw new Error('未知浏览器引擎：' + raw +
      '（只认 chromium / webkit / firefox）\n' +
      '  ⇒ 写错名字会让它静默退回别处，等于没选。');
  }
  return e;
}

/** 关掉缓存的 launch —— 所有测试脚本必须用它，别自己调 puppeteer.launch */
async function launch(opts) {
  var engine = engineOf(opts);
  if (engine !== 'chromium') return launchPlaywright(engine);
  return launchChromium(opts);
}

/**
 * Playwright 引擎（webkit / firefox）。
 *
 * ⚠️ 为什么用 Proxy 适配而不是逐个方法手写
 * ----------------------------------------------------
 * 39 个脚本用的是 puppeteer 的页面 API。Playwright 覆盖面很大但不完全一样
 * （缺 setViewport / setCacheEnabled / emulateMediaFeatures）。
 * 逐个手写会漏；用 Proxy 把没特殊处理的方法**直通**到 Playwright，
 * 只为真正缺的那几个写实现 ⇒ 覆盖面由"我有没有想全"变成"它本来就有"。
 */
async function launchPlaywright(engine) {
  var pw;
  try {
    pw = require('playwright');
  } catch (e) {
    throw new Error('引擎 ' + engine + ' 需要 playwright，但没装（npm ci 后会装）。\n' +
      '  ⇒ 没有它就是"这台机器跑不了这个引擎"，必须报错，**不许退回 Chromium** ——\n' +
      '     退回 Chromium 会让矩阵再次变成"三个作业跑同一个浏览器"。');
  }
  var browser = await pw[engine].launch({ headless: true });
  browser.__engine = engine;
  /* ⚠️ Playwright 的 version() 是**同步**的，puppeteer 的也是 ——
     但 chromium 分支拿的是 puppeteer 对象，两边都当同步值读。 */
  browser.__version = (typeof browser.version === 'function') ? browser.version() : '?';
  return wrap(browser, engine);
}

async function launchChromium(opts) {
  // 🔴 找不到浏览器时**明确失败**，绝不静默退化成"没跑=通过"。
  //   静默退化是门禁假绿的经典形态：CI 上没装浏览器 ⇒ 契约一条没跑 ⇒ 全绿。
  if (!CHROME) {
    throw new Error(
      '找不到 Chrome/Chromium 可执行文件。\n' +
      '  已尝试：\n' +
      CANDIDATES.filter(Boolean).map((p) => '    ' + p).join('\n') + '\n' +
      '  以及 Playwright 缓存目录：' + PLAYWRIGHT_GLOBS.join('\n    ') + '\n' +
      '  ⇒ 装一个：npx playwright install --with-deps chromium\n' +
      '  或设CHROME_PATH 指向已有的可执行文件。');
  }
  // 🔴 三层防缓存，缺一不可：
  //   ① 启动参数禁掉 disk / application / http cache
  //   ② 每次用**随机临时 profile** ⇒ 不碰 正在使用的 Chrome，
  //      也不复用上一次的缓存
  //   ③ wrap() 把 newPage 包一层，自动 setCacheEnabled(false)
  const os = require('os');
  // ⚠️ 必须用 path.join —— 之前写死 '\\' 分隔符，
  //    在 Linux/macOS 上会造出一个**名字里带反斜杠**的目录，
  //    临时 profile 散落在文件系统里。CI 上必踩。
  //
  // 🔴 FL_TMPDIR（2026-10-08 加）：系统临时目录**所在盘写满了**的时候，
  //    Chrome 会直接报 "磁盘空间不足 / 无法创建 ProcessSingleton" 而**启动失败**，
  //    于是浏览器门禁全红 —— 而代码其实一个字都没问题
  //    （本库实测：C 盘 476G 用满，E 盘还有 421G）。
  //    ⇒ 允许把临时 profile 指到别的盘。**不设就与原来完全一样**，
  //      所以不影响任何默认环境（包括陌生人克隆后的第一次运行）。
  const tmpRoot = process.env.FL_TMPDIR || os.tmpdir();
  const profile = path.join(tmpRoot,
    'fe-cache-' + process.pid + '-' + Date.now());
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disk-cache-size=0',
      '--disable-application-cache',
      '--disable-http-cache',
      '--user-data-dir=' + profile,
    ],
    ...(opts || {}),
  });
  browser.__profile = profile;
  /* ⭐ puppeteer 的 version() 是 **Promise**，Playwright 的是同步字符串。
     ⇒ 这里统一 await 成字符串，免得报告里出现 `[object Promise]`。 */
  try { browser.__version = await browser.version(); }
  catch (e) { browser.__version = '?'; }
  return wrap(browser);
}

/**
 * 🔴 把 browser 的 newPage 包一层，**每个新页面自动 setCacheEnabled(false)**。
 *
 * ⚠️ 为什么必须包这一层
 * ----------------------------------------------------
 * 我第一版只把 `puppeteer.launch()` 换成 `launch()`，以为完事了。
 * **但脚本们都是 `const p = await b.newPage()` 自己开页面** ——
 * 完全**绕过了** newPage() 里那一行 `setCacheEnabled(false)`。
 * ⇒ 换 import 一点用都没有（实测：11 个脚本里 7 处 newPage 全部绕过）。
 *
 * ⇒ 正确做法：**在 browser 层面包 newPage**，
 *    无论调用方怎么开页面，都逃不掉。
 */
function wrap(browser, engine) {
  engine = engine || 'chromium';
  const origNewPage = browser.newPage.bind(browser);
  browser.newPage = async function (...args) {
    const page = await origNewPage(...args);
    /* ⭐ Playwright 那两个引擎的 page 缺几个 puppeteer 方法 ⇒ 套一层适配；
       chromium 保持原样（39 个脚本在它上面本来就绿，不许动）。 */
    const p = engine === 'chromium' ? page : shimPage(page, browser);
    try { await p.setCacheEnabled(false); } catch (e) { /* Playwright 无此 API，见 shim */ }
    return p;
  };
  // 顺带把 createIncognitoBrowser / browserContext 也包上
  if (typeof browser.createIncognitoBrowser === 'function') {
    const origIncog = browser.createIncognitoBrowser.bind(browser);
    browser.createIncognitoBrowser = async function (...a) {
      const ctx = await origIncog(...a);
      if (ctx && typeof ctx.newPage === 'function') {
        const origCtxNew = ctx.newPage.bind(ctx);
        ctx.newPage = async function (...args2) {
          const pg = await origCtxNew(...args2);
          try { await pg.setCacheEnabled(false); } catch (e) { /* 忽略 */ }
          return pg;
        };
      }
      return ctx;
    };
  }
  browser.__engine = engine;
  return browser;
}

/**
 * Playwright 的 page → puppeteer 风格的 page。
 *
 * 🔴 用 Proxy 而不是逐个方法手写：
 *    手写时覆盖面 = "我想到了多少"，漏一个就是运行时 undefined 崩溃；
 *    Proxy 的覆盖面 = "Playwright 本来就有多少"，只为**真的缺的**写实现。
 *
 * ⚠️ `cur` 是可变的：需要 isMobile / hasTouch / deviceScaleFactor 时，
 *    Playwright **只能在建 context 时**设这些 ⇒ 只能重建 context + page。
 *    Proxy 让"重建"变成换一个内部引用，调用方手里的对象**不需要更新**。
 */
function shimPage(page, browser) {
  let cur = page;
  const shims = {
    /* puppeteer: setViewport({width,height,isMobile,hasTouch,deviceScaleFactor}) */
    setViewport: async function (vp) {
      vp = vp || {};
      const w = vp.width || 393, h = vp.height || 852;
      const needDevice = vp.isMobile || vp.hasTouch ||
        (vp.deviceScaleFactor && vp.deviceScaleFactor !== 1);
      if (needDevice) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: h },
          isMobile: !!vp.isMobile,
          hasTouch: !!vp.hasTouch,
          deviceScaleFactor: vp.deviceScaleFactor || 1,
        });
        const np = await ctx.newPage();
        try { await cur.close(); } catch (e) { /* 忽略 */ }
        cur = np;                        // ⭐ 换引用即可，调用方无感
        return;
      }
      return cur.setViewportSize({ width: w, height: h });
    },
    /* Playwright 没有 setCacheEnabled：每次 launch 都是全新 context，
       本来就不会跨运行复用磁盘缓存 ⇒ 语义上等价于"已关"。 */
    setCacheEnabled: async function () { return undefined; },
    /* puppeteer: emulateMediaFeatures([{name,value}]) → Playwright: emulateMedia({...}) */
    emulateMediaFeatures: async function (list) {
      const opt = {};
      (list || []).forEach((f) => {
        if (f.name === 'prefers-color-scheme') opt.colorScheme = f.value;
        else if (f.name === 'prefers-reduced-motion') opt.reducedMotion = f.value;
        else if (f.name === 'forced-colors') opt.forcedColors = f.value;
      });
      return cur.emulateMedia(opt);
    },
    /* 让调用方能问"我到底在哪个引擎上" —— 报告里必须出现真实引擎名 */
    engine: function () { return browser.__engine; },
  };
  return new Proxy({}, {
    get: function (_t, k) {
      if (Object.prototype.hasOwnProperty.call(shims, k)) return shims[k];
      const v = cur[k];
      return typeof v === 'function' ? v.bind(cur) : v;
    },
    set: function (_t, k, v) { cur[k] = v; return true; },
    has: function (_t, k) { return k in shims || k in cur; },
  });
}

/**
 * 开一个**已关缓存**的页面。
 * @param {object} vp  viewport（可选）
 */
async function newPage(vp) {
  const browser = await launch();
  const page = await browser.newPage();
  // 🔴 核心：这一行就是整个文件存在的理由
  await page.setCacheEnabled(false);
  if (vp) {
    await page.setViewport({
      width: vp.width || 393,
      height: vp.height || 852,
      deviceScaleFactor: vp.deviceScaleFactor || 2,
      isMobile: !!vp.isMobile,
      hasTouch: !!vp.hasTouch,
    });
  }
  // 记录 browser 以便调用方关掉
  page.__browser = browser;
  return page;
}

/**
 * 最常见的用法：一行开页面、一行关浏览器。
 * callback 里跑你的测试，异常会照常抛出。
 */
async function withPage(vp, fn) {
  const page = await newPage(vp);
  try {
    return await fn(page);
  } finally {
    try { await page.__browser.close(); } catch (e) { /* 忽略 */ }
  }
}

module.exports = { launch, newPage, withPage, CHROME, engineOf, ENGINES: ['chromium', 'webkit', 'firefox'] };
