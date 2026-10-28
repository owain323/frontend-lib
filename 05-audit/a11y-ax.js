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

/* 要转录的页面：挑的是「交互语义各不相同」的那批，不是随便凑数。
 * 覆盖面 = 有名字/有状态/有组合关系的四类角色都出现。 */
const PAGES = [
  ['button', '02-primitives/button/demo.html', '按钮：名字 + disabled/busy 状态'],
  ['input', '02-primitives/input/demo.html', '输入：label 关联 + 错误描述'],
  ['select', '02-primitives/select/demo.html', '下拉：combobox 角色 + expanded'],
  ['choice', '02-primitives/choice/demo.html', '单选/复选：checked + group'],
  ['switch', '02-primitives/switch/demo.html', '开关：switch 角色 + checked'],
  ['tabs', '03-patterns/tabs/demo.html', '标签页：tablist/tab + selected + controls'],
  ['overlay', '03-patterns/overlay/demo.html', '浮层：dialog + modal + 名字'],
  ['table', '04-recipes/table/demo.html', '表格：table/row/columnheader 关系'],
  ['states', '03-patterns/states/demo.html', '状态消息：status/alert 播报'],
  ['form-validation', '03-patterns/form-validation/demo.html', '表单校验：invalid + 描述'],
];

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
  console.log('');
  console.log(bad ? '  ⇒ 🔴 判据自检 ' + bad + ' 条不成立' : '  ⇒ ✅ 判据自检全部成立');
  return bad ? 1 : 0;
}

(async () => {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  const UPDATE = process.argv.includes('--update');
  const only = process.argv.slice(2).find((a) => !a.startsWith('--'));

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
    const nodes = await transcript(page);

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
      console.log('  🔴 ' + id.padEnd(16) + ' ' + e.code + ' ' + e.why);
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
