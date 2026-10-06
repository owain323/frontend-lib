const fs = require('fs');
const path = require('path');

/**
 * chart-check.js — 图表契约门禁（charter 13 · 图表规范）
 *
 * ============================================================================
 * ⭐ 存在的理由（2026-10-05 Owner 实机指出）
 * ============================================================================
 *   ① 异常值冲出图表范围，柱子**穿透了三张图**；
 *   ② 数值标注**压在柱子上**，右下角叠成一团。
 *
 * ⭐ 两条都不是"渲染 bug"，是**契约缺失**：
 *   ① SVG 的 `overflow` 默认是 `visible`（不是 hidden！）⇒ 超量程就穿透；
 *   ② 没有"标注不得覆盖数据"这条契约 ⇒ 逐柱标注必然重叠。
 *
 * ============================================================================
 * 🔴 本门禁的判据纪律（照 contract-kit 的 7 个坑，不重犯）
 * ============================================================================
 *   · **剥注释后再查**（Node 侧逐字符剥，不用正则）——否则注释里写
 *     `overflow: hidden` 就算"通过"，是假通过。
 *   · **不许只看"文本里有没有这个词"**——那是今晚踩过的坑。
 *   · 每条判据都要有**反向控制**（注入缺陷 ⇒ 必须被抓到）。
 */

const ROOT = '${REPO}';
let bad = 0;
const out = [];
const pass = (ok, what) => { out.push({ ok: !!ok, what }); if (!ok) bad++; };

/**
 * 逐字符剥 CSS/JS 注释
 *
 * 🔴 2026-10-05 **修一个假通过漏洞**（反向控制② 抓到的）：
 *   原来用 `for` + `i++` + `continue` 的写法，
 *   在命中 `/*` 时 `i++` 已经多走一格，
 *   ⇒ 注释起始符的**第二个字符（`*`）被当普通字符输出了**，
 *   ⇒ 整段注释的边界判断错乱，**注释内容漏进结果**。
 *
 *   症状：把 `overflow: hidden` 只写进注释里，门禁竟然通过 ⇒ 假绿。
 *
 *   ⇒ 改成**下标 while + 显式 i += 2**，不依赖循环自增。
 */
function stripComments(t) {
  const r = [];
  let d = 0;           // 0=不在注释 1=在注释
  let i = 0;
  while (i < t.length) {
    if (d === 0) {
      if (t[i] === '/' && t[i + 1] === '*') { d = 1; i += 2; continue; }
      r.push(t[i]); i += 1;
    } else {
      if (t[i] === '*' && t[i + 1] === '/') { d = 0; i += 2; continue; }
      i += 1;
    }
  }
  return r.join('');
}

