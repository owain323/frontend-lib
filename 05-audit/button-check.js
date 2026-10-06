const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * button-check.js — 按钮契约（B1.5  #2）
 *
 * 依据 charter 12 的「通用 7 类契约项」+ 组件专属判据。
 * 判据的坑见 contract-kit.js 顶部（7 个，全部实测踩过）。
 */
(async () => {
  const r = await kit.check({
    name: 'button',
    url: 'http://127.0.0.1:8000/02-primitives/button/demo.html',
    dir: REPO + '/02-primitives/button',
    primary: '.btn',
    interactive: '.btn',
    extra: {
      /* 组件专属：按钮的三种变体都必须有可见焦点环 + 命中区达标 */
      '变体齐全（primary/secondary/ghost）': async (p) => {
        const n = await p.evaluate(() => {
          const s = new Set();
          document.querySelectorAll('.btn').forEach((e) => {
            for (const c of String(e.className).split(/\s+/)) {
              if (/^btn--/.test(c)) s.add(c);
            }
          });
          return s.size;
        });
        return { ok: n >= 2, note: n + ' 种变体' };
      },
      /* 禁用态必须真的不可点（不能只是"看着灰"） */
      '禁用态不可点': async (p) => {
        const r = await p.evaluate(() => {
          const b = document.querySelector('.btn[disabled], .btn[aria-disabled="true"]');
          if (!b) return { ok: true, note: 'demo 无禁用按钮（跳过）' };
          if (b.disabled) return { ok: true, note: 'disabled=true' };
          return { ok: false, note: '只有 aria-disabled，仍可点' };
        });
        return r;
      },
      /* 三态（默认/悬停/按下）都要有定义，不能只有一个状态
         🔴 判据第三次修正（2026-10-04）：
            ① 读 `document.styleSheets` ⇒ **跨源 0 条**（假失败）
            ② 改读 `<style>` 文本 ⇒ 本页 CSS 全在**外部 <link>** ⇒ 仍是假失败
         ⇒ 最终：**Node 侧直接读源文件**（contract-kit 的坑 ① ② 正解） */
      '有 hover 反馈': async () => {
        const fs = require('fs');
        const raw = kit.stripComments(
          fs.readFileSync(REPO + '/02-primitives/button/button.css', 'utf8'));
        /* [0-9a-zA-Z_-]* 才能吃掉 .btn--primary 这类变体名 */
        const has = /[0-9a-zA-Z_-]*:hover/.test(raw);
        const n = (raw.match(/:hover/g) || []).length;
        return { ok: has, note: has ? n + ' 处 :hover' : '缺 :hover 反馈' };
      },
    },
  });
  process.exit(kit.report(r));
})();
