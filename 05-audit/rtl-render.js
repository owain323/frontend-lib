/**
 * rtl-render.js — RTL 的真实渲染判据
 * ============================================================================
 * 为什么需要它（rtl-check.js 已经在了，为什么不够）
 * ---------------------------------------------------------------------------
 *   现有的 `rtl-check.js` 只证明两件事：
 *     · CSS 里物理方向属性 0 处（静态）
 *     · 把 dir 设成 rtl 之后 computed direction 变成了 rtl（一个页面，一条断言）
 *
 *   而"方向属性清零"不等于"RTL 下渲染正确"：
 *     · 逻辑属性摆对了框，但**字形**不会翻转（▶ 在 RTL 里仍指向右）
 *     · 汉字换成阿拉伯语之后**文字变长**，容器可能装不下 —— 这叫文字膨胀，
 *       是 RTL 最典型的回归形态，而它与"有没有 margin-left"毫无关系
 *     · 整页横向滚动（RTL 下最常见的破相）
 *   这三件事都必须**在渲染后量**，静态扫 CSS 扫不出来。
 *
 * 判据（三条，都能被证伪）
 * ---------------------------------------------------------------------------
 *   ① `dir=rtl` 后根元素 computed direction === 'rtl'（否则下面两条没意义）
 *   ② 1280 宽下**页面**无横向滚动；把叶子文字换成同语义的阿/希字符串
 *      并拉长到 1.3 倍后，仍然无横向滚动（WCAG 1.4.10 的 RTL 版本）
 *   ③ 方向性字形真的镜像了：`.tree__marker` 折叠态在 RTL 下 content 为 ◀
 *
 * 为什么只判"页面"横滚、不判每个元素
 * ---------------------------------------------------------------------------
 *   数据表格是二维内容，WCAG 明确豁免它有自己的横向滚动容器。
 *   判每个元素会把这些合法滚动区全判成失败 —— 那是假红，会让人关掉门禁。
 *
 * 用法
 * ---------------------------------------------------------------------------
 *   node 05-audit/rtl-render.js
 *   node 05-audit/rtl-render.js tree      # 只判一页
 *   node 05-audit/rtl-render.js --selftest
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const { launch } = require('./browser');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.FL_BASE || 'http://127.0.0.1:8000';

/* 阿拉伯语 / 希伯来语样例：不是占位符，是**真的会出现在业务里的词**。
 * 长度刻意比中文长（膨胀本来就是这样发生的）。 */
const AR = 'إجمالي الإيرادات التشغيلية للربع الرابع';
const HE = 'סך ההכנסות התפעוליות ברבעון הרביעי';

function pages() {
  const cj = JSON.parse(fs.readFileSync(path.join(ROOT, 'ai', 'components.json'), 'utf-8'));
  const out = cj.components
    .filter((c) => c.files && c.files.demo)
    .map((c) => [c.id, c.files.demo]);
  out.push(['docs-index', 'guide/index.html']);
  out.push(['docs-page', 'guide/table.html']);
  return out;
}

