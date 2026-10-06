# -*- coding: utf-8 -*-
"""
_common.py — 门禁脚本共享的常量

===========================================================================
🔴 为什么要有这个文件（2026-10-06 实测踩坑）
---------------------------------------------------------------------------
  同一天里 **三道门禁**（mojibake / viewport / contrast）同时变红，
  根因**完全一样**：`10-review/shots/_current/` 里存的是**截图产物**，
  但扩展名被写成 `.html`（内容其实是 PNG 二进制）。

  ⇒ 任何 `glob('**/*.htm*')` 或 `os.walk` 的门禁都会扫到它们，
    然后报出**莫名其妙的错**（"编码损坏" / "缺 meta viewport" / 直接崩）。

  ⚠️ 最坏的后果不是红，而是**红得没有意义** ——
     大家会习惯性忽略，然后真正的新问题也一起被忽略。

  ⇒ 正解：**产物目录集中在这里定义**，所有门禁从这里 import。
     新增产物目录时只改一处，不会再漏掉某个门禁。
===========================================================================
"""
import os

# ⭐ 视觉回归的产物目录（截图、diff 图、自检产物）。
#    ⚠️ 它们**不是交付物**，不该被任何内容门禁扫描。
#    ⚠️ `_current/` 里的文件扩展名是 .html 但内容是 PNG —— 这是坑的来源。
ARTIFACT_DIRS = (
    '10-review/shots/_current',
    '10-review/shots/_diff',
    '_selftest',
    'node_modules',
    '.git',
)


def is_artifact(path, root=None):
    """判断一个路径是否属于「产物 / 不该被内容门禁扫」"""
    p = str(path).replace(os.sep, '/')
    return any(a in p for a in ARTIFACT_DIRS)


def exclude_artifacts(paths):
    """从路径列表里剔除产物目录里的文件"""
    return [p for p in paths if not is_artifact(p)]


def walk_filtered(root, skip_dirs=None):
    """
    os.walk 的包装：自动跳过产物目录。

    ⚠️ 必须**在遍历时就剪枝**（改 dirnames），
       事后过滤文件名是不行的 —— 那样仍会进到产物目录里。
    用法：
        for dirpath, dirnames, filenames in walk_filtered(ROOT):
            ...
    """
    skip = set(ARTIFACT_DIRS) | set(skip_dirs or ())
    for dirpath, dirnames, filenames in os.walk(root):
        rel = os.path.relpath(dirpath, root).replace(os.sep, '/')
        rel = '' if rel == '.' else rel
        dirnames[:] = [d for d in dirnames
                       if d not in skip
                       and ((rel + '/' + d) if rel else d) not in skip]
        yield dirpath, dirnames, filenames
