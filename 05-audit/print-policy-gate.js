#!/usr/bin/env node
/* ============================================================================
   print-policy-gate — 打印契约的三向核对（契约 / 实现 / 运行时）
   ----------------------------------------------------------------------------
   🔴 为什么需要它
     本轮（2026-11-02）之前，本库的打印行为只存在于 `01-tokens/tokens.css` 的一个
     `@media print` 块里。没有任何东西能回答三个问题：

       ① 契约里写的打印策略，CSS 里真的实现了吗？（还是写了就忘了）
       ② CSS 里的每一条隐藏，契约里都认领了吗？（还是顺手加的？）
       ③ 声明了，运行时真的生效吗？

     ③ 不是修辞。实测过两次：
       · `.tabs__panel` 的规则少了 `.tabs` 前缀 ⇒ 同特异性被组件 CSS 盖掉，
         PDF 与改动前**逐字节相同**，没有报错。
       · accordion 的规则少了 `visibility: visible` ⇒ display 与高度全对，
         一个字的墨都没多。
     这两次都是「规则写了、看起来生效了、其实什么都没发生」。

   🔴 四条腿（少一条就有一类失效看不见）
     L0 归属   组件规则的选择器，必须在该组件自己的 CSS 或 tokens.css
               （两者都排除 print 块）里定义过
               ⇒ 抓「藏了一个库里根本不存在的类」（实测抓到 .overlay：
                  tokens.css 一直在隐藏它，而全库没有任何 CSS 定义过它）
     L1 声明→实现  契约里的每条规则，必须在**全库** print 块里有一条
               值相符的声明 ⇒ 抓「契约写了、CSS 删了」
               （不钉死文件：库级行为按设计写在 tokens.css 里）
     L2 实现→声明  print 块里每一条**影响内容是否上纸**的声明，必须有规则认领
               ⇒ 抓「顺手加了一条 display:none」
     L3 声明→生效  在真浏览器的 print 媒体下量标本页的计算值
               ⇒ 抓「被更强的声明压掉」（E254 / E255 那一类）

   🔴 覆盖面（说清楚边界，比声称全覆盖有用）
     只看「内容是否上纸」和「能否跨页切断」两类决定：
       display:none / visibility:hidden / content-visibility:hidden /
       opacity:0 / max-height:0 / height:0 / grid-template-rows:0fr /
       break-inside / break-before / break-after
     纯版式调整（单栏化、sticky 取消、描边色、动画关掉）**不记录**：
     它们不丢内容，硬塞进 enum 只会让每条记录都变成「看情况」。

   🔴 不覆盖 examples/
     `examples/finance-report/page.css` 是**使用方**的样式（.fr-fig）。
     契约管的是库；使用方自己的打印行为由使用方负责（audit 工具会看）。

   用法
     node 05-audit/print-policy-gate.js             # 四条腿
     node 05-audit/print-policy-gate.js --selftest  # 反向控制 7 条（覆盖四条腿）
     node 05-audit/print-policy-gate.js --json      # 机读
     环境：BASE（默认 http://127.0.0.1:8000，需要静态服务）
   ========================================================================== */
'use strict';

const { launch } = require('./browser.js');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const FIXTURE = '/05-audit/fixtures/print-policy/probe.html';
const DEFAULTS_CSS = '01-tokens/tokens.css';

/* 库的 CSS 范围。examples/ 不在里面 —— 那是使用方，不是库。 */
const LIB_DIRS = ['01-tokens', '02-primitives', '03-patterns', '04-recipes', '09-assets'];

/* 有限枚举。与 ai/components.schema.json 的 printRule.policy 必须逐字一致。 */
const POLICIES = ['omit', 'expand', 'reveal', 'keep-together', 'allow-break'];
const PAGINATIONS = ['none', 'client', 'server'];

/* 「内容是否上纸」的声明白名单：属性 → 会丢内容的取值。
   不在这张表里的属性一律不要求认领（见文件头的覆盖面说明）。 */
const COVER = {
  'display': ['none'],
  'visibility': ['hidden'],
  'content-visibility': ['hidden'],
  'opacity': ['0'],
  'max-height': ['0', '0px'],
  'height': ['0', '0px'],
  'grid-template-rows': ['0fr'],
  'break-inside': ['avoid', 'auto'],
  'break-before': ['avoid', 'page', 'always', 'left', 'right'],
  'break-after': ['avoid', 'page', 'always', 'left', 'right'],
};

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

