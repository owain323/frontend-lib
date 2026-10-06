const { launch } = require('./browser.js');

/**
 * tap-highlight-check.js — iOS 点击高亮门禁
 *
 * ============================================================================
 * 🔴 为什么需要（2026-10-04 Owner iOS 实机报）
 * ============================================================================
 * Owner 原话：「点击单选和复选的选项的时候会出现非常奇怪的阴影残留，
 * 那个阴影居然是**纺锤形**的，或者是极快的那个**灰黑色的底色闪动**」。
 *
 * ⭐ 真因：**iOS Safari 的默认行为** ——
 *   它给被点击的元素加一层半透明灰黑遮罩（约 rgba(0,0,0,0.18)），
 *   而这层遮罩**跟着元素形状与圆角** ⇒ 圆角方块 ⇒ 「纺锤形」。
 *
 *   ⚠️ 真正被点的不是那个小圆点，是**铺满整个控件的透明 input**
 *      （`opacity:0; inset:0`）⇒ 遮罩画在它身上，更怪。
 *
 * ⇒ 标准解法：`-webkit-tap-highlight-color: transparent`。
 *
 * ⚠️ **必须做成门禁**的原因：这是 iOS 独有行为，
 *    在桌面的 Chrome 里**根本看不出来** ⇒ 不设门禁必然复发。
 */
const TARGETS = [
  ['.choice', '单选/复选'], ['.btn', '按钮'],
  ['.accordion__trigger', '折叠标题'], ['.switch', '开关'],
  ['.tabs__tab', '标签页'], ['.nav__link', '导航'],
];
const PAGES = [
  ['iOS 验证页', '/10-review/ios/index.html'],
  ['choice demo', '/02-primitives/choice/demo.html'],
  ['accordion demo', '/03-patterns/accordion/demo.html'],
  ['switch demo', '/02-primitives/switch/demo.html'],
  ['button demo', '/02-primitives/button/demo.html'],
];

(async () => {
  const b = await launch();
  let bad = 0, checked = 0;
  for (const [name, rel] of PAGES) {
    const p = await b.newPage();
    await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 2,
                          isMobile: true, hasTouch: true });
    try {
      await p.goto('http://127.0.0.1:8000' + rel,
                   { waitUntil: 'networkidle0', timeout: 12000 });
    } catch (e) { await p.close(); continue; }
    for (const [sel, label] of TARGETS) {
      const v = await p.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return cs.webkitTapHighlightColor ||
               cs.getPropertyValue('-webkit-tap-highlight-color');
      }, sel);
      if (v === null) continue;
      checked++;
      const off = (v === 'rgba(0, 0, 0, 0)' || v === 'transparent');
      if (!off) { bad++; console.log('  ❌ ' + name + ' · ' + label + ' = ' + v); }
    }
    await p.close();
  }
  await b.close();
  console.log('  检查了 ' + checked + ' 个可点元素（' + PAGES.length + ' 个页面）');
  if (bad) {
    console.log('  ❌ ' + bad + ' 处 iOS 点击高亮未关闭');
    console.log('');
    console.log('  🔴 iOS Safari 默认会给被点击元素加半透明灰黑遮罩（约 18% 黑），');
    console.log('     遮罩**跟着元素形状与圆角** ⇒ 圆角方块会显示成「纺锤形」。');
    console.log('     修法：`01-tokens/tokens.css` 里对可点元素加');
    console.log('          `-webkit-tap-highlight-color: transparent;`');
    console.log('     ⚠️ 桌面的 Chrome 看不到这个问题 ⇒ **必须有门禁，否则必然复发**。');
    process.exit(1);
  }
  console.log('  ✅ 全部可点元素的 iOS 点击高亮已关闭（不会出现纺锤形灰黑遮罩）');
})();
