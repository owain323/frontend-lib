#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
publish-guard.py — 对外发布内容审核门禁

===========================================================================
🔴 这个门禁为什么存在（公开前对外检查时亲自指出）
---------------------------------------------------------------------------
  把 README 和 commit message 推上 GitHub，里面全是**内部讨论痕迹**：
    · 内部项目代号（ESP32）
    · 内部场景枚举（"录视频 / 做网站 / 做小程序"）
    · 第一人称与对话口吻（"我们"、"你"、"按你的场景选"）
    · 内部流程词（"工单"、"下一步（按顺序来，不跳）"）
    · 个人经历（"门禁反过来纠正过我一次"）

  ⛔ 这些**不是**产品的一部分，是团队内部的思考过程。
  ⛔ 一旦推到公开仓库，读者看到的是"这库是某个人内部讨论的产物"，
     而不是"这是一个可以放心用的库"。

===========================================================================
判据
---------------------------------------------------------------------------
  ① **对外文件**（README / LICENSE / 包元数据）不得出现：
     - 内部项目代号
     - 内部场景枚举
     - 第一人称（我/我们/你）
     - 内部流程词
  ② **提交信息**同样受约束（它也是公开可见的）
  ③ 豁免机制：代码注释里的中文**不算**——
     因为那是给维护者看的，不是给使用者看的。
     ⭐ 本门禁只扫「对外文件」与「commit message」，不扫代码注释。

  ⚠️ 词表分两类：
     · **硬禁**（出现即失败）：内部代号、场景枚举 —— 它们毫无意义且泄漏身份
     · **软警**（出现即提示）：第一人称 —— 有些是正常表达，需要人判断
===========================================================================
"""
import sys
import os
import io
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ============================================================================
# 词表
# ============================================================================

# 硬禁：内部代号 / 内部场景 —— 出现即失败
HARD_BAN = [
    # 内部项目/设备代号
    'ESP' + '32',
    # 内部场景枚举
    '录' + '视频', '做网' + '站', '做小' + '程序',
    # 内部流程词
    '工单', '批次', '作战计划', '复盘',
]

# 软警：第一人称 / 对话口吻 —— 提示，人工判断
SOFT_WARN = [
    '我们', '我', '你',
]

# 对外文件（会被使用者看到）
PUBLIC_FILES = ['README.md', 'LICENSE', 'package.json', 'CHANGELOG.md']


def read(path):
    p = os.path.join(ROOT, path)
    if not os.path.isfile(p):
        return None
    return io.open(p, encoding='utf-8', errors='replace').read()


def scan_text(text, label, hard, soft):
    hits_hard = []
    hits_soft = []
    for w in hard:
        # 用中文安全的边界：直接子串匹配即可（这些词不会被英文单词误伤）
        n = text.count(w)
        if n:
            lines = [i + 1 for i, l in enumerate(text.split('\n')) if w in l]
            hits_hard.append((w, n, lines[:4]))
    for w in soft:
        n = text.count(w)
        if n:
            lines = [i + 1 for i, l in enumerate(text.split('\n')) if w in l]
            hits_soft.append((w, n, lines[:4]))
    return hits_hard, hits_soft


def commit_messages(limit=30):
    try:
        out = subprocess.run(['git', 'log', '-n', str(limit), '--pretty=%H%x09%s%x09%b'],
                             cwd=ROOT, capture_output=True, timeout=30)
        if out.returncode != 0:
            return None
        txt = out.stdout.decode('utf-8', errors='replace')
        return [l for l in txt.split('\n') if l.strip()]
    except Exception:
        return None


def main():
    bad = 0
    warn = 0

    print('  === 对外发布审核（零内部痕迹）===')
    print('')

    # ---------- ① 对外文件 ----------
    print('  【对外文件】')
    found_any = False
    for f in PUBLIC_FILES:
        t = read(f)
        if t is None:
            continue
        found_any = True
        h, s = scan_text(t, f, HARD_BAN, SOFT_WARN)
        if h:
            bad += 1
            print('  🔴 %s 命中硬禁词：' % f)
            for w, n, lines in h:
                print('       「%s」×%d  行 %s' % (w, n, lines))
        if s:
            warn += 1
            print('  ⚠️  %s 含第一人称/对话口吻：' % f)
            for w, n, lines in s:
                print('       「%s」×%d  行 %s' % (w, n, lines))
    if not found_any:
        print('  （未找到对外文件）')
    elif bad == 0 and warn == 0:
        print('  ✅ 对外文件干净')

    # ---------- ② 提交信息 ----------
    print('')
    print('  【提交信息】（公开可见，同样受约束）')
    msgs = commit_messages()
    if msgs is None:
        print('  SKIP  取不到 git log')
    else:
        cbad = 0
        for line in msgs:
            parts = line.split('\t')
            subj = parts[1] if len(parts) > 1 else ''
            body = parts[2] if len(parts) > 2 else ''
            text = subj + '\n' + body
            h, _s = scan_text(text, 'commit', HARD_BAN, [])
            if h:
                cbad += 1
                for w, n, _lines in h:
                    print('  🔴 %s  命中「%s」' % (subj[:44], w))
        if cbad:
            bad += cbad
            print('')
            print('  ⇒ 需要重写这些提交信息（git rebase 或重建历史）')
        else:
            print('  ✅ 提交信息干净')

    # ---------- 汇总 ----------
    print('')
    if bad:
        print('  ⇒ 🔴 有 %d 处硬禁内容**不能发布**' % bad)
        print('    硬禁 = 内部代号 / 内部场景 / 内部流程词')
        print('    这些对外读者毫无意义，且泄漏团队内部过程')
        return 1
    if warn:
        print('  ⇒ ⚠️ 有 %d 处第一人称/对话口吻，需人工判断' % warn)
        print('    （README 面向使用者，应避免"我们"、"你"）')
        return 0
    print('  ✅ 对外内容干净')
    return 0


if __name__ == '__main__':
    sys.exit(main())
