#!/usr/bin/env node
/* LAYER: component
 * ============================================================================
 * score-page.js — 对一个**生成出来的 HTML 文件**打分（P 组任务用）
 *
 * 🔴 为什么不能复用现成门禁
 *   `a11y-ax.js` / `responsive-check.js` / `zoom-reflow.js` 的页面清单是**硬编码**的
 *   （`PAGES` 常量、目录名参数），指向的全是仓库内置页。它们**不能被指向一个
 *   模型新生成的文件**。所以「跑一遍全量门禁给生成页打分」这条路不通。
 *
 * 🔴 为什么只做 5 条静态判据
 *   够得着的才判。需要真实视口才能量的（横向溢出、触控目标尺寸）标为 NOT_COVERED，
 *   由人工记录表补。**一个跑得动、可复现的 5 条，好过一个跑不动或会误报的 10 条。**
 *
 * 用法：
 *   node benchmark/score-page.js <file.html>          # 打分（JSON）
 *   node benchmark/score-page.js <file.html> --text   # 人读格式
 *   node benchmark/score-page.js --selftest           # 反向控制
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIB_DIRS = ['01-tokens', '02-primitives', '03-patterns', '04-recipes', '09-assets'];

/* ---------------------------------------------------------------- 库类清单 -- */
/* ⚠️ 不用 `new Set()`：`05-audit/legacy-api-gate.py` 禁止组件侧直接用它
 *    （老 WebView 没有）。本文件虽然跑在 Node 里，但保持同一套写法，
 *    免得"工具代码可以例外"变成下次破例的理由。用无原型对象当集合。 */
let _libCache = null;
function libClasses() {
  if (_libCache) return _libCache;
  const map = Object.create(null);
  const re = /\.([a-z][a-z0-9_-]{1,})/g;
  for (const d of LIB_DIRS) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of walk(abs)) {
      if (!/\.css$/.test(f)) continue;
      const css = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      let m;
      while ((m = re.exec(css))) map[m[1]] = 1;
    }
  }
  _libCache = map;
  return map;
}

function walk(dir) {
  const out = [];
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/* --------------------------------------------------------------- 五条判据 -- */
/* 每条返回 { id, pass, value, limit, why } —— `why` 是给人看的失败原因 */
function score(html) {
  const lib = libClasses();
  const out = [];

  /* ① 库覆盖率：用到的类里有多少来自本库
   *    这是「有没有真的用这个库」的唯一可量化回答。
   *    阈值 0.6 是**初始值**，需用参考解法校准（--selftest 会打印实测值）。 */
  const used = Object.create(null);
  const clsRe = /class\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = clsRe.exec(html))) {
    m[1].split(/\s+/).forEach((c) => { if (c) used[c] = 1; });
  }
  const usedKeys = Object.keys(used);
  let hit = 0;
  for (const c of usedKeys) if (lib[c]) hit++;
  const cov = usedKeys.length ? hit / usedKeys.length : 0;
  out.push({
    id: 'lib-class-coverage',
    pass: usedKeys.length > 0 && cov >= 0.6,
    value: Number(cov.toFixed(3)),
    limit: '>= 0.6',
    why: usedKeys.length === 0 ? '页面一个 class 都没用' :
      '共 ' + usedKeys.length + ' 个类，只有 ' + hit + ' 个来自本库',
  });

  /* ② 无裸颜色：不许在 style 属性 / <style> 里写死颜色 */
  const styles = extractStyles(html).join('\n');
  const rawColor = styles.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/g) || [];
  out.push({
    id: 'no-raw-color',
    pass: rawColor.length === 0,
    value: rawColor.length,
    limit: '=== 0',
    why: rawColor.length ? '写死了 ' + rawColor.length + ' 处颜色：' + rawColor.slice(0, 3).join(' ') : '',
  });

  /* ③ 无裸字号：令牌之外的 px 字号是暗色/缩放的常见破口 */
  const rawFs = styles.match(/font-size\s*:\s*[0-9.]+(px|pt)\b/g) || [];
  out.push({
    id: 'no-raw-font-size',
    pass: rawFs.length === 0,
    value: rawFs.length,
    limit: '=== 0',
    why: rawFs.length ? '写死了 ' + rawFs.length + ' 处 px 字号：' + rawFs.slice(0, 3).join(' ') : '',
  });

  /* ④ 无第三方运行时依赖：外链 script / stylesheet 一律算违规（本库承诺零依赖） */
  const ext = (html.match(/<(script|link)[^>]+(src|href)\s*=\s*"(https?:)?\/\//gi) || []);
  out.push({
    id: 'no-external-dep',
    pass: ext.length === 0,
    value: ext.length,
    limit: '=== 0',
    why: ext.length ? '引了 ' + ext.length + ' 个外部资源' : '',
  });

  /* ⑤ 语义结构：页面级至少要有 main 或 role=main 之一 + 一个标题 */
  const hasMain = /<main\b|role\s*=\s*"main"/i.test(html);
  const hasH1 = /<h1\b/i.test(html);
  out.push({
    id: 'semantic-structure',
    pass: hasMain && hasH1,
    value: (hasMain ? 1 : 0) + (hasH1 ? 1 : 0),
    limit: '=== 2 (main + h1)',
    why: [hasMain ? '' : '没有 <main> 或 role="main"', hasH1 ? '' : '没有 <h1>'].filter(Boolean).join('；'),
  });

  const passed = out.filter((x) => x.pass).length;
  return { passed, total: out.length, details: out };
}

function extractStyles(html) {
  const blocks = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html))) blocks.push(m[1]);
  const inl = /style\s*=\s*"([^"]*)"/gi;
  while ((m = inl.exec(html))) blocks.push(m[1]);
  return blocks;
}

