#!/usr/bin/env node
/*
 * to-doc.js — deck → 核心契约文档
 *
 * ============================================================================
 * 🔴 这个文件存在的全部意义
 * ----------------------------------------------------------------------------
 * 把「呈现语义」和「组件结构」**分开存放**：
 *
 *   deck.json   slide / layout / role  —— 呈现形态的事，本层负责
 *   doc.json    节点 / 组件 / 插槽      —— 核心的事，核心负责
 *
 * 转换时，呈现语义被塞进每个节点的 `extensions.presentation`。
 * ⇒ 核心校验器看到它：忽略（前向兼容，不判非法）
 * ⇒ 本层看到它：知道这一页是第几页、这个节点是什么角色
 *
 * ⇒ **核心不需要知道 PPT 存在。** 这句话不是口号，是可以 grep 验证的：
 *      grep -ril 'slide\|deck' 01-tokens 02-primitives 03-patterns 04-recipes
 *    ⇒ 0 命中（由 05-audit/core-boundary-gate.py 守住）
 *
 * ============================================================================
 * 用法
 * ----------------------------------------------------------------------------
 *   node adapters/presentation/to-doc.js deck.json [-o doc.json]
 * ============================================================================
 */
'use strict';

var fs = require('fs');
var path = require('path');

/**
 * 读命令行开关。支持 `-o x` / `-o=x` / `--o=x` / `--o x` 四种写法。
 * ⚠️ 第一版只认双横线 ⇒ `-o out.json` 被静默忽略，
 *    结果文档被打印到 stdout 而**文件没写出来** ⇒ 下游 ENOENT（实测）。
 *    **参数没生效却不报错**，是最难查的一类失败。
 */
function flag(name, def) {
  for (var i = 0; i < process.argv.length; i++) {
    var a = process.argv[i];
    if (a === '-' + name || a === '--' + name) {
      var v = process.argv[i + 1];
      if (v !== undefined && v.charAt(0) !== '-') return v;
      return def;
    }
    if (a.indexOf('-' + name + '=') === 0 || a.indexOf('--' + name + '=') === 0) {
      return a.slice(a.indexOf('=') + 1);
    }
  }
  return def;
}

function toDoc(deck) {
  var nodes = {};
  var root = [];

  (deck.slides || []).forEach(function (slide, si) {
    var slideId = 'slide-' + (slide.id || (si + 1));
    var childIds = [];

    (slide.nodes || []).forEach(function (n, ni) {
      var id = n.id || (slideId + '-n' + (ni + 1));
      var node = {
        id: id,
        kind: n.kind,
        extensions: {
          presentation: {
            slide: si + 1,
            slideId: slideId,
            layout: slide.layout || null,
            role: n.role || null
          }
        }
      };
      if (n.text !== undefined) node.text = n.text;
      if (n.props) node.props = n.props;
      if (n.children) node.children = n.children;
      if (n.extensions) {
        Object.keys(n.extensions).forEach(function (k) {
          node.extensions[k] = n.extensions[k];
        });
      }
      nodes[id] = node;
      childIds.push(id);
    });

    nodes[slideId] = {
      id: slideId,
      kind: 'section',
      children: childIds,
      extensions: {
        presentation: {
          slide: si + 1,
          layout: slide.layout || null,
          title: slide.title || null
        }
      }
    };
    root.push(slideId);
  });

  return {
    schemaVersion: '1.0.0',
    profile: 'standard',
    root: root,
    nodes: nodes,
    extensions: {
      presentation: {
        adapter: 'presentation',
        adapterVersion: '1.0.0',
        deckTitle: deck.title || null,
        slideCount: (deck.slides || []).length
      }
    }
  };
}

function main() {
  var file = process.argv[2];
  if (!file) {
    process.stderr.write('用法：to-doc.js <deck.json> [-o doc.json]\n');
    process.exit(1);
  }
  var deck = JSON.parse(fs.readFileSync(file, 'utf8'));
  var doc = toDoc(deck);
  var o = flag('o', null);
  var txt = JSON.stringify(doc, null, 2) + '\n';
  if (o) {
    fs.writeFileSync(o, txt);
    process.stdout.write('  已写出 ' + o + '（' + (deck.slides || []).length +
      ' 页 / ' + Object.keys(doc.nodes).length + ' 个节点）\n');
  } else {
    process.stdout.write(txt);
  }
}

if (require.main === module) main();
module.exports = { toDoc: toDoc };
