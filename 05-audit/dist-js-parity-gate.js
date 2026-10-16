/**
 * dist-js-parity-gate.js — dist 的 JS 与源码**语义等价**断言（0.8.9 · 审计 P1-2）
 *
 * ============================================================================
 * 这道门禁补的是哪个洞
 * ---------------------------------------------------------------------------
 * `dist-parity-check.js` 只对 **CSS** 做 CSSOM 双向比对，JS 被一行
 * `if (!f.source.endsWith('.css')) continue;` **整体跳过**。
 * 对 JS 产物的唯一把关是 `node --check`（只查语法，而且 pack-smoke 只查前 12 个）。
 *
 * ⇒ 结论：**「dist 与源码一致」这条对外承诺，对 JS 部分没有任何机械证据。**
 *   只查语法抓不到「语义被改但语法仍合法」—— 而那恰恰是剥注释最容易出的错
 *   （行注释与块注释的处理一旦越界，就会吃掉真正的代码）。
 *
 *   ⚠️ 写这行注释时我自己踩了一次：原文里写了「块注释的两个定界符」的**字面形式**，
 *      其中的收尾符**提前结束了这段注释块** ⇒ `node --check` 直接语法错误。
 *      这正是本文件要防的那类问题，只是发生在了注释层。
 *      （今天第二次踩 —— 第一次是 token-parse-gate 的反向控制 fixture。）
 *   ⇒ 纪律：**注释里永远不要写块注释的收尾符字面量**。
 *
 * ============================================================================
 * 判据：把同一份文件的两个版本喂给**真实浏览器**，比对可观测行为
 * ---------------------------------------------------------------------------
 * 对每个有 JS 的组件：
 *   ① 在空白页加载**源码版**，记录 { 新增的 window 全局, 抛的错 }
 *   ② 换一张干净页，加载 **dist 版**，同样记录
 *   ③ 两者必须**逐项相同**
 *
 * ⭐ 为什么比对"全局 + 报错"而不是比对文本：
 *   文本层面的"去注释"是**定义**（dist 就是这么生成的），比它没有信息量。
 *   有信息量的是**可观测行为**：剥注释如果吃掉了代码，
 *   要么少暴露一个全局、要么抛错、要么报错信息变了 —— 三者都会被这里抓到。
 *
 * ⚠️ 空白页上很多组件会因缺 DOM 而抛错 —— **那是正常的**，两边都抛同样的错即可。
 *    这类"环境性报错"恰好也在判据的覆盖范围内：**剥注释不该改变报错**。
 *
 * ============================================================================
 * 已知盲区（如实写出，不假装覆盖）
 * ---------------------------------------------------------------------------
 * · 只覆盖 `ai/components.json` 里声明了 `files.js` 的组件
 * · 只观测 **load 时的即时效果**；组件「运行时才暴露的全局」抓不到
 *   ⇒ 那需要按 demo 页真实使用一遍，属下一步（见文件尾 TODO）
 * · 不覆盖 05-audit 自己的脚本（它们不是产物）
 *
 * 用法：node 05-audit/dist-js-parity-gate.js [--selftest]
 */
const fs = require('fs');
const path = require('path');
const { withPage } = require(path.resolve(__dirname, 'browser.js'));

const ROOT = path.resolve(__dirname, '..');

/** 收集要检查的 (源码JS, dist JS) 对 */
function pairs() {
  const comps = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'ai', 'components.json'), 'utf-8')).components;
  const out = [];
  for (const c of comps) {
    const rel = c.files && c.files.js;
    if (!rel) continue;
    const dist = 'dist/' + rel;
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    if (!fs.existsSync(path.join(ROOT, dist))) {
      out.push({ id: c.id, src: rel, dist: null });     // dist 缺失，单独报
      continue;
    }
    out.push({ id: c.id, src: rel, dist: dist });
  }
  return out;
}

/** 在页面里加载一个 script，记录它造成的可观测变化 */
const OBSERVE = (url) => {
  const before = new Set(Object.getOwnPropertyNames(window));
  return new Promise((resolve) => {
    const s = document.createElement('script');
    let err = null;
    s.onerror = () => { err = 'resource-error'; resolve({ globals: [], err }); };
    window.onerror = (m) => { err = String(m); };
    s.src = url;
    s.onload = () => {
      const after = Object.getOwnPropertyNames(window)
        .filter((k) => !before.has(k)).sort();
      resolve({ globals: after, err: err });
    };
    document.head.appendChild(s);
  });
};

