/**
 * a11y-ax.js — 可访问性树（Accessibility Tree）转录与回归
 * ============================================================================
 * 为什么要有这个文件
 * ---------------------------------------------------------------------------
 *   仓库里已经有 axe（`a11y-scan.js`），但它回答的是「有没有踩已知的违规规则」。
 *   使用者真正会问的是另一句：**「屏幕阅读器会念出什么？」**
 *   axe 答不了这个问题 —— 它不生成朗读序列，也不知道 accessible name 从哪来。
 *
 *   而没有一个页面对使用者说「我们按 WCAG 2.2 AA 做，已知缺口是这几条」，
 *   这一维的证据链就永远是断的：声明没有证据支撑，等于广告。
 *
 * 这里做什么（两件事，分开看）
 * ---------------------------------------------------------------------------
 *   ① **硬判据**（会红）：
 *      · 每个可交互角色必须有非空 accessible name  —— 对应 WCAG 4.1.2
 *      · name 不得是角色名本身 / "undefined" / "null"（占位泄漏）
 *      · 不得有可聚焦元素落在 `aria-hidden="true"` 的祖先里
 *      （这三条与浏览器版本无关，只看 DOM 语义 ⇒ 不会因为 Chrome 升级而假红）
 *
 *   ② **证据**（快照，会红但一句话就能刷新）：
 *      把每页的线性朗读序列（角色 + 名称 + 状态，按 DOM 顺序）存成文本，
 *      下次跑做 **逐行 diff**。名称被改坏、状态丢失、顺序颠倒，diff 里看得见。
 *      ⚠️ 这是快照测试（和 Jest snapshot 同一类东西）：
 *         它红的含义是「朗读序列变了」，不是「一定错了」。
 *         核实无误后 `--update` 刷新，并把 diff 一起提交 ——
 *         审查者看的正是那个 diff。
 *
 * 为什么排除项要写成白名单而不是过滤器
 * ---------------------------------------------------------------------------
 *   `generic` / `none` / `InlineTextBox` 这类节点没有语义，留在转录里只会
 *   把真问题埋掉。排除规则集中在 `ROLE_IGNORE`，改它必须说明理由。
 *
 * 用法
 * ---------------------------------------------------------------------------
 *   node 05-audit/a11y-ax.js             # 判据 + 与快照比对
 *   node 05-audit/a11y-ax.js --update    # 刷新快照（改完核实过再跑）
 *   node 05-audit/a11y-ax.js --selftest  # 验判据本身抓不抓得到问题
 *   node 05-audit/a11y-ax.js button      # 只跑一页
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const { launch } = require('./browser');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.FL_BASE || 'http://127.0.0.1:8000';
const SNAP_DIR = path.join(ROOT, '10-review', 'a11y-tree');

/* 要转录的页面 —— **全部 38 个 demo.html**，不是挑几张代表作。
 *
 * 🔴 0.11.16 之前这里只有 11 页（挑的是「交互语义各不相同」的那批）。
 *    当时的理由是"覆盖面 = 四类角色都出现过"，但那个理由经不起一句追问：
 *    **没被转录的 27 页，凭什么认为它们没问题？** 答案是没有依据 ——
 *    判据（NEEDS_NAME / AX-3 / AX-4）只对被转录的页面生效。
 *    一个 `role="progressbar"` 少写名字的图表页，正好落在视野外，
 *    axe 也不报（axe 查的是"已知违规规则"，不生成朗读序列）。
 *    ⇒ 全量后每一页都有快照：改坏了哪个字，diff 里看得见。
 *
 * 第三列不是"标题"，是**这一页负责证什么**。写不出这一行的页面说明
 * 它在语义上和其他页重复 —— 那是删页的理由，不是跳过的理由。
 */
