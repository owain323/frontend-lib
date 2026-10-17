/*
 * token-resolved-gate.js — 令牌「解析值」门禁：暗色是不是**真的**生效了（总 I-7 补丁）
 *
 * ============================================================================
 * 🔴 它补的是什么洞
 * ----------------------------------------------------------------------------
 * 在此之前，明暗这件事有三道门禁：
 *
 *   · theme-sync.py     比**文本**：`@media` 暗色段 vs `[data-theme]` 生成段
 *   · theme-css-gate.js 比**渲染**：但只探 2 个令牌（`--paper` / `--text-primary`）
 *   · token-tree-gate   比**声明文本**在浏览器 CSSOM 里读到的名字/值
 *
 * 三者合起来仍漏一类：
 *
 *       **声明是合法的、文本是两边一致的，但浏览器根本没让它生效。**
 *
 * 实证过两次：
 *   ① `--lift-sm/md/lg` 被一个未闭合的注释吞掉 —— 正则仍能匹配到那一行，
 *      浏览器里那条声明**不存在**（`token-parse-gate` 的 bug A）
 *   ② 用 `--raw-x:` 直接写在 `@media { }` 体内（不挂选择器）—— 自定义属性
 *      必须挂在选择器上，裸声明被丢弃 ⇒ 暗色**静默回落到浅色**
 *
 * 第二类最阴：没有任何报错，页面只是"看起来不对"。而 `--paper` 探针
 * 恰好是唯一没被吞的那两条之一，所以它也抓不到。
 *
 * ⇒ 本门禁把**全部令牌**的**解析值**取出来，判五条：
 *
 *   ① 暗色三条路径结果一致：系统暗 / 强制暗（`data-theme="dark"`）
 *   ② 浅色两条路径结果一致：系统亮 / 系统暗下强制亮（`data-theme="light"`）
 *   ③ **声明即生效**：在 `[data-theme="dark"]` 段声明过的令牌，
 *      解析值必须与浅色不同（否则就是"声明了但没生效"）
 *      豁免只能写在基线的 `sameInDark` 里，且**必须写理由**
 *   ④ **每个令牌都读得出来**：解析值为空的，说明声明被解析器丢了
 *   ⑤ 解析值基线：与 `05-audit/token-resolved-baseline.json` 逐条一致
 *      （改配色必须 `--update` 显式重录 —— 不允许自动更新）
 *
 * ============================================================================
 * ⚠️ 为什么这一条能替代"暗色人工核对"
 * ----------------------------------------------------------------------------
 * `visual`（截图回归）只拍浅色。暗色改坏了两条路：
 *   · 值变了（色差、对比度掉了）      ⇒ 判据 ⑤ 逐条比，抓得到
 *   · 值没变但没生效（回落浅色）      ⇒ 判据 ③ 抓得到
 * 前者原本只能靠人眼看截图 —— 而逐像素截图抓不住"暗色下正文变灰"，
 * 因为整页都跟着变了，diff 比例反而很小。
 *
 * ============================================================================
 * 用法
 * ----------------------------------------------------------------------------
 *   node 05-audit/token-resolved-gate.js            # 门禁
 *   node 05-audit/token-resolved-gate.js --update   # 显式重录基线
 *   node 05-audit/token-resolved-gate.js --selftest # 反向控制
 * ============================================================================
 */
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

const ROOT = path.dirname(__dirname);
const CSS = path.join(ROOT, '01-tokens', 'tokens.css');
const BASE = path.join(__dirname, 'token-resolved-baseline.json');

const BEGIN = '/* === BEGIN: dark-via-attr';
const END = '/* === END: dark-via-attr === */';

// ---------------------------------------------------------------------------
// 四种组合：`sys` 是系统偏好，`attr` 是手动开关
// ---------------------------------------------------------------------------
const CASES = [
  { key: 'light+none', sys: 'light', attr: null, scheme: 'light' },
  { key: 'light+dark', sys: 'light', attr: 'dark', scheme: 'dark' },
  { key: 'dark+none', sys: 'dark', attr: null, scheme: 'dark' },
  { key: 'dark+light', sys: 'dark', attr: 'light', scheme: 'light' },
];

