const { launch } = require('./browser.js');

/**
 * fab-opaque-check.js — 悬浮按钮「不许透明 + 不许语义不清」门禁
 *
 * ============================================================================
 * 🔴 为什么需要（2026-10-04 Owner 实机指出的两件事）
 * ============================================================================
 *   ①「你这个底色是**透明颜色**的，透明颜色非常非常容易出现错误」
 *      实测确认 `background = rgba(0,0,0,0)` ——
 *      根因是 `background: var(--surface-raised)`，
 *      而 **那个变量在浅色段没定义**（只定义在暗色段）
 *      ⇒ 变量不存在 ⇒ 整个声明失效 ⇒ **静默变透明**。
 *      ⚠️ 危险之处：**它不报错**，只是"看起来透明"，很容易被忽略。
 *
 *   ②「明暗 跟随这三个键我也看懂，但**总归是有点语义问题**，
 *      **别人不一定能看得懂**」
 *      ⇒ 文案必须说人话，且 `aria-label` 必须完整。
 *
 * ⚠️ 这类问题**目视极难发现**（半透明 + 白底在浅色页面上看着"还行"）
 *    ⇒ 必须机械检查。
 */
(async () => {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 2,
                        isMobile: true, hasTouch: true });
  await p.goto('http://127.0.0.1:8000/10-review/ios/index.html',
               { waitUntil: 'networkidle0' });
  const bad = [];
  const MODES = ['auto', 'light', 'dark'];

  for (const m of MODES) {
    await p.evaluate((x) => window.Theme.set(x), m);
    await new Promise((r) => setTimeout(r, 300));
    const r = await p.evaluate(() => {
      const el = document.getElementById('theme-fab');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, text: el.textContent.replace(/\s+/g, ' ').trim(),
               aria: el.getAttribute('aria-label') || '',
               w: Math.round(el.getBoundingClientRect().width),
               h: Math.round(el.getBoundingClientRect().height) };
    });
    if (!r) { bad.push('找不到 #theme-fab'); continue; }
    // ① 底色必须实体
    if (r.bg === 'rgba(0, 0, 0, 0)') bad.push('[' + m + '] 底色是**完全透明**');
    // ② 尺寸必须够（WCAG 2.5.5）
    if (r.w < 44 || r.h < 44) bad.push('[' + m + '] 命中区 ' + r.w + '×' + r.h + ' < 44');
    // ③ 文案必须说人话（不能是「跟随/亮/暗」这种缩写）
    const vague = /^(跟随|亮|暗|明暗)$/;
    if (!r.text || vague.test(r.text.replace(/[^一-龥]/g, ''))) {
      bad.push('[' + m + '] 文案「' + r.text + '」**语义不清**');
    }
    // ④ aria-label 必须完整（≥10 个字，说明当前状态 + 按下会怎样）
    if (r.aria.length < 10) bad.push('[' + m + '] aria-label 太短：「' + r.aria + '」');
    else if (r.aria.indexOf('点按') < 0) {
      bad.push('[' + m + '] aria-label 没说「按下去会怎样」：「' + r.aria + '」');
    }
  }
  await b.close();

  console.log('  检查了 ' + MODES.length + ' 种主题下的悬浮按钮');
  if (bad.length) {
    console.log('  ❌ ' + bad.length + ' 项：');
    bad.forEach((x) => console.log('     · ' + x));
    console.log('');
    console.log('  🔴 透明底色最危险的地方：');
    console.log('     `background: var(--某个未定义变量)` **不报错**，只是静默失效 ⇒');
    console.log('     元素变透明。目视在浅色页面上很容易漏掉。');
    console.log('     ⇒ 悬浮控件必须**实体底色**，且门禁要查计算值。');
    process.exit(1);
  }
  console.log('  ✅ 底色实体 · 命中区 ≥44 · 文案说人话 · aria 说明按下后的动作');
})();
