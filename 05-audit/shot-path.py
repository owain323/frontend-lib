#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
shot-path.py — 截图必须落在**库内**，不许落 Temp

背景
--------------------------------
点击开我给的截图**打不开**，还伴随网络报错。

真因：**把截图写到了 `/tmp/fe-shots/`**。
两个问题：
  ① `AppData/Local/Temp` 是**系统清理区** ⇒ 随时会消失
  ② 路径在库外 ⇒ IDE 的文件解析/预览可能拿不到

⇒ 从此**截图一律落 `10-review/shots/`（库内）**。

这个脚本的作用：防止再犯。
"""
import sys
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _is_temp_path(s):
    """这个路径是不是落在系统临时区。

    🔴 第一版写成一条正则 `AppData[/\\]Local[/\\]Temp`，
       **判别力验证没抓到** —— 反斜杠在字符类里被当成转义，
       实际路径匹配不上。
    ⇒ 改成**先把反斜杠统一成斜杠，再做子串判断**，不靠正则。
    """
    t = s.replace('\\', '/')
    return ('AppData/Local/Temp' in t
            or '/tmp/' in t
            or '/private/tmp/' in t)

def main():
    bad = []
    for f in glob.glob(os.path.join(ROOT, '05-audit', '*.js')) + \
             glob.glob(os.path.join(ROOT, '05-audit', '*.py')):
        # 🔴 排除**本脚本自己** —— 它的文档里提到了那个路径（那是说明，不是配置）
        if os.path.basename(f) == 'shot-path.py':
            continue
        try:
            for i, line in enumerate(open(f, encoding='utf-8',
                                          errors='replace'), 1):
                if 'screenshot' not in line and 'shots' not in line:
                    continue
                if _is_temp_path(line):
                    bad.append((os.path.relpath(f, ROOT), i, line.strip()[:66]))
        except OSError:
            pass
    if bad:
        print('  [FAIL] 有 %d 处把截图写到临时目录（点击开会打不开）：' % len(bad))
        for f, i, t in bad:
            print('     · %s L%d  %s' % (f, i, t))
        print('')
        print('  改法：路径换成 10-review/shots/（库内）')
        return 1
    print('  [OK  ] 截图路径全部在库内 10-review/shots/')
    return 0

if __name__ == '__main__':
    sys.exit(main())
