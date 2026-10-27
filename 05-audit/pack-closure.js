#!/usr/bin/env node
/* LAYER: static */
/* ============================================================================
 * pack-closure.js — 包内闭包门禁：**消费者真正收到的东西**是否与声明一致
 *
 * 用法：
 *   node 05-audit/pack-closure.js              清单模式（默认）
 *   node 05-audit/pack-closure.js --dir <路径> 判定已解包 / 已安装的目录
 *   node 05-audit/pack-closure.js --selftest   判据自检（有鉴别力 + 不误报）
 *
 * ---------------------------------------------------------------------------
 * 🔴 为什么需要（外部审计第 3 条建议，2026-10-26）
 *
 *   审计原话：
 *     「只加一项，就加『解包后的消费者闭包检查』。对 `npm pack` 的实际产物
 *       递归解析所有条件导出（包括对象和通配符），并核对导出目标及随包
 *       演示引用的本地资源是否都在包内。」
 *
 *   它指出的真实盲点：
 *     · `release-gate.py` 的 [7] 只判**仓库里**文件在不在；
 *     · `pack-smoke.sh` 第 4 步的 walker 只认 `typeof v === 'string'`，
 *       条件导出对象（`{"types":…, "default":…}`）整片跳过；
 *     · 于是 `publish:check` 可以**全绿**，而包根导入（`exports["."].default`
 *       → `./index.html`）在 tarball 里根本不存在。
 *   实测证据：修复前 `npm pack` 出 269 个文件，`index.html` **0 个**。
 *
 * ---------------------------------------------------------------------------
 * ⭐ 为什么单独一道，而不是塞进 pack-smoke
 *
 *   pack-smoke 要「打包 → 装进空目录 → 加载」，几十秒起步，属 component 层，
 *   `--fast` 直接跳过它 ⇒ 日常改代码时这道**根本不会跑**。
 *   而 `npm pack --dry-run --json` 拿到的清单是**权威的**（就是 npm 自己
 *   按 files 白名单算出来的结果），代价 ~1.5 秒，可以进 fast 层。
 *
 *   ⇒ 分工：
 *     本脚本（清单模式）＝ 每次提交都跑的**权威闭包判定**；
 *     pack-smoke `--dir` ＝ 装完之后用**同一套判据**再核一遍（防止
 *                            "清单说在、装完不在"这类安装期问题）。
 *
 * ---------------------------------------------------------------------------
 * 🔴 一条必须守住的纪律：判据只许写一份
 *
 *   本库 ERROR E31 的教训：「同一判定写两遍必然漂移」。
 *   原来 exports 的判定在 release-gate（python）和 pack-smoke（bash）里
 *   各有一份，两边松紧不同 ⇒ 一处修好、另一处继续假绿。
 *   ⇒ 现在 exports / HTML 引用 / 文档路径三类判定**只在本文件里**，
 *     release-gate 只负责"仓库内存在性"并在输出里点名指向这里。
 *
 * ---------------------------------------------------------------------------
 * 🔁 第二轮外部审计（2026-10-26 晚）补掉的四个洞
 *
 *   P1-1 通配判定：原来只看「`*` 前面那个目录存不存在、非空」。
 *        `./x/*` → `./dist/*.js`，`dist/` 里只有 `notes.txt` 时**照样绿**。
 *        实际 `*` 是 Node 的字符串替换，可以跨目录 ⇒ 现在对**包内文件集**
 *        求模式匹配，至少命中一个才算成立；根通配也不再无条件放行。
 *   P1-2 HTML 引用：只认双引号 `src`/`href`。补单引号 / 无引号 /
 *        `srcset` / `poster`；根相对 `/x` 原来被当外部**静默忽略**，
 *        现在按包根判（实测仓库 51 个 HTML、334 条引用里根相对为 0 条，
 *        这条今天不产生误报，只是把将来的漏判变成明判）。
 *   ① 字段：`main` / `module` / `browser`(字符串或对象) / `imports`(# 映射)
 *        原来完全不查。现在只要声明了、且值是包内相对路径，就必须在包里。
 *   ② 清单结构：`npm pack --dry-run --json` 的输出原来直接
 *        `parsed[0].files.map(...)`，schema 一变就是 TypeError。
 *        现在 `readPackList()` 显式校验并给出可诊断原因。
 *
 * ---------------------------------------------------------------------------
 * 🔁 第三轮外部审计（2026-10-26 深夜）—— 本轮修的是「判据本身在撒谎」
 *
 *   审计点名的四条，全部属于**我们的判据给了一个 Node 不会给的答案**：
 *
 *   R3-1 多星号：目标里每个 `*` 被独立展开成 `[\\s\\S]*`。
 *        Node 的真实语义是**同一个值替换所有星号** ⇒
 *        `./dist/<star>/copy-<star>.js` 会被 `dist/a/copy-b.js` 判绿，而 Node 解析不出来。
 *        ⇒ 星号语义整体搬到 `05-audit/_pkg-target.js`（唯一实现），
 *          多星用 `\\1` 回填；并用**真 Node 解析**做差分自检。
 *   R3-2 空星号：`[\\s\\S]*` 允许空串。实测 Node 对空星号直接
 *        `ERR_PACKAGE_PATH_NOT_EXPORTED` ⇒ 改成 `+`。
 *   R3-3 目标形状：先 `replace(/^\\.\\//, '')` 再判存在 ⇒ 声明 `"dist/x.js"`
 *        （没有 `./`）只要文件在就判绿，而 Node 抛 `ERR_INVALID_PACKAGE_TARGET`。
 *        ⇒ 加 `checkExportsTarget()`。**只对 exports 生效** ——
 *          `main`/`module`/`browser` 允许不带 `./`，套这条会制造假红。
 *   R3-4 HTML 词法：`<tag ([^>]*)>` 不理解属性引号 ⇒
 *        `<img data-label="a > b" src="missing.png">` 在引号内的 `>` 处截断，
 *        缺失的 `src` **完全看不到**。⇒ 换成引号感知的 tokenizer（不引第三方
 *        依赖，本库零依赖是硬约束），并把 `<base>` / 导航链接 / srcset
 *        语法一起收紧。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 明确不覆盖（说了不做，比假装覆盖强）
 *
 *   `data-mv-three="vendor/three.min.js"` 这类 **data-* 运行时配置**的
 *   资源：它不在 HTML 的 src/href 里，是点击后才由 JS 读出来注入的。
 *   `09-assets/model-viewer/demo.html` 已用正文声明「包里没有 vendor/ 与
 *   models/，看到降级 UI 是预期行为」。本门禁**不判**它，因为
 *   「声明为外部依赖」和「漏打包」在静态层面长得一模一样，
 *   硬判只会制造假红。⇒ 这一项保留为**未验证**，不记作通过。
 *
 *   CSS 文档里的 `url()` 与 `@import`：第三轮审计也点了这一条（「后者不是
 *   HTML attribute，需要单独定义范围」）。**本轮明确不做**，理由不是难，
 *   而是它是**另一类文档**：随包有上百个 CSS，要按 CSS 语法判、要处理
 *   `url(#grad)` / `data:` / `var()` 拼接，塞进这道 HTML 引用判据里会让
 *   判据混杂、误报率不可控。⇒ 结论行里显式打印为**未验证**，不记作通过。
 *
 *   同样不覆盖：入口能否被消费者 `import`/`require` 真正解析 ——
 *   那是 `05-audit/entry-resolve.js`（在 pack-smoke 里、装完之后跑）。
 * ==========================================================================*/
'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');
/* 星号 / 目标形状的判据**只有一份**（E31）。别在本文件里再写一遍正则。 */
var pkgTarget = require('./_pkg-target.js');

var ROOT = path.resolve(__dirname, '..');

/* ==========================================================================
 * ① 判定核心（纯函数：只依赖一个"文件集"抽象，便于自检里喂假数据）
 * ========================================================================*/

/* npm 永远会带上这三样，哪怕 files 白名单里没写（README/LICENSE 任意扩展名、
 * package.json 本身）。清单里有没有都算"有"，否则会制造假红。 */
var ALWAYS_SHIPPED = { 'package.json': 1, 'readme.md': 1, 'license': 1 };

