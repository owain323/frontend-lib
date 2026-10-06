// puppeteer-core 改由 browser.js 统一持有
  // 🔴 统一走 browser.js：那里会 setCacheEnabled(false)。
  //    没有它，页面里跑的是**缓存的旧代码**，测试会假通过
  //    （磁盘上明明改对了，浏览器里还是旧的）。
  const { launch } = require('./browser');
const AXE = require.resolve('axe-core');

// 判别力验证：注入 5 类典型违规，验证 axe 是否真能抓到（否则"0 违规"不可信）
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
    const res = await window.axe.run(document);
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
  console.log(miss ? '  ' + miss + ' 类漏检' : '  5/5 全部抓到 —— 说明"0 违规"是可信的');
  process.exit(miss ? 1 : 0);
})();
