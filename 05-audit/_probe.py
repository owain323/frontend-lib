#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
_probe.py — 探测类门禁的公共helper

===========================================================================
为什么需要它
---------------------------------------------------------------------------
  「在真实浏览器里取运行时形状」这类门禁（api-contract / api-form）
  都依赖本地静态服务在 :8000。但它们有两种被调用的场景：

    · check-all.sh 里 —— 服务**已经**在跑
    · 人手动单独跑   —— 服务**没起**

  早期两个门禁各写一套，结果：
    手动跑api-form-gate.py → 全部组件报「找不到」
    （因为 probe 连到了别的页面/没有服务，静默返回空）
  ⇒ **报错信息误导人以为实现坏了，其实是没起服务。**

===========================================================================
正解
---------------------------------------------------------------------------
  本helper 统一负责：
    1. 先探一下 :8000 通不通
    2. 不通就临时起一个（用完杀掉）
    3. 返回一个能拿到 JSON 的调用函数

  ⚠️ 端口被占用时**不杀别人的进程** —— 那是 check-all 起的服务，
     复用即可。只在「连不上」时才自己起。
===========================================================================
"""
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8000


def port_open(port=PORT, host='127.0.0.1', timeout=1.0):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        return s.connect_ex((host, port)) == 0
    except Exception:
        return False
    finally:
        s.close()


class Server(object):
    """按需起一个静态服务；退出时保证杀掉自己起的那个。"""

    def __init__(self):
        self.proc = None
        self.own = False

    def ensure(self):
        if port_open():
            return True                    # 复用已有的
        py = sys.executable or 'python'
        for cand in (py, 'python3', 'python'):
            try:
                self.proc = subprocess.Popen(
                    [cand, '-m', 'http.server', str(PORT)],
                    cwd=ROOT,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL)
            except Exception:
                continue
            # 等它起来（最多 6 秒）
            for _ in range(30):
                time.sleep(0.2)
                if port_open():
                    self.own = True
                    return True
            break
        return port_open()

    def close(self):
        if self.proc and self.own:
            try:
                self.proc.terminate()
                self.proc.wait(timeout=5)
            except Exception:
                try:
                    self.proc.kill()
                except Exception:
                    pass
        self.proc = None

    def __enter__(self):
        self.ensure()
        return self

    def __exit__(self, *a):
        self.close()


def run_probe(js_rel_path, timeout=420):
    """跑一个探测脚本，把 stdout 里的 JSON 解出来。失败返回 None。

    ⚠️ 解析策略：脚本输出前可能混有服务日志 ⇒ 从第一个 '{' 开始解；
       解不动就逐个 '}' 收缩尝试。**不要**直接 json.loads(整个stdout)。
    """
    node = shutil.which('node') or os.environ.get('NODE', 'node')
    js = os.path.join(ROOT, js_rel_path)
    if not os.path.isfile(js):
        return None
    with Server() as _srv:
        p = subprocess.run([node, js], cwd=ROOT,
                           capture_output=True, timeout=timeout)
    out = (p.stdout or b'').decode('utf-8', 'replace')
    i = out.find('{')
    if i < 0:
        return None
    try:
        return json.loads(out[i:])
    except Exception:
        pass
    # 逐段收缩
    for j in range(len(out), i, -1):
        chunk = out[i:j]
        if chunk.count('{') != chunk.count('}'):
            continue
        try:
            return json.loads(chunk)
        except Exception:
            continue
    return None
