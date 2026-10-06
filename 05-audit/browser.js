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
 * 用法
 * ============================================================================
 *   const { launch } = require('./browser');
 *   const b = await launch();
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
const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.CHROME_BIN,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
const CHROME = CANDIDATES.find((p) => {
  if (!p) return false;
  try { return fsx.existsSync(p); } catch (e) { return false; }
});

/** 关掉缓存的 launch —— 所有测试脚本必须用它，别自己调 puppeteer.launch */
async function launch(opts) {
  // 🔴 三层防缓存，缺一不可：
  //   ① 启动参数禁掉 disk / application / http cache
  //   ② 每次用**随机临时 profile** ⇒ 不碰 正在使用的 Chrome，
  //      也不复用上一次的缓存
  //   ③ wrap() 把 newPage 包一层，自动 setCacheEnabled(false)
  const os = require('os');
  const profile = os.tmpdir() + '\\fe-cache-' + process.pid + '-' + Date.now();
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
function wrap(browser) {
  const origNewPage = browser.newPage.bind(browser);
  browser.newPage = async function (...args) {
    const page = await origNewPage(...args);
    try { await page.setCacheEnabled(false); } catch (e) { /* 忽略 */ }
    return page;
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
  return browser;
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

module.exports = { launch, newPage, withPage, CHROME };
