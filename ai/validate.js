/*
 * validate.js — 契约校验器（零第三方依赖）
 *
 * ============================================================================
 * 🔴 它是**故意不完整**的，并且这个不完整被机械地守住了
 * ----------------------------------------------------------------------------
 * 完整实现 JSON Schema 需要几百 KB（ajv 就是这个量级）。
 * 本库的核心约束是零第三方依赖，所以这里只实现**我们自己 schema 用到的**那些关键字。
 *
 * ⇒ 危险在于：哪天有人在 schema 里用了我们**没实现**的关键字
 *    （比如 `if` / `then` / `dependentSchemas`），
 *    这个校验器会**静默忽略它** ⇒ 门禁绿着，而那条约束压根没被检查。
 *    这就是"假绿"最典型的一种。
 *
 * ⇒ 解法：`SUPPORTED_KEYWORDS` 是白名单，`assertSchemasUseOnlySupported()`
 *    会在每次校验前扫一遍全部 schema，遇到白名单外的关键字**直接抛错**。
 *    ⇒ 工具的能力边界由机器守住，不靠人记得。
 *
 * ============================================================================
 * 对外接口
 * ----------------------------------------------------------------------------
 *   validate(schema, data)      → { ok, errors: [{path, msg}] }
 *   validateDoc(doc, opt)       → { ok, errors, warnings }
 *   assertSchemasUseOnlySupported()
 * ============================================================================
 */
'use strict';

var fs = require('fs');
var path = require('path');

var AI_DIR = __dirname;

// ---------------------------------------------------------------- 能力白名单
// ⚠️ 改这个表 = 改工具的能力边界。加关键字 ⇒ 必须同时实现它，否则别加。
var SUPPORTED_KEYWORDS = [
  '$schema', '$id', '$comment', '$ref', 'definitions', 'title',
  'type', 'required', 'properties', 'additionalProperties', 'patternProperties',
  'items', 'enum', 'const', 'pattern', 'minLength', 'maxLength',
  'minimum', 'maximum', 'minItems', 'maxItems', 'uniqueItems',
  'allOf', 'anyOf', 'oneOf', 'not',
  // 我们自己的元信息键（不是 JSON Schema 标准，由本库读取）
  'invariants', 'opRequirements'
];

function readJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(AI_DIR, rel), 'utf8'));
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 扫一遍 schema 里出现的所有关键字，遇到白名单外的就抛错。
 * 🔴 这是防止"校验器静默漏检"的唯一手段。
 */
// 哪些键的"值"本身还是 schema
var SUBSCHEMA_KEYS = [
  'items', 'additionalProperties', 'patternProperties', 'allOf', 'anyOf',
  'oneOf', 'not', 'propertyNames', 'contains', 'if', 'then', 'else'
];
// 哪些键是"名字 → schema"的容器（它们的**键**是字段名，不是关键字）
var CONTAINER_KEYS = ['properties', 'definitions', '$defs', 'dependentSchemas'];

function assertSchemasUseOnlySupported() {
  var files = ['contract.schema.json', 'components.schema.json',
               'tokens.schema.json', 'patch.schema.json'];
  var unknown = [];

  function checkNode(schema, f, ptr) {
    if (!isPlainObject(schema)) return;
    Object.keys(schema).forEach(function (k) {
      // 🔴 只检查**处于 schema 位置**的键。
      //    `properties` 下面的键是数据字段名（例如 DTCG 的 $value / $type），
      //    把它们当关键字 ⇒ 第一版把整份 tokens.schema.json 判成了非法（实测）。
      if (SUPPORTED_KEYWORDS.indexOf(k) < 0) {
        unknown.push(f + ' ' + ptr + ' → ' + k);
      }
    });
    Object.keys(schema).forEach(function (k) {
      var v = schema[k];
      if (CONTAINER_KEYS.indexOf(k) >= 0 && isPlainObject(v)) {
        Object.keys(v).forEach(function (name) {
          checkNode(v[name], f, ptr + '/' + k + '/' + name);
        });
      } else if (SUBSCHEMA_KEYS.indexOf(k) >= 0) {
        if (Array.isArray(v)) {
          v.forEach(function (s, i) { checkNode(s, f, ptr + '/' + k + '/' + i); });
        } else {
          checkNode(v, f, ptr + '/' + k);
        }
      }
    });
  }

  files.forEach(function (f) { checkNode(readJSON(f), f, ''); });

  if (unknown.length) {
    throw new Error('schema 用了校验器没实现的关键字，会导致静默漏检：\n  ' +
      unknown.join('\n  '));
  }
  return true;
}

