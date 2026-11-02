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
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8000

# 🔴 canary：**不能拿"端口有人应答"当"服务是我们的"**
#   实测（2026-11-02，CI 上真实发生、本地可复现）：8000 被另一个进程占着
#   （它服务的是别的根目录）⇒ 每个 demo 页 404 ⇒ 探针拿到 16 个 absent
#   ⇒ 门禁报「ai/components.json 声明了浏览器里不存在的 global」。
#   16 个组件同时"消失"显然不是实现坏了，是**量具连错了地方**。
#   同一课在 with-server.sh 里已经学过一遍（"只要有人应答就算就绪"改成 canary），
#   这里补上：取一个只有本仓库才有的文件，200 且够大才算"是我们的"。
CANARY_PATH = '/01-tokens/tokens.css'


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
        self.base = 'http://127.0.0.1:%d' % PORT

    @staticmethod
    def is_ours(base):
        """canary：这个端口上跑的**是不是本仓库**的静态服务。"""
        try:
            r = urllib.request.urlopen(base + CANARY_PATH, timeout=2)
            return r.getcode() == 200 and len(r.read()) > 1000
        except Exception:
            return False

    @staticmethod
    def free_port():
        s = socket.socket()
        try:
            s.bind(('127.0.0.1', 0))
            return s.getsockname()[1]
        finally:
            s.close()

    def _spawn(self, port):
        """在指定端口起一个自己的静态服务；起来了返回 base，否则 None。"""
        py = sys.executable or 'python'
        for cand in (py, 'python3', 'python'):
            try:
                self.proc = subprocess.Popen(
                    [cand, '-m', 'http.server', str(port), '--bind', '127.0.0.1'],
                    cwd=ROOT,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL)
            except Exception:
                continue
            base = 'http://127.0.0.1:%d' % port
            for _ in range(40):
                time.sleep(0.2)
                if self.is_ours(base):
                    self.own = True
                    return base
            break
        return None

    def ensure(self):
        # ① 8000 上是**本仓库**的服务 ⇒ 复用（历史行为，别动）
        if port_open(PORT) and self.is_ours('http://127.0.0.1:%d' % PORT):
            self.base = 'http://127.0.0.1:%d' % PORT
            return True

        # ② 8000 空着 ⇒ **优先还占 8000**。
        #    🔴 这不是偷懒：全套 30 多个探测脚本里仍有写死 :8000 的
        #       （api-contract.js 等）。把它们全部改成读 BASE 是一次大改，
        #       而在 8000 空着时换随机端口，会让那些脚本**集体拿不到数据**
        #       —— 实测：改完第一版 CI 上 api-contract 立刻红
        #       「拿不到运行时形状」。⇒ 只在 8000 被别人占着时才换端口。
        if not port_open(PORT):
            base = self._spawn(PORT)
            if base:
                self.base = base
                return True

        # ③ 8000 被别人的服务占着 ⇒ 换空闲端口自己起。
        #    绝不复用别人的服务（E265：那会把 404 记成"组件不存在"）。
        port = self.free_port()
        base = self._spawn(port)
        if base:
            self.base = base
            return True
        return False

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
        # 🔴 BASE 必须**传下去**：探测脚本不该自己猜端口。
        #    以前它写死 :8000，于是"服务其实在别的端口"这种事只能靠
        #    运气（8000 恰好也是我们的）才不炸。
        env = dict(os.environ)
        env['BASE'] = _srv.base
        p = subprocess.run([node, js], cwd=ROOT, env=env,
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
