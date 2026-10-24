"""Backend contracts for editable two-point dimension annotations."""
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
import vector_dimension
import vector_io

SPEC = importlib.util.spec_from_file_location("dimension_curve_editor_server", TOOLS / "server.py")
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)
SAMPLE = json.loads((TOOLS / "examples/心形_可编辑示例.json").read_text(encoding="utf-8"))


class DimensionServerTests(unittest.TestCase):
    def text(self, **changes):
        value = {
            "id": "dimension-1", "name": "尺寸 1", "content": "过期值",
            "x": 999, "y": 999, "fontSize": 10, "color": "#123ABC", "rotation": -99,
            "dimension": {
                "a": {"x": 0, "y": 0}, "b": {"x": 3, "y": 4},
                "offset": 10, "unit": "mm",
            },
        }
        value.update(changes)
        return value

    def document(self, text=None, calibration=True):
        document = copy.deepcopy(SAMPLE)
        document.update({
            "width": 100, "height": 80, "paths": [], "images": [],
            "texts": [] if text is None else [text],
            "layers": [{
                "id": "dimensions", "name": "尺寸标注", "visible": True, "locked": False,
                "pathIds": [], "imageIds": [], "textIds": [] if text is None else [text["id"]],
            }],
            "calibration": ({"a": {"x": 0, "y": 0}, "b": {"x": 10, "y": 0},
                             "length": 10, "unit": "mm"} if calibration else None),
        })
        return document

    def path(self, path_id="source", points=((0, 0), (3, 4)), **changes):
        nodes = [{"x": x, "y": y, "in": {"x": x, "y": y},
                  "out": {"x": x, "y": y}, "mode": "cusp"} for x, y in points]
        value = {"id": path_id, "name": "来源曲线", "color": "#000000",
                 "role": "outline", "closed": False, "nodes": nodes}
        value.update(changes)
        return value

    def bind(self, text=None, bindings=...):
        text = copy.deepcopy(text or self.text())
        if bindings is ...:
            bindings = {"a": {"pathId": "source", "index": 0},
                        "b": {"pathId": "source", "index": 1}}
        text["dimension"]["bindings"] = copy.deepcopy(bindings)
        return text

    def test_three_four_five_geometry_resolves_mm_cm_and_readable_label(self):
        source = self.text()
        before = copy.deepcopy(source)
        resolved = vector_dimension.resolve_dimension(source, self.document()["calibration"])
        self.assertEqual(source, before)
        self.assertEqual(resolved["content"], "5.00 mm")
        self.assertAlmostEqual(resolved["x"], -8.3)
        self.assertAlmostEqual(resolved["y"], -16.9)
        self.assertAlmostEqual(resolved["rotation"], math.degrees(math.atan2(4, 3)))

        centimetres = vector_dimension.resolve_dimension(
            {**source, "dimension": {**source["dimension"], "unit": "cm"}},
            self.document()["calibration"],
        )
        self.assertEqual(centimetres["content"], "0.50 cm")

        segments = vector_dimension.dimension_segments(resolved)
        self.assertEqual(len(segments), 7)
        self.assertEqual(segments[0][0], {"x": 0, "y": 0})
        self.assertAlmostEqual(segments[0][1]["x"], -10.4)
        self.assertAlmostEqual(segments[0][1]["y"], 7.8)
        self.assertEqual(segments[2], ({"x": -8.0, "y": 6.0}, {"x": -5.0, "y": 10.0}))

        vertical = self.text(dimension={
            "a": {"x": 0, "y": 10}, "b": {"x": 0, "y": 0}, "offset": 5, "unit": "mm",
        })
        self.assertAlmostEqual(vector_dimension.resolve_dimension(vertical, self.document()["calibration"])["rotation"], 90)

    def test_missing_calibration_is_saved_as_unresolved_but_geometry_remains(self):
        resolved = vector_dimension.resolve_dimension(self.text(), None)
        self.assertEqual(resolved["content"], "未标定")
        self.assertEqual(len(vector_dimension.dimension_segments(resolved)), 7)
        document = self.document(self.text(), calibration=False)
        SERVER.validate(document)
        with tempfile.TemporaryDirectory() as directory, patch.object(SERVER, "SAVES", Path(directory)):
            result = SERVER.persist(document)
            recovered = json.loads(Path(result["path"]).read_text(encoding="utf-8"))
        self.assertEqual(recovered["texts"][0]["content"], "未标定")
        with self.assertRaisesRegex(ValueError, "比例|标定"):
            vector_io.export_document(document, "svg")

    def test_validation_rejects_malformed_nonfinite_and_marker_conflicts(self):
        SERVER.validate(self.document(self.text()))
        invalid_dimensions = [
            None, [], {},
            {"a": {"x": 0, "y": 0}, "b": {"x": 1, "y": 0}, "offset": 0},
            {"a": {"x": 0, "y": 0}, "b": {"x": 1, "y": 0}, "offset": 0, "unit": "mm", "extra": 1},
            {"a": {"x": 0, "y": 0, "z": 0}, "b": {"x": 1, "y": 0}, "offset": 0, "unit": "mm"},
            {"a": {"x": math.nan, "y": 0}, "b": {"x": 1, "y": 0}, "offset": 0, "unit": "mm"},
            {"a": {"x": 0, "y": 0}, "b": {"x": 1, "y": math.inf}, "offset": 0, "unit": "mm"},
            {"a": {"x": 0, "y": 0}, "b": {"x": 1, "y": 0}, "offset": True, "unit": "mm"},
            {"a": {"x": 0, "y": 0}, "b": {"x": 1, "y": 0}, "offset": 10_000_001, "unit": "mm"},
            {"a": {"x": 0, "y": 0}, "b": {"x": 1, "y": 0}, "offset": 0, "unit": "in"},
        ]
        for dimension in invalid_dimensions:
            with self.subTest(dimension=dimension), self.assertRaises(ValueError):
                SERVER.validate(self.document(self.text(dimension=dimension)))
        with self.assertRaises(ValueError):
            SERVER.validate(self.document(self.text(positionMarker={"x": 0, "y": 0})))

    def test_binding_validation_is_strict_and_empty_bindings_mean_free(self):
        SERVER.validate(self.document(self.bind(bindings={})))
        SERVER.validate(self.document(self.bind(bindings={
            "a": {"pathId": "source", "index": 0},
        })))
        invalid = [
            None, [], {"c": {"pathId": "source", "index": 0}},
            {"a": None}, {"a": []},
            {"a": {"pathId": "", "index": 0}},
            {"a": {"pathId": " " * 201, "index": 0}},
            {"a": {"pathId": "source", "index": True}},
            {"a": {"pathId": "source", "index": -1}},
            {"a": {"pathId": "source", "index": 10000}},
            {"a": {"pathId": "source", "index": 0, "extra": 1}},
        ]
        for bindings in invalid:
            with self.subTest(bindings=bindings), self.assertRaises(ValueError):
                SERVER.validate(self.document(self.bind(bindings=bindings)))

    def test_bound_anchors_and_derived_fields_recompute_without_mutating_source(self):
        source = self.bind()
        paths = [self.path(points=((10, 20), (16, 28)))]
        before_text, before_paths = copy.deepcopy(source), copy.deepcopy(paths)
        resolved = vector_dimension.resolve_dimension(
            source, self.document()["calibration"], paths,
        )
        self.assertEqual(resolved["dimension"]["a"], {"x": 10, "y": 20})
        self.assertEqual(resolved["dimension"]["b"], {"x": 16, "y": 28})
        self.assertEqual(resolved["content"], "10.00 mm")
        self.assertNotEqual((resolved["x"], resolved["y"], resolved["rotation"]),
                            (999, 999, -99))
        self.assertEqual(source, before_text)
        self.assertEqual(paths, before_paths)

    def test_missing_binding_reference_keeps_each_cached_anchor(self):
        source = self.bind(bindings={
            "a": {"pathId": "source", "index": 0},
            "b": {"pathId": "missing", "index": 9999},
        })
        resolved = vector_dimension.resolve_dimension(
            source, self.document()["calibration"], [self.path(points=((9, 8),))],
        )
        self.assertEqual(resolved["dimension"]["a"], {"x": 9, "y": 8})
        self.assertEqual(resolved["dimension"]["b"], {"x": 3, "y": 4})

    def test_zero_and_tiny_distances_use_stable_geometry(self):
        for end in ((0, 0), (1e-7, 0)):
            with self.subTest(end=end):
                text = self.text(dimension={
                    "a": {"x": 0, "y": 0}, "b": {"x": end[0], "y": end[1]},
                    "offset": 5, "unit": "mm",
                })
                SERVER.validate(self.document(text))
                resolved = vector_dimension.resolve_dimension(text, self.document()["calibration"])
                self.assertEqual(len(vector_dimension.dimension_segments(resolved)), 7)
                self.assertTrue(all(math.isfinite(resolved[key]) for key in ("x", "y", "rotation")))
                if end == (0, 0):
                    self.assertEqual(resolved["content"], "0.00 mm")
                    self.assertEqual(resolved["rotation"], 0)

    def test_dimension_tool_asset_and_editor_state_are_supported(self):
        self.assertEqual(SERVER.ALLOWED["/dimension.js"], ("dimension.js", "text/javascript"))
        SERVER.validate_editor_state({
            "selected": None, "ni": None, "selection": [], "imageSelection": [],
            "textSelection": [], "activeLayer": "dimensions", "nodeSelection": [],
            "drawing": False, "tool": "dimension",
        })

    def test_scope_save_preview_and_svg_recompute_stale_label_without_mutation(self):
        document = self.document(self.text())
        before = copy.deepcopy(document)
        scoped = vector_io.scope_document(document, ["dimensions"])
        self.assertEqual(scoped["texts"][0]["content"], "5.00 mm")
        self.assertNotEqual(scoped["texts"][0]["x"], 999)
        self.assertEqual(document, before)

        svg = SERVER.preview_svg(document)
        self.assertEqual(svg.count("<line "), 7)
        self.assertIn("5.00 mm", svg)
        self.assertNotIn("过期值", svg)
        self.assertLess(SERVER.export_bounds(document)[1], -16)
        self.assertEqual(document, before)

        with tempfile.TemporaryDirectory() as directory, patch.object(SERVER, "SAVES", Path(directory)):
            result = SERVER.persist(copy.deepcopy(document))
            recovered = json.loads(Path(result["path"]).read_text(encoding="utf-8"))
            saved_svg = Path(result["path"]).with_suffix(".svg").read_text(encoding="utf-8")
        self.assertEqual(recovered["texts"][0]["content"], "5.00 mm")
        self.assertNotEqual(recovered["texts"][0]["x"], 999)
        self.assertEqual(saved_svg.count("<line "), 7)

    def test_scope_resolves_against_hidden_unselected_source_before_filtering(self):
        dimension = self.bind()
        document = self.document(dimension)
        document["paths"] = [self.path(points=((20, 30), (26, 38)), visible=False)]
        document["layers"].insert(0, {
            "id": "source-layer", "name": "隐藏来源", "visible": False, "locked": False,
            "pathIds": ["source"], "imageIds": [], "textIds": [],
        })
        before = copy.deepcopy(document)
        scoped = vector_io.scope_document(document, ["dimensions"])
        self.assertEqual(scoped["paths"], [])
        self.assertEqual(scoped["texts"][0]["dimension"]["a"], {"x": 20, "y": 30})
        self.assertEqual(scoped["texts"][0]["dimension"]["b"], {"x": 26, "y": 38})
        self.assertEqual(scoped["texts"][0]["content"], "10.00 mm")
        preview = SERVER.preview_svg(document)
        self.assertIn("10.00 mm", preview)
        with tempfile.TemporaryDirectory() as directory, patch.object(SERVER, "SAVES", Path(directory)):
            saved = SERVER.persist(document)
            recovered = json.loads(Path(saved["path"]).read_text(encoding="utf-8"))
        self.assertEqual(recovered["texts"][0]["dimension"]["a"], {"x": 20, "y": 30})
        self.assertEqual(recovered["texts"][0]["dimension"]["b"], {"x": 26, "y": 38})
        self.assertEqual(recovered["texts"][0]["content"], "10.00 mm")
        self.assertEqual(document, before)

    def test_svg_and_ai_dxf_include_seven_lines_and_outlined_label_without_mutation(self):
        import vector_ai
        import vector_dxf
        document = self.document(self.text())
        before = copy.deepcopy(document)

        svg = vector_io.export_document(document, "svg", ["dimensions"])["data"].decode()
        self.assertEqual(svg.count("<line "), 7)
        self.assertIn("5.00 mm", svg)
        for file_format, importer in (("ai", vector_ai.import_ai), ("dxf", vector_dxf.import_dxf)):
            result = vector_io.export_document(document, file_format, ["dimensions"], dxf_mode="spline")
            restored = importer(result["data"], "dimension." + file_format)["document"]
            self.assertGreater(len(restored["paths"]), 7)
            self.assertGreater(result["textOutlineCount"], 0)
            self.assertAlmostEqual(vector_io.millimeters_per_pixel(restored), 1)
            _, _, width, height = vector_io.content_bounds(restored)
            self.assertAlmostEqual(width, result["widthMm"], delta=0.011)
            self.assertAlmostEqual(height, result["heightMm"], delta=0.011)
        self.assertEqual(document, before)

    def test_exported_dimension_line_uses_calibrated_physical_length(self):
        import vector_ai
        import vector_dxf
        document = self.document(self.text())
        document["calibration"]["length"] = 20
        self.assertEqual(vector_dimension.resolve_dimension(document["texts"][0], document["calibration"])["content"], "10.00 mm")
        for kind, importer, mode in (("ai", vector_ai.import_ai, "spline"), ("dxf", vector_dxf.import_dxf, "spline"), ("dxf", vector_dxf.import_dxf, "polyline")):
            result = vector_io.export_document(document, kind, ["dimensions"], dxf_mode=mode)
            restored = importer(result["data"], "dimension." + kind)["document"]
            nodes = restored["paths"][2]["nodes"]
            self.assertEqual(len(nodes), 2)
            self.assertAlmostEqual(math.hypot(nodes[1]["x"]-nodes[0]["x"], nodes[1]["y"]-nodes[0]["y"]), 10, places=5)

    def test_ai_and_both_dxf_modes_use_moved_bound_nodes(self):
        import vector_ai
        import vector_dxf
        document = self.document(self.bind())
        document["paths"] = [self.path(points=((40, 50), (46, 58)), visible=False)]
        document["layers"].insert(0, {
            "id": "source-layer", "name": "来源", "visible": False, "locked": False,
            "pathIds": ["source"], "imageIds": [], "textIds": [],
        })
        before = copy.deepcopy(document)
        for kind, importer, mode in (
                ("ai", vector_ai.import_ai, "spline"),
                ("dxf", vector_dxf.import_dxf, "spline"),
                ("dxf", vector_dxf.import_dxf, "polyline")):
            with self.subTest(kind=kind, mode=mode):
                result = vector_io.export_document(document, kind, ["dimensions"], dxf_mode=mode)
                restored = importer(result["data"], "dimension." + kind)["document"]
                nodes = restored["paths"][2]["nodes"]
                self.assertAlmostEqual(
                    math.hypot(nodes[1]["x"] - nodes[0]["x"], nodes[1]["y"] - nodes[0]["y"]),
                    10, places=5,
                )
        self.assertEqual(document, before)

    def test_dimension_lines_retain_the_500_export_path_limit(self):
        document = self.document(self.text())
        paths = []
        for index in range(494):
            nodes = [{"x": index, "y": 0, "in": {"x": index, "y": 0},
                      "out": {"x": index, "y": 0}, "mode": "cusp"},
                     {"x": index, "y": 1, "in": {"x": index, "y": 1},
                      "out": {"x": index, "y": 1}, "mode": "cusp"}]
            paths.append({"id": f"p-{index}", "name": "线", "color": "#000000",
                          "role": "outline", "closed": False, "nodes": nodes})
        document["paths"] = paths
        document["layers"][0]["pathIds"] = [path["id"] for path in paths]
        with self.assertRaisesRegex(ValueError, "500"):
            vector_io.export_document(document, "ai", ["dimensions"])


if __name__ == "__main__":
    unittest.main()
