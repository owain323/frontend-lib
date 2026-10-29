'use strict';
/*
 * demo-claim-gate.js —— 「对错对照块」的断言必须能被机器验
 *
 * ============================================================================
 * 🔴 它补的是哪一半
 * ============================================================================
 * `demo-counterexample-gate.py` 判的是「反例**在不在**」：块在、没被藏、
 * 块后有标题。它判不了「这块反例**是不是真的坏**」—— 那句话当时写在脚本头部，
 * 承认了没判。
 *
 * 而这个缺口是真实存在的，不是理论上的：
 *   · `03-patterns/nav` 的反例栏，`.toc__link` 自带 `white-space: nowrap`，
 *     长标题**根本没换行**，只是被裁掉了 —— 标题却写着「允许换行」。
 *   · `03-patterns/list` 同一形态：两栏都是 1 行，`.list__title` 自带 ellipsis。
 *   · 更早的 `02-primitives/dropdown`：反例写了 `display:flex; min-height:44px`，
 *     恰好绕开了真实坑，两栏像素级相同。
 * 三次都是「块在、标题对、但反例不成立」。只判「在不在」时，这三处全绿。
 *
 * ============================================================================
 * 🔴 怎么判：每栏一条可证伪的数字，且两栏断言**互斥**
 * ============================================================================
 * 写法（写在栏容器上）：
 *
 *   <div class="cmp__pane cmp__bad"  data-bad="li.dd-bug|h|<=24">
 *   <div class="cmp__pane cmp__good" data-good="li.dd__item|h|>=44">
 *
 * 格式：`选择器|指标|断言`，断言 = 比较符 + 数值（选择器写 `.` 表示这一栏本身）
 *
 * 判三件事：
 *   ① 两栏都写了断言（缺一条就红 —— 没有断言就没有可验证的东西）
 *   ② 两栏各自**成立**（量出来的数真的落在断言里）
 *   ③ 两条断言**互斥**：不存在任何一个数能同时满足两边
 *
 * ③ 是这套判据的关键。只做 ①② 的话，`>=24` 与 `>=44` 也能双双成立 ——
 * 那什么也证明不了。互斥成立 ⇒ 两栏在那个维度上**必然不同**，
 * 这是「错的样子真的摆出来了」能被机器捡到的那一半。
 *
 * ============================================================================
 * 🔴 第二道判据：反例块里**到底有没有东西可看**
 * ============================================================================
 * 上面那套判的是"两栏有没有差别"。但它有个前提：块里得真有标本。
 * 0.11.12 发布之后扫了一遍，**13 个反例块里一个标本都没有** —— 全是
 * `<p class="small">` 在**描述**一个反例。例如：
 *
 *   `02-primitives/separator`：标题写「反例：用 div + border-bottom 代替 hr」，
 *   块里却只有一段话说"div 对读屏什么都没有"。**那个 div 根本没渲染。**
 *   `02-primitives/switch`、`03-patterns/accordion`、`03-patterns/tabs` 同形。
 *
 * 这不是"反例不成立"，是更早一层：**没有反例**。而 `demo-counter` 判不出来
 * ——它只判"块在不在、有没有被藏、块后有没有标题"，一段纯文字全都满足。
 *
 * 判据：块里必须有**标本** —— 一个库组件的实例。可接受两种：
 *   ① 元素带着组件样式里定义的类名（`.badge` / `.choice` / `.field` / `.sparkline`…）
 *   ② 原生绘图/交互元素（`hr` `input` `button` `table` `svg` …）
 * 都摆不出来的，必须在块上写 `data-prose="理由"` —— **声明，不是沉默**。
 * 理由为空等于没写。
 *
 * ⚠️ 类名表只从组件样式收，**排除 `01-tokens`**：那是排版工具类
 * （`.small` `.page` `.row`），它们大量出现在说明文字上，拿它们当"标本"
 * 就等于这条判据不存在（第一版正是这么写的，13 个块全绿）。
 *
 * ============================================================================
 * 🔴 第三道判据：单栏块必须**逐块登记**，不是打个数字
 * ============================================================================
 * `box bad` 单栏块没有成对结构，互斥断言用不上 —— 这是真实的覆盖边界，
 * 不是能消灭的东西。但"边界"和"欠账"的区别在于：前者每一块都写清了为什么，
 * 后者只是一个数字。
 *
 * 所以：每个单栏反例块，必须在**块上**写
 *
 *   <div class="box bad" data-claim-skip="差别只在无障碍树里，两栏视觉必然相同">
 *
 * 缺了、或理由为空白 ⇒ 红。理由逐条打出来，可以被反驳 ——
 * 这是它比一行统计数字唯一多出来的价值。
 *
 * ⚠️ 这条判据以前是**按页**的（`<!-- demo-claim:skip 理由 -->`），0.11.14 改成按块。
 * 原因不是审美，是一个具体的洞：按页判时，只要给页面加**一个** `cmp` 块，
 * 同页剩下的单栏反例就全部"洗白"了 —— 门禁不看了，也不需要理由。
 * 而 0.11.14 恰好造出了这种页（`separator` / `switch` 各有一块在视觉上
 * 必然相同的反例，凑不成对），所以这个洞必须先堵上，否则改完就是假绿。
 * 页面级注释现在会**报错**，不忽略 —— 两套机制并存比没有机制更坏。
 *
 * ============================================================================
 * 🔴 它判不了什么（不假装判了）
 * ============================================================================
 *   · 反例**该不该**算错 —— 那是判断，机器判不了。
 *     （例：`progress` 那块量的是"反例里有 success 色的满进度条"，
 *       这证明演示物在，不证明"到 100% 变绿"这个做法不好。）
 *   · 文案说得准不准 —— `cmp__why` 里那句话对不对，只能人读。
 *   · 标本**像不像**那个反例 —— 只判"有没有非说明标签的元素"，判不了
 *     "这一实例对不对"。摆一个不相干的 `<div>` 就满足判据。
 *   · `data-prose` 的理由**诚不诚实** —— 只判"写了且不是空话"，判不了真假。
 *     理由会逐条打出来，能被反驳，这已经是机器能给的上限。
 *
 * ============================================================================
 * 🔴 为什么在 900px 宽下量
 * ============================================================================
 * `.cmp` 在 640px 以下叠成单栏（见 `01-tokens/page.css`），
 * 叠起来就没有"并排"了。900px 是两栏并排时的典型宽度，
 * 所有数字都以它为准 —— 换宽度量，阈值要重定，那是另一件事。
 *
 * 用法：
 *   node 05-audit/demo-claim-gate.js             # 判
 *   node 05-audit/demo-claim-gate.js --selftest  # 自检（每条用例都写明该红还是该绿）
 * ========================================================================= */

