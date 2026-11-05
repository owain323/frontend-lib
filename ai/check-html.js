/*
 * check-html.js — 检查**已经写出来的那份页面**（不是计划，是产物）
 *
 * ============================================================================
 * 🔴 为什么需要它：契约校验通过，页面依然可能是坏的
 * ----------------------------------------------------------------------------
 * `ai check <doc.json>` 校验的是**文档模型**：节点类型对不对、组件在不在档位里。
 * 它证明不了三件最要命的事：
 *
 *   ① 写出来的类名在库里**根本不存在** —— 不报错、不警告，只是一点样式都没有；
 *   ② 页面引了 `.card` 却**没引** `card.css` —— 同上，而且更难发现：
 *      类名是对的、文档也是对的，只是少了一个 `<link>`；
 *   ③ 语义结构缺件 —— 表格没有 `<caption>`、图没有 `alt`、标题从 h2 跳到 h4。
 *
 * 这三类都不会让页面"打不开"，只会让它**看起来像是另一个人做的**。
 * ⇒ 校验必须落在产物上，且判据必须能从文件本身算出来（不联网、不启动浏览器）。
 *
 * ============================================================================
 * 🔴 类名白名单只有一个来源：库自己的 CSS
 * ----------------------------------------------------------------------------
 * 不维护第二份「合法类名清单」。理由不是洁癖：清单会和 CSS 分叉，
 * 而分叉的方向永远是"清单里有、CSS 里没了"—— 那时门禁放行、页面掉样式，
 * 是最难查的一种假绿。这里每次都从磁盘上的 CSS 现算（进程内缓存）。
 *
 * 而且检查分两级，因为两种失败的含义完全不同：
 *   · 类在库里、但这页没引到定义它的样式表 → **错误**（一定是漏了 <link>）
 *   · 类在库里也没有                   → **警告**（可能是笔误，也可能是页面自己的钩子）
 *
 * ⚠️ 页面内联的 `<style>` 也算来源。单文件页面（把 tokens.css 内联进 <style>）
 * 是这套库推荐的用法之一，把它们判成"没引样式"是纯粹的假红。
 *
 * ============================================================================
 * 判据（每条都有反向控制，见 05-audit/html-check-gate.js）
 * ----------------------------------------------------------------------------
 * 错误：html-lang / meta-charset / meta-viewport / img-alt / table-caption /
 *       th-scope / id-duplicate / heading-skip / control-name / rel-noopener /
 *       class-not-linked
 * 警告：class-unknown / empty-link
 *
 * 用法：
 *   const { checkPage } = require('./check-html');
 *   const r = checkPage('page.html', { recipe: 'report/finance' });
 *   if (!r.ok) r.findings.forEach(f => ...);
 */
'use strict';

var fs = require('fs');
var path = require('path');
var url = require('url');

var AI = __dirname;
var ROOT = path.join(AI, '..');

/* 库的资产层。类名白名单只从这里来 —— 与 `ai assets` 的扫描口径同一份事实。 */
var ASSET_DIRS = ['01-tokens', '02-primitives', '03-patterns', '04-recipes', '09-assets'];

/* 空元素：没有结束标签，也不进栈。 */
var VOID = {
  area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1,
  link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1
};

/* 内容按**文本**处理的元素：里面的 `<` 不是标签，是字面量。
   ⚠️  `<pre>` **不在**这一列 —— 按 HTML 规范 pre 里仍然是标记，
       所以 `<pre><div class="x">` 里的 div 是真元素（写错了就该被抓到）。 */
var RAW = { script: 1, style: 1, textarea: 1, title: 1 };

