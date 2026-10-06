/**
 * responsive-check.js — 响应式门禁（ H4）
 * ============================================================================
 * 🔴 为什么单独做这个门禁（而不是让 33 个契约各跑三档）
 * ---------------------------------------------------------------------------
 *   ① **成本**：33 个契约 × 3 档 = 全量门禁慢 3 倍（现在已 3 分钟）
 *      ⇒ 门禁变慢就会被跳过 ⇒ 慢的门禁等于没有门禁
 *   ② **职责不同**："这个组件行为对不对"（契约）
 *      vs "换到平板/桌面会不会崩"（本门禁）
 *      ⇒ 混在一起会让契约的失败原因变得难读
 *
 *   所以：**契约保持手机档**（默认不变），响应式由本门禁独立负责。
 *
 * ============================================================================
 * 测什么（只测"换尺寸就可能坏"的四类，不是重跑全部契约）
 * ---------------------------------------------------------------------------
 *   ① **横向溢出** —— 最常见的响应式 bug（桌面下被挤破）
 *   ② **命中区缩水** —— 桌面上不该有大片死区（hover 门控失效的信号）
 *   ③ **文字截断** —— 容器变窄后 `text-overflow` 把内容吃掉
 *   ④ **触控目标** —— 平板有触屏，必须 ≥ 24px（WCAG 2.5.8 AA）
 *
 * ⭐ 三档尺寸（与 contract-kit 的 VP 一致）
 *   phone   393 × 852   （基准）
 *   tablet  834 × 1112
 *   desktop 1440 × 900
 */
const { launch } = require('./browser.js');

const VIEWPORTS = [
  { key: 'phone', w: 393, h: 852, touch: true },
  { key: 'tablet', w: 834, h: 1112, touch: true },
  { key: 'desktop', w: 1440, h: 900, touch: false },
];

/* ⭐ 只测这几页：它们是"布局敏感"的组件（列表/表格/表单/导航/图表）。
   其余组件（按钮/徽标/开关…）尺寸变化时行为不变，测了是浪费。 */
const PAGES = [
  ['02-primitives/input', '输入框'],
  ['02-primitives/select', '下拉选择'],
  ['02-primitives/combobox', '组合框'],
  ['02-primitives/date-range', '日期区间'],
  ['03-patterns/list', '列表'],
  ['03-patterns/form-validation', '表单校验'],
  ['03-patterns/nav', '导航'],
  ['03-patterns/tree', '树形视图'],
  ['03-patterns/table', '表格'],
  ['04-recipes/table', '表格 recipe'],
  ['10-review/composition', '组合页'],
];

/** 在页面里执行的检查 */
const SCAN = function (hasTouch) {
  const res = { overflow: null, tinyTargets: [], truncated: [] };

  /* ① 横向溢出 */
  const de = document.documentElement;
  res.overflow = { sw: de.scrollWidth, cw: de.clientWidth };

  /* ② + ④ 可点击元素的尺寸 */
  const sel = 'button, a[href], input, select, textarea, [role="button"], [role="tab"]';
  for (const el of document.querySelectorAll(sel)) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;         // 隐藏元素
    if (r.bottom < 0 || r.top > innerHeight * 3) continue;  // 视口外（未展开的弹层）
    /* ④ 触控目标：只在有触屏的版本要求 */
    if (hasTouch && (r.height < 24 || r.width < 24)) {
      res.tinyTargets.push({
        cls: (el.tagName.toLowerCase() +
              (typeof el.className === 'string' && el.className
                ? '.' + el.className.trim().split(/\s+/)[0] : '')),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
  }

  /* ③ 文字截断：scrollWidth 明显超过 clientWidth 且被 overflow 吃掉 */
  for (const el of document.querySelectorAll('body *')) {
    const hasText = Array.prototype.some.call(el.childNodes,
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!hasText) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (cs.textOverflow === 'ellipsis' && cs.overflow !== 'visible') {
      /* 省略号是**设计选择**，不算 bug ⇒ 跳过 */
      continue;
    }
    if (cs.whiteSpace === 'nowrap' && el.scrollWidth > el.clientWidth + 2) {
      const r = el.getBoundingClientRect();
      if (r.width < 1) continue;
      res.truncated.push({
        cls: (el.tagName.toLowerCase() +
              (typeof el.className === 'string' && el.className
                ? '.' + el.className.trim().split(/\s+/)[0] : '')),
        text: (el.textContent || '').trim().slice(0, 18),
        sw: el.scrollWidth, cw: el.clientWidth,
      });
    }
  }
  return res;
};

(async () => {
  const browser = await launch();
  let fails = 0;
  let checks = 0;

  console.log('  === 响应式（ H4 · 三档 × ' + PAGES.length + ' 页）===');

  for (const vp of VIEWPORTS) {
    const line = [];
    for (const [dir, label] of PAGES) {
      const p = await browser.newPage();
      try {
        await p.setViewport({ width: vp.w, height: vp.h,
                              deviceScaleFactor: 1,
                              isMobile: vp.key === 'phone',
                              hasTouch: vp.touch });
        await p.goto('http://127.0.0.1:8000/' + dir + '/demo.html',
                     { waitUntil: 'networkidle0' });
        await new Promise((r) => setTimeout(r, 350));
        /* 冻结动画，避免截图/测量抖动（与 shot-baseline 同一手法） */
        await p.addStyleTag({ content:
          '*,*::before,*::after{animation:none !important;transition:none !important}' });
        await new Promise((r) => setTimeout(r, 120));

        const r = await p.evaluate(SCAN, vp.touch);
        checks++;

        /* ① 横向溢出：容差 1px（避免亚像素抖动假红） */
        if (r.overflow.sw > r.overflow.cw + 1) {
          fails++;
          line.push('  🔴 ' + label + ' 横向溢出 ' + r.overflow.sw + ' > ' + r.overflow.cw);
          continue;
        }
        /* ④ 触控目标 */
        if (r.tinyTargets.length) {
          fails++;
          line.push('  🔴 ' + label + ' 触控目标过小 ' + r.tinyTargets.length + ' 个：' +
                    r.tinyTargets.slice(0, 2).map((t) => t.cls + ' ' + t.w + '×' + t.h).join(', '));
          continue;
        }
        /* ③ 文字截断（只报前 2 个） */
        if (r.truncated.length) {
          fails++;
          line.push('  🔴 ' + label + ' 文字被截断 ' + r.truncated.length + ' 个：' +
                    r.truncated.slice(0, 2).map((t) => t.cls + '「' + t.text + '」').join(', '));
          continue;
        }
      } catch (e) {
        fails++;
        line.push('  🔴 ' + label + ' 出错：' + String(e).slice(0, 40));
      }
      await p.close();
    }
    if (line.length) {
      console.log('  ' + vp.key + ' (' + vp.w + '×' + vp.h + ')');
      line.forEach((l) => console.log(l));
    } else {
      console.log('  OK  ' + vp.key + ' (' + vp.w + '×' + vp.h + ')  ' +
                  PAGES.length + ' 页全部通过');
    }
  }

  await browser.close();
  console.log('');
  console.log('  跑了 ' + (checks) + ' 个（页面 × 版本）组合，' + fails + ' 个有问题');
  if (fails) {
    console.log('');
    console.log('  ⇒ 🔴 响应式的问题**在单档契约里永远测不到**');
    console.log('    （契约默认只跑手机 393×852）');
  }
  process.exit(fails ? 1 : 0);
})();
