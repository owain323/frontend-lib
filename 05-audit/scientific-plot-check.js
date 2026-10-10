const kit = require('./contract-kit.js');
const path = require('path');
const fs = require('fs');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * scientific-plot-check.js — 二维科学绘图契约（VIZ-02 / 09-assets）
 *
 * ============================================================================
 * 为什么它**不能**复用 BI 图表的契约
 * ----------------------------------------------------------------------------
 *   BI 图表问的是"这个月比上个月好还是差"，科学绘图问的是
 *  "这些测量值落在哪、误差多大、有没有超出模型预测"。
 *   ⇒ 失败模式不同，判据就得不同。这里验的是**数据与坐标的诚实性**：
 *
 *   ① 坐标与单位显式（轴名 + 单位写在轴上，不猜）
 *   ② 缺失 ≠ 零（null 处断开，不跨缺失区连成假曲线）
 *   ③ 对数轴必须显式声明；domain ≤ 0 要**抛错**而不是静默退化
 *   ④ 不做表达式求值（没有 eval / new Function）
 *   ⑤ 文本等价信息（role="img" + aria-label）
 *   ⑥ 颜色走令牌（跟着主题走，不写死色值）
 *
 * ⚠️ 反向控制：把 splitByGaps 换成"跳过 null 直接连起来"，
 *    判据②必须变红；把 log 域的抛错删掉，判据③必须变红。
 *    否则这两条就是"写给自己看的注释"。
 */
