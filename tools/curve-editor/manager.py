#!/usr/bin/env python3
"""JSON command bridge for the native menu bar. Uses only loopback services."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import socket
import sys
import time
import uuid
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

import editor_registry as registry


def active(identifier):
    entry = registry.find(identifier)
    info = registry.health(entry['url'])
    if not registry.matches(entry, info):
        raise ValueError('该编辑器已关闭，请重新打开列表')
    return entry


def create(project, name):
    name = registry.valid_name(name)
    project = Path(project).expanduser().resolve()
    if not project.is_dir():
        raise ValueError('项目文件夹不存在')
    identity = 'page-' + str(uuid.uuid4())
    registry.directory().mkdir(parents=True, exist_ok=True)
    with (registry.directory() / 'launch.log').open('ab') as log:
        child = subprocess.Popen([sys.executable, str(Path(__file__).with_name('server.py')),
                                  '--project', str(project), '--port', 'auto', '--session', identity,
                                  '--name', name, '--blank'], stdin=subprocess.DEVNULL,
                                 stdout=log, stderr=log, start_new_session=True)
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        for entry in registry.entries():
            if entry.get('project') == str(project) and entry.get('workspace', {}).get('id') == identity:
                if registry.health(entry['url']):
                    return {k: v for k, v in entry.items() if k not in {'token', 'pid', 'instance', 'hidden'}}
        if child.poll() is not None:
            raise ValueError('新页面启动失败，请检查项目文件夹是否可写或端口是否已满')
        time.sleep(.05)
    child.terminate()
    raise ValueError('新页面启动超时，请重新尝试')


def rename(identifier, name):
    name = registry.valid_name(name)
    entry = active(identifier)
    if entry.get('token'):
        registry.request(entry['url'], '/api/manage', {'action': 'rename', 'name': name}, entry['token'], timeout=3)
        for other in registry.entries():
            if other.get('instance') == entry['instance']:
                other['name'] = name; registry.store(other)
    else:
        entry['name'] = name; registry.store(entry)
    return {**{k: v for k, v in entry.items() if k not in {'token', 'pid', 'instance', 'hidden'}}, 'name': name}


def remove(identifier):
    entry = registry.find(identifier)
    info = registry.health(entry['url'])
    if not registry.matches(entry, info):
        (registry.directory() / (identifier + '.json')).unlink(missing_ok=True)
        return
    others = [e for e in registry.entries() if e['id'] != identifier and not e.get('hidden')
              and entry.get('instance') and e.get('instance') == entry['instance']]
    if entry.get('token') and not others:
        registry.request(entry['url'], '/api/manage', {'action': 'close'}, entry['token'], timeout=3)
    entry['hidden'] = True
    registry.store(entry)


def restart_candidates():
    """Only revive registered workspaces whose on-disk identity still agrees."""
    groups = {}
    for entry in registry.entries():
        if (entry.get('hidden') or entry.get('registryScope') != registry.scope()
                or entry.get('edition') != registry.edition()):
            continue
        try:
            base = registry.local_base(entry['url'])
            project = Path(entry['project']).resolve()
            workspace = entry['workspace']
            mode, identity = workspace['mode'], workspace['id']
            if mode not in ('shared', 'isolated') or not isinstance(identity, str) or not identity.strip():
                continue
            root = project / 'work/curve_editor' / ('test-sessions' if registry.edition() == 'test' else 'sessions')
            legacy = mode == 'shared' and identity == 'default'
            saves = root if legacy else root / mode / hashlib.sha256(identity.encode()).hexdigest()
            if str(saves) != entry['saves'] or saves.resolve() != saves:
                continue
            metadata = json.loads((saves / '.editor.json').read_text())
            state = json.loads(((saves.parent if legacy else saves) / 'server.json').read_text())
            if (metadata.get('drawingId') != entry.get('drawingId')
                    or state.get('port') != urlsplit(base).port
                    or state.get('project') != str(project) or state.get('workspace') != workspace):
                continue
            groups.setdefault((base, str(saves)), []).append(entry)
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            continue
    return list(groups.values())


def port_open(url):
    with socket.socket() as connection:
        connection.settimeout(.2)
        return connection.connect_ex(('127.0.0.1', urlsplit(url).port)) == 0


def restart_group(entries):
    entry = entries[0]
    url = entry['url']
    info = registry.health(url)
    if info:
        owner = next((e for e in entries if registry.matches(e, info) and e.get('token')), None)
        if owner is None:
            raise ValueError('原端口的服务身份已改变，未重启')
        registry.request(url, '/api/manage', {'action': 'restart'}, owner['token'], timeout=3)
        deadline = time.monotonic() + 5
        while port_open(url) and time.monotonic() < deadline:
            time.sleep(.05)
    if port_open(url):
        raise ValueError('原端口仍被占用，未改用其他地址，请稍后重试')

    workspace = entry['workspace']
    env = os.environ.copy()
    client = parse_qs(urlsplit(url).query).get('client', ['restart-manager'])[0]
    env['CODEX_THREAD_ID'] = client
    args = [sys.executable, str(Path(__file__).with_name('server.py')),
            '--project', entry['project'], '--port', str(urlsplit(url).port),
            '--shared' if workspace['mode'] == 'shared' else '--session', workspace['id']]
    child = None
    try:
        with (registry.directory() / 'launch.log').open('ab') as log:
            child = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                     start_new_session=True, env=env)
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            info = registry.health(url)
            if (registry.compatible(info) and info.get('project') == entry['project']
                    and info.get('workspace') == workspace and info.get('saves') == entry['saves']
                    and info.get('editor', {}).get('drawingId') == entry['drawingId']):
                launched = next((e for e in registry.entries()
                                 if e.get('pid') == child.pid and registry.matches(e, info) and e.get('token')), None)
                if launched:
                    # Re-register every original client URL, including bare legacy URLs.
                    for original in entries:
                        registry.register(original['url'], info, launched['token'], child.pid)
                    original_ids = {e['id'] for e in entries}
                    if launched['id'] not in original_ids:
                        (registry.directory() / (launched['id'] + '.json')).unlink(missing_ok=True)
                    return
            if child.poll() is not None:
                raise ValueError('启动失败，请检查项目目录或查看本机 launch.log')
            time.sleep(.05)
        raise ValueError('启动超时，请稍后重试')
    except Exception:
        try:
            if child and child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
        finally:
            # Keep recovery records available even after a failed launch.
            for original in entries:
                registry.store(original)
        raise


def restart():
    registry.directory().mkdir(parents=True, exist_ok=True)
    with (registry.directory() / 'restart.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('正在重新启动，请等待完成') from None
        restarted, errors = 0, []
        for entries in restart_candidates():
            try:
                restart_group(entries)
                restarted += 1
            except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
                errors.append(f"{entries[0]['name']}：{error}")
        return {'restarted': restarted, 'errors': errors, 'editors': registry.discover()}


def main():
    parser = argparse.ArgumentParser(description='本机编辑器管理')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('list')
    commands.add_parser('restart')
    lookup = commands.add_parser('lookup'); lookup.add_argument('--query', required=True)
    new = commands.add_parser('create'); new.add_argument('--project', required=True); new.add_argument('--name', required=True)
    change = commands.add_parser('rename'); change.add_argument('--id', required=True); change.add_argument('--name', required=True)
    delete = commands.add_parser('remove'); delete.add_argument('--id', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'list':
            result = {'editors': registry.discover()}
        elif args.command == 'restart':
            result = restart()
        elif args.command == 'lookup':
            query = args.query.strip()
            matches = [e for e in registry.discover() if query in (e['name'], e['drawingId'], e['id'])]
            if not matches:
                raise ValueError('没有找到该名称或 ID 的作品，请查看当前列表')
            result = {'editors': matches, 'ambiguous': len({e['drawingId'] for e in matches}) > 1}
        elif args.command == 'create':
            result = {'editor': create(args.project, args.name)}
        elif args.command == 'rename':
            result = {'editor': rename(args.id, args.name)}
        else:
            remove(args.id); result = {'removed': True}
        print(json.dumps(result, ensure_ascii=False))
    except HTTPError as error:
        try:
            with error:
                result = json.load(error)
        except (ValueError, OSError):
            result = {'error': '编辑器暂时无法响应'}
        print(json.dumps(result, ensure_ascii=False)); return 1
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False)); return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
