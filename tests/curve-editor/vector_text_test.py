"""Native CoreText text-to-outline conversion contracts."""
import copy
import math
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/curve-editor"))

import vector_text


def text(content="A12 中文", **changes):
    value = {
        "id": "label-1",
        "name": "裁片编号",
        "content": content,
        "x": 100,
        "y": 80,
        "fontSize": 24,
        "color": "#176bce",
    }
    value.update(changes)
    return value


def points(path):
    return [(p["x"], p["y"]) for node in path["nodes"]
            for p in (node, node["in"], node["out"])]


class VectorTextTests(unittest.TestCase):
    def test_chinese_latin_digits_are_outlined_without_mutating_source(self):
        source = text()
        before = copy.deepcopy(source)
        paths = vector_text.outline_text(source)
        self.assertEqual(source, before)
        self.assertGreaterEqual(len(paths), 5)
        self.assertEqual(len({path["id"] for path in paths}), len(paths))
        for path in paths:
            self.assertEqual(path["name"], source["name"])
            self.assertEqual(path["color"], source["color"])
            self.assertEqual(path["role"], "outline")
            self.assertTrue(path["closed"])
            self.assertGreaterEqual(len(path["nodes"]), 2)
            for node in path["nodes"]:
                self.assertEqual(node["mode"], "cusp")
                for point in (node, node["in"], node["out"]):
                    self.assertTrue(math.isfinite(point["x"]))
                    self.assertTrue(math.isfinite(point["y"]))

    def test_multiline_uses_canvas_baselines(self):
        paths = vector_text.outline_text(text("I\nI", fontSize=10, x=7, y=11))
        self.assertEqual(len(paths), 2)
        upper, lower = sorted(paths, key=lambda path: min(y for x, y in points(path)))
        for (x1, y1), (x2, y2) in zip(points(upper), points(lower)):
            self.assertAlmostEqual(x1, x2, places=7)
            self.assertAlmostEqual(y2 - y1, 12, places=7)

    def test_rotation_is_about_text_anchor(self):
        source = text("I", x=30, y=40, fontSize=20)
        plain = vector_text.outline_text(source)
        rotated = vector_text.outline_text({**source, "rotation": 90})
        self.assertEqual(len(plain), len(rotated))
        for original, turned in zip(plain, rotated):
            for (px, py), (qx, qy) in zip(points(original), points(turned)):
                self.assertAlmostEqual(qx, source["x"] - (py - source["y"]), places=6)
                self.assertAlmostEqual(qy, source["y"] + (px - source["x"]), places=6)

    def test_holes_are_separate_closed_contours(self):
        paths = vector_text.outline_text(text("O"))
        self.assertEqual(len(paths), 2)
        self.assertTrue(all(path["closed"] for path in paths))

    def test_coretext_applies_contextual_shaping(self):
        joined = vector_text.outline_text(text("سلام", x=0, y=0))
        isolated = [path for character in "سلام"
                    for path in vector_text.outline_text(text(character, x=0, y=0))]
        self.assertTrue(joined)
        self.assertNotEqual(sum(len(path["nodes"]) for path in joined),
                            sum(len(path["nodes"]) for path in isolated))

    def test_font_size_scales_all_geometry(self):
        small = vector_text.outline_text(text("S", x=0, y=0, fontSize=12))
        large = vector_text.outline_text(text("S", x=0, y=0, fontSize=24))
        self.assertEqual(len(small), len(large))
        for a, b in zip(small, large):
            for (x1, y1), (x2, y2) in zip(points(a), points(b)):
                self.assertAlmostEqual(x2, x1 * 2, places=6)
                self.assertAlmostEqual(y2, y1 * 2, places=6)

    def test_default_font_matches_chrome_zh_cn_sans_serif_advance(self):
        # Chrome 155 on macOS resolves 28px sans-serif under lang=zh-CN to
        # PingFangSC-Regular: digit advance 16.8px + space advance 9.324px.
        paths = vector_text.outline_text(text("0 0", x=0, y=0, fontSize=28))
        self.assertEqual(len(paths), 4)  # outer and inner contour per zero
        first_left = min(x for path in paths[:2] for x, y in points(path))
        second_left = min(x for path in paths[2:] for x, y in points(path))
        self.assertAlmostEqual(first_left, 1.4, places=6)
        self.assertAlmostEqual(second_left - first_left, 26.124, places=6)

    def test_position_marker_adds_fixed_dot_and_rotated_leader(self):
        source = text(" ", x=100, y=80, fontSize=20, rotation=90,
                      positionMarker={"x": 40, "y": 50})
        paths = vector_text.outline_text(source)
        self.assertEqual(len(paths), 2)
        dot = next(path for path in paths if path["closed"])
        leader = next(path for path in paths if not path["closed"])
        dot_points = [(node["x"], node["y"]) for node in dot["nodes"]]
        self.assertAlmostEqual(min(x for x, y in dot_points), 40 - 3.2)
        self.assertAlmostEqual(max(x for x, y in dot_points), 40 + 3.2)
        self.assertAlmostEqual(min(y for x, y in dot_points), 50 - 3.2)
        self.assertAlmostEqual(max(y for x, y in dot_points), 50 + 3.2)
        self.assertEqual((leader["nodes"][0]["x"], leader["nodes"][0]["y"]), (40, 50))
        self.assertAlmostEqual(leader["nodes"][1]["x"], 88)
        self.assertAlmostEqual(leader["nodes"][1]["y"], 80)
        self.assertEqual(source["positionMarker"], {"x": 40, "y": 50})

    def test_missing_visible_glyph_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "字形"):
            vector_text.outline_text(text("A\u0378B"))
        with self.assertRaisesRegex(ValueError, "字形"):
            vector_text.outline_text(text("😀"))

    def test_invalid_values_platform_and_resource_limits_are_rejected(self):
        invalid = [
            None, text(1), text("A", x=float("inf")), text("A", fontSize=0),
            text("A", rotation=True), text("A", color="#123"),
            text("A", positionMarker={"x": 0, "y": float("nan")}),
        ]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                vector_text.outline_text(value)
        with self.assertRaises(ValueError):
            vector_text.outline_text(text("x" * 10001))
        with patch.object(vector_text, "MAX_PATHS", 1):
            with self.assertRaisesRegex(ValueError, "上限"):
                vector_text.outline_text(text("O"))
        with patch.object(vector_text.sys, "platform", "linux"):
            with self.assertRaisesRegex(ValueError, "macOS"):
                vector_text.outline_text(text("A"))


if __name__ == "__main__":
    unittest.main()