/* ---------------- 页面内探针 ---------------- */
const probe = {
  /* 页面级横向溢出 + 元凶（跳过自己有横向滚动的合法容器） */
  overflow: () => {
    const de = document.scrollingElement || document.documentElement;
    const over = de.scrollWidth - de.clientWidth;
    const who = [];
    if (over > 1) {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        /* 🔴 必须**两边都看**。RTL 下溢出的元素往**左**跑（左边缘变负），
           不是往右。只判 `r.right > clientWidth` 时，RTL 页面明明溢出了，
           元凶列表却是空的 —— 报告只剩一个数字，定位不了任何人。
           （LTR 与 RTL 两种溢出必须同一份探针都能指名，否则等于没探针。） */
        if (r.right <= de.clientWidth + 1 && r.left >= -1) continue;
        const cs = getComputedStyle(el);
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
        who.push((el.tagName.toLowerCase() + '.' +
          String(el.className || '').split(' ')[0]).slice(0, 50) +
          '(' + (r.left < -1 ? 'L' : 'R') + ')');
        if (who.length >= 3) break;
      }
    }
    return { over, who, dir: getComputedStyle(document.body).direction };
  },

  /* 文字膨胀：把叶子文本换成阿/希字符串并拉长到 1.3 倍 */
  inflate: (text) => {
    let n = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const targets = [];
    while (walker.nextNode()) {
      const t = walker.currentNode;
      if (!t.nodeValue || !t.nodeValue.trim()) continue;
      if (t.parentElement && t.parentElement.closest('script,style,svg')) continue;
      targets.push(t);
    }
    for (const t of targets) {
      const base = t.nodeValue.trim();
      /* 单字符不替换：那多半是分隔符 `·`、关闭符 `×`、或单个数字，
         它们本来就不该被"翻译成阿拉伯语延长版"，替换了反而是在造噪音。
         ⚠️ 代价：如果某页**全是**单字符文本，这条判据会一个都不替换 ——
         所以调用侧必须把 `n === 0` 判成红（判据没生效 ≠ 通过）。 */
      if (base.length < 2) continue;
      /* 1.3 倍：业界常用的"德语/阿拉伯语膨胀"经验值 */
      const times = Math.max(1, Math.ceil(base.length * 1.3 / text.length));
      t.nodeValue = new Array(times + 1).join(text);
      n++;
    }
    return n;
  },

  /* 方向性字形是否镜像（读 ::before 的 content）
     ⚠️ 三种状态分别读，**不能只看收起态**：
        "把 RTL 里的箭头全翻转"这种改法也能让收起态变对，
        但它会把展开态 ▼ 翻成 ▲ —— 那是另一个错。 */
  marker: () => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const c = getComputedStyle(el, '::before').content;
      return c == null ? null : String(c).replace(/["']/g, '');
    };
    const off = pick('.tree__item[aria-expanded="false"] > .tree__node .tree__marker');
    const on = pick('.tree__item[aria-expanded="true"] > .tree__node .tree__marker');
    const leaf = pick('.tree__item:not([aria-expanded]) > .tree__node .tree__marker');
    if (off === null && on === null && leaf === null) return { found: false };
    return { found: true, off, on, leaf };
  },
  /* 分页的前/后按钮：这两个字形是**文字字符**，镜像与否取决于
     Unicode 的 Bidi_Mirrored 属性，不是"我们有没有写 RTL 规则"。
     所以这里不判"有没有 [dir=rtl] 规则"，只判"用的是不是会被自动镜像的那类字符"。 */
  steps: () => {
    const pick = (g) => {
      const el = document.querySelector('.pagination__link[data-goto="' + g + '"]');
      return el ? String(el.textContent || '').trim() : null;
    };
    const prev = pick('prev');
    const next = pick('next');
    if (prev === null && next === null) return { found: false };
    return { found: true, prev, next };
  },
};

/* 三种字形：收起 ▶→◀ 必须镜像；展开 ▼ 与叶子 · **必须不变** */
const GLYPH = { off: '\u25C0', on: '\u25BC', leaf: '\u00B7' };

/* 哪些字符**由浏览器自动镜像**（Bidi_Mirrored = Yes）—— 实测结论，不是查表抄的。
 * ---------------------------------------------------------------------------
 * 2026-10-29 直接渲染对照（LTR 行 vs RTL 行，四种字符并排）：
 *   U+2039 U+203A U+003C U+003E  ⇒ 四者在 RTL 下**全部**翻转了；
 *   而 U+25B6 / U+25C0（几何图形）**不翻转**。
 * ⇒ 这正是 tree 必须写显式 `[dir="rtl"]` 规则、而 pagination 不必写的原因。
 *   用这一族"标点类"字符表达方向是免费的；用几何形状表达方向就得自己镜像。
 *   钉死这条，是为了防止有人把 `‹` 换成 `◀`（看起来更像箭头），
 *   结果 RTL 下箭头指向反了、而其它门禁一条都不会响。
 * ⚠️ 只收**实测过**的字符；`« »` 之类没测就不收 —— 宁可比实际需要更严。 */
const AUTO_MIRRORED = ['\u2039', '\u203A', '\u003C', '\u003E'];




