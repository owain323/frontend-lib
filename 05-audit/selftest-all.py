#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
selftest-all.py — 把所有门禁的反向控制**一次性跑一遍**

🔴 为什么需要（0.8.9 自查发现的真问题）
---------------------------------------------------------------------------
本库的核心口号是「没有反向控制的门禁不算门禁」。但实测：

    `05-audit/` 下有 **26 个脚本支持 `--selftest`**，
    而 `check-all.sh` 里只注册了 **1 个**（`api-form-rev`）。

⇒ 其余 25 个的反向控制**从来没在门禁里跑过**。
  这正是本库自己登记过的那类假绿（`INVARIANT.md` I-10 实证 5）：
  「代码说自己会检查，但没有任何门禁跑它」。

判据
---------------------------------------------------------------------------
  ① 至少发现 N 个自检（零视野守卫：一个都没找到 ⇒ 红）
  ② 每个自检必须 **RC=0**
  ③ **每跑完一个，工作区必须与跑前一致**
     —— 这一条抓的是"自检有副作用"：反向控制会临时改源码，
        还原不彻底就会把工作区弄脏（甚至把变异体留在源码里）。
        实测就是这么抓到 `gen-behavior.py --selftest` 的：
        它用**文本模式**读备份（CRLF→LF 在读取时就丢了），
        还原写回去就把两个源文件的行尾永久改成了 LF。
        ⇒ 内容一字不差，`git diff` 是空的，**只有 `git status` 能看出来**。

⚠️ 判据 ③ 需要 git。没有 git（比如解压出来的 tarball）时：
   **跳过这一条并明说**，不假装通过。

🔴 判据 ④「跑不起来 ≠ 通过」（2026-10-27 加）
---------------------------------------------------------------------------
  实测事故：`MODE=fast` 全跑时报 `selftest-all FAIL`，原因是它内部有
  `motion-concurrency.js --selftest`，而那一条要连 `127.0.0.1:8000`。
  fast 档是纯静态层、**不起服务** ⇒ 该自检打印「跑不起来：ERR_CONNECTION_REFUSED」。

  两个错误处置，都要避免：
    · 把它塞进 SKIP ⇒ 这条自检就永远不跑了（比红灯更糟，是**没人知道**）
    · 看它输出「[FAIL]」就以为已判红 ⇒ 不成立：判红必须靠**退出码**，
      而"跑不起来"和"检查出问题"在语义上完全不同，必须分开报

  ⇒ 正解是**判据自己造前提**：本脚本自己确保 :8000 服务在跑（canary 校验
    服务的是不是这棵树），跑完关掉。这样 fast / full / 单跑三种入口都成立。
  ⇒ 另加一条牙：**RC=0 但输出说"跑不起来"的，判红**。理由是
    「跑不起来」绝不能以任何形式被记成「通过」（INVARIANT I-10）。

用法
---------------------------------------------------------------------------
    python3 05-audit/selftest-all.py
    SKIP_SELFTESTS="a.py,b.py" python3 05-audit/selftest-all.py   # 临时跳过
