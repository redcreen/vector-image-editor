"""Convert editable text records to cubic editor paths with macOS CoreText.

The source text record is never changed. CoreText performs shaping and font
fallback; CoreGraphics then exposes each glyph's native outline.
"""
from functools import lru_cache
import ctypes
import ctypes.util
import math
import re
import sys
import unicodedata


MAX_CONTENT_LENGTH = 10_000
MAX_PATHS = 500
MAX_NODES = 100_000
_UTF8 = 0x08000100
_BROWSER_SANS_FONT = "PingFangSC-Regular"


class _CGPoint(ctypes.Structure):
    _fields_ = (("x", ctypes.c_double), ("y", ctypes.c_double))


class _CGAffineTransform(ctypes.Structure):
    _fields_ = tuple((name, ctypes.c_double) for name in ("a", "b", "c", "d", "tx", "ty"))


class _CFRange(ctypes.Structure):
    _fields_ = (("location", ctypes.c_long), ("length", ctypes.c_long))


class _CGPathElement(ctypes.Structure):
    _fields_ = (("type", ctypes.c_int), ("points", ctypes.POINTER(_CGPoint)))


_PathCallback = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.POINTER(_CGPathElement))


class _Bindings:
    def __init__(self):
        try:
            cf_path = ctypes.util.find_library("CoreFoundation")
            ct_path = ctypes.util.find_library("CoreText")
            cg_path = ctypes.util.find_library("CoreGraphics")
            if not cf_path or not ct_path or not cg_path:
                raise OSError("framework not found")
            self.cf = ctypes.CDLL(cf_path)
            self.ct = ctypes.CDLL(ct_path)
            self.cg = ctypes.CDLL(cg_path)
        except (OSError, TypeError) as exc:
            raise ValueError("文字转曲仅支持带 CoreText 的 macOS") from exc

        pointer = ctypes.c_void_p
        index = ctypes.c_long
        self.cf.CFRelease.argtypes = [pointer]
        self.cf.CFStringCreateWithBytes.argtypes = [pointer, ctypes.c_char_p, index,
                                                    ctypes.c_uint32, ctypes.c_bool]
        self.cf.CFStringCreateWithBytes.restype = pointer
        self.cf.CFStringGetCString.argtypes = [pointer, ctypes.c_char_p, index,
                                              ctypes.c_uint32]
        self.cf.CFStringGetCString.restype = ctypes.c_bool
        self.cf.CFDictionaryCreate.argtypes = [pointer, ctypes.POINTER(pointer),
                                               ctypes.POINTER(pointer), index,
                                               pointer, pointer]
        self.cf.CFDictionaryCreate.restype = pointer
        self.cf.CFDictionaryGetValue.argtypes = [pointer, pointer]
        self.cf.CFDictionaryGetValue.restype = pointer
        self.cf.CFAttributedStringCreate.argtypes = [pointer, pointer, pointer]
        self.cf.CFAttributedStringCreate.restype = pointer
        self.cf.CFArrayGetCount.argtypes = [pointer]
        self.cf.CFArrayGetCount.restype = index
        self.cf.CFArrayGetValueAtIndex.argtypes = [pointer, index]
        self.cf.CFArrayGetValueAtIndex.restype = pointer

        self.ct.CTFontCreateWithName.argtypes = [pointer, ctypes.c_double,
                                                ctypes.POINTER(_CGAffineTransform)]
        self.ct.CTFontCreateWithName.restype = pointer
        self.ct.CTFontCreateForString.argtypes = [pointer, pointer, _CFRange]
        self.ct.CTFontCreateForString.restype = pointer
        self.ct.CTFontGetGlyphsForCharacters.argtypes = [pointer,
                                                         ctypes.POINTER(ctypes.c_uint16),
                                                         ctypes.POINTER(ctypes.c_uint16), index]
        self.ct.CTFontGetGlyphsForCharacters.restype = ctypes.c_bool
        self.ct.CTFontCopyPostScriptName.argtypes = [pointer]
        self.ct.CTFontCopyPostScriptName.restype = pointer
        self.ct.CTLineCreateWithAttributedString.argtypes = [pointer]
        self.ct.CTLineCreateWithAttributedString.restype = pointer
        self.ct.CTLineGetGlyphRuns.argtypes = [pointer]
        self.ct.CTLineGetGlyphRuns.restype = pointer
        self.ct.CTRunGetGlyphCount.argtypes = [pointer]
        self.ct.CTRunGetGlyphCount.restype = index
        self.ct.CTRunGetGlyphs.argtypes = [pointer, _CFRange,
                                          ctypes.POINTER(ctypes.c_uint16)]
        self.ct.CTRunGetPositions.argtypes = [pointer, _CFRange,
                                             ctypes.POINTER(_CGPoint)]
        self.ct.CTRunGetStringIndices.argtypes = [pointer, _CFRange,
                                                 ctypes.POINTER(index)]
        self.ct.CTRunGetAttributes.argtypes = [pointer]
        self.ct.CTRunGetAttributes.restype = pointer
        self.ct.CTFontCreatePathForGlyph.argtypes = [pointer, ctypes.c_uint16,
                                                    ctypes.POINTER(_CGAffineTransform)]
        self.ct.CTFontCreatePathForGlyph.restype = pointer
        self.cg.CGPathApply.argtypes = [pointer, pointer, _PathCallback]
        self.font_attribute = ctypes.c_void_p.in_dll(
            self.ct, "kCTFontAttributeName").value

    def string(self, value):
        raw = value.encode("utf-8")
        result = self.cf.CFStringCreateWithBytes(None, raw, len(raw), _UTF8, False)
        if not result:
            raise ValueError("无法创建文字数据")
        return result


