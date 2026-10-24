"""Backend validation, persistence, and SVG tests for position markers."""
import copy
import importlib.util
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools/curve-editor"
sys.path.insert(0, str(TOOLS))
SPEC = importlib.util.spec_from_file_location("curve_editor_position_marker_server", TOOLS / "server.py")
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)
import vector_io
SAMPLE = json.loads((TOOLS / "examples/心形_可编辑示例.json").read_text(encoding="utf-8"))


class PositionMarkerServerTests(unittest.TestCase):
    def text(self, **changes):
        value = {
            "id": "text-1",
            "name": "位置标注 1",
            "content": "A12",
            "x": 90,
            "y": 70,
            "fontSize": 20,
            "color": "#123ABC",
            "rotation": 90,
            "positionMarker": {"x": -10, "y": -20, "pathId": "curve-1", "source": "node-7"},
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
                "id": "position-markers",
                "name": "位置标注",
                "visible": True,
                "locked": False,
                "pathIds": [],
                "imageIds": [],
                "textIds": [text["id"]],
            }],
        })
        return document

    def test_position_marker_coordinates_and_alphanumeric_content_are_validated(self):
        for coordinate in (-10_000_000, -12.5, 0, 81.25, 10_000_000):
            with self.subTest(valid=coordinate):
                SERVER.validate(self.document(self.text(positionMarker={"x": coordinate, "y": 1, "extra": True})))

        invalid_markers = [
            None,
            [],
            {},
            {"x": 1},
            {"y": 1},
            {"x": True, "y": 1},
            {"x": 1, "y": False},
            {"x": "1", "y": 1},
            {"x": math.nan, "y": 1},
            {"x": math.inf, "y": 1},
            {"x": -10_000_001, "y": 1},
            {"x": 1, "y": 10_000_001},
        ]
        for marker in invalid_markers:
            with self.subTest(invalid=marker):
                with self.assertRaises(ValueError):
                    SERVER.validate(self.document(self.text(positionMarker=marker)))

        for path_id in (None, "", 123, "x" * 201):
            with self.subTest(invalid_path_id=path_id):
                marker = {"x": 1, "y": 2, "pathId": path_id}
                with self.assertRaises(ValueError):
                    SERVER.validate(self.document(self.text(positionMarker=marker)))

        valid_attachments = [
            {"kind": "node", "index": 0},
            {"kind": "segment", "index": 7, "t": 0.25},
        ]
        for attachment in valid_attachments:
            with self.subTest(valid_attachment=attachment):
                marker = {"x": 1, "y": 2, "pathId": "curve-1", "attachment": attachment}
                SERVER.validate(self.document(self.text(positionMarker=marker)))
        invalid_attachments = [
            None, {}, {"kind": "node", "index": -1}, {"kind": "node", "index": 1.5},
            {"kind": "node", "index": 10_000}, {"kind": "segment", "index": 0},
            {"kind": "segment", "index": 0, "t": -0.1}, {"kind": "segment", "index": 0, "t": 1.1},
            {"kind": "other", "index": 0},
        ]
        for attachment in invalid_attachments:
            with self.subTest(invalid_attachment=attachment):
                marker = {"x": 1, "y": 2, "pathId": "curve-1", "attachment": attachment}
                with self.assertRaises(ValueError):
                    SERVER.validate(self.document(self.text(positionMarker=marker)))
        with self.assertRaises(ValueError):
            SERVER.validate(self.document(self.text(positionMarker={
                "x": 1, "y": 2, "attachment": {"kind": "node", "index": 0},
            })))

        for content in ("", "A-1", "A 1", "位置1", "A" * 33):
            with self.subTest(invalid_content=content):
                with self.assertRaises(ValueError):
                    SERVER.validate(self.document(self.text(content=content)))

        ordinary = self.text(content="普通文字与空格", rotation=0)
        ordinary.pop("positionMarker")
        SERVER.validate(self.document(ordinary))

    def test_position_tool_is_valid_in_recoverable_editor_state(self):
        SERVER.validate_editor_state({
            "selected": None,
            "ni": None,
            "selection": [],
            "imageSelection": [],
            "textSelection": [],
            "activeLayer": "position-markers",
            "nodeSelection": [],
            "drawing": False,
            "tool": "position",
        })

    def test_persisted_document_keeps_independent_marker_coordinates_and_extra_fields(self):
        document = self.document(self.text())
        with tempfile.TemporaryDirectory() as directory, patch.object(SERVER, "SAVES", Path(directory)):
            result = SERVER.persist(document)
            recovered = json.loads(Path(result["path"]).read_text(encoding="utf-8"))

        self.assertEqual(recovered["texts"][0]["positionMarker"], {"x": -10, "y": -20, "pathId": "curve-1", "source": "node-7"})

    def test_svg_draws_marker_and_leader_outside_rotated_text_transform(self):
        svg = SERVER.preview_svg(self.document(self.text()))

        self.assertIn('<line x1="-10" y1="-20" x2="78" y2="70" stroke="#123ABC" stroke-width="1.2"/>', svg)
        self.assertIn('<circle cx="-10" cy="-20" r="3.2" fill="#123ABC"/>', svg)
        self.assertIn('<text x="90" y="90" font-family="sans-serif" font-size="20" fill="#123ABC" xml:space="preserve" transform="rotate(90 90 70)">', svg)
        self.assertIn('<tspan x="90" y="90">A12</tspan>', svg)
        self.assertNotIn('<g transform="rotate(', svg)
        self.assertLess(svg.index("<line "), svg.index("<text "))
        self.assertLess(svg.index("<circle "), svg.index("<text "))

    def test_svg_bounds_include_marker_circle_and_rotated_text(self):
        document = self.document(self.text())

        self.assertEqual(SERVER.export_bounds(document), (-17.2, -27.2, 117.2, 173.2))
        self.assertIn('viewBox="-17.2 -27.2 117.2 173.2"', SERVER.preview_svg(document))

    def test_vector_svg_export_keeps_marker_geometry_and_bounds(self):
        document = self.document(self.text())
        document["calibration"] = {
            "a": {"x": 0, "y": 0},
            "b": {"x": 1, "y": 0},
            "length": 1,
            "unit": "mm",
        }

        result = vector_io.export_document(document, "svg", ["position-markers"])
        svg = result["data"].decode("utf-8")

        self.assertIn('viewBox="-13.2 -23.2 103.2 165.2"', svg)
        self.assertEqual(result["widthMm"], 103.2)
        self.assertEqual(result["heightMm"], 165.2)
        self.assertIn('<line x1="-10" y1="-20" x2="78" y2="70" stroke="#123ABC" stroke-width="1.2"/>', svg)
        self.assertIn('<circle cx="-10" cy="-20" r="3.2" fill="#123ABC"/>', svg)
        self.assertIn('transform="rotate(90 90 70)"', svg)


if __name__ == "__main__":
    unittest.main()