"""
import atexit
import io
import os
import re
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIT = os.path.join(ROOT, '05-audit')

# 列举式跳过（每条都要写理由）。
# ⚠️ 这里**不写条数** —— 原注释写「当前为空 —— 26 个全都跑得动」，
#    到 2026-10 已经是 51 个自检 + 1 条跳过。数字写死在注释里就是第二个真源，
#    真值只由运行时的「发现 N 个自检」那一行给出。
# ⚠️ 不许用"跑得慢"当理由；只有"需要本机没有的外部条件"或"已在别处注册"才算。
SKIP = {
    # ⚠️ 不是"跑得慢"，是**避免同一条自检在一个批次里跑两遍**：
    #    它要起浏览器（2-8 秒）且需要同源服务，已在 check-all.sh 的浏览器段
    #    注册为 `dist-js-parity-rev`，那里服务一定是活的。
    #    🔴 2026-10-27 措辞修正：本脚本已自备 :8000（见 ensure_server），
    #    所以跳过理由**不再是"跑不起来"**。原措辞写着"本脚本的环境里没有
    #    :8000 服务"，留着会让下一个人以为环境有洞、再"修"一遍。
    'dist-js-parity-gate.js':
        '已在 check-all.sh 浏览器段注册（避免重复跑，不是跑不起来）',
}

# 临时跳过（`SKIP_SELFTESTS="a.py,b.py"`）：给「只想验一条」的场合用。
# 🔴 这个入口此前**只写在文件头文档里，代码里从未实现** —— 文档承诺了一个
#    不存在的参数。补实现而不是删文档，因为它正是「改什么跑什么」的通道：
#    改了某项就只跑那项的反向控制，不必等 70 多条。
for _s in (os.environ.get('SKIP_SELFTESTS') or '').split(','):
    _s = _s.strip()
    if _s:
        SKIP.setdefault(_s, 'SKIP_SELFTESTS 临时跳过')
del _s

TIMEOUT = 180

# 判据 ④ 的触发词。用「冒号」把普通叙述排除掉：
#   "跑不起来：" 是这些脚本自己的失败前缀，不是文档里提一嘴。
BOOT_FAIL = ('ERR_CONNECTION_REFUSED', '跑不起来：')


def candidates():
    out = []
    me = os.path.basename(os.path.abspath(__file__))
    for f in sorted(os.listdir(AUDIT)):
        if not (f.endswith('.py') or f.endswith('.js')):
            continue
        # 🔴 必须排除自己：本文件里也出现了 `--selftest` 这个字面量，
        #    而它**不支持** --selftest ⇒ 一旦被选进来就会跑 main() ⇒ **递归**。
        if f == me:
            continue
        p = os.path.join(AUDIT, f)
        txt = io.open(p, encoding='utf-8', errors='replace').read()
        # 只认"真的实现了 --selftest 分支"的（不是注释里提一句）：
        #   Python 走 `'--selftest' in sys.argv`；JS 走 `argv.indexOf('--selftest')`
        #   ⇒ 判据落在**调用点**上，而不是文档里出现过这个词。
        if f.endswith('.py'):
            hit = re.search(r"['\"]--selftest['\"]\s*(?:in|not in)", txt)
        else:
            hit = re.search(
                r"argv\.(?:indexOf|includes)\(\s*['\"]--selftest['\"]", txt)
        if hit:
            out.append(f)
    return out


def tree_state():
    """工作区快照（相对路径 + 状态）。git 不可用 → None。"""
    try:
        r = subprocess.run(['git', 'status', '--porcelain'],
                           cwd=ROOT, capture_output=True, text=True,
                           timeout=60)
        if r.returncode != 0:
            return None
        return set(l.rstrip() for l in r.stdout.split('\n') if l.strip())
    except Exception:
        return None


# :8000 的服务句柄。只在本脚本**自己起的**时候持有；复用别人的不碰。
_SERVER = {'proc': None}


def _fetch(path, timeout=3):
    with urllib.request.urlopen('http://127.0.0.1:8000' + path,
                                timeout=timeout) as r:
        return r.read()


def ensure_server():
    """确保 :8000 上跑的是**这棵树**。返回 (状态, 说明)。

    为什么由本脚本负责，而不是靠调用者（check-all.sh 已经会起）：
      `selftest-all` 同时也是**可单跑的**（"我改了个门禁，先跑它的自检"），
      而 `MODE=fast` 那一档为了不抢用户端口**故意不起服务**。
      前提不自己造 ⇒ 结果由"今天谁先跑"决定，这正是交接纪律第 8 条。

    canary 为什么必须做：只看"8000 通"会把**另一棵树**当真。
    实测先例见 check-all.sh 的同名注释（源仓库残留服务导致 100+ 道门禁
    量的全是别人的代码）。这里复用的是同一条判据：**字节比对**。
    """
    try:
        local = io.open(os.path.join(ROOT, 'index.html'), 'rb').read()
    except OSError:
        local = None

    try:
        if local is not None and _fetch('/index.html') == local:
            return 'reuse', '复用已在跑的服务（canary 字节一致）'
        return 'wrong-tree', (':8000 上跑的是**另一棵树**（index.html 字节'
                              '与本地不一致）⇒ 自检结果不可信')
    except Exception:
        pass

    proc = subprocess.Popen(
        # 与 check-all.sh 用同一个服务实现：默认 backlog 5 撑不住并发浏览器
        [sys.executable, os.path.join(AUDIT, 'http-serve.py'), '8000'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=ROOT)
    for _ in range(20):
        try:
            got = _fetch('/index.html', 1)
            if local is None or got == local:
                _SERVER['proc'] = proc
                return 'started', '已启动本地静态服务 :8000（canary 字节一致）'
        except Exception:
            time.sleep(0.3)
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()
    return 'failed', '服务起不来（20 次探测全失败）⇒ 依赖 :8000 的自检无法作数'


def stop_server():
    p = _SERVER.get('proc')
    if not p:
        return
    p.terminate()
    try:
        p.wait(timeout=5)
    except Exception:
        p.kill()
    _SERVER['proc'] = None


def run_one(fname):
    p = os.path.join(AUDIT, fname)
    # 解释器按扩展名选：JS 的自检必须用 node 跑（用 python 跑 JS 会 RC=1，
    # 看起来像"自检失败"，实际是跑错了语言 —— 那种红会让人怀疑整个清单）
    exe = 'node' if fname.endswith('.js') else sys.executable
    t0 = time.time()
    try:
        r = subprocess.run([exe, p, '--selftest'],
                           cwd=ROOT, capture_output=True, text=True,
                           encoding='utf-8', errors='replace',
                           timeout=TIMEOUT)
        rc, out = r.returncode, (r.stdout or '') + (r.stderr or '')
    except subprocess.TimeoutExpired:
        rc, out = 124, '超时（%ds）' % TIMEOUT
    return rc, out, int((time.time() - t0) * 1000)


def verdict(rc, out, dirt=''):
    """一次自检的判定。**抽成函数是为了能被自检喂合成样本**（见 selftest）。

    返回 (ok, extra)。ok 只由三件事决定：
      · 退出码 0（唯一的"通过"来源）
      · 没有弄脏工作区（`dirt` 非空即红）
      · 输出里没有"跑不起来"（判据 ④，见文件头）
    """
    extra = dirt
    boot = [k for k in BOOT_FAIL if k in out]
    if rc == 0 and boot:
        extra += '  🔴 输出说「%s」却 RC=0（跑不起来≠通过）' % boot[0]
    return (rc == 0 and not extra), extra


def selftest():
    """判据合成：喂样本，看它该红的时候红、该绿的时候绿。

    这是本库的通用纪律「判据必须有反向控制」用在自己身上。
    之前它没有 —— 于是它漏判「跑不起来但 RC=0」这件事，
    要靠一次 `MODE=fast` 的偶然红才被发现。
    """
    print('  === selftest-all 自身的判据合成 ===')
    cases = [
        # 名称, rc, 输出, 脏文件, 期望
        ('RC=0 且输出干净', 0, 'OK 全部通过', '', True),
        ('RC=0 但说「跑不起来：」', 0,
         '[FAIL] 跑不起来：net::ERR_CONNECTION_REFUSED', '', False),
        ('RC=0 但含 ERR_CONNECTION_REFUSED', 0,
         'net::ERR_CONNECTION_REFUSED at http://127.0.0.1:8000/', '', False),
        ('RC=1 输出无关键词', 1, 'something broke', '', False),
        ('RC=0 但弄脏工作区', 0, 'OK', '  🔴 弄脏工作区: a.css', False),
    ]
    bad = 0
    for name, rc, out, dirt, want in cases:
        got, _ = verdict(rc, out, dirt)
        ok = (got == want)
        print('  %s %-32s 期望=%-5s 实得=%-5s'
              % ('OK ' if ok else '🔴 ', name, want, got))
        if not ok:
            bad += 1
    if bad:
        print('  => %d 个样本判错 ⇒ 判定函数没有鉴别力' % bad)
        return 1
    print('  OK %d 个样本全部判对 ⇒ 判据有牙' % len(cases))
    return 0


def main():
    print('  === 全部门禁的反向控制（--selftest）===')
    print('')

    # 判据 ④ 的前提：有些自检要连 :8000，前提必须自己造（见文件头）。
    srv, srv_msg = ensure_server()
    if srv in ('wrong-tree', 'failed'):
        print('  [FAIL] %s' % srv_msg)
        print('         ⇒ 不继续跑：没有可信的服务，浏览器类自检的结论没有意义。')
        return 2
    atexit.register(stop_server)
    print('  [%s] %s' % ('OK' if srv in ('reuse', 'started') else '??', srv_msg))

    names = [f for f in candidates() if f not in SKIP]
    skipped = [(f, SKIP[f]) for f in candidates() if f in SKIP]

    # ① 零视野守卫
    if not names:
        print('  [FAIL] 一个自检都没找到 ⇒ 这道门禁是**空转**的')
        return 1
    print('  发现 %d 个自检%s'
          % (len(names), '' if not skipped else
             '（另有 %d 个声明跳过）' % len(skipped)))

    has_git = tree_state() is not None
    if has_git:
        base = tree_state()
        print('  工作区快照已取（%d 项已有改动，不计入判据）' % len(base))
    else:
        print('  ⚠️ git 不可用 ⇒ **判据 ③（不得弄脏工作区）跳过**，'
              '这一条本轮不作数')

    print('')
    bad = 0
    dirty = 0
    slow = []
    for f in names:
        rc, out, ms = run_one(f)
        dirt = ''
        if has_git:
            now = tree_state()
            new = now - base if now is not None else set()
            if new:
                dirty += 1
                dirt = '  🔴 弄脏工作区: %s' % ', '.join(sorted(new))[:60]
                base = now          # 避免后续脚本被前面的污染连坐
        ok, extra = verdict(rc, out, dirt)
        print('  %s %-30s RC=%-3d %5dms%s'
              % ('OK ' if ok else '🔴 ', f, rc, ms, extra))
        if not ok:
            bad += 1
            tail = [l for l in out.strip().split('\n') if l.strip()][-4:]
            for l in tail:
                print('        %s' % l[:96])
            # 完整子输出落盘（E150）：这里只印 4 行摘要，一旦出现**不可复现**的红，
            # 摘要往往不够定位。落盘走 internal/（已被 .gitignore 忽略），
            # 不进公开仓库，也不影响判据 —— 只是把证据留在原地。
            try:
                _d = os.path.join(ROOT, 'internal', 'tmp')
                os.makedirs(_d, exist_ok=True)
                _fp = os.path.join(_d, 'selftest-fail-%s.log'
                                   % os.path.splitext(f)[0])
                io.open(_fp, 'w', encoding='utf-8').write(
                    'RC=%d  %dms\n\n%s\n' % (rc, ms, out))
                print('        完整输出已存：%s'
                      % os.path.relpath(_fp, ROOT).replace('\\', '/'))
            except Exception as _e:
                print('        （完整输出落盘失败：%s）' % _e)
        if ms > 5000:
            slow.append((ms, f))

    if skipped:
        print('')
        for f, why in skipped:
            print('  — %-30s 跳过（%s）' % (f, why))

    if slow:
        print('')
        print('  较慢的：%s'
              % ', '.join('%s %dms' % (f, ms) for ms, f in sorted(slow,
                                                                  reverse=True)))

    print('')
    if dirty:
        print('  🔴 %d 个自检**改了工作区**（还原不彻底）' % dirty)
        print('     ⇒ 反向控制会临时改源码，必须**字节级**还原：')
        print('        文本模式 `io.open(p, encoding="utf-8").read()` 会把')
        print('        CRLF 归一成 LF ⇒ 写回去就永久改了行尾，而 `git diff` 是空的。')
        print('        正确做法：备份/还原用 `open(p, "rb")` / `open(p, "wb")`。')
    if bad:
        print('  => %d 个自检未通过' % bad)
        return 1
    print('  OK %d 个反向控制全部通过%s'
          % (len(names), '，且都没有弄脏工作区' if has_git else ''))
    return 0


if __name__ == '__main__':
    # --selftest 必须在 main() **之前**分流：合成样本是纯内存的，
    # 不需要 :8000；否则会为了测一个纯函数去起一个 http server。
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(main())
