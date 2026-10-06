/**
 * api-contract.js — 运行时 API 形状提取（工单 W3）
 *
 * ============================================================================
 * ⭐ 为什么必须「真的跑起来」而不是静态提取源码
 * ---------------------------------------------------------------------------
 *  旧门禁（api-snapshot.py）用正则从源码里扒 `return { ... }`，
 *  实测：**它对 `Select.destroy()` 这个幻觉 API 报「OK」**。
 *
 *  两层根因，都致命：
 *   ① types侧只用 `^\s*(\w+)\s*\(` 抓**方法**
 *      ⇒ getter（`value` / `tags`）在它眼里根本不存在，
 *        属性类的分叉一律漏。
 *   ② runtime 侧只扒 key 名
 *      ⇒ 分不清「方法」与「getter」，也认不出
 *        「类型声明了、实例上其实没有」。
 *
 *  正解只有一条：**在真浏览器里创建实例，
 *    用 Object.getOwnPropertyDescriptors 拿真实形状。**
 * ============================================================================
 *
 * 输出 JSON 到 stdout：{ "组件名": { "成员": "method"|"getter"|... } }
 */

const { launch } = require('./browser.js');

/* 在页面上下文里执行：按组件名创建实例并取形状。
 *⚠️ 用字符串注入而不是 new Function 传函数 ——
 *    后者在跨上下文时会因为闭包丢失而拿不到 window 上的组件。
 */
function probeScript(targetName) {
  return `
  (function () {
    function shape(inst) {
      var out = {};
      if (!inst) return out;
      var names = Object.getOwnPropertyNames(inst);
      for (var i = 0; i < names.length; i++) {
        var n = names[i];
        if (n === 'constructor' || n === '__proto__') continue;
        var d = Object.getOwnPropertyDescriptor(inst, n);
        if (!d) continue;
        if (typeof d.get === 'function') out[n] = d.set ? 'accessor' : 'getter';
        else if (typeof d.value === 'function') out[n] = 'method';
        else out[n] = 'value';
      }
      var proto = Object.getPrototypeOf(inst);
      if (proto && proto !== Object.prototype) {
        var pn = Object.getOwnPropertyNames(proto);
        for (var j = 0; j < pn.length; j++) {
          var k = pn[j];
          if (k === 'constructor' || out[k]) continue;
          var pd = Object.getOwnPropertyDescriptor(proto, k);
          if (pd && typeof pd.value === 'function') out[k] = 'proto-method';
        }
      }
      return out;
    }

    function hostOf(selectors) {
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el) return el;
      }
      return document.body;
    }

    try {
      if (${JSON.stringify(targetName)} === 'Select') {
        var G = window.Select;
        if (!G || typeof G.create !== 'function') return { __error: 'Select 未挂载' };
        var selHost = hostOf(['[data-select]', '.select', '.field', '.control']);
        return { shape: shape(G.create(selHost, {
          label: '契约探测',
          options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }],
          value: 'a',
        })) };
      }
      if (${JSON.stringify(targetName)} === 'Combobox') {
        var C = window.Combobox;
        if (!C || typeof C.create !== 'function') return { __error: 'Combobox 未挂载' };
        var cbHost = hostOf(['[data-combobox]', '.combobox', '.field', '.control']);
        return { shape: shape(C.create(cbHost, {
          label: '契约探测',
          options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }],
        })) };
      }
      if (${JSON.stringify(targetName)} === 'DateRange') {
        var D = window.DateRange;
        if (!D || typeof D.create !== 'function') return { __error: 'DateRange 未挂载' };
        var drHost = hostOf(['[data-range]', '.drange', '.field', '.control']);
        return { shape: shape(D.create(drHost, { label: '契约探测' })) };
      }
      if (${JSON.stringify(targetName)} === 'Dropdown') {
        var W = window.Dropdown;
        if (!W || typeof W.create !== 'function') return { __error: 'Dropdown 未挂载' };
        return { shape: shape(W.create(hostOf(['[data-dd]', '.dropdown']))) };
      }
      if (${JSON.stringify(targetName)} === 'Tree') {
        var T = window.Tree;
        if (!T || typeof T.create !== 'function') return { __error: 'Tree 未挂载' };
        return { shape: shape(T.create(hostOf(['[role="tree"]', '.tree']), {
          label: '契约探测' })) };
      }
      return { __error: '未知目标' };
    } catch (e) {
      return { __error: String((e && e.message) || e) };
    }
  })()
  `;
}

/* 组件 → demo 页 */
const TARGETS = [
  ['Select', '/02-primitives/select/demo.html'],
  ['Combobox', '/02-primitives/combobox/demo.html'],
  ['DateRange', '/02-primitives/date-range/demo.html'],
  ['Dropdown', '/03-patterns/dropdown/demo.html'],
  ['Tree', '/03-patterns/tree/demo.html'],
];

(async () => {
  const browser = await launch();
  const result = {};

  for (const [name, url] of TARGETS) {
    let page;
    try {
      page = await browser.newPage();
      await page.goto('http://127.0.0.1:8000' + url,
        { waitUntil: 'domcontentloaded' });
      await new Promise((r) => setTimeout(r, 300));
      const info = await page.evaluate(probeScript(name));
      result[name] = info.shape || info;
    } catch (e) {
      result[name] = { __error: String((e && e.message) || e).slice(0, 140) };
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  /*命名空间的静态成员（不实例化） */
  let sp;
  try {
    sp = await browser.newPage();
    await sp.goto('http://127.0.0.1:8000/02-primitives/date-range/demo.html',
      { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 300));
    result.DateRangeStatics = await sp.evaluate(() => {
      var DR = window.DateRange;
      if (!DR) return { __error: 'DateRange 全局不存在' };
      var out = {};
      var names = Object.getOwnPropertyNames(DR);
      for (var i = 0; i < names.length; i++) {
        var n = names[i];
        if (n === 'length' || n === 'name' || n === 'prototype') continue;
        var d = Object.getOwnPropertyDescriptor(DR, n);
        out[n] = (typeof d.value === 'function') ? 'static-method' : 'static-value';
      }
      return out;
    });
  } finally {
    if (sp) await sp.close().catch(() => {});
  }

  await browser.close();
  process.stdout.write(JSON.stringify(result, null, 2));
})().catch((e) => {
  process.stderr.write('api-contract 失败：' + ((e && e.stack) || e) + '\n');
  process.exit(1);
});
