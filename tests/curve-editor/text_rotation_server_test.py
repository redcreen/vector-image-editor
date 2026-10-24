"""Backend persistence and SVG export tests for rotated text elements."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools/curve-editor"
sys.path.insert(0, str(TOOLS))
SPEC = importlib.util.spec_from_file_location("curve_editor_text_rotation_server", TOOLS / "server.py")
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)
SAMPLE = json.loads((TOOLS / "examples/心形_可编辑示例.json").read_text(encoding="utf-8"))


class TextRotationServerTests(unittest.TestCase):
    def text(self, **changes):
        value = {
            "id": "text-1",
            "name": "标题",
            "content": "AB",
            "x": 90,
            "y": 70,
            "fontSize": 20,
            "color": "#123ABC",
        }
        value.update(changes)
        return value

    def document(self, text):
        document = copy.deepcopy(SAMPLE)
        document.update({
            "width": 100,
            "height": 80,
            "paths": [],
            "images": [],
            "texts": [text],
            "layers": [{
                "id": "layer-1",
                "name": "文字",
                "visible": True,
                "locked": False,
                "pathIds": [],
                "imageIds": [],
                "textIds": [text["id"]],
            }],
        })
        return document

    def test_rotation_is_optional_and_missing_field_is_not_normalized(self):
        document = self.document(self.text())
        original = copy.deepcopy(document)

        SERVER.validate(document)
        svg = SERVER.preview_svg(document)

        self.assertEqual(document, original)
        self.assertNotIn("rotation", document["texts"][0])
        self.assertNotIn('transform="rotate(', svg)

    def test_rotation_accepts_finite_degrees_within_limit_and_rejects_invalid_values(self):
        for rotation in (-10_000_000, -12.5, 0, 359.75, 10_000_000):
            with self.subTest(valid=rotation):
                SERVER.validate(self.document(self.text(rotation=rotation)))

        for rotation in (True, False, None, "90", float("nan"), float("inf"), -10_000_001, 10_000_001):
            with self.subTest(invalid=rotation):
                with self.assertRaises(ValueError):
                    SERVER.validate(self.document(self.text(rotation=rotation)))

    def test_persisted_json_and_svg_keep_rotation_around_unrotated_top_left_anchor(self):
        document = self.document(self.text(rotation=90))
        with tempfile.TemporaryDirectory() as directory, patch.object(SERVER, "SAVES", Path(directory)):
            result = SERVER.persist(document)
            saved_path = Path(result["path"])
            persisted = json.loads(saved_path.read_text(encoding="utf-8"))
            svg = saved_path.with_suffix(".svg").read_text(encoding="utf-8")

        self.assertEqual(persisted["texts"][0]["rotation"], 90)
        self.assertIn('transform="rotate(90 90 70)"', svg)
        self.assertIn('<text x="90" y="90"', svg)
        self.assertIn('<tspan x="90" y="90">AB</tspan>', svg)

    def test_saved_svg_bounds_include_all_rotated_text_extent_corners(self):
        document = self.document(self.text(rotation=90))

        self.assertEqual(SERVER.export_bounds(document), (0, 0, 100, 122))
        self.assertIn('viewBox="0 0 100 122"', SERVER.preview_svg(document))


if __name__ == "__main__":
    unittest.main()
