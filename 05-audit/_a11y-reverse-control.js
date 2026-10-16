// puppeteer-core 改由 browser.js 统一持有
  // 🔴 统一走 browser.js：那里会 setCacheEnabled(false)。
  //    没有它，页面里跑的是**缓存的旧代码**，测试会假通过
  //    （磁盘上明明改对了，浏览器里还是旧的）。
  const { launch } = require('./browser');
const AXE = require.resolve('axe-core');

// 判别力验证：注入 5 类典型违规，验证 axe 是否真能抓到（否则"0 违规"不可信）
//
// 🔴 `duplicate-id` 这一条**抓不到了，而且这是事实**（0.8.9 接入时实测）：
//   · axe-core **4.14.0 已经移除了 `duplicate-id` 规则**
//     （实测 `grep '"duplicate-id"' node_modules/axe-core/axe.js` 无结果）
//   · 我试过加 `best-practice` 标签（那确实是它过去的 tag），仍然不报
//     ⇒ 不是「配置漏了 tag」，是**规则本身不存在了**。
//   · 曾试过 `axe.run(document, {runOnly: {type:'rule', values:[...]}})`
//     显式点名这条规则 —— 规则不存在时 runOnly 点名它会被静默忽略。
//
//   ⇒ 处理方式：**如实标成「工具已无此能力」，但保留这一项在清单里**，
//     让它每次都提醒一遍。删掉它 = 假装这条已经查过了。
//     真要查重复 id，得自己写（`querySelectorAll('[id]')` 收集后查重），
//     已列入路线图。
const CASES = [
  ['image-alt', '<img src="x.png">'],
  ['label', '<input type="text">'],
  ['duplicate-id', '<div id="dup"></div><div id="dup"></div>'],
  ['tabindex', '<div tabindex="5">焦点乱序</div>'],
  ['color-contrast', '<p style="color:#bbbbbb;background:#ffffff">太浅的文字</p>'],
];

(async () => {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  await p.goto('http://127.0.0.1:8000/02-primitives/input/demo.html',
               { waitUntil: 'networkidle0' });
  await p.evaluate((html) => {
    document.body.insertAdjacentHTML('beforeend', html);
  }, CASES.map(([, h]) => h).join('\n'));
  await p.addScriptTag({ path: AXE });
  const v = await p.evaluate(async () => {
    // 🔴 必须带上 best-practice（0.8.9 接入时实测发现的）：
    //   原样 `axe.run(document)` 只跑默认 tag（wcag*），
    //   而 `duplicate-id` 的 tag 是 **best-practice**（它不属于 WCAG 条款）
    //   ⇒ 实测结果：5 类注入里 `duplicate-id` **漏检**。
    //   而重复 id 会破坏 label 的 for 关联与所有 ARIA 引用，
    //   对「语义正确」是致命的，必须查。
    //   ⚠️ 这与 `a11y-scan.js` 的 runOnly 配置必须**一致** ——
    //      否则反向控制验证的是一套配置、真实扫描跑的是另一套
    //      （E31「同一个判定写两遍」的第三次发生）。
    const res = await window.axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa',
                 'best-practice'],
      },
    });
    const out = {};
    res.violations.forEach((x) => { out[x.id] = x.nodes.length; });
    return out;
  });
  console.log('  注入 5 类违规，axe 结果：');
  let miss = 0;
  for (const [id] of CASES) {
    const n = v[id];
    if (!n) miss++;
    console.log('    ' + (n ? 'OK ' : 'NG ') + ' ' +
                id.padEnd(16) + (n ? '×' + n : ' <<< 漏检'));
  }
  await b.close();
  console.log('');
  // 🔴 「已登记的工具缺口」（0.8.9）
  //   axe-core 4.14.0 没有 `duplicate-id` 这条规则了 ⇒ 它**永远**会漏检。
  //   三种处理都会撒谎：
  //     ① 删掉这一项  ⇒ 假装查过了
  //     ② 每次都 exit 1 ⇒ 门禁天天红，且没人能修（工具里没这条规则）
  //     ③ 只打印不改退出码 ⇒ 又是「红的却说不清为什么」
  //   ⇒ 正确做法：**显式登记**，清单里保留 + 每次都提示，
  //      但不计入「漏检」（它不是我们的判据失效，是工具没这个能力）。
  const KNOWN_GAPS = new Set(['duplicate-id']);   // 见上方注释与路线图
  // ⚠️ 只把「在 KNOWN_GAPS 里、且实测确实没抓到」的算作工具缺口；
  //   其余一律算真实漏检。（第一版漏了「实测确实没抓到」这个条件，
  //   而且解构写错 ⇒ 打印出 NaN。）
  const gaps = CASES.filter((c) => c && c[0] && KNOWN_GAPS.has(c[0]) && !v[c[0]]);
  const realMiss = miss - gaps.length;
  if (miss) {
    // 🔴 0.8.9 修：这里原来写成
    //     console.log('… %d …' % (miss, gaps.length))
    //   —— `console.log` **本身就支持 printf 风格占位符**，
    //   再用 `%` 拼一次会得到一个**数组的字符串化结果**，
    //   打印时它又把 `%d` 当占位符再解释一次 ⇒ 输出 `NaN`。
    //   ⇒ 直接把两个值作为参数传给 console.log，不要用 `%` 拼。
    console.log('  ' + miss + ' 类漏检（其中 ' + gaps.length
      + ' 类是 axe-core 已移除该规则，已登记）');
  }
  console.log(realMiss
    ? '  ' + realMiss + ' 类**真实漏检** ⇒「0 违规」不可信'
    : '  其余全部抓到 —— 说明"0 违规"是可信的'
      + (gaps.length
          ? '（已登记的工具缺口：'
            + gaps.map((c) => c[0]).join(' / ') + '）'
          : ''));
  process.exit(realMiss ? 1 : 0);
})();