const fs = require('fs');
const path = require('path');
const { launch } = require(path.join(__dirname, 'browser.js'));

const ROOT = path.dirname(__dirname);
/* 默认走 check-all.sh 起的 8000；开发时可用 FL_BASE 指到别的端口，
   免得为了跑一次门禁去抢 8000（那会让 check-all 的 canary 判定混乱）。 */
const BASE = process.env.FL_BASE || 'http://127.0.0.1:8000/';
const VIEW = { width: 900, height: 900 };

/* 指标表。加一个指标要想清楚"它一句话说清的是哪件事"，
   加不进去的，说明那个反例其实量化不了 —— 那就别硬凑。 */
const METRICS = {
  count: '栏内匹配元素的个数',
  h: '第一个匹配元素的高度（px）',
  w: '第一个匹配元素的宽度（px）',
  lines: '高度 ÷ 行高，即行数',
  fs: '第一个匹配元素的字号（px）',
  uniq: '不同"渲染字形"的个数（textContent + ::before/::after）',
  glyphs: '第一个匹配元素的字形字符数（含伪元素）',
  hidden: '有效不可见的匹配元素个数（opacity 0 / visibility hidden / 零尺寸）',
  /* 别的指标都是**代理**：「高度 0」暗示焦点没了、「没有 input」暗示原生行为没了。
     focus 是**直接**的那一个 —— 它数的就是"按 Tab 能不能停上去"。
     反例讲的是"键盘到不了这里"时，只有它能把这句话量出来。 */
  focus: '匹配元素里真的能 Tab 到的个数（tabIndex≥0、有渲染盒、未 disabled）',
  gh: 'hover 引起的高度变化（px，正数=变大）',
  gw: 'hover 引起的宽度变化（px，正数=变宽）',
};

const OPS = ['=', '<=', '>=', '<', '>'];

/* ---------------------------------------------------------------------------
 * ① 解析 & 断言代数
 * ------------------------------------------------------------------------ */

function parseClaim(raw) {
  if (raw === null || raw === undefined) return { err: '没写断言' };
  const parts = raw.split('|');
  if (parts.length !== 3) {
    return { err: `格式应为 选择器|指标|断言（如 li|h|>=44），实际 ${parts.length} 段：${raw}` };
  }
  const [sel, metric, assert] = parts.map((x) => x.trim());
  if (!sel) return { err: '选择器为空' };
  if (!METRICS[metric]) {
    return { err: `未知指标 ${metric}（可用：${Object.keys(METRICS).join(' / ')}）` };
  }
  const m = /^(<=|>=|=|<|>)(-?\d+(?:\.\d+)?)$/.exec(assert);
  if (!m) {
    return { err: `断言应形如 >=44 / <24 / =0，实际是 ${assert}`
      + `（可用比较符：${OPS.join(' ')}）` };
  }
  return { sel, metric, op: m[1], value: Number(m[2]) };
}

/** 量出来的值是否落在断言里。`=` 用 0.51 容差：值统一保留一位小数。 */
function holds(measured, claim) {
  if (measured === null) return false;
  const { op, value } = claim;
  const eps = 0.51;
  switch (op) {
    case '=': return Math.abs(measured - value) <= eps;
    case '<': return measured < value - eps;        // 严格小于，且留出测量噪声
    case '>': return measured > value + eps;
    case '<=': return measured <= value + eps;
    case '>=': return measured >= value - eps;
    default: return false;
  }
}

/** 把一条断言化成区间 [lo, hi, lo含端点, hi含端点]。 */
function interval(c) {
  switch (c.op) {
    case '=': return [c.value, c.value, true, true];
    case '<': return [-Infinity, c.value, false, false];
    case '<=': return [-Infinity, c.value, false, true];
    case '>': return [c.value, Infinity, false, false];
    case '>=': return [c.value, Infinity, true, false];
    default: return [NaN, NaN, false, false];
  }
}