const PAGES = [
  /* ---- 02-primitives ---- */
  ['button', '02-primitives/button/demo.html', '按钮：名字 + disabled/busy 状态'],
  ['input', '02-primitives/input/demo.html', '输入：label 关联 + 错误描述'],
  ['select', '02-primitives/select/demo.html', '下拉：combobox 角色 + expanded'],
  ['choice', '02-primitives/choice/demo.html', '单选/复选：checked + group'],
  ['switch', '02-primitives/switch/demo.html', '开关：switch 角色 + checked'],
  ['badge', '02-primitives/badge/demo.html',
   '徽章：纯装饰节点不许漏进朗读序列，也不许被合成出名字'],
  ['card', '02-primitives/card/demo.html',
   '卡片：标题层级 + 整块链接，标题不得被当成交互控件'],
  ['combobox', '02-primitives/combobox/demo.html',
   '组合框：combobox + listbox + option + expanded（与 select 的单选语义不同源）'],
  ['date-range', '02-primitives/date-range/demo.html',
   '日期区间：输入框名字 + 日历弹层 + role=alert 的越界提示'],
  ['delta', '02-primitives/delta/demo.html',
   '变化量：+ / − 是 CSS 生成的文本 —— 它必须真的进朗读序列，'
   + '否则方向只剩颜色（WCAG 1.4.1 不成立）'],
  ['metric', '02-primitives/metric/demo.html',
   '指标块：dt/dd 的术语-值关系要能被念出来；缺数的 — 不许被念成「零」'],
  ['popover', '02-primitives/popover/demo.html',
   '气泡卡片：非模态浮层的名字来源与「点外面关掉」的可达性'],
  ['progress', '02-primitives/progress/demo.html',
   '进度：progressbar + valuenow / 有名字与无名字两种形态'],
  ['separator', '02-primitives/separator/demo.html',
   '分隔线：separator 角色 + 分组名落在哪一层（放错层就等于没有）'],
  ['skeleton', '02-primitives/skeleton/demo.html',
   '骨架屏：装饰性 aria-hidden 与内嵌 progressbar 的例外'],
  /* ---- 03-patterns ---- */
  ['tabs', '03-patterns/tabs/demo.html', '标签页：tablist/tab + selected + controls'],
  /* 0.11.13 加：折叠是「button + expanded + 受控 region」这一组关系，
     与 tablist 的 selected/controls 不同源；而 `accordion-contract.js`
     查的是**属性写得对不对**，查不到"读屏实际念出什么"。 */
  ['accordion', '03-patterns/accordion/demo.html', '折叠：button + expanded + 受控 region'],
  ['overlay', '03-patterns/overlay/demo.html', '浮层：dialog + modal + 名字'],
  ['states', '03-patterns/states/demo.html', '状态消息：status/alert 播报'],
  ['form-validation', '03-patterns/form-validation/demo.html', '表单校验：invalid + 描述'],
  ['content', '03-patterns/content/demo.html',
   '长文排版：标题层级与表格，正文段落不得被容器吞成一个名字'],
  ['drawer', '03-patterns/drawer/demo.html',
   '抽屉：dialog + modal + 关闭按钮的名字（ICON 按钮最容易只剩图标）'],
  ['dropdown', '03-patterns/dropdown/demo.html',
   '下拉菜单：menu/menuitem + expanded（菜单不等于 tablist）'],
  ['list', '03-patterns/list/demo.html',
   '列表：list/listitem + 可翻转卡片内部不得被朗读两遍'],
  ['nav', '03-patterns/nav/demo.html',
   '导航：同类地标多于一个时靠名字区分 + aria-current + 抽屉触发器'],
  ['pagination', '03-patterns/pagination/demo.html',
   '分页：每个页码按钮要有能区分的名字（"第 3 页"而不是"3"）'],
  ['reveal', '03-patterns/reveal/demo.html',
   '滚动显现：纯视觉变换不得进入朗读序列，也不得吞掉内容'],
  ['tooltip', '03-patterns/tooltip/demo.html',
   '提示：aria-describedby 关联，提示文本不作为独立节点再念一遍'],
  ['tree', '03-patterns/tree/demo.html',
   '树：tree/treeitem/group + expanded + 层级（缩进要能被念出来）'],
  /* ---- 04-recipes ---- */
  ['table', '04-recipes/table/demo.html', '表格：table/row/columnheader 关系'],
  ['analysis-report', '04-recipes/analysis-report/demo.html',
   '组合报告：region 地标 + 可横向滚动表格的名字（滚动容器最容易丢语义）'],
  ['data-showcase', '04-recipes/data-showcase/demo.html',
   '数据展示：多张表格并存时靠 caption/label 区分，不许都叫"表格"'],
  ['detail-page', '04-recipes/detail-page/demo.html',
   '详情页：标题层级 + 定义列表语义（dt/dd 不能被压平成一段）'],
  ['report', '04-recipes/report/demo.html',
   '报告页：表格与段落混排时的朗读顺序，标题不跳级'],
  /* ---- 09-assets ---- */
  ['bar', '09-assets/bar/demo.html',
   '柱状图：图形替身必须有非空名字（canvas 的文本读屏拿不到）'],
  ['echarts-adapter', '09-assets/echarts-adapter/demo.html',
   '图表适配：role=img + 数值表双通道，两条通道都得有名字'],
  ['model-viewer', '09-assets/model-viewer/demo.html',
   '3D 模型：画布语义 + 操作提示，纯指针操作要给出替代路径'],
  ['scientific-plot', '09-assets/scientific-plot/demo.html',
   '科学绘图：坐标轴刻度文本进入朗读序列，且不与图形名字重复'],
  ['sparkline', '09-assets/sparkline/demo.html',
   '迷你趋势线：role=img + 名字（无名字的趋势线等于没画）'],
  /* ---- 10-review ---- */
  ['composition', '10-review/composition/demo.html',
   '组合页：多个模式同处一页时不得出现无法区分的同名控件'],
];

