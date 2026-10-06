/**
 * global-api-probe.js — 取所有组件全局对象的真实形态（任务 W5）
 *
 * ============================================================================
 * 为什么需要这道
 * ---------------------------------------------------------------------------
 *   API.md 曾写「所有行为脚本遵循 `<组件名>.create(root, options)`」，
 *   但 11 个全局里只有 4 个真有 create：
 *     Drawer.open · Toc.init · Bar.draw · Tooltip.attach …
 *   而 Accordion / Tabs 是**构造函数**（`new`），既无 create 也无 attach。
 *
 *   ⇒ 「一条规则 + 一堆例外」等于没有规则。
 *     这份脚本把真实形态逐个取出来，作为 API.md 与文档门禁的判据来源。
 * ============================================================================
 *
 * ⭐ 探测方式：**按已知名单定向查**，不做「扫 window 全量」。
 *   理由：window 上有大量浏览器内置（大写开头的不多但存在），
 *   全量扫必然掺入噪音，而这份数据的用途是**校验我们自己声明的表**，
 *   不是发现未知全局。
 *
 * 输出：{ 全局名: {形态, 成员} }
 */
const { launch } = require('./browser.js');

/* 全局名 → 能找到它的页面（取第一个存在的即可） */
const TARGETS = {
  Select: '/02-primitives/select/demo.html',
  Combobox: '/02-primitives/combobox/demo.html',
  DateRange: '/02-primitives/date-range/demo.html',
  Popover: '/02-primitives/popover/demo.html',
  Accordion: '/03-patterns/accordion/demo.html',
  Tabs: '/03-patterns/tabs/demo.html',
  Tree: '/03-patterns/tree/demo.html',
  Dropdown: '/03-patterns/dropdown/demo.html',
  Overlay: '/03-patterns/overlay/demo.html',
  Drawer: '/03-patterns/drawer/demo.html',
  Tooltip: '/03-patterns/tooltip/demo.html',
  Toc: '/03-patterns/nav/demo.html',
  Bar: '/09-assets/bar/demo.html',
  FLIP: '/03-patterns/list/demo.html',
  Pagination: '/03-patterns/pagination/demo.html',
  Chart: '/09-assets/sparkline/demo.html',
  ChartAdapter: '/09-assets/echarts-adapter/demo.html',
  ModelViewer: '/09-assets/model-viewer/demo.html',
  // Theme 在 01-tokens，用加载它的页面当宿主
  Theme: '/10-review/ios/index.html',
};

/* 按页面分组，一个页面只开一次 tab */
const BY_PAGE = {};
for (const [name, url] of Object.entries(TARGETS)) {
  (BY_PAGE[url] = BY_PAGE[url] || []).push(name);
}

(async () => {
  const browser = await launch();
  const out = {};

  for (const [url, names] of Object.entries(BY_PAGE)) {
    let page;
    try {
      page = await browser.newPage();
      await page.goto('http://127.0.0.1:8000' + url,
        { waitUntil: 'domcontentloaded' });
      await new Promise((r) => setTimeout(r, 280));

      const got = await page.evaluate((want) => {
        const r = {};
        for (const name of want) {
          const v = window[name];
          if (v === undefined || v === null) { r[name] = { absent: true }; continue; }
          const members = {};
          /* 静态成员 +原型上的方法（构造函数式组件的方法在原型上） */
          for (const n in v) {
            if (Object.prototype.hasOwnProperty.call(v, n)) {
              members[n] = typeof v[n];
            }
          }
          const proto = v.prototype;
          let newable = false;
          let protoMethods = {};
          if (proto && typeof v === 'function') {
            const pn = Object.getOwnPropertyNames(proto)
              .filter((n) => n !== 'constructor');
            newable = pn.length > 0;
            pn.forEach((n) => { protoMethods[n] = typeof proto[n]; });
          }
          /* 形态判定：这是**给使用者看的关键信息**。
           * ⭐ 对象形态（namespace）必须**按成员名**再细分，
           *   否则 Select 与 Drawer 都是「namespace」，
           *   文档里写 create 还是 open 就分不出来（第一版踩过，
           *   表现为门禁把 7 个组件全报「形态不符」）。
           *   判据优先级：构造函数 > attach > create > 直呼动作。 */
          let form;
          if (typeof v !== 'function') {
            form = members.create ? 'create'
              : members.attach ? 'attach'
                : 'direct';
          } else if (members.create) form = 'create';
          else if (members.attach) form = 'attach';
          else if (newable) form = 'construct';
          else form = 'functions';
          r[name] = {
            form: form,
            members: members,
            protoMethods: protoMethods,
          };
        }
        return r;
      }, names);

      Object.assign(out, got);
    } catch (e) {
      names.forEach((n) => {
        out[n] = { error: String((e && e.message) || e).slice(0, 100) };
      });
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  await browser.close();
  process.stdout.write(JSON.stringify(out, null, 2));
})().catch((e) => {
  process.stderr.write('global-api-probe 失败：' + ((e && e.stack) || e) + '\n');
  process.exit(1);
});