function norm(v) {
  return String(v).replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 从源码文本里取 `[data-theme="dark"]` 段声明的令牌名（不解析值）。 */
function declaredDarkNames(cssText) {
  const a = cssText.indexOf(BEGIN);
  let body;
  if (a >= 0) {
    const b = cssText.indexOf(END, a);
    body = b > a ? cssText.slice(a, b) : cssText.slice(a);
  } else {
    const i = cssText.indexOf(':root[data-theme="dark"]');
    body = i >= 0 ? cssText.slice(i) : '';
  }
  const s = body.indexOf('{');
  const e = body.lastIndexOf('}');
  if (s < 0 || e < s) return [];
  const inner = body.slice(s + 1, e);
  const out = [];
  inner.replace(/(^|[\s;{])(--[a-z0-9-]+)\s*:/gi, (m, _p, name) => {
    out.push(name);
    return m;
  });
  return Array.from(new Set(out));
}

function serve(cssText) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        // 故意不引 theme-toggle.js —— 这里测的是"纯 CSS 就能成立"
        res.end('<!doctype html><html lang="zh"><head><meta charset="utf-8">' +
          '<link rel="stylesheet" href="/tokens.css"></head><body></body></html>');
        return;
      }
      if (req.url === '/tokens.css') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        res.end(cssText);
        return;
      }
      res.writeHead(404);
      res.end('');
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/** 在真浏览器里把四种组合各跑一遍，返回 { caseKey: {name: value} } */
async function resolveAll(cssText) {
  const { launch } = require(process.env.FL_BROWSER ||
    path.join(__dirname, 'browser.js'));
  const srv = await serve(cssText);
  const port = srv.address().port;
  const out = {};
  let browser;
  try {
    browser = await launch();
    for (const c of CASES) {
      const page = await browser.newPage();
      await page.emulateMediaFeatures([
        { name: 'prefers-color-scheme', value: c.sys }]);
      await page.goto('http://127.0.0.1:' + port + '/index.html',
        { waitUntil: 'load' });
      if (c.attr) {
        await page.evaluate((a) => {
          document.documentElement.setAttribute('data-theme', a);
        }, c.attr);
      }
      out[c.key] = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const names = [];
        // 遍历 CSSOM 声明过的自定义属性 —— 这是浏览器自己认的集合，
        // 不是本库任何一条正则算出来的（独立信息源）
        for (const sheet of Array.from(document.styleSheets)) {
          let rules;
          try { rules = sheet.cssRules; } catch (e) { continue; }
          const walk = (list) => {
            for (const r of Array.from(list)) {
              if (r.cssRules) walk(r.cssRules);
              if (!r.style) continue;
              for (const n of Array.from(r.style)) {
                if (n.slice(0, 2) === '--') names.push(n);
              }
            }
          };
          walk(rules);
        }
        const res = {};
        Array.from(new Set(names)).sort().forEach((n) => {
          res[n] = cs.getPropertyValue(n).trim();
        });
        return res;
      });
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    srv.close();
  }
  return out;
}

function diffMap(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const k of Array.from(keys).sort()) {
    if (norm(a[k]) !== norm(b[k])) {
      out.push({ name: k, a: a[k], b: b[k] });
    }
  }
  return out;
}

async function judge(cssText, baseline) {
  const got = await resolveAll(cssText);
  const problems = [];
  const sameInDark = new Set(baseline.sameInDark || []);
  const dark = got['dark+none'] || {};
  const light = got['light+none'] || {};

  // ① 暗色三条路径（系统暗 / 强制暗）必须一致
  for (const p of [['dark+none', 'light+dark']]) {
    for (const d of diffMap(got[p[0]] || {}, got[p[1]] || {})) {
      problems.push('① `' + d.name + '` 在「' + p[0] + '」与「' + p[1] +
        '」下取值不同（`' + d.a + '` vs `' + d.b +
        '`）—— 两条进入暗色的路径不等价');
    }
  }
  // ② 浅色两条路径必须一致
  for (const d of diffMap(got['light+none'] || {}, got['dark+light'] || {})) {
    problems.push('② `' + d.name + '` 在「light+none」与「dark+light」下取值不同' +
      '（`' + d.a + '` vs `' + d.b + '`）—— 强制亮色没把暗色压住');
  }

  // ④ 每个令牌都必须读得出来（解析值为空 = 声明被解析器丢了）
  for (const key of Object.keys(got)) {
    const empties = Object.keys(got[key]).filter((n) => got[key][n] === '');
    for (const n of empties) {
      problems.push('④ `' + n + '` 在「' + key + '」下解析值为空 —— ' +
        '声明被 CSS 解析器丢弃了（典型原因：未闭合注释、裸声明）');
    }
  }

  // ③ 声明即生效：暗色段声明过的令牌，解析值必须与浅色不同
  const declared = declaredDarkNames(cssText);
  for (const n of declared) {
    if (sameInDark.has(n)) continue;
    if (norm(dark[n]) === norm(light[n])) {
      problems.push('③ `' + n + '` 在 `[data-theme="dark"]` 段声明了，' +
        '但浏览器解析出的暗色值与浅色**相同**（' + light[n] + '）' +
        ' ⇒ 声明没生效，暗色会静默用浅色值');
    }
  }

  // ⑤ 解析值基线
  // 🔴 三类必须分开报：
  //    值变了 / 令牌消失  ⇒ **红**（这是回归）
  //    基线里没有（新增）⇒ **不红，但要计数并打印**
  //    D5 分层时踩过：30 个新 `--raw-*` × 明暗两套 = 60 条"基线里没有"，
  //    如果混进同一条判据，读者看到"共 60 处"会以为配色乱了 ——
  //    而实际上原有 107 个令牌的解析值**一个都没变**。
  //    把结构变更读成回归，和把回归读成结构变更，一样危险。
  const added = [];
  for (const scheme of ['light', 'dark']) {
    const rec = baseline[scheme] || {};
    const now = scheme === 'light' ? light : dark;
    for (const d of diffMap(rec, now)) {
      if (d.a === undefined) {
        added.push(scheme + ':' + d.name);
        continue;
      }
      if (d.b === undefined) {
        problems.push('⑤ ' + scheme + ' 令牌消失：`' + d.name +
          '` 基线是 `' + d.a + '`（声明被删了？）');
        continue;
      }
      problems.push('⑤ ' + scheme + ' 解析值变了：`' + d.name +
        '` 基线 `' + d.a + '` → 现在 `' + d.b + '`');
    }
  }

  return { problems, got, declared, added };
}