/** 从报错文本里抹掉**路径与行号** —— 它们本来就会随文件不同而不同 */
function normErr(e) {
  if (!e) return null;
  return String(e)
    .replace(/https?:\/\/[^\s)]+/g, '<url>')
    .replace(/\b\d+:\d+\b/g, '<ln>')
    .slice(0, 120);
}

async function observe(rel) {
  const base = 'http://127.0.0.1:' + (process.env.FL_PORT || '8000');
  const url = base + '/' + rel;
  return withPage({}, async (p) => {
    // 🔴 必须走**同源**的空页，不能用 about:blank（0.8.9 实测踩到）：
    //   `about:blank` 的 origin 是 `about:`，从它加载 `http://127.0.0.1:8000/...`
    //   会被当跨域 ⇒ 两边都 `resource-error` ⇒ 判"报错一致"⇒ **假绿**
    //   （18 个样本全"通过"，其实一个都没加载）。
    //   ⇒ 用 05-audit/_blank.html（同源、无脚本、无样式依赖）。
    await p.goto(base + '/05-audit/_blank.html');
    return p.evaluate(OBSERVE, url);
  });
}

async function main() {
  const list = pairs();
  if (!list.length) {
    console.log('  🔴 视野已空：一个带 JS 的组件都没找到');
    console.log('     ⇒ 这道门禁没在核对任何东西，不应判通过');
    return 1;
  }

  console.log('  === dist 的 JS 与源码语义等价（真实浏览器）===')
  console.log('');
  let bad = 0;
  let checked = 0;
  let envFailures = 0;          // 「资源加载失败」的样本数（用于零加载守卫）

  for (const it of list) {
    if (!it.dist) {
      console.log('  🔴 ' + it.id.padEnd(20) + ' dist 里**没有** ' + it.src);
      bad += 1;
      continue;
    }
    let a, b;
    try {
      a = await observe(it.src);
      b = await observe(it.dist);
    } catch (e) {
      console.log('  🔴 ' + it.id.padEnd(20) + ' 观测失败：'
        + String(e).slice(0, 90));
      bad += 1;
      continue;
    }
    checked += 1;
    if (a.err === 'resource-error' && b.err === 'resource-error') envFailures += 1;
    const ga = JSON.stringify(a.globals);
    const gb = JSON.stringify(b.globals);
    const ea = normErr(a.err);
    const eb = normErr(b.err);
    const sameG = ga === gb;
    const sameE = ea === eb;

    if (sameG && sameE) {
      console.log('  OK  ' + it.id.padEnd(20) + ' 全局 ' + a.globals.length
        + ' 个 · 报错一致'
        + (ea ? '（同为环境性报错）' : '（都没报错）'));
    } else {
      bad += 1;
      console.log('  🔴 ' + it.id.padEnd(20) + ' 源码与 dist 行为不同！');
      if (!sameG) {
        console.log('       全局：源码 ' + ga);
        console.log('              dist ' + gb);
        console.log('       ⇒ 剥注释可能吃掉了真正的代码（语法仍合法，'
          + '所以 node --check 抓不到）');
      }
      if (!sameE) {
        console.log('       报错：源码 ' + ea);
        console.log('              dist ' + eb);
      }
    }
  }

  console.log('')
  console.log('  实查 ' + checked + ' / ' + list.length + ' 个带 JS 的组件');

  // 🔴 零加载守卫（0.8.9 加 · 起因：我自己踩过一次假绿）
  // --------------------------------------------------------------------
  // 如果**所有**样本都是「资源加载失败」（resource-error），
  // 那说明环境不对（静态服务没起 / 用了异源白纸页），
  // 此时"两边报错一致"是**必然**的 ⇒ 判据空转 ⇒ 绝不能判通过。
  //   实测踩到：用 about:blank 当白纸页时，18/18 全部 resource-error，
  //   而脚本输出了「✅ 全部等价」——**一道假绿门禁**。
  if (envFailures >= checked && checked > 0) {
    console.log('');
    console.log('  🔴 ' + envFailures + ' / ' + checked
      + ' 个样本都是「资源加载失败」⇒ 这不是通过，是**环境不对**：');
    console.log('     · 静态服务没起？先跑 05-audit/serve.py 或 python -m http.server 8000');
    console.log('     · 用了异源的空白页？（about:blank 加载 http 脚本会被当跨域）');
    console.log('     ⇒ 此时"两边报错一致"是必然的，判据其实什么都没测。');
    return 1;
  }
  if (envFailures) {
    console.log('  ⚠️ 有 ' + envFailures + ' 个样本报「资源加载失败」，'
      + '它们的结果不可信（见上）');
  }
  console.log('  ⚠️ 盲区：只观测 load 时的即时效果；'
    + '「运行时才暴露的全局」这一层还没覆盖');
  if (bad) {
    console.log('')
    console.log('  🔴 ' + bad + ' 个组件的 dist JS 与源码不等价');
    return 1;
  }
  console.log('  ✅ 全部等价：dist 的 JS 与源码在可观测行为上一致');
  return 0;
}