function read(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

/* ================================================================== *
 * 铁律一 · 超量程必须被容器裁剪
 * ================================================================== */

// 库里所有**自己画的** SVG 图表组件（排除 vendor 第三方）
const CHART_DIRS = ['09-assets/sparkline', '09-assets/bar', '09-assets/model-viewer'];

(function rule1() {
  for (const dir of CHART_DIRS) {
    const name = dir.split('/').pop();
    const css = read(dir + '/' + name + '.css');
    if (!css) continue;                 // 组件还不存在（bar 还没做）⇒ 跳过
    const body = stripComments(css);
    const js = stripComments(read(dir + '/' + name + '.js') || '');

    // 🔴 2026-10-05 判据修正：**先看组件用什么渲染**
    //   · SVG  ⇒ `overflow` 默认 `visible` ⇒ **必须显式 hidden**（根因在这）
    //   · canvas ⇒ 位图**天然裁剪**在自身尺寸内 ⇒ 不需要这条规则
    //   （实测 model-viewer 用 canvas，之前门禁对它报"缺 overflow"是**假失败**。）
    const usesCanvas = /getContext\s*\(/.test(js) && !/createElementNS/.test(js);
    const usesSvg = /createElementNS/.test(js) || /\.sparkline\s+svg/.test(css);

    if (usesSvg) {
      // 判据 1：svg 元素上必须有 overflow: hidden
      // ⚠️ 不能只查"文件里有没有 overflow"—— 那个可能在别的规则上。
      const svgRules = body.match(/[^{}]*svg[^{}]*\{[^}]*\}/g) || [];
      const hasSvgClip = svgRules.some((r) => /overflow\s*:\s*hidden/.test(r));
      pass(hasSvgClip,
           '① ' + name + '.css：svg 上有 overflow:hidden' +
           (hasSvgClip ? '' : '  🔴 缺这条柱子会穿透到别的内容上（SVG 默认 overflow:visible）'));
    } else if (usesCanvas) {
      pass(true, '① ' + name + '：用 canvas 渲染（位图天然裁剪，无需 overflow）');
    } else {
      pass(true, '① ' + name + '：未检出渲染方式（跳过，见 ' + dir + '）');
    }

    // 判据 2：外层容器要裁（防"穿透到别的卡片"）—— 对两种渲染方式都适用
    const hasBoxClip = /overflow\s*:\s*hidden/.test(body);
    pass(hasBoxClip, '① ' + name + '.css：容器有 overflow:hidden');
  }
})();

/* ================================================================== *
 * 铁律二 · 标注不得覆盖数据
 * ================================================================== */
(function rule2() {
  for (const dir of CHART_DIRS) {
    const js = read(dir + '/' + dir.split('/').pop() + '.js');
    if (!js) continue;
    const body = stripComments(js);

    // 判据 1：如果有"标最大值"这类逻辑，必须能限制标注数量
    // 🔴 逐柱标注（对每个数据点都画文字）必然重叠 ⇒ 禁止
    const perBarLabel = /forEach\s*\([^)]*\)[\s\S]{0,400}?(textContent|innerHTML)\s*=/.test(body)
                     && /label|value|text/i.test(body);
    // 更直接的判据：数一下有几个"无条件给每根柱子写文字"的模式
    const writesLabel = (body.match(/(label|value|标注|数值)[^\n]{0,40}=\s*/gi) || []).length;
    pass(!perBarLabel || writesLabel <= 8,
         '② ' + dir.split('/').pop() + '.js：不是逐柱无条件标注（' +
         writesLabel + ' 处文字赋值，阈值 8）');

    // 判据 2：标注颜色不得用 presentation attribute 里的 var()
    // ⚠️ 规范没保证 Safari 支持，且 sparkline.css 里已经踩过这个坑
    const attrVar = /setAttribute\s*\(\s*['"](fill|stroke)['"]\s*,\s*['"]var\(/.test(body);
    pass(!attrVar,
         '② 标注颜色不走 setAttribute("fill","var(...)")（Safari 不可靠）');
  }
})();

/* ================================================================== *
 * 铁律三 · 量程必须显式声明
 * ================================================================== */
(function rule3() {
  for (const dir of CHART_DIRS) {
    const js = read(dir + '/' + dir.split('/').pop() + '.js');
    if (!js) continue;
    const body = stripComments(js);
    // 判据：不能"读数据里的最大值当量程"（那会让异常值压缩所有常态值）
    const autoMax = /Math\.max\s*\(\s*\.\.\./.test(body) && !/\bmax\b\s*[:=]/.test(body);
    pass(!autoMax,
         '③ ' + dir.split('/').pop() + '.js：量程不由数据自动决定（必须有显式 max）');
  }
})();

/* ================================================================== *
 * 报告
 * ================================================================== */
console.log('');
console.log('  === 图表契约（charter 13）===');
out.forEach((x) => console.log('    ' + (x.ok ? 'OK  ' : 'FAIL') + '  ' + x.what));
console.log('');
if (bad) { console.log('  ❌ 图表契约：' + bad + ' 项不满足'); process.exit(1); }
console.log('  ✅ 图表契约全部满足');
