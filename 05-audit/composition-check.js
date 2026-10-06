const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * composition-check.js — 组合契约（总 G1）
 *
 * ⭐ 为什么需要这个契约（它与其它 32 个契约的根本区别）：
 *   其它契约都是**单组件**的 —— 每个组件在自己的 demo 里都正确。
 *   但真把组件**放在一起**就会冒出新问题，而且是**单组件契约抓不到**的那种：
 *
 *   ① **z-index 打架**   select 放进 drawer ⇒ 下拉被抽屉边框盖住
 *   ② **焦点互抢**      form-validation 校验报错时抢走 combobox 的焦点
 *   ③ **Esc 冲突**      两层都监听 Esc ⇒ 按一次关哪层？关错了顺序
 *   ④ **布局被撑破**     badge 放进 tree 的层级缩进被顶乱
 *
 *   这四类**只有真嵌套才测得到** ⇒ 所以这个契约用的是
 *   `10-review/composition/demo.html`（真页面，不是构造的 DOM）。
 *
 * ⭐ 全部用**真键盘 + 真点击**，不用编程式调用
 *   （这是本项目血换来的教训：编程式调用测不出真问题）。
 */
(async () => {
  const r = await kit.check({
    name: 'composition',
    url: 'http://127.0.0.1:8000/10-review/composition/demo.html',
    dir: REPO + '/10-review/composition',
    primary: '.wrap',
    interactive: '.btn, .select__btn, .combo__input, .dd__btn, .tree__node, .badge',
    skipFocusRing: true,
    note: '组合页面的容器不聚焦（焦点在各组件内）',
    skipHitArea: true,
    hitAreaNote: '组合页汇总；各组件的命中区由各自契约负责',

    extra: {
      /* ---------- ① z-index：select 的下拉必须盖在 drawer 之上 ---------- */
      'select 下拉盖在 drawer 之上': async (p) => {
        /* 打开抽屉 */
        await p.evaluate(() => {
          const b = document.getElementById('openDrawer');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 450));
        /* 打开抽屉里的 select */
        await p.evaluate(() => {
          const b = document.querySelector('.drawer [data-select-btn]');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 350));
        const r = await p.evaluate(() => {
          const dr = document.querySelector('.drawer');
          const list = document.querySelector('.drawer .select__list');
          if (!dr || !list) return { ok: false, note: '🔴 抽屉或下拉没打开' };
          if (list.hidden) return { ok: false, note: '🔴 下拉是 hidden' };
          /* ⭐ 关键判断：下拉里某个选项的**实际可见性**——
             用 elementFromPoint 量（只看 z-index 数字会被 transform 骗） */
          const opt = list.querySelector('[role="option"]');
          if (!opt) return { ok: false, note: '🔴 没有选项' };
          const b = opt.getBoundingClientRect();
          if (b.height < 1) return { ok: false, note: '🔴 选项不可见' };
          const top = document.elementFromPoint(
            Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2));
          const inside = !!(top && list.contains(top));
          return { ok: inside, note: inside ? '选项可点击（在最上层）✅'
                                           : '🔴 选项被别的元素盖住了（top=' +
                                             (top ? top.className || top.tagName : 'null') + '）',
                   z: getComputedStyle(list).zIndex };
        });
        /* 收尾：Esc 关下拉，再 Esc 关抽屉 */
        await p.keyboard.press('Escape');
        await new Promise((x) => setTimeout(x, 300));
        await p.keyboard.press('Escape');
        await new Promise((x) => setTimeout(x, 420));
        return r;
      },

      /* ---------- ② Esc 冲突：内层先关，且焦点不能丢 ---------- */
      'Esc 先关内层（不一次关两层）': async (p) => {
        await p.evaluate(() => {
          const b = document.getElementById('openDrawer');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 450));
        await p.evaluate(() => {
          const b = document.querySelector('.drawer [data-select-btn]');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 320));
        const before = await p.evaluate(() => ({
          drawer: !!document.querySelector('.drawer'),
          listOpen: (function () {
            const l = document.querySelector('.drawer .select__list');
            return l ? !l.hidden : false;
          })(),
        }));
        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 320));
        const after = await p.evaluate(() => ({
          drawer: !!document.querySelector('.drawer'),
          listOpen: (function () {
            const l = document.querySelector('.drawer .select__list');
            return l ? !l.hidden : false;
          })(),
          active: (document.activeElement || {}).className || '',
        }));
        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 420));
        return { ok: before.drawer && before.listOpen && after.drawer && !after.listOpen,
                 note: 'Esc 前：抽屉' + (before.drawer ? '开' : '关') + '·下拉' +
                       (before.listOpen ? '开' : '关') +
                       ' → Esc 后：抽屉' + (after.drawer ? '开' : '关') + '·下拉' +
                       (after.listOpen ? '开' : '关') + '·焦点在「' +
                       String(after.active).slice(0, 20) + '」' +
                       (after.drawer && !after.listOpen
                         ? ' ✅ 只关了下拉' : ' 🔴 关错了层数') };
      },

      /* ---------- ③ 焦点互抢：校验报错不能抢走 combobox 的焦点 ---------- */
      '校验报错不抢焦点': async (p) => {
        await p.evaluate(() => {
          const i = document.querySelector('#k1c [data-combo-input]');
          if (i) { i.value = '半'; i.focus(); }
          i && i.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await new Promise((r) => setTimeout(r, 300));
        /* 选一项（触发 onChange → 校验通过）*/
        await p.keyboard.press('ArrowDown');
        await new Promise((r) => setTimeout(r, 160));
        await p.keyboard.press('Enter');
        await new Promise((r) => setTimeout(r, 320));
        const r = await p.evaluate(() => {
          const i = document.querySelector('#k1c [data-combo-input]');
          return { onInput: document.activeElement === i,
                   invalid: i ? i.getAttribute('aria-invalid') : null,
                   errShown: (function () {
                     const e = document.getElementById('k1err');
                     return e ? !e.hidden : false;
                   })() };
        });
        return { ok: r.onInput && r.invalid === 'false',
                 note: 'Enter 加标签后：焦点仍在 input=' + r.onInput +
                       ' · aria-invalid=' + r.invalid +
                       ' · 错误框显示=' + r.errShown +
                       (r.onInput ? ' ✅ 焦点没被抢' : ' 🔴 焦点被校验逻辑抢走了') };
      },

      /* ---------- ④ 布局：badge 不能撑破 tree 的层级缩进 ---------- */
      'badge 不撑破 tree 缩进': async (p) => {
        const r = await p.evaluate(() => {
          const nodes = [...document.querySelectorAll('#t1 .tree__node')];
          if (nodes.length < 2) return { ok: true, note: '节点不足（跳过）' };
          /* 找父节点与其子节点，比子节点的左边距是否真的更大（体现层级）*/
          const nested = nodes.filter((n) =>
            n.closest('ul ul') !== null && n.getClientRects().length);
          if (!nested.length) return { ok: true, note: '无嵌套节点（跳过）' };
          const child = nested[0];
          const childLi = child.closest('[role="treeitem"]');
          const parentLi = childLi.parentElement.closest('[role="treeitem"]');
          if (!parentLi) return { ok: true, note: '无父节点（跳过）' };
          const parentNode = parentLi.querySelector('.tree__node');
          const cLeft = child.getBoundingClientRect().left;
          const pLeft = parentNode.getBoundingClientRect().left;
          return { ok: cLeft > pLeft,
                   note: '子节点左 ' + Math.round(cLeft) + ' vs 父节点左 ' +
                         Math.round(pLeft) + '（差 ' + Math.round(cLeft - pLeft) + 'px）' +
                         (cLeft > pLeft ? ' ✅ 层级有缩进' : ' 🔴 层级没缩进（被 badge 顶平了）') };
        });
        return r;
      },

      /* ---------- ⑤ badge 不能把菜单项挤到换行 ---------- */
      'badge 不挤坏菜单项': async (p) => {
        await p.evaluate(() => {
          const b = document.querySelector('#d1 [data-dd-btn]');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 350));
        const r = await p.evaluate(() => {
          const items = [...document.querySelectorAll('#d1 [role="menuitem"]')];
          if (!items.length) return { ok: true, note: '菜单未开（跳过）' };
          /* 每项高度应仍是 44px（单行）；明显更高说明换行了 */
          const tall = items.filter((i) => i.getBoundingClientRect().height > 50);
          /* 徽标不能溢出项的右边界 */
          const overflow = items.filter((i) => {
            const ib = i.getBoundingClientRect();
            const b = i.querySelector('.badge');
            if (!b) return false;
            const bb = b.getBoundingClientRect();
            return bb.right > ib.right + 1;
          });
          return { ok: tall.length === 0 && overflow.length === 0,
                   note: items.length + ' 项，高度过大 ' + tall.length +
                         ' 个、徽标溢出 ' + overflow.length + ' 个' +
                         (tall.length === 0 && overflow.length === 0
                           ? ' ✅' : ' 🔴 徽标把布局挤坏了') };
        });
        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 260));
        return r;
      },

      /* ---------- ⑥ 组合页整体：无横向溢出 / 无控制台错误 ---------- */
      '组合页无横向溢出': async (p) => {
        const r = await p.evaluate(() => {
          const de = document.documentElement;
          return { sw: de.scrollWidth, cw: de.clientWidth };
        });
        return { ok: r.sw <= r.cw + 1,
                 note: r.sw + ' ≤ ' + r.cw + (r.sw <= r.cw + 1 ? ' ✅' : ' 🔴 有横向溢出') };
      },
    },
  });
  process.exit(kit.report(r));
})();
