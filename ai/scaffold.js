/*
 * scaffold.js — 三个「最小壳」：正确的骨架，不含内容
 *
 * ============================================================================
 * 🔴 为什么给壳，而不是给模板引擎
 * ----------------------------------------------------------------------------
 * 这一层最容易做歪的方向是"喂一段内容，吐一页报告" —— 那需要解析输入、
 * 决定结构、再选版式，最后产出的东西**没法被断言**（对不对取决于读的人）。
 *
 * 这里只做一件事：把**前置条件**给对。漏一条 `<link>`、少一层 `.rep__grid`、
 * 把文章标题写成 h3，页面不会报错，只会静默地长得不对 —— 而这些都是
 * "知道就不会错、不知道就一定会错"的东西。
 *
 * ⇒ 壳只保证三件事：
 *   ① 引对了样式表（少一个 = 那部分完全没样式）
 *   ② 骨架层级对（.rep > header > .rep__grid > .rep__body/.rep__aside）
 *   ③ 每一版**必有件**的位置留出来了（ai/recipes.json 里那几条）
 *
 * ⚠️ 三个壳都必须能通过 `ai check --html --recipe=<自己>`。
 *    这不是口号：05-audit/html-check-gate.js 每次都会把三个壳跑一遍，
 *    壳和判据一旦对不上就红。壳里少写一个必有件，门禁当场抓到。
 */
'use strict';

var fs = require('fs');
var path = require('path');

var AI = __dirname;

/** 壳里出现的 CSS 清单（相对库根）。只列真正用到的，不多引。 */
var SHEETS = [
  '01-tokens/tokens.css',
  '01-tokens/typography.css',
  '01-tokens/page.css',
  '04-recipes/table/table.css',
  '04-recipes/report/report.css'
];

function head(title, cssPrefix) {
  var p = String(cssPrefix || 'node_modules/agentcss').replace(/\/+$/, '');
  var links = SHEETS.map(function (s) {
    return '<link rel="stylesheet" href="' + p + '/' + s + '">';
  }).join('\n');
  return '<!doctype html>\n'
    + '<html lang="zh-CN">\n'
    + '<head>\n'
    + '<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>' + title + '</title>\n'
    + links + '\n'
    + '</head>\n';
}

/* 表格：三个壳共用。caption + th[scope] 是硬要求，壳里就写对，
   免得使用者照着抄的时候把这两条一起漏掉。 */
function table() {
  return '          <div class="table">\n'
    + '            <table>\n'
    + '              <caption>表 1 · 三组对比（写"这张表比的是什么"，不是"这是数据"）</caption>\n'
    + '              <thead>\n'
    + '                <tr><th scope="col">项目</th><th scope="col">A 组</th>'
    + '<th scope="col">B 组</th><th scope="col">C 组</th></tr>\n'
    + '              </thead>\n'
    + '              <tbody>\n'
    + '                <tr><th scope="row">指标一</th><td>—</td><td>—</td><td>—</td></tr>\n'
    + '                <tr><th scope="row">指标二</th><td>—</td><td>—</td><td>—</td></tr>\n'
    + '              </tbody>\n'
    + '            </table>\n'
    + '          </div>\n';
}

function figure(wide) {
  return '          <figure class="rep__fig' + (wide ? ' rep__fig--wide' : '') + '">\n'
    + '            <!-- 放图：09-assets/scientific-plot 的容器 id，或直接 <img src alt> -->\n'
    + '            <div id="chart"></div>\n'
    + '            <figcaption class="rep__cap">图 1 · 图说（说清"看什么"，不是"这是什么"）</figcaption>\n'
    + '          </figure>\n';
}

function section(title, body) {
  return '        <section class="rep__sec">\n'
    + '          <h3>' + title + '</h3>\n'
    + body
    + '        </section>\n';
}