/* ============================================================================
 * 反向控制：证明它会红
 * ---------------------------------------------------------------------------
 * ⚠️ 必须在**临时目录**里改坏 dist 的副本，绝不碰真 dist
 *    （P0-1 的教训：反向控制有副作用，中断就污染）。
 *    做法：复制一份 dist 出来，在副本上删掉一行代码，指向副本跑一次，
 *    确认判据报红。
 * ============================================================================ */
async function selftest() {
  console.log('  === 反向控制 ===');
  console.log('');
  let bad = 0;

  // 找一个"在空白页上确实暴露了全局"的 JS —— 只有这样改坏它才看得出来
  const cand = pairs().filter((p) => p.dist
    && /overlay|accordion|pagination|tabs/.test(p.src));
  if (!cand.length) {
    console.log('  🔴 找不到可用于反向控制的样本');
    return 1;
  }
  const target = cand[0];
  console.log('  用 ' + target.src + ' 做样本');

  const before = await observe(target.src);
  console.log('     源码版：全局 ' + before.globals.length + ' 个，报错 '
    + (normErr(before.err) || '无'));

  // 造一个"被改坏"的 dist：**删掉最后一行有效代码**。
  //
  // ⚠️ 第一版我用 `replace(/window\.([A-Z]\w*)\s*=/, '__BROKEN__')` ——
  //    **没用**：它匹配到的是文件里**第一个** `window.X =`，
  //    而那是 `window.CustomEvent =`（一个 polyfill 赋值），
  //    不是真正暴露组件的 `window.Accordion = `。
  //    ⇒ 改坏后全局仍然照常暴露 ⇒ 判据看不到差异 ⇒ 反向控制报"没鉴别力"。
  //    ⭐ 这又是一次「**fixture 写错，看起来像判据失效**」——
  //      和 purg-css-selftest、css-imports-selftest 同一个模式。
  //
  // 「删掉最后一行」正是本判据要防的那类破坏的**典型形态**：
  //  剥注释时把行注释的边界判错，最常吃掉的就是**紧随注释的那行代码**。
  const srcTxt = fs.readFileSync(path.join(ROOT, target.dist), 'utf-8');
  const srcLines = srcTxt.split('\n').filter((l) => l.trim() !== '');
  const broken = srcLines.slice(0, -1).join('\n') + '\n';
  const tmpRel = 'dist/__parity_probe.js';
  const tmpAbs = path.join(ROOT, tmpRel);
  const existed = fs.existsSync(tmpAbs);
  if (existed) {
    console.log('  🔴 临时文件已存在（上次没清干净）：' + tmpRel);
    return 1;
  }
  fs.writeFileSync(tmpAbs, broken, 'utf-8');
  try {
    const after = await observe(tmpRel);
    console.log('     改坏版：全局 ' + after.globals.length + ' 个，报错 '
      + (normErr(after.err) || '无'));
    const differs = JSON.stringify(after.globals) !== JSON.stringify(before.globals)
      || normErr(after.err) !== normErr(before.err);
    console.log('  ' + (differs ? 'OK ' : '🔴 ')
      + ' 改坏后行为确实不同 ⇒ 判据有鉴别力');
    if (!differs) bad += 1;
  } finally {
    // 🔴 无论成败都要清掉，且**验证清掉了**
    fs.rmSync(tmpAbs, { force: true });
    if (fs.existsSync(tmpAbs)) {
      console.log('  🔴 临时文件清理失败：' + tmpRel + '（请手工删除）');
      bad += 1;
    }
  }

  console.log('');
  console.log('  ' + (bad ? '🔴 反向控制没通过' : '反向控制通过'));
  return bad ? 1 : 0;
}

if (process.argv.includes('--selftest')) {
  selftest().then((rc) => process.exit(rc))
    .catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
} else {
  main().then((rc) => process.exit(rc))
    .catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
}
