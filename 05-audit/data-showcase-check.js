const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * data-showcase-check.js — 数据展示对照页契约（VIZ-03）
 *
 * ============================================================================
 * 这一页的作用是**划清四类数据表达的边界**（BI 迷你趋势 / 科学坐标图 /
 * 学术出版表格 / 统计结果表格）。它的失败模式是**拼装出来的语义不对**：
 *   · 表格没有 caption ⇒ 脱离上下文就不知道量的是什么
 *   · 表头不用 th[scope] ⇒ 读屏念不出"这一列是什么"
 *   · 统计表只给估计值不给 SE/CI/p ⇒ 读者无法判断可靠性
 *   · 示例数据没标注 ⇒ 被当成真实测量值引用
 *
 * ⚠️ 这一页**没有自己的 CSS** —— 全部复用既有组件与令牌，
 *    所以这里不查"样式写得对不对"，只查拼装结果与语义。
 */
(async () => {
  const r = await kit.check({
    name: 'data-showcase',
    url: 'http://127.0.0.1:8000/04-recipes/data-showcase/demo.html',
    dir: REPO + '/04-recipes/data-showcase',
    primary: 'main.wrap',
    skipFocusRing: true,
    note: '页面级对照页（recipe），不是可聚焦控件',
    interactive: 'main.wrap a[href], main.wrap button',
    skipHitArea: true,
    hitAreaNote: '正文行内链接在文字流中，靠行高与间距保证（不强制 44×44）',

    extra: {
      /* 四类表达都在（少一类就失去对照意义）*/
      '四类数据表达都在页面上': async (p) => {
        const r = await p.evaluate(() => ({
          spark: document.querySelectorAll('.sparkline svg').length,
          plot: document.querySelectorAll('.splot').length,
          academic: document.querySelectorAll('.table--academic').length,
          stats: document.querySelectorAll('.table--stats').length,
        }));
        return { ok: r.spark >= 1 && r.plot >= 1 && r.academic >= 1 && r.stats >= 1,
                 note: '迷你趋势 ' + r.spark + ' · 坐标图 ' + r.plot +
                       ' · 学术表 ' + r.academic + ' · 统计表 ' + r.stats };
      },

      /* 学术表：多级表头 + 每个表都有 caption */
      '学术表有多级表头（colgroup）且每个表都有 caption': async (p) => {
        const r = await p.evaluate(() => {
          const tables = [...document.querySelectorAll('table')];
          const noCap = tables.filter((t) => !t.querySelector('caption'));
          const groups = document.querySelectorAll(
            '.table--academic th[scope="colgroup"]').length;
          return { ok: tables.length > 0 && noCap.length === 0 && groups >= 1,
                   note: tables.length + ' 个表 · 缺 caption ' + noCap.length +
                         ' · 多级表头 ' + groups + ' 个' };
        });
        return r;
      },

      /* 表头语义：每个 th 都有 scope（与 table 组件同一条规矩）*/
      '所有表头用 th[scope]': async (p) => {
        const r = await p.evaluate(() => {
          const ths = [...document.querySelectorAll('table th')];
          const noScope = ths.filter((t) => !t.getAttribute('scope'));
          return { ok: ths.length > 0 && noScope.length === 0,
                   note: ths.length + ' 个 th，' + noScope.length + ' 个缺 scope' };
        });
        return r;
      },

      /* 统计表：估计值之外必须给不确定性（SE / CI）与 p 值 */
      '统计结果表给出 SE / CI / p（不只给估计值）': async (p) => {
        const r = await p.evaluate(() => {
          const t = document.querySelector('.table--stats');
          if (!t) return { ok: false, note: '🔴 没有 .table--stats' };
          const se = t.querySelectorAll('.stat__se').length;
          const ci = t.querySelectorAll('.stat__ci').length;
          const pv = t.querySelectorAll('.stat__p').length;
          const rows = t.querySelectorAll('tbody tr').length;
          return { ok: se >= rows && ci >= rows && pv >= rows,
                   note: rows + ' 行 · SE ' + se + ' · CI ' + ci + ' · p ' + pv };
        });
        return r;
      },

      /* 示例数据必须标出来（否则会被当真引用）*/
      '示例数据有明确标注': async (p) => {
        const r = await p.evaluate(() => {
          const txt = document.body.textContent || '';
          const n = (txt.match(/示例/g) || []).length;
          return { ok: n >= 2,
                   note: '页面上「示例」出现 ' + n + ' 次' +
                         (n < 2 ? '（🔴 会被读者当成真实测量值）' : '') };
        });
        return r;
      },

      /* 宽屏也不横向溢出（宽表是拼装页最常见的塌法）*/
      '宽屏（1280）无横向溢出': async (p) => {
        await p.setViewport({ width: 1280, height: 900, isMobile: false,
                              hasTouch: false, deviceScaleFactor: 2 });
        await new Promise((r2) => setTimeout(r2, 300));
        const r = await p.evaluate(() => {
          const ov = document.documentElement.scrollWidth - window.innerWidth;
          const scrollers = [...document.querySelectorAll('.table')]
            .filter((t) => {
              const cs = getComputedStyle(t);
              return cs.overflowX === 'auto' || cs.overflowX === 'scroll';
            }).length;
          return { ok: ov <= 1,
                   note: '横向溢出 ' + ov + 'px · 表格自带横向滚动 ' +
                         scrollers + ' 个' };
        });
        return r;
      },
    },
  });
  process.exit(kit.report(r));
})();