/* ---------------------------------------------------------------------------
 * 🔴 覆盖完整性判据：手写的 PAGES 必须**等于**磁盘上的全部 demo.html。
 *
 *   为什么需要这一条（这不是洁癖，是同一个病第三次复发）：
 *     `a11y-scan.js` 在 0.8.9 之前手写了 11 个页面，而组件有 33 个 ⇒
 *     axe 只覆盖三分之一，而文档写的是"每个组件都有契约守着"。
 *     当时的结论是「手写清单是**第二份**『哪些页面要查』的表述，两份必然漂移」。
 *     本文件 0.11.16 从 11 页扩到 38 页时，同样是手写 —— 一样的隐患。
 *
 *   为什么不用"扫目录生成"（那样就没有第二份了）：
 *     第三列「这一页负责证什么」必须是人写的。自动生成只能得到文件名，
 *     而"这一页和那一页在语义上重复吗"这件事恰恰是要人回答的。
 *   ⇒ 保留手写清单，但把「有没有漏页」变成**判据**：
 *     新加一个 demo.html 却忘了加进来 ⇒ 这里直接红，而不是安静地少查一页。
 *     清单里写了但磁盘上没有（改名/删页）⇒ 也红（它指向一个不存在的证据）。
 */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'guide', '.git',
                           '.toolchain', 'vendor', 'shots']);

function demoPagesOnDisk() {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name), rel ? rel + '/' + e.name : e.name);
      } else if (e.name === 'demo.html') {
        out.push(rel ? rel + '/demo.html' : 'demo.html');
      }
    }
  };
  walk(ROOT, '');
  return out.sort();
}

function checkCoverage(pages) {
  const listed = new Set(pages.map((p) => p[1]));
  const disk = demoPagesOnDisk();
  const errs = [];
  for (const rel of disk) {
    if (!listed.has(rel)) {
      errs.push('磁盘上有 ' + rel + ' 但清单里没有 ⇒ 这一页从未被转录过'
                + '（漏页不会自己叫，只有这条判据会）');
    }
  }
  const onDisk = new Set(disk);
  for (const rel of listed) {
    if (!onDisk.has(rel)) {
      errs.push('清单里的 ' + rel + ' 磁盘上没有 ⇒ 证据指向一个不存在的页面');
    }
  }
  // 同一页登记两次 ⇒ 后一条覆盖前一条快照，其中一条永远不生效
  const seen = new Set();
  for (const p of pages) {
    if (seen.has(p[1])) errs.push('清单里 ' + p[1] + ' 登记了两次');
    seen.add(p[1]);
  }
  return errs;
}