/* 判据清单。level 决定 `ok`；hint 是**改法**（报错只说"不对"等于把活儿推回给调用方）。 */
var RULES = {
  'html-lang': {
    level: 'error', title: '<html> 缺 lang',
    hint: '写 <html lang="zh-CN">。读屏与断词按它决定发音与断行，缺了会用系统默认。'
  },
  'meta-charset': {
    level: 'error', title: '缺 <meta charset>',
    hint: '在 <head> 最前面加 <meta charset="utf-8">，否则中文在部分环境下会乱码。'
  },
  'meta-viewport': {
    level: 'error', title: '缺 <meta name="viewport">',
    hint: '加 <meta name="viewport" content="width=device-width, initial-scale=1">。'
      + '没有它，手机按 980px 排版再整体缩小，字会小到读不了。'
  },
  'img-alt': {
    level: 'error', title: '<img> 缺 alt',
    hint: '装饰性图片写 alt=""（空字符串是有意的声明），有信息的图写描述。'
      + '缺这个属性时读屏会念出整个文件名。'
  },
  'table-name': {
    level: 'error', title: '<table> 没有名字',
    hint: '给表格一个可访问名称：<caption>…</caption>，或 <table aria-label="…">。'
      + '读屏用户靠它知道"这张表比的是什么"；一张没有名字的表，念出来是一串没有上下文的数字。'
  },
  'th-scope': {
    level: 'error', title: '<th> 缺 scope',
    hint: '写 scope="col" 或 scope="row"。读屏靠它把单元格和表头对起来。'
  },
  'id-duplicate': {
    level: 'error', title: 'id 重复',
    hint: '同一份文档里 id 必须唯一：锚点跳转、<label for>、aria-labelledby 都按它找元素。'
  },
  'heading-skip': {
    level: 'error', title: '标题跳级',
    hint: '标题只跳一级（h2 → h3）。跳级会让"按标题导航"的人以为中间少了一节。'
      + '需要更小的字，用字号类，不要用 h5。'
  },
  'control-name': {
    level: 'error', title: '表单控件没有可读名称',
    hint: '三选一：<label for="x"> + id、aria-label、或把控件包进 <label> 里。'
  },
  'rel-noopener': {
    level: 'error', title: 'target="_blank" 缺 rel="noopener"',
    hint: '写 rel="noopener"（或 noreferrer）：否则新窗口能通过 window.opener 改这一页。'
  },
  'class-not-linked': {
    level: 'error', title: '类名库里有，但这页没引到定义它的样式表',
    hint: '补一条 <link rel="stylesheet">。这类缺失不报错、不警告，只是一点样式都不生效。'
  },
  'sheet-unreadable': {
    level: 'error', title: '样式表一个都读不到',
    hint: '检查 <link href> 的相对路径：它是相对**这个页面**解析的。'
      + '页面在项目根目录时，库的路径通常是 node_modules/agentcss/…；'
      + '换过位置就得改前缀（ai scaffold 的 --css-prefix 就是为这个准备的）。'
  },
  'class-unknown': {
    level: 'warn', title: '类名库里没有',
    hint: '若是笔误就改掉；若是页面自己的类，在页内 <style> 里定义它（否则它什么也不会做）。'
  },
  'empty-link': {
    level: 'warn', title: '<a> 没有 href',
    hint: '占位链接写 href="#" 也点不动。要么给真实地址，要么换成 <button>。'
  },
  'recipe-root': {
    level: 'error', title: '版式根类不对',
    hint: '--recipe 指定的版式必须真的落在页面上（例：report/finance 要 .rep.rep--finance）。'
  },
  'recipe-required': {
    level: 'error', title: '这一版必须有的一件东西不见了',
    hint: '见 ai/recipes.json：每条都是"这个阅读场景缺了它就不成立"的东西。'
  }
};

/* ============================================================================
 * 分词
 * ============================================================================
 * 不引入解析器（零依赖是硬约束），但也不做"正则找 class= 属性"那种事：
 * 那个做法会把 <script> 里的模板字符串、注释里的示例、<style> 里的选择器
 * 全部当成现状。这套库在这上面翻过三次车（判据把注释当代码），不再重复。
 */
function lineIndex(src) {
  var nl = [];
  for (var i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) nl.push(i);
  return function (idx) {
    var lo = 0, hi = nl.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (nl[mid] < idx) lo = mid + 1; else hi = mid; }
    return lo + 1;
  };
}

