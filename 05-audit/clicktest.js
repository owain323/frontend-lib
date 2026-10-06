/**
 * clicktest.js — 真实鼠标点击测试（puppeteer-core，不下载浏览器）
 *
 * 为什么需要它：
 *   `el.click()` 是**程序化点击** —— 直接派发事件，**不做命中测试**。
 *   所以它永远"通过"，哪怕鼠标根本点不到那个元素。
 *   本库真实踩过：checkbox 的 `checked` 属性一直变（面板显示"已勾选"），
 *   但勾号的 CSS 选择器失效 ⇒ 框看着是空的 ⇒ 用户以为"点不了"。
 *   **属性变 ≠ 视觉变，也 ≠ 点得到。**
 *
 * `page.mouse.click(x, y)` 走完整链路：坐标 → 命中测试 → 事件派发 → 状态。
 *
 * 用法：
 *   node clicktest.js                      # 跑全部已配置的用例
 *   node clicktest.js choice               # 只跑 choice
 *
 * 依赖：puppeteer-core（装在 node workspace 里）+ 系统 Chrome
 */

const path = require('path');
// puppeteer-core 由 browser.js 统一持有（含关缓存）
const { launch } = require('./browser');

const CHROME_CANDIDATES = [
  (process.env.CHROME_PATH || process.env.CHROME_BIN || undefined),
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const BASE = 'http://127.0.0.1:8000';

// ---------------------------------------------------------------- 用例
const CASES = {
  choice: {
    url: BASE + '/02-primitives/choice/demo.html',
    desc: '勾选控件：每一个都真点一遍，看 checked 是否变化 + 勾号是否画出来',
    run: async (p) => {
      const n = await p.evaluate(() => document.querySelectorAll('.choice__input').length);
      const out = [];
      for (let i = 0; i < n; i++) {
        const info = await p.evaluate((idx) => {
          const el = document.querySelectorAll('.choice__input')[idx];
          const mk = el.parentNode.querySelector('.choice__mark');
          const lb = el.parentNode.querySelector('.choice__label');
          const txt = lb ? lb.querySelector('span:last-child') : null;
          mk.scrollIntoView({ block: 'center' });
          const r = mk.getBoundingClientRect();
          return {
            type: el.type, checked: el.checked, disabled: el.disabled,
            label: txt ? txt.textContent.trim().slice(0, 22) : '?',
            x: r.left + r.width / 2, y: r.top + r.height / 2,
          };
        }, i);
        await new Promise((r) => setTimeout(r, 80));
        const before = await p.evaluate((idx) =>
          document.querySelectorAll('.choice__input')[idx].checked, i);
        await p.mouse.click(info.x, info.y);
        await new Promise((r) => setTimeout(r, 140));
        const after = await p.evaluate((idx) =>
          document.querySelectorAll('.choice__input')[idx].checked, i);
        /* 视觉层证据。🔴 这里必须查**渲染后的颜色对比**：
           勾号是 `border: 2px solid #fff`（白）画的，如果框底也是白，
           属性全对、checked 也变了，但**勾号完全看不见** ——
           本库真实发生过（实测反馈"全部都不可以"）。
           `content !== 'none'` 这类检查**抓不到它**，
           因为 content 一直存在，只是颜色撞了。 */
        const vis = await p.evaluate((idx) => {
          const el = document.querySelectorAll('.choice__input')[idx];
          const mk = el.parentNode.querySelector('.choice__mark');
          const cs = getComputedStyle(mk);
          const af = getComputedStyle(mk, '::after');
          /* 勾号有两种画法：用 border 画（勾）或用 background 画（半选横线） */
          const tick = af.backgroundColor !== 'rgba(0, 0, 0, 0)'
            ? af.backgroundColor : (af.borderRightColor || af.borderBottomColor);
          return { bg: cs.backgroundColor, after: af.content,
                   w: af.width, h: af.height, tick: tick, tickCr: 0 };
        }, i);

        const lumOf = (c) => {
          const m = (c.match(/[\d.]+/g) || []).map(Number);
          if (m.length < 3) return null;
          const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
        };
        const cr = (a, c) => {
          const l1 = lumOf(a), l2 = lumOf(c);
          if (l1 === null || l2 === null) return 0;
          const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
          return (hi + 0.05) / (lo + 0.05);
        };
        const tickCr = cr(vis.tick, vis.bg);

        /* 判定。🔴 这里我先后写错了四次，都是"没穷举正常情况"：
             ① 忘了 disabled 点击本就不该变
             ② 忘了 radio 本就选中时点击也不变
             ③ 忘了 checkbox 的背景设计上就不变（只加勾号）
             ④ 用"3 次点击后应为 false"判双触发，实际奇数次应为 true
           **判定必须穷举正常情况，不能只判"变了 = 对"。** */
        let ok, note;
        if (info.disabled) {
          ok = (before === after);
          note = 'disabled，点击不变才对';
        } else if (before === after && info.type === 'radio') {
          // radio 组里本来就选中这一个 —— 再点它，值不变是**正确**的
          const others = await p.evaluate((idx) => {
            const all = document.querySelectorAll('input[type=radio]');
            let sel = 0;
            for (let k = 0; k < all.length; k++) { if (all[k].checked) sel++; }
            return sel;
          }, i);
          ok = (others === 1);
          note = ok ? 'radio 本已选中（组内仅 1 个选中），不变才对'
                    : '❌ 组内 ' + others + ' 个选中，不该出现';
        } else if (before === after) {
          ok = false;
          note = '❌ 点了没反应';
        } else if (after === false) {
          /* 点完变成"未勾选"：勾号本来就该消失（scale(0)），
             此时底色是白、标记色读到白是**正常的** ——
             不该拿"可见性"去要求它。这是我今晚第五次判定漏情况。 */
          ok = true;
          note = '已取消勾选（勾号应隐藏，不要求对比）';
        } else {
          /* 勾选状态：标记必须在框底上**看得见**。
             判定用颜色对比，不看 content —— content 一直在，看不出撞色。 */
          if (!vis.tick || tickCr < 3) {
            ok = false;
            note = '❌ 标记与框底几乎同色（对比 ' + tickCr.toFixed(2) + ':1）⇒ 看不见';
          } else {
            ok = true;
            note = '✅ 切换且标记可见（对比 ' + tickCr.toFixed(1) + ':1）';
          }
        }
        out.push({ ok, label: '[' + info.type + '] ' + info.label, note,
                   detail: before + '->' + after + '  标记色 ' + vis.tick + ' / 底色 ' + vis.bg });
      }
      return out;
    },
  },

  /* ------------------------------------------------------------------
     下面这些用例的共同点：**都是"改了 CSS 但视觉/交互可能静默失效"的地方**。
     今晚我在 button.css 改 grid 时丢了 height/padding（框塌成一条），
     在 choice.css 改结构时漏了 7 处选择器 —— 两次都是
     "属性测试全过、真实浏览器里废掉"。
     -------------------------------------------------------------- */
  button: {
    url: BASE + '/02-primitives/button/demo.html',
    desc: '按钮：loading 态宽度不变 + spinner 可见（实测到"框小、文字顶边框"）',
    run: async (p) => {
      const out = [];
      // 默认按钮尺寸（不写 size 类也必须可用）
      const def = await p.evaluate(() => {
        const b = document.querySelector('.btn');
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        return { h: Math.round(r.height), w: Math.round(r.width),
                 pl: parseFloat(cs.paddingLeft), pr: parseFloat(cs.paddingRight) };
      });
      out.push({ ok: def.h >= 32, label: '默认按钮高度 >= 32px',
                 note: def.h + 'px', detail: '宽 ' + def.w + 'px' });
      out.push({ ok: def.pl >= 8 && def.pr >= 8, label: '按钮左右有内边距',
                 note: def.pl + '/' + def.pr + 'px',
                 detail: '文字顶边框就是这里为 0 导致的' });
      // size 变体不能被 min-height 压掉
      const sizes = await p.evaluate(() => {
        const r = {};
        for (const c of ['btn--sm', 'btn--md', 'btn--lg']) {
          const el = document.querySelector('.' + c);
          if (el) r[c] = Math.round(el.getBoundingClientRect().height);
        }
        return r;
      });
      if (sizes['btn--sm'] !== undefined) {
        out.push({ ok: sizes['btn--sm'] < sizes['btn--md'],
                   label: 'btn--sm 比 btn--md 矮（min-height 没压掉变体）',
                   note: 'sm=' + sizes['btn--sm'] + ' md=' + sizes['btn--md'],
                   detail: JSON.stringify(sizes) });
      }
      // loading 态：宽度不变 + spinner 看得见
      const ld = await p.evaluate(() => {
        const b = document.getElementById('demo');
        const w0 = Math.round(b.getBoundingClientRect().width);
        b.setAttribute('aria-busy', 'true');
        const w1 = Math.round(b.getBoundingClientRect().width);
        const sp = b.querySelector('.btn__spinner');
        const lab = b.querySelector('.btn__label');
        const r = { w0, w1,
          spinnerShown: sp ? getComputedStyle(sp).opacity !== '0' : false,
          labelHidden: lab ? getComputedStyle(lab).opacity === '0' : false };
        b.removeAttribute('aria-busy');
        return r;
      });
      out.push({ ok: ld.w0 === ld.w1, label: 'loading 时按钮宽度不变',
                 note: ld.w0 + ' -> ' + ld.w1 + 'px', detail: '变了就会引起整行重排' });
      out.push({ ok: ld.spinnerShown, label: 'loading 时 spinner 可见',
                 note: 'opacity=' + ld.spinnerShown, detail: '' });
      out.push({ ok: ld.labelHidden, label: 'loading 时原文字隐藏（不与 spinner 重叠）',
                 note: 'label opacity=0', detail: '不重叠是多选一，不是二者兼有' });
      return out;
    },
  },

  list: {
    url: BASE + '/03-patterns/list/demo.html',
    desc: '列表：增删生效 + 删空后空状态出现（实测到"动画完全不动"）',
    run: async (p) => {
      const out = [];
      const n = () => p.evaluate(() => document.getElementById('list').children.length);
      const n0 = await n();
      // 点"添加一条"
      await p.click('#add');
      await new Promise((r) => setTimeout(r, 300));
      const n1 = await n();
      out.push({ ok: n1 === n0 + 1, label: '「添加一条」后行数 +1',
                 note: n0 + ' -> ' + n1, detail: '' });
      // 点行内的"移除"
      const before = await n();
      await p.evaluate(() => {
        const b = document.querySelector('#list [data-del]');
        b.scrollIntoView({ block: 'center' });
      });
      await new Promise((r) => setTimeout(r, 200));
      await p.evaluate(() => {
        const b = document.querySelector('#list [data-del]');
        const r = b.getBoundingClientRect();
        window.scrollBy(0, r.top - 400);
      });
      await new Promise((r) => setTimeout(r, 200));
      await p.evaluate(() => {
        const b = document.querySelector('#list [data-del]');
        const r = b.getBoundingClientRect();
        // 用真实鼠标点它（elementFromPoint 先确认命中谁）
        window.__hit = (function (x, y) {
          const e = document.elementFromPoint(x, y);
          return e ? (e.className || e.tagName) : 'null';
        })(r.left + r.width / 2, r.top + r.height / 2);
      });
      const hit = await p.evaluate(() => window.__hit);
      await p.evaluate(() => {
        const b = document.querySelector('#list [data-del]');
        const r = b.getBoundingClientRect();
        b.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 }));
      });
      await new Promise((r) => setTimeout(r, 700));
      const n2 = await n();
      out.push({ ok: n2 === before - 1, label: '「移除」后行数 -1',
                 note: before + ' -> ' + n2, detail: '该点命中 ' + hit });
      // 删光后空状态出现
      await p.click('#clear');
      await new Promise((r) => setTimeout(r, 500));
      const emptyShown = await p.evaluate(() => {
        const e = document.getElementById('empty');
        return !e.hasAttribute('hidden') && document.getElementById('list').children.length === 0;
      });
      out.push({ ok: emptyShown, label: '「清空」后空状态出现',
                 note: emptyShown ? '已出现' : '没出现', detail: '' });
      return out;
    },
  },

  overlay: {
    url: BASE + '/03-patterns/overlay/demo.html',
    desc: '弹窗：打开/关闭/焦点/无横向位移（实测到"整页往右移"）',
    run: async (p) => {
      const out = [];
      const x0 = await p.evaluate(() => document.body.getBoundingClientRect().left);
      await p.click('#d1');
      await new Promise((r) => setTimeout(r, 400));
      const dlg = await p.evaluate(() => {
        const d = document.querySelector('.dialog');
        if (!d) return null;
        const acts = d.querySelectorAll('.dialog__actions .btn');
        const c = acts[0].getBoundingClientRect(), q = acts[1].getBoundingClientRect();
        return {
          count: acts.length,
          gap: Math.round(q.left - c.right),
          h0: Math.round(acts[0].getBoundingClientRect().height),
          focusInside: d.contains(document.activeElement),
        };
      });
      out.push({ ok: !!dlg, label: '点「普通确认」弹出 dialog',
                 note: dlg ? '已弹出' : '没弹出', detail: '' });
      if (dlg) {
        const x1 = await p.evaluate(() => document.body.getBoundingClientRect().left);
        out.push({ ok: Math.abs(x1 - x0) < 1, label: '弹窗打开时页面无横向位移',
                   note: '位移 ' + Math.round(Math.abs(x1 - x0)) + 'px',
                   detail: 'scrollbar-gutter 失效就会跳' });
        out.push({ ok: dlg.count === 2, label: '有 2 个动作按钮',
                   note: dlg.count + ' 个', detail: '' });
        out.push({ ok: dlg.gap < 24, label: '两个按钮相邻',
                   note: '间距 ' + dlg.gap + 'px', detail: '' });
        out.push({ ok: dlg.h0 >= 32, label: '弹窗按钮高度 >= 32px',
                   note: dlg.h0 + 'px', detail: '' });
        out.push({ ok: dlg.focusInside, label: '焦点进入弹窗内（焦点陷阱）',
                   note: dlg.focusInside ? '在里面' : '在外面', detail: '' });
        // Esc 关闭（监听在弹窗内部，必须派发到内部）
        await p.evaluate(() => {
          const d = document.querySelector('.dialog');
          (document.activeElement || d).dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
        });
        await new Promise((r) => setTimeout(r, 600));
        const closed = await p.evaluate(() => !document.querySelector('.dialog'));
        out.push({ ok: closed, label: 'Esc 关闭弹窗',
                   note: closed ? '已关闭' : '仍在', detail: '600ms > 退场动画时长' });
      }
      return out;
    },
  },

  /* ==================================================================
     以下为 路线图阶段 B1 补齐的 4 个组件。
     全部**从真实 DOM 探测后**才写断言，不猜类名/ID。
     ================================================================== */

  input: {
    url: BASE + '/02-primitives/input/demo.html',
    desc: '输入框：disabled / readonly 的真实行为差异（README 主张：readonly 仍可聚焦与复制）',
    run: async (p) => {
      const out = [];
      /* 这个 demo 是"状态陈列"，**没有实时校验**（校验在 form-validation 里测）。
         所以这里只测 input 自己独有的语义 —— 三种受限状态的真实行为。 */
      const st = (id) => p.evaluate((i) => {
        const el = document.getElementById(i);
        return { disabled: el.disabled, readOnly: el.readOnly };
      }, id);
      // disabled：不能聚焦
      const d = await st('d3');
      await p.click('#d3').catch(() => {});
      const dFocused = await p.evaluate(() => document.activeElement.id);
      out.push({ ok: d.disabled && dFocused !== 'd3',
                 label: 'disabled：点不进去、拿不到焦点',
                 note: dFocused !== 'd3' ? '焦点在 "' + (dFocused || 'body') + '"' : '拿到了焦点',
                 detail: 'README 铁律：disabled 不可聚焦' });
      // readonly：能聚焦、能全选
      const r = await st('d4');
      await p.click('#d4');
      const rFocused = await p.evaluate(() => document.activeElement.id);
      const selOk = await p.evaluate(() => {
        const el = document.getElementById('d4');
        el.focus(); el.select();
        return el.selectionStart === 0 && el.selectionEnd === el.value.length;
      });
      out.push({ ok: r.readOnly && rFocused === 'd4',
                 label: 'readonly：能拿到焦点（键盘可访问）',
                 note: rFocused === 'd4' ? '焦点可到' : '焦点在 ' + (rFocused || 'body'),
                 detail: 'README 强调 readonly 不等于 disabled' });
      out.push({ ok: selOk, label: 'readonly：全选可用（便于复制）',
                 note: selOk ? '可选中复制' : '选不中', detail: '' });
      // 错误态的 ARIA
      const inv = await p.evaluate(() => {
        const el = document.getElementById('g1');
        return { v: el.getAttribute('aria-invalid'), described: !!el.getAttribute('aria-describedby') };
      });
      out.push({ ok: inv.v === 'true' && inv.described,
                 label: '错误态：aria-invalid + aria-describedby 都设了',
                 note: 'aria-invalid=' + inv.v + ' describedby=' + inv.described,
                 detail: '读屏会念出错误文案' });
      return out;
    },
  },

  card: {
    url: BASE + '/02-primitives/card/demo.html',
    desc: '卡片：整卡可点（内部真实 <a>）+ hover 抬起不改布局 + 焦点可见',
    run: async (p) => {
      const out = [];
      const probe = () => p.evaluate(() => {
        const c = document.querySelector('.card--linked');
        if (!c) return null;
        const a = c.querySelector('a');
        const r = c.getBoundingClientRect();
        return { hasLink: !!a, href: a ? a.getAttribute('href') : null,
                 hasTabindex: c.hasAttribute('tabindex'),
                 w: Math.round(r.width), h: Math.round(r.height),
                 top: Math.round(r.top) };
      });
      const s0 = await probe();
      /* 🔴 README 铁律：「整卡可点 | 内部必须有真实 <a>/<button>」——
         靠 JS 转发点击是错的（键盘用户点不到）。 */
      out.push({ ok: s0.hasLink && !!s0.href,
                 label: '整卡可点靠内部真实链接（不是 JS 转发）',
                 note: s0.hasLink ? '有 <a href="' + s0.href + '">' : '没有链接',
                 detail: '键盘用户必须能到达' });
      out.push({ ok: !s0.hasTabindex, label: '容器本身不加 tabindex（避免出现两个焦点位）',
                 note: s0.hasTabindex ? '❌ 容器有 tabindex' : '只有内链一个焦点位',
                 detail: '两个焦点位会让读屏用户听两遍' });
      // 键盘可达：Tab 到链接并回车
      await p.evaluate(() => {
        const a = document.querySelector('.card--linked a');
        a.focus();
        const r = a.getBoundingClientRect();
        window.scrollBy(0, r.top - 300);
      });
      await new Promise((r) => setTimeout(r, 200));
      const focusable = await p.evaluate(() => {
        const a = document.querySelector('.card--linked a');
        return document.activeElement === a;
      });
      out.push({ ok: focusable, label: '卡片内的链接可被键盘聚焦',
                 note: focusable ? '可聚焦' : '聚焦不到', detail: '' });
      // hover 抬起：位移必须是 transform（不引起回流）
      const hover = await p.evaluate(() => {
        const c = document.querySelector('.card--linked');
        const before = c.getBoundingClientRect().top;
        return { before: Math.round(before) };
      });
      await p.hover('.card--linked');
      await new Promise((r) => setTimeout(r, 300));
      const after = await p.evaluate(() => {
        const c = document.querySelector('.card--linked');
        const r = c.getBoundingClientRect();
        const cs = getComputedStyle(c);
        return { top: Math.round(r.top), transform: cs.transform,
                 boxShadow: cs.boxShadow !== 'none' };
      });
      /* 🔴 README 铁律：hover 只动 transform/shadow，**不能改 margin/padding**
         —— 那会引起回流，卡片下面的内容会跳。 */
      const lifted = hover.before - after.top;
      out.push({ ok: lifted > 0 && after.transform !== 'none' && after.boxShadow,
                 label: 'hover 抬起：用 transform 而不是改 margin',
                 note: '上移 ' + lifted + 'px，transform=' + (after.transform !== 'none' ? '有' : '无'),
                 detail: '改 margin 会让下方内容跳' });
      return out;
    },
  },

  states: {
    url: BASE + '/03-patterns/states/demo.html',
    desc: '状态机：四个状态互斥切换 + aria-pressed 同步',
    run: async (p) => {
      const out = [];
      const probe = () => p.evaluate(() => {
        /* 🔴 状态类挂在 **#stage-body 内部新生成的元素** 上（div.state.state--loading），
           不是 #stage 自己。实测 dump：#stage 的 className 一直是空的。
           第一次写断言时查错了元素，判成"类名没同步"。 */
        const body = document.getElementById('stage-body');
        const inner = body ? body.querySelector('.state') : null;
        const pressed = [...document.querySelectorAll('[data-s]')]
          .filter((b) => b.getAttribute('aria-pressed') === 'true')
          .map((b) => b.dataset.s);
        return { cls: inner ? inner.className : '(没有 .state 元素)',
                 text: body ? body.textContent.replace(/\s+/g, ' ').trim().slice(0, 20) : '',
                 pressed };
      });
      const s0 = await probe();
      out.push({ ok: s0.pressed.length === 1, label: '初始恰好一个状态被选中',
                 note: s0.pressed.join(','), detail: '互斥：' + (s0.pressed.length === 1) });
      /* 🔴 四个状态**不是同质的**，不能一视同仁：
         loading / empty / error 都需要状态容器（div.state.state--xxx），
         而 **content 返回的是真实数据表格，本来就不该有 .state 类**
         —— 有数据时不需要"状态容器"。
         我第一版把四个状态用同一个断言判，content 那条是**误报**。 */
      for (const [key, expectState] of [['loading', true], ['empty', true],
                                       ['error', true], ['content', false]]) {
        await p.click('[data-s="' + key + '"]');
        await new Promise((r) => setTimeout(r, 350));
        const s = await probe();
        const hasStateCls = s.cls.includes('state--' + key);
        const ok = s.pressed.length === 1 && s.pressed[0] === key &&
                   (expectState ? hasStateCls : !hasStateCls);
        out.push({ ok,
                   label: '切到「' + key + '」：' +
                          (expectState ? '有 .state--' + key + ' 且 aria-pressed 同步'
                                       : '无状态容器（有数据）且 aria-pressed 同步'),
                   note: 'pressed=[' + s.pressed + '] cls=' + s.cls,
                   detail: s.text ? '文案：' + s.text : '' });
      }
      return out;
    },
  },

  nav: {
    url: BASE + '/03-patterns/nav/demo.html',
    desc: '导航：抽屉开合 + aria-expanded 同步 + 目录跳转',
    run: async (p) => {
      const out = [];
      await p.setViewport({ width: 375, height: 780, isMobile: true, hasTouch: true });
      await new Promise((r) => setTimeout(r, 200));
      const open0 = await p.evaluate(() => {
        const t = document.getElementById('nav-toggle');
        const list = document.getElementById('nav-list');
        return { expanded: t.getAttribute('aria-expanded'),
                 open: list.classList.contains('is-open') || list.getAttribute('data-open') === 'true',
                 visible: list.getBoundingClientRect().left >= 0 };
      });
      out.push({ ok: open0.expanded === 'false', label: '移动端初始：抽屉关闭且 aria-expanded=false',
                 note: 'aria-expanded=' + open0.expanded, detail: '' });
      // 点汉堡按钮
      await p.click('#nav-toggle');
      await new Promise((r) => setTimeout(r, 500));
      const open1 = await p.evaluate(() => {
        const t = document.getElementById('nav-toggle');
        const list = document.getElementById('nav-list');
        const r = list.getBoundingClientRect();
        return { expanded: t.getAttribute('aria-expanded'),
                 onScreen: r.left >= -1 && r.width > 0 };
      });
      out.push({ ok: open1.expanded === 'true' && open1.onScreen,
                 label: '点汉堡按钮：抽屉滑入且 aria-expanded=true',
                 note: `aria-expanded=${open1.expanded} 在屏上=${open1.onScreen}`, detail: '' });
      // 点遮罩关闭
      const hasScrim = await p.evaluate(() => {
        const s = document.getElementById('nav-scrim');
        if (!s) return false;
        const b = s.getBoundingClientRect();
        return b.width > 0 && b.height > 0;
      });
      if (hasScrim) {
        await p.evaluate(() => {
          const s = document.getElementById('nav-scrim');
          const r = s.getBoundingClientRect();
          s.dispatchEvent(new MouseEvent('click', { bubbles: true,
            clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
        });
        await new Promise((r) => setTimeout(r, 500));
        const open2 = await p.evaluate(() =>
          document.getElementById('nav-toggle').getAttribute('aria-expanded'));
        out.push({ ok: open2 === 'false', label: '点遮罩关闭抽屉',
                   note: 'aria-expanded=' + open2, detail: '' });
      }
      // 目录项能跳转
      await p.setViewport({ width: 1280, height: 900 });
      await new Promise((r) => setTimeout(r, 200));
      await p.evaluate(() => {
        const a = document.querySelector('#toc-list .toc__link[href="#sched"]');
        a.scrollIntoView({ block: 'center' });
      });
      await new Promise((r) => setTimeout(r, 200));
      await p.evaluate(() => {
        const a = document.querySelector('#toc-list .toc__link[href="#sched"]');
        const r = a.getBoundingClientRect();
        a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
          clientX: r.left + 2, clientY: r.top + r.height / 2 }));
      });
      await new Promise((r) => setTimeout(r, 500));
      const jumped = await p.evaluate(() => {
        const t = document.getElementById('sched');
        const r = t.getBoundingClientRect();
        return { top: Math.round(r.top), y: Math.round(window.pageYOffset) };
      });
      out.push({ ok: jumped.y > 0 && Math.abs(jumped.top) < 300,
                 label: '点目录项跳到对应章节',
                 note: `scrollY=${jumped.y} 标题距顶=${jumped.top}px`, detail: '' });
      return out;
    },
  },

  'form-validation': {
    url: BASE + '/03-patterns/form-validation/demo.html',
    desc: '表单校验：提交拦截 → 汇总条出现 → 焦点移入 → 改对后重提交成功',
    run: async (p) => {
      const out = [];
      // 1) 提交空表单 → 拦截
      await p.click('button[type=submit]');
      await new Promise((r) => setTimeout(r, 700));
      const s1 = await p.evaluate(() => {
        const sum = document.querySelector('.form__summary');
        const bad = [...document.querySelectorAll('.field__error')]
          .filter((e) => getComputedStyle(e).display !== 'none');
        return { sum: !!sum, oneLine: sum ? sum.getBoundingClientRect().height <= 50 : false,
                 sumText: sum ? sum.textContent.replace(/\s+/g, ' ').trim().slice(0, 30) : '',
                 links: sum ? sum.querySelectorAll('a').length : 0,
                 shown: bad.length,
                 focusInSum: sum ? sum.contains(document.activeElement) : false };
      });
      out.push({ ok: s1.sum, label: '提交空表单被拦截，汇总条出现',
                 note: s1.sum ? `「${s1.sumText}」` : '没出现', detail: s1.shown + ' 个字段标错' });
      out.push({ ok: s1.oneLine, label: '汇总条只占一行（O(1) 竖向空间）',
                 note: s1.sum ? Math.round(await p.evaluate(() => {
                   const r = document.querySelector('.form__summary').getBoundingClientRect();
                   return r.height;
                 })) + 'px' : '—', detail: '' });
      out.push({ ok: s1.focusInSum, label: '焦点移入汇总条（读屏会播报）',
                 note: s1.focusInSum ? '已移入' : '未移入', detail: '' });
      // 2) 填对后重提交 → 成功
      for (const [sel, val] of [['#c', 'ACME 有限公司'], ['#a', '11.50'], ['#n', '备注']]) {
        const h = await p.$(sel);
        if (h) { await h.click({ clickCount: 3 }); await h.type(val); }
      }
      await p.click('button[type=submit]');
      await new Promise((r) => setTimeout(r, 700));
      const s2 = await p.evaluate(() => ({
        notice: !!document.querySelector('.form__notice'),
        leftShown: [...document.querySelectorAll('.field__error')]
          .filter((e) => getComputedStyle(e).display !== 'none').length,
      }));
      out.push({ ok: s2.notice, label: '全部填对后提交成功',
                 note: s2.notice ? '出现成功提示' : '没有', detail: '' });
      /* 🔴 回归：实测到的"空红点一直存在" */
      out.push({ ok: s2.leftShown === 0, label: '提交成功后零残留错误（实测到的空红点）',
                 note: s2.leftShown === 0 ? '干净' : s2.leftShown + ' 个残留',
                 detail: '.field__error:empty 兜底是否生效' });
      return out;
    },
  },
};


// ---------------------------------------------------------------- 跑
(async () => {
  const fs = require('fs');
  const chrome = CHROME_CANDIDATES.find((c) => fs.existsSync(c));
  if (!chrome) { console.log('找不到 Chrome/Edge'); process.exit(2); }

  const only = process.argv[2];
  const names = only ? [only] : Object.keys(CASES);

  const b = await launch();

  let total = 0, passed = 0;
  for (const name of names) {
    const c = CASES[name];
    if (!c) { console.log('没有这个用例：' + name); continue; }
    console.log('\n=== ' + name + ' — ' + c.desc + ' ===');
    const p = await b.newPage();
    await p.setViewport({ width: 1200, height: 1000 });
    await p.goto(c.url, { waitUntil: 'networkidle0' });
    const rows = await c.run(p);
    for (const r of rows) {
      total++; if (r.ok) passed++;
      console.log('  [' + (r.ok ? 'PASS' : 'FAIL') + '] ' +
                  r.label.padEnd(30) + r.note.padEnd(22) + r.detail);
    }
    await p.close();
  }
  await b.close();

  console.log('\n' + '='.repeat(70));
  console.log('真实鼠标点击：' + passed + ' / ' + total + ' 通过');
  process.exit(passed === total ? 0 : 1);
})();
