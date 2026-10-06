const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * list-check.js — 列表契约（总 A2）
 *
 * ⭐ 列表的核心风险是「**用 div 假装是列表**」：
 *   读屏用户按"列表项"键（Ctrl+Alt+Shift+↓）时，什么都跳不过去；
 *   有序列表的序号也是**语义的一部分**，手写数字会读成"1. "再读一遍内容。
 */
(async () => {
  const r = await kit.check({
    name: 'list',
    url: 'http://127.0.0.1:8000/03-patterns/list/demo.html',
    dir: REPO + '/03-patterns/list',
    primary: '.list',
    interactive: '.list a, .list button, .list [tabindex]',

    extra: {
      /* ① 列表必须用真列表标签或 role=list */
      '用真列表标签（ul/ol/role=list）': async (p) => {
        const r = await p.evaluate(() => {
          const lists = [...document.querySelectorAll('.list')];
          if (!lists.length) return { ok: false, note: '没有 .list' };
          const bad = lists.filter((e) => {
            const tag = e.tagName;
            const role = e.getAttribute('role');
            const okTag = ['UL', 'OL', 'DL'].indexOf(tag) >= 0;
            const okRole = role === 'list';
            return !okTag && !okRole;
          });
          return { ok: bad.length === 0,
                   note: lists.length + ' 个列表，' +
                         lists.filter(e => ['UL','OL','DL'].indexOf(e.tagName) >= 0).length +
                         ' 个用语义标签，' + bad.length + ' 个无语义' +
                         (bad.length ? '：<' + bad[0].tagName.toLowerCase() + '>' : '') };
        });
        return r;
      },

      /* ② 列表项：<li> 或 role=listitem
         ⚠️ 特别要抓：**ul 里直接放 div**（浏览器不会渲染成列表项） */
      '列表项用 li 或 role=listitem': async (p) => {
        const r = await p.evaluate(() => {
          const lists = [...document.querySelectorAll('.list')]
            .filter((e) => ['UL', 'OL', 'DL'].indexOf(e.tagName) >= 0
                        || e.getAttribute('role') === 'list');
          let total = 0, bad = 0, sample = '';
          lists.forEach((L) => {
            [...L.children].forEach((c) => {
              if (c.getAttribute('role') === 'presentation') return;
              total++;
              const ok = c.tagName === 'LI' || c.getAttribute('role') === 'listitem';
              if (!ok) { bad++; if (!sample) sample = '<' + c.tagName.toLowerCase() + '>'; }
            });
          });
          return { ok: bad === 0,
                   note: total + ' 个子元素，' + bad + ' 个不是列表项' +
                         (sample ? '（如 ' + sample + '）' : '') };
        });
        return r;
      },

      /* ③ ⭐ 有序列表的序号**必须交给浏览器**，不能手写
         手写 "1. " 的后果：读屏会先念"1"，再念"1. 标题" ⇒ 重复；
         而且复制粘贴、筛选后序号全错。 */
      '有序列表序号不手写': async (p) => {
        const r = await p.evaluate(() => {
          const ols = [...document.querySelectorAll('ol')];
          if (!ols.length) return { ok: true, note: 'demo 无 <ol>（跳过）' };
          const bad = ols.filter((o) => {
            /* 序号写在 HTML 里（<li>1. xxx）或用绝对定位画数字 */
            return /^\s*\d+[.、)]/.test(o.textContent || '') ||
                   o.querySelector('[class*="num"],[class*="index"],[class*="order"]');
          });
          return { ok: bad.length === 0,
                   note: bad.length ? '🔴 ' + bad.length + ' 个 <ol> 手写了序号' : '序号交给 <ol> 本身' };
        });
        return r;
      },

      /* ④ 交互列表项（可点击的 li）必须能被键盘到达
         ⛔ 最常见的错：整行 <li onclick>，键盘 Tab 不到 */
      '可点击项键盘可达': async (p) => {
        const r = await p.evaluate(() => {
          const rows = [...document.querySelectorAll('.list li, [role="listitem"]')];
          const clickable = rows.filter((e) =>
            e.onclick || e.getAttribute('tabindex') !== null ||
            e.querySelector('a, button, [tabindex]:not([tabindex="-1"])'));
          if (!clickable.length) return { ok: true, note: '列表项不可点（静态列表，跳过）' };
          const bad = clickable.filter((e) => {
            const hasInner = e.querySelector('a, button, [tabindex]:not([tabindex="-1"])');
            const selfFocus = e.getAttribute('tabindex') !== null &&
                              e.getAttribute('tabindex') !== '-1';
            return !hasInner && !selfFocus;
          });
          return { ok: bad.length === 0,
                   note: clickable.length + ' 个可点项，' +
                         bad.length + ' 个键盘不可达' +
                         (bad.length ? '（role/listitem onclick 无 tabindex）' : '') };
        });
        return r;
      },

      /* ⑤ 列表不能只有视觉分隔（.list--bare）而没有语义提示 */
      '描述列表用 dl（dt/dd）': async (p) => {
        const r = await p.evaluate(() => {
          const dl = [...document.querySelectorAll('dl')];
          if (!dl.length) return { ok: true, note: '无 <dl>（跳过）' };
          const bad = dl.filter((d) => !d.querySelector('dt') || !d.querySelector('dd'));
          return { ok: bad.length === 0,
                   note: dl.length + ' 个 <dl>，' + bad.length + ' 个缺 dt/dd' };
        });
        return r;
      },
    },
  });
  process.exit(kit.report(r));
})();
