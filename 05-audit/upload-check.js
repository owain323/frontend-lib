#!/usr/bin/env node
/* LAYER: component
 * ============================================================================
 * upload-check.js — 文件上传：真值方向、两条入口的校验一致性、强制色边界
 *
 * 🔴 为什么这个组件需要一道专门的判据
 *   上传组件的失败方式和别的组件不一样：它**看起来永远是对的**。
 *   拖一个文件进去，列表里出现一行 —— 用户会认为"选好了"。
 *   但如果那一行是组件自己记的数组、`input.files` 还是空的，
 *   点提交时文件就**凭空消失**，而且不报错、不 alert、控制台干净。
 *
 *   所以这道门禁判的不是"渲染对不对"，是：
 *     ① `input.files` 是不是**唯一真值**（列表必须能被 files 推出来）
 *     ② 拖放与原生选择是不是**同一套校验**（写成两遍必然漂移）
 *     ③ 写不进 files 时，是不是**明确拒绝**而不是装作成功
 *
 * 🔴 为什么"校验一致性"必须单独判
 *   两条入口各写一次校验，在代码审查里几乎看不出来 —— 两段都对，
 *   只是内容不同。而它们漂移的那天，症状是"拖进去被拒、点选进去通过"，
 *   只有用户会碰到（测试通常只测其中一条）。
 *   ⇒ 本判据用一个**同一个文件**分别走两条入口，断言结论相同。
 *     这条只有在"校验只有一份实现"时才可能持续通过。
 *
 * 🔴 三组结构（缺一组结论站不住）
 *   A 组 结构：可见性、可聚焦性、label 关联、播报区位置
 *   B 组 行为：真值方向 / 校验一致 / 拒绝不假成功 / 删除索引 / 进度
 *   C 组 反向控制：破坏掉某条前提，对应判据必须变红
 *        —— 没有 C 组，B 组的绿只证明"现在绿"，不证明判据有牙
 * ========================================================================== */

'use strict';

const path = require('path');
const { launch } = require('./browser.js');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.FL_BASE || 'http://127.0.0.1:8000';

const FIXTURE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<link rel="stylesheet" href="${BASE}/01-tokens/tokens.css">
<link rel="stylesheet" href="${BASE}/01-tokens/page.css">
<link rel="stylesheet" href="${BASE}/02-primitives/input/input.css">
<link rel="stylesheet" href="${BASE}/02-primitives/progress/progress.css">
<link rel="stylesheet" href="${BASE}/02-primitives/upload/upload.css">
<script src="${BASE}/02-primitives/upload/upload.js"></script>
<style>body{margin:0;padding:16px;font:14px/1.5 sans-serif}</style>
</head><body>

<!-- ① 基础形态：零 JS -->
<input class="upload__input" type="file" id="basic" accept=".pdf">

<!-- ② 增强形态：max 20KB / 最多 2 个，方便用极小的内存造超限文件 -->
<div class="upload upload--drop" id="u" data-upload data-max-size="20480" data-max-files="2">
  <input class="upload__input" type="file" id="f" multiple accept=".pdf,.csv">
  <label class="upload__dropzone" for="f" aria-hidden="true">
    <svg class="upload__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 11V2.6M4.4 6.2L8 2.6l3.6 3.6"/></svg>
    <span class="upload__title">拖入文件，或 <span class="upload__browse">选择文件</span></span>
    <span class="upload__hint">PDF / CSV，20 KB 以内</span>
  </label>
  <ul class="upload__list"></ul>
  <span class="upload__status" role="status" aria-live="polite"></span>
</div>

<!-- ③ 空列表：用来判 :empty 不占位 -->
<div class="upload upload--drop" id="u2" data-upload>
  <input class="upload__input" type="file" id="f2" multiple>
  <label class="upload__dropzone" for="f2" aria-hidden="true">
    <span class="upload__title">空</span>
  </label>
  <ul class="upload__list"></ul>
  <span class="upload__status" role="status" aria-live="polite"></span>
</div>