/* ------------------------------------------------------------------ 自检 -- */
/* 反向控制必须用**仓库里真实存在的满分样本**，不用我编的 HTML。
 * 断言：① 参考页拿满分或接近满分 ② 注入裸颜色后必须掉分 ③ 去掉 main 后必须掉分 */
function selftest() {
  const REF = path.join(ROOT, '04-recipes/table/demo.html');
  if (!fs.existsSync(REF)) {
    console.log('  FAIL 找不到参考页 ' + REF);
    return 1;
  }
  const ref = fs.readFileSync(REF, 'utf8');
  const base = score(ref);

  const dirty = ref.replace('</style>', '</style><style>.x{color:#ff0000;font-size:13px}</style>');
  const withColor = score(dirty);

  const noMain = ref.replace(/<main\b/g, '<div').replace(/<\/main>/g, '</div>');
  const broken = score(noMain);

  let bad = 0;
  function expect(why, hit, detail) {
    console.log('  [' + (hit ? 'OK  ' : 'FAIL') + '] ' + why + (detail ? '\n         ' + detail : ''));
    if (!hit) bad++;
  }

  const covDetail = '参考页 lib-class-coverage=' +
    (base.details.find((d) => d.id === 'lib-class-coverage') || {}).value;
  expect('参考页（table demo）通过 ≥ 4 / 5 条', base.passed >= 4,
    'passed=' + base.passed + '/' + base.total + '  ' + covDetail);

  const c0 = base.details.find((d) => d.id === 'no-raw-color').value;
  const c1 = withColor.details.find((d) => d.id === 'no-raw-color').value;
  expect('注入裸颜色 ⇒ no-raw-color 必须从通过变失败', c0 === 0 && c1 > 0,
    '注入前=' + c0 + ' 注入后=' + c1);

  const s0 = base.details.find((d) => d.id === 'semantic-structure').pass;
  const s1 = broken.details.find((d) => d.id === 'semantic-structure').pass;
  expect('去掉 <main> ⇒ semantic-structure 必须变失败', s0 === true && s1 === false,
    '去掉前=' + s0 + ' 去掉后=' + s1);

  const fs0 = base.details.find((d) => d.id === 'no-raw-font-size').value;
  const fs1 = withColor.details.find((d) => d.id === 'no-raw-font-size').value;
  expect('注入裸字号 ⇒ no-raw-font-size 必须从通过变失败', fs0 === 0 && fs1 > 0,
    '注入前=' + fs0 + ' 注入后=' + fs1);

  console.log('\n  ' + (bad ? '❌ 反向控制有 ' + bad + ' 条没抓到' : '✅ 反向控制全绿'));
  return bad ? 1 : 0;
}

/* ------------------------------------------------------------------ CLI -- */
const args = process.argv.slice(2);
if (args.includes('--selftest')) process.exit(selftest());

const file = args.find((a) => a.indexOf('--') !== 0);
if (!file) {
  console.log('用法：node benchmark/score-page.js <file.html> [--text]');
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.log('找不到文件：' + file);
  process.exit(2);
}

const res = score(fs.readFileSync(file, 'utf8'));
const wrapper = {
  artifact: path.relative(ROOT, path.resolve(file)).replace(/\\/g, '/'),
  passed: res.passed,
  total: res.total,
  details: res.details,
  notCovered: [
    '横向溢出（393px，需真实视口）',
    '触控目标尺寸（需真实视口）',
    '视觉回归（需基线图）',
    '暗色下的实际对比度',
  ],
};

if (args.includes('--text')) {
  console.log('  === ' + wrapper.artifact + ' ===');
  res.details.forEach(function (d) {
    console.log('  [' + (d.pass ? 'OK  ' : 'FAIL') + '] ' + d.id +
      '  ' + d.value + '（要求 ' + d.limit + '）' + (d.why ? '\n         ' + d.why : ''));
  });
  console.log('\n  ' + res.passed + ' / ' + res.total + ' 条通过');
  console.log('  未覆盖：' + wrapper.notCovered.join('、'));
} else {
  process.stdout.write(JSON.stringify(wrapper, null, 2) + '\n');
}
process.exit(res.passed === res.total ? 0 : 1);
