const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * table-check.js — 数据表格契约（总 B1 /
 *
 * ⭐ 三条硬要求（缺一就不算"能上线"）：
 *   ① 粘性表头：position:sticky + z-index 走令牌
 *   ② 数字列右对齐 + tabular-nums（能竖着比大小）
 *   ③ 空 / 加载 / 出错**三态齐全**
 *
 * ⚠️ 另有一条容易漏的：`position: sticky` 在 `border-collapse: collapse`
 *   的表格里**不生效**（浏览器限制）⇒ 必须用 `separate`。
 *   这是"写了 sticky 却没生效"的唯一原因，肉眼看不出来。
 */
(async () => {
  const r = await kit.check({
    name: 'table',
    url: 'http://127.0.0.1:8000/04-recipes/table/demo.html',
    dir: REPO + '/04-recipes/table',
    primary: '.table',
    interactive: '.table button, .table a',
    skipFocusRing: true,
    note: '表格容器本身不可聚焦（内部按钮/链接各自有焦点环）',
    skipHitArea: true,
    hitAreaNote: '表格内按钮按密集数据表惯例用 32px（行高限制），非 44px 触控目标',

    extra: {
      /* ① 粘性表头 */
      '表头是 sticky + z-index 走令牌': async () => {
        const fs = require('fs');
        const raw = kit.stripComments(
          fs.readFileSync(REPO + '/04-recipes/table/table.css', 'utf8'));
        const thRules = raw.match(/[^{}]*thead[^{}]*th[^{}]*\{[^{}]*\}/g) || [];
        if (!thRules.length) return { ok: false, note: '🔴 没有 thead th 规则' };
        const okSticky = thRules.some((r) => /position\s*:\s*sticky/.test(r));
        const okZ = thRules.some((r) => /z-index\s*:\s*var\(--/.test(r));
        const okBg = thRules.some((r) => /background/.test(r));
        return { ok: okSticky && okZ && okBg,
                 note: (okSticky ? '有 sticky' : '🔴 无 sticky') + ' · ' +
                       (okZ ? 'z-index 走令牌' : '🔴 z-index 写死') + ' · ' +
                       (okBg ? '有背景色' : '🔴 无背景色（会与内容重叠）') };
      },

      /* ①-b 🔴 关键：border-collapse 必须是 separate，否则 sticky 静默失效 */
      'border-collapse:separate（sticky 才生效）': async () => {
        const fs = require('fs');
        const raw = kit.stripComments(
          fs.readFileSync(REPO + '/04-recipes/table/table.css', 'utf8'));
        const m = raw.match(/border-collapse\s*:\s*(\w+)/);
        if (!m) return { ok: false, note: '🔴 没写 border-collapse（默认 separate，OK）' };
        return { ok: m[1] === 'separate',
                 note: 'border-collapse: ' + m[1] +
                       (m[1] === 'separate' ? ' ✅' : ' 🔴 sticky 会静默失效') };
      },

      /* ② 数字列：右对齐 + 等宽数字 */
      '数字列右对齐 + tabular-nums': async (p) => {
        const r = await p.evaluate(() => {
          const nums = [...document.querySelectorAll('.table .num')]
            .filter((e) => e.getClientRects().length);
          if (!nums.length) return { ok: true, note: '无 .num 列（跳过）' };
          const cs = getComputedStyle(nums[0]);
          /* ⭐ 修正：RTL 改造后表格用的是 `text-align: end`，
           *   它在 LTR 下与 `right` **视觉完全相同**，
           *   但 Chrome 的 getComputedStyle 返回的是 'end'（不解析成 'right'）。
           *   ⇒ 判据必须同时接受两种写法，否则会把正确实现报成"未右对齐"。 */
          const right = cs.textAlign === 'right' || cs.textAlign === 'end';
          const tabular = cs.fontVariantNumeric &&
                          cs.fontVariantNumeric.indexOf('tabular-nums') >= 0;
          return { ok: right && tabular,
                   note: (right ? '右对齐' : '🔴 非右对齐') + ' · ' +
                         (tabular ? 'tabular-nums' : '🔴 无 tabular-nums') +
                         '（' + nums.length + ' 个单元格）' };
        });
        return r;
      },

      /* ③ 三态齐全
         🔴 判据修正（第一次跑时误报"三态全缺"）：
            三态是**通过按钮切换**的，页面初始只渲染"常规"那一态
            ⇒ 只在初始 DOM 里找 `.table__empty` 必然找不到。
            ⇒ 正解：**依次点开每个状态**再查，最后复位。 */
      '空/加载/出错三态齐全': async (p) => {
        const seen = { empty: false, loading: false, error: false };
        /* ⚠️ 用 `[data-demo]`，不是 `[data-state]`。
           `data-state` 是**组件状态枚举**（open/closed/…），
           demo 里那几个按钮是"切到哪个视图"的**演示控件**，两者不是一回事。
           （之前混用同一个属性名，正是状态词汇被污染的典型。）

           ⚠️ 且必须**显式记录有没有找到按钮** —— 旧版 `if (b) b.click()`
              找不到就静默跳过，于是"按钮被删了"和"三态缺失"报的是同一句话。
              ⇒ 找不到按钮要当成**失败**，否则这条判据是假绿。 */
        const missBtn = [];
        for (const st of ['loading', 'empty', 'error']) {
          const hit = await p.evaluate((s) => {
            const b = document.querySelector('[data-demo="' + s + '"]');
            if (b) { b.click(); return true; }
            return false;
          }, st);
          if (!hit) missBtn.push(st);
          await new Promise((r) => setTimeout(r, 220));
          const r = await p.evaluate(() => ({
            empty: !!document.querySelector('.table__empty'),
            loading: !!document.querySelector('.table__loading, [aria-busy]'),
            error: !!document.querySelector('.table__error, [role="alert"]'),
          }));
          if (r[st]) seen[st] = true;
        }
        /* 复位回常规 */
        await p.evaluate(() => {
          const b = document.querySelector('[data-demo="ready"]');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 200));
        const missing = [];
        if (!seen.empty) missing.push('空态');
        if (!seen.loading) missing.push('加载态');
        if (!seen.error) missing.push('出错态');
        if (missBtn.length) {
          missing.push('演示切换按钮缺失：' + missBtn.join('、'));
        }
        return { ok: missing.length === 0,
                 note: missing.length ? '🔴 缺：' + missing.join('、') : '三态齐全' };
      },

      /* ③-b 状态容器要有语义（加载/出错要被播报）*/
      '状态区有 ARIA 语义': async (p) => {
        const r = await p.evaluate(() => {
          const l = document.querySelector('.table__loading');
          const e = document.querySelector('.table__error');
          const okL = !l || l.getAttribute('role') === 'status' ||
                      l.hasAttribute('aria-live') || l.hasAttribute('aria-busy');
          const okE = !e || e.getAttribute('role') === 'alert' ||
                      e.hasAttribute('aria-live');
          return { ok: okL && okE,
                   note: (okL ? '加载态有语义' : '🔴 加载态无语义') + ' · ' +
                         (okE ? '出错态有语义' : '🔴 出错态无语义') };
        });
        return r;
      },

      /* ④ 表头必须用 th + scope（读屏要念"列名"）*/
      '表头用 th[scope]': async (p) => {
        const r = await p.evaluate(() => {
          const ths = [...document.querySelectorAll('.table thead th')];
          if (!ths.length) return { ok: false, note: '🔴 表头没用 th' };
          const noScope = ths.filter((t) => !t.getAttribute('scope'));
          return { ok: noScope.length === 0,
                   note: ths.length + ' 个 th，' + noScope.length + ' 个缺 scope' +
                         (noScope.length ? '（读屏念不出列关系）' : '') };
        });
        return r;
      },

      /* ⑤ 排序状态用 aria-sort（在 th 上，不是在按钮上）*/
      '排序用 aria-sort': async (p) => {
        const r = await p.evaluate(() => {
          const btns = [...document.querySelectorAll('.table__sort')];
          if (!btns.length) return { ok: true, note: '无排序按钮（静态表，跳过）' };
          const bad = btns.filter((b) => {
            const th = b.closest('th');
            const v = th && th.getAttribute('aria-sort');
            /* aria-sort 必须在 th 上；值合法：ascending/descending/none */
            return th && v && ['ascending', 'descending', 'none'].indexOf(v) < 0;
          });
          /* 另查：按钮自己不能带 aria-sort */
          const onBtn = btns.filter((b) => b.hasAttribute('aria-sort'));
          return { ok: bad.length === 0 && onBtn.length === 0,
                   note: onBtn.length ? '🔴 aria-sort 放在按钮上了（应在 th）'
                                      : btns.length + ' 个排序按钮，aria-sort 位置正确' };
        });
        return r;
      },

      /* ⑥ 数字不能只靠颜色（正负）—— 必须有符号 */
      '正负有符号线索': async () => {
        const fs = require('fs');
        const raw = kit.stripComments(
          fs.readFileSync(REPO + '/04-recipes/table/table.css', 'utf8'));
        const pos = /\.num--pos[^{]*\{[^}]*content/.test(raw);
        const neg = /\.num--neg[^{]*\{[^}]*content/.test(raw);
        return { ok: pos && neg,
                 note: (pos ? '正有 + 号' : '🔴 正是纯颜色') + ' · ' +
                       (neg ? '负有 − 号' : '🔴 负是纯颜色') };
      },

      /* ⑦ 表格不能横向溢出页面（要能内部滚动）*/
      '横向滚动在容器内': async (p) => {
        const r = await p.evaluate(() => {
          const t = [...document.querySelectorAll('.table')];
          if (!t.length) return { ok: false, note: '没有 .table' };
          const noScroll = t.filter((x) => {
            const cs = getComputedStyle(x);
            return cs.overflowX === 'visible';
          });
          return { ok: noScroll.length === 0,
                   note: t.length + ' 个表格容器，' + noScroll.length + ' 个没设 overflow-x' +
                         (noScroll.length ? '（宽表会把整页撑宽）' : '') };
        });
        return r;
      },

      /* ⑨ 🔴 排序：**箭头必须跟实际数据顺序一致**（VIZ-REPORT-01 · P1-1）
         -------------------------------------------------------------
         这一pts：旧门禁只查"aria-sort 在不在 th 上"（结构）⇒ 全绿；
         而浏览器里箭头永远是"↕"（结果），数据排好了也看不出来。
         ⇒ 这里的判据是：点一下，读出**表里真的顺序**，
            再点一下，顺序必须反过来，且箭头两次都不一样
            才叫"数据看完无事"。 */
      '⑨ 排序箭头与实际数据顺序同步（不只是 aria-sort 写对了）': async (p) => {
        const read = () => p.evaluate(() => {
          const th = [...document.querySelectorAll('.table--financial thead th')]
            .find((t) => (t.querySelector('.table__sort') || {}).dataset &&
                         t.querySelector('.table__sort').dataset.key === 'rev');
          const btn = th.querySelector('.table__sort');
          return {
            arrow: getComputedStyle(btn, '::after').content,
            aria: th.getAttribute('aria-sort'),
            vals: [...document.querySelectorAll('.table--financial tbody tr')]
              .map((tr) => {
                const td = tr.children[1];
                return td ? Number(String(td.textContent).replace(/[,，\s]/g, '')) : NaN;
              }),
          };
        });
        await p.evaluate(() => {
          const b = document.querySelector('.table--financial .table__sort[data-key="rev"]');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 150));
        const asc = await read();
        await p.evaluate(() => {
          const b = document.querySelector('.table--financial .table__sort[data-key="rev"]');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 150));
        const desc = await read();

        const finite = asc.vals.filter((v) => isFinite(v));
        const isAsc = finite.every((v, i) => i === 0 || finite[i - 1] <= v);
        const dfin = desc.vals.filter((v) => isFinite(v));
        const isDesc = dfin.every((v, i) => i === 0 || dfin[i - 1] >= v);
        const arrowsDiffer = asc.arrow !== desc.arrow && /↑|↓/.test(asc.arrow);
        const ok = finite.length > 1 && isAsc && isDesc && arrowsDiffer;
        return { ok,
                 note: '箭头 ' + asc.arrow + '→' + desc.arrow +
                       ' · 第一次是否升序=' + isAsc + ' · 第二次是否降序=' + isDesc +
                       ' · aria=' + asc.aria + '→' + desc.aria +
                       (ok ? '' : '  🔴 排序是假的（箭头或顺序没跟着变）') };
      },

      /* ⑩ 🔴 动态文本不许被当成 HTML（VIZ-REPORT-01 · P1-2）
         demo 是给人**照抄**的 ⇒ 它必须示范正确的做法：
           数据里的 <b> / <a> / 带引号的属性 都要**原样显示**。
         判据看的是**结果**：真的有没有生成这些元素。 */
      '⑩ 动态文本按文本渲染，不生成 HTML 元素': async (p) => {
        const r = await p.evaluate(() => {
          const box = document.getElementById('escproof');
          if (!box) return { missing: true };
          const tbl = box.querySelector('table');
          if (!tbl) return { missing: true };
          const all = [tbl, ...tbl.querySelectorAll('*')];
          return {
            missing: false,
            b: tbl.querySelectorAll('b').length,
            a: tbl.querySelectorAll('a').length,
            handlers: all.filter((e) => [...e.attributes]
              .some((at) => /^on/i.test(at.name))).length,
            /* 尖括号必须**原样出现在文本里** —— 转义对了才看得到字面的 <b> */
            literal: (tbl.textContent || '').indexOf('<b>') >= 0,
            rows: tbl.querySelectorAll('tbody tr').length,
          };
        });
        if (r.missing) {
          return { ok: false, note: '🔴 找不到转义自证区（#escproof）⇒ 判据无从生效' };
        }
        const ok = r.rows > 0 && r.b === 0 && r.a === 0 && r.handlers === 0 && r.literal;
        return { ok,
                 note: r.rows + ' 行 · 生成了 <b> ' + r.b + ' 个 / <a> ' + r.a +
                       ' 个 / 事件属性 ' + r.handlers + ' 个 · 字面含 <b> =' + r.literal };
      },

      /* ⑪ 三种用途预设**不能合并**（合并会把财务表的规则套到三线表上） */
      '⑪ 三种预设各自独立存在（财务 / 三线表 / 统计）': async (p) => {
        const r = await p.evaluate(() => ({
          fin: document.querySelectorAll('.table--financial').length,
          acad: document.querySelectorAll('.table--academic').length,
          stats: document.querySelectorAll('.table--stats').length,
        }));
        return { ok: r.fin >= 1 && r.acad >= 1 && r.stats >= 1,
                 note: '财务 ' + r.fin + ' · 三线表 ' + r.acad + ' · 统计 ' + r.stats };
      },

      /* ⑧ 单位在两处都写了 ⇒ 必须写的是同一个（0.8.0 新增）
         🔴 起因：财务表**同时**在表题里写「金额单位：万元」、又在列头写 `unit: '万元'`。
            两处都是人写的 ⇒ 它们会漂移。实测踩到的还不是漂移，而是
            「两处都写万元、但数值量级是十万元」——那种**机器查不出来**（见下）。

         ⚠️ 诚实边界：**数值量级与单位是否相符，本判据查不出来**。
            那需要外部真值（真实财报），本库没有也不该有。
            所以这里只钉死能钉的：**声明单位的两处写法必须一致**，
            并且"一处都没声明"要判红（否则把 `unit` 删了就假绿）。

            量级那一半只能靠人核对 —— 上面那条真事故是人工核对时发现的，
            不是门禁发现的。不要因为门禁绿了就以为单位一定对。 */
      '声明了金额单位的表：表题与列头写法一致': async (p) => {
        const r = await p.evaluate(() => {
          const tables = [...document.querySelectorAll('.table table')];
          const found = [];
          for (const t of tables) {
            const cap = t.querySelector('caption');
            if (!cap) continue;
            const m = cap.textContent.match(/金额单位\s*[：:]\s*([^\s·,，]+)/);
            if (!m) continue;
            const declared = m[1];
            const units = [...t.querySelectorAll('thead .table__unit')]
              .map((e) => e.textContent.trim()).filter(Boolean);
            const money = units.filter((u) => /元/.test(u));
            found.push({ declared: declared, money: money });
          }
          if (!found.length) {
            return { ok: false,
                     note: '🔴 页面上没有"声明了金额单位"的表 ⇒ 判据无从生效' +
                           '（多半是表题被改掉了）。跳过等于假绿，所以判红。' };
          }
          const bad = found.filter((o) =>
            o.money.length === 0 || o.money.some((u) => u !== o.declared));
          return { ok: bad.length === 0,
                   note: found.map((o) => '表题「' + o.declared + '」/ 列头 ' +
                         JSON.stringify(o.money)).join(' · ') +
                         (bad.length ? ' ⇒ 🔴 两处不一致' : ' ⇒ 一致') };
        });
        return r;
      },
    },
  });
  process.exit(kit.report(r));
})();