/* ---------------------------------------------------------------- CSS 解析
   为什么不用现成的 CSS 解析器：本库零运行时依赖，门禁也不该为了读一个
   @media print 块引入 postcss。真实需要的语法只有两种：注释、单层规则。
   ⚠️ 所以这里**不支持**嵌套 at-rule 内的声明分组（当前库里没有）；
      真出现时 parseRules 会把内层压平处理，不会静默丢掉。
*/

function stripComments(css) {
  let out = '';
  let i = 0;
  let q = null;
  while (i < css.length) {
    const c = css[i];
    if (q) {
      out += c;
      if (c === q && css[i - 1] !== '\\') q = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { q = c; out += c; i++; continue; }
    if (c === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2);
      i = e < 0 ? css.length : e + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/* 返回 [{body, start, end}]，start/end 是**原文**（未剥注释）里的偏移。
   ⚠️ 偏移必须在剥注释后的字符串上算，再用于同一份字符串 —— 见 readCss。 */
function printBlocks(css) {
  const out = [];
  const re = /@media[^{]*\{/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const head = m[0];
    if (!/\bprint\b/i.test(head)) continue;
    const open = m.index + head.length - 1;
    let depth = 0;
    let j = open;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push({ body: css.slice(open + 1, j), start: m.index, end: j + 1 });
  }
  return out;
}

function parseRules(body) {
  const rules = [];
  let i = 0;
  let start = 0;
  while (i < body.length) {
    if (body[i] !== '{') { i++; continue; }
    const selText = body.slice(start, i).trim();
    let depth = 0;
    let j = i;
    for (; j < body.length; j++) {
      if (body[j] === '{') depth++;
      else if (body[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const inner = body.slice(i + 1, j);
    if (/^@/.test(selText)) {
      // 嵌套 at-rule（@supports 之类）：压平，不丢
      rules.push.apply(rules, parseRules(inner));
    } else if (selText) {
      const selectors = selText.split(',')
        .map((s) => s.trim().replace(/\s+/g, ' '))
        .filter(Boolean);
      inner.split(';').forEach((decl) => {
        const k = decl.indexOf(':');
        if (k < 0) return;
        const prop = decl.slice(0, k).trim().toLowerCase();
        if (!prop || prop[0] === '@') return;
        let value = decl.slice(k + 1).trim().toLowerCase();
        let important = false;
        if (/!important\s*$/.test(value)) {
          important = true;
          value = value.replace(/!important\s*$/, '').trim();
        }
        // 归一化：`0px` → `0`，多个空格 → 一个
        value = value.replace(/\s+/g, ' ').replace(/^0px$/, '0');
        rules.push({ selectors, prop, value, important });
      });
    }
    i = j + 1;
    start = i;
  }
  return rules;
}

function walkCss(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      /* 第三方目录（model-viewer/vendor 里是 three.js）不是本库的打印决定：
         它要是写了 @media print，我们既不该认领、也不该改。
         不排除的话，将来 anything.min.css 一带 display:none 就会要求契约认领，
         最后只能加白名单 —— 白名单就是这条腿的死法。 */
      if (name === 'vendor' || name === 'node_modules') continue;
      walkCss(p, out);
    }
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

/* 读全库 CSS，返回：
     { files: {相对路径: {outside, decls[]}}, decls: [{file, ...}] } */
function loadLibrary() {
  const files = {};
  const all = [];
  for (const d of LIB_DIRS) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const p of walkCss(abs, [])) {
      const rel = path.relative(ROOT, p).replace(/\\/g, '/');
      const raw = stripComments(fs.readFileSync(p, 'utf-8'));
      const blocks = printBlocks(raw);
      let outside = '';
      let cur = 0;
      const decls = [];
      for (const b of blocks) {
        outside += raw.slice(cur, b.start);
        cur = b.end;
        for (const r of parseRules(b.body)) {
          r.file = rel;
          decls.push(r);
          all.push(r);
        }
      }
      outside += raw.slice(cur);
      files[rel] = { outside, decls };
    }
  }
  return { files, decls: all };
}

/* 选择器的「主体」类：最后一个复合选择器里的第一个类名。
   `.rep table` → null（元素选择器，天然存在）；`.tabs__panel[hidden]` → tabs__panel */
function subjectClass(sel) {
  const parts = sel.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  const m = last.match(/\.([A-Za-z][\w-]*)/);
  return m ? m[1] : null;
}

/* ---------------------------------------------------------------- 契约侧 */

function loadContract() {
  const p = path.join(ROOT, 'ai', 'components.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

/* 把契约摊平成 [{owner, css, selector, policy, why}]，库级规则在前。
   ⚠️ `css` 只是「这个组件自己的文件」，**不是**这条规则该待的地方：
      库级打印行为（隐藏标签栏、展开折叠面板、不跨页切断）按设计写在
      tokens.css 里 —— tokens.css 是每页都加载的基底，写在组件文件里
      反而只对引了那个文件的页面生效。所以声明放哪由实现决定，
      L1 在全库 print 块里找，L0 才管「这个类是谁定义的」。 */
function flatten(contract) {
  const out = [];
  const d = contract.printDefaults || { rules: [] };
  for (const r of d.rules || []) {
    out.push({ owner: 'printDefaults', css: DEFAULTS_CSS, selector: r.selector,
      policy: r.policy, why: r.why, component: null });
  }
  for (const c of contract.components || []) {
    for (const r of c.printPolicy || []) {
      out.push({ owner: c.id, css: (c.files && c.files.css) || DEFAULTS_CSS,
        selector: r.selector, policy: r.policy, why: r.why, component: c });
    }
  }
  return out;
}

/* ---------------------------------------------------------------- 四条腿 */

const ISSUES = [];
function fail(leg, msg) { ISSUES.push({ leg, msg }); }

/* L0：组件规则的选择器必须在组件自己的 CSS（打印块之外）里定义过。
   实测意义：tokens.css 曾经隐藏 `.overlay`，而全库没有任何 CSS 定义过它 ——
   这条规则除了「隐藏一个不存在的东西」以外什么都没做，而真正的遮罩
   （`.dialog-backdrop`）反而在纸上盖满整页。 */
function legL0(contract, lib, rules) {
  let n = 0;
  for (const r of rules) {
    if (r.owner === 'printDefaults') continue;   // 工具类本来就只活在 print 块里
    const cls = subjectClass(r.selector);
    if (!cls) continue;                          // 元素选择器不需要归属
    const f = lib.files[r.css];
    if (!f) { fail('L0', r.owner + ' 的 CSS 文件不存在：' + r.css); continue; }
    const re = new RegExp('\\.' + cls.replace(/[-_]/g, '\\$&') + '(?![\\w-])');
    if (!re.test(f.outside)) {
      fail('L0', r.owner + ' 声明 ' + r.selector + '，但 ' + r.css
        + ' 打印块之外没有 .' + cls + ' —— 这是「隐藏一个库里不存在的东西」');
    }
    n++;
  }
  return n;
}

const REQUIRED = {
  omit: (d) => d.some((x) => x.prop === 'display' && x.value === 'none'),
  reveal: (d) => d.some((x) => x.prop === 'display'),
  'keep-together': (d) => d.some((x) => x.prop === 'break-inside' && x.value === 'avoid'),
  'allow-break': (d) => d.some((x) => x.prop === 'break-inside' && x.value === 'auto'),
  expand: (d) => d.some((x) => ['display', 'visibility', 'position', 'max-height',
    'overflow', 'overflow-y', 'grid-template-rows'].indexOf(x.prop) >= 0),
};

/* L1：声明 → 实现 */
function legL1(lib, rules) {
  let n = 0;
  for (const r of rules) {
    const decls = lib.decls.filter((d) => d.selectors.indexOf(r.selector) >= 0);
    if (!decls.length) {
      fail('L1', r.owner + ' 声明 ' + r.selector + '（' + r.policy + '），但'
        + '全库 print 块里都没有这条选择器 —— 契约写了，CSS 没有');
      continue;
    }
    const need = REQUIRED[r.policy];
    if (need && !need(decls)) {
      fail('L1', r.owner + ' 声明 ' + r.selector + ' 为 ' + r.policy
        + '，但声明里没有对应的值：'
        + decls.map((d) => d.prop + ':' + d.value).join('; '));
    }
    n++;
  }
  return n;
}

/* L2：实现 → 声明（不许有裸隐藏） */
function legL2(lib, rules) {
  const claimed = new Set(rules.map((r) => r.selector));
  let n = 0;
  let covered = 0;
  for (const d of lib.decls) {
    const vals = COVER[d.prop];
    if (!vals || vals.indexOf(d.value) < 0) continue;
    covered++;
    for (const sel of d.selectors) {
      n++;
      if (!claimed.has(sel)) {
        fail('L2', d.file + ' 里 ' + sel + ' { ' + d.prop + ': ' + d.value
          + ' } 没有任何 printPolicy 认领 —— 要么写进 components.meta.json，'
          + '要么删掉这条声明');
      }
    }
  }
  return { selectors: n, covered: covered };
}

/* L3：声明 → 生效（真浏览器 + print 媒体） */
function readStates(arg) {
  const sel = arg.sel;
  const allowSels = arg.allowSels || [];
  const els = Array.prototype.slice.call(document.querySelectorAll(sel));
  return els.map(function (el) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      display: cs.display,
      visibility: cs.visibility,
      position: cs.position,
      maxHeight: cs.maxHeight,
      overflowY: cs.overflowY,
      breakInside: cs.breakInside === '' ? 'auto' : cs.breakInside,
      height: Math.round(r.height),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().length,
      /* 退出开关：同一个选择器可以有多个标本，
         带 .print-allow-break 的那个本来就该是 auto（那是它的全部用途）。
         🔴 还要认「被别的 allow-break 声明命中」：`.rep__fig--table` 同时带
            `.rep__fig` 类，两条声明特异性相同、靠加载顺序决出 auto。按元素看，
            它确实是 auto，只是不由 `.rep__fig` 这条声明决定 —— 不排除的话
            L3 会把一个**正确**的结果判成 FAIL（2026-11-06 实测）。 */
      allowBreak: el.classList.contains('print-allow-break')
        || allowSels.some(function (x) {
          try { return el.matches(x); } catch (e) { return false; }
        }),
    };
  });
}

/* 逐**元素**判，不是只看第一个：
   `.card` 在标本页上有两个（普通 + print-allow-break），只查第一个的话
   断言结果取决于 HTML 里谁先出现 —— 那种测试会在某次重排后悄悄变绿。 */
function judgeOne(policy, print, screen) {
  if (policy === 'omit') {
    return print.display === 'none' ? null
      : 'print 态 display=' + print.display + '（应为 none）';
  }
  if (policy === 'reveal') {
    if (!screen) return 'screen 态没量到元素';
    if (screen.display !== 'none') return 'screen 态 display=' + screen.display
      + '（应为 none：只在纸上出现）';
    return print.display === 'none' ? 'print 态仍是 display:none' : null;
  }
  if (policy === 'keep-together') {
    if (print.allowBreak) return null;          // 显式退出，见上
    return print.breakInside === 'avoid' ? null : 'break-inside=' + print.breakInside
      + '（应为 avoid）';
  }
  if (policy === 'allow-break') {
    return print.breakInside === 'auto' ? null : 'break-inside=' + print.breakInside
      + '（应为 auto）';
  }
  // expand：内容必须真的回到纸上的流里
  if (print.display === 'none') return 'print 态 display:none（没展开）';
  if (print.visibility === 'hidden') return 'print 态 visibility:hidden（展开了但一个字不印）';
  if (print.position === 'fixed') return 'print 态 position:fixed（脱离文档流，会盖住正文）';
  if (print.maxHeight !== 'none' && print.maxHeight !== '') {
    return 'print 态 max-height=' + print.maxHeight + '（限高没放开，只印可视区）';
  }
  if (/hidden|auto|scroll/.test(print.overflowY)) {
    return 'print 态 overflow-y=' + print.overflowY + '（滚动容器没放开）';
  }
  if (print.text > 0 && print.height < 2) return 'print 态高度 ' + print.height + 'px（有文字但没高度）';
  return null;
}

function judge(policy, prints, screens) {
  for (let i = 0; i < prints.length; i++) {
    const why = judgeOne(policy, prints[i], screens ? screens[i] : null);
    if (why) return '第 ' + (i + 1) + ' 个标本：' + why;
  }
  return null;
}

/* L3：声明 → 生效（真浏览器 + print 媒体） */
async function legL3(page, rules) {
  const screens = {};
  await page.emulateMediaType('screen');
  const allowSels = rules.filter((r) => r.policy === 'allow-break').map((r) => r.selector);
  for (const r of rules) {
    screens[r.selector] = await page.evaluate(readStates, { sel: r.selector, allowSels: allowSels });
  }
  await page.emulateMediaType('print');
  // 等一帧：print 媒体下 grid/flex 的重排不是同步的
  await new Promise((res) => setTimeout(res, 120));
  let n = 0;
  for (const r of rules) {
    const prints = await page.evaluate(readStates, { sel: r.selector, allowSels: allowSels });
    if (!prints.length) {
      fail('L3', r.owner + ' 的 ' + r.selector + ' 在标本页上命中 0 个元素 —— '
        + '没有标本就没有证据（去 05-audit/fixtures/print-policy/probe.html 补）');
      continue;
    }
    const why = judge(r.policy, prints, screens[r.selector]);
    if (why) fail('L3', r.owner + ' 的 ' + r.selector + '（' + r.policy + '）：' + why);
    n += prints.length;
  }

  /* 打印组件不能靠导出器 finish 动画才可见；直接 Ctrl+P 也必须稳定。
     这两条检查的是浏览器真实计算样式，不是 CSS 里有没有写过规则。 */
  const stable = await page.evaluate(() => {
    const panel = document.querySelector('.tabs__panel--enter');
    const body = document.querySelector('.page');
    if (!panel || !body) return null;
    const p = getComputedStyle(panel);
    const b = getComputedStyle(body);
    return { opacity: p.opacity, animation: p.animationName,
      minHeight: b.minHeight, paddingEnd: b.paddingBlockEnd };
  });
  if (!stable || stable.opacity !== '1' || stable.animation !== 'none') {
    fail('L3', 'tabs 淡入面板在 print 媒体下仍可能透明：' + JSON.stringify(stable));
  }
  if (!stable || stable.minHeight !== '0px' || stable.paddingEnd !== '0px') {
    fail('L3', '页面骨架在 print 媒体下仍带屏幕高度/末尾留白：' + JSON.stringify(stable));
  }
  n += 2;
  await page.emulateMediaType('screen');
  return n;
}

/* L4：契约自身的形状与自相矛盾（手改过 components.json 时兜底） */
function legL4(contract) {
  let n = 0;
  // 库级规则也要过枚举与 why —— 它们同样是契约的一部分，不能因为
  // 「没有组件根」就免检（免检的字段迟早写错，而且没人发现）。
  for (const r of (contract.printDefaults || {}).rules || []) {
    if (POLICIES.indexOf(r.policy) < 0) {
      fail('L4', 'printDefaults 的 ' + r.selector + ' policy='
        + JSON.stringify(r.policy) + ' 不在枚举里');
    }
    if (!r.why || String(r.why).trim().length < 8) {
      fail('L4', 'printDefaults 的 ' + r.selector + ' 没有 why');
    }
    n++;
  }
  for (const c of contract.components || []) {
    if (!Array.isArray(c.printPolicy)) {
      fail('L4', c.id + ' 没有 printPolicy 字段（空数组也要写 —— 缺字段与「原样保留」不是一回事）');
      continue;
    }
    if (PAGINATIONS.indexOf(c.pagination) < 0) {
      fail('L4', c.id + ' 的 pagination=' + JSON.stringify(c.pagination)
        + ' 不在枚举里（' + PAGINATIONS.join(' / ') + '）');
    }
    for (const r of c.printPolicy) {
      if (POLICIES.indexOf(r.policy) < 0) {
        fail('L4', c.id + ' 的 ' + r.selector + ' policy=' + JSON.stringify(r.policy)
          + ' 不在枚举里（' + POLICIES.join(' / ') + '）');
      }
      if (!r.why || String(r.why).trim().length < 8) {
        fail('L4', c.id + ' 的 ' + r.selector + ' 没有 why —— 写不出「不这么做会怎样」的策略不该存在');
      }
      if (c.pagination === 'server' && r.policy === 'expand') {
        fail('L4', c.id + '：pagination=server 却要 expand（' + r.selector
          + '）—— 服务端分页只有当前一页，展开后是「印出一页却看起来完整」');
      }
      n++;
    }
  }
  return n;
}

/* ---------------------------------------------------------------- 反向控制 */

const CSS_LINK_RE = /<link rel="stylesheet" href="([^"]+)">/g;

/* 把标本页拼成**离线**文档：所有 <link> 换成内联 <style>。
   🔴 为什么自检必须离线：`selftest-all` 在 MODE=fast 里也会跑，
      而 fast 不起静态服务。依赖 8000 的反向控制会把 fast 变成
      "每次一条未判定"（这已经不是假设：motion-concurrency 就是这么被
      加进 SKIP_SELFTESTS 的）。离线拼接还顺带让自检与端口无关、可重复。
   ⚠️ 内联是安全的：标本页与它引的 20 份 CSS 里没有外部 url()
      （仅有的几处是 data: URI），也没有 @import。 */
function buildInlineFixture(mutateTokens) {
  const file = path.join(ROOT, FIXTURE.replace(/^\//, ''));
  const html = fs.readFileSync(file, 'utf-8');
  let touched = false;
  const out = html.replace(CSS_LINK_RE, function (m, href) {
    const abs = path.resolve(path.dirname(file), href);
    let css = fs.readFileSync(abs, 'utf-8');
    const isTokens = href.indexOf('01-tokens/tokens.css') >= 0;
    if (isTokens && mutateTokens) {
      const before = css;
      css = mutateTokens(css);
      if (css === before) {
        // 变异体没变 ⇒ 这条控制什么都没证明。宁可炸，也不要报一个
        // 「期望红、实际没红」的假失败（那会让人去查门禁，而问题在控制本身）。
        throw new Error('mutateTokens 没有改动任何字节 —— 被替换的字符串已经变了，'
          + '去改 _selftest 里那一行');
      }
      touched = true;
    }
    return '<style data-from="' + href + '">\n' + css + '\n</style>';
  });
  if (mutateTokens && !touched) {
    throw new Error('标本页里没有 01-tokens/tokens.css 的 <link> —— 无法就地改写');
  }
  return out;
}

/* 加载标本页。
   opts.offline       → 内联拼装（不依赖静态服务，自检/反向控制用）
   否则               → goto 真实页面（走服务，与生产同一条路径）
   opts.mutateTokens  → 就地改写 tokens.css（隐含 offline） */
async function loadFixture(browser, opts) {
  opts = opts || {};
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  if (!opts.offline && !opts.mutateTokens) {
    await page.goto(BASE + FIXTURE, { waitUntil: 'networkidle0', timeout: 30000 });
    return page;
  }
  await page.setContent(buildInlineFixture(opts.mutateTokens),
    { waitUntil: 'networkidle0', timeout: 30000 });
  return page;
}

/* 跑一轮完整核对，返回 {issues, counts}。纯函数式：输入变，输出就变。 */
async function runOnce(browser, contract, lib, opts) {
  // ⚠️ 必须在这里收口默认值：两个调用点（main 与 _selftest）传的 opts 不同，
  //    把 `opts.page` 直接透给内层就等于要求每个调用点都知道这个字段。
  //    实测代价：只跑 --selftest 时全绿，正常模式直接
  //    `Cannot read properties of undefined (reading 'page')`。
  opts = opts || {};
  const saved = ISSUES.splice(0, ISSUES.length);
  const rules = flatten(contract);
  // 一次跑完就清空：中途抛异常时也不能把半截结论留给下一次调用
  // （反向控制连跑 7 轮，脏状态会让「第 N 条腿没红」这种误判极难查）。
  try {
    return await runOnceInner(browser, contract, lib, opts, rules);
  } finally {
    ISSUES.splice(0, ISSUES.length);
    saved.forEach((x) => ISSUES.push(x));
  }
}

async function runOnceInner(browser, contract, lib, opts, rules) {
  const counts = {};
  counts.l0 = legL0(contract, lib, rules);
  counts.l1 = legL1(lib, rules);
  counts.l2 = legL2(lib, rules);
  counts.l4 = legL4(contract);
  // opts.page = 复用已建好的标本页（反向控制里 6 条控制用同一张页，
  //   只有需要改写 tokens.css 的那两条才重建）。建一页要内联 20 份 CSS，
  //   实测 2.2s/页 —— 8 页就是 17s，而 7 条控制里 5 条看的是同一张页。
  const own = !opts.page;
  const page = opts.page || await loadFixture(browser, opts);
  try {
    counts.l3 = await legL3(page, rules);
  } finally {
    if (own) await page.close();
  }
  const issues = ISSUES.slice();
  return { issues, counts, rules };
}

const CTLS = [];

async function selftest() {
  const contract = loadContract();
  const lib = loadLibrary();
  const browser = await launch();
  let pass = 0;
  let bad = 0;

  // 一张页跑遍所有不改编 CSS 的控制（见 runOnceInner 里的注释）
  const shared = await loadFixture(browser, { offline: true });
  const base = await runOnce(browser, contract, lib, { page: shared });
  if (base.issues.length) {
    console.log('  [FAIL] 基线不干净（' + base.issues.length + ' 条），'
      + '反向控制没有意义 —— 先把基线修绿');
    base.issues.slice(0, 8).forEach((x) => console.log('         ' + x.leg + ' ' + x.msg));
    await shared.close();
    await browser.close();
    return 1;
  }
  console.log('  基线：' + base.rules.length + ' 条规则 / L0 ' + base.counts.l0
    + ' · L1 ' + base.counts.l1 + ' · L2 ' + base.counts.l2.selectors
    + ' 选择器 · L3 ' + base.counts.l3 + ' · L4 ' + base.counts.l4);
  console.log('');

  async function control(name, expectLeg, mutate, mutateTokens) {
    const c2 = JSON.parse(JSON.stringify(contract));
    const lib2 = mutate.lib ? mutate.lib(lib) : lib;
    mutate.contract(c2);
    let r;
    try {
      r = await runOnce(browser, c2, lib2, {
        page: mutateTokens ? undefined : shared, mutateTokens: mutateTokens });
    } catch (e) {
      r = { issues: [{ leg: 'ERR', msg: e.message }] };
    }
    const hit = r.issues.filter((x) => x.leg === expectLeg);
    const ok = hit.length > 0;
    if (ok) pass++; else bad++;
    console.log('  ' + (ok ? 'OK  ' : 'FAIL') + '  ' + name);
    console.log('        ' + (ok ? '→ ' + expectLeg + ' 报红：' + hit[0].msg.slice(0, 96)
      : '→ 期望 ' + expectLeg + ' 报红，实际没有（门禁对这类失效是瞎的）'));
    CTLS.push({ name, leg: expectLeg, ok });
  }

  function dropDecl(file, selector, prop) {
    return function (lib0) {
      const copy = { files: {}, decls: [] };
      Object.keys(lib0.files).forEach((k) => {
        copy.files[k] = {
          outside: lib0.files[k].outside,
          decls: lib0.files[k].decls.filter((d) => !(k === file
            && d.selectors.indexOf(selector) >= 0 && d.prop === prop)),
        };
      });
      copy.decls = lib0.decls.filter((d) => !(d.file === file
        && d.selectors.indexOf(selector) >= 0 && d.prop === prop));
      return copy;
    };
  }

  function addDecl(file, selector, prop, value) {
    return function (lib0) {
      const copy = { files: {}, decls: [] };
      const extra = { selectors: [selector], prop, value, important: true, file };
      Object.keys(lib0.files).forEach((k) => {
        copy.files[k] = { outside: lib0.files[k].outside,
          decls: lib0.files[k].decls.slice() };
      });
      copy.files[file].decls.push(extra);
      copy.decls = lib0.decls.concat([extra]);
      return copy;
    };
  }

  // ① L1：契约说 omit，CSS 里的 display:none 被删掉
  await control('L1 · 删掉 CSS 里的隐藏声明（契约还在）', 'L1',
    { contract: () => {}, lib: dropDecl('01-tokens/tokens.css', '.pagination', 'display') });

  // ② L2：凭空加一条未认领的隐藏
  await control('L2 · 往 print 块里塞一条没人认领的 display:none', 'L2',
    { contract: () => {}, lib: addDecl('01-tokens/tokens.css', '.ghost-box', 'display', 'none') });

  // ③ L3：真实复刻 E254 —— 把 .tabs 前缀去掉，规则被组件 CSS 同特异性盖掉
  await control('L3 · 复刻 E254：.tabs 前缀去掉，规则被组件 CSS 盖掉', 'L3',
    { contract: () => {} },
    (css) => css.replace('.tabs .tabs__panel[hidden] { display: block; }',
      '.tabs__panel[hidden] { display: block; }'));

  // ④ L3：把政策改成 omit，而 CSS 是展开
  await control('L3 · 政策与实现相反（expand 的 CSS 被声明成 omit）', 'L3',
    { contract: (c) => {
      const t = c.components.find((x) => x.id === 'accordion');
      t.printPolicy[0].policy = 'omit';
    } });

  // ⑤ L4：服务端分页 + expand
  await control('L4 · pagination=server 与 expand 同时出现', 'L4',
    { contract: (c) => {
      const t = c.components.find((x) => x.id === 'table');
      t.pagination = 'server';
    } });

  // ⑥ L3：复刻 E255 —— 只删 `visibility: visible`，display 与高度全对
  await control('L3 · 复刻 E255：删掉 visibility:visible（display 与高度都还对）', 'L3',
    { contract: () => {} },
    (css) => css.replace('    visibility: visible;', ''));

  // ⑦ L0：藏一个库里不存在的类（.overlay 就是这个形状）
  await control('L0 · 藏一个库里没有定义的类（.overlay 的形状）', 'L0',
    { contract: (c) => {
      const t = c.components.find((x) => x.id === 'overlay');
      t.printPolicy.push({ selector: '.overlay', policy: 'omit', why: '故意写一个不存在的类' });
    } });

  await shared.close();
  await browser.close();
  console.log('');
  const legs = Array.from(new Set(CTLS.filter((c) => c.ok).map((c) => c.leg))).sort();
  console.log('  反向控制 ' + pass + '/' + (pass + bad) + ' 条全部报红'
    + '（覆盖 ' + (legs.join(' / ') || '—') + '）'
    + (bad ? '  🔴 有 ' + bad + ' 条对这类失效是瞎的' : ''));
  return bad ? 1 : 0;
}

/* ---------------------------------------------------------------- 主流程 */

async function main() {
  // ⚠️ 写成 `argv.indexOf('--selftest')` 而不是 `has('--selftest')`：
  //    selftest-all.py 用这个**调用点**当发现判据（argv.indexOf|includes + 字面量），
  //    套一层 has() 就发现不了 —— 发现不了 = 这道反向控制不在"全部门禁一起自检"里。
  if (argv.indexOf('--selftest') >= 0) return selftest();

  const contract = loadContract();
  const lib = loadLibrary();
  const rules = flatten(contract);

  const browser = await launch();
  let r;
  try {
    r = await runOnce(browser, contract, lib);
  } finally {
    await browser.close();
  }

  const issues = r.issues;
  const byLeg = {};
  issues.forEach((x) => { byLeg[x.leg] = (byLeg[x.leg] || 0) + 1; });

  if (has('--json')) {
    console.log(JSON.stringify({
      ok: issues.length === 0,
      rules: rules.length,
      counts: r.counts,
      byLeg,
      issues,
    }, null, 1));
  } else {
    console.log('');
    console.log('  打印契约核对（契约 / 实现 / 运行时）');
    console.log('  ' + '-'.repeat(74));
    console.log('  规则 ' + rules.length + ' 条（库级 '
      + (contract.printDefaults || { rules: [] }).rules.length + ' + 组件 '
      + (rules.length - (contract.printDefaults || { rules: [] }).rules.length) + '）');
    console.log('  L0 归属      ' + r.counts.l0 + ' 条选择器确认在归属文件里定义过');
    console.log('  L1 声明→实现 ' + r.counts.l1 + ' 条规则在 print 块里找到相符声明');
    console.log('  L2 实现→声明 ' + r.counts.l2.covered + ' 条内容性声明 / '
      + r.counts.l2.selectors + ' 个选择器，逐条对照认领表');
    console.log('  L3 声明→生效 ' + r.counts.l3 + ' 个标本元素在 print 媒体下量到预期值');
    console.log('  L4 契约形状  ' + r.counts.l4 + ' 条记录枚举合法、无自相矛盾');
    console.log('  ' + '-'.repeat(74));
    if (!issues.length) {
      console.log('  ✅ 四条腿全绿：没有裸隐藏、没有写了不生效、没有藏不存在的东西');
    } else {
      issues.forEach((x) => console.log('  FAIL [' + x.leg + '] ' + x.msg));
      console.log('');
      console.log('  共 ' + issues.length + ' 条：'
        + Object.keys(byLeg).sort().map((k) => k + '×' + byLeg[k]).join('  '));
    }
    console.log('');
  }
  return issues.length ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e) => {
  const msg = String(e && e.message || e);
  if (/ECONNREFUSED|net::ERR|Navigation failed|timeout/i.test(msg)) {
    console.error('  静态服务没起（BASE=' + BASE + '）—— 先 bash 05-audit/with-server.sh');
    process.exit(3);
  }
  console.error('ERR ' + msg);
  process.exit(1);
});