@lru_cache(maxsize=1)
def _bindings():
    if sys.platform != "darwin":
        raise ValueError("文字转曲仅支持带 CoreText 的 macOS")
    return _Bindings()


def _node(x, y):
    return {"x": x, "y": y, "in": {"x": x, "y": y},
            "out": {"x": x, "y": y}, "mode": "cusp"}


def _contours(path, offset_x, offset_y):
    """Read a CGPath and return immutable cubic contours in font coordinates."""
    contours = []
    current = None
    closed = False
    error = []

    def finish():
        nonlocal current, closed
        if current:
            if len(current) >= 2:
                contours.append(tuple((n["x"], n["y"], n["in"]["x"], n["in"]["y"],
                                       n["out"]["x"], n["out"]["y"]) for n in current))
            current = None
            closed = False

    def callback(info, element_pointer):
        nonlocal current, closed
        try:
            element = element_pointer.contents
            kind = element.type
            values = element.points
            if kind == 0:  # move
                finish()
                point = values[0]
                current = [_node(point.x + offset_x, point.y + offset_y)]
            elif kind == 1 and current:  # line
                point = values[0]
                current.append(_node(point.x + offset_x, point.y + offset_y))
            elif kind == 2 and current:  # quadratic -> exact cubic
                control, endpoint = values[0], values[1]
                start = current[-1]
                qx, qy = control.x + offset_x, control.y + offset_y
                ex, ey = endpoint.x + offset_x, endpoint.y + offset_y
                start["out"] = {"x": start["x"] + (qx - start["x"]) * 2 / 3,
                                "y": start["y"] + (qy - start["y"]) * 2 / 3}
                node = _node(ex, ey)
                node["in"] = {"x": ex + (qx - ex) * 2 / 3,
                              "y": ey + (qy - ey) * 2 / 3}
                current.append(node)
            elif kind == 3 and current:  # cubic
                first, second, endpoint = values[0], values[1], values[2]
                current[-1]["out"] = {"x": first.x + offset_x, "y": first.y + offset_y}
                node = _node(endpoint.x + offset_x, endpoint.y + offset_y)
                node["in"] = {"x": second.x + offset_x, "y": second.y + offset_y}
                current.append(node)
            elif kind == 4 and current:  # close
                closed = True
                finish()
        except Exception as exc:  # ctypes callbacks cannot propagate exceptions
            error.append(exc)

    native_callback = _PathCallback(callback)
    _bindings().cg.CGPathApply(path, None, native_callback)
    if error:
        raise ValueError("无法读取字形轮廓") from error[0]
    finish()
    return contours


def _utf16_character(text, offset):
    if offset < 0:
        return ""
    position = 0
    for character in text:
        width = 2 if ord(character) > 0xFFFF else 1
        if position <= offset < position + width:
            return character
        position += width
    return ""


def _pathless_allowed(character):
    if not character or character.isspace():
        return True
    return unicodedata.category(character) in ("Cc", "Cf", "Mn", "Me")


