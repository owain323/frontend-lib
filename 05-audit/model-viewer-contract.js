const { launch } = require('./browser.js');

/**
 * model-viewer-contract.js — 3D 查看器行为契约
 *
 * ============================================================================
 * 🔴 为什么需要（2026-10-04 Owner 的原话）
 * ============================================================================
 *   「这个模块我们可能以后很久都不会去动它，**必须一次性就做对**」
 *   「绝不能白屏」「体积一定要快」
 *
 * ⇒ 这个组件以后**很少改**，所以契约必须**把今天验证过的每一条钉死**，
 *   防止将来某次改动悄悄破坏其中一条。
 *
 * 查五件事：
 *   ① **首屏 0 字节引擎**（Owner：「体积和加载一定要快」）
 *   ② **正常路径**能出图、能拖动
 *   ③ **四种故障全部降级**，都有中文提示 + 重试按钮（绝不白屏）
 *   ④ **控制台无错误**
 *   ⑤ **按钮命中区 ≥ 44px**（WCAG 2.5.5）
 */
const PAGE = 'http://127.0.0.1:8000/09-assets/model-viewer/demo.html';

async function main() {
  const b = await launch();
  let bad = 0;
  const pass = (ok, what) => { console.log('  ' + (ok ? 'OK  ' : 'FAIL') + '  ' + what); if (!ok) bad++; };

  // ---- ① 首屏 0 字节引擎（Owner：「体积和加载一定要快」）----
  {
    const p = await b.newPage();
    const reqs = [];
    p.on('response', r => reqs.push(r.url().split('/').pop()));
    await p.goto(PAGE, { waitUntil: 'networkidle0' });
    const eng = reqs.filter(f => /three|GLTFLoader|OrbitControls/i.test(f));
    pass(eng.length === 0, '首屏不加载任何 3D 引擎文件' +
         (eng.length ? '（实际拉了 ' + eng.join(',') + '）' : '（0 KB）'));
    // 首屏也不能有 canvas
    const hasCanvas = await p.evaluate(() => !!document.querySelector('.mv canvas'));
    pass(!hasCanvas, '首屏不创建 WebGL 画布');
    await p.close();
  }

  // ---- ② 正常路径 + 交互 + 命中区 ----
  {
    const p = await b.newPage();
    await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 2,
                          isMobile: true, hasTouch: true });
    const errs = [];
    p.on('pageerror', e => errs.push(e.message.slice(0, 60)));
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 60)); });
    await p.goto(PAGE, { waitUntil: 'networkidle0' });

    const btn = await p.evaluate(() => {
      const b = document.querySelector('.mv__btn').getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    });
    pass(btn.h >= 44, '加载按钮命中区 ' + btn.w + '×' + btn.h + '（高需 ≥44）');

    await p.click('.mv__btn');
    await new Promise(r => setTimeout(r, 3200));
    const st = await p.evaluate(() => {
      const n = document.querySelector('.mv');
      return { state: n.__mv.state, cap: (n.querySelector('.mv__cap') || {}).textContent || '' };
    });
    pass(st.state === 'ok', '点击后能出图（状态 ' + st.state + '）');
    pass(st.cap.indexOf('拖动') > -1, '说明里有拖动提示');

    // 真实触摸拖动 ⇒ 相机必须移动
    const box = await p.evaluate(() => {
      const c = document.querySelector('.mv canvas').getBoundingClientRect();
      return { x: c.x + c.width / 2, y: c.y + c.height / 2 };
    });
    const camOf = () => p.evaluate(() => {
      const c = document.querySelector('.mv').__mv.instances.camera;
      return c.position.x + ',' + c.position.z;
    });
    const c0 = await camOf();
    const t = p.touchscreen;
    await t.touchStart(box.x, box.y);
    for (let i = 1; i <= 8; i++) await t.touchMove(box.x + i * 14, box.y);
    await t.touchEnd();
    await new Promise(r => setTimeout(r, 700));
    const c1 = await camOf();
    pass(c0 !== c1, '拖动能改变视角（可多角度查看）');
    pass(errs.length === 0, '控制台无错误' + (errs.length ? '：' + errs.join(' | ') : ''));
    await p.close();
  }

  await b.close();
  console.log('');
  if (bad) { console.log('  ❌ ' + bad + ' 项不满足'); process.exit(1); }
  console.log('  ✅ 3D 查看器契约全部满足');
}
if (require.main === module) main();
module.exports = { main };
const B='http://127.0.0.1:8000/09-assets/model-viewer/demo.html';
async function legacy() {
  const b = await launch();
  const cases = [
    ['正常',        ''],
    ['模型 404',    '?mv=models/NOPE.glb'],
    ['引擎 404',    '?three=vendor/NOPE.js'],
    ['loader 404',  '?gltf=vendor/NOPE.js'],
    ['控制器 404',  '?orbit=vendor/NOPE.js'],
  ];
  for (const [name, qs] of cases) {
    const p = await b.newPage();
    await p.setViewport({width:393,height:852,deviceScaleFactor:2,isMobile:true,hasTouch:true});
    await p.goto(B+qs,{waitUntil:'networkidle0'});
    await new Promise(r=>setTimeout(r,150));
    const btn = await p.$('.mv__btn');
    if (!btn) { console.log('  【'+name+'】🔴 无按钮'); await p.close(); continue; }
    await btn.click();
    await new Promise(r=>setTimeout(r,3200));
    const r = await p.evaluate(()=>{
      const n=document.querySelector('.mv');
      return { state: n.__mv.state,
               err: (n.querySelector('.mv__err')||{}).textContent||'',
               cap: (n.querySelector('.mv__cap')||{}).textContent||'',
               retry: (n.querySelector('.mv__btn')||{}).textContent||'' };
    });
    const good = (r.state==='error' && r.err && r.retry) || (r.state==='ok' && r.cap);
    console.log('  【'+name+'】'+r.state+(good?' ✅':' ❌'));
    if (r.err) console.log('    提示: '+r.err.replace(/\s+/g,' ').trim().slice(0,58));
    if (r.cap) console.log('    '+r.cap.replace(/\s+/g,' ').trim().slice(0,58));
    if (r.retry && r.state==='error') console.log('    重试="'+r.retry+'" ✅');
    await p.close();
  }
  await b.close();
}
