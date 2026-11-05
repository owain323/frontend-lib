#!/usr/bin/env node
/*
 * html-check-gate.js — `ai check <page.html>` 这道产物的门禁，自己有没有牙
 *
 * ============================================================================
 * 为什么这道门禁必须存在
 * ----------------------------------------------------------------------------
 * `ai/check-html.js` 是**给使用者用的判据**，不是给本仓库用的。它一旦判断错，
 * 代价由外人承担：漏报 ⇒ 他以为页面没问题；误报 ⇒ 他去改一个本来正确的页面。
 * 两种都比"没有这个工具"更坏，因为工具带着"我检查过了"的暗示。
 *
 * ⇒ 这里要证三件事，缺一不可：
 *   ① 正例不吵：本库 12 个示例页 + index.html 必须 0 错误（误报会在这里露头）
 *   ② 反例不漏：一份注入全部违规的页面，报出的判据集合必须**逐条相等**
 *      （不是"报了 ≥N 条"—— 凑数通过是最常见的假绿）
 *   ③ 每条判据各自负责自己的命中：把某条判据关掉，夹具里那一条必须消失。
 *      这是**元反向控制**：如果关掉 A 之后 B 仍然报出同一处问题，
 *      说明那处命中其实是 B 抓的，A 的判据可能根本没生效。
 *
 * ============================================================================
 * 还有一类假绿专门盯着"什么也没读到"
 * ----------------------------------------------------------------------------
 * 样式表路径全错时，旧写法会给 40 个类各报一次"没引到样式表"——
 * 看起来报了 40 条很严格，实际只有 1 个错误（前缀写错），而且把真正的原因
 * 埋在了 40 行噪声下面。这里单独断言：那种情况**恰好 1 条** sheet-unreadable，
 * 且**0 条** class-not-linked。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.dirname(__dirname);
const AI = path.join(ROOT, 'ai');
const check = require(path.join(AI, 'check-html.js'));
const scaffold = require(path.join(AI, 'scaffold.js'));
const shot = require(path.join(AI, 'shot.js'));
const pdf = require(path.join(AI, 'pdf.js'));

let passes = 0;
let fails = 0;

function ok(name, extra) {
  passes++;
  console.log('  [OK]   ' + name + (extra ? '  — ' + extra : ''));
}
function bad(name, detail) {
  fails++;
  console.log('  [FAIL] ' + name + '\n         ' + String(detail).split('\n').join('\n         '));
}
function expect(cond, name, detail) {
  if (cond) ok(name); else bad(name, detail || '');
}

/* 临时目录：**不落在仓库里**，也不落 C 盘（本机 C 盘紧张是既有约束） */
const TMP = fs.mkdtempSync(path.join(process.env.AGENTCSS_TMP || os.tmpdir(), 'agentcss-htmlcheck-'));
function tmp(name, text) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, text, 'utf8');
  return p;
}
function rulesOf(r) {
  return Array.from(new Set(r.findings.map((f) => f.rule))).sort();
}

/* ============================================================================
 * 夹具：一页里塞进**全部**违规，外加两处"看起来像违规、其实不是"的采样
 * ============================================================================ */
const TOKENS = pathToFileURL(path.join(ROOT, '01-tokens/tokens.css')).href;

const BAD_PAGE = [
  '<!doctype html>',
  '<html>',                                            /* html-lang */
  '<head>',
  /* meta-charset / meta-viewport 都缺 */
  '<link rel="stylesheet" href="' + TOKENS + '">',
  '<style>.local-only{color:#333}</style>',
  '</head>',
  '<body>',
  '<img src="x.png">',                                 /* img-alt */
  '<table><tr><th>a</th></tr></table>',                /* table-name + th-scope */
  '<h2>二</h2>',
  '<h4>四</h4>',                                       /* heading-skip */
  '<div id="dup"></div>',
  '<div id="dup"></div>',                              /* id-duplicate */
  '<input id="x">',                                    /* control-name */
  '<a href="https://example.com" target="_blank">外链</a>',  /* rel-noopener */
  '<a href="#">占位</a>',                              /* empty-link */
  '<div class="badge">②</div>',                        /* class-not-linked（badge.css 没引） */
  '<div class="totally-made-up">②</div>',              /* class-unknown */
  '<div class="local-only">不该报</div>',              /* 页内定义过 ⇒ **不该**报 */
  '<table aria-hidden="true"><tr><td>x</td></tr></table>',   /* aria-hidden ⇒ **不该**报 */
  '</body>',
  '</html>'
].join('\n');

