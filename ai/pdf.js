/*
 * pdf.js — HTML → PDF 导出。零运行时依赖（不需要 puppeteer，也不需要联网）。
 *
 * ============================================================================
 * 🔴 为什么导出器在**这里**，而不是在组件库里
 * ============================================================================
 * `@page` 是**文档级决定**：纸多大、边距多少，取决于"这份东西要交给谁"，
 * 不取决于某个按钮长什么样。库一旦在 `tokens.css` 里声明 `@page`，
 * 使用者的边距控制会**静默失效**（实测同一份页面：943 runs vs 978 runs，
 * 只是多了一条 `@page` 规则）。所以：
 *
 *   组件库  → `@media print` 里的**行为**（隐藏什么、展开什么、不跨页切断）
 *   导出器  → `@page` 里的**版式**（纸幅、边距）
 *
 * 这条分工不是偏好：谁声明 `@page`，谁就接管了使用者的边距控制。
 * 所以它只能由"产出这份文件的人"给 —— 这正是本文件存在的理由。
 *
 * ============================================================================
 * 🔴 为什么用 Chrome 的命令行，而不是 puppeteer
 * ============================================================================
 * 本库的承诺是**零运行时依赖**（package.json 里 dependencies 是空的）。
 * 为了一个"5% 的人才会用"的导出功能塞一个 ~300 MB 的浏览器包，
 * 等于让 95% 的人为 5% 的人付安装代价 —— 那是这条承诺唯一的实质内容。
 *
 * 所以：`--print-to-pdf` 走使用者**已经装好的** Chrome/Chromium/Edge。
 * 找不到就**明确报错**（`no-chrome`），绝不静默降级成一个空文件。
 *
 * ============================================================================
 * ⚠️ 一条必须写下来的观测差异
 * ============================================================================
 * 本工具产出的 PDF **包含底色**（headless 打印的默认行为，实测：
 * `.bg{background:#1b4d8f}` 在内容流里是 `.1059 .302 .5608 rg … re f`），
 * 而浏览器打印对话框默认**不勾**"背景图形"。
 *
 * ⇒ 同一份页面，「导出」与「Ctrl+P」在**彩色块**上观感不同：
 *   导出里白字压深蓝可读；对话框里底色被丢弃、白字会被压成 #ABABAB。
 *   两者不是谁错了，是两个产品。`docs/PRINT.md` §八 写了这件事。
 *
 * 用法：
 *   const { exportPdf } = require('./pdf');
 *   const r = exportPdf({ src: 'page.html', out: 'page.pdf', paper: 'a4',
 *                         margin: '18mm 15mm', budget: 8 });
 *   if (!r.ok) …  // r.code ∈ usage|no-chrome|render|timeout|over-budget|unreadable
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const pages = require('./pdf-pages');

/* 纸幅。CSS 的 `size` 关键字就够，不需要自己换算 pt ——
   换算过的地方迟早和引擎的取整方式差 0.28pt，然后有人拿它当"回归"。 */
const PAPERS = {
  a3: { css: 'A3', w: 841.89, h: 1190.55 },
  a4: { css: 'A4', w: 595.28, h: 841.89 },
  a5: { css: 'A5', w: 419.53, h: 595.28 },
  letter: { css: 'Letter', w: 612, h: 792 },
  legal: { css: 'Legal', w: 612, h: 1008 },
};

const DEFAULT_PAPER = 'a4';
/* 18mm/15mm 是"文档"而不是"网页"的常见留白；12mm/10mm 是浏览器默认量级。
   两者都不神圣 —— 关键是**由导出方显式给出**，不是由库偷偷定。 */
const DEFAULT_MARGIN = '18mm 15mm';

/* ============================================================================
 * Chrome 定位
 * ============================================================================
 * ⚠️ 这张表与 `05-audit/browser.js` 的候选表**有意重复**：那一份要给
 *    puppeteer 用，还要认 Playwright 的缓存目录与引擎参数；这一份要能
 *    跟着包发到使用者机器上、不许 require 任何东西。两边的共同判据只有一条：
 *    **找不到就明确报错，不许静默降级**。
 *    漂移由 `05-audit/pdf-export-gate.js` 的 E8 交叉核对（两边都找到时必须是同一个文件）。
 */
