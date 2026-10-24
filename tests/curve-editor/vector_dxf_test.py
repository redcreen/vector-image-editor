import importlib.util
import copy
import math
import os
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "tools" / "curve-editor" / "vector_dxf.py"
SPEC = importlib.util.spec_from_file_location("vector_dxf", MODULE_PATH)
vector_dxf = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = vector_dxf
SPEC.loader.exec_module(vector_dxf)


def dxf(*body, units=4, layers=()):
    pairs = [
        (0, "SECTION"), (2, "HEADER"), (9, "$ACADVER"), (1, "AC1015"),
    ]
    if units is not None:
        pairs += [(9, "$INSUNITS"), (70, str(units))]
    pairs += [(0, "ENDSEC"), (0, "SECTION"), (2, "TABLES")]
    if layers:
        pairs += [(0, "TABLE"), (2, "LAYER"), (70, str(len(layers)))]
        for name, color, flags in layers:
            pairs += [(0, "LAYER"), (2, name), (70, str(flags)), (62, str(color)), (6, "CONTINUOUS")]
        pairs += [(0, "ENDTAB")]
    pairs += [(0, "ENDSEC"), (0, "SECTION"), (2, "ENTITIES")]
    pairs += list(body)
    pairs += [(0, "ENDSEC"), (0, "EOF")]
    return ("\n".join(str(value) for pair in pairs for value in pair) + "\n").encode("ascii")


def line(x1, y1, x2, y2, layer="0"):
    return [(0, "LINE"), (8, layer), (10, x1), (20, y1), (11, x2), (21, y2)]


