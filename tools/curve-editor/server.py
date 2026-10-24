#!/usr/bin/env python3
"""Loopback-only curve editor. Versioned saves stay inside this project."""
import argparse
import copy
import fcntl
import hashlib
import json
import math
import os
import re
import secrets
import threading
import time
import uuid
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import build_opener, ProxyHandler
from xml.sax.saxutils import escape, quoteattr
import editor_registry as registry
import vector_dimension
import vector_io
import native_image_clipboard

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[1]
SAVES = PROJECT / "work/curve_editor/sessions"
WORKSPACE = {"mode": "shared", "id": "default"}
EDITOR = {}
EDITION = "official"
INSTANCE = str(uuid.uuid4())
MANAGE_TOKEN = secrets.token_urlsafe(32)
LOOPBACK_HTTP = build_opener(ProxyHandler({}))
MAX_BODY = 32 * 1024 * 1024
ALLOWED = {"/": ("index.html", "text/html; charset=utf-8"), "/index.html": ("index.html", "text/html; charset=utf-8"), "/style.css": ("style.css", "text/css"), "/app.js": ("app.js", "text/javascript"), "/geometry.js": ("geometry.js", "text/javascript"), "/interactions.js": ("interactions.js", "text/javascript"), "/layers.js": ("layers.js", "text/javascript"), "/tracing.js": ("tracing.js", "text/javascript")}
ALLOWED.update({"/offset.js": ("offset.js", "text/javascript"), "/vendor/clipper.js": ("vendor/clipper.js", "text/javascript")})
ALLOWED["/offset-fit.js"] = ("offset-fit.js", "text/javascript")
ALLOWED["/editor-session.js"] = ("editor-session.js", "text/javascript")
ALLOWED["/simplify.js"] = ("simplify.js", "text/javascript")
ALLOWED["/fairing.js"] = ("fairing.js", "text/javascript")
ALLOWED["/walk.js"] = ("walk.js", "text/javascript")
ALLOWED["/bend.js"] = ("bend.js", "text/javascript")
ALLOWED["/fitting-range.js"] = ("fitting-range.js", "text/javascript")
ALLOWED["/fitting.js"] = ("fitting.js", "text/javascript")
ALLOWED["/notches.js"] = ("notches.js", "text/javascript")
ALLOWED["/text.js"] = ("text.js", "text/javascript")
ALLOWED["/dimension.js"] = ("dimension.js", "text/javascript")
ALLOWED["/image-metadata.js"] = ("image-metadata.js", "text/javascript")
ALLOWED["/vector-files.js"] = ("vector-files.js", "text/javascript")
ALLOWED["/image-region.js"] = ("image-region.js", "text/javascript")
ALLOWED["/printing.js"] = ("printing.js", "text/javascript")
ALLOWED["/symmetry.js"] = ("symmetry.js", "text/javascript")


def static_files():
    """Capture one coherent browser bundle for the lifetime of this process."""
    return {name: (ROOT / name).read_bytes() for name, _ in set(ALLOWED.values())}


STATIC_FILES = static_files()


def editor_revision():
    """Fingerprint backend and browser assets so stale services are not reused."""
    digest = hashlib.sha256()
    names = set(STATIC_FILES)
    names.add(Path(__file__).name)
    names.add('editor_registry.py')
    names.add('native_image_clipboard.py')
    if (ROOT / 'native-image-clipboard.swift').is_file():
        names.add('native-image-clipboard.swift')
    names.update(path.name for path in ROOT.glob("vector_*.py"))
    names.update(str(path.relative_to(ROOT)) for path in (ROOT / "vendor/python").rglob("*.py"))
    for name in sorted(names):
        digest.update(name.encode("utf-8"))
        digest.update(STATIC_FILES[name] if name in STATIC_FILES else (ROOT / name).read_bytes())
    return "editor-" + digest.hexdigest()[:16]


EDITOR_REVISION = editor_revision()
IMAGE_DATA_URL = re.compile(r"data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+")
EDITOR_TOOLS = {"node", "select", "pen", "rectangle", "ellipse", "pan", "axis", "measure", "calibrate", "trace", "outline", "text", "position", "dimension"}


def number(v, limit=1e7):
    return type(v) in (int, float) and math.isfinite(v) and abs(v) <= limit


def text_lines(text):
    return re.sub(r"\r\n?", "\n", text["content"]).split("\n")


def validate_editor_state(state, snapshot=False):
    if not isinstance(state, dict):
        raise ValueError("编辑状态无效")
    required = {"selected", "ni", "selection", "imageSelection", "activeLayer", "nodeSelection", "drawing", "tool"}
    if not required.issubset(state) or (snapshot and "doc" not in state) or (not snapshot and "doc" in state):
        raise ValueError("编辑状态无效")
    if state["selected"] is not None and not isinstance(state["selected"], str):
        raise ValueError("编辑状态无效")
    if state["activeLayer"] is not None and not isinstance(state["activeLayer"], str):
        raise ValueError("编辑状态无效")
    if state["ni"] is not None and (type(state["ni"]) is not int or not 0 <= state["ni"] <= 10000):
        raise ValueError("编辑状态无效")
    if (not isinstance(state["selection"], list)
            or not all(isinstance(value, str) for value in state["selection"])
            or not isinstance(state["imageSelection"], list)
            or not all(isinstance(value, str) for value in state["imageSelection"])
            or not isinstance(state.get("textSelection", []), list)
            or not all(isinstance(value, str) for value in state.get("textSelection", []))
            or not isinstance(state.get("layerSelection", []), list)
            or not all(isinstance(value, str) for value in state.get("layerSelection", []))
            or not isinstance(state["nodeSelection"], list)):
        raise ValueError("编辑状态无效")
    for node in state["nodeSelection"]:
        if (not isinstance(node, dict) or not isinstance(node.get("pathId"), str)
                or type(node.get("index")) is not int or not 0 <= node["index"] <= 10000):
            raise ValueError("编辑状态无效")
    if type(state["drawing"]) is not bool or state["tool"] not in EDITOR_TOOLS:
        raise ValueError("编辑状态无效")


def unpack_history_document(document, assets):
    if not isinstance(document, dict) or "operationHistory" in document:
        raise ValueError("历史快照文件无效")
    unpacked = copy.deepcopy(document)
    images = []
    if unpacked.get("image") is not None:
        images.append(unpacked["image"])
    if isinstance(unpacked.get("images"), list):
        images.extend(unpacked["images"])
    for image in images:
        if not isinstance(image, dict):
            raise ValueError("历史快照图片无效")
        reference = image.get("dataUrl")
        if (not isinstance(reference, dict) or set(reference) != {"asset"}
                or type(reference["asset"]) is not int
                or not 0 <= reference["asset"] < len(assets)):
            raise ValueError("历史快照图片引用无效")
        image["dataUrl"] = assets[reference["asset"]]
    return unpacked


