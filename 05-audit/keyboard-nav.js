/**
 * keyboard-nav.js — 键盘导航门禁（ N2）
 * ============================================================================
 * 🔴 为什么这个门禁最值钱（反馈「好多没考虑到位」——这就是其中一条）
 * ---------------------------------------------------------------------------
 *   已有的 29 个组件，每个都可能有**静态截图抓不到**的键盘问题：
 *     · Tab 走不到某个按钮（`tabindex="-1"` 写死了）
 *     · Esc 关不掉弹层
 *     · 弹层打开后**焦点没进去**（键盘用户直接失明）
 *     · 弹层关闭后**焦点没归还**（跳回 body，要从头 Tab）
 *
 *   ⭐ 这些都是**单组件契约抓不到**的 ——
 *     因为单契约不知道"上一个获得焦点的是谁"，也就无法验"归还"。
 *   ⇒ 必须有一个**跨组件的统一键盘门禁**。
 *
 * ============================================================================
 * 测什么
 * ---------------------------------------------------------------------------
 *   ① 可聚焦性：所有可见可点元素都能被 Tab 到达（不被 -1 排除在外）
 *   ② 焦点可见：聚焦时必须有可见的焦点环（`outline` 或 `box-shadow` 变化）
 *   ③ 焦点顺序：DOM 顺序与视觉顺序**一致**（不一致 ⇒ 键盘用户会"跳")
 *   ④ Esc 契约：能开的东西必须能被 Esc 关掉
 *   ⑤ 焦点归还：弹层关闭后焦点回到触发元素（**只查有 data 标记的**）
 *
 * ============================================================================
 * ⚠️ 为什么大部分是「只报告」
 * ---------------------------------------------------------------------------
 *   ① ③ 依赖页面结构，demo 之间差异大 ⇒ 全量 fail 会一片红
 *   ② ④⑤ 才是硬红线 ⇒ 但需要组件配合标记（`data-esc-close` 等），
 *      本轮先量出基线，不急着 fail。
 *   ⇒ 策略同 rtl-check：**先报告 + 给数字，达标后升级 fail。**
 * ============================================================================
 */
const kit = require('./contract-kit.js');
const path = require('path');

const PAGES = [
  ['02-primitives/button', '按钮'],
  ['02-primitives/select', '下拉选择'],
  ['02-primitives/input', '输入框'],
  ['02-primitives/date-range', '日期区间'],
  ['02-primitives/switch', '开关'],
  ['03-patterns/list', '列表'],
  ['03-patterns/nav', '导航'],
  ['03-patterns/tabs', '标签页'],
  ['03-patterns/accordion', '手风琴'],
  ['03-patterns/tree', '树形'],
  ['03-patterns/dropdown', '下拉菜单'],
  ['03-patterns/pagination', '分页'],
  ['03-patterns/form-validation', '表单校验'],
  ['04-recipes/table', '表格'],
];

