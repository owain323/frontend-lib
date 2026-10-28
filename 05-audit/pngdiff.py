"""
pngdiff.py — 零依赖的 PNG 解码 / 比对 / 写出
============================================================================
为什么要有这个文件
----------------------------------------------------------------------------
视觉回归此前依赖 Pillow：

    def _try_pil():
        try:
            from PIL import Image
        except ImportError:
            return None
    ...
    if not Image:
        return None, ['缺少 Pillow（pip install pillow）才能做逐像素 diff']

于是**没装 Pillow 的机器上这道门禁直接跳过**。而本仓库自己定的规矩是
「跳过不是通过」—— 也就是说，日常改样式的这条防线在多数环境里根本不存在。
装一次 Pillow 只是让**我这台机器**不跳过，判据本体仍然挂在可选依赖上。

⇒ 正确的修法不是"请大家装 Pillow"，而是把依赖拿掉：
   PNG 是 zlib + 5 种行过滤，用标准库 40 行就能解。解出来之后
   「缺依赖 ⇒ 跳过」这条路径从代码里**消失**，跳过就不再是一个选项。

设计约束
----------------------------------------------------------------------------
  ① **只解我们真的会遇到的格式**：8 位、非隔行、RGB / RGBA / 灰度 /
     灰度+alpha / 调色板。遇到别的**明确报错**，不猜 —— 猜错会变成
     "图看起来一样但其实没比"。
  ② 比对语义与旧实现**逐字一致**（分块 32×32、块阈值 3%、全页 0.5%、
     通道容差 12），否则换了实现等于换了判据，历史基线全部失去意义。
  ③ 速度：逐像素 Python 循环在 150 万像素上太慢，先按行做字节比较，
     整行相同就整行跳过 —— 未改动的页面基本瞬间出结果。
============================================================================
"""

import os
import struct
import zlib

PNG_SIG = b'\x89PNG\r\n\x1a\n'

_CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}


