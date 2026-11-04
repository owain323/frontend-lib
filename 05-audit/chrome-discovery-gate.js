#!/usr/bin/env node
/**
 * chrome-discovery-gate.js — 浏览器发现必须在「只有 Playwright 装的浏览器」时也成立
 *
 * 为什么要有这道门
 * ---------------------------------------------------------------------------
 * 外部审计 F5 的现场：干净的 Linux VM 上 `npm ci && npx playwright install chromium`
 * 之后，`agentcss ai pdf` 返回 `no-chrome`，于是几乎所有浏览器门禁连锁失败。
 * 根因不是"没装浏览器"，而是**发现逻辑写死了目录布局**：
 *
 *     只认 chrome-linux/chrome、chrome-linux/headless_shell、chrome-win/chrome.exe
 *     而新版 Playwright 用的是
 *     chrome-linux64/chrome、chrome-headless-shell-linux64/chrome-headless-shell、
 *     chrome-win64/chrome.exe、chrome-headless-shell-win64/chrome-headless-shell.exe
 *
 * 还有一个开发机永远看不见的独立原因：Windows 上 Playwright 装在
 * `%LOCALAPPDATA%\ms-playwright`，而代码只找 `~/.cache/ms-playwright` ——
 * 那条路径在 Windows 上根本不存在。
 *
 * 两种坏法有同一个特征：**在有系统 Chrome 的开发机上 100% 绿**。
 * ⇒ 所以判据不能依赖本机装了什么，必须用假目录树造出各种布局来验。
 *
 * 判据
 * ---------------------------------------------------------------------------
 * ① 七种真实布局（Linux 新旧 / Linux headless-shell / Windows 新旧 /
 *    Windows headless-shell / macOS）都要能被找到，且**指向那个文件**。
 * ② 三个入口都必须认：
 *      · 05-audit/browser.js 的 findPlaywrightChrome()
 *      · ai/pdf.js 的 chromeCandidates()
 * ③ 空目录 ⇒ 必须返回 null / 不返回该目录下的路径（**不许静默回落到别的浏览器**）。
 * ④ 元反向：把**旧写法**（固定 rel 列表）套到同一棵假树上，新布局必须找不到 ——
 *    否则说明这棵树没有判别力，测试是自嗨。
 *
 * 用法：node 05-audit/chrome-discovery-gate.js [--selftest]
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

/* 每种布局：假树里的相对路径（相对 PLAYWRIGHT_BROWSERS_PATH） */
const LAYOUTS = [
  ['Linux 旧布局（Playwright ≤1.4x）',
    'chromium-1140/chrome-linux/chrome'],
  ['Linux 新布局（chrome-linux64）',
    'chromium-1243/chrome-linux64/chrome'],
  ['Linux headless-shell（新命名）',
    'chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'],
  ['Windows 旧布局',
    'chromium-1140/chrome-win/chrome.exe'],
  ['Windows 新布局（chrome-win64）',
    'chromium-1243/chrome-win64/chrome.exe'],
  ['Windows headless-shell（本机实测布局）',
    'chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe'],
  ['macOS 新布局（chrome-mac-arm64）',
    'chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'],
];

/* 旧写法：固定 rel 列表。只用于元反向 —— 证明这棵树对它有判别力。 */
const OLD_RELS = ['chrome-linux/chrome',
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  'chrome-win/chrome.exe', 'chrome-linux/headless_shell'];

const META_PROBE = `
const fs = require('fs');
const path = require('path');
const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
const REALS = ${JSON.stringify(OLD_RELS)};
const out = [];
for (const n of fs.readdirSync(root)) {
  if (!/^chromium/.test(n)) continue;
  for (const rel of REALS) {
    const p = path.join(root, n, ...rel.split('/'));
    if (fs.existsSync(p)) out.push(p);
  }
}
process.stdout.write(JSON.stringify(out));
`;

const DISCOVER_PROBE = `
const path = require('path');
const repo = process.env.FL_REPO;
const b = require(path.join(repo, '05-audit', 'browser.js'));
const p = require(path.join(repo, 'ai', 'pdf.js'));
process.stdout.write(JSON.stringify({
  browser: b.findPlaywrightChrome(),
  pdf: p.chromeCandidates(),
  roots: b.PW_ROOTS,
}));
`;