def _ensure_visible_characters(api, font, string, line):
    """Reject CoreText's replacement glyph when no fallback has the source scalar."""
    utf16_offset = 0
    for character in line:
        encoded = character.encode("utf-16-le")
        width = len(encoded) // 2
        if not _pathless_allowed(character):
            if unicodedata.category(character) == "Cn":
                raise ValueError(f"系统字体缺少可见字形：{character!r}")
            fallback = api.ct.CTFontCreateForString(
                font, string, _CFRange(utf16_offset, width))
            if not fallback:
                raise ValueError(f"系统字体缺少可见字形：{character!r}")
            try:
                units = (ctypes.c_uint16 * width).from_buffer_copy(encoded)
                glyphs = (ctypes.c_uint16 * width)()
                if not api.ct.CTFontGetGlyphsForCharacters(
                        fallback, units, glyphs, width) or not any(glyphs):
                    raise ValueError(f"系统字体缺少可见字形：{character!r}")
                postscript_name = api.ct.CTFontCopyPostScriptName(fallback)
                if postscript_name:
                    try:
                        buffer = ctypes.create_string_buffer(256)
                        if api.cf.CFStringGetCString(postscript_name, buffer, len(buffer), _UTF8):
                            name = buffer.value.decode("utf-8", "replace").lower()
                            if "lastresort" in name:
                                raise ValueError(f"系统字体缺少可见字形：{character!r}")
                    finally:
                        api.cf.CFRelease(postscript_name)
            finally:
                api.cf.CFRelease(fallback)
        utf16_offset += width


def _shape_line(line):
    if not line:
        return ()
    api = _bindings()
    string = font_name = font = attributes = attributed = shaped = None
    contours = []
    try:
        string = api.string(line)
        # Chrome resolves sans-serif to this PostScript face for the editor's
        # zh-CN document. The explicit face also keeps Latin/digit advances in
        # lockstep with the browser; CoreText supplies other fallback runs.
        font_name = api.string(_BROWSER_SANS_FONT)
        font = api.ct.CTFontCreateWithName(font_name, 1.0, None)
        if not font:
            raise ValueError("无法加载系统无衬线字体")
        _ensure_visible_characters(api, font, string, line)
        keys = (ctypes.c_void_p * 1)(api.font_attribute)
        values = (ctypes.c_void_p * 1)(font)
        attributes = api.cf.CFDictionaryCreate(None, keys, values, 1, None, None)
        attributed = api.cf.CFAttributedStringCreate(None, string, attributes)
        shaped = api.ct.CTLineCreateWithAttributedString(attributed)
        if not attributes or not attributed or not shaped:
            raise ValueError("无法排版文字")
        runs = api.ct.CTLineGetGlyphRuns(shaped)
        for run_index in range(api.cf.CFArrayGetCount(runs)):
            run = api.cf.CFArrayGetValueAtIndex(runs, run_index)
            count = api.ct.CTRunGetGlyphCount(run)
            if count <= 0:
                continue
            glyphs = (ctypes.c_uint16 * count)()
            positions = (_CGPoint * count)()
            indices = (ctypes.c_long * count)()
            entire_run = _CFRange(0, 0)
            api.ct.CTRunGetGlyphs(run, entire_run, glyphs)
            api.ct.CTRunGetPositions(run, entire_run, positions)
            api.ct.CTRunGetStringIndices(run, entire_run, indices)
            run_attributes = api.ct.CTRunGetAttributes(run)
            run_font = api.cf.CFDictionaryGetValue(run_attributes, api.font_attribute)
            if not run_font:
                raise ValueError("无法读取回退字体")
            for index in range(count):
                character = _utf16_character(line, indices[index])
                if glyphs[index] == 0 and not _pathless_allowed(character):
                    raise ValueError(f"系统字体缺少可见字形：{character!r}")
                glyph_path = api.ct.CTFontCreatePathForGlyph(run_font, glyphs[index], None)
                if not glyph_path:
                    if not _pathless_allowed(character):
                        raise ValueError(f"系统字体无法转出可见字形：{character!r}")
                    continue
                try:
                    contours.extend(_contours(glyph_path, positions[index].x,
                                              positions[index].y))
                    if len(contours) > MAX_PATHS or sum(map(len, contours)) > MAX_NODES:
                        raise ValueError("文字转曲结果超过导出上限")
                finally:
                    api.cf.CFRelease(glyph_path)
        return tuple(contours)
    finally:
        for value in (shaped, attributed, attributes, font, font_name, string):
            if value:
                api.cf.CFRelease(value)


@lru_cache(maxsize=256)
def _shape_short_line(line):
    return _shape_line(line)


def _line_contours(line):
    return _shape_short_line(line) if len(line) <= 256 else _shape_line(line)


def _number(value, *, positive=False):
    valid = type(value) in (int, float) and math.isfinite(value) and abs(value) <= 10_000_000
    return valid and (not positive or value > 0)


