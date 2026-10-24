"""Small, dependency-free ASCII DXF codec for the curve editor.

Coordinates in imported editor documents are millimetres represented as pixels.
DXF's upward Y axis is mapped to the editor's downward Y axis by negation.  Arc
entities are represented by cubic Beziers. Export defaults to LWPOLYLINE with
at most 0.01 mm control-polygon deviation; spline mode keeps cubic geometry.
"""

from __future__ import annotations

import copy
import math
from pathlib import Path
import re
from typing import Dict, List, Optional, Sequence, Tuple


MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_PAIRS = 2_000_000
MAX_ENTITIES = 100_000
MAX_PATHS = 500
MAX_NODES = 10_000
MAX_LAYERS = 200
MAX_COORD = 10_000_000.0
CURVE_TOLERANCE_MM = 0.01

UNIT_FACTORS = {
    1: ("in", 25.4), 2: ("ft", 304.8), 3: ("mi", 1_609_344.0),
    4: ("mm", 1.0), 5: ("cm", 10.0), 6: ("m", 1000.0), 7: ("km", 1_000_000.0),
    8: ("microin", 0.0000254), 9: ("mil", 0.0254), 10: ("yd", 914.4),
    11: ("angstrom", 1e-7), 12: ("nm", 1e-6), 13: ("um", 0.001),
    14: ("dm", 100.0), 15: ("dam", 10_000.0), 16: ("hm", 100_000.0),
    17: ("Gm", 1e12), 18: ("AU", 149_597_870_700_000.0),
    19: ("ly", 9.4607304725808e18), 20: ("pc", 3.0856775814913674e19),
    21: ("us-ft", 1200 / 3937 * 1000),
}
OVERRIDE_FACTORS = {name: factor for code, (name, factor) in UNIT_FACTORS.items() if code in (1, 2, 4, 5, 6)}

ACI_COLORS = {
    1: "#ff0000", 2: "#ffff00", 3: "#00ff00", 4: "#00ffff",
    5: "#0000ff", 6: "#ff00ff", 7: "#ffffff", 8: "#808080", 9: "#c0c0c0",
}
DEFAULT_COLOR = "#e04544"


class MissingUnitsError(ValueError):
    """Raised when a DXF has no usable $INSUNITS declaration."""


def _decode_text(data: bytes) -> str:
    if not isinstance(data, (bytes, bytearray)):
        raise TypeError("DXF data must be bytes")
    if len(data) > MAX_FILE_BYTES:
        raise ValueError("DXF exceeds the 64 MiB input limit")
    if b"\x00" in data:
        raise ValueError("binary DXF is not supported")
    try:
        return bytes(data).decode("utf-8-sig")
    except UnicodeDecodeError:
        return bytes(data).decode("cp1252")


def _pairs(data: bytes) -> List[Tuple[int, str]]:
    lines = _decode_text(data).splitlines()
    if len(lines) % 2:
        raise ValueError("malformed DXF: unmatched group code")
    if len(lines) // 2 > MAX_PAIRS:
        raise ValueError("DXF token limit exceeded")
    result = []
    for index in range(0, len(lines), 2):
        try:
            code = int(lines[index].strip())
        except ValueError as exc:
            raise ValueError("malformed DXF group code at line %d" % (index + 1)) from exc
        if code < 0 or code > 1071:
            raise ValueError("invalid DXF group code %d" % code)
        result.append((code, lines[index + 1].strip()))
    if not result or result[-1] != (0, "EOF"):
        raise ValueError("malformed DXF: missing EOF")
    return result


def _sections(pairs: Sequence[Tuple[int, str]]) -> Dict[str, List[Tuple[int, str]]]:
    sections: Dict[str, List[Tuple[int, str]]] = {}
    i = 0
    while i < len(pairs):
        if pairs[i] == (0, "SECTION"):
            if i + 1 >= len(pairs) or pairs[i + 1][0] != 2:
                raise ValueError("malformed DXF SECTION")
            name = pairs[i + 1][1].upper()
            i += 2
            start = i
            while i < len(pairs) and pairs[i] != (0, "ENDSEC"):
                i += 1
            if i >= len(pairs):
                raise ValueError("unterminated DXF SECTION")
            sections.setdefault(name, []).extend(pairs[start:i])
        i += 1
    if "ENTITIES" not in sections:
        raise ValueError("DXF must contain an ENTITIES section")
    return sections


def _records(values: Sequence[Tuple[int, str]]) -> List[Tuple[str, List[Tuple[int, str]]]]:
    records = []
    current_type = None
    current: List[Tuple[int, str]] = []
    for code, value in values:
        if code == 0:
            if current_type is not None:
                records.append((current_type, current))
            current_type, current = value.upper(), []
        elif current_type is not None:
            current.append((code, value))
    if current_type is not None:
        records.append((current_type, current))
    return records


def _one(record: Sequence[Tuple[int, str]], code: int, default=None):
    for item_code, value in record:
        if item_code == code:
            return value
    return default


def _all(record: Sequence[Tuple[int, str]], code: int) -> List[str]:
    return [value for item_code, value in record if item_code == code]