/* 三种版式各自的那一段。顺序刻意与 README 的取舍表一致。 */
var VARIANTS = {
  'report/finance': {
    label: 'report · 金融研究版',
    rootClass: 'rep rep--finance',
    title: '标题：把结论写在标题里',
    kicker: '行业跟踪 · 金融研究版',
    standfirst: '导语：先说结论与它成立的条件，再说依据。读者读完这一段就该知道要不要往下看。',
    before: '    <!-- 关键数字条：这一版的读者先看数、后看论证（ai/recipes.json: rep__keyline） -->\n'
      + '    <dl class="rep__keyline">\n'
      + '      <div><dt>读数一</dt><dd>—</dd></div>\n'
      + '      <div><dt>读数二</dt><dd>—</dd></div>\n'
      + '      <div><dt>读数三</dt><dd>—</dd></div>\n'
      + '    </dl>\n',
    body: '',
    after: '    <!-- 风险披露：这一版必须有（ai/recipes.json: rep__risk） -->\n'
      + '    <p class="rep__risk">风险披露：把结论的适用条件、数据口径与不确定性写在这里。'
      + '没有这一段的金融结论读起来像建议，而不是分析。</p>\n',
    aside: '次要读数放这里。放不下的大图不要塞边注 —— 边注只有 14em。'
  },
  'report/technical': {
    label: 'report · 科研技术版',
    rootClass: 'rep rep--technical',
    title: '标题：说清对象与方法',
    kicker: '实验报告 · 科研技术版',
    standfirst: '导语：一句话说清做了什么、得到什么、结论的置信边界在哪。',
    before: '',
    body: '',
    after: '    <!-- 来源脚注：这一版必须有（ai/recipes.json: rep__source） -->\n'
      + '    <p class="rep__source">来源：数据出处、采集时间与口径。逐条核对的人会顺着这里回查原始材料。</p>\n',
    aside: '术语与口径写这里。这一版的读者会逐条核对，边注用来放"不影响主线但需要说明"的东西。'
  },
  'report/magazine': {
    label: 'report · 杂志编辑版',
    rootClass: 'rep rep--magazine',
    title: '标题：用一个具体的画面开头',
    kicker: '长报道 · 杂志编辑版',
    standfirst: '导语：把读者带进场景，而不是先给结论。这一版是通读的，不是查数的。',
    before: '    <!-- 引语块：这一版靠停顿制造节奏（ai/recipes.json: rep__pull） -->\n'
      + '    <blockquote class="rep__pull">一句能被单独引用的话。它应该是全文的转折点，不是摘要。</blockquote>\n',
    body: '',
    after: '',
    aside: '短提醒放这里。这一版没有编号，边注是唯一的"旁白"通道。'
  }
};

/**
 * @param {string} id      版式名（见 ai/recipes.json）
 * @param {object} [opts]  `{cssPrefix}` —— 样式表前缀，默认 `node_modules/agentcss`
 * @returns {{ok:true, html:string, id:string, requires:string[]}|{ok:false, message:string}}
 */
function render(id, opts) {
  opts = opts || {};
  var v = VARIANTS[id];
  if (!v) {
    return { ok: false, message: '未知版式：' + id + '（可用：' + Object.keys(VARIANTS).join(' / ') + '）' };
  }
  var wide = id === 'report/magazine';

  var body = '        <section class="rep__sec">\n'
    + '          <h3>第一节：先给判断，再给依据</h3>\n'
    + '          <p>正文。这一段的每句话都应该能被上一段的数字或下一段的图支撑；'
    + '撑不住的删掉。</p>\n'
    + figure(wide)
    + table()
    + '        </section>\n'
    + section('第二节：把限制写清楚', '          <p>适用的边界、数据口径、以及"这一版有意不做什么"。</p>\n');

  var html = head(v.title, opts.cssPrefix)
    + '<body class="page">\n'
    + '<main class="wrap">\n'
    + '  <!-- 由 `agentcss ai scaffold` 生成：只给壳，不给内容。\n'
    + '       写完跑：agentcss ai check 本文件 --recipe=' + id + ' -->\n'
    + '  <article class="' + v.rootClass + '">\n'
    + '    <header>\n'
    + '      <p class="rep__kicker">' + v.kicker + '</p>\n'
    + '      <h2 class="rep__title">' + v.title + '</h2>\n'
    + '      <p class="rep__standfirst">' + v.standfirst + '</p>\n'
    + '      <ul class="rep__meta"><li>作者</li><li>日期</li><li>版本 v1</li></ul>\n'
    + '    </header>\n'
    + v.before
    + '    <div class="rep__grid">\n'
    + '      <div class="rep__body">\n'
    + body
    + '      </div>\n'
    + '      <aside class="rep__aside">' + v.aside + '</aside>\n'
    + '    </div>\n'
    + v.after
    + '  </article>\n'
    + '</main>\n'
    + '</body>\n'
    + '</html>\n';

  var requires = [];
  try {
    var all = JSON.parse(fs.readFileSync(path.join(AI, 'recipes.json'), 'utf8'));
    requires = ((all.recipes[id] || {}).requires || []).map(function (r) { return r.selector; });
  } catch (e) { /* 读不到就不报；门禁会盯 recipes.json */ }

  return { ok: true, html: html, id: id, requires: requires };
}

function list() {
  return Object.keys(VARIANTS).map(function (k) {
    return { id: k, label: VARIANTS[k].label };
  });
}

module.exports = { render: render, list: list, VARIANTS: VARIANTS, SHEETS: SHEETS };
