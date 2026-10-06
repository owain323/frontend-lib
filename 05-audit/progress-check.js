const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * progress-check.js — 进度条契约
 *
 * ============================================================================
 * ⭐ 为什么这个组件的判据要自己写死
 * ---------------------------------------------------------------------------
 *   进度条**没有文字**（数字都在 aria-hidden 的 span 里）⇒ 通用契约的
 *   文字对比度判据全部不适用。而它自己最该被验的三件事，通用契约一条都不查：
 *     ① role/aria-valuenow 齐全（读屏要能念出进度 —— **无障碍红线**）
 *     ② 不确定态**不能**显示百分比（显示假的百分比是"撒谎"）
 *     ③ 动画尊重 prefers-reduced-motion，且**停掉后条子仍可见**
 */
(async () => {
  const r = await kit.check({
    name: 'progress',
    url: 'http://127.0.0.1:8000/02-primitives/progress/demo.html',
    dir: REPO + '/02-primitives/progress',
    primary: '.progress',

    /* 🔴 纯展示组件（进度条本身不可点、不可聚焦）⇒ 显式豁免两条通用判据 */
    interactive: '.progress:not([tabindex]), .progress__bar, .progress-ring',
    skipFocusRing: true,
    note: 'progress 是纯展示组件（不可交互），焦点环与命中区不适用',

    extra: {
      /* ---------- ① 无障碍：role + aria-valuenow（红线）---------- */
      '每个进度条都有 role=progressbar 与可读的 aria 值': async (p) => {
        const v = await p.evaluate(() => {
          const list = [...document.querySelectorAll('.progress, .progress-ring, .progress-steps')];
          const bad = [];
          for (const el of list) {
            const role = el.getAttribute('role');
            const label = el.getAttribute('aria-label');
            const busy = el.getAttribute('aria-busy') === 'true';
            const now = el.getAttribute('aria-valuenow');
            /* 不确定态（aria-busy）可以不设 valuenow —— 那是诚实的 */
            if (role !== 'progressbar') { bad.push('缺 role'); continue; }
            if (!label && !el.getAttribute('aria-labelledby')) { bad.push('缺 aria-label'); continue; }
            if (!busy && (now === null || now === '')) { bad.push('确定态缺 aria-valuenow'); }
          }
          return { total: list.length, bad: bad };
        });
        if (v.total === 0) return { ok: false, why: 'demo 里找不到进度条' };
        if (v.bad.length) {
          return { ok: false, why: v.bad.length + ' 处问题：' +
            [...new Set(v.bad)].slice(0, 3).join(' / ') };
        }
        return { ok: true, why: v.total + ' 个进度条的无障碍属性齐全' };
      },

      /* ---------- ② 不确定态不能显示百分比（不撒谎）---------- */
      '不确定态不显示百分比（不撒谎）': async (p) => {
        const v = await p.evaluate(() => {
          const ind = [...document.querySelectorAll('[aria-busy="true"]')];
          if (!ind.length) return { n: 0 };
          const bad = [];
          for (const el of ind) {
            /* 不确定态里若出现 "85%" 这类文本，就是撒谎 */
            const t = (el.textContent || '').trim();
            if (/\d+\s*%/.test(t)) bad.push(t.slice(0, 12));
            /* 也不该有 aria-valuenow（它暗示"知道进度"） */
            if (el.getAttribute('aria-valuenow') !== null) {
              bad.push('aria-valuenow=' + el.getAttribute('aria-valuenow'));
            }
          }
          return { n: ind.length, bad: bad };
        });
        if (v.n === 0) return { ok: false, why: 'demo 里找不到不确定态（aria-busy）' };
        if (v.bad.length) {
          return { ok: false, why: v.bad.length + ' 处：不确定态却显示了进度值 ⇒ ' +
            '读屏会念出假的百分比' };
        }
        return { ok: true, why: v.n + ' 个不确定态均未显示进度值' };
      },

      /* ---------- ③ 减少动态效果：动画停掉但条子仍可见 ---------- */
      '减少动态效果时动画停、条子仍可见': async (p) => {
        const v = await p.evaluate(() => {
          const bar = document.querySelector('.progress--indeterminate .progress__bar');
          if (!bar) return null;
          const cs = getComputedStyle(bar, '::after');
          const self = getComputedStyle(bar);
          const r = bar.getBoundingClientRect();
          return {
            anim: self.animationName,
            dur: self.animationDuration,
            w: Math.round(r.width),
            /* 条子自身要有宽度（= 看得见）*/
            bg: self.backgroundColor,
          };
        });
        if (!v) return { ok: false, why: 'demo 里找不到不确定态的条子' };
        if (v.anim && v.anim !== 'none') {
          return { ok: false, why: 'reduce 下动画仍在跑（' + v.anim + '）⇒ 违反 WCAG 2.3.3' };
        }
        if (v.w < 10) {
          return { ok: false, why: 'reduce 下条子宽度 ' + v.w + 'px ⇒ 几乎看不见，' +
            '用户不知道系统在忙' };
        }
        return { ok: true, why: '动画已停，条子仍有 ' + v.w + 'px 宽（可见）' };
      },

      /* ---------- ④ 形态齐全 ---------- */
      '四种形态齐全': async (p) => {
        const v = await p.evaluate(() => ({
          line: document.querySelectorAll('.progress__bar').length,
          ring: document.querySelectorAll('.progress-ring').length,
          indet: document.querySelectorAll('.progress--indeterminate').length,
          steps: document.querySelectorAll('.progress-steps').length,
          variants: document.querySelectorAll(
            '.progress--success,.progress--warning,.progress--danger').length,
        }));
        const miss = [];
        if (!v.line) miss.push('线形');
        if (!v.ring) miss.push('环形');
        if (!v.indet) miss.push('不确定');
        if (!v.steps) miss.push('步骤分段');
        if (v.variants < 3) miss.push('语义色变体（需 3 个）');
        if (miss.length) return { ok: false, why: '缺少：' + miss.join(', ') };
        return { ok: true, why: '线形/环形/不确定/步骤 + 3 个语义色齐全' };
      },
    },
  });
  process.exit(r ? 0 : 1);
})();