function mkTree(base, rel) {
  const full = path.join(base, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, process.platform === 'win32' ? '' : '#!/bin/sh\n');
  return full;
}

function runNode(script, env) {
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    env: Object.assign({}, process.env, env),
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

function main() {
  let bad = 0;
  const report = (ok, name, extra) => {
    if (!ok) bad += 1;
    console.log('  ' + (ok ? 'OK   ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
  };

  console.log('  === 浏览器发现（假目录树）===');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcss-chrome-'));

  try {
    for (const [label, rel] of LAYOUTS) {
      const base = fs.mkdtempSync(path.join(tmp, 'p-'));
      const exe = mkTree(base, rel);
      const got = runNode(DISCOVER_PROBE, {
        FL_REPO: ROOT,
        PLAYWRIGHT_BROWSERS_PATH: base,
      });
      const want = process.platform === 'win32'
        ? exe.replace(/\\/g, '/') : exe;
      const norm = (s) => (s ? s.replace(/\\/g, '/') : s);

      report(norm(got.browser) === want, label + ' → browser.js 找到', norm(got.browser) || 'null');
      const inPdf = got.pdf.some((p) => norm(p) === want);
      report(inPdf, label + ' → ai/pdf.js 候选表包含');

      /* 元反向：旧写法在同一棵树上必须找不到（否则这棵树没有判别力） */
      const oldHits = runNode(META_PROBE, { PLAYWRIGHT_BROWSERS_PATH: base });
      const isOldLayout = OLD_RELS.some((r) => rel.endsWith(r));
      if (isOldLayout) {
        report(oldHits.length > 0, label + ' → 元反向：旧写法也能找到（该布局本就在旧表里）');
      } else {
        report(oldHits.length === 0, label + ' → 元反向：旧写法找不到（证明这是新布局）');
      }
    }

    /* 空目录：必须找不到，不许静默回落。
       ⚠️ 必须把**所有**根目录都指到空目录 —— 只设 PLAYWRIGHT_BROWSERS_PATH 的话，
          findPlaywrightChrome 会继续去本机真实的 %LOCALAPPDATA% / ~/.cache 里找，
          于是在"开发机装了浏览器"时这条永远绿（第一版就是这么绿的）。 */
    const empty = fs.mkdtempSync(path.join(tmp, 'empty-'));
    const got = runNode(DISCOVER_PROBE, {
      FL_REPO: ROOT,
      PLAYWRIGHT_BROWSERS_PATH: empty,
      LOCALAPPDATA: empty,
      HOME: empty,
      USERPROFILE: empty,
    });
    report(got.browser === null, '空目录 ⇒ browser.js 返回 null（不静默回落）',
      String(got.browser));
    /* 只断言「没有从 Playwright 扫描里凭空造出路径」。
       不能断言"整张候选表里没有以空目录开头的路径" ——
       Windows 的系统 Chrome 候选是 `%LOCALAPPDATA%\Google\Chrome\...` 拼出来的，
       而这里 LOCALAPPDATA 也被指到了空目录，那条**本该**存在（它属于系统浏览器官网路径）。
       要看的是：Playwright 扫描有没有在空目录下编出一个 chromium 路径。 */
    const leaked = got.pdf.filter((p) => {
      if (!p) return false;
      const q = p.replace(/\\/g, '/');
      return q.startsWith(empty.replace(/\\/g, '/')) && /chromium/i.test(q);
    });
    report(leaked.length === 0, '空目录 ⇒ ai/pdf.js 的 Playwright 扫描不出路径',
      leaked.slice(0, 2).join(' , '));

    /* 零视野守卫：假树一个都没建出来时，上面的"找到"必须全红 */
    report(LAYOUTS.length >= 5, '布局覆盖数 ≥ 5（防止有人把清单删空）',
      'n=' + LAYOUTS.length);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('  ' + (bad === 0
    ? '✅ 七种布局 · 两个入口 · 空目录不回落 · 元反向成立'
    : '🔴 ' + bad + ' 条失败'));
  return bad === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}