/** 解析 `name=value` 序列，返回 {attrs, end, selfClose}。`end` 指向 `>` 之后。 */
function parseAttrs(src, from) {
  var attrs = Object.create(null);
  var j = from, n = src.length, selfClose = false;
  while (j < n) {
    while (j < n && /\s/.test(src[j])) j++;
    if (j >= n) break;
    if (src[j] === '>') { j++; break; }
    if (src[j] === '/' && src[j + 1] === '>') { selfClose = true; j += 2; break; }
    var k = j;
    while (k < n && !/[\s>=\/]/.test(src[k])) k++;
    if (k === j) { j++; continue; }          // 防死循环：不认识的字节直接跳过一个
    var name = src.slice(j, k).toLowerCase();
    j = k;
    while (j < n && /\s/.test(src[j])) j++;
    var val = '';
    if (src[j] === '=') {
      j++;
      while (j < n && /\s/.test(src[j])) j++;
      var q = src[j];
      if (q === '"' || q === "'") {
        var end = src.indexOf(q, j + 1);
        var stop = end < 0 ? n : end;
        val = src.slice(j + 1, stop);
        j = end < 0 ? n : end + 1;
      } else {
        var e = j;
        while (e < n && !/[\s>]/.test(src[e])) e++;
        val = src.slice(j, e);
        j = e;
      }
    }
    /* 重复属性按 HTML 规范取**第一个**（浏览器就是这么做的） */
    if (!(name in attrs)) attrs[name] = val;
  }
  return { attrs: attrs, end: j, selfClose: selfClose };
}

/**
 * @param {string} src
 * @returns {Array<{type:string, tag?:string, attrs?:object, line:number, at:number, endAt:number, content?:string}>}
 */
function tokenize(src) {
  var lineAt = lineIndex(src);
  var nodes = [];
  var i = 0, n = src.length;

  while (i < n) {
    var lt = src.indexOf('<', i);
    if (lt < 0) break;
    i = lt;

    if (src.slice(i, i + 4) === '<!--') {
      var ce = src.indexOf('-->', i + 4);
      i = ce < 0 ? n : ce + 3;
      continue;
    }
    /* <!doctype> / <?xml / <![CDATA[ —— 都不是元素 */
    if (src[i + 1] === '!' || src[i + 1] === '?') {
      var de = src.indexOf('>', i);
      i = de < 0 ? n : de + 1;
      continue;
    }

    var mEnd = /^<\/([a-zA-Z][a-zA-Z0-9:-]*)\s*>/.exec(src.slice(i, i + 200));
    if (mEnd) {
      nodes.push({ type: 'end', tag: mEnd[1].toLowerCase(), line: lineAt(i), at: i, endAt: i + mEnd[0].length });
      i += mEnd[0].length;
      continue;
    }

    var mStart = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(src.slice(i, i + 200));
    if (!mStart) { i++; continue; }          // 孤立的 '<'（正文里的比较符号）

    var tag = mStart[1].toLowerCase();
    var parsed = parseAttrs(src, i + mStart[0].length);
    var node = {
      type: 'start', tag: tag, attrs: parsed.attrs,
      line: lineAt(i), at: i, endAt: parsed.end, selfClose: parsed.selfClose
    };
    nodes.push(node);
    i = parsed.end;

    if (RAW[tag]) {
      var closeRe = new RegExp('</' + tag + '\\s*>', 'i');
      var rest = src.slice(i);
      var mm = closeRe.exec(rest);
      var content = mm ? rest.slice(0, mm.index) : rest;
      if (tag === 'style') node.content = content;
      var stopAt = mm ? i + mm.index : n;
      if (mm) nodes.push({ type: 'end', tag: tag, line: lineAt(stopAt), at: stopAt, endAt: stopAt + mm[0].length });
      i = mm ? stopAt + mm[0].length : n;
    }
  }
  return nodes;
}

/* ============================================================================
 * 样式表 → 类名
 * ============================================================================ */