class ImportDxfTests(unittest.TestCase):
    @unittest.skipUnless((ROOT / "tests/curve-editor/fixtures/vector-dxf/basic-mm.dxf").is_file(), "local DXF fixture not supplied")
    def test_fixture_imports_mm_line_and_decodes_unicode_layer(self):
        data = (ROOT / "tests" / "curve-editor" / "fixtures" / "vector-dxf" / "basic-mm.dxf").read_bytes()
        result = vector_dxf.import_dxf(data, "basic-mm.dxf")
        doc = result["document"]
        self.assertEqual(result["sourceUnit"], "mm")
        self.assertEqual(doc["format"], "daban-curve-editor")
        self.assertEqual(doc["units"], "image-px")
        self.assertEqual(doc["calibration"], {"a": {"x": 0, "y": 0}, "b": {"x": 1, "y": 0}, "length": 1, "unit": "mm"})
        self.assertEqual(doc["layers"][0]["name"], "Cut线")
        self.assertEqual(doc["layers"][0]["pathIds"], [doc["paths"][0]["id"]])
        nodes = doc["paths"][0]["nodes"]
        self.assertEqual([(n["x"], n["y"]) for n in nodes], [(0.0, -0.0), (25.0, -10.0)])

    def test_missing_units_requires_override_and_declared_inches_win(self):
        raw = dxf(*line(0, 0, 2, 1), units=None)
        with self.assertRaises(vector_dxf.MissingUnitsError):
            vector_dxf.import_dxf(raw, "unitless.dxf")
        imported = vector_dxf.import_dxf(raw, "unitless.dxf", "cm")
        self.assertEqual(imported["sourceUnit"], "cm")
        self.assertEqual(imported["document"]["paths"][0]["nodes"][1]["x"], 20.0)
        inch = vector_dxf.import_dxf(dxf(*line(0, 0, 2, 0), units=1), "inch.dxf", "mm")
        self.assertEqual(inch["sourceUnit"], "in")
        self.assertAlmostEqual(inch["document"]["paths"][0]["nodes"][1]["x"], 50.8)
        with self.assertRaises(ValueError):
            vector_dxf.import_dxf(raw, "bad.dxf", "yard")
        no_header = dxf(*line(0, 0, 1, 0), units=4).decode()
        no_header = no_header[no_header.index("0\nSECTION\n2\nTABLES"):].encode()
        with self.assertRaises(vector_dxf.MissingUnitsError):
            vector_dxf.import_dxf(no_header, "no-header.dxf")

    def test_other_declared_dxf_units_and_insert_transform_preserve_size(self):
        block_pairs = [
            (0, "SECTION"), (2, "HEADER"), (9, "$INSUNITS"), (70, 7), (0, "ENDSEC"),
            (0, "SECTION"), (2, "BLOCKS"), (0, "BLOCK"), (2, "part"), (10, 1), (20, 1),
            (0, "LINE"), (8, "0"), (10, 1), (20, 1), (11, 2), (21, 1),
            (0, "ENDBLK"), (0, "ENDSEC"), (0, "SECTION"), (2, "ENTITIES"),
            (0, "INSERT"), (8, "placed"), (2, "part"), (10, 3), (20, 4), (41, 2), (42, 2), (50, 90),
            (0, "ENDSEC"), (0, "EOF"),
        ]
        raw = ("\n".join(str(v) for p in block_pairs for v in p) + "\n").encode()
        result = vector_dxf.import_dxf(raw, "insert-km.dxf")
        self.assertEqual(result["sourceUnit"], "km")
        nodes = result["document"]["paths"][0]["nodes"]
        self.assertAlmostEqual(math.hypot(nodes[1]["x"] - nodes[0]["x"], nodes[1]["y"] - nodes[0]["y"]), 2_000_000)
        self.assertEqual(result["document"]["layers"][0]["name"], "placed")

    def test_lwpolyline_bulge_becomes_editable_cubic_and_keeps_closed_flag(self):
        body = [
            (0, "LWPOLYLINE"), (8, "curves"), (90, 2), (70, 1),
            (10, 0), (20, 0), (42, 1), (10, 10), (20, 0),
        ]
        doc = vector_dxf.import_dxf(dxf(*body, layers=(("curves", 5, 0),)), "bulge.dxf")["document"]
        path = doc["paths"][0]
        self.assertTrue(path["closed"])
        self.assertGreaterEqual(len(path["nodes"]), 2)
        self.assertNotEqual(path["nodes"][0]["out"], {"x": 0.0, "y": -0.0})
        self.assertNotEqual(path["nodes"][1]["in"], {"x": 10.0, "y": -0.0})

    def test_arc_circle_ellipse_and_polyline_are_supported(self):
        body = [
            (0, "ARC"), (8, "g"), (10, 0), (20, 0), (40, 10), (50, 0), (51, 90),
            (0, "CIRCLE"), (8, "g"), (10, 30), (20, 0), (40, 5),
            (0, "ELLIPSE"), (8, "g"), (10, 50), (20, 0), (11, 10), (21, 0), (40, .5), (41, 0), (42, 2 * math.pi),
            (0, "POLYLINE"), (8, "g"), (70, 1),
            (0, "VERTEX"), (8, "g"), (10, 0), (20, 20),
            (0, "VERTEX"), (8, "g"), (10, 10), (20, 20),
            (0, "VERTEX"), (8, "g"), (10, 10), (20, 30),
            (0, "SEQEND"),
        ]
        paths = vector_dxf.import_dxf(dxf(*body), "shapes.dxf")["document"]["paths"]
        self.assertEqual(len(paths), 4)
        self.assertFalse(paths[0]["closed"])
        self.assertTrue(paths[1]["closed"])
        self.assertTrue(paths[2]["closed"])
        self.assertTrue(paths[3]["closed"])
        self.assertTrue(any(n["mode"] == "smooth" for n in paths[0]["nodes"]))

    def test_arc_with_more_than_one_turn_is_rejected_before_segment_allocation(self):
        body = [
            (0, "ARC"), (8, "g"), (10, 0), (20, 0), (40, 10),
            (50, 0), (51, 1e308),
        ]
        with self.assertRaisesRegex(ValueError, "sweep"):
            vector_dxf.import_dxf(dxf(*body), "hostile-arc.dxf")

    def test_cubic_and_linear_splines_import(self):
        cubic = [
            (0, "SPLINE"), (8, "s"), (70, 8), (71, 3), (72, 8), (73, 4),
            (40, 0), (40, 0), (40, 0), (40, 0), (40, 1), (40, 1), (40, 1), (40, 1),
            (10, 0), (20, 0), (10, 3), (20, 4), (10, 7), (20, 4), (10, 10), (20, 0),
        ]
        linear = [
            (0, "SPLINE"), (8, "s"), (70, 8), (71, 1), (72, 5), (73, 3),
            (40, 0), (40, 0), (40, .5), (40, 1), (40, 1),
            (10, 0), (20, 10), (10, 5), (20, 12), (10, 10), (20, 10),
        ]
        paths = vector_dxf.import_dxf(dxf(*(cubic + linear)), "splines.dxf")["document"]["paths"]
        self.assertEqual(len(paths), 2)
        self.assertAlmostEqual(paths[0]["nodes"][0]["out"]["x"], 3.0)
        self.assertEqual([n["x"] for n in paths[1]["nodes"]], [0.0, 5.0, 10.0])

    def test_cubic_spline_with_repeated_endpoints_keeps_exact_bezier_geometry(self):
        # Some CAD exporters store independent Bezier spans (knot multiplicity
        # four) and repeat their joining endpoint instead of sharing it.
        points = [(0, 0), (1, 3), (2, 4), (3, 2),
                  (3, 2), (4, -1), (6, -2), (7, 0),
                  (8, 2), (10, 3), (11, 1)]
        knots = [0] * 4 + [0.2] * 4 + [0.75] * 3 + [1] * 4
        record = [(0, "SPLINE"), (8, "outline"), (70, 8), (71, 3),
                  (72, len(knots)), (73, len(points))]
        record += [(40, k) for k in knots]
        record += [pair for x, y in points for pair in ((10, x), (20, y))]
        doc = vector_dxf.import_dxf(dxf(*record, units=5), "repeated.dxf")["document"]
        path = doc["paths"][0]
        self.assertEqual(len(path["nodes"]), 4)
        self.assertFalse(path["closed"])
        self.assertEqual(doc["layers"][0]["name"], "outline")
        for index, start in enumerate((0, 4, 7)):
            a, b = path["nodes"][index:index + 2]
            actual = [(a["x"], a["y"]), (a["out"]["x"], a["out"]["y"]),
                      (b["in"]["x"], b["in"]["y"]), (b["x"], b["y"])]
            self.assertEqual(actual, [(x * 10, -y * 10) for x, y in points[start:start + 4]])
        # A real jump must never acquire an invented joining line, even when
        # smaller than the general path assembly tolerance.
        broken = record.copy()
        coord_indices = [i for i, (c, _) in enumerate(broken) if c == 10]
        broken[coord_indices[4]] = (10, 3 + 1e-9)
        with self.assertRaisesRegex(ValueError, "disconnected"):
            vector_dxf.import_dxf(dxf(*broken), "jump.dxf")

    def test_quadruple_knot_closed_spline_preserves_closure_and_affine_transform(self):
        points = [(0, 0), (1, 0), (2, 1), (2, 2),
                  (2, 2), (1, 3), (-1, 2), (-2, 1),
                  (-2, 1), (-1, 0), (-1, -1), (0, 0)]
        knots = [0] * 4 + [2] * 4 + [5] * 4 + [6] * 4
        record = [(70, 9), (71, 3), (72, len(knots)), (73, len(points))]
        record += [(40, k) for k in knots]
        record += [pair for x, y in points for pair in ((10, x), (20, y))]
        matrix = (0, 2, -3, 0, 7, -11)
        segments, closed = vector_dxf._spline_segments(record, matrix)
        self.assertTrue(closed)
        self.assertEqual(segments, [tuple((7 - 3*y, -11 + 2*x) for x, y in points[i:i+4])
                                    for i in (0, 4, 8)])
        path = vector_dxf.import_dxf(dxf((0, "SPLINE"), *record), "closed.dxf")["document"]["paths"][0]
        self.assertTrue(path["closed"])
        self.assertEqual(len(path["nodes"]), 3)

    @unittest.skipUnless(os.environ.get("CURVE_EDITOR_DXF_REGRESSION_FILE"), "external DXF fixture not supplied")
    def test_sheep_dxf_regression_preserves_all_entities_and_spline_controls(self):
        source = Path(os.environ["CURVE_EDITOR_DXF_REGRESSION_FILE"])
        raw = source.read_bytes()
        with self.assertRaises(vector_dxf.MissingUnitsError):
            vector_dxf.import_dxf(raw, source.name)
        # mm is a test-only choice; no original file or production canvas is changed.
        doc = vector_dxf.import_dxf(raw, source.name, "mm")["document"]
        records = vector_dxf._records(vector_dxf._sections(vector_dxf._pairs(raw))["ENTITIES"])
        self.assertEqual(len(records), 113)
        self.assertEqual(len(doc["paths"]), len(records))
        count = 0
        for (kind, record), path in zip(records, doc["paths"]):
            if kind != "SPLINE":
                continue
            count += 1
            points = list(zip(map(float, vector_dxf._all(record, 10)),
                              map(float, vector_dxf._all(record, 20))))
            knots = list(map(float, vector_dxf._all(record, 40)))
            spans = [i for i in range(3, len(points)) if knots[i] < knots[i+1]]
            self.assertEqual(len(path["nodes"]), len(spans) + 1)
            for j, k in enumerate(spans):
                a, b = path["nodes"][j:j+2]
                actual = [(a["x"], -a["y"]), (a["out"]["x"], -a["out"]["y"]),
                          (b["in"]["x"], -b["in"]["y"]), (b["x"], -b["y"])]
                self.assertEqual(actual, points[k-3:k+1])
        self.assertEqual(count, 63)
        self.assertEqual({layer["name"] for layer in doc["layers"]}, {"layer0"})

    def test_cubic_spline_rejects_excessive_knot_multiplicity(self):
        for knots in ([0]*5 + [1]*4, [0]*4 + [.5]*5 + [1]*4, [0]*4 + [1]*5,
                      [0]*4 + [.5] + [1]*4, [0]*4 + [.5]*2 + [1]*4):
            points = [(0, 0)] * (len(knots) - 4)
            record = [(0, "SPLINE"), (70, 8), (71, 3)]
            record += [(40, k) for k in knots]
            record += [pair for x, y in points for pair in ((10, x), (20, y))]
            with self.subTest(knots=knots), self.assertRaises(ValueError):
                vector_dxf.import_dxf(dxf(*record), "bad-knots.dxf")

    def test_nonclamped_and_periodic_splines_are_rejected_instead_of_misdrawn(self):
        controls = [(10, 0), (20, 0), (10, 3), (20, 4), (10, 7), (20, 4), (10, 10), (20, 0)]
        uniform = [(0, "SPLINE"), (70, 8), (71, 3), (72, 8), (73, 4)]
        uniform += [(40, value) for value in range(8)] + controls
        with self.assertRaisesRegex(ValueError, "clamped"):
            vector_dxf.import_dxf(dxf(*uniform), "uniform-spline.dxf")
        periodic = [(0, "SPLINE"), (70, 10), (71, 3), (72, 8), (73, 4)]
        periodic += [(40, value) for value in (0, 0, 0, 0, 1, 1, 1, 1)] + controls
        with self.assertRaisesRegex(ValueError, "periodic"):
            vector_dxf.import_dxf(dxf(*periodic), "periodic-spline.dxf")
        discontinuous_linear = [
            (0, "SPLINE"), (70, 8), (71, 1), (72, 6), (73, 4),
            (40, 0), (40, 0), (40, 1), (40, 1), (40, 2), (40, 2),
            (10, 0), (20, 0), (10, 10), (20, 0),
            (10, 20), (20, 10), (10, 30), (20, 10),
        ]
        with self.assertRaisesRegex(ValueError, "strictly increasing"):
            vector_dxf.import_dxf(dxf(*discontinuous_linear), "discontinuous-linear-spline.dxf")

    def test_unsupported_or_malformed_content_fails_instead_of_dropping_geometry(self):
        with self.assertRaisesRegex(ValueError, "unsupported DXF entity TEXT"):
            vector_dxf.import_dxf(dxf((0, "TEXT"), (10, 1), (20, 2), (1, "lost")), "text.dxf")
        with self.assertRaisesRegex(ValueError, "2D"):
            vector_dxf.import_dxf(dxf(*line(0, 0, 1, 1), (31, 2)), "3d.dxf")
        with self.assertRaises(ValueError):
            vector_dxf.import_dxf(b"0\nSECTION\n2\nHEADER\n9\n", "truncated.dxf")
        two_vertex_loop = [(0, "LWPOLYLINE"), (90, 2), (70, 1),
                           (10, 0), (20, 0), (10, 1), (20, 0)]
        with self.assertRaisesRegex(ValueError, "three nodes"):
            vector_dxf.import_dxf(dxf(*two_vertex_loop), "degenerate-loop.dxf")
        for fit_flag in (2, 4):
            fitted_polyline = [(0, "POLYLINE"), (70, fit_flag),
                               (0, "VERTEX"), (10, 0), (20, 0),
                               (0, "VERTEX"), (10, 10), (20, 10), (0, "SEQEND")]
            with self.subTest(fit_flag=fit_flag), self.assertRaisesRegex(ValueError, "fit"):
                vector_dxf.import_dxf(dxf(*fitted_polyline), "fitted-polyline.dxf")

    def test_entity_invisibility_is_preserved_on_import(self):
        visible = line(0, 0, 10, 0)
        hidden = [(0, "LINE"), (8, "0"), (60, 1), (10, 0), (20, 10), (11, 10), (21, 10)]
        paths = vector_dxf.import_dxf(dxf(*(visible + hidden)), "visibility.dxf")["document"]["paths"]
        self.assertEqual([path["visible"] for path in paths], [True, False])


