const kit = require('./contract-kit.js');
const path = require('path');
const fs = require('fs');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');
const DIR = REPO + '/04-recipes/analysis-report';

/**
 * analysis-report-check.js — 组合型研究报告 recipe 契约（FL-NEXT-01 工作包 C + VIZ-03）
 *
 * ============================================================================
 * 这个 recipe 的**失败模式**不是"某个控件坏了"，而是**版式塌了但没报错**：
 *   · 窄屏时并排没退回单栏 ⇒ 正文被压成 200px 宽、读不了
 *   · grid 列用了 1fr 而不是 minmax(0,1fr) ⇒ 宽表格把整页撑出横向滚动
 *   · 图/表只有视觉、没有文字 ⇒ 读屏与打印时信息丢失
 * ⇒ 判据全部量**几何与语义**，不读 CSS 文本（读文本会假绿：写了 ≠ 生效）。
 */
(async () => {
  const r = await kit.check({
    name: 'analysis-report',
    url: 'http://127.0.0.1:8000/04-recipes/analysis-report/demo.html',
    dir: DIR,
    primary: '.report',
    skipFocusRing: true,
    note: '页面级版式容器（recipe），不是可聚焦控件',
    interactive: '.report a[href], .report button',
    skipHitArea: true,
    hitAreaNote: '正文行内链接在文字流中，靠行高与间距保证（不强制 44×44）',

    extra: {
      /* 窄屏：并排必须退回上下堆叠 */
      '窄屏（393）退回单栏：辅助栏落在正文下方': async (p) => {
        await p.setViewport({ width: 393, height: 852, isMobile: true,
                              hasTouch: true, deviceScaleFactor: 2 });
        await new Promise((r2) => setTimeout(r2, 300));
        const r = await p.evaluate(() => {
          const m = document.querySelector('.report__main');
          const a = document.querySelector('.report__aside');
          if (!m || !a) return { ok: false, note: '🔴 缺 .report__main / .report__aside' };
          const rm = m.getBoundingClientRect(), ra = a.getBoundingClientRect();
          return { ok: ra.top >= rm.bottom - 2,
                   note: '正文底 ' + Math.round(rm.bottom) +
                         ' · 辅助栏顶 ' + Math.round(ra.top) +
                         '（正文宽 ' + Math.round(rm.width) + '）' };
        });
        return r;
      },

      /* 宽屏：正文与辅助栏并排（不是上下）*/
      '宽屏（1280）正文与辅助栏并排': async (p) => {
        await p.setViewport({ width: 1280, height: 900, isMobile: false,
                              hasTouch: false, deviceScaleFactor: 2 });
        await new Promise((r2) => setTimeout(r2, 300));
        const r = await p.evaluate(() => {
          const m = document.querySelector('.report__main');
          const a = document.querySelector('.report__aside');
          if (!m || !a) return { ok: false, note: '🔴 缺 .report__main / .report__aside' };
          const rm = m.getBoundingClientRect(), ra = a.getBoundingClientRect();
          const sideBySide = ra.left >= rm.right - 2;
          const ov = document.documentElement.scrollWidth - window.innerWidth;
          return { ok: sideBySide && ov <= 1,
                   note: '正文右缘 ' + Math.round(rm.right) +
                         ' · 辅助栏左缘 ' + Math.round(ra.left) +
                         ' · 横向溢出 ' + ov + 'px' };
        });
        return r;
      },

      /* ③ 宽屏下辅助栏 sticky **且** align-self:start
         ⚠️ 为什么必须查计算值而不是查 CSS 文本：
            `position: sticky` 写在 grid 项上时，grid 项默认 `align-self: stretch`
            ⇒ 它的高度被拉满整行 ⇒ **没有可滚动的余量** ⇒ sticky 静默不动。
            文本里写了 sticky 也算"写了"，但读者看到的是"它没跟着滚"。
            ⇒ 判据取 `getComputedStyle(.report__aside)` 的 position 与 alignSelf。 */
      '宽屏下辅助栏 sticky + align-self:start（不是只写在 CSS 里）': async (p) => {
        await p.setViewport({ width: 1280, height: 900, isMobile: false,
                              hasTouch: false, deviceScaleFactor: 2 });
        await new Promise((r2) => setTimeout(r2, 300));
        const r = await p.evaluate(() => {
          const a = document.querySelector('.report__aside');
          if (!a) return { ok: false, note: '🔴 缺 .report__aside' };
          const cs = getComputedStyle(a);
          return { ok: cs.position === 'sticky' && cs.alignSelf === 'start',
                   note: 'position=' + cs.position + ' · align-self=' +
                         cs.alignSelf +
                         (cs.position === 'sticky' && cs.alignSelf !== 'start'
                            ? ' 🔴 stretch 会让 sticky 静默失效' : '') };
        });
        return r;
      },

      /* 窄屏无横向溢出：宽表格必须在**容器内**滚动，不把整页撑宽
         ⚠️ 判据修正（第一版误报）：
            原判据 = 「.report 里任何元素的右缘都不得越过视口」。
            但宽表格**本来就该**比 393px 宽 —— 它外面那层 `.table` 带
            `overflow-x:auto`，读者在容器里横向滚是**正确的做法**。
            ⇒ 原判据会把正确实现报成越界（table / caption / thead 全中招）。
            ⇒ 正解分两条量：
                ① 页面级：scrollWidth ≤ innerWidth（整页不能被撑宽）
                ② 元素级：只追究**祖先里没有横向滚动容器**的越界元素
         */
      '窄屏无横向溢出（宽表在容器内滚动）': async (p) => {
        await p.setViewport({ width: 393, height: 852, isMobile: true,
                              hasTouch: true, deviceScaleFactor: 2 });
        await new Promise((r2) => setTimeout(r2, 300));
        const r = await p.evaluate(() => {
          const inScroller = (el) => {
            let n = el.parentElement;
            while (n && n !== document.body) {
              const ox = getComputedStyle(n).overflowX;
              if (ox === 'auto' || ox === 'scroll') return true;
              n = n.parentElement;
            }
            return false;
          };
          const ov = document.documentElement.scrollWidth - window.innerWidth;
          const wide = [...document.querySelectorAll('.report *')]
            .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 &&
                           !inScroller(e))
            .slice(0, 3)
            .map((e) => e.tagName.toLowerCase() +
                        (e.className ? '.' + String(e.className).split(' ')[0] : ''));
          const boxes = [...document.querySelectorAll('.report .table')];
          const noScroll = boxes.filter((t) => {
            const ox = getComputedStyle(t).overflowX;
            return ox !== 'auto' && ox !== 'scroll';
          }).length;
          return { ok: ov <= 1 && wide.length === 0 && noScroll === 0,
                   note: '整页溢出 ' + ov + 'px · 容器外越界 ' + wide.length +
                         ' 个' + (wide.length ? '（' + wide.join(' / ') + '）' : '') +
                         ' · 表格容器 ' + boxes.length + ' 个，' +
                         '没开横向滚动 ' + noScroll + ' 个' };
        });
        return r;
      },

      /* 关键发现区：结论不能埋在正文里 */
      '有独立的关键发现区': async (p) => {
        const r = await p.evaluate(() => {
          const kf = document.querySelector('.report .kf');
          if (!kf) return { ok: false, note: '🔴 没有 .kf 关键发现区' };
          const items = kf.querySelectorAll('li, p');
          const txt = (kf.textContent || '').trim();
          return { ok: items.length >= 2 && txt.length > 20,
                   note: items.length + ' 条 · ' + txt.length + ' 字' };
        });
        return r;
      },

      /* 表格语义：表头用 th[scope]（与 table 组件同一条规矩）*/
      '数据表表头用 th[scope]': async (p) => {
        const r = await p.evaluate(() => {
          const ths = [...document.querySelectorAll('.report table th')];
          if (!ths.length) return { ok: false, note: '🔴 表头没用 th' };
          const noScope = ths.filter((t) => !t.getAttribute('scope'));
          return { ok: noScope.length === 0,
                   note: ths.length + ' 个 th，' + noScope.length + ' 个缺 scope' };
        });
        return r;
      },

      /* 节奏件：正文不能是一堵连续的段落墙 */
      '有节奏件（代码块或引用块）': async (p) => {
        const r = await p.evaluate(() => {
          const code = document.querySelectorAll('.report .report__code').length;
          const quote = document.querySelectorAll('.report .report__quote').length;
          return { ok: code + quote >= 1,
                   note: '代码块 ' + code + ' 个 · 引用块 ' + quote + ' 个' };
        });
        return r;
      },

      /* 图不能自解释：有图注，且图形本身有文本等价信息 */
      '图有图注与文本等价信息': async (p) => {
        const r = await p.evaluate(() => {
          const figs = [...document.querySelectorAll('.report figure')];
          if (!figs.length) return { ok: false, note: '🔴 没有 figure' };
          const noCap = figs.filter((f) => !f.querySelector('figcaption'));
          const svg = [...document.querySelectorAll('.report figure svg')];
          const noLabel = svg.filter((s) => !s.getAttribute('aria-label'));
          return { ok: noCap.length === 0 && noLabel.length === 0,
                   note: figs.length + ' 张图 · 缺图注 ' + noCap.length +
                         ' · SVG 缺 aria-label ' + noLabel.length };
        });
        return r;
      },

      /* 关键发现区必须在**第一个数据表之前**（结论不能埋在表格后面）*/
      '关键发现区位于正文表格之前': async (p) => {
        const r = await p.evaluate(() => {
          const kf = document.querySelector('.report .kf');
          const tbl = document.querySelector('.report table');
          if (!kf || !tbl) return { ok: false, note: '🔴 缺 .kf 或 table' };
          const before = !!(kf.compareDocumentPosition(tbl) &
                            Node.DOCUMENT_POSITION_FOLLOWING);
          return { ok: before,
                   note: before ? '.kf 在第一个 table 之前'
                                : '🔴 .kf 排在表格之后' };
        });
        return r;
      },

      /* 辅助栏必须复用既有 card，不新造一套卡片样式 */
      '辅助栏复用既有 card 组件': async (p) => {
        const r = await p.evaluate(() => {
          const n = document.querySelectorAll('.report__aside .card').length;
          return { ok: n >= 1,
                   note: '辅助栏里 ' + n + ' 个 .card（复用 02-primitives/card）' };
        });
        return r;
      },

      /* 打印：正文不能被并排栏挤掉（打印是报告的真实用途之一）
         ⚠️ 反向控制：把 print 块里的 `1fr` 改回 `minmax(0, 1fr) 15rem`，
            这条必须变红 —— 第一版正则被 `minmax(0,1fr)` 子串蒙过去了。 */
      '打印样式把版式退回单栏': async () => {
        const raw = kit.stripComments(
          fs.readFileSync(DIR + '/analysis-report.css', 'utf8'));
        /* ⚠️ 判据修正（第一版假绿）：
           原判据 = 「print 块里出现 `1fr` 或 `minmax(0,1fr)`」。
           但并排写法 `minmax(0, 1fr) 15rem` **也含有** `minmax(0, 1fr)`
           ⇒ 把"打印仍是两栏"判成了单栏。
           ⇒ 正解：**数轨道数** —— 去掉函数括号后再按空白切分，
              1 个 token = 单栏，2 个 = 并排。 */
        const i = raw.search(/@media\s+print/);
        if (i < 0) return { ok: false, note: '🔴 没有 @media print 块' };
        let depth = 0, end = -1;
        for (let k = raw.indexOf('{', i); k < raw.length; k++) {
          if (raw[k] === '{') depth++;
          else if (raw[k] === '}') { depth--; if (!depth) { end = k; break; } }
        }
        const body = raw.slice(raw.indexOf('{', i) + 1, end);
        const m = body.match(
          /\.report__body\s*\{[^}]*grid-template-columns\s*:\s*([^;}]+)/);
        let tracks = 0;
        if (m) {
          tracks = m[1].replace(/\([^)]*\)/g, '')
                       .split(/\s+/).filter(Boolean).length;
        }
        return { ok: tracks === 1,
                 note: m ? 'print 里列数 ' + tracks +
                         (tracks === 1 ? '（已退回单栏）'
                                       : ' 🔴 打印时仍是并排，纸面上会挤爆')
                       : '🔴 print 块里没有重设 .report__body 的列' };
      },
    },
  });
  process.exit(kit.report(r));
})();