/* 无语义节点：留在转录里只会淹没真问题。 */
const ROLE_IGNORE = new Set([
  'generic', 'none', 'presentation', 'InlineTextBox', 'LineBreak',
  'StaticText',            // 正文由所在节点的 name 体现，单列会重复两遍
  /* 行内强调：朗读单位是所在的段落，不是这几个标签本身。
     单列出来会让转录里出现 `code "--accent-hover"` 这种碎片，
     而读屏实际念的是整句。 */
  'code', 'strong', 'emphasis', 'deletion', 'insertion',
  'subscript', 'superscript', 'term', 'definition',
]);

/* 必须有 accessible name 的角色 —— 对应 WCAG 4.1.2「名称、角色、值」。
 * 漏一个角色的后果是：那个控件对读屏用户是「一个没有名字的东西」。
 *
 * 🔴 2026-10-29 第一次跑就把 `main` 放进来了 ⇒ 10 页全红、11 条，
 *    而实际错的是**判据**：WCAG 4.1.2 管的是「用户界面组件」，
 *    页面上**唯一**的 `main` 地标没有名字是完全正确的（读屏念"主区域"），
 *    只有同类地标出现**多个**时才必须靠名字区分。
 *    ⇒ 地标类角色改走 `LANDMARK_MULTI` 的计数判据，不再无脑要求名字。
 *    ⚠️ 这正是"红得整齐"最可疑的地方：真问题通常零散，假红往往成片。
 */
const NEEDS_NAME = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'switch',
  'combobox', 'listbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'tab', 'slider', 'spinbutton', 'dialog', 'alertdialog', 'progressbar',
  'table', 'img',
]);

/* 地标：同类出现 >1 个时才要求每个都有名字（否则读屏只报"导航"，分不清是哪个）。 */
const LANDMARK_MULTI = new Set(['navigation', 'region', 'form', 'main', 'complementary']);

/* 状态里值得进转录的（其余属性对朗读序列没有意义，列出来只会让 diff 抖动） */
const STATE_KEYS = [
  'disabled', 'expanded', 'checked', 'pressed', 'selected', 'required',
  'invalid', 'readonly', 'busy', 'level', 'live', 'atomic', 'modal',
  'multiselectable', 'hasPopup', 'orientation',
];

/* ⭐ 判据本体。抽成纯函数是为了能被 `--selftest` 直接验：
 *   一个判据如果只能靠"跑一遍真实页面看红不红"来验证，
 *   那它红的时候你分不清是页面坏了还是判据坏了。 */