(async () => {
  const r = await kit.check({
    name: 'scientific-plot',
    url: 'http://127.0.0.1:8000/09-assets/scientific-plot/demo.html',
    dir: REPO + '/09-assets/scientific-plot',
    primary: '.splot',
    skipFocusRing: true,
    note: 'SVG 图形输出，本身不可聚焦（不是交互控件）',
    skipHitArea: true,
    hitAreaNote: '纯输出图形，没有指针目标',

    extra: {
      /* ① 轴名必须显式（原则①）
         ⚠️ 判据修正（第一版误报）：
            原判据要求「每张图的轴上都要有单位」⇒ 把**本来就没有单位**的图
            （如"采样点 / 读数"这类无量纲序列）报成不合规。
            ⇒ 单位是"有就画出来"，不是"必须有"。
            ⇒ 拆成两条：① 每张图都必须有**轴名**；② **声明了单位**的轴，
               单位必须出现在轴标签上（这条自己造一张图验证，不依赖 demo）。 */
      '每张图都有轴名（轴标签非空）': async (p) => {
        const r = await p.evaluate(() => {
          const svgs = [...document.querySelectorAll('.splot')];
          if (!svgs.length) return { ok: false, note: '🔴 页面上没有 .splot' };
          const bad = svgs.filter((s) => {
            const ls = [...s.querySelectorAll('.splot__axis-label')]
              .map((x) => (x.textContent || '').trim()).filter(Boolean);
            return ls.length < 2;
          });
          return { ok: bad.length === 0,
                   note: svgs.length + ' 张图 · 轴名不全 ' + bad.length + ' 张' };
        });
        return r;
      },

      /* ①-b 声明了单位的轴，单位必须出现在轴标签上 */
      '声明了单位的轴，单位出现在轴标签上': async (p) => {
        const r = await p.evaluate(() => {
          const box = document.createElement('div');
          box.style.cssText = 'position:absolute;left:-9999px;top:0';
          document.body.appendChild(box);
          window.ScientificPlot.render(box, {
            width: 240, height: 160,
            x: { label: '时间', unit: 's', scale: 'linear', domain: [0, 2] },
            y: { label: '速度', unit: 'm·s⁻¹', scale: 'linear', domain: [0, 3] },
            series: [{ type: 'scatter', data: [[1, 1]] }],
          });
          const ls = [...box.querySelectorAll('.splot__axis-label')]
            .map((x) => x.textContent);
          box.remove();
          const hasS = ls.some((t) => t.indexOf('s') >= 0 && t.indexOf('时间') >= 0);
          const hasV = ls.some((t) => t.indexOf('m·s⁻¹') >= 0);
          return { ok: hasS && hasV,
                   note: '轴标签 ' + JSON.stringify(ls) };
        });
        return r;
      },

      /* ② 缺失 ≠ 零（原则②）—— 这条是全模块最重要的一条 */
      '缺失处断开：null 断开成两段，填 0 才连成一段': async (p) => {
        const r = await p.evaluate(() => {
          const box = document.createElement('div');
          box.style.cssText = 'position:absolute;left:-9999px;top:0';
          document.body.appendChild(box);
          const draw = (data) => {
            window.ScientificPlot.render(box, {
              width: 240, height: 160,
              x: { label: 'x', unit: 's', scale: 'linear', domain: [0, 4] },
              y: { label: 'y', unit: 'm', scale: 'linear', domain: [0, 6] },
              series: [{ type: 'line', data: data }],
            });
            const lines = [...box.querySelectorAll('.splot__line')];
            return { segs: lines.length,
                     nan: lines.some((l) => /NaN|Infinity/.test(
                                        l.getAttribute('points'))) };
          };
          const withNull = draw([[0, 1], [1, 2], [2, null], [3, 4], [4, 5]]);
          const withZero = draw([[0, 1], [1, 2], [2, 0], [3, 4], [4, 5]]);
          box.remove();
          return { ok: withNull.segs === 2 && withZero.segs === 1 &&
                       !withNull.nan && !withZero.nan,
                   note: 'null → ' + withNull.segs + ' 段（应 2）· ' +
                         '填 0 → ' + withZero.segs + ' 段（应 1）· ' +
                         (withNull.nan ? '🔴 含 NaN' : '无 NaN') };
        });
        return r;
      },

      /* ③ 对数轴：能画 + 非法域抛错（原则①的另一半）*/
      '对数轴可用，且 domain ≤ 0 直接抛错（不静默退化）': async (p) => {
        const r = await p.evaluate(() => {
          const box = document.createElement('div');
          box.style.cssText = 'position:absolute;left:-9999px;top:0';
          document.body.appendChild(box);
          const out = { okLog: false, threw: false, msg: '' };
          try {
            window.ScientificPlot.render(box, {
              width: 240, height: 160,
              x: { label: 'x', unit: 's', scale: 'linear', domain: [1, 100] },
              y: { label: 'y', unit: 'm', scale: 'log', domain: [1, 1000] },
              series: [{ type: 'scatter', data: [[10, 100]] }],
            });
            out.okLog = !!box.querySelector('.splot');
          } catch (e) { out.msg = String(e.message).slice(0, 40); }
          try {
            window.ScientificPlot.render(box, {
              width: 240, height: 160,
              x: { label: 'x', unit: 's', scale: 'linear', domain: [0, 1] },
              y: { label: 'y', unit: 'm', scale: 'log', domain: [0, 100] },
              series: [{ type: 'scatter', data: [[0.5, 10]] }],
            });
          } catch (e) {
            out.threw = /domain 必须 > 0/.test(String(e.message));
            out.msg = String(e.message).slice(0, 40);
          }
          box.remove();
          return { ok: out.okLog && out.threw,
                   note: (out.okLog ? 'log[1,1000] 画得出' : '🔴 log 轴画不出') +
                         ' · ' + (out.threw ? 'log[0,100] 抛错（' + out.msg + '）'
                                            : '🔴 非法 log 域没抛错') };
        });
        return r;
      },

      /* ④ 不做表达式求值 */
      '代码里没有 eval / new Function': async () => {
        const raw = kit.stripComments(
          fs.readFileSync(REPO + '/09-assets/scientific-plot/scientific-plot.js',
                          'utf8'));
        const bad = [];
        if (/(^|[^.\w])eval\s*\(/.test(raw)) bad.push('eval(');
        if (/new\s+Function\s*\(/.test(raw)) bad.push('new Function(');
        return { ok: bad.length === 0,
                 note: bad.length ? '🔴 出现 ' + bad.join('、')
                                  : '函数曲线走采样，不做字符串求值' };
      },

      /* ⑤ 文本等价信息（原则⑤）*/
      '每张图 role="img" 且 aria-label 非空': async (p) => {
        const r = await p.evaluate(() => {
          const svgs = [...document.querySelectorAll('.splot')];
          const bad = svgs.filter((s) => s.getAttribute('role') !== 'img' ||
                                         !s.getAttribute('aria-label'));
          return { ok: svgs.length > 0 && bad.length === 0,
                   note: svgs.length + ' 张图，' + bad.length +
                         ' 张缺文本等价信息' };
        });
        return r;
      },

      /* ⑥ 颜色走令牌：描边/填充不写死（跟着主题走）*/
      '描边与填充不写死色值（走令牌）': async () => {
        const raw = kit.stripComments(
          fs.readFileSync(REPO + '/09-assets/scientific-plot/scientific-plot.css',
                          'utf8'));
        const decls = raw.match(/(?:stroke|fill)\s*:\s*([^;}]+)/g) || [];
        const bad = decls.filter((d) => {
          const v = d.split(':')[1].trim();
          /* 允许：var(--*) / none / currentColor / transparent */
          return !/^var\(--/.test(v) &&
                 ['none', 'currentColor', 'transparent'].indexOf(v) < 0;
        });
        return { ok: decls.length > 0 && bad.length === 0,
                 note: decls.length + ' 处描边/填充，写死 ' + bad.length + ' 处' +
                       (bad.length ? '：' + bad.slice(0, 2).join(' | ') : '') };
      },
    },
  });
  process.exit(kit.report(r));
})();