/** 两个断言能否被同一个数同时满足。能 ⇒ 它们证明不了"两栏不同"。 */
function overlap(a, b) {
  const [al, ah, alIn, ahIn] = interval(a);
  const [bl, bh, blIn, bhIn] = interval(b);
  const lo = al > bl ? { v: al, i: alIn } : al < bl ? { v: bl, i: blIn }
    : { v: al, i: alIn && blIn };
  const hi = ah < bh ? { v: ah, i: ahIn } : ah > bh ? { v: bh, i: bhIn }
    : { v: ah, i: ahIn && bhIn };
  if (lo.v > hi.v) return false;
  if (lo.v < hi.v) return true;
  return lo.i && hi.i;
}

/* ---------------------------------------------------------------------------
 * ② 页面内测量
 * ------------------------------------------------------------------------ */

/* 这个函数会被 page.evaluate 序列化进去，只能用页面里有的东西 */
function measureInPage([blockIdx, side, spec]) {
  const block = document.querySelectorAll('.cmp')[blockIdx];
  if (!block) return null;
  const pane = block.querySelector(side === 'bad' ? '.cmp__bad' : '.cmp__good');
  if (!pane) return null;

  const glyph = (el) => {
    const pick = (v) => (v && v !== 'none' && v !== 'normal')
      ? v.replace(/^["']|["']$/g, '') : '';
    return pick(getComputedStyle(el, '::before').content)
      + (el.textContent || '').trim()
      + pick(getComputedStyle(el, '::after').content);
  };

  if (spec.metric === 'count') return pane.querySelectorAll(spec.sel).length;

  if (spec.metric === 'hidden') {
    return [...pane.querySelectorAll(spec.sel)].filter((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display === 'none' || cs.visibility === 'hidden'
        || parseFloat(cs.opacity) === 0 || r.width === 0 || r.height === 0;
    }).length;
  }

  if (spec.metric === 'uniq') {
    return new Set([...pane.querySelectorAll(spec.sel)].map(glyph)).size;
  }

  /* 「能不能 Tab 到」没有现成 API，得**两个信号一起取** —— 少一个都会错，
     而且两个方向的错都实测到了：

       元素                     tabIndex   专注得成   Tab 到得了
       a[href]                     0         ✅         ✅
       a（没有 href）              0         ❌         ❌   ← tabIndex 会撒谎
       input[disabled]             0         ❌         ❌   ← tabIndex 会撒谎
       div[tabindex="-1"]         -1         ✅         ❌   ← 能聚焦 ≠ 能 Tab 到
       button[tabindex="-1"]      -1         ✅         ❌   ← roving 的"其余项"就是它

     所以判据是 **`focus()` 成功 且 `tabIndex >= 0`**：
       · 只看 tabIndex  ⇒ 没 href 的 `<a>`、disabled 的输入框会被算成可聚焦；
       · 只看 focus()   ⇒ roving tabindex 那组里 `-1` 的项会被算成能 Tab 到
         （tabs 那页第一次就是这么错的：正例量出 3，应该是 1）。

     ⚠️ 已知低估：`contenteditable` 在 Chrome 里 `tabIndex` 报 -1，但它**在**
        Tab 顺序里 —— 本库没用到，真用上时要补一条 `isContentEditable`。
        `focus()` 会滚动页面，量完把滚动位置放回去、并 `blur()` 掉。 */
  if (spec.metric === 'focus') {
    const els = [...pane.querySelectorAll(spec.sel)];
    const sx = window.scrollX;
    const sy = window.scrollY;
    let n = 0;
    for (const el of els) {
      if (typeof el.focus !== 'function') continue;
      if (el.tabIndex < 0) continue;
      el.focus({ preventScroll: true });
      if (document.activeElement === el) n++;
    }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    window.scrollTo(sx, sy);
    return n;
  }

  const el = spec.sel === '.' ? pane : pane.querySelector(spec.sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  switch (spec.metric) {
    case 'h': return r.height;
    case 'w': return r.width;
    case 'fs': return parseFloat(cs.fontSize);
    case 'glyphs': return glyph(el).length;
    case 'lines': {
      let lh = parseFloat(cs.lineHeight);
      if (!Number.isFinite(lh)) lh = parseFloat(cs.fontSize) * 1.2;
      /* 取整：padding 也被算进高度里，比值天然带小数
         （实测 2 行的链接量出 2.39）—— 取整才对应"几行"。 */
      return Math.round(r.height / lh);
    }
    default: return null;
  }
}

const HOVER = new Set(['gh', 'gw']);

/** hover 前后各量一次。必须先把元素滚进视口 —— mouse.move 用的是视口坐标。 */
async function measureHover(page, blockIdx, side, spec) {
  const rect = await page.evaluate(([i, s, sel]) => {
    const pane = document.querySelectorAll('.cmp')[i]
      .querySelector(s === 'bad' ? '.cmp__bad' : '.cmp__good');
    const el = sel === '.' ? pane : pane.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  }, [blockIdx, side, spec.sel]);
  if (!rect) return null;
  await page.mouse.move(rect.x, rect.y);
  await new Promise((r) => setTimeout(r, 700));
  const after = await page.evaluate(([i, s, sel]) => {
    const pane = document.querySelectorAll('.cmp')[i]
      .querySelector(s === 'bad' ? '.cmp__bad' : '.cmp__good');
    const el = sel === '.' ? pane : pane.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }, [blockIdx, side, spec.sel]);
  await page.mouse.move(3, 3);
  await new Promise((r) => setTimeout(r, 350));
  if (!after) return null;
  return spec.metric === 'gh' ? after.h - rect.h : after.w - rect.w;
}

async function measure(page, blockIdx, side, spec) {
  if (HOVER.has(spec.metric)) return measureHover(page, blockIdx, side, spec);
  return page.evaluate(measureInPage, [blockIdx, side, spec]);
}

/* ---------------------------------------------------------------------------
 * ②b 判"块里有没有标本"（跑在页面里）
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * ②b 判"块里有没有标本"
 * ---------------------------------------------------------------------------
 * 走过两条错路，都留在注释里，因为下一个人会想到同样的两条：
 *
 * 错路一：按"类名是否定义在组件样式里"判。`separator` 的反例是
 *   `<div class="line">`，`line` 定义在 demo 自己的 `<style>` 里 —— 真标本
 *   被判成没标本；反过来 `.row > .sparkline` 这种后代选择器又会把排版类
 *   `.row` 收进表里 ⇒ 假绿。解析 CSS 判不出来。
 * 错路二：按"有没有边框/底色"判。`tooltip` 的反例是 `<div class="tt-field">`
 *   里面几个纯文字的 span，`tree` 是 `div.tree__node`，`report` 是
 *   `<p class="rep-p">` —— 三处都是**文字构成的标本**，一个边框都没有。
 *   这条规则把三处真标本全冤枉了。
 *
 * 现在的判据：**说明文字用的排版类不算标本，其余算**。
 *   · 原生控件/绘图元素（`hr` `input` `table` `svg`…）→ 标本
 *   · `h3 p code pre strong …` 这些"天生是字"的标签 → 只有带**非排版类**
 *     的类名时才算标本（`p.rep-p` 是内容本身，`p.small` 是描述）
 *   · 其余标签（`div` `span` `li`…）→ 算标本
 * 排版类表 = `01-tokens/*.css` 里出现过的类名（`.small` `.lede` `.note`…）。
 *
 * ⚠️ 刻意不判 `opacity` / `visibility`：`reveal` 那页的反例就是"卡片存在
 * 但看不见"，排掉不可见，那页会被冤枉成"没有标本"。
 *
 * 它判不了：加一层 `<div>` 包住一段说明文字就能过 —— 判据只看"有没有
 * 非说明标签的元素"，判不了"那个元素算不算标本"。这条只防"整块只有
 * 说明文字"，不防"摆了个不相干的东西"，后者机器判不了。
 */
function judgeSpecimensInPage([tokenClasses]) {
  const token = new Set(tokenClasses);
  const NATIVE = new Set(['hr', 'input', 'button', 'select', 'textarea', 'svg',
    'canvas', 'img', 'video', 'table', 'progress', 'meter', 'dialog', 'details',
    'summary', 'iframe']);
  /* 这些标签天生是"字"：只有挂上非排版类才算标本 */
  const PROSE = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'code', 'pre',
    'blockquote', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'kbd', 'samp',
    'var', 'cite', 'q', 'abbr', 'br', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'figure',
    'figcaption', 'time', 'mark', 'del', 'ins', 'sub', 'sup']);

  const rendered = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  };
  const isSpecimen = (el) => {
    if (!rendered(el)) return false;
    const tag = el.tagName.toLowerCase();
    if (NATIVE.has(tag)) return true;
    if (PROSE.has(tag)) {
      return [...el.classList].some((c) => !token.has(c));
    }
    return true;
  };

  const out = [];
  for (const el of document.querySelectorAll('.box.bad, .cmp__bad')) {
    const h3 = el.querySelector('h3');
    const title = h3 ? h3.textContent.trim() : '(无标题)';
    /* 块级信息：`data-claim-skip` 是"这块写不出互斥断言"的登记，
       `isCmp` 用来区分"成对的（由断言判据管）"和"单栏的（必须登记）"。 */
    const base = {
      title,
      isCmp: el.classList.contains('cmp__bad'),
      claimSkip: el.getAttribute('data-claim-skip'),
    };
    const prose = el.getAttribute('data-prose');
    if (prose !== null) {
      out.push(prose.trim().length >= 8
        ? { ...base, ok: true, declared: true, prose: prose.trim() }
        : { ...base, ok: false, why: 'data-prose 的理由太短（要写清为什么摆不出来）' });
      continue;
    }
    const n = [...el.querySelectorAll('*')].filter(isSpecimen).length;
    out.push(n
      ? { ...base, ok: true, declared: false, n }
      : { ...base, ok: false,
        why: '块里只有说明文字，没有一个"内容本身"的元素 —— '
          + '标题说的那个"反例"根本没被摆出来' });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * ③ 判一个块
 * ------------------------------------------------------------------------ */

/* 排版工具类：`01-tokens/*.css` 里出现过的类名。
   判"这段文字是说明还是内容"时，就靠这张表 —— `.small` `.lede` 是描述用的，
   `.rep-p` `.tt-hint` 是内容本身的。 */
function tokenClasses() {
  const set = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, '01-tokens'))) {
    if (!f.endsWith('.css')) continue;
    const css = fs.readFileSync(path.join(ROOT, '01-tokens', f), 'utf8');
    for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) set.add(m[1]);
  }
  return [...set];
}