function chromeCandidates() {
  const out = [];
  if (process.env.AGENTCSS_CHROME) out.push(process.env.AGENTCSS_CHROME);
  if (process.env.CHROME_PATH) out.push(process.env.CHROME_PATH);
  if (process.env.CHROME_BIN) out.push(process.env.CHROME_BIN);
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    out.push(
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      local && path.join(local, 'Google/Chrome/Application/chrome.exe'),
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe');
  } else if (process.platform === 'darwin') {
    out.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    out.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium');
  }
  /* CI 上没有系统 Chrome：Playwright 装的那份也得认，否则"能导出"只在开发机上成立 */
  for (const root of [path.join(os.homedir(), '.cache/ms-playwright'),
    path.join(os.homedir(), 'Library/Caches/ms-playwright')]) {
    let names;
    try { names = fs.readdirSync(root); } catch (e) { continue; }
    for (const n of names) {
      if (!/^chromium/.test(n)) continue;
      for (const rel of ['chrome-linux/chrome',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        'chrome-win/chrome.exe', 'chrome-linux/headless_shell']) {
        out.push(path.join(root, n, ...rel.split('/')));
      }
    }
  }
  return out.filter(Boolean);
}

/**
 * @param {string} [explicit] 显式路径（`--chrome=`）
 * @param {object} [opts]     `{candidates}` —— **只为可测性**留的口子：
 *   没有它，"一个浏览器都没有"这条报错就只能靠"这台机器恰好没装 Chrome"才验证得了，
 *   而有 Chrome 的开发机上它**永远测不到**（与 validate.js 的 `opt.components` 同一个理由）。
 * @returns {{path:string, source:string}|{error:string}}
 */
function resolveChrome(explicit, opts) {
  if (explicit) {
    /* 显式给了却不存在 ⇒ 立刻报错。悄悄回落到自动探测会让"我明明指定了它"
       变成一句谎话，而且失败现场看起来像是"这个 Chrome 不能打印"。 */
    if (!fs.existsSync(explicit)) {
      return { error: '--chrome 指定的文件不存在：' + explicit
        + '\n  这里要的是 Chrome / Chromium / Edge 的**可执行文件**路径。' };
    }
    return { path: explicit, source: 'explicit' };
  }
  const list = (opts && opts.candidates) || chromeCandidates();
  for (const p of list) {
    try { if (fs.existsSync(p)) return { path: p, source: 'auto' }; } catch (e) { /* 下一个 */ }
  }
  return {
    error: '找不到 Chrome / Chromium / Edge。\n'
      + '  用法：--chrome="C:/Program Files/Google/Chrome/Application/chrome.exe"\n'
      + '  或设环境变量 AGENTCSS_CHROME / CHROME_PATH。\n'
      + '  本工具不打包浏览器：为了 5% 的导出需求让 95% 的人多装 300 MB，不值。',
  };
}

/* ============================================================================
 * 版式
 * ============================================================================ */

/** `18mm` / `18mm,15mm` / `18mm 15mm` / 四段 → CSS margin 简写。非法则返回 null。 */
function normalizeMargin(v) {
  if (v === undefined || v === null || v === '') return DEFAULT_MARGIN;
  const parts = String(v).trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length < 1 || parts.length > 4) return null;
  for (const p of parts) {
    if (!/^\d+(\.\d+)?(mm|cm|in|pt|px)$/.test(p)) return null;
  }
  return parts.join(' ');
}

function paperSpec(name) {
  const k = String(name || DEFAULT_PAPER).toLowerCase();
  return PAPERS[k] ? { key: k, ...PAPERS[k] } : null;
}

/** 注入到 `<head>` 末尾（**必须在使用者样式之后**，否则同特异性被覆盖 —— E254）。 */
function injectSheet(html, css) {
  const style = '<style id="agentcss-paper" data-agentcss="paper">' + css + '</style>';
  if (/<\/head\s*>/i.test(html)) return html.replace(/<\/head\s*>/i, style + '</head>');
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, '$&' + style);
  return style + html;
}

function cssFor(spec, margin) {
  return '@page{size:' + spec.css + ';margin:' + margin + '}';
}

/* ============================================================================
 * 导出
 * ============================================================================ */

function isRemote(src) {
  return /^https?:\/\//i.test(src);
}