// ---------------------------------------------------------------- 校验核心
function typeOk(expected, value) {
  if (Array.isArray(expected)) {
    return expected.some(function (e) { return typeOk(e, value); });
  }
  if (expected === 'object') return isPlainObject(value);
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'string') return typeof value === 'string';
  if (expected === 'number') return typeof value === 'number';
  if (expected === 'boolean') return typeof value === 'boolean';
  if (expected === 'null') return value === null;
  if (expected === 'integer') return typeof value === 'number' && value % 1 === 0;
  return true;
}

function resolveRef(root, ref) {
  if (ref.charAt(0) !== '#' || ref.indexOf('#/') !== 0) {
    throw new Error('只支持文档内 $ref：' + ref);
  }
  var parts = ref.slice(2).split('/');
  var cur = root;
  for (var i = 0; i < parts.length; i++) {
    cur = cur[parts[i].replace(/~1/g, '/').replace(/~0/g, '~')];
    if (cur === undefined) throw new Error('$ref 找不到：' + ref);
  }
  return cur;
}

function validate(schema, data, root, ptr, errors) {
  root = root || schema;
  ptr = ptr || '';
  errors = errors || [];

  if (schema.$ref) {
    return validate(resolveRef(root, schema.$ref), data, root, ptr, errors);
  }

  if (schema.type !== undefined && !typeOk(schema.type, data)) {
    errors.push({ path: ptr, msg: '类型应为 ' + JSON.stringify(schema.type) +
      '，实际是 ' + (data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data) });
    return errors;
  }
  if (schema.enum !== undefined && schema.enum.indexOf(data) < 0) {
    errors.push({ path: ptr, msg: '取值必须是 ' + JSON.stringify(schema.enum) +
      ' 之一，实际是 ' + JSON.stringify(data) });
  }
  if (schema.const !== undefined && data !== schema.const) {
    errors.push({ path: ptr, msg: '应为 ' + JSON.stringify(schema.const) });
  }
  if (typeof data === 'string') {
    if (schema.pattern !== undefined && !(new RegExp(schema.pattern)).test(data)) {
      errors.push({ path: ptr, msg: '不符合模式 ' + schema.pattern });
    }
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push({ path: ptr, msg: '长度不足 ' + schema.minLength });
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push({ path: ptr, msg: '长度超过 ' + schema.maxLength });
    }
  }
  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push({ path: ptr, msg: '小于最小值 ' + schema.minimum });
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push({ path: ptr, msg: '大于最大值 ' + schema.maximum });
    }
  }
  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({ path: ptr, msg: '元素少于 ' + schema.minItems + ' 个' });
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push({ path: ptr, msg: '元素多于 ' + schema.maxItems + ' 个' });
    }
    if (schema.items) {
      data.forEach(function (v, i) {
        validate(schema.items, v, root, ptr + '/' + i, errors);
      });
    }
  }
  if (isPlainObject(data)) {
    (schema.required || []).forEach(function (k) {
      if (!(k in data)) {
        errors.push({ path: ptr, msg: '缺少必填字段 ' + k });
      }
    });
    var props = schema.properties || {};
    Object.keys(data).forEach(function (k) {
      if (props[k] !== undefined) {
        validate(props[k], data[k], root, ptr + '/' + k, errors);
        return;
      }
      var matched = false;
      if (schema.patternProperties) {
        Object.keys(schema.patternProperties).forEach(function (p) {
          if ((new RegExp(p)).test(k)) {
            validate(schema.patternProperties[p], data[k], root, ptr + '/' + k, errors);
            matched = true;
          }
        });
      }
      if (matched) return;
      if (schema.additionalProperties === false) {
        errors.push({ path: ptr + '/' + k, msg: '不允许的字段 ' + k });
      } else if (isPlainObject(schema.additionalProperties)) {
        validate(schema.additionalProperties, data[k], root, ptr + '/' + k, errors);
      }
    });
  }
  (schema.allOf || []).forEach(function (s) { validate(s, data, root, ptr, errors); });
  if (schema.anyOf) {
    var anyOk = schema.anyOf.some(function (s) {
      return validate(s, data, root, ptr, []).length === 0;
    });
    if (!anyOk) errors.push({ path: ptr, msg: '不满足 anyOf 中任何一条' });
  }
  if (schema.oneOf) {
    var n = schema.oneOf.filter(function (s) {
      return validate(s, data, root, ptr, []).length === 0;
    }).length;
    if (n !== 1) {
      errors.push({ path: ptr, msg: '必须恰好满足 oneOf 中的一条，实际满足 ' + n + ' 条' });
    }
  }
  return errors;
}

