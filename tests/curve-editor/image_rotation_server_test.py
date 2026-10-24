"""Backend validation and SVG preview tests for rotated image elements."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools/curve-editor"
sys.path.insert(0, str(TOOLS))
SPEC = importlib.util.spec_from_file_location("curve_editor_image_rotation_server", TOOLS / "server.py")
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)
SAMPLE = json.loads((TOOLS / "examples/心形_可编辑示例.json").read_text(encoding="utf-8"))


class ImageRotationServerTests(unittest.TestCase):
    def image(self, **changes):
        value = {
            "id": "image-1",
            "name": "参考.png",
            "dataUrl": "data:image/png;base64,cm90YXRlZA==",
            "x": -10,
            "y": 10,
            "width": 20,
            "height": 40,
            "opacity": 1,
        }
        value.update(changes)
        return value

    def document(self, image):
        document = copy.deepcopy(SAMPLE)
        document.update({
            "width": 100,
            "height": 100,
            "paths": [],
            "images": [image],
            "layers": [{
                "id": "layer-1",
                "name": "图片",
                "visible": True,
                "locked": False,
                "pathIds": [],
                "imageIds": [image["id"]],
            }],
        })
        return document

    def test_rotation_is_optional_and_missing_field_is_not_normalized(self):
        document = self.document(self.image())
        original = copy.deepcopy(document)

        SERVER.validate(document)
        SERVER.preview_svg(document)

        self.assertEqual(document, original)
        self.assertNotIn("rotation", document["images"][0])

    def test_rotation_accepts_finite_degrees_within_limit_and_rejects_invalid_values(self):
        for rotation in (-10_000_000, -12.5, 0, 359.75, 10_000_000):
            with self.subTest(valid=rotation):
                SERVER.validate(self.document(self.image(rotation=rotation)))

        for rotation in (True, False, None, "90", float("nan"), float("inf"), -10_000_001, 10_000_001):
            with self.subTest(invalid=rotation):
                with self.assertRaises(ValueError):
                    SERVER.validate(self.document(self.image(rotation=rotation)))

    def test_svg_rotates_clockwise_around_image_center_and_preserves_bitmap(self):
        document = self.document(self.image(rotation=90))

        svg = SERVER.preview_svg(document)

        self.assertIn('transform="rotate(90 0 30)"', svg)
        self.assertIn('href="data:image/png;base64,cm90YXRlZA=="', svg)
        self.assertIn('x="-10" y="10" width="20" height="40"', svg)

    def test_explicit_zero_rotation_is_rendered_without_adding_it_to_old_images(self):
        self.assertIn('transform="rotate(0 0 30)"', SERVER.preview_svg(self.document(self.image(rotation=0))))
        self.assertNotIn('transform="rotate(', SERVER.preview_svg(self.document(self.image())))

    def test_export_bounds_include_all_four_rotated_corners(self):
        document = self.document(self.image(rotation=90))

        self.assertEqual(SERVER.export_bounds(document), (-24, 0, 124, 100))
        self.assertIn('viewBox="-24 0 124 100"', SERVER.preview_svg(document))


if __name__ == "__main__":
    unittest.main()
