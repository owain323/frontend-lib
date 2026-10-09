#!/usr/bin/env node
/*
 * workflow-gate.js — CI 工作流配置的门禁
 *
 * ============================================================================
 * 🔴 为什么需要这道门禁（2026-10-09 外部评审实测驱动）
 * ----------------------------------------------------------------------------
 *   `.github/workflows/gate.yml` 里躺着这样一行：
 *
 *       timeout-minutes: 6# 兜底：卡住就掐掉，不烧额度
 *
 *   YAML 规范：**注释标记 `#` 必须与前面的内容由空白分隔。**
 *   少了那个空格，`#` 就不是注释起始符，
 *   于是 `timeout-minutes` 的值变成字符串 `"6# 兜底：…"` 而不是整数 6。
 *
 *   ⚠️ 这行的危害不在"格式不好看"，而在于它**伪装成了一句注释**：
 *     人读的时候它看起来就是"6 分钟 + 一句说明"，
 *     机器读的时候它是一个非法的整数。
 *     ⇒ 读者与机器的理解**分叉**了，而分叉点肉眼不可见。
 *
 *   本库自己的纪律里有一条「正则不是解析器」（I-10 近亲）：
 *   想可靠地发现这类问题，**必须真的去解析 YAML**，不能靠正则扫 `#`。
 *
 * ============================================================================
 * 判据（每条都配反向控制，证明它会红）
 * ----------------------------------------------------------------------------
 *   ① 每个 workflow 必须能被**真 YAML 解析器**解析，且失败要报出行号
 *   ② 每个 job 必须有 `timeout-minutes`，且解析后是**整数**
 *      （正是上面那个坑；字符串 / 缺失 / 布尔都算红）
 *   ③ `run:` 步骤里引用的脚本路径必须**真实存在**
 *      ⚠️ 理由：CI 上写错一个脚本名，最坏情况是那道门禁**从未被执行过**，
 *         而 workflow 依然绿 —— 与"门禁没接进链"是同一类假绿。
 *   ④ 每个 job 必须先装依赖（`npm ci` / `npm install`）
 *      ⚠️ 本库自己的注释已写明这是必须的（锁文件可复现性从未被验证过的事故）
 *
 * ============================================================================
 * 用法
 * ----------------------------------------------------------------------------
 *   node 05-audit/workflow-gate.js              # 检查仓库里的 workflow
 *   node 05-audit/workflow-gate.js --selftest   # 反向控制（每条判据必须会红）
 * ============================================================================
 */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.dirname(__dirname);
var WF_DIR = path.join(ROOT, '.github', 'workflows');

/* 🔴 环境缺失 ⇒ SKIP，不许报"通过"（宪法第 4 条）。
     缺 yaml 包时若直接 return 0，就等于"没检查 = 没问题"。 */
var YAML;
try {
  YAML = require('yaml');
} catch (e) {
  process.stdout.write('  SKIP  workflow-gate：缺少 yaml 解析包（npm ci 后会装）\n');
  process.stdout.write('        ⇒ 没有真解析器就不做 YAML 判据，绝不退化成正则\n');
  process.exit(0);
}

var SCRIPT_EXT = /\.(py|js|mjs|cjs|sh)$/;

/**
 * 从一段 shell 里抽出"看起来像仓库内脚本路径"的 token。
 * ⚠️ 只是**候选提取**，判据是后面的 fs.existsSync ——
 *    误报由 existsSync 兜住，不是靠正则写得更聪明。
 */
