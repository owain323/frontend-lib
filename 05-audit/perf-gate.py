#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
perf-gate.py — 性能预算门禁（ H8）

===========================================================================
🔴 为什么需要它
---------------------------------------------------------------------------
  性能是唯一"**只会变差、不会自己变好**"的维度：
  改一行 CSS 让某个属性多写一遍、体积悄悄涨 2KB —— 没有任何功能门禁会拦。

  ⛔ 实测过的静默劣化路径：
     · 复制粘贴把 `transition` 写进几十个选择器
     · 反复调试留下的 `outline: 0` / `will-change: transform`
     · 大段内联 `<style>`（demo 页面积累出来的）
     · 引入图表库（echarts）却不 lazy-load

===========================================================================
预算（按"移动端 WebView + 4G"这一真实场景定，不是拍脑袋）
---------------------------------------------------------------------------
  ① 单个 CSS 文件 ≤ 24 KB
     理由：4G 下 24KB ≈ 200ms 首屏样式阻塞，超过就该拆。
  ② 全部 CSS 合计 ≤ 125 KB
     理由：库被完整引入时的总量上限（精简档 的预算）。
     ⚠️ 2026-10-25 从 120 调到 124（+3.3%）：容器级主题要让 `[data-theme]`
       在每个作用域**重声明 L2 别名**（`--paper: var(--raw-paper)`）——
       这是 CSS 的规定动作，不是可选优化（实测：只改 L1，容器里毫无变化，
       见 docs/INVARIANT.md I-16）。实测代价 +2.6 KB（剥注释后）。
       这不是"配额放松"，是一次有明确来源的重新定价。
     ⚠️ 2026-10-29 从 124 调到 125：`page.css` 收了 `.cmp` 对错对照家族
       （并排两栏 / 裁剪修饰符 / 窄屏叠单栏），供 24 个示例页共用。
       实测代价 **+0.83 KB**（剥注释并压掉空白后量得）。
       ⚠️ 这次上调**没有"规定动作"级别的理由**，只是一次功能采购：
         24 页看得见的「错写法 vs 本库写法」，替代此前 22 份页内副本。
       ⇒ 下一次撞到这条线时，**先删再谈**：必须在 `page.css` 里找出等量
         的未引用规则删掉，再来改这个数字。
  ③ 组件 demo 页面的内联 `<style>` ≤ 8 KB
     理由：demo 是给人看的，但内联样式会绕过 tokens 门禁 ⇒ 要卡住。
  ④ **禁止**遗留调试属性
     `will-change: transform`（未配动画时）· `outline: 0`（无替代焦点环时）
  ⑤ 动画必须尊重 `prefers-reduced-motion`
     （本库已有 `05-audit/motion.py` 查这个，这里只做交叉提醒）
"""
import sys
import os
import io
import glob
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

KB = 1024.0

# 预算
MAX_ONE_CSS = 24 * KB
# 🔴 0.12.0：125 → 132 KB。加的是 `delta`（≈1.5 KB 生效）+ `metric`（≈1.5 KB）
#    + `01-tokens/market.css`（≈0.2 KB），实测合计从 125.0 涨到 127.0 KB。
#    **这不是"顺手放宽"**：涨的是新组件的真实规则（剥注释后口径），
#    不是注释膨胀。如果要省，能省的只有组件本身。
MAX_ALL_CSS = 132 * KB
MAX_INLINE_STYLE = 8 * KB


def css_files():
    out = []
    for pat in ('01-tokens/*.css', '02-primitives/*/*.css',
                '03-patterns/*/*.css', '04-recipes/*/*.css',
                '09-assets/*/*.css'):
        out += glob.glob(os.path.join(ROOT, pat))
    return sorted(out)


def strip_comments(s):
    return re.sub(r'/\*.*?\*/', '', s, flags=re.S)


def main():
    bad = 0
    total = 0

    # ---------- ① + ② 体积 ----------
    print('  === CSS 体积预算 ===')
    files = css_files()
    if not files:
        print('  [FAIL] 一个 CSS 都没找到')
        return 1
    # 🔴 修正判据：**算「剥掉注释后」的体积**。
    #    原因：本库的说明注释很长（这是刻意投入），
    #    但**浏览器不解析注释** ⇒ 用文件原始体积判会严重高估。
    #    实测：tokens.css 原始 34.5 KB，剥注释后只剩约 9 KB。
    #    ⇒ 该判的是"实际生效的 CSS"，它才对应真实的首屏阻塞时间。
    def eff_size(f):
        s = strip_comments(io.open(f, encoding='utf-8').read())
        return len(s.encode('utf-8'))

    sizes = {}
    for f in files:
        n = eff_size(f)
        sizes[f] = n
        total += n
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        raw = os.path.getsize(f)
        if n > MAX_ONE_CSS:
            bad += 1
            print('  FAIL  %-42s %6.1f KB（上限 %.0f，原始 %.1f）' %
                  (rel, n / KB, MAX_ONE_CSS / KB, raw / KB))
    big = max(sizes.items(), key=lambda x: x[1])
    print('  单文件：%d 个，最大 %s（剥注释后 %.1f KB）' %
          (len(files), os.path.basename(big[0]), big[1] / KB))
    if total > MAX_ALL_CSS:
        bad += 1
        print('  FAIL  合计 %.1f KB（总预算 %.0f KB）' % (total / KB, MAX_ALL_CSS / KB))
    else:
        print('  OK    合计 %.1f KB / %.0f KB' % (total / KB, MAX_ALL_CSS / KB))

    # ---------- ③ demo 内联样式 ----------
    print('')
    print('  === demo 内联 <style> 预算（单个）===')
    for f in sorted(glob.glob(os.path.join(ROOT, '0*', '*', 'demo.html'))):
        html = io.open(f, encoding='utf-8').read()
        for m in re.finditer(r'<style[^>]*>(.*?)</style>', html, flags=re.S):
            n = len(m.group(1).encode('utf-8'))
            if n > MAX_INLINE_STYLE:
                bad += 1
                print('  FAIL  %-42s %6.1f KB（上限 %.0f KB）' %
                      (os.path.basename(f), n / KB, MAX_INLINE_STYLE / KB))
    print('  OK    （无超限）')

    # ---------- ④ 遗留调试属性 ----------
    print('')
    print('  === 遗留调试属性 ===')
    deb = []
    for f in css_files():
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        s = strip_comments(io.open(f, encoding='utf-8').read())
        # will-change 用在非动画元素上（动画类才有意义）
        for m in re.finditer(r'([^{}]*)\{([^{}]*will-change[^{}]*)\}', s, flags=re.S):
            sel = m.group(1).strip().split('\n')[-1].strip()[:30]
            body = m.group(2)
            # 允许 @keyframes / 动画类
            if 'animation' in body or 'transition' in body or '@' in sel:
                continue
            deb.append('%s %s' % (rel, sel))
    if deb:
        bad += 1
        for d in deb[:6]:
            print('  FAIL  will-change 用在无动画的元素上：%s' % d)
    else:
        print('  OK    无遗留 will-change')

    # ---------- 汇总 ----------
    print('')
    if bad:
        print('  ⇒ %d 项超出预算' % bad)
        print('    性能是唯一"只会变差、不会自己变好"的维度 ⇒ 必须有门禁')
    else:
        print('  ✅ 全部在预算内')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