def validate_operation_history(operation_history):
    if (not isinstance(operation_history, dict)
            or operation_history.get("format") != "curve-editor-session"
            or operation_history.get("version") != 1
            or not isinstance(operation_history.get("assets"), list)
            or not isinstance(operation_history.get("data"), dict)):
        raise ValueError("操作记录格式无效")
    assets = operation_history["assets"]
    if (not all(isinstance(value, str) and IMAGE_DATA_URL.fullmatch(value) for value in assets)
            or len(set(assets)) != len(assets)):
        raise ValueError("操作记录图片无效")
    session = operation_history["data"]
    if not isinstance(session.get("current"), dict) or not isinstance(session.get("history"), dict):
        raise ValueError("操作记录数据无效")
    validate_editor_state(session["current"])
    history = session["history"]
    if history.get("version") != 1:
        raise ValueError("操作记录版本无效")
    keys = ("past", "future", "pastLabels", "futureLabels")
    if not all(isinstance(history.get(key), list) for key in keys):
        raise ValueError("操作记录数据无效")
    if len(history["past"]) + len(history["future"]) > 100:
        raise ValueError("操作记录数量无效")
    if len(history["past"]) != len(history["pastLabels"]) or len(history["future"]) != len(history["futureLabels"]):
        raise ValueError("操作记录标签无效")
    if not all(isinstance(label, str) and len(label) <= 200 for label in history["pastLabels"] + history["futureLabels"]):
        raise ValueError("操作记录标签无效")
    for snapshot in history["past"] + history["future"]:
        validate_editor_state(snapshot, snapshot=True)
        validate(unpack_history_document(snapshot["doc"], assets), allow_operation_history=False)