class ExportDxfTests(unittest.TestCase):
    def document(self, paths, layers=None, calibration=None):
        if layers is None:
            layers = [{"id": "layer", "name": "切割层", "visible": True, "locked": False,
                       "pathIds": [p["id"] for p in paths], "imageIds": [], "textIds": []}]
        return {
            "format": "daban-curve-editor", "version": 1, "title": "export",
            "width": 100, "height": 100, "units": "image-px", "image": None,
            "paths": paths, "layers": layers, "images": [], "texts": [],
            "calibration": calibration or {"a": {"x": 0, "y": 0}, "b": {"x": 2, "y": 0}, "length": 1, "unit": "cm"},
        }

    def test_export_has_mm_header_layers_exact_lines_and_no_duplicate_close_vertex(self):
        node = lambda x, y: {"x": x, "y": y, "in": {"x": x, "y": y}, "out": {"x": x, "y": y}, "mode": "cusp"}
        path = {"id": "p", "name": "box", "color": "#e04544", "role": "cut", "closed": True,
                "nodes": [node(0, 0), node(2, 0), node(2, 2), node(0, 2), node(0, 0)]}
        raw = vector_dxf.export_dxf(self.document([path]))
        text = raw.decode("ascii")
        self.assertIn("$INSUNITS\n70\n4", text)
        self.assertIn("$MEASUREMENT\n70\n1", text)
        self.assertIn("\\U+5207\\U+5272\\U+5C42", text)
        result = vector_dxf.import_dxf(raw, "roundtrip.dxf")
        out = result["document"]["paths"][0]
        self.assertTrue(out["closed"])
        self.assertEqual(len(out["nodes"]), 4)
        self.assertEqual([(n["x"], n["y"]) for n in out["nodes"]], [(0, 0), (10, 0), (10, 10), (0, 10)])

    def test_r2000_layer_table_has_valid_unique_handles_and_owners(self):
        node = lambda x: {"x": x, "y": 0, "in": {"x": x, "y": 0},
                          "out": {"x": x, "y": 0}, "mode": "cusp"}
        paths = [{"id": value, "name": value, "closed": False, "nodes": [node(0), node(1)]}
                 for value in ("a", "b")]
        layers = [{"id": value, "name": value, "visible": True, "locked": False,
                   "pathIds": [value], "imageIds": [], "textIds": []} for value in ("a", "b")]
        pairs = vector_dxf._pairs(vector_dxf.export_dxf(self.document(paths, layers)))
        table_index = pairs.index((0, "TABLE"))
        self.assertEqual(pairs[table_index + 1:table_index + 5],
                         [(2, "LAYER"), (5, "1"), (330, "0"), (100, "AcDbSymbolTable")])
        layer_records = [(kind, record) for kind, record in vector_dxf._records(pairs) if kind == "LAYER"]
        handles = [vector_dxf._one(record, 5) for _, record in layer_records]
        self.assertEqual(len(set(handles)), 2)
        self.assertNotIn(None, handles)
        self.assertTrue(all(vector_dxf._one(record, 330) == "1" for _, record in layer_records))

    def test_curves_are_flattened_with_bounded_deviation_and_round_trip_dimensions(self):
        nodes = [
            {"x": 0, "y": 0, "in": {"x": 0, "y": 0}, "out": {"x": 0, "y": 10}, "mode": "smooth"},
            {"x": 10, "y": 0, "in": {"x": 10, "y": 10}, "out": {"x": 10, "y": 0}, "mode": "smooth"},
        ]
        raw = vector_dxf.export_dxf(self.document([{"id": "curve", "name": "curve", "closed": False, "color": "#176bce", "nodes": nodes}]))
        doc = vector_dxf.import_dxf(raw, "curve.dxf")["document"]
        points = doc["paths"][0]["nodes"]
        self.assertGreater(len(points), 8)
        self.assertAlmostEqual(points[0]["x"], 0)
        self.assertAlmostEqual(points[-1]["x"], 50)
        self.assertAlmostEqual(max(n["y"] for n in points), 37.5, delta=.02)

    def test_repeated_closing_anchor_preserves_incoming_curve_without_mutating_document(self):
        def node(x, y, in_x=None, in_y=None, out_x=None, out_y=None):
            return {"x": x, "y": y,
                    "in": {"x": x if in_x is None else in_x, "y": y if in_y is None else in_y},
                    "out": {"x": x if out_x is None else out_x, "y": y if out_y is None else out_y},
                    "mode": "cusp"}
        path = {"id": "p", "name": "p", "closed": True, "nodes": [
            node(0, 0), node(20, 0), node(20, 20, out_x=10, out_y=30),
            node(0, 0, in_x=-10, in_y=20),
        ]}
        doc = self.document([path])
        before = repr(doc)
        imported = vector_dxf.import_dxf(vector_dxf.export_dxf(doc), "closing-curve.dxf")["document"]
        self.assertEqual(repr(doc), before)
        points = imported["paths"][0]["nodes"]
        self.assertTrue(imported["paths"][0]["closed"])
        self.assertTrue(any(n["x"] < -1 for n in points), "last.in curve was flattened away")

    def test_repeated_anchor_with_nonzero_closing_loop_is_not_discarded(self):
        def node(x, y, ix=None, iy=None, ox=None, oy=None):
            return {"x": x, "y": y, "in": {"x": x if ix is None else ix, "y": y if iy is None else iy},
                    "out": {"x": x if ox is None else ox, "y": y if oy is None else oy}, "mode": "cusp"}
        path = {"id": "loop", "name": "loop", "closed": True, "nodes": [
            node(0, 0, ix=-10, iy=-20), node(20, 0), node(20, 20),
            node(0, 0, ox=10, oy=-20),
        ]}
        imported = vector_dxf.import_dxf(vector_dxf.export_dxf(self.document([path])), "loop.dxf")["document"]
        points = imported["paths"][0]["nodes"]
        self.assertTrue(any(n["y"] < -1 for n in points), "same-anchor closing loop was discarded")

    def test_collinear_cubic_overshoot_is_not_collapsed_to_its_endpoint_chord(self):
        output = [(0.0, 0.0)]
        vector_dxf._flatten(((0.0, 0.0), (100.0, 0.0), (-100.0, 0.0), (1.0, 0.0)), .01, output)
        xs = [point[0] for point in output]
        self.assertGreater(len(xs), 4)
        self.assertGreater(max(xs), 25)
        self.assertLess(min(xs), -20)

    def test_flatten_enforces_node_limit_while_recursing(self):
        output = [(0.0, 0.0)] * vector_dxf.MAX_NODES
        with self.assertRaisesRegex(ValueError, "node limit"):
            vector_dxf._flatten(((0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (1.0, 0.0)), .01, output)

    def test_export_rejects_invalid_calibration_layers_and_non_curve_content(self):
        simple = {"id": "p", "name": "p", "closed": False, "nodes": [
            {"x": 0, "y": 0, "in": {"x": 0, "y": 0}, "out": {"x": 0, "y": 0}, "mode": "cusp"},
            {"x": 1, "y": 1, "in": {"x": 1, "y": 1}, "out": {"x": 1, "y": 1}, "mode": "cusp"}]}
        doc = self.document([simple])
        doc["calibration"] = None
        with self.assertRaisesRegex(ValueError, "calibration"):
            vector_dxf.export_dxf(doc)
        doc = self.document([simple])
        doc["layers"][0]["pathIds"] = []
        with self.assertRaisesRegex(ValueError, "layer"):
            vector_dxf.export_dxf(doc)
        doc = self.document([simple])
        doc["images"] = [{"id": "i"}]
        with self.assertRaisesRegex(ValueError, "curve-only"):
            vector_dxf.export_dxf(doc)

    def test_non_bmp_unicode_layer_name_round_trips_through_dxf_escapes(self):
        node = lambda x: {"x": x, "y": 0, "in": {"x": x, "y": 0}, "out": {"x": x, "y": 0}, "mode": "cusp"}
        path = {"id": "p", "name": "p", "closed": False, "nodes": [node(0), node(1)]}
        doc = self.document([path])
        doc["layers"][0]["name"] = "激光😀"
        imported = vector_dxf.import_dxf(vector_dxf.export_dxf(doc), "emoji.dxf")["document"]
        self.assertEqual(imported["layers"][0]["name"], "激光😀")

    def test_numbered_chinese_layer_names_do_not_extend_unicode_escape_digits(self):
        for name in ("图层1", "图层12", "A图9F", "图层😀12"):
            with self.subTest(name=name):
                escaped = vector_dxf._escape(name)
                self.assertEqual(vector_dxf._unescape(escaped), name)

    def test_duplicate_display_layer_names_remain_distinct_after_round_trip(self):
        node = lambda x, y: {"x": x, "y": y, "in": {"x": x, "y": y},
                             "out": {"x": x, "y": y}, "mode": "cusp"}
        paths = [
            {"id": "a", "name": "a", "closed": False, "nodes": [node(0, 0), node(10, 0)]},
            {"id": "b", "name": "b", "closed": False, "nodes": [node(0, 10), node(10, 10)]},
            {"id": "c", "name": "c", "closed": False, "nodes": [node(0, 20), node(10, 20)]},
        ]
        layers = [
            {"id": "one", "name": "outline", "visible": True, "locked": False,
             "pathIds": ["a"], "imageIds": [], "textIds": []},
            {"id": "two", "name": "outline", "visible": True, "locked": False,
             "pathIds": ["b"], "imageIds": [], "textIds": []},
            {"id": "three", "name": "OUTLINE [2]", "visible": True, "locked": False,
             "pathIds": ["c"], "imageIds": [], "textIds": []},
        ]
        result = vector_dxf.import_dxf(vector_dxf.export_dxf(self.document(paths, layers)), "layers.dxf")
        out_layers = result["document"]["layers"]
        self.assertEqual(len(out_layers), 3)
        self.assertEqual([len(layer["pathIds"]) for layer in out_layers], [1, 1, 1])
        self.assertEqual(len({layer["name"].casefold() for layer in out_layers}), 3)
        self.assertEqual(out_layers[0]["name"], "outline")

    def test_entity_colors_keep_distinct_path_colors_inside_one_layer(self):
        node = lambda x, y: {"x": x, "y": y, "in": {"x": x, "y": y},
                             "out": {"x": x, "y": y}, "mode": "cusp"}
        paths = [
            {"id": "red", "name": "red", "color": "#ff0000", "closed": False,
             "nodes": [node(0, 0), node(10, 0)]},
            {"id": "blue", "name": "blue", "color": "#0000ff", "closed": False,
             "nodes": [node(0, 10), node(10, 10)]},
        ]
        doc = self.document(paths)
        doc["layers"][0]["pathIds"] = ["red", "blue"]
        result = vector_dxf.import_dxf(vector_dxf.export_dxf(doc), "colors.dxf")["document"]
        self.assertEqual([path["color"] for path in result["paths"]], ["#ff0000", "#0000ff"])


class SplineDxfTests(unittest.TestCase):
    document = ExportDxfTests.document

    @staticmethod
    def node(x, y, incoming=None, outgoing=None):
        return {"x": x, "y": y, "in": dict(zip(('x', 'y'), incoming or (x, y))),
                "out": dict(zip(('x', 'y'), outgoing or (x, y))), "mode": "cusp"}

    def mixed_path(self, closed=True):
        return {"id": "mixed", "name": "mixed", "closed": closed, "color": "#ff0000", "nodes": [
            self.node(-10, 0, (-15, 5) if closed else None, (-10, -12)),
            self.node(20, 0, (20, -15)), self.node(20, 30, outgoing=(12, 42)),
            self.node(-5, 25, (0, 40), (-14, 20) if closed else None)]}

    def entities(self, raw):
        return vector_dxf._records(vector_dxf._sections(vector_dxf._pairs(raw))['ENTITIES'])

    def assert_geometry(self, source, imported, scale=5):
        self.assertEqual(imported['closed'], source['closed'])
        self.assertEqual(len(imported['nodes']), len(source['nodes']))
        for a, b in zip(source['nodes'], imported['nodes']):
            for p, q in ((a, b), (a['in'], b['in']), (a['out'], b['out'])):
                for axis in ('x', 'y'):
                    self.assertAlmostEqual(p[axis] * scale, q[axis], places=8)

    def test_open_and_closed_mixed_paths_keep_anchors_handles_corners_and_units(self):
        for closed in (False, True):
            with self.subTest(closed=closed):
                path = self.mixed_path(closed);doc = self.document([path]);before = copy.deepcopy(doc)
                raw = vector_dxf.export_dxf(doc, mode='spline')
                entities = self.entities(raw)
                self.assertEqual([kind for kind, _ in entities], ['SPLINE'])
                record = entities[0][1]
                self.assertEqual(int(vector_dxf._one(record, 70)), 9 if closed else 8)
                self.assertEqual(int(vector_dxf._one(record, 71)), 3)
                segments = 4 if closed else 3
                self.assertEqual(int(vector_dxf._one(record, 73)), 3 * segments + 1)
                self.assertEqual(int(vector_dxf._one(record, 72)), 3 * segments + 5)
                imported = vector_dxf.import_dxf(raw, 'curves.dxf')['document']
                self.assert_geometry(path, imported['paths'][0])
                self.assertEqual(imported['paths'][0]['nodes'][1]['mode'], 'cusp')
                self.assertEqual(imported['layers'][0]['name'], '切割层')
                self.assertEqual(imported['paths'][0]['color'], '#ff0000')
                self.assertEqual(doc, before)

    def test_spline_geometry_matches_independent_de_boor_evaluation(self):
        path = self.mixed_path();raw = vector_dxf.export_dxf(self.document([path]), mode='spline')
        record = self.entities(raw)[0][1]
        knots = list(map(float, vector_dxf._all(record, 40)))
        controls = list(zip(map(float, vector_dxf._all(record, 10)), map(float, vector_dxf._all(record, 20))))
        # Independent standard de Boor evaluation of serialized DXF, not our importer.
        def evaluate(u):
            span = next(i for i in range(3, len(controls)) if knots[i] <= u < knots[i+1])
            work = [list(controls[j]) for j in range(span-3, span+1)]
            for level in range(1, 4):
                for j in range(3, level-1, -1):
                    k = span-3+j
                    alpha = (u-knots[k])/(knots[k+4-level]-knots[k])
                    work[j] = [(1-alpha)*work[j-1][axis]+alpha*work[j][axis] for axis in (0, 1)]
            return work[3]
        for i, a in enumerate(path['nodes']):
            b = path['nodes'][(i+1) % len(path['nodes'])]
            for t in (0, .01, .1, .33, .5, .79, .99):
                actual = evaluate(i+t)
                for axis, sign, value in zip(('x', 'y'), (1, -1), actual):
                    expected = ((1-t)**3*a[axis] + 3*(1-t)**2*t*a['out'][axis]
                                + 3*(1-t)*t*t*b['in'][axis] + t**3*b[axis])*5*sign
                    self.assertAlmostEqual(value, expected, places=8)

    def test_sixteen_anchor_circle_stays_sixteen_while_default_still_flattens(self):
        nodes=[];radius=50;h=4/3*math.tan(math.pi/32)*radius
        for i in range(16):
            angle=2*math.pi*i/16;x=radius*math.cos(angle);y=radius*math.sin(angle)
            tx=-math.sin(angle)*h;ty=math.cos(angle)*h
            nodes.append(self.node(x,y,(x-tx,y-ty),(x+tx,y+ty)))
        path={'id':'circle','name':'circle','closed':True,'nodes':nodes}
        doc=self.document([path])
        raw=vector_dxf.export_dxf(doc, mode='spline')
        self.assert_geometry(path, vector_dxf.import_dxf(raw,'circle.dxf')['document']['paths'][0])
        default=vector_dxf.export_dxf(doc)
        self.assertEqual(default, vector_dxf.export_dxf(doc, mode='polyline'))
        self.assertEqual(self.entities(default)[0][0], 'LWPOLYLINE')
        self.assertGreater(len(vector_dxf.import_dxf(default,'circle.dxf')['document']['paths'][0]['nodes']),16)

    def test_straight_paths_stay_polylines_and_closed_anchor_normalization_keeps_curve(self):
        straight={'id':'line','name':'line','closed':False,'nodes':[self.node(0,0),self.node(20,0)]}
        raw=vector_dxf.export_dxf(self.document([straight]), mode='spline')
        self.assertEqual(self.entities(raw)[0][0], 'LWPOLYLINE')
        path=self.mixed_path();path['nodes'].append(self.node(-10,0,(-15,5)))
        path['nodes'][0]['in']={'x':-10,'y':0}
        before=copy.deepcopy(path);expected=self.mixed_path()
        raw=vector_dxf.export_dxf(self.document([path]), mode='spline')
        self.assert_geometry(expected,vector_dxf.import_dxf(raw,'repeated.dxf')['document']['paths'][0])
        self.assertEqual(path,before)

    def test_same_anchor_nonzero_closing_loop_and_collinear_overshoot_are_preserved(self):
        path=self.mixed_path();path['nodes'].append(self.node(-10,0,(-15,5),(20,-30)))
        raw=vector_dxf.export_dxf(self.document([path]), mode='spline')
        self.assert_geometry(path,vector_dxf.import_dxf(raw,'loop.dxf')['document']['paths'][0])
        path={'id':'over','name':'over','closed':False,'nodes':[self.node(0,0,outgoing=(100,0)),self.node(1,0,(-100,0))]}
        raw=vector_dxf.export_dxf(self.document([path]), mode='spline')
        self.assertEqual(self.entities(raw)[0][0],'SPLINE')
        self.assert_geometry(path,vector_dxf.import_dxf(raw,'overshoot.dxf')['document']['paths'][0])

    def test_two_span_closed_lens_retains_its_repeated_endpoint(self):
        path={'id':'lens','name':'lens','closed':True,'nodes':[
            self.node(0,0,outgoing=(0,10)),self.node(10,0,(10,10),(10,-10)),
            self.node(0,0,(0,-10))]}
        raw=vector_dxf.export_dxf(self.document([path]),mode='spline')
        self.assert_geometry(path,vector_dxf.import_dxf(raw,'lens.dxf')['document']['paths'][0])

    def test_import_rejects_incompatible_knots_counts_weights_and_false_closure(self):
        raw=vector_dxf.export_dxf(self.document([self.mixed_path(False)]), mode='spline')
        record=self.entities(raw)[0][1]
        variants=[[(c, 100 if c==73 else v) for c,v in record],
                  [(c, 9 if c==70 else v) for c,v in record],
                  [(c, 2.5 if c==71 else v) for c,v in record],
                  record+[(41,1)], record+[(41,2)]]
        altered=record.copy();index=next(i for i,(c,v) in enumerate(altered) if c==40 and float(v)==1)
        altered[index]=(40,.5);variants.append(altered)
        for variant in variants:
            with self.subTest(variant=variant),self.assertRaises(ValueError):
                vector_dxf.import_dxf(dxf((0,'SPLINE'),*variant),'invalid.dxf')

    def test_invalid_mode_does_not_silently_export_the_other_representation(self):
        for mode in ('typo',None,False,[]):
            with self.subTest(mode=mode),self.assertRaises(ValueError):
                vector_dxf.export_dxf(self.document([self.mixed_path()]),mode=mode)


if __name__ == "__main__":
    unittest.main()