/* 所有 demo 页。以前只收有 `cmp__bad` 的页 —— 那样"没有成对结构的页"
   连看都不会被看到，正是 13 个空反例块能躺到 0.11.12 的原因。 */
function readPages() {
  const out = [];
  for (const top of fs.readdirSync(ROOT)) {
    if (!/^0\d-/.test(top)) continue;
    const dir = path.join(ROOT, top);
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name, 'demo.html');
      if (!fs.existsSync(file)) continue;
      const src = fs.readFileSync(file, 'utf8');
      out.push({
        rel: `${top}/${name}/demo.html`,
        hasCmp: /cmp__bad/.test(src),
        /* 已废弃的**页面级**登记。留着这一项是为了主动报错，不是兼容 ——
           两套登记机制并存时，下一个人会以为注释那套还在生效。 */
        legacySkip: /<!--\s*demo-claim:skip[\s\S]*?-->/.test(src),
      });
    }
  }
  return out;
}

async function judgePage(page) {
  const raws = await page.evaluate(() => [...document.querySelectorAll('.cmp')].map((b) => {
    const bad = b.querySelector('.cmp__bad');
    const good = b.querySelector('.cmp__good');
    return {
      hasBad: !!bad, hasGood: !!good,
      bad: bad ? bad.getAttribute('data-bad') : null,
      good: good ? good.getAttribute('data-good') : null,
      title: bad && bad.querySelector('h3') ? bad.querySelector('h3').textContent.trim() : '',
    };
  }));

  const problems = [];
  for (let i = 0; i < raws.length; i++) {
    const b = raws[i];
    if (!b.hasBad || !b.hasGood) {
      /* 少一栏就是"对照不存在"。这里**不能**只报"有反例栏却缺正例栏"——
         反过来（只有正例栏）更常见，而且更隐蔽：删掉反例栏，页面看起来
         依然是个正经的两栏块，`demo-counter` 也只是"少一个块"而不会红。 */
      problems.push(`块#${i}（${b.title || '无标题'}）`
        + (b.hasBad ? '只有反例栏，没有正例栏' : b.hasGood ? '只有正例栏，没有反例栏' : '两栏都没有')
        + ' —— 对照必须有两侧');
      continue;
    }
    const cb = parseClaim(b.bad);
    const cg = parseClaim(b.good);
    if (cb.err) { problems.push(`块#${i}（${b.title}）反例栏：${cb.err}`); continue; }
    if (cg.err) { problems.push(`块#${i}（${b.title}）正例栏：${cg.err}`); continue; }
    if (cb.metric !== cg.metric) {
      problems.push(`块#${i}（${b.title}）两栏量的不是同一件事：`
        + `${cb.metric} vs ${cg.metric} —— 这样的对比说明不了任何问题`);
      continue;
    }
    if (overlap(cb, cg)) {
      problems.push(`块#${i}（${b.title}）两栏断言可以同时成立`
        + `（${cb.metric} ${cb.op}${cb.value} 与 ${cg.op}${cg.value}）`
        + ' —— 那它就证明不了"两栏不同"');
      continue;
    }
    const mb = await measure(page, i, 'bad', cb);
    const mg = await measure(page, i, 'good', cg);
    if (!holds(mb, cb)) {
      problems.push(`块#${i}（${b.title}）反例栏断言不成立：`
        + `${cb.sel} 的 ${cb.metric} 量得 ${mb === null ? '找不到元素' : fmt(mb)}，`
        + `断言是 ${cb.op}${cb.value}`);
      continue;
    }
    if (!holds(mg, cg)) {
      problems.push(`块#${i}（${b.title}）正例栏断言不成立：`
        + `${cg.sel} 的 ${cg.metric} 量得 ${mg === null ? '找不到元素' : fmt(mg)}，`
        + `断言是 ${cg.op}${cg.value}`);
      continue;
    }
    console.log('    OK    %s  %s 量得 %s', pad(cb.metric), b.title.slice(0, 22), fmt(mb));
  }
  return problems;
}