const EXPECTED = [
  'class-not-linked', 'class-unknown', 'control-name', 'empty-link',
  'heading-skip', 'html-lang', 'id-duplicate', 'img-alt',
  'meta-charset', 'meta-viewport', 'rel-noopener', 'table-name', 'th-scope'
];

(function main() {
  console.log('  === html-check 门禁 ===\n');

  /* ---------------------------------------------------------------- ① 正例 */
  const pages = [];
  (function walk(dir) {
    for (const n of fs.readdirSync(dir)) {
      if (n.charAt(0) === '_' || n.charAt(0) === '.') continue;
      const p = path.join(dir, n);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.html$/.test(n)) pages.push(p);
    }
  })(path.join(ROOT, '04-recipes'));
  pages.push(path.join(ROOT, 'index.html'));

  const noisy = [];
  for (const p of pages) {
    const r = check.checkPage(p, {});
    if (!r.ok) {
      noisy.push(path.relative(ROOT, p) + '：'
        + r.findings.filter((f) => f.level === 'error').map((f) => f.rule + '@' + f.line).join(', '));
    }
  }
  expect(pages.length >= 10, '① 找到的示例页数量合理', '只找到 ' + pages.length + ' 页');
  expect(noisy.length === 0, '① 本库 ' + pages.length + ' 个页面 0 错误（不误报）', noisy.join('\n'));

  /* ---------------------------------------------------------------- ② 反例 */
  const badFile = tmp('bad.html', BAD_PAGE);
  const bad = check.checkPage(badFile, {});
  const got = rulesOf(bad);
  expect(got.join(',') === EXPECTED.join(','),
    '② 注入的 ' + EXPECTED.length + ' 类违规逐条报出（集合相等）',
    '缺：' + EXPECTED.filter((x) => got.indexOf(x) < 0).join(', ') + '\n'
      + '多：' + got.filter((x) => EXPECTED.indexOf(x) < 0).join(', '));

  /* 每处都要有行号：没有行号的报错等于让人自己找 */
  expect(bad.findings.every((f) => f.line > 0), '② 每条命中都带行号');

  /* 两处"看起来像违规"的采样：必须一条都不报 */
  const local = bad.findings.filter((f) => /local-only/.test(f.msg));
  /* 第二张表（aria-hidden）不该被要求命名 ⇒ table-name 只该出现 1 次 */
  const named = bad.findings.filter((f) => f.rule === 'table-name');
  expect(local.length === 0, '② 页内 <style> 定义过的类不算未知', JSON.stringify(local));
  expect(named.length === 1, '② aria-hidden 子树里的表不要求可访问名称', JSON.stringify(named));

  /* ------------------------------------------------- ③ 元反向：逐条关掉判据 */
  const leaks = [];
  for (const id of EXPECTED) {
    const meta = check.RULES[id];
    if (!meta) { leaks.push(id + '（RULES 里没有这条）'); continue; }
    const keep = meta.level;
    meta.level = 'off';
    let r;
    try { r = check.checkPage(badFile, {}); } finally { meta.level = keep; }
    const set = rulesOf(r);
    if (set.indexOf(id) >= 0) leaks.push(id + '（关掉后仍然报出 ⇒ 这处命中不是它抓的）');
    const lost = EXPECTED.filter((x) => x !== id && set.indexOf(x) < 0);
    if (lost.length) leaks.push(id + '（关掉后连累其它判据：' + lost.join(',') + '）');
  }
  expect(leaks.length === 0, '③ 逐条关掉判据，对应命中随之消失（元反向控制）', leaks.join('\n'));

  /* -------------------------------------------- ④ 样式表一个都读不到时只报一条 */
  const deadLink = tmp('dead-link.html',
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<link rel="stylesheet" href="nope/does-not-exist.css">'
    + '</head><body><div class="badge">x</div></body></html>');
  const dead = check.checkPage(deadLink, {});
  expect(dead.findings.filter((f) => f.rule === 'sheet-unreadable').length === 1
    && dead.findings.filter((f) => f.rule === 'class-not-linked').length === 0,
    '④ 样式表全读不到 ⇒ 恰好 1 条 sheet-unreadable、0 条 class-not-linked',
    JSON.stringify(dead.findings.map((f) => f.rule)));

  /* ---------------------------------------------------------------- ⑤ strict */
  const warnOnly = tmp('warn-only.html',
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '</head><body><a href="#">占位</a></body></html>');
  const soft = check.checkPage(warnOnly, {});
  const hard = check.checkPage(warnOnly, { strict: true });
  expect(soft.ok === true && soft.counts.warn === 1,
    '⑤ 只有警告时默认通过', JSON.stringify(soft.counts));
  expect(hard.ok === false && hard.counts.warn === 1,
    '⑤ --strict 把警告当失败', JSON.stringify(hard.counts));

  /* ---------------------------------------------------------------- ⑥ 版式 */
  const fin = scaffold.render('report/finance', { cssPrefix: pathToFileURL(ROOT).href });
  const finFile = tmp('fin.html', fin.html);
  const finOk = check.checkPage(finFile, { recipe: 'report/finance' });
  expect(finOk.ok && finOk.findings.length === 0,
    '⑥ 壳本身通过它自己的版式判据', JSON.stringify(finOk.findings.map((f) => f.rule)));

  const noRisk = check.checkPage(tmp('fin-no-risk.html', fin.html.replace('class="rep__risk"', 'class="rep__risk-typo"')),
    { recipe: 'report/finance' });
  expect(rulesOf(noRisk).indexOf('recipe-required') >= 0,
    '⑥ 删掉风险披露 ⇒ recipe-required',
    JSON.stringify(rulesOf(noRisk)));

  const wrongRoot = check.checkPage(tmp('fin-wrong-root.html', fin.html.replace('rep rep--finance', 'rep rep--magazine')),
    { recipe: 'report/finance' });
  expect(rulesOf(wrongRoot).indexOf('recipe-root') >= 0,
    '⑥ 根类不是这一版 ⇒ recipe-root', JSON.stringify(rulesOf(wrongRoot)));

  const unknown = check.checkPage(finFile, { recipe: 'report/nope' });
  expect(unknown.code === 'unknown-recipe' && /report\/nope/.test(unknown.message),
    '⑥ 未知版式 ⇒ 明确报错（不静默放行）', JSON.stringify(unknown));

  /* ------------------------------------------- ⑦ 三个壳都必须能过自己的版式 */
  const shellBad = [];
  for (const item of scaffold.list()) {
    const s = scaffold.render(item.id, { cssPrefix: pathToFileURL(ROOT).href });
    const r = check.checkPage(tmp(item.id.replace('/', '-') + '.html', s.html), { recipe: item.id });
    if (!r.ok) shellBad.push(item.id + '：' + r.findings.map((f) => f.rule).join(','));
  }
  expect(shellBad.length === 0, '⑦ 三个壳各自通过自己的版式判据', shellBad.join('\n'));

  /* 版式清单必须两边一致：`scaffold` 能生成的，`recipes.json` 必须能判。
     少一边就是那种"给了壳但没有判据（或反过来）"的静默漏洞。 */
  const rec = check.readRecipes();
  const recIds = Object.keys(rec.recipes).sort().join(',');
  const scIds = scaffold.list().map((x) => x.id).sort().join(',');
  expect(recIds === scIds, '⑦ recipes.json 与 scaffold 的版式清单一致', recIds + ' ≠ ' + scIds);

  /* 选择器必须真的在对应样式表里定义 —— 否则改名之后判据恒真（永远报缺件，
     或者永远不报），而这两种都不会自己冒出来。 */
  const drift = [];
  for (const id of Object.keys(rec.recipes)) {
    const one = rec.recipes[id];
    let defined;
    try { defined = new Set(check.classesInCss(fs.readFileSync(path.join(ROOT, one.css), 'utf8'))); }
    catch (e) { drift.push(id + '：读不到 ' + one.css); continue; }
    for (const sel of [one.root].concat(one.requires.map((x) => x.selector))) {
      for (const c of String(sel).split('.').filter(Boolean)) {
        if (!defined.has(c)) drift.push(id + '：' + sel + '（' + c + ' 不在 ' + one.css + '）');
      }
    }
  }
  expect(drift.length === 0, '⑦ recipes.json 里的选择器都在对应样式表里定义', drift.join('\n'));

  /* ---------------------------------------------------------------- ⑧ CLI */
  const cli = path.join(AI, 'cli.js');
  function run(args) {
    return spawnSync(process.execPath, [cli].concat(args), { encoding: 'utf8' });
  }
  expect(run(['check', badFile]).status === 1, '⑧ CLI：有错误 ⇒ 退出码 1',
    String(run(['check', badFile]).status));
  expect(run(['check', warnOnly]).status === 0, '⑧ CLI：只有警告 ⇒ 退出码 0',
    String(run(['check', warnOnly]).status));
  expect(run(['check', warnOnly, '--strict']).status === 1, '⑧ CLI：--strict ⇒ 退出码 1');
  expect(run(['check', finFile, '--recipe=report/nope']).status === 1, '⑧ CLI：未知版式 ⇒ 退出码 1');
  expect(run(['check', path.join(ROOT, 'index.html')]).status === 0, '⑧ CLI：正常页面 ⇒ 退出码 0');
  expect(run(['check', '--list-recipes']).status === 0,
    '⑧ CLI：`check --list-recipes` 不需要文件参数（它自己就是一次完整调用）');
  /* 旧路径不能被扩展名分派弄坏：`.json` 仍然走文档模型校验 —— 拿一份
     "扩展名是 .json、内容是 HTML" 的文件去撞，它必须报"不是合法 JSON"，
     而不是被 HTML 分派悄悄接走。 */
  const notJson = tmp('shape.json', '<!doctype html><html lang="zh-CN"></html>');
  const jsonRun = run(['check', notJson]);
  expect(jsonRun.status === 1 && /不是合法 JSON/.test(jsonRun.stderr || ''),
    '⑧ CLI：.json 仍走文档模型校验（没有被 HTML 分派抢走）',
    jsonRun.stdout + jsonRun.stderr);

  /* ---------------------------------------------------------------- ⑨ 截图 */
  const usage = path.join(AI, 'cli.js');
  expect(run(['shot', finFile]).status === 2, '⑨ shot：缺 --out ⇒ 退出码 2');
  expect(run(['shot', finFile, '--out', 'x.png', '--width=abc']).status === 2,
    '⑨ shot：宽度不是整数 ⇒ 退出码 2（不静默取默认值）');

  /* 显式给了不存在的 --chrome ⇒ 退出码 3，且要说清"这里要的是可执行文件" */
  const explicit = spawnSync(process.execPath, [usage, 'shot', finFile, '--out', path.join(TMP, 'x.png'),
    '--chrome=' + path.join(TMP, 'nope.exe')], { encoding: 'utf8' });
  expect(explicit.status === 3 && /可执行文件/.test(explicit.stderr || explicit.stdout),
    '⑨ shot：指定的浏览器不存在 ⇒ 退出码 3 且说明要的是可执行文件',
    explicit.stderr || explicit.stdout);

  const chrome = pdf.resolveChrome(null);
  if (chrome.error) {
    /* 不静默放过：明确写出"这条没验"，而不是让它看起来是绿的 */
    console.log('  [UNVERIFIED] ⑨ 这台机器上没有 Chrome/Chromium/Edge —— '
      + '真实截图（视口宽度 / 整页 / 两次一致）本次**未验证**');
  } else {
    (async function () {
      const outA = path.join(TMP, 'shot-a.png');
      const outB = path.join(TMP, 'shot-b.png');
      const r1 = await shot.shoot({ src: finFile, out: outA, widths: [390], full: true, wait: 200, scale: 1 });
      const r2 = await shot.shoot({ src: finFile, out: outB, widths: [390], full: true, wait: 200, scale: 1 });
      if (!r1.ok) {
        bad('⑨ shot 能截出图', r1.message || JSON.stringify(r1));
        return finish();
      }
      const s = r1.shots[0];
      /* 🔴 这两条是这套工具存在的理由：`--screenshot --window-size` 那条老路
         会给出"宽度是 390、实际按 500 排版"的图，且不报错。 */
      expect(s.viewport === 390, '⑨ 真实视口 = 390（不是被最小窗口宽度截断的假 390）',
        '实际 ' + s.viewport);
      expect(s.png.width === 390 && s.png.height >= 390,
        '⑨ PNG 宽度就是视口宽度（整页）',
        s.png.width + '×' + s.png.height);
      expect(fs.readFileSync(outA).equals(fs.readFileSync(outB)),
        '⑨ 同一台机器、同样参数，两次截图逐字节一致（可当判据用）');
      return finish();
    })().catch((e) => {
      bad('⑨ shot 流程抛异常', e && e.stack || String(e));
      finish();
    });
    return;
  }
  finish();

  function finish() {
    try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* 交给系统 */ }
    console.log('\n  ' + passes + ' 项通过 · ' + fails + ' 项失败\n');
    process.exit(fails ? 1 : 0);
  }
})();
