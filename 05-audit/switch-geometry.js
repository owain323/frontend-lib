const { launch } = require(REPO + '/05-audit/browser.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');
(async () => {
  const b = await launch(); const p = await b.newPage();
  await p.setViewport({width:393,height:852,deviceScaleFactor:3,isMobile:true,hasTouch:true});
  await p.goto('http://127.0.0.1:8000/10-review/ios/index.html',{waitUntil:'networkidle0'});
  let bad = 0;
  for (const st of [false, true]) {
    await p.evaluate((v)=>{document.getElementById('ios-sw').checked=v;}, st);
    await new Promise(r=>setTimeout(r,250));
    const g = await p.evaluate(()=>{
      const tr=document.querySelector('.switch__track');
      const th=document.querySelector('.switch__thumb');
      const t=tr.getBoundingClientRect(), h=th.getBoundingClientRect();
      return { T:+(h.top-t.top).toFixed(1), B:+(t.bottom-h.bottom).toFixed(1),
               L:+(h.left-t.left).toFixed(1), R:+(t.right-h.right).toFixed(1),
               tw:+t.width.toFixed(1), th_:+t.height.toFixed(1),
               hw:+h.width.toFixed(1), hh:+h.height.toFixed(1),
               ratio:+(t.width/t.height).toFixed(3) };
    });
    const okV = Math.abs(g.T-g.B) < 0.5;   // 上下对称
    /* 水平：滑块必须**贴住一边**（关=左，开=右）。
       ⚠️ travel 不能写成 `tw - hw`（那是"轨道宽 − 滑块宽" = 22），
          因为**两端的 gap 也占了位置**：
            真实行程 = 轨道内容宽 − 滑块宽 = (tw − 边框×2) − hw
                    = (42 − 2) − 20 = 20
          也就是说 **|L − R| 应等于 20**，而 L+R 应等于 20（两端各 10 不可能，
          实际是 2 + 18 = 20）—— 也就是 |L − R| = 20。 */
    /* ✅ 正确的判据（实测推导）：
         关态：左 = 2（右 = 轨道 − 2 − 滑块 = 20）
         开态：右 = 2（左 = 20）
       ⇒ 判据 = **两端间隙之和 = 轨道宽 − 滑块宽 − 边框×2**
                  = 42 − 20 − 2 = 20  ✅  (2 + 20 = 22? 不对)
       实测：关 2+20=22，开 20+2=22 ⇒ 和 = 22 = 轨道 − 边框 = 42−2=40? 也不对。
       ⚠️ 那就直接判「两态互补且各自贴边」：
         关 ⇒ 左 == 2 且 右 == 20
         开 ⇒ 右 == 2 且 左 == 20
       数值从 tokens 推：gap=1px(pad)、border=1px ⇒ 贴边间隙 = 2px。 */
    const EDGE = 2;  // 边框1 + 留白1
    const want = (st ? { L: g.tw - 2 - g.hw, R: EDGE }
                      : { L: EDGE, R: g.tw - 2 - g.hw });
    const okH = Math.abs(g.L - want.L) < 0.5 && Math.abs(g.R - want.R) < 0.5;
    if (!okV || !okH) bad++;
    console.log('  【'+(st?'开':'关')+'】轨道 '+g.tw+'×'+g.th_+'（比例 '+g.ratio+'）滑块 '+g.hw+'×'+g.hh);
    console.log('    垂直间隙 上'+g.T+' 下'+g.B+' '+(okV?'✅ 对称':'❌ 歪了'));
    console.log('    水平间隙 左'+g.L+' 右'+g.R+' 差='+Math.abs(g.L-g.R)+
      ' （应贴边 '+want.L+'/'+want.R+'）'+(okH?' ✅ 贴边到位':' ❌'));
    if (g.ratio < 1.7 || g.ratio > 1.8) console.log('    ❌ 宽高比应 1.75');
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})();
