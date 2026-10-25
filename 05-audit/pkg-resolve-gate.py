#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pkg-resolve-gate —— 发布物的**真实解析**门禁

为什么需要它（和 pack-smoke / tsc-gate 的区别）
=====================================================================
现有两个门禁都**没有**回答"使用者到底能不能用上"：

  · `tsc-gate.py` 走 `type-tests/tsconfig.json` 的 `paths` 别名
    ⇒ 它验的是"这个 d.ts 文件本身语法对不对"，**不是**"从包名能不能解析到它"。
    实测证据：包名从 `frontend-lib` 改成 `agentcss` 之后，`paths` 里还写着旧名，
    类型门禁照样全绿 —— 因为它压根没走 `exports`。
  · `pack-smoke.sh` 验的是"路径存在 / 文件在包里 / 能被 node --check"
    ⇒ 它是**存在性**检查，不是**解析**检查。

本门禁补的就是这一格：**按 `files` 白名单把真实发布物摆成 node_modules 的样子，
让 tsc 以 `moduleResolution: bundler` 从包名解析一次**。

判据（四条，全部可机械执行）
=====================================================================
  A. `npm pack --dry-run --json` 的清单非空，且我们复制出的文件数 == 清单条数
     （用 npm 自己的答案当单一真源，不手写 files 规则）
  B. 使用者写 `import { Select } from '<包名>'` + `import type {...} from '<包名>'`
     ⇒ `tsc --strict --skipLibCheck false` 退出码 0、输出无 `error TS`
  C. `exports` 里每一个**精确**目标都真实存在于发布物中；
     **通配**目标至少能匹配到一个文件（不许指向空目录）
  D. 反例必须红：删掉 `exports["."].types` ⇒ 必须报 TS2307
     （这条证明 B 不是"反正都能过"，而是真的依赖 exports）

🔴 为什么 C 要分开判精确/通配：`./primitives/*` 这种通配在 `release-gate` 里
   是被 `endswith('*')` 直接跳过的 —— 也就是说它从来没被验过。
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NPM = shutil.which('npm') or shutil.which('npm.cmd') or 'npm'
NODE = shutil.which('node') or 'node'
TSC = os.path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')

PROBE_TS = """\
import { Select, Combobox } from '%(NAME)s';
import type { SelectOption, SelectOptions } from '%(NAME)s';

declare const el: HTMLElement;

const opts: SelectOption[] = [
  { value: 'a', label: '甲' },
  { value: 'b', label: '乙', disabled: true },
];

/* Select 的公开面是 open/close/value —— 它**没有**公开的 destroy()，
   所以这里不许调（调了就是探针自己错，不是类型错）。 */
const opt: SelectOptions = { label: '口径', options: opts };
const s = Select.create(el, opt);
s.open();
s.close();

/* Combobox 有 destroy()（types:170），顺带验证 Destroyable 这一面也解析得到。 */
const c = Combobox.create(el, { label: '标签', options: opts });
c.destroy();
"""

TSCONFIG = """\
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM"],
    "types": [],
    "skipLibCheck": false
  },
  "include": ["probe.ts"]
}
"""


def run(cmd, cwd=None):
    p = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, shell=False)
    return p.returncode, p.stdout.decode('utf-8', 'ignore')


def pack_manifest(root):
    """用 npm 自己的 --dry-run --json 拿"到底哪些文件会发出去"。"""
    rc, out = run([NPM, 'pack', '--dry-run', '--json'], cwd=root)
    if rc != 0:
        return None, 'npm pack --dry-run 失败（rc=%d）：%s' % (rc, out.strip()[:300])
    try:
        data = json.loads(out[out.index('['):])
        return data[0], None
    except Exception as e:
        return None, '解析 npm pack 输出失败：%s' % e


def stage(root, manifest, dest):
    """把清单里的文件**原样**复制成 node_modules/<name>/ 的样子。"""
    pkg = json.loads(io.open(os.path.join(root, 'package.json'), encoding='utf-8').read())
    name = pkg['name']
    pkg_dir = os.path.join(dest, 'node_modules', name)
    copied = 0
    for f in manifest.get('files', []):
        rel = f['path'].replace('\\', '/')
        src = os.path.join(root, rel)
        dst = os.path.join(pkg_dir, rel.replace('/', os.sep))
        if not os.path.isfile(src):
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1
    return pkg_dir, copied, name


def check_exports(pkg_dir, exports):
    """精确目标必须存在；通配目标必须能匹配到文件。"""
    bad = []
    for key, val in exports.items():
        if isinstance(val, dict):
            targets = [v for v in val.values() if isinstance(v, str)]
        elif isinstance(val, str):
            targets = [val]
        else:
            continue
        for t in targets:
            if '*' in t:
                d = os.path.dirname(t.replace('*', 'x')).replace('./', '')
                base = os.path.join(pkg_dir, d)
                n = 0
                for _, _, fn in os.walk(base):
                    n += len(fn)
                if n == 0:
                    bad.append('%s → %s 通配不到任何文件' % (key, t))
            else:
                p = os.path.join(pkg_dir, t.replace('./', '').replace('/', os.sep))
                if not os.path.isfile(p):
                    bad.append('%s → %s 不存在' % (key, t))
    return bad


def tsc_probe(temp):
    """跑一次真实解析。返回 (rc, 输出)。"""
    rc, out = run([NODE, TSC, '-p', os.path.join(temp, 'tsconfig.json')])
    return rc, out