const fmt = (v) => (Math.round(v * 10) / 10).toString();
const pad = (s) => (s + '            ').slice(0, 10);

/* ---------------------------------------------------------------------------
 * ④ 主流程
 * ------------------------------------------------------------------------ */

/* 块级登记判据。抽成函数是为了能在自检里喂合成数据 ——
   否则这段逻辑只能靠"在真实仓库里看着对"来相信。 */
function judgeBlockSkips(blocks) {
  const problems = [];
  for (const b of blocks) {
    if (b.isCmp) continue;            // 成对的块由断言判据管，不走这条
    /* 写了 `data-prose` 的块连标本都摆不出来，自然更配不成对 ——
       `data-prose` 已经把这件事说清了，再要一条 `data-claim-skip`
       是让人把同一句话说两遍。一条声明只能覆盖一个问题，不要两个都罚。 */
    if (b.declared) continue;
    const reason = b.claimSkip === null || b.claimSkip === undefined
      ? null : b.claimSkip.trim();
    if (reason === null) {
      problems.push({
        title: b.title,
        why: '单栏反例块没有写 `data-claim-skip="理由"` —— '
          + '写不出互斥断言可以，沉默不行',
      });
    } else if (reason.length < 8) {
      problems.push({ title: b.title, why: `登记理由太短：${JSON.stringify(reason)}` });
    }
  }
  return problems;
}

/* 页面级登记已废弃：判据搬到**块上**了。
   原因很具体 —— 页面级只有"这一页有没有成对结构"一个粒度，
   而一页里可以既有成对的块、又有写不成对的块（本轮就有两页是这种情况）。
   按页判的话，加一个 `cmp` 块就能把同页剩下的单栏反例全部"洗白"。 */
