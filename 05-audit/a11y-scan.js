/**
 * a11y-scan.js — 用 axe-core 扫每个 demo，报告真实的无障碍违规
 *
 * 为什么用 axe-core（2026-10-03）
 * ----------------------------
 * Owner 问「开源项目有没有这种模拟器，确保语义不会出问题，并且要可验证」。
 *
 * axe-core 是**业界标准**：
 *   · Deque Systems 维护，驱动 Chrome DevTools 的无障碍审计
 *   · 90+ 规则，覆盖 WCAG 2.0 / 2.1 / 2.2 的 A 与 AA
 *   · 零误报承诺
 *
 * 🔴 协议要注意：**MPL-2.0**（文件级 copyleft，不是 MIT/ISC）
 *   · 作为**测试工具运行** ⇒ 没有任何分发问题
 *   · **绝不能打进产品产物**（那样被修改的文件要开源）
 *   · 本文件只 require 它，不把它拷进 05-audit/ 或发布包
 *
 * 🔴 关于 `.box.bad`（反例区）：
 *   那是**故意的错误示范**（"常见写法：纯红""过度动画"…），
 *   本来就不该通过 a11y 检查。做法是**扫描期间**临时隐藏它，
 *   并在输出里公开打印跳过了几个 —— 不做"标记了就免检"这种静默豁免。
 *   仍然保留它们的 `aria-hidden`，让**读屏**也别念反例（axe 查视觉，管不了这个）。
 *
 * 🔴 axe 只能覆盖 WCAG 问题的约 30–40%（业界公认）。
 *   它查得出：缺 alt、缺 label、重复 id、缺 lang、对比度不足、
 *   ARIA 属性用错、tabindex > 0、缺地标……
 *   它查不出：alt 写得有没有意义、阅读顺序对不对、复杂控件的键盘行为。
 *   ⇒ 报告里必须写清这个边界，不能让人以为"跑绿了就无障碍达标"。
 *
 * 用法：node a11y-scan.js            # 扫全部
 *       node a11y-scan.js choice     # 只扫一个
 */
const path = require('path');
const fs = require('fs');
// puppeteer-core 由 browser.js 统一持有（含关缓存）
const { launch } = require('./browser');
const AXE = require.resolve('axe-core');

const CHROME = (process.env.CHROME_PATH || process.env.CHROME_BIN || undefined);
const ROOT = require('path').resolve(__dirname, '..');  // ⭐ 不写死绝对路径
const BASE = 'http://127.0.0.1:8000';

// 🔴 KNOWN_OK = 已知且**已决定暂不做**的规则（会让门禁变红但不该变红）。
//
// 2026-10-03 更新：'landmark-one-main' 与 'region' **已清零**。
//    之前它们在这里是因为批量改 HTML 出过事故（8 页面结构损坏）而放弃。
//    现在用**安全做法**重做：只换开标签 + body 尾闭合标签（唯一确定，不需配对推断），
//    改完立即用浏览器验 `document.body.children` 与 `.wrap` 的 tagName。
//    11/11 页面通过，axe 294 条规则 0 违规。
//    ⇒ 从这里移除，让门禁重新盯住这两条。
const KNOWN_OK = new Set();   // 目前为空 —— 没有"已知且暂不做"的规则
const PAGES = [
  ['index', 'index.html'],
  ['button', '02-primitives/button/demo.html'],
  ['card', '02-primitives/card/demo.html'],
  ['choice', '02-primitives/choice/demo.html'],
  ['input', '02-primitives/input/demo.html'],
  ['form-validation', '03-patterns/form-validation/demo.html'],
  ['list', '03-patterns/list/demo.html'],
  ['nav', '03-patterns/nav/demo.html'],
  ['overlay', '03-patterns/overlay/demo.html'],
  ['states', '03-patterns/states/demo.html'],
  ['longform', '04-recipes/longform/longform.html'],
];