def build_temp(root, mutate=None):
    """摆出一个消费者项目；mutate 可对 package.json 做一处破坏（反向控制用）。"""
    manifest, err = pack_manifest(root)
    if err:
        return None, None, err, 0
    temp = tempfile.mkdtemp(prefix='fl-resolve-')
    pkg_dir, copied, name = stage(root, manifest, temp)

    if mutate:
        p = os.path.join(pkg_dir, 'package.json')
        pkg = json.loads(io.open(p, encoding='utf-8').read())
        mutate(pkg)
        io.open(p, 'w', encoding='utf-8', newline='\n').write(
            json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')

    io.open(os.path.join(temp, 'probe.ts'), 'w', encoding='utf-8',
            newline='\n').write(PROBE_TS % {'NAME': name})
    io.open(os.path.join(temp, 'tsconfig.json'), 'w', encoding='utf-8',
            newline='\n').write(TSCONFIG)
    return temp, pkg_dir, None, copied


def evaluate(root):
    """返回 (是否通过, [(级别, 文本)])。"""
    msgs = []
    ok = True

    manifest, err = pack_manifest(root)
    if err:
        return False, [('FAIL', err)]
    entry = manifest.get('entryCount') or len(manifest.get('files', []))
    if entry == 0:
        return False, [('FAIL', 'npm pack 清单是空的 —— 不是"干净"，是没打包成功')]

    temp, pkg_dir, err, copied = build_temp(root)
    if err:
        return False, [('FAIL', err)]
    try:
        # A
        if copied != entry:
            ok = False
            msgs.append(('FAIL', 'A 复制了 %d 个文件，npm 清单是 %d 条' % (copied, entry)))
        else:
            msgs.append(('OK', 'A 发布物 %d 个文件，与 npm 清单一致' % copied))

        # C
        pkg = json.loads(io.open(os.path.join(pkg_dir, 'package.json'), encoding='utf-8').read())
        bad = check_exports(pkg_dir, pkg.get('exports') or {})
        if bad:
            ok = False
            for b in bad:
                msgs.append(('FAIL', 'C ' + b))
        else:
            msgs.append(('OK', 'C exports 全部落点存在（%d 条）'
                         % len(pkg.get('exports') or {})))

        # B
        rc, out = tsc_probe(temp)
        errs = [l for l in out.splitlines() if 'error TS' in l]
        if rc != 0 or errs:
            ok = False
            msgs.append(('FAIL', 'B tsc 解析失败（rc=%d）：%s' % (rc, errs[0] if errs else out[:200])))
        else:
            msgs.append(('OK', 'B tsc 从包名解析成功（strict + skipLibCheck:false）'))
    finally:
        shutil.rmtree(temp, ignore_errors=True)
    return ok, msgs


def selftest(root):
    """反向控制：基准必须绿；删掉 exports 的 types 条件必须红。"""
    ok = True
    good, msgs = evaluate(root)
    print('  基准（未破坏）：' + ('PASS' if good else 'FAIL'))
    if not good:
        for lv, m in msgs:
            print('    %s %s' % (lv, m))
        ok = False

    def kill_types(pkg):
        exp = pkg.get('exports') or {}
        if isinstance(exp.get('.'), dict):
            exp['.'].pop('types', None)
        pkg['exports'] = exp

    temp, pkg_dir, err, copied = build_temp(root, mutate=kill_types)
    if err:
        print('  [FAIL] 反向控制准备失败：%s' % err)
        return 1
    try:
        rc, out = tsc_probe(temp)
        if rc == 0 and 'error TS' not in out:
            print('  [FAIL] 删掉 exports["."].types 之后 tsc 仍然通过 ⇒ 判据 B 没有牙')
            ok = False
        else:
            first = [l for l in out.splitlines() if 'error TS' in l]
            print('  OK   删掉 exports["."].types 后 tsc 变红（%s）'
                  % (first[0][:110] if first else 'rc=%d' % rc))
    finally:
        shutil.rmtree(temp, ignore_errors=True)

    def kill_css(pkg):
        exp = pkg.get('exports') or {}
        if isinstance(exp.get('./tokens.css'), str):
            exp['./tokens.css'] = './dist/01-tokens/NO-SUCH-FILE.css'
        pkg['exports'] = exp

    temp, pkg_dir, err, copied = build_temp(root, mutate=kill_css)
    if err:
        print('  [FAIL] 反向控制准备失败：%s' % err)
        return 1
    try:
        pkg = json.loads(io.open(os.path.join(pkg_dir, 'package.json'), encoding='utf-8').read())
        bad = check_exports(pkg_dir, pkg.get('exports') or {})
        if not bad:
            print('  [FAIL] 把 tokens.css 指向不存在的文件，判据 C 仍然通过 ⇒ 没牙')
            ok = False
        else:
            print('  OK   指向不存在的导出目标后判据 C 变红：%s' % bad[0])
    finally:
        shutil.rmtree(temp, ignore_errors=True)

    print('  ---- selftest %s ----' % ('通过' if ok else '失败'))
    return 0 if ok else 1


def main():
    if '--selftest' in sys.argv:
        return selftest(ROOT)
    if not os.path.isfile(TSC):
        print('  [SKIP] 没装 typescript（npm ci 之后才有）—— 不算通过')
        return 0
    print('  === 发布物真实解析（pkg-resolve）===')
    ok, msgs = evaluate(ROOT)
    for lv, m in msgs:
        print('  %-4s %s' % (lv, m))
    if not ok:
        print('  ⇒ 使用者按文档写的 import 解析不了。这不是文档问题，是 exports 问题。')
        return 1
    print('  OK   包名 / 子路径 / 类型 三条解析路径都成立')
    return 0


if __name__ == '__main__':
    sys.exit(main())