function judge(nodes) {
  const errs = [];
  const seen = new Map();
  for (const n of nodes) {
    if (n.ignored) continue;
    const role = n.role;
    if (ROLE_IGNORE.has(role)) continue;
    const name = (n.name || '').trim();

    if (NEEDS_NAME.has(role)) {
      if (!name) {
        errs.push({ code: 'AX-1', role, why: '可交互角色没有 accessible name' });
      } else if (/^(undefined|null|\[object Object\])$/i.test(name)) {
        errs.push({ code: 'AX-2', role, why: 'accessible name 是占位泄漏：' + name });
      } else if (name.toLowerCase() === role) {
        errs.push({ code: 'AX-2', role, why: 'name 等于角色名（等于没名字）：' + name });
      }
    }
    /* 同名同角色出现多次通常意味着同名控件无法区分，
     * 但列表项/单元格天然会重名 ⇒ 只对可交互角色报。 */
    if (name && NEEDS_NAME.has(role)) {
      const k = role + '\u0000' + name;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
  }

  /* 地标：同类多于一个却没名字 ⇒ 读屏里会出现两个"导航"，用户无法区分 */
  const landmarkCount = {};
  for (const n of nodes) {
    if (n.ignored) continue;
    if (LANDMARK_MULTI.has(n.role)) {
      landmarkCount[n.role] = (landmarkCount[n.role] || 0) + 1;
    }
  }
  for (const n of nodes) {
    if (n.ignored || !LANDMARK_MULTI.has(n.role)) continue;
    if (landmarkCount[n.role] > 1 && !(n.name || '').trim()) {
      errs.push({ code: 'AX-4', role: n.role,
                  why: '同类地标有 ' + landmarkCount[n.role] + ' 个但这个名字是空的' });
    }
  }
  return errs;
}

/* aria-hidden 里放可聚焦元素 —— 读屏用户完全够不到，键盘用户却会撞进去。
 * 这是「看得见的人能用、看不见的人不能用」的最典型形态。 */
function judgeHiddenFocusable(rows) {
  return rows.map((r) => ({ code: 'AX-3', ...r }));
}

/* 结构性节点：即使没有名字也要留（读屏靠它们报「列表，3 项」「表格」）。 */
const STRUCTURAL = new Set([
  'list', 'listitem', 'table', 'row', 'cell', 'columnheader', 'rowheader',
  'grid', 'tablist', 'tabpanel', 'menu', 'dialog', 'main', 'navigation',
  'complementary', 'region', 'group', 'radiogroup', 'toolbar', 'status',
  'alert', 'progressbar', 'img', 'figure', 'blockquote',
]);

/* 默认值是噪音：`[invalid=false]` 每一行都出现，等于没写，
 * 还会让快照因为无关的默认值变化而抖动。 */
function stateIsReal(v) {
  if (v === undefined || v === null) return false;
  if (v === false || v === 'false') return false;
  if (v === 'undefined' || v === 'none' || v === '') return false;
  return true;
}

function line(n) {
  const bits = [n.role];
  if (n.name) bits.push('"' + n.name + '"');
  const st = [];
  for (const k of STATE_KEYS) {
    if (stateIsReal(n.states && n.states[k])) st.push(k + '=' + n.states[k]);
  }
  if (st.length) bits.push('[' + st.join(' ') + ']');
  return bits.join(' ');
}

async function transcript(page) {
  const client = await page.target().createCDPSession();
  await client.send('Accessibility.enable');
  const { nodes } = await client.send('Accessibility.getFullAXTree');

  const byId = new Map(nodes.map((n) => [n.nodeId, n]));

  /* 文字在 StaticText 子节点里；父节点（paragraph/code/strong）名字是空的。
   * 只按名字过滤会把这些**正文**全丢掉 —— 而正文正是读屏要念的东西。
   * ⇒ 名字为空时向下收集 StaticText 拼成名字（截断到 60 字）。
   *
   * ⚠️ 必须**遇到块级元素就停**：否则 `main` 会把整页正文拼成自己的名字
   *    （第一次生成时就是这样，转录里出现一行 300 字的 main，
   *     而读屏根本不会那么念）。正文归属它的段落，不归属容器。 */
  const BLOCK_STOP = new Set(['paragraph', 'heading', 'listitem', 'cell',
                              'row', 'rowheader', 'columnheader']);
  const textOf = (id, acc, isRoot) => {
    const n = byId.get(id);
    if (!n) return acc;
    const role = n.role && n.role.value ? String(n.role.value) : '';
    if (role === 'StaticText' && n.name && n.name.value) {
      acc.push(String(n.name.value).trim());
      return acc;
    }
    /* 从**根节点本身**开始是允许的；但一旦往下走进块级元素就停 ——
       容器（main/section）不该把整页正文吞成自己的名字。 */
    if (!isRoot && BLOCK_STOP.has(role)) return acc;
    for (const c of n.childIds || []) textOf(c, acc, false);
    return acc;
  };

  const hasBlockDescendant = (id, seenB) => {
    if (seenB.has(id)) return false;
    seenB.add(id);
    const n = byId.get(id);
    if (!n) return false;
    for (const c of n.childIds || []) {
      const cn = byId.get(c);
      const cr = cn && cn.role && cn.role.value ? String(cn.role.value) : '';
      if (BLOCK_STOP.has(cr)) return true;
      if (hasBlockDescendant(c, seenB)) return true;
    }
    return false;
  };

  const out = [];
  const seen = new Set();
  /* 语义缩进 = 被保留的祖先数（不是原始树深度）。
   * 原始深度会把被过滤掉的节点也算进去，diff 里看起来像"层级跳了两级"。 */
  const walk = (id, depth) => {
    if (seen.has(id)) return;
    seen.add(id);
    const raw = byId.get(id);
    if (!raw) return;
    const role = raw.role && raw.role.value ? String(raw.role.value) : '';
    let name = raw.name && raw.name.value ? String(raw.name.value) : '';
    const states = {};
    for (const p of raw.properties || []) {
      if (STATE_KEYS.includes(p.name)) {
        states[p.name] = p.value && p.value.value !== undefined ? p.value.value : true;
      }
    }
    /* 只在「这一支里没有任何块级后代」时合成名字。
       有块级后代说明它是容器，正文归那些段落 —— 否则 main 会把整页吞成名字。 */
    if (!name && !ROLE_IGNORE.has(role) && !hasBlockDescendant(id, new Set())) {
      name = textOf(id, [], true).join(' ');
    }
    name = name.replace(/\s+/g, ' ').slice(0, 60);

    const keep = !raw.ignored && !ROLE_IGNORE.has(role) &&
                 (name !== '' || STRUCTURAL.has(role) ||
                  Object.keys(states).some((k) => stateIsReal(states[k])));
    if (keep) out.push({ role, name, states, depth });
    for (const c of raw.childIds || []) walk(c, keep ? depth + 1 : depth);
  };
  if (nodes.length) walk(nodes[0].nodeId, 0);
  return out;
}

/* ---------- 自检：判据必须抓得到它该抓的 ---------- */
function selftest() {
  let bad = 0;
  const cases = [
    // [说明, 节点, 期望错误码]
    ['正常按钮', [{ role: 'button', name: '保存' }], null],
    ['按钮没名字', [{ role: 'button', name: '' }], 'AX-1'],
    ['名字是 undefined', [{ role: 'link', name: 'undefined' }], 'AX-2'],
    ['名字等于角色名', [{ role: 'button', name: 'button' }], 'AX-2'],
    ['纯装饰节点不判', [{ role: 'generic', name: '' }], null],
    ['静态文本不判', [{ role: 'StaticText', name: '正文' }], null],
    ['dialog 没名字', [{ role: 'dialog', name: '' }], 'AX-1'],
    ['表格没名字要报', [{ role: 'table', name: '' }], 'AX-1'],
    /* 🔴 这两条是第 11 条假红的成因，必须留在自检里： */
    ['单个 main 不需要名字', [{ role: 'main', name: '' }], null],
    ['两个 nav 都没名字', [{ role: 'navigation', name: '' },
                          { role: 'navigation', name: '' }], 'AX-4'],
    ['两个 nav 都有名字', [{ role: 'navigation', name: '主导航' },
                          { role: 'navigation', name: '页脚导航' }], null],
  ];
  for (const [why, nodes, want] of cases) {
    const got = judge(nodes);
    const code = got.length ? got[0].code : null;
    const ok = code === want;
    if (!ok) bad++;
    console.log('  ' + (ok ? 'OK ' : 'RED') + ' ' + why.padEnd(20) +
                ' 期望 ' + String(want).padEnd(6) + ' 得到 ' + String(code));
  }
  /* 覆盖完整性判据也必须自己被打一遍：
   * 一条只会说"全部覆盖"的判据和一个永远返回 true 的函数没有区别。 */
  const cov = [
    ['漏页必须红', checkCoverage(PAGES.slice(1)), '但清单里没有'],
    ['指向不存在的页必须红',
     checkCoverage(PAGES.concat([['ghost', 'no/such/demo.html', 'x']])),
     '磁盘上没有'],
    ['重复登记必须红', checkCoverage(PAGES.concat([PAGES[0]])), '登记了两次'],
    ['原样必须绿', checkCoverage(PAGES), null],
  ];
  for (const [why, errs, needle] of cov) {
    const ok = needle ? errs.some((e) => e.includes(needle)) : errs.length === 0;
    if (!ok) bad++;
    console.log('  ' + (ok ? 'OK ' : 'RED') + ' 覆盖判据：' + why.padEnd(14) +
                ' ' + (errs.length ? '报 ' + errs.length + ' 条' : '0 条'));
  }
  console.log('');
  console.log(bad ? '  ⇒ 🔴 判据自检 ' + bad + ' 条不成立' : '  ⇒ ✅ 判据自检全部成立');
  return bad ? 1 : 0;
}

/* ---------------------------------------------------------------------------
 * 稳定采样：同一份页面连采两次，**逐字节相同**才算数
 *
 * 🔴 为什么要这个（0.16.1，并发下实测到）
 *   `goto(networkidle0)` 只保证"网络静了"，**不保证组件的 JS 已经改完 DOM**。
 *   全量门禁 4 路并发时，combobox 页出现过一次这样的转录：
 *       - combobox "关注板块" [hasPopup=listbox]
 *       + textbox "关注板块"
 *   单独跑永远复现不出来。危险方向是**反过来**：如果这次恰好是在 `--update`，
 *   基线就会录下一个「组件还没初始化完」的树 —— 之后每次真跑都红，
 *   而人会以为是组件坏了。
 *
 * => 采样直到连续两次一致，最多 6 次。仍然不一致 => 返回 null（判失败，不录）。
 *   宁可红着说「这页 AX 树不稳定」，也不要录一份不稳定的基线。
 * ------------------------------------------------------------------------- */
async function stableTranscript(page) {
  const key = (t) => t.map((n) => [n.nodeId, n.role, n.depth, n.name].join('|')).join('\u000a');
  let prev = null;
  for (let i = 0; i < 6; i++) {
    const t = await transcript(page);
    if (prev !== null && key(t) === prev) return t;
    prev = key(t);
    await new Promise((r) => setTimeout(r, 90 + i * 90));
  }
  return null;
}

(async () => {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  const UPDATE = process.argv.includes('--update');
  const only = process.argv.slice(2).find((a) => !a.startsWith('--'));

  /* 覆盖闸门放在最前面：漏了页却照常出"✅ 全部通过"，比不跑更糟。 */
  const covErrs = checkCoverage(PAGES);
  if (covErrs.length) {
    console.error('  🔴 页面清单与磁盘不一致 ' + covErrs.length + ' 处：');
    for (const e of covErrs.slice(0, 10)) console.error('     - ' + e);
    console.error('     每页都要有一行「这一页负责证什么」，写不出来说明该页'
                  + '与别页语义重复 —— 那是删页的理由，不是跳过的理由。');
    process.exit(2);
  }

  try {
    await new Promise((res, rej) => {
      const r = require('http').get(BASE + '/index.html', (s) => { s.resume(); res(); });
      r.on('error', rej);
      r.setTimeout(3000, () => r.destroy(new Error('timeout')));
    });
  } catch (e) {
    console.error('  🔴 读不到 ' + BASE + ' —— 这不是"跳过"，是**没有取证**。');
    console.error('     先起本地静态服务（check-all.sh 会自动起）。');
    process.exit(2);
  }

  fs.mkdirSync(SNAP_DIR, { recursive: true });
  const browser = await launch();
  let fails = 0, drifts = 0, done = 0;

  for (const [id, rel, why] of PAGES) {
    if (only && only !== id) continue;
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    try {
      await page.goto(BASE + '/' + rel, { waitUntil: 'networkidle0', timeout: 15000 });
    } catch (e) {
      console.log('  🔴 ' + id + ' 打不开：' + String(e).slice(0, 60));
      fails++;
      await page.close();
      continue;
    }
    const nodes = await stableTranscript(page);
    if (nodes === null) {
      console.log('  🔴 ' + id.padEnd(16) + ' AX 树在 6 次采样内不稳定（组件 JS 还没跑完？）');
      console.log('       不录基线、也不判通过 —— 这种状态下量到的东西不能当证据');
      fails++;
      await page.close();
      continue;
    }

    /* aria-hidden 祖先里有没有可聚焦元素 —— 用真实 DOM 判，不看 AX 树 */
    const hiddenFocusable = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('[aria-hidden="true"]').forEach((h) => {
        h.querySelectorAll('a[href],button,input,select,textarea,[tabindex]').forEach((el) => {
          if (el.getAttribute('tabindex') === '-1') return;
          out.push((el.tagName + ' ' + (el.className || '')).slice(0, 60));
        });
      });
      return out;
    });

    const errs = judge(nodes).concat(judgeHiddenFocusable(
      hiddenFocusable.map((el) => ({ why: 'aria-hidden 里有可聚焦元素：' + el }))));

    /* 转录：只留有语义的行，缩进体现层级 */
    const text = nodes
      .filter((n) => !n.ignored && !ROLE_IGNORE.has(n.role))
      .map((n) => '  '.repeat(Math.max(0, n.depth)) + line(n))
      .join('\n') + '\n';

    const file = path.join(SNAP_DIR, id + '.txt');
    const header = '# ' + id + ' — ' + why + '\n' +
                   '# 由 05-audit/a11y-ax.js 生成；这是可访问性树的线性转录，' +
                   '不是录音。\n# 改动的含义是「屏幕阅读器会念的东西变了」。刷新：' +
                   'node 05-audit/a11y-ax.js --update\n';
    const body = header + text;

    if (UPDATE) {
      fs.writeFileSync(file, body, 'utf-8');
    } else if (!fs.existsSync(file)) {
      console.log('  🔴 ' + id.padEnd(16) + ' 没有快照 ⇒ 未取证（跑 --update 生成）');
      fails++;
    } else {
      const was = fs.readFileSync(file, 'utf-8');
      if (was !== body) {
        const a = was.split('\n'), b = body.split('\n');
        let i = 0;
        while (i < a.length && a[i] === b[i]) i++;
        console.log('  🔴 ' + id.padEnd(16) + ' 朗读序列变了（第 ' + (i + 1) + ' 行）');
        console.log('       - ' + (a[i] === undefined ? '(无)' : a[i].slice(0, 78)));
        console.log('       + ' + (b[i] === undefined ? '(无)' : b[i].slice(0, 78)));
        console.log('       核实无误后：node 05-audit/a11y-ax.js --update，并把 diff 一起提交');
        drifts++;
      }
    }

    for (const e of errs) {
      // 🔴 带上 role：不带的话「可交互角色没有 accessible name」这句话
      //    在一页有 200 个节点时等于没说 —— 你根本不知道去找哪个元素。
      console.log('  🔴 ' + id.padEnd(16) + ' ' + e.code +
                  (e.role ? ' [' + e.role + ']' : '') + ' ' + e.why);
      fails++;
    }
    if (!errs.length && (UPDATE || fs.existsSync(file))) {
      console.log('  OK ' + id.padEnd(16) + nodes.length +
                  ' 个语义节点');
    }
    done++;
    await page.close();
  }

  await browser.close();
  console.log('');
  if (!done) {
    console.error('  🔴 一页都没跑 ⇒ 假绿，不许出结论');
    process.exit(2);
  }
  console.log('  转录 ' + done + ' 页 · 判据失败 ' + fails + ' · 快照漂移 ' + drifts);
  if (fails || drifts) {
    console.log('  ⇒ 🔴 未通过（WCAG 4.1.2 名称/角色/值，或朗读序列与快照不一致）');
    process.exit(1);
  }
  console.log('  ⇒ ✅ 每页的每个可交互控件都有名字，朗读序列与快照一致');
  process.exit(0);
})();
