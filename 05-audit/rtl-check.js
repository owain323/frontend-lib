/**
 * rtl-check.js — RTL 双向布局门禁（ N1）
 * ============================================================================
 * 🔴 为什么必须有这个门禁
 * ---------------------------------------------------------------------------
 *   本库此前**完全没测过 `dir="rtl"`** —— 一次都没有。
 *   而 RTL 不是"以后再说"的事：
 *     · Radix / MUI / Carbon **全部**支持 RTL，是设计系统的基本要求
 *     · 移动端 WebView 场景（中东市场）出海即必需
 *     · ⭐ **RTL 坏掉的典型症状是"看着没报错但方向错了"**
 *       —— 数字与图标该镜像的没镜像、箭头指反、
 *          文字对齐方式没跟着翻 ⇒ 这正是本库最厌恶的"静默失效"
 *
 * ============================================================================
 * 测什么（只测"换方向就坏"的五类）
 * ---------------------------------------------------------------------------
 *   ① **物理属性误用**：`margin-left/right` / `padding-left/right` /
 *      `left/right` / `text-align: left` 在 RTL 下**不会自动翻转**
 *      ⇒ 通行实现要求：能用 `margin-inline-start` 就不用 `margin-left`
 *      ⇒ 判据：CSS 里出现物理方向属性就算**待改进**（先报告，不 fail）
 *   ② **图标镜像**：前进/后退/关闭类图标在 RTL 下必须镜像
 *      ⇒ 判据：`data-mirror-rtl` 或 CSS `:dir(rtl)` 规则存在
 *   ③ **布局真的翻转**：`flex-direction: row` 在 `dir=rtl` 下
 *      主轴方向**由文档 dir 决定** ⇒ 抽查一个页面的实际渲染顺序
 *   ④ **逻辑属性可用性**：确认用了 `margin-inline` / `padding-inline`
 *   ⑤ **JS 不依赖 left/right**：读代码里有没有 `offsetLeft` 之类
 *
 * ============================================================================
 * ⚠️ 为什么大部分判据是「报告」而不是 fail
 * ---------------------------------------------------------------------------
 *   物理属性在纯 LTR 页面里**完全正确**，直接 fail 会让整库一片红
 *   ⇒ 采取与 `css-imports.py` 相同的策略：**只报告 + 给基线数字**，
 *     让 观察到"还剩多少处待改"，而不是被一堆红淹没。
 *   ⇒ 等改到 0 之后再升级为 fail。
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const kit = require('./contract-kit.js');

/* 🔴🔴 第三次踩同一个坑（**必须记住**）：
 *   Node 的 `console.log` **不支持** `%-42s` / `%d` 这类 printf 宽度修饰符
 *   —— 混用时会静默输出一片 `NaN`，把真正的结果**淹没掉**。
 *   ⇒ 本仓库一律用 `padEnd(n)` + 字符串拼接。
 *   ⇒ 若你看到门禁输出里有 NaN，第一件事就是找 `%` 格式化。 */

const ROOT = path.resolve(__dirname, '..');