function loadBaseline() {
  if (!fs.existsSync(BASE)) return null;
  return JSON.parse(fs.readFileSync(BASE, 'utf8'));
}

function saveBaseline(got, cssText) {
  const declared = declaredDarkNames(cssText);
  const dark = got['dark+none'];
  const light = got['light+none'];
  const sameInDark = declared.filter((n) => norm(dark[n]) === norm(light[n]));
  const out = {
    _note: '令牌解析值基线（浏览器 getComputedStyle 实测）。' +
      '改配色后跑 --update 显式重录；sameInDark 里只放"深色下刻意同值"的令牌，并注明理由。',
    _recorded: new Date().toISOString().slice(0, 10),
    sameInDark,
    light,
    dark,
  };
  fs.writeFileSync(BASE, JSON.stringify(out, null, 2) + '\n', 'utf8');
  return out;
}

async function selftest() {
  console.log('  === token-resolved 反向控制 ===');
  const base = fs.readFileSync(CSS, 'utf8');
  const baseline = loadBaseline();
  if (!baseline) {
    console.log('  [FAIL] 先跑一次 --update 生成基线，再自检');
    process.exit(1);
  }
  let bad = 0;

  const run = async (why, cssText, wantProblem, needle) => {
    const r = await judge(cssText, baseline);
    const hit = needle
      ? r.problems.filter((p) => p.indexOf(needle) >= 0)
      : r.problems;
    const got = hit.length > 0;
    const ok = got === wantProblem;
    if (!ok) {
      console.log('       ↳ 实际：' + (r.problems[0] || '(无)'));
    }
    console.log('  [' + (ok ? 'OK ' : 'FAIL') + '] ' + why +
      ' 期望' + (wantProblem ? '红' : '绿') + ' ⇒ 实际' + (got ? '红' : '绿'));
    if (!ok) bad++;
  };

  // (1) 未改动的源码：必须绿（否则门禁一上线就假红）
  await run('原样不动', base, false);

  // (2) 把一条暗色令牌的**值**改掉：判据 ⑤ 必须抓到
  // 🔴 D5 分层后语义令牌的值是 `var(--raw-*)`，直接改 `--paper:` 什么也抓不到
  //    （`replace` 静默不生效 ⇒ 后面那个"样本失效"分支会接住，但更常见的是
  //      被写成"期望红 ⇒ 实际绿"然后被当成判据没牙）。
  //    要改的是 L1 的原始值，且**两处都要改**（@media 段 + 生成段）——
  //    只改一处会先撞上判据 ①（两条暗色路径不等价），测的就不是判据 ⑤ 了。
  const changed = base.replace(/(--raw-paper:\s*)#14171A/gi, '$1#101010');
  if (changed === base) {
    console.log('  [FAIL] 自检样本失效：tokens.css 里找不到 `--raw-paper: #14171A`');
    bad++;
  } else {
    await run('暗色值被改', changed, true, '⑤');
  }

  // (3) 🔴 最关键：暗色**声明还在文本里**，但两条路径都不再生效 ——
  //     媒体查询永远不匹配 + 属性选择器永远不命中。
  //     这就是"声明了但浏览器没让它生效"（D5 撞过的坑），判据 ③ 必须抓到。
  //     ⚠️ 不能靠"删掉声明"来模拟：那会让 ③ 的输入集合变空，
  //        门禁不红只是因为**没东西可查**，属于假绿。
  const a = base.indexOf(BEGIN);
  const b = base.indexOf(END, a);
  if (a < 0 || b < 0) {
    console.log('  [FAIL] 自检样本失效：找不到生成段标记');
    bad++;
  } else {
    const dead = base
      .replace(/@media\s*\(prefers-color-scheme:\s*dark\)/g,
        '@media (min-width: 99999px)')
      .replace(/:root\[data-theme="dark"\]/g, ':root[data-theme="never"]');
    if (dead === base) {
      console.log('  [FAIL] 自检样本失效：找不到暗色媒体查询或属性选择器');
      bad++;
    } else {
      const keep = declaredDarkNames(dead);
      if (!keep.length) {
        console.log('  [FAIL] 自检样本失效：暗色令牌名单变空了 —— ' +
          '③ 会因"没东西可查"而假绿');
        bad++;
      }
      await run('暗色声明全在、但两条路径都不生效', dead, true, '③');
    }
  }

  // (4) 把某个浅色令牌的声明改成非法值（`--x: ;`）⇒ 解析值为空，判据 ④ 必须抓到
  const dropped = base.replace(/(--raw-paper\s*:\s*)#f6f7f8\s*;/i, '$1;');
  if (dropped === base) {
    console.log('  [FAIL] 自检样本失效：找不到浅色 `--raw-paper: #f6f7f8;`');
    bad++;
  } else {
    await run('浅色声明值被清空', dropped, true, '④');
  }

  console.log('');
  console.log('  ' + (bad ? '🔴 ' + bad + ' 条反向控制未通过' :
    '反向控制全部通过 ⇒ 判据 ③④⑤ 都有牙'));
  process.exit(bad ? 1 : 0);
}

(async () => {
  const cssText = fs.readFileSync(process.env.FL_TOKENS || CSS, 'utf8');
  const args = process.argv.slice(2);

  if (args.indexOf('--selftest') >= 0) {
    await selftest();
    return;
  }

  const baseline = loadBaseline();

  if (args.indexOf('--update') >= 0) {
    const got = await resolveAll(cssText);
    const out = saveBaseline(got, cssText);
    console.log('  ✓ 已重录解析值基线：浅色 ' + Object.keys(out.light).length +
      ' 个 / 暗色 ' + Object.keys(out.dark).length + ' 个令牌');
    if (out.sameInDark.length) {
      console.log('  ⚠️ 深色下与浅色同值的令牌（已写入 sameInDark）：' +
        out.sameInDark.join(', '));
    }
    process.exit(0);
  }

  if (!baseline) {
    console.log('  [FAIL] 缺基线：先跑 node 05-audit/token-resolved-gate.js --update');
    process.exit(1);
  }

  if (args.indexOf('--json') >= 0) {
    const got = await resolveAll(cssText);
    console.log(JSON.stringify(got, null, 2));
    return;
  }

  const { problems, got, declared, added } = await judge(cssText, baseline);
  if (problems.length) {
    problems.forEach((p) => console.log('  [FAIL] ' + p));
    console.log('\n  共 ' + problems.length + ' 处');
    console.log('  ⚠️ 若是"有意改配色"，跑 --update 重录基线并把理由写进 CHANGELOG');
    process.exit(1);
  }
  const n = Object.keys(got['light+none']).length;
  console.log('  [OK] 解析值一致：' + n + ' 个令牌 × 4 种明暗组合；' +
    '暗色段声明的 ' + declared.length + ' 个令牌全部真的生效');
  if (added && added.length) {
    // 新增令牌**不判红**（加令牌本身不是缺陷，死重量由 audience 门禁管），
    // 但必须报出来 —— 否则"基线还没覆盖它"这件事只有门禁自己知道。
    const uniq = Array.from(new Set(added.map((x) => x.split(':')[1])));
    console.log('  ℹ️ 基线未覆盖 ' + added.length + ' 条（' + uniq.length +
      ' 个新增令牌 × 明暗两套）：跑 --update 重录。');
    if (uniq.length <= 6) console.log('     ' + uniq.join(', '));
  }
})();
