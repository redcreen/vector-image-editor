"""Real-process coverage for the menu bar's local editor manager."""
import copy
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import select
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / 'tools/curve-editor/server.py'
MANAGER = ROOT / 'tools/curve-editor/manager.py'
HTTP = build_opener(ProxyHandler({}))
SAMPLE = json.loads((SERVER.parent / 'examples/心形_可编辑示例.json').read_text())


class ManagerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='editor-manager-')
        self.base = Path(self.temp.name)
        self.project = self.base / '项目'
        self.project.mkdir()
        self.env = {**os.environ, 'CURVE_EDITOR_REGISTRY': str(self.base / 'registry'),
                    'CURVE_EDITOR_SCAN_PORTS': '', 'CURVE_EDITOR_EDITION': 'test',
                    'CODEX_HOME': str(self.base / 'codex')}
        self.children = []

    def tearDown(self):
        # Also stop detached new-page servers, without relying on the feature under test.
        for file in (self.base / 'registry').glob('*.json'):
            try:
                entry = json.loads(file.read_text())
                if entry.get('pid') and entry.get('token'):
                    os.kill(entry['pid'], 15)
            except (OSError, ValueError):
                pass
        for process in self.children:
            if process.poll() is None:
                process.terminate()
            process.communicate(timeout=5)
        self.temp.cleanup()

    def command(self, *args, ok=True, env=None):
        result = subprocess.run([sys.executable, str(MANAGER), *args], env=env or self.env,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode == 0, ok, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def start(self, *args, env=None, port='0'):
        process = subprocess.Popen([sys.executable, str(SERVER), '--project', str(self.project),
                                    '--port', port, *args], env=env or self.env,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(process)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if select.select([process.stdout], [], [], .1)[0]:
                line = process.stdout.readline()
                if 'http://127.0.0.1:' in line:
                    return process, line[line.index('http://'):].strip()
            if process.poll() is not None:
                self.fail(process.stderr.read())
        self.fail('server did not start')

    def get(self, url, path):
        with HTTP.open(url.split('?')[0] + path, timeout=3) as response:
            return json.load(response)

    def post(self, url, path, data, headers=None):
        base = url.split('?')[0]
        request = Request(base + path, data=json.dumps(data).encode(),
                          headers={'Origin': base, 'Content-Type': 'application/json', **(headers or {})})
        with HTTP.open(request, timeout=3) as response:
            return json.load(response)

    def test_lists_isolated_editors_and_names_persist_without_moving_saves(self):
        process, a = self.start('--session', 'a', '--name', '裁片 A')
        _, b = self.start('--session', 'b', '--name', '插画 B')
        entries = self.command('list')['editors']
        self.assertEqual({e['name'] for e in entries}, {'裁片 A', '插画 B'})
        self.assertNotEqual(a, b)
        entry = next(e for e in entries if e['name'] == '裁片 A')
        before = self.get(a, '/api/health')['saves']
        self.command('rename', '--id', entry['id'], '--name', '新名称')
        self.assertEqual(self.get(a, '/api/editor')['name'], '新名称')
        self.assertEqual(self.get(a, '/api/health')['saves'], before)
        process.terminate(); process.communicate(timeout=5)
        _, reopened = self.start('--session', 'a')
        self.assertEqual(self.get(reopened, '/api/editor')['name'], '新名称')

    def test_port_zero_uses_an_os_assigned_port_with_working_health(self):
        _, url = self.start('--session', 'ephemeral')
        port = int(url.split(':')[2].split('?')[0])
        self.assertGreater(port, 0)
        self.assertEqual(self.get(url, '/api/health')['workspace']['id'], 'ephemeral')

    def test_list_ignores_incomplete_registry_records_without_hiding_healthy_editors(self):
        _, url = self.start('--session', 'healthy', '--name', '健康作品')
        invalid_id = 'a' * 64
        invalid = Path(self.env['CURVE_EDITOR_REGISTRY']) / (invalid_id + '.json')
        invalid.write_text(json.dumps({'id': invalid_id}), encoding='utf-8')

        editors = self.command('list')['editors']

        self.assertEqual([(entry['name'], entry['url']) for entry in editors], [('健康作品', url)])
        self.assertTrue(invalid.is_file())

    def test_invalid_editor_metadata_fields_are_repaired_without_losing_the_name(self):
        identity = 'metadata-repair'
        saves = (self.project / 'work/curve_editor/test-sessions/isolated'
                 / hashlib.sha256(identity.encode()).hexdigest())
        saves.mkdir(parents=True)
        (saves / '.editor.json').write_text(json.dumps({
            'name': '保留名称', 'blank': 'yes', 'drawingId': {'bad': True},
            'lastEditedAt': 'yesterday', 'createdAt': 'sometime',
        }), encoding='utf-8')

        _, url = self.start('--session', identity)
        editor = self.get(url, '/api/editor')

        self.assertEqual(editor['name'], '保留名称')
        self.assertIs(editor['blank'], False)
        self.assertRegex(editor['drawingId'], r'^图-[0-9a-f]{12}$')
        self.assertIsInstance(editor['lastEditedAt'], (int, float))
        self.assertIsInstance(editor['createdAt'], (int, float))
        saved = self.post(url, '/api/save', copy.deepcopy(SAMPLE))
        self.assertTrue(Path(saved['path']).is_file())

    def test_restart_preserves_address_artwork_and_dirty_browser_workspace(self):
        _, url = self.start('--session', 'restart', '--name', '原作品')
        before = self.get(url, '/api/health')
        saved = self.post(url, '/api/save', copy.deepcopy(SAMPLE))
        contents = Path(saved['path']).read_bytes()
        self.post(url, '/api/presence', {'page': 'open-tab', 'dirty': True})
        result = self.command('restart')
        self.assertEqual(result['restarted'], 1)
        self.assertEqual(result['errors'], [])
        after = self.get(url, '/api/health')
        self.assertNotEqual(before['instance'], after['instance'])
        for key in ('project', 'workspace', 'saves'):
            self.assertEqual(before[key], after[key])
        self.assertEqual(before['editor']['drawingId'], after['editor']['drawingId'])
        self.assertEqual(contents, Path(saved['path']).read_bytes())
        self.assertEqual([e['url'] for e in self.command('list')['editors']], [url])

    def test_restart_recovers_crashed_service_but_not_hidden_or_foreign_records(self):
        process, url = self.start('--session', 'crashed')
        _, hidden_url = self.start('--session', 'hidden')
        records = list((self.base / 'registry').glob('*.json'))
        for path in records:
            entry = json.loads(path.read_text())
            if entry['url'] == hidden_url:
                entry['hidden'] = True
                path.write_text(json.dumps(entry))
        hidden_before = self.get(hidden_url, '/api/health')['instance']
        before = self.get(url, '/api/health')
        process.kill(); process.communicate(timeout=5)
        self.assertEqual(self.command('restart')['restarted'], 1)
        self.assertEqual(self.get(url, '/api/health')['workspace'], before['workspace'])
        self.assertEqual(self.get(hidden_url, '/api/health')['instance'], hidden_before)
        for path in (self.base / 'registry').glob('*.json'):
            entry = json.loads(path.read_text())
            entry['registryScope'] = 'another-registry'
            path.write_text(json.dumps(entry))
        self.assertEqual(self.command('restart')['restarted'], 0)

    def test_restart_shared_clients_once_and_keeps_exact_urls(self):
        self.env['CODEX_THREAD_ID'] = 'client-a'
        _, a = self.start('--shared', 'shared-artwork')
        self.env['CODEX_THREAD_ID'] = 'client-b'
        _, b = self.start('--shared', 'shared-artwork', port='auto')
        result = self.command('restart')
        self.assertEqual(result['restarted'], 1)
        self.assertEqual(result['errors'], [])
        self.assertEqual({e['url'] for e in result['editors']}, {a, b})

    def test_restart_reports_occupied_port_without_touching_other_service(self):
        process, url = self.start('--session', 'occupied')
        process.kill(); process.communicate(timeout=5)
        port = int(url.split(':')[2])
        with socket.socket() as occupied:
            occupied.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            occupied.bind(('127.0.0.1', port)); occupied.listen()
            result = self.command('restart')
        self.assertEqual(result['restarted'], 0)
        self.assertEqual(len(result['errors']), 1)
        self.assertIn('端口', result['errors'][0])
        self.assertEqual(self.command('restart')['restarted'], 1)

    def test_drawing_id_survives_rename_restart_and_shared_clients(self):
        process, url = self.start('--session', 'permanent', '--name', '原作品')
        info = self.get(url, '/api/editor')
        drawing_id = info.get('drawingId')
        self.assertRegex(drawing_id or '', r'^图-[0-9a-f]{12}$')
        self.assertEqual(self.command('lookup', '--query', '原作品')['editors'][0]['drawingId'], drawing_id)
        entry = self.command('list')['editors'][0]
        created = entry['created']
        self.command('rename', '--id', entry['id'], '--name', '改名后的作品')
        process.terminate(); process.communicate(timeout=5)
        _, reopened = self.start('--session', 'permanent')
        self.assertEqual(self.get(reopened, '/api/editor')['drawingId'], drawing_id)
        self.assertEqual(self.command('lookup', '--query', drawing_id)['editors'][0]['created'], created)
        self.assertEqual(self.command('lookup', '--query', drawing_id)['editors'][0]['name'], '改名后的作品')
        saved = self.post(reopened, '/api/save', copy.deepcopy(SAMPLE))
        self.assertEqual(json.loads(Path(saved['path']).read_text())['drawingId'], drawing_id)
        self.env['CODEX_THREAD_ID'] = 'member-a'
        _, a = self.start('--shared', '共同作品')
        self.env['CODEX_THREAD_ID'] = 'member-b'
        _, b = self.start('--shared', '共同作品', port='auto')
        self.assertNotEqual(a, b)
        self.assertEqual(self.get(a, '/api/editor')['drawingId'], self.get(b, '/api/editor')['drawingId'])
        _, other = self.start('--session', 'another', '--name', '改名后的作品')
        matches = self.command('lookup', '--query', '改名后的作品')
        self.assertEqual(len(matches['editors']), 2)
        self.assertTrue(matches['ambiguous'])

    def test_list_orders_actual_edits_and_ignores_heartbeat_replays_and_rename(self):
        _, a = self.start('--session', 'older', '--name', '先建作品')
        _, b = self.start('--session', 'newer', '--name', '后建作品')
        entries = self.command('list')['editors']
        self.assertEqual([e['name'] for e in entries], ['后建作品', '先建作品'])
        edited_at = time.time()
        self.post(a, '/api/presence', {'page': 'tab-a', 'dirty': True, 'sequence': 1, 'editedAt': edited_at})
        entries = self.command('list')['editors']
        self.assertEqual(entries[0]['name'], '先建作品')
        self.assertEqual(entries[0]['lastEditedAt'], edited_at)
        self.post(b, '/api/presence', {'page': 'tab-b', 'dirty': True, 'sequence': 1})
        self.post(a, '/api/presence', {'page': 'tab-a', 'dirty': True, 'sequence': 2, 'editedAt': edited_at})
        self.post(a, '/api/presence', {'page': 'tab-a', 'dirty': True, 'sequence': 1, 'editedAt': edited_at + 1})
        b_entry = next(e for e in entries if e['name'] == '后建作品')
        self.command('rename', '--id', b_entry['id'], '--name', '仅改名')
        entries = self.command('list')['editors']
        self.assertEqual(entries[0]['name'], '先建作品')
        self.assertEqual(entries[0]['lastEditedAt'], edited_at)
        later = time.time()
        self.post(b, '/api/presence', {'page': 'tab-b', 'dirty': True, 'sequence': 2, 'editedAt': later})
        self.assertEqual(self.command('list')['editors'][0]['name'], '仅改名')

    def test_repeated_unchanged_save_does_not_promote_an_older_drawing(self):
        _, a = self.start('--session', 'save-a', '--name', '旧作品')
        _, b = self.start('--session', 'save-b', '--name', '新作品')
        self.post(a, '/api/save', copy.deepcopy(SAMPLE))
        self.post(b, '/api/save', copy.deepcopy(SAMPLE))
        before = self.get(a, '/api/editor')['lastEditedAt']
        self.post(a, '/api/save', copy.deepcopy(SAMPLE))
        self.assertEqual(self.get(a, '/api/editor')['lastEditedAt'], before)
        self.assertEqual(self.command('list')['editors'][0]['name'], '新作品')

    def test_browser_save_keeps_actual_edit_time_even_when_file_content_changed(self):
        _, a = self.start('--session', 'tracked-a', '--name', '先编辑的作品')
        _, b = self.start('--session', 'tracked-b', '--name', '后编辑的作品')
        first = time.time()
        self.post(a, '/api/presence', {'page': 'tab', 'dirty': True, 'editedAt': first})
        second = time.time()
        self.post(b, '/api/presence', {'page': 'tab', 'dirty': True, 'editedAt': second})
        self.post(a, '/api/save', copy.deepcopy(SAMPLE), headers={'X-Editor-Edited-At': str(first)})
        self.assertEqual(self.get(a, '/api/editor')['lastEditedAt'], first)
        self.assertEqual(self.command('list')['editors'][0]['name'], '后编辑的作品')

    def test_create_is_blank_isolated_and_remove_preserves_saved_files(self):
        a = self.command('create', '--project', str(self.project), '--name', '新画板')['editor']
        b = self.command('create', '--project', str(self.project), '--name', '另一张')['editor']
        self.assertNotEqual(a['url'], b['url'])
        self.assertTrue(self.get(a['url'], '/api/editor')['blank'])
        saved = self.post(a['url'], '/api/save', copy.deepcopy(SAMPLE))
        self.command('remove', '--id', a['id'])
        self.assertTrue(Path(saved['path']).is_file())
        self.assertNotIn(a['id'], {e['id'] for e in self.command('list')['editors']})
        self.assertEqual(self.get(b['url'], '/api/editor')['name'], '另一张')

    def test_dirty_page_blocks_close_until_saved_and_management_requires_token(self):
        _, url = self.start('--session', 'dirty')
        entry = self.command('list')['editors'][0]
        self.post(url, '/api/presence', {'page': 'tab-a', 'dirty': True})
        self.post(url, '/api/presence', {'page': 'tab-b', 'dirty': False})
        result = self.command('remove', '--id', entry['id'], ok=False)
        self.assertIn('未保存', result['error'])
        self.assertEqual(len(self.command('list')['editors']), 1)
        with self.assertRaises(HTTPError) as denied:
            self.post(url, '/api/manage', {'action': 'close'})
        self.assertEqual(denied.exception.code, 403)
        denied.exception.close()
        with self.assertRaises(HTTPError) as denied_restart:
            self.post(url, '/api/manage', {'action': 'restart'})
        self.assertEqual(denied_restart.exception.code, 403)
        denied_restart.exception.close()
        self.post(url, '/api/presence', {'page': 'tab-a', 'dirty': False})
        self.command('remove', '--id', entry['id'])
        self.assertEqual(self.command('list')['editors'], [])

    def test_codex_title_default_and_shared_client_urls_survive_rename_and_reuse(self):
        codex = Path(self.env['CODEX_HOME']); codex.mkdir()
        with sqlite3.connect(codex / 'state_5.sqlite') as db:
            db.execute('CREATE TABLE threads (id TEXT, title TEXT)')
            db.execute('INSERT INTO threads VALUES (?, ?)', ('known-thread', '对应聊天标题'))
        self.env['CODEX_THREAD_ID'] = 'known-thread'
        _, url = self.start('--session', 'known-thread')
        self.assertEqual(self.get(url, '/api/editor')['name'], '对应聊天标题')
        self.env['CODEX_THREAD_ID'] = 'member-a'
        _, a = self.start('--shared', '协作稿')
        self.env['CODEX_THREAD_ID'] = 'member-b'
        _, b = self.start('--shared', '协作稿', port='auto')
        self.assertEqual(a.split('?')[0], b.split('?')[0]); self.assertNotEqual(a, b)
        entries = self.command('list')['editors']
        self.assertIn(a, {e['url'] for e in entries}); self.assertIn(b, {e['url'] for e in entries})
        entry = next(e for e in entries if e['url'] == b)
        self.command('rename', '--id', entry['id'], '--name', '共享新名')
        self.assertIn(b, {e['url'] for e in self.command('list')['editors']})
        self.command('remove', '--id', entry['id'])
        self.assertEqual(self.get(a, '/api/editor')['name'], '共享新名')
        self.assertNotIn(b, {e['url'] for e in self.command('list')['editors']})

    def test_invalid_name_is_rejected_without_changing_existing_name(self):
        _, url = self.start('--session', 'validation', '--name', '原名')
        entry = self.command('list')['editors'][0]
        for name in ['', 'x' * 81, 'a\nb']:
            self.command('rename', '--id', entry['id'], '--name', name, ok=False)
        self.assertEqual(self.get(url, '/api/editor')['name'], '原名')

    def test_closed_page_ignores_late_dirty_heartbeat_but_bfcache_can_reopen(self):
        _, url = self.start('--session', 'presence-order')
        entry = self.command('list')['editors'][0]
        self.post(url, '/api/presence', {'page': 'tab', 'dirty': True, 'sequence': 1})
        self.post(url, '/api/presence', {'page': 'tab', 'dirty': True, 'closed': True, 'sequence': 2})
        self.post(url, '/api/presence', {'page': 'tab', 'dirty': True, 'sequence': 1})
        # BFCache restore uses a higher sequence and must protect the page again.
        self.post(url, '/api/presence', {'page': 'tab', 'dirty': True, 'sequence': 3})
        self.command('remove', '--id', entry['id'], ok=False)
        self.post(url, '/api/presence', {'page': 'tab', 'dirty': True, 'closed': True, 'sequence': 4})
        self.post(url, '/api/presence', {'page': 'tab', 'dirty': True, 'sequence': 3})
        self.command('remove', '--id', entry['id'])
        self.assertEqual(self.command('list')['editors'], [])

    def test_legacy_discovery_rename_and_hide_leave_its_service_running(self):
        self.env['CURVE_EDITOR_EDITION'] = 'official'
        info = {'app': 'daban-curve-editor-v1', 'project': str(self.project),
                'saves': str(self.project / 'work/curve_editor/sessions'), 'editorRevision': 'old'}
        class Legacy(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                value = json.dumps(info).encode()
                self.send_response(200); self.send_header('Content-Length', str(len(value)))
                self.end_headers(); self.wfile.write(value)
        legacy = ThreadingHTTPServer(('127.0.0.1', 0), Legacy)
        threading.Thread(target=legacy.serve_forever, daemon=True).start()
        self.addCleanup(legacy.server_close); self.addCleanup(legacy.shutdown)
        self.env['CURVE_EDITOR_SCAN_PORTS'] = str(legacy.server_port)
        entry = self.command('list')['editors'][0]
        self.assertTrue(entry['legacy'])
        self.command('rename', '--id', entry['id'], '--name', '旧页面命名')
        self.assertEqual(self.command('list')['editors'][0]['name'], '旧页面命名')
        self.command('remove', '--id', entry['id'])
        self.assertEqual(self.command('list')['editors'], [])
        self.assertEqual(self.get(entry['url'], '/api/health'), info)

    def test_test_edition_cannot_claim_a_formal_editor_port(self):
        result = subprocess.run([sys.executable, str(SERVER), '--project', str(self.project),
                                 '--port', '8769', '--session', 'blocked-test-port'],
                                env=self.env, capture_output=True, text=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('测试版不能占用正式版端口', result.stderr)
        self.assertEqual(self.command('list')['editors'], [])

    def test_test_and_official_editions_do_not_discover_or_reuse_each_other(self):
        _, test_url = self.start('--session', 'same-edition-workspace', '--name', '测试服务')
        test_port = test_url.split(':')[2].split('?')[0]
        health = self.get(test_url, '/api/health')
        self.assertEqual(health['edition'], 'test')
        self.assertEqual(self.get(test_url, '/api/editor')['edition'], 'test')
        self.assertEqual(Path(health['saves']).parts[-3], 'test-sessions')
        test_entry = self.command('list')['editors'][0]
        self.command('rename', '--id', test_entry['id'], '--name', '测试服务已改名')
        renamed = self.get(test_url, '/api/editor')
        self.assertEqual({key: renamed[key] for key in ('name', 'blank', 'edition')},
                         {'name': '测试服务已改名', 'blank': False, 'edition': 'test'})
        test_document = copy.deepcopy(SAMPLE)
        test_document['paths'][0]['note'] = 'test-edition-content'
        test_saved = self.post(test_url, '/api/save', test_document)

        sockets = [socket.socket() for _ in range(2)]
        for sock in sockets:
            sock.bind(('127.0.0.1', 0))
        auto_ports = ','.join(str(sock.getsockname()[1]) for sock in sockets)
        for sock in sockets:
            sock.close()
        official_env = {**self.env, 'CURVE_EDITOR_EDITION': 'official',
                        'CURVE_EDITOR_SCAN_PORTS': test_port,
                        'CURVE_EDITOR_AUTO_PORTS': auto_ports}
        self.assertEqual(self.command('list', env=official_env)['editors'], [])
        _, official_url = self.start('--session', 'same-edition-workspace', '--name', '正式服务',
                                     env=official_env, port='auto')

        self.assertNotEqual(test_url.split('?')[0], official_url.split('?')[0])
        official_health = self.get(official_url, '/api/health')
        self.assertEqual(official_health['edition'], 'official')
        with HTTP.open(official_url + '/') as response:
            html = response.read().decode()
        self.assertIn('data-edition="official">[正式]', html)
        self.assertIn('<title>正式服务</title>', html)
        self.assertEqual(Path(official_health['saves']).parts[-3], 'sessions')
        self.assertNotEqual(health['saves'], official_health['saves'])
        official_document = copy.deepcopy(SAMPLE)
        official_document['paths'][0]['note'] = 'official-edition-content'
        official_saved = self.post(official_url, '/api/save', official_document)
        self.assertNotEqual(test_saved['path'], official_saved['path'])
        self.assertEqual(self.get(test_url, '/api/latest')['paths'][0]['note'], 'test-edition-content')
        self.assertEqual(self.get(official_url, '/api/latest')['paths'][0]['note'], 'official-edition-content')
        self.assertEqual(json.loads((Path(health['saves']) / '.editor.json').read_text())['name'],
                         '测试服务已改名')
        self.assertEqual(json.loads((Path(official_health['saves']) / '.editor.json').read_text())['name'],
                         '正式服务')
        test_entries = self.command('list')['editors']
        official_entries = self.command('list', env=official_env)['editors']
        self.assertEqual([(entry['name'], entry['edition']) for entry in test_entries], [('测试服务已改名', 'test')])
        self.assertEqual([(entry['name'], entry['edition']) for entry in official_entries], [('正式服务', 'official')])

    def test_private_registries_do_not_discover_or_reuse_each_others_servers(self):
        sockets = [socket.socket() for _ in range(2)]
        for sock in sockets:
            sock.bind(('127.0.0.1', 0))
        auto_ports = ','.join(str(sock.getsockname()[1]) for sock in sockets)
        for sock in sockets:
            sock.close()
        first_env = {**self.env, 'CURVE_EDITOR_AUTO_PORTS': auto_ports}
        _, first = self.start('--session', 'same-workspace', '--name', 'registry A', env=first_env, port='auto')
        first_port = first.split(':')[2].split('?')[0]
        other_env = {**first_env,
                     'CURVE_EDITOR_REGISTRY': str(self.base / 'other-registry'),
                     'CURVE_EDITOR_SCAN_PORTS': first_port}

        self.assertEqual(self.command('list', env=other_env)['editors'], [])
        _, second = self.start('--session', 'same-workspace', '--name', 'registry B', env=other_env, port='auto')

        self.assertNotEqual(first.split('?')[0], second.split('?')[0])
        self.assertEqual({entry['name'] for entry in self.command('list')['editors']}, {'registry A'})
        self.assertEqual({entry['name'] for entry in self.command('list', env=other_env)['editors']}, {'registry B'})


if __name__ == '__main__':
    unittest.main()
