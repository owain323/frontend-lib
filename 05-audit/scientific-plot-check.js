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

      /* ⑦ 🔴 系列样式身份（VIZ-REPORT-01 · P0-2）
         -------------------------------------------------------
         修复前 `var colorIdx = 0` 从头到尾不自增 ⇒ 页面上所有系列都是 s0，
         三条材料一个色，完全没有区分。这条直接**读浏览器算出来的颜色**，
         而不是检查源码里有没有写 colorIdx。 */
      '⑦ 不同系列在浏览器里真的能区分（至少三组 · 每组一带一线）': async (p) => {
        const r = await p.evaluate(() => {
          const box = document.createElement('div');
          box.style.cssText = 'position:absolute;left:-9999px;top:0';
          document.body.appendChild(box);
          const mk = (base) => {
            const line = [], band = [];
            for (let i = 0; i <= 8; i++) {
              const x = i / 8, y = base + 0.15 * Math.sin(x * 3);
              line.push([x, y]);
              band.push([x, y - 0.04, y + 0.04]);
            }
            return { line, band };
          };
          const A = mk(0.2), B = mk(0.45), C = mk(0.7);
          window.ScientificPlot.render(box, {
            width: 480, height: 300,
            x: { label: '温度', unit: 'K', scale: 'linear', domain: [0, 1] },
            y: { label: '响应', unit: 'a.u.', scale: 'linear', domain: [0, 1] },
            series: [
              { type: 'band', data: A.band, name: '材料甲' },
              { type: 'line', data: A.line, name: '材料甲' },
              { type: 'band', data: B.band, name: '材料乙' },
              { type: 'line', data: B.line, name: '材料乙' },
              { type: 'band', data: C.band, name: '材料丙' },
              { type: 'line', data: C.line, name: '材料丙' },
            ],
          });
          const lines = [...box.querySelectorAll('.splot__line')]
            .map((e) => ({ stroke: getComputedStyle(e).stroke,
                           dash: getComputedStyle(e).strokeDasharray }));
          const bands = [...box.querySelectorAll('.splot__band')]
            .map((e) => getComputedStyle(e).fill);
          box.remove();
          return { lines, bands, n: lines.length };
        });
        const uniq = (a) => Array.from(new Set(a));
        const colors = uniq(r.lines.map((l) => l.stroke));
        const dashes = uniq(r.lines.map((l) => l.dash));
        const bands = uniq(r.bands);
        const ok = r.n === 3 && colors.length === 3 && dashes.length === 3 &&
                   bands.length === 3;
        return { ok,
                 note: r.n + ' 条曲线 · 颜色 ' + colors.length + ' 种 · 线型 ' +
                       dashes.length + ' 种 · 色带 ' + bands.length + ' 种' +
                       (ok ? '' : ' 🔴 存在无法区分的系列') };
      },

      /* ⑦-b 同一逻辑系列的"带"和"线"必须**同色**
         ⚠️ 这条挡的是**反方向**的错误：把 P0-2 修成"每条记录一个色"
            ⇒ 同一材料的置信带和曲线变成两个颜色，看着像两种材料。 */
      '⑦-b 同一系列的区间带与曲线共享同一个色': async (p) => {
        const r = await p.evaluate(() => {
          const host = document.getElementById('fig3');
          const owner = host ? host.parentNode : document.body;
          return {
            lines: [...owner.querySelectorAll('.splot__line')]
              .map((e) => getComputedStyle(e).stroke),
            bands: [...owner.querySelectorAll('.splot__band')]
              .map((e) => getComputedStyle(e).fill),
          };
        });
        const all = r.lines.concat(r.bands);
        const uniq = Array.from(new Set(all));
        return { ok: all.length > 0 && uniq.length === 1,
                 note: '线 ' + JSON.stringify(r.lines) + ' 带 ' + JSON.stringify(r.bands) +
                       (uniq.length === 1 ? ' ⇒ 同一个色'
                                          : ' 🔴 同一系列竟有 ' + uniq.length + ' 种颜色') };
      },

      /* ⑦-c 图例：颜色必须能被翻译成名字 */
      '⑦-c 多系列图有图例，且色标与系列同色': async (p) => {
        const r = await p.evaluate(() => {
          const owner = document.getElementById('fig2').parentNode;
          return [...owner.querySelectorAll('.splot__legend-item')].map((li) => {
            const ln = li.querySelector('.splot__legend-mark line');
            return { name: (li.textContent || '').trim(),
                     swatch: ln ? getComputedStyle(ln).stroke : null };
          });
        });
        if (!r.length) return { ok: false, note: '🔴 双系列图没有图例（颜色无人翻译）' };
        const named = r.every((x) => x.name && x.name.length > 0);
        const uniqNames = new Set(r.map((x) => x.name));
        const uniqColors = new Set(r.map((x) => x.swatch));
        return { ok: named && uniqNames.size === r.length && uniqColors.size === r.length,
                 note: JSON.stringify(r.map((x) => x.name + '/' + x.swatch)) };
      },

      /* ⑧ 🔴 裁剪：数据不许画到坐标域之外
         SVG 默认 overflow:visible ⇒ 越界的点会压到轴外、甚至相邻卡片上。
         ⚠️ 只查"有没有 clip-path"会漏一层：clipPath 元素不存在时 URL 指向空，
            图形会直接**消失**。所以两个都查：挂了 + 目标真的存在。 */
      '⑧ 数据层被裁剪在坐标域内（clip-path 指向真实存在的元素）': async (p) => {
        const r = await p.evaluate(() => {
          const svgs = document.querySelectorAll('.splot').length;
          const groups = [...document.querySelectorAll('.splot g[clip-path]')];
          const ids = [...document.querySelectorAll('.splot clipPath')].map((c) => c.id);
          const missing = groups.filter((g) => {
            const m = (g.getAttribute('clip-path') || '').match(/#([^)]+)\)/);
            return !m || !document.getElementById(m[1]);
          }).length;
          let badCoord = 0;
          document.querySelectorAll('.splot polyline, .splot polygon,' +
            '.splot circle, .splot line').forEach((e) => {
            ['points', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy'].forEach((a) => {
              const v = e.getAttribute(a);
              if (v && /null|NaN|Infinity|undefined/.test(v)) badCoord++;
            });
          });
          return { svgs, groups: groups.length, missing,
                   idsUnique: ids.length === new Set(ids).size, badCoord };
        });
        const ok = r.svgs > 0 && r.groups >= r.svgs && r.missing === 0 &&
                   r.idsUnique && r.badCoord === 0;
        return { ok,
                 note: r.svgs + ' 张图 / ' + r.groups + ' 个裁剪组 · clipPath 缺失 ' +
                       r.missing + ' · id 唯一=' + r.idsUnique +
                       ' · 非法坐标 ' + r.badCoord + ' 处' };
      },

      /* ⑨ 🔴 对数轴上的无效数据必须**明确**，不能悄悄变成一条假曲线 */
      '⑨ 对数轴 ≤0 的点：断开 + 计数 + 图上写明': async (p) => {
        const r = await p.evaluate(() => {
          const box = document.createElement('div');
          box.style.cssText = 'position:absolute;left:-9999px;top:0';
          document.body.appendChild(box);
          const ret = window.ScientificPlot.render(box, {
            width: 360, height: 240,
            x: { label: 't', unit: 'h', scale: 'linear', domain: [0, 5] },
            y: { label: '计数', unit: 'CFU', scale: 'log', domain: [1e2, 1e5] },
            series: [{
              type: 'line', name: '实测',
              data: [[0, 2e2], [1, 5e2], [2, 0], [3, 3e3], [4, -1], [5, 2e4]],
            }],
          });
          /* 画得出来的标记数：≥2 的连续段是折线，孤立的点会被画成圆点。
             ⇒ 两者都算"能看见"，只数某一种会误判。 */
          const segs = box.querySelectorAll('.splot__line').length +
                       box.querySelectorAll('.splot__pt').length;
          const note = [...box.querySelectorAll('.splot__note')]
            .map((t) => t.textContent).join(' | ');
          const label = box.querySelector('.splot').getAttribute('aria-label') || '';
          const pts = [...box.querySelectorAll('.splot__line')]
            .map((l) => l.getAttribute('points')).join(' ');
          box.remove();
          return { dropped: ret.dropped, segs, note, label,
                   badCoord: /null|NaN|Infinity/.test(pts) };
        });
        const ok = r.dropped === 2 && r.segs >= 2 && /未绘制/.test(r.note) &&
                   /未绘制/.test(r.label) && !r.badCoord;
        return { ok,
                 note: 'dropped=' + r.dropped + '（应 2）· 折线断成 ' + r.segs +
                       ' 段 · 图上提示「' + r.note + '」· aria 提到=' +
                       /未绘制/.test(r.label) + ' · 坐标含非法值=' + r.badCoord };
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