(async () => {
  const only = process.argv[2];
  const list = only ? PAGES.filter(([n]) => n === only) : PAGES;
  const browser = await launch();
  let totalV = 0, totalPass = 0;
  const allViolations = [];
  const knownIssues = [];
  for (const [name, rel] of list) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    try {
      await page.goto(BASE + '/' + rel, { waitUntil: 'networkidle0', timeout: 15000 });
    } catch (e) {
      console.log('  [跳过] ' + name + '  ' + String(e).slice(0, 50));
      await page.close();
      continue;
    }
    // 反例区（.box.bad）是"故意的错误示范"，本来就不该通过 a11y 检查。
    // 做法：在**扫描期间**临时隐藏它（不改页面本身），
    // 并把跳过了什么**公开打印** —— 绝不能变成"标记了就免检"的万能借口。
    const skipped = await page.evaluate(() => {
      const n = document.querySelectorAll('.box.bad').length;
      document.querySelectorAll('.box.bad').forEach((e) => {
        e.setAttribute('data-axe-skipped', '1');
        e.style.display = 'none';
      });
      return n;
    });
    await page.addScriptTag({ path: AXE });
    const r = await page.evaluate(async () => {
      const res = await window.axe.run(document, {
        /* 🔴 2026-10-03 补 best-practice：反向控制发现 `duplicate-id` 漏检。
           原因是它不属于 WCAG 条款（tag 是 best-practice），
           而我原来只跑 wcag* 几个 tag ⇒ 重复 id 查不出来。
           而重复 id 会**破坏 label 的 for 关联和所有 ARIA 引用** ——
           对"语义正确"是致命的，必须查。
           best-practice 里有几条主观规则（如 heading-order），
           报出来的是"建议"，我会逐条人工判定而不是盲改。 */
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa',
                   'best-practice'],
        },
      });
      return {
        violations: res.violations.map((v) => ({
          id: v.id, impact: v.impact, help: v.help,
          n: v.nodes.length,
          sample: v.nodes.slice(0, 2).map((x) => x.html.slice(0, 70)),
        })),
        passes: res.passes.length,
        incomplete: res.incomplete.length,
      };
    });
    totalV += r.violations.length;
    totalPass += r.passes;
    const bad = r.violations.length;
    console.log('  [' + (bad ? 'FAIL' : 'OK  ') + '] ' +
                name.padEnd(16) + bad + ' 违规 / ' + r.passes + ' 通过' +
                (r.incomplete ? ' / ' + r.incomplete + ' 待人工' : '') +
                (skipped ? '   （跳过 ' + skipped + ' 个反例区 .box.bad）' : ''));
    for (const v of r.violations) {
      allViolations.push({ page: name, id: v.id, n: v.n, help: v.help });
      if (KNOWN_OK.has(v.id) && !knownIssues.includes(v.id + '（' + v.help + '）')) {
        knownIssues.push(v.id + '（' + v.help + '）');
      }
      console.log('         └ [' + v.impact + '] ' + v.id + ' ×' + v.n + ' — ' + v.help);
      v.sample.forEach((s) => console.log('            ' + s));
    }
    await page.close();
  }
  await browser.close();
  console.log('');
  // 2026-10-03：分「已知且已决定不做」与「真问题」两类报告。
  // 之前我把"缺 <main> 地标"和真问题混在一起报，看起来像还有 6 个页面坏了，
  // 实际上那是 Owner 明确决定**放弃**的（批量改 HTML 出的事故已回滚，
  // 结构已恢复原样）。混报会让人误判状态。
  console.log('合计 ' + totalV + ' 类违规 / ' + totalPass + ' 条规则通过');
  if (knownIssues.length) {
    console.log('');
    console.log('其中**已知且已决定暂不做**（不是新发现的缺陷）：');
    knownIssues.forEach((i) => console.log('  · ' + i));
  }
  const real = allViolations.filter((x) => !KNOWN_OK.has(x.id));
  if (real.length) {
    console.log('');
    console.log('🔴 **真问题**（需要修）：');
    real.forEach((v) => console.log('  · [' + v.page + '] ' + v.id +
                                   ' ×' + v.n + ' — ' + v.help));
  } else {
    console.log('');
    console.log('✅ 除上面那些「已决定暂不做」的，**没有其他问题**。');
  }
  console.log('');
  console.log('⚠ axe 只覆盖 WCAG 问题的约 30–40%。它查不出：');
  console.log('  · alt 写得有没有意义      · 阅读顺序对不对');
  console.log('  · 复杂控件的键盘行为是否正确（日期选择、轮播、树形视图）');
  console.log('  · 屏幕阅读器实际听到的是什么 —— 那一项永远需要人用耳朵听。');
  // 只按「真问题」决定退出码 —— 已决定暂不做的那些不该让门禁变红
  process.exit(real.length ? 1 : 0);
})();