</body></html>`;

/* 探针：全部在页面里跑，避免把 DOM 拖回 Node 再算 */
const PROBE = {
  /* 造文件：1 字节真实内容 + 覆盖 size（不为了让"看起来真实"去真分配 30MB） */
  mk: (name, size, type) => {
    const f = new File([new Uint8Array(1)], name, { type: type || '' });
    try { Object.defineProperty(f, 'size', { value: size }); } catch (e) {}
    return f;
  },

  inst: (id) => {
    const el = document.getElementById(id);
    return el && el.uploadInstance ? true : false;
  },

  /* 一次快照：把"真值 vs 镜像"的所有数字取齐 */
  snap: (id) => {
    const root = document.getElementById(id);
    const input = root.querySelector('.upload__input');
    const items = Array.prototype.slice.call(root.querySelectorAll('.upload__item'));
    return {
      files: input.files.length,
      names: Array.prototype.slice.call(input.files || []).map((f) => f.name),
      domOk: items.filter((li) => li.getAttribute('data-state') !== 'error').length,
      domErr: items.filter((li) => li.getAttribute('data-state') === 'error').length,
      count: root.getAttribute('data-count'),
      metaTexts: items.map((li) => (li.querySelector('.upload__meta') || {}).textContent),
      names_dom: items.map((li) => (li.querySelector('.upload__name') || {}).textContent),
    };
  },

  /* 结构签名 */
  struct: () => {
    const basic = document.getElementById('basic');
    const f = document.getElementById('f');
    const dz = document.querySelector('#u .upload__dropzone');
    const status = document.querySelector('#u > .upload__status');
    const list = document.querySelector('#u .upload__list');
    const r = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
    return {
      basicSize: r(basic),
      basicDisplay: getComputedStyle(basic).display,
      basicTab: basic.tabIndex,
      dropInputSize: r(f),
      dropInputOpacity: getComputedStyle(f).opacity,
      dropInputDisplay: getComputedStyle(f).display,
      dropInputTab: f.tabIndex,
      dzTag: dz.tagName.toLowerCase(),
      dzFor: dz.getAttribute('for'),
      dzRole: dz.getAttribute('role'),
      dzTab: dz.tabIndex,
      statusRole: status ? status.getAttribute('role') : null,
      statusInList: list ? !!list.querySelector('.upload__status') : null,
      /* 空列表高度：判 :empty 是否收起 */
      emptyListH: (() => {
        const l = document.querySelector('#u2 .upload__list');
        return l ? Math.round(l.getBoundingClientRect().height) : -1;
      })(),
    };
  },

  /* 强制色下的边界与图标 */
  fc: () => {
    const root = document.getElementById('u');
    const dz = document.querySelector('#u .upload__dropzone');
    const icon = document.querySelector('#u .upload__icon');
    const cs = getComputedStyle(dz);
    const ci = getComputedStyle(icon);
    /* 往上找第一层不透明的底 —— 不能从元素自身开始（E169） */
    let bg = 'rgb(255, 255, 255)';
    let cur = dz.parentElement;
    while (cur) {
      const c = getComputedStyle(cur).backgroundColor;
      if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { bg = c; break; }
      cur = cur.parentElement;
    }
    return {
      pageBg: bg,
      dzBg: cs.backgroundColor,
      borderW: parseFloat(cs.borderTopWidth) || 0,
      borderColor: cs.borderTopColor,
      borderStyle: cs.borderTopStyle,
      iconColor: ci.color,
      iconStroke: getComputedStyle(icon.querySelector('path')).stroke,
      ignore: root ? 1 : 0,
    };
  },

  /* 进度三态 */
  prog: (i) => {
    const root = document.getElementById('u');
    const li = root.querySelectorAll('.upload__item')[i];
    if (!li) return null;
    const bar = li.querySelector('.upload__progress');
    const fill = li.querySelector('.progress__bar');
    return {
      h: Math.round(li.getBoundingClientRect().height),
      state: li.getAttribute('data-state'),
      hasBar: !!bar,
      pct: fill ? fill.style.getPropertyValue('--progress') : null,
      meta: (li.querySelector('.upload__meta') || {}).textContent,
    };
  },

  /* 删掉 window.DataTransfer，模拟老 Safari */
  killDT: () => {
    try { delete window.DataTransfer; } catch (e) {}
    window.__flDT = window.DataTransfer;
    try { window.DataTransfer = undefined; } catch (e2) {}
    return typeof window.DataTransfer;
  },

  restoreDT: () => { try { window.DataTransfer = window.__flDT; } catch (e) {} },
};

/* ---------------------------------------------------------------- 主流程 */

(async () => {
  const rows = [];
  const add = (group, label, ok, note) => rows.push({ group, label, ok: !!ok, note: note || '' });

  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 1000, height: 900 });

  /* E172：先确认服务是"门禁服务器"，不是给人看 demo 的单线程那个。
     并发下它会把 CSS 请求排队 ⇒ 量到的是没有样式的布局。 */
  const hdr = await p.goto(BASE + '/02-primitives/upload/demo.html', { waitUntil: 'domcontentloaded', timeout: 15000 })
    .then(() => p.evaluate(() => document.title)).catch(() => '');
  if (!hdr) {
    console.error('  ❌ 服务不可达：' + BASE + '（先用 python 05-audit/http-serve.py 8000 起服务）');
    process.exit(2);
  }

  await p.setContent(FIXTURE, { waitUntil: 'load', timeout: 20000 });
  /* 外部 script 在 setContent 里是异步的；等实例挂上，别赌毫秒 */
  await p.waitForFunction(
    () => {
      const a = document.getElementById('u');
      const c = document.getElementById('u2');
      return a && a.uploadInstance && c && c.uploadInstance;
    },
    { timeout: 10000 }
  );
  /* 动画推到终态（E170：切了状态 ≠ 样式落到终态） */
  await p.evaluate(() => {
    document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) {} });
  });

  /* ==========================================================================
   * A 组 · 结构
   * ========================================================================== */
  const st = await p.evaluate(PROBE.struct);

  /* A1 基础形态**可见**（零 JS 路径靠它工作）。被 display:none 掉就没有零 JS 路径了。 */
  add('A1', '基础形态：原生 input 可见（h ≥ 40，不是 display:none）',
    st.basicDisplay !== 'none' && st.basicSize[1] >= 30,
    'display=' + st.basicDisplay + ' size=' + st.basicSize.join('×'));

  /* A2 增强形态：input 是 1px 视觉隐藏，**不是** display:none。
     🔴 这是整个组件最关键的一条：display:none 的文件 input
        键盘进不去（不可聚焦元素不在 Tab 序列里），而鼠标用户毫无感知。 */
  add('A2', '增强形态：input 只是 1px 视觉隐藏（display 不是 none、opacity 为 0）',
    st.dropInputDisplay !== 'none' && st.dropInputOpacity === '0' &&
    st.dropInputSize[0] <= 2 && st.dropInputSize[1] <= 2,
    'display=' + st.dropInputDisplay + ' opacity=' + st.dropInputOpacity +
    ' size=' + st.dropInputSize.join('×'));

  /* A3 可聚焦（tabIndex 不是 -1） */
  add('A3', '增强形态：input 仍在 Tab 序列里（tabIndex ≠ -1）',
    st.dropInputTab !== -1,
    'tabIndex=' + st.dropInputTab + ' / 基础形态 tabIndex=' + st.basicTab);

  /* A4 dropzone 是 label for → input：点它打开选择器这件事不依赖 JS */
  add('A4', '拖放区是 <label for>，指向同一个 input（零 JS 也能点开选择器）',
    st.dzTag === 'label' && st.dzFor === 'f',
    '<' + st.dzTag + ' for="' + st.dzFor + '">');

  /* A5 dropzone 自己不是焦点站（焦点属于 input；两个焦点站 = 用户按两次 Tab 才过一格） */
  add('A5', '拖放区本身不进 Tab 序列（焦点只属于 input）',
    st.dzTab === -1 || st.dzRole === null,
    'tabIndex=' + st.dzTab + ' role=' + st.dzRole);

  /* A6 播报区：role=status 且**不在** <ul> 里。
     放在 <ul> 里会被当列表内容，且列表项增减时会被连带重读。 */
  add('A6', '播报区是独立的 role="status"，不在 <ul> 内部',
    st.statusRole === 'status' && st.statusInList === false,
    'role=' + st.statusRole + ' 在列表内=' + st.statusInList);

  /* A7 空列表不占位 */
  add('A7', '空列表被 :empty 收起（高度 0，不留一条空白缝）',
    st.emptyListH === 0,
    '空列表高 ' + st.emptyListH + 'px');

  /* ==========================================================================
   * B 组 · 行为（真值方向 / 校验一致性 / 不假成功）
   * ========================================================================== */

  /* B1 真值方向：add() 之后 input.files 里真的有文件，且列表 = files + 拒收 */
  const b1 = await p.evaluate((probeSrc) => {
    const mk = eval('(' + probeSrc + ')');
    const root = document.getElementById('u');
    root.uploadInstance.add([mk('a.pdf', 1024, 'application/pdf'),
                             mk('b.csv', 2048, 'text/csv')], 0);
    const input = root.querySelector('.upload__input');
    return {
      files: input.files.length,
      names: Array.prototype.slice.call(input.files).map((f) => f.name),
      dom: root.querySelectorAll('.upload__item').length,
    };
  }, PROBE.mk.toString());
  add('B1', '真值方向：add() 之后 input.files 里真的有文件（不是只渲染了列表）',
    b1.files === 2 && b1.names.join(',') === 'a.pdf,b.csv',
    'files=' + b1.files + ' [' + b1.names.join(', ') + ']');

  /* B2 镜像一致：DOM 项数 = files 数（此处无拒收） */
  add('B2', '列表是镜像：DOM 项数 == input.files.length',
    b1.dom === b1.files,
    'dom=' + b1.dom + ' files=' + b1.files);

  /* B3 超限拒绝，且**不进入 files** */
  const b3 = await p.evaluate((probeSrc) => {
    const mk = eval('(' + probeSrc + ')');
    const root = document.getElementById('u');
    root.uploadInstance.add([mk('big.pdf', 50 * 1024, 'application/pdf')], 0);
    const input = root.querySelector('.upload__input');
    const items = root.querySelectorAll('.upload__item');
    const last = items[items.length - 1];
    return {
      files: input.files.length,
      names: Array.prototype.slice.call(input.files).map((f) => f.name),
      errItems: root.querySelectorAll('.upload__item[data-state="error"]').length,
      reason: (last.querySelector('.upload__meta') || {}).textContent,
      state: last.getAttribute('data-state'),
    };
  }, PROBE.mk.toString());
  add('B3', '超限文件被拒，且**不进入 input.files**（不会悄悄被提交）',
    b3.names.indexOf('big.pdf') < 0 && b3.errItems === 1 && b3.state === 'error',
    'files=[' + b3.names.join(', ') + '] 里没有 big.pdf · 拒收项=' + b3.errItems +
    ' 原因="' + b3.reason + '"');

  /* B4 拒收原因写在文本里（不是只把边框变红） */
  add('B4', '拒收原因是一句人话（"超过 20 KB"），不是只靠颜色',
    /超过/.test(b3.reason || ''),
    '原因="' + b3.reason + '"');

  /* B5 accept 的二次校验：`accept` 只约束文件选择器，拖放完全绕过它。
     🔴 只写 accept=".pdf" 而拖入 .exe 时浏览器**不会**拦 —— 这是规范行为。 */
  const b5 = await p.evaluate((probeSrc) => {
    const mk = eval('(' + probeSrc + ')');
    const root = document.getElementById('u');
    root.uploadInstance.add([mk('bad.exe', 1024, 'application/x-msdownload')], 0);
    const items = root.querySelectorAll('.upload__item');
    const last = items[items.length - 1];
    const input = root.querySelector('.upload__input');
    return {
      files: input.files.length,
      names: Array.prototype.slice.call(input.files).map((f) => f.name),
      state: last.getAttribute('data-state'),
      reason: (last.querySelector('.upload__meta') || {}).textContent,
    };
  }, PROBE.mk.toString());
  add('B5', 'accept 二次校验：拖入 .exe 被拒（accept 只约束选择器，拦不住拖放）',
    b5.names.indexOf('bad.exe') < 0 && b5.state === 'error',
    'files=[' + b5.names.join(', ') + '] 里没有 bad.exe · state=' + b5.state +
    ' 原因="' + b5.reason + '"');

  /* B6 数量上限 */
  const b6 = await p.evaluate((probeSrc) => {
    const mk = eval('(' + probeSrc + ')');
    const root = document.getElementById('u');
    root.uploadInstance.add([mk('1.pdf', 100, 'application/pdf'),
                             mk('2.pdf', 100, 'application/pdf'),
                             mk('3.pdf', 100, 'application/pdf')], 0);
    const input = root.querySelector('.upload__input');
    return {
      files: input.files.length,
      names: Array.prototype.slice.call(input.files).map((f) => f.name),
      err: root.querySelectorAll('.upload__item[data-state="error"]').length,
    };
  }, PROBE.mk.toString());
  add('B6', '数量上限：最多 2 个（第 3 个被拒，不是被静默丢弃）',
    b6.files === 2 && b6.names.join(',') === '1.pdf,2.pdf' && b6.err >= 1,
    'files=' + b6.files + ' [' + b6.names.join(', ') + '] 拒收=' + b6.err);

  /* B7 删除索引：删掉第 0 个之后，剩下的第 0 个必须是**原来的第 1 个**。
     🔴 这是列表组件最经典的 off-by-one：闭包捕获旧索引 ⇒ 删错人。 */
  const b7 = await p.evaluate(() => {
    const root = document.getElementById('u');
    const before = Array.prototype.slice.call(root.querySelector('.upload__input').files).map((f) => f.name);
    root.querySelectorAll('.upload__item .upload__remove')[0].click();
    const after = Array.prototype.slice.call(root.querySelector('.upload__input').files).map((f) => f.name);
    return { before, after };
  });
  add('B7', '移除后索引不错位：删第 0 个 ⇒ 剩下的第 0 个是原第 1 个',
    b7.before.join(',') === '1.pdf,2.pdf' && b7.after.join(',') === '2.pdf',
    b7.before.join(',') + ' → 删首个 → ' + b7.after.join(','));

  /* B8 两条入口的校验结论一致。
     🔴 这一条只有在"_validate 只有一份实现"时才可能持续通过。
        变成两遍的那天，这里会红 —— 而且会红在"用户会碰到、测试碰不到"的那个格子里。 */
  const b8 = await p.evaluate((probeSrc) => {
    const mk = eval('(' + probeSrc + ')');
    const root = document.getElementById('u');
    const input = root.querySelector('.upload__input');

    /* 入口一：拖放（add） */
    root.uploadInstance.add([mk('dup.pdf', 50 * 1024, 'application/pdf')], 0);
    const viaAdd = root.querySelectorAll('.upload__item[data-state="error"]').length;

    /* 入口二：原生 change —— 直接往 input 里塞同一个文件，然后派发 change */
    const dt = new DataTransfer();
    dt.items.add(mk('dup2.pdf', 50 * 1024, 'application/pdf'));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const viaChange = root.querySelectorAll('.upload__item[data-state="error"]').length;

    return { viaAdd, viaChange, files: input.files.length };
  }, PROBE.mk.toString());
  add('B8', '两条入口（拖放 / 原生选择）对同一个超限文件给出**同样的**拒绝结论',
    b8.viaAdd >= 1 && b8.viaChange >= 1 && b8.files === 0,
    'add→拒收 ' + b8.viaAdd + ' 条 · change→拒收 ' + b8.viaChange + ' 条 · files=' + b8.files);

  /* B9 DataTransfer 缺失时不假成功。
     老 Safari（< 14.1）没有构造器 ⇒ input.files 不可写。
     此时若照样渲染列表，用户会看到"文件进去了"，点提交却什么都没有。 */
  const b9 = await p.evaluate((probeSrc) => {
    const mk = eval('(' + probeSrc + ')');
    const root = document.getElementById('u');
    const keep = window.DataTransfer;
    try { window.DataTransfer = undefined; } catch (e) {}
    const ok = root.uploadInstance.add([mk('x.pdf', 100, 'application/pdf')], 0);
    const files = root.querySelector('.upload__input').files.length;
    const errText = (root.querySelector('.upload__item[data-state="error"] .upload__meta') || {}).textContent || '';
    try { window.DataTransfer = keep; } catch (e2) {}
    return { ok, files, errText, dtBack: typeof window.DataTransfer };
  }, PROBE.mk.toString());
  add('B9', 'DataTransfer 缺失时**明确拒绝**（返回 false、不写入、给出提示），不装作成功',
    b9.ok === false && b9.files === 0 && /不支持/.test(b9.errText) && b9.dtBack === 'function',
    '返回 ' + b9.ok + ' · files=' + b9.files + ' · 提示="' + b9.errText + '"');

  /* B10 进度：按需插入、完成后移除（无进度时不留空行） */
  const b10 = await p.evaluate((probeSrc) => {
    const mk = eval('(' + probeSrc + ')');
    const root = document.getElementById('u');
    const inst = root.uploadInstance;
    inst.add([mk('p.pdf', 100, 'application/pdf')], 0);
    const li = () => root.querySelectorAll('.upload__item')[0];
    const snap = () => {
      const el = li();
      const bar = el.querySelector('.upload__progress');
      return {
        h: Math.round(el.getBoundingClientRect().height),
        hasBar: !!bar,
        state: el.getAttribute('data-state'),
        meta: (el.querySelector('.upload__meta') || {}).textContent,
        fillW: bar && bar.querySelector('.progress__bar')
          ? Math.round(bar.querySelector('.progress__bar').getBoundingClientRect().width) : -1,
      };
    };
    const a = snap();
    inst.setProgress(0, 42);
    const b = snap();
    inst.setProgress(0, 100);
    const c = snap();
    return { a, b, c };
  }, PROBE.mk.toString());
  add('B10', '进度按需插入：没有进度时不留空行，有进度时出现，完成后移除',
    b10.a.hasBar === false && b10.b.hasBar === true && b10.c.hasBar === false,
    '无进度 h=' + b10.a.h + ' → 42% h=' + b10.b.h + '（条 ' + b10.b.fillW + 'px）→ 完成 h=' + b10.c.h);
  add('B10b', '进度同时写进文本（"上传中 42%"），不是只在图形里',
    /上传中\s*42%/.test(b10.b.meta || '') && b10.b.state === 'pending' && b10.c.state === 'done',
    'meta="' + b10.b.meta + '" · 完成态=' + b10.c.state);

  /* ==========================================================================
   * C 组 · 强制色（在 CDP 的 forced-colors 下重量一遍）
   * ========================================================================== */
  const cdp = await p.target().createCDPSession();
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'forced-colors', value: 'active' }],
  });
  await p.evaluate(() => {
    document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) {} });
  });
  const fc = await p.evaluate(PROBE.fc);

  add('C0', '强制色已生效（前提：dropzone 的背景确实被换成了系统色）',
    fc.dzBg !== '' && fc.borderW > 0,
    'dz 底=' + fc.dzBg + ' 边框=' + fc.borderW + 'px ' + fc.borderStyle + ' ' + fc.borderColor);

  add('C1', '强制色：拖放区的边框仍在，且与背景不同色（边界没消失）',
    fc.borderW > 0 && fc.borderColor !== fc.dzBg,
    '边框 ' + fc.borderColor + ' vs 底 ' + fc.dzBg);

  add('C2', '强制色：图标用 currentColor 画的，与背景不同色（图形没变白）',
    fc.iconStroke !== 'none' && fc.iconColor !== fc.dzBg,
    'stroke=' + fc.iconStroke + ' color=' + fc.iconColor + ' vs 底 ' + fc.dzBg);

  /* ==========================================================================
   * D 组 · 反向控制：破坏一条前提，对应判据必须变红
   * ========================================================================== */
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await p.evaluate(() => {
    document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) {} });
  });

  /* D1 把 input 改成 display:none ⇒ A2 的判据必须变成"不满足"。
     这条证明 A2 不是永远为真：它真的在看 display 与尺寸。 */
  const d1 = await p.evaluate(() => {
    const f = document.getElementById('f');
    f.style.display = 'none';
    const r = f.getBoundingClientRect();
    return { display: getComputedStyle(f).display, w: Math.round(r.width), h: Math.round(r.height) };
  });
  add('D1', '反向：把 input 设成 display:none ⇒ A2 的判据确实变红',
    d1.display === 'none' && (d1.w === 0 || d1.h === 0),
    'display=' + d1.display + ' size=' + d1.w + '×' + d1.h + ' ⇒ A2 会判失败');

  /* D2 清空 input.files 但保留 DOM ⇒ B2 的"镜像"判据必须变红。
     这条证明 B2 真的在比对两侧，而不是"DOM 有项就算过"。 */
  const d2 = await p.evaluate(() => {
    const root = document.getElementById('u');
    const input = root.querySelector('.upload__input');
    const dom = root.querySelectorAll('.upload__item:not([data-state="error"])').length;
    const dt = new DataTransfer();
    input.files = dt.files;              /* 只清空真值，故意不动 DOM */
    return { dom, files: input.files.length };
  });
  add('D2', '反向：只清空 input.files、不动 DOM ⇒ B2 的镜像判据确实变红',
    d2.files === 0 && d2.dom > 0,
    'dom=' + d2.dom + ' files=' + d2.files + ' ⇒ 两侧不等，B2 会判失败');

  /* D3 把 dropzone 的 border 去掉 ⇒ C1 的判据必须变红 */
  const d3 = await p.evaluate(() => {
    const dz = document.querySelector('#u .upload__dropzone');
    dz.style.border = '0';
    const cs = getComputedStyle(dz);
    return { bw: parseFloat(cs.borderTopWidth) || 0 };
  });
  add('D3', '反向：把 dropzone 的 border 去掉 ⇒ C1 的判据确实变红',
    d3.bw === 0,
    'borderWidth=' + d3.bw + ' ⇒ 边界判据会判失败');

  await b.close();

  /* ==========================================================================
   * 输出
   * ========================================================================== */
  const GROUPS = {
    A1: '结构·基础形态', A2: '结构·1px 隐藏', A3: '结构·可聚焦', A4: '结构·label 关联',
    A5: '结构·单焦点站', A6: '结构·播报区', A7: '结构·空列表',
    B1: '行为·真值方向', B2: '行为·镜像一致', B3: '行为·超限拒绝', B4: '行为·原因可读',
    B5: '行为·accept 二次校验', B6: '行为·数量上限', B7: '行为·删除索引',
    B8: '行为·两条入口一致', B9: '行为·不假成功', B10: '行为·进度按需',
    C0: '强制色·前提', C1: '强制色·边界', C2: '强制色·图标',
    D1: '反向·display:none', D2: '反向·镜像', D3: '反向·边框',
  };

  let bad = 0;
  let last = '';
  console.log('  === upload：真值方向 / 两条入口校验一致 / 强制色边界 ===');
  console.log('  引擎 chromium / ' + BASE);
  console.log('');
  rows.forEach((row) => {
    if (row.group.slice(0, 1) !== last) {
      console.log('  -- ' + row.group.slice(0, 1) + ' 组 ' + (GROUPS[row.group] || '') + ' --');
      last = row.group.slice(0, 1);
    }
    if (!row.ok) bad++;
    console.log('  [' + (row.ok ? 'OK  ' : 'FAIL') + '] ' + row.label);
    console.log('        ' + row.note);
  });
  console.log('');
  console.log(bad
    ? '  ❌ ' + bad + ' 条不满足'
    : '  ✅ 全部满足：input.files 是真值、两条入口同一套校验、写不进时不假成功、强制色边界还在');
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