/**
 * @param {object} o
 * @param {string} o.src            本地 HTML 路径，或 http(s) URL
 * @param {string} o.out            输出 PDF 路径（父目录不存在会创建）
 * @param {string} [o.paper]        a3|a4|a5|letter|legal（默认 a4）
 * @param {string} [o.margin]       CSS margin 简写（默认 18mm 15mm）
 * @param {number} [o.budget]       页数上限；超了返回 over-budget
 * @param {string} [o.chrome]       Chrome 可执行文件
 * @param {number} [o.timeoutMs]
 * @returns {object} `{ok:true, ...}` 或 `{ok:false, code, message, ...}`
 */
function exportPdf(o) {
  o = o || {};
  const t0 = Date.now();
  if (!o.src) return { ok: false, code: 'usage', message: '缺少 src' };
  if (!o.out) return { ok: false, code: 'usage', message: '缺少 out' };

  const spec = paperSpec(o.paper);
  if (!spec) {
    return { ok: false, code: 'usage',
      message: '未知纸幅 ' + JSON.stringify(o.paper) + '（可用：'
        + Object.keys(PAPERS).join(' / ') + '）' };
  }
  const margin = normalizeMargin(o.margin);
  if (!margin) {
    return { ok: false, code: 'usage',
      message: '边距写法不认识：' + JSON.stringify(o.margin)
        + '（要 CSS 简写，例：18mm 或 "18mm 15mm"）' };
  }
  if (o.budget !== undefined && o.budget !== null) {
    const b = Number(o.budget);
    if (!Number.isInteger(b) || b < 1) {
      /* ⚠️ 用 String() 而不是 JSON.stringify：`JSON.stringify(NaN)` 是 `"null"`，
         于是 `--max-pages=abc` 会报「收到 null」—— 使用者据这句话会去查一个
         根本不存在的 null（实测踩过，见 E264）。 */
      return { ok: false, code: 'usage',
        message: '--max-pages 必须是 ≥1 的整数，收到 ' + String(o.budget) };
    }
  }

  const chrome = resolveChrome(o.chrome);
  if (chrome.error) return { ok: false, code: 'no-chrome', message: chrome.error };

  const outAbs = path.resolve(o.out);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });

  /* 本地文件才注入 @page：远程页面我们拿不到它的字节，硬注入等于假装改了它。 */
  let target = o.src;
  let tmpHtml = null;
  if (!isRemote(o.src)) {
    const srcAbs = path.resolve(o.src);
    if (!fs.existsSync(srcAbs)) {
      return { ok: false, code: 'usage', message: '找不到输入文件：' + srcAbs };
    }
    const html = fs.readFileSync(srcAbs, 'utf8');
    /* ⚠️ 临时文件必须落在**同一个目录**：换成系统临时目录，页面里的
       `./tokens.css` / `/02-primitives/...` 会全部 404，而产物看起来"只是没样式"。 */
    tmpHtml = path.join(path.dirname(srcAbs),
      '.agentcss-print-' + process.pid + '-' + Date.now().toString(36) + '.html');
    fs.writeFileSync(tmpHtml, injectSheet(html, cssFor(spec, margin)), 'utf8');
    target = pathToFileURL(tmpHtml).href;
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcss-chrome-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    /* 每次一个新 profile：使用者可能正开着 Chrome，共用 profile 会抢锁 */
    '--user-data-dir=' + profile,
    /* 页眉页脚（日期 / 标题 / 1/2）默认是开的，必须显式关掉 */
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    '--print-to-pdf=' + outAbs,
    target,
  ];
  /* 容器里以 root 跑才需要关沙箱 —— 默认不开，也不替使用者决定 */
  if (process.env.AGENTCSS_NO_SANDBOX === '1') args.unshift('--no-sandbox');

  let res;
  try {
    res = spawnSync(chrome.path, args, {
      timeout: o.timeoutMs || 60000,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } finally {
    /* 清理必须**同步**做完：CLI 随后就 process.exit，挂一个 setTimeout
       等于每次导出都在系统临时目录里留一个 Chrome profile（实测漏了 6 个才发现）。
       删不掉不算错（Windows 上偶发 EBUSY），但不能因为删不掉就不删。 */
    if (tmpHtml) { try { fs.unlinkSync(tmpHtml); } catch (e) { /* 已删 */ } }
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); }
    catch (e) { /* 交给系统清理 */ }
  }

  const ms = Date.now() - t0;
  const stderr = String((res && res.stderr) || '').slice(-800);
  if (res && res.error && res.error.code === 'ETIMEDOUT') {
    return { ok: false, code: 'timeout', message: 'Chrome 在 '
      + Math.round((o.timeoutMs || 60000) / 1000) + 's 内没有结束（页面可能有死循环或等待网络）', ms };
  }
  if (!fs.existsSync(outAbs)) {
    return { ok: false, code: 'render', ms,
      message: 'Chrome 没有产出文件（退出码 ' + (res ? res.status : '?') + '）'
        + (stderr ? '\n  ' + stderr.trim().split('\n').slice(-4).join('\n  ') : '') };
  }

  const buf = fs.readFileSync(outAbs);
  if (buf.length < 5 || buf.slice(0, 5).toString('latin1') !== '%PDF-') {
    return { ok: false, code: 'render',
      message: '产出的文件不是 PDF（' + buf.length + ' 字节）—— 通常是页面加载失败', ms };
  }

  const info = pages.inspect(buf);
  const injected = !isRemote(o.src);
  const base = {
    out: outAbs, bytes: buf.length, pdf: buf, ms,
    /* 远程页面没注入 @page ⇒ `paper` 只能是 null：报 "a4" 是在陈述一个
       没有发生的事实（实测远程导出是 612×792）。真实纸幅看 `mediaBox`。 */
    paper: injected ? spec.key : null,
    margin: injected ? margin : null, chrome: chrome.path,
    pages: info.pages, mediaBox: info.mediaBox,
    injected: injected,
  };

  /* 页数两套说法不一致 ⇒ 不判预算，也不假装通过 */
  if (!info.agree && o.budget !== undefined && o.budget !== null) {
    return { ...base, ok: false, code: 'unreadable',
      message: 'PDF 里 `/Type /Page` 数出 ' + info.pages + ' 页、页树 `/Count` 说 '
        + info.countFromTree + ' 页 —— 两套说法不一致，无法判定预算' };
  }

  if (o.budget !== undefined && o.budget !== null && info.pages > o.budget) {
    return { ...base, ok: false, code: 'over-budget', budget: Number(o.budget),
      message: overBudgetMessage(info.pages, Number(o.budget), spec, margin, outAbs,
        info.mediaBox, !isRemote(o.src)) };
  }
  return { ...base, ok: true,
    budget: (o.budget === undefined || o.budget === null) ? null : Number(o.budget) };
}

