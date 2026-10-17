# -*- coding: utf-8 -*-
"""按**内容**读字节的统一入口（行尾无关）。

🔴 为什么必须统一（0.8.9 · 决策项 D4 的第 ① 步）
---------------------------------------------------------------------------
本库有多处按字节记账：

    · `dist/manifest.json` 的 `sourceSha256` / `sourceBytes` / `sourceGzip`
    · `05-audit/size-baseline.json` 的 `raw` / `gzip`
    · README 里"全库 CSS 371.7 KB 原始里 236.3 KB 是注释"这类对外数字

而**工作区的行尾是混合的**（实测：300 个文件 CRLF / 80 个 LF）。
同一份内容在不同机器、不同 `core.autocrlf` 设置下，磁盘字节数不同
⇒ 任何"记下数字再比对"的判据都会变成**绑定了某台机器**，
在别人的 clone 里假红（而 `git diff` 是空的，极难查）。

⇒ 统一在这里把 `\r\n` 归一成 `\n` 再算哈希 / 量字节。
   这样"内容没变"在任何机器上都是同一个数字。

⚠️ 只对**文本**用。二进制（png / glb / woff2 / zip）绝不能走这里 ——
   归一化会毁掉它。`read_norm()` 会拒绝非文本扩展名。
"""
import gzip
import hashlib
import io
import os

# 会被按内容记账的文本扩展名（与 build-dist / size-baseline 的范围一致）
TEXT_EXTS = ('.css', '.js', '.mjs', '.html', '.htm', '.json', '.md',
             '.txt', '.yml', '.yaml', '.svg', '.ts', '.d.ts')


def is_text(path):
    low = path.lower()
    return low.endswith(TEXT_EXTS)


def read_norm(path):
    """→ 归一后的字节（`\\r\\n` → `\\n`）。非文本文件直接抛错，不静默放行。"""
    if not is_text(path):
        raise ValueError(
            'read_norm 只接受文本文件（%s）；二进制归一化会毁掉内容' % path)
    with io.open(path, 'rb') as f:
        return f.read().replace(b'\r\n', b'\n')


def size(path):
    """归一后的字节数。"""
    return len(read_norm(path))


def gzip_size(path, level=9):
    """归一后的 gzip 字节数（线上传输量看这个，不看原始大小）。"""
    return len(gzip.compress(read_norm(path), level))


def sha256(path):
    """归一后的 sha256（内容指纹，与磁盘行尾无关）。"""
    return hashlib.sha256(read_norm(path)).hexdigest()


# ---------------------------------------------------------------------------
# 自检：证明"行尾不影响结果"，而且"二进制被拒绝"
# ---------------------------------------------------------------------------
def _selftest():
    import tempfile
    tmp = tempfile.mkdtemp(prefix='bytes-')
    bad = 0

    def chk(label, got, want):
        nonlocal bad
        ok = got == want
        print('  %s %-40s %r' % ('OK ' if ok else '🔴 ', label, got))
        if not ok:
            print('       want %r' % (want,))
            bad += 1

    crlf = os.path.join(tmp, 'a.css')
    lf = os.path.join(tmp, 'b.css')
    with io.open(crlf, 'wb') as f:
        f.write(b'.a {\r\n  color: red;\r\n}\r\n')
    with io.open(lf, 'wb') as f:
        f.write(b'.a {\n  color: red;\n}\n')

    chk('CRLF 与 LF 的 sha256 相同', sha256(crlf), sha256(lf))
    chk('CRLF 与 LF 的 size 相同', size(crlf), size(lf))
    chk('CRLF 与 LF 的 gzip 相同', gzip_size(crlf), gzip_size(lf))
    chk('size 等于归一后的字节数', size(crlf), len(b'.a {\n  color: red;\n}\n'))
    # 二进制必须被拒绝（而不是被悄悄归一化）
    png = os.path.join(tmp, 'x.png')
    with io.open(png, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
    try:
        read_norm(png)
        chk('二进制被拒绝', 'no-raise', 'ValueError')
    except ValueError:
        chk('二进制被拒绝', 'ValueError', 'ValueError')

    print('')
    print('  ' + ('🔴 %d 条自检未通过' % bad if bad
                  else '自检全部通过 ⇒ 行尾不影响结果、二进制会被拒绝'))
    return 1 if bad else 0


if __name__ == '__main__':
    import sys
    sys.exit(_selftest())
