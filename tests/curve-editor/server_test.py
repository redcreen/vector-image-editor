"""Exercise the actual HTTP server across independent project directories."""
import copy
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[2]
SERVER = Path(os.environ.get('CURVE_EDITOR_SERVER', ROOT / 'tools/curve-editor/server.py'))
SAMPLE = json.loads((ROOT / 'tools/curve-editor/examples/心形_可编辑示例.json').read_text())

class ProjectIsolationTests(unittest.TestCase):
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

    def start(self, project):
        proc = subprocess.Popen([sys.executable, str(SERVER), '--project', str(project), '--port', 'auto'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
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
                return proc, line[line.index('http://127.0.0.1:'):].strip()
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
        again, same_url = self.start(a)
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