/** 从 CSS 文本里取类名。先剥注释：`/* .ghost *​/` 不是定义。 */
function classesInCss(text) {
  var s = String(text).replace(/\/\*[\s\S]*?\*\//g, '');
  var out = [];
  var re = /\.(-?[_a-zA-Z][\w-]*)/g, m;
  while ((m = re.exec(s))) out.push(m[1]);
  return out;
}

function importsInCss(text) {
  var s = String(text).replace(/\/\*[\s\S]*?\*\//g, '');
  var out = [];
  var re = /@import\s+(?:url\(\s*)?['"]?([^'")]+)['"]?\s*\)?/g, m;
  while ((m = re.exec(s))) out.push(m[1].trim());
  return out;
}

/** 库的类名地图：class → 定义它的文件（相对库根）。进程内只算一次。 */
var LIB = null;
function libraryClassMap() {
  if (LIB) return LIB;
  var map = Object.create(null);
  var files = 0;

  function walk(dir) {
    var names;
    try { names = fs.readdirSync(dir); } catch (e) { return; }
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (n.charAt(0) === '_' || n.charAt(0) === '.') continue;
      var p = path.join(dir, n);
      var st;
      try { st = fs.statSync(p); } catch (e) { continue; }
      if (st.isDirectory()) { walk(p); continue; }
      if (!/\.css$/.test(n)) continue;
      files++;
      var rel = path.relative(ROOT, p).split(path.sep).join('/');
      var cls = classesInCss(fs.readFileSync(p, 'utf8'));
      for (var k = 0; k < cls.length; k++) {
        if (!map[cls[k]]) map[cls[k]] = [];
        if (map[cls[k]].indexOf(rel) < 0) map[cls[k]].push(rel);
      }
    }
  }
  for (var d = 0; d < ASSET_DIRS.length; d++) walk(path.join(ROOT, ASSET_DIRS[d]));
  LIB = { map: map, files: files };
  return LIB;
}

/** 把 `<link href>` / `@import` 的写法解析成本地绝对路径；远程/内联返回 null。 */
function resolveSheet(href, baseDir) {
  if (!href) return null;
  var h = String(href).trim();
  if (/^data:/i.test(h)) return null;
  if (/^https?:/i.test(h)) return { remote: h };
  if (/^file:/i.test(h)) {
    try { return { file: url.fileURLToPath(h) }; } catch (e) { return null; }
  }
  if (h.charAt(0) === '/' || /^[a-zA-Z]:[\\/]/.test(h)) return { file: h };
  return { file: path.resolve(baseDir, h.replace(/[?#].*$/, '')) };
}

function collectClasses(absFile, seen, into, depth) {
  if (depth > 3 || seen[absFile]) return false;
  seen[absFile] = 1;
  var txt;
  try { txt = fs.readFileSync(absFile, 'utf8'); } catch (e) { return false; }
  classesInCss(txt).forEach(function (c) { into[c] = 1; });
  importsInCss(txt).forEach(function (spec) {
    var r = resolveSheet(spec, path.dirname(absFile));
    if (r && r.file) collectClasses(r.file, seen, into, depth + 1);
  });
  return true;
}

/* ============================================================================
 * 检查
 * ============================================================================ */

function stripTags(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function checkPage(file, opts) {
  opts = opts || {};
  var abs = path.resolve(file);
  var src;
  try {
    src = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    return { ok: false, code: 'unreadable', message: '读不到文件：' + abs };
  }
  var pageDir = path.dirname(abs);
  var nodes = tokenize(src);
  var findings = [];
  var notes = [];

  function add(rule, line, msg, extra) {
    var meta = RULES[rule];
    /* `level: 'off'` 是给门禁做**元反向控制**用的：关掉一条判据，夹具里对应
       那一条必须消失 —— 这样才能证明每条命中确实由它自己产生，
       而不是被邻居顺手抓到（那种"覆盖"在改判据时会静默失效）。 */
    if (!meta || meta.level === 'off') return;
    var f = { rule: rule, level: meta.level, line: line, msg: msg };
    if (extra) for (var k in extra) f[k] = extra[k];
    findings.push(f);
  }

  /* ---------- ① 文档级 ---------- */
  var htmlLang = null, sawHtml = false, hasCharset = false, hasViewport = false;

  /* ---------- ② 结构 ---------- */
  var stack = [];
  var lastHeading = 0;
  var ids = Object.create(null);
  var labelFor = Object.create(null);
  var tables = [];
  var usedClasses = Object.create(null);
  var firstUseLine = Object.create(null);

  function inLabel() {
    for (var i = stack.length - 1; i >= 0; i--) if (stack[i].tag === 'label') return true;
    return false;
  }

  /* `aria-hidden="true"` 的子树**不在无障碍树里**。
     对它们要求"可访问名称"是无意义的：读屏根本不会念到，
     而补一个 aria-label 也不会让它被念到。演示页的"✅/❌ 对照"就是这样：
     两块表刻意对读屏隐藏，它们要表达的是外观差异，不是数据。 */
  function inHidden() {
    for (var i = stack.length - 1; i >= 0; i--) if (stack[i].hid) return true;
    return false;
  }

  for (var pass = 0; pass < 2; pass++) {
    /* 两趟：第一趟收集 <label for> 与 id（label 可能在控件之后），第二趟判控件名。
       同一份 nodes 走两遍比"先收集再回填"更不容易漏。
       ⚠️ 每趟都要把栈清零：上一趟留下的残余会让 inLabel() 判错。 */
    stack.length = 0;
    lastHeading = 0;
    tables.length = 0;
    for (var idx = 0; idx < nodes.length; idx++) {
      var nd = nodes[idx];
      if (nd.type === 'end') {
        /* 表格在**闭合时**判：<caption> 可能出现在任何位置 */
        if (nd.tag === 'table') {
          var tb = tables.pop();
          if (tb && !tb.name && !tb.hidden) {
            add('table-name', tb.line, '<table> 既没有 <caption>，也没有 aria-label');
          }
        }
        var found = -1;
        for (var s = stack.length - 1; s >= 0; s--) {
          if (stack[s].tag === nd.tag) { found = s; break; }
        }
        if (found >= 0) stack.length = found;
        continue;
      }
      if (nd.type !== 'start') continue;
      var tag = nd.tag, a = nd.attrs;

      if (pass === 0) {
        /* ⚠️ 属性不存在时 `a.lang` 是 undefined，不是 ''：直接拿去和 null 比
           会让"没有 lang"这条静默漏掉（门禁的反例集合当场抓到了这个写法）。 */
        if (tag === 'html') { sawHtml = true; htmlLang = ('lang' in a) ? String(a.lang) : ''; }
        if (tag === 'meta') {
          if (a.charset) hasCharset = true;
          if (String(a.name || '').toLowerCase() === 'viewport') hasViewport = true;
        }
        if (a['class']) {
          var cs = String(a['class']).split(/\s+/);
          for (var ci = 0; ci < cs.length; ci++) {
            var c = cs[ci];
            if (!c) continue;
            /* 模板占位（{{x}} / ${x} / <% %>）不是类名，是构建期才有的东西 */
            if (/[{}<>$%=]/.test(c)) continue;
            if (!usedClasses[c]) { usedClasses[c] = 1; firstUseLine[c] = nd.line; }
          }
        }
        if (a.id) {
          if (ids[a.id] !== undefined) {
            add('id-duplicate', nd.line, 'id="' + a.id + '" 和第 ' + ids[a.id] + ' 行重复');
          } else ids[a.id] = nd.line;
        }
        if (tag === 'label' && a['for']) labelFor[a['for']] = 1;
      } else {
        if (tag === 'img' && !('alt' in a)) {
          add('img-alt', nd.line, '<img> 缺 alt（src=' + String(a.src || '').slice(0, 60) + '）');
        }
        if (tag === 'table') {
          tables.push({
            name: String(a['aria-label'] || '').trim() !== ''
              || String(a['aria-labelledby'] || '').trim() !== '',
            hidden: inHidden() || String(a['aria-hidden'] || '').toLowerCase() === 'true',
            line: nd.line
          });
        }
        if (tag === 'caption' && tables.length) {
          var closeAt = src.indexOf('</caption', nd.endAt);
          var text = closeAt < 0 ? '' : stripTags(src.slice(nd.endAt, closeAt));
          if (text) tables[tables.length - 1].name = true;
        }
        if (tag === 'th' && !a.scope && !inHidden()) add('th-scope', nd.line, '<th> 缺 scope');
        if (/^h[1-6]$/.test(tag)) {
          var lv = Number(tag.charAt(1));
          if (lastHeading && lv > lastHeading + 1) {
            add('heading-skip', nd.line, 'h' + lastHeading + ' → h' + lv + ' 跳了 ' + (lv - lastHeading - 1) + ' 级');
          }
          lastHeading = lv;
        }
        if (tag === 'a') {
          if (!('href' in a) || String(a.href).trim() === '' || String(a.href).trim() === '#') {
            add('empty-link', nd.line, '<a> 没有可用地址（' + (('href' in a) ? 'href="' + a.href + '"' : '缺 href') + '）');
          }
          if (String(a.target || '') === '_blank') {
            var rel = String(a.rel || '').toLowerCase();
            if (rel.indexOf('noopener') < 0 && rel.indexOf('noreferrer') < 0) {
              add('rel-noopener', nd.line, 'target="_blank" 缺 rel="noopener"');
            }
          }
        }
        if (tag === 'input' || tag === 'select' || tag === 'textarea') {
          var type = String(a.type || '').toLowerCase();
          var hasValueAsName = (tag === 'input' && /^(submit|button|reset)$/.test(type)
            && String(a.value || '').trim() !== '');
          var named = String(a['aria-label'] || '').trim() !== ''
            || String(a['aria-labelledby'] || '').trim() !== ''
            || (a.id && labelFor[a.id])
            || inLabel()
            || (tag === 'input' && type === 'hidden')
            || hasValueAsName;
          if (!named && !inHidden()) {
            add('control-name', nd.line, '<' + tag + '> 没有可读名称'
              + (a.id ? '（id="' + a.id + '" 没有对应的 <label for>）' : ''));
          }
        }
      }
      if (!VOID[tag] && !nd.selfClose) {
        stack.push({ tag: tag, hid: String(a['aria-hidden'] || '').toLowerCase() === 'true' });
      }
    }
  }

  /* caption 的收口在 `</table>` 那一支里（见上），这里不再补判 */

  if (!sawHtml) {
    add('html-lang', 1, '整个文件没有 <html> 标签');
  } else if (String(htmlLang).trim() === '') {
    add('html-lang', 1, '<html> 的 lang 是空的');
  }
  if (!hasCharset) add('meta-charset', 1, '<head> 里没有 <meta charset>');
  if (!hasViewport) add('meta-viewport', 1, '没有 <meta name="viewport">');

  /* ---------- ③ 类名：对样式表 ---------- */
  var linked = Object.create(null);
  var seen = Object.create(null);
  var localSheets = 0, remoteSheets = 0, readSheets = 0, firstSheetLine = 0;
  var sheetHrefs = [];

  for (var li = 0; li < nodes.length; li++) {
    var ln = nodes[li];
    if (ln.type !== 'start' || ln.tag !== 'link') continue;
    var rel = String(ln.attrs.rel || '').toLowerCase();
    if (rel.indexOf('stylesheet') < 0) continue;
    var r = resolveSheet(ln.attrs.href, pageDir);
    if (!r) continue;                       // data: —— 内联样式表，跳过
    if (r.remote) { remoteSheets++; continue; }
    localSheets++;
    if (!firstSheetLine) firstSheetLine = ln.line;
    if (readSheets <= 3) sheetHrefs.push(String(ln.attrs.href));
    if (collectClasses(r.file, seen, linked, 0)) readSheets++;
  }

  /* 引了样式表却一个都读不到 —— 这**不是**"类名缺定义"，是路径整段错了。
     分开报的理由：前者要改十几个类，后者只要改一个前缀；混在一起会让人
     去改那十几个类，而真正的错在 <link> 上。 */
  if (localSheets > 0 && readSheets === 0) {
    add('sheet-unreadable', firstSheetLine,
      '引了 ' + localSheets + ' 个样式表，一个都读不到：' + sheetHrefs.slice(0, 3).join('、')
        + (localSheets > 3 ? ' 等' : ''));
  }

  var inline = Object.create(null);
  for (var sj = 0; sj < nodes.length; sj++) {
    if (nodes[sj].type === 'start' && nodes[sj].tag === 'style' && nodes[sj].content) {
      classesInCss(nodes[sj].content).forEach(function (c) { inline[c] = 1; });
    }
  }

  var lib = libraryClassMap();
  var judgeLinked = localSheets > 0 && remoteSheets === 0 && readSheets > 0;
  var skipped = [];

  if (!judgeLinked) {
    skipped.push({
      rule: 'class-not-linked',
      why: localSheets === 0
        ? '这页没有引用任何本地样式表（单文件写法）—— 无法判断"引没引到"，只能判断类名存不存在'
        : readSheets === 0
          ? '引用的样式表一个都没读到（见上面那条）—— 路径不通时，"类名没被引到"这个判断没有意义'
          : '有 ' + remoteSheets + ' 个远程样式表读不到 —— 无法判断类名是否由它定义'
    });
  }

  for (var cname in usedClasses) {
    /* 页内样式表或本地样式表里有定义 ⇒ 这一页确实会给它样式，不论能不能判 linkage */
    if (inline[cname] || linked[cname]) continue;
    if (lib.map[cname]) {
      /* 库里有、这页没引到 —— 只在"该页引的都是本地样式表"时才敢下这个结论 */
      if (!judgeLinked) continue;
      var def = lib.map[cname][0];
      add('class-not-linked', firstUseLine[cname],
        '.' + cname + ' 定义在 ' + def + '，这页没有引用它',
        { file: def });
    } else {
      add('class-unknown', firstUseLine[cname], '.' + cname + ' 在库里没有定义');
    }
  }

  /* ---------- ④ 版式必有件 ---------- */
  var recipe = opts.recipe || null;
  var recipeInfo = null;
  if (recipe) {
    var all = readRecipes();
    recipeInfo = all && all.recipes && all.recipes[recipe];
    if (!recipeInfo) {
      return {
        ok: false, code: 'unknown-recipe',
        message: '未知版式：' + recipe + '（可用：' + Object.keys((all && all.recipes) || {}).join(' / ') + '）'
      };
    }
    var rootSel = String(recipeInfo.root || '');
    var rootClasses = rootSel.split('.').filter(Boolean);
    var missingRoot = rootClasses.filter(function (c) { return !usedClasses[c]; });
    if (missingRoot.length) {
      add('recipe-root', 1, '这页不是 ' + recipe + ' 版式：缺 .' + missingRoot.join(' 与 .'));
    }
    (recipeInfo.requires || []).forEach(function (req) {
      var cls = String(req.selector || '').split('.').filter(Boolean);
      /* 必要件必须**出现在页面上**（用了这个类），只把它写进 <style> 不算 */
      var miss = cls.filter(function (c) { return !usedClasses[c]; });
      if (miss.length) {
        add('recipe-required', 1, '缺「' + req.label + '」（' + req.selector + '）',
          { label: req.label, selector: req.selector });
      }
    });
    (recipeInfo.unchecked || []).forEach(function (u) {
      notes.push({ kind: 'unchecked', label: u.label, why: u.why });
    });
  }

  /* ---------- ⑤ 收口 ---------- */
  var levelRank = { error: 0, warn: 1 };
  findings.sort(function (x, y) {
    return (x.line - y.line) || (levelRank[x.level] - levelRank[y.level]) || (x.rule < y.rule ? -1 : 1);
  });
  var counts = { error: 0, warn: 0 };
  findings.forEach(function (f) { counts[f.level]++; });

  var strict = !!opts.strict;
  var blocking = counts.error + (strict ? counts.warn : 0);

  return {
    ok: blocking === 0,
    mode: 'html',
    file: file,
    recipe: recipe || null,
    counts: counts,
    findings: findings,
    notes: notes,
    skipped: skipped,
    sources: {
      localSheets: localSheets,
      remoteSheets: remoteSheets,
      inlineStyle: Object.keys(inline).length > 0,
      libraryCssFiles: lib.files,
      libraryClasses: Object.keys(lib.map).length
    },
    rules: Object.keys(RULES)
  };
}

/** 读 `ai/recipes.json`。文件不在 ⇒ 返回 null（调用方据此报"没有版式判据"）。 */
function readRecipes() {
  try {
    return JSON.parse(fs.readFileSync(path.join(AI, 'recipes.json'), 'utf8'));
  } catch (e) {
    return null;
  }
}

module.exports = {
  checkPage: checkPage,
  tokenize: tokenize,
  classesInCss: classesInCss,
  libraryClassMap: libraryClassMap,
  readRecipes: readRecipes,
  RULES: RULES
};
