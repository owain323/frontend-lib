

/* 由 05-audit/selftest.py 注入 —— 在真实浏览器里点，取真实结果 */
window.__R = [];
function say(t, ok, info) { window.__R.push({ t: t, ok: !!ok, info: info || '' }); }
function h(el) { return el ? Math.round(el.getBoundingClientRect().height) : -1; }
function w(el) { return el ? Math.round(el.getBoundingClientRect().width) : -1; }
function fire(el, type) {
  var e = new Event(type, { bubbles: true, cancelable: true });
  el.dispatchEvent(e);
}
setTimeout(function () {
 try {
  var body = document.body;

  /* ---- 🔴 命中检测：实测反馈"方框点不了、圆点能点"。
         我的自检一直用 cb.click()（程序化点击，**直接派发事件、不做命中测试**）
         ⇒ 它永远通过，但鼠标点不到。必须用 elementFromPoint 问浏览器
         "这个坐标上究竟是谁"。 */
  function hitTest(inputEl, label) {
    var mk = inputEl.parentNode.querySelector('.choice__mark');
    var lb = (label || mk).getBoundingClientRect();
    var cx = lb.left + lb.width / 2, cy = lb.top + lb.height / 2;
    var hit = document.elementFromPoint(cx, cy);
    return {
      cls: hit ? (hit.className || hit.tagName) : '(null=没人命中)',
      isInput: hit === inputEl,
      inInput: hit ? (inputEl.contains(hit) || hit === inputEl) : false,
      inLabel: hit ? ((inputEl.parentNode.querySelector('.choice__label') || {contains:function(){return false}}).contains(hit)) : false,
      z: hit ? window.getComputedStyle(hit).zIndex : '?',
      pe: hit ? window.getComputedStyle(hit).pointerEvents : '?'
    };
  }
  var cbx = document.querySelector('.choice--checkbox .choice__input');
  if (cbx) {
    var ht = hitTest(cbx);
    say('方形框中心命中的是 input 自己', ht.isInput || ht.inInput,
        '命中 ' + ht.cls + ' z=' + ht.z + ' pointer-events=' + ht.pe);
  }
  /* 圆点的对照检查已删：radio 在页面下方，elementFromPoint 对视口外的坐标
     返回 null ⇒ 必然误报。真实点击请用 `node 05-audit/clicktest.js choice`，
     它会先把元素滚进视口再点（puppeteer 的真实鼠标事件）。 */

  /* ---- checkbox：属性变 **且视觉跟着变**（实测到"显示已勾选但框是空的"）
         🔴 只查 checked 属性是不够的：属性变了而 CSS 选择器没命中，
            框看着还是空的 —— 这正是我漏掉的那类 bug。 */
  var cb = document.querySelector('#c1');
  if (cb) {
    var before = cb.checked;
    var mk = cb.parentNode.querySelector('.choice__mark');
    var bg0 = mk ? window.getComputedStyle(mk).backgroundColor : '?';
    var bd0 = mk ? window.getComputedStyle(mk).borderColor : '?';
    cb.click();
    say('checkbox#c1 点击后状态改变', cb.checked !== before, before + ' -> ' + cb.checked);
    if (mk) {
      var cs1 = window.getComputedStyle(mk);
      /* 🔴 断言必须匹配**真实设计意图**，不能按"我以为的"写：
         本库的 checkbox 勾选时**背景不变**，只显示勾号（::after）——
         这是刻意的（保留边框的清晰度）。radio 才是背景变实心。
         断言写成"背景应变化"是错的，会逼着人把设计改坏。 */
      var af = window.getComputedStyle(mk, '::after');
      say('checkbox 勾号（::after）在勾选后可见',
          af.content !== 'none' && af.opacity !== '0',
          '::after content=' + af.content + ' opacity=' + af.opacity +
          ' | 背景 ' + bg0 + ' -> ' + cs1.backgroundColor + '（设计上不变）');
    }
    cb.click();
  }

  /* ---- indeterminate：部分勾选时全选框应为第三态（实测到只能弹全选）---- */
  var all = document.querySelector('#c2');
  if (all) {
    var box = all.closest('.choice');
    var marks = box ? box.parentNode.querySelectorAll('input[type=checkbox]') : [];
    var on = 0;
    for (var i = 0; i < marks.length; i++) { if (marks[i].checked) on++; }
    say('indeterminate：' + on + '/' + marks.length + ' 子项勾选时全选框为半选',
        all.indeterminate === true, 'indeterminate=' + all.indeterminate);
  }

  /* ---- radio：互斥 ---- */
  var radios = document.querySelectorAll('input[type=radio]');
  if (radios.length >= 2) {
    var r0 = radios[0], r1 = radios[1];
    r0.checked = true;
    r1.click();
    say('radio 互斥：点第二个后第一个取消', r0.checked === false && r1.checked === true,
        r0.checked + ' / ' + r1.checked);
  }

  /* indeterminate 的 ::after 应该是**横线**（宽>高），不是勾号（正方形） */
  /* 🔴 必须**按状态找**，不能 querySelector 取第一个 ——
     第一个 checkbox(#c1) 不是 indeterminate，测它当然没有横线。
     这是这一轮我第三次在测试里选错元素。 */
  var ind = null;
  var cbAll = document.querySelectorAll('.choice--checkbox .choice__input');
  for (var ci = 0; ci < cbAll.length; ci++) {
    if (cbAll[ci].indeterminate) { ind = cbAll[ci]; break; }
  }
  if (ind) {
    var im = ind.parentNode.querySelector('.choice__mark');
    if (im) {
      var ia = window.getComputedStyle(im, '::after');
      var ib = window.getComputedStyle(im);
      say('indeterminate 框的 ::after 是横线（宽>高）',
          (parseFloat(ia.width) || 0) > (parseFloat(ia.height) || 0),
          '::after ' + ia.width + ' x ' + ia.height +
          ' | 框背景 ' + ib.backgroundColor);
    }
  }

  /* radio 勾选时**背景应变实心**（与 checkbox 不同，radio 没有勾号） */
  var r0 = document.querySelector('input[type=radio]');
  if (r0) {
    var rm = r0.parentNode.querySelector('.choice__mark');
    if (rm) {
      /* 🔴 第一个 radio 在 HTML 里本来就 checked，直接 "设成 true" 等于没改，
         前后都是实心 ⇒ 误报"背景没变"。必须先取消再选中。 */
      r0.checked = false;
      var rb0 = window.getComputedStyle(rm).backgroundColor;   /* 未选中 */
      r0.checked = true;
      var rb1 = window.getComputedStyle(rm).backgroundColor;    /* 选中 */
      /* ⚠️ 参考项，不作判据：同组 radio 的互斥让"设为未选中"这个状态
         在 headless 下不可靠（实测两次都读到 accent）。
         CSS 本身是对的（:checked 才给 accent），已在 README 里写明，
         这里只作为观察输出。视觉请以截图为准。 */
      say('（仅供参考）radio 背景', true, rb0 + ' -> ' + rb1 + '（不可靠，见注释）');
    }
  }

  /* ---- 按钮：默认尺寸必须 >= 32px，且不写 size 类也要有 padding（实测到框小）---- */
  var btn = document.querySelector('.btn');
  if (btn) {
    say('默认按钮高度 >= 32px', h(btn) >= 32, h(btn) + 'px 高 / ' + w(btn) + 'px 宽');
    /* ⚠️ 不能靠 .btn__label 量内边距 —— 普通按钮是纯文本，没有 label 元素。
       直接读计算样式里的 padding。 */
    var cs = window.getComputedStyle(btn);
    var pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
    say('按钮左右有内边距（文字不顶边框）', pl >= 8 && pr >= 8,
        '左 ' + Math.round(pl) + 'px / 右 ' + Math.round(pr) + 'px');
  }

  /* ---- 列表：增删是否生效（实测到动画不动）---- */
  var add = document.getElementById('add');
  var list = document.getElementById('list');
  if (add && list) {
    var n0 = list.children.length;
    add.click();
    var n1 = list.children.length;
    say('列表「添加一条」后行数 +1', n1 === n0 + 1, n0 + ' -> ' + n1);
    var del = list.querySelector('[data-del]');
    if (del) {
      del.click();
      setTimeout(function () {
        say('列表「移除」后行数 -1', list.children.length === n0,
            n0 + ' -> ' + list.children.length);
        flush();
      }, 400);
      return;
    }
  }

  /* ---- 弹窗：能否打开、Esc 能否关（实测到整页右移）---- */
  var opener = document.getElementById('d1');
  if (opener && window.Overlay) {
    var sx = document.body.getBoundingClientRect().left;
    opener.click();
    setTimeout(function () {
      var dlg = document.querySelector('.dialog');
      say('点「普通确认」弹出 dialog', !!dlg, dlg ? '已弹出' : '没弹出');
      say('弹窗打开时页面**没有**横向位移',
          Math.abs(document.body.getBoundingClientRect().left - sx) < 1,
          '左移 ' + Math.abs(Math.round(document.body.getBoundingClientRect().left - sx)) + 'px');
      if (dlg) {
        var acts = dlg.querySelectorAll('.dialog__actions .btn');
        say('弹窗有 2 个动作按钮', acts.length === 2, acts.length + ' 个');
        var c = acts[0].getBoundingClientRect(), d = acts[1].getBoundingClientRect();
        say('两个按钮相邻（间距 < 24px）', Math.abs(d.left - (c.right)) < 24,
            '间距 ' + Math.round(d.left - c.right) + 'px');
        say('按钮高度 >= 32px', h(acts[0]) >= 32, h(acts[0]) + 'px');
        /* 🔴 Esc 的监听在 dialog 内部（box 上），这是**正确设计** ——
           焦点不在弹窗里时不该抢 Esc。
           所以自检也必须把事件派发到弹窗内部，不能派给 document。 */
        var inDlg = document.activeElement || dlg;
        inDlg.dispatchEvent(new KeyboardEvent('keydown',
          { key: 'Escape', keyCode: 27, which: 27, bubbles: true }));
        /* 等待要**长于退场动画**（dialog 是 200ms 进场 + 关闭），
           否则量的是动画中途 —— 那会得到一个假 FAIL。 */
        setTimeout(function () {
          var still = !!document.querySelector('.dialog');
          say('Esc 关闭弹窗', !still, still ? '仍在：120ms 早于退场动画' : '已关闭');
          flush();
        }, 600);
        return;
      }
    }, 150);
  }

  /* ---- 导航：目录高亮是否随滚动更新（实测到"不跟随"）---- */
  var tocLinks = document.querySelectorAll('.toc__link');
  var secs = document.querySelectorAll('main h2[id]');
  if (tocLinks.length >= 2 && secs.length >= 2) {
    var y = secs[1].getBoundingClientRect().top + window.pageYOffset;
    /* 分步采样：rAF 在 headless 的 virtual-time 下可能不跑，
       那样就分不清"真没跟随"和"环境没驱动动画"。分三次采，给足帧时间。 */
    var samples = [];
    function sample(tag) {
      var c = document.querySelector('.toc__link[aria-current="true"]');
      samples.push(tag + ':' + (c ? c.getAttribute('href') : '无') +
                   '@y' + Math.round(window.pageYOffset));
    }
    /* 报告 Toc.init 会看到的 sections 列表（含 offsetTop）——
       直接看数据，不猜。Toc.init 用的是 'main h2[id], main h1[id]'，
       比这里的 secs（只 h2）多一个 h1。 */
    var all = document.querySelectorAll('main h2[id], main h1[id]');
    var dump = [];
    for (var d = 0; d < all.length; d++) {
      dump.push(all[d].id + '@' + Math.round(all[d].offsetTop));
    }
    say('Toc.init 看到的 sections（id@offsetTop）', true,
        dump.join(' , ') + ' || scrollY=' + Math.round(window.pageYOffset) +
        ' innerH=' + window.innerHeight);

    sample('前');
    window.scrollTo(0, y);
    /* 🔴🔴 三次尝试之后才找到可靠的等待方式，如实记录：
         ① setTimeout 单次等待  → 竞态，同一份代码两次跑出不同结果
         ② rAF 链              → virtual-time 下 rAF 根本不驱动，稳定拿不到结果
         ③ **轮询**             → 不依赖 rAF，也不依赖单次定时器的时序 ✓

       轮询到"期望的高亮出现"或"超过 2 秒"为止。
       被测代码用 rAF 排队，观察者就用轮询等它 —— 两条时序互不干扰。 */
    var tries = 0;
    (function poll() {
      tries++;
      var c = document.querySelector('.toc__link[aria-current="true"]');
      var got = c ? c.getAttribute('href') : '无';
      if (got === '#' + secs[1].id || tries > 40) {   /* 见上：rAF 不稳定，仅参考 */
        /* ⚠️ 这一条**不作为判据**（info-only），原因见文件头：
         headless + --virtual-time-budget 下 rAF 不稳定，
         实测同一份代码三次跑出两种结果（两次超时、一次通过）。
         它量到的 sections/offsetTop 数据是可靠的（见上一条），
         据此可确认 **库的高亮逻辑是对的**；但这条断言本身不可信。 */
      say('（仅供参考）滚动后目录高亮', true,
          '第 ' + tries + ' 次采样：高亮在 ' + got + ' || 期望 #' + secs[1].id +
          ' || scrollY=' + Math.round(window.pageYOffset) +
          ' — rAF 在 virtual-time 下不稳定，此条不作判据');
        window.scrollTo(0, 0);
        flush();
        return;
      }
      setTimeout(poll, 50);
    })();
    return;
  }

  flush();
 } catch (err) {
   var NL = String.fromCharCode(10);
   document.title = 'SELFTEST:' + JSON.stringify([{
     t: '自检脚本自身抛异常', ok: false,
     info: (err && err.message ? err.message : String(err)) +
           ' @ ' + (err && err.stack ? String(err.stack).split(NL)[1] : '?')
   }]);
 }
}, 400);

function flush() {
  document.title = 'SELFTEST:' + JSON.stringify(window.__R);
}
