const kit = require('./contract-kit.js');
const path = require('path');
const fs = require('fs');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');
const DIR = REPO + '/04-recipes/report';

/**
 * report-check.js — 报告版式系统 v1 契约（VIZ-REPORT-01 工作包 C + D）
 *
 * ============================================================================
 * 这个 recipe 的**失败模式**不是"样式丑"，而是**声称由变量驱动的版式，
 * 实际变量一个都没生效**。三件真事，都是本轮实测抓到的：
 *
 *   ① 级联事故：`.rep h2 / .rep h3` 是 (0,1,1)，`.rep__title` 是 (0,1,0)
 *      ⇒ **单类名选择器被元素+类的组合选择器压过去**，
 *        `--rep-title-fs` 这个"换版式的关键变量"静默失效，
 *        三套 profile 的标题被钉死成同一个字号（实测全是 24px）。
 *      ⇒ 判据必须读**计算值**，并要求 profile 之间数值**真的不同**。
 *
 *   ② 编号规则对不上标记结构：原写 `.rep--technical h2::before`，
 *      而 demo 的小节是 h3 ⇒ 页面上一节都没编号，文档却照写"自动编号"。
 *      ⇒ 判据要覆盖两侧：该编号的**有**，不该编号的**没有**。
 *
 *   ③ 嘴上说不做分页 PDF，却可能有人偷偷往里加 @page。
 *      ⇒ 加反向判据：report.css **不许**出现 @page / break-after:page。
 *
 * 🔴 诚实边界（写进报告，不用绿色冒充真机保证）：
 *    CSS counter 的**具体数字**（"图 1" 里的 1）读不到 —— ::before 的生成
 *    文字既不在 DOM 里，也不在无障碍树里（实测 page.accessibility.snapshot()
 *    抓不到它）。所以这里能验证的是「规则命中 + 用对了哪一路计数器 +
 *    生成框真的占位像素」，**不是**数字本身 ⇒ 数字标为未验证项。
 */
