"""Read matching image DPI from macOS pasteboard; never expose clipboard contents."""
import base64
import binascii
import fcntl
import hashlib
import json
import math
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parent
MAX_IMAGE = 18 * 1024 * 1024
_reader = threading.BoundedSemaphore(1)


def cached_helper(root=ROOT):
    source = root / 'native-image-clipboard.swift'
    if not source.is_file():
        return None
    digest = hashlib.sha256(source.read_bytes() + platform.machine().encode()).hexdigest()
    return Path.home() / 'Library/Caches/curve-editor/native-image-clipboard' / digest / 'native-image-clipboard'


def helper_path():
    if sys.platform != 'darwin':
        return None
    bundled = ROOT / 'native-image-clipboard'
    if bundled.is_file():
        return bundled
    cached = cached_helper()
    return cached if cached and cached.is_file() else None


def build_helper(root=ROOT):
    """Compile before publishing. Never compile or install on a paste request."""
    if sys.platform != 'darwin':
        return None
    target = cached_helper(root)
    if target is None:
        raise RuntimeError('缺少本机图片剪贴板源码')
    target.parent.mkdir(parents=True, exist_ok=True)
    with (target.parent / 'build.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if target.is_file():
            return target
        with tempfile.TemporaryDirectory(prefix='compile-', dir=target.parent) as temp:
            binary = Path(temp) / target.name
            result = subprocess.run(['swiftc', '-O', str(root / 'native-image-clipboard.swift'), '-o', str(binary)], capture_output=True, timeout=120)
            if result.returncode:
                raise RuntimeError('本机图片剪贴板编译失败：' + result.stderr.decode(errors='replace')[:2000])
            binary.replace(target)
    return target


def read_metadata(payload):
    if not isinstance(payload, dict) or set(payload) != {'data'} or not isinstance(payload['data'], str):
        raise ValueError('图片剪贴板请求格式无效')
    data = payload['data']
    if not data or len(data) > ((MAX_IMAGE + 2) // 3) * 4:
        raise ValueError('剪贴板图片超过18MB或为空')
    try:
        decoded = base64.b64decode(data, validate=True)
    except (ValueError, binascii.Error):
        raise ValueError('剪贴板图片编码无效') from None
    if not decoded or len(decoded) > MAX_IMAGE:
        raise ValueError('剪贴板图片超过18MB或为空')
    del decoded
    binary = helper_path()
    if binary is None or not _reader.acquire(blocking=False):
        return {'metadata': None}
    try:
        result = subprocess.run([str(binary)], input=json.dumps({'data': data}).encode(), capture_output=True, timeout=4)
        if result.returncode or len(result.stdout) > 4096:
            return {'metadata': None}
        answer = json.loads(result.stdout)
        metadata = answer.get('metadata') if isinstance(answer, dict) else None
        if not isinstance(metadata, dict) or metadata.get('orientation') != 1:
            return {'metadata': None}
        for key in ['dpiX', 'dpiY']:
            value = metadata.get(key)
            if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
                return {'metadata': None}
        return {'metadata': {'dpiX': metadata['dpiX'], 'dpiY': metadata['dpiY'], 'orientation': 1, 'source': 'macos-clipboard', **({'defaultDpi': True} if metadata.get('defaultDpi') is True else {})}}
    except (OSError, subprocess.TimeoutExpired, ValueError, TypeError):
        return {'metadata': None}
    finally:
        _reader.release()


if __name__ == '__main__':
    print(build_helper() or 'Native clipboard is available on macOS only')
