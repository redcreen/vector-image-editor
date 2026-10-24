"""Exercise the actual HTTP server across independent project directories."""
import copy
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen, build_opener, ProxyHandler, install_opener
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[2]
SERVER = Path(os.environ.get('CURVE_EDITOR_SERVER', ROOT / 'tools/curve-editor/server.py'))
SAMPLE = json.loads((ROOT / 'tools/curve-editor/examples/心形_可编辑示例.json').read_text())
install_opener(build_opener(ProxyHandler({})))

class ProjectIsolationTests(unittest.TestCase):
    def test_curve_clipboard_v3_round_trips_mixed_items_and_rejects_invalid_content_atomically(self):
        project = self.base / 'mixed-clipboard'
        project.mkdir()
        _, url = self.start(project)

        def clipboard(data):
            request = Request(url + '/api/curve-clipboard', data=json.dumps(data).encode(),
                              headers={'Content-Type': 'application/json', 'Origin': url})
            with urlopen(request, timeout=3) as response:
                return json.load(response)

        path = copy.deepcopy(SAMPLE['paths'][0])
        image = {'id': 'image-1', 'name': '参考.png', 'dataUrl': 'data:image/png;base64,aW1hZ2U=',
                 'x': -10, 'y': 20, 'width': 30, 'height': 40, 'opacity': .8, 'rotation': 15}
        text = {'id': 'text-1', 'name': '说明', 'content': '正面', 'x': 12, 'y': 18,
                'fontSize': 24, 'color': '#123ABC', 'rotation': -5}
        payload = {
            'format': 'curve-editor-clipboard', 'version': 3,
            'paths': [path], 'images': [image], 'texts': [text],
            'items': [{'type': 'image', 'id': image['id']},
                      {'type': 'path', 'id': path['id']},
                      {'type': 'text', 'id': text['id']}],
            'calibration': None, 'sourcePageId': 'source-page', 'copiedAt': 987654321,
        }
        clipboard({'action': 'write', 'clipboard': payload})
        self.assertEqual(clipboard({'action': 'read'}), payload)

        invalid_payloads = []
        for missing in ('paths', 'images', 'texts'):
            value = copy.deepcopy(payload)
            del value[missing]
            invalid_payloads.append(value)
        invalid_payloads.append({**payload, 'paths': [], 'images': [], 'texts': [], 'items': []})
        invalid_path = copy.deepcopy(payload)
        invalid_path['paths'][0]['nodes'][0]['x'] = 'left'
        invalid_payloads.append(invalid_path)
        invalid_image = copy.deepcopy(payload)
        invalid_image['images'][0]['width'] = 0
        invalid_payloads.append(invalid_image)
        invalid_text = copy.deepcopy(payload)
        invalid_text['texts'][0]['fontSize'] = 0
        invalid_payloads.append(invalid_text)
        invalid_payloads.extend([
            {**payload, 'items': [payload['items'][0], payload['items'][0], *payload['items'][1:]]},
            {**payload, 'items': [{'type': 'image', 'id': 'missing'}, *payload['items'][1:]]},
            {**payload, 'items': payload['items'][:-1]},
            {**payload, 'items': [{'type': 'shape', 'id': path['id']}, *payload['items'][1:]]},
        ])
        too_many_images = [{**image, 'id': f'image-{index}'} for index in range(201)]
        invalid_payloads.append({**payload, 'paths': [], 'images': too_many_images, 'texts': [], 'items': []})

        for invalid in invalid_payloads:
            with self.subTest(invalid=invalid), self.assertRaises(HTTPError) as failure:
                clipboard({'action': 'write', 'clipboard': invalid})
            self.assertEqual(failure.exception.code, 400)
            failure.exception.close()
            self.assertEqual(clipboard({'action': 'read'}), payload)

        image_only = {key: value for key, value in payload.items() if key != 'items'}
        image_only.update(paths=[], texts=[], copiedAt=payload['copiedAt'] + 1)
        clipboard({'action': 'write', 'clipboard': image_only})
        self.assertEqual(clipboard({'action': 'read'}), image_only)

    def test_curve_clipboard_v2_preserves_physical_scale_and_rejects_invalid_metadata(self):
        project=self.base/'physical-clipboard';project.mkdir();_,url=self.start(project)
        def clipboard(data):
            with urlopen(Request(url+'/api/curve-clipboard',data=json.dumps(data).encode(),headers={'Content-Type':'application/json','Origin':url}),timeout=3) as response:
                return json.load(response)
        calibration={'a':{'x':0,'y':0},'b':{'x':100,'y':0},'length':5,'unit':'cm'}
        payload={'format':'curve-editor-clipboard','version':2,'paths':SAMPLE['paths'],'calibration':calibration,'sourcePageId':'source-page','copiedAt':123456789}
        clipboard({'action':'write','clipboard':payload})
        self.assertEqual(clipboard({'action':'read'}),payload)
        for patch in [{'calibration':False},{'calibration':{**calibration,'length':0}},{'calibration':{**calibration,'unit':'px'}},{'sourcePageId':''},{'sourcePageId':7}]:
            with self.subTest(patch=patch),self.assertRaises(HTTPError) as failed:
                clipboard({'action':'write','clipboard':{**payload,**patch}})
            self.assertEqual(failed.exception.code,400);failed.exception.close()
            self.assertEqual(clipboard({'action':'read'}),payload)
        missing={**payload};del missing['calibration']
        with self.assertRaises(HTTPError) as failed:clipboard({'action':'write','clipboard':missing})
        self.assertEqual(failed.exception.code,400);failed.exception.close()
        uncalibrated={**payload,'calibration':None};clipboard({'action':'write','clipboard':uncalibrated})
        self.assertEqual(clipboard({'action':'read'}),uncalibrated)
        self.assertIsNone(self.read(url,'/api/latest'))

    def test_curve_clipboard_late_older_writes_cannot_replace_newer_copy_across_ports(self):
        urls=[]
        for name in ('clipboard-order-a','clipboard-order-b'):
            project=self.base/name;project.mkdir();_,url=self.start(project);urls.append(url)
        def request(url,data):
            with urlopen(Request(url+'/api/curve-clipboard',data=json.dumps(data).encode(),headers={'Content-Type':'application/json','Origin':url}),timeout=3) as response:
                return json.load(response)
        payload={'format':'curve-editor-clipboard','version':2,'paths':SAMPLE['paths'],'calibration':None,'sourcePageId':'source'}
        def write(timestamp):
            return request(urls[timestamp%2],{'action':'write','clipboard':{**payload,'copiedAt':timestamp}})
        write(20);write(10)
        self.assertEqual(request(urls[0],{'action':'read'})['copiedAt'],20)
        with ThreadPoolExecutor(max_workers=8) as pool:list(pool.map(write,[24,28,22,26,30,21,29,23,27,25]))
        self.assertEqual(request(urls[1],{'action':'read'})['copiedAt'],30)

    def test_curve_clipboard_shared_across_projects_without_touching_saves(self):
        first, second = self.base / 'copy', self.base / 'paste'
        first.mkdir(); second.mkdir()
        _, source = self.start(first)
        _, target = self.start(second)
        def clipboard(url, data, origin=None):
            with urlopen(Request(url + '/api/curve-clipboard', data=json.dumps(data).encode(),
                                 headers={'Content-Type': 'application/json', 'Origin': origin or url}), timeout=3) as response:
                return json.load(response)
        self.assertIsNone(clipboard(target, {'action': 'read'}))
        payload = {'format': 'curve-editor-clipboard', 'version': 1, 'paths': SAMPLE['paths']}
        clipboard(source, {'action': 'write', 'clipboard': payload})
        self.assertEqual(clipboard(target, {'action': 'read'}), payload)
        third, fourth = self.base / 'other-registry', self.base / 'other-edition'
        third.mkdir(); fourth.mkdir()
        _, isolated = self.start(third, registry_dir=self.base / 'isolated-registry')
        _, official = self.start(fourth, edition='official')
        self.assertIsNone(clipboard(isolated, {'action': 'read'}))
        self.assertIsNone(clipboard(official, {'action': 'read'}))
        self.assertIsNone(self.read(source, '/api/latest'))
        self.assertIsNone(self.read(target, '/api/latest'))
        for data, origin, code in [
                ({'action': 'write', 'clipboard': {**payload, 'paths': []}}, source, 400),
                ({'action': 'write', 'clipboard': {**payload, 'paths': [{'id': 'bad'}]}}, source, 400),
                ({'action': 'write', 'clipboard': {**payload, 'copiedAt': -1}}, source, 400),
                ({'action': 'read'}, 'https://example.com', 403),
                ({'action': 'write', 'clipboard': payload}, target, 403)]:
            with self.assertRaises(HTTPError) as failure:
                clipboard(source, data, origin)
            self.assertEqual(failure.exception.code, code)
            failure.exception.close()
        self.assertEqual(clipboard(target, {'action': 'read'}), payload)

    def test_symmetry_metadata_round_trip_and_invalid_metadata_rejected(self):
        project = self.base / '关联对称'
        project.mkdir()
        _, url = self.start(project)
        document = copy.deepcopy(SAMPLE)
        document['mirrorAxisVisible'] = False
        document['symmetryLinks'] = [{'id': 'pair', 'axis': {'a': {'x': 0, 'y': 0}, 'b': {'x': 0, 'y': 100}}}]
        document['paths'][0]['nodes'][0]['symmetry'] = {'out': {'id': 'pair', 'side': 0, 'dir': 1}}
        def save(data):
            return urlopen(Request(url + '/api/save', data=json.dumps(data).encode(), headers={'Content-Type': 'application/json', 'Origin': url}), timeout=3)
        with save(document) as response:
            self.assertEqual(response.status, 200)
        self.assertEqual(self.read(url, '/api/latest')['symmetryLinks'], document['symmetryLinks'])
        invalid = copy.deepcopy(document)
        invalid['paths'][0]['nodes'][0]['symmetry']['out']['side'] = 2
        with self.assertRaises(HTTPError) as failure:
            save(invalid)
        self.assertEqual(failure.exception.code, 400)
        failure.exception.close()
        self.assertEqual(self.read(url, '/api/latest')['paths'], document['paths'])

    def test_node_colors_round_trip_and_invalid_node_colors_do_not_replace_the_saved_artwork(self):
        project = self.base / '节点颜色'
        project.mkdir()
        _, url = self.start(project)
        document = copy.deepcopy(SAMPLE)
        document['paths'][0]['nodes'][0]['color'] = '#C43283'
        request = Request(url + '/api/save', data=json.dumps(document).encode(), headers={'Content-Type': 'application/json', 'Origin': url})
        with urlopen(request, timeout=3) as response:
            self.assertEqual(response.status, 200)
        self.assertEqual(self.read(url, '/api/latest')['paths'][0]['nodes'][0]['color'], '#C43283')
        document['paths'][0]['nodes'][0]['color'] = 'red'
        request = Request(url + '/api/save', data=json.dumps(document).encode(), headers={'Content-Type': 'application/json', 'Origin': url})
        with self.assertRaises(HTTPError) as failure:
            urlopen(request, timeout=3)
        self.assertEqual(failure.exception.code, 400)
        self.assertEqual(self.read(url, '/api/latest')['paths'][0]['nodes'][0]['color'], '#C43283')

    def test_parallel_editor_resources_load_without_dropping_connections(self):
        project = self.base/'并行页面资源'
        project.mkdir()
        _, url = self.start(project)
        resources = ['/index.html', '/style.css', '/app.js', '/geometry.js', '/fairing.js', '/interactions.js', '/layers.js', '/tracing.js', '/offset.js', '/vendor/clipper.js'] * 4
        gate = threading.Barrier(len(resources))
        def read_resource(resource):
            gate.wait(timeout=5)
            with urlopen(url + resource, timeout=3) as response:
                return response.status, len(response.read())
        with ThreadPoolExecutor(max_workers=len(resources)) as pool:
            for status, size in pool.map(read_resource, resources):
                self.assertEqual(status, 200)
                self.assertGreater(size, 0)

    def test_old_server_is_preserved_but_not_reused_for_portable_history_editor(self):
        project = self.base/'升级兼容'
        project.mkdir()
        saves = project/'work/curve_editor/test-sessions'
        saves.mkdir(parents=True)
        class LegacyHandler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                body = json.dumps({'app': 'daban-curve-editor-v1', 'project': str(project.resolve()), 'saves': str(saves.resolve()), 'editorRevision': 'editor-outline-v1'}).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        legacy = ThreadingHTTPServer(('127.0.0.1', 0), LegacyHandler)
        thread = threading.Thread(target=legacy.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(legacy.server_close)
        self.addCleanup(legacy.shutdown)
        (saves.parent/'server.json').write_text(json.dumps({'port': legacy.server_port}))
        proc, url = self.start(project)
        self.assertNotEqual(url, f'http://127.0.0.1:{legacy.server_port}')
        self.assertIsNone(proc.poll())
        self.assertRegex(self.read(url, '/api/health')['editorRevision'], r'^editor-[0-9a-f]{16}$')
        self.assertEqual(self.read(f'http://127.0.0.1:{legacy.server_port}', '/api/health')['project'], str(project.resolve()))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='vector-editor-test-')
        self.base = Path(self.temp.name)
        self.children = []

    def tearDown(self):
        for proc in self.children:
            if proc.poll() is None:
                proc.terminate()
            proc.communicate(timeout=5)
        self.temp.cleanup()

    def start(self, project, port="0", registry_dir=None, edition='test'):
        proc = subprocess.Popen([sys.executable, str(SERVER), '--project', str(project), '--port', port, '--shared', 'default'], env={**os.environ, "CURVE_EDITOR_EDITION": edition, 'CURVE_EDITOR_REGISTRY': str(registry_dir or self.base / 'registry'), 'CURVE_EDITOR_SCAN_PORTS': ''}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        self.children.append(proc)
        deadline = time.monotonic() + 10
        lines = []
        while time.monotonic() < deadline:
            if not select.select([proc.stdout], [], [], .1)[0]:
                continue
            line = proc.stdout.readline()
            if not line:
                break
            lines.append(line)
            if 'http://127.0.0.1:' in line:
                return proc, line[line.index('http://127.0.0.1:'):].strip().split('?', 1)[0]
        self.fail('Server did not start: ' + ''.join(lines))

    def read(self, url, path):
        with urlopen(url + path, timeout=3) as response:
            return json.load(response)

    def save(self, url, title, **extra):
        document = copy.deepcopy(SAMPLE)
        document['title'] = title
        document.update(extra)
        request = Request(url + '/api/save', data=json.dumps(document).encode(), headers={'Content-Type':'application/json', 'Origin':url})
        with urlopen(request, timeout=3) as response:
            return json.load(response)

    def editor_state(self, **extra):
        state = {'selected': None, 'ni': None, 'selection': [], 'imageSelection': [],
                 'activeLayer': None, 'nodeSelection': [], 'drawing': False, 'tool': 'node'}
        state.update(extra)
        return state

    def packed_snapshot(self, document, **state):
        return {'doc': document, **self.editor_state(**state)}

    def test_outer_contour_tool_survives_portable_operation_history(self):
        project = self.base/'外轮廓操作记录'
        project.mkdir()
        _, url = self.start(project)
        operation_history = {
            'format': 'curve-editor-session', 'version': 1, 'assets': [],
            'data': {
                'current': self.editor_state(tool='outline'),
                'history': {
                    'version': 1,
                    'past': [self.packed_snapshot(copy.deepcopy(SAMPLE), tool='outline')],
                    'future': [], 'pastLabels': ['提取外轮廓'], 'futureLabels': [],
                },
            },
        }
        saved = self.save(url, '外轮廓', operationHistory=operation_history)
        self.assertEqual(json.loads(Path(saved['path']).read_text())['operationHistory'], operation_history)

    def test_portable_operation_history_round_trips_deleted_images_and_redo_entries(self):
        project = self.base/'便携历史'
        project.mkdir()
        _, url = self.start(project)
        deleted_image = 'data:image/png;base64,ZGVsZXRlZA=='
        redone_image = 'data:image/webp;base64,cmVkb25l'

        deleted_doc = copy.deepcopy(SAMPLE)
        deleted_doc['title'] = '删除图片之前'
        deleted_doc['image'] = {'name': 'deleted.png', 'dataUrl': {'asset': 0}}
        redone_doc = copy.deepcopy(SAMPLE)
        redone_doc['title'] = '重做后的图片'
        redone_doc['image'] = {'name': 'redone.webp', 'dataUrl': {'asset': 1}}
        operation_history = {
            'format': 'curve-editor-session',
            'version': 1,
            'assets': [deleted_image, redone_image],
            'data': {
                'current': self.editor_state(tool='select'),
                'history': {
                    'version': 1,
                    'past': [self.packed_snapshot(deleted_doc, selection=[SAMPLE['paths'][0]['id']])],
                    'future': [self.packed_snapshot(redone_doc, imageSelection=['old-image'], tool='select')],
                    'pastLabels': ['删除图片'],
                    'futureLabels': ['恢复图片'],
                },
            },
        }

        saved = self.save(url, '当前不含图片', image=None, operationHistory=operation_history)
        persisted = json.loads(Path(saved['path']).read_text())
        self.assertEqual(persisted['operationHistory'], operation_history)
        self.assertEqual(self.read(url, '/api/latest')['operationHistory'], operation_history)
        self.assertIsNone(persisted['image'])

    def test_invalid_portable_operation_history_does_not_replace_latest(self):
        project = self.base/'无效便携历史'
        project.mkdir()
        _, url = self.start(project)
        self.save(url, '有效基线')

        packed_doc = copy.deepcopy(SAMPLE)
        packed_doc['image'] = {'name': 'history.png', 'dataUrl': {'asset': 0}}
        valid = {
            'format': 'curve-editor-session',
            'version': 1,
            'assets': ['data:image/png;base64,aGlzdG9yeQ=='],
            'data': {
                'current': self.editor_state(),
                'history': {
                    'version': 1,
                    'past': [self.packed_snapshot(packed_doc)],
                    'future': [],
                    'pastLabels': ['导入图片'],
                    'futureLabels': [],
                },
            },
        }

        invalid = []
        for key in ('selection', 'imageSelection', 'nodeSelection', 'drawing', 'tool'):
            history = copy.deepcopy(valid)
            del history['data']['current'][key]
            invalid.append(('current missing ' + key, history))
        for key in ('selection', 'imageSelection', 'nodeSelection', 'drawing', 'tool'):
            history = copy.deepcopy(valid)
            del history['data']['history']['past'][0][key]
            invalid.append(('snapshot missing ' + key, history))

        malformed = [
            ('wrong packing format', {**copy.deepcopy(valid), 'format': 'other'}),
            ('wrong packing version', {**copy.deepcopy(valid), 'version': 2}),
            ('asset is not a data URL', {**copy.deepcopy(valid), 'assets': ['https://example.invalid/image.png']}),
            ('duplicate packed asset', {**copy.deepcopy(valid), 'assets': valid['assets'] * 2}),
        ]
        invalid.extend(malformed)

        bad_ref = copy.deepcopy(valid)
        bad_ref['data']['history']['past'][0]['doc']['image']['dataUrl'] = {'asset': 1}
        invalid.append(('out of range asset reference', bad_ref))
        direct_url = copy.deepcopy(valid)
        direct_url['data']['history']['past'][0]['doc']['image']['dataUrl'] = valid['assets'][0]
        invalid.append(('unpacked snapshot data URL', direct_url))
        too_many = copy.deepcopy(valid)
        too_many['data']['history']['past'] *= 101
        too_many['data']['history']['pastLabels'] *= 101
        invalid.append(('more than 100 history entries', too_many))
        label_mismatch = copy.deepcopy(valid)
        label_mismatch['data']['history']['pastLabels'] = []
        invalid.append(('label count mismatch', label_mismatch))
        long_label = copy.deepcopy(valid)
        long_label['data']['history']['pastLabels'] = ['x' * 201]
        invalid.append(('label too long', long_label))
        nested = copy.deepcopy(valid)
        nested['data']['history']['past'][0]['doc']['operationHistory'] = copy.deepcopy(valid)
        invalid.append(('nested operation history', nested))
        invalid_doc = copy.deepcopy(valid)
        invalid_doc['data']['history']['past'][0]['doc']['width'] = 0
        invalid.append(('invalid snapshot document', invalid_doc))

        for reason, operation_history in invalid:
            with self.subTest(reason=reason):
                with self.assertRaises(HTTPError) as error:
                    self.save(url, '不应保存', operationHistory=operation_history)
                self.assertEqual(error.exception.code, 400)
                error.exception.close()
                self.assertEqual(self.read(url, '/api/latest')['title'], '有效基线')

    def test_mirror_axis_round_trip_and_invalid_axes_are_rejected(self):
        project = self.base/'镜像测试'
        project.mkdir()
        _, url = self.start(project)
        axis = {'a': {'x': 25, 'y': 30}, 'b': {'x': 180, 'y': 260}}
        saved = self.save(url, '含对称轴', mirrorAxis=axis)
        self.assertEqual(self.read(url, '/api/latest')['mirrorAxis'], axis)
        self.assertEqual(json.loads(Path(saved['path']).read_text())['mirrorAxis'], axis)
        for invalid in ({'a': axis['a'], 'b': axis['a']}, {'a': axis['a']}, {'a': {'x': True, 'y': 0}, 'b': axis['b']}, {'a': {'x': 1e8, 'y': 0}, 'b': axis['b']}):
            with self.assertRaises(HTTPError) as error:
                self.save(url, '无效轴', mirrorAxis=invalid)
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
        self.assertEqual(self.read(url, '/api/latest')['mirrorAxis'], axis)

    def test_calibration_round_trips_and_svg_reports_scale_without_changing_pixel_canvas(self):
        project = self.base/'标定测试'
        project.mkdir()
        _, url = self.start(project)
        calibration = {'a': {'x': 10, 'y': 20}, 'b': {'x': 110, 'y': 20}, 'length': 2.5, 'unit': 'cm'}
        saved = self.save(url, '含物理标定', calibration=calibration, measureUnit='cm')
        latest = self.read(url, '/api/latest')
        self.assertEqual(latest['calibration'], calibration)
        self.assertEqual(latest['measureUnit'], 'cm')
        persisted = json.loads(Path(saved['path']).read_text())
        self.assertEqual(persisted['calibration'], calibration)
        self.assertEqual(persisted['measureUnit'], 'cm')
        svg = Path(saved['path']).with_suffix('.svg').read_text()
        self.assertIn(f'width="{SAMPLE["width"]}px"', svg)
        self.assertIn(f'height="{SAMPLE["height"]}px"', svg)
        self.assertIn(f'viewBox="0 0 {SAMPLE["width"]} {SAMPLE["height"]}"', svg)
        self.assertIn('用户两点标定', svg)
        self.assertIn('1 px = 0.25 mm', svg)
        self.assertNotIn('未标定毫米', svg)
        self.assertNotIn('<line', svg)
        self.assertNotIn('<circle', svg)

    def test_uncalibrated_old_and_null_documents_remain_valid(self):
        project = self.base/'旧文件兼容'
        project.mkdir()
        _, url = self.start(project)
        old = self.save(url, '旧格式')
        latest = self.read(url, '/api/latest')
        self.assertNotIn('calibration', latest)
        self.assertNotIn('measureUnit', latest)
        self.assertIn('未标定毫米', Path(old['path']).with_suffix('.svg').read_text())
        null_save = self.save(url, '空标定', calibration=None, measureUnit='mm')
        latest = self.read(url, '/api/latest')
        self.assertIsNone(latest['calibration'])
        self.assertEqual(latest['measureUnit'], 'mm')
        self.assertIn('未标定毫米', Path(null_save['path']).with_suffix('.svg').read_text())

    def test_svg_export_expands_for_outside_curves_without_resizing_image_metadata(self):
        project = self.base/'无限画布导出'
        project.mkdir()
        _, url = self.start(project)
        image = {'name': 'pixel.png', 'dataUrl': 'data:image/png;base64,AA=='}
        def node(x, y):
            return {'x': x, 'y': y, 'in': {'x': x, 'y': y}, 'out': {'x': x, 'y': y}, 'mode': 'cusp'}
        path = {'id': 'outside', 'name': '越界线', 'note': '', 'closed': False,
                'color': '#123456', 'nodes': [node(-20, -30), node(340, 250)]}
        saved = self.save(url, '越界导出', width=300, height=200, image=image, paths=[path])
        persisted = json.loads(Path(saved['path']).read_text())
        self.assertEqual((persisted['width'], persisted['height']), (300, 200))
        svg = Path(saved['path']).with_suffix('.svg').read_text()
        self.assertIn('width="368px" height="288px" viewBox="-24 -34 368 288"', svg)
        self.assertIn('<image width="300" height="200"', svg)

    def test_hidden_paths_round_trip_stay_out_of_svg_and_require_a_boolean(self):
        project = self.base/'曲线可见性'
        project.mkdir()
        _, url = self.start(project)
        baseline = self.save(url, '原始范围')
        baseline_svg = Path(baseline['path']).with_suffix('.svg').read_text().splitlines()[0]
        paths = copy.deepcopy(SAMPLE['paths'])
        hidden = copy.deepcopy(paths[0])
        hidden.update(id='hidden', name='隐藏曲线', visible=False, color='#010203')
        for node in hidden['nodes']:
            for point in (node, node['in'], node['out']):
                point['x'] -= 10000
        paths.append(hidden)
        for extra in ({}, {'layers': [{'id': 'layer', 'name': '图层', 'visible': True, 'locked': False,
                                      'pathIds': [p['id'] for p in paths], 'imageIds': []}], 'images': []}):
            saved = self.save(url, '隐藏一条曲线', paths=paths, **extra)
            self.assertEqual(self.read(url, '/api/latest')['paths'], paths)
            svg = Path(saved['path']).with_suffix('.svg').read_text()
            self.assertEqual(svg.splitlines()[0], baseline_svg)
            self.assertNotIn('隐藏曲线', svg)
            self.assertNotIn('#010203', svg)
        for invalid in (1, 0, 'false', None, [], {}):
            with self.subTest(visible=invalid):
                invalid_paths = copy.deepcopy(paths)
                invalid_paths[0]['visible'] = invalid
                with self.assertRaises(HTTPError) as error:
                    self.save(url, '无效可见性', paths=invalid_paths)
                self.assertEqual(error.exception.code, 400)
                self.assertEqual(self.read(url, '/api/latest')['paths'], paths)

    def test_dashed_paths_round_trip_export_and_require_a_boolean(self):
        project = self.base/'虚线路径'
        project.mkdir()
        _, url = self.start(project)
        paths = copy.deepcopy(SAMPLE['paths'])
        paths[0]['dashed'] = True
        saved = self.save(url, '虚线保存', paths=paths)
        self.assertIs(self.read(url, '/api/latest')['paths'][0]['dashed'], True)
        self.assertIs(json.loads(Path(saved['path']).read_text())['paths'][0]['dashed'], True)
        self.assertIn('stroke-dasharray="8 6"', Path(saved['path']).with_suffix('.svg').read_text())

        solid = self.save(url, '旧文件实线')
        self.assertNotIn('dashed', self.read(url, '/api/latest')['paths'][0])
        self.assertNotIn('stroke-dasharray', Path(solid['path']).with_suffix('.svg').read_text())

        for invalid in (1, 0, 'true', None, [], {}):
            with self.subTest(dashed=invalid):
                invalid_paths = copy.deepcopy(SAMPLE['paths'])
                invalid_paths[0]['dashed'] = invalid
                with self.assertRaises(HTTPError) as error:
                    self.save(url, '无效虚线', paths=invalid_paths)
                self.assertEqual(error.exception.code, 400)
                error.exception.close()
        self.assertEqual(self.read(url, '/api/latest')['title'], '旧文件实线')

    def test_invalid_calibrations_and_measure_units_do_not_replace_latest(self):
        project = self.base/'无效标定'
        project.mkdir()
        _, url = self.start(project)
        valid = {'a': {'x': 0, 'y': 0}, 'b': {'x': 100, 'y': 0}, 'length': 10, 'unit': 'mm'}
        self.save(url, '有效标定', calibration=valid, measureUnit='mm')
        invalid_calibrations = [
            {},
            {'a': valid['a'], 'b': valid['b'], 'length': 0, 'unit': 'mm'},
            {'a': valid['a'], 'b': valid['b'], 'length': -1, 'unit': 'mm'},
            {'a': valid['a'], 'b': valid['b'], 'length': True, 'unit': 'mm'},
            {'a': valid['a'], 'b': valid['b'], 'length': 1e7 + 1, 'unit': 'mm'},
            {'a': valid['a'], 'b': valid['b'], 'length': float('nan'), 'unit': 'mm'},
            {'a': {'x': True, 'y': 0}, 'b': valid['b'], 'length': 10, 'unit': 'mm'},
            {'a': {'x': 1e7 + 1, 'y': 0}, 'b': valid['b'], 'length': 10, 'unit': 'mm'},
            {'a': {'x': 0, 'y': 0}, 'b': {'x': 1e-7, 'y': 0}, 'length': 10, 'unit': 'mm'},
            {'a': valid['a'], 'b': valid['b'], 'length': 10, 'unit': 'inch'},
        ]
        for invalid in invalid_calibrations:
            with self.subTest(calibration=invalid):
                with self.assertRaises(HTTPError) as error:
                    self.save(url, '无效标定', calibration=invalid)
                self.assertEqual(error.exception.code, 400)
                error.exception.close()
        for unit in ('inch', '', None, True):
            with self.subTest(measureUnit=unit):
                with self.assertRaises(HTTPError) as error:
                    self.save(url, '无效显示单位', measureUnit=unit)
                self.assertEqual(error.exception.code, 400)
                error.exception.close()
        latest = self.read(url, '/api/latest')
        self.assertEqual(latest['title'], '有效标定')
        self.assertEqual(latest['calibration'], valid)

    def test_layers_and_images_round_trip_and_svg_uses_visible_layer_order_and_bounds(self):
        project = self.base/'图层导出'
        project.mkdir()
        _, url = self.start(project)

        def node(x, y):
            return {'x': x, 'y': y, 'in': {'x': x, 'y': y}, 'out': {'x': x, 'y': y}, 'mode': 'cusp'}

        paths = [
            {'id': 'back-path', 'name': '后层路径', 'note': '', 'closed': False,
             'color': '#112233', 'nodes': [node(10, 10), node(30, 30)]},
            {'id': 'hidden-path', 'name': '隐藏路径', 'note': '', 'closed': False,
             'color': '#445566', 'nodes': [node(-900, -900), node(900, 900)]},
            {'id': 'front-path', 'name': '前层路径', 'note': '', 'closed': False,
             'color': '#778899', 'nodes': [node(40, 40), node(60, 60)]},
        ]
        images = [
            {'id': 'back-image', 'name': '后层图', 'dataUrl': 'data:image/png;base64,YmFjaw==',
             'x': -20, 'y': -30, 'width': 10, 'height': 15, 'opacity': .25},
            {'id': 'hidden-image', 'name': '隐藏图', 'dataUrl': 'data:image/jpeg;base64,aGlkZGVu',
             'x': -800, 'y': -800, 'width': 1600, 'height': 1600, 'opacity': 1},
            {'id': 'front-image', 'name': '前层图', 'dataUrl': 'data:image/webp;base64,ZnJvbnQ=',
             'x': 110, 'y': 20, 'width': 40, 'height': 50, 'opacity': .75},
        ]
        layers = [
            {'id': 'back', 'name': '后层', 'visible': True, 'locked': False,
             'pathIds': ['back-path'], 'imageIds': ['back-image']},
            {'id': 'hidden', 'name': '隐藏层', 'visible': False, 'locked': False,
             'pathIds': ['hidden-path'], 'imageIds': ['hidden-image']},
            {'id': 'front', 'name': '前层', 'visible': True, 'locked': True,
             'pathIds': ['front-path'], 'imageIds': ['front-image']},
        ]
        saved = self.save(url, '图层文档', width=100, height=100, image=None,
                          paths=paths, images=images, layers=layers)
        latest = self.read(url, '/api/latest')
        self.assertEqual(latest['images'], images)
        self.assertEqual(latest['layers'], layers)
        svg = Path(saved['path']).with_suffix('.svg').read_text()
        self.assertIn('viewBox="-24 -34 178 134"', svg)
        self.assertNotIn('aGlkZGVu', svg)
        self.assertNotIn('#445566', svg)
        expected = ['YmFjaw==', '#112233', 'ZnJvbnQ=', '#778899']
        positions = [svg.index(fragment) for fragment in expected]
        self.assertEqual(positions, sorted(positions))
        self.assertIn('x="-20" y="-30" width="10" height="15"', svg)
        self.assertIn('opacity="0.25"', svg)
        self.assertIn('preserveAspectRatio="none"', svg)
        self.assertIn('x="110" y="20" width="40" height="50"', svg)
        self.assertIn('opacity="0.75"', svg)

    def test_invalid_layers_images_and_references_do_not_replace_latest(self):
        project = self.base/'无效图层'
        project.mkdir()
        _, url = self.start(project)
        self.save(url, '有效基线')

        path_id = SAMPLE['paths'][0]['id']
        image = {'id': 'image-1', 'name': '图片', 'dataUrl': 'data:image/png;base64,AA==',
                 'x': 0, 'y': 0, 'width': 10, 'height': 20, 'opacity': 1}
        layer = {'id': 'layer-1', 'name': '图层', 'visible': True, 'locked': False,
                 'pathIds': [path_id], 'imageIds': ['image-1']}
        invalid = [
            {'images': [image]},
            {'layers': [layer]},
            {'paths': [], 'images': [], 'layers': []},
            {'images': [image], 'layers': [{**layer, 'id': ''}]},
            {'images': [image], 'layers': [{**layer, 'id': '   '}]},
            {'images': [image], 'layers': [{**layer, 'id': 'l' * 201}]},
            {'images': [{**image, 'id': ''}], 'layers': [layer]},
            {'images': [{**image, 'id': '\t'}], 'layers': [{**layer, 'imageIds': ['\t']}]},
            {'images': [{**image, 'id': 'i' * 201}], 'layers': [{**layer, 'imageIds': ['i' * 201]}]},
            {'images': [image, image], 'layers': [layer]},
            {'images': [image], 'layers': [layer, layer]},
            {'images': [{**image, 'x': True}], 'layers': [layer]},
            {'images': [{**image, 'y': 1e7 + 1}], 'layers': [layer]},
            {'images': [{**image, 'width': 0}], 'layers': [layer]},
            {'images': [{**image, 'height': -1}], 'layers': [layer]},
            {'images': [{**image, 'opacity': 1.01}], 'layers': [layer]},
            {'images': [{**image, 'opacity': float('nan')}], 'layers': [layer]},
            {'images': [image], 'layers': [{**layer, 'visible': 1}]},
            {'images': [image], 'layers': [{**layer, 'locked': 0}]},
            {'images': [image], 'layers': [{**layer, 'pathIds': ['missing']}]},
            {'images': [image], 'layers': [{**layer, 'imageIds': ['missing']}]},
            {'images': [image], 'layers': [{**layer, 'pathIds': []}]},
            {'images': [image], 'layers': [{**layer, 'imageIds': []}]},
            {'images': [image], 'layers': [layer, {**layer, 'id': 'layer-2'}]},
            {'images': [image], 'layers': [layer, {**layer, 'id': 'layer-2', 'pathIds': [], 'imageIds': ['image-1']}]},
            {'images': [image] * 201, 'layers': [layer]},
            {'images': [image], 'layers': [{**layer, 'id': f'layer-{index}'} for index in range(201)]},
        ]
        for extra in invalid:
            with self.subTest(extra=extra):
                with self.assertRaises(HTTPError) as error:
                    self.save(url, '无效图层', image=None, **extra)
                self.assertEqual(error.exception.code, 400)
                error.exception.close()
        self.assertEqual(self.read(url, '/api/latest')['title'], '有效基线')

    def test_legacy_image_export_and_editor_script_routes_remain_available(self):
        project = self.base/'兼容性'
        project.mkdir()
        _, url = self.start(project)
        legacy_image = {'name': 'legacy.png', 'dataUrl': 'data:image/png;base64,bGVnYWN5'}
        saved = self.save(url, '旧底图', image=legacy_image)
        self.assertEqual(self.read(url, '/api/latest')['image'], legacy_image)
        svg = Path(saved['path']).with_suffix('.svg').read_text()
        self.assertIn('bGVnYWN5', svg)
        self.assertIn(f'width="{SAMPLE["width"]}" height="{SAMPLE["height"]}"', svg)
        with urlopen(url + '/layers.js', timeout=3) as response:
            self.assertEqual(response.status, 200)
        with urlopen(url + '/tracing.js', timeout=3) as response:
            self.assertEqual(response.status, 200)
            self.assertIn(b'CurveTracing', response.read())
        for resource in ('/offset.js', '/vendor/clipper.js'):
            with urlopen(url + resource, timeout=3) as response:
                self.assertEqual(response.status, 200)
                self.assertIn('javascript', response.headers['Content-Type'])

    def test_two_projects_save_separately_and_reuse_only_matching_server(self):
        a, b = self.base/'项目 A', self.base/'项目 B'
        a.mkdir(); b.mkdir()
        process_a, url_a = self.start(a)
        process_b, url_b = self.start(b)
        self.assertNotEqual(url_a, url_b)
        self.assertEqual(self.read(url_a, '/api/health')['project'], str(a.resolve()))
        self.assertEqual(self.read(url_b, '/api/health')['project'], str(b.resolve()))
        self.assertIsNone(self.read(url_a, '/api/latest'))
        self.assertIsNone(self.read(url_b, '/api/latest'))
        saved_a = self.save(url_a, '项目A修改')
        saved_b = self.save(url_b, '项目B修改')
        self.assertTrue(Path(saved_a['path']).is_relative_to(a.resolve()))
        self.assertTrue(Path(saved_b['path']).is_relative_to(b.resolve()))
        self.assertEqual(self.read(url_a, '/api/latest')['title'], '项目A修改')
        self.assertEqual(self.read(url_b, '/api/latest')['title'], '项目B修改')
        with urlopen(url_a + '/', timeout=3) as response:
            self.assertIn('通用矢量图编辑器', response.read().decode())
        again, same_url = self.start(a, port="auto")
        self.assertEqual(same_url, url_a)
        self.assertEqual(again.wait(timeout=3), 0)
        conflict = subprocess.run([sys.executable, str(SERVER), '--project', str(a), '--port', url_b.rsplit(':',1)[1]], capture_output=True, text=True, timeout=5)
        self.assertNotEqual(conflict.returncode, 0)
        self.assertEqual(self.read(url_b, '/api/latest')['title'], '项目B修改')

    def test_nonexistent_project_is_rejected_without_creating_it(self):
        missing = self.base/'不存在'
        proc = subprocess.run([sys.executable, str(SERVER), '--project', str(missing), '--port', 'auto'], capture_output=True, text=True, timeout=5)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('项目目录不存在', proc.stderr + proc.stdout)
        self.assertFalse(missing.exists())

if __name__ == '__main__':
    unittest.main()