def _validate(text):
    if sys.platform != "darwin":
        raise ValueError("文字转曲仅支持带 CoreText 的 macOS")
    if not isinstance(text, dict):
        raise ValueError("文字数据无效")
    if (not isinstance(text.get("id"), str) or not text["id"].strip()
            or len(text["id"]) > 200
            or not isinstance(text.get("name"), str) or len(text["name"]) > 80
            or not isinstance(text.get("content"), str)
            or len(text["content"]) > MAX_CONTENT_LENGTH
            or not _number(text.get("x")) or not _number(text.get("y"))
            or not _number(text.get("fontSize"), positive=True) or text["fontSize"] > 4096
            or not _number(text.get("rotation", 0))
            or not isinstance(text.get("color"), str)
            or not re.fullmatch(r"#[0-9a-fA-F]{6}", text["color"])):
        raise ValueError("文字数据无效")
    marker = text.get("positionMarker")
    if marker is not None and (not isinstance(marker, dict)
                               or not _number(marker.get("x"))
                               or not _number(marker.get("y"))):
        raise ValueError("标注点位置无效")


def _transform(point, text, baseline):
    # CoreText is Y-up; editor/SVG coordinates are Y-down.
    px = text["x"] + point[0] * text["fontSize"]
    py = baseline - point[1] * text["fontSize"]
    angle = math.radians(text.get("rotation", 0))
    cosine, sine = math.cos(angle), math.sin(angle)
    dx, dy = px - text["x"], py - text["y"]
    return (text["x"] + cosine * dx - sine * dy,
            text["y"] + sine * dx + cosine * dy)


def _outline_path(text, identifier, contour, baseline):
    nodes = []
    for x, y, ix, iy, ox, oy in contour:
        anchor = _transform((x, y), text, baseline)
        incoming = _transform((ix, iy), text, baseline)
        outgoing = _transform((ox, oy), text, baseline)
        nodes.append({"x": anchor[0], "y": anchor[1],
                      "in": {"x": incoming[0], "y": incoming[1]},
                      "out": {"x": outgoing[0], "y": outgoing[1]},
                      "mode": "cusp"})
    return {"id": identifier, "name": text["name"], "color": text["color"],
            "role": "outline", "closed": True, "nodes": nodes}


def _marker_paths(text, first_index):
    marker = text.get("positionMarker")
    if marker is None:
        return []
    radius = text["fontSize"] * 0.16
    handle = radius * 4 * (math.sqrt(2) - 1) / 3
    x, y = marker["x"], marker["y"]
    anchors = ((x + radius, y), (x, y + radius),
               (x - radius, y), (x, y - radius))
    circle = [_node(*point) for point in anchors]
    circle[0]["in"] = {"x": x + radius, "y": y - handle}
    circle[0]["out"] = {"x": x + radius, "y": y + handle}
    circle[1]["in"] = {"x": x + handle, "y": y + radius}
    circle[1]["out"] = {"x": x - handle, "y": y + radius}
    circle[2]["in"] = {"x": x - radius, "y": y + handle}
    circle[2]["out"] = {"x": x - radius, "y": y - handle}
    circle[3]["in"] = {"x": x - handle, "y": y - radius}
    circle[3]["out"] = {"x": x + handle, "y": y - radius}
    angle = math.radians(text.get("rotation", 0))
    offset = text["fontSize"] * 0.6
    leader_end = (text["x"] - math.sin(angle) * offset,
                  text["y"] + math.cos(angle) * offset)
    prefix = f"{text['id']}-text-outline"
    common = {"name": text["name"], "color": text["color"], "role": "outline"}
    return [
        {"id": f"{prefix}-{first_index}", **common, "closed": True, "nodes": circle},
        {"id": f"{prefix}-{first_index + 1}", **common, "closed": False,
         "nodes": [_node(x, y), _node(*leader_end)]},
    ]


def outline_text(text):
    """Return cubic editor paths for one text record and its optional marker."""
    _validate(text)
    paths = []
    normalized = text["content"].replace("\r\n", "\n").replace("\r", "\n")
    for line_index, line in enumerate(normalized.split("\n")):
        baseline = text["y"] + text["fontSize"] * (1 + line_index * 1.2)
        for contour in _line_contours(line):
            paths.append(_outline_path(
                text, f"{text['id']}-text-outline-{len(paths)}", contour, baseline))
            if len(paths) > MAX_PATHS or sum(len(path["nodes"]) for path in paths) > MAX_NODES:
                raise ValueError("文字转曲结果超过导出上限")
    marker_paths = _marker_paths(text, len(paths))
    if len(paths) + len(marker_paths) > MAX_PATHS:
        raise ValueError("文字转曲结果超过导出上限")
    return paths + marker_paths