class PngError(Exception):
    """解不了就抛这个 —— **不要静默返回空图**。"""


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def read_png(path):
    """返回 (w, h, rgb_bytes)。rgb_bytes 是 w*h*3，逐行紧密排列。"""
    with open(path, 'rb') as f:
        data = f.read()
    if not data.startswith(PNG_SIG):
        raise PngError('不是 PNG：' + os.path.basename(path))

    pos = 8
    ihdr = None
    palette = b''
    idat = []
    while pos < len(data):
        (length,) = struct.unpack('>I', data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b'IHDR':
            ihdr = struct.unpack('>IIBBBBB', body)
        elif ctype == b'PLTE':
            palette = body
        elif ctype == b'IDAT':
            idat.append(body)
        elif ctype == b'IEND':
            break

    if ihdr is None:
        raise PngError('没有 IHDR：' + path)
    w, h, depth, color, comp, filt, interlace = ihdr
    if depth != 8:
        raise PngError('只支持 8 位色深，实际 %d：%s' % (depth, path))
    if interlace != 0:
        raise PngError('不支持隔行 PNG：' + path)
    if color not in _CHANNELS:
        raise PngError('不支持的颜色类型 %d：%s' % (color, path))

    ch = _CHANNELS[color]
    stride = w * ch
    raw = zlib.decompress(b''.join(idat))

    # ---- 反过滤（5 种行过滤，标准算法）----
    out = bytearray(stride * h)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        ft = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if ft == 0:
            pass
        elif ft == 1:          # Sub
            for i in range(ch, stride):
                line[i] = (line[i] + line[i - ch]) & 0xFF
        elif ft == 2:          # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:          # Average
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ft == 4:          # Paeth
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                c = prev[i - ch] if i >= ch else 0
                line[i] = (line[i] + _paeth(a, prev[i], c)) & 0xFF
        else:
            raise PngError('未知行过滤 %d：%s' % (ft, path))
        out[y * stride:(y + 1) * stride] = line
        prev = line

    # ---- 统一成 RGB ----
    if color == 2:
        return w, h, bytes(out)
    if color == 6:
        rgb = bytearray(w * h * 3)
        for i in range(w * h):
            rgb[i * 3:i * 3 + 3] = out[i * 4:i * 4 + 3]
        return w, h, bytes(rgb)
    if color == 0:
        rgb = bytearray(w * h * 3)
        for i in range(w * h):
            v = out[i]
            rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = v
        return w, h, bytes(rgb)
    if color == 4:
        rgb = bytearray(w * h * 3)
        for i in range(w * h):
            v = out[i * 2]
            rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = v
        return w, h, bytes(rgb)
    if color == 3:
        rgb = bytearray(w * h * 3)
        for i in range(w * h):
            idx = out[i] * 3
            rgb[i * 3:i * 3 + 3] = palette[idx:idx + 3]
        return w, h, bytes(rgb)
    raise PngError('未能转换的颜色类型 %d' % color)


def write_png(path, w, h, rgb):
    """写 8 位 RGB PNG（filter 0）。用于产出 diff 图。"""
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += rgb[y * w * 3:(y + 1) * w * 3]

    def chunk(tag, body):
        return (struct.pack('>I', len(body)) + tag + body +
                struct.pack('>I', zlib.crc32(tag + body) & 0xFFFFFFFF))

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    with open(path, 'wb') as f:
        f.write(PNG_SIG)
        f.write(chunk(b'IHDR', ihdr))
        f.write(chunk(b'IDAT', zlib.compress(bytes(raw), 6)))
        f.write(chunk(b'IEND', b''))


def compare(a_path, b_path, diff_path=None, tile=32, tile_pct=3.0,
            page_pct=0.5, tolerance=12):
    """逐块比对两图。

    返回 dict：
      ok         是否通过
      pct        全页差异百分比
      bad_tiles  [(tx, ty, pct), ...] 超块阈值的块
      size       (a 的尺寸, b 的尺寸) —— 尺寸不同时由调用方解释原因
    """
    aw, ah, a = read_png(a_path)
    bw, bh, b = read_png(b_path)
    if (aw, ah) != (bw, bh):
        return {'ok': False, 'pct': 100.0, 'bad_tiles': [],
                'size': ((aw, ah), (bw, bh)), 'size_mismatch': True}

    # 按行切开，整行相同就整行跳过（未改动的页面几乎零成本）
    a_rows = [a[y * aw * 3:(y + 1) * aw * 3] for y in range(ah)]
    b_rows = [b[y * bw * 3:(y + 1) * bw * 3] for y in range(bh)]

    diff = bytearray(aw * ah * 3) if diff_path else None
    n = 0
    bad_tiles = []

    for ty in range(0, ah, tile):
        for tx in range(0, aw, tile):
            x1 = min(tx + tile, aw)
            ys = range(ty, min(ty + tile, ah))
            same = True
            for y in ys:
                if a_rows[y][tx * 3:x1 * 3] != b_rows[y][tx * 3:x1 * 3]:
                    same = False
                    break
            if same:
                if diff is not None:
                    for y in ys:
                        for x in range(tx, x1):
                            v = b_rows[y][x * 3]
                            diff[(y * aw + x) * 3:(y * aw + x) * 3 + 3] = bytes((v, v, v))
                continue

            tn = 0
            ttot = 0
            for y in ys:
                ar = a_rows[y]
                br = b_rows[y]
                for x in range(tx, x1):
                    ttot += 1
                    i = x * 3
                    dr = abs(ar[i] - br[i])
                    dg = abs(ar[i + 1] - br[i + 1])
                    db = abs(ar[i + 2] - br[i + 2])
                    if dr > tolerance or dg > tolerance or db > tolerance:
                        tn += 1
                        n += 1
                        if diff is not None:
                            diff[(y * aw + x) * 3:(y * aw + x) * 3 + 3] = b'\xff\x00\x00'
                    elif diff is not None:
                        v = br[i]
                        diff[(y * aw + x) * 3:(y * aw + x) * 3 + 3] = bytes((v, v, v))
            p = 100.0 * tn / max(1, ttot)
            if p > tile_pct:
                bad_tiles.append((tx, ty, p))

    pct = 100.0 * n / (aw * ah)
    if diff_path:
        write_png(diff_path, aw, ah, bytes(diff))
    return {'ok': not (bad_tiles or pct > page_pct), 'pct': pct,
            'bad_tiles': bad_tiles, 'size': ((aw, ah), (bw, bh)),
            'size_mismatch': False}


# ---------------------------------------------------------------- 自检
def _synthetic(w, h, paint):
    rgb = bytearray(w * h * 3)
    for y in range(h):
        for x in range(w):
            r, g, b = paint(x, y)
            i = (y * w + x) * 3
            rgb[i] = r
            rgb[i + 1] = g
            rgb[i + 2] = b
    return bytes(rgb)


def selftest(tmpdir):
    bad = 0

    def case(why, ok):
        nonlocal bad
        if not ok:
            bad += 1
        print('  ' + ('OK ' if ok else 'RED') + ' ' + why)

    def roundtrip(name, w, h, rgb):
        p = os.path.join(tmpdir, name)
        write_png(p, w, h, rgb)
        gw, gh, back = read_png(p)
        return p, (gw, gh) == (w, h) and back == rgb

    base = _synthetic(64, 64, lambda x, y: (200, 200, 200))
    p1, ok1 = roundtrip('a.png', 64, 64, base)
    case('编解码往返一致（64×64 纯色）', ok1)

    # 同一张图 ⇒ 必须通过
    r = compare(p1, p1)
    case('自己比自己 ⇒ 通过（差异 0%）', r['ok'] and r['pct'] == 0)

    # 一块 8×8 变黑 ⇒ 必须红（局部退化，正是这个判据存在的理由）
    dirty = bytearray(base)
    for y in range(10, 18):
        for x in range(10, 18):
            i = (y * 64 + x) * 3
            dirty[i:i + 3] = b'\x00\x00\x00'
    p2, ok2 = roundtrip('b.png', 64, 64, bytes(dirty))
    case('一块 8×8 变色能被写出并读回', ok2)
    r = compare(p1, p2)
    case('局部 8×8 改动 ⇒ 判失败（块阈值生效）', not r['ok'] and len(r['bad_tiles']) >= 1)

    # 全页轻微抖动（在容差内）⇒ 必须通过，否则抗锯齿噪声会天天假红
    noisy = _synthetic(64, 64, lambda x, y: (200 + (x % 3) - 1,) * 3)
    p3, _ = roundtrip('c.png', 64, 64, noisy)
    r = compare(p1, p3)
    case('±1 抖动在容差内 ⇒ 通过（不假红）', r['ok'])

    # 尺寸不同 ⇒ 必须判失败并带回尺寸
    p4, _ = roundtrip('d.png', 32, 32, _synthetic(32, 32, lambda x, y: (200, 200, 200)))
    r = compare(p1, p4)
    case('尺寸不同 ⇒ 判失败且能说明尺寸',
         (not r['ok']) and r['size_mismatch'] and r['size'] == ((64, 64), (32, 32)))

    print('')
    print('  ⇒ ' + ('🔴 自检 ' + str(bad) + ' 条不成立' if bad else '✅ 自检全部成立'))
    return bad


if __name__ == '__main__':
    import sys
    import tempfile
    if '--selftest' in sys.argv:
        d = tempfile.mkdtemp(prefix='pngdiff-')
        sys.exit(1 if selftest(d) else 0)
    print('用法：python3 05-audit/pngdiff.py --selftest')