/* 分页箭头判据（纯函数，可单测）：用了不会自动镜像的字符就报问题。
 * 抽成纯函数的原因：主流程里它只在**通过**的那一支被跑到，
 * 会让"这条判据真的会红吗"永远没人验证过。 */
function stepProblems(st) {
  const out = [];
  for (const pair of [['prev', st.prev], ['next', st.next]]) {
    const k = pair[0], v = pair[1];
    if (v == null || v === '') continue;
    if (AUTO_MIRRORED.indexOf(v) < 0) {
      out.push('分页 ' + k + ' 箭头用了不会自动镜像的字符 ' + JSON.stringify(v)
               + ' ⇒ 换成 ' + JSON.stringify(AUTO_MIRRORED[0])
               + ' 一类，或在 CSS 里补 [dir="rtl"] 规则');
    }
  }
  return out;
}

async function selftest() {
  const b = await launch();
  let bad = 0;
  const ok = (why, cond, extra) => {
    if (!cond) bad++;
    console.log('  ' + (cond ? 'OK ' : 'RED') + ' ' + why.padEnd(30) + (extra || ''));
  };
  const p = await b.newPage();
  await p.setViewport({ width: 400, height: 600 });

  // ① 宽盒子 ⇒ 必须报溢出，指得出元凶，且方向是 rtl
  await p.setContent('<html dir="rtl"><body style="margin:0"><div style="width:1200px;height:40px">宽</div></body></html>');
  let v = await p.evaluate(probe.overflow);
  ok('定宽溢出 ⇒ 报出并指方向', v.over > 1 && v.dir === 'rtl', 'over=' + v.over + ' dir=' + v.dir);
  /* 🔴 RTL 下溢出发生在**左**边（元素的 left 变负）。
     只判右边缘的实现在这里会得到 over>0 而 who=[] —— 数字有了、人没有。
     ⇒ 这条同时要求"指名道姓"，且标记方向 L。 */
  ok('RTL 左溢出 ⇒ 指得出元凶', v.who.length >= 1 && /\(L\)/.test(v.who[0]),
     'who=' + JSON.stringify(v.who));

  // ② 流式页面 ⇒ 不许报
  await p.setContent('<html dir="rtl"><body style="margin:0"><div style="max-width:100%">流式</div></body></html>');
  v = await p.evaluate(probe.overflow);
  ok('流式页面 ⇒ 不报溢出', v.over <= 1, 'over=' + v.over);

  // ③ 膨胀确实改了文本且确实更长
  await p.setContent('<html dir="rtl"><body><p style="width:120px">季度收入</p><p style="width:120px">营业收入</p></body></html>');
  const n = await p.evaluate(probe.inflate, 'نص عربي طويل');
  v = await p.evaluate(probe.overflow);
  ok('膨胀替换了叶子文本', n >= 1, 'n=' + n);
  ok('膨胀后窄容器 ⇒ 页面不横滚（块级会换行）', v.over <= 1, 'over=' + v.over);

  // ③b 单字符文本**故意不替换**：把这条边界钉死，
  //     防止把"跳过"当成"已覆盖"（判据 0 目标却报绿是假绿）。
  await p.setContent('<html dir="rtl"><body><p style="width:120px">·</p><p style="width:120px">×</p></body></html>');
  const n1 = await p.evaluate(probe.inflate, 'نص عربي طويل');
  ok('单字符文本 ⇒ 跳过不替换', n1 === 0, 'n=' + n1);

  // ④ 字形镜像：三种状态各判一次
  /* ⚠️ 这里用 String.fromCharCode 拼 CSS，而不是在源码里写转义序列：
     转义要穿过 node 字符串 → CSS 字符串两层，任何一层少一个反斜杠，
     断言就会对着一个完全不同的字符判"通过/失败"（实测踩过：
     写坏之后 content 变成 "BC"，三条断言还都在跑，判的却是垃圾）。 */
  const cp = (n) => String.fromCharCode(n);
  await p.setContent(
    '<html dir="rtl"><body><style>' +
    '.m::before{content:"' + cp(0x25BC) + '"}' +                 /* ▼ 展开（不变） */
    '.c::before{content:"' + cp(0x25B6) + '"}' +                 /* ▶ 收起（LTR 基准） */
    '.l::before{content:"' + cp(0x00B7) + '"}' +                 /* · 叶子（不变） */
    '[dir="rtl"] .c::before{content:"' + cp(0x25C0) + '"}' +     /* ◀ 镜像后 */
    '</style><span class="m"></span><span class="c"></span><span class="l"></span></body></html>');
  const m = await p.evaluate(function () {
    function g(sel) {
      var c = getComputedStyle(document.querySelector(sel), '::before').content;
      return c == null ? '' : String(c).replace(/["']/g, '');
    }
    return { on: g('.m'), off: g('.c'), leaf: g('.l') };
  });
  ok('RTL 下收起字形镜像成 ◀', m.off === GLYPH.off, 'content=' + JSON.stringify(m.off));
  ok('RTL 下展开字形不变 ▼', m.on === GLYPH.on, 'content=' + JSON.stringify(m.on));
  ok('RTL 下叶子字形不变 ·', m.leaf === GLYPH.leaf, 'content=' + JSON.stringify(m.leaf));

  // ⑤ 分页箭头：会镜像的字符放行，几何图形必须拦下
  ok('分页箭头 ‹ › ⇒ 放行',
     stepProblems({ prev: AUTO_MIRRORED[0], next: AUTO_MIRRORED[1] }).length === 0);
  ok('分页箭头 ◀ ⇒ 拦下',
     stepProblems({ prev: GLYPH.off, next: AUTO_MIRRORED[1] }).length === 1,
     'problems=' + JSON.stringify(stepProblems({ prev: GLYPH.off, next: AUTO_MIRRORED[1] })));

  await b.close();
  console.log('');
  console.log(bad ? '  ⇒ 🔴 判据自检 ' + bad + ' 条不成立' : '  ⇒ ✅ 判据自检全部成立');
  return bad ? 1 : 0;
}

(async () => {
  if (process.argv.includes('--selftest')) process.exit(await selftest());
  const only = process.argv.slice(2).find((a) => !a.startsWith('--'));

  try {
    await new Promise((res, rej) => {
      const r = require('http').get(BASE + '/index.html', (s) => { s.resume(); res(); });
      r.on('error', rej);
      r.setTimeout(3000, () => r.destroy(new Error('timeout')));
    });
  } catch (e) {
    console.error('  🔴 读不到 ' + BASE + ' —— 没有取证，不是跳过。');
    process.exit(2);
  }

  const browser = await launch();
  const list = pages().filter(([id]) => !only || id === only);
  let fails = 0, done = 0;
  let markerChecked = 0, offChecked = 0, offOk = 0;
  let stepChecked = 0;

  for (const [id, rel] of list) {
    const p = await browser.newPage();
    const bad = [];
    try {
      await p.setCacheEnabled(false);
      await p.setViewport({ width: 1280, height: 900 });
      await p.goto(BASE + '/' + rel, { waitUntil: 'networkidle0', timeout: 15000 });

      /* 先把整页切成 RTL：只改 attribute，不重排版式表 */
      await p.evaluate(() => { document.documentElement.dir = 'rtl'; });
      await new Promise((r) => setTimeout(r, 80));

      const v1 = await p.evaluate(probe.overflow);
      if (v1.dir !== 'rtl') bad.push('direction 仍是 ' + v1.dir);
      if (v1.over > 1) {
        bad.push('RTL 1280px 横向溢出 ' + v1.over + 'px' +
                 (v1.who.length ? '（' + v1.who.join(' / ') + '）' : ''));
      }

      /* 文字膨胀 */
      const replaced = await p.evaluate(probe.inflate, AR);
      /* 🔴 `replaced === 0` 必须判红：
         一个文本都没替换 ⇒ 「膨胀 1.3× 不破相」这句话**根本没被检验**，
         而流程照样会把它打印成一行绿 —— 那就是"判据没跑却算通过"。
         （本次就是靠这类 0/0 抓到：tree 页当年一个 aria-expanded=false
           都没有，方向性字形 0/0，却报「全绿」。） */
      if (replaced < 1) {
        bad.push('膨胀没有替换任何文本 ⇒ 这一页的膨胀判据没生效（不是通过）');
      }
      await new Promise((r) => setTimeout(r, 120));
      const v2 = await p.evaluate(probe.overflow);
      if (v2.over > 1) {
        bad.push('阿拉伯语膨胀 1.3× 后横向溢出 ' + v2.over + 'px' +
                 (v2.who.length ? '（' + v2.who.join(' / ') + '）' : ''));
      }

      /* 字形镜像只在有方向性字形的页面判。
         ⚠️ 三种状态一起判：只判收起态的话，"把箭头全翻转"这种改法也能过，
            但它会把展开态 ▼ 变成 ▲ —— 那是另一个错。 */
      const mk = await p.evaluate(probe.marker);
      if (mk.found) {
        markerChecked++;
        if (mk.off !== null) {
          offChecked++;
          if (mk.off === GLYPH.off) offOk++;
          else bad.push('收起箭头在 RTL 下没有镜像（读到 ' + JSON.stringify(mk.off) + '）');
        }
        if (mk.on !== null && mk.on !== GLYPH.on) {
          bad.push('展开箭头不该翻转，却成了 ' + JSON.stringify(mk.on));
        }
        if (mk.leaf !== null && mk.leaf !== GLYPH.leaf) {
          bad.push('叶子标记不该变，却成了 ' + JSON.stringify(mk.leaf));
        }
      }
      /* 分页前/后箭头：必须是**会被自动镜像**的那类字符 */
      const st = await p.evaluate(probe.steps);
      if (st.found) {
        stepChecked++;
        for (const msg of stepProblems(st)) bad.push(msg);
      }



      /* 希伯来语再来一遍（同一套判据，换一种文字） */
      await p.goto(BASE + '/' + rel, { waitUntil: 'networkidle0', timeout: 15000 });
      await p.evaluate(() => { document.documentElement.dir = 'rtl'; });
      await p.evaluate(probe.inflate, HE);
      await new Promise((r) => setTimeout(r, 120));
      const v3 = await p.evaluate(probe.overflow);
      if (v3.over > 1) bad.push('希伯来语膨胀后横向溢出 ' + v3.over + 'px');
    } catch (e) {
      bad.push('打不开：' + String(e).slice(0, 50));
    }
    await p.close();

    done++;
    if (bad.length) {
      fails++;
      console.log('  🔴 ' + id.padEnd(18) + bad[0]);
      for (const x of bad.slice(1)) console.log('     ' + ' '.repeat(18) + x);
    } else {
      console.log('  OK ' + id.padEnd(18) + 'RTL 渲染 · 阿/希膨胀 · 方向一致');
    }
  }

  await browser.close();
  console.log('');
  if (!done) {
    console.error('  🔴 一页都没判 ⇒ 假绿');
    process.exit(2);
  }
  console.log('  判了 ' + done + ' 页 · 失败 ' + fails +
              ' · 收起字形 ' + offOk + '/' + offChecked +
              ' · 分页箭头 ' + stepChecked + ' 页' +
              ' · 含方向性字形的页面 ' + markerChecked + ' 个');
  /* 🔴 0/0 不是「没有失败」，是「这条判据没跑」。必须红。 */
  if (!markerChecked || !offChecked) {
    console.error('  🔴 没有任何一页验到收起态字形（0 个）'
                  + ' ⇒ 第 ④ 条判据其实没跑，不能算通过');
    process.exit(2);
  }
  /* 分页箭头那条同理：0 页验到 = 判据没跑。 */
  if (!stepChecked) {
    console.error('  🔴 没有任何一页验到分页箭头（0 个）'
                  + ' ⇒ 箭头字形判据没跑，不能算通过');
    process.exit(2);
  }
  if (fails) {
    console.log('  ⇒ 🔴 RTL 渲染未通过');
    process.exit(1);
  }
  console.log('  ⇒ ✅ RTL 下页面不横滚、阿/希文字膨胀 1.3× 不破相、方向性字形已镜像');
  process.exit(0);
})();