def validate(data, allow_operation_history=True):
    if not isinstance(data, dict) or data.get("format") != "daban-curve-editor" or data.get("version") != 1 or data.get("units") != "image-px":
        raise ValueError("修改文件格式无效")
    for k in ("width", "height"):
        if not number(data.get(k), 30000) or data[k] < 1:
            raise ValueError("画板尺寸无效")
    if not isinstance(data.get("paths"), list) or len(data["paths"]) > 500:
        raise ValueError("曲线数量无效")
    if "mirrorAxisVisible" in data and type(data["mirrorAxisVisible"]) is not bool:
        raise ValueError("对称轴显示状态无效")
    links = data.get("symmetryLinks", [])
    if not isinstance(links, list) or len(links) > 500:
        raise ValueError("对称关联数量无效")
    link_ids = set()
    for link in links:
        if (not isinstance(link, dict) or not isinstance(link.get("id"), str)
                or not 1 <= len(link["id"]) <= 80 or link["id"] in link_ids):
            raise ValueError("对称关联标识无效")
        link_ids.add(link["id"])
        linked_axis = link.get("axis")
        if (not isinstance(linked_axis, dict)
                or any(not isinstance(linked_axis.get(k), dict) or not number(linked_axis[k].get("x")) or not number(linked_axis[k].get("y")) for k in ("a", "b"))
                or math.hypot(linked_axis["a"]["x"] - linked_axis["b"]["x"], linked_axis["a"]["y"] - linked_axis["b"]["y"]) < 1e-6):
            raise ValueError("关联对称轴无效")
    axis = data.get("mirrorAxis")
    if axis is not None:
        if not isinstance(axis, dict) or any(not isinstance(axis.get(k), dict) or not number(axis[k].get("x")) or not number(axis[k].get("y")) for k in ("a", "b")):
            raise ValueError("对称轴坐标无效")
        if math.hypot(axis["a"]["x"] - axis["b"]["x"], axis["a"]["y"] - axis["b"]["y"]) < 1e-6:
            raise ValueError("对称轴两点不能重合")
    calibration = data.get("calibration")
    if calibration is not None:
        if not isinstance(calibration, dict):
            raise ValueError("物理标定无效")
        points = []
        for key in ("a", "b"):
            point = calibration.get(key)
            if not isinstance(point, dict) or not number(point.get("x")) or not number(point.get("y")):
                raise ValueError("物理标定坐标无效")
            points.append(point)
        length = calibration.get("length")
        unit = calibration.get("unit")
        if not number(length) or length <= 0 or unit not in ("mm", "cm"):
            raise ValueError("物理标定长度或单位无效")
        pixels = math.hypot(points[0]["x"] - points[1]["x"], points[0]["y"] - points[1]["y"])
        if pixels < 1e-6:
            raise ValueError("物理标定两点不能重合")
        millimeters_per_pixel = length * (10 if unit == "cm" else 1) / pixels
        if not math.isfinite(millimeters_per_pixel) or millimeters_per_pixel <= 0:
            raise ValueError("物理标定比例无效")
    if "measureUnit" in data and data["measureUnit"] not in ("mm", "cm"):
        raise ValueError("测量显示单位无效")
    ids = set()
    for p in data["paths"]:
        if not isinstance(p, dict) or not isinstance(p.get("id"), str) or p["id"] in ids:
            raise ValueError("曲线标识无效")
        ids.add(p["id"])
        if not isinstance(p.get("nodes"), list) or len(p["nodes"]) > 10000:
            raise ValueError("节点数量无效")
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", p.get("color", "")):
            raise ValueError("线色无效")
        if "dashed" in p and type(p["dashed"]) is not bool:
            raise ValueError("虚线标记无效")
        if "sourceImageId" in p and (not isinstance(p["sourceImageId"], str) or not 1 <= len(p["sourceImageId"]) <= 80):
            raise ValueError("轮廓来源图片无效")
        if "visible" in p and type(p["visible"]) is not bool:
            raise ValueError("曲线可见性无效")
        for n in p["nodes"]:
            if not isinstance(n, dict):
                raise ValueError("节点无效")
            if "symmetry" in n:
                tags = n["symmetry"]
                if not isinstance(tags, dict) or any(key not in ("in", "out") for key in tags):
                    raise ValueError("对称关联标记无效")
                for tag in tags.values():
                    if (not isinstance(tag, dict) or not isinstance(tag.get("id"), str)
                            or not 1 <= len(tag["id"]) <= 80
                            or type(tag.get("side")) is not int or tag["side"] not in (0, 1)
                            or type(tag.get("dir", 1)) is not int or tag.get("dir", 1) not in (-1, 1)):
                        raise ValueError("对称关联标记无效")
            if "notchId" in n and (not isinstance(n["notchId"], str) or not 1 <= len(n["notchId"]) <= 80):
                raise ValueError("剪口标记无效")
            if "color" in n and (not isinstance(n["color"], str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", n["color"])):
                raise ValueError("节点颜色无效")
            for v in (n, n.get("in"), n.get("out")):
                if not isinstance(v, dict) or not number(v.get("x")) or not number(v.get("y")):
                    raise ValueError("节点坐标无效")
    texts = data.get("texts", [])
    if not isinstance(texts, list) or len(texts) > 500:
        raise ValueError("文字数量无效")
    text_ids = set()
    for item in texts:
        if (not isinstance(item, dict)
                or not isinstance(item.get("id"), str) or not item["id"].strip() or len(item["id"]) > 200 or item["id"] in text_ids
                or not isinstance(item.get("name"), str) or len(item["name"]) > 80
                or not isinstance(item.get("content"), str) or not item["content"].strip() or len(item["content"]) > 10000
                or not number(item.get("x")) or not number(item.get("y"))
                or not number(item.get("fontSize"), 4096) or item["fontSize"] < 1
                or ("rotation" in item and not number(item["rotation"]))
                or not isinstance(item.get("color"), str)
                or not re.fullmatch(r"#[0-9a-fA-F]{6}", item["color"])):
            raise ValueError("文字数据无效")
        if "positionMarker" in item:
            marker = item["positionMarker"]
            attachment = marker.get("attachment") if isinstance(marker, dict) else None
            attachment_invalid = False
            if isinstance(marker, dict) and "attachment" in marker:
                attachment_invalid = (
                    "pathId" not in marker
                    or not isinstance(attachment, dict)
                    or attachment.get("kind") not in ("node", "segment")
                    or type(attachment.get("index")) is not int
                    or not 0 <= attachment["index"] < 10000
                    or (attachment["kind"] == "segment"
                        and (not number(attachment.get("t"), 1) or attachment["t"] < 0))
                )
            if (not isinstance(marker, dict)
                    or not number(marker.get("x"))
                    or not number(marker.get("y"))
                    or ("pathId" in marker and (not isinstance(marker["pathId"], str)
                                                  or not marker["pathId"].strip()
                                                  or len(marker["pathId"]) > 200))
                    or attachment_invalid
                    or not re.fullmatch(r"[A-Za-z0-9]{1,32}", item["content"])):
                raise ValueError("位置标注数据无效")
        if "dimension" in item:
            vector_dimension.check_dimension(item)
        text_ids.add(item["id"])
    image = data.get("image")
    if image is not None and (not isinstance(image, dict) or not isinstance(image.get("name"), str) or not isinstance(image.get("dataUrl"), str) or not IMAGE_DATA_URL.fullmatch(image["dataUrl"])):
        raise ValueError("底图格式无效")
    if "layers" in data or "images" in data or texts:
        layers, images = data.get("layers"), data.get("images")
        if not isinstance(layers, list) or not 1 <= len(layers) <= 200:
            raise ValueError("图层数量无效")
        if not isinstance(images, list) or len(images) > 200:
            raise ValueError("图片数量无效")

        image_ids = set()
        for item in images:
            if (not isinstance(item, dict)
                    or not isinstance(item.get("id"), str) or not item["id"].strip() or len(item["id"]) > 200 or item["id"] in image_ids
                    or not isinstance(item.get("name"), str)
                    or not isinstance(item.get("dataUrl"), str)
                    or not IMAGE_DATA_URL.fullmatch(item["dataUrl"])
                    or not number(item.get("x")) or not number(item.get("y"))
                    or not number(item.get("width")) or item["width"] <= 0
                    or not number(item.get("height")) or item["height"] <= 0
                    or ("rotation" in item and not number(item["rotation"]))
                    or not number(item.get("opacity"), 1) or item["opacity"] < 0):
                raise ValueError("图片数据无效")
            image_ids.add(item["id"])

        layer_ids = set()
        layers_by_id = {}
        path_references, image_references, text_references = [], [], []
        for layer in layers:
            layer_text_ids = layer.get("textIds", []) if isinstance(layer, dict) else None
            kind = layer.get("kind", "layer") if isinstance(layer, dict) else None
            parent_id = layer.get("parentId") if isinstance(layer, dict) else None
            if (not isinstance(layer, dict)
                    or not isinstance(layer.get("id"), str) or not layer["id"].strip() or len(layer["id"]) > 200 or layer["id"] in layer_ids
                    or not isinstance(layer.get("name"), str)
                    or kind not in ("layer", "group")
                    or (parent_id is not None and (not isinstance(parent_id, str) or not parent_id.strip() or len(parent_id) > 200))
                    or ("collapsed" in layer and type(layer["collapsed"]) is not bool)
                    or type(layer.get("visible")) is not bool or type(layer.get("locked")) is not bool
                    or not isinstance(layer.get("pathIds"), list)
                    or not all(isinstance(value, str) for value in layer["pathIds"])
                    or not isinstance(layer.get("imageIds"), list)
                    or not all(isinstance(value, str) for value in layer["imageIds"])
                    or not isinstance(layer_text_ids, list)
                    or not all(isinstance(value, str) for value in layer_text_ids)):
                raise ValueError("图层数据无效")
            layer_ids.add(layer["id"])
            layers_by_id[layer["id"]] = layer
            path_references.extend(layer["pathIds"])
            image_references.extend(layer["imageIds"])
            text_references.extend(layer_text_ids)
            has_items = "items" in layer
            items = layer.get("items")
            if kind == "group":
                if layer["pathIds"] or layer["imageIds"] or layer_text_ids or (has_items and items != []):
                    raise ValueError("图层组内容无效")
                continue
            if not has_items:
                continue
            if not isinstance(items, list):
                raise ValueError("图层项目无效")
            item_references = {"path": [], "image": [], "text": []}
            seen_items = set()
            for item in items:
                if (not isinstance(item, dict) or item.get("type") not in item_references
                        or not isinstance(item.get("id"), str)
                        or ("visible" in item and type(item["visible"]) is not bool)
                        or ("locked" in item and type(item["locked"]) is not bool)
                        or (item.get("type"), item.get("id")) in seen_items):
                    raise ValueError("图层项目无效")
                reference = (item["type"], item["id"])
                seen_items.add(reference)
                item_references[item["type"]].append(item["id"])
            expected = {"path": layer["pathIds"], "image": layer["imageIds"], "text": layer_text_ids}
            if any(len(item_references[kind]) != len(expected[kind])
                   or set(item_references[kind]) != set(expected[kind]) for kind in expected):
                raise ValueError("图层项目引用无效")
        for layer in layers:
            parent_id = layer.get("parentId")
            if parent_id is not None and (parent_id not in layers_by_id
                                          or layers_by_id[parent_id].get("kind", "layer") != "group"):
                raise ValueError("图层组引用无效")
            ancestors = set()
            current = layer
            while current.get("parentId") is not None:
                if current["id"] in ancestors:
                    raise ValueError("图层组不得循环嵌套")
                ancestors.add(current["id"])
                current = layers_by_id[current["parentId"]]
        if len(path_references) != len(ids) or set(path_references) != ids:
            raise ValueError("图层曲线引用无效")
        if len(image_references) != len(image_ids) or set(image_references) != image_ids:
            raise ValueError("图层图片引用无效")
        if len(text_references) != len(text_ids) or set(text_references) != text_ids:
            raise ValueError("图层文字引用无效")
    if "operationHistory" in data:
        if not allow_operation_history:
            raise ValueError("历史快照不得嵌套操作记录")
        validate_operation_history(data["operationHistory"])


def visible_layer_items(data):
    """Yield visible editable content in recursive bottom-to-top paint order."""
    paths = {path["id"]: path for path in data["paths"]}
    images = {image["id"]: image for image in data.get("images", [])}
    texts = {text["id"]: text for text in data.get("texts", [])}
    layers = data["layers"]
    children = {}
    for layer in layers:
        children.setdefault(layer.get("parentId"), []).append(layer)

    def visit(parent_id, inherited_visible=True):
        for layer in children.get(parent_id, []):
            visible = inherited_visible and layer["visible"]
            if layer.get("kind", "layer") == "group":
                yield from visit(layer["id"], visible)
                continue
            if not visible:
                continue
            if "items" in layer:
                item_source = layer["items"]
            else:
                image_ids, path_ids, text_ids = set(layer["imageIds"]), set(layer["pathIds"]), set(layer.get("textIds", []))
                item_source = ([{"type": "image", "id": item["id"]} for item in data.get("images", []) if item["id"] in image_ids]
                               + [{"type": "path", "id": item["id"]} for item in data["paths"] if item["id"] in path_ids]
                               + [{"type": "text", "id": item["id"]} for item in data.get("texts", []) if item["id"] in text_ids])
            stores = {"path": paths, "image": images, "text": texts}
            for item in item_source:
                if item.get("visible") is not False:
                    yield item["type"], stores[item["type"]][item["id"]]

    yield from visit(None)


def resolved_dimensions(data):
    """Derive dimension labels in a copy so stale saved fields are never rendered."""
    if not any("dimension" in text for text in data.get("texts", [])):
        return data
    result = copy.deepcopy(data)
    result["texts"] = [vector_dimension.resolve_dimension(
                           text, result.get("calibration"), result.get("paths", []))
                       if "dimension" in text else text for text in result["texts"]]
    return result


def export_bounds(data):
    data = resolved_dimensions(data)
    width, height = data["width"], data["height"]
    min_x, min_y, max_x, max_y = 0, 0, width, height

    def cubic_value(p0, p1, p2, p3, t):
        u = 1 - t
        return u**3 * p0 + 3 * u*u*t * p1 + 3 * u*t*t * p2 + t**3 * p3

    def extrema(p0, p1, p2, p3):
        a = -p0 + 3*p1 - 3*p2 + p3
        b = 3*p0 - 6*p1 + 3*p2
        c = -3*p0 + 3*p1
        qa, qb = 3*a, 2*b
        if abs(qa) < 1e-12:
            roots = [] if abs(qb) < 1e-12 else [-c/qb]
        else:
            discriminant = qb*qb - 4*qa*c
            roots = [] if discriminant < 0 else [(-qb-math.sqrt(discriminant))/(2*qa), (-qb+math.sqrt(discriminant))/(2*qa)]
        return [t for t in roots if 0 < t < 1]

    if "layers" in data:
        visible_items = list(visible_layer_items(data))
        paths = [value for kind, value in visible_items if kind == "path"]
        images = [value for kind, value in visible_items if kind == "image"]
        texts = [value for kind, value in visible_items if kind == "text"]
    else:
        paths, images, texts = data["paths"], [], []

    for image in images:
        center_x = image["x"] + image["width"] / 2
        center_y = image["y"] + image["height"] / 2
        angle = math.radians(image.get("rotation", 0))
        cosine, sine = math.cos(angle), math.sin(angle)
        corners = []
        for x in (image["x"], image["x"] + image["width"]):
            for y in (image["y"], image["y"] + image["height"]):
                offset_x, offset_y = x - center_x, y - center_y
                corners.append((
                    center_x + cosine * offset_x - sine * offset_y,
                    center_y + sine * offset_x + cosine * offset_y,
                ))
        min_x = min(min_x, *(point[0] for point in corners))
        min_y = min(min_y, *(point[1] for point in corners))
        max_x = max(max_x, *(point[0] for point in corners))
        max_y = max(max_y, *(point[1] for point in corners))

    for text in texts:
        lines = text_lines(text)
        text_width = max(len(line) * text["fontSize"] * 1.2 for line in lines)
        text_height = text["fontSize"] * 1.2 * len(lines)
        angle = math.radians(text.get("rotation", 0))
        cosine, sine = math.cos(angle), math.sin(angle)
        corners = []
        for offset_x in (0, text_width):
            for offset_y in (0, text_height):
                corners.append((
                    text["x"] + cosine * offset_x - sine * offset_y,
                    text["y"] + sine * offset_x + cosine * offset_y,
                ))
        min_x = min(min_x, *(point[0] for point in corners))
        min_y = min(min_y, *(point[1] for point in corners))
        max_x = max(max_x, *(point[0] for point in corners))
        max_y = max(max_y, *(point[1] for point in corners))
        marker = text.get("positionMarker")
        if marker is not None:
            radius = text["fontSize"] * 0.16
            leader_offset = text["fontSize"] * 0.6
            leader_x = text["x"] - sine * leader_offset
            leader_y = text["y"] + cosine * leader_offset
            min_x = min(min_x, marker["x"] - radius, leader_x)
            min_y = min(min_y, marker["y"] - radius, leader_y)
            max_x = max(max_x, marker["x"] + radius, leader_x)
            max_y = max(max_y, marker["y"] + radius, leader_y)
        if "dimension" in text:
            for start, end in vector_dimension.dimension_segments(text):
                min_x = min(min_x, start["x"], end["x"])
                min_y = min(min_y, start["y"], end["y"])
                max_x = max(max_x, start["x"], end["x"])
                max_y = max(max_y, start["y"], end["y"])

    for path in (path for path in paths if path.get("visible") is not False):
        nodes = path["nodes"]
        if not nodes:
            continue
        points = [(nodes[0]["x"], nodes[0]["y"])]
        for index in range(len(nodes) - 1 + bool(path.get("closed"))):
            start, end = nodes[index], nodes[(index + 1) % len(nodes)]
            parameters = set(extrema(start["x"], start["out"]["x"], end["in"]["x"], end["x"]))
            parameters.update(extrema(start["y"], start["out"]["y"], end["in"]["y"], end["y"]))
            points.append((end["x"], end["y"]))
            points.extend((
                cubic_value(start["x"], start["out"]["x"], end["in"]["x"], end["x"], t),
                cubic_value(start["y"], start["out"]["y"], end["in"]["y"], end["y"], t)
            ) for t in parameters)
        min_x = min(min_x, *(point[0] for point in points))
        min_y = min(min_y, *(point[1] for point in points))
        max_x = max(max_x, *(point[0] for point in points))
        max_y = max(max_y, *(point[1] for point in points))

    padding = 4
    if min_x < 0:
        min_x -= padding
    if min_y < 0:
        min_y -= padding
    if max_x > width:
        max_x += padding
    if max_y > height:
        max_y += padding
    return min_x, min_y, max_x - min_x, max_y - min_y


def preview_svg(data):
    data = resolved_dimensions(data)
    image_w, image_h = data["width"], data["height"]
    x, y, w, h = export_bounds(data)
    fmt = lambda value: f'{value:.12g}'
    calibration = data.get("calibration")
    if calibration:
        pixels = math.hypot(calibration["a"]["x"] - calibration["b"]["x"], calibration["a"]["y"] - calibration["b"]["y"])
        millimeters_per_pixel = calibration["length"] * (10 if calibration["unit"] == "cm" else 1) / pixels
        description = f'图像保持像素坐标；已按用户两点标定，1 px = {millimeters_per_pixel:.12g} mm；修改沟通图，非生产切割版。'
    else:
        description = '图像像素坐标，未标定毫米；修改沟通图，非生产切割版。'
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{fmt(w)}px" height="{fmt(h)}px" viewBox="{fmt(x)} {fmt(y)} {fmt(w)} {fmt(h)}">', f'<desc>{description}</desc>']
    if data.get("image"):
        parts.append(f'<image width="{image_w}" height="{image_h}" href={quoteattr(data["image"]["dataUrl"])} opacity="0.65"/>')

    def image_element(image):
        center_x = image["x"] + image["width"] / 2
        center_y = image["y"] + image["height"] / 2
        transform = (f' transform="rotate({fmt(image["rotation"])} {fmt(center_x)} {fmt(center_y)})"'
                     if "rotation" in image else "")
        return (f'<image x="{fmt(image["x"])}" y="{fmt(image["y"])}" '
                f'width="{fmt(image["width"])}" height="{fmt(image["height"])}" '
                f'href={quoteattr(image["dataUrl"])} opacity="{fmt(image["opacity"])}" preserveAspectRatio="none"{transform}>'
                f'<title>{escape(image["name"])}</title></image>')

    def pt(n):
        return f'{n["x"]:.6f} {n["y"]:.6f}'

    def path_element(p):
        ns = p["nodes"]
        if not ns or p.get("visible") is False:
            return None
        d = "M " + pt(ns[0])
        for i in range(len(ns) - 1 + bool(p.get("closed"))):
            a, b = ns[i], ns[(i + 1) % len(ns)]
            d += f' C {pt(a["out"])} {pt(b["in"])} {pt(b)}'
        if p.get("closed"):
            d += " Z"
        dash = ' stroke-dasharray="8 6"' if p.get("dashed") is True else ''
        return f'<path d={quoteattr(d)} fill="none" stroke={quoteattr(p["color"])} stroke-width="2"{dash}><title>{escape(str(p.get("name", "")))}</title><desc>{escape(str(p.get("note", "")))}</desc></path>'

    def text_element(text):
        x = fmt(text["x"])
        font_size = text["fontSize"]
        baseline = text["y"] + font_size
        transform = (f' transform="rotate({fmt(text["rotation"])} {x} {fmt(text["y"])})"'
                     if "rotation" in text else "")
        spans = []
        for index, line in enumerate(text_lines(text)):
            y = fmt(baseline + index * font_size * 1.2)
            spans.append(f'<tspan x="{x}" y="{y}">{escape(line)}</tspan>')
        marker_elements = ""
        if "dimension" in text:
            color = quoteattr(text["color"])
            marker_elements += "".join(
                f'<line x1="{fmt(start["x"])}" y1="{fmt(start["y"])}" '
                f'x2="{fmt(end["x"])}" y2="{fmt(end["y"])}" '
                f'stroke={color} stroke-width="{fmt(font_size * 0.06)}"/>'
                for start, end in vector_dimension.dimension_segments(text)
            )
        marker = text.get("positionMarker")
        if marker is not None:
            marker_x, marker_y = fmt(marker["x"]), fmt(marker["y"])
            angle = math.radians(text.get("rotation", 0))
            leader_offset = font_size * 0.6
            leader_x = fmt(text["x"] - math.sin(angle) * leader_offset)
            leader_y = fmt(text["y"] + math.cos(angle) * leader_offset)
            color = quoteattr(text["color"])
            marker_elements = (
                f'<line x1="{marker_x}" y1="{marker_y}" x2="{leader_x}" y2="{leader_y}" '
                f'stroke={color} stroke-width="{fmt(font_size * 0.06)}"/>'
                f'<circle cx="{marker_x}" cy="{marker_y}" r="{fmt(font_size * 0.16)}" fill={color}/>'
            )
        return marker_elements + (f'<text x="{x}" y="{fmt(baseline)}" font-family="sans-serif" '
                                  f'font-size="{fmt(font_size)}" fill={quoteattr(text["color"])} xml:space="preserve"{transform}>'
                                  + "".join(spans) + "</text>")

    if "layers" in data:
        for kind, item in visible_layer_items(data):
            element = image_element(item) if kind == "image" else text_element(item) if kind == "text" else path_element(item)
            if element is not None:
                parts.append(element)
    else:
        parts.extend(element for path in data["paths"] if (element := path_element(path)))
    parts.append("</svg>")
    return "\n".join(parts)


def persist(data):
    validate(data)
    data = resolved_dimensions(data)
    SAVES.mkdir(parents=True, exist_ok=True)
    name = re.sub(r"[^\w\-\u4e00-\u9fff]+", "_", str(data.get("title", "改线")))[:60] or "改线"
    stem = f'{datetime.now().strftime("%Y%m%d_%H%M%S")}_{name}_{uuid.uuid4().hex[:6]}'
    data["savedAt"] = datetime.now().astimezone().isoformat()
    if EDITOR.get('drawingId'):
        data['drawingId'] = EDITOR['drawingId']
    file = SAVES / (stem + ".json")
    # Unique immutable revisions; publish latest only after both outputs exist.
    file.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    (SAVES / (stem + ".svg")).write_text(preview_svg(data), encoding="utf-8")
    temp = SAVES / ("latest-" + uuid.uuid4().hex + ".tmp")
    temp.write_text(file.name, encoding="utf-8")
    os.replace(temp, SAVES / "latest.txt")
    return {"filename": file.name, "path": str(file)}


class LocalServer(ThreadingHTTPServer):
    # Browsers prefetch the editor scripts together; keep this burst off the
    # platform's tiny default accept queue instead of resetting connections.
    request_queue_size = 64

    def __init__(self, *args):
        super().__init__(*args)
        self.editor_lock = threading.Lock()
        self.pages = {}
        self.closing = False


def health_info():
    return {"app": "daban-curve-editor-v1", "project": str(PROJECT), "saves": str(SAVES),
            "workspace": WORKSPACE, "editorRevision": EDITOR_REVISION, "editor": EDITOR, "instance": INSTANCE,
            "registryScope": registry.scope(), "edition": EDITION}


def rename_editor(name):
    value = {**EDITOR, 'name': registry.valid_name(name)}
    registry.atomic_json(registry.metadata_path(SAVES), value)
    EDITOR.update(value)
    for entry in registry.entries():
        if entry.get('instance') == INSTANCE:
            entry['name'] = EDITOR['name']
            registry.store(entry)
    return EDITOR


def record_edit(edited_at):
    if edited_at <= EDITOR.get('lastEditedAt', 0):
        return
    registry.atomic_json(registry.metadata_path(SAVES), {**EDITOR, 'lastEditedAt': edited_at})
    EDITOR['lastEditedAt'] = edited_at


def saved_artwork_changed(data):
    try:
        name = (SAVES / 'latest.txt').read_text().strip()
        if Path(name).name != name or not name.endswith('.json'):
            return True
        previous = json.loads((SAVES / name).read_text())
        content = lambda doc: {k: v for k, v in doc.items() if k not in {'savedAt', 'drawingId'}}
        return content(previous) != content(data)
    except (OSError, ValueError, AttributeError):
        return True


def curve_clipboard(data):
    """Share only explicitly copied curves between local editors in this edition/scope."""
    if not isinstance(data, dict) or data.get('action') not in ('read', 'write'):
        raise ValueError('曲线剪贴板请求无效')
    path = registry.directory() / 'clipboard' / (EDITION + '.json')
    if data['action'] == 'read':
        try:
            with path.open('rb') as file:
                raw = file.read(MAX_BODY + 1)
            if len(raw) > MAX_BODY:
                raise ValueError('曲线剪贴板超过32MB')
            return json.loads(raw)
        except FileNotFoundError:
            return None
    payload = data.get('clipboard')
    if (not isinstance(payload, dict) or payload.get('format') != 'curve-editor-clipboard'
            or type(payload.get('version')) is not int or payload.get('version') not in (1, 2, 3)
            or not isinstance(payload.get('paths'), list)):
        raise ValueError('曲线剪贴板格式无效')
    version = payload['version']
    if version < 3 and not payload['paths']:
        raise ValueError('曲线剪贴板格式无效')
    if version == 3:
        if (not isinstance(payload.get('images'), list) or not isinstance(payload.get('texts'), list)
                or not payload['paths'] and not payload['images'] and not payload['texts']):
            raise ValueError('曲线剪贴板格式无效')
        images, texts = payload['images'], payload['texts']
    else:
        images, texts = [], []
    document = {'format': 'daban-curve-editor', 'version': 1, 'units': 'image-px',
                'width': 1, 'height': 1, 'paths': payload['paths']}
    if version >= 2:
        if ('calibration' not in payload or not isinstance(payload.get('sourcePageId'), str)
                or not payload['sourcePageId'].strip() or len(payload['sourcePageId']) > 200):
            raise ValueError('曲线剪贴板缺少尺寸或来源信息，请重新复制')
        document['calibration'] = payload['calibration']
    if version == 3:
        document.update(images=images, texts=texts, layers=[{
            'id': 'clipboard', 'name': '剪贴板', 'visible': True, 'locked': False,
            'pathIds': [item.get('id') if isinstance(item, dict) else None for item in payload['paths']],
            'imageIds': [item.get('id') if isinstance(item, dict) else None for item in images],
            'textIds': [item.get('id') if isinstance(item, dict) else None for item in texts],
        }])
    validate(document, allow_operation_history=False)
    if any(not p['nodes'] for p in payload['paths']):
        raise ValueError('剪贴板中的曲线没有节点')
    if version == 3 and 'items' in payload:
        items = payload['items']
        if not isinstance(items, list):
            raise ValueError('剪贴板项目顺序无效')
        expected = ({('path', item['id']) for item in payload['paths']}
                    | {('image', item['id']) for item in images}
                    | {('text', item['id']) for item in texts})
        references = []
        for item in items:
            if (not isinstance(item, dict) or set(item) != {'type', 'id'}
                    or item.get('type') not in ('path', 'image', 'text')
                    or not isinstance(item.get('id'), str)):
                raise ValueError('剪贴板项目顺序无效')
            references.append((item['type'], item['id']))
        if len(references) != len(expected) or len(set(references)) != len(references) or set(references) != expected:
            raise ValueError('剪贴板项目引用无效')
    stored = {key: payload[key] for key in ('format', 'version', 'paths')}
    if version >= 2:
        stored.update(calibration=payload['calibration'], sourcePageId=payload['sourcePageId'])
    if version == 3:
        stored.update(images=images, texts=texts)
        if 'items' in payload:
            stored['items'] = payload['items']
    if 'copiedAt' in payload:
        if not number(payload['copiedAt'], 1e16) or payload['copiedAt'] <= 0:
            raise ValueError('曲线复制时间无效')
        stored['copiedAt'] = payload['copiedAt']
    path.parent.mkdir(parents=True, exist_ok=True)
    # The lock spans processes/ports; an older delayed request must not replace a newer copy.
    with path.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            existing = json.loads(path.read_text())
        except (FileNotFoundError, ValueError):
            existing = None
        previous_time = existing.get('copiedAt') if isinstance(existing, dict) else None
        if (number(previous_time, 1e16) and 'copiedAt' in stored
                and previous_time > stored['copiedAt']):
            return {'ok': True}
        registry.atomic_json(path, stored)
    return {'ok': True}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def allowed_host(self):
        return self.headers.get("Host") in {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}

    def respond(self, data, status=200, content_type="application/json; charset=utf-8", filename=None):
        if isinstance(data, (dict, list)) or data is None:
            data = json.dumps(data, ensure_ascii=False).encode("utf-8")
        elif isinstance(data, str):
            data = data.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if filename:
            self.send_header("X-Curve-Filename", quote(filename, safe=""))
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.allowed_host():
            return self.respond({"error": "Host denied"}, 403)
        path = urlsplit(self.path).path
        if path == "/api/health":
            return self.respond(health_info())
        if path == "/api/editor":
            return self.respond(EDITOR)
        if path == "/api/latest":
            try:
                name = (SAVES / "latest.txt").read_text().strip()
                if Path(name).name != name or not name.endswith(".json"):
                    raise ValueError()
                return self.respond(json.loads((SAVES / name).read_text()), filename=name)
            except (OSError, ValueError):
                return self.respond(None)
        if path not in ALLOWED:
            return self.respond({"error": "Not found"}, 404)
        name, mime = ALLOWED[path]
        body = STATIC_FILES[name]
        if name == "index.html":
            html = body.decode("utf-8")
            html = html.replace("<title>通用矢量图编辑器 · 测试版</title>", f"<title>{escape(EDITOR['name'])}</title>")
            tag = '[测试]' if EDITION == 'test' else '[正式]'
            html = html.replace('data-edition="test">[测试]', f'data-edition="{EDITION}">{tag}')
            body = html.encode("utf-8")
        return self.respond(body, content_type=mime)

    def do_POST(self):
        expected = f"http://{self.headers.get('Host')}"
        if not self.allowed_host() or self.headers.get("Origin") != expected or self.headers.get("Sec-Fetch-Site") not in (None, "same-origin"):
            return self.respond({"error": "Only same-origin local saves are allowed"}, 403)
        if self.path not in ("/api/save", "/api/editor", "/api/presence", "/api/manage", "/api/curve-clipboard", "/api/image-clipboard", "/api/vector/import", "/api/vector/export", "/api/vector/preview"):
            return self.respond({"error": "Not found"}, 404)
        if self.path == "/api/manage" and not secrets.compare_digest(self.headers.get('X-Editor-Token', ''), MANAGE_TOKEN):
            return self.respond({"error": "管理凭据无效"}, 403)
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.respond({"error": "Expected JSON"}, 415)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            limit = MAX_BODY if self.path in ('/api/save', '/api/curve-clipboard', '/api/image-clipboard', '/api/vector/import', '/api/vector/export', '/api/vector/preview') else 4096
            if size < 1 or size > limit:
                return self.respond({"error": "文件超过32MB"}, 413)
            data = json.loads(self.rfile.read(size))
            if self.path == '/api/image-clipboard':
                # Automated tests never consult the user's general pasteboard.
                # A deliberate native UI integration run can opt in explicitly.
                if EDITION == 'test' and os.environ.get('CURVE_EDITOR_NATIVE_CLIPBOARD_TEST') != '1':
                    return self.respond({'metadata': None})
                return self.respond(native_image_clipboard.read_metadata(data))
            if self.path == '/api/curve-clipboard':
                return self.respond(curve_clipboard(data))
            if self.path in ('/api/vector/import', '/api/vector/export', '/api/vector/preview'):
                if not isinstance(data, dict):
                    raise ValueError('矢量文件请求格式无效')
                if self.path == '/api/vector/import':
                    result = vector_io.import_file(data.get('name'), data.get('data'), data.get('unit'))
                    validate(result['document'])
                    return self.respond(result)
                document = data.get('document')
                validate(document, allow_operation_history=False)
                if self.path == '/api/vector/preview':
                    return self.respond(vector_io.preview_export(document, data.get('format'), data.get('layerIds')))
                result = vector_io.export_document(document, data.get('format'), data.get('layerIds'),
                                                   dxf_mode=data.get('dxfMode', 'polyline'))
                name = re.sub(r'[^\w\-\u4e00-\u9fff]+', '_', str(document.get('title', '矢量作品')))[:80] or '矢量作品'
                return self.respond(result['data'], content_type=result['mime'], filename=name+'.'+data['format'])
            if self.path != '/api/save':
                if not isinstance(data, dict):
                    raise ValueError('管理请求格式无效')
                with self.server.editor_lock:
                    if self.server.closing:
                        return self.respond({'error': '该编辑器正在关闭'}, 409)
                    if self.path == '/api/presence':
                        page = data.get('page')
                        if not isinstance(page, str) or not 1 <= len(page) <= 100 or type(data.get('dirty')) is not bool:
                            raise ValueError('页面状态无效')
                        previous = self.server.pages.get(page, {'sequence': 0})
                        sequence = data.get('sequence', previous['sequence'] + 1)
                        if type(sequence) is not int or not 1 <= sequence <= 2**53:
                            raise ValueError('页面状态序号无效')
                        edited_at = data.get('editedAt', 0)
                        if type(edited_at) not in (int, float) or not math.isfinite(edited_at) or edited_at < 0:
                            raise ValueError('编辑时间无效')
                        if sequence > previous['sequence']:
                            # Retain close tombstones: a delayed heartbeat must
                            # not resurrect the page after its pagehide beacon.
                            self.server.pages[page] = {'sequence': sequence, 'dirty': data['dirty'], 'closed': data.get('closed') is True}
                            if edited_at and not data.get('closed'):
                                record_edit(min(edited_at, time.time()))
                        return self.respond({'ok': True})
                    if self.path == '/api/editor' or data.get('action') == 'rename':
                        return self.respond(rename_editor(data.get('name')))
                    if data.get('action') in ('close', 'restart'):
                        restarting = data['action'] == 'restart'
                        if not restarting and any(p['dirty'] and not p['closed'] for p in self.server.pages.values()):
                            return self.respond({'error': '该编辑器有未保存修改，请先在页面保存，再点击删除'}, 409)
                        # Restart keeps browser canvases and local recovery records in place.
                        self.server.restarting = restarting
                        self.server.closing = True
                        self.respond({'closed': True})
                        threading.Thread(target=self.server.shutdown, daemon=True).start()
                        return
                    raise ValueError('未知管理操作')
            with self.server.editor_lock:
                edited_at = self.headers.get('X-Editor-Edited-At')
                if edited_at is not None:
                    edited_at = float(edited_at)
                    if not math.isfinite(edited_at) or edited_at < 0:
                        raise ValueError('编辑时间无效')
                elif saved_artwork_changed(data):
                    edited_at = time.time()
                result = persist(data)
                if edited_at:
                    record_edit(min(edited_at, time.time()))
            return self.respond(result)
        except vector_io.ImportUnitRequiredError as err:
            return self.respond({"error": str(err), "needsUnit": True}, 400)
        except (ValueError, TypeError, KeyError) as err:
            return self.respond({"error": str(err)}, 400)
        except OSError:
            return self.respond({"error": "本机文件保存失败，请下载备份"}, 500)


def main():
    global PROJECT, SAVES, WORKSPACE, EDITOR, EDITION
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, default=PROJECT, help="修改文件所属的项目目录")
    parser.add_argument("--port", default="auto" if os.environ.get("CURVE_EDITOR_EDITION") == "test" else "8767", help="端口号，0 由系统分配临时端口，或 auto 自动选择本机空闲端口")
    parser.add_argument("--open", action="store_true")
    parser.add_argument("--name", help="页面及状态栏中的名称")
    parser.add_argument("--blank", action="store_true", help="新工作区使用空白画板")
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--session", help="独立会话 ID；默认使用当前 Codex 会话")
    scope.add_argument("--shared", help="同项目的共享工作区名称；default 访问旧版项目存档")
    args = parser.parse_args()
    try:
        EDITION = registry.edition()
    except ValueError as error:
        parser.error(str(error))
    PROJECT = args.project.expanduser().resolve()
    if not PROJECT.is_dir():
        parser.error("项目目录不存在：" + str(PROJECT))
    client = os.environ.get("CODEX_THREAD_ID") or os.environ.get("CODEX_SESSION_ID") or str(uuid.uuid4())
    identity = args.shared if args.shared is not None else args.session if args.session is not None else client
    if not identity.strip() or len(identity) > 200 or any(ord(c) < 32 for c in identity):
        parser.error("工作区标识需为 1—200 个非空字符，不可包含控制字符")
    WORKSPACE = {"mode": "shared" if args.shared is not None else "isolated", "id": identity}
    base_name = "test-sessions" if EDITION == "test" else "sessions"
    base = PROJECT / "work/curve_editor" / base_name
    legacy = args.shared == "default"
    directory = "shared" if args.shared is not None else "isolated"
    scoped_path = base if legacy else base / directory / hashlib.sha256(identity.encode("utf-8")).hexdigest()
    SAVES = scoped_path.resolve()
    if SAVES != scoped_path or not SAVES.is_relative_to(PROJECT):
        parser.error("保存目录不可通过符号链接共用其他工作区或指向项目以外")
    try:
        EDITOR = {**registry.metadata(SAVES, WORKSPACE, PROJECT, args.name, args.blank), "edition": EDITION}
    except ValueError as error:
        parser.error(str(error))
    state_file = SAVES.parent / "server.json" if legacy else SAVES / "server.json"

    def workspace_url(port):
        url = f"http://127.0.0.1:{port}"
        return url + "?" + urlencode({"client": client}) if args.shared is not None else url

    def matching_server(port):
        try:
            with LOOPBACK_HTTP.open(f"http://127.0.0.1:{port}/api/health", timeout=.5) as response:
                health = json.load(response)
            return (health.get("app") == "daban-curve-editor-v1"
                    and registry.compatible(health)
                    and health.get("project") == str(PROJECT)
                    and health.get("editorRevision") == EDITOR_REVISION
                    and health.get("workspace") == WORKSPACE
                    and health.get("saves") == str(SAVES))
        except (OSError, ValueError, AttributeError):
            return False

    def reuse(port):
        url = workspace_url(port)
        info = registry.health(url)
        known = next((e for e in registry.entries() if registry.matches(e, info) and e.get('token')), {})
        if args.name is not None and known:
            registry.request(url, '/api/manage', {'action': 'rename', 'name': args.name}, known['token'])
            info = registry.health(url)
        registry.register(url, info, known.get('token'), known.get('pid'))
        if args.open:
            webbrowser.open(url)
        print("通用矢量图编辑器已经运行：" + url, flush=True)
        print("修改保存在：" + str(SAVES), flush=True)

    if args.port == "auto":
        try:
            previous = json.loads(state_file.read_text())["port"]
            if type(previous) is int and 1 <= previous <= 65535 and matching_server(previous):
                return reuse(previous)
        except (OSError, ValueError, KeyError, TypeError):
            pass
        configured_ports = os.environ.get("CURVE_EDITOR_AUTO_PORTS")
        if configured_ports is None:
            ports = [0] if EDITION == "test" else range(8767, 8867)
        else:
            try:
                ports = [int(value) for value in configured_ports.split(",") if value]
                if not ports or any(not 1 <= value <= 65535 for value in ports):
                    raise ValueError()
            except ValueError:
                raise SystemExit("CURVE_EDITOR_AUTO_PORTS 需为逗号分隔的 1—65535 端口") from None
    else:
        try:
            port = int(args.port)
            if not 0 <= port <= 65535:
                raise ValueError()
        except ValueError:
            parser.error("端口需为 0—65535 的整数或 auto")
        ports = [port]
    if EDITION == "test" and any(8767 <= value < 8867 for value in ports):
        parser.error("测试版不能占用正式版端口 8767—8866，请使用 --port 0")
    for port in ports:
        try:
            server = LocalServer(("127.0.0.1", port), Handler)
            port = server.server_port
            break
        except OSError:
            if port and matching_server(port):
                return reuse(port)
    else:
        raise SystemExit("端口被其他程序或项目占用；请使用 --port 指定另一个端口。")
    url = workspace_url(port)
    try:
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps({"port": port, "project": str(PROJECT), "workspace": WORKSPACE}, ensure_ascii=False))
    except OSError:
        server.server_close()
        raise SystemExit("无法写入项目目录：" + str(PROJECT))
    try:
        registry.register(url, health_info(), MANAGE_TOKEN, os.getpid())
    except OSError:
        server.server_close()
        raise SystemExit("无法写入本机编辑器列表")
    if args.open:
        threading.Timer(.3, lambda: webbrowser.open(url)).start()
    print("通用矢量图编辑器已启动：" + url, flush=True)
    print("修改保存在：" + str(SAVES), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if not getattr(server, 'restarting', False):
            registry.unregister(INSTANCE)


if __name__ == "__main__":
    main()