/** 🔴 已知豁免：**发布出去**的页面里有几条导航链接指向**不发布**的开发目录。
 *
 *  实测（2026-10-26，第三轮审计把导航链接纳入判定之后第一次跑出来的）：
 *    根 index.html:36 / :75 / :76 / :77 分别指向
 *      10-review/ios/index.html（出现两次）
 *      10-review/composition/demo.html
 *      examples/react-vite/index.html
 *    而 `files` 白名单里**没有** `10-review/` 和 `examples/`
 *    ⇒ 消费者装完点这两处必然 404。
 *
 *  ⚠️ 为什么不顺手改 index.html：
 *    ① 它是**视觉基线页**之一，改内容要连带重录基线，而本机渲染环境与基线
 *       不一致（见 ERRORS：未改一行代码的 master 就跑出 37/40 页 31px 高度差）
 *       ⇒ 在这台机器上重录等于用另一套渲染覆盖基准；
 *    ② 「入口页在发布版里要不要链到开发目录」是**产品取舍**，不是门禁能替
 *       维护者决定的（严格 scope freeze）。
 *  ⇒ 登记为显式豁免，并在结论里**打印**（不静默）。新增的死链仍然会红 ——
 *    这条豁免按**目标路径逐个列**，不是"导航链接一律放过"。
 */
var KNOWN_DEV_ONLY_NAV = {
  '10-review/composition/demo.html': '开发期评审页；files 白名单未包含 10-review/',
  '10-review/ios/index.html': '同上（Safari 专项验证页）',
  'examples/react-vite/index.html': '开发期示例；files 白名单未包含 examples/'
};

/**
 * 把 exports 摊平成 { label, target } 列表。
 *
 * 🔴 这就是原来那版 walker 的病根：只认顶层字符串。
 *    exports 的值有 **四种**形态，全部要走到：
 *      ① 字符串          "./tokens.css": "./dist/01-tokens/tokens.css"
 *      ② 条件导出对象     ".": { "types": ..., "default": "./index.html" }
 *      ③ 嵌套条件         "node": { "import": ..., "require": ... }
 *      ④ 数组（回退链）   "./x": ["./a.js", "./b.js"]
 *    另外顶层 exports 本身也可以是字符串或数组（单入口包）。
 *
 *  ⚠️ 数组（回退链）—— **这是本项目自定的政策，不是对 Node 行为的描述。**
 *     本门禁要求数组里的**每一个**字符串分支都指向包内存在的文件。
 *
 *     第三轮审计指出上一版这句话说得过宽：「Node 会跳过解析不出的分支、
 *     继续试下一个」。更准确的说法是 —— 两者**宽严不同，不可互相解释**：
 *       · Node 解析数组时，只在「该分支在当前条件集下不可用」时继续试下一个；
 *         「目标字符串非法」（如不以 `./` 开头）是直接抛 ERR_INVALID_PACKAGE_TARGET，
 *         不会回退。至于「目标文件不存在」是否被当作可跳过，取决于解析所处
 *         的阶段与条件集，**不该被当成判据引用**。
 *       · 本门禁只看一件事：**声明了却不在包里的分支 = 作者以为它在包里**。
 *         所以要求全部分支存在，这是有意的 fail-closed，不是对 Node 的模拟。
 *     ⇒ 真有正当理由要留空分支，请把那条从 package.json 里删掉。
 *        本门禁不猜「这条大概是想回退吧」。规格已决（第二轮审计登记，
 *        第三轮审计核准为「有意政策可以接受，但注释措辞要改」）。
 */
function walkExports(ex) {
  var rows = [];

  function walk(val, label) {
    if (typeof val === 'string') {
      rows.push({ label: label, target: val });
      return;
    }
    if (Array.isArray(val)) {
      for (var i = 0; i < val.length; i++) walk(val[i], label + '[' + i + ']');
      return;
    }
    if (val && typeof val === 'object') {
      Object.keys(val).forEach(function (cond) {
        walk(val[cond], label + ' » ' + cond);
      });
    }
  }

  if (typeof ex === 'string' || Array.isArray(ex)) {
    walk(ex, 'exports（顶层裸值）');
    return rows;
  }
  Object.keys(ex || {}).forEach(function (k) {
    walk(ex[k], k);
  });
  return rows;
}

/** 把导出目标模式翻成正则。
 *
 *  🔴 实现**不在这里** —— 已搬到 `05-audit/_pkg-target.js`。
 *     第三轮审计点名：本文件和 entry-resolve.js 各写过一遍，而且**已经分叉**
 *     （一个每个 `*` 独立展开，一个只取 `m[1]`，两个都不是 Node 的语义）。
 *     ⇒ 按 E31「同一判定写两遍必然漂移」，现在只留一个实现，这里只转发。
 *     保留这个函数名是因为 `--selftest` 与外部按名引用它。
 */
function patternToRegExp(t) {
  return pkgTarget.toRegExp(t);
}

/**
 * 单个目标在文件集里是否成立。
 *
 * @param {string} target  导出声明的目标
 * @param {{allFiles:fn, exists:fn}} vfs 文件集
 * @param {{strictShape?:boolean}} [opts]
 *        `strictShape`（默认 true）要求目标符合 **exports 目标**形状：
 *        必须以 `./` 开头、不许 `..` 段、不许 `node_modules`。
 *        判 `main` / `module` / `browser` / `jsnext:main` 时**必须传 false** ——
 *        那些更老的字段允许 `index.js` 这种不带 `./` 的写法，
 *        套 exports 的形状会制造假红（实测：包里就有 `"main": "03-patterns/…"`）。
 */