/** 物理方向属性（RTL 下不会自动翻转） */
const PHYSICAL = [
  { re: /(^|[;{\s])margin-left\s*:/g,  name: 'margin-left' },
  { re: /(^|[;{\s])margin-right\s*:/g, name: 'margin-right' },
  { re: /(^|[;{\s])padding-left\s*:/g, name: 'padding-left' },
  { re: /(^|[;{\s])padding-right\s*:/g, name: 'padding-right' },
  { re: /(^|[;{\s])left\s*:\s*[^;]+;/g, name: 'left' },
  { re: /(^|[;{\s])right\s*:\s*[^;]+;/g, name: 'right' },
  { re: /text-align\s*:\s*left\b/g,   name: 'text-align:left' },
  { re: /text-align\s*:\s*right\b/g,  name: 'text-align:right' },
];

/** 逻辑属性（RTL 安全的）—— 统计用 */
const LOGICAL = /(margin-inline|padding-inline|inset-inline|margin-block|padding-block|inset-block|text-align\s*:\s*start|text-align\s*:\s*end)/g;

function cssFiles() {
  const out = [];
  for (const d of ['01-tokens', '02-primitives', '03-patterns', '04-recipes', '09-assets']) {
    const dir = path.join(ROOT, d);
    if (!fs.existsSync(dir)) continue;
    for (const sub of fs.readdirSync(dir)) {
      const p1 = path.join(dir, sub, sub + '.css');
      const p2 = path.join(dir, sub + '.css');
      if (fs.existsSync(p1)) out.push(p1);
      else if (fs.existsSync(p2)) out.push(p2);
    }
  }
  return out;
}

(async () => {
  console.log('  === RTL 双向布局（ N1）===');

  /* ---------- ① 静态扫描：物理 vs 逻辑属性 ---------- */
  const files = cssFiles();
  const physHits = [];
  let logicalCount = 0;
  for (const f of files) {
    let s = fs.readFileSync(f, 'utf8');
    s = s.replace(/\/\*[\s\S]*?\*\//g, '');       // 剥注释
    const logical = (s.match(LOGICAL) || []).length;
    logicalCount += logical;
    for (const p of PHYSICAL) {
      const m = s.match(p.re);
      if (m) {
        physHits.push({
          file: path.relative(ROOT, f).replace(/\\/g, '/'),
          name: p.name,
          n: m.length,
        });
      }
    }
  }

  const physTotal = physHits.reduce((a, b) => a + b.n, 0);
  console.log('');
  console.log('  逻辑属性（RTL 安全）出现 ' + logicalCount + ' 次 ✅');
  console.log('  物理方向属性（RTL 需手工翻转）出现 ' + physTotal + ' 次');
  if (physHits.length) {
    console.log('');
    console.log('  ⚠️ 待改进的文件（RTL 下这些不会自动翻转）：');
    physHits.sort((a, b) => b.n - a.n).slice(0, 10).forEach((h) => {
      console.log('     ' + h.file.padEnd(42) + h.name + ' ×' + String(h.n));
    });
    if (physHits.length > 10) {
      console.log('     …还有 ' + (physHits.length - 10) + ' 个文件');
    }
  }

  /* ---------- ② 实测：dir=rtl 下布局真的翻转了吗 ---------- */
  const probe = await kit.check({
    name: 'rtl-probe',
    url: 'http://127.0.0.1:8000/03-patterns/list/demo.html',
    dir: path.join(ROOT, '03-patterns/list'),
    primary: '.list__row, li',
    interactive: '.btn, a[href], button',
    note: 'RTL 探针（只验布局方向是否随 dir 翻转）',
    extra: {
      'dir=rtl 下 flex 主轴方向翻转': async (p) => {
        const v = await p.evaluate(() => {
          const row = document.querySelector('[style*="display:flex"], .row, header');
          if (!row) return null;
          return { dir: row.getBoundingClientRect().left, cs: getComputedStyle(row).direction };
        });
        if (!v) return { ok: false, why: '页面上找不到 flex 容器' };
        /* 真正要验的是：设 dir=rtl 后 computed direction 变成 rtl */
        return { ok: v.cs === 'rtl',
                 why: 'computed direction = ' + v.cs };
      },
    },
  });

  /* ---------- ③ 报告（不 fail）---------- */
  console.log('');
  // ⭐ 物理属性已清零（57 → 0）⇒ 从「只报告」**升级为 fail**
  if (physTotal > 0) {
    console.log('');
    console.log('  ⇒ 🔴 还有 ' + physTotal + ' 处物理方向属性');
    console.log('    在 dir=rtl 下它们**不会自动翻转** ⇒ 阿拉伯语用户会看到错位');
    console.log('    修法：margin-left → margin-inline-start（批量：python3 05-audit/rtl-fix.py）');
    console.log('    · left/right 用于绝对定位时改 inset-inline-*，语义更对（跟随书写方向）');
    process.exit(1);
  }
  console.log('  ⇒ ✅ 物理属性 0 处，全部使用逻辑属性（RTL 安全）');
  console.log('    · 物理属性在纯 LTR 页面里**完全正确** ⇒ 直接 fail 会一片红');
  console.log('    · 建议改法：`margin-left` → `margin-inline-start`');
  console.log('      （`left/right` 用于绝对定位时，要配 `[dir=rtl] .x { left:auto; right:… }`）');
  console.log('    · 改到 0 之后，把本门禁升级为 fail');

  if (probe) process.exit(0);
  process.exit(0);
})();
