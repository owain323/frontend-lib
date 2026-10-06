const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * content-check.js — 内容容器契约（总 A3）
 *
 * ⭐ 正文容器的核心风险是**标题层级乱跳**：
 *   h1 直接到 h3，读屏用户按 H 键跳转会"漏掉"一节，
 *   依赖标题层级的工具（大纲、目录生成）也会出错。
 */
(async () => {
  const r = await kit.check({
    name: 'content',
    url: 'http://127.0.0.1:8000/03-patterns/content/demo.html',
    dir: REPO + '/03-patterns/content',
    primary: '.prose',
    interactive: '.prose a, .prose button',
    skipFocusRing: true,
    note: 'content 是纯展示容器（正文/标题/段落），本身不可聚焦',
    /* 🔴 正文里的行内链接不适用 44×44：
       它在文字流里，给 44px 高会把行距撑乱。
       WCAG 2.5.5 管的是「指针目标」，正文链接靠**行高 + 间距**保证。 */
    skipHitArea: true,
    hitAreaNote: '正文行内链接在文字流中，靠行高与间距保证（不强制 44×44）',

    extra: {
      '标题层级不跳级': async (p) => {
        const r = await p.evaluate(() => {
          const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
            .filter((h) => h.getClientRects().length);
          if (!hs.length) return { ok: true, note: '页面无标题（跳过）' };
          const seq = hs.map((h) => +h.tagName[1]);
          const jumps = [];
          for (let i = 1; i < seq.length; i++) {
            if (seq[i] - seq[i - 1] > 1) {
              jumps.push('h' + seq[i - 1] + '→h' + seq[i] +
                         '（' + (hs[i].textContent || '').trim().slice(0, 10) + '）');
            }
          }
          return { ok: jumps.length === 0,
                   note: hs.length + ' 个标题，' + jumps.length + ' 处跳级' +
                         (jumps.length ? '：' + jumps.join('; ') : '') };
        });
        return r;
      },

      '页面只有一个 h1': async (p) => {
        const r = await p.evaluate(() => {
          const h1 = [...document.querySelectorAll('h1')].filter((h) => h.getClientRects().length);
          return { ok: h1.length <= 1,
                   note: h1.length + ' 个 h1' +
                         (h1.length > 1 ? '（多个 h1 会让读屏的"页面标题"不确定）' : '') };
        });
        return r;
      },

      '表格有标题（th/summary/caption）': async (p) => {
        const r = await p.evaluate(() => {
          const tables = [...document.querySelectorAll('table')].filter((t) => t.getClientRects().length);
          if (!tables.length) return { ok: true, note: '无表格（跳过）' };
          const bad = tables.filter((t) => !t.querySelector('th') && !t.querySelector('caption'));
          return { ok: bad.length === 0,
                   note: tables.length + ' 个表格，' + bad.length + ' 个缺 th/caption' };
        });
        return r;
      },

      /* 定义列表用 dl/dt/dd
         🔴 判据两次收紧（都是误判逼的）：
            ① 原版：把**任何**含 `<b>` 的 `<p>` 都当违规 ⇒ 普通加粗也被判。
            ② 收紧一版：只查「含冒号」⇒ 又把「元素：**结构用标准**（…）」这种
               **句中冒号**误判成定义项。
            ⇒ 真正的定义项形态是「**加粗的名字 + 冒号 + 紧跟值**」：
                 <p><b>名称</b>：值…</p>
               判据 = 冒号**紧跟在加粗标签之后**（中间没有别的字）。
         */
      '定义列表用 dl/dt/dd': async (p) => {
        const r = await p.evaluate(() => {
          const dts = document.querySelectorAll('dt');
          const faux = [...document.querySelectorAll('p')].filter((el) => {
            if (el.closest('dl')) return false;
            const b = el.querySelector('b,strong');
            if (!b) return false;
            /* ⭐ 冒号必须**紧跟加粗标签**（中间无文字）才是「名：值」 */
            let n = b.nextSibling;
            while (n && n.nodeType === 3 && !n.textContent.trim()) n = n.nextSibling;
            const after = (n && n.textContent || '').trim();
            return /^[:：]/.test(after);
          });
          return { ok: dts.length > 0 || faux.length === 0,
                   note: dts.length + ' 个 <dt>，' + faux.length + ' 处「<b>名</b>：值」却没用 dl' +
                         (faux.length ? '（读屏读不出术语/定义关系）' : '') };
        });
        return r;
      },
    },
  });
  process.exit(kit.report(r));
})();
