#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
accent-gate.py — 强调色必须稀缺

背景
------------------------------------------------
我最初说"`--accent` 63 处，严重违反强调稀缺"。
**实测推翻了它** —— 63 处里真正的"实心强调"只有 13 处，
其余是链接色（10）、焦点环（9）、边框（11），**这些是功能性的，本来就不该算强调**。

按"首屏实心填充"精确统计：

| 页面 | 实心强调 | 判定 |
|---|---|---|
| button | 5 | 唯一超标 —— 但那是**七态演示**，每态一个按钮 |
| list / overlay / states | 1 | OK |
| card / choice / input / form-validation / nav | 0 | OK |

⇒ **8/9 页面本来就达标。** 唯一的超标是组件陈列页（合理）。

所以本门禁的判据不是"数 CSS 里的 accent"，而是**打开页面数首屏的实心填充**。

判据
----
**一个视口内，accent 作背景的实心元素 ≤ 3 个。**
链接色、焦点环、边框**不算**（它们是功能性的，不是强调）。

豁免
----
**组件陈列页**（`02-primitives/button` 等）——
它的目的是把组件的每种形态都摆出来，必然有多个实心按钮。
豁免名单写死在下面，加新豁免要在注释里写清理由。

用法：python 05-audit/accent-gate.py
"""
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = 'http://127.0.0.1:8000'

# 豁免：组件陈列页（摆出所有形态 ⇒ 必然多个实心按钮）
EXEMPT = {
    '02-primitives/button': '七态演示，每态一个 primary 按钮 —— 陈列而非设计',
}
LIMIT = 3
ACCENT_RGB = 'rgb(27, 77, 143)'          # --accent 的当前值

PAGES = [
    '02-primitives/card', '02-primitives/choice', '02-primitives/input',
    '03-patterns/form-validation', '03-patterns/list', '03-patterns/nav',
    '03-patterns/overlay', '03-patterns/states',
    '02-primitives/button',
]

SCRIPT = r'''
const pages = %s, exempt = %s, LIMIT = %d, ACCENT = %s;
(async () => {
  const puppeteer = require('puppeteer-core');
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  const out = [];
  for (const path of pages) {
    await p.setViewport({ width: 1280, height: 900 });
    try {
      await p.goto('http://127.0.0.1:8000/' + path + '/demo.html',
                  { waitUntil: 'networkidle0', timeout: 15000 });
    } catch (e) { out.push({ path, err: String(e).slice(0, 60) }); continue; }
    const r = await p.evaluate((A) => {
      let solid = 0; const items = [];
      document.querySelectorAll('body *').forEach((el) => {
        const cs = getComputedStyle(el);
        const bb = el.getBoundingClientRect();
        if (bb.width === 0 || bb.height === 0) return;
        if (bb.top > 900 || bb.bottom < 0) return;      // 只算首屏
        if (cs.backgroundColor === A) {
          solid++;
          items.push((el.textContent || '').trim().slice(0, 10));
        }
      });
      return { solid, items: items.slice(0, 5) };
    }, ACCENT);
    out.push(Object.assign({ path }, r));
  }
  await b.close();
  console.log(JSON.stringify(out));
})();
'''


def main():
    try:
        import subprocess
        node = os.path.join(
            os.environ.get('WORKBUDDY_NODE', ''), 'node.exe')
        if not os.path.isfile(node):
            node = 'node'
        import json
        # 一次性把占位符换掉（replace 有次数限制，顺序也有讲究：先长的）
        fmt = (SCRIPT
               .replace('%s', json.dumps(PAGES), 1)
               .replace('%s', json.dumps(EXEMPT), 1)
               .replace('%d', str(LIMIT), 1)
               .replace('%s', json.dumps(ACCENT_RGB), 1))
        tmp = os.path.join(HERE, '_accent_tmp.js')
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(fmt)
        r = subprocess.run([node, tmp], capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=180,
                           cwd=HERE)
        os.remove(tmp)
        import json
        lines = [l for l in r.stdout.strip().split('\n') if l.startswith('[')]
        if not lines:
            print('  [accent-gate] 没拿到结果：%s' % (r.stderr or r.stdout)[:120])
            return 1
        data = json.loads(lines[-1])
    except Exception as e:
        print('  [accent-gate] 运行失败：%s' % str(e)[:120])
        return 1

    bad = 0
    for it in data:
        if it.get('err'):
            print('  [accent-gate] %-34s 加载失败' % it['path'])
            bad += 1
            continue
        n = it['solid']
        ex = EXEMPT.get(it['path'])
        mark = 'EXEMPT' if ex else ('OK' if n <= LIMIT else 'TOO MANY')
        if not ex and n > LIMIT:
            bad += 1
        note = ('豁免：' + ex) if ex else ('实心 %d 个 / 上限 %d' % (n, LIMIT))
        print('  [accent-gate] %-8s %-34s %s%s'
              % (mark, it['path'], note,
                 '  ' + str(it.get('items', [])) if n > LIMIT else ''))
    print('')
    if bad:
        print('%d 个页面首屏实心强调超过 %d 个。' % (bad, LIMIT))
        return 1
    print('强调色稀缺：全部达标（或在豁免名单内）。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
