"""Backend schema and SVG behavior for nested layer groups and merged items."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools/curve-editor"
sys.path.insert(0, str(TOOLS))
SPEC = importlib.util.spec_from_file_location("curve_editor_group_server", TOOLS / "server.py")
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)
SAMPLE = json.loads((TOOLS / "examples/心形_可编辑示例.json").read_text(encoding="utf-8"))


def node(x, y):
    return {"x": x, "y": y, "in": {"x": x, "y": y}, "out": {"x": x, "y": y}}


class LayerGroupServerTests(unittest.TestCase):
    def path(self, path_id, color, x=1):
        return {"id": path_id, "name": path_id, "note": "", "closed": False,
                "color": color, "nodes": [node(x, 1), node(x + 1, 2)]}

    def image(self, image_id, payload, x=1):
        return {"id": image_id, "name": image_id,
                "dataUrl": f"data:image/png;base64,{payload}", "x": x, "y": 1,
                "width": 2, "height": 2, "opacity": 1}

    def text(self, text_id, content, x=1):
        return {"id": text_id, "name": text_id, "content": content, "x": x,
                "y": 1, "fontSize": 10, "color": "#123456"}

    def document(self):
        document = copy.deepcopy(SAMPLE)
        document.update({"width": 20, "height": 20, "paths": [], "images": [],
                         "texts": [], "layers": []})
        return document

    def group(self, layer_id, **changes):
        layer = {"id": layer_id, "name": layer_id, "kind": "group", "visible": True,
                 "locked": False, "collapsed": False, "pathIds": [], "imageIds": [],
                 "textIds": []}
        layer.update(changes)
        return layer

    def layer(self, layer_id, **changes):
        layer = {"id": layer_id, "name": layer_id, "visible": True, "locked": False,
                 "pathIds": [], "imageIds": [], "textIds": []}
        layer.update(changes)
        return layer

    def assert_invalid(self, document):
        with self.assertRaises(ValueError):
            SERVER.validate(document)

    def test_nested_groups_and_explicit_merged_items_are_valid(self):
        document = self.document()
        document["paths"] = [self.path("p", "#010203")]
        document["images"] = [self.image("i", "aW1hZ2U=")]
        document["texts"] = [self.text("t", "text")]
        document["layers"] = [
            self.group("outer", collapsed=True, parentId=None, items=[]),
            self.group("inner", parentId="outer"),
            self.layer("merged", kind="layer", parentId="inner", pathIds=["p"],
                       imageIds=["i"], textIds=["t"], items=[
                           {"type": "text", "id": "t", "visible": True, "locked": True},
                           {"type": "image", "id": "i", "visible": False, "locked": False},
                           {"type": "path", "id": "p"},
                       ]),
        ]
        SERVER.validate(document)

    def test_editor_state_accepts_layer_selection_and_rejects_non_string_values(self):
        state = {"selected": None, "ni": None, "selection": [], "imageSelection": [],
                 "textSelection": [], "layerSelection": ["group", "child"],
                 "activeLayer": "child", "nodeSelection": [], "drawing": False,
                 "tool": "select"}
        SERVER.validate_editor_state(state)
        state["layerSelection"] = ["group", 1]
        with self.assertRaises(ValueError):
            SERVER.validate_editor_state(state)

    def test_group_relationships_and_group_payload_are_strictly_validated(self):
        base = self.document()
        invalid_layers = [
            [self.group("g", kind="folder")],
            [self.group("g", collapsed=1)],
            [self.group("g", parentId=1)],
            [self.group("g", parentId="missing")],
            [self.group("g", parentId="g")],
            [self.group("a", parentId="b"), self.group("b", parentId="a")],
            [self.layer("plain"), self.group("g", parentId="plain")],
            [self.group("g", pathIds=["p"])],
            [self.group("g", items=None)],
            [self.group("g", items=[{"type": "path", "id": "p"}])],
        ]
        for layers in invalid_layers:
            with self.subTest(layers=layers):
                document = copy.deepcopy(base)
                if any("p" in layer.get("pathIds", []) for layer in layers):
                    document["paths"] = [self.path("p", "#010203")]
                document["layers"] = layers
                self.assert_invalid(document)

    def test_explicit_items_must_exactly_and_uniquely_cover_normal_layer_arrays(self):
        base = self.document()
        base["paths"] = [self.path("p", "#010203")]
        base["layers"] = [self.layer("l", pathIds=["p"])]
        invalid_items = [
            None, "p", [None], [{}], [{"type": "shape", "id": "p"}],
            [{"type": "path", "id": 1}],
            [{"type": "path", "id": "missing"}],
            [{"type": "path", "id": "p", "visible": 1}],
            [{"type": "path", "id": "p", "locked": 0}],
            [{"type": "path", "id": "p"}, {"type": "path", "id": "p"}],
            [],
        ]
        for items in invalid_items:
            with self.subTest(items=items):
                document = copy.deepcopy(base)
                document["layers"][0]["items"] = items
                self.assert_invalid(document)

    def test_recursive_paint_order_and_visibility_control_svg_and_bounds(self):
        document = self.document()
        document["width"] = 100
        document["paths"] = [
            self.path("root-path", "#110001"), self.path("nested-path", "#220002"),
            self.path("item-hidden", "#330003", -500), self.path("group-hidden", "#440004", 500),
        ]
        document["images"] = [self.image("nested-image", "bmVzdGVk")]
        document["texts"] = [self.text("nested-text", "NESTED")]
        document["layers"] = [
            self.layer("root", pathIds=["root-path"]),
            self.group("group"),
            self.layer("nested", parentId="group", pathIds=["nested-path", "item-hidden"],
                       imageIds=["nested-image"], textIds=["nested-text"], items=[
                           {"type": "path", "id": "nested-path"},
                           {"type": "text", "id": "nested-text"},
                           {"type": "image", "id": "nested-image"},
                           {"type": "path", "id": "item-hidden", "visible": False},
                       ]),
            self.group("hidden-group", visible=False),
            self.layer("hidden-child", parentId="hidden-group", pathIds=["group-hidden"]),
        ]
        SERVER.validate(document)
        svg = SERVER.preview_svg(document)
        fragments = ["#110001", "#220002", "NESTED", "bmVzdGVk"]
        self.assertEqual([svg.index(value) for value in fragments],
                         sorted(svg.index(value) for value in fragments))
        self.assertNotIn("#330003", svg)
        self.assertNotIn("#440004", svg)
        self.assertEqual(SERVER.export_bounds(document), (0, 0, 100, 20))

    def test_legacy_layer_item_order_remains_images_then_paths_then_texts(self):
        document = self.document()
        document["paths"] = [self.path("p", "#abcdef")]
        document["images"] = [self.image("i", "bGVnYWN5")]
        document["texts"] = [self.text("t", "LEGACY")]
        document["layers"] = [self.layer("l", pathIds=["p"], imageIds=["i"], textIds=["t"])]
        SERVER.validate(document)
        svg = SERVER.preview_svg(document)
        positions = [svg.index(value) for value in ("bGVnYWN5", "#abcdef", "LEGACY")]
        self.assertEqual(positions, sorted(positions))


if __name__ == "__main__":
    unittest.main()
