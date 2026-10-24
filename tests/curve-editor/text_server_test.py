"""Backend validation and SVG export tests for editable text elements."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools/curve-editor"
sys.path.insert(0, str(TOOLS))
SPEC = importlib.util.spec_from_file_location("curve_editor_server", TOOLS / "server.py")
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)
SAMPLE = json.loads((TOOLS / "examples/心形_可编辑示例.json").read_text(encoding="utf-8"))


class TextServerTests(unittest.TestCase):
    def test_text_asset_participates_in_the_editor_revision(self):
        self.assertEqual(SERVER.ALLOWED["/text.js"], ("text.js", "text/javascript"))
        baseline = SERVER.editor_revision()
        read_bytes = Path.read_bytes
        for name in ("text.js", "vector-files.js", "vector_ai.py", "vector_dxf.py", "vector_io.py", "vendor/python/pypdf/_reader.py"):
            with self.subTest(asset=name):
                target = TOOLS / name
                def changed_bytes(path):
                    data = read_bytes(path)
                    return data + b'\nrevision-test' if path == target else data
                with patch.object(Path, "read_bytes", changed_bytes):
                    with patch.object(SERVER, "STATIC_FILES", SERVER.static_files()):
                        self.assertNotEqual(SERVER.editor_revision(), baseline)

    def test_text_tool_and_selection_are_valid_portable_editor_state(self):
        state = {
            "selected": None, "ni": None, "selection": [], "imageSelection": [],
            "textSelection": ["text-1"], "activeLayer": "layer-1",
            "nodeSelection": [], "drawing": False, "tool": "text",
        }
        SERVER.validate_editor_state(state)
        state["textSelection"] = "text-1"
        with self.assertRaises(ValueError):
            SERVER.validate_editor_state(state)

    def document(self, text=None, *, visible=True):
        document = copy.deepcopy(SAMPLE)
        document.update({
            "width": 100,
            "height": 80,
            "paths": [],
            "images": [],
            "texts": [] if text is None else [text],
            "layers": [{
                "id": "layer-1",
                "name": "内容",
                "visible": visible,
                "locked": False,
                "pathIds": [],
                "imageIds": [],
                "textIds": [] if text is None else [text["id"]],
            }],
        })
        return document

    def text(self, **changes):
        value = {
            "id": "text-1",
            "name": "标题",
            "content": "第一行\nSecond line",
            "x": 12,
            "y": 18,
            "fontSize": 24,
            "color": "#123ABC",
        }
        value.update(changes)
        return value

    def assert_invalid(self, document):
        with self.assertRaises(ValueError):
            SERVER.validate(document)

    def test_legacy_documents_and_layers_without_text_fields_remain_valid(self):
        SERVER.validate(copy.deepcopy(SAMPLE))
        layered = self.document()
        del layered["texts"]
        del layered["layers"][0]["textIds"]
        SERVER.validate(layered)

    def test_valid_multiline_text_and_layer_membership_are_accepted(self):
        document = self.document(self.text())
        SERVER.validate(document)

    def test_text_schema_rejects_invalid_fields_and_limits(self):
        invalid_texts = [
            None,
            self.text(id=""),
            self.text(id="x" * 201),
            self.text(name=1),
            self.text(name="x" * 81),
            self.text(content=" \n\t"),
            self.text(content="x" * 10001),
            self.text(x=True),
            self.text(x=10_000_001),
            self.text(y=float("inf")),
            self.text(fontSize=0),
            self.text(fontSize=4097),
            self.text(fontSize=True),
            self.text(color="#123"),
            self.text(color="123456"),
            self.text(color=123456),
        ]
        for value in invalid_texts:
            with self.subTest(value=value):
                document = self.document()
                document["texts"] = [value]
                document["layers"][0]["textIds"] = [value.get("id", "text-1")] if isinstance(value, dict) else []
                self.assert_invalid(document)

        wrong_collection = self.document()
        wrong_collection["texts"] = {}
        self.assert_invalid(wrong_collection)
        too_many = self.document()
        too_many["texts"] = [self.text(id=f"text-{index}") for index in range(501)]
        too_many["layers"][0]["textIds"] = [text["id"] for text in too_many["texts"]]
        self.assert_invalid(too_many)

    def test_text_ids_are_unique_and_each_text_belongs_to_exactly_one_layer(self):
        duplicate = self.document(self.text())
        duplicate["texts"].append(self.text())
        duplicate["layers"][0]["textIds"].append("text-1")
        self.assert_invalid(duplicate)

        for references in ([], ["missing"], ["text-1", "text-1"]):
            with self.subTest(references=references):
                document = self.document(self.text())
                document["layers"][0]["textIds"] = references
                self.assert_invalid(document)

        no_layers = copy.deepcopy(SAMPLE)
        no_layers["texts"] = [self.text()]
        self.assert_invalid(no_layers)

        bad_layer_field = self.document()
        bad_layer_field["layers"][0]["textIds"] = "text-1"
        self.assert_invalid(bad_layer_field)

    def test_svg_exports_visible_multiline_text_after_curves_with_escaped_content(self):
        text = self.text(content="汉 A\n<&", x=-20, y=-10, fontSize=20, color="#aBcDeF")
        document = self.document(text)
        document["width"] = 10
        document["height"] = 10
        document["paths"] = [{
            "id": "path-1", "name": "线", "note": "", "closed": False,
            "color": "#000000", "nodes": [
                {"x": 1, "y": 1, "in": {"x": 1, "y": 1}, "out": {"x": 1, "y": 1}},
                {"x": 2, "y": 2, "in": {"x": 2, "y": 2}, "out": {"x": 2, "y": 2}},
            ],
        }]
        document["layers"][0]["pathIds"] = ["path-1"]
        SERVER.validate(document)
        svg = SERVER.preview_svg(document)

        self.assertIn('viewBox="-24 -14 80 56"', svg)
        self.assertIn('<text x="-20" y="10" font-family="sans-serif" font-size="20" fill="#aBcDeF" xml:space="preserve">', svg)
        self.assertIn('<tspan x="-20" y="10">汉 A</tspan>', svg)
        self.assertIn('<tspan x="-20" y="34">&lt;&amp;</tspan>', svg)
        self.assertLess(svg.index("<path "), svg.index("<text "))

        hidden_svg = SERVER.preview_svg(self.document(text, visible=False))
        self.assertNotIn("<text ", hidden_svg)
        self.assertNotIn("汉 A", hidden_svg)

    def test_svg_normalizes_common_newline_encodings(self):
        document = self.document(self.text(content="one\r\ntwo\rthree"))
        svg = SERVER.preview_svg(document)
        self.assertEqual(svg.count("<tspan "), 3)
        self.assertNotIn("\r", svg)

    def test_svg_uses_conservative_bounds_for_wide_text_outside_artboard(self):
        document = self.document(self.text(content="WWWW", x=90, y=10, fontSize=20))
        svg = SERVER.preview_svg(document)
        self.assertIn('viewBox="0 0 190 80"', svg)


if __name__ == "__main__":
    unittest.main()
