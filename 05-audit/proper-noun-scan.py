#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
proper-noun-scan.py — 驼峰专有名词检测

===========================================================================
🔴 为什么需要这道门禁
---------------------------------------------------------------------------
  之前靠**手动列词表**（terms.py）来防泄漏，结果**永远漏**。

  ⭐ 根本教训：**黑名单一定会漏**。
  ⇒ 改成**模式检测**：任何「两段以上首字母大写」的词，
    若不在已知技术白名单里，就**报出来**。
  ⇒ 这样"漏掉"变成了"必须显式加进白名单"。

  ⚠️ 豁免：vendor/（第三方库满是这类词）、门禁自身（含词表）。
===========================================================================
"""
import sys
import io
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ============================================================================
# 技术词白名单 —— ⚠️ 新增必须写清理由
# ============================================================================
WHITELIST = {
    # 语言 / 平台
    'JavaScript', 'TypeScript', 'CoffeeScript', 'WebAssembly',
    # 工具
    'GitHub', 'GitLab', 'Chrome', 'Firefox', 'Safari', 'Edge', 'Opera',
    'Webpack', 'Vite', 'Rollup', 'Babel', 'PostCSS', 'Prettier', 'ESLint',
    'Puppeteer', 'Playwright', 'Jest', 'Vitest', 'Bash', 'PowerShell',
    'DevTools', 'Node', 'Deno', 'Bun', 'React', 'Vue', 'Angular', 'Svelte',
    # 协议 / 规范
    'HTTP', 'HTTPS', 'URL', 'URI', 'ARIA', 'WAI', 'APG', 'WCAG', 'CSS', 'HTML',
    'DOM', 'SVG', 'XML', 'JSON', 'YAML', 'TOML', 'API', 'REST', 'GraphQL',
    'WebGL', 'WebGL2', 'GLTF', 'DRM', 'ES5', 'ES6', 'ES2015', 'ES2020',
    'MIT', 'LGPL', 'Apache', 'BSD', 'GPL', 'ISC',
    'RTL', 'LTR', 'IME', 'I18N', 'L10N', 'A11Y',
    # TypeScript 通用术语（声明文件里必然出现，不是内部代号）
    'ComponentInstance', 'PresetName', 'SelectOption', 'SelectOptions',
    'ComboboxOptions', 'DateRangeOptions', 'DateRangeStatics',
    'FrontendLibGlobal', 'TreeOptions', 'Destroyable',
    # 浏览器 API
    'IntersectionObserver', 'MutationObserver', 'ResizeObserver',
    'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'TouchEvent',
    'CustomEvent', 'FileReader', 'FileLoader', 'XMLHttpRequest',
    'AbortController', 'ArrayBuffer', 'DataView', 'Intl', 'DateTimeFormat',
    'NumberFormat', 'Collator', 'Promise', 'Proxy', 'Reflect',
    'WeakMap', 'WeakSet', 'Map', 'Set', 'Symbol', 'Generator',
    'Iterator', 'AsyncIterator', 'URLSearchParams', 'FormData',
    'Blob', 'Worker', 'ServiceWorker', 'BroadcastChannel',
    'Storage', 'IndexedDB', 'Canvas', 'Image', 'ImageData', 'Text',
    'Notification', 'Geolocation', 'MediaQuery', 'matchMedia',
    'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle',
    'querySelector', 'querySelectorAll', 'addEventListener',
    'IntersectionObserverEntry', 'CommandLine', 'ImportError', 'IndexError',
    'CimInstance', 'ChartsPage', 'DateRange', 'CommonMark', 'DejaVu',
    'BlinkMacSystemFont', 'ChartAdapter', 'LinearProgress',
    'CircularProgress', 'DamagedHelmet',
    # 键名 / 事件名 / 字体 / 语言 API / 异常类
    'AppData', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp',
    'MarkdownIt', 'ModelViewer', 'NullPointerException', 'OrbitControls',
    'OrbitCtor', 'PingFang', 'ProgressBar', 'RegExp', 'SaveButton',
    'SimSun', 'SwitchThumb', 'SystemExit', 'TalkBack', 'TimeoutExpired',
    'TypeError', 'UnboundLocalError', 'UnicodeDecodeError', 'ValueError',
    'ViewportCheck', 'VoiceOver', 'WebKit', 'WebView', 'WorkBuddy',
    'YaHei', 'ZipFile', 'RangeError', 'SyntaxError', 'ReferenceError',
    'NotFoundError', 'AssertionError', 'StopIteration', 'DeprecationWarning',
    # 3D 图形
    'AmbientLight', 'DirectionalLight', 'PointLight', 'SpotLight',
    'HemisphereLight', 'RectAreaLight', 'LightProbe', 'AmbientLightProbe',
    'PerspectiveCamera', 'OrthographicCamera', 'Scene', 'Group', 'Object3D',
    'BoxGeometry', 'SphereGeometry', 'PlaneGeometry', 'BufferGeometry',
    'MeshStandardMaterial', 'MeshBasicMaterial', 'MeshPhongMaterial',
    'WebGLRenderer',
    # Python 标准库
    'ArgumentParser', 'Namespace',
    # 素材库文件名
    'Shoelace', 'AnimationMixer', 'AnimationClip', 'LoadingManager',
}

PAT = re.compile(r'\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b')
SELF = {'terms.py', 'leak-scan.py', 'leak-clean.py', 'outsider-audit.py',
        'publish-guard.py', 'leak-fix-paths.py', 'proper-noun-scan.py'}
EXTS = ('.md', '.html', '.js', '.css', '.py', '.json', '.sh', '.mjs')


def main():
    print('  === 专有名词检测（防黑名单漏项）===')
    print('')
    try:
        out = subprocess.run(['git', '-c', 'core.quotePath=false', 'ls-files'],
                             cwd=ROOT, capture_output=True, timeout=30)
        files = [f for f in out.stdout.decode('utf-8', 'replace').split('\n')
                 if f.strip()]
    except Exception:
        files = []

    found = {}
    for rel in files:
        if 'vendor' in rel or rel.split('/')[-1] in SELF:
            continue
        if not rel.endswith(EXTS):
            continue
        # ★ 锁文件不扫：里面是包名与内容哈希（会被误认成专有名词）
        if 'package-lock.json' in rel or 'yarn.lock' in rel:
            continue
        try:
            t = io.open(os.path.join(ROOT, rel), encoding='utf-8',
                        errors='replace').read()
        except Exception:
            continue
        for m in PAT.findall(t):
            if m in WHITELIST:
                continue
            found.setdefault(m, set()).add(rel)

    print('  扫了 %d 个文件' % len(files))
    print('')
    if not found:
        print('  OK 无未登记的专有名词')
        return 0

    print('  ! 以下驼峰词不在白名单，请确认是否为内部代号：')
    for w in sorted(found):
        print('     %-24s %s' % (w[:24], list(found[w])[0][:46]))
    print('')
    print('  => 若是技术词，加进 proper-noun-scan.py 的 WHITELIST')
    print('     若是内部代号，必须中性化')
    return 1


if __name__ == '__main__':
    sys.exit(main())