// ---------------------------------------------------------------- 文档校验
/**
 * 校验一份编辑文档。
 * @param {object} doc    符合 contract.schema.json 的文档
 * @param {object} opt    { profile: 'creative'|'standard'|'strict' }
 * @returns {{ok:boolean, errors:Array, warnings:Array}}
 */
function validateDoc(doc, opt) {
  opt = opt || {};
  assertSchemasUseOnlySupported();

  var contract = readJSON('contract.schema.json');
  var errors = validate(contract, doc, contract, '');
  var warnings = [];
  // 🔴 显式覆盖必须优先于文档自己声明的档位。
  //    第一版写成 `doc.profile || opt.profile` ⇒
  //    CLI 的 `--profile=strict` 对任何自带 profile 的文档**完全无效**（实测），
  //    而退出码还是 0 ⇒ 看上去"校验通过了"。
  var profileName = opt.profile || doc.profile || 'standard';
  var profiles = readJSON('profiles.json').profiles;
  var profile = profiles[profileName];

  if (!profile) {
    errors.push({ path: '/profile', msg: '未知档位 ' + profileName +
      '（可用：' + Object.keys(profiles).join(' / ') + '）' });
    profile = profiles.standard;
  }

  // ---- 结构完整性：children 引用的 id 必须存在，且不能形成环
  var nodes = doc.nodes || {};
  var ids = Object.keys(nodes);
  ids.forEach(function (id) {
    (nodes[id].children || []).forEach(function (c) {
      if (!(c in nodes)) {
        errors.push({ path: '/nodes/' + id + '/children',
          msg: '引用了不存在的节点 id：' + c });
      }
    });
  });
  var seen = {};
  function visit(id, stack) {
    if (stack.indexOf(id) >= 0) {
      errors.push({ path: '/nodes/' + id, msg: '节点引用成环：' + stack.concat(id).join(' → ') });
      return;
    }
    if (seen[id]) return;
    seen[id] = true;
    (nodes[id].children || []).forEach(function (c) {
      if (nodes[c]) visit(c, stack.concat(id));
    });
  }
  ids.forEach(function (id) { visit(id, []); });

  // ---- root 里的 id 必须存在
  (doc.root || []).forEach(function (id) {
    if (!(id in nodes)) {
      errors.push({ path: '/root', msg: 'root 引用了不存在的节点 id：' + id });
    }
  });

  // ---- 组件成熟度（Profile 的核心差异）
  //
  // ⚠️ `opt.components` 是**为了可测性**留的口子，不是给使用者的配置项。
  //    没有它，"strict 档必须拒绝 beta 组件"这条规则就只能靠
  //    **真实组件表里恰好有 beta 组件**才验证得了。
  //
  //    实测踩到：状态收敛完成后 27 个组件全部升到 stable，
  //    于是没有任何 beta ⇒ 这条判据**无法执行**，门禁直接报"前置条件不足"。
  //    ⇒ 那是"门禁因为库变好了而失去鉴别力"，正是要避免的假绿。
  //    ⇒ 正解：用**合成夹具**证明规则本身成立，与真实组件表无关。
  var src = opt.components || readJSON('components.json').components || [];
  var comps = {};
  src.forEach(function (c) { comps[c.id] = c; });
  ids.forEach(function (id) {
    var n = nodes[id];
    if (n.kind === 'text' || n.kind === 'slot') return;
    var c = comps[n.kind];
    if (!c) {
      if (profile.allowedUnknownComponent) {
        warnings.push({ path: '/nodes/' + id,
          msg: '组件 ' + n.kind + ' 不在契约里（本档位放行，但渲染结果无保证）' });
      } else {
        errors.push({ path: '/nodes/' + id,
          msg: '组件 ' + n.kind + ' 不在契约里，本档位（' + profileName + '）不允许' });
      }
      return;
    }
    if (profile.allowedMaturity.indexOf(c.maturity) < 0) {
      errors.push({ path: '/nodes/' + id,
        msg: '组件 ' + n.kind + ' 的成熟度是 ' + c.maturity +
             '，本档位（' + profileName + '）只允许 ' +
             profile.allowedMaturity.join(' / ') });
    }
    var props = n.props || {};
    // 变体
    Object.keys(props).forEach(function (k) {
      if (k === 'variant' && typeof props[k] === 'string') {
        if (c.variants.indexOf(props[k]) < 0) {
          if (profile.allowedUnknownVariant) {
            warnings.push({ path: '/nodes/' + id + '/props/variant',
              msg: '变体 ' + props[k] + ' 不在契约里（已知：' +
                   (c.variants.join(', ') || '无') + '）' });
          } else {
            errors.push({ path: '/nodes/' + id + '/props/variant',
              msg: '变体 ' + props[k] + ' 不在契约里，本档位不允许' });
          }
        }
      }
    });
    // 状态取值
    Object.keys(props).forEach(function (k) {
      if (k.indexOf('data-') !== 0) return;
      var known = c.states && c.states.enum && c.states.enum[k];
      if (known && known.indexOf(String(props[k])) < 0) {
        if (profile.allowedUnknownState) {
          warnings.push({ path: '/nodes/' + id + '/props/' + k,
            msg: '状态取值 ' + JSON.stringify(props[k]) + ' 不在契约里（已知：' +
                 known.join(' / ') + '）' });
        } else {
          errors.push({ path: '/nodes/' + id + '/props/' + k,
            msg: '状态取值 ' + JSON.stringify(props[k]) + ' 不在契约里（已知：' +
                 known.join(' / ') + '）—— 写错会让组件静默停在错误状态' });
        }
      }
    });
  });

  // ---- 前向兼容：extensions 必须是对象，未知键不得影响判定
  if (doc.extensions !== undefined && !isPlainObject(doc.extensions)) {
    errors.push({ path: '/extensions', msg: 'extensions 必须是对象' });
  }
  if (!profile.allowedExtensions && doc.extensions &&
      Object.keys(doc.extensions).length > 0) {
    errors.push({ path: '/extensions', msg: '本档位（' + profileName +
      '）不允许携带扩展字段' });
  }

  return { ok: errors.length === 0, errors: errors, warnings: warnings,
           profile: profileName };
}

module.exports = {
  validate: function (schema, data) {
    return { ok: validate(schema, data, schema, '').length === 0,
             errors: validate(schema, data, schema, '') };
  },
  validateDoc: validateDoc,
  assertSchemasUseOnlySupported: assertSchemasUseOnlySupported,
  SUPPORTED_KEYWORDS: SUPPORTED_KEYWORDS
};