function targetStatus(target, vfs, opts) {
  var strictShape = !(opts && opts.strictShape === false);

  if (strictShape) {
    var shape = pkgTarget.checkExportsTarget(target);
    if (!shape.ok) return { ok: false, kind: 'shape', why: shape.why };
  }

  var t = String(target).replace(/^\.\//, '');
  var stars = pkgTarget.starCount(t);

  if (stars > 0) {
    /* 🔴 多个 `*` 必须用**同一个值**替换（Node 语义，实测见 _pkg-target.js 头）。
       旧实现在这里给每个 `*` 各开一个 `[\s\S]*` ⇒ `dist/a/copy-b.js` 也判绿。 */
    var files = vfs.allFiles();
    for (var i = 0; i < files.length; i++) {
      if (pkgTarget.starValue(t, files[i]) !== null) {
        return { ok: true, kind: 'wildcard', match: files[i] };
      }
    }
    return {
      ok: false, kind: 'wildcard',
      why: '包里没有任何文件匹配该模式（`*` 可跨目录、且多个 `*` 必须是同一个值）'
    };
  }

  if (vfs.exists(t)) return { ok: true, kind: 'exact' };
  return { ok: false, kind: 'exact', why: '文件不存在' };
}

/* ==========================================================================
 *  ①b HTML 词法：引号感知的 tokenizer
 *
 * 🔴 第三轮审计 R3-4：旧实现是 `<tag ([^>]*)>` —— 它**不理解属性引号**：
 *      <img data-label="a > b" src="missing.png">
 *    在引号里的 `>` 处就把标签截断了，后面的 `src` **完全看不到**。
 *    这是合法 HTML，不是刁钻写法，只是文案里带个 `>` 而已。
 *
 *    用 HTML parser 是最正的解，但本库的核心约束是**零第三方运行时依赖**，
 *    devDependencies 里也没有 HTML parser（引进来会给维护者多一份要跟进的东西）。
 *    ⇒ 写一个够用的 tokenizer：只认开始/结束标签 + 属性，规范到「引号内不结束」
 *      这一条；**不**做实体解码（属性值里的 `&amp;` 在路径里几乎不会出现，
 *      真出现也只会造成假红，不会假绿）。
 *
 *    它也顺手解决另一个洞：`<script>` 的内部文本不是标签。
 *    以前 `<script>var s = '<img src="x">'</script>` 会被当成真引用。
 * ========================================================================*/

/* 内容不是标签的元素：open tag 之后必须**跳过内容**直到闭合标签。
   ⚠️ 少写一个就是一个假红/假绿来源，所以按规范列表来，不按"见过的"来。 */
var RAW_TEXT_TAGS = {
  script: 1, style: 1, textarea: 1, title: 1, xmp: 1, iframe: 1,
  noembed: 1, noframes: 1, plaintext: 1
};

/**
 * 把 HTML 切成标签流。返回 `[{tag, attrs: [{name, value}], end}]`。
 * `end: true` 表示结束标签（`</x>`）或声明（`<!doctype>`），调用方忽略即可。
 */
function tokenizeTags(html) {
  var text = String(html);
  var out = [];
  var i = 0;
  var n = text.length;

  while (i < n) {
    var lt = text.indexOf('<', i);
    if (lt < 0) break;

    /* 注释整段跳过。`<!--` 里可以有 `>`，所以不能等 `>`。 */
    if (text.substr(lt, 4) === '<!--') {
      var ce = text.indexOf('-->', lt + 4);
      i = ce < 0 ? n : ce + 3;
      continue;
    }

    var c1 = text.charAt(lt + 1);

    /* 结束标签 / doctype / 处理指令：名字取出来，属性为空。 */
    if (c1 === '/' || c1 === '!' || c1 === '?') {
      var gt = text.indexOf('>', lt);
      var name = '';
      if (c1 === '/') {
        var mm = /^<\/([a-zA-Z][^\s/>]*)/.exec(text.slice(lt, lt + 48));
        name = mm ? mm[1].toLowerCase() : '';
      }
      out.push({ tag: name || '!', attrs: [], end: true });
      if (gt < 0) break;
      i = gt + 1;
      continue;
    }

    if (!/[a-zA-Z]/.test(c1)) { i = lt + 1; continue; }

    /* 标签名 */
    var j = lt + 1;
    while (j < n && !/[\s/>]/.test(text.charAt(j))) j++;
    var tag = text.slice(lt + 1, j).toLowerCase();

    /* 属性：**引号感知**。这里是整个函数存在的理由。 */
    var attrs = [];
    while (j < n) {
      while (j < n && /\s/.test(text.charAt(j))) j++;
      if (j >= n) break;
      var ch = text.charAt(j);
      if (ch === '>') { j++; break; }
      if (ch === '/') { j++; continue; }          /* `<br />` 的自闭合斜杠 */

      var s = j;
      while (j < n && !/[\s=/>]/.test(text.charAt(j))) j++;
      if (j === s) { j++; continue; }             /* 防御：不认识就前进一格，绝不原地打转 */
      var aname = text.slice(s, j).toLowerCase();

      var avalue = '';
      var k = j;
      while (k < n && /\s/.test(text.charAt(k))) k++;
      if (text.charAt(k) === '=') {
        k++;
        while (k < n && /\s/.test(text.charAt(k))) k++;
        var q = text.charAt(k);
        if (q === '"' || q === "'") {
          var qe = text.indexOf(q, k + 1);
          if (qe < 0) { avalue = text.slice(k + 1); k = n; }
          else { avalue = text.slice(k + 1, qe); k = qe + 1; }
        } else {
          var ve = k;
          while (ve < n && !/[\s>]/.test(text.charAt(ve))) ve++;
          avalue = text.slice(k, ve);
          k = ve;
        }
        j = k;
      }
      attrs.push({ name: aname, value: avalue });
    }

    out.push({ tag: tag, attrs: attrs, end: false });
    i = j;

    /* 原始文本元素：内容不是标签，必须跳到闭合标签之后。 */
    if (RAW_TEXT_TAGS[tag] && text.charAt(j - 1) !== '/') {
      var close = new RegExp('</' + tag + '\\b', 'i');
      var cm = close.exec(text.slice(i));
      if (cm) {
        var gt2 = text.indexOf('>', i + cm.index);
        i = gt2 < 0 ? n : gt2 + 1;
      } else {
        i = n;
      }
    }
  }

  return out;
}

/**
 * 按 **srcset 语法**拆候选，不是 `split(',')`。
 *
 * 🔴 第三轮审计点名的假红：`data:image/png;base64,AAAA 1x, b.png 2x`
 *    用 `split(',')` 会把 data URI 拆成两段，然后报「data:image/png;base64 不存在」。
 *
 * 规范事实：srcset 里的 URL **不允许含空白**，但**允许含逗号**；
 * 候选之间用逗号分隔，且分隔逗号**后面**跟的才是下一个 URL。
 * ⇒ 按「先吃到空白为止得到一个 URL，再跳到下一个逗号」来走。
 */
function parseSrcset(v) {
  var text = String(v);
  var out = [];
  var i = 0;
  var n = text.length;

  while (i < n) {
    while (i < n && (/\s/.test(text.charAt(i)) || text.charAt(i) === ',')) i++;
    if (i >= n) break;

    var s = i;
    while (i < n && !/\s/.test(text.charAt(i))) i++;
    var url = text.slice(s, i);

    if (/,$/.test(url)) {
      /* `a.png, b.png` —— 逗号紧贴 URL 结尾，这个候选没有描述符 */
      out.push(url.replace(/,+$/, ''));
      continue;
    }
    out.push(url);

    /* 描述符里不会出现逗号，所以下一个逗号就是候选分隔符 */
    while (i < n && text.charAt(i) !== ',') i++;
  }

  return out.filter(function (u) { return !!u; });
}

/* 同一属性在一张标签里出现两次时按 HTML 规范取**第一个**。 */
function attrsOf(tagToken) {
  var map = {};
  tagToken.attrs.forEach(function (a) {
    if (!Object.prototype.hasOwnProperty.call(map, a.name)) map[a.name] = a.value;
  });
  return map;
}

/** 这些标签上的 `href` 是**资源**（页面加载时就会请求）。 */
var HREF_IS_RESOURCE = { link: 1, use: 1, image: 1, script: 1, track: 1 };

/** 这些标签上的 `href` 是**导航**（用户点了才请求）。 */
var HREF_IS_NAV = { a: 1, area: 1 };

/**
 * 从标签流里取出引用，分成三类：
 *   `res`  资源引用（src / srcset / poster / object[data] / link[href] …）
 *   `nav`  导航引用（a[href] / area[href] / form[action] / formaction）
 *   `base` `<base href>` 的值（null 表示没有）
 *
 * ⚠️ 为什么要分两类而不是混成一个数组：**判据不同**。
 *    资源引用必须精确命中一个文件；导航链接可以指向目录（浏览器会找
 *    index），也可以省略 `.html`。混在一起会把 demo 里的正常目录链接判红。
 */
function collectRefs(tokens) {
  var res = [];
  var nav = [];
  var base = null;

  tokens.forEach(function (t) {
    if (t.end) return;
    var a = attrsOf(t);

    if (t.tag === 'base' && base === null &&
        Object.prototype.hasOwnProperty.call(a, 'href')) {
      base = a.href;
    }

    if (Object.prototype.hasOwnProperty.call(a, 'src')) res.push(a.src);
    if (Object.prototype.hasOwnProperty.call(a, 'poster')) res.push(a.poster);
    if (Object.prototype.hasOwnProperty.call(a, 'srcset')) {
      parseSrcset(a.srcset).forEach(function (u) { res.push(u); });
    }
    if (t.tag === 'object' && Object.prototype.hasOwnProperty.call(a, 'data')) {
      res.push(a.data);
    }
    if (Object.prototype.hasOwnProperty.call(a, 'href')) {
      if (HREF_IS_RESOURCE[t.tag]) res.push(a.href);
      else if (HREF_IS_NAV[t.tag]) nav.push(a.href);
    }
    /* SVG 的 `xlink:href`（老写法；新写法是裸 `href`，上面已覆盖） */
    if (Object.prototype.hasOwnProperty.call(a, 'xlink:href') &&
        (t.tag === 'image' || t.tag === 'use')) {
      res.push(a['xlink:href']);
    }
    if (t.tag === 'form' && Object.prototype.hasOwnProperty.call(a, 'action')) {
      nav.push(a.action);
    }
    if (Object.prototype.hasOwnProperty.call(a, 'formaction')) nav.push(a.formaction);
  });

  return { res: res, nav: nav, base: base };
}

/** 兼容旧接口：只返回资源引用（不含导航）。 */
function htmlRefs(text) {
  return collectRefs(tokenizeTags(text)).res;
}

function isExternalRef(u) {
  return !u || u.charAt(0) === '#' ||
    /^[a-z][a-z0-9+.-]*:/i.test(u) ||      /* http: data: mailto: javascript: */
    u.slice(0, 2) === '//';
}

/** 这个字段值算不算"包内相对路径"。
 *  `main: "index.js"`（不带 `./`）是合法且常见的写法，必须算；
 *  裸包名（`"browser": {"fs": false}` 的键、`imports` 指向依赖）不能算。 */
function isRelPath(v) {
  if (typeof v !== 'string' || !v) return false;
  if (v.slice(0, 2) === './' || v.slice(0, 3) === '../') return true;
  if (v.charAt(0) === '/' || v.charAt(0) === '#') return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return false;
  return /\.[a-z0-9]+$/i.test(v);          /* index.js / dist/x.css */
}

/** 严格形态：必须以 `./` 或 `../` 开头（`imports` 的目标用这个判）。 */
function isDotRel(v) {
  return typeof v === 'string' &&
    (v.slice(0, 2) === './' || v.slice(0, 3) === '../');
}

/** 把任意形态（字符串 / 数组 / 条件对象）里的字符串全收集出来。 */
function collectStrings(v, out) {
  out = out || [];
  if (typeof v === 'string') { out.push(v); return out; }
  if (Array.isArray(v)) { v.forEach(function (x) { collectStrings(x, out); }); return out; }
  if (v && typeof v === 'object') {
    Object.keys(v).forEach(function (k) { collectStrings(v[k], out); });
  }
  return out;
}

/**
 * 全量判定。
 * @param {{name:string,exports?:object,files?:array,types?:string,typings?:string}} pkg
 * @param {{exists:fn,isDir:fn,listDir:fn,read:fn,allFiles:fn}} vfs
 * @returns {{problems:string[], stats:object}}
 */
function checkClosure(pkg, vfs) {
  var problems = [];
  var name = pkg.name || '(未命名)';

  /* ---------- A. exports 的每一种形态 ---------- */
  var rows = walkExports(pkg.exports);
  var exact = 0;
  var wild = 0;
  rows.forEach(function (r) {
    var st = targetStatus(r.target, vfs);
    if (st.ok) {
      if (st.kind === 'exact') exact++; else wild++;
      return;
    }
    problems.push({ s: 'exports', t: 'exports ' + r.label + ' → ' + r.target +
                             '（' + st.why + '）' });
  });

  /* ---------- B. 类型声明（对外承诺，缺了 TS 用户直接炸） ---------- */
  ['types', 'typings'].forEach(function (f) {
    var v = pkg[f];
    if (typeof v !== 'string' || !v) return;
    if (!vfs.exists(v.replace(/^\.\//, ''))) {
      problems.push({ s: 'exports', t: f + ' → ' + v + '（文件不在包内）' });
    }
  });

  /* ---------- B1. 传统入口字段 ----------
   *  `main` / `module` 是 npm 生态里比 `exports` 更老的入口契约，
   *  `browser` 还有字符串和对象两种形态。它们同样是对外承诺：
   *  文件不在包里，`require('pkg')` 就炸。
   *  ⚠️ 只判**相对路径**形态：裸包名（`"module": "some-pkg"`）和 URL
   *     属于依赖策略，硬判会制造假红。 */
  function checkFieldPath(field, v) {
    if (!isRelPath(v)) return;
    if (v.indexOf('*') >= 0) {
      /* strictShape:false —— main/module/browser 允许不带 `./` */
      var st = targetStatus(v, vfs, { strictShape: false });
      if (!st.ok) {
        problems.push({ s: 'exports', t: field + ' → ' + v + '（' + st.why + '）' });
      }
      return;
    }
    if (!vfs.exists(v.replace(/^\.\//, ''))) {
      problems.push({ s: 'exports', t: field + ' → ' + v + '（文件不在包内）' });
    }
  }
  checkFieldPath('main', pkg.main);
  checkFieldPath('module', pkg.module);
  checkFieldPath('jsnext:main', pkg['jsnext:main']);
  if (typeof pkg.browser === 'string') {
    checkFieldPath('browser', pkg.browser);
  } else if (pkg.browser && typeof pkg.browser === 'object') {
    /* 对象形态：{ "./a.js": "./b.js", "fs": false }。只判**值**是相对路径的
       那几项；键是请求说明符，存在与否由目标决定。 */
    Object.keys(pkg.browser).forEach(function (k) {
      checkFieldPath('browser["' + k + '"]', pkg.browser[k]);
    });
  }

  /* ---------- B2. imports（# 内部映射）----------
   *  只处理包内 `#x": "./..."`；指向外部包名的留给依赖策略。
   *  键必须以 `#` 开头，否则 Node 会直接抛 ERR_PACKAGE_IMPORT_NOT_DEFINED。 */
  (function () {
    var im = pkg.imports;
    if (!im || typeof im !== 'object') return;
    Object.keys(im).forEach(function (k) {
      if (k.charAt(0) !== '#') {
        problems.push({ s: 'exports', t: 'imports 的键必须以 # 开头：' + k });
      }
      collectStrings(im[k]).forEach(function (v) {
        /* 裸包名（`"#dep": "some-pkg"`）是"指向依赖"，属依赖策略，跳过；
           只有 `./` 开头的才是包内目标。 */
        if (!isDotRel(v)) return;
        checkFieldPath('imports["' + k + '"]', v);
      });
    });
  })();

  /* ---------- C. 随包 HTML 的本地引用 ----------
   *
   *  第三轮审计点名了三处，本轮全改：
   *    ① 注释与转义示例不算引用  —— 已在 tokenizer 里（注释整段跳过、
   *       转义示例没有字面 `<`，天然不会进标签流）。
   *    ② `<base href>` 能改变**整页**相对 URL 的基准。旧实现根本没读它，
   *       于是页面加了 `<base href="https://cdn/">` 之后，本地引用实际会
   *       请求到 CDN 上去，而门禁还按"HTML 文件所在目录"判 → 假绿。
   *       ⇒ 现在：相对 base 参与解析；**指向包外/站点根的 base 直接判红**
   *         （fail-closed：那种页面的相对引用我们无法静态判定，与其判绿
   *         不如说清"判不了"）。实测仓库 51 个 HTML 里 `<base>` 出现 **0** 次。
   *    ③ 导航链接（`a` / `area` / `form[action]` / `formaction`）原来完全不判。
   *       ⇒ 现在判，但用**不同的判据**（见 judge() 的 isNav 分支）：
   *         导航可以指向目录，也可以省略 `.html`，资源引用不行。
   *   ⚠️ 仍未覆盖：CSS 文档里的 `url()` / `@import`（理由见文件头「明确不覆盖」）。
   */
  var htmlN = 0;
  var refN = 0;
  var navN = 0;
  var baseN = 0;
  var exemptN = 0;

  vfs.allFiles().forEach(function (f) {
    if (!/\.html?$/i.test(f)) return;
    htmlN++;

    var parsed = collectRefs(tokenizeTags(vfs.read(f)));

    /* 解析基准：默认是 HTML 文件所在目录；有相对 `<base>` 时改用它。 */
    var baseDir = path.posix.dirname(f);
    if (parsed.base !== null) {
      baseN++;
      var b = String(parsed.base).trim();
      if (isExternalRef(b) || b.charAt(0) === '/') {
        problems.push({
          s: 'html',
          t: f + ' 的 <base href="' + b + '"> 指向包外/站点根 ⇒ 本页相对引用' +
               '不指向包内，静态无法判定（fail-closed，不记作通过）'
        });
        return;                       /* 已记一条，不再逐条误判这一页 */
      }
      var joined = path.posix.normalize(path.posix.join(path.posix.dirname(f), b));
      baseDir = /\/$/.test(b) ? joined : path.posix.dirname(joined);
      if (baseDir.slice(0, 2) === '..') {
        problems.push({ s: 'html', t: f + ' 的 <base href="' + b + '"> 越出包根' });
        return;
      }
    }

    function judge(raw, isNav) {
      var u = String(raw).trim();
      if (isExternalRef(u)) return;

      /* 去掉 `#fragment` 与 `?query` 后再判文件。纯 `#x` / `?x` 是页内跳转。 */
      var pure = u.split('#')[0].split('?')[0];
      if (!pure) return;

      if (isNav) navN++; else refN++;

      /* 🔴 根相对 `/assets/x.css` 原来被 isExternalRef 直接当外部忽略 ——
         那是**静默放过**：包内 HTML 是从 node_modules 里打开的，没有站点根，
         `/x` 只会 404。这里改成按**包根**解析并显式判定。
         实测（2026-10-26）仓库 51 个 HTML、334 条引用里根相对是 **0 条**，
         所以这条规则今天不产生任何误报，纯粹是把将来的漏判变成明判。 */
      if (pure.charAt(0) === '/') {
        var rt = path.posix.normalize(pure.replace(/^\/+/, ''));
        if (!rt || rt.slice(0, 2) === '..') {
          problems.push({ s: 'html', t: f + ' 引用 ' + u + '（根相对路径越界）' });
          return;
        }
        if (!existsFor(rt, isNav)) {
          problems.push({
            s: 'html', t: f + ' 引用根相对路径 ' + u + '（包根处没有 ' + rt + '）'
          });
        }
        return;
      }

      var tgt = path.posix.normalize(path.posix.join(baseDir, pure));
      if (tgt.slice(0, 2) === '..') {
        problems.push({ s: 'html', t: f + ' 引用 ' + u + '（跑到包外去了）' });
        return;
      }
      if (isNav && Object.prototype.hasOwnProperty.call(KNOWN_DEV_ONLY_NAV, tgt)) {
        exemptN++;
        return;
      }
      if (!existsFor(tgt, isNav)) {
        problems.push({ s: 'html', t: f + ' 引用 ' + u + ' → ' + tgt + '（不在包内）' });
      }
    }

    /** 资源引用必须**精确命中文件**；导航链接宽松一档（目录 / 补 .html / index）。 */
    function existsFor(p, isNav) {
      if (vfs.exists(p)) return true;
      if (!isNav) return false;
      var dir = p.replace(/\/+$/, '');
      return vfs.isDir(dir) ||
             vfs.exists(dir + '.html') ||
             vfs.exists(dir + '/index.html');
    }

    parsed.res.forEach(function (u) { judge(u, false); });
    parsed.nav.forEach(function (u) { judge(u, true); });
  });

  /* ---------- D. 文档里给使用者的 node_modules/<包名>/… 路径 ---------- */
  /*  起因（2026-10-06 真实用户级事故）：README 教人写
   *    <script src="node_modules/frontend-lib/patterns/overlay/overlay.js">
   *  而 tarball 里根本没有 patterns/ 这个目录 ⇒ 陌生人照抄必然 404。
   *  exports 的 "./patterns/*" 只对包解析生效，**不会**在 node_modules 里
   *  造出同名目录。 */
  var re = new RegExp('node_modules/' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                      '/([A-Za-z0-9_/.-]+\\.(?:js|css))', 'g');
  var docN = 0;
  vfs.allFiles().forEach(function (f) {
    if (!/\.md$/i.test(f)) return;
    var text = vfs.read(f);
    var m;
    while ((m = re.exec(text))) {
      docN++;
      if (!vfs.exists(m[1])) {
        problems.push({ s: 'docs', t: f + ' 里写的 node_modules/' + name +
                                       '/' + m[1] + '（包内不存在）' });
      }
    }
    re.lastIndex = 0;
  });

  return {
    problems: problems,
    stats: {
      exact: exact, wildcard: wild, html: htmlN, refs: refN, nav: navN, base: baseN,
      exempt: exemptN, docRefs: docN, files: vfs.allFiles().length
    }
  };
}

/* ==========================================================================
 * ② 两种文件集来源
 * ========================================================================*/

/** 清单模式：npm 自己算出来的包内文件清单（权威）。 */
function vfsFromPackList(list) {
  var files = {};
  list.forEach(function (f) { files[f] = 1; });
  var dirs = {};
  Object.keys(files).forEach(function (f) {
    var d = path.posix.dirname(f);
    while (d && d !== '.' && !dirs[d]) {
      dirs[d] = 1;
      d = path.posix.dirname(d);
    }
  });

  return {
    allFiles: function () { return Object.keys(files).sort(); },
    exists: function (p) {
      if (files[p]) return true;
      return !!ALWAYS_SHIPPED[p.split('/').pop().toLowerCase()] && p.indexOf('/') < 0;
    },
    isDir: function (p) { return !!dirs[p]; },
    listDir: function (p) {
      return Object.keys(files).filter(function (f) {
        return f.indexOf(p + '/') === 0;
      });
    },
    read: function (p) {
      return fs.readFileSync(path.join(ROOT, p), 'utf8');
    }
  };
}

/** 目录模式：已解包 / 已安装的树。
 *
 *  🔴 `listDir` 必须和清单模式**同一个语义**：返回"该前缀下的全部文件"
 *     （递归），不是"该目录的直接子项"。
 *     第一版写成 `readdirSync(p).filter(isFile)`，于是
 *        dist/02-primitives/       ← 下面只有子目录，没有直接文件
 *     被判成「目标目录为空」⇒ 通配导出 `./primitives/*` 假红。
 *     而清单模式（平铺文件名列表）反而正确 —— 两种模式判据不一致，
 *     正是本脚本开头警告的那件事：同一判定两个实现必然分叉。
 */
function vfsFromDir(root) {
  var all = [];
  (function walk(rel) {
    var abs = rel ? path.join(root, rel) : root;
    var names;
    try { names = fs.readdirSync(abs); } catch (e) { return; }
    names.forEach(function (n) {
      var r = rel ? rel + '/' + n : n;
      var st;
      try { st = fs.statSync(path.join(root, r)); } catch (e) { return; }
      if (st.isDirectory()) walk(r); else all.push(r);
    });
  })('');
  all.sort();

  var isFile = {};
  all.forEach(function (f) { isFile[f] = 1; });

  return {
    allFiles: function () { return all; },
    exists: function (p) { return !!isFile[p]; },
    isDir: function (p) {
      try { return fs.statSync(path.join(root, p)).isDirectory(); } catch (e) { return false; }
    },
    listDir: function (p) {
      return all.filter(function (f) { return f.indexOf(p + '/') === 0; });
    },
    read: function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); }
  };
}

/* ==========================================================================
 * ③ 自检：判据自己有没有牙（有鉴别力 + 不误报）
 * ========================================================================*/
function selftest() {
  var bad = 0;

  /* 假文件集：{ 路径: 内容 }。
     🔴 内容必须能参与判定 —— 第一版这里把所有文件都填成 '<html></html>'，
        于是 [3]（HTML 引用）在自检里**永远没有引用可判**，
        等于"自检通过"却根本没测到那条判据。这类假绿是自己身上犯的同一个病。 */
  function fakeVfs(map) {
    map = map || {};
    var dirs = {};
    Object.keys(map).forEach(function (f) {
      var d = path.posix.dirname(f);
      while (d && d !== '.' && !dirs[d]) { dirs[d] = 1; d = path.posix.dirname(d); }
    });
    return {
      allFiles: function () { return Object.keys(map); },
      exists: function (p) { return Object.prototype.hasOwnProperty.call(map, p); },
      isDir: function (p) { return !!dirs[p]; },
      listDir: function (p) {
        return Object.keys(map).filter(function (f) { return f.indexOf(p + '/') === 0; });
      },
      read: function (p) { return map[p] || ''; }
    };
  }

  /** 基准文件集（= 一个健康的包），extra 覆盖 / 追加。 */
  function base(extra) {
    var m = {
      'package.json': '{}',
      'index.html': '<!DOCTYPE html><html></html>',
      'types/index.d.ts': '',
      'dist/01-tokens/tokens.css': '',
      '03-patterns/overlay/overlay.js': '',
      'README.md': '# agentcss'
    };
    Object.keys(extra || {}).forEach(function (k) {
      if (extra[k] === null) delete m[k]; else m[k] = extra[k];
    });
    return m;
  }

  function expect(label, pkg, files, shouldFail) {
    var got = checkClosure(pkg, fakeVfs(files)).problems;
    var ok = shouldFail ? got.length > 0 : got.length === 0;
    if (!ok) {
      bad++;
      console.log('      X ' + label + '（期望' + (shouldFail ? '报错' : '通过') +
                  '，实际 ' + (got.length ? got.join('；') : '通过') + '）');
    } else {
      console.log('      OK ' + label);
    }
  }

  var OK_PKG = {
    name: 'agentcss',
    exports: {
      '.': { types: './types/index.d.ts', default: './index.html' },
      './tokens.css': './dist/01-tokens/tokens.css',
      './patterns/*': './03-patterns/*'
    },
    types: './types/index.d.ts'
  };

  console.log('  === 判据自检 ===');
  expect('不误报：条件导出 + 通配 + 类型都齐', OK_PKG, base(), false);

  /* 🔴 下面这条就是本次的原始 bug：条件导出里的 default 指向未打包文件。
     旧 walker 只认 `typeof v === 'string'` ⇒ 整片跳过 ⇒ publish:check 全绿。 */
  expect('反：条件导出 default 指向未打包文件（本次原始 bug）',
    OK_PKG, base({ 'index.html': null }), true);

  expect('反：嵌套条件导出里的目标缺失', {
    name: 'agentcss', exports: { '.': { node: { import: './nope.mjs' } } }
  }, base(), true);

  expect('反：数组回退链里有一个缺失', {
    name: 'agentcss',
    exports: { './x': ['./dist/01-tokens/tokens.css', './gone.js'] }
  }, base(), true);

  expect('反：顶层 exports 是裸字符串且缺失', {
    name: 'agentcss', exports: './gone.js'
  }, base(), true);

  expect('反：通配导出的目标目录不在包里', {
    name: 'agentcss', exports: { './recipes/*': './04-recipes/*' }
  }, base(), true);

  expect('反：types 指向未打包文件', {
    name: 'agentcss', exports: {}, types: './types/gone.d.ts'
  }, base(), true);

  /* ---------- HTML 引用：抓真引用，且不许误报 ---------- */
  expect('反：HTML 真引用了未打包的 css', {
    name: 'agentcss', exports: {}
  }, base({ 'demo/demo.html': '<link rel="stylesheet" href="demo.css">' }), true);

  expect('不误报：注释里的 <script src> 与转义示例都不算引用', {
    name: 'agentcss', exports: {}
  }, base({
    'demo/demo.html':
      '<!-- 注意：这里没有 <script src="three.min.js"> -->\n' +
      '<code>&lt;script src="echarts.min.js"&gt;&lt;/script&gt;</code>\n' +
      '<link rel="icon" href="data:,">'
  }), false);

  expect('反：文档教人引用的 node_modules 路径不在包里', {
    name: 'agentcss', exports: {}
  }, base({
    'docs/A.md': '写成 node_modules/agentcss/patterns/x.js 即可'
  }), true);

  /* ---------- 通配：**目录非空 ≠ 有文件匹配**（外部审计 P1-1） ----------
     🔴 旧判据把 `*` 当"这一层目录"，只看目录非空。
        `./x/*` → `./dist/*.js`，而 dist/ 里只有 notes.txt 时**照样通过**。
        实际 `*` 是 Node 的字符串替换，可以跨目录 —— 必须对真实文件集求匹配。 */
  expect('反：通配目录非空，但没有任何文件匹配 `dist/*.js`', {
    name: 'agentcss', exports: { './x/*': './dist/*.js' }
  }, base({ 'dist/notes.txt': '' }), true);

  expect('不误报：`dist/*.js` 下有真实 js', {
    name: 'agentcss', exports: { './x/*': './dist/*.js' }
  }, base({ 'dist/a.js': '' }), false);

  expect('反：根通配但包内一个文件都没有', {
    name: 'agentcss', exports: { './*': './*' }
  }, {}, true);

  /* ---------- HTML 引用：单引号 / 无引号 / srcset / poster ---------- */
  expect('反：单引号 href 指向未打包 css', { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<link rel="stylesheet" href=\'gone.css\'>' }), true);

  expect('反：无引号 src 指向未打包 js', { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<script src=gone.js></script>' }), true);

  expect('反：srcset 里的候选缺失', { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<img src="a.png" srcset="gone.png 2x, a.png 1x">',
           'demo/a.png': '' }), true);

  expect('反：video poster 缺失', { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<video src="a.mp4" poster="gone.jpg"></video>',
           'demo/a.mp4': '' }), true);

  expect('不误报：单引号 / 无引号 / srcset 都指向已有文件', { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<link href=\'demo.css\'>' +
                          '<script src=demo.js></script>' +
                          '<img src=a.png srcset=\'a.png 2x\'>',
           'demo/demo.css': '', 'demo/demo.js': '', 'demo/a.png': '' }), false);

  /* ---------- 根相对 `/x`：原来直接被当外部忽略 ⇒ 静默放过 ---------- */
  expect('反：根相对引用在包根处不存在', { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<link rel="stylesheet" href="/assets/x.css">' }), true);

  expect('不误报：根相对引用在包根处存在', { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<link rel="stylesheet" href="/assets/x.css">',
           'assets/x.css': '' }), false);

  /* ---------- main / module / imports ---------- */
  expect('反：main 指向未打包文件', {
    name: 'agentcss', exports: {}, main: './dist/index.js'
  }, base(), true);

  expect('不误报：main 不带 ./ 也算相对路径', {
    name: 'agentcss', exports: {}, main: '03-patterns/overlay/overlay.js'
  }, base(), false);

  expect('反：imports 的 # 映射指向未打包文件', {
    name: 'agentcss', exports: {}, imports: { '#x': './gone.js' }
  }, base(), true);

  expect('不误报：imports 指向外部包名不判（属依赖策略）', {
    name: 'agentcss', exports: {}, imports: { '#dep': 'some-pkg' }
  }, base(), false);

  expect('反：imports 的键没以 # 开头', {
    name: 'agentcss', exports: {}, imports: { 'x': './index.html' }
  }, base(), true);

  /* ---------- npm pack --json 结构校验（不许一换 schema 就 TypeError） ---------- */
  (function () {
    function rp(label, payload, expectErr) {
      var got = readPackList(payload);
      var has = got.errors.length > 0;
      if (has !== expectErr) {
        bad++;
        console.log('      X ' + label + '（实际 ' + (has ? got.errors[0] : '通过') + '）');
      } else {
        console.log('      OK ' + label);
      }
    }
    rp('不误报：npm pack --json 的正常结构',
       [{ name: 'agentcss', version: '0.9.0', files: [{ path: 'package.json' }] }], false);
    rp('反：顶层空数组', [], true);
    rp('反：files 不是数组', [{ files: {} }], true);
    rp('反：files 是空数组', [{ files: [] }], true);
    rp('反：files 元素缺 path', [{ files: [{ size: 1 }] }], true);
  })();

  /* ---------- 目录模式：必须与清单模式**同语义** ----------
     🔴 这条真踩过：第一版 vfsFromDir.listDir 用的是
        `readdirSync(p).filter(isFile)`（只看直接子项），
        于是 `dist/02-primitives/` 这种**只含子目录**的目录被判成"空"
        ⇒ 通配导出假红；而清单模式反而判对 ⇒ 两种模式给了两个答案。
        假文件集测不出这个（它是平铺列表语义），只能真建一棵树。 */
  (function () {
    var os = require('os');
    var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-closure-'));
    try {
      fs.mkdirSync(path.join(tmp, '04-recipes', 'card'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '04-recipes', 'card', 'card.css'), '');
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
        name: 'agentcss', exports: { './recipes/*': './04-recipes/*' }
      }));
      var pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
      var probs = checkClosure(pkg, vfsFromDir(tmp)).problems;
      if (probs.length) {
        bad++;
        console.log('      X 目录模式：目标目录**只含子目录**时被误判为空（' +
                    probs[0].t + '）');
      } else {
        console.log('      OK 目录模式：目标目录只有子目录时，仍能匹配到真实文件（与清单模式同语义）');
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  })();

  /* ---------- 星号语义：**必须与真 Node 一致**（第三轮审计 R3-1/2/3） ----------
     🔴 审计原话：「待验证：空匹配……应加真实 Node 解析样例，不宜仅凭正则推断。」
        ⇒ 这里直接建临时包，用 `Module.createRequire()` **真解析**一遍
          （只解析，不执行模块 —— 本库的入口是 HTML/CSS，执行必碰 document）。
          判据只有一条：**我们的答案必须等于 Node 的答案**。
          将来 Node 改语义，这条会红，而不是我们继续假绿。 */
  (function () {
    var Module = require('module');
    var os = require('os');
    var cases = [
      { label: '单星可跨目录（dist/b/c.js）',
        exportsMap: { './x/*': './dist/*.js' },
        files: ['dist/a.js', 'dist/b/c.js'], sub: 'x/b/c' },
      { label: '多星不同值 **不成立**（dist/a/copy-b.js）',
        exportsMap: { './x/*': './dist/*/copy-*.js' },
        files: ['dist/a/copy-b.js'], sub: 'x/a' },
      { label: '多星同值成立（dist/a/copy-a.js）',
        exportsMap: { './x/*': './dist/*/copy-*.js' },
        files: ['dist/a/copy-a.js'], sub: 'x/a' },
      { label: '目标不带 ./ 不成立（ERR_INVALID_PACKAGE_TARGET）',
        exportsMap: { './i': 'dist/i.js' },
        files: ['dist/i.js'], sub: 'i' }
    ];

    var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-closure-node-'));
    try {
      cases.forEach(function (c, idx) {
        var dir = path.join(tmp, 'c' + idx);
        var pkgDir = path.join(dir, 'node_modules', 'p');
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'package.json'),
          JSON.stringify({ name: 'p', version: '1.0.0', exports: c.exportsMap }));
        c.files.forEach(function (f) {
          var abs = path.join(pkgDir, f);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, '');
        });

        var anchor = path.join(dir, '__a.js');
        fs.writeFileSync(anchor, '');
        var nodeOk = true;
        try { Module.createRequire(anchor).resolve('p/' + c.sub); }
        catch (e) { nodeOk = false; }

        /* 我们的答案：把 exports 里唯一的目标拿出来判 */
        var target = null;
        (function pick(v) {
          if (target !== null) return;
          if (typeof v === 'string') { target = v; return; }
          if (Array.isArray(v)) { v.forEach(pick); return; }
          if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { pick(v[k]); });
        })(c.exportsMap[Object.keys(c.exportsMap)[0]]);

        var ours = targetStatus(target, fakeVfs(function () {
          var m = { 'package.json': '{}' };
          c.files.forEach(function (f) { m[f] = ''; });
          return m;
        }())).ok;

        if (ours !== nodeOk) {
          bad++;
          console.log('      X 与真 Node 不一致：' + c.label +
                      '（Node ' + (nodeOk ? '解析成功' : '解析失败') +
                      '，本判据 ' + (ours ? '判绿' : '判红') + '）');
        } else {
          console.log('      OK 与真 Node 一致：' + c.label +
                      ' ⇒ ' + (nodeOk ? '成立' : '不成立'));
        }
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  })();

  /* ---------- 空星号 ----------
     🔴 实测：`exports {"./a*": "./dist/*.js"}` + 子路径 `a` ⇒
        ERR_PACKAGE_PATH_NOT_EXPORTED —— Node 在**键**这一侧就拒绝了空匹配。
     ⚠️ 本门禁判的是「这个通配导出**是否存在某个**可用子路径」，
        不模拟「某个**具体**子路径能不能解析」（后者由 entry-resolve.js 用
        真解析器逐个验）。所以键侧的空匹配不在本判据的射程内，
        这里只钉住**目标**一侧的规则：`*` 不许匹配空串。
        两侧口径一致 ⇒ 不会出现"目标允许空、键不允许"的口径错位。 */
  (function () {
    var empties = [
      ['dist/*.js', 'dist/.js'],
      ['dist/*/*.js', 'dist//a.js'],
      ['*', ''],
      ['a*/b', 'a/b']
    ];
    var leaked = [];
    empties.forEach(function (pair) {
      if (pkgTarget.starValue(pair[0], pair[1]) !== null) leaked.push(pair[0] + ' ⇐ ' + pair[1]);
    });
    if (leaked.length) {
      bad++;
      console.log('      X 空星号被判成命中（Node 不接受）：' + leaked.join('；'));
    } else {
      console.log('      OK 空星号不算命中：`*` 必须匹配至少一个字符（与 Node 键侧口径一致）');
    }
  })();

  /* ---------- HTML 词法：引号里的 `>` 不许截断标签 ---------- */
  expect('反：属性值里有 `>` 时，后面的 src 仍要判出来（旧实现被截断 ⇒ 假绿）',
    { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<img data-label="a > b" src="gone.png">' }), true);

  expect('不误报：属性值里有 `>` 且文件都在', { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<img data-label="a > b" src="a.png">', 'demo/a.png': '' }), false);

  expect('不误报：<script> 内容里的伪标签不算引用', { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<script>var s = \'<img src="gone.png">\';</script>' }), false);

  /* ---------- <base href> ---------- */
  expect('反：<base> 指向包外 ⇒ 相对引用无法静态判定，fail-closed',
    { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<base href="https://cdn.example/">' +
                          '<link rel="stylesheet" href="x.css">' }), true);

  expect('不误报：相对 <base href="sub/"> 下的引用按 sub/ 解析',
    { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<base href="sub/"><link rel="stylesheet" href="x.css">',
           'demo/sub/x.css': '' }), false);

  expect('反：有 <base href="sub/"> 时，HTML 同级的 x.css **不算**命中',
    { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<base href="sub/"><link rel="stylesheet" href="x.css">',
           'demo/x.css': '' }), true);

  /* ---------- srcset 语法：data URI 里的逗号不是候选分隔符 ---------- */
  expect('不误报：srcset 里 data URI 的逗号不该被当成候选分隔（旧实现假红）',
    { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<img src="a.png" ' +
                          'srcset="data:image/png;base64,AAAA 1x, a.png 2x">',
           'demo/a.png': '' }), false);

  expect('反：srcset 第二个候选真的缺失', { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<img src="a.png" srcset="a.png 1x, gone.png 2x">',
           'demo/a.png': '' }), true);

  /* ---------- 导航链接：判，但判据比资源引用宽松一档 ---------- */
  expect('反：<a href> 指向包内不存在的文件', { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<a href="gone.html">x</a>' }), true);

  expect('不误报：<a href> 指向目录（浏览器会找 index）', { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<a href="sub/">x</a>', 'demo/sub/index.html': '' }), false);

  expect('不误报：<a href> 省略 .html', { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<a href="other">x</a>', 'demo/other.html': '' }), false);

  expect('不误报：<a href="#x"> 与 mailto:/javascript: 都不是本地引用',
    { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<a href="#x">1</a><a href="mailto:a@b.c">2</a>' +
                          '<a href="javascript:void(0)">3</a>' }), false);

  expect('反：form[action] 指向不存在的本地端点', { name: 'agentcss', exports: {} },
    base({ 'demo/a.html': '<form action="/api/gone"></form>' }), true);

  /* ---------- exports 目标形状（R3-3） ---------- */
  expect('反：exports 目标不带 ./（Node 抛 ERR_INVALID_PACKAGE_TARGET）',
    { name: 'agentcss', exports: { './i': 'index.html' } }, base(), true);

  expect('反：exports 目标含 .. 段', {
    name: 'agentcss', exports: { './i': './../outside.js' }
  }, base(), true);

  return bad;
}

/* ==========================================================================
 * ④ 入口
 * ========================================================================*/
/**
 * 校验 `npm pack --dry-run --json` 的输出结构，返回文件清单。
 *
 * 🔴 npm 只承诺"有 --json"，**没有承诺 schema 跨版本稳定**。
 *    原来直接 `parsed[0].files.map(f => f.path)`：
 *    结构一变就是 `TypeError: Cannot read properties of undefined`，
 *    而报错信息对"哪里变了"毫无帮助。这里显式校验并给出可诊断的原因。
 */
function readPackList(parsed) {
  function bad(msg) { return { list: [], errors: [msg], meta: {} }; }
  if (!Array.isArray(parsed)) {
    return bad('npm 输出顶层不是数组（实际 ' + Object.prototype.toString.call(parsed) + '）');
  }
  if (parsed.length === 0) return bad('npm 输出是空数组：一个包都没打出来');
  var p0 = parsed[0];
  if (!p0 || typeof p0 !== 'object') return bad('parsed[0] 不是对象');
  if (!Array.isArray(p0.files)) {
    return bad('parsed[0].files 不是数组（实际 ' + typeof p0.files + '）');
  }
  if (p0.files.length === 0) {
    return bad('parsed[0].files 是空数组：files 白名单把一切都排除了？');
  }
  var list = [];
  var errs = [];
  p0.files.forEach(function (f, i) {
    if (!f || typeof f !== 'object' || typeof f.path !== 'string' || !f.path) {
      errs.push('files[' + i + '] 没有字符串 path 字段');
      return;
    }
    list.push(f.path);
  });
  return {
    list: list,
    errors: errs,
    meta: { name: p0.name, version: p0.version, id: p0.id, entryCount: p0.entryCount }
  };
}

function main(argv) {
  var dirArg = null;
  var i = argv.indexOf('--dir');
  if (i >= 0) dirArg = argv[i + 1];

  console.log('  === 包内闭包门禁（消费者真正收到的东西）===');
  console.log('');

  var pkg;
  var vfs;
  if (dirArg) {
    console.log('  清单来源：目录 ' + dirArg);
    pkg = JSON.parse(fs.readFileSync(path.join(dirArg, 'package.json'), 'utf8'));
    vfs = vfsFromDir(path.resolve(dirArg));
  } else {
    var env = {};
    Object.keys(process.env).forEach(function (k) { env[k] = process.env[k]; });
    /* `npm publish --dry-run` 会把 `npm_config_dry_run=true` 写进环境变量，
       子进程全部继承 ⇒ npm pack 不产出清单。发布预演时必须清掉。 */
    delete env.npm_config_dry_run;

    var r = cp.spawnSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: ROOT, encoding: 'utf8', env: env, shell: true
    });
    if (r.status !== 0) {
      console.log('  [1] 取包内清单');
      console.log('      X `npm pack --dry-run --json` 跑不起来（exit ' + r.status + '）');
      console.log('        ⇒ 这不是"检查不通过"，是清单来源没拿到；不许当通过。');
      return 1;
    }
    var parsed;
    try {
      parsed = JSON.parse(r.stdout);
    } catch (e) {
      console.log('  [1] 取包内清单');
      console.log('      X npm 输出的不是 JSON：' + String(r.stdout).slice(0, 120));
      return 1;
    }
    pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

    var got = readPackList(parsed);
    if (got.errors.length) {
      console.log('  [1] 取包内清单');
      got.errors.slice(0, 5).forEach(function (e) { console.log('      X ' + e); });
      console.log('        ⇒ 清单结构不认识。这不是"检查不通过"，是清单没读出来 ——');
      console.log('          npm 换了 --json 结构时应当先修本门禁，而不是让它变成 TypeError。');
      return 1;
    }
    if (got.meta.name && got.meta.name !== pkg.name) {
      console.log('  [1] 取包内清单');
      console.log('      X npm 打出的是 `' + got.meta.name + '`，仓库 package.json 是 `' +
                  pkg.name + '`');
      console.log('        ⇒ 判错了对象，后面的结论一律无效。');
      return 1;
    }
    var list = got.list;
    console.log('  清单来源：npm pack --dry-run（' + list.length + ' 个文件' +
                (got.meta.version ? '，' + got.meta.name + '@' + got.meta.version : '') + '）');
    vfs = vfsFromPackList(list);
  }
  console.log('');

  var out = checkClosure(pkg, vfs);
  var s = out.stats;
  /* 每段单独判，不许用"总问题数"当所有段的前缀 ——
     否则 [3] 出问题会让 [2][4] 一起显示 X，看的人分不清是哪一段坏了。 */
  function bad(section) {
    return out.problems.filter(function (p) { return p.s === section; }).length;
  }

  console.log('  [1] 根入口（exports["."] 必须落在包内）');
  var root = (pkg.exports && pkg.exports['.']) || null;
  var rootTarget = null;
  if (typeof root === 'string') rootTarget = root;
  else if (root && typeof root === 'object') {
    rootTarget = root.default || root.import || root.require || null;
  }
  if (rootTarget) {
    var st = targetStatus(rootTarget, vfs);
    console.log('      ' + (st.ok ? 'OK ' : 'X  ') + '. → ' + rootTarget +
                (st.ok ? '' : '（' + st.why + '）'));
  } else {
    console.log('      ! 未声明 exports["."]（不算错，但包根导入行为未定义）');
  }

  console.log('  [2] exports 全部形态（字符串 / 条件 / 嵌套 / 数组 / 通配）');
  console.log('      ' + (bad('exports') ? 'X  ' : 'OK ') +
              '精确 ' + s.exact + ' 条、通配 ' + s.wildcard + ' 条，逐条判定');

  console.log('  [3] 随包 HTML 的本地引用');
  console.log('      ' + (bad('html') ? 'X  ' : 'OK ') +
              s.html + ' 个 HTML、' + s.refs + ' 条资源引用 + ' + s.nav +
              ' 条导航链接（引号感知 tokenizer；单/双/无引号 + srcset + poster + ' +
              'object[data] 都算；根相对按包根判；<base> 参与基准）');
  if (s.base) {
    console.log('      ! 本包有 ' + s.base + ' 个页面声明了 <base href>，' +
                '这些页面的相对引用按 base 解析');
  }
  if (s.exempt) {
    console.log('      ! 已知豁免 ' + s.exempt + ' 条导航链接（指向 **不发布** 的开发目录，' +
                '逐条登记在 KNOWN_DEV_ONLY_NAV；装到 node_modules 里点开是 404，属已登记取舍）');
  }

  console.log('  [4] 文档里给使用者的路径');
  console.log('      ' + (bad('docs') ? 'X  ' : 'OK ') +
              s.docRefs + ' 条 node_modules/' + pkg.name + '/… 引用');

  if (out.problems.length) {
    console.log('');
    console.log('  🔴 声明了但包里没有：');
    out.problems.slice(0, 20).forEach(function (p) { console.log('      · ' + p.t); });
    if (out.problems.length > 20) {
      console.log('      …还有 ' + (out.problems.length - 20) + ' 条');
    }
    console.log('');
    console.log('  => 用户装到的东西与声明不一致（' + out.problems.length + ' 处）');
    return 1;
  }

  console.log('');
  console.log('  ⇒ 静态引用闭合：包内 ' + s.files + ' 个文件；exports / 类型 / main 等字段 /' +
              ' HTML 引用 / 文档路径全部落在包内' +
              (s.exempt ? '（导航链接另有 ' + s.exempt + ' 条已登记豁免）' : '') + '。');
  console.log('  ! 这只覆盖**静态引用**。未验证的三项：');
  console.log('    · data-* 运行时配置引用的资源（如 model-viewer 的 vendor/）；');
  console.log('    · CSS 文档里的 url() 与 @import（另一类文档，需单独一道按 CSS 语法判）；');
  console.log('    · 入口能否被消费者的 import/require 真正解析（由 entry-resolve.js 判）。');
  console.log('    ⇒ 别把这一行读成"包内一切与声明一致"。');
  return 0;
}

if (require.main === module) {
  var argv = process.argv.slice(2);
  if (argv.indexOf('--selftest') >= 0) {
    var bad = selftest();
    console.log('');
    console.log('  ' + (bad ? '🔴 ' + bad + ' 条判据自检未通过'
                             : '自检全部通过 ⇒ 判据有鉴别力、也不误报'));
    process.exit(bad ? 1 : 0);
  }
  process.exit(main(argv));
}

module.exports = {
  walkExports: walkExports,
  checkClosure: checkClosure,
  htmlRefs: htmlRefs,
  tokenizeTags: tokenizeTags,
  parseSrcset: parseSrcset,
  collectRefs: collectRefs,
  targetStatus: targetStatus,
  patternToRegExp: patternToRegExp,
  readPackList: readPackList
};
