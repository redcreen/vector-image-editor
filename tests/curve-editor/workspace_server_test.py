#!/usr/bin/env python3
"""Black-box coverage for per-session and named shared editor workspaces."""
import copy
import hashlib
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
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import ProxyHandler, Request, build_opener, install_opener, urlopen


ROOT = Path(__file__).resolve().parents[2]
SERVER = Path(os.environ.get("CURVE_EDITOR_SERVER", ROOT / "tools/curve-editor/server.py"))
SAMPLE = json.loads((ROOT / "tools/curve-editor/examples/心形_可编辑示例.json").read_text())
install_opener(build_opener(ProxyHandler({})))


def digest(identifier):
    return hashlib.sha256(identifier.encode("utf-8")).hexdigest()


class WorkspaceServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="curve-workspace-test-")
        self.base = Path(self.temp.name)
        self.children = []

    def tearDown(self):
        for process in self.children:
            if process.poll() is None:
                process.terminate()
            try:
                process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate(timeout=5)
        self.temp.cleanup()

    def project(self, name="project"):
        project = self.base / name
        project.mkdir()
        return project.resolve()

    def clean_env(self, *, thread_id=None, session_id=None):
        env = {**os.environ, "CURVE_EDITOR_EDITION": "test", "CURVE_EDITOR_REGISTRY": str(self.base / "registry"), "CURVE_EDITOR_SCAN_PORTS": ""}
        env.pop("CODEX_THREAD_ID", None)
        env.pop("CODEX_SESSION_ID", None)
        if thread_id is not None:
            env["CODEX_THREAD_ID"] = thread_id
        if session_id is not None:
            env["CODEX_SESSION_ID"] = session_id
        return env

    def start(self, project, *workspace_args, thread_id=None, session_id=None, port="0"):
        command = [
            sys.executable,
            str(SERVER),
            "--project",
            str(project),
            "--port",
            port,
            *workspace_args,
        ]
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=self.clean_env(thread_id=thread_id, session_id=session_id),
        )
        self.children.append(process)
        deadline = time.monotonic() + 10
        output = []
        while time.monotonic() < deadline:
            if select.select([process.stdout], [], [], 0.1)[0]:
                line = process.stdout.readline()
                if not line:
                    break
                output.append(line)
                marker = "http://127.0.0.1:"
                if marker in line:
                    launch_url = line[line.index(marker):].strip()
                    parsed = urlsplit(launch_url)
                    base_url = f"{parsed.scheme}://{parsed.netloc}"
                    return process, launch_url, base_url
            elif process.poll() is not None:
                break
        if process.stdout:
            output.append(process.stdout.read())
        self.fail(
            f"Server did not start (exit={process.poll()}): " + "".join(output)
        )

    def read(self, base_url, path):
        with urlopen(base_url + path, timeout=3) as response:
            return json.load(response)

    def save(self, base_url, title):
        document = copy.deepcopy(SAMPLE)
        document["title"] = title
        request = Request(
            base_url + "/api/save",
            data=json.dumps(document).encode(),
            headers={"Content-Type": "application/json", "Origin": base_url},
        )
        with urlopen(request, timeout=3) as response:
            return json.load(response)

    def assert_health(self, base_url, project, mode, identifier, saves):
        health = self.read(base_url, "/api/health")
        self.assertEqual(health["project"], str(project.resolve()))
        self.assertEqual(health["saves"], str(saves))
        self.assertEqual(health["workspace"], {"mode": mode, "id": identifier})
        self.assertRegex(health["editorRevision"], r"^editor-[0-9a-f]{16}$")
        return health

    def test_explicit_sessions_isolate_latest_and_exact_session_reuses(self):
        project = self.project()
        expected_a = project / "work/curve_editor/test-sessions/isolated" / digest("session-A")
        expected_b = project / "work/curve_editor/test-sessions/isolated" / digest("session-B")

        process_a, launch_a, base_a = self.start(project, "--session", "session-A")
        self.assertEqual(urlsplit(launch_a).query, "")
        self.assert_health(base_a, project, "isolated", "session-A", expected_a)
        saved_a = self.save(base_a, "A 的第一版")
        self.assertEqual(Path(saved_a["path"]).parent, expected_a)

        process_b, _, base_b = self.start(project, "--session", "session-B")
        self.assertNotEqual(urlsplit(base_a).port, urlsplit(base_b).port)
        self.assert_health(base_b, project, "isolated", "session-B", expected_b)
        self.assertIsNone(self.read(base_b, "/api/latest"))
        saved_b = self.save(base_b, "B 的第一版")
        self.assertEqual(Path(saved_b["path"]).parent, expected_b)
        self.assertEqual(self.read(base_a, "/api/latest")["title"], "A 的第一版")

        reused, _, reused_base = self.start(project, "--session", "session-A", port="auto")
        self.assertEqual(reused_base, base_a)
        self.assertEqual(self.read(reused_base, "/api/latest")["title"], "A 的第一版")
        self.assertIsNone(process_a.poll())
        self.assertIsNone(process_b.poll())
        reused.wait(timeout=5)

        other_project = self.project("other-project")
        _, _, other_base = self.start(other_project, "--session", "session-A")
        self.assertNotEqual(urlsplit(other_base).port, urlsplit(base_a).port)
        self.assertIsNone(self.read(other_base, "/api/latest"))

    def test_named_shared_workspace_reuses_saved_latest_with_per_client_urls(self):
        project = self.project()
        name = "review-team"
        expected = project / "work/curve_editor/test-sessions/shared" / digest(name)

        owner, owner_launch, owner_base = self.start(
            project, "--shared", name, thread_id="thread-owner"
        )
        self.assert_health(owner_base, project, "shared", name, expected)
        self.assertEqual(parse_qs(urlsplit(owner_launch).query), {"client": ["thread-owner"]})
        self.save(owner_base, "所有者保存")

        joiner, joiner_launch, joiner_base = self.start(
            project, "--shared", name, thread_id="thread-joiner", port="auto"
        )
        self.assertEqual(joiner_base, owner_base)
        self.assertNotEqual(joiner_launch, owner_launch)
        self.assertEqual(parse_qs(urlsplit(joiner_launch).query), {"client": ["thread-joiner"]})
        self.assertEqual(self.read(joiner_base, "/api/latest")["title"], "所有者保存")
        self.save(joiner_base, "接续保存")
        self.assertEqual(self.read(owner_base, "/api/latest")["title"], "接续保存")
        self.assertIsNone(owner.poll())
        joiner.wait(timeout=5)

    def test_shared_default_preserves_and_updates_legacy_latest(self):
        project = self.project()
        legacy = project / "work/curve_editor/test-sessions"
        legacy.mkdir(parents=True)
        old_document = copy.deepcopy(SAMPLE)
        old_document["title"] = "迁移前作品"
        old_file = legacy / "legacy.json"
        old_file.write_text(json.dumps(old_document, ensure_ascii=False))
        (legacy / "latest.txt").write_text(old_file.name)

        _, launch_url, base_url = self.start(
            project, "--shared", "default", session_id="legacy-client"
        )
        self.assert_health(base_url, project, "shared", "default", legacy)
        self.assertEqual(parse_qs(urlsplit(launch_url).query), {"client": ["legacy-client"]})
        self.assertEqual(self.read(base_url, "/api/latest")["title"], "迁移前作品")
        new_save = self.save(base_url, "迁移后作品")
        self.assertTrue(old_file.exists())
        self.assertEqual(Path(new_save["path"]).parent, legacy)
        self.assertEqual(self.read(base_url, "/api/latest")["title"], "迁移后作品")

    def test_default_identity_prefers_thread_then_falls_back_to_session(self):
        project = self.project()
        _, thread_launch, thread_base = self.start(
            project, thread_id="thread-wins", session_id="session-loses"
        )
        self.assertEqual(urlsplit(thread_launch).query, "")
        self.assert_health(
            thread_base,
            project,
            "isolated",
            "thread-wins",
            project / "work/curve_editor/test-sessions/isolated" / digest("thread-wins"),
        )

        _, _, session_base = self.start(project, session_id="session-fallback")
        self.assert_health(
            session_base,
            project,
            "isolated",
            "session-fallback",
            project / "work/curve_editor/test-sessions/isolated" / digest("session-fallback"),
        )

    def test_missing_environment_identity_creates_unique_private_workspaces(self):
        project = self.project()
        _, launch_one, base_one = self.start(project)
        _, launch_two, base_two = self.start(project)
        health_one = self.read(base_one, "/api/health")
        health_two = self.read(base_two, "/api/health")

        self.assertEqual(urlsplit(launch_one).query, "")
        self.assertEqual(urlsplit(launch_two).query, "")
        self.assertEqual(health_one["workspace"]["mode"], "isolated")
        self.assertEqual(health_two["workspace"]["mode"], "isolated")
        self.assertNotEqual(health_one["workspace"]["id"], health_two["workspace"]["id"])
        self.assertNotEqual(base_one, base_two)
        for health in (health_one, health_two):
            identifier = health["workspace"]["id"]
            expected = project / "work/curve_editor/test-sessions/isolated" / digest(identifier)
            self.assertEqual(health["saves"], str(expected))
            self.assertRegex(health["editorRevision"], r"^editor-[0-9a-f]{16}$")

    def test_identifiers_are_hashed_and_symlink_escape_is_refused(self):
        project = self.project()
        unsafe_label = "../escape/../../另一个项目"
        expected = project / "work/curve_editor/test-sessions/isolated" / digest(unsafe_label)
        _, _, base_url = self.start(project, "--session", unsafe_label)
        self.assert_health(base_url, project, "isolated", unsafe_label, expected)
        saved = self.save(base_url, "安全映射")
        self.assertEqual(Path(saved["path"]).parent, expected)
        self.assertFalse((self.base / "escape").exists())

        alias_project = self.project("alias-project")
        shared_target = alias_project / "work/curve_editor/test-sessions/isolated" / digest("target")
        shared_target.mkdir(parents=True)
        (shared_target.parent / digest("alias")).symlink_to(shared_target, target_is_directory=True)
        try:
            alias = subprocess.run(
                [sys.executable, str(SERVER), "--project", str(alias_project), "--port", "auto", "--session", "alias"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                env=self.clean_env(), timeout=5,
            )
        except subprocess.TimeoutExpired:
            self.fail("Server accepted an alias to another session's save directory")
        self.assertNotEqual(alias.returncode, 0, "Session alias must not share another session's directory")
        self.assertIn("符号链接", alias.stdout)

        symlink_project = self.project("symlink-project")
        outside = self.base / "outside"
        outside.mkdir()
        identifier = "symlink-target"
        scoped_root = symlink_project / "work/curve_editor/test-sessions/isolated"
        scoped_root.mkdir(parents=True)
        (scoped_root / digest(identifier)).symlink_to(outside, target_is_directory=True)
        command = [
            sys.executable,
            str(SERVER),
            "--project",
            str(symlink_project),
            "--port",
            "auto",
            "--session",
            identifier,
        ]
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=self.clean_env(),
        )
        self.children.append(process)
        try:
            output, _ = process.communicate(timeout=4)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.communicate(timeout=5)
            self.fail("Server accepted a save directory symlink that escapes the project")
        self.assertNotEqual(process.returncode, 0, output)
        self.assertEqual(list(outside.iterdir()), [])

    def test_old_revision_server_is_preserved_but_not_reused(self):
        project = self.project()
        identifier = "revision-check"
        saves = project / "work/curve_editor/test-sessions/isolated" / digest(identifier)
        saves.parent.mkdir(parents=True)

        class OldHandler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                body = json.dumps({
                    "app": "daban-curve-editor-v1",
                    "project": str(project.resolve()),
                    "saves": str(saves),
                    "workspace": {"mode": "isolated", "id": identifier},
                    "editorRevision": "editor-outline-v1",
                }).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        old_server = ThreadingHTTPServer(("127.0.0.1", 0), OldHandler)
        old_thread = threading.Thread(target=old_server.serve_forever, daemon=True)
        old_thread.start()
        self.addCleanup(old_server.server_close)
        self.addCleanup(old_server.shutdown)
        state_file = project / "work/curve_editor/server.json"
        state_file.write_text(json.dumps({"port": old_server.server_port}))

        process, _, base_url = self.start(project, "--session", identifier)
        self.assertNotEqual(urlsplit(base_url).port, old_server.server_port)
        self.assertIsNone(process.poll())
        self.assertRegex(self.read(base_url, "/api/health")["editorRevision"], r"^editor-[0-9a-f]{16}$")
        self.assertTrue(old_thread.is_alive())

    def test_session_and_shared_options_are_mutually_exclusive(self):
        project = self.project()
        result = subprocess.run(
            [
                sys.executable,
                str(SERVER),
                "--project",
                str(project),
                "--port",
                "auto",
                "--session",
                "private",
                "--shared",
                "team",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=self.clean_env(),
            timeout=5,
        )
        self.assertNotEqual(result.returncode, 0, result.stdout)


if __name__ == "__main__":
    unittest.main()
