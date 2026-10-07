#!/usr/bin/env node
/*
 * check.js — 呈现形态特有的检查（**不属于核心门禁**）
 *
 * ============================================================================
 * 🔴 为什么这些检查不在核心里
 * ----------------------------------------------------------------------------
 * 下面每一条判据都只对一个**呈现形态**成立：
 *   · 单页元素上限 12 —— 换成报告形态这个数就不对
 *   · 版面必须已登记  —— 换成海报形态版面集合完全不同
 *   · 每页必须有标题  —— 换成封面页就不该有
 *
 ⇒ 把它们写进核心 = 核心要跟着每一种形态改一次。
   核心应该只管**任何形态下都成立**的事（对比度、焦点、键盘、令牌）。
 *
 * ============================================================================
 * 判据
 * ----------------------------------------------------------------------------
 *   ① 版面必须已登记（deck.schema.json 的 layouts.registered）
 *   ② 单页元素数 <= 12（超过必然溢出）
 *   ③ 非封面页必须有 role=title 的节点
 *   ④ 标题层级不跳级（有 subtitle 就必须先有 title）
 *   ⑤ 不得出现"页面级 override"式表达（.slide-N xxx）—— 那是事故形态
 * ============================================================================
 */
'use strict';

var fs = require('fs');
var path = require('path');

var HERE = __dirname;
var MAX_PER_SLIDE = 12;

function main() {
  var file = process.argv[2];
  if (!file) {
    process.stderr.write('用法：check.js <deck.json>\n');
    process.exit(1);
  }
  var deck = JSON.parse(fs.readFileSync(file, 'utf8'));
  var schema = JSON.parse(fs.readFileSync(path.join(HERE, 'deck.schema.json'), 'utf8'));
  var registered = schema.layouts.registered;

  var errs = [];
  var warns = [];

  (deck.slides || []).forEach(function (slide, i) {
    var at = '第 ' + (i + 1) + ' 页';
    var sid = slide.id || (i + 1);

    // ① 版面已登记
    if (slide.layout && registered.indexOf(slide.layout) < 0) {
      errs.push(at + '：版面 ' + slide.layout + ' 未登记（已登记：' +
        registered.join(' / ') + '）');
    }
    if (!slide.layout) {
      warns.push(at + '：没有指定版面');
    }

    var nodes = slide.nodes || [];
    // ② 单页元素上限
    if (nodes.length > MAX_PER_SLIDE) {
      errs.push(at + '：' + nodes.length + ' 个元素，超过上限 ' + MAX_PER_SLIDE +
        ' ⇒ 必然溢出，溢出后只能靠加特异性去救，那是事故的开始');
    }

    // ③ 非封面/分隔页必须有标题
    var roles = nodes.map(function (n) { return n.role; });
    var isCover = slide.layout === 'title' || slide.layout === 'section-break';
    if (!isCover && roles.indexOf('title') < 0 && !slide.title) {
      errs.push(at + '：没有标题（既没有 slide.title，也没有 role=title 的节点）');
    }

    // ④ 层级不跳级
    if (roles.indexOf('subtitle') >= 0 && roles.indexOf('title') < 0 && !slide.title) {
      errs.push(at + '：有 subtitle 但没有 title ⇒ 层级跳级');
    }

    // ⑤ 页面级 override 式表达
    var dump = JSON.stringify(slide);
    if (/\.slide-/.test(dump) || /\.page-\d/.test(dump)) {
      errs.push(at + '：出现了页面级选择器（.slide-N / .page-N）' +
        ' ⇒ 这正是事故的形态，请改组件而不是改页面');
    }
  });

  if (warns.length) {
    process.stdout.write('  ⚠️ 提示：\n');
    warns.forEach(function (w) { process.stdout.write('       ' + w + '\n'); });
  }
  if (errs.length) {
    process.stdout.write('  [FAIL] 呈现检查：\n');
    errs.forEach(function (e) { process.stdout.write('       ' + e + '\n'); });
    process.exit(1);
  }
  process.stdout.write('  [OK] 呈现检查通过（' + (deck.slides || []).length + ' 页）\n');
  process.exit(0);
}

if (require.main === module) main();
module.exports = { MAX_PER_SLIDE: MAX_PER_SLIDE };
