#!/usr/bin/env node
/**
 * reveal-contract.js — reveal 组件的专属判据（静态，不开浏览器）
 *
 * ============================================================================
 * 🔴 为什么要有专属门禁
 * ----------------------------------------------------------------------------
 * `ai/components.json` 的 `maturityReasons.hasDedicatedGate` 决定它能不能算
 * stable。但更实际的原因是：这个组件的四条约定**别的门禁都不查**——
 *
 *   ① 六个方向必须共用一套 transform（不许某方向单独写 keyframes）
 *   ② 位移上限 8px（作品集的 24px 搬到产品页会把视线带离内容）
 *   ③ 时长只能走令牌（裸 200ms 会被 motion.py 查，但令牌名要对）
 *   ④ 无 JS 时内容全可见：隐藏必须挂在 html[data-reveal-ready] 下
 *
 * ④ 是**最容易写错、后果最重**的一条：一旦把 opacity:0 直接写在 [data-reveal] 上，
 * JS 挂掉就是白屏 —— 而所有行为门禁都测不出来（它们都在 JS 能跑的前提下测）。
 *
 * 组件路径：03-patterns/reveal/（覆盖率门禁按目录名认契约，这里写成字面量）
 *
 * 用法：
 *   node 05-audit/reveal-contract.js
 *   node 05-audit/reveal-contract.js --selftest
 * 退出码：0 = 全过；1 = 有判据不过；2 = 文件缺失（不许判通过）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DIR = path.join(REPO, '03-patterns', 'reveal');
const FILES = {
  css: path.join(DIR, 'reveal.css'),
  js: path.join(DIR, 'reveal.js'),
  demo: path.join(DIR, 'demo.html'),
};

function read(p) {
  try {
    return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  } catch (e) {
    return null;
  }
}

/* 每条判据：输入三份文本，返回 [名称, 是否通过, 说明] */
const RULES = [
  ['六方向齐全', (f) => {
    const dirs = ['up', 'down', 'left', 'right', 'scale', 'none'];
    const missing = dirs.filter(d => f.css.indexOf('[data-reveal="' + d + '"]') === -1);
    return [missing.length === 0, missing.length ? '缺少方向：' + missing.join('/') : '6/6'];
  }],

  ['位移 ≤ 8px', (f) => {
    const hits = [];
    const re = /--reveal-[xy]:\s*(-?[0-9.]+)px/g;
    let m;
    while ((m = re.exec(f.css)) !== null) hits.push(Math.abs(parseFloat(m[1])));
    if (!hits.length) return [false, '没有找到 --reveal-x/--reveal-y 的 px 声明'];
    const max = Math.max.apply(null, hits);
    return [max <= 8, '最大 ' + max + 'px（上限 8px）'];
  }],

  ['时长走令牌', (f) => {
    /* 只查真正生效的时长声明；自定义属性 --reveal-delay: 0ms 不算（它是延迟，且为 0） */
    const bad = [];
    const re = /(transition|animation)-duration:\s*([^;]+);/g;
    let m;
    while ((m = re.exec(f.css)) !== null) {
      const v = m[2].trim();
      if (v.indexOf('var(--dur-') !== 0) bad.push(v);
    }
    return [bad.length === 0, bad.length ? '裸时长：' + bad.join(' / ') : '全部 var(--dur-*)'];
  }],

  ['无 transition: all', (f) => {
    const bad = /transition\s*:\s*all\b/i.test(f.css);
    return [!bad, bad ? '出现 transition: all' : '逐属性声明'];
  }],

  ['无 scale(0) 入场', (f) => {
    /* 两处都要查：
       ① 字面量 scale(0)
       ② --reveal-scale 被写成 0 —— 变量为 0 和 scale(0) 是同一个观感，
          只查字面量会漏（本条是自检逼出来的：第一版只有 ①，破坏后仍然绿） */
    const lit = /scale\(\s*0(?:\.0+)?\s*[,)]/i.test(f.css);
    const vals = [];
    const re = /--reveal-scale:\s*([0-9.]+)/g;
    let m;
    while ((m = re.exec(f.css)) !== null) vals.push(parseFloat(m[1]));
    const small = vals.filter(v => v < 0.9);
    const min = vals.length ? Math.min.apply(null, vals) : NaN;
    if (lit) return [false, '出现字面量 scale(0)：从"一个点"炸开'];
    if (small.length) return [false, '--reveal-scale 出现 < .9（' + small.join(',') + '）'];
    return [true, '最小 ' + min + '（下限 .9）'];
  }],

  ['无 JS 不白屏', (f) => {
    /* ① 隐藏态必须挂在 [data-reveal-ready] 下
       ② 任何"选择器含 [data-reveal] 但不含 data-reveal-ready"的规则块里，
          都不许出现 opacity:0

       ⚠️ 不能只匹配字面量 `[data-reveal] {`（第一版就是那样）：
          给根选择器加个 `.reveal` 别名、或改成逗号列表，正则立刻失效，
          而**破坏样本照样能通过** —— 这条是自检逼出来的第二次修正。 */
    /* ⚠️ 必须先剥注释：头部注释里就写着 `data-reveal-ready` 这个词，
       不剥的话它会被当成"选择器的一部分"，于是整个块被 skip 掉 ——
       而破坏样本照样通过（自检抓到的第三次修正）。 */
    const clean = f.css.replace(/\/\*[\s\S]*?\*\//g, '');
    const blockRe = /([^{}]+)\{([^{}]*)\}/g;
    const offenders = [];
    let m;
    while ((m = blockRe.exec(clean)) !== null) {
      const sel = m[1];
      const body = m[2];
      if (sel.indexOf('[data-reveal]') === -1) continue;
      if (sel.indexOf('data-reveal-ready') !== -1) continue;
      if (/opacity:\s*0/.test(body)) offenders.push(sel.trim().replace(/\s+/g, ' '));
    }
    const ready = /\[data-reveal-ready\][^{]*\{[^}]*opacity:\s*0/.test(clean);
    if (offenders.length) {
      return [false, '这些规则块在无 JS 时会藏内容：' + offenders.join(' / ')];
    }
    return [ready, ready ? '隐藏只挂在 data-reveal-ready 下' : '找不到 data-reveal-ready 门栅'];
  }],

  ['降级关掉位移', (f) => {
    const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(f.css);
    if (!m) return [false, '没有 prefers-reduced-motion 块'];
    const block = m[1];
    const off = /transform:\s*none/.test(block);
    const faster = /var\(--dur-fast\)/.test(block);
    return [off && faster, (off ? '位移已关' : '位移未关') +
      ' / ' + (faster ? '缩到 --dur-fast' : '未缩到 --dur-fast')];
  }],

  ['JS 有 IO 兜底', (f) => {
    const hasDetect = /'IntersectionObserver'\s*in\s/.test(f.js);
    const hasFallback = /function revealAll|revealAll\(\)/.test(f.js);
    const hasUnobserve = /unobserve\(/.test(f.js);
    return [hasDetect && hasFallback && hasUnobserve,
      '特性检测 ' + hasDetect + ' / 全显兜底 ' + hasFallback + ' / unobserve ' + hasUnobserve];
  }],

  ['默认不自动接管', (f) => {
    /* 引擎只允许在 <html data-reveal-auto> 时自动 enable；
       直接无条件 enable() 等于"引了脚本内容就消失"，与无 JS 契约矛盾 */
    const gated = /hasAttribute\(['"]data-reveal-auto['"]\)/.test(f.js);
    return [gated, gated ? '由 data-reveal-auto 决定' : '找不到 data-reveal-auto 门栅'];
  }],

  ['demo 覆盖协议', (f) => {
    const dirs = (f.demo.match(/data-reveal="/g) || []).length;
    const children = /data-reveal-children/.test(f.demo);
    const delay = /data-reveal-delay=/.test(f.demo);
    const ok = dirs >= 6 && children && delay;
    return [ok, dirs + ' 处方向 / children ' + children + ' / delay ' + delay];
  }],
];

function run(texts) {
  const out = [];
  RULES.forEach(function (r) {
    const name = r[0];
    let res;
    try {
      res = r[1](texts);
    } catch (e) {
      res = [false, '判据自身抛错：' + e.message];
    }
    out.push({ name: name, ok: !!res[0], msg: res[1] });
  });
  return out;
}

/* 每条判据都要能红：对真实文本做一处针对性破坏，判据必须失败 */
const MUTATIONS = {
  '六方向齐全': (f) => { f.css = f.css.replace('[data-reveal="scale"]', '[data-reveal="zoom"]'); },
  '位移 ≤ 8px': (f) => { f.css = f.css.replace('--reveal-y:  8px;', '--reveal-y:  24px;'); },
  '时长走令牌': (f) => { f.css = f.css.replace('transition-duration: var(--dur-base);', 'transition-duration: 200ms;'); },
  '无 transition: all': (f) => { f.css += '\n.x { transition: all 200ms; }\n'; },
  '无 scale(0) 入场': (f) => { f.css = f.css.replace('--reveal-scale: .97;', '--reveal-scale: 0;'); },
  '无 JS 不白屏': (f) => { f.css = f.css.replace('  transform: translate', '  opacity: 0;\n  transform: translate'); },
  '降级关掉位移': (f) => { f.css = f.css.replace('transform: none;', 'transform: scale(.99);'); },
  'JS 有 IO 兜底': (f) => { f.js = f.js.replace(/unobserve\(/g, '/* 去掉 */('); },
  '默认不自动接管': (f) => { f.js = f.js.replace("hasAttribute('data-reveal-auto')", "hasAttribute('no-such-attr')"); },
  'demo 覆盖协议': (f) => { f.demo = f.demo.replace(/data-reveal-children/g, 'data-rv-children'); },
};

function selftest() {
  const base = { css: read(FILES.css), js: read(FILES.js), demo: read(FILES.demo) };
  if (!base.css || !base.js || !base.demo) {
    console.log('  [FAIL] 组件文件缺失，自检无法进行');
    return 2;
  }
  const good = run({ css: base.css, js: base.js, demo: base.demo });
  let bad = good.filter(r => !r.ok).length;
  console.log('  基准（未破坏）：' + (bad ? 'FAIL ' + bad : 'PASS 10/10'));

  RULES.forEach(function (r) {
    const name = r[0];
    const mut = { css: base.css, js: base.js, demo: base.demo };
    MUTATIONS[name](mut);
    const res = run(mut).filter(x => x.name === name)[0];
    if (res.ok) {
      console.log('  [FAIL] ' + name + ' 破坏后仍然通过（判据没牙）');
      bad++;
    } else {
      console.log('  PASS  ' + name + ' 破坏后变红：' + res.msg);
    }
  });

  console.log('  自检 ' + (RULES.length + 1) + ' 条，失败 ' + bad + ' 条');
  return bad ? 1 : 0;
}

function main() {
  if (process.argv.indexOf('--selftest') !== -1) {
    process.exit(selftest());
  }

  const texts = { css: read(FILES.css), js: read(FILES.js), demo: read(FILES.demo) };
  const missing = Object.keys(texts).filter(k => !texts[k]);
  if (missing.length) {
    console.log('  [FAIL] 组件文件缺失：' + missing.join('/') + ' —— 不许判通过');
    process.exit(2);
  }

  console.log('  reveal 组件契约（静态判据）');
  let bad = 0;
  run(texts).forEach(function (r) {
    console.log('  ' + (r.ok ? 'OK  ' : 'FAIL') + ' ' + r.name + ' —— ' + r.msg);
    if (!r.ok) bad++;
  });
  if (bad) {
    console.log('  ⇒ ' + bad + ' 条不过');
    process.exit(1);
  }
  console.log('  全部通过（' + RULES.length + ' 条）');
  process.exit(0);
}

main();