/* 报错要**可执行**：三条出路 + 一条"我不代做"的说明。
   为什么不实现 truncate：截断 = 静默丢内容，正是这套门禁在防的事。
   一个会替你悄悄删掉后半份报告的工具，比一个报错停下的工具危险得多。 */
function overBudgetMessage(got, budget, spec, margin, out, box, injected) {
  const size = box ? (Math.round(box.width) + '×' + Math.round(box.height) + 'pt') : '?';
  /* 远程页面没注入 @page ⇒ 纸幅与边距都不是我们给的。
     这时报"A4 / 18mm 15mm"是在描述一个不存在的事实（实测：远程导出是 612×792，
     而参数写着 a4）—— 报错里写错事实，比不写更误导。 */
  const layout = injected
    ? '（' + spec.css + '，' + size + '，边距 ' + margin + '）'
    : '（页面自定义纸幅，实测 ' + size + '；未注入 @page，--paper/--margin 不生效）';
  return '超出页数预算：' + got + ' 页 > ' + budget + ' 页' + layout + '\n'
    + '  产出文件保留在：' + out + '\n'
    + '  三条出路（按代价从低到高）：\n'
    + '   ① 拆文档   把一章拆成单独文件分别导出：agentcss pdf chapter-2.html --out ch2.pdf\n'
    + '   ② 进附录   明细移到附录，正文只留汇总 —— 需要作者改内容，不是换个参数\n'
    + '   ③ 截断     **本工具不代做**。静默丢内容正是这套判据在防的事；\n'
    + '              真要截断，请删掉要丢的段落再导出（这样它会出现在 diff 里）\n'
    + '  确认预算定低了，就调高它：--max-pages=' + Math.max(got, budget);
}

module.exports = {
  exportPdf, resolveChrome, normalizeMargin, paperSpec, PAPERS,
  DEFAULT_PAPER, DEFAULT_MARGIN,
};
