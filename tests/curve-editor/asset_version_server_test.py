"""Keep each running editor on one coherent browser-asset revision."""
import json
import os
from pathlib import Path
import select
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.error import HTTPError
from urllib.request import ProxyHandler, build_opener


ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools/curve-editor"
HTTP = build_opener(ProxyHandler({}))


class StaticAssetVersionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="curve-asset-version-")
        self.base = Path(self.temp.name)
        self.tools = self.base / "curve-editor"
        self.project = self.base / "project"
        shutil.copytree(TOOLS, self.tools)
        self.project.mkdir()
        self.processes = []

    def tearDown(self):
        for process in self.processes:
            if process.poll() is None:
                process.terminate()
            process.communicate(timeout=5)
        self.temp.cleanup()

    def start(self):
        process = subprocess.Popen(
            [sys.executable, str(self.tools / "server.py"), "--project", str(self.project),
             "--port", "0", "--shared", "default"],
            env={**os.environ, "CURVE_EDITOR_EDITION": "test",
                 "CURVE_EDITOR_REGISTRY": str(self.base / "registry"),
                 "CURVE_EDITOR_SCAN_PORTS": ""},
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        self.processes.append(process)
        deadline = time.monotonic() + 10
        lines = []
        while time.monotonic() < deadline:
            if not select.select([process.stdout], [], [], .1)[0]:
                continue
            line = process.stdout.readline()
            if not line:
                break
            lines.append(line)
            if "http://127.0.0.1:" in line:
                url = line[line.index("http://127.0.0.1:"):].strip().split("?", 1)[0]
                return url
        self.fail("Server did not start: " + "".join(lines))

    def get(self, url, path):
        with HTTP.open(url + path, timeout=3) as response:
            return response.read()

    def test_running_server_keeps_startup_assets_while_new_server_gets_new_revision(self):
        old_url = self.start()
        old_index = self.get(old_url, "/index.html")
        old_app = self.get(old_url, "/app.js")
        old_health = json.loads(self.get(old_url, "/api/health"))

        new_index = old_index + b'\n<script src="startup-addon.js"></script>\n'
        new_app = old_app + b"\nwindow.startupAssetRevision = 'updated';\n"
        addon = b"window.startupAddonLoaded = true;\n"
        (self.tools / "index.html").write_bytes(new_index)
        (self.tools / "app.js").write_bytes(new_app)
        (self.tools / "startup-addon.js").write_bytes(addon)
        server_path = self.tools / "server.py"
        source = server_path.read_text()
        anchor = 'ALLOWED["/vector-files.js"] = ("vector-files.js", "text/javascript")\n'
        self.assertIn(anchor, source)
        server_path.write_text(source.replace(
            anchor, anchor + 'ALLOWED["/startup-addon.js"] = ("startup-addon.js", "text/javascript")\n', 1))

        self.assertEqual(self.get(old_url, "/index.html"), old_index)
        self.assertEqual(self.get(old_url, "/app.js"), old_app)
        with self.assertRaises(HTTPError) as denied:
            self.get(old_url, "/startup-addon.js")
        self.assertEqual(denied.exception.code, 404)
        denied.exception.close()

        new_url = self.start()
        new_health = json.loads(self.get(new_url, "/api/health"))
        self.assertEqual(self.get(new_url, "/index.html"), new_index)
        self.assertEqual(self.get(new_url, "/app.js"), new_app)
        self.assertEqual(self.get(new_url, "/startup-addon.js"), addon)
        self.assertNotEqual(new_health["editorRevision"], old_health["editorRevision"])

    def test_latest_document_is_read_live_after_startup(self):
        url = self.start()
        saves = Path(json.loads(self.get(url, "/api/health"))["saves"])
        first = {"title": "first"}
        second = {"title": "second"}
        (saves / "first.json").write_text(json.dumps(first))
        (saves / "latest.txt").write_text("first.json")
        self.assertEqual(json.loads(self.get(url, "/api/latest")), first)
        (saves / "second.json").write_text(json.dumps(second))
        (saves / "latest.txt").write_text("second.json")
        self.assertEqual(json.loads(self.get(url, "/api/latest")), second)


if __name__ == "__main__":
    unittest.main()
