"""Local editor discovery and display names; never stores artwork or chat content."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener

HTTP = build_opener(ProxyHandler({}))


def edition():
    value = os.environ.get('CURVE_EDITOR_EDITION', 'official')
    if value not in {'official', 'test'}:
        raise ValueError('CURVE_EDITOR_EDITION 只能是 official 或 test')
    return value


def directory():
    configured = os.environ.get('CURVE_EDITOR_REGISTRY')
    if configured:
        return Path(configured).expanduser()
    name = 'test-editors' if edition() == 'test' else 'editors'
    return Path.home() / 'Library/Application Support/CurveEditor' / name


def scope():
    """Stable identity for one canonical registry directory."""
    canonical = directory().resolve()
    return hashlib.sha256(os.fsencode(str(canonical))).hexdigest()


def in_scope(info):
    """Accept old services, but never cross a scope declared by a new service."""
    return bool(info) and ('registryScope' not in info or info['registryScope'] == scope())


def compatible(info):
    """A process only manages services from its own registry and edition."""
    return in_scope(info) and info.get('edition', 'official') == edition()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as file:
            json.dump(value, file, ensure_ascii=False)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def valid_name(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 80 or any(ord(c) < 32 for c in value):
        raise ValueError('名称需为 1—80 个字符，不可包含换行或控制字符')
    return value.strip()


def session_title(identifier):
    home = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex')))
    for file in sorted(home.glob('state_*.sqlite'), reverse=True):
        try:
            with sqlite3.connect(file.as_uri() + '?mode=ro', uri=True, timeout=.2) as db:
                row = db.execute('SELECT title FROM threads WHERE id = ?', (identifier,)).fetchone()
            if row and row[0]:
                return valid_name(' '.join(row[0].split())[:80])
        except (sqlite3.Error, ValueError, OSError):
            continue
    return None


def metadata_path(saves):
    return Path(saves) / '.editor.json'


def drawing_id(saves):
    """One drawing per save workspace, independent of names, ports and clients."""
    return '图-' + hashlib.sha256(os.fsencode(str(Path(saves).resolve()))).hexdigest()[:12]


def last_saved_edit(saves):
    try:
        name = (Path(saves) / 'latest.txt').read_text().strip()
        if Path(name).name == name and name.endswith('.json'):
            return (Path(saves) / name).stat().st_mtime
    except OSError:
        pass
    return 0


def metadata(saves, workspace, project, name=None, blank=False):
    path = metadata_path(saves)
    try:
        saved = json.loads(path.read_text())
        saved['name'] = valid_name(saved['name'])
    except (OSError, ValueError, KeyError, TypeError):
        default = (session_title(workspace['id']) if workspace['mode'] == 'isolated' else None)
        default = default or (workspace['id'] if workspace['mode'] == 'shared' and workspace['id'] != 'default'
                              else Path(project).name + ' · ' + workspace['id'][:8])
        saved = {'name': valid_name(default[:80]), 'blank': bool(blank)}
    if name is not None:
        saved['name'] = valid_name(name)
    if type(saved.get('blank')) is not bool:
        saved['blank'] = bool(blank)
    identifier = saved.get('drawingId')
    if (not isinstance(identifier, str) or not identifier.startswith('图-')
            or len(identifier) != 14 or any(c not in '0123456789abcdef' for c in identifier[2:])):
        saved['drawingId'] = drawing_id(saves)
    last_edited = saved.get('lastEditedAt')
    if (type(last_edited) not in (int, float) or not math.isfinite(last_edited)
            or last_edited < 0):
        saved['lastEditedAt'] = last_saved_edit(saves)
    created = saved.get('createdAt')
    if type(created) not in (int, float) or not math.isfinite(created) or created < 0:
        try:
            saved['createdAt'] = path.stat().st_mtime
        except OSError:
            saved['createdAt'] = time.time()
    atomic_json(path, saved)
    return saved


def entries():
    result = []
    for file in directory().glob('*.json'):
        try:
            entry = json.loads(file.read_text())
            if (not isinstance(entry, dict) or entry.get('id') != file.stem
                    or not all(isinstance(entry.get(key), str)
                               for key in ('name', 'url', 'project', 'saves'))
                    or type(entry.get('created')) not in (int, float)
                    or not math.isfinite(entry['created'])):
                continue
            local_base(entry['url'])
            result.append(entry)
        except (OSError, ValueError, TypeError):
            continue
    return result


def store(entry):
    atomic_json(directory() / (entry['id'] + '.json'), entry)
    return entry


def find(identifier):
    if not isinstance(identifier, str) or len(identifier) != 64 or any(c not in '0123456789abcdef' for c in identifier):
        raise ValueError('编辑器标识无效')
    try:
        entry = json.loads((directory() / (identifier + '.json')).read_text())
        if entry['id'] != identifier:
            raise ValueError('编辑器标识无效')
        return entry
    except (OSError, KeyError, TypeError):
        raise ValueError('该编辑器已关闭，请重新打开列表') from None


def local_base(url):
    parsed = urlsplit(url)
    if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or not parsed.port or parsed.username or parsed.password:
        raise ValueError('编辑器地址必须是本机回环地址')
    return f'http://127.0.0.1:{parsed.port}'


def request(url, path, data=None, token=None, timeout=.4):
    base = local_base(url)
    headers = {'Origin': base, 'Content-Type': 'application/json'}
    if token:
        headers['X-Editor-Token'] = token
    req = Request(base + path, data=None if data is None else json.dumps(data).encode(), headers=headers)
    with HTTP.open(req, timeout=timeout) as response:
        return json.load(response)


def health(url):
    try:
        result = request(url, '/api/health')
        if result.get('app') == 'daban-curve-editor-v1' and isinstance(result.get('project'), str) and isinstance(result.get('saves'), str):
            return result
    except (OSError, ValueError, AttributeError, TypeError):
        pass
    return None


def matches(entry, info):
    return (compatible(info) and entry.get('edition', 'official') == edition()
            and info.get('project') == entry.get('project') and info.get('saves') == entry.get('saves')
            and info.get('workspace', {'mode': 'shared', 'id': 'default'}) == entry.get('workspace')
            and info.get('instance') == entry.get('instance'))


def register(url, info, token=None, pid=None):
    if not compatible(info):
        raise ValueError('编辑器属于另一个本机列表或版本')
    workspace = info.get('workspace', {'mode': 'shared', 'id': 'default'})
    key_parts = [info['project'], info['saves'], urlsplit(url).query]
    if edition() != 'official':
        key_parts.append(edition())
    key = json.dumps(key_parts, ensure_ascii=False)
    identifier = hashlib.sha256(key.encode()).hexdigest()
    try:
        previous = find(identifier)
    except ValueError:
        previous = {}
    name = info.get('editor', {}).get('name') or previous.get('name') or session_title(workspace['id'])
    name = name or ('旧版项目存档' if workspace['id'] == 'default' else workspace['id'][:80])
    return store({'id': identifier, 'name': name, 'url': url, 'project': info['project'],
                  'saves': info['saves'], 'workspace': workspace, 'pid': pid,
                  'registryScope': scope(), 'edition': edition(),
                  'instance': info.get('instance'), 'token': token, 'legacy': not bool(token),
                  'drawingId': info.get('editor', {}).get('drawingId') or drawing_id(info['saves']),
                  'lastEditedAt': info.get('editor', {}).get('lastEditedAt', previous.get('lastEditedAt', 0)),
                  'hidden': False, 'created': previous.get('created', info.get('editor', {}).get('createdAt', time.time()))})


def unregister(instance):
    for entry in entries():
        if instance and entry.get('instance') == instance:
            (directory() / (entry['id'] + '.json')).unlink(missing_ok=True)


def discover():
    records = entries()
    scan = os.environ.get('CURVE_EDITOR_SCAN_PORTS')
    ports = range(8767, 8867) if scan is None else [int(p) for p in scan.split(',') if p]
    urls = {local_base(e['url']) for e in records} | {f'http://127.0.0.1:{p}' for p in ports}
    with ThreadPoolExecutor(max_workers=16) as pool:
        infos = dict(zip(sorted(urls), pool.map(health, sorted(urls))))
    infos = {url: info if compatible(info) else None for url, info in infos.items()}
    known = {local_base(e['url']) for e in records if matches(e, infos.get(local_base(e['url'])))}
    for url, info in infos.items():
        if info and url not in known:
            # A legacy shared service has no launch-client information. Keep its
            # existing bare URL instead of inventing a different member identity.
            register(url, info)
    result = []
    for entry in entries():
        info = infos.get(local_base(entry['url']))
        if entry.get('hidden') or not matches(entry, info):
            continue
        if info.get('editor', {}).get('name'):
            entry['name'] = info['editor']['name']
        entry['edition'] = info.get('edition', entry.get('edition', 'official'))
        entry['drawingId'] = info.get('editor', {}).get('drawingId') or drawing_id(entry['saves'])
        entry['lastEditedAt'] = info.get('editor', {}).get('lastEditedAt',
                                    entry.get('lastEditedAt') or last_saved_edit(entry['saves']))
        result.append({k: v for k, v in entry.items() if k not in {'token', 'pid', 'instance', 'hidden'}})
    return sorted(result, key=lambda e: (e['lastEditedAt'] or e['created'], e['created'], e['id']), reverse=True)