function judgeLegacySkips(pages) {
  return pages.filter((p) => p.legacySkip).map((p) => ({
    rel: p.rel,
    why: '还在用页面级的 `<!-- demo-claim:skip -->` —— '
      + '判据已改到块上，请改成该块的 `data-claim-skip="理由"`',
  }));
}

async function main() {
  const pages = readPages();
  const token = tokenClasses();
  const b = await launch();
  const page = await b.newPage();
  await page.setViewport(VIEW);

  let blocks = 0;
  let nSpecimen = 0;
  const nProse = [];
  const allBlocks = [];
  const claimProblems = [];
  const specimenProblems = [];

  for (const p of pages) {
    await page.goto(BASE + p.rel, { waitUntil: 'networkidle0' });

    /* ② 标本：每一页都判，不只有成对结构的页 */
    const specs = await page.evaluate(judgeSpecimensInPage, [token]);
    allBlocks.push(...specs.map((s) => ({ rel: p.rel, ...s })));
    const bad = specs.filter((s) => !s.ok);
    if (bad.length) specimenProblems.push({ rel: p.rel, bad });
    for (const s of specs) {
      if (!s.ok) continue;
      if (s.declared) nProse.push({ rel: p.rel, title: s.title, prose: s.prose });
      else nSpecimen++;
    }

    /* ① 断言：只有成对结构的页才有 */
    if (!p.hasCmp) continue;
    const n = await page.evaluate(() => document.querySelectorAll('.cmp').length);
    blocks += n;
    const problems = await judgePage(page);
    if (problems.length) claimProblems.push({ rel: p.rel, problems });
    else if (!bad.length) console.log('  ✅ %s（%d 块）', p.rel, n);
  }
  await b.close();

  /* ③ 登记：**按块**判，不按页判 */
  const skipBad = judgeBlockSkips(allBlocks);
  const legacy = judgeLegacySkips(pages);
  const declared = allBlocks.filter((b) => !b.isCmp
    && typeof b.claimSkip === 'string' && b.claimSkip.trim().length >= 8);

  console.log('\n  ── 覆盖 ──');
  console.log('  对照块 %d 个（%d 页）；反例块里有标本 %d 个，'
    + '声明摆不出来 %d 个；单栏块登记 %d 个',
  blocks, pages.filter((p) => p.hasCmp).length, nSpecimen, nProse.length,
  declared.length);
  if (nProse.length) {
    console.log('  声明的（`data-prose`，理由可被反驳）：');
    nProse.forEach((x) => console.log('    · %s  %s\n      %s',
      x.rel.replace('/demo.html', ''), x.title.slice(0, 18), x.prose));
  }
  if (declared.length) {
    console.log('  单栏块登记（%d 块，视觉上必然相同，写不出互斥断言）：', declared.length);
    declared.forEach((x) => console.log('    · %s  %s\n      %s',
      x.rel.replace('/demo.html', ''), x.title.slice(0, 18), x.claimSkip.trim()));
  }

  if (specimenProblems.length) {
    console.log('\n  🔴 %d 页的反例块里没有标本：', specimenProblems.length);
    for (const x of specimenProblems) {
      console.log('\n  · %s', x.rel);
      x.bad.forEach((s) => console.log('      「%s」\n        %s', s.title, s.why));
    }
  }
  if (skipBad.length) {
    console.log('\n  🔴 %d 个单栏块没有登记：', skipBad.length);
    skipBad.forEach((x) => console.log('  · 「%s」\n      %s', x.title, x.why));
  }
  if (legacy.length) {
    console.log('\n  🔴 %d 页还在用页面级登记：', legacy.length);
    legacy.forEach((x) => console.log('  · %s\n      %s', x.rel, x.why));
  }
  if (claimProblems.length) {
    console.log('\n  🔴 %d 页有断言不成立：', claimProblems.length);
    for (const x of claimProblems) {
      console.log('\n  · %s', x.rel);
      x.problems.forEach((m) => console.log('      %s', m));
    }
  }
  if (specimenProblems.length || skipBad.length || legacy.length || claimProblems.length) {
    process.exit(1);
  }

  console.log('\n  ✅ %d 个对照块：每栏都写了可证伪的断言，且两两互斥、各自成立', blocks);
  console.log('  ✅ 每个反例块里都有标本，或写明了为什么摆不出来');
  console.log('  ✅ %d 个单栏块逐块登记（不是一行统计数字）', declared.length);
}

/* ---------------------------------------------------------------------------
 * ⑤ 自检：门禁必须证明自己会红
 * ------------------------------------------------------------------------ */

