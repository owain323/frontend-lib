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
sys.path.insert(0, os.path.join(ROOT, '05-audit'))
from _common import scannable_files  # noqa: E402

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
    # Python 标准异常（门禁脚本里会用到，不是内部代号）
    #   SubprocessError = TimeoutExpired / CalledProcessError 的基类
    'RuntimeError', 'ValueError', 'TypeError', 'KeyError', 'OSError',
    'SubprocessError', 'CalledProcessError', 'FileNotFoundError',
    # 平台 / 标准 API 名（2026-10-29 补：文档站脚本与判据工具里出现，
    #   全部是规范里的名字，不是内部代号）
    'GoTo', 'InlineTextBox', 'LineBreak', 'NodeFilter', 'StaticText',
    'PngError',
    # NameError（2026-08-16 补）
    #   起因：ERRORS.md E41 记「批量插零文件守卫时守卫插到 return 之后
    #   ⇒ NameError: total」，那是我自己踩的真实报错，不是内部代号。
    'NameError',
    # 2026-10-31 补三个（起因：强制色那道门禁用系统色关键字修强制色缺陷）
    #   · CanvasText / GrayText —— CSS 系统色关键字（CSS Color 4）。它们不是
    #     内部代号，是**规范里的名字**；判据必须用它们才能在强制色下保住
    #     前景/禁用态的语义（见 02-primitives/skeleton、switch）。
    #   · InvalidStateError —— Web Animations 的标准异常：对无限动画调
    #     `Animation.finish()` 就会抛它。门禁里必须捕获，所以名字出现在代码里。
    'CanvasText', 'GrayText', 'InvalidStateError',
    # 2026-10-17 补三个（起因：审计收口那轮新增的门禁代码里引用了它们）
    #   · AttributeError   —— release-gate 处理 exports 条件导出时，
    #                         原判据对 dict 调 .endswith ⇒ 真抛过这个错
    #   · ModuleNotFoundError —— doc-facts 第一版 import 了不存在的模块
    #                             ⇒ 真抛过（判据因此空转）
    #   · SecurityError    —— purge-css 走 file:// 时 styleSheets 全抛
    #                          （实测 9/9 张表）
    #   ⇒ 三个都是**语言/浏览器标准异常名**，是"我们真踩过的报错"，
    #     按本库的判据（是不是内部代号）它们必须进白名单。
    'AttributeError', 'ModuleNotFoundError', 'SecurityError',
    # RecursionError（本轮补）：`_css.resolve_vars()` 的注释里解释了
    # 「循环引用不能靠递归深度兜底，那样只会得到一个莫名的 RecursionError」
    # —— 是标准异常名，不是内部代号。
    'RecursionError',
    # Windows 公开 API / 错误码（2026-10-14补）
    #   起因：修 shot-baseline.py 的 node 路径时在注释里写了
    #   「直接丢给 CreateProcess 会 WinError 5」⇒ 被当成内部代号报红。
    #   核实：两者都是 Windows 公开 API（进程创建 / 系统错误码），与内部代号无关。
    'CreateProcess', 'WinError',
    # 浏览器 / WebView 的 UA 里必然出现的产品名（补于真机基线采集之后）
    #   起因：`docs/LAYER-BASELINE.md` 记录实测 UA，那段字符串里有
    #   MicroMessenger / WeChat / NetType 三个驼峰词 ⇒ 被判"疑似内部代号"。
    #   核实：三个都是**第三方 UA 里的公开标识**，不是我们的内部命名。
    #   ⚠️ 这一条不能靠"中性化 UA"来解决 —— UA 是证据，
    #      改写它等于把证据变成摘要（那样别人就无法复核基线了）。
    #      身份标识（如微信的 MMWEBID）另行脱敏，那是隐私，不是术语。
    'MicroMessenger', 'WeChat', 'NetType',
    # 企业微信 UA 里的字段名（`Language/zh ColorScheme/Light wwmver/…`）
    'ColorScheme',
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
    # 浏览器引擎标识（UA 判据直接比对这些字面量 —— 是技术词，不是内部代号）:
    #   · AppleWebKit  —— WebKit / Chromium 的 UA 里**都有**（Chromium 是它的分叉）
    #   · HeadlessChrome —— Chromium 无头模式的 UA 字面量
    'AppleWebKit', 'HeadlessChrome',
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
    # Chrome 报错里出现的类名（原文照抄才便于以后检索，不是内部代号）
    'ProcessSingleton',
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
    # 本库对外公开的全局名（不是内部代号，API.md 里有登记）
    'ScientificPlot',
    # 本库 `types/index.d.ts` 里的**公开接口名**（2026-10-29 补）。
    #   起因：0.11.16 把「类型成员」收进废弃基线（`api` 这一类），
    #   成员名的坐标是 `接口.成员`，于是这些接口名第一次出现在
    #   `ai/surface.baseline.json` 与 `docs/DEPRECATIONS.md` 里 ——
    #   而它们本来就是对外导出的类型，不是内部代号。
    #   ⚠️ 例外说明：这几个名字本身**不再**单独出现（成员都带前缀），
    #      但基线是纯名字集合，接口名作为前缀仍然在里面。
    'AccordionInstance', 'AccordionOptions', 'DismissableOverlay',
    'FlipApi', 'NavInstance', 'OverlayApi', 'PaginationApi', 'PopoverApi',
    'RevealApi', 'TabsInstance', 'TocApi', 'TooltipApi',
    # 化学元素符号连写（示例内容里的化学式，如 LiNi₀.₈Co₀.₁Mn₀.₁O₂）
    'LiNi',
}

PAT = re.compile(r'\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b')
SELF = {'terms.py', 'leak-scan.py', 'leak-clean.py', 'outsider-audit.py',
        'publish-guard.py', 'proper-noun-scan.py'}
EXTS = ('.md', '.html', '.js', '.css', '.py', '.json', '.sh', '.mjs')


def main():
    print('  === 专有名词检测（防黑名单漏项）===')
    print('')
    # 🔴 视野 = 磁盘上要交付的东西（含未跟踪的新文件），不是 git 索引
    files = scannable_files(ROOT)

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
