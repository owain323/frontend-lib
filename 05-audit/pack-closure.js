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
 * ⚠️ 明确不覆盖（说了不做，比假装覆盖强）
 *
 *   `data-mv-three="vendor/three.min.js"` 这类 **data-* 运行时配置**的
 *   资源：它不在 HTML 的 src/href 里，是点击后才由 JS 读出来注入的。
 *   `09-assets/model-viewer/demo.html` 已用正文声明「包里没有 vendor/ 与
 *   models/，看到降级 UI 是预期行为」。本门禁**不判**它，因为
 *   「声明为外部依赖」和「漏打包」在静态层面长得一模一样，
 *   硬判只会制造假红。⇒ 这一项保留为**未验证**，不记作通过。
 * ==========================================================================*/
'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');

/* ==========================================================================
 * ① 判定核心（纯函数：只依赖一个"文件集"抽象，便于自检里喂假数据）
 * ========================================================================*/

/* npm 永远会带上这三样，哪怕 files 白名单里没写（README/LICENSE 任意扩展名、
 * package.json 本身）。清单里有没有都算"有"，否则会制造假红。 */
var ALWAYS_SHIPPED = { 'package.json': 1, 'readme.md': 1, 'license': 1 };

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

/** 单个导出目标在文件集里是否成立。通配按目录判，不逐字符判。 */
function targetStatus(target, vfs) {
  var t = String(target).replace(/^\.\//, '');
  var star = t.indexOf('*');

  if (star >= 0) {
    /* `./patterns/*` → 目录 `patterns`。
       ⚠️ 不能对带 * 的路径直接 exists()，那永远为假 ⇒ 把正常的通配导出
          误报成缺失（pack-smoke 的老注释里记着这个坑）。 */
    var dir = t.slice(0, star).replace(/\/+$/, '');
    if (dir === '') return { ok: true, kind: 'root-wildcard' };
    if (!vfs.isDir(dir)) return { ok: false, kind: 'wildcard', why: '目标目录不存在' };
    if (vfs.listDir(dir).length === 0) {
      return { ok: false, kind: 'wildcard', why: '目标目录为空' };
    }
    return { ok: true, kind: 'wildcard' };
  }

  if (vfs.exists(t)) return { ok: true, kind: 'exact' };
  return { ok: false, kind: 'exact', why: '文件不存在' };
}

/** HTML 里真正会被浏览器请求的本地引用（不含注释、不含转义后的示例代码）。 */
function htmlRefs(text) {
  var out = [];
  /* 🔴 必须先剥注释。`09-assets/model-viewer/demo.html` 里有一句
     `<!-- 🔴 注意：这里**没有** <script src="three.min.js"> -->`，
     不剥就会被判成"引用了没打包的引擎" —— 一条纯假红。 */
  var clean = text.replace(/<!--[\s\S]*?-->/g, '');
  /* 🔴 也只能认**真标签**。`&lt;script src="echarts.min.js"&gt;` 是文档
     示例（被转义过，没有字面 `<`），用裸正则 `src="…"` 同样会误报。 */
  var tag = /<(script|link|img|source|video|audio|iframe|use)\b([^>]*)>/gi;
  var attr = /\b(?:src|href)\s*=\s*"([^"]*)"/i;
  var m;
  while ((m = tag.exec(clean))) {
    var a = attr.exec(m[2]);
    if (a) out.push(a[1].trim());
  }
  return out;
}

function isExternalRef(u) {
  return !u || u.charAt(0) === '#' || u.charAt(0) === '/' ||
    /^[a-z][a-z0-9+.-]*:/i.test(u) ||      /* http: data: mailto: javascript: */
    u.slice(0, 2) === '//';
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

  /* ---------- C. 随包 HTML 的本地引用 ---------- */
  var htmlN = 0;
  var refN = 0;
  vfs.allFiles().forEach(function (f) {
    if (!/\.html?$/i.test(f)) return;
    htmlN++;
    var text = vfs.read(f);
    htmlRefs(text).forEach(function (u) {
      if (isExternalRef(u)) return;
      var pure = u.split('#')[0].split('?')[0];
      if (!pure) return;
      refN++;
      var tgt = path.posix.normalize(path.posix.join(path.posix.dirname(f), pure));
      if (tgt.slice(0, 2) === '..') {
        problems.push({ s: 'html', t: f + ' 引用 ' + u + '（跑到包外去了）' });
        return;
      }
      if (!vfs.exists(tgt)) {
        problems.push({ s: 'html', t: f + ' 引用 ' + u + ' → ' + tgt + '（不在包内）' });
      }
    });
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
      exact: exact, wildcard: wild, html: htmlN, refs: refN, docRefs: docN,
      files: vfs.allFiles().length
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
        console.log('      OK 目录模式：只含子目录的目标目录算非空（与清单模式同语义）');
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  })();

  return bad;
}

/* ==========================================================================
 * ④ 入口
 * ========================================================================*/
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
    var list = parsed[0].files.map(function (f) { return f.path; });
    console.log('  清单来源：npm pack --dry-run（' + list.length + ' 个文件）');
    pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
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
              s.html + ' 个 HTML、' + s.refs + ' 条本地引用（已剔注释与转义示例）');

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
  console.log('  ⇒ 包内 ' + s.files + ' 个文件与声明一致');
  console.log('  ! 未覆盖：data-* 运行时配置引用的资源（如 model-viewer 的 vendor/）；');
  console.log('    该项保留为**未验证**，不记作通过。');
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

module.exports = { walkExports: walkExports, checkClosure: checkClosure, htmlRefs: htmlRefs };