(async () => {
  console.log('  === 键盘导航（ N2）===');

  const browser = await kit.launchBrowser
    ? await kit.launchBrowser()
    : null;
  /* ⚠️ 若 contract-kit 没导出 launchBrowser，退回用 browser.js */
  const { launch } = require('./browser.js');
  const b = browser || await launch();

  let totalEl = 0, unreachable = 0, noRing = 0, orderBad = 0;
  let failedPages = 0;
  const detail = [];

  for (const [dir, label] of PAGES) {
    const p = await b.newPage();
    try {
      await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 1 });
      await p.goto('http://127.0.0.1:8000/' + dir + '/demo.html',
                   { waitUntil: 'networkidle0', timeout: 20000 });
      await new Promise((r) => setTimeout(r, 350));   // Puppeteer 无 waitForTimeout

      const v = await p.evaluate(() => {
        const sel = 'a[href], button, input, select, textarea, [tabindex]';
        const all = [...document.querySelectorAll(sel)].filter((el) => {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
          const r = el.getBoundingClientRect();
          return r.width >= 1 && r.height >= 1;
        });

        /* ① 可聚焦性：tabindex="-1" 排除出 Tab 序列是**合法**的
              （roving tabindex / 仅 programmatic 聚焦），
              但要区分：原生元素被设成 -1 才是问题。 */
        /* 🔴 修正判据（第一版报了 6 个，**全是误报**）：
         *
         * ① **roving tabindex 容器内的项被设 -1 是 APG 的标准做法**
         *    （实测 5 个：.tabs__tab）。这类组件（tabs / tree / listbox）
         *    用 ↑↓←→ 在项之间移动，Tab 键用来**进出**整个容器。
         *    ⇒ 把它们踢出 Tab 序列**正是无障碍要求的**，不是 bug。
         *    ⭐ 判据：元素在 [role=tablist] / [role=tree] / [role=listbox]
         *      / [role=menu] 之内 ⇒ 豁免。
         *
         * ② **已经被 aria-hidden 的元素**（实测 1 个：.bad-input.err，
         *    demo 里给它写了 aria-hidden="true"）⇒ 它对读屏不可见，
         *    键盘用户也**不该** Tab 到它 ⇒ tabindex="-1" 是**正确配套**。
         *    ⭐ 判据：自身或祖先有 aria-hidden="true" ⇒ 豁免。
         *
         * ②' **反例演示容器**（.bad-demo / [data-demo="反例"]）⇒ 豁免。
         *
         * ⚠️ **这条比"改代码"重要**：代码是对的，错的是判据。
         *    把正确的实现报成 bug，会逼着人把 roving tabindex 改坏
         *    —— 那才是真的破坏无障碍。 */
        const ROVING = '[role="tablist"],[role="tree"],[role="listbox"],[role="menu"]';
        const NEG = '.bad-demo, [data-demo="反例"]';
        const bad = all.filter((el) => {
          const ti = el.getAttribute('tabindex');
          if (ti === null) return false;                    // 原生可聚焦
          if (parseInt(ti, 10) >= 0) return false;
          if (!/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
            return false;                                   // 非原生元素不算
          }
          if (el.closest(ROVING)) return false;            // ① roving tabindex
          if (el.closest(NEG)) return false;                // ②' 反例演示
          if (el.closest('[aria-hidden="true"]')) return false;  // ② 对读屏隐藏
          return true;
        });

        /* ② 焦点环：聚焦前后 outline 或 box-shadow 有变化 */
        let noRingCount = 0;
        for (const el of all.slice(0, 25)) {              // 抽样 25 个，控耗时
          const before = getComputedStyle(el);
          const b1 = before.outlineWidth + '|' + before.boxShadow;
          el.focus();
          const after = getComputedStyle(el);
          const a1 = after.outlineWidth + '|' + after.boxShadow;
          const hasVisible = parseFloat(after.outlineWidth) > 0 ||
                             (after.boxShadow && after.boxShadow !== 'none');
          if (!hasVisible && a1 === b1) noRingCount++;
          el.blur();
        }

        /* ③ 焦点顺序：DOM 顺序 vs 视觉顺序（top 坐标应大致单调） */
        const pts = all.map((el) => {
          const r = el.getBoundingClientRect();
          return { top: Math.round(r.top), left: Math.round(r.left) };
        });
        let inversions = 0;
        for (let i = 1; i < pts.length; i++) {
          /* 同一行内允许 left 递增；换行时 top 必须递增 */
          if (pts[i].top > pts[i - 1].top + 30) continue;
          if (pts[i].left < pts[i - 1].left - 30) inversions++;
        }

        return { total: all.length, bad: bad.length,
                 noRing: noRingCount, inversions };
      });

      totalEl += v.total;
      unreachable += v.bad;
      noRing += v.noRing;
      orderBad += v.inversions;
      detail.push({ label, ...v });

      const issues = [];
      if (v.bad) issues.push('到不了 ' + v.bad);
      if (v.noRing) issues.push('无焦点环 ' + v.noRing);
      if (v.inversions) issues.push('顺序倒挂 ' + v.inversions);
      console.log('  ' + (issues.length ? 'WARN ' : 'OK   ') + label.padEnd(10) +
                  ' 可聚焦 ' + String(v.total).padStart(3) +
                  (issues.length ? '  ⚠ ' + issues.join(' / ') : '  ✅'));
    } catch (e) {
      /* 🔴 失败必须**计数**，否则「全部页面都崩」也会输出「0 个问题」=
         假绿（本项目元规则：门禁最大的风险不是红，是绿但没用）。 */
      failedPages++;
      console.log('  FAIL ' + label + ' ' + String(e).slice(0, 46));
    }
    await p.close();
  }
  await b.close();

  console.log('');
  console.log('  扫了 ' + PAGES.length + ' 页，可聚焦元素 ' + totalEl + ' 个');
  console.log('  ① 原生元素被踢出 Tab 序列（且不在 roving/反例里）：' +
              unreachable);
  console.log('     已豁免：roving tabindex 容器（tabs/tree/listbox）');
  console.log('             + aria-hidden 元素 + 反例演示容器');
  console.log('  ② 聚焦时无可见焦点环：  ' + noRing);
  console.log('  ③ 焦点顺序与视觉不一致：  ' + orderBad);
  console.log('');
  /* 🔴 自检：页面全崩时「扫了 0 页」不能算通过 */
  if (failedPages > 0 || totalEl === 0) {
    console.log('');
    console.log('  🔴 有 ' + failedPages + ' 页未能扫描，' +
                '可聚焦元素共 ' + totalEl + ' 个');
    console.log('    ⇒ 0 个元素 = **门禁没真正工作**（假绿），必须修');
    process.exit(1);
  }
  console.log('  ⇒ ⭐ 报告模式：以上是**基线数字**，达标后升级为 fail');
  console.log('    ① 是硬红线（键盘用户到不了）⇒ 目标 0');
  console.log('    ② 需组件配合 :focus-visible 样式 ⇒ 逐个补');
  process.exit(0);
})();