def _number(value, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid DXF number for %s" % label) from exc
    if not math.isfinite(number):
        raise ValueError("non-finite DXF number for %s" % label)
    return number


def _integer(value, label: str) -> int:
    number = _number(value, label)
    if number != int(number):
        raise ValueError("invalid DXF integer for %s" % label)
    return int(number)


_UNICODE_ESCAPE = re.compile(r"\\U\+([0-9A-Fa-f]{4})")
_SURROGATE_PAIR = re.compile(r"\\U\+([dD][89ABab][0-9A-Fa-f]{2})\\U\+([dD][c-fC-F][0-9A-Fa-f]{2})")


def _unescape(value: str) -> str:
    def replace_pair(match):
        high, low = int(match.group(1), 16), int(match.group(2), 16)
        return chr(0x10000 + ((high - 0xD800) << 10) + low - 0xDC00)
    value = _SURROGATE_PAIR.sub(replace_pair, value)
    def replace(match):
        codepoint = int(match.group(1), 16)
        if codepoint > 0x10FFFF or 0xD800 <= codepoint <= 0xDFFF:
            raise ValueError("invalid DXF Unicode escape")
        return chr(codepoint)
    return _UNICODE_ESCAPE.sub(replace, value)


def _resolve_units(header: Sequence[Tuple[int, str]], override: Optional[str]) -> Tuple[str, float]:
    if override is not None and override not in OVERRIDE_FACTORS:
        raise ValueError("unit_override must be one of mm, cm, m, in, ft")
    declared = None
    for index, (code, value) in enumerate(header):
        if code == 9 and value.upper() == "$INSUNITS":
            if index + 1 >= len(header) or header[index + 1][0] not in (70, 280):
                raise ValueError("malformed $INSUNITS header")
            declared = _integer(header[index + 1][1], "$INSUNITS")
            break
    if declared in UNIT_FACTORS:
        return UNIT_FACTORS[declared]
    if override is not None:
        return override, OVERRIDE_FACTORS[override]
    detail = "missing" if declared is None else "unknown value %d" % declared
    raise MissingUnitsError("DXF units are %s; choose mm, cm, m, in, or ft" % detail)


def _aci_color(record: Sequence[Tuple[int, str]]) -> str:
    true_color = _one(record, 420)
    if true_color is not None:
        value = _integer(true_color, "true color")
        if 0 <= value <= 0xFFFFFF:
            return "#%06x" % value
    aci = abs(_integer(_one(record, 62, 7), "layer color"))
    return ACI_COLORS.get(aci, DEFAULT_COLOR)


def _entity_color(record: Sequence[Tuple[int, str]], layer_color: str) -> str:
    true_color = _one(record, 420)
    if true_color is not None:
        value = _integer(true_color, "entity true color")
        if not 0 <= value <= 0xFFFFFF:
            raise ValueError("invalid DXF entity true color")
        return "#%06x" % value
    raw_aci = _one(record, 62)
    if raw_aci is None:
        return layer_color
    aci = abs(_integer(raw_aci, "entity color"))
    if aci in (0, 256):
        return layer_color
    return ACI_COLORS.get(aci, layer_color)


def _layer_table(values: Sequence[Tuple[int, str]]) -> Dict[str, dict]:
    layers: Dict[str, dict] = {}
    for kind, record in _records(values):
        if kind != "LAYER":
            continue
        raw_name = _one(record, 2)
        if raw_name is None:
            raise ValueError("DXF LAYER has no name")
        name = _unescape(raw_name)
        if not name or len(name) > 200:
            raise ValueError("invalid DXF layer name")
        flags = _integer(_one(record, 70, 0), "layer flags")
        color = _integer(_one(record, 62, 7), "layer color")
        layers[name] = {"name": name, "visible": color >= 0 and not (flags & 1),
                        "locked": bool(flags & 4), "color": _aci_color(record)}
    if len(layers) > MAX_LAYERS:
        raise ValueError("DXF layer limit exceeded")
    return layers


def _matrix_apply(matrix, point):
    a, b, c, d, tx, ty = matrix
    x, y = point
    return (a * x + c * y + tx, b * x + d * y + ty)


def _matrix_compose(parent, child):
    pa, pb, pc, pd, ptx, pty = parent
    a, b, c, d, tx, ty = child
    return (pa * a + pc * b, pb * a + pd * b,
            pa * c + pc * d, pb * c + pd * d,
            pa * tx + pc * ty + ptx, pb * tx + pd * ty + pty)


def _point(record, xcode=10, ycode=20, label="point"):
    x = _one(record, xcode)
    y = _one(record, ycode)
    if x is None or y is None:
        raise ValueError("DXF %s is incomplete" % label)
    return (_number(x, label), _number(y, label))


def _require_2d(record, zcodes=(30, 31, 32, 33)):
    for code in zcodes:
        for value in _all(record, code):
            if abs(_number(value, "Z coordinate")) > 1e-12:
                raise ValueError("only 2D DXF geometry is supported")
    ex = _number(_one(record, 210, 0), "extrusion X")
    ey = _number(_one(record, 220, 0), "extrusion Y")
    ez = _number(_one(record, 230, 1), "extrusion Z")
    if abs(ex) > 1e-12 or abs(ey) > 1e-12 or abs(ez - 1) > 1e-12:
        raise ValueError("only the default 2D DXF extrusion is supported")


def _cubic_arc(center, rx_vec, ry_vec, start, end, factor, matrix):
    sweep = end - start
    if not math.isfinite(sweep) or abs(sweep) > 2 * math.pi + 1e-9:
        raise ValueError("DXF arc sweep exceeds one turn")
    if sweep <= 0:
        sweep += 2 * math.pi
    a, b, c, d, _, _ = matrix
    transformed_rx = (a * rx_vec[0] + c * rx_vec[1], b * rx_vec[0] + d * rx_vec[1])
    transformed_ry = (a * ry_vec[0] + c * ry_vec[1], b * ry_vec[0] + d * ry_vec[1])
    radius_mm = max(math.hypot(*transformed_rx), math.hypot(*transformed_ry)) * factor
    # For the standard tangent cubic, radial error is below r*theta^6/55296.
    max_angle = math.pi / 2
    if radius_mm > 0:
        max_angle = min(max_angle, max(0.02, (CURVE_TOLERANCE_MM * 55296 / radius_mm) ** (1 / 6)))
    count = max(1, int(math.ceil(abs(sweep) / max_angle)))
    result = []
    for index in range(count):
        a0 = start + sweep * index / count
        a1 = start + sweep * (index + 1) / count
        delta = a1 - a0
        k = 4 / 3 * math.tan(delta / 4)
        def p(angle):
            return (center[0] + rx_vec[0] * math.cos(angle) + ry_vec[0] * math.sin(angle),
                    center[1] + rx_vec[1] * math.cos(angle) + ry_vec[1] * math.sin(angle))
        def tangent(angle):
            return (-rx_vec[0] * math.sin(angle) + ry_vec[0] * math.cos(angle),
                    -rx_vec[1] * math.sin(angle) + ry_vec[1] * math.cos(angle))
        p0, p3 = p(a0), p(a1)
        t0, t1 = tangent(a0), tangent(a1)
        result.append((p0, (p0[0] + k * t0[0], p0[1] + k * t0[1]),
                       (p3[0] - k * t1[0], p3[1] - k * t1[1]), p3))
    return [[_matrix_apply(matrix, p) for p in segment] for segment in result]


def _line_segment(a, b, matrix):
    p0, p1 = _matrix_apply(matrix, a), _matrix_apply(matrix, b)
    return (p0, p0, p1, p1)


def _bulge_segments(a, b, bulge, factor, matrix):
    if abs(bulge) < 1e-14:
        return [_line_segment(a, b, matrix)]
    dx, dy = b[0] - a[0], b[1] - a[1]
    chord = math.hypot(dx, dy)
    if chord <= 1e-14:
        raise ValueError("bulged polyline edge has zero length")
    theta = 4 * math.atan(bulge)
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    offset = chord / (2 * math.tan(theta / 2))
    center = (mx - dy / chord * offset, my + dx / chord * offset)
    radius = math.hypot(a[0] - center[0], a[1] - center[1])
    start = math.atan2(a[1] - center[1], a[0] - center[0])
    if theta > 0:
        return _cubic_arc(center, (radius, 0), (0, radius), start, start + theta, factor, matrix)
    # _cubic_arc is counter-clockwise; reverse a positive arc to represent clockwise bulge.
    forward = _cubic_arc(center, (radius, 0), (0, radius), start + theta, start, factor, matrix)
    return [(s[3], s[2], s[1], s[0]) for s in reversed(forward)]


def _editor_point(point, factor):
    x, y = point[0] * factor, -point[1] * factor
    if not math.isfinite(x) or not math.isfinite(y) or abs(x) > MAX_COORD or abs(y) > MAX_COORD:
        raise ValueError("DXF coordinate exceeds the supported range")
    return {"x": float(x), "y": float(y)}


def _path_from_segments(segments, closed, factor, path_id, name, layer_name, color, visible):
    if not segments:
        raise ValueError("DXF entity has no drawable segments")
    converted = [[_editor_point(point, factor) for point in segment] for segment in segments]
    nodes = []
    first = converted[0][0]
    nodes.append({"x": first["x"], "y": first["y"], "in": dict(first), "out": dict(first), "mode": "cusp"})
    for segment_index, segment in enumerate(converted):
        p0, c1, c2, p3 = segment
        if abs(nodes[-1]["x"] - p0["x"]) > 1e-6 or abs(nodes[-1]["y"] - p0["y"]) > 1e-6:
            raise ValueError("disconnected DXF entity segments")
        nodes[-1]["out"] = dict(c1)
        curved = c1 != p0 or c2 != p3
        if (closed and segment_index == len(converted) - 1 and
                abs(p3["x"] - first["x"]) <= 1e-8 and abs(p3["y"] - first["y"]) <= 1e-8):
            nodes[0]["in"] = dict(c2)
            if curved:
                nodes[-1]["mode"] = "smooth"
                nodes[0]["mode"] = "smooth"
        else:
            node = {"x": p3["x"], "y": p3["y"], "in": dict(c2), "out": dict(p3),
                    "mode": "smooth" if curved else "cusp"}
            if curved:
                nodes[-1]["mode"] = "smooth"
            nodes.append(node)
    if len(nodes) > MAX_NODES:
        raise ValueError("DXF path node limit exceeded")
    if closed and len(nodes) < 3:
        raise ValueError("closed DXF paths require at least three nodes")
    return {"id": path_id, "name": name, "role": "outline", "color": color,
            "closed": bool(closed), "visible": bool(visible), "note": "Imported from DXF layer " + layer_name,
            "nodes": nodes, "_layer": layer_name}


def _poly_vertices(record):
    vertices = []
    current = None
    for code, value in record:
        if code == 10:
            if current is not None:
                vertices.append(current)
            current = {"x": _number(value, "polyline X"), "bulge": 0.0}
        elif current is not None and code == 20:
            current["y"] = _number(value, "polyline Y")
        elif current is not None and code == 42:
            current["bulge"] = _number(value, "polyline bulge")
    if current is not None:
        vertices.append(current)
    if len(vertices) < 2 or any("y" not in vertex for vertex in vertices):
        raise ValueError("LWPOLYLINE requires at least two complete vertices")
    return vertices


def _poly_segments(vertices, closed, factor, matrix):
    segments = []
    count = len(vertices) if closed else len(vertices) - 1
    for index in range(count):
        a, b = vertices[index], vertices[(index + 1) % len(vertices)]
        segments.extend(_bulge_segments((a["x"], a["y"]), (b["x"], b["y"]), a.get("bulge", 0), factor, matrix))
    return segments


def _parse_blocks(values):
    blocks = {}
    records = _records(values)
    i = 0
    while i < len(records):
        kind, record = records[i]
        if kind != "BLOCK":
            i += 1
            continue
        name = _one(record, 2) or _one(record, 3)
        if not name:
            raise ValueError("DXF BLOCK has no name")
        base = (_number(_one(record, 10, 0), "block base X"), _number(_one(record, 20, 0), "block base Y"))
        body = []
        i += 1
        while i < len(records) and records[i][0] != "ENDBLK":
            body.append(records[i])
            i += 1
        if i >= len(records):
            raise ValueError("unterminated DXF BLOCK")
        blocks[name] = (base, body)
        i += 1
    return blocks


def _spline_segments(record, matrix):
    """Read clamped linear or piecewise cubic Bezier splines without sampling.

    Cubic spans may share endpoints (interior knot multiplicity three) or
    repeat coincident endpoints (multiplicity four). Disconnected spans and
    other B-splines are rejected rather than joined or misread as Beziers.
    """
    degree = _integer(_one(record, 71), "spline degree")
    if degree not in (1, 3):
        raise ValueError("unsupported DXF SPLINE: only linear and cubic Bezier splines are supported")
    xs, ys = _all(record, 10), _all(record, 20)
    if len(xs) != len(ys) or not degree + 1 <= len(xs) <= 4 * MAX_NODES:
        raise ValueError("malformed DXF SPLINE control points")
    points = [(_number(x, "spline X"), _number(y, "spline Y")) for x, y in zip(xs, ys)]
    knots = [_number(value, "spline knot") for value in _all(record, 40)]
    if (_integer(_one(record, 73, len(points)), "spline control count") != len(points) or
            _integer(_one(record, 72, len(knots)), "spline knot count") != len(knots)):
        raise ValueError("malformed DXF SPLINE declared counts")
    if len(knots) != len(points) + degree + 1 or any(b < a for a, b in zip(knots, knots[1:])):
        raise ValueError("unsupported DXF SPLINE knot vector")
    if (any(value != knots[0] for value in knots[:degree + 1]) or
            any(value != knots[-1] for value in knots[-degree - 1:]) or knots[-1] <= knots[0]):
        raise ValueError("unsupported DXF SPLINE: knot vector must be clamped")
    weights = [_number(v, "spline weight") for v in _all(record, 41)]
    if weights and (len(weights) != len(points) or any(v != 1 for v in weights)):
        raise ValueError("rational or malformed DXF SPLINE weights are unsupported")
    flags = _integer(_one(record, 70, 0), "spline flags")
    if flags & 2:
        raise ValueError("periodic DXF SPLINE geometry is unsupported")
    closed = bool(flags & 1)
    if closed and points[0] != points[-1]:
        raise ValueError("closed DXF SPLINE endpoints must coincide")
    if degree == 1:
        active_knots = knots[1:-1]
        if any(b <= a for a, b in zip(active_knots, active_knots[1:])):
            raise ValueError("unsupported linear DXF SPLINE: active knots must be strictly increasing")
        segments = [_line_segment(a, b, matrix) for a, b in zip(points, points[1:])]
    else:
        # Each nonzero knot span already describes one exact cubic Bezier.
        # A fourth interior knot repeats the endpoint control, as used by
        # some CAD exporters; it must not introduce a fabricated connection.
        runs = []
        for knot in knots:
            if runs and runs[-1][0] == knot:
                runs[-1][1] += 1
            else:
                runs.append([knot, 1])
        if (runs[0][1] != 4 or runs[-1][1] != 4 or
                any(count not in (3, 4) for _, count in runs[1:-1])):
            raise ValueError("unsupported DXF SPLINE: cubic Bezier spans require triple or quadruple interior knots")
        if len(runs) - 1 > MAX_NODES:
            raise ValueError("DXF path node limit exceeded")
        segments = []
        previous_end = None
        for k in range(3, len(points)):
            if knots[k] == knots[k + 1]:
                continue
            span = points[k - 3:k + 1]
            if previous_end is not None and previous_end != span[0]:
                raise ValueError("disconnected DXF SPLINE spans are unsupported")
            segments.append(tuple(_matrix_apply(matrix, p) for p in span))
            previous_end = span[-1]
    return segments, closed


def _spline_node_modes(path):
    # Knot multiplicity permits corners. Do not label their independent handles
    # as smooth merely because an adjacent span is curved.
    for node in path['nodes']:
        ax, ay = node['in']['x'] - node['x'], node['in']['y'] - node['y']
        bx, by = node['out']['x'] - node['x'], node['out']['y'] - node['y']
        product = math.hypot(ax, ay) * math.hypot(bx, by)
        node['mode'] = ('smooth' if product > 0 and ax * bx + ay * by < 0
                        and abs(ax * by - ay * bx) <= 1e-10 * product else 'cusp')


class _Importer:
    def __init__(self, factor, layer_defs, blocks):
        self.factor = factor
        self.layer_defs = layer_defs
        self.blocks = blocks
        self.paths = []
        self.counter = 0

    def layer(self, name):
        name = _unescape(name or "0")
        if name not in self.layer_defs:
            if len(self.layer_defs) >= MAX_LAYERS:
                raise ValueError("DXF layer limit exceeded")
            self.layer_defs[name] = {"name": name, "visible": True, "locked": False, "color": DEFAULT_COLOR}
        return name

    def add_path(self, segments, closed, layer, entity_name, color, visible):
        if len(self.paths) >= MAX_PATHS:
            raise ValueError("DXF path limit exceeded")
        self.counter += 1
        path = _path_from_segments(segments, closed, self.factor, "dxf-path-%d" % self.counter,
                                   "%s %d" % (entity_name.title(), self.counter), layer, color, visible)
        self.paths.append(path)

    def consume(self, records, matrix=(1, 0, 0, 1, 0, 0), inherited_layer=None,
                depth=0, inherited_visible=True):
        if depth > 16:
            raise ValueError("DXF block nesting limit exceeded")
        i = 0
        while i < len(records):
            kind, record = records[i]
            if kind in ("VERTEX", "SEQEND", "ENDBLK"):
                raise ValueError("malformed DXF %s sequence" % kind)
            _require_2d(record)
            raw_layer = _one(record, 8, "0")
            layer = self.layer(inherited_layer if raw_layer == "0" and inherited_layer else raw_layer)
            color = _entity_color(record, self.layer_defs[layer]["color"])
            invisible = _integer(_one(record, 60, 0), "entity visibility")
            if invisible not in (0, 1):
                raise ValueError("invalid DXF entity visibility")
            visible = inherited_visible and invisible == 0
            if kind == "LINE":
                self.add_path([_line_segment(_point(record), _point(record, 11, 21), matrix)], False, layer, kind, color, visible)
            elif kind == "LWPOLYLINE":
                if abs(_number(_one(record, 38, 0), "polyline elevation")) > 1e-12:
                    raise ValueError("only 2D LWPOLYLINE geometry is supported")
                vertices = _poly_vertices(record)
                closed = bool(_integer(_one(record, 70, 0), "polyline flags") & 1)
                self.add_path(_poly_segments(vertices, closed, self.factor, matrix), closed, layer, kind, color, visible)
            elif kind == "POLYLINE":
                flags = _integer(_one(record, 70, 0), "polyline flags")
                if flags & (2 | 4):
                    raise ValueError("curve-fit and spline-fit DXF POLYLINE geometry is unsupported")
                if flags & (8 | 16 | 64):
                    raise ValueError("only 2D POLYLINE geometry is supported")
                vertices = []
                i += 1
                while i < len(records) and records[i][0] == "VERTEX":
                    vertex_record = records[i][1]
                    _require_2d(vertex_record)
                    vertices.append({"x": _number(_one(vertex_record, 10), "vertex X"),
                                     "y": _number(_one(vertex_record, 20), "vertex Y"),
                                     "bulge": _number(_one(vertex_record, 42, 0), "vertex bulge")})
                    i += 1
                if i >= len(records) or records[i][0] != "SEQEND" or len(vertices) < 2:
                    raise ValueError("malformed DXF POLYLINE sequence")
                closed = bool(flags & 1)
                self.add_path(_poly_segments(vertices, closed, self.factor, matrix), closed, layer, kind, color, visible)
            elif kind in ("ARC", "CIRCLE"):
                center = _point(record)
                radius = _number(_one(record, 40), "radius")
                if radius <= 0:
                    raise ValueError("DXF radius must be positive")
                if kind == "ARC":
                    start = math.radians(_number(_one(record, 50), "arc start"))
                    end = math.radians(_number(_one(record, 51), "arc end"))
                    closed = False
                else:
                    start, end, closed = 0.0, 2 * math.pi, True
                self.add_path(_cubic_arc(center, (radius, 0), (0, radius), start, end, self.factor, matrix), closed, layer, kind, color, visible)
            elif kind == "ELLIPSE":
                center = _point(record)
                major = _point(record, 11, 21, "ellipse major axis")
                ratio = _number(_one(record, 40), "ellipse ratio")
                if not 0 < ratio <= 1 or math.hypot(*major) <= 0:
                    raise ValueError("invalid DXF ELLIPSE axes")
                minor = (-major[1] * ratio, major[0] * ratio)
                start = _number(_one(record, 41, 0), "ellipse start")
                end = _number(_one(record, 42, 2 * math.pi), "ellipse end")
                closed = abs((end - start) % (2 * math.pi)) < 1e-10
                if closed:
                    end = start + 2 * math.pi
                self.add_path(_cubic_arc(center, major, minor, start, end, self.factor, matrix), closed, layer, kind, color, visible)
            elif kind == "SPLINE":
                segments, closed = _spline_segments(record, matrix)
                self.add_path(segments, closed, layer, kind, color, visible)
                _spline_node_modes(self.paths[-1])
            elif kind == "INSERT":
                block_name = _one(record, 2)
                if block_name not in self.blocks:
                    raise ValueError("DXF INSERT references missing block %s" % block_name)
                cols = _integer(_one(record, 70, 1), "insert columns")
                rows = _integer(_one(record, 71, 1), "insert rows")
                if cols != 1 or rows != 1:
                    raise ValueError("DXF INSERT arrays are unsupported")
                insertion = _point(record)
                sx = _number(_one(record, 41, 1), "insert X scale")
                sy = _number(_one(record, 42, 1), "insert Y scale")
                angle = math.radians(_number(_one(record, 50, 0), "insert rotation"))
                base, body = self.blocks[block_name]
                cos_a, sin_a = math.cos(angle), math.sin(angle)
                local = (cos_a * sx, sin_a * sx, -sin_a * sy, cos_a * sy,
                         insertion[0] - cos_a * sx * base[0] + sin_a * sy * base[1],
                         insertion[1] - sin_a * sx * base[0] - cos_a * sy * base[1])
                self.consume(body, _matrix_compose(matrix, local), layer, depth + 1, visible)
            else:
                raise ValueError("unsupported DXF entity %s; import aborted to prevent data loss" % kind)
            i += 1


def import_dxf(data: bytes, filename: str, unit_override: Optional[str] = None) -> dict:
    """Import an ASCII DXF into an editable curve-editor v1 document."""
    pairs = _pairs(data)
    sections = _sections(pairs)
    source_unit, factor = _resolve_units(sections.get("HEADER", []), unit_override)
    layer_defs = _layer_table(sections.get("TABLES", []))
    blocks = _parse_blocks(sections.get("BLOCKS", []))
    entity_records = _records(sections["ENTITIES"])
    if len(entity_records) > MAX_ENTITIES:
        raise ValueError("DXF entity limit exceeded")
    importer = _Importer(factor, layer_defs, blocks)
    importer.consume(entity_records)
    if not importer.paths:
        raise ValueError("DXF contains no supported curve geometry")
    used_names = []
    for path in importer.paths:
        if path["_layer"] not in used_names:
            used_names.append(path["_layer"])
    layers = []
    for index, name in enumerate(used_names, 1):
        info = layer_defs[name]
        layers.append({"id": "dxf-layer-%d" % index, "name": name, "visible": info["visible"],
                       "locked": info["locked"],
                       "pathIds": [path["id"] for path in importer.paths if path["_layer"] == name],
                       "imageIds": [], "textIds": []})
    for path in importer.paths:
        del path["_layer"]
    coordinates = [value for path in importer.paths for node in path["nodes"]
                   for point in (node, node["in"], node["out"]) for value in (point["x"], point["y"])]
    extent = max([1.0] + [abs(value) for value in coordinates])
    title = Path(filename or "import.dxf").stem[:200] or "DXF import"
    document = {"format": "daban-curve-editor", "version": 1, "title": title,
                "width": extent, "height": extent, "units": "image-px", "newNodeMode": "cusp",
                "image": None, "opacity": 0.65, "images": [], "texts": [],
                "paths": importer.paths, "layers": layers,
                "calibration": {"a": {"x": 0, "y": 0}, "b": {"x": 1, "y": 0},
                                "length": 1, "unit": "mm"}, "measureUnit": "mm"}
    document["originals"] = copy.deepcopy(document["paths"])
    return {"document": document, "warnings": [], "sourceUnit": source_unit}


def _finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("invalid %s" % label)
    if abs(value) > MAX_COORD:
        raise ValueError("%s exceeds coordinate limit" % label)
    return float(value)


def _calibration_scale(document):
    calibration = document.get("calibration")
    if not isinstance(calibration, dict) or calibration.get("unit") not in ("mm", "cm"):
        raise ValueError("valid mm/cm calibration is required for DXF export")
    a, b = calibration.get("a"), calibration.get("b")
    if not isinstance(a, dict) or not isinstance(b, dict):
        raise ValueError("valid calibration points are required for DXF export")
    ax, ay = _finite(a.get("x"), "calibration X"), _finite(a.get("y"), "calibration Y")
    bx, by = _finite(b.get("x"), "calibration X"), _finite(b.get("y"), "calibration Y")
    pixels = math.hypot(bx - ax, by - ay)
    length = _finite(calibration.get("length"), "calibration length")
    if pixels <= 0 or length <= 0:
        raise ValueError("valid positive calibration is required for DXF export")
    return length * (10 if calibration["unit"] == "cm" else 1) / pixels


def _distance_to_segment(point, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length_squared = dx * dx + dy * dy
    if length_squared == 0:
        return math.hypot(point[0] - a[0], point[1] - a[1])
    t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length_squared
    t = min(1.0, max(0.0, t))
    return math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy))


