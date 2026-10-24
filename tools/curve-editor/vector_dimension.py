"""Shared geometry and derived labels for editable two-point dimensions."""
import copy
import math


_LIMIT = 10_000_000


def _number(value, *, positive=False):
    valid = type(value) in (int, float) and math.isfinite(value) and abs(value) <= _LIMIT
    return valid and (not positive or value > 0)


def check_dimension(text):
    """Validate and return a text record's strict dimension payload."""
    if not isinstance(text, dict) or "positionMarker" in text:
        raise ValueError("尺寸标注数据无效")
    dimension = text.get("dimension")
    required = {"a", "b", "offset", "unit"}
    if (not isinstance(dimension, dict) or not required.issubset(dimension)
            or set(dimension) - required != ({"bindings"} if "bindings" in dimension else set())):
        raise ValueError("尺寸标注数据无效")
    if dimension["unit"] not in ("mm", "cm") or not _number(dimension["offset"]):
        raise ValueError("尺寸标注数据无效")
    points = []
    for key in ("a", "b"):
        point = dimension[key]
        if (not isinstance(point, dict) or set(point) != {"x", "y"}
                or not _number(point["x"]) or not _number(point["y"])):
            raise ValueError("尺寸标注数据无效")
        points.append(point)
    if "bindings" in dimension:
        bindings = dimension["bindings"]
        if not isinstance(bindings, dict) or not set(bindings).issubset({"a", "b"}):
            raise ValueError("尺寸标注数据无效")
        for binding in bindings.values():
            if (not isinstance(binding, dict) or set(binding) != {"pathId", "index"}
                    or not isinstance(binding["pathId"], str)
                    or not binding["pathId"].strip() or len(binding["pathId"]) > 200
                    or type(binding["index"]) is not int
                    or not 0 <= binding["index"] < 10000):
                raise ValueError("尺寸标注数据无效")
    return dimension


def _basis(text):
    dimension = check_dimension(text)
    a, b = dimension["a"], dimension["b"]
    dx, dy = b["x"] - a["x"], b["y"] - a["y"]
    length = math.hypot(dx, dy)
    ux, uy = (dx / length, dy / length) if length else (1, 0)
    nx, ny = -uy, ux
    offset = dimension["offset"]
    qa = {"x": a["x"] + nx * offset, "y": a["y"] + ny * offset}
    qb = {"x": b["x"] + nx * offset, "y": b["y"] + ny * offset}
    return dimension, a, b, length, ux, uy, nx, ny, qa, qb


def _millimeters_per_pixel(calibration):
    if calibration is None:
        return None
    try:
        if not isinstance(calibration, dict) or calibration["unit"] not in ("mm", "cm"):
            raise ValueError()
        a, b = calibration["a"], calibration["b"]
        length = calibration["length"]
        distance = math.hypot(b["x"] - a["x"], b["y"] - a["y"])
        if not _number(length, positive=True) or distance <= 1e-6:
            raise ValueError()
        scale = length * (10 if calibration["unit"] == "cm" else 1) / distance
        if not math.isfinite(scale) or scale <= 0:
            raise ValueError()
        return scale
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise ValueError("实际尺寸比例无效，请重新标定") from exc


def resolve_dimension(text, calibration, paths=None):
    """Return a copy with authoritative content, label position and rotation."""
    result = copy.deepcopy(text)
    dimension = check_dimension(result)
    bindings = dimension.get("bindings", {})
    if bindings and paths is not None:
        paths_by_id = {
            path["id"]: path for path in paths
            if isinstance(path, dict) and isinstance(path.get("id"), str)
        }
        for key, binding in bindings.items():
            path = paths_by_id.get(binding["pathId"])
            nodes = path.get("nodes") if isinstance(path, dict) else None
            index = binding["index"]
            if isinstance(nodes, list) and index < len(nodes):
                node = nodes[index]
                if (isinstance(node, dict) and _number(node.get("x"))
                        and _number(node.get("y"))):
                    dimension[key] = {"x": node["x"], "y": node["y"]}
    dimension, a, b, length, ux, uy, nx, ny, qa, qb = _basis(result)
    scale = _millimeters_per_pixel(calibration)
    if scale is None:
        content = "未标定"
    else:
        value = length * scale / (10 if dimension["unit"] == "cm" else 1)
        rounded = math.floor(value * 100 + 0.5) / 100
        content = f"{rounded:.2f} {dimension['unit']}"

    # Keep text upright when the measured direction points left or vertically up.
    if ux < 0 or (abs(ux) <= 1e-12 and uy < 0):
        ux, uy = -ux, -uy
    readable_nx, readable_ny = -uy, ux
    midpoint_x = (qa["x"] + qb["x"]) / 2
    midpoint_y = (qa["y"] + qb["y"]) / 2
    font_size = text.get("fontSize")
    if not _number(font_size, positive=True):
        raise ValueError("尺寸标注字号无效")
    width = len(content) * font_size * 0.6
    result.update({
        "content": content,
        "x": midpoint_x - ux * width / 2 - readable_nx * font_size * 1.35,
        "y": midpoint_y - uy * width / 2 - readable_ny * font_size * 1.35,
        "rotation": math.degrees(math.atan2(uy, ux)),
    })
    return result


def dimension_segments(text):
    """Return extension, dimension and four arrow-wing line segments."""
    dimension, a, b, length, ux, uy, nx, ny, qa, qb = _basis(text)
    font_size = text.get("fontSize")
    if not _number(font_size, positive=True):
        raise ValueError("尺寸标注字号无效")
    direction = -1 if dimension["offset"] < 0 else 1
    extension = font_size * 0.3 * direction
    extension_a = {"x": qa["x"] + nx * extension, "y": qa["y"] + ny * extension}
    extension_b = {"x": qb["x"] + nx * extension, "y": qb["y"] + ny * extension}
    arrow = min(font_size * 0.5, length * 0.25)
    wing = arrow * 0.4

    def point(base, along, normal):
        return {"x": base["x"] + ux * along + nx * normal,
                "y": base["y"] + uy * along + ny * normal}

    return [
        (copy.deepcopy(a), extension_a),
        (copy.deepcopy(b), extension_b),
        (copy.deepcopy(qa), copy.deepcopy(qb)),
        (copy.deepcopy(qa), point(qa, arrow, wing)),
        (copy.deepcopy(qa), point(qa, arrow, -wing)),
        (copy.deepcopy(qb), point(qb, -arrow, wing)),
        (copy.deepcopy(qb), point(qb, -arrow, -wing)),
    ]