function scriptRefs(runText) {
  var text = String(runText);
  var out = [];
  var re = /[A-Za-z0-9_.][A-Za-z0-9_./\\-]*\.(py|js|mjs|cjs|sh)\b/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    /* 🔴 判据不是"长得像路径"，而是「**独立参数**且**不含运行时拼接**」。
       两条缺一不可（都是实测踩出来的误报）：
         · `"05-audit/${c}-check.js"` 割出来的 `check.js` 前有 `-`
           ⇒ 它是 shell 变量拼出来的，静态判不了，跳过；
         · 前面是引号/空白才算一个真正的命令行参数。
       ⚠️ 宁可**漏判**也不误判：误判会让 CI 绿不了，是最烦人的假红。 */
    var prev = m.index > 0 ? text[m.index - 1] : '\n';
    if (!/[\s"'|&;(\n]/.test(prev)) continue;
    var t = m[0];
    if (t.indexOf('$') >= 0 || t.indexOf('{{') >= 0) continue;
    out.push(t);
  }
  return out;
}

/** 解析一个目录下的所有 workflow 文件。 */
function parseDir(dir) {
  var names;
  try {
    names = fs.readdirSync(dir).filter(function (n) {
      return /\.ya?ml$/.test(n);
    });
  } catch (e) {
    return { files: [], fatal: '读不到目录：' + dir };
  }
  var files = [];
  names.forEach(function (n) {
    var text = fs.readFileSync(path.join(dir, n), 'utf8');
    var rec = { name: n, text: text, doc: null, err: null };
    try {
      rec.doc = YAML.parse(text);
    } catch (e) {
      /* ⭐ 真解析器会给出行列 —— 报错必须带上，否则使用者要自己找 */
      rec.err = {
        msg: e.message,
        line: (e.linePos && e.linePos[0] && e.linePos[0].line) || null,
      };
    }
    files.push(rec);
  });
  return { files: files, fatal: null };
}

/** 核心判据。返回 { errs:[], oks:[] } —— 纯函数，便于反向控制造突变体。 */
function check(dir) {
  var errs = [];
  var oks = [];
  var parsed = parseDir(dir);

  if (parsed.fatal) {
    errs.push('读不到 workflow 目录：' + parsed.fatal);
    return { errs: errs, oks: oks };
  }
  if (!parsed.files.length) {
    /* 🔴 视野为空 ⇒ 不许算通过（与 scannable_files 那次事故同源） */
    errs.push('扫到 0 个 workflow 文件 ⇒ 这份"通过"不作数（门禁视野已空）');
    return { errs: errs, oks: oks };
  }

  parsed.files.forEach(function (f) {
    /* ① 真解析 */
    if (f.err) {
      errs.push('%s 不是合法 YAML（第 %s 行）：%s'.replace('%s', f.name)
        .replace('%s', f.err.line === null ? '?' : String(f.err.line))
        .replace('%s', f.err.msg));
      return;
    }
    var doc = f.doc;
    if (!doc || typeof doc !== 'object') {
      errs.push(f.name + '：解析结果不是一个映射');
      return;
    }
    var jobs = doc.jobs;
    if (!jobs || typeof jobs !== 'object') {
      errs.push(f.name + '：没有 jobs');
      return;
    }
    oks.push(f.name + ' 是合法 YAML');

    Object.keys(jobs).forEach(function (jid) {
      var job = jobs[jid] || {};
      var tag = f.name + ' › ' + jid;

      /* ② timeout-minutes 必须是整数 */
      var tm = job['timeout-minutes'];
      if (tm === undefined) {
        errs.push(tag + '：没有 timeout-minutes（卡住时会一直烧额度）');
      } else if (typeof tm !== 'number' || !isFinite(tm) || tm <= 0) {
        /* ⭐ 这条就是本门禁存在的理由：值被 `#` 吞成了字符串 */
        errs.push(tag + '：`timeout-minutes` 解析后是 ' + typeof tm +
          '（' + JSON.stringify(tm) + '），不是整数' +
          ' ⇒ 很可能是 `#` 前少了空格');
      } else {
        oks.push(tag + ' 超时 ' + tm + ' 分钟');
      }

      /* ③ run 步骤引用的脚本必须存在 */
      var steps = job.steps || [];
      if (!Array.isArray(steps)) steps = [];
      var seenScript = false;
      steps.forEach(function (st) {
        if (!st || typeof st.run !== 'string') return;
        scriptRefs(st.run).forEach(function (ref) {
          if (!SCRIPT_EXT.test(ref)) return;
          /* run 里的路径是**仓库相对路径**（CI 的工作目录就是仓库根） */
          var p = path.join(ROOT, ref);
          if (!fs.existsSync(p)) {
            errs.push(tag + '：run 里引用了不存在的脚本 `' + ref + '`' +
              ' ⇒ 这道门禁在 CI 上根本不会被执行');
          } else {
            seenScript = true;
          }
        });
      });
      if (seenScript) oks.push(tag + ' 引用的脚本都存在');

      /* ④ 必须装依赖 */
      var blob = steps.map(function (st) {
        return (st && (st.run || st.uses)) || '';
      }).join('\n');
      if (!/\bnpm\s+(ci|install)\b/.test(blob)) {
        errs.push(tag + '：没有 `npm ci` / `npm install`' +
          ' ⇒ 「锁文件可复现」这个承诺从未被验证');
      } else {
        oks.push(tag + ' 装了依赖');
      }
    });
  });

  return { errs: errs, oks: oks };
}

function main() {
  process.stdout.write('  === CI 工作流配置（真 YAML 解析，不是正则）===\n\n');
  var r = check(WF_DIR);
  r.oks.forEach(function (s) { process.stdout.write('  [OK]   ' + s + '\n'); });
  if (!r.errs.length) {
    process.stdout.write('\n  ✅ 工作流配置闭环\n');
    return 0;
  }
  process.stdout.write('\n  🔴 工作流配置有问题：\n');
  r.errs.forEach(function (s) { process.stdout.write('     ' + s + '\n'); });
  return 1;
}

/* ==========================================================================
   反向控制：每条判据必须**真的会红**（宪法第 3 条）
   -------------------------------------------------------------------------- */
var GOOD = [
  'name: gate',
  'on: [push]',
  'jobs:',
  '  quick:',
  '    timeout-minutes: 6 # 兜底',
  '    steps:',
  '      - run: npm ci',
  '      - run: python3 05-audit/leak-scan.py',
  '',
].join('\n');

function tmpDirWith(content) {
  var d = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-gate-'));
  var wf = path.join(d, '.github', 'workflows');
  fs.mkdirSync(wf, { recursive: true });
  /* content === null ⇒ 造一个**空**的 workflow 目录（测"视野为空"） */
  if (content !== null) {
    fs.writeFileSync(path.join(wf, 'gate.yml'), content);
  }
  return d;
}

function selftest() {
  var bad = 0;
  function expect(why, content, needle) {
    var d = tmpDirWith(content);
    var r = check(path.join(d, '.github', 'workflows'));
    var hit = needle
      ? r.errs.some(function (e) { return e.indexOf(needle) >= 0; })
      : r.errs.length > 0;
    process.stdout.write('  [' + (hit ? 'OK  ' : 'FAIL') + '] ' + why + '\n');
    if (!hit) {
      bad++;
      process.stdout.write('         没抓到。errs=' + JSON.stringify(r.errs) + '\n');
    }
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }

  /* ⭐ 第一条就是评审发现的那个真实缺陷 —— 必须永远能复现它 */
  expect('`timeout-minutes: 6#注释`（# 前无空格）⇒ 必须红',
    GOOD.replace('timeout-minutes: 6 # 兜底', 'timeout-minutes: 6# 兜底'),
    '不是整数');
  expect('没有 timeout-minutes ⇒ 必须红',
    GOOD.replace('    timeout-minutes: 6 # 兜底\n', ''),
    'timeout-minutes');
  expect('run 引用不存在的脚本 ⇒ 必须红',
    /* ⚠️ 错别字必须用 ASCII：非 ASCII 字符进不了路径正则 ⇒ 突变体根本打不到判据 */
    GOOD.replace('05-audit/leak-scan.py', '05-audit/leak-scan-typo.py'),
    '不存在的脚本');
  expect('没有 npm ci ⇒ 必须红',
    GOOD.replace('      - run: npm ci\n', ''),
    '锁文件可复现');
  expect('缩进错误的坏 YAML ⇒ 必须红',
    'jobs:\n  a:\n    b: 1\n   c: 2\n',
    '不是合法 YAML');
  expect('workflow 目录为空 ⇒ 必须红（不许"扫到 0 个"算通过）',
    null,
    '这份"通过"不作数');

  /* 🔴 反向方向之一：**动态拼出来的脚本名不许误报**
     （`node "05-audit/${c}-check.js"` 是真的存在于仓库 workflow 里的写法） */
  var dDyn = tmpDirWith(GOOD.replace('      - run: python3 05-audit/leak-scan.py',
    '      - run: |\n          for c in select overlay; do\n' +
    '            node "05-audit/${c}-check.js"\n          done'));
  var rDyn = check(path.join(dDyn, '.github', 'workflows'));
  var noFalseAlarm = !rDyn.errs.some(function (e) { return e.indexOf('不存在的脚本') >= 0; });
  process.stdout.write('  [' + (noFalseAlarm ? 'OK  ' : 'FAIL') +
    '] 动态脚本名 `${c}-check.js` ⇒ 不许误报\n');
  if (!noFalseAlarm) {
    bad++;
    process.stdout.write('         ' + JSON.stringify(rDyn.errs) + '\n');
  }
  try { fs.rmSync(dDyn, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }

  /* 反向方向：正常样本必须绿（不许误报） */
  var d = tmpDirWith(GOOD);
  var r = check(path.join(d, '.github', 'workflows'));
  var okGreen = r.errs.length === 0 && r.oks.length > 0;
  process.stdout.write('  [' + (okGreen ? 'OK  ' : 'FAIL') + '] 正常 workflow ⇒ 必须全绿（不误报）\n');
  if (!okGreen) {
    bad++;
    process.stdout.write('         errs=' + JSON.stringify(r.errs) + '\n');
  }
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }

  process.stdout.write('\n' + (bad ? '  ❌ 反向控制有 ' + bad + ' 条没抓到' : '  ✅ 反向控制全绿') + '\n');
  return bad ? 1 : 0;
}

if (require.main === module) {
  if (process.argv.indexOf('--selftest') >= 0) {
    process.exit(selftest());
  }
  process.exit(main());
}

module.exports = { check: check, scriptRefs: scriptRefs };
