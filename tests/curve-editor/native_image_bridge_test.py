"""Native clipboard boundary tests use mocks, never the user's clipboard."""
import base64
import json
import math
from pathlib import Path
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/curve-editor'))
import native_image_clipboard as native
import server

DATA = base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode()
META = {'dpiX': 300, 'dpiY': 150, 'orientation': 1, 'source': 'macos-clipboard'}

class NativeBridgeTests(unittest.TestCase):
    def test_request_validation_happens_before_any_native_access(self):
        with patch.object(native, 'helper_path') as helper:
            for value in [None, [], {}, {'data': ''}, {'data': '!!!'}, {'data': DATA, 'path': '/private/file'}, {'data': 42}]:
                with self.subTest(value=value), self.assertRaises(ValueError):
                    native.read_metadata(value)
            helper.assert_not_called()

    def test_helper_receives_only_matching_image_bytes_and_returns_only_valid_metadata(self):
        with patch.object(native, 'helper_path', return_value=Path('/fake/native-helper')), patch.object(native.subprocess, 'run') as run:
            run.return_value = subprocess.CompletedProcess([], 0, json.dumps({'metadata': META, 'secret': 'must not escape'}).encode(), b'')
            self.assertEqual(native.read_metadata({'data': DATA}), {'metadata': META})
            args, kwargs = run.call_args
            self.assertEqual(args[0], ['/fake/native-helper'])
            self.assertEqual(json.loads(kwargs['input']), {'data': DATA})
            self.assertLessEqual(kwargs['timeout'], 5)
            for bad in [{**META, 'dpiX': 0}, {**META, 'dpiY': float('inf')}, {**META, 'orientation': 6}, {**META, 'dpiX': True}]:
                run.return_value.stdout = json.dumps({'metadata': bad}).encode()
                self.assertEqual(native.read_metadata({'data': DATA}), {'metadata': None})

    def test_scanner_default_provenance_is_preserved(self):
        meta = {**META, 'dpiX': 100, 'dpiY': 100, 'defaultDpi': True}
        with patch.object(native, 'helper_path', return_value=Path('/fake/native-helper')), patch.object(native.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps({'metadata': meta}).encode(), b'')):
            self.assertEqual(native.read_metadata({'data': DATA}), {'metadata': meta})

    def test_no_helper_failure_timeout_and_busy_are_silent_pixel_fallback(self):
        with patch.object(native, 'helper_path', return_value=None):
            self.assertEqual(native.read_metadata({'data': DATA}), {'metadata': None})
        with patch.object(native, 'helper_path', return_value=Path('/fake/native-helper')), patch.object(native.subprocess, 'run') as run:
            for failure in [OSError('not available'), subprocess.TimeoutExpired('helper', 3)]:
                run.side_effect = failure
                self.assertEqual(native.read_metadata({'data': DATA}), {'metadata': None})
            run.side_effect = None
            run.return_value = subprocess.CompletedProcess([], 1, b'bad', b'private content')
            self.assertEqual(native.read_metadata({'data': DATA}), {'metadata': None})

class NativeHTTPTests(unittest.TestCase):
    def setUp(self):
        self.http = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True);self.thread.start()
        self.url = f'http://127.0.0.1:{self.http.server_port}'
    def tearDown(self):
        self.http.shutdown();self.http.server_close();self.thread.join()
    def post(self, payload, origin=None, site='same-origin'):
        return urlopen(Request(self.url+'/api/image-clipboard', data=json.dumps(payload).encode(), headers={'Content-Type':'application/json','Origin':self.url if origin is None else origin,'Sec-Fetch-Site':site}), timeout=5)
    def test_same_origin_image_request_is_read_only_and_returns_metadata(self):
        with patch.object(native, 'read_metadata', return_value={'metadata': META}) as read:
            with self.post({'data': DATA}) as response:self.assertEqual(json.load(response), {'metadata': META})
            read.assert_called_once_with({'data': DATA})
    def test_foreign_origin_cross_site_and_get_do_not_read_clipboard(self):
        with patch.object(native, 'read_metadata') as read:
            for kwargs in [{'origin':'https://example.com'}, {'site':'cross-site'}]:
                with self.assertRaises(HTTPError) as caught:self.post({'data': DATA}, **kwargs)
                self.assertEqual(caught.exception.code,403);caught.exception.close()
            with self.assertRaises(HTTPError) as caught:urlopen(self.url+'/api/image-clipboard')
            self.assertEqual(caught.exception.code,404);caught.exception.close();read.assert_not_called()
    def test_invalid_input_does_not_invoke_helper(self):
        with patch.object(native, 'helper_path') as helper:
            with self.assertRaises(HTTPError) as caught:self.post({'data':'bad','path':'/tmp/no'})
            self.assertEqual(caught.exception.code,400);caught.exception.close();helper.assert_not_called()

if __name__ == '__main__':unittest.main()