def _split_cubic(points):
    p0, p1, p2, p3 = points
    mid = lambda a, b: ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    p01, p12, p23 = mid(p0, p1), mid(p1, p2), mid(p2, p3)
    p012, p123 = mid(p01, p12), mid(p12, p23)
    p = mid(p012, p123)
    return (p0, p01, p012, p), (p, p123, p23, p3)


def _flatten(points, tolerance, output, depth=0):
    if len(output) >= MAX_NODES:
        raise ValueError("flattened DXF path exceeds node limit")
    if depth > 24:
        raise ValueError("Bezier flattening limit exceeded")
    if max(_distance_to_segment(points[1], points[0], points[3]),
           _distance_to_segment(points[2], points[0], points[3])) <= tolerance:
        output.append(points[3])
        return
    left, right = _split_cubic(points)
    _flatten(left, tolerance, output, depth + 1)
    _flatten(right, tolerance, output, depth + 1)


def _escape(value):
    result = []
    for char in str(value):
        codepoint = ord(char)
        if 32 <= codepoint < 127 and char != "\\":
            result.append(char)
        elif codepoint <= 0xFFFF:
            result.append("\\U+%04X" % codepoint)
        else:
            # DXF's escape is UTF-16 based for non-BMP characters.
            value16 = codepoint - 0x10000
            result.append("\\U+%04X\\U+%04X" % (0xD800 + (value16 >> 10), 0xDC00 + (value16 & 1023)))
    return "".join(result)