async function selftest() {
  /* 只跑"当前代码全绿"是没有鉴别力的 —— 那叫恒绿。下面每条都必须是红的。 */
  const FIXTURE = (bad, good, body) => `<style>
      .cmp{display:grid;grid-template-columns:1fr 1fr}
      .cmp__pane{border:1px solid #ccc;padding:8px}
      li{height:24px} .tall li{height:44px}
    </style><div class="cmp">
      <div class="cmp__pane cmp__bad" ${bad === null ? '' : `data-bad="${bad}"`}>
        <h3>反例</h3>${body}</div>
      <div class="cmp__pane cmp__good" ${good === null ? '' : `data-good="${good}"`}>
        <h3>正例</h3><ul class="tall"><li>a</li></ul></div>
    </div>`;

  const cases = [
    ['没写断言', null, 'li|h|>=44', '<ul><li>a</li></ul>'],
    ['格式不对（缺少比较符）', 'li|h|44', 'li|h|>=44', '<ul><li>a</li></ul>'],
    ['格式不对（两段）', 'li|h>=44', 'li|h|>=44', '<ul><li>a</li></ul>'],
    ['未知指标', 'li|height|<=24', 'li|h|>=44', '<ul><li>a</li></ul>'],
    ['选择器找不到', 'li.nope|h|<=24', 'li|h|>=44', '<ul><li>a</li></ul>'],
    ['断言不成立（量得 24 却写 <=20）', 'li|h|<=20', 'li|h|>=44', '<ul><li>a</li></ul>'],
    ['两栏可同时成立', 'li|h|>=24', 'li|h|>=44', '<ul><li>a</li></ul>'],
    ['两栏量的不是同一件事', 'li|h|<=24', 'li|w|>=44', '<ul><li>a</li></ul>'],
  ];

  const b = await launch();
  const page = await b.newPage();
  await page.setViewport(VIEW);
  let ok = true;
  let nRed = 0;
  let nGreen = 0;
  /* kind 必须显式传：自检结论里的条数要能**数出来**，不能手写 ——
     手写的数字会在下次加用例时变成谎话（这一条本轮已经踩过两次）。 */
  const say = (pass, msg, kind = 'red') => {
    if (!pass) ok = false;
    if (kind === 'green') nGreen++; else nRed++;
    console.log('  %s %s', pass ? 'PASS' : 'FAIL', msg);
  };

  for (const [name, bad, good, body] of cases) {
    await page.setContent(FIXTURE(bad, good, body), { waitUntil: 'load' });
    const problems = await judgePage(page);
    say(problems.length > 0, `反向控制：${name} → 必须红（${problems[0] || '却绿了'}）`);
  }

  // 反向控制的另一半：合法夹具必须绿，否则这道门禁只会恒红
  await page.setContent(FIXTURE('li|h|<=24', 'li|h|>=44', '<ul><li>a</li></ul>'),
    { waitUntil: 'load' });
  const green = await judgePage(page);
  say(green.length === 0, '正例：合法断言（24 vs 44，互斥且各自成立）→ 必须绿', 'green');

  // 少一栏：两个方向都要红。只有正例栏那条最容易被漏掉 ——
  // 删掉反例栏之后，页面看起来仍是个正经的两栏块。
  for (const [name, html] of [
    ['只有正例栏', '<div class="cmp"><div class="cmp__pane cmp__good" '
      + 'data-good="li|h|>=44"><h3>正例</h3><ul class="tall"><li>a</li></ul></div></div>'],
    ['只有反例栏', '<div class="cmp"><div class="cmp__pane cmp__bad" '
      + 'data-bad="li|h|<=24"><h3>反例</h3><ul><li>a</li></ul></div></div>'],
  ]) {
    await page.setContent(html, { waitUntil: 'load' });
    const missing = await judgePage(page);
    say(missing.length > 0 && /对照必须有两侧/.test(missing[0]),
      `反向控制：${name} → 必须红（${missing[0] || '却绿了'}）`);
  }

  /* ③ 标本判据：块里到底有没有东西可看 */
  const SPEC = (inner, attr = '') =>
    `<div class="box bad"${attr}><h3>反例</h3>${inner}</div>`;
  const TOK = ['small', 'lede', 'note', 'prose', 'row'];
  /* 每条都写成"该红还是该绿"的对照 —— 只测红会得到一道恒红的门禁，
     只测绿会得到一道恒绿的门禁，两种都不可信。 */
  for (const [name, inner, attr, want] of [
    ['只有一段说明文字（.small 是排版类）',
      '<p class="small">div 对读屏什么都没有</p>', '', false],
    ['说明文字带行内 code',
      '<p><code>&lt;div class="line"&gt;</code> 不行</p>', '', false],
    ['说明文字里有列表', '<ul><li>a</li><li>b</li></ul>', '', false],
    ['无类名的 p（分不出是说明还是内容，按说明算）', '<p>x</p>', '', false],
    /* 这条是重构的全部理由：report 的反例就是 <p class="rep-p">，
       它没有边框没有底色，但它是"内容本身"而不是"描述反例的文字"。 */
    ['PROSE 标签但带非排版类（report 的 p.rep-p）',
      '<p class="rep-p">数据来源：公司 2026 年三季报</p>', '', true],
    ['工具 tip 那种纯文字字段组（div.tt-field）',
      '<div class="tt-field"><span class="tt-label">账期</span></div>', '', true],
    ['有底色的 badge（span）',
      '<span style="background:#eef;padding:2px 6px">已停牌</span>', '', true],
    ['有边框的空 div（separator 的 div.line）',
      '<div style="border-bottom:1px solid #ccc;height:8px"></div>', '', true],
    ['裸 hr', '<hr>', '', true],
    ['裸 table（说明性表格也是渲染出来的东西）',
      '<table><tr><td>a</td></tr></table>', '', true],
    ['opacity:0 但有尺寸（reveal 那种"存在但看不见"）',
      '<div style="height:20px;opacity:0"></div>', '', true],
    ['display:none 的零尺寸元素',
      '<div style="display:none">x</div>', '', false],
    ['data-prose 写了理由', '<p>x</p>',
      ' data-prose="焦点落点是运行时行为，静态块摆不出来"', true],
    ['data-prose 是空字符串', '<p>x</p>', ' data-prose=""', false],
    ['data-prose 只有几个字', '<p>x</p>', ' data-prose="摆不出来"', false],
  ]) {
    await page.setContent(SPEC(inner, attr), { waitUntil: 'load' });
    const r = await page.evaluate(judgeSpecimensInPage, [TOK]);
    const green = r.length === 1 && r[0].ok;
    say(green === want, `${want ? '放行' : '反向'}控制：标本「${name}」`
      + `→ 必须${want ? '绿' : '红'}（实际${green ? '绿' : '红'}）`,
    want ? 'green' : 'red');
  }

  /* ④ 登记判据（喂合成数据，不碰真实仓库） */
  const LONG = '两栏在视觉上必然相同，差别只在无障碍树里，写不出互斥断言';
  for (const [name, blocks, want] of [
    ['单栏块没登记', [{ title: 'x', isCmp: false }], false],
    ['理由全是空格', [{ title: 'x', isCmp: false, claimSkip: '   ' }], false],
    ['理由太短', [{ title: 'x', isCmp: false, claimSkip: '量不了' }], false],
    ['理由够长', [{ title: 'x', isCmp: false, claimSkip: LONG }], true],
    ['成对的块不需要登记', [{ title: 'x', isCmp: true }], true],
    /* 反方向也要放行：成对的块**多写一条**登记不该被罚 ——
       那不是矛盾，只是冗余；罚它会让下一个人去删一句真话。 */
    ['成对的块多写了登记', [{ title: 'x', isCmp: true, claimSkip: LONG }], true],
    /* 标本都没有的块不用再登记一遍 —— 否则同一件事要说两遍 */
    ['写了 data-prose 的块（已声明摆不出来）',
      [{ title: 'x', isCmp: false, declared: true }], true],
    ['data-prose 无效的块仍然要登记',
      [{ title: 'x', isCmp: false, declared: false }], false],
  ]) {
    const green = judgeBlockSkips(blocks).length === 0;
    say(green === want, `${want ? '放行' : '反向'}控制：登记「${name}」`
      + `→ 必须${want ? '绿' : '红'}（实际${green ? '绿' : '红'}）`,
    want ? 'green' : 'red');
  }

  /* 页面级登记已废弃：留着必须报错，否则两套机制并存 */
  say(judgeLegacySkips([{ rel: 'a', legacySkip: true }]).length === 1
    && judgeLegacySkips([{ rel: 'b', legacySkip: false }]).length === 0,
  '反向控制：页面级 `<!-- demo-claim:skip -->` 残留 → 必须红');

  /* ⑤ focus 指标：它数的是"能不能 Tab 到"，
     所以每条都要有正反两面 —— 只测"数出 0"会放过一条永远返回 0 的实现。 */
  for (const [name, inner, sel, want] of [
    ['普通 input', '<input type="checkbox">', 'input', 1],
    ['display:none 的 input', '<input type="checkbox" style="display:none">', 'input', 0],
    ['visibility:hidden 的 input',
      '<input type="checkbox" style="visibility:hidden">', 'input', 0],
    ['disabled 的 input', '<input type="checkbox" disabled>', 'input', 0],
    ['opacity:0 的 input（本库 choice 的写法）',
      '<input style="opacity:0;position:absolute;inset:0">', 'input', 1],
    ['带 tabindex=0 的 div', '<div tabindex="0">x</div>', '[tabindex]', 1],
    ['没有 tabindex 的 div', '<div>x</div>', 'div', 0],
    ['带 href 的 a', '<a href="#x">x</a>', 'a', 1],
    ['没有 href 的 a', '<a>x</a>', 'a', 0],
    /* 这两条是"别把语义搞反"的守门：aria-disabled 是**仍可聚焦**，
       max-height:0 的内容**仍在 Tab 顺序里** —— 正是 accordion 那页要教的。 */
    ['aria-disabled 的 button（规范要求仍可聚焦）',
      '<button aria-disabled="true">x</button>', 'button', 1],
    /* 这一条是第一次实现量错的地方：能聚焦不等于能 Tab 到 */
    ['tabindex="-1" 的 button（脚本能聚焦，Tab 到不了）',
      '<button tabindex="-1">x</button>', 'button', 0],
    ['max-height:0 里的链接（仍可聚焦）',
      '<div style="max-height:0;overflow:hidden"><a href="#y">y</a></div>', 'a', 1],
    ['hidden 里的链接（已离开 Tab 顺序）',
      '<div hidden><a href="#y">y</a></div>', 'a', 0],
  ]) {
    await page.setContent(
      `<div class="cmp"><div class="cmp__pane cmp__bad">${inner}</div></div>`,
      { waitUntil: 'load' });
    const got = await page.evaluate(measureInPage, [0, 'bad', { sel, metric: 'focus' }]);
    say(got === want, `${want ? '放行' : '反向'}控制：focus「${name}」`
      + `→ 必须数出 ${want}（实际 ${got}）`, want ? 'green' : 'red');
  }

  await b.close();
  console.log(ok ? '\n  ✅ 自检通过：' + nRed + ' 条「必须红」的用例全红，'
    + nGreen + ' 条「必须绿」的用例全绿'
    : '\n  🔴 自检失败：门禁抓不住上面的错误，它给的绿不可信');
  if (!ok) process.exit(1);
}

if (require.main === module) {
  (process.argv.includes('--selftest') ? selftest() : main())
    .catch((e) => { console.error(e); process.exit(1); });
}
