const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * separator-check.js — 分隔线契约（总 A1）
 *
 * ⭐ separator 是**纯装饰**：一条横线，读者不需要它的存在。
 *   ⇒ 豁免焦点环、豁免命中区。
 *   ⚠️ 但**不能不写任何语义**：要么用 `<hr>`（隐含 role=separator），
 *      要么显式 `role="separator"`。若它落在 role="presentation"/"none"
 *      的祖先里，`<hr>` 的语义会**被剥掉** ⇒ 此时必须显式补 role。
 */
(async () => {
  const r = await kit.check({
    name: 'separator',
    url: 'http://127.0.0.1:8000/02-primitives/separator/demo.html',
    dir: REPO + '/02-primitives/separator',
    primary: '.separator',
    interactive: '.nonexistent-selector',        // 纯装饰：无可点元素
    skipFocusRing: true,
    note: 'separator 是纯装饰线条（<hr> / role=separator），不可聚焦',

    extra: {
      /* ① 语义：要么 <hr>，要么显式 role="separator" */
      '有分隔语义（hr 或 role=separator）': async (p) => {
        const r = await p.evaluate(() => {
          const all = [...document.querySelectorAll('.separator')];
          if (!all.length) return { ok: false, note: '没有 .separator' };
          const bad = all.filter((e) => {
            const hasHr = e.tagName === 'HR';
            const role = e.getAttribute('role');
            return !hasHr && role !== 'separator' && role !== 'none';
          });
          return { ok: bad.length === 0, n: all.length, bad: bad.length,
                   note: all.length + ' 条，' +
                         (all.filter(e => e.tagName === 'HR').length) + ' 条用 <hr>，' +
                         bad.length + ' 条无语义' };
        });
        return r;
      },

      /* ② ⭐ 祖先若是 presentation/none，<hr> 的语义会被剥掉
            ⇒ 这种情况下必须显式补 role="separator"，否则读屏听不到分隔。 */
      '在 presentation 祖先下仍保留语义': async (p) => {
        const r = await p.evaluate(() => {
          const all = [...document.querySelectorAll('.separator')];
          const risky = all.filter((e) => {
            let n = e.parentElement, found = false;
            while (n && n !== document.body) {
              const rl = (n.getAttribute && n.getAttribute('role') || '').toLowerCase();
              if (rl === 'presentation' || rl === 'none') { found = true; break; }
              n = n.parentElement;
            }
            return found;
          });
          /* 有风险却没有显式 role 的 ⇒ 出问题 */
          const bad = risky.filter((e) => e.getAttribute('role') !== 'separator');
          return { ok: bad.length === 0,
                   note: risky.length + ' 条在 presentation 祖先下，' +
                         (risky.length ? risky.filter(e => e.getAttribute('role')==='separator').length + ' 条已显式补 role' : '') +
                         (bad.length ? '  🔴 ' + bad.length + ' 条未补' : '') };
        });
        return r;
      },

      /* ③ 装饰性分隔线不该是 "hr" 且带 title（会被读屏念成"分隔符"噪音）
            —— 但这属于「可选优化」，这里只查没有 role="presentation" 的裸 div */
      '不是裸 div（无语义容器）': async (p) => {
        const r = await p.evaluate(() => {
          const all = [...document.querySelectorAll('.separator')];
          const bareDiv = all.filter((e) => e.tagName === 'DIV'
            && e.getAttribute('role') !== 'separator');
          return { ok: bareDiv.length === 0,
                   note: bareDiv.length
                     ? '🔴 ' + bareDiv.length + ' 条是裸 div 且无 role'
                     : all.length + ' 条语义正确' };
        });
        return r;
      },

      /* ④ 分隔线要看得见，且颜色要能随主题走
         🔴 判据修正（2026-10-05 第一次跑就假失败）：
            原来只认 `background / border-color / background-color` 三个属性名，
            但实际写法是**简写 `border-top`** ⇒ 被判成"颜色未走令牌"。
            ⇒ 正则要覆盖 `border`、`border-top`、`border-bottom`、`background*` 全部。 */
      '颜色走令牌（能随主题变）': async () => {
        const fs = require('fs');
        const raw = kit.stripComments(
          fs.readFileSync(REPO + '/02-primitives/separator/separator.css', 'utf8'));
        const rules = raw.match(/[^{}]+\{[^{}]*\}/g) || [];
        /* 找出所有给线条上色的规则，看它们是否用了 var(--) */
        const colorRules = rules.filter((r) => {
          const body = r.slice(r.indexOf('{'));
          return /\b(border|background)/.test(body) && /:/.test(body);
        });
        if (!colorRules.length) return { ok: false, note: '没有找到线条着色规则' };
        const noToken = colorRules.filter((r) => !/var\(--/.test(r));
        /* 不许用 opacity 淡出（对比度会变得不可控） */
        const usesOpacity = /opacity\s*:/.test(raw);
        return { ok: noToken.length === 0 && !usesOpacity,
                 note: colorRules.length + ' 条着色规则，' +
                       (noToken.length ? '🔴 ' + noToken.length + ' 条没用令牌；' : '全部走令牌；') +
                       (usesOpacity ? '🔴 用了 opacity 淡出' : '未用 opacity') };
      },

      /* ⑤ 分隔线在暗色下也要看得见 ⇒ 令牌必须在暗色块里有值
         🔴 判据修正（第二次假失败）：
            原来用 `[\s\S]*?\n\}` 去截暗色块，遇到块内**空行**就提前截断
            （实测暗色块 4972 字符，我的正则只吃到 900）
            ⇒ 明明有 `--border-decor` 却被判"没定义"。
            ⇒ 正解：先定位 `[data-theme…dark] {` 的**配对大括号**，
               逐字符数深度，不靠换行猜。 */
      '令牌在暗色块里有定义': async () => {
        const fs = require('fs');
        const tok = kit.stripComments(
          fs.readFileSync(REPO + '/01-tokens/tokens.css', 'utf8'));
        const light = (tok.match(/--border-decor\s*:\s*([^;]+);/) || [])[1];

        /* 🔴 逐字符数括号深度，精确切出暗色块。
           ⚠️ 库里有**两种**暗色写法，必须都认：
              @media (prefers-color-scheme: dark) { … }   ← 本库主用
              [data-theme="dark"] { … }                    ← 手动切换
        */
        function cutBlock(re) {
          const m = re.exec(tok);
          if (!m) return null;
          let depth = 0, i = tok.indexOf('{', m.index);
          for (; i < tok.length; i++) {
            if (tok[i] === '{') depth++;
            else if (tok[i] === '}') { depth--; if (depth === 0) break; }
          }
          return tok.slice(m.index, i + 1);
        }
        const darkMedia = cutBlock(/@media[^{}]*prefers-color-scheme\s*:\s*dark[^{}]*\{/);
        const darkAttr  = cutBlock(/\[data-theme[^\]]*dark[^\]]*\]\s*\{/);
        const dark = (darkMedia || '') + (darkAttr || '');
        const has = dark ? /--border-decor\s*:/.test(dark) : false;
        return { ok: has,
                 note: '--border-decor 浅色=' + (light || '(未找到)') +
                       (has ? '，暗色块里有定义 ✅（' +
                             [darkMedia && '@media ' + darkMedia.length + ' 字符',
                              darkAttr  && '[data-theme] ' + darkAttr.length + ' 字符']
                             .filter(Boolean).join(' + ') + '）'
                            : (dark ? '，🔴 暗色块里没有它' : '，🔴 找不到暗色块')) };
      },
    },
  });
  process.exit(kit.report(r));
})();