def _format_number(value):
    if abs(value) < 5e-13:
        value = 0.0
    return format(value, ".12g")


def _nearest_aci(color):
    if not isinstance(color, str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", color):
        return 7
    rgb = tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))
    def distance(item):
        candidate = tuple(int(item[1][i:i + 2], 16) for i in (1, 3, 5))
        return sum((a - b) ** 2 for a, b in zip(rgb, candidate))
    return min(ACI_COLORS.items(), key=distance)[0]


def _distinct_layer_names(layers):
    """Return stable, case-insensitively unique DXF names for editor layers."""
    used = set()
    result = {}
    for layer in layers:
        base = layer["name"][:200]
        candidate = base
        suffix_number = 2
        while candidate.casefold() in used:
            suffix = " [%d]" % suffix_number
            candidate = base[:200 - len(suffix)] + suffix
            suffix_number += 1
        used.add(candidate.casefold())
        result[id(layer)] = candidate
    return result


def export_dxf(document: dict, mode: str = "polyline") -> bytes:
    """Export a validated, visible curve-only editor document as R2000 DXF."""
    if not isinstance(document, dict):
        raise ValueError("DXF export document must be an object")
    if mode not in ("polyline", "spline"):
        raise ValueError("DXF 曲线方式无效，请选择折线兼容或保留曲线")
    if document.get("images") or document.get("texts") or document.get("image"):
        raise ValueError("DXF export requires a curve-only document")
    scale = _calibration_scale(document)
    paths, layers = document.get("paths"), document.get("layers")
    if not isinstance(paths, list) or len(paths) > MAX_PATHS:
        raise ValueError("invalid DXF export path count")
    if not isinstance(layers, list) or not 1 <= len(layers) <= MAX_LAYERS:
        raise ValueError("invalid DXF export layers")
    path_by_id = {}
    for path in paths:
        if not isinstance(path, dict) or not isinstance(path.get("id"), str) or path["id"] in path_by_id:
            raise ValueError("invalid or duplicate path id")
        path_by_id[path["id"]] = path
    owner = {}
    for layer in layers:
        if not isinstance(layer, dict) or layer.get("kind", "layer") != "layer":
            raise ValueError("DXF export does not support layer groups")
        name = layer.get("name")
        if not isinstance(name, str) or not name or len(name) > 200:
            raise ValueError("invalid DXF layer name")
        refs = layer.get("pathIds")
        if not isinstance(refs, list):
            raise ValueError("invalid DXF layer path references")
        for path_id in refs:
            if path_id not in path_by_id or path_id in owner:
                raise ValueError("each path must have exactly one valid layer")
            owner[path_id] = layer
    if set(owner) != set(path_by_id):
        raise ValueError("each path must have exactly one valid layer")
    export_layer_names = _distinct_layer_names(layers)

    pairs = [(0, "SECTION"), (2, "HEADER"), (9, "$ACADVER"), (1, "AC1015"),
             (9, "$INSUNITS"), (70, 4), (9, "$MEASUREMENT"), (70, 1), (0, "ENDSEC"),
             (0, "SECTION"), (2, "TABLES"), (0, "TABLE"), (2, "LAYER"),
             (5, "1"), (330, "0"), (100, "AcDbSymbolTable"), (70, len(layers))]
    for layer_index, layer in enumerate(layers):
        color = _nearest_aci(next((path.get("color") for path in paths if path["id"] in layer["pathIds"]), DEFAULT_COLOR))
        if layer.get("visible", True) is False:
            color = -color
        flags = 4 if layer.get("locked", False) else 0
        pairs += [(0, "LAYER"), (5, format(0x10 + layer_index, "X")), (330, "1"),
                  (100, "AcDbSymbolTableRecord"), (100, "AcDbLayerTableRecord"),
                  (2, _escape(export_layer_names[id(layer)])),
                  (70, flags), (62, color), (6, "CONTINUOUS"), (370, -3)]
    pairs += [(0, "ENDTAB"), (0, "ENDSEC"), (0, "SECTION"), (2, "ENTITIES")]

    for path in paths:
        nodes = path.get("nodes")
        if not isinstance(nodes, list) or not 2 <= len(nodes) <= MAX_NODES:
            raise ValueError("DXF export paths require 2-%d nodes" % MAX_NODES)
        closed = bool(path.get("closed", False))
        if closed and len(nodes) > 2:
            first, last = nodes[0], nodes[-1]
            try:
                repeated_end = (float(first.get("x")) == float(last.get("x")) and
                                float(first.get("y")) == float(last.get("y")))
            except (TypeError, ValueError):
                repeated_end = False
            if repeated_end:
                anchor = (first.get("x"), first.get("y"))
                closing_is_zero = (isinstance(first.get("in"), dict) and
                                   isinstance(last.get("out"), dict) and
                                   (first["in"].get("x"), first["in"].get("y")) == anchor and
                                   (last["out"].get("x"), last["out"].get("y")) == anchor)
                # A two-span closed lens needs its repeated third anchor to
                # remain editable in our >=3-node closed-path model.
                if closing_is_zero and not (mode == "spline" and len(nodes) == 3):
                    # The final anchor only terminates the preceding cubic.  Move
                    # that incoming handle to the retained first anchor, without
                    # changing the caller's document.
                    retained_first = copy.deepcopy(first)
                    retained_first["in"] = copy.deepcopy(last.get("in"))
                    nodes = [retained_first] + nodes[1:-1]
        cubics = []
        segment_count = len(nodes) if closed else len(nodes) - 1
        for index in range(segment_count):
            a, b = nodes[index], nodes[(index + 1) % len(nodes)]
            for node in (a, b):
                if not isinstance(node, dict) or not isinstance(node.get("in"), dict) or not isinstance(node.get("out"), dict):
                    raise ValueError("invalid editor node")
            source = ((a.get("x"), a.get("y")), (a["out"].get("x"), a["out"].get("y")),
                      (b["in"].get("x"), b["in"].get("y")), (b.get("x"), b.get("y")))
            cubic = []
            for x, y in source:
                x, y = _finite(x, "path X"), _finite(y, "path Y")
                cubic.append((x * scale, -y * scale))
            cubics.append(tuple(cubic))
        layer = owner[path["id"]]
        attributes = [(100, "AcDbEntity"), (8, _escape(export_layer_names[id(layer)])),
                      (62, _nearest_aci(path.get("color")))]
        if mode == "spline" and any(c[1] != c[0] or c[2] != c[3] for c in cubics):
            if closed and len(nodes) < 3:
                raise ValueError("closed DXF paths require at least three nodes")
            # A cubic Bezier chain is exactly a clamped degree-3 B-spline with
            # triple interior knots. Preserve the closing span, including loops.
            controls = [cubics[0][0]] + [point for cubic in cubics for point in cubic[1:]]
            knots = [0] * 4 + [i for i in range(1, segment_count) for _ in range(3)] + [segment_count] * 4
            pairs += [(0, "SPLINE")] + attributes + [(100, "AcDbSpline"),
                      (210, 0), (220, 0), (230, 1), (70, 9 if closed else 8), (71, 3),
                      (72, len(knots)), (73, len(controls)), (74, 0)]
            pairs += [(40, knot) for knot in knots]
            for x, y in controls:
                pairs += [(10, _format_number(x)), (20, _format_number(y)), (30, 0)]
            continue
        points = [cubics[0][0]]
        for cubic in cubics:
            if cubic[1] == cubic[0] and cubic[2] == cubic[3]:
                points.append(cubic[3])
            else:
                _flatten(tuple(cubic), CURVE_TOLERANCE_MM, points)
            if len(points) > MAX_NODES:
                raise ValueError("flattened DXF path exceeds node limit")
        if closed and len(points) > 1 and math.hypot(points[-1][0] - points[0][0], points[-1][1] - points[0][1]) <= 1e-10:
            points.pop()
        if len(points) < (3 if closed else 2):
            raise ValueError("DXF export path has insufficient distinct vertices")
        pairs += [(0, "LWPOLYLINE")] + attributes + [
                  (100, "AcDbPolyline"), (90, len(points)), (70, 1 if closed else 0)]
        for x, y in points:
            pairs += [(10, _format_number(x)), (20, _format_number(y))]
    pairs += [(0, "ENDSEC"), (0, "EOF")]
    return ("\n".join(str(value) for pair in pairs for value in pair) + "\n").encode("ascii")


__all__ = ["MissingUnitsError", "import_dxf", "export_dxf"]