(async () => {
  /* 🔴 判据第一版在这里假报了一次：直接拿原文匹配 `@page`，
        结果命中了**文件头注释**里那句"它需要 @page / 实物打样"。
        ⇒ 静态判据必须先剥注释再匹配（kit.stripComments 就是为此存在的）。 */
  const cssRaw = kit.stripComments(fs.readFileSync(DIR + '/report.css', 'utf8'));

  const r = await kit.check({
    name: 'report',
    url: 'http://127.0.0.1:8000/04-recipes/report/demo.html',
    dir: DIR,
    primary: '.rep',
    viewport: 'desktop',
    skipFocusRing: true,
    note: '页面级版式容器（recipe），不是可聚焦控件',
    interactive: '.rep a[href], .rep button',
    skipHitArea: true,
    hitAreaNote: '正文容器内的链接在文字流中，靠行高与间距保证（不强制 44×44）',

    extra: {
      /* ================================================================
         一 · 六个可变量真的分工了吗（① 的直接岗位）
         读 **getComputedStyle**，不读 CSS 文本 —— 写了不等于生效。
         ================================================================ */
      '① 六个可变量真的分档：三套 profile 的正文行长互不相同': async (p) => {
        await p.setViewport({ width: 1440, height: 900, isMobile: false,
                              hasTouch: false, deviceScaleFactor: 2 });
        await new Promise((r2) => setTimeout(r2, 250));
        const m = await p.evaluate(() => {
          const ratio = (id) => {
            const art = document.querySelector(id);
            const el = document.querySelector(id + ' .rep__body');
            if (!el || !art) return NaN;
            /* 🔴 必须换算成 **em** 再比，不能直接比 px：
               行长本来就是用 em 声明的，而各 profile 的正文字号不同
               （杂志/科研 18px、金融 14px）⇒ 34em 在金融版只有 476px。
               若只比 px，就算把 `--rep-measure: 30em` 这行删掉，
               金融版仍会因为"字号本身就小"而显得窄 ⇒ **判据变成聋子**
               （反向控制 RC-2 就是这样全绿的）。 */
            const mw = parseFloat(getComputedStyle(el).maxWidth);
            const fs = parseFloat(getComputedStyle(art).fontSize);
            return Math.round((mw / fs) * 10) / 10;
          };
          return { mag: ratio('#mag'), tech: ratio('#tech'), fin: ratio('#fin') };
        });
        const ok = m.mag > m.tech && m.tech > m.fin;
        return { ok,
                 note: '行长 杂志 ' + m.mag + 'em > 科研 ' + m.tech +
                       'em > 金融 ' + m.fin + 'em（按各版自身字号换算）' +
                       (ok ? '' : ' 🔴 行长没拉开档次，某个 profile 的 --rep-measure 没覆写') };
      },

      '① 文章标题字号真的跟着 profile 走（不被 .rep h2/h3 抢走）': async (p) => {
        const t = await p.evaluate(() => {
          const px = (sel) => {
            const el = document.querySelector(sel);
            return el ? parseFloat(getComputedStyle(el).fontSize) : NaN;
          };
          return {
            mag: px('#mag .rep__title'),
            tech: px('#tech .rep__title'),
            fin: px('#fin .rep__title'),
            magH3: px('#mag h3'),
            finH3: px('#fin h3')
          };
        });
        /* 三条都必须成立：
             · 金融版标题 < 杂志版（变量真的分了档）
             · 每套的标题 > 自己的小节标题（层级没被压平）
             · 杂志版标题 ≠ 小节标题字号（证明 .rep h3 没赢过 .rep__title） */
        const distinctF = t.fin < t.mag;
        const hierarchyF = t.mag > t.magH3 && t.fin > t.finH3;
        return { ok: distinctF && hierarchyF,
                 note: '标题 杂志 ' + t.mag + ' / 科研 ' + t.tech + ' / 金融 ' + t.fin +
                       ' · 小节 h3 ' + t.magH3 + '（金融 ' + t.finH3 + '）' +
                       (distinctF ? '' : ' 🔴 标题没随 profile 变，级联被 h2/h3 规则抢走') +
                       (hierarchyF ? '' : ' 🔴 标题与小节同字号，层级被压平') };
      },

      '① 金融版正文字号小一档，科研版行距最松': async (p) => {
        const v = await p.evaluate(() => {
          const probe = (id) => {
            const el = document.querySelector(id);
            if (!el) return null;
            const cs = getComputedStyle(el);
            return { fs: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight) };
          };
          return { mag: probe('#mag'), tech: probe('#tech'), fin: probe('#fin') };
        });
        const finSmaller = v.fin.fs < v.mag.fs;
        const techLoosest = (v.tech.lh / v.tech.fs) > (v.mag.lh / v.mag.fs);
        return { ok: finSmaller && techLoosest,
                 note: '正文字号 ' + v.mag.fs + ' / ' + v.tech.fs + ' / ' + v.fin.fs +
                       ' · 行距比 ' + (v.mag.lh / v.mag.fs).toFixed(2) + ' / ' +
                       (v.tech.lh / v.tech.fs).toFixed(2) + ' / ' +
                       (v.fin.lh / v.fin.fs).toFixed(2) +
                       (finSmaller ? '' : ' 🔴 金融版没降字号') +
                       (techLoosest ? '' : ' 🔴 科研版行距不是最松') };
      },

      /* ================================================================
         二 · 62rem 断点与窄屏（ded 栅格）
         ================================================================ */
      '② 宽屏（1440）正文与边注并排': async (p) => {
        await p.setViewport({ width: 1440, height: 900, isMobile: false,
                              hasTouch: false, deviceScaleFactor: 2 });
        await new Promise((r2) => setTimeout(r2, 250));
        const g = await p.evaluate(() => {
          const el = document.querySelector('#tech .rep__grid');
          const cs = getComputedStyle(el);
          return { tracks: cs.gridTemplateColumns.trim().split(/\s+/).length,
                   cols: cs.gridTemplateColumns };
        });
        return { ok: g.tracks === 2,
                 note: '列数 ' + g.tracks + '（' + g.cols + '）' };
      },

      /* 🔴 这条判据修过两轮，两个坑都值得留下来：
         坑 ①：`newPage({viewport})` 在本机不生效（窗口实际停在 800px），
                而 @media (min-width:62rem) 只在真宽屏下才开两列；
                不显式 setViewport ⇒ 一直在单列状态里量 ⇒ 判据变聋子。
         坑 ②：`1fr` 与 `minmax(0,1fr)` 的差异**不在栅格容器的宽度上**
                （容器宽度由父级给定，恒定），而在 **grid 项（列）的宽度**上。
                实测同一页：1fr ⇒ 正文列 184→598px（被内容顶宽 414px）；
                            minmax(0,1fr) ⇒ 184→184px。
                ⇒ 量容器永远量不出区别，**必须量列**。 */
      '② minmax(0,1fr) 真在起作用：塞进超宽内容后正文列不被顶宽': async (p) => {
        await p.setViewport({ width: 1440, height: 900, isMobile: false,
                              hasTouch: false, deviceScaleFactor: 2 });
        await new Promise((r2) => setTimeout(r2, 250));
        const g = await p.evaluate(() => {
          const grid = document.querySelector('#tech .rep__grid');
          const col = grid.querySelector('.rep__body');
          /* 前置：确认此刻真的是**两列**（否则这条测的是单列，等于没测） */
          const tracks = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length;
          const before = col.getBoundingClientRect().width;
          const probe = document.createElement('div');
          probe.style.cssText = 'width:2000px;height:1px';
          col.appendChild(probe);
          const after = col.getBoundingClientRect().width;
          probe.remove();
          return { tracks,
                   before: Math.round(before), after: Math.round(after) };
        });
        const grew = g.after - g.before;
        return { ok: g.tracks === 2 && grew <= 1,
                 note: g.tracks === 2
                   ? '两列下注入 2000px 宽内容：正文列 ' + g.before + '→' + g.after +
                     'px（涨 ' + grew + '）' +
                     (grew <= 1 ? '' : ' 🔴 被内容顶宽 ⇒ grid 列退化成 1fr，minmax(0,…) 丢了')
                   : '🔴 此刻不是两列（列数 ' + g.tracks + '），判据没测到目标状态' };
      },

      /* 🔴 这条是给「边注把正文挤成一根棍」上的锁。
         事故还原：库的标准页宽 --measure-page = 832px，body + 边注共享它；
         当时边注取了 --measure-aside(32em=576px) ⇒ 正文列只剩 **220px ≈ 12em**
         （目标 34em），而**页面看起来完全正常**，没有任何报错。
         ⇒ 必须锁"正文列的可用宽度下限"，而不是只看"是不是两列"。 */
      '② 宽屏下正文列保有可读宽度（不被边注挤成一根棍）': async (p) => {
        await p.setViewport({ width: 1440, height: 900, isMobile: false,
                              hasTouch: false, deviceScaleFactor: 2 });
        await new Promise((r2) => setTimeout(r2, 250));
        const c = await p.evaluate(() => {
          const out = {};
          ['#mag', '#tech', '#fin'].forEach((id) => {
            const art = document.querySelector(id);
            const body = art.querySelector('.rep__body');
            const w = body.getBoundingClientRect().width;
            const fs = parseFloat(getComputedStyle(art).fontSize);
            out[id] = { px: Math.round(w), em: Math.round((w / fs) * 10) / 10 };
          });
          return out;
        });
        /* 下限 22em：低于这个数中文一行不到 22 字，正式报告不可接受 */
        const bad = ['#mag', '#tech', '#fin'].filter((id) => c[id].em < 22);
        return { ok: bad.length === 0,
                 note: ['#mag', '#tech', '#fin']
                   .map((id) => id + ' ' + c[id].px + 'px/' + c[id].em + 'em')
                   .join(' · ') +
                   (bad.length ? ' 🔴 ' + bad.join(' ') + ' 窄于 22em：边注把正文挤掉了' : '') };
      },

      '② 窄屏（393）边注落到正文下方，且整页无横向溢出': async (p) => {
        await p.setViewport({ width: 393, height: 852, isMobile: true,
                              hasTouch: true, deviceScaleFactor: 2 });
        await new Promise((r2) => setTimeout(r2, 300));
        const o = await p.evaluate(() => {
          const el = document.querySelector('#tech .rep__grid');
          const tracks = getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length;
          const ov = document.documentElement.scrollWidth - window.innerWidth;
          /* 追究「祖先里没有横向滚动容器」的越界元素：
             宽表格在 .table 里天然可以横滚，那不算缺陷。 */
          const inScroller = (n) => {
            while (n && n !== document.body) {
              const ox = getComputedStyle(n).overflowX;
              if (ox === 'auto' || ox === 'scroll') return true;
              n = n.parentElement;
            }
            return false;
          };
          const wide = [...document.querySelectorAll('.rep *')]
            .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !inScroller(e))
            .slice(0, 3)
            .map((e) => e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]);
          return { tracks, ov, wide };
        });
        return { ok: o.tracks === 1 && o.ov <= 1 && o.wide.length === 0,
                 note: '列数 ' + o.tracks + ' · 整页溢出 ' + o.ov + 'px · 容器外越界 ' +
                       o.wide.length + (o.wide.length ? '（' + o.wide.join(' / ') + '）' : '') };
      },

      /* ================================================================
         三 · 编号：该编号的有、不该编号的没有
         ⚠️ 读的是 **::before 的计算值**：`content` 里带着 `counter(rep-x)`
            说明「这条编号规则真的匹配上了这个元素」；`none` 说明没匹配。
            （修复前就是这里的四个值全为 none —— 这条判据有牙。）
         ================================================================ */
      '③ technical：正文小节编号，文章标题与边注标题不编号': async (p) => {
        await p.setViewport({ width: 1440, height: 900, isMobile: false,
                              hasTouch: false, deviceScaleFactor: 2 });
        await new Promise((r2) => setTimeout(r2, 250));
        const c = await p.evaluate(() => {
          const before = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return 'MISSING';
            return getComputedStyle(el, '::before').content;
          };
          const secs = [...document.querySelectorAll('#tech .rep__sec > h3')];
          const withNum = secs.filter((h) => /counter\(/.test(getComputedStyle(h, '::before').content));
          return {
            secTotal: secs.length, secNumbered: withNum.length,
            title: before('#tech > header .rep__title'),
            asideH: before('#tech .rep__aside > h3'),
            sourcesH: before('#tech .rep__sources > h3')
          };
        });
        const ok = c.secTotal >= 2 && c.secNumbered === c.secTotal &&
                   c.title === 'none' && c.asideH === 'none' && c.sourcesH === 'none';
        return { ok,
                 note: '正文小节 ' + c.secNumbered + '/' + c.secTotal + ' 个编号' +
                       ' · 文章标题 ' + c.title +
                       ' · 边注标题 ' + c.asideH +
                       ' · 来源标题 ' + c.sourcesH +
                       (ok ? '' : ' 🔴 编号范围不对（多编或漏编）') };
      },

      '③ 图与表走两路独立计数（rep-fig / rep-tab），不是同一路': async (p) => {
        const c = await p.evaluate(() => {
          const fig = document.querySelector('#tech .rep__cap:not(.rep__cap--table)');
          const tab = document.querySelector('#tech .rep__cap--table');
          if (!fig || !tab) return { missing: true };
          const bf = getComputedStyle(fig, '::before');
          const bt = getComputedStyle(tab, '::before');
          return {
            figContent: bf.content, figInc: bf.counterIncrement,
            tabContent: bt.content, tabInc: bt.counterIncrement
          };
        });
        if (c.missing) return { ok: false, note: '🔴 缺少 .rep__cap 或 .rep__cap--table 实例' };
        /* ⚠️ `counterIncrement` 的计算值是 "rep-fig 1"（**带增量 1**），
              不是 "rep-fig" ⇒ 判等会假红。判「用的是哪一路计数器」要前缀匹配。 */
        const pick = (s) => String(s || '').trim().split(/\s+/)[0];
        const ok = /counter\(rep-fig\)/.test(c.figContent) && pick(c.figInc) === 'rep-fig' &&
                   /counter\(rep-tab\)/.test(c.tabContent) && pick(c.tabInc) === 'rep-tab';
        return { ok,
                 note: '图：' + c.figInc + ' · 表：' + c.tabInc +
                       '（两路必须不同，否则「图 3」与「表 3」会互相吃掉计数）' };
      },

      '③ 编号由 profile 决定，不是由标记决定（金融版同标记不出编号）': async (p) => {
        const c = await p.evaluate(() => {
          const tab = document.querySelector('#fin .rep__cap--table');
          const techTab = document.querySelector('#tech .rep__cap--table');
          if (!tab || !techTab) return { missing: true };
          return { fin: getComputedStyle(tab, '::before').content,
                   tech: getComputedStyle(techTab, '::before').content };
        });
        if (c.missing) return { ok: false, note: '🔴 两个 profile 都得有一张带说明的表' };
        /* 同一个 class，在 technical 有编号、在 finance 没有 ⇒ 是 profile 说了算 */
        return { ok: /counter\(/.test(c.tech) && c.fin === 'none',
                 note: 'technical = ' + (c.tech.indexOf('counter') >= 0 ? '有编号' : '🔴 无编号') +
                       ' · finance = ' + (c.fin === 'none' ? '无编号（正确）' : '🔴 也编号了') };
      },

      '③ 生成框真的占了像素（不是 content  resolved 成空）': async (p) => {
        const w = await p.evaluate(() => {
          /* ::before 的文字**量不到** getBoundingClientRect ⇒ 用「宽度差」取证：
             临时把 content 关掉，量元素窄了多少 —— 差值为 0 说明编号没渲染出来。 */
          const el = document.querySelector('#tech .rep__cap--table');
          const natural = getComputedStyle(el).display;
          const probe = document.createElement('style');
          probe.textContent = '#tech .rep__cap--table::before { content: none !important; }';
          const probeOff = document.createElement('style');
          probeOff.textContent = '.rep__cap { display: inline-block !important; }';
          const widthOf = () => el.getBoundingClientRect().width;
          document.head.appendChild(probeOff);
          const withNum = widthOf();
          document.head.appendChild(probe);
          const without = widthOf();
          probe.remove(); probeOff.remove();
          return { withNum: Math.round(withNum), without: Math.round(without), natural };
        });
        const delta = w.withNum - w.without;
        return { ok: delta > 4,
                 note: '带编号宽 ' + w.withNum + 'px · 关掉编号后 ' + w.without +
                       'px · 差 ' + delta + 'px（>4 说明「表 N ·」真渲染出来了）' };
      },

      /* ================================================================
         四 · 每套 profile 的「必需件」—— 取舍表里写了，页面就得有
         ================================================================ */
      '④ 金融版：关键数字条 + 风险披露都到位': async (p) => {
        const c = await p.evaluate(() => {
          const kl = document.querySelector('#fin .rep__keyline');
          const risk = document.querySelector('#fin .rep__risk');
          const cells = kl ? kl.querySelectorAll('dt').length : 0;
          const ddTab = kl ? [...kl.querySelectorAll('dd')]
            .every((d) => getComputedStyle(d).fontVariantNumeric.indexOf('tabular') >= 0) : false;
          return { keyline: !!kl, cells, ddTab,
                   risk: !!risk,
                   riskLen: risk ? (risk.textContent || '').trim().length : 0 };
        });
        return { ok: c.keyline && c.cells >= 2 && c.ddTab && c.risk && c.riskLen >= 20,
                 note: '关键数字 ' + c.cells + ' 项 · 数字表格对齐 ' + c.ddTab +
                       ' · 风险披露 ' + c.riskLen + ' 字' };
      },

      '④ 杂志版：有引语块与出血宽图，且宽图在正文流里（不在边注里挤）': async (p) => {
        await p.setViewport({ width: 1440, height: 900, isMobile: false,
                              hasTouch: false, deviceScaleFactor: 2 });
        await new Promise((r2) => setTimeout(r2, 250));
        const c = await p.evaluate(() => {
          const pull = document.querySelector('#mag .rep__pull');
          const wide = document.querySelector('#mag .rep__fig--wide');
          const svg = document.querySelector('#magChart svg');
          return { pull: !!pull, wide: !!wide,
                   pullLen: pull ? (pull.textContent || '').trim().length : 0,
                   wideInAside: !!wide && !!wide.closest('.rep__aside'),
                   svgW: svg ? Math.round(svg.getBoundingClientRect().width) : 0 };
        });
        /* 出血图必须在正文流：塞进 14em 的边注里会被压成缩略图（实测只剩 220px） */
        return { ok: c.pull && c.pullLen >= 10 && c.wide && !c.wideInAside && c.svgW >= 360,
                 note: '引语块 ' + c.pullLen + ' 字 · 宽图在边注里 ' + c.wideInAside +
                       '（应为 false）· 图上渲染宽 ' + c.svgW + 'px' };
      },

      '④ 科研版：来源脚注编号列出，且不止一条': async (p) => {
        const c = await p.evaluate(() => {
          const src = document.querySelector('#tech .rep__sources');
          const items = src ? src.querySelectorAll('.rep__source > li').length : 0;
          return { items };
        });
        return { ok: c.items >= 2, note: '来源条数 ' + c.items };
      },

      /* ================================================================
         五 · 反向判据：本轮明确不做的事，**不许**偷偷做了一半
         ================================================================ */
      '⑤ 反向：没有偷偷做分页 — report.css 不得出现 @page / break-after': async () => {
        const bad = [];
        if (/@page\b/.test(cssRaw)) bad.push('@page');
        if (/break-after\s*:\s*(page|left|right)/.test(cssRaw)) bad.push('break-after:page');
        if (/break-before\s*:\s*(page|left|right)/.test(cssRaw)) bad.push('break-before:page');
        return { ok: bad.length === 0,
                 note: bad.length ? '🔴 出现 ' + bad.join(' / ') + ' ⇒ 本轮声明不做分页 PDF'
                                  : '无 @page / 无跨页断行声明（与 README 的「明确不做」一致）' };
      },

      '⑤ @media print 只做「不更糟」，且不得声称打印=分页': async () => {
        const i = cssRaw.indexOf('@media print');
        const hasBlock = i >= 0;
        let inner = '';
        if (hasBlock) {
          let depth = 0, end = -1;
          for (let k = cssRaw.indexOf('{', i); k < cssRaw.length; k++) {
            if (cssRaw[k] === '{') depth++;
            else if (cssRaw[k] === '}') { depth--; if (!depth) { end = k; break; } }
          }
          inner = cssRaw.slice(cssRaw.indexOf('{', i) + 1, end);
        }
        const ok = hasBlock && /.rep__fig[\s\S]*break-inside\s*:\s*avoid/.test(inner);
        return { ok,
                 note: hasBlock ? '有 print 块，图表/表格 break-inside:avoid' :
                                  '🔴 连最小打印保障都没有' };
      },

      /* 文档自述与实际是否一致：取舍表里的三行不能只是文案 */
      '⑥ 取舍表里的数字与实现一致（表 A 的三行不是文案）': async (p) => {
        await p.setViewport({ width: 1440, height: 900, isMobile: false,
                              hasTouch: false, deviceScaleFactor: 2 });
        const c = await p.evaluate(() => {
          const rows = [...document.querySelectorAll('table tr')].map((tr) => {
            const cells = [...tr.children].map((td) => (td.textContent || '').trim());
            return cells;
          });
          return rows;
        });
        const flat = JSON.stringify(c);
        const hasThree = ['杂志编辑', '科研技术', '金融研究'].every((s) => flat.indexOf(s) >= 0);
        const hasGiveUp = flat.indexOf('放弃了') >= 0;
        return { ok: hasThree && hasGiveUp,
                 note: hasThree ? '三套 profile 都在取舍表里，且每条写了「放弃了什么」'
                                : '🔴 取舍表不完整' };
      },
    },
  });
  process.exit(kit.report(r));
})();
